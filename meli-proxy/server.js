
'use strict';

/*
===========================================================
 ML HUB PRO
 Backend Mercado Livre
 Node.js 18+
===========================================================
*/

const express = require('express');
const cors = require('cors');

const app = express();

/*
===========================================================
 CONFIGURAÇÃO
===========================================================
*/

const PORT = process.env.PORT || 10000;

const ML_API = 'https://api.mercadolibre.com';
const ML_SITE = 'MLB';

/*
===========================================================
 MIDDLEWARES
===========================================================
*/

app.use(cors({
    origin: '*',
    methods: [
        'GET',
        'POST',
        'PUT',
        'PATCH',
        'DELETE',
        'OPTIONS'
    ],
    allowedHeaders: [
        'Content-Type',
        'Authorization'
    ]
}));

app.use(express.json({
    limit: '5mb'
}));

app.use(express.urlencoded({
    extended: true
}));

/*
===========================================================
 FUNÇÕES AUXILIARES
===========================================================
*/

/**
 * Obtém o token enviado pelo frontend.
 *
 * Aceita:
 * Authorization: Bearer TOKEN
 *
 * ou:
 * Authorization: TOKEN
 */
function requireToken(req, res) {

    const authorization =
        req.headers.authorization || '';

    if (!authorization) {

        res.status(401).json({
            erro:
                'Token do Mercado Livre não informado.'
        });

        return null;
    }

    let token =
        String(authorization).trim();

    if (
        token
            .toLowerCase()
            .startsWith('bearer ')
    ) {

        token =
            token
                .substring(7)
                .trim();
    }

    if (!token) {

        res.status(401).json({
            erro:
                'Token do Mercado Livre inválido.'
        });

        return null;
    }

    return token;
}


/**
 * Faz uma chamada para a API do Mercado Livre.
 */
async function mlFetch(
    path,
    token,
    options = {}
) {

    const headers = {
        Accept: 'application/json',

        Authorization:
            `Bearer ${token}`,

        ...(options.headers || {})
    };

    const response =
        await fetch(
            `${ML_API}${path}`,
            {
                ...options,
                headers
            }
        );

    let data = null;

    try {

        data =
            await response.json();

    } catch {

        data = null;
    }

    return {
        response,
        data
    };
}


/**
 * Arredondamento monetário.
 */
function money(value) {

    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {
        return 0;
    }

    return Number(
        number.toFixed(2)
    );
}


/**
 * Converte qualquer valor para número seguro.
 */
function number(value) {

    const result =
        Number(value);

    return Number.isFinite(result)
        ? result
        : 0;
}


/**
 * Divide array em lotes.
 */
function chunks(
    array,
    size
) {

    const result = [];

    for (
        let i = 0;
        i < array.length;
        i += size
    ) {

        result.push(
            array.slice(
                i,
                i + size
            )
        );
    }

    return result;
}


/**
 * Mensagem de erro amigável do ML.
 */
function mercadoLivreError(
    result,
    fallback
) {

    return (
        result?.data?.message ||
        result?.data?.error_description ||
        result?.data?.error ||
        fallback
    );
}


/*
===========================================================
 ROTA PRINCIPAL
===========================================================
*/

app.get('/', (req, res) => {

    res.json({
        ok: true,
        message:
            'ML Hub Pro API online',
        version:
            '3.0.0',
        timestamp:
            new Date().toISOString()
    });
});


/*
===========================================================
 HEALTH CHECK
===========================================================
*/

app.get('/health', (req, res) => {

    res.json({
        ok: true,
        status: 'online',
        service: 'ML Hub Pro',
        timestamp:
            new Date().toISOString()
    });
});


/*
===========================================================
 /api/me
===========================================================
*/

app.get('/api/me', async (req, res) => {

    const token =
        requireToken(req, res);

    if (!token) return;

    try {

        const result =
            await mlFetch(
                '/users/me',
                token
            );

        if (!result.response.ok) {

            return res.status(
                result.response.status
            ).json({
                erro:
                    mercadoLivreError(
                        result,
                        'Não foi possível consultar o usuário.'
                    )
            });
        }

        return res.json(
            result.data
        );

    } catch (e) {

        console.error(
            'Erro /api/me:',
            e
        );

        return res.status(500).json({
            erro:
                'Erro ao consultar usuário: ' +
                e.message
        });
    }
});


