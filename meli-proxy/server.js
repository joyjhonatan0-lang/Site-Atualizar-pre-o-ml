// ============================================================
// ML HUB PRO - BACKEND
// Mercado Livre + Access Token manual + OAuth opcional
// ============================================================

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 10000;

const ML_API =
  "https://api.mercadolibre.com";

const ML_AUTH =
  "https://auth.mercadolivre.com.br";

const ML_SITE =
  "MLB";

const FRONTEND_URL =
  "https://joyjhonatan0-lang.github.io/Site-Atualizar-preco-ml/";


// ============================================================
// VARIÁVEIS DE AMBIENTE
// ============================================================

const ML_CLIENT_ID =
  process.env.ML_CLIENT_ID || "";

const ML_CLIENT_SECRET =
  process.env.ML_CLIENT_SECRET || "";

const ML_REDIRECT_URI =
  process.env.ML_REDIRECT_URI || "";


// ============================================================
// CORS
// ============================================================

const allowedOrigins = [

  FRONTEND_URL.replace(/\/$/, ""),

  "https://joyjhonatan0-lang.github.io",

  "http://localhost:3000",

  "http://localhost:5173",

  "http://127.0.0.1:5500",

  "http://localhost:5500"

];


app.use(
  cors({

    origin: function (origin, callback) {

      // Permite chamadas sem Origin
      // como curl/Postman/server-to-server
      if (!origin) {
        return callback(null, true);
      }

      const normalized =
        origin.replace(/\/$/, "");

      if (
        allowedOrigins.includes(
          normalized
        )
      ) {

        return callback(
          null,
          true
        );

      }

      console.warn(
        "Origin bloqueada pelo CORS:",
        origin
      );

      return callback(
        new Error(
          "Origin não autorizada pelo CORS."
        )
      );

    },

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS"
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept"
    ],

    credentials: true

  })
);


// ============================================================
// BODY
// ============================================================

app.use(
  express.json({
    limit: "2mb"
  })
);


// ============================================================
// LOG BÁSICO
// ============================================================

app.use(
  (req, res, next) => {

    console.log(
      `[${new Date().toISOString()}]`,
      req.method,
      req.path
    );

    next();

  }
);


// ============================================================
// SESSÕES OAUTH
// ============================================================

// OAuth é opcional.
// Para o seu caso principal, o site usará Access Token manual.

const sessions =
  new Map();

const oauthStates =
  new Map();


// ============================================================
// UTILITÁRIOS
// ============================================================

function jsonError(
  res,
  status,
  message,
  extra = {}
) {

  return res
    .status(status)
    .json({

      erro: message,

      ...extra

    });

}


function normalizeToken(
  token
) {

  let value =
    String(token || "")
      .trim();

  if (
    value
      .toLowerCase()
      .startsWith("bearer ")
  ) {

    value =
      value
        .slice(7)
        .trim();

  }

  return value;

}


function getBearerToken(
  req
) {

  const header =
    req.headers.authorization;

  if (!header) {
    return null;
  }

  if (
    !header
      .toLowerCase()
      .startsWith("bearer ")
  ) {

    return null;

  }

  return normalizeToken(
    header
      .slice(7)
  );

}


// ============================================================
// CHAMADA AO MERCADO LIVRE
// ============================================================

async function mlFetch(
  path,
  token,
  options = {}
) {

  const cleanToken =
    normalizeToken(token);


  if (!cleanToken) {

    throw new Error(
      "Access Token não informado."
    );

  }


  const headers = {

    "Accept":
      "application/json",

    "Authorization":
      `Bearer ${cleanToken}`,

    ...(options.headers || {})

  };


  const response =
    await fetch(
      ML_API + path,
      {
        ...options,
        headers
      }
    );


  let data = null;

  const contentType =
    response.headers.get(
      "content-type"
    ) || "";


  if (
    contentType.includes(
      "application/json"
    )
  ) {

    try {

      data =
        await response.json();

    } catch (error) {

      data = null;

    }

  } else {

    try {

      const text =
        await response.text();

      data =
        text
          ? {
              message: text
            }
          : null;

    } catch (error) {

      data = null;

    }

  }


  if (!response.ok) {

    const error =
      new Error(
        data?.message ||
        data?.error ||
        data?.cause?.[0]?.message ||
        `Mercado Livre HTTP ${response.status}`
      );

    error.status =
      response.status;

    error.data =
      data;

    throw error;

  }


  return data;

}


