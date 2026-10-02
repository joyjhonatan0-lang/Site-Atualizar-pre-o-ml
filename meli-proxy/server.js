const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Servidor proxy do Mercado Livre online!');
});

// 1. Rota para puxar TODOS os anúncios de forma rápida
app.get('/api/anuncios', async (req, res) => {
    let token = req.headers['authorization'];
    if (!token) return res.status(401).json({ erro: "Token não fornecido" });

    token = token.replace('Bearer ', '').trim();

    const existingIdsParam = req.query.existingIds;
    const existingIdsSet = new Set(existingIdsParam ? existingIdsParam.split(',') : []);
    const isAppendMode = existingIdsSet.size > 0;

    try {
        const userRes = await fetch("https://api.mercadolibre.com/users/me", {
            headers: { "Authorization": "Bearer " + token }
        });
        const userData = await userRes.json();
        
        if (!userData.id) {
            return res.status(401).json({ erro: "Token inválido ou expirado." });
        }

        let allIds = [];
        let scrollId = null;
        let hasMore = true;

        while (hasMore) {
            let url = `https://api.mercadolibre.com/users/${userData.id}/items/search?search_type=scan&limit=50`;
            if (scrollId) {
                url += `&scroll_id=${scrollId}`;
            }

            const searchRes = await fetch(url, {
                headers: { "Authorization": "Bearer " + token }
            });
            const searchData = await searchRes.json();

            const results = searchData.results || [];
            if (results.length > 0) {
                allIds = allIds.concat(results);
            }

            scrollId = searchData.scroll_id;

            if (results.length === 0 || !scrollId) {
                hasMore = false;
            }
        }

        if (allIds.length === 0) {
            return res.json({ itens: [] });
        }

        let targetIds = allIds;
        if (isAppendMode) {
            targetIds = allIds.filter(id => !existingIdsSet.has(id));
            if (targetIds.length === 0) {
                return res.json({ itens: [], mensagem: "Nenhum anúncio novo encontrado." });
            }
        }

        let listaFinal = [];

        for (let i = 0; i < targetIds.length; i += 20) {
            const chunk = targetIds.slice(i, i + 20);
            
            try {
                const multiRes = await fetch(`https://api.mercadolibre.com/items?ids=${chunk.join(",")}`, {
                    headers: { "Authorization": "Bearer " + token }
                });
                const multiData = await multiRes.json();
                const itensArray = Array.isArray(multiData) ? multiData : [];

                for (let itemObj of itensArray) {
                    if (itemObj && itemObj.code === 200 && itemObj.body) {
                        const body = itemObj.body;
                        const idItem = body.id;
                        const preco = body.price || 0;
                        const listingType = body.listing_type_id || 'gold_special';
                        const availableQty = body.available_quantity || 0;
                        const title = body.title || 'Sem Título';
                        const permalink = body.permalink || '#';
                        const thumbnail = body.thumbnail || '';
                        
                        let sku = 'Sem SKU';
                        if (body.attributes) {
                            const attrSku = body.attributes.find(a => a.id === 'SELLER_SKU');
                            if (attrSku && attrSku.value_name) sku = attrSku.value_name;
                        }
                        const status = body.status || 'active';

                        let comissao = body.sale_fee || (listingType === 'gold_pro' ? preco * 0.16 : preco * 0.11);
                        
                        let shipping = body.shipping || {};
                        let freeShipping = shipping.free_shipping || false;
                        
                        let custoEnvio = 6.85;
                        if (shipping.logistic_type === 'fulfillment') {
                            custoEnvio = 18.50;
                        }
                        if (shipping.costs && Array.isArray(shipping.costs) && shipping.costs.length > 0) {
                            let cObj = shipping.costs.find(c => c.cost !== undefined);
                            if (cObj) custoEnvio = cObj.cost;
                        }

                        let liquido = preco - comissao - (freeShipping ? custoEnvio : 0);
                        if (liquido < 0) liquido = 0;

                        listaFinal.push({
                            id: idItem,
                            title: title,
                            price: preco,
                            status: status,
                            listing_type_id: listingType,
                            available_quantity: availableQty,
                            sku: sku,
                            permalink: permalink,
                            thumbnail: thumbnail,
                            sale_fee: comissao,
                            shipping_cost: custoEnvio,
                            free_shipping: freeShipping,
                            net_received: liquido
                        });
                    }
                }
            } catch (chunkErr) {
                console.error("Erro ao buscar lote de IDs:", chunkErr);
            }
        }

        res.json({ itens: listaFinal });

    } catch (e) {
        res.status(500).json({ erro: "Erro ao processar dados da API: " + e.message });
    }
});

// 2. ROTA: Sincronizar PREÇOS
app.post('/api/sincronizar-precos', async (req, res) => {
    let token = req.headers['authorization'];
    if (!token) return res.status(401).json({ erro: "Token não fornecido" });

    token = token.replace('Bearer ', '').trim();
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ erro: "Lista de IDs inválida." });
    }

    let precosMap = {};

    try {
        for (let i = 0; i < ids.length; i += 20) {
            const blocoIds = ids.slice(i, i + 20).join(',');
            const multiRes = await fetch(`https://api.mercadolibre.com/items?ids=${blocoIds}`, {
                headers: { "Authorization": "Bearer " + token }
            });
            const multiData = await multiRes.json();
            
            if (Array.isArray(multiData)) {
                multiData.forEach(itemObj => {
                    if (itemObj.code === 200 && itemObj.body) {
                        precosMap[itemObj.body.id] = itemObj.body.price;
                    }
                });
            }
        }
        res.json({ precos: precosMap });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar preços: " + e.message });
    }
});

