const express = require('express');
const cors = require('cors');

const fetch = (...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json());


/* =========================================================
   FUNÇÃO PARA OBTER TOKEN
========================================================= */

function obterToken(req) {

    let token = req.headers['authorization'];

    if (token) {
        token = token.replace(/^Bearer\s+/i, '').trim();
    }

    if (!token) {
        token = process.env.ML_ACCESS_TOKEN || '';
    }

    return token.trim();
}


/* =========================================================
   FUNÇÃO AUXILIAR - MERCADO LIVRE
========================================================= */

async function mercadoLivreFetch(url, options = {}) {

    return fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {})
        }
    });
}


/* =========================================================
   ROTA PRINCIPAL
========================================================= */

app.get('/', (req, res) => {

    res.json({
        sucesso: true,
        mensagem: 'Servidor proxy do Mercado Livre online!'
    });
});


/* =========================================================
   AUTENTICAÇÃO MANUAL
   CLIENT ID / SECRET são recebidos apenas para compatibilidade.
   O Access Token é o que autentica a conta.
========================================================= */

app.post('/api/auth/start', async (req, res) => {

    try {

        const {
            client_id,
            client_secret,
            redirect_uri,
            access_token
        } = req.body || {};

        /*
         * Client ID, Client Secret e Redirect URI podem continuar
         * sendo informados pelo formulário, mas para conexão manual
         * precisamos de um Access Token válido.
         */

        if (!access_token) {

            return res.status(400).json({
                erro:
                    'Informe um Access Token válido para conectar manualmente.'
            });
        }


        const token = String(access_token).trim();


        const resposta = await mercadoLivreFetch(
            'https://api.mercadolibre.com/users/me',
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );


        let dados = {};

        try {
            dados = await resposta.json();
        } catch (e) {
            dados = {};
        }


        if (!resposta.ok || !dados.id) {

            return res.status(401).json({
                erro:
                    dados.message ||
                    'Access Token inválido ou expirado.'
            });
        }


        /*
         * Não salvamos Client Secret.
         * Também não colocamos o token em variável global,
         * pois isso poderia misturar contas de usuários diferentes.
         */

        return res.json({
            sucesso: true,
            autenticado: true,
            user_id: dados.id,
            nickname: dados.nickname || '',
            message:
                'Conta do Mercado Livre conectada com sucesso.'
        });

    } catch (erro) {

        console.error(
            'Erro em /api/auth/start:',
            erro
        );

        return res.status(500).json({
            erro:
                'Erro ao validar o Access Token: ' +
                erro.message
        });
    }
});


/* =========================================================
   STATUS DA AUTENTICAÇÃO
========================================================= */

app.get('/api/auth/status', async (req, res) => {

    const token = obterToken(req);


    if (!token) {

        return res.json({
            autenticado: false
        });
    }


    try {

        const resposta = await mercadoLivreFetch(
            'https://api.mercadolibre.com/users/me',
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );


        let dados = {};

        try {
            dados = await resposta.json();
        } catch (e) {
            dados = {};
        }


        if (!resposta.ok || !dados.id) {

            return res.json({
                autenticado: false
            });
        }


        return res.json({
            autenticado: true,
            user_id: dados.id,
            nickname: dados.nickname || ''
        });

    } catch (erro) {

        console.error(
            'Erro verificando autenticação:',
            erro
        );

        return res.json({
            autenticado: false
        });
    }
});


/* =========================================================
   LOGOUT
========================================================= */

app.post('/api/auth/logout', (req, res) => {

    /*
     * Como o token fica somente no sessionStorage do navegador,
     * não existe sessão de servidor para destruir.
     */

    res.json({
        sucesso: true,
        mensagem: 'Desconectado com sucesso.'
    });
});


/* =========================================================
   CALCULAR FRETE EXATO
========================================================= */

