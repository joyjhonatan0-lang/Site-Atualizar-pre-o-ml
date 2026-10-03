"use strict";

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 3000;

const APP_URL = (
  process.env.APP_URL ||
  "https://site-atualizar-pre-o-ml.onrender.com"
).replace(/\/+$/, "");

const CALLBACK_URL = `${APP_URL}/auth/callback`;

const AUTH_FILE = path.join(__dirname, ".ml-auth.enc");
const KEY_FILE = path.join(__dirname, ".ml-auth.key");

const ML_API = "https://api.mercadolibre.com";
const ML_AUTH = "https://auth.mercadolivre.com.br/authorization";
const ML_TOKEN = "https://api.mercadolibre.com/oauth/token";

const SESSION_COOKIE = "ml_session";

const sessions = new Map();

app.set("trust proxy", 1);

app.use(
  cors({
    origin: APP_URL,
    credentials: true
  })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false }));

/* =========================================================
   SEGURANÇA / ARMAZENAMENTO
========================================================= */

function getEncryptionKey() {
  if (process.env.ML_ENCRYPTION_KEY) {
    const key = Buffer.from(process.env.ML_ENCRYPTION_KEY, "base64");

    if (key.length !== 32) {
      throw new Error(
        "ML_ENCRYPTION_KEY precisa ser uma chave Base64 de 32 bytes."
      );
    }

    return key;
  }

  if (fs.existsSync(KEY_FILE)) {
    const key = fs.readFileSync(KEY_FILE);

    if (key.length === 32) {
      return key;
    }
  }

  const key = crypto.randomBytes(32);

  try {
    fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
  } catch (error) {
    console.error("Não foi possível salvar a chave:", error.message);
  }

  return key;
}

function encrypt(text) {
  const key = getEncryptionKey();

  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key,
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
  const key = getEncryptionKey();

  const parts = String(value).split(".");

  if (parts.length !== 3) {
    throw new Error("Arquivo de autenticação inválido.");
  }

  const iv = Buffer.from(parts[0], "base64");
  const tag = Buffer.from(parts[1], "base64");
  const encrypted = Buffer.from(parts[2], "base64");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}

function loadStore() {
  if (!fs.existsSync(AUTH_FILE)) {
    return {
      auth: null,
      pending: null
    };
  }

  try {
    const raw = fs.readFileSync(AUTH_FILE, "utf8");
    return JSON.parse(decrypt(raw));
  } catch (error) {
    console.error(
      "Não foi possível ler o armazenamento de autenticação:",
      error.message
    );

    return {
      auth: null,
      pending: null
    };
  }
}

function saveStore(store) {
  const encrypted = encrypt(JSON.stringify(store));

  fs.writeFileSync(AUTH_FILE, encrypted, {
    mode: 0o600
  });
}

function updateStore(callback) {
  const store = loadStore();

  callback(store);

  saveStore(store);

  return store;
}

/* =========================================================
   SESSÃO
========================================================= */

function hashSession(session) {
  return crypto
    .createHash("sha256")
    .update(session)
    .digest("hex");
}

function createSession() {
  const token = crypto.randomBytes(32).toString("hex");
  const hash = hashSession(token);

  sessions.set(hash, {
    createdAt: Date.now()
  });

  return token;
}

function destroySession(token) {
  if (!token) return;

  sessions.delete(hashSession(token));
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
  );
}

function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  );
}

function parseCookies(req) {
  const header = req.headers.cookie || "";

  const cookies = {};

  header.split(";").forEach((part) => {
    const index = part.indexOf("=");

    if (index === -1) return;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    cookies[key] = decodeURIComponent(value);
  });

  return cookies;
}

function isAuthenticated(req) {
  const cookies = parseCookies(req);

  const session = cookies[SESSION_COOKIE];

  if (!session) return false;

  return sessions.has(hashSession(session));
}

function requireAuth(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({
      error: "Não conectado ao Mercado Livre.",
      code: "NOT_AUTHENTICATED"
    });
  }

  next();
}

/* =========================================================
   UTILITÁRIOS
========================================================= */

function randomString(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function createCodeChallenge(verifier) {
  return crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
}

function formEncode(data) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null && value !== "") {
      params.append(key, String(value));
    }
  }

  return params.toString();
}