// ============================================================
// PEGAR TOKEN DA REQUISIÇÃO
// ============================================================
//
// PRIORIDADE:
//
// 1. Authorization: Bearer TOKEN
//
// 2. Sessão OAuth por cookie
//
// Isso permite que cada conta do frontend
// envie seu próprio Access Token.
//
// ============================================================

function getSessionToken(
  req
) {

  // ----------------------------------------------------------
  // TOKEN MANUAL
  // ----------------------------------------------------------

  const bearer =
    getBearerToken(req);

  if (bearer) {

    return {
      token: bearer,
      source: "manual"
    };

  }


  // ----------------------------------------------------------
  // TOKEN DA SESSÃO OAUTH
  // ----------------------------------------------------------

  const sessionId =
    req.headers["x-session-id"] ||
    null;


  if (
    sessionId &&
    sessions.has(sessionId)
  ) {

    const session =
      sessions.get(sessionId);

    if (
      session &&
      session.access_token
    ) {

      return {
        token:
          session.access_token,

        source:
          "oauth",

        sessionId

      };

    }

  }


  // ----------------------------------------------------------
  // COOKIE DE SESSÃO
  // ----------------------------------------------------------

  const cookieHeader =
    req.headers.cookie || "";

  const cookies =
    parseCookies(
      cookieHeader
    );

  const cookieSessionId =
    cookies.ml_session;


  if (
    cookieSessionId &&
    sessions.has(
      cookieSessionId
    )
  ) {

    const session =
      sessions.get(
        cookieSessionId
      );

    if (
      session &&
      session.access_token
    ) {

      return {
        token:
          session.access_token,

        source:
          "oauth",

        sessionId:
          cookieSessionId

      };

    }

  }


  return null;

}


function requireToken(
  req,
  res,
  next
) {

  const auth =
    getSessionToken(req);


  if (!auth?.token) {

    return jsonError(
      res,
      401,
      "Access Token não informado. Envie Authorization: Bearer SEU_ACCESS_TOKEN."
    );

  }


  req.mlToken =
    auth.token;

  req.authSource =
    auth.source;

  req.mlSessionId =
    auth.sessionId || null;


  next();

}


// ============================================================
// COOKIES
// ============================================================

function parseCookies(
  header
) {

  const result = {};

  if (!header) {
    return result;
  }

  header
    .split(";")
    .forEach(
      part => {

        const index =
          part.indexOf("=");

        if (index === -1) {
          return;
        }

        const key =
          part
            .slice(0, index)
            .trim();

        const value =
          part
            .slice(index + 1)
            .trim();

        result[key] =
          decodeURIComponent(value);

      }
    );

  return result;

}


// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  "/",
  (req, res) => {

    res.json({

      ok: true,

      nome:
        "ML Hub Pro API",

      status:
        "online",

      timestamp:
        new Date().toISOString()

    });

  }
);


app.get(
  "/health",
  (req, res) => {

    res.json({

      ok: true,

      status:
        "online"

    });

  }
);


// ============================================================
// API /ME
// ============================================================

