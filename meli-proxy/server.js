const express = require('express');
const cors = require('cors');
const fetch = (...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();

app.use(cors());
app.use(express.json());

/* =========================================================
   CONFIGURAÇÃO
========================================================= */

const PORT = process.env.PORT || 3000;

/* =========================================================
   FUNÇÕES AUXILIARES
========================================================= */

// Aceita:
// Authorization: Bearer APP_USR-...
// Authorization: APP_USR-...
// ou variável de ambiente ML_ACCESS_TOKEN
function obterToken(req) {
    let token = req.headers['authorization'] || '';

    token = String(token).trim();

    if (token.toLowerCase().startsWith('bearer ')) {
        token = token.slice(7).trim();
    }

    if (!token) {
        token = String(process.env.ML_ACCESS_TOKEN || '').trim();
    }

    return token;
}


// Valida o Access Token diretamente no Mercado Livre
async function validarToken(token) {
    if (!token) {
        return {
            valido: false,
            erro: 'Token não fornecido.'
        };
    }

    try {
        const response = await fetch(
            'https://api.mercadolibre.com/users/me',
            {
                headers: {
                    Authorization: 'Bearer ' + token
                }
            }
        );

        let data = {};

        try {
            data = await response.json();
        } catch (e) {
            data = {};
        }

        if (!response.ok || !data.id) {
            return {
                valido: false,
                erro: data.message || 'Token inválido ou expirado.'
            };
        }

        return {
            valido: true,
            usuario: data
        };

    } catch (e) {
        return {
            valido: false,
            erro: 'Erro ao validar token: ' + e.message
        };
    }
}


// Função para fazer requisições ao Mercado Livre
async function mercadoLivreFetch(url, token, options = {}) {
    const headers = {
        ...(options.headers || {}),
        Authorization: 'Bearer ' + token
    };

    return fetch(url, {
        ...options,
        headers
    });
}


/* =========================================================
   ROTA PRINCIPAL
========================================================= */

app.get('/', (req, res) => {
    res.send('Servidor proxy do Mercado Livre online!');
});


/* =========================================================
   VALIDAÇÃO DO TOKEN
========================================================= */

// Essa rota permite testar o token sem OAuth.
app.get('/api/auth/status', async (req, res) => {

    const token = obterToken(req);

    if (!token) {
        return res.status(401).json({
            autenticado: false,
            erro: 'Token não fornecido.'
        });
    }

    const validacao = await validarToken(token);

    if (!validacao.valido) {
        return res.status(401).json({
            autenticado: false,
            erro: validacao.erro
        });
    }

    return res.json({
        autenticado: true,
        user_id: validacao.usuario.id,
        nickname: validacao.usuario.nickname || '',
        permalink: validacao.usuario.permalink || ''
    });
});


// Mantida apenas para compatibilidade.
// Não existe OAuth neste sistema.
app.post('/api/auth/start', async (req, res) => {

    const token =
        String(req.body?.access_token || '').trim() ||
        obterToken(req);

    if (!token) {
        return res.status(400).json({
            sucesso: false,
            erro: 'Access Token não fornecido.'
        });
    }

    const validacao = await validarToken(token);

    if (!validacao.valido) {
        return res.status(401).json({
            sucesso: false,
            erro: validacao.erro
        });
    }

    return res.json({
        sucesso: true,
        autenticado: true,
        user_id: validacao.usuario.id,
        nickname: validacao.usuario.nickname || ''
    });
});


// Como o token fica no navegador, logout simplesmente confirma.
app.post('/api/auth/logout', (req, res) => {
    res.json({
        sucesso: true
    });
});


/* =========================================================
   FRETE EXATO
========================================================= */

async function calcularFreteExato(itemObj, token) {

    const shipping = itemObj.shipping || {};
    const freeShipping = shipping.free_shipping || false;

    let custoEnvio = 6.85;

    if (freeShipping) {

        // Tenta buscar o custo exato via API de sale_fee
        try {

            const saleFeeRes = await mercadoLivreFetch(
                `https://api.mercadolibre.com/items/${itemObj.id}/sale_fee?price=${itemObj.price || 0}&listing_type_id=${itemObj.listing_type_id || 'gold_special'}`,
                token
            );

            if (saleFeeRes.ok) {

                const saleFeeData =
                    await saleFeeRes.json();

                if (
                    saleFeeData.sale_fee_details &&
                    saleFeeData.sale_fee_details.shipping_fee !== undefined
                ) {
                    // CORREÇÃO: return na mesma linha
                    return saleFeeData.sale_fee_details.shipping_fee;
                }
            }

        } catch (e) {
            // Ignora e segue para fallback
        }


        // Se for frete grátis e não pegou na API,
        // usa custos declarados
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
                return cObj.cost;
            }
        }

        // Fallback original
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
                custoEnvio = cObj.cost;
            }
        }
    }

    return custoEnvio;
}


