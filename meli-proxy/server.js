const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Servidor proxy do Mercado Livre online!');
});

app.get('/api/anuncios', async (req, res) => {
    let token = req.headers['authorization'];
    if (!token) return res.status(401).json({ erro: "Token não fornecido" });

    token = token.replace('Bearer ', '').trim();

    try {
        // 1. API para puxar os dados do usuário autenticado
        const userRes = await fetch("https://api.mercadolibre.com/users/me", {
            headers: { "Authorization": "Bearer " + token }
        });
        const userData = await userRes.json();
        
        if (!userData.id) {
            return res.status(401).json({ erro: "Token inválido ou expirado." });
        }

        // 2. Paginação automática para puxar TODOS os IDs dos anúncios (suporta mais de 2.000 itens)
        let allIds = [];
        let offset = 0;
        let limit = 50;
        let total = 0;

        do {
            const itemsRes = await fetch(`https://api.mercadolibre.com/users/${userData.id}/items/search?limit=${limit}&offset=${offset}`, {
                headers: { "Authorization": "Bearer " + token }
            });
            const itemsData = await itemsRes.json();
            const results = itemsData.results || [];
            
            allIds = allIds.concat(results);
            total = itemsData.paging && itemsData.paging.total ? itemsData.paging.total : 0;
            offset += limit;

            if (results.length === 0 || offset >= total) break;
        } while (offset < total);

        if (allIds.length === 0) {
            return res.json({ itens: [] });
        }

        let listaFinal = [];

        // 3. Puxar os detalhes em lote usando a API de items do Mercado Livre (blocos de 20)
        for (let i = 0; i < allIds.length; i += 20) {
            const chunk = allIds.slice(i, i + 20);
            
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

                    // 4. API para puxar a comissão exata (Sale Fee)
                    let comissao = body.sale_fee || 0;
                    if (!comissao) {
                        try {
                            const feeRes = await fetch(`https://api.mercadolibre.com/sites/MLB/listing_prices?price=${preco}&listing_type_id=${listingType}`, {
                                headers: { "Authorization": "Bearer " + token }
                            });
                            const feeData = await feeRes.json();
                            if (feeData && feeData.sale_fee_amount) {
                                comissao = feeData.sale_fee_amount;
                            }
                        } catch (err) {
                            comissao = listingType === 'gold_pro' ? preco * 0.16 : preco * 0.11;
                        }
                    }

                    if (!comissao || isNaN(comissao)) {
                        comissao = listingType === 'gold_pro' ? preco * 0.16 : preco * 0.11;
                    }

                    // 5. Custo de envio real
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
        }

        res.json({ itens: listaFinal });

    } catch (e) {
        console.error("ERRO NA API:", e);
        res.status(500).json({ erro: "Erro ao processar dados da API: " + e.message });
    }
});

// Rota de atualização de preço
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
            let mensagemErro = "Erro ao atualizar preço";
            if (mlData.message) {
                mensagemErro = mlData.message;
            } else if (mlData.cause && Array.isArray(mlData.cause) && mlData.cause.length > 0 && mlData.cause[0].message) {
                mensagemErro = mlData.cause[0].message;
            }
            res.status(400).json({ erro: mensagemErro });
        }
    } catch (e) {
        console.error("ERRO AO ATUALIZAR PREÇO:", e);
        res.status(500).json({ erro: "Erro de conexão ao atualizar preço: " + e.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