app.get(
  "/api/me",
  requireToken,
  async (req, res) => {

    try {

      const data =
        await mlFetch(
          "/users/me",
          req.mlToken
        );


      return res.json({

        id:
          data?.id || null,

        user_id:
          data?.id || null,

        nickname:
          data?.nickname || "",

        first_name:
          data?.first_name || "",

        last_name:
          data?.last_name || "",

        country_id:
          data?.country_id || "",

        site_id:
          data?.site_id || "",

        seller_reputation:
          data?.seller_reputation || null,

        source:
          req.authSource

      });


    } catch (error) {

      console.error(
        "Erro /api/me:",
        error
      );


      return jsonError(
        res,
        error.status === 401
          ? 401
          : 502,
        error.message ||
          "Não foi possível validar o Access Token.",
        {
          mercado_livre:
            error.data || null
        }
      );

    }

  }
);


// ============================================================
// OAUTH - AUTORIZAR
// ============================================================

app.get(
  "/oauth/authorize",
  (req, res) => {

    if (
      !ML_CLIENT_ID ||
      !ML_REDIRECT_URI
    ) {

      return jsonError(
        res,
        500,
        "OAuth não configurado no servidor. Configure ML_CLIENT_ID e ML_REDIRECT_URI no Render."
      );

    }


    const state =
      crypto
        .randomBytes(24)
        .toString("hex");


    oauthStates.set(
      state,
      {
        createdAt:
          Date.now()
      }
    );


    // Limpa states antigos
    limparOAuthStates();


    const params =
      new URLSearchParams({

        response_type:
          "code",

        client_id:
          ML_CLIENT_ID,

        redirect_uri:
          ML_REDIRECT_URI,

        state

      });


    const url =
      `${ML_AUTH}/authorization?${params.toString()}`;


    return res.redirect(
      url
    );

  }
);


// ============================================================
// OAUTH - CALLBACK
// ============================================================

app.get(
  "/oauth/callback",
  async (req, res) => {

    const {
      code,
      state,
      error,
      error_description
    } = req.query;


    if (error) {

      return res.status(400).send(
        `
          <html>
            <body style="font-family:Arial;padding:40px;">
              <h2>Erro na autorização</h2>
              <p>${escapeHtmlServer(
                error_description ||
                error
              )}</p>
              <a href="${FRONTEND_URL}">
                Voltar para o site
              </a>
            </body>
          </html>
        `
      );

    }


    if (
      !code ||
      !state
    ) {

      return res.status(400).send(
        `
          <html>
            <body style="font-family:Arial;padding:40px;">
              <h2>Callback OAuth inválido</h2>
              <a href="${FRONTEND_URL}">
                Voltar para o site
              </a>
            </body>
          </html>
        `
      );

    }


    const stateData =
      oauthStates.get(
        state
      );


    if (!stateData) {

      return res.status(400).send(
        `
          <html>
            <body style="font-family:Arial;padding:40px;">
              <h2>Estado OAuth inválido ou expirado.</h2>
              <a href="${FRONTEND_URL}">
                Voltar para o site
              </a>
            </body>
          </html>
        `
      );

    }


    oauthStates.delete(
      state
    );


    try {

      const body =
        new URLSearchParams({

          grant_type:
            "authorization_code",

          client_id:
            ML_CLIENT_ID,

          client_secret:
            ML_CLIENT_SECRET,

          code:
            code,

          redirect_uri:
            ML_REDIRECT_URI

        });


      const response =
        await fetch(
          `${ML_API}/oauth/token`,
          {

            method:
              "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded",

              "Accept":
                "application/json"
            },

            body:
              body.toString()

          }
        );


      const data =
        await response.json();


      if (!response.ok) {

        console.error(
          "Erro ao trocar code por token:",
          data
        );

        return res.status(502).send(
          `
            <html>
              <body style="font-family:Arial;padding:40px;">
                <h2>Mercado Livre recusou a autorização.</h2>
                <p>${escapeHtmlServer(
                  data?.message ||
                  data?.error ||
                  "Erro desconhecido"
                )}</p>
                <a href="${FRONTEND_URL}">
                  Voltar para o site
                </a>
              </body>
            </html>
          `
        );

      }


      const sessionId =
        crypto
          .randomBytes(32)
          .toString("hex");


      sessions.set(
        sessionId,
        {

          access_token:
            data.access_token,

          refresh_token:
            data.refresh_token || null,

          expires_in:
            data.expires_in || null,

          createdAt:
            Date.now()

        }
      );


      return res
        .status(302)
        .setHeader(
          "Set-Cookie",
          `ml_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=86400`
        )
        .setHeader(
          "Location",
          FRONTEND_URL
        )
        .end();


    } catch (error) {

      console.error(
        "Erro no OAuth callback:",
        error
      );

      return res.status(500).send(
        `
          <html>
            <body style="font-family:Arial;padding:40px;">
              <h2>Erro interno no OAuth.</h2>
              <a href="${FRONTEND_URL}">
                Voltar para o site
              </a>
            </body>
          </html>
        `
      );

    }

  }
);