/* =========================================================
   1. TODOS OS ANÚNCIOS
========================================================= */

app.get('/api/anuncios', async (req, res) => {

    const token = obterToken(req);

    if (!token) {
        return res.status(401).json({
            erro: "Token não fornecido"
        });
    }


    // Valida o token antes de começar a buscar anúncios
    const validacao = await validarToken(token);

    if (!validacao.valido) {
        return res.status(401).json({
            erro: "Token inválido ou expirado."
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

        const userData =
            validacao.usuario;

        let allIds = [];

        let scrollId = null;

        let hasMore = true;


        while (hasMore) {

            let url =
                `https://api.mercadolibre.com/users/${userData.id}/items/search?search_type=scan&limit=50`;

            if (scrollId) {
                url += `&scroll_id=${encodeURIComponent(scrollId)}`;
            }


            const searchRes =
                await mercadoLivreFetch(
                    url,
                    token
                );


            let searchData = {};

            try {
                searchData =
                    await searchRes.json();
            } catch (e) {
                searchData = {};
            }


            if (!searchRes.ok) {

                return res.status(searchRes.status).json({
                    erro:
                        searchData.message ||
                        "Erro ao buscar anúncios no Mercado Livre."
                });
            }


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


        let targetIds =
            allIds;


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
                    await mercadoLivreFetch(
                        `https://api.mercadolibre.com/items?ids=${chunk.join(",")}`,
                        token
                    );


                const multiData =
                    await multiRes.json();


                const itensArray =
                    Array.isArray(multiData)
                        ? multiData
                        : [];


                for (
                    const itemObj
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


                        // Aplica o cálculo exato
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

                            title: title,

                            price: preco,

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

        console.error(
            "Erro /api/anuncios:",
            e
        );

        res.status(500).json({
            erro:
                "Erro ao processar dados da API: " +
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
            erro: "Token não fornecido"
        });
    }


    const { ids } =
        req.body;


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
                await mercadoLivreFetch(
                    `https://api.mercadolibre.com/items?ids=${blocoIds}`,
                    token
                );


            const multiData =
                await multiRes.json();


            if (
                Array.isArray(multiData)
            ) {

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
            precos:
                precosMap
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
   3. SINCRONIZAR FRETES
========================================================= */

app.post('/api/sincronizar-fretes', async (req, res) => {

    const token = obterToken(req);

    if (!token) {
        return res.status(401).json({
            erro: "Token não fornecido"
        });
    }


    const { ids } =
        req.body;


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
                await mercadoLivreFetch(
                    `https://api.mercadolibre.com/items?ids=${blocoIds}`,
                    token
                );


            const multiData =
                await multiRes.json();


            if (
                Array.isArray(multiData)
            ) {

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
                            ) ||
                            false;


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
            fretes:
                fretesMap
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
   4. ATUALIZAÇÃO INDIVIDUAL
========================================================= */

app.post('/api/atualizar-preco', async (req, res) => {

    const token = obterToken(req);

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
            await mercadoLivreFetch(
                `https://api.mercadolibre.com/items/${id}`,
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
            await mlRes.json();


        if (mlRes.ok) {

            return res.json({
                sucesso: true,
                resultado:
                    mlData
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


        res.status(400).json({
            erro:
                mensagemErro
        });


    } catch (e) {

        res.status(500).json({
            erro:
                "Erro de conexão ao atualizar preço: " +
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
            erro: "Token não fornecido"
        });
    }


    const { itens } =
        req.body;


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
                            await mercadoLivreFetch(
                                `https://api.mercadolibre.com/items/${item.id}`,
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
                                                Number(
                                                    item.price
                                                )
                                        })
                                }
                            );


                        const mlData =
                            await mlRes.json();


                        if (mlRes.ok) {

                            return {
                                id:
                                    item.id,

                                sucesso:
                                    true
                            };
                        }


                        const mensagemErro =
                            mlData.message ||
                            (
                                mlData.cause &&
                                mlData.cause[0] &&
                                mlData.cause[0].message
                            ) ||
                            JSON.stringify(
                                mlData
                            );


                        return {

                            id:
                                item.id,

                            sucesso:
                                false,

                            erro:
                                mensagemErro
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
   INICIAR SERVIDOR
========================================================= */

app.listen(
    PORT,
    () => {
        console.log(
            `Servidor rodando na porta ${PORT}`
        );
    }
);
