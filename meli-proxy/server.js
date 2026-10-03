const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 10000;

const APP_URL =
  process.env.APP_URL ||
  "https://site-atualizar-pre-o-ml.onrender.com";

const CALLBACK_URL =
  `${APP_URL}/auth/callback`;

const AUTH_FILE =
  path.join(__dirname, ".ml-auth.json");

const KEY_FILE =
  path.join(__dirname, ".ml-auth.key");

/* =========================================================
   ARMAZENAMENTO
========================================================= */

function getEncryptionKey() {
  if (process.env.ML_ENCRYPTION_KEY) {
    return crypto
      .createHash("sha256")
      .update(process.env.ML_ENCRYPTION_KEY)
      .digest();
  }

  if (fs.existsSync(KEY_FILE)) {
    return fs.readFileSync(KEY_FILE);
  }

  const key = crypto.randomBytes(32);

  fs.writeFileSync(KEY_FILE, key, {
    mode: 0o600
  });

  return key;
}

const ENCRYPTION_KEY = getEncryptionKey();

function encrypt(text) {
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    ENCRYPTION_KEY,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final()
  ]);

  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64")
  ].join(".");
}

function decrypt(value) {
  const [
    ivBase64,
    tagBase64,
    encryptedBase64
  ] = value.split(".");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    ENCRYPTION_KEY,
    Buffer.from(ivBase64, "base64")
  );

  decipher.setAuthTag(
    Buffer.from(tagBase64, "base64")
  );

  return Buffer.concat([
    decipher.update(
      Buffer.from(encryptedBase64, "base64")
    ),
    decipher.final()
  ]).toString("utf8");
}

function loadStore() {
  if (!fs.existsSync(AUTH_FILE)) {
    return {};
  }

  try {
    const encrypted = fs.readFileSync(
      AUTH_FILE,
      "utf8"
    );

    return JSON.parse(
      decrypt(encrypted)
    );
  } catch {
    return {};
  }
}

function saveStore(data) {
  const encrypted = encrypt(
    JSON.stringify(data)
  );

  fs.writeFileSync(
    AUTH_FILE,
    encrypted,
    {
      mode: 0o600
    }
  );
}

/* =========================================================
   SESSÃO
========================================================= */

function createSession(store) {
  const sessionToken =
    crypto.randomBytes(32).toString("hex");

  store.sessionToken = sessionToken;

  saveStore(store);

  return sessionToken;
}

function getSession(req) {
  const cookie = req.headers.cookie || "";

  const match = cookie
    .split(";")
    .map(v => v.trim())
    .find(v =>
      v.startsWith("ml_session=")
    );

  if (!match) {
    return null;
  }

  return decodeURIComponent(
    match.substring("ml_session=".length)
  );
}

function requireAuth(req, res, next) {
  const store = loadStore();

  const session = getSession(req);

  if (
    !session ||
    !store.sessionToken ||
    session !== store.sessionToken
  ) {
    return res.status(401).json({
      ok: false,
      error: "Não autenticado"
    });
  }

  req.store = store;

  next();
}

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "ML Hub Pro",
    app_url: APP_URL,
    callback_url: CALLBACK_URL,
    time: new Date().toISOString()
  });
});

/* =========================================================
   INICIAR OAUTH
========================================================= */

app.post("/api/auth/start", (req, res) => {
  try {
    const {
      client_id,
      client_secret
    } = req.body;

    if (!client_id || !client_secret) {
      return res.status(400).json({
        ok: false,
        error: "Informe Client ID e Client Secret."
      });
    }

    const state =
      crypto.randomBytes(32).toString("hex");

    const store = loadStore();

    store.pendingOAuth = {
      client_id,
      client_secret,
      state,
      created_at: Date.now()
    };

    saveStore(store);

    const params = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: CALLBACK_URL,
      state,

      /*
       * Permissões necessárias para leitura,
       * alteração e renovação do acesso.
       */
      scope: "offline_access read write"
    });

    const authUrl =
      "https://auth.mercadolivre.com.br/authorization?" +
      params.toString();

    res.json({
      ok: true,
      auth_url: authUrl
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      ok: false,
      error: "Erro ao iniciar conexão."
    });
  }
});

/* =========================================================
   CALLBACK DO MERCADO LIVRE
========================================================= */