/*
===========================================================
 BUSCAR IDs DOS ANÚNCIOS
===========================================================
*/

async function buscarIdsAnuncios(
    sellerId,
    token
) {

    const ids = [];

    let offset = 0;

    const limit = 100;

    /*
     * O endpoint suporta paginação.
     * Para o dashboard do ML Hub Pro,
     * buscamos anúncios ativos.
     */
    while (true) {

        const params =
            new URLSearchParams({
                status: 'active',
                limit: String(limit),
                offset: String(offset)
            });

        const result =
            await mlFetch(
                `/users/${sellerId}/items/search?${params.toString()}`,
                token
            );

        if (!result.response.ok) {

            const error =
                new Error(
                    mercadoLivreError(
                        result,
                        'Erro ao buscar anúncios.'
                    )
                );

            error.status =
                result.response.status;

            error.data =
                result.data;

            throw error;
        }

        const results =
            Array.isArray(
                result.data?.results
            )
                ? result.data.results
                : [];

        ids.push(
            ...results
        );

        const total =
            Number(
                result.data?.paging?.total || 0
            );

        offset +=
            results.length;

        if (
            results.length === 0 ||
            results.length < limit ||
            offset >= total ||
            offset >= 1000
        ) {
            break;
        }
    }

    return ids;
}


/*
===========================================================
 BUSCAR DETALHES DOS ITENS
===========================================================
*/

async function buscarItens(
    ids,
    token
) {

    if (!ids.length) {
        return [];
    }

    const resultado = [];

    /*
     * /items/bulk é a opção atual recomendada
     * para consultas múltiplas.
     */
    const lotes =
        chunks(ids, 20);

    for (const lote of lotes) {

        const params =
            new URLSearchParams({
                ids: lote.join(',')
            });

        const result =
            await mlFetch(
                `/items/bulk?${params.toString()}`,
                token
            );

        /*
         * Alguns ambientes podem ainda retornar
         * erro no endpoint novo. Tentamos o endpoint
         * antigo como fallback durante a migração.
         */
        if (!result.response.ok) {

            const fallback =
                await mlFetch(
                    `/items?${params.toString()}`,
                    token
                );

            if (!fallback.response.ok) {

                const error =
                    new Error(
                        mercadoLivreError(
                            result,
                            'Erro ao consultar anúncios.'
                        )
                    );

                error.status =
                    result.response.status;

                error.data =
                    result.data;

                throw error;
            }

            if (
                Array.isArray(
                    fallback.data
                )
            ) {

                for (
                    const item
                    of fallback.data
                ) {

                    if (
                        item?.body
                    ) {

                        resultado.push(
                            item.body
                        );
                    }
                }
            }

            continue;
        }

        if (
            Array.isArray(
                result.data
            )
        ) {

            for (
                const item
                of result.data
            ) {

                /*
                 * /items/bulk pode retornar:
                 *
                 * {
                 *   id,
                 *   code,
                 *   body
                 * }
                 */

                if (
                    item?.body
                ) {

                    resultado.push(
                        item.body
                    );

                } else if (
                    item?.id
                ) {

                    /*
                     * Segurança caso o formato
                     * venha diretamente.
                     */

                    resultado.push(
                        item
                    );
                }
            }
        }
    }

    return resultado;
}


/*
===========================================================
 BUSCAR COMISSÃO DO ANÚNCIO
===========================================================
*/

async function buscarComissao(
    item,
    token
) {

    try {

        const params =
            new URLSearchParams();

        params.set(
            'price',
            String(
                number(item.price)
            )
        );

        if (
            item.listing_type_id
        ) {

            params.set(
                'listing_type_id',
                item.listing_type_id
            );
        }

        if (
            item.category_id
        ) {

            params.set(
                'category_id',
                item.category_id
            );
        }

        const result =
            await mlFetch(
                `/sites/${ML_SITE}/listing_prices?${params.toString()}`,
                token
            );

        if (
            !result.response.ok
        ) {

            return {
                saleFee: 0,
                listingFee: 0
            };
        }

        const data =
            Array.isArray(
                result.data
            )
                ? result.data
                : [result.data];

        let selected =
            data.find(
                itemPrice =>
                    itemPrice?.listing_type_id ===
                    item.listing_type_id
            );

        if (!selected) {
            selected =
                data[0];
        }

        return {

            saleFee:
                number(
                    selected?.sale_fee_amount
                ),

            listingFee:
                number(
                    selected?.listing_fee_amount
                )
        };

    } catch (e) {

        console.error(
            'Erro ao calcular comissão:',
            e.message
        );

        return {
            saleFee: 0,
            listingFee: 0
        };
    }
}