async function calcularFreteExato(itemObj, token) {

    const shipping = itemObj.shipping || {};

    const freeShipping =
        shipping.free_shipping || false;

    let custoEnvio = 6.85;


    if (freeShipping) {

        try {

            const saleFeeRes = await mercadoLivreFetch(
                `https://api.mercadolibre.com/items/${itemObj.id}/sale_fee?price=${itemObj.price || 0}&listing_type_id=${itemObj.listing_type_id || 'gold_special'}`,
                {
                    headers: {
                        Authorization:
                            'Bearer ' + token
                    }
                }
            );


            if (saleFeeRes.ok) {

                const saleFeeData =
                    await saleFeeRes.json();


                if (
                    saleFeeData.sale_fee_details &&
                    saleFeeData.sale_fee_details.shipping_fee !== undefined
                ) {

                    return Number(
                        saleFeeData
                            .sale_fee_details
                            .shipping_fee
                    ) || 0;
                }
            }

        } catch (e) {

            console.error(
                'Erro consultando sale_fee:',
                e.message
            );
        }


        if (
            shipping.costs &&
            Array.isArray(shipping.costs) &&
            shipping.costs.length > 0
        ) {

            const cObj =
                shipping.costs.find(
                    c => c.cost !== undefined
                );


            if (cObj) {
                return Number(cObj.cost) || 0;
            }
        }


        custoEnvio = 12.95;

    } else {

        if (
            shipping.costs &&
            Array.isArray(shipping.costs) &&
            shipping.costs.length > 0
        ) {

            const cObj =
                shipping.costs.find(
                    c => c.cost !== undefined
                );


            if (cObj) {
                custoEnvio = Number(cObj.cost) || 0;
            }
        }
    }


    return custoEnvio;
}


/* =========================================================
   1. BUSCAR TODOS OS ANÚNCIOS
========================================================= */

