const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   TOKEN
========================================================= */

let accessToken = process.env.ML_ACCESS_TOKEN || "";

function getTokenFromRequest(req) {
  return (
    req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
    accessToken
  );
}

/* =========================================================
   HEALTH
========================================================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "ML Hub Pro",
    connected: Boolean(accessToken),
    time: new Date().toISOString()
  });
});

/* =========================================================
   CONECTAR COM ACCESS TOKEN
========================================================= */

app.post("/api/connect", async (req, res) => {
  try {
    const token = String(
      req.body.access_token || ""
    ).trim();

    if (!token) {
      return res.status(400).json({
        ok: false,
        error: "Informe o Access Token."
      });
    }

    const response = await fetch(
      "https://api.mercadolibre.com/users/me",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error:
          data.message ||
          data.error ||
          "Access Token inválido.",
        details: data
      });
    }

    accessToken = token;

    res.json({
      ok: true,
      message: "Mercado Livre conectado com sucesso.",
      user: data
    });

  } catch (error) {
    console.error("Erro ao conectar:", error);

    res.status(500).json({
      ok: false,
      error: "Erro ao conectar ao Mercado Livre."
    });
  }
});

/* =========================================================
   STATUS
========================================================= */

app.get("/api/status", async (req, res) => {
  try {
    if (!accessToken) {
      return res.json({
        ok: true,
        connected: false
      });
    }

    const response = await fetch(
      "https://api.mercadolibre.com/users/me",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.json({
        ok: true,
        connected: false,
        error:
          data.message ||
          data.error ||
          "Token inválido ou expirado."
      });
    }

    res.json({
      ok: true,
      connected: true,
      user: data
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      connected: false,
      error: error.message
    });
  }
});

/* =========================================================
   DESCONECTAR
========================================================= */

app.post("/api/disconnect", (req, res) => {
  accessToken = "";

  res.json({
    ok: true,
    message: "Conta desconectada."
  });
});

/* =========================================================
   USUÁRIO
========================================================= */

