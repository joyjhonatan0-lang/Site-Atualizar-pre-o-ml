const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Servidor proxy do Mercado Livre rodando com sucesso!');
});

app.post('/api/gerar-token', async (req, res) => {
    const { code, clientId, clientSecret, redirectUri } = req.body;
    try {
        const response = await fetch('https://api.mercadolibre.com/oauth/token', {
            method: 'POST',
            headers: { 'accept': 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: clientId,
                client_secret: clientSecret,
                code: code,
                redirect_uri: redirectUri || 'https://www.google.com'
            })
        });
        const data = await response.json();
        if (response.ok) {
            res.json({ sucesso: true, access_token: data.access_token });
        } else {
            res.json({ sucesso: false, erro: data.error_description || "Erro ao gerar token" });
        }
    } catch (e) {
        res.status(500).json({ sucesso: false, erro: "Erro interno no servidor" });
    }
});

// Rota definitiva com fatiamento por blocos de data para contornar o limite de 1000 da API
app.get('/api/anuncios', async (req, res) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(401).json({ erro: "Token não fornecido" });

    try {
        const userRes = await fetch("https://api.mercadolibre.com/users/me", {
            headers: { "Authorization": "Bearer " + token }
        });
        const userData = await userRes.json();
        if (!userData.id) return res.status(401).json({ erro: "Token inválido" });

        let allIdsSet = new Set();
        let limit = 50;

        // Vamos fatiar a busca por anos/meses e status para garantir que nenhum bloco ultrapasse 1000 itens
        const statuses = ['active', 'paused', 'closed'];
        const anos = ['2026', '2025', '2024', '2023', '2022', '2021'];

        for (let status of statuses) {
            // 1. Busca padrão sem filtro de data até onde der (primeiro bloco)
            let offset = 0;
            let fetchMore = true;
            while (fetchMore && offset < 950) {
                const r = await fetch(`https://api.mercadolibre.com/users/${userData.id}/items/search?status=${status}&limit=${limit}&offset=${offset}`, {
                    headers: { "Authorization": "Bearer " + token }
                });
                const d = await r.json();
                const ids = d.results || [];
                if (ids.length > 0) {
                    ids.forEach(id => allIdsSet.add(id));
                    offset += limit;
                    if (ids.length < limit) fetchMore = false;
                } else {
                    fetchMore = false;
                }
            }

            // 2. Busca refinada por anos para capturar o restante que a paginação bloqueia
            for (let ano of anos) {
                for (let mes = 1; mes <= 12; mes++) {
                    let mesStr = mes < 10 ? `0${mes}` : `${mes}`;
                    let dateFrom = `${ano}-${mesStr}-01T00:00:00Z`;
                    let dateTo = mes === 12 ? `${parseInt(ano)+1}-01-01T00:00:00Z` : `${ano}-${mes+1 < 10 ? '0'+(mes+1) : mes+1}-01T00:00:00Z`;

                    let subOffset = 0;
                    let subMore = true;
                    while (subMore && subOffset < 950) {
                        const rSub = await fetch(`https://api.mercadolibre.com/users/${userData.id}/items/search?status=${status}&limit=${limit}&offset=${subOffset}&date_from=${dateFrom}&date_to=${dateTo}`, {
                            headers: { "Authorization": "Bearer " + token }
                        });
                        const dSub = await rSub.json();
                        const idsSub = dSub.results || [];
                        if (idsSub.length > 0) {
                            idsSub.forEach(id => allIdsSet.add(id));
                            subOffset += limit;
                            if (idsSub.length < limit) subMore = false;
                        } else {
                            subMore = false;
                        }
                    }
                }
            }
        }

        let allIds = Array.from(allIdsSet);
        if (allIds.length === 0) return res.json({ itens: [] });

        let listaFinal = [];
        for (let i = 0; i < allIds.length; i += 20) {
            const chunk = allIds.slice(i, i + 20);
            const multiRes = await fetch(`https://api.mercadolibre.com/items?ids=${chunk.join(",")}&attributes=id,title,price,status,listing_type_id,available_quantity,seller_custom_field,permalink,thumbnail,sale_fee`, {
                headers: { "Authorization": "Bearer " + token }
            });
            const multiData = await multiRes.json();

            multiData.forEach(itemObj => {
                if (itemObj.code === 200) {
                    const body = itemObj.body;
                    let preco = body.price || 0;
                    let taxa = body.sale_fee || 0;
                    let liquido = preco - taxa;

                    listaFinal.push({
                        id: body.id,
                        title: body.title,
                        price: preco,
                        status: body.status,
                        listing_type_id: body.listing_type_id,
                        available_quantity: body.available_quantity || 0,
                        sku: body.seller_custom_field || 'Sem SKU',
                        permalink: body.permalink,
                        thumbnail: body.thumbnail || '',
                        sale_fee: taxa,
                        net_received: liquido > 0 ? liquido : 0
                    });
                }
            });
        }

        res.json({ itens: listaFinal });

    } catch (e) {
        res.status(500).json({ erro: "Erro ao comunicar com a API do Mercado Livre" });
    }
});

app.put('/api/atualizar-preco', async (req, res) => {
    const token = req.headers['authorization'];
    const { mlb, price } = req.body;
    if (!token) return res.status(401).json({ sucesso: false, erro: "Token não fornecido" });

    try {
        const response = await fetch(`https://api.mercadolibre.com/items/${mlb}`, {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ price: price })
        });
        const data = await response.json();
        if (response.ok) {
            res.json({ sucesso: true });
        } else {
            res.json({ sucesso: false, erro: data.message || "Erro ao atualizar" });
        }
    } catch (e) {
        res.status(500).json({ sucesso: false, erro: "Erro interno no servidor" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