app.get('/api/anuncios', async (req, res) => {

    const token = obterToken(req);


    if (!token) {

        return res.status(401).json({
            erro:
                'Token não fornecido. Informe o Access Token.'
        });
    }


    const existingIdsParam =
        req.query.existingIds;


    const existingIdsSet =
        new Set(
            existingIdsParam
                ? existingIdsParam.split(',')
                : []
        );


    const isAppendMode =
        existingIdsSet.size > 0;


    try {

        const userRes = await mercadoLivreFetch(
            'https://api.mercadolibre.com/users/me',
            {
                headers: {
                    Authorization:
                        'Bearer ' + token
                }
            }
        );


        const userData =
            await userRes.json();


        if (!userRes.ok || !userData.id) {

            return res.status(401).json({
                erro:
                    'Token inválido ou expirado.'
            });
        }


        let allIds = [];

        let scrollId = null;

        let hasMore = true;


        while (hasMore) {

            let url =
                `https://api.mercadolibre.com/users/${userData.id}/items/search?search_type=scan&limit=50`;


            if (scrollId) {
                url += `&scroll_id=${scrollId}`;
            }


            const searchRes =
                await mercadoLivreFetch(
                    url,
                    {
                        headers: {
                            Authorization:
                                'Bearer ' + token
                        }
                    }
                );


            const searchData =
                await searchRes.json();


            if (!searchRes.ok) {

                return res.status(400).json({
                    erro:
                        searchData.message ||
                        'Erro ao consultar anúncios.'
                });
            }


            const results =
                searchData.results || [];


            if (results.length > 0) {
                allIds = allIds.concat(results);
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
                    id =>
                        !existingIdsSet.has(id)
                );


            if (targetIds.length === 0) {

                return res.json({
                    itens: [],
                    mensagem:
                        'Nenhum anúncio novo encontrado.'
                });
            }
        }


        const listaFinal = [];


        for (
            let i = 0;
            i < targetIds.length;
            i += 20
        ) {

            const chunk =
                targetIds.slice(i, i + 20);


            try {

                const multiRes =
                    await mercadoLivreFetch(
                        `https://api.mercadolibre.com/items?ids=${chunk.join(',')}`,
                        {
                            headers: {
                                Authorization:
                                    'Bearer ' + token
                            }
                        }
                    );


                const multiData =
                    await multiRes.json();


                const itensArray =
                    Array.isArray(multiData)
                        ? multiData
                        : [];


                for (const itemObj of itensArray) {

                    if (
                        !itemObj ||
                        itemObj.code !== 200 ||
                        !itemObj.body
                    ) {
                        continue;
                    }


                    const body = itemObj.body;

                    const idItem =
                        body.id;

                    const preco =
                        Number(body.price) || 0;

                    const listingType =
                        body.listing_type_id ||
                        'gold_special';

                    const availableQty =
                        Number(body.available_quantity) || 0;

                    const title =
                        body.title ||
                        'Sem Título';

                    const permalink =
                        body.permalink ||
                        '#';

                    const thumbnail =
                        body.thumbnail ||
                        '';


                    let sku = 'Sem SKU';


                    if (Array.isArray(body.attributes)) {

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


                    const comissao =
                        Number(body.sale_fee) ||
                        (
                            listingType === 'gold_pro'
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


                    /*
                     * Retornamos os nomes originais da API
                     * e também os nomes usados pelo seu HTML.
                     */

                    listaFinal.push({

                        id: idItem,

                        title: title,
                        titulo: title,

                        price: preco,
                        preco: preco,

                        status: status,

                        listing_type_id:
                            listingType,

                        available_quantity:
                            availableQty,

                        sku: sku,

                        permalink:
                            permalink,

                        thumbnail:
                            thumbnail,

                        sale_fee:
                            comissao,

                        comissao:
                            comissao,

                        shipping_cost:
                            custoEnvio,

                        frete:
                            custoEnvio,

                        free_shipping:
                            freeShipping,

                        net_received:
                            liquido,

                        liquido:
                            liquido
                    });
                }

            } catch (chunkErr) {

                console.error(
                    'Erro ao buscar lote de IDs:',
                    chunkErr
                );
            }
        }


        return res.json({
            itens: listaFinal
        });


    } catch (e) {

        console.error(e);

        return res.status(500).json({
            erro:
                'Erro ao processar dados da API: ' +
                e.message
        });
    }
});


/* =========================================================
   2. SINCRONIZAR PREÇOS
========================================================= */

app.post('/api/sincronizar-precos', async (req, res) => {

    const token = obterToken(req);


    if (!token) {

        return res.status(401).json({
            erro: 'Token não fornecido.'
        });
    }


    const { ids } = req.body;


    if (
        !Array.isArray(ids) ||
        ids.length === 0
    ) {

        return res.status(400).json({
            erro: 'Lista de IDs inválida.'
        });
    }


    const precosMap = {};


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
                await mercadoLivreFetch(
                    `https://api.mercadolibre.com/items?ids=${blocoIds}`,
                    {
                        headers: {
                            Authorization:
                                'Bearer ' + token
                        }
                    }
                );


            const multiData =
                await multiRes.json();


            if (Array.isArray(multiData)) {

                multiData.forEach(itemObj => {

                    if (
                        itemObj.code === 200 &&
                        itemObj.body
                    ) {

                        precosMap[itemObj.body.id] =
                            itemObj.body.price;
                    }

                });
            }
        }


        return res.json({
            precos: precosMap
        });


    } catch (e) {

        return res.status(500).json({
            erro:
                'Erro ao buscar preços: ' +
                e.message
        });
    }
});


/* =========================================================
   3. SINCRONIZAR FRETES
========================================================= */

app.post('/api/sincronizar-fretes', async (req, res) => {

    const token = obterToken(req);


    if (!token) {

        return res.status(401).json({
            erro: 'Token não fornecido.'
        });
    }


    const { ids } = req.body;


    if (
        !Array.isArray(ids) ||
        ids.length === 0
    ) {

        return res.status(400).json({
            erro: 'Lista de IDs inválida.'
        });
    }


    const fretesMap = {};


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
                await mercadoLivreFetch(
                    `https://api.mercadolibre.com/items?ids=${blocoIds}`,
                    {
                        headers: {
                            Authorization:
                                'Bearer ' + token
                        }
                    }
                );


            const multiData =
                await multiRes.json();


            if (!Array.isArray(multiData)) {
                continue;
            }


            for (const itemObj of multiData) {

                if (
                    itemObj.code !== 200 ||
                    !itemObj.body
                ) {
                    continue;
                }


                const body =
                    itemObj.body;


                const freeShipping =
                    Boolean(
                        body.shipping &&
                        body.shipping.free_shipping
                    );


                const custoEnvio =
                    await calcularFreteExato(
                        body,
                        token
                    );


                fretesMap[body.id] = {

                    custo: custoEnvio,

                    shipping_cost:
                        custoEnvio,

                    gratis:
                        freeShipping,

                    free_shipping:
                        freeShipping
                };
            }
        }


        return res.json({
            fretes: fretesMap
        });


    } catch (e) {

        return res.status(500).json({
            erro:
                'Erro ao buscar fretes: ' +
                e.message
        });
    }
});