app.get("/auth/callback", async (req, res) => {
  try {
    const {
      code,
      state,
      error,
      error_description
    } = req.query;

    if (error) {
      return res.status(400).send(`
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Erro Mercado Livre</title>
          </head>
          <body style="font-family:Arial;padding:40px">
            <h2>Erro ao conectar Mercado Livre</h2>
            <p>${escapeHtml(error)}</p>
            <p>${escapeHtml(error_description || "")}</p>
          </body>
        </html>
      `);
    }

    if (!code || !state) {
      return res.status(400).send(`
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Erro</title>
          </head>
          <body style="font-family:Arial;padding:40px">
            <h2>Dados OAuth incompletos.</h2>
            <p>O Mercado Livre não enviou o código de autorização.</p>
          </body>
        </html>
      `);
    }

    const store = loadStore();

    if (!store.pendingOAuth) {
      return res.status(400).send(`
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Erro</title>
          </head>
          <body style="font-family:Arial;padding:40px">
            <h2>Sessão OAuth não encontrada.</h2>
            <p>Volte ao painel e tente conectar novamente.</p>
          </body>
        </html>
      `);
    }

    if (
      state !==
      store.pendingOAuth.state
    ) {
      return res.status(400).send(`
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Erro</title>
          </head>
          <body style="font-family:Arial;padding:40px">
            <h2>State OAuth inválido.</h2>
            <p>Por segurança, a conexão foi interrompida.</p>
          </body>
        </html>
      `);
    }

    /*
     * O código OAuth é temporário.
     */
    if (
      Date.now() -
      store.pendingOAuth.created_at >
      10 * 60 * 1000
    ) {
      delete store.pendingOAuth;

      saveStore(store);

      return res.status(400).send(`
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Expirado</title>
          </head>
          <body style="font-family:Arial;padding:40px">
            <h2>Conexão expirada.</h2>
            <p>Volte ao painel e tente novamente.</p>
          </body>
        </html>
      `);
    }

    const tokenResponse =
      await fetch(
        "https://api.mercadolibre.com/oauth/token",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/x-www-form-urlencoded"
          },
          body:
            new URLSearchParams({
              grant_type: "authorization_code",
              client_id:
                store.pendingOAuth.client_id,
              client_secret:
                store.pendingOAuth.client_secret,
              code,
              redirect_uri:
                CALLBACK_URL
            })
        }
      );

    const tokenData =
      await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error(
        "Erro token:",
        tokenData
      );

      return res.status(400).send(`
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Erro Mercado Livre</title>
          </head>
          <body style="font-family:Arial;padding:40px">
            <h2>Mercado Livre recusou a conexão.</h2>
            <pre style="white-space:pre-wrap">${escapeHtml(
              JSON.stringify(
                tokenData,
                null,
                2
              )
            )}</pre>
          </body>
        </html>
      `);
    }

    store.client_id =
      store.pendingOAuth.client_id;

    store.client_secret =
      store.pendingOAuth.client_secret;

    store.access_token =
      tokenData.access_token;

    store.refresh_token =
      tokenData.refresh_token || null;

    store.user_id =
      tokenData.user_id || null;

    store.expires_at =
      Date.now() +
      ((tokenData.expires_in || 21600) * 1000);

    store.connected_at =
      new Date().toISOString();

    delete store.pendingOAuth;

    const sessionToken =
      createSession(store);

    res.setHeader(
      "Set-Cookie",
      `ml_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
    );

    res.redirect("/?connected=1");

  } catch (error) {
    console.error(
      "OAuth callback error:",
      error
    );

    res.status(500).send(`
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Erro</title>
        </head>
        <body style="font-family:Arial;padding:40px">
          <h2>Erro interno ao conectar.</h2>
          <p>${escapeHtml(error.message)}</p>
        </body>
      </html>
    `);
  }
});

/* =========================================================
   RENOVAÇÃO DO TOKEN
========================================================= */

async function getValidAccessToken(store) {
  if (
    store.access_token &&
    store.expires_at &&
    Date.now() <
      store.expires_at - 120000
  ) {
    return store.access_token;
  }

  if (!store.refresh_token) {
    return store.access_token;
  }

  const response =
    await fetch(
      "https://api.mercadolibre.com/oauth/token",
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body:
          new URLSearchParams({
            grant_type: "refresh_token",
            client_id: store.client_id,
            client_secret: store.client_secret,
            refresh_token: store.refresh_token
          })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {
    console.error(
      "Erro renovando token:",
      data
    );

    throw new Error(
      "Não foi possível renovar o token do Mercado Livre."
    );
  }

  store.access_token =
    data.access_token;

  if (data.refresh_token) {
    store.refresh_token =
      data.refresh_token;
  }

  store.expires_at =
    Date.now() +
    ((data.expires_in || 21600) * 1000);

  saveStore(store);

  return store.access_token;
}

/* =========================================================
   STATUS
========================================================= */

app.get(
  "/api/auth/status",
  (req, res) => {
    const store = loadStore();

    const session =
      getSession(req);

    const connected =
      !!(
        session &&
        store.sessionToken &&
        session === store.sessionToken &&
        store.access_token
      );

    res.json({
      ok: true,
      connected,
      user_id:
        connected
          ? store.user_id
          : null,
      expires_at:
        connected
          ? store.expires_at
          : null
    });
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  "/api/auth/logout",
  (req, res) => {
    const store = loadStore();

    delete store.sessionToken;

    saveStore(store);

    res.setHeader(
      "Set-Cookie",
      "ml_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"
    );

    res.json({
      ok: true
    });
  }
);

/* =========================================================
   DADOS DA CONTA
========================================================= */

app.get(
  "/api/me",
  requireAuth,
  async (req, res) => {
    try {
      const token =
        await getValidAccessToken(
          req.store
        );

      const response =
        await fetch(
          "https://api.mercadolibre.com/users/me",
          {
            headers: {
              Authorization:
                `Bearer ${token}`
            }
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        return res.status(
          response.status
        ).json(data);
      }

      res.json({
        ok: true,
        user: data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================================================
   PRODUTOS / ANÚNCIOS
========================================================= */

app.get(
  "/api/anuncios",
  requireAuth,
  async (req, res) => {
    try {
      const token =
        await getValidAccessToken(
          req.store
        );

      const userResponse =
        await fetch(
          "https://api.mercadolibre.com/users/me",
          {
            headers: {
              Authorization:
                `Bearer ${token}`
            }
          }
        );

      const user =
        await userResponse.json();

      if (!user.id) {
        return res.status(400).json({
          ok: false,
          error: "Não foi possível identificar o usuário."
        });
      }

      const searchResponse =
        await fetch(
          `https://api.mercadolibre.com/users/${user.id}/items/search?limit=50`,
          {
            headers: {
              Authorization:
                `Bearer ${token}`
            }
          }
        );

      const searchData =
        await searchResponse.json();

      if (!searchResponse.ok) {
        return res.status(
          searchResponse.status
        ).json(searchData);
      }

      const ids =
        searchData.results || [];

      if (ids.length === 0) {
        return res.json({
          ok: true,
          total: 0,
          anuncios: []
        });
      }

      const detailResponse =
        await fetch(
          `https://api.mercadolibre.com/items?ids=${ids.join(",")}`,
          {
            headers: {
              Authorization:
                `Bearer ${token}`
            }
          }
        );

      const detailData =
        await detailResponse.json();

      const anuncios =
        Array.isArray(detailData)
          ? detailData
              .map(item => item.body)
              .filter(Boolean)
          : [];

      res.json({
        ok: true,
        total: anuncios.length,
        anuncios
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================================================
   ATUALIZAR PREÇO
========================================================= */

app.post(
  "/api/atualizar-preco",
  requireAuth,
  async (req, res) => {
    try {
      const {
        item_id,
        price
      } = req.body;

      if (!item_id || price === undefined) {
        return res.status(400).json({
          ok: false,
          error:
            "Informe item_id e price."
        });
      }

      const token =
        await getValidAccessToken(
          req.store
        );

      const response =
        await fetch(
          `https://api.mercadolibre.com/items/${encodeURIComponent(item_id)}`,
          {
            method: "PUT",
            headers: {
              Authorization:
                `Bearer ${token}`,
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              price: Number(price)
            })
          }
        );

      const data =
        await response.json();

      res.status(
        response.ok ? 200 : response.status
      ).json({
        ok: response.ok,
        data
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);

/* =========================================================
   PÁGINA
========================================================= */

app.use(
  express.static(__dirname)
);

app.get("*", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  );
});

/* =========================================================
   AUXILIAR
========================================================= */

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =========================================================
   SERVIDOR
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `ML Hub Pro rodando na porta ${PORT}`
    );

    console.log(
      `APP_URL: ${APP_URL}`
    );

    console.log(
      `CALLBACK_URL: ${CALLBACK_URL}`
    );
  }
);