app.get("/api/me", async (req, res) => {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Mercado Livre não conectado."
      });
    }

    const response = await fetch(
      "https://api.mercadolibre.com/users/me",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );

    const data = await response.json();

    res.status(response.ok ? 200 : response.status).json({
      ok: response.ok,
      user: data
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   ANÚNCIOS
========================================================= */

app.get("/api/anuncios", async (req, res) => {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Mercado Livre não conectado."
      });
    }

    /* Primeiro descobrimos o usuário */

    const userResponse = await fetch(
      "https://api.mercadolibre.com/users/me",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );

    const user = await userResponse.json();

    if (!userResponse.ok || !user.id) {
      return res.status(401).json({
        ok: false,
        error: "Não foi possível identificar a conta."
      });
    }

    /* Buscamos os IDs dos anúncios */

    const searchResponse = await fetch(
      `https://api.mercadolibre.com/users/${user.id}/items/search?limit=50`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );

    const searchData = await searchResponse.json();

    if (!searchResponse.ok) {
      return res.status(searchResponse.status).json({
        ok: false,
        error:
          searchData.message ||
          searchData.error ||
          "Erro ao buscar anúncios.",
        details: searchData
      });
    }

    const ids = searchData.results || [];

    if (!ids.length) {
      return res.json({
        ok: true,
        total: 0,
        anuncios: []
      });
    }

    /* Buscamos os detalhes */

    const details = [];

    for (let i = 0; i < ids.length; i += 20) {
      const batch = ids.slice(i, i + 20);

      const response = await fetch(
        `https://api.mercadolibre.com/items?ids=${batch.join(",")}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json"
          }
        }
      );

      const data = await response.json();

      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && item.body) {
            details.push(item.body);
          }
        }
      }
    }

    res.json({
      ok: true,
      total: details.length,
      anuncios: details
    });

  } catch (error) {
    console.error("Erro anúncios:", error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   CONSULTAR UM ANÚNCIO
========================================================= */

app.get("/api/anuncio/:id", async (req, res) => {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Mercado Livre não conectado."
      });
    }

    const response = await fetch(
      `https://api.mercadolibre.com/items/${encodeURIComponent(req.params.id)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );

    const data = await response.json();

    res.status(response.ok ? 200 : response.status).json({
      ok: response.ok,
      anuncio: data
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   ATUALIZAR PREÇO
========================================================= */

app.post("/api/atualizar-preco", async (req, res) => {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Mercado Livre não conectado."
      });
    }

    const itemId = String(
      req.body.item_id || ""
    ).trim();

    const price = Number(req.body.price);

    if (!itemId) {
      return res.status(400).json({
        ok: false,
        error: "Informe o ID do anúncio."
      });
    }

    if (!Number.isFinite(price) || price <= 0) {
      return res.status(400).json({
        ok: false,
        error: "Informe um preço válido."
      });
    }

    const response = await fetch(
      `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          price
        })
      }
    );

    const data = await response.json();

    res.status(response.ok ? 200 : response.status).json({
      ok: response.ok,
      data
    });

  } catch (error) {
    console.error("Erro preço:", error);

    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   ATUALIZAR VÁRIOS PREÇOS
========================================================= */

app.post("/api/atualizar-precos", async (req, res) => {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Mercado Livre não conectado."
      });
    }

    const anuncios = Array.isArray(req.body.anuncios)
      ? req.body.anuncios
      : [];

    if (!anuncios.length) {
      return res.status(400).json({
        ok: false,
        error: "Nenhum anúncio informado."
      });
    }

    const resultados = [];

    for (const anuncio of anuncios) {
      const itemId = String(
        anuncio.item_id || anuncio.id || ""
      ).trim();

      const price = Number(anuncio.price);

      if (!itemId || !Number.isFinite(price) || price <= 0) {
        resultados.push({
          item_id: itemId,
          ok: false,
          error: "ID ou preço inválido."
        });

        continue;
      }

      try {
        const response = await fetch(
          `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({
              price
            })
          }
        );

        const data = await response.json();

        resultados.push({
          item_id: itemId,
          ok: response.ok,
          data
        });

      } catch (error) {
        resultados.push({
          item_id: itemId,
          ok: false,
          error: error.message
        });
      }
    }

    res.json({
      ok: true,
      resultados
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   SINCRONIZAR PREÇOS
========================================================= */

app.post("/api/sincronizar-precos", async (req, res) => {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        ok: false,
        error: "Mercado Livre não conectado."
      });
    }

    const response = await fetch(
      "https://api.mercadolibre.com/users/me",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );

    const user = await response.json();

    if (!response.ok || !user.id) {
      return res.status(401).json({
        ok: false,
        error: "Token inválido."
      });
    }

    const searchResponse = await fetch(
      `https://api.mercadolibre.com/users/${user.id}/items/search?limit=50`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json"
        }
      }
    );

    const searchData = await searchResponse.json();

    res.status(
      searchResponse.ok ? 200 : searchResponse.status
    ).json({
      ok: searchResponse.ok,
      total: (searchData.results || []).length,
      ids: searchData.results || []
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

/* =========================================================
   SIMULAR
========================================================= */

app.post("/api/simular", (req, res) => {
  const {
    preco,
    custo,
    frete
  } = req.body;

  const precoNum = Number(preco) || 0;
  const custoNum = Number(custo) || 0;
  const freteNum = Number(frete) || 0;

  const lucro =
    precoNum -
    custoNum -
    freteNum;

  const margem =
    precoNum > 0
      ? (lucro / precoNum) * 100
      : 0;

  res.json({
    ok: true,
    preco: precoNum,
    custo: custoNum,
    frete: freteNum,
    lucro,
    margem
  });
});

/* =========================================================
   FRONTEND
========================================================= */

app.use(express.static(__dirname));

app.get("*", (req, res) => {
  res.sendFile(
    path.join(__dirname, "index.html")
  );
});

/* =========================================================
   SERVIDOR
========================================================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `ML Hub Pro iniciado na porta ${PORT}`
    );
  }
);