/* =========================================================
   4. ATUALIZAÇÃO INDIVIDUAL
========================================================= */

app.post('/api/atualizar-preco', async (req, res) => {

    const token = obterToken(req);


    if (!token) {

        return res.status(401).json({
            erro: 'Token não fornecido.'
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
                'ID ou preço não informados.'
        });
    }


    try {

        const mlRes =
            await mercadoLivreFetch(
                `https://api.mercadolibre.com/items/${id}`,
                {
                    method: 'PUT',

                    headers: {
                        Authorization:
                            'Bearer ' + token,

                        'Content-Type':
                            'application/json'
                    },

                    body: JSON.stringify({
                        price:
                            Number(price)
                    })
                }
            );


        const mlData =
            await mlRes.json();


        if (mlRes.ok) {

            return res.json({
                sucesso: true,
                resultado: mlData
            });
        }


        const mensagemErro =
            mlData.message ||
            (
                mlData.cause &&
                mlData.cause[0] &&
                mlData.cause[0].message
            ) ||
            JSON.stringify(mlData);


        return res.status(400).json({
            erro: mensagemErro
        });


    } catch (e) {

        return res.status(500).json({
            erro:
                'Erro de conexão ao atualizar preço: ' +
                e.message
        });
    }
});


/* =========================================================
   5. ATUALIZAÇÃO EM LOTE
========================================================= */

app.post('/api/atualizar-precos', async (req, res) => {

    const token = obterToken(req);


    if (!token) {

        return res.status(401).json({
            erro: 'Token não fornecido.'
        });
    }


    const { itens } = req.body;


    if (
        !Array.isArray(itens) ||
        itens.length === 0
    ) {

        return res.status(400).json({
            erro:
                'Nenhum item informado para atualização em lote.'
        });
    }


    try {

        const promises =
            itens.map(async item => {

                try {

                    const mlRes =
                        await mercadoLivreFetch(
                            `https://api.mercadolibre.com/items/${item.id}`,
                            {
                                method: 'PUT',

                                headers: {
                                    Authorization:
                                        'Bearer ' + token,

                                    'Content-Type':
                                        'application/json'
                                },

                                body: JSON.stringify({
                                    price:
                                        Number(item.preco)
                                })
                            }
                        );


                    const mlData =
                        await mlRes.json();


                    if (mlRes.ok) {

                        return {
                            id: item.id,
                            sucesso: true
                        };
                    }


                    const mensagemErro =
                        mlData.message ||
                        (
                            mlData.cause &&
                            mlData.cause[0] &&
                            mlData.cause[0].message
                        ) ||
                        JSON.stringify(mlData);


                    return {
                        id: item.id,
                        sucesso: false,
                        erro: mensagemErro
                    };


                } catch (err) {

                    return {
                        id: item.id,
                        sucesso: false,
                        erro:
                            'Erro de conexão: ' +
                            err.message
                    };
                }
            });


        const resultados =
            await Promise.all(promises);


        return res.json({
            resultados
        });


    } catch (e) {

        return res.status(500).json({
            erro:
                'Erro no servidor ao processar lote: ' +
                e.message
        });
    }
});


/* =========================================================
   SERVIDOR
========================================================= */

const PORT =
    process.env.PORT || 3000;


app.listen(PORT, () => {

    console.log(
        `Servidor rodando na porta ${PORT}`
    );
});