// ============================================================
// OAUTH STATUS
// ============================================================

app.get(
  "/api/auth/status",
  (req, res) => {

    const auth =
      getSessionToken(req);


    return res.json({

      conectado:
        Boolean(auth?.token),

      origem:
        auth?.source || null

    });

  }
);


// ============================================================
// OAUTH LOGOUT
// ============================================================

app.post(
  "/oauth/logout",
  (req, res) => {

    const cookies =
      parseCookies(
        req.headers.cookie || ""
      );

    const sessionId =
      cookies.ml_session;


    if (sessionId) {

      sessions.delete(
        sessionId
      );

    }


    res.setHeader(
      "Set-Cookie",
      "ml_session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0"
    );


    return res.json({
      ok: true
    });

  }
);


// ============================================================
// LISTAR IDs DOS ANÚNCIOS
// ============================================================

async function buscarTodosIds(
  token
) {

  const ids = [];

  let offset =
    0;

  const limit =
    50;


  while (true) {

    const data =
      await mlFetch(
        `/users/me/items/search?status=active&offset=${offset}&limit=${limit}`,
        token
      );


    const results =
      Array.isArray(
        data?.results
      )
        ? data.results
        : [];


    ids.push(
      ...results
    );


    const total =
      Number(
        data?.paging?.total || 0
      );


    offset +=
      results.length;


    if (
      results.length === 0 ||
      offset >= total
    ) {

      break;

    }


    // segurança contra loop
    if (
      results.length <
      limit
    ) {

      break;

    }

  }


  return ids;

}


// ============================================================
// BUSCAR DETALHES DOS ANÚNCIOS
// ============================================================

async function buscarDetalhesAnuncios(
  ids,
  token
) {

  if (!ids.length) {
    return [];
  }


  const resultado = [];


  // Mercado Livre permite buscar vários IDs
  // em uma única consulta.
  // Limitamos o tamanho do lote.

  const tamanhoLote =
    20;


  for (
    let i = 0;
    i < ids.length;
    i += tamanhoLote
  ) {

    const lote =
      ids.slice(
        i,
        i + tamanhoLote
      );


    const endpoint =
      `/items?ids=${encodeURIComponent(
        lote.join(",")
      )}`;


    const data =
      await mlFetch(
        endpoint,
        token
      );


    if (
      Array.isArray(data)
    ) {

      for (
        const entry of data
      ) {

        if (
          entry?.code >= 200 &&
          entry?.code < 300 &&
          entry?.body
        ) {

          resultado.push(
            entry.body
          );

        }

      }

    }


  }


  return resultado;

}


// ============================================================
// CALCULAR TAXA / FRETE / RECEBIMENTO
// ============================================================

function calcularDadosFinanceiros(
  item
) {

  const price =
    Number(
      item?.price || 0
    );


  const saleFee =
    Number(
      item?.sale_fee_amount ||
      item?.sale_fee ||
      0
    );


  const shippingCost =
    Number(
      item?.shipping_cost ||
      0
    );


  const netReceived =
    price -
    saleFee -
    shippingCost;


  return {

    price,

    sale_fee:
      saleFee,

    shipping_cost:
      shippingCost,

    net_received:
      netReceived

  };

}