async function readJson(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text
    };
  }
}

function mlErrorMessage(data, fallback) {
  if (!data) return fallback;

  return (
    data.message ||
    data.error_description ||
    data.error ||
    data.cause?.[0]?.message ||
    fallback
  );
}

/* =========================================================
   MERCADO LIVRE - AUTENTICAÇÃO
========================================================= */

async function exchangeAuthorizationCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier
}) {
  const body = formEncode({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });

  const response = await fetch(ML_TOKEN, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(
      mlErrorMessage(
        data,
        `Erro ao trocar código por token. HTTP ${response.status}`
      )
    );
  }

  return data;
}

async function refreshAccessToken() {
  const store = loadStore();
  const auth = store.auth;

  if (!auth) {
    throw new Error("Nenhuma conta do Mercado Livre conectada.");
  }

  if (!auth.refreshToken) {
    throw new Error(
      "Não existe Refresh Token. É necessário conectar novamente pelo Mercado Livre."
    );
  }

  const body = formEncode({
    grant_type: "refresh_token",
    client_id: auth.clientId,
    client_secret: auth.clientSecret,
    refresh_token: auth.refreshToken
  });

  const response = await fetch(ML_TOKEN, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(
      mlErrorMessage(
        data,
        `Erro ao renovar token. HTTP ${response.status}`
      )
    );
  }

  updateStore((current) => {
    if (!current.auth) return;

    current.auth.accessToken = data.access_token;
    current.auth.refreshToken =
      data.refresh_token || current.auth.refreshToken;

    current.auth.expiresAt =
      Date.now() + Number(data.expires_in || 21600) * 1000;

    if (data.user_id) {
      current.auth.userId = data.user_id;
    }

    if (data.scope) {
      current.auth.scope = data.scope;
    }

    current.auth.updatedAt = Date.now();
  });

  return data.access_token;
}

async function getValidAccessToken(forceRefresh = false) {
  const store = loadStore();

  if (!store.auth) {
    throw new Error("Mercado Livre não conectado.");
  }

  const expiresAt = Number(store.auth.expiresAt || 0);

  const needsRefresh =
    forceRefresh ||
    !store.auth.accessToken ||
    (expiresAt > 0 && expiresAt - Date.now() < 120000);

  if (needsRefresh && store.auth.refreshToken) {
    return refreshAccessToken();
  }

  if (!store.auth.accessToken) {
    throw new Error("Access Token inexistente.");
  }

  return store.auth.accessToken;
}

async function mlFetch(url, options = {}, retry = true) {
  let token = await getValidAccessToken();

  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
    Accept: "application/json"
  };

  let response = await fetch(url, {
    ...options,
    headers
  });

  if (response.status === 401 && retry) {
    token = await refreshAccessToken();

    response = await fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });
  }

  return response;
}

/* =========================================================
   ROTAS GERAIS
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

app.get("/api/auth/status", async (req, res) => {
  try {
    const store = loadStore();

    if (!store.auth || !isAuthenticated(req)) {
      return res.json({
        authenticated: false,
        connected: false
      });
    }

    let auth = store.auth;

    try {
      await getValidAccessToken();

      const refreshedStore = loadStore();

      auth = refreshedStore.auth || auth;
    } catch (error) {
      return res.json({
        authenticated: false,
        connected: false,
        error: error.message
      });
    }

    res.json({
      authenticated: true,
      connected: true,
      user_id: auth.userId || null,
      expires_at: auth.expiresAt || null,
      expires_in_seconds: auth.expiresAt
        ? Math.max(
            0,
            Math.floor((auth.expiresAt - Date.now()) / 1000)
          )
        : null,
      scope: auth.scope || null,
      callback_url: CALLBACK_URL
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================================================
   INÍCIO DO OAUTH
========================================================= */