/*
===========================================================
 /api/anuncios
===========================================================
*/

app.get('/api/anuncios', async (req, res) => {

    const token =
        requireToken(req, res);

    if (!token) return;

    try {

        /*
         * 1. Usuário
         */
        const userResult =
            await mlFetch(
                '/users/me',
                token
            );

        if (
            !userResult.response.ok ||
            !userResult.data?.id
        ) {

            return res.status(401).json({
                erro:
                    'Token inválido ou expirado.'
            });
        }

        const sellerId =
            userResult.data.id;

        /*
         * 2. IDs
         */
        const ids =
            await buscarIdsAnuncios(
                sellerId,
                token
            );

        /*
         * 3. Detalhes
         */
        const itens =
            await buscarItens(
                ids,
                token
            );

        /*
         * 4. Monta resposta
         */
        const resposta = [];

        for (
            const item
            of itens
        ) {

            const price =
                number(item.price);

            const shipping =
                item.shipping || {};

            const freeShipping =
                Boolean(
                    shipping.free_shipping
                );

            const shippingCost =
                number(
                    shipping.cost
                );

            /*
             * Comissão
             */
            const comissao =
                await buscarComissao(
                    item,
                    token
                );

            const saleFee =
                comissao.saleFee;

            /*
             * Valor líquido estimado.
             */
            const netReceived =
                Math.max(
                    0,
                    price -
                    saleFee -
                    shippingCost
                );

            resposta.push({

                id:
                    item.id,

                title:
                    item.title ||
                    'Sem título',

                sku:
                    item.seller_custom_field ||
                    item.seller_sku ||
                    null,

                price:
                    money(price),

                sale_fee:
                    money(saleFee),

                shipping_cost:
                    money(shippingCost),

                net_received:
                    money(netReceived),

                available_quantity:
                    number(
                        item.available_quantity
                    ),

                status:
                    item.status ||
                    null,

                listing_type_id:
                    item.listing_type_id ||
                    null,

                listing_type_name:
                    item.listing_type_name ||
                    null,

                category_id:
                    item.category_id ||
                    null,

                thumbnail:
                    item.thumbnail ||
                    null,

                permalink:
                    item.permalink ||
                    null,

                free_shipping:
                    freeShipping,

                logistic_type:
                    shipping.logistic_type ||
                    null
            });
        }

        return res.json({

            ok: true,

            total:
                resposta.length,

            itens:
                resposta,

            ultima_atualizacao:
                new Date().toISOString()
        });

    } catch (e) {

        console.error(
            'Erro /api/anuncios:',
            e
        );

        return res.status(
            e.status || 500
        ).json({
            erro:
                e.message ||
                'Erro ao carregar anúncios.'
        });
    }
});


/*
===========================================================
 /api/sincronizar-precos
===========================================================
*/

app.post(
    '/api/sincronizar-precos',
    async (req, res) => {

        const token =
            requireToken(req, res);

        if (!token) return;

        try {

            const precosSolicitados =
                req.body?.precos || {};

            const ids =
                Object.keys(
                    precosSolicitados
                );

            if (!ids.length) {

                return res.json({
                    ok: true,
                    precos: {}
                });
            }

            const itens =
                await buscarItens(
                    ids,
                    token
                );

            const precos = {};

            for (
                const item
                of itens
            ) {

                if (item?.id) {

                    precos[
                        String(item.id)
                    ] =
                        money(
                            item.price
                        );
                }
            }

            return res.json({

                ok: true,

                precos
            });

        } catch (e) {

            console.error(
                'Erro sincronizar preços:',
                e
            );

            return res.status(
                e.status || 500
            ).json({
                erro:
                    e.message ||
                    'Erro ao sincronizar preços.'
            });
        }
    }
);


/*
===========================================================
 /api/sincronizar-fretes
===========================================================
*/