// ============================================================
// TRANSFORMAR ITEM
// ============================================================

function transformarAnuncio(
  item
) {

  const financeiro =
    calcularDadosFinanceiros(
      item
    );


  const shipping =
    item?.shipping || {};


  const freeShipping =
    Boolean(
      shipping?.free_shipping ||
      shipping?.free_shipping_mode === "mandatory"
    );


  return {

    id:
      item?.id || "",

    title:
      item?.title || "",

    sku:
      obterSKU(item),

    price:
      financeiro.price,

    sale_fee:
      financeiro.sale_fee,

    shipping_cost:
      financeiro.shipping_cost,

    net_received:
      financeiro.net_received,

    available_quantity:
      Number(
        item?.available_quantity || 0
      ),

    status:
      item?.status || "",

    listing_type_id:
      item?.listing_type_id || "",

    thumbnail:
      item?.thumbnail || "",

    permalink:
      item?.permalink || "",

    free_shipping:
      freeShipping

  };

}


function obterSKU(
  item
) {

  if (
    item?.seller_custom_field
  ) {

    return String(
      item.seller_custom_field
    );

  }


  if (
    Array.isArray(
      item?.attributes
    )
  ) {

    const skuAttribute =
      item.attributes.find(
        attr =>
          String(
            attr?.id || ""
          ).toUpperCase() ===
          "SELLER_SKU"
      );


    if (
      skuAttribute?.value_name
    ) {

      return String(
        skuAttribute.value_name
      );

    }

  }


  return "";

}


// ============================================================
// /API/ANUNCIOS
// ============================================================

app.get(
  "/api/anuncios",
  requireToken,
  async (req, res) => {

    try {

      const ids =
        await buscarTodosIds(
          req.mlToken
        );


      const detalhes =
        await buscarDetalhesAnuncios(
          ids,
          req.mlToken
        );


      const itens =
        detalhes.map(
          transformarAnuncio
        );


      return res.json({

        itens,

        total:
          itens.length

      });


    } catch (error) {

      console.error(
        "Erro /api/anuncios:",
        error
      );


      const status =
        error.status === 401
          ? 401
          : 502;


      return jsonError(
        res,
        status,
        error.message ||
          "Erro ao buscar anúncios no Mercado Livre.",
        {
          mercado_livre:
            error.data || null
        }
      );

    }

  }
);


// ============================================================
// ATUALIZAR PREÇOS
// ============================================================

app.post(
  "/api/atualizar-precos",
  requireToken,
  async (req, res) => {

    try {

      const itens =
        Array.isArray(
          req.body?.itens
        )
          ? req.body.itens
          : [];


      if (!itens.length) {

        return jsonError(
          res,
          400,
          "Nenhum item recebido."
        );

      }


      const resultados = [];


      for (
        const item of itens
      ) {

        const id =
          String(
            item?.id || ""
          ).trim();


        const price =
          Number(
            item?.price
          );


        if (!id) {

          resultados.push({

            id: null,

            ok: false,

            erro:
              "ID do anúncio não informado."

          });

          continue;

        }


        if (
          !Number.isFinite(price) ||
          price <= 0
        ) {

          resultados.push({

            id,

            ok: false,

            erro:
              "Preço inválido."

          });

          continue;

        }


        try {

          const updated =
            await mlFetch(
              `/items/${encodeURIComponent(id)}`,
              req.mlToken,
              {

                method:
                  "PUT",

                headers: {
                  "Content-Type":
                    "application/json"
                },

                body:
                  JSON.stringify({
                    price
                  })

              }
            );


          resultados.push({

            id,

            ok: true,

            price:
              updated?.price ??
              price

          });


        } catch (error) {

          console.error(
            `Erro atualizando ${id}:`,
            error
          );


          resultados.push({

            id,

            ok: false,

            erro:
              error.message ||
              "Erro ao atualizar anúncio.",

            mercado_livre:
              error.data || null

          });

        }

      }


      const erros =
        resultados.filter(
          item =>
            !item.ok
        );


      if (erros.length) {

        return res.status(207).json({

          ok:
            false,

          total:
            resultados.length,

          atualizados:
            resultados.length -
            erros.length,

          erros:

            erros,

          resultados

        });

      }


      return res.json({

        ok:
          true,

        total:
          resultados.length,

        atualizados:
          resultados.length,

        resultados

      });


    } catch (error) {

      console.error(
        "Erro /api/atualizar-precos:",
        error
      );


      return jsonError(
        res,
        500,
        error.message ||
          "Erro ao atualizar preços."
      );

    }

  }
);


