const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/anuncios', async (req, res) => {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({ erro: "Token não fornecido" });

    try {
        const userRes = await fetch('https://api.mercadolibre.com/users/me', {
            headers: { 'Authorization': token }
        });
        const userData = await userRes.json();
        if (!userData.id) return res.status(400).json({ erro: "Token inválido" });

        const itemsRes = await fetch(`https://api.mercadolibre.com/users/${userData.id}/items/search?limit=50`, {
            headers: { 'Authorization': token }
        });
        const itemsData = await itemsRes.json();
        const ids = itemsData.results || [];

        if (ids.length === 0) return res.json({ itens: [] });

        const multiRes = await fetch(`https://api.mercadolibre.com/items?ids=${ids.join(',')}`, {
            headers: { 'Authorization': token }
        });
        const multiData = await multiRes.json();

        const listaFinal = [];
        multiData.forEach(itemObj => {
            if (itemObj.code === 200) {
                listaFinal.push({
                    id: itemObj.body.id,
                    title: itemObj.body.title,
                    price: itemObj.body.price
                });
            }
        });

        res.json({ itens: listaFinal });
    } catch (e) {
        res.status(500).json({ erro: "Erro ao comunicar com a API do Mercado Livre" });
    }
});

app.put('/api/atualizar-preco', async (req, res) => {
    const token = req.headers.authorization;
    const { mlb, price } = req.body;

    try {
        const response = await fetch(`https://api.mercadolibre.com/items/${mlb}`, {
            method: 'PUT',
            headers: {
                'Authorization': token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ price })
        });

        if (response.ok) {
            res.json({ sucesso: true });
        } else {
            res.status(400).json({ sucesso: false });
        }
    } catch (e) {
        res.status(500).json({ erro: "Erro ao atualizar preço" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));
