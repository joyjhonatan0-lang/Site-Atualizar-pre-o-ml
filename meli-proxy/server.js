const express = require('express');
const cors = require('cors');

const fetch = (...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ML_API = 'https://api.mercadolibre.com';

app.get('/', (req, res) => {
    res.send('Servidor proxy do Mercado Livre online!');
});

/* =========================================================
   FUNÇÕES AUXILIARES
========================================================= */

function obterToken(req) {
    let token = req.headers['authorization'];

    if (!token) {
        return null;
    }

    return token.replace(/^Bearer\s+/i, '').trim();
}

function respostaErro(res, status, mensagem) {
    return res.status(status).json({
        sucesso: false,
        erro: mensagem
    });
}

async function mlFetch(url, token, options = {}) {
    const headers = {
        ...(options.headers || {}),
        Authorization: 'Bearer ' + token
    };

    return fetch(url, {
        ...options,
        headers
    });
}

async function jsonSeguro(response) {
    try {
        return await response.json();
    } catch {
        return {};
    }
}

function formatarErroMercadoLivre(data) {
    return (
        data?.message ||
        data?.error ||
        data?.cause?.[0]?.message ||
        data?.cause?.[0]?.code ||
        JSON.stringify(data)
    );
}

// Função auxiliar centralizada para calcular o frete exato do Mercado Livre
async function calcularFreteExato(itemObj, token) {
    const shipping = itemObj.shipping || {};
    const freeShipping = shipping.free_shipping || false;

    let custoEnvio = 6.85;

    if (freeShipping) {
        try {
            const saleFeeRes = await mlFetch(
                `${ML_API}/items/${itemObj.id}/sale_fee?price=${itemObj.price || 0}&listing_type_id=${itemObj.listing_type_id || 'gold_special'}`,
                token
            );

            if (saleFeeRes.ok) {
                const saleFeeData = await jsonSeguro(saleFeeRes);

                if (
                    saleFeeData.sale_fee_details &&
                    saleFeeData.sale_fee_details.shipping_fee
                ) {
                    return saleFeeData.sale_fee_details.shipping_fee;
                }
            }
        } catch (e) {
            // fallback
        }

        if (
            shipping.costs &&
            Array.isArray(shipping.costs) &&
            shipping.costs.length > 0
        ) {
            const cObj = shipping.costs.find(
                c => c.cost !== undefined
            );

            if (cObj) {
                return cObj.cost;
            }
        }

        custoEnvio = 12.95;
    } else {
        if (
            shipping.costs &&
            Array.isArray(shipping.costs) &&
            shipping.costs.length > 0
        ) {
            const cObj = shipping.costs.find(
                c => c.cost !== undefined
            );

            if (cObj) {
                custoEnvio = cObj.cost;
            }
        }
    }

    return custoEnvio;
}

/* =========================================================
   1. ROTA ORIGINAL - TODOS OS ANÚNCIOS
   NÃO ALTERADA NA LÓGICA
========================================================= */

app.get('/api/anuncios', async (req, res) => {
    let token = obterToken(req);

    if (!token) {
        return res.status(401).json({
            erro: "Token não fornecido"
        });
    }

    const existingIdsParam = req.query.existingIds;

    const existingIdsSet = new Set(
        existingIdsParam
            ? existingIdsParam.split(',')
            : []
    );

    const isAppendMode =
        existingIdsSet.size > 0;

    try {
        const userRes = await mlFetch(
            `${ML_API}/users/me`,
            token
        );

        const userData = await jsonSeguro(userRes);

        if (!userData.id) {
            return res.status(401).json({
                erro: "Token inválido ou expirado."
            });
        }

        let allIds = [];
        let scrollId = null;
        let hasMore = true;

        while (hasMore) {
            let url =
                `${ML_API}/users/${userData.id}/items/search?search_type=scan&limit=50`;

            if (scrollId) {
                url += `&scroll_id=${encodeURIComponent(scrollId)}`;
            }

            const searchRes = await mlFetch(
                url,
                token
            );

            const searchData =
                await jsonSeguro(searchRes);

            const results =
                searchData.results || [];

            if (results.length > 0) {
                allIds =
                    allIds.concat(results);
            }

            scrollId =
                searchData.scroll_id;

            if (
                results.length === 0 ||
                !scrollId
            ) {
                hasMore = false;
            }
        }

        if (allIds.length === 0) {
            return res.json({
                itens: []
            });
        }

        let targetIds = allIds;

        if (isAppendMode) {
            targetIds =
                allIds.filter(
                    id => !existingIdsSet.has(id)
                );

            if (targetIds.length === 0) {
                return res.json({
                    itens: [],
                    mensagem:
                        "Nenhum anúncio novo encontrado."
                });
            }
        }

        let listaFinal = [];

        for (
            let i = 0;
            i < targetIds.length;
            i += 20
        ) {
            const chunk =
                targetIds.slice(
                    i,
                    i + 20
                );

            try {
                const multiRes =
                    await mlFetch(
                        `${ML_API}/items?ids=${chunk.join(",")}`,
                        token
                    );

                const multiData =
                    await jsonSeguro(multiRes);

                const itensArray =
                    Array.isArray(multiData)
                        ? multiData
                        : [];

                for (
                    let itemObj
                    of itensArray
                ) {
                    if (
                        itemObj &&
                        itemObj.code === 200 &&
                        itemObj.body
                    ) {
                        const body =
                            itemObj.body;

                        const idItem =
                            body.id;

                        const preco =
                            body.price || 0;

                        const listingType =
                            body.listing_type_id ||
                            'gold_special';

                        const availableQty =
                            body.available_quantity ||
                            0;

                        const title =
                            body.title ||
                            'Sem Título';

                        const permalink =
                            body.permalink ||
                            '#';

                        const thumbnail =
                            body.thumbnail ||
                            '';

                        let sku =
                            'Sem SKU';

                        if (body.attributes) {
                            const attrSku =
                                body.attributes.find(
                                    a =>
                                        a.id ===
                                        'SELLER_SKU'
                                );

                            if (
                                attrSku &&
                                attrSku.value_name
                            ) {
                                sku =
                                    attrSku.value_name;
                            }
                        }

                        const status =
                            body.status ||
                            'active';

                        let comissao =
                            body.sale_fee ||
                            (
                                listingType ===
                                'gold_pro'
                                    ? preco * 0.16
                                    : preco * 0.11
                            );

                        const shipping =
                            body.shipping || {};

                        const freeShipping =
                            shipping.free_shipping ||
                            false;

                        const custoEnvio =
                            await calcularFreteExato(
                                body,
                                token
                            );

                        let liquido =
                            preco -
                            comissao -
                            (
                                freeShipping
                                    ? custoEnvio
                                    : 0
                            );

                        if (liquido < 0) {
                            liquido = 0;
                        }

                        listaFinal.push({
                            id: idItem,
                            title,
                            price: preco,
                            status,
                            listing_type_id:
                                listingType,
                            available_quantity:
                                availableQty,
                            sold_quantity:
                                Number(body.sold_quantity || 0),
                            sku,
                            permalink,
                            thumbnail,
                            sale_fee:
                                comissao,
                            shipping_cost:
                                custoEnvio,
                            free_shipping:
                                freeShipping,
                            net_received:
                                liquido
                        });
                    }
                }
            } catch (chunkErr) {
                console.error(
                    "Erro ao buscar lote de IDs:",
                    chunkErr
                );
            }
        }

        res.json({
            itens: listaFinal
        });

    } catch (e) {
        res.status(500).json({
            erro:
                "Erro ao processar dados da API: " +
                e.message
        });
    }
});

/* =========================================================
   2. ROTA ORIGINAL - SINCRONIZAR PREÇOS
========================================================= */

app.post('/api/sincronizar-precos', async (req, res) => {
    let token = obterToken(req);

    if (!token) {
        return res.status(401).json({
            erro: "Token não fornecido"
        });
    }

    const { ids } = req.body;

    if (
        !ids ||
        !Array.isArray(ids) ||
        ids.length === 0
    ) {
        return res.status(400).json({
            erro:
                "Lista de IDs inválida."
        });
    }

    let precosMap = {};

    try {
        for (
            let i = 0;
            i < ids.length;
            i += 20
        ) {
            const blocoIds =
                ids
                    .slice(i, i + 20)
                    .join(',');

            const multiRes =
                await mlFetch(
                    `${ML_API}/items?ids=${blocoIds}`,
                    token
                );

            const multiData =
                await jsonSeguro(multiRes);

            if (Array.isArray(multiData)) {
                multiData.forEach(
                    itemObj => {
                        if (
                            itemObj.code === 200 &&
                            itemObj.body
                        ) {
                            precosMap[
                                itemObj.body.id
                            ] =
                                itemObj.body.price;
                        }
                    }
                );
            }
        }

        res.json({
            precos: precosMap
        });

    } catch (e) {
        res.status(500).json({
            erro:
                "Erro ao buscar preços: " +
                e.message
        });
    }
});

/* =========================================================
   3. ROTA ORIGINAL - SINCRONIZAR FRETES
========================================================= */

app.post('/api/sincronizar-fretes', async (req, res) => {
    let token = obterToken(req);

    if (!token) {
        return res.status(401).json({
            erro: "Token não fornecido"
        });
    }

    const { ids } = req.body;

    if (
        !ids ||
        !Array.isArray(ids) ||
        ids.length === 0
    ) {
        return res.status(400).json({
            erro:
                "Lista de IDs inválida."
        });
    }

    let fretesMap = {};

    try {
        for (
            let i = 0;
            i < ids.length;
            i += 20
        ) {
            const blocoIds =
                ids
                    .slice(i, i + 20)
                    .join(',');

            const multiRes =
                await mlFetch(
                    `${ML_API}/items?ids=${blocoIds}`,
                    token
                );

            const multiData =
                await jsonSeguro(multiRes);

            if (Array.isArray(multiData)) {
                for (
                    const itemObj
                    of multiData
                ) {
                    if (
                        itemObj.code === 200 &&
                        itemObj.body
                    ) {
                        const body =
                            itemObj.body;

                        const freeShipping =
                            (
                                body.shipping &&
                                body.shipping.free_shipping
                            ) || false;

                        const custoEnvio =
                            await calcularFreteExato(
                                body,
                                token
                            );

                        fretesMap[
                            body.id
                        ] = {
                            custo:
                                custoEnvio,
                            shipping_cost:
                                custoEnvio,
                            gratis:
                                freeShipping,
                            free_shipping:
                                freeShipping
                        };
                    }
                }
            }
        }

        res.json({
            fretes: fretesMap
        });

    } catch (e) {
        res.status(500).json({
            erro:
                "Erro ao buscar fretes: " +
                e.message
        });
    }
});

/* =========================================================
   4. ROTA ORIGINAL - ATUALIZAR PREÇO
========================================================= */

app.post('/api/atualizar-preco', async (req, res) => {
    let token = obterToken(req);

    if (!token) {
        return res.status(401).json({
            erro: "Token não fornecido"
        });
    }

    const {
        id,
        price
    } = req.body;

    if (
        !id ||
        price === undefined
    ) {
        return res.status(400).json({
            erro:
                "ID ou preço não informados."
        });
    }

    try {
        const mlRes =
            await mlFetch(
                `${ML_API}/items/${id}`,
                token,
                {
                    method: 'PUT',
                    headers: {
                        'Content-Type':
                            'application/json'
                    },
                    body:
                        JSON.stringify({
                            price:
                                Number(price)
                        })
                }
            );

        const mlData =
            await jsonSeguro(mlRes);

        if (mlRes.ok) {
            res.json({
                sucesso: true,
                resultado:
                    mlData
            });
        } else {
            const mensagemErro =
                formatarErroMercadoLivre(
                    mlData
                );

            res.status(400).json({
                erro:
                    mensagemErro
            });
        }

    } catch (e) {
        res.status(500).json({
            erro:
                "Erro de conexão ao atualizar preço: " +
                e.message
        });
    }
});

/* =========================================================
   5. ROTA ORIGINAL - ATUALIZAÇÃO EM LOTE
========================================================= */

app.post('/api/atualizar-precos', async (req, res) => {
    let token = obterToken(req);

    if (!token) {
        return res.status(401).json({
            erro: "Token não fornecido"
        });
    }

    const { itens } = req.body;

    if (
        !itens ||
        !Array.isArray(itens) ||
        itens.length === 0
    ) {
        return res.status(400).json({
            erro:
                "Nenhum item informado para atualização em lote."
        });
    }

    try {
        const promises =
            itens.map(
                async item => {
                    try {
                        const mlRes =
                            await mlFetch(
                                `${ML_API}/items/${item.id}`,
                                token,
                                {
                                    method:
                                        'PUT',
                                    headers: {
                                        'Content-Type':
                                            'application/json'
                                    },
                                    body:
                                        JSON.stringify({
                                            price:
                                                Number(
                                                    item.price
                                                )
                                        })
                                }
                            );

                        const mlData =
                            await jsonSeguro(
                                mlRes
                            );

                        if (mlRes.ok) {
                            return {
                                id:
                                    item.id,
                                sucesso:
                                    true
                            };
                        }

                        return {
                            id:
                                item.id,
                            sucesso:
                                false,
                            erro:
                                formatarErroMercadoLivre(
                                    mlData
                                )
                        };

                    } catch (err) {
                        return {
                            id:
                                item.id,
                            sucesso:
                                false,
                            erro:
                                "Erro de conexão: " +
                                err.message
                        };
                    }
                }
            );

        const resultados =
            await Promise.all(
                promises
            );

        res.json({
            resultados
        });

    } catch (e) {
        res.status(500).json({
            erro:
                "Erro no servidor ao processar lote: " +
                e.message
        });
    }
});

/* =========================================================
   NOVAS FUNÇÕES
   DASHBOARD / INDICADORES / VENDAS / TOP 10
========================================================= */

/**
 * Busca todos os pedidos disponíveis no período
 * permitido pela API.
 *
 * A API do Mercado Livre mantém pedidos por até 12 meses.
 */
async function buscarPedidosDoVendedor(
    token,
    sellerId
) {
    const agora =
        new Date();

    const inicio =
        new Date(agora);

    inicio.setFullYear(
        inicio.getFullYear() - 1
    );

    let pedidos = [];
    let offset = 0;
    const limit = 50;

    while (true) {
        const params =
            new URLSearchParams({
                seller:
                    String(sellerId),
                'order.date_created.from':
                    inicio.toISOString(),
                'order.date_created.to':
                    agora.toISOString(),
                sort:
                    'date_desc',
                offset:
                    String(offset),
                limit:
                    String(limit)
            });

        const response =
            await mlFetch(
                `${ML_API}/orders/search?${params.toString()}`,
                token
            );

        const data =
            await jsonSeguro(
                response
            );

        if (!response.ok) {
            throw new Error(
                formatarErroMercadoLivre(
                    data
                )
            );
        }

        const resultados =
            data.results || [];

        pedidos =
            pedidos.concat(
                resultados
            );

        const total =
            Number(
                data.paging?.total || 0
            );

        offset +=
            resultados.length;

        if (
            resultados.length === 0 ||
            offset >= total
        ) {
            break;
        }

        // Proteção
        if (offset > 50000) {
            break;
        }
    }

    return pedidos;
}

/**
 * Busca títulos e informações dos anúncios
 * usados no ranking.
 */
async function buscarItensBulk(
    token,
    ids
) {
    const mapa = {};

    const idsUnicos =
        [...new Set(
            ids.filter(Boolean)
        )];

    for (
        let i = 0;
        i < idsUnicos.length;
        i += 20
    ) {
        const bloco =
            idsUnicos.slice(
                i,
                i + 20
            );

        if (bloco.length === 0) {
            continue;
        }

        const response =
            await mlFetch(
                `${ML_API}/items/bulk?ids=${bloco.join(',')}`,
                token
            );

        const data =
            await jsonSeguro(
                response
            );

        if (!response.ok) {
            continue;
        }

        if (Array.isArray(data)) {
            data.forEach(
                registro => {
                    const body =
                        registro.body;

                    const id =
                        registro.id ||
                        body?.id;

                    if (
                        id &&
                        body
                    ) {
                        mapa[id] =
                            body;
                    }
                }
            );
        }
    }

    return mapa;
}

/**
 * GET /api/dashboard
 *
 * Retorna:
 * - dados da conta
 * - 4 indicadores
 * - vendas reais
 * - top 10 anúncios
 */
app.get('/api/dashboard', async (req, res) => {
    const token =
        obterToken(req);

    if (!token) {
        return respostaErro(
            res,
            401,
            'Token não fornecido.'
        );
    }

    try {
        const userResponse =
            await mlFetch(
                `${ML_API}/users/me`,
                token
            );

        const user =
            await jsonSeguro(
                userResponse
            );

        if (
            !userResponse.ok ||
            !user.id
        ) {
            return respostaErro(
                res,
                401,
                'Token inválido ou expirado.'
            );
        }

        const sellerId =
            user.id;

        const pedidos =
            await buscarPedidosDoVendedor(
                token,
                sellerId
            );

        /*
         * Somente pedidos pagos entram no
         * cálculo de venda real.
         */
        const pedidosPagos =
            pedidos.filter(
                pedido =>
                    pedido.status ===
                    'paid'
            );

        let totalVendas =
            0;

        let totalUnidades =
            0;

        const vendasPorItem =
            {};

        pedidosPagos.forEach(
            pedido => {
                totalVendas +=
                    Number(
                        pedido.paid_amount ||
                        pedido.total_amount ||
                        0
                    );

                const itens =
                    pedido.order_items ||
                    [];

                itens.forEach(
                    orderItem => {
                        const item =
                            orderItem.item ||
                            {};

                        const itemId =
                            item.id;

                        const quantidade =
                            Number(
                                orderItem.quantity ||
                                0
                            );

                        const unitPrice =
                            Number(
                                orderItem.unit_price ||
                                0
                            );

                        if (!itemId) {
                            return;
                        }

                        totalUnidades +=
                            quantidade;

                        if (
                            !vendasPorItem[
                                itemId
                            ]
                        ) {
                            vendasPorItem[
                                itemId
                            ] = {
                                item_id:
                                    itemId,
                                titulo:
                                    item.title ||
                                    itemId,
                                unidades:
                                    0,
                                faturamento:
                                    0
                            };
                        }

                        vendasPorItem[
                            itemId
                        ].unidades +=
                            quantidade;

                        vendasPorItem[
                            itemId
                        ].faturamento +=
                            quantidade *
                            unitPrice;
                    }
                );
            }
        );

        const topIds =
            Object.values(
                vendasPorItem
            )
                .sort(
                    (a, b) =>
                        b.unidades -
                        a.unidades
                )
                .slice(0, 10)
                .map(
                    item =>
                        item.item_id
                );

        const itensDetalhes =
            await buscarItensBulk(
                token,
                topIds
            );

        const top10 =
            Object.values(
                vendasPorItem
            )
                .sort(
                    (a, b) =>
                        b.unidades -
                        a.unidades
                )
                .slice(0, 10)
                .map(
                    item => {
                        const detalhe =
                            itensDetalhes[
                                item.item_id
                            ];

                        return {
                            ...item,
                            titulo:
                                detalhe?.title ||
                                item.titulo,
                            preco_atual:
                                detalhe?.price ||
                                0,
                            thumbnail:
                                detalhe?.thumbnail ||
                                '',
                            permalink:
                                detalhe?.permalink ||
                                '#'
                        };
                    }
                );

        /*
         * Busca os dados completos do vendedor.
         * seller_reputation.metrics contém:
         * sales
         * claims
         * delayed_handling_time
         * cancellations
         */
        const sellerResponse =
            await mlFetch(
                `${ML_API}/users/${sellerId}?attributes=seller_reputation`,
                token
            );

        const sellerData =
            await jsonSeguro(
                sellerResponse
            );

        const reputation =
            sellerData.seller_reputation ||
            {};

        const metrics =
            reputation.metrics ||
            {};

        const salesMetric =
            metrics.sales ||
            {};

        const claimsMetric =
            metrics.claims ||
            {};

        const delayedMetric =
            metrics.delayed_handling_time ||
            {};

        const cancellationsMetric =
            metrics.cancellations ||
            {};

        res.json({
            sucesso: true,

            periodo_vendas: {
                inicio:
                    inicioISO12Meses(),
                fim:
                    new Date().toISOString(),
                observacao:
                    'A API de pedidos do Mercado Livre disponibiliza pedidos por até 12 meses.'
            },

            conta: {
                id:
                    sellerData.id ||
                    sellerId,
                nickname:
                    sellerData.nickname ||
                    user.nickname ||
                    '',
                permalink:
                    sellerData.permalink ||
                    ''
            },

            indicadores: {
                vendas: {
                    nome:
                        'Vendas',
                    valor:
                        salesMetric.completed ??
                        salesMetric.value ??
                        null,
                    periodo:
                        salesMetric.period ??
                        null
                },

                reclamacoes: {
                    nome:
                        'Reclamações',
                    taxa:
                        claimsMetric.rate ??
                        null,
                    valor:
                        claimsMetric.value ??
                        null,
                    periodo:
                        claimsMetric.period ??
                        null
                },

                atrasos: {
                    nome:
                        'Atrasos',
                    taxa:
                        delayedMetric.rate ??
                        null,
                    valor:
                        delayedMetric.value ??
                        null,
                    periodo:
                        delayedMetric.period ??
                        null
                },

                cancelamentos: {
                    nome:
                        'Cancelamentos',
                    taxa:
                        cancellationsMetric.rate ??
                        null,
                    valor:
                        cancellationsMetric.value ??
                        null,
                    periodo:
                        cancellationsMetric.period ??
                        null
                }
            },

            vendas_reais: {
                pedidos_pagos:
                    pedidosPagos.length,
                unidades:
                    totalUnidades,
                valor_total:
                    Number(
                        totalVendas.toFixed(2)
                    ),
                moeda:
                    'BRL'
            },

            top10
        });

    } catch (error) {
        console.error(
            'Erro dashboard:',
            error
        );

        return respostaErro(
            res,
            500,
            'Erro ao carregar o dashboard: ' +
            error.message
        );
    }
});

function inicioISO12Meses() {
    const data =
        new Date();

    data.setFullYear(
        data.getFullYear() - 1
    );

    return data.toISOString();
}

/* =========================================================
   PERGUNTAS E RESPOSTAS
========================================================= */

/**
 * GET /api/perguntas
 *
 * Busca perguntas recebidas pelo vendedor.
 */
app.get('/api/perguntas', async (req, res) => {
    const token =
        obterToken(req);

    if (!token) {
        return respostaErro(
            res,
            401,
            'Token não fornecido.'
        );
    }

    try {
        const userResponse =
            await mlFetch(
                `${ML_API}/users/me`,
                token
            );

        const user =
            await jsonSeguro(
                userResponse
            );

        if (
            !userResponse.ok ||
            !user.id
        ) {
            return respostaErro(
                res,
                401,
                'Token inválido ou expirado.'
            );
        }

        const sellerId =
            user.id;

        const limit =
            Math.min(
                Number(
                    req.query.limit || 50
                ),
                100
            );

        const offset =
            Math.max(
                Number(
                    req.query.offset || 0
                ),
                0
            );

        const status =
            req.query.status || '';

        const params =
            new URLSearchParams({
                seller_id:
                    String(sellerId),
                api_version:
                    '4',
                limit:
                    String(limit),
                offset:
                    String(offset),
                sort_fields:
                    'date_created',
                sort_types:
                    'DESC'
            });

        if (status) {
            params.set(
                'status',
                status
            );
        }

        const response =
            await mlFetch(
                `${ML_API}/questions/search?${params.toString()}`,
                token
            );

        const data =
            await jsonSeguro(
                response
            );

        if (!response.ok) {
            return respostaErro(
                res,
                response.status,
                formatarErroMercadoLivre(
                    data
                )
            );
        }

        const perguntas =
            data.questions ||
            [];

        const ids =
            perguntas.map(
                p => p.item_id
            );

        const itens =
            await buscarItensBulk(
                token,
                ids
            );

        const resultado =
            perguntas.map(
                pergunta => {
                    const item =
                        itens[
                            pergunta.item_id
                        ];

                    return {
                        id:
                            pergunta.id,
                        item_id:
                            pergunta.item_id,
                        titulo:
                            item?.title ||
                            pergunta.item_id,
                        thumbnail:
                            item?.thumbnail ||
                            '',
                        permalink:
                            item?.permalink ||
                            '#',
                        pergunta:
                            pergunta.text ||
                            '',
                        status:
                            pergunta.status ||
                            '',
                        respondida:
                            pergunta.status ===
                            'ANSWERED' ||
                            Boolean(
                                pergunta.answer
                            ),
                        resposta:
                            pergunta.answer?.text ||
                            '',
                        data:
                            pergunta.date_created ||
                            null
                    };
                }
            );

        res.json({
            sucesso: true,
            total:
                data.total ||
                resultado.length,
            limit,
            offset,
            perguntas:
                resultado
        });

    } catch (error) {
        console.error(
            'Erro perguntas:',
            error
        );

        return respostaErro(
            res,
            500,
            'Erro ao carregar perguntas: ' +
            error.message
        );
    }
});

/**
 * POST /api/responder-pergunta
 */
app.post('/api/responder-pergunta', async (req, res) => {
    const token =
        obterToken(req);

    if (!token) {
        return respostaErro(
            res,
            401,
            'Token não fornecido.'
        );
    }

    const {
        question_id,
        text
    } = req.body;

    if (!question_id) {
        return respostaErro(
            res,
            400,
            'ID da pergunta não informado.'
        );
    }

    if (
        !text ||
        !String(text).trim()
    ) {
        return respostaErro(
            res,
            400,
            'Digite uma resposta.'
        );
    }

    const resposta =
        String(text).trim();

    if (resposta.length > 2000) {
        return respostaErro(
            res,
            400,
            'A resposta não pode ultrapassar 2.000 caracteres.'
        );
    }

    try {
        const response =
            await mlFetch(
                `${ML_API}/answers`,
                token,
                {
                    method:
                        'POST',
                    headers: {
                        'Content-Type':
                            'application/json'
                    },
                    body:
                        JSON.stringify({
                            question_id:
                                Number(
                                    question_id
                                ),
                            text:
                                resposta
                        })
                }
            );

        const data =
            await jsonSeguro(
                response
            );

        if (!response.ok) {
            return respostaErro(
                res,
                response.status,
                formatarErroMercadoLivre(
                    data
                )
            );
        }

        res.json({
            sucesso: true,
            mensagem:
                'Resposta enviada ao Mercado Livre.',
            resultado:
                data
        });

    } catch (error) {
        console.error(
            'Erro resposta:',
            error
        );

        return respostaErro(
            res,
            500,
            'Erro ao enviar resposta: ' +
            error.message
        );
    }
});

/* =========================================================
   ATUALIZAR TÍTULO E SKU DO ANÚNCIO
========================================================= */

app.put('/api/atualizar-anuncio', async (req, res) => {
    const token = obterToken(req);

    if (!token) {
        return respostaErro(res, 401, 'Token não fornecido.');
    }

    const { id, title, sku } = req.body || {};

    if (!id) {
        return respostaErro(res, 400, 'ID do anúncio não informado.');
    }

    const tituloLimpo = String(title ?? '').trim();
    const skuLimpo = String(sku ?? '').trim();

    if (!tituloLimpo) {
        return respostaErro(res, 400, 'O título do anúncio não pode ficar vazio.');
    }

    try {
        // Primeiro consulta o anúncio atual. Isso evita reenviar campos que o
        // usuário não alterou. O Mercado Livre pode rejeitar, por exemplo,
        // o campo title em anúncios que já possuem vendas.
        const atualRes = await mlFetch(
            `${ML_API}/items/${encodeURIComponent(id)}`,
            token
        );
        const atual = await jsonSeguro(atualRes);

        if (!atualRes.ok) {
            return respostaErro(
                res,
                atualRes.status || 400,
                formatarErroMercadoLivre(atual) || 'Não foi possível consultar o anúncio antes da alteração.'
            );
        }

        const attrSkuAtual = Array.isArray(atual.attributes)
            ? atual.attributes.find(a => a.id === 'SELLER_SKU')
            : null;

        const skuAtual = String(attrSkuAtual?.value_name ?? '').trim();
        const tituloAtual = String(atual.title ?? '').trim();
        const alterouSku = skuLimpo !== skuAtual;
        const alterouTitulo = tituloLimpo !== tituloAtual;

        if (!alterouSku && !alterouTitulo) {
            return res.json({
                sucesso: true,
                alterou: false,
                item: {
                    id: atual.id || id,
                    title: tituloAtual,
                    sku: skuAtual || 'Sem SKU',
                    status: atual.status,
                    sold_quantity: Number(atual.sold_quantity || 0)
                }
            });
        }

        let ultimoRetorno = atual;
        const alteracoes = [];

        // SKU é atualizado isoladamente. Assim uma restrição de título não
        // impede a alteração do SKU e não enviamos campos desnecessários.
        if (alterouSku) {
            const skuRes = await mlFetch(
                `${ML_API}/items/${encodeURIComponent(id)}`,
                token,
                {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        attributes: [
                            {
                                id: 'SELLER_SKU',
                                value_name: skuLimpo || null
                            }
                        ]
                    })
                }
            );

            const skuData = await jsonSeguro(skuRes);

            if (!skuRes.ok) {
                return respostaErro(
                    res,
                    skuRes.status || 400,
                    formatarErroMercadoLivre(skuData) || 'O Mercado Livre recusou a alteração do SKU.'
                );
            }

            ultimoRetorno = skuData;
            alteracoes.push('SKU');
        }

        // O Mercado Livre não permite alterar o título de um anúncio que já
        // possui vendas. Só tentamos o PUT de title quando ele realmente mudou.
        if (alterouTitulo) {
            if (Number(atual.sold_quantity || 0) > 0) {
                return res.status(409).json({
                    sucesso: false,
                    parcial: alterouSku,
                    sku_atualizado: alterouSku,
                    erro: alterouSku
                        ? 'O SKU foi atualizado, mas o Mercado Livre não permite alterar o título deste anúncio porque ele já possui vendas.'
                        : 'O Mercado Livre não permite alterar o título deste anúncio porque ele já possui vendas.',
                    item: {
                        id: atual.id || id,
                        title: tituloAtual,
                        sku: skuLimpo || skuAtual || 'Sem SKU',
                        status: atual.status,
                        sold_quantity: Number(atual.sold_quantity || 0)
                    }
                });
            }

            const tituloRes = await mlFetch(
                `${ML_API}/items/${encodeURIComponent(id)}`,
                token,
                {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({ title: tituloLimpo })
                }
            );

            const tituloData = await jsonSeguro(tituloRes);

            if (!tituloRes.ok) {
                return res.status(tituloRes.status || 400).json({
                    sucesso: false,
                    parcial: alterouSku,
                    sku_atualizado: alterouSku,
                    erro: (alterouSku ? 'O SKU foi atualizado, porém o título foi recusado pelo Mercado Livre: ' : '') +
                        (formatarErroMercadoLivre(tituloData) || 'Erro ao atualizar o título.'),
                    item: {
                        id: atual.id || id,
                        title: tituloAtual,
                        sku: skuLimpo || skuAtual || 'Sem SKU',
                        status: atual.status,
                        sold_quantity: Number(atual.sold_quantity || 0)
                    }
                });
            }

            ultimoRetorno = tituloData;
            alteracoes.push('título');
        }

        // Consulta novamente para devolver ao painel exatamente o que ficou
        // salvo no Mercado Livre.
        const finalRes = await mlFetch(
            `${ML_API}/items/${encodeURIComponent(id)}`,
            token
        );
        const finalData = await jsonSeguro(finalRes);
        const finalItem = finalRes.ok ? finalData : ultimoRetorno;

        const attrSkuFinal = Array.isArray(finalItem.attributes)
            ? finalItem.attributes.find(a => a.id === 'SELLER_SKU')
            : null;

        return res.json({
            sucesso: true,
            alterou: true,
            alteracoes,
            item: {
                id: finalItem.id || id,
                title: finalItem.title || tituloLimpo,
                sku: String(attrSkuFinal?.value_name ?? skuLimpo).trim() || 'Sem SKU',
                status: finalItem.status ?? atual.status,
                sold_quantity: Number(finalItem.sold_quantity ?? atual.sold_quantity ?? 0)
            }
        });

    } catch (error) {
        console.error('Erro ao atualizar título/SKU:', error);

        return respostaErro(
            res,
            500,
            'Erro de conexão ao atualizar anúncio: ' + error.message
        );
    }
});


/* =========================================================
   SERVIDOR
========================================================= */

app.listen(
    PORT,
    () => {
        console.log(
            `Servidor rodando na porta ${PORT}`
        );
    }
);