// ============================================================
// SINCRONIZAR PREÇOS
// ============================================================

app.post(
  "/api/sincronizar-precos",
  requireToken,
  async (req, res) => {

    try {

      const precos =
        req.body?.precos || {};


      const ids =
        Object.keys(
          precos
        );


      if (!ids.length) {

        return jsonError(
          res,
          400,
          "Nenhum preço recebido."
        );

      }


      const resultados = [];


      for (
        const id of ids
      ) {

        const price =
          Number(
            precos[id]
          );


        if (
          !Number.isFinite(price) ||
          price <= 0
        ) {

          resultados.push({

            id,

            ok: false,

            erro:
              "Preço inválido."

          });

          continue;

        }


        try {

          const updated =
            await mlFetch(
              `/items/${encodeURIComponent(id)}`,
              req.mlToken,
              {

                method:
                  "PUT",

                headers: {
                  "Content-Type":
                    "application/json"
                },

                body:
                  JSON.stringify({
                    price
                  })

              }
            );


          resultados.push({

            id,

            ok: true,

            price:
              updated?.price ??
              price

          });


        } catch (error) {

          resultados.push({

            id,

            ok: false,

            erro:
              error.message

          });

        }

      }


      const erros =
        resultados.filter(
          item =>
            !item.ok
        );


      return res.json({

        ok:
          erros.length === 0,

        total:
          resultados.length,

        atualizados:
          resultados.length -
          erros.length,

        erros,

        resultados

      });


    } catch (error) {

      console.error(
        "Erro /api/sincronizar-precos:",
        error
      );


      return jsonError(
        res,
        500,
        error.message ||
          "Erro ao sincronizar preços."
      );

    }

  }
);


// ============================================================
// SINCRONIZAR FRETES
// ============================================================
//
// Importante:
// O endpoint mantém o formato esperado pelo frontend.
// O Mercado Livre controla regras de frete de acordo com
// anúncio, logística e configurações da conta.
//
// Aqui buscamos os anúncios e retornamos os dados atuais.
// ============================================================

app.post(
  "/api/sincronizar-fretes",
  requireToken,
  async (req, res) => {

    try {

      const fretes =
        req.body?.fretes || {};


      const ids =
        Object.keys(
          fretes
        );


      if (!ids.length) {

        return jsonError(
          res,
          400,
          "Nenhum frete recebido."
        );

      }


      const detalhes =
        await buscarDetalhesAnuncios(
          ids,
          req.mlToken
        );


      const itens =
        detalhes.map(
          transformarAnuncio
        );


      return res.json({

        ok:
          true,

        total:
          itens.length,

        itens

      });


    } catch (error) {

      console.error(
        "Erro /api/sincronizar-fretes:",
        error
      );


      return jsonError(
        res,
        error.status === 401
          ? 401
          : 502,
        error.message ||
          "Erro ao sincronizar fretes.",
        {
          mercado_livre:
            error.data || null
        }
      );

    }

  }
);


// ============================================================
// DASHBOARD
// ============================================================