// 3. ROTA: Sincronizar FRETES REAIS em Lotes Simultâneos (Rápido e sem Timeout)
app.post('/api/sincronizar-fretes', async (req, res) => {
    let token = req.headers['authorization'];
    if (!token) return res.status(401).json({ erro: "Token não fornecido" });

    token = token.replace('Bearer ', '').trim();
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ erro: "Lista de IDs inválida." });
    }

    let fretesMap = {};

    try {
        // Divide os IDs em blocos de 10 para processar em paralelo de forma segura
        for (let i = 0; i < ids.length; i += 10) {
            const bloco = ids.slice(i, i + 10);

            const promises = bloco.map(async (idItem) => {
                let custoEnvio = 6.85;
                let freeShipping = false;

                try {
                    // Busca paralela de dados e opções de envio
                    const [itemRes, shipRes] = await Promise.all([
                        fetch(`https://api.mercadolibre.com/items/${idItem}`, { headers: { "Authorization": "Bearer " + token } }),
                        fetch(`https://api.mercadolibre.com/items/${idItem}/shipping_options`, { headers: { "Authorization": "Bearer " + token } })
                    ]);

                    if (itemRes.ok) {
                        const itemData = await itemRes.json();
                        if (itemData.shipping) {
                            freeShipping = itemData.shipping.free_shipping || false;
                        }
                    }

                    if (shipRes.ok) {
                        const shipData = await shipRes.json();
                        if (shipData && shipData.options && Array.isArray(shipData.options)) {
                            const opcaoGratis = shipData.options.find(opt => opt.free_shipping && opt.list_cost > 0);
                            if (opcaoGratis) {
                                custoEnvio = opcaoGratis.list_cost;
                            } else if (shipData.options.length > 0 && shipData.options[0].cost !== undefined) {
                                custoEnvio = shipData.options[0].cost;
                            }
                        }
                    }
                } catch (err) {
                    // Mantém valor padrão em caso de falha isolada
                }

                return {
                    id: idItem,
                    custo: custoEnvio,
                    gratis: freeShipping
                };
            });

            const resultadosLote = await Promise.all(promises);
            resultadosLote.forEach(resItem => {
                fretesMap[resItem.id] = {
                    custo: resItem.custo,
                    gratis: resItem.gratis
                };
            });
        }

        res.json({ fretes: fretesMap });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao buscar fretes: " + e.message });
    }
});

// 4. Rota de atualização de preço individual
app.post('/api/atualizar-preco', async (req, res) => {
    let token = req.headers['authorization'];
    if (!token) return res.status(401).json({ erro: "Token não fornecido" });

    token = token.replace('Bearer ', '').trim();
    const { id, price } = req.body;

    if (!id || price === undefined) {
        return res.status(400).json({ erro: "ID ou preço não informados." });
    }

    try {
        const mlRes = await fetch(`https://api.mercadolibre.com/items/${id}`, {
            method: 'PUT',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ price: Number(price) })
        });

        const mlData = await mlRes.json();

        if (mlRes.ok) {
            res.json({ sucesso: true, resultado: mlData });
        } else {
            let mensagemErro = mlData.message || (mlData.cause?.[0]?.message) || JSON.stringify(mlData);
            res.status(400).json({ erro: mensagemErro });
        }
    } catch (e) {
        res.status(500).json({ erro: "Erro de conexão ao atualizar preço: " + e.message });
    }
});

// 5. Rota de atualização em lote simultâneo
app.post('/api/atualizar-precos', async (req, res) => {
    let token = req.headers['authorization'];
    if (!token) return res.status(401).json({ erro: "Token não fornecido" });

    token = token.replace('Bearer ', '').trim();
    const { itens } = req.body;

    if (!itens || !Array.isArray(itens) || itens.length === 0) {
        return res.status(400).json({ erro: "Nenhum item informado para atualização em lote." });
    }

    try {
        const promises = itens.map(async (item) => {
            try {
                const mlRes = await fetch(`https://api.mercadolibre.com/items/${item.id}`, {
                    method: 'PUT',
                    headers: {
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ price: Number(item.price) })
                });

                const mlData = await mlRes.json();

                if (mlRes.ok) {
                    return { id: item.id, sucesso: true };
                } else {
                    let mensagemErro = mlData.message || 
                                       (mlData.cause && mlData.cause[0] && mlData.cause[0].message) || 
                                       JSON.stringify(mlData);
                    return { id: item.id, sucesso: false, erro: mensagemErro };
                }
            } catch (err) {
                return { id: item.id, sucesso: false, erro: "Erro de conexão: " + err.message };
            }
        });

        const resultados = await Promise.all(promises);
        res.json({ resultados });

    } catch (e) {
        res.status(500).json({ erro: "Erro no servidor ao processar lote: " + e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