app.post(
    '/api/sincronizar-fretes',
    async (req, res) => {

        const token =
            requireToken(req, res);

        if (!token) return;

        try {

            const fretesSolicitados =
                req.body?.fretes || {};

            const ids =
                Object.keys(
                    fretesSolicitados
                );

            if (!ids.length) {

                return res.json({
                    ok: true,
                    fretes: {}
                });
            }

            const itens =
                await buscarItens(
                    ids,
                    token
                );

            const fretes = {};

            for (
                const item
                of itens
            ) {

                if (!item?.id) {
                    continue;
                }

                const shipping =
                    item.shipping || {};

                fretes[
                    String(item.id)
                ] = {

                    custo:
                        money(
                            shipping.cost
                        ),

                    gratis:
                        Boolean(
                            shipping.free_shipping
                        ),

                    logistic_type:
                        shipping.logistic_type ||
                        null
                };
            }

            return res.json({

                ok: true,

                fretes
            });

        } catch (e) {

            console.error(
                'Erro sincronizar fretes:',
                e
            );

            return res.status(
                e.status || 500
            ).json({
                erro:
                    e.message ||
                    'Erro ao sincronizar fretes.'
            });
        }
    }
);


/*
===========================================================
 /api/atualizar-precos
===========================================================
*/

app.post(
    '/api/atualizar-precos',
    async (req, res) => {

        const token =
            requireToken(req, res);

        if (!token) return;

        try {

            const itens =
                Array.isArray(
                    req.body?.itens
                )
                    ? req.body.itens
                    : [];

            if (!itens.length) {

                return res.status(400).json({
                    erro:
                        'Nenhum item informado para atualização.'
                });
            }

            const resultados = [];

            /*
             * O frontend já envia lotes de até 20.
             */
            for (
                const item
                of itens
            ) {

                const id =
                    String(
                        item?.id || ''
                    ).trim();

                const price =
                    number(
                        item?.price
                    );

                if (!id) {

                    resultados.push({

                        id: null,

                        ok: false,

                        erro:
                            'ID do anúncio não informado.'
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
                            'Preço inválido.'
                    });

                    continue;
                }

                try {

                    const result =
                        await mlFetch(
                            `/items/${encodeURIComponent(id)}`,
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
                                            money(price)
                                    })
                            }
                        );

                    if (
                        !result.response.ok
                    ) {

                        resultados.push({

                            id,

                            ok: false,

                            erro:
                                mercadoLivreError(
                                    result,
                                    'Mercado Livre recusou a atualização.'
                                ),

                            status:
                                result.response.status
                        });

                        continue;
                    }

                    resultados.push({

                        id,

                        ok: true,

                        price:
                            money(
                                result.data?.price ??
                                price
                            )
                    });

                } catch (e) {

                    resultados.push({

                        id,

                        ok: false,

                        erro:
                            e.message ||
                            'Erro ao atualizar anúncio.'
                    });
                }
            }

            const sucesso =
                resultados.filter(
                    item => item.ok
                ).length;

            const falhas =
                resultados.length -
                sucesso;

            /*
             * Se tudo deu errado, retorna erro HTTP.
             */
            if (
                sucesso === 0 &&
                resultados.length > 0
            ) {

                return res.status(400).json({

                    ok: false,

                    sucesso: 0,

                    falhas,

                    resultados,

                    erro:
                        'Nenhum anúncio foi atualizado.'
                });
            }

            return res.json({

                ok:
                    falhas === 0,

                sucesso,

                falhas,

                resultados
            });

        } catch (e) {

            console.error(
                'Erro /api/atualizar-precos:',
                e
            );

            return res.status(500).json({
                erro:
                    'Erro ao atualizar preços: ' +
                    e.message
            });
        }
    }
);


/*
===========================================================
 /api/dashboard
===========================================================
*/