app.get(
  "/api/dashboard",
  requireToken,
  async (req, res) => {

    try {

      // ------------------------------------------------------
      // Período de 60 dias
      // ------------------------------------------------------

      const now =
        new Date();

      const from =
        new Date(
          now.getTime() -
          60 *
          24 *
          60 *
          60 *
          1000
        );


      const fromDate =
        formatDateML(
          from
        );


      const toDate =
        formatDateML(
          now
        );


      // ------------------------------------------------------
      // Buscar anúncios para montar informações auxiliares
      // ------------------------------------------------------

      let anuncios = [];


      try {

        const ids =
          await buscarTodosIds(
            req.mlToken
          );


        const detalhes =
          await buscarDetalhesAnuncios(
            ids,
            req.mlToken
          );


        anuncios =
          detalhes.map(
            transformarAnuncio
          );

      } catch (error) {

        console.warn(
          "Não foi possível carregar anúncios para dashboard:",
          error.message
        );

      }


      // ------------------------------------------------------
      // Buscar pedidos/vendas
      // ------------------------------------------------------

      let orders = [];


      try {

        const ordersData =
          await buscarOrders(
            req.mlToken,
            fromDate,
            toDate
          );


        orders =
          ordersData.orders || [];

      } catch (error) {

        console.warn(
          "Não foi possível carregar orders:",
          error.message
        );

      }


      // ------------------------------------------------------
      // Processar vendas
      // ------------------------------------------------------

      let totalVendas =
        0;

      let faturamento =
        0;

      const vendasPorDia =
        new Map();

      const produtos =
        new Map();


      // Inicializa 60 dias
      for (
        let i = 59;
        i >= 0;
        i--
      ) {

        const date =
          new Date(
            now.getTime() -
            i *
            24 *
            60 *
            60 *
            1000
          );


        const key =
          formatDateML(
            date
          );


        vendasPorDia.set(
          key,
          0
        );

      }


      for (
        const order of orders
      ) {

        const status =
          String(
            order?.status || ""
          );


        if (
          status !==
          "paid"
        ) {

          continue;

        }


        const orderTotal =
          Number(
            order?.total_amount || 0
          );


        const quantity =
          Array.isArray(
            order?.order_items
          )
            ? order.order_items.reduce(
                (
                  sum,
                  item
                ) =>
                  sum +
                  Number(
                    item?.quantity || 0
                  ),
                0
              )
            : 0;


        totalVendas +=
          quantity;


        faturamento +=
          orderTotal;


        const date =
          getOrderDate(
            order
          );


        if (
          date &&
          vendasPorDia.has(
            date
          )
        ) {

          vendasPorDia.set(
            date,
            vendasPorDia.get(
              date
            ) +
            quantity
          );

        }


        if (
          Array.isArray(
            order?.order_items
          )
        ) {

          for (
            const orderItem
            of order.order_items
          ) {

            const item =
              orderItem?.item ||
              {};


            const itemId =
              String(
                item?.id || ""
              );


            const title =
              item?.title ||
              itemId ||
              "Produto";


            const itemQuantity =
              Number(
                orderItem?.quantity || 0
              );


            const unitPrice =
              Number(
                orderItem?.unit_price || 0
              );


            const itemRevenue =
              itemQuantity *
              unitPrice;


            const key =
              itemId ||
              title;


            if (
              !produtos.has(
                key
              )
            ) {

              produtos.set(
                key,
                {
                  id:
                    itemId,

                  title:
                    title,

                  quantity:
                    0,

                  revenue:
                    0
                }
              );

            }


            const product =
              produtos.get(
                key
              );


            product.quantity +=
              itemQuantity;

            product.revenue +=
              itemRevenue;

          }

        }

      }


      const ticketMedio =
        totalVendas > 0
          ? faturamento /
            totalVendas
          : 0;


      const top10 =
        Array.from(
          produtos.values()
        )
        .sort(
          (a, b) =>
            b.quantity -
            a.quantity
        )
        .slice(
          0,
          10
        );


      const series60Dias =
        Array.from(
          vendasPorDia.entries()
        )
        .map(
          ([date, value]) => ({

            date,

            vendas:
              value,

            value

          })
        );


      return res.json({

        vendas_60_dias:
          totalVendas,

        total_vendas_60_dias:
          totalVendas,

        faturamento_60_dias:
          faturamento,

        ticket_medio:
          ticketMedio,

        top_10:
          top10,

        series_60_dias:
          series60Dias,

        anuncios:
          anuncios.length

      });


    } catch (error) {

      console.error(
        "Erro /api/dashboard:",
        error
      );


      return jsonError(
        res,
        error.status === 401
          ? 401
          : 502,
        error.message ||
          "Erro ao carregar dashboard.",
        {
          mercado_livre:
            error.data || null
        }
      );

    }

  }
);


