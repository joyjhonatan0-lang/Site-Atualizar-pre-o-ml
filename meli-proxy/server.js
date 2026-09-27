const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
app.use(cors());
app.use(express.json());

// Rota de teste para ver se o servidor está ativo
app.get('/', (req, res) => {
    res.send('Servidor proxy do Mercado Livre rodando com sucesso!');
});

// NOVA ROTA: Troca automática do código TG pelo Access Token definitivo
app.post('/api/gerar-token', async (req, res) => {
    const { code, clientId, clientSecret, redirectUri } = req.body;

    try {
        const response = await fetch('https://api.mercadolibre.com/oauth/token', {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'content-type': 'application/x-www-form-urlencoded'
            },
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

// Rota para buscar os anúncios do Mercado Livre
app.get('/api/anuncios', async (req, res) => {
    const token = req.headers['authorization'];

    if (!token) {
        return res.status(401).json({ erro: "Token não fornecido" });
    }

    try {
        // 1. Pega os dados do usuário logado
        const userRes = await fetch("https://api.mercadolibre.com/users/me", {
            headers: { "Authorization": "Bearer " + token }
        });
        const userData = await userRes.json();

        if (!userData.id) {
            return res.status(401).json({ erro: "Token inválido" });
        }

        // 2. Busca a lista de IDs dos anúncios do vendedor
        const itemsRes = await fetch(`https://api.mercadolibre.com/users/${userData.id}/items/search?limit=20`, {
            headers: { "Authorization": "Bearer " + token }
        });
        const itemsData = await itemsRes.json();
        const ids = itemsData.results || [];

        if (ids.length === 0) {
            return res.json({ itens: [] });
        }

        // 3. Busca os detalhes de cada anúncio (título, preço, etc)
        const multiRes = await fetch(`https://api.mercadolibre.com/items?ids=${ids.join(",")}`, {
            headers: { "Authorization": "Bearer " + token }
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

// Rota para atualizar o preço de um anúncio específico
app.put('/api/atualizar-preco', async (req, res) => {
    const token = req.headers['authorization'];
    const { mlb, price } = req.body;

    if (!token) {
        return res.status(401).json({ sucesso: false, erro: "Token não fornecido" });
    }

    try {
        const response = await fetch(`https://api.mercadolibre.com/items/${mlb}`, {
            method: 'PUT',
            headers: {
                'Authorization': 'Bearer ' + token,
                'Content-Type': 'application/json'
            },
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
app.listen(PORT, () => {
    console.log(`Servidor a rodar na porta ${PORT}`);
});
