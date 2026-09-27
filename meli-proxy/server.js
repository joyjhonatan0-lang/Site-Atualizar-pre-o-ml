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
        // 1. Descobrir o ID do usuário logado
        const userRes = await fetch("https://api.mercadolibre.com/users/me", {
            headers: { "Authorization": "Bearer " + token }
        });
        const userData = await userRes.json();
        
        if (!userData.id) {
            return res.status(401).json({ erro: "Token inválido ou expirado." });
        }

        // 2. Buscar os IDs dos anúncios do vendedor
        const itemsRes = await fetch(`https://api.mercadolibre.com/users/${userData.id}/items/search?limit=50`, {
            headers: { "Authorization": "Bearer " + token }
        });
        const itemsData = await itemsRes.json();
        const allIds = itemsData.results || [];

        if (allIds.length === 0) {
            return res.json({ itens: [] });
        }

        let listaFinal = [];

        // 3. Buscar os detalhes dos anúncios em lote de até 50 itens
        for (let i = 0; i < allIds.length; i += 50) {
            const chunk = allIds.slice(i, i + 50);
            
            const multiRes = await fetch(`https://api.mercadolibre.com/items?ids=${chunk.join(",")}&attributes=id,title,price,status,listing_type_id,available_quantity,seller_custom_field,permalink,thumbnail,sale_fee,shipping`, {
                headers: { "Authorization": "Bearer " + token }
            });
            const multiData = await multiRes.json();
            const itensArray = Array.isArray(multiData) ? multiData : [];

            for (let itemObj of itensArray) {
                if (itemObj && itemObj.code === 200 && itemObj.body) {
                    const body = itemObj.body;
                    let preco = body.price || 0;
                    let listingType = body.listing_type_id;
                    
                    let comissao = body.sale_fee;
                    if (!comissao || isNaN(comissao)) {
                        comissao = listingType === 'gold_pro' ? preco * 0.16 : preco * 0.11;
                    }

                    let shipping = body.shipping || {};
                    let freeShipping = shipping.free_shipping || false;
                    
                    let custoEnvio = 6.85;
                    if (shipping.costs && Array.isArray(shipping.costs) && shipping.costs.length > 0) {
                        let cObj = shipping.costs.find(c => c.cost !== undefined);
                        if (cObj) custoEnvio = cObj.cost;
                    }

                    let liquido = preco - comissao - (freeShipping ? custoEnvio : 0);
                    if (liquido < 0) liquido = 0;

                    listaFinal.push({
                        id: body.id,
                        title: body.title || 'Sem Título',
                        price: preco,
                        status: body.status || 'active',
                        listing_type_id: listingType || 'gold_special',
                        available_quantity: body.available_quantity || 0,
                        sku: body.seller_custom_field || 'Sem SKU',
                        permalink: body.permalink || '#',
                        thumbnail: body.thumbnail || '',
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
        console.error("ERRO:", e);
        res.status(500).json({ erro: "Erro interno ao buscar anúncios." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