app.get(
    '/api/dashboard',
    async (req, res) => {

        const token =
            requireToken(req, res);

        if (!token) return;

        try {

            /*
             * =================================================
             * 1. USUÁRIO
             * =================================================
             */

            const userResult =
                await mlFetch(
                    '/users/me',
                    token
                );

            if (
                !userResult.response.ok ||
                !userResult.data?.id
            ) {

                return res.status(401).json({
                    erro:
                        'Token inválido ou expirado.'
                });
            }

            const sellerId =
                userResult.data.id;

            /*
             * =================================================
             * 2. ÚLTIMOS 60 DIAS
             * =================================================
             */

            const agora =
                new Date();

            const inicio =
                new Date(
                    agora.getTime() -
                    60 *
                    24 *
                    60 *
                    60 *
                    1000
                );

            /*
             * Map evita pedidos duplicados.
             */
            const ordersMap =
                new Map();

            /*
             * =================================================
             * 3. BUSCA PEDIDOS EM BLOCOS DE 15 DIAS
             * =================================================
             */

            let cursor =
                new Date(inicio);

            while (
                cursor < agora
            ) {

                const fim =
                    new Date(
                        Math.min(
                            cursor.getTime() +
                            15 *
                            24 *
                            60 *
                            60 *
                            1000,

                            agora.getTime()
                        )
                    );

                let offset = 0;

                while (true) {

                    const params =
                        new URLSearchParams();

                    params.set(
                        'seller',
                        String(sellerId)
                    );

                    params.set(
                        'order.status',
                        'paid'
                    );

                    params.set(
                        'order.date_created.from',
                        cursor.toISOString()
                    );

                    params.set(
                        'order.date_created.to',
                        fim.toISOString()
                    );

                    params.set(
                        'sort',
                        'date_desc'
                    );

                    params.set(
                        'limit',
                        '50'
                    );

                    params.set(
                        'offset',
                        String(offset)
                    );

                    const result =
                        await mlFetch(
                            `/orders/search?${params.toString()}`,
                            token
                        );

                    if (
                        !result.response.ok
                    ) {

                        console.error(
                            'Erro /orders/search:',
                            result.data
                        );

                        return res.status(
                            result.response.status
                        ).json({

                            erro:
                                mercadoLivreError(
                                    result,
                                    'Erro ao consultar vendas.'
                                )
                        });
                    }

                    const orders =
                        Array.isArray(
                            result.data?.results
                        )
                            ? result.data.results
                            : [];

                    if (
                        !orders.length
                    ) {
                        break;
                    }

                    /*
                     * Guarda pedidos sem duplicação.
                     */
                    for (
                        const order
                        of orders
                    ) {

                        if (
                            order?.id !==
                            undefined &&
                            order?.id !==
                            null
                        ) {

                            ordersMap.set(
                                String(order.id),
                                order
                            );
                        }
                    }

                    offset +=
                        orders.length;

                    const total =
                        Number(
                            result.data?.paging?.total ||
                            0
                        );

                    if (
                        orders.length < 50 ||
                        (
                            total > 0 &&
                            offset >= total
                        ) ||
                        offset >= 10000
                    ) {
                        break;
                    }
                }

                cursor =
                    fim;
            }

            /*
             * =================================================
             * 4. CONVERTE PEDIDOS
             * =================================================
             */

            const orders =
                Array.from(
                    ordersMap.values()
                );

            /*
             * =================================================
             * 5. MÉTRICAS
             * =================================================
             */

            let faturamento = 0;

            let unidades = 0;

            const produtos =
                new Map();

            const dias =
                new Map();

            /*
             * =================================================
             * 6. PROCESSA PEDIDOS
             * =================================================
             */

            for (
                const order
                of orders
            ) {

                /*
                 * Faturamento
                 */
                const valorPedido =
                    number(
                        order.total_amount ??
                        order.paid_amount ??
                        0
                    );

                faturamento +=
                    valorPedido;

                /*
                 * Dia
                 */
                const dataPedido =
                    order.date_created
                        ? new Date(
                            order.date_created
                        )
                        : null;

                if (
                    dataPedido &&
                    !Number.isNaN(
                        dataPedido.getTime()
                    )
                ) {

                    const dia =
                        dataPedido
                            .toISOString()
                            .slice(0, 10);

                    dias.set(
                        dia,
                        (
                            dias.get(dia) ||
                            0
                        ) + 1
                    );
                }

                /*
                 * Produtos
                 */
                const orderItems =
                    Array.isArray(
                        order.order_items
                    )
                        ? order.order_items
                        : [];

                for (
                    const orderItem
                    of orderItems
                ) {

                    const item =
                        orderItem?.item ||
                        {};

                    const id =
                        item.id
                            ? String(
                                item.id
                            )
                            : 'SEM_ID';

                    const quantidade =
                        number(
                            orderItem.quantity ||
                            1
                        );

                    const preco =
                        number(
                            orderItem.unit_price ||
                            0
                        );

                    if (
                        !produtos.has(id)
                    ) {

                        produtos.set(
                            id,
                            {

                                id,

                                title:
                                    item.title ||
                                    'Produto sem título',

                                sku:
                                    item.seller_custom_field ||
                                    null,

                                sales: 0,

                                revenue: 0,

                                orders: 0
                            }
                        );
                    }

                    const produto =
                        produtos.get(id);

                    produto.sales +=
                        quantidade;

                    produto.revenue +=
                        preco *
                        quantidade;

                    produto.orders +=
                        1;

                    unidades +=
                        quantidade;
                }
            }

            /*
             * =================================================
             * 7. TOP 10
             * =================================================
             */

            const top10 =
                Array.from(
                    produtos.values()
                )
                .sort(
                    (a, b) => {

                        if (
                            b.sales !==
                            a.sales
                        ) {

                            return (
                                b.sales -
                                a.sales
                            );
                        }

                        return (
                            b.revenue -
                            a.revenue
                        );
                    }
                )
                .slice(0, 10)
                .map(item => ({

                    id:
                        item.id,

                    title:
                        item.title,

                    sku:
                        item.sku,

                    sales:
                        Math.round(
                            item.sales
                        ),

                    revenue:
                        money(
                            item.revenue
                        ),

                    orders:
                        Math.round(
                            item.orders
                        )
                }));

            /*
             * =================================================
             * 8. GRÁFICO 60 DIAS
             * =================================================
             */

            const series = [];

            for (
                let i = 59;
                i >= 0;
                i--
            ) {

                const data =
                    new Date(
                        agora.getTime() -
                        i *
                        24 *
                        60 *
                        60 *
                        1000
                    );

                const dia =
                    data
                        .toISOString()
                        .slice(0, 10);

                series.push({

                    date:
                        dia,

                    value:
                        Number(
                            dias.get(dia) ||
                            0
                        )
                });
            }

            /*
             * =================================================
             * 9. TOTAIS
             * =================================================
             */

            const pedidos =
                orders.length;

            const ticket =
                pedidos > 0
                    ? faturamento /
                      pedidos
                    : 0;

            /*
             * =================================================
             * 10. RESPOSTA
             * =================================================
             */

            return res.json({

                ok: true,

                periodo_dias:
                    60,

                total_pedidos:
                    pedidos,

                vendas_60_dias:
                    pedidos,

                total_unidades:
                    Math.round(
                        unidades
                    ),

                faturamento_60_dias:
                    money(
                        faturamento
                    ),

                ticket_medio:
                    money(
                        ticket
                    ),

                top_10:
                    top10,

                series_60_dias:
                    series,

                ultima_atualizacao:
                    new Date()
                        .toISOString()
            });

        } catch (e) {

            console.error(
                'Erro dashboard:',
                e
            );

            return res.status(500).json({

                erro:
                    'Erro ao montar dashboard: ' +
                    (
                        e?.message ||
                        'erro desconhecido'
                    )
            });
        }
    }
);


/*
===========================================================
 TRATAMENTO DE ROTA NÃO ENCONTRADA
===========================================================
*/

app.use(
    (req, res) => {

        res.status(404).json({

            erro:
                'Rota não encontrada.',

            path:
                req.originalUrl
        });
    }
);


/*
===========================================================
 TRATAMENTO GLOBAL DE ERROS
===========================================================
*/

app.use(
    (
        err,
        req,
        res,
        next
    ) => {

        console.error(
            'Erro global:',
            err
        );

        if (
            res.headersSent
        ) {
            return next(err);
        }

        return res.status(500).json({

            erro:
                err?.message ||
                'Erro interno do servidor.'
        });
    }
);


/*
===========================================================
 INICIA SERVIDOR
===========================================================
*/

app.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log(
            '=========================================='
        );

        console.log(
            'ML Hub Pro API online'
        );

        console.log(
            `Porta: ${PORT}`
        );

        console.log(
            `Mercado Livre: ${ML_API}`
        );

        console.log(
            `Site: ${ML_SITE}`
        );

        console.log(
            '=========================================='
        );
    }
);