app.post("/api/auth/start", async (req, res) => {
  try {
    const {
      client_id,
      client_secret,
      redirect_uri,
      access_token
    } = req.body || {};

    const clientId = String(client_id || "").trim();
    const clientSecret = String(client_secret || "").trim();
    const redirectUri = String(
      redirect_uri || CALLBACK_URL
    ).trim();
    const manualToken = String(access_token || "").trim();

    if (!clientId) {
      return res.status(400).json({
        error: "Informe o Client ID."
      });
    }

    if (!clientSecret) {
      return res.status(400).json({
        error: "Informe o Client Secret."
      });
    }

    if (redirectUri !== CALLBACK_URL) {
      return res.status(400).json({
        error:
          `A URL de retorno precisa ser exatamente: ${CALLBACK_URL}`
      });
    }

    /*
      Caso o usuário coloque um Access Token manualmente,
      validamos e salvamos. Porém, para renovação automática,
      o recomendado é usar OAuth e obter também o Refresh Token.
    */

    if (manualToken) {
      const response = await fetch(`${ML_API}/users/me`, {
        headers: {
          Authorization: `Bearer ${manualToken}`,
          Accept: "application/json"
        }
      });

      const data = await readJson(response);

      if (!response.ok) {
        return res.status(400).json({
          error: mlErrorMessage(
            data,
            "Access Token inválido."
          )
        });
      }

      const session = createSession();

      updateStore((store) => {
        store.auth = {
          clientId,
          clientSecret,
          redirectUri,
          accessToken: manualToken,
          refreshToken: null,
          expiresAt: Date.now() + 3600000,
          userId: data.id || data.user_id,
          scope: null,
          updatedAt: Date.now()
        };

        store.pending = null;
      });

      setSessionCookie(res, session);

      return res.json({
        ok: true,
        connected: true,
        message:
          "Access Token conectado. Para renovação automática, conecte novamente usando OAuth."
      });
    }

    /*
      OAuth + PKCE
    */

    const state = randomString(32);
    const codeVerifier = randomString(64);
    const codeChallenge = createCodeChallenge(codeVerifier);

    updateStore((store) => {
      store.pending = {
        state,
        codeVerifier,
        clientId,
        clientSecret,
        redirectUri,
        createdAt: Date.now()
      };
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256"
    });

    const authorizationUrl =
      `${ML_AUTH}?${params.toString()}`;

    res.json({
      ok: true,
      auth_url: authorizationUrl
    });
  } catch (error) {
    console.error("OAuth start:", error);

    res.status(500).json({
      error:
        error.message ||
        "Não foi possível iniciar a conexão com o Mercado Livre."
    });
  }
});

/* =========================================================
   CALLBACK OAUTH
========================================================= */

async function oauthCallback(req, res) {
  try {
    const code = String(
      req.query.code ||
      req.body?.code ||
      ""
    ).trim();

    const state = String(
      req.query.state ||
      req.body?.state ||
      ""
    ).trim();

    const oauthError = String(
      req.query.error ||
      req.body?.error ||
      ""
    ).trim();

    const oauthErrorDescription = String(
      req.query.error_description ||
      req.body?.error_description ||
      ""
    ).trim();

    if (oauthError) {
      return res.redirect(
        `/?oauth=error&message=${encodeURIComponent(
          oauthErrorDescription || oauthError
        )}`
      );
    }

    if (!code) {
      return res.redirect(
        `/?oauth=error&message=${encodeURIComponent(
          "O Mercado Livre não retornou o código de autorização."
        )}`
      );
    }

    const store = loadStore();
    const pending = store.pending;

    if (!pending) {
      return res.redirect(
        `/?oauth=error&message=${encodeURIComponent(
          "A solicitação de autorização expirou. Clique novamente em Conectar Mercado Livre."
        )}`
      );
    }

    /*
      State é obrigatório para garantir que o callback
      pertence à tentativa de conexão iniciada pelo painel.
    */

    if (!state || state !== pending.state) {
      return res.redirect(
        `/?oauth=error&message=${encodeURIComponent(
          "Falha de segurança: state OAuth inválido."
        )}`
      );
    }

    /*
      Não permitir callback antigo.
    */

    if (
      !pending.createdAt ||
      Date.now() - pending.createdAt > 10 * 60 * 1000
    ) {
      updateStore((current) => {
        current.pending = null;
      });

      return res.redirect(
        `/?oauth=error&message=${encodeURIComponent(
          "A tentativa de conexão expirou. Tente novamente."
        )}`
      );
    }

    const tokenData = await exchangeAuthorizationCode({
      clientId: pending.clientId,
      clientSecret: pending.clientSecret,
      code,
      redirectUri: pending.redirectUri,
      codeVerifier: pending.codeVerifier
    });

    if (!tokenData.access_token) {
      throw new Error(
        "O Mercado Livre não retornou um Access Token."
      );
    }

    if (!tokenData.refresh_token) {
      throw new Error(
        "O Mercado Livre não retornou um Refresh Token. Verifique se o acesso offline está habilitado na aplicação."
      );
    }

    updateStore((current) => {
      current.auth = {
        clientId: pending.clientId,
        clientSecret: pending.clientSecret,
        redirectUri: pending.redirectUri,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt:
          Date.now() +
          Number(tokenData.expires_in || 21600) * 1000,
        userId: tokenData.user_id || null,
        scope: tokenData.scope || null,
        updatedAt: Date.now()
      };

      current.pending = null;
    });

    const session = createSession();

    setSessionCookie(res, session);

    return res.redirect("/?oauth=success");
  } catch (error) {
    console.error("OAuth callback:", error);

    return res.redirect(
      `/?oauth=error&message=${encodeURIComponent(
        error.message ||
          "Erro ao conectar com o Mercado Livre."
      )}`
    );
  }
}