// ============================================================
// BUSCAR ORDERS
// ============================================================

async function buscarOrders(
  token,
  fromDate,
  toDate
) {

  const orders = [];

  let offset =
    0;

  const limit =
    50;


  while (true) {

    const endpoint =
      `/orders/search?seller=${encodeURIComponent(
        "me"
      )}` +
      `&order.date_created.from=${encodeURIComponent(
        fromDate + "T00:00:00.000-03:00"
      )}` +
      `&order.date_created.to=${encodeURIComponent(
        toDate + "T23:59:59.999-03:00"
      )}` +
      `&offset=${offset}` +
      `&limit=${limit}`;


    const data =
      await mlFetch(
        endpoint,
        token
      );


    const results =
      Array.isArray(
        data?.results
      )
        ? data.results
        : [];


    orders.push(
      ...results
    );


    const total =
      Number(
        data?.paging?.total || 0
      );


    offset +=
      results.length;


    if (
      results.length === 0 ||
      offset >= total
    ) {

      break;

    }


    if (
      results.length <
      limit
    ) {

      break;

    }

  }


  return {
    orders
  };

}


// ============================================================
// DATA HELPERS
// ============================================================

function formatDateML(
  date
) {

  const year =
    date.getFullYear();


  const month =
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    );


  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    );


  return `${year}-${month}-${day}`;

}


function getOrderDate(
  order
) {

  const value =
    order?.date_closed ||
    order?.date_created ||
    null;


  if (!value) {
    return null;
  }


  const date =
    new Date(value);


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return null;

  }


  return formatDateML(
    date
  );

}


// ============================================================
// LIMPEZA OAUTH
// ============================================================

function limparOAuthStates() {

  const now =
    Date.now();

  const maxAge =
    10 *
    60 *
    1000;


  for (
    const [
      key,
      value
    ]
    of oauthStates.entries()
  ) {

    if (
      !value ||
      now -
      value.createdAt >
      maxAge
    ) {

      oauthStates.delete(
        key
      );

    }

  }

}


// ============================================================
// ESCAPE SERVER
// ============================================================

function escapeHtmlServer(
  value
) {

  return String(
    value || ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );

}


// ============================================================
// TRATAMENTO GLOBAL DE ERROS
// ============================================================

app.use(
  (
    err,
    req,
    res,
    next
  ) => {

    console.error(
      "Erro global:",
      err
    );


    if (
      res.headersSent
    ) {

      return next(err);

    }


    return res
      .status(500)
      .json({

        erro:
          err.message ||
          "Erro interno do servidor."

      });

  }
);


// ============================================================
// START
// ============================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "======================================"
    );

    console.log(
      "ML Hub Pro API iniciada"
    );

    console.log(
      `Porta: ${PORT}`
    );

    console.log(
      `Frontend: ${FRONTEND_URL}`
    );

    console.log(
      "Access Token manual: ATIVO"
    );

    console.log(
      `OAuth configurado: ${
        ML_CLIENT_ID &&
        ML_CLIENT_SECRET &&
        ML_REDIRECT_URI
          ? "SIM"
          : "NÃO"
      }`
    );

    console.log(
      "======================================"
    );

  }
);
