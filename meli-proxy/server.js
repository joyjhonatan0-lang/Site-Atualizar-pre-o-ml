'use strict';

const express = require('express');
const cors = require('cors');

const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();

const PORT = process.env.PORT || 3000;
const ML_API = 'https://api.mercadolibre.com';

app.use(
  cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   UTILITÁRIOS
========================================================= */

function obterToken(req) {
  let token = req.headers.authorization || '';

  if (token.toLowerCase().startsWith('bearer ')) {
    token = token.slice(7);
  }

  token = token.trim();

  if (!token) {
    token = String(process.env.ML_ACCESS_TOKEN || '').trim();
  }

  return token;
}

function erroMensagem(error) {
  if (!error) return 'Erro desconhecido.';
  if (typeof error === 'string') return error;
  return error.message || 'Erro desconhecido.';
}

async function lerRespostaJson(response) {
  const texto = await response.text();

  if (!texto) {
    return {};
  }

  try {
    return JSON.parse(texto);
  } catch {
    return {
      _respostaNaoJson: true,
      _texto: texto,
    };
  }
}

async function mlFetch(url, token, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await lerRespostaJson(response);

  return {
    response,
    data,
  };
}

function respostaErroMercadoLivre(data, status) {
  return (
    data?.message ||
    data?.error ||
    data?.cause?.[0]?.message ||
    `Mercado Livre retornou HTTP ${status}.`
  );
}

/* =========================================================
   VALIDAÇÃO DE TOKEN
========================================================= */

async function validarTokenML(token) {
  if (!token) {
    return null;
  }

  try {
    const { response, data } = await mlFetch(
      `${ML_API}/users/me`,
      token
    );

    if (!response.ok || !data?.id) {
      return null;
    }

    return data;
  } catch (error) {
    console.error('Erro validando Access Token:', erroMensagem(error));
    return null;
  }
}

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get('/', (req, res) => {
  res.json({
    online: true,
    sistema: 'Painel Mercado Livre',
    status: 'operacional',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health', async (req, res) => {
  const token = obterToken(req);

  let mercadoLivre = false;
  let usuario = null;

  if (token) {
    usuario = await validarTokenML(token);
    mercadoLivre = Boolean(usuario);
  }

  res.json({
    online: true,
    mercado_livre: mercadoLivre,
    usuario: usuario
      ? {
          id: usuario.id,
          nickname: usuario.nickname || '',
          permalink: usuario.permalink || '',
        }
      : null,
    timestamp: new Date().toISOString(),
  });
});

/* =========================================================
   AUTENTICAÇÃO
========================================================= */

/*
  O sistema agora trabalha SOMENTE com Access Token.

  Client ID, Client Secret e Redirect URI não são necessários
  para autenticar quando o usuário já possui um Access Token.

  O Client Secret nunca é salvo pelo servidor.
*/

app.post('/api/auth/start', async (req, res) => {
  try {
    const accessToken = String(req.body?.access_token || '').trim();

    if (!accessToken) {
      return res.status(400).json({
        sucesso: false,
        erro: 'Informe o Access Token do Mercado Livre.',
      });
    }

    const usuario = await validarTokenML(accessToken);

    if (!usuario) {
      return res.status(401).json({
        sucesso: false,
        erro: 'Access Token inválido, expirado ou sem autorização.',
      });
    }

    return res.json({
      sucesso: true,
      autenticado: true,
      usuario: {
        id: usuario.id,
        nickname: usuario.nickname || '',
        nome: usuario.first_name || '',
        sobrenome: usuario.last_name || '',
        email: usuario.email || '',
        permalink: usuario.permalink || '',
      },
    });
  } catch (error) {
    console.error('POST /api/auth/start:', error);

    return res.status(500).json({
      sucesso: false,
      erro: 'Não foi possível validar o Access Token.',
      detalhes: erroMensagem(error),
    });
  }
});

app.get('/api/auth/status', async (req, res) => {
  try {
    const token = obterToken(req);

    if (!token) {
      return res.status(401).json({
        autenticado: false,
        erro: 'Access Token não informado.',
      });
    }

    const usuario = await validarTokenML(token);

    if (!usuario) {
      return res.status(401).json({
        autenticado: false,
        erro: 'Access Token inválido ou expirado.',
      });
    }

    return res.json({
      autenticado: true,
      usuario: {
        id: usuario.id,
        nickname: usuario.nickname || '',
        nome: usuario.first_name || '',
        sobrenome: usuario.last_name || '',
        email: usuario.email || '',
        permalink: usuario.permalink || '',
      },
    });
  } catch (error) {
    console.error('GET /api/auth/status:', error);

    return res.status(500).json({
      autenticado: false,
      erro: 'Erro ao verificar autenticação.',
    });
  }
});

app.post('/api/auth/logout', (req, res) => {
  /*
    O token fica no sessionStorage do navegador.
    Portanto, logout no servidor não precisa revogar o token
    do Mercado Livre.
  */

  return res.json({
    sucesso: true,
    mensagem: 'Sessão encerrada.',
  });
});

/* =========================================================
   OBTENÇÃO DOS ANÚNCIOS
========================================================= */

app.get('/api/anuncios', async (req, res) => {
  try {
    const token = obterToken(req);

    if (!token) {
      return res.status(401).json({
        erro: 'Access Token não informado.',
      });
    }

    const usuario = await validarTokenML(token);

    if (!usuario) {
      return res.status(401).json({
        erro: 'Access Token inválido ou expirado.',
      });
    }

    const sellerId = usuario.id;

    const limiteSolicitado = Number(req.query.limit || 50);

    const limit = Math.min(
      Math.max(Number.isFinite(limiteSolicitado) ? limiteSolicitado : 50, 1),
      100
    );

    const offset = Math.max(Number(req.query.offset || 0), 0);

    const status = req.query.status || 'active';

    const searchParams = new URLSearchParams({
      seller_id: String(sellerId),
      status,
      limit: String(limit),
      offset: String(offset),
    });

    const busca = await mlFetch(
      `${ML_API}/users/${sellerId}/items/search?${searchParams}`,
      token
    );

    if (!busca.response.ok) {
      return res.status(busca.response.status).json({
        erro: respostaErroMercadoLivre(
          busca.data,
          busca.response.status
        ),
        mercado_livre: busca.data,
      });
    }

    const ids = Array.isArray(busca.data?.results)
      ? busca.data.results
      : [];

    if (!ids.length) {
      return res.json({
        sucesso: true,
        usuario: {
          id: usuario.id,
          nickname: usuario.nickname || '',
        },
        total: Number(busca.data?.paging?.total || 0),
        limit,
        offset,
        anuncios: [],
      });
    }

    const anuncios = [];

    /*
      O endpoint de itens permite buscar vários anúncios.
      Para evitar URLs gigantes, dividimos em lotes.
    */

    const tamanhoLote = 20;

    for (let i = 0; i < ids.length; i += tamanhoLote) {
      const lote = ids.slice(i, i + tamanhoLote);

      const detalhes = await mlFetch(
        `${ML_API}/items?ids=${encodeURIComponent(lote.join(','))}`,
        token
      );

      if (!detalhes.response.ok) {
        continue;
      }

      const lista = Array.isArray(detalhes.data)
        ? detalhes.data
        : [];

      for (const resultado of lista) {
        const item = resultado?.body || resultado;

        if (!item?.id) {
          continue;
        }

        let saleFee = 0;

        try {
          const feeResponse = await mlFetch(
            `${ML_API}/items/${item.id}/sale_fee`,
            token
          );

          if (
            feeResponse.response.ok &&
            feeResponse.data
          ) {
            saleFee = Number(
              feeResponse.data.sale_fee_amount ||
              feeResponse.data.sale_fee ||
              0
            );
          }
        } catch {
          saleFee = 0;
        }

        let shippingCost = 0;

        try {
          shippingCost = await calcularFreteExato(
            item,
            token
          );
        } catch {
          shippingCost = 0;
        }

        const preco = Number(item.price || 0);

        const freteGratuito =
          item.shipping?.free_shipping === true;

        const freteConsiderado = freteGratuito
          ? Number(shippingCost || 0)
          : 0;

        const liquido = Math.max(
          0,
          preco - saleFee - freteConsiderado
        );

        anuncios.push({
          id: item.id,

          title: item.title || '',
          titulo: item.title || '',

          price: preco,
          preco,

          sale_fee: saleFee,
          comissao: saleFee,

          shipping_cost: freteConsiderado,
          frete: freteConsiderado,

          net_received: liquido,
          liquido,

          status: item.status || '',
          permalink: item.permalink || '',

          thumbnail:
            item.thumbnail ||
            item.pictures?.[0]?.secure_url ||
            item.pictures?.[0]?.url ||
            '',

          category_id: item.category_id || '',
          condition: item.condition || '',

          available_quantity: Number(
            item.available_quantity || 0
          ),

          sold_quantity: Number(
            item.sold_quantity || 0
          ),

          listing_type_id:
            item.listing_type_id || '',

          shipping: item.shipping || {},
        });
      }
    }

    return res.json({
      sucesso: true,

      usuario: {
        id: usuario.id,
        nickname: usuario.nickname || '',
        nome: usuario.first_name || '',
      },

      total: Number(
        busca.data?.paging?.total ||
          anuncios.length
      ),

      limit,
      offset,

      anuncios,
    });
  } catch (error) {
    console.error('GET /api/anuncios:', error);

    return res.status(500).json({
      erro: 'Erro ao carregar anúncios.',
      detalhes: erroMensagem(error),
    });
  }
});

/* =========================================================
   FRETE
========================================================= */

async function calcularFreteExato(itemObj, token) {
  const itemId = itemObj?.id;

  if (!itemId) {
    return 0;
  }

  try {
    const saleFee = await mlFetch(
      `${ML_API}/items/${itemId}/sale_fee`,
      token
    );

    const data = saleFee.data;

    if (
      data?.sale_fee_details &&
      data.sale_fee_details.shipping_fee !== undefined
    ) {
      return Number(
        data.sale_fee_details.shipping_fee || 0
      );
    }

    if (data?.shipping_fee !== undefined) {
      return Number(data.shipping_fee || 0);
    }
  } catch (error) {
    console.warn(
      `Falha calculando frete de ${itemId}:`,
      erroMensagem(error)
    );
  }

  /*
    Fallback.
    Esse valor só é utilizado quando a API não informa
    o frete detalhado.
  */

  if (itemObj?.shipping?.free_shipping) {
    return 12.95;
  }

  return 0;
}

/* =========================================================
   SINCRONIZAÇÃO DE PREÇOS
========================================================= */

app.post('/api/sincronizar-precos', async (req, res) => {
  try {
    const token = obterToken(req);

    if (!token) {
      return res.status(401).json({
        erro: 'Access Token não informado.',
      });
    }

    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids
      : [];

    if (!ids.length) {
      return res.status(400).json({
        erro: 'Nenhum anúncio foi informado.',
      });
    }

    const resultados = [];

    for (const id of ids) {
      try {
        const resposta = await mlFetch(
          `${ML_API}/items/${encodeURIComponent(id)}`,
          token
        );

        if (!resposta.response.ok) {
          resultados.push({
            id,
            sucesso: false,
            erro: respostaErroMercadoLivre(
              resposta.data,
              resposta.response.status
            ),
          });

          continue;
        }

        const item = resposta.data;

        resultados.push({
          id,
          sucesso: true,
          preco: Number(item.price || 0),
          titulo: item.title || '',
        });
      } catch (error) {
        resultados.push({
          id,
          sucesso: false,
          erro: erroMensagem(error),
        });
      }
    }

    return res.json({
      sucesso: true,
      resultados,
    });
  } catch (error) {
    console.error(
      'POST /api/sincronizar-precos:',
      error
    );

    return res.status(500).json({
      erro: 'Erro ao sincronizar preços.',
      detalhes: erroMensagem(error),
    });
  }
});

/* =========================================================
   SINCRONIZAÇÃO DE FRETES
========================================================= */

app.post('/api/sincronizar-fretes', async (req, res) => {
  try {
    const token = obterToken(req);

    if (!token) {
      return res.status(401).json({
        erro: 'Access Token não informado.',
      });
    }

    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids
      : [];

    if (!ids.length) {
      return res.status(400).json({
        erro: 'Nenhum anúncio foi informado.',
      });
    }

    const resultados = [];

    for (const id of ids) {
      try {
        const itemResponse = await mlFetch(
          `${ML_API}/items/${encodeURIComponent(id)}`,
          token
        );

        if (!itemResponse.response.ok) {
          resultados.push({
            id,
            sucesso: false,
            erro: respostaErroMercadoLivre(
              itemResponse.data,
              itemResponse.response.status
            ),
          });

          continue;
        }

        const item = itemResponse.data;

        const frete =
          await calcularFreteExato(
            item,
            token
          );

        resultados.push({
          id,
          sucesso: true,
          frete,
          frete_gratis:
            item.shipping?.free_shipping === true,
        });
      } catch (error) {
        resultados.push({
          id,
          sucesso: false,
          erro: erroMensagem(error),
        });
      }
    }

    return res.json({
      sucesso: true,
      resultados,
    });
  } catch (error) {
    console.error(
      'POST /api/sincronizar-fretes:',
      error
    );

    return res.status(500).json({
      erro: 'Erro ao sincronizar fretes.',
      detalhes: erroMensagem(error),
    });
  }
});

/* =========================================================
   ATUALIZAR PREÇO INDIVIDUAL
========================================================= */

app.post('/api/atualizar-preco', async (req, res) => {
  try {
    const token = obterToken(req);

    if (!token) {
      return res.status(401).json({
        erro: 'Access Token não informado.',
      });
    }

    const id = String(req.body?.id || '').trim();

    const preco = Number(
      req.body?.preco ??
        req.body?.price
    );

    if (!id) {
      return res.status(400).json({
        erro: 'ID do anúncio não informado.',
      });
    }

    if (
      !Number.isFinite(preco) ||
      preco <= 0
    ) {
      return res.status(400).json({
        erro: 'Informe um preço válido maior que zero.',
      });
    }

    const resposta = await mlFetch(
      `${ML_API}/items/${encodeURIComponent(id)}`,
      token,
      {
        method: 'PUT',

        headers: {
          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          price: Number(preco.toFixed(2)),
        }),
      }
    );

    if (!resposta.response.ok) {
      return res.status(
        resposta.response.status
      ).json({
        sucesso: false,
        erro: respostaErroMercadoLivre(
          resposta.data,
          resposta.response.status
        ),
        mercado_livre: resposta.data,
      });
    }

    return res.json({
      sucesso: true,

      mensagem:
        'Preço atualizado com sucesso.',

      anuncio: {
        id: resposta.data.id || id,
        titulo:
          resposta.data.title || '',
        preco: Number(
          resposta.data.price || preco
        ),
      },

      dados: resposta.data,
    });
  } catch (error) {
    console.error(
      'POST /api/atualizar-preco:',
      error
    );

    return res.status(500).json({
      sucesso: false,
      erro: 'Erro ao atualizar preço.',
      detalhes: erroMensagem(error),
    });
  }
});

/* =========================================================
   ATUALIZAÇÃO EM MASSA
========================================================= */

app.post('/api/atualizar-precos', async (req, res) => {
  try {
    const token = obterToken(req);

    if (!token) {
      return res.status(401).json({
        erro: 'Access Token não informado.',
      });
    }

    const anuncios = Array.isArray(
      req.body?.anuncios
    )
      ? req.body.anuncios
      : [];

    if (!anuncios.length) {
      return res.status(400).json({
        erro: 'Nenhum anúncio foi informado.',
      });
    }

    const resultados = [];

    for (const anuncio of anuncios) {
      const id = String(
        anuncio?.id || ''
      ).trim();

      const preco = Number(
        anuncio?.preco ??
          anuncio?.price
      );

      if (
        !id ||
        !Number.isFinite(preco) ||
        preco <= 0
      ) {
        resultados.push({
          id,
          sucesso: false,
          erro: 'ID ou preço inválido.',
        });

        continue;
      }

      try {
        const resposta = await mlFetch(
          `${ML_API}/items/${encodeURIComponent(id)}`,
          token,
          {
            method: 'PUT',

            headers: {
              'Content-Type':
                'application/json',
            },

            body: JSON.stringify({
              price: Number(
                preco.toFixed(2)
              ),
            }),
          }
        );

        if (!resposta.response.ok) {
          resultados.push({
            id,
            sucesso: false,
            erro: respostaErroMercadoLivre(
              resposta.data,
              resposta.response.status
            ),
          });

          continue;
        }

        resultados.push({
          id,
          sucesso: true,
          preco: Number(
            resposta.data.price ||
              preco
          ),
          titulo:
            resposta.data.title ||
            anuncio.titulo ||
            '',
        });
      } catch (error) {
        resultados.push({
          id,
          sucesso: false,
          erro: erroMensagem(error),
        });
      }
    }

    const sucesso = resultados.filter(
      item => item.sucesso
    ).length;

    const falhas = resultados.length - sucesso;

    return res.json({
      sucesso: falhas === 0,
      total: resultados.length,
      atualizados: sucesso,
      falhas,
      resultados,
    });
  } catch (error) {
    console.error(
      'POST /api/atualizar-precos:',
      error
    );

    return res.status(500).json({
      sucesso: false,
      erro: 'Erro na atualização em massa.',
      detalhes: erroMensagem(error),
    });
  }
});

/* =========================================================
   ERROS
========================================================= */

app.use((req, res) => {
  res.status(404).json({
    erro: 'Rota não encontrada.',
    rota: req.originalUrl,
    metodo: req.method,
  });
});

app.use((error, req, res, next) => {
  console.error('Erro geral:', error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    erro: 'Erro interno do servidor.',
    detalhes: erroMensagem(error),
  });
});

/* =========================================================
   SERVIDOR
========================================================= */

app.listen(PORT, () => {
  console.log(
    `Servidor Mercado Livre rodando na porta ${PORT}`
  );

  console.log(
    `Modo: Access Token`
  );

  if (process.env.ML_ACCESS_TOKEN) {
    console.log(
      'ML_ACCESS_TOKEN configurado no ambiente.'
    );
  } else {
    console.log(
      'ML_ACCESS_TOKEN não configurado. O token deverá ser enviado pelo painel.'
    );
  }
});