/*
  GET é o callback normal do Mercado Livre.
  POST também fica disponível para evitar 405 caso alguma
  configuração externa envie POST.
*/

app.get("/auth/callback", oauthCallback);
app.post("/auth/callback", oauthCallback);

/* =========================================================
   LOGOUT
========================================================= */

app.post("/api/auth/logout", (req, res) => {
  const cookies = parseCookies(req);

  destroySession(cookies[SESSION_COOKIE]);

  clearSessionCookie(res);

  res.json({
    ok: true
  });
});

/* =========================================================
   PERFIL DO USUÁRIO
========================================================= */

app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const response = await mlFetch(
      `${ML_API}/users/me`
    );

    const data = await readJson(response);

    if (!response.ok) {
      return res.status(response.status).json({
        error: mlErrorMessage(
          data,
          "Não foi possível consultar o usuário."
        ),
        details: data
      });
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================================================
   ANÚNCIOS
========================================================= */

async function getAllItemIds(userId) {
  const ids = [];

  let offset = 0;
  const limit = 50;

  while (true) {
    const url =
      `${ML_API}/users/${encodeURIComponent(userId)}/items/search` +
      `?limit=${limit}&offset=${offset}`;

    const response = await mlFetch(url);
    const data = await readJson(response);

    if (!response.ok) {
      throw new Error(
        mlErrorMessage(
          data,
          "Não foi possível buscar os anúncios."
        )
      );
    }

    const results = Array.isArray(data.results)
      ? data.results
      : [];

    ids.push(...results);

    const total = Number(data.paging?.total || 0);

    if (
      results.length === 0 ||
      ids.length >= total ||
      results.length < limit
    ) {
      break;
    }

    offset += limit;

    /*
      Proteção contra respostas anormais.
    */

    if (offset > 100000) {
      break;
    }
  }

  return ids;
}

async function getItemDetails(itemId) {
  const response = await mlFetch(
    `${ML_API}/items/${encodeURIComponent(itemId)}`
  );

  const data = await readJson(response);

  if (!response.ok) {
    throw new Error(
      mlErrorMessage(
        data,
        `Erro ao consultar anúncio ${itemId}.`
      )
    );
  }

  return data;
}

async function getSaleFee(itemId) {
  try {
    const response = await mlFetch(
      `${ML_API}/items/${encodeURIComponent(itemId)}/sale_fee`
    );

    const data = await readJson(response);

    if (!response.ok) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

function calculatePriceInfo(item, feeData) {
  const price = Number(item.price || 0);

  let fee = 0;

  if (feeData) {
    fee = Number(
      feeData.sale_fee_amount ||
      feeData.sale_fee ||
      feeData.total_fee ||
      0
    );
  }

  if (!fee && item.sale_fee) {
    fee = Number(item.sale_fee);
  }

  const freeShipping =
    item.shipping?.free_shipping === true;

  return {
    price,
    fee,
    free_shipping: freeShipping,
    available_quantity:
      Number(item.available_quantity || 0),
    sold_quantity:
      Number(item.sold_quantity || 0)
  };
}

app.get("/api/anuncios", requireAuth, async (req, res) => {
  try {
    const store = loadStore();

    if (!store.auth?.userId) {
      const meResponse = await mlFetch(
        `${ML_API}/users/me`
      );

      const me = await readJson(meResponse);

      if (!meResponse.ok) {
        throw new Error(
          mlErrorMessage(
            me,
            "Não foi possível descobrir o usuário do Mercado Livre."
          )
        );
      }

      updateStore((current) => {
        if (current.auth) {
          current.auth.userId = me.id;
        }
      });

      store.auth.userId = me.id;
    }

    const userId = store.auth.userId;

    const itemIds = await getAllItemIds(userId);

    /*
      Para não sobrecarregar a API, processamos em pequenos grupos.
    */

    const anuncios = [];

    for (let i = 0; i < itemIds.length; i += 5) {
      const batch = itemIds.slice(i, i + 5);

      const items = await Promise.all(
        batch.map(async (id) => {
          try {
            const item = await getItemDetails(id);

            const fee = await getSaleFee(id);

            const info = calculatePriceInfo(
              item,
              fee
            );

            return {
              id: item.id,
              title: item.title || "",
              price: info.price,
              original_price:
                Number(item.original_price || 0),
              available_quantity:
                info.available_quantity,
              sold_quantity:
                info.sold_quantity,
              status: item.status || "",
              permalink: item.permalink || "",
              thumbnail:
                item.thumbnail ||
                item.pictures?.[0]?.secure_url ||
                item.pictures?.[0]?.url ||
                "",
              category_id:
                item.category_id || "",
              listing_type_id:
                item.listing_type_id || "",
              free_shipping:
                info.free_shipping,
              sale_fee:
                info.fee,
              currency_id:
                item.currency_id || "BRL"
            };
          } catch (error) {
            return {
              id,
              title: "Erro ao carregar anúncio",
              error: error.message
            };
          }
        })
      );

      anuncios.push(...items);
    }

    res.json({
      ok: true,
      total: anuncios.length,
      anuncios
    });
  } catch (error) {
    console.error("Anúncios:", error);

    res.status(500).json({
      error:
        error.message ||
        "Erro ao carregar anúncios."
    });
  }
});

/* =========================================================
   ATUALIZAR UM PREÇO
========================================================= */

app.put("/api/atualizar-preco", requireAuth, async (req, res) => {
  try {
    const { id, price } = req.body || {};

    const itemId = String(id || "").trim();
    const newPrice = Number(price);

    if (!itemId) {
      return res.status(400).json({
        error: "Informe o ID do anúncio."
      });
    }

    if (!Number.isFinite(newPrice) || newPrice <= 0) {
      return res.status(400).json({
        error: "Informe um preço válido maior que zero."
      });
    }

    const response = await mlFetch(
      `${ML_API}/items/${encodeURIComponent(itemId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          price: newPrice
        })
      }
    );

    const data = await readJson(response);

    if (!response.ok) {
      return res.status(response.status).json({
        error: mlErrorMessage(
          data,
          "Não foi possível atualizar o preço."
        ),
        details: data
      });
    }

    res.json({
      ok: true,
      item: data
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

/* =========================================================
   ATUALIZAR VÁRIOS PREÇOS
========================================================= */

app.put(
  "/api/atualizar-precos",
  requireAuth,
  async (req, res) => {
    try {
      const items = Array.isArray(req.body?.items)
        ? req.body.items
        : [];

      if (!items.length) {
        return res.status(400).json({
          error: "Nenhum anúncio foi enviado."
        });
      }

      const resultados = [];

      for (const item of items) {
        const id = String(item.id || "").trim();
        const price = Number(item.price);

        if (
          !id ||
          !Number.isFinite(price) ||
          price <= 0
        ) {
          resultados.push({
            id,
            ok: false,
            error: "ID ou preço inválido."
          });

          continue;
        }

        try {
          const response = await mlFetch(
            `${ML_API}/items/${encodeURIComponent(id)}`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                price
              })
            }
          );

          const data = await readJson(response);

          resultados.push({
            id,
            ok: response.ok,
            price,
            error: response.ok
              ? null
              : mlErrorMessage(
                  data,
                  `Erro HTTP ${response.status}`
                )
          });
        } catch (error) {
          resultados.push({
            id,
            ok: false,
            price,
            error: error.message
          });
        }
      }

      res.json({
        ok: true,
        total: resultados.length,
        sucesso: resultados.filter((x) => x.ok).length,
        erros: resultados.filter((x) => !x.ok).length,
        resultados
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   SINCRONIZAR PREÇOS
========================================================= */

app.get(
  "/api/sincronizar-precos",
  requireAuth,
  async (req, res) => {
    try {
      /*
        O próprio endpoint /api/anuncios já busca
        os preços atuais no Mercado Livre.
      */

      const response = await fetch(
        `${APP_URL}/api/anuncios`,
        {
          headers: {
            Cookie:
              req.headers.cookie || ""
          }
        }
      );

      const data = await readJson(response);

      res.status(response.status).json(data);
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   SINCRONIZAR FRETES
========================================================= */

app.get(
  "/api/sincronizar-fretes",
  requireAuth,
  async (req, res) => {
    try {
      const store = loadStore();

      const userId = store.auth?.userId;

      if (!userId) {
        return res.status(400).json({
          error:
            "Não foi possível identificar o usuário."
        });
      }

      const itemIds = await getAllItemIds(userId);

      const resultados = [];

      for (let i = 0; i < itemIds.length; i += 5) {
        const batch = itemIds.slice(i, i + 5);

        const rows = await Promise.all(
          batch.map(async (id) => {
            try {
              const item = await getItemDetails(id);

              return {
                id: item.id,
                title: item.title,
                free_shipping:
                  item.shipping?.free_shipping === true,
                shipping_mode:
                  item.shipping?.mode || null,
                logistic_type:
                  item.shipping?.logistic_type || null
              };
            } catch (error) {
              return {
                id,
                error: error.message
              };
            }
          })
        );

        resultados.push(...rows);
      }

      res.json({
        ok: true,
        total: resultados.length,
        fretes: resultados
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   SIMULAÇÃO DE PREÇO
========================================================= */

app.post(
  "/api/simular",
  requireAuth,
  async (req, res) => {
    try {
      const {
        price,
        fee_percent,
        shipping,
        cost
      } = req.body || {};

      const venda = Number(price || 0);
      const percentual = Number(
        fee_percent || 0
      );
      const frete = Number(shipping || 0);
      const custo = Number(cost || 0);

      if (!Number.isFinite(venda) || venda < 0) {
        return res.status(400).json({
          error: "Preço inválido."
        });
      }

      const taxa = venda * (percentual / 100);
      const lucro = venda - taxa - frete - custo;

      const margem =
        venda > 0
          ? (lucro / venda) * 100
          : 0;

      res.json({
        ok: true,
        price: venda,
        fee: taxa,
        shipping: frete,
        cost: custo,
        profit: lucro,
        margin: margem
      });
    } catch (error) {
      res.status(500).json({
        error: error.message
      });
    }
  }
);

/* =========================================================
   ERROS API
========================================================= */

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "Endpoint não encontrado."
  });
});

/* =========================================================
   FRONTEND
========================================================= */

app.use(
  express.static(__dirname, {
    index: "index.html"
  })
);

app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "Endpoint não encontrado."
    });
  }

  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

/* =========================================================
   ERRO GLOBAL
========================================================= */

app.use((error, req, res, next) => {
  console.error("Erro global:", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    error:
      error.message ||
      "Erro interno do servidor."
  });
});

/* =========================================================
   START
========================================================= */

app.listen(PORT, () => {
  console.log("========================================");
  console.log("ML HUB PRO");
  console.log("========================================");
  console.log(`Porta: ${PORT}`);
  console.log(`APP_URL: ${APP_URL}`);
  console.log(`Callback: ${CALLBACK_URL}`);
  console.log("OAuth Mercado Livre: ATIVO");
  console.log("Renovação automática: ATIVA");
  console.log("========================================");
});
