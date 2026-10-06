const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const fetch = (...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const ML_API = 'https://api.mercadolibre.com';
const OAUTH_FILE = process.env.ML_OAUTH_FILE || path.join(__dirname, 'ml-oauth-store.json');
const DEFAULT_FRONTEND_URL = process.env.FRONTEND_URL || 'https://joyjhonatan0-lang.github.io/Site-Atualizar-pre-o-ml/';
let oauthRefreshPromise = null;

function lerOAuthStore() {
    try {
        if (!fs.existsSync(OAUTH_FILE)) return {};
        return JSON.parse(fs.readFileSync(OAUTH_FILE, 'utf8')) || {};
    } catch (erro) {
        console.error('Erro ao ler OAuth store:', erro.message);
        return {};
    }
}

function salvarOAuthStore(dados) {
    fs.writeFileSync(OAUTH_FILE, JSON.stringify(dados, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function limparOAuthStore() {
    try { if (fs.existsSync(OAUTH_FILE)) fs.unlinkSync(OAUTH_FILE); } catch (erro) {}
}

function tokenExpirando(store) {
    if (!store?.access_token) return true;
    if (!store?.expires_at) return false;
    return Date.now() >= Number(store.expires_at) - 120000;
}

async function renovarAccessTokenSeNecessario(forcar = false) {
    let store = lerOAuthStore();
    if (!store.access_token && !store.refresh_token) return null;
    if (!forcar && !tokenExpirando(store)) return store.access_token;
    if (!store.refresh_token || !store.client_id || !store.client_secret) return store.access_token || null;

    if (oauthRefreshPromise) return oauthRefreshPromise;

    oauthRefreshPromise = (async () => {
        const atual = lerOAuthStore();
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: String(atual.client_id),
            client_secret: String(atual.client_secret),
            refresh_token: String(atual.refresh_token)
        });

        const response = await fetch(`${ML_API}/oauth/token`, {
            method: 'POST',
            headers: { 'accept': 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
            body
        });
        const data = await jsonSeguro(response);
        if (!response.ok || !data.access_token) {
            console.error('Falha ao renovar token Mercado Livre:', data);
            throw new Error(formatarErroMercadoLivre(data) || 'Falha ao renovar Access Token.');
        }

        const novo = {
            ...atual,
            access_token: data.access_token,
            refresh_token: data.refresh_token || atual.refresh_token,
            expires_in: Number(data.expires_in || 21600),
            expires_at: Date.now() + Number(data.expires_in || 21600) * 1000,
            user_id: data.user_id || atual.user_id,
            scope: data.scope || atual.scope,
            updated_at: new Date().toISOString()
        };
        salvarOAuthStore(novo);
        return novo.access_token;
    })();

    try { return await oauthRefreshPromise; }
    finally { oauthRefreshPromise = null; }
}

app.get('/', (req, res) => {
    res.send('Servidor proxy do Mercado Livre online!');
});

/* =========================================================
   FUNÇÕES AUXILIARES
========================================================= */

function obterToken(req) {
    let token = req.headers['authorization'];
    if (token) {
        token = token.replace(/^Bearer\s+/i, '').trim();
        if (token && token !== 'AUTO' && token !== 'null' && token !== 'undefined') return token;
    }
    const store = lerOAuthStore();
    return store.access_token || null;
}

function respostaErro(res, status, mensagem) {
    return res.status(status).json({
        sucesso: false,
        erro: mensagem
    });
}

async function mlFetch(url, token, options = {}) {
    let tokenFinal = token;
    const store = lerOAuthStore();

    // Se a chamada estiver usando o token gerenciado pelo servidor, renova antes de expirar.
    if (!tokenFinal || tokenFinal === 'AUTO' || (store.access_token && tokenFinal === store.access_token)) {
        try {
            tokenFinal = await renovarAccessTokenSeNecessario(false);
        } catch (erro) {
            console.error('Renovação automática:', erro.message);
            tokenFinal = store.access_token || tokenFinal;
        }
    }

    const headers = {
        ...(options.headers || {}),
        Authorization: 'Bearer ' + tokenFinal
    };

    let response = await fetch(url, { ...options, headers });

    // Se o ML responder 401 para o token gerenciado, tenta UMA renovação e repete a chamada.
    if (response.status === 401 && store.refresh_token && (!token || token === 'AUTO' || token === store.access_token)) {
        try {
            tokenFinal = await renovarAccessTokenSeNecessario(true);
            response = await fetch(url, {
                ...options,
                headers: { ...(options.headers || {}), Authorization: 'Bearer ' + tokenFinal }
            });
        } catch (erro) {
            console.error('Falha na renovação após 401:', erro.message);
        }
    }

    return response;
}

async function jsonSeguro(response) {
    try {
        return await response.json();
    } catch {
        return {};
    }
}

function traduzirErroMercadoLivreV46(causa={}) {
    const code=String(causa?.code||causa?.error||'').trim();
    const msg=String(causa?.message||'').trim();
    const ref=Array.isArray(causa?.references)?causa.references.join(', '):String(causa?.references||'');
    const mapa={
        'item.attributes.missing_required':'Falta uma característica obrigatória para esta categoria.',
        'item.attribute.missing_conditional_required':'Falta uma característica obrigatória/condicional para esta categoria.',
        'item.attributes.invalid_length':'Uma característica ultrapassou o tamanho máximo permitido.',
        'item.price.invalid':'O preço informado não é aceito pelo Mercado Livre.',
        'item.pictures.max':'A quantidade de fotos ultrapassa o limite permitido nesta categoria.',
        'item.listing_type_id.requiresPictures':'O tipo de publicação escolhido exige pelo menos uma foto.',
        'item.category_id.invalid':'A categoria escolhida não é válida para esta publicação.',
        'item.category_id.no_listings_allowed':'O Mercado Livre não permite novas publicações nesta categoria.',
        'item.title.invalid':'O nome/título da publicação não é válido para esta categoria.',
        'item.family_name.invalid':'O nome da família não é válido para o modelo User Products.',
        'item.attributes.invalid':'Uma ou mais características informadas não são aceitas nesta categoria.',
        'item.attribute.invalid':'Uma característica informada não é aceita nesta categoria.',
        'item.attribute.product_identifier.invalid':'O código universal do produto é inválido.',
        'item.attribute.product_identifier.invalid_by_domain_catalog':'O código universal informado pertence a outro produto/categoria.',
        'validation_error':'O Mercado Livre recusou um ou mais campos da publicação.',
        'shipping.lost_me1_by_user':'A sua conta não utiliza mais o Mercado Envios 1. A publicação precisa usar o Mercado Envios 2.',
        'shipping.me2_not_enabled_for_user':'O Mercado Envios 2 não apareceu como disponível para esta conta.',
        'shipping.me2_not_enabled_for_category':'A categoria escolhida não aceita Mercado Envios 2.',
        'shipping.invalid_mode':'O modo de envio informado não é aceito para esta publicação.',
        'shipping.invalid_logistic_type':'O tipo de logística não é aceito para esta publicação.',
        'shipping.adoption_required':'O Mercado Envios 2 precisa ser adotado para esta publicação.',
        'shipping.mandatory_free_shipping':'O Mercado Livre exige frete grátis para esta publicação.',
        'item.shipping.mandatory_free_shipping':'O Mercado Livre determinou que este anúncio deve oferecer frete grátis. O painel ajustará isso automaticamente.',
        'shipping.lost_me1_by_user':'Sua conta usa Mercado Envios 2. O painel não enviará Mercado Envios 1.',
        'item.attribute.product_identifier.invalid':'O código universal do produto (GTIN/EAN/UPC) informado é inválido.',
        'item.attribute.missing_conditional_required':'Falta um atributo condicional obrigatório da categoria, como GTIN ou o motivo de não possuir GTIN.'
    };
    let pt=mapa[code]||'';
    if(!pt){
        if(/missing required|required attribute|not present/i.test(msg))pt='Falta uma característica obrigatória para publicar.';
        else if(/picture.*max|max.*picture/i.test(msg))pt='Há mais fotos do que a categoria permite.';
        else if(/invalid length|maximum length/i.test(msg))pt='Um campo ultrapassou o tamanho máximo permitido.';
        else if(/validation error/i.test(msg))pt='O Mercado Livre recusou um ou mais campos da publicação.';
        else pt=msg||code||'Erro não detalhado pelo Mercado Livre.';
    }
    const detalhe=[];
    if(ref)detalhe.push(`Campo/referência: ${ref}`);
    if(code)detalhe.push(`Código: ${code}`);
    return detalhe.length?`${pt} ${detalhe.join(' · ')}`:pt;
}

function formatarErroMercadoLivre(data) {
    const causas=Array.isArray(data?.cause)?data.cause:[];
    if(causas.length){
        return causas.map(c=>traduzirErroMercadoLivreV46(c)).filter(Boolean).join(' | ');
    }
    const base=String(data?.message||data?.error||'').trim();
    if(base){
        if(/validation error/i.test(base))return 'O Mercado Livre recusou um ou mais campos da publicação. Veja os campos obrigatórios e os detalhes da validação.';
        return base;
    }
    try{return JSON.stringify(data)}catch(e){return 'Erro não detalhado pelo Mercado Livre.'}
}

// Consulta de frete usada SOMENTE pela rota /api/sincronizar-fretes.
// O carregamento normal de anúncios não faz esta consulta individual.
async function calcularFreteExato(itemObj, token) {
    const shipping = itemObj?.shipping || {};
    const itemId = itemObj?.id;
    const sellerId = itemObj?.seller_id;
    if (!itemId || !sellerId) return 0;

    try {
        const params = new URLSearchParams({
            item_id: String(itemId),
            free_shipping: shipping.free_shipping ? 'true' : 'false',
            verbose: 'true'
        });
        const freteRes = await mlFetch(
            `${ML_API}/users/${sellerId}/shipping_options/free?${params.toString()}`,
            token
        );
        const freteData = await jsonSeguro(freteRes);
        if (freteRes.ok) {
            const valor = Number(freteData?.coverage?.all_country?.list_cost);
            if (Number.isFinite(valor) && valor >= 0) return valor;
        }
    } catch (e) {
        console.error(`Erro ao consultar frete ${itemId}:`, e.message);
    }

    if (Array.isArray(shipping.costs)) {
        const c = shipping.costs.find(x => Number.isFinite(Number(x?.cost)));
        if (c) return Number(c.cost);
    }
    return 0;
}


/* =========================================================
   OAUTH MERCADO LIVRE - LOGIN + RENOVAÇÃO AUTOMÁTICA
========================================================= */

app.get('/api/oauth/status', async (req, res) => {
    try {
        const store = lerOAuthStore();
        if (!store.access_token && !store.refresh_token) {
            return res.json({ connected: false });
        }

        let token = null;
        try { token = await renovarAccessTokenSeNecessario(false); } catch (erro) { token = store.access_token || null; }

        let nickname = store.nickname || null;
        let userId = store.user_id || null;

        if (token) {
            try {
                const meRes = await fetch(`${ML_API}/users/me`, {
                    headers: { Authorization: 'Bearer ' + token }
                });
                const me = await jsonSeguro(meRes);
                if (meRes.ok && me.id) {
                    nickname = me.nickname || nickname;
                    userId = me.id;
                    salvarOAuthStore({ ...lerOAuthStore(), nickname, user_id: userId });
                }
            } catch (erro) {}
        }

        const atual = lerOAuthStore();
        return res.json({
            connected: Boolean(token),
            renewable: Boolean(atual.refresh_token && atual.client_id && atual.client_secret),
            user_id: userId,
            nickname,
            expires_at: atual.expires_at || null,
            redirect_uri: atual.redirect_uri || null,
            token_preview: token
                ? `${String(token).slice(0, 12)}••••••••${String(token).slice(-6)}`
                : null
        });
    } catch (erro) {
        return respostaErro(res, 500, 'Erro ao consultar conexão OAuth: ' + erro.message);
    }
});

app.get('/api/version', (req, res) => {
    res.json({
        ok: true,
        service: 'ML Hub Pro',
        version: 'ml-hub-pro-v46-visible-specs-fast-ai-safe-publish',
        oauth_callback: '/auth/callback',
        manual_credentials: '/api/oauth/manual-credentials'
    });
});

app.post('/api/oauth/configure', async (req, res) => {
    const { client_id, client_secret, redirect_uri, access_token, frontend_url } = req.body || {};
    if (!client_id || !client_secret || !redirect_uri) {
        return respostaErro(res, 400, 'Informe Client ID, Client Secret e URL de retorno.');
    }

    try {
        const callback = new URL(redirect_uri);
        if (callback.protocol !== 'https:') {
            return respostaErro(res, 400, 'A URL de retorno precisa usar HTTPS.');
        }
    } catch {
        return respostaErro(res, 400, 'URL de retorno inválida.');
    }

    const state = crypto.randomBytes(24).toString('hex');

    // PKCE S256: necessário quando a aplicação do Mercado Livre está com PKCE habilitado.
    // Também reforça a segurança do fluxo de autorização.
    const codeVerifier = crypto.randomBytes(48).toString('base64url');
    const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

    const storeAnterior = lerOAuthStore();
    const store = {
        ...storeAnterior,
        client_id: String(client_id).trim(),
        client_secret: String(client_secret).trim(),
        redirect_uri: String(redirect_uri).trim(),
        frontend_url: String(frontend_url || DEFAULT_FRONTEND_URL).trim(),
        oauth_state: state,
        oauth_state_created_at: Date.now(),
        pkce_code_verifier: codeVerifier
    };

    if (access_token && String(access_token).trim()) {
        store.access_token = String(access_token).trim();
        store.expires_at = null;
    }

    salvarOAuthStore(store);

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: store.client_id,
        redirect_uri: store.redirect_uri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
            scope: 'offline_access read write'
    });

    return res.json({
        sucesso: true,
        authorization_url: `https://auth.mercadolivre.com.br/authorization?${params.toString()}`
    });
});

app.get('/auth/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query || {};
    const store = lerOAuthStore();
    const frontend = store.frontend_url || DEFAULT_FRONTEND_URL;

    if (error) {
        return res.redirect(`${frontend}${frontend.includes('?') ? '&' : '?'}oauth=error&message=${encodeURIComponent(error_description || error)}`);
    }
    if (!code || !state || !store.oauth_state || state !== store.oauth_state) {
        return res.status(400).send('OAuth inválido: state ou code não confere. Volte ao ML Hub Pro e tente novamente.');
    }
    if (Date.now() - Number(store.oauth_state_created_at || 0) > 15 * 60 * 1000) {
        return res.status(400).send('OAuth expirado. Volte ao ML Hub Pro e inicie a conexão novamente.');
    }

    try {
        const tokenPayload = {
            grant_type: 'authorization_code',
            client_id: String(store.client_id),
            client_secret: String(store.client_secret),
            code: String(code),
            redirect_uri: String(store.redirect_uri)
        };

        // Se a autorização foi iniciada com PKCE, o mesmo verifier deve ser
        // enviado na troca do authorization code pelo token.
        if (store.pkce_code_verifier) {
            tokenPayload.code_verifier = String(store.pkce_code_verifier);
        }

        const body = new URLSearchParams(tokenPayload);

        const tokenRes = await fetch(`${ML_API}/oauth/token`, {
            method: 'POST',
            headers: { 'accept': 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
            body
        });
        const tokenData = await jsonSeguro(tokenRes);

        if (!tokenRes.ok || !tokenData.access_token) {
            console.error('Erro OAuth callback:', tokenData);
            return res.status(tokenRes.status || 400).send('Não foi possível gerar o token do Mercado Livre: ' + (formatarErroMercadoLivre(tokenData) || 'erro desconhecido'));
        }

        const novo = {
            ...store,
            access_token: tokenData.access_token,
            refresh_token: tokenData.refresh_token,
            expires_in: Number(tokenData.expires_in || 21600),
            expires_at: Date.now() + Number(tokenData.expires_in || 21600) * 1000,
            user_id: tokenData.user_id || null,
            scope: tokenData.scope || null,
            oauth_state: null,
            oauth_state_created_at: null,
            pkce_code_verifier: null,
            connected_at: new Date().toISOString()
        };
        salvarOAuthStore(novo);

        return res.redirect(`${frontend}${frontend.includes('?') ? '&' : '?'}oauth=success`);
    } catch (erroInterno) {
        console.error('Erro no callback OAuth:', erroInterno);
        return res.status(500).send('Erro interno ao concluir OAuth: ' + erroInterno.message);
    }
});


app.post('/api/oauth/manual-credentials', async (req, res) => {
    const clientId = String(req.body?.client_id || '').trim();
    const clientSecret = String(req.body?.client_secret || '').trim();
    const redirectUri = String(req.body?.redirect_uri || '').trim();
    const accessToken = String(req.body?.access_token || '').trim();
    const refreshToken = String(req.body?.refresh_token || '').trim();
    const frontendUrl = String(req.body?.frontend_url || DEFAULT_FRONTEND_URL).trim();

    if (!clientId || !clientSecret || !redirectUri || !accessToken) {
        return respostaErro(res, 400, 'Informe Client ID, Client Secret, URL de retorno e Access Token.');
    }

    try {
        const callback = new URL(redirectUri);
        if (callback.protocol !== 'https:') {
            return respostaErro(res, 400, 'A URL de retorno precisa usar HTTPS.');
        }
    } catch {
        return respostaErro(res, 400, 'URL de retorno inválida.');
    }

    try {
        // Confirma que o APP_USR informado realmente funciona antes de liberar o painel.
        const meRes = await fetch(`${ML_API}/users/me`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'application/json'
            }
        });
        const me = await jsonSeguro(meRes);

        if (!meRes.ok || !me?.id) {
            return respostaErro(
                res,
                meRes.status || 401,
                'Access Token inválido ou expirado: ' + (formatarErroMercadoLivre(me) || 'não foi possível consultar /users/me')
            );
        }

        const anterior = lerOAuthStore();
        const novo = {
            ...anterior,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            frontend_url: frontendUrl,
            access_token: accessToken,
            user_id: me.id,
            nickname: me.nickname || null,
            updated_at: new Date().toISOString()
        };

        if (refreshToken) {
            novo.refresh_token = refreshToken;
            // O token do ML normalmente é válido por 6 horas. Com refresh informado,
            // o servidor passa a controlar a renovação automática.
            novo.expires_in = 21600;
            novo.expires_at = Date.now() + 21600 * 1000;
        } else {
            // Sem refresh token não inventamos uma expiração nem prometemos renovação.
            delete novo.refresh_token;
            novo.expires_at = null;
        }

        salvarOAuthStore(novo);

        return res.json({
            sucesso: true,
            connected: true,
            renewable: Boolean(refreshToken),
            user_id: me.id,
            nickname: me.nickname || null,
            token_preview: `${accessToken.slice(0, 12)}••••••••${accessToken.slice(-6)}`
        });
    } catch (erro) {
        return respostaErro(res, 500, 'Erro ao validar/salvar as credenciais: ' + erro.message);
    }
});

app.post('/api/oauth/manual-token', (req, res) => {
    const accessToken = String(req.body?.access_token || '').trim();
    if (!accessToken) return respostaErro(res, 400, 'Access Token não informado.');
    const store = lerOAuthStore();
    salvarOAuthStore({ ...store, access_token: accessToken, expires_at: null, updated_at: new Date().toISOString() });
    return res.json({ sucesso: true });
});

app.post('/api/oauth/disconnect', (req, res) => {
    limparOAuthStore();
    return res.json({ sucesso: true });
});

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

                        // Não consulta cotação de frete aqui: isso deixava o carregamento
                        // de milhares de anúncios extremamente lento. O frete correto
                        // é atualizado exclusivamente pelo botão "Puxar fretes".
                        let custoEnvio = 0;
                        if (Array.isArray(shipping.costs)) {
                            const custoDoItem = shipping.costs.find(
                                c => Number.isFinite(Number(c?.cost))
                            );
                            if (custoDoItem) custoEnvio = Number(custoDoItem.cost);
                        }

                        // Valor líquido exibido no painel: preço - comissão - custo de envio.
                        // O usuário pediu que o frete seja descontado sempre do campo "Você recebe".
                        let liquido =
                            preco -
                            comissao -
                            custoEnvio;

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
                const itensValidos = multiData
                    .filter(itemObj => itemObj.code === 200 && itemObj.body)
                    .map(itemObj => itemObj.body);

                // Consulta os custos em paralelo para acelerar lotes grandes,
                // sem alterar o carregamento normal dos anúncios.
                const concorrencia = 20;
                for (let j = 0; j < itensValidos.length; j += concorrencia) {
                    const grupo = itensValidos.slice(j, j + concorrencia);
                    const resultados = await Promise.all(
                        grupo.map(async body => {
                            const freeShipping = Boolean(body.shipping?.free_shipping);
                            const custoEnvio = await calcularFreteExato(body, token);
                            return { body, freeShipping, custoEnvio };
                        })
                    );

                    for (const { body, freeShipping, custoEnvio } of resultados) {
                        fretesMap[body.id] = {
                            custo: custoEnvio,
                            shipping_cost: custoEnvio,
                            gratis: freeShipping,
                            free_shipping: freeShipping
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
   V35 — ATUALIZAÇÃO DE PREÇOS ROBUSTA
========================================================= */

const esperarV35 = ms => new Promise(resolve => setTimeout(resolve, ms));
let precoCooldownAteV35 = 0;

function statusItemPtV35(status){
    const mapa={
        active:'ativo',
        paused:'pausado',
        closed:'encerrado/finalizado',
        inactive:'inativo',
        under_review:'em revisão pelo Mercado Livre',
        payment_required:'aguardando regularização de pagamento'
    };
    return mapa[String(status||'').toLowerCase()]||String(status||'desconhecido');
}

function motivoBloqueioStatusV35(status){
    const st=String(status||'').toLowerCase();

    if(st==='under_review'){
        return 'O anúncio está em revisão pelo Mercado Livre. Enquanto a revisão não terminar, o preço não pode ser alterado pela API.';
    }
    if(st==='closed'){
        return 'O anúncio está encerrado/finalizado no Mercado Livre. Anúncios encerrados não permitem alteração de preço.';
    }
    if(st==='paused'){
        return 'O anúncio está pausado. O Mercado Livre não permite alterar o preço desse anúncio por este processo enquanto ele estiver pausado.';
    }
    if(st==='inactive'){
        return 'O anúncio está inativo. O preço não pode ser alterado enquanto ele estiver nesse estado.';
    }
    if(st==='payment_required'){
        return 'O anúncio está bloqueado aguardando regularização de pagamento. O preço não pode ser alterado enquanto esse bloqueio existir.';
    }

    if(st==='active'){
        return 'O anúncio está ativo, mas o Mercado Livre marcou o preço como não editável neste momento. Isso pode acontecer por revisão/moderação, promoção ou automatização de preço, catálogo ou outra restrição temporária da publicação.';
    }

    return `O anúncio está com status "${statusItemPtV35(status)}" e o Mercado Livre não permite alterar o preço nesse estado.`;
}

function traduzirErroPrecoV35({httpStatus,codigo,mensagem,itemStatus,dynamicPricing=false}){
    const code=String(codigo||'').toLowerCase();
    const msg=String(mensagem||'');
    const lower=msg.toLowerCase();
    const status=String(itemStatus||'').toLowerCase();

    if(httpStatus===429 || code==='too_many_requests' || lower.includes('too many requests') || lower.includes('quota exceeded')){
        return {
            tipo:'temporario',
            retryable:true,
            mensagem:'O Mercado Livre limitou temporariamente a quantidade de alterações de preço. O sistema aguardou e tentou novamente automaticamente, mas o limite ainda estava ativo. Aguarde alguns minutos e tente somente os anúncios restantes.'
        };
    }

    if(dynamicPricing || lower.includes('dynamic pricing')){
        return {
            tipo:'bloqueio',
            retryable:false,
            mensagem:'Este anúncio está com Automatização de Preços configurada no Mercado Livre. O Mercado Livre bloqueia a alteração manual do preço pela API enquanto essa automatização estiver ativa.'
        };
    }

    if(code==='item.price.not_modifiable' || lower.includes('cannot update item') || lower.includes('price.not_modifiable')){
        if(status){
            return {
                tipo:'bloqueio',
                retryable:false,
                mensagem:motivoBloqueioStatusV35(status)
            };
        }

        const statusMatch=lower.match(/status\s*:\s*([a-z_]+)/i);
        if(statusMatch?.[1]){
            return {
                tipo:'bloqueio',
                retryable:false,
                mensagem:motivoBloqueioStatusV35(statusMatch[1])
            };
        }

        return {
            tipo:'bloqueio',
            retryable:false,
            mensagem:'O Mercado Livre bloqueou a edição do preço deste anúncio. Isso pode acontecer quando o anúncio está em revisão, encerrado, inativo ou possui uma regra de preço que impede edição pela API.'
        };
    }

    if(httpStatus===401 || code==='unauthorized' || code==='invalid_token'){
        return {
            tipo:'autenticacao',
            retryable:false,
            mensagem:'A autorização da conta do Mercado Livre expirou ou não é válida. Reconecte a conta antes de tentar atualizar os preços.'
        };
    }

    if(httpStatus===403 || code==='forbidden'){
        return {
            tipo:'permissao',
            retryable:false,
            mensagem:'O Mercado Livre recusou a alteração porque a conta ou o aplicativo não possui permissão para editar esse anúncio.'
        };
    }

    if(httpStatus===404 || code==='not_found' || code==='item_not_found'){
        return {
            tipo:'bloqueio',
            retryable:false,
            mensagem:'O anúncio não foi encontrado pelo Mercado Livre ou não pertence mais à conta conectada.'
        };
    }

    if([500,502,503,504].includes(Number(httpStatus))){
        return {
            tipo:'temporario',
            retryable:true,
            mensagem:'O Mercado Livre apresentou uma instabilidade temporária ao alterar este preço. O sistema tentou novamente automaticamente, mas a API continuou indisponível.'
        };
    }

    if(httpStatus===400){
        return {
            tipo:'validacao',
            retryable:false,
            mensagem:'O Mercado Livre recusou esse novo preço por uma regra de validação do anúncio. Verifique o estado do anúncio, promoções ativas, automatização de preços e os limites permitidos para o valor.'
        };
    }

    return {
        tipo:'erro',
        retryable:false,
        mensagem:msg
            ? `O Mercado Livre recusou a atualização. Detalhe recebido: ${msg}`
            : 'O Mercado Livre recusou a atualização do preço sem informar um motivo detalhado.'
    };
}

async function esperarCooldownPrecoV35(){
    const restante=precoCooldownAteV35-Date.now();
    if(restante>0)await esperarV35(restante);
}

async function atualizarPrecoItemV35(item,token,meta={}){
    const maxTentativas=Math.max(3,Math.min(6,Number(process.env.ML_PRICE_UPDATE_RETRIES||5)));
    let ultimo=null;

    for(let tentativa=1;tentativa<=maxTentativas;tentativa++){
        await esperarCooldownPrecoV35();

        try{
            const mlRes=await mlFetch(
                `${ML_API}/items/${item.id}`,
                token,
                {
                    method:'PUT',
                    headers:{'Content-Type':'application/json'},
                    body:JSON.stringify({price:Number(item.price)})
                }
            );

            const mlData=await jsonSeguro(mlRes);

            const warning=(Array.isArray(mlData?.warnings)?mlData.warnings:[])
                .find(w=>String(w?.code||'').toLowerCase()==='item.price.not_modifiable');

            if(mlRes.ok && !warning){
                return {
                    id:item.id,
                    sucesso:true,
                    requested_price:Number(item.price),
                    price:Number(mlData?.price ?? item.price),
                    http_status:mlRes.status,
                    tentativas:tentativa
                };
            }

            const codigo=
                warning?.code ||
                mlData?.cause?.[0]?.code ||
                mlData?.error ||
                null;

            const mensagemOriginal=
                warning?.message ||
                mlData?.message ||
                formatarErroMercadoLivre(mlData) ||
                `HTTP ${mlRes.status}`;

            const traduzido=traduzirErroPrecoV35({
                httpStatus:mlRes.status,
                codigo,
                mensagem:mensagemOriginal,
                itemStatus:meta.status,
                dynamicPricing:Boolean(meta.dynamicPricing)
            });

            ultimo={
                id:item.id,
                sucesso:false,
                requested_price:Number(item.price),
                http_status:mlRes.status,
                codigo,
                erro:traduzido.mensagem,
                erro_tecnico:mensagemOriginal,
                tipo_falha:traduzido.tipo,
                retryable:Boolean(traduzido.retryable),
                tentativas:tentativa
            };

            if(!traduzido.retryable || tentativa>=maxTentativas){
                return ultimo;
            }

            const retryAfter=Number(mlRes.headers.get('retry-after')||0);
            const espera=retryAfter>0
                ? Math.min(30000,retryAfter*1000)
                : Math.min(15000,1200*Math.pow(2,tentativa-1));

            if(mlRes.status===429){
                precoCooldownAteV35=Math.max(precoCooldownAteV35,Date.now()+espera);
            }

            await esperarV35(espera);
        }catch(err){
            ultimo={
                id:item.id,
                sucesso:false,
                requested_price:Number(item.price),
                http_status:null,
                codigo:'connection_error',
                erro:'Houve uma falha temporária de conexão entre o servidor e o Mercado Livre. O sistema tentou novamente automaticamente.',
                erro_tecnico:String(err?.message||err),
                tipo_falha:'temporario',
                retryable:true,
                tentativas:tentativa
            };

            if(tentativa>=maxTentativas)return ultimo;
            await esperarV35(Math.min(10000,1000*Math.pow(2,tentativa-1)));
        }
    }

    return ultimo;
}

/* =========================================================
   5. ROTA ORIGINAL - ATUALIZAÇÃO EM LOTE
========================================================= */

app.post('/api/atualizar-precos', async (req, res) => {
    const token=obterToken(req);

    if(!token){
        return res.status(401).json({erro:'Token não fornecido'});
    }

    const itens=Array.isArray(req.body?.itens)?req.body.itens:[];

    if(!itens.length){
        return res.status(400).json({
            erro:'Nenhum item informado para atualização em lote.'
        });
    }

    try{
        const metaPorId=new Map();

        if(db){
            try{
                const ids=itens.map(x=>String(x.id));
                const r=await dbQuery(`
                    SELECT item_id,status,raw
                    FROM ml_items
                    WHERE item_id=ANY($1::text[])
                `,[ids]);

                for(const row of r.rows){
                    const tags=Array.isArray(row?.raw?.tags)?row.raw.tags:[];
                    metaPorId.set(String(row.item_id),{
                        status:String(row.status||''),
                        dynamicPricing:tags.includes('dynamic_standard_price')
                    });
                }
            }catch(e){
                console.warn('[PREÇO V35 META]',e.message);
            }
        }

        const resultados=new Array(itens.length);
        const concorrencia=Math.max(1,Math.min(3,Number(process.env.ML_PRICE_UPDATE_CONCURRENCY||2)));
        const intervalo=Math.max(250,Math.min(2000,Number(process.env.ML_PRICE_UPDATE_DELAY_MS||450)));
        let cursor=0;

        async function worker(){
            while(true){
                const idx=cursor++;
                if(idx>=itens.length)return;

                const item=itens[idx];
                const meta=metaPorId.get(String(item.id))||{};
                const status=String(meta.status||'').toLowerCase();

                if(status && status!=='active'){
                    resultados[idx]={
                        id:item.id,
                        sucesso:false,
                        requested_price:Number(item.price),
                        http_status:400,
                        codigo:'item.price.not_modifiable',
                        erro:motivoBloqueioStatusV35(status),
                        erro_tecnico:`status:${status}`,
                        tipo_falha:'bloqueio',
                        retryable:false,
                        bloqueado:true,
                        tentativas:0
                    };
                    continue;
                }

                if(meta.dynamicPricing){
                    resultados[idx]={
                        id:item.id,
                        sucesso:false,
                        requested_price:Number(item.price),
                        http_status:400,
                        codigo:'item.price.not_modifiable',
                        erro:'Este anúncio está com Automatização de Preços configurada no Mercado Livre. O preço não pode ser alterado manualmente pela API enquanto essa automatização estiver ativa.',
                        erro_tecnico:'dynamic_standard_price',
                        tipo_falha:'bloqueio',
                        retryable:false,
                        bloqueado:true,
                        tentativas:0
                    };
                    continue;
                }

                resultados[idx]=await atualizarPrecoItemV35(item,token,meta);
                await esperarV35(intervalo);
            }
        }

        await Promise.all(
            Array.from({length:Math.min(concorrencia,itens.length)},()=>worker())
        );

        try{
            if(db){
                const sucessos=resultados.filter(x=>x?.sucesso);
                const mapaPreco=new Map(itens.map(x=>[String(x.id),Number(x.price||0)]));

                if(sucessos.length){
                    const params=[];
                    const values=[];

                    sucessos.forEach(x=>{
                        const base=params.length;
                        params.push(String(x.id),mapaPreco.get(String(x.id)));
                        values.push(`($${base+1}::text,$${base+2}::numeric)`);
                    });

                    await dbQuery(`
                        UPDATE ml_items AS m SET
                          price=v.price,
                          net_received=GREATEST(0,v.price-m.sale_fee-m.shipping_cost),
                          freight_synced_at=NULL,
                          freight_last_attempt_at=NULL,
                          synced_at=NOW()
                        FROM (VALUES ${values.join(',')}) AS v(item_id,price)
                        WHERE m.item_id=v.item_id
                    `,params);
                }
            }
        }catch(e){
            console.warn('[DB PREÇOS]',e.message);
        }

        res.json({
            sucesso:true,
            resultados,
            resumo:{
                total:resultados.length,
                atualizados:resultados.filter(x=>x?.sucesso).length,
                bloqueados:resultados.filter(x=>x?.bloqueado).length,
                temporarios:resultados.filter(x=>!x?.sucesso&&x?.tipo_falha==='temporario').length,
                falhas:resultados.filter(x=>!x?.sucesso).length
            }
        });
    }catch(err){
        res.status(500).json({
            erro:'Erro ao atualizar preços: '+err.message
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
 * Busca os 10 anúncios com maior quantidade vendida na conta.
 * Usa a ordenação sold_quantity_desc do endpoint oficial do vendedor
 * e depois consulta os detalhes dos itens com o token proprietário.
 */
async function montarTop10PorPedidosPagos(token,pedidos){
    const mapa=new Map();

    for(const pedido of (Array.isArray(pedidos)?pedidos:[])){
        if(String(pedido?.status||'').toLowerCase()!=='paid')continue;

        for(const oi of (Array.isArray(pedido?.order_items)?pedido.order_items:[])){
            const item=oi?.item||{};
            const id=String(item.id||'').trim();
            if(!id)continue;

            const quantidade=Number(oi.quantity||0);
            const unitPrice=Number(oi.unit_price||0);

            if(!mapa.has(id)){
                mapa.set(id,{
                    item_id:id,
                    titulo:item.title||id,
                    unidades:0,
                    faturamento:0
                });
            }

            const reg=mapa.get(id);
            reg.unidades+=quantidade;
            reg.faturamento+=quantidade*unitPrice;
        }
    }

    const ranking=[...mapa.values()]
      .filter(x=>x.unidades>0)
      .sort((a,b)=>b.unidades-a.unidades || b.faturamento-a.faturamento)
      .slice(0,10);

    if(!ranking.length)return [];

    const detalhes=await buscarItensBulk(token,ranking.map(x=>x.item_id));

    return ranking.map(item=>{
        const detalhe=detalhes[item.item_id]||{};
        return {
            item_id:item.item_id,
            titulo:detalhe.title||item.titulo||item.item_id,
            unidades:Number(item.unidades||0),
            faturamento:Number(Number(item.faturamento||0).toFixed(2)),
            preco_atual:Number(detalhe.price||0),
            thumbnail:detalhe.thumbnail||detalhe.secure_thumbnail||'',
            permalink:detalhe.permalink||'#',
            status:detalhe.status||''
        };
    });
}

/**
 * Top 10 por vendas reais.
 * A API de orders conserva os pedidos por até 12 meses; usamos somente orders
 * pagas e somamos quantity + unit_price de cada anúncio.
 */
async function buscarTop10MaisVendidosDaConta(token,sellerId){
    const pedidos=await buscarPedidosDoVendedor(token,sellerId);
    return montarTop10PorPedidosPagos(token,pedidos);
}

/**
 * GET /api/v22/top10
 * Ranking rápido e independente do dashboard completo.
 */
async function responderTop10V23(req,res){
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    try{
        const me=await usuarioML(token);
        const sellerId=me.id;
        let top10=[];
        let fonte='pedidos_pagos_12_meses';

        try{
            top10=await buscarTop10MaisVendidosDaConta(token,sellerId);
        }catch(e){
            console.warn('[TOP10 V23 PEDIDOS]',e.message);
        }

        // Fallback somente se a busca de pedidos não retornar ranking.
        if((!Array.isArray(top10)||!top10.length) && db){
            const r=await dbQuery(`
              SELECT item_id,title,price::float8 price,sold_quantity,thumbnail,permalink,status
              FROM ml_items
              WHERE seller_id=$1 AND sold_quantity>0
              ORDER BY sold_quantity DESC,item_id
              LIMIT 10
            `,[sellerId]);

            if(r.rows.length){
                fonte='postgresql_fallback';
                top10=r.rows.map(item=>({
                    item_id:item.item_id,
                    titulo:item.title||item.item_id,
                    unidades:Number(item.sold_quantity||0),
                    faturamento:Number(item.sold_quantity||0)*Number(item.price||0),
                    preco_atual:Number(item.price||0),
                    thumbnail:item.thumbnail||'',
                    permalink:item.permalink||'#',
                    status:item.status||''
                }));
            }
        }

        res.set('Cache-Control','no-store');
        return res.json({
            sucesso:true,
            fonte,
            periodo:'ultimos_12_meses',
            total:top10.length,
            top10
        });
    }catch(e){
        console.error('[TOP10 V23]',e);
        return respostaErro(res,500,'Erro ao buscar Top 10: '+e.message);
    }
}

app.get('/api/v23/top10',responderTop10V23);
// Compatibilidade com o index anterior durante o deploy.
app.get('/api/v22/top10',responderTop10V23);

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

        // Visitas recentes da conta. O recurso oficial retorna total_visits
        // por janela diária para os anúncios do vendedor.
        let visitasDia = { total: null, periodo: 'Visitas do dia' };
        try {
            const vr = await mlFetch(
                `${ML_API}/users/${sellerId}/items_visits/time_window?last=1&unit=day`,
                token
            );
            const vd = await jsonSeguro(vr);
            if (vr.ok) {
                visitasDia = {
                    total: Number(vd?.total_visits ?? 0),
                    periodo: vd?.date_from && vd?.date_to
                        ? `${new Date(vd.date_from).toLocaleDateString('pt-BR')} · janela diária`
                        : 'Janela diária da API'
                };
            }
        } catch (e) {
            console.warn('[DASHBOARD VISITAS]', e.message);
        }

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

        // Top 10 real do período: soma unidades e faturamento dos pedidos pagos.
        // Reaproveita os pedidos que o dashboard já buscou, sem fazer outra varredura.
        let top10;

        try {
            top10 = await montarTop10PorPedidosPagos(
                token,
                pedidosPagos
            );
        } catch (erroTop10) {
            console.warn('[TOP10 DASHBOARD V23]', erroTop10.message);
            top10 = Object.values(vendasPorItem)
                .sort((a, b) => b.unidades - a.unidades || b.faturamento - a.faturamento)
                .slice(0, 10)
                .map(item => {
                    const detalhe = itensDetalhes[item.item_id];
                    return {
                        ...item,
                        titulo: detalhe?.title || item.titulo,
                        preco_atual: Number(detalhe?.price || 0),
                        thumbnail: detalhe?.thumbnail || detalhe?.secure_thumbnail || '',
                        permalink: detalhe?.permalink || '#',
                        status: detalhe?.status || ''
                    };
                });
        }

        // PostgreSQL é fallback. A consulta direta ao Mercado Livre acima
        // é priorizada para o ranking ficar atualizado no clique.
        if (!Array.isArray(top10) || top10.length === 0) {
            try {
                if (db) {
                    const rankDb = await dbQuery(`
                        SELECT item_id,title,price::float8 price,sold_quantity,thumbnail,permalink,status
                        FROM ml_items
                        WHERE seller_id=$1 AND sold_quantity>0
                        ORDER BY sold_quantity DESC, item_id
                        LIMIT 10
                    `,[sellerId]);
                    if (rankDb.rows.length) {
                        top10 = rankDb.rows.map(item => ({
                            item_id:item.item_id,
                            titulo:item.title || item.item_id,
                            unidades:Number(item.sold_quantity||0),
                            faturamento:Number(item.sold_quantity||0)*Number(item.price||0),
                            preco_atual:Number(item.price||0),
                            thumbnail:item.thumbnail||'',
                            permalink:item.permalink||'#',
                            status:item.status||''
                        }));
                    }
                }
            } catch (e) {
                console.warn('[TOP10 DB FALLBACK]', e.message);
            }
        }


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

            visitas_dia: visitasDia,

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

async function mapLimitV21(lista,limite,fn){
    const saida=new Array(lista.length);
    let cursor=0;
    async function worker(){
        while(true){
            const i=cursor++;
            if(i>=lista.length)return;
            try{saida[i]=await fn(lista[i],i)}
            catch(e){saida[i]=null}
        }
    }
    await Promise.all(Array.from({length:Math.min(limite,Math.max(1,lista.length))},()=>worker()));
    return saida;
}

app.get('/api/v21/pedidos', async (req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    try{
        const me=await usuarioML(token);
        const page=Math.max(1,Number(req.query.page||1));
        const limit=Math.min(50,Math.max(10,Number(req.query.limit||30)));
        const offset=(page-1)*limit;
        const params=new URLSearchParams({
            seller:String(me.id),
            sort:'date_desc',
            offset:String(offset),
            limit:String(limit)
        });
        const or=await mlFetch(`${ML_API}/orders/search?${params.toString()}`,token);
        const od=await jsonSeguro(or);
        if(!or.ok)return respostaErro(res,or.status,formatarErroMercadoLivre(od));

        const orders=Array.isArray(od?.results)?od.results:[];
        const enriquecidos=await mapLimitV21(orders,8,async order=>{
            let shipment=null;
            try{
                const sr=await mlFetch(`${ML_API}/orders/${order.id}/shipments`,token,{
                    headers:{'x-format-new':'true'}
                });
                const sd=await jsonSeguro(sr);
                if(sr.ok)shipment=sd;
            }catch(e){}

            const shipmentStatus=String(shipment?.status||order?.shipping?.status||'').toLowerCase();
            const orderStatus=String(order?.status||'').toLowerCase();
            let situacao='em_andamento';
            if(orderStatus==='cancelled'||orderStatus==='canceled'||shipmentStatus==='cancelled')situacao='cancelado';
            else if(shipmentStatus==='delivered')situacao='entregue';
            else if(orderStatus!=='paid'||['pending','ready_to_ship','handling'].includes(shipmentStatus))situacao='pendente';

            return {
                id:order.id,
                date_created:order.date_created,
                date_closed:order.date_closed,
                status:order.status,
                status_detail:order.status_detail,
                total_amount:Number(order.total_amount||order.paid_amount||0),
                paid_amount:Number(order.paid_amount||0),
                currency_id:order.currency_id||'BRL',
                buyer:{
                    id:order.buyer?.id||null,
                    nickname:order.buyer?.nickname||''
                },
                items:(order.order_items||[]).map(oi=>({
                    id:oi.item?.id||'',
                    title:oi.item?.title||oi.item?.id||'Produto',
                    quantity:Number(oi.quantity||0),
                    unit_price:Number(oi.unit_price||0)
                })),
                shipping:{
                    id:shipment?.id||order?.shipping?.id||null,
                    status:shipment?.status||order?.shipping?.status||null,
                    substatus:shipment?.substatus||order?.shipping?.substatus||null
                },
                situacao
            };
        });

        const pedidos=enriquecidos.filter(Boolean);
        const total=Number(od?.paging?.total||0);
        res.json({
            sucesso:true,
            pagina:page,
            limite:limit,
            total,
            paginas:Math.max(1,Math.ceil(total/limit)),
            pedidos
        });
    }catch(e){
        console.error('[PEDIDOS V21]',e);
        respostaErro(res,500,'Erro ao buscar pedidos: '+e.message);
    }
});

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

    const { id, title, sku, available_quantity } = req.body || {};

    if (!id) {
        return respostaErro(res, 400, 'ID do anúncio não informado.');
    }

    const tituloLimpo = String(title ?? '').trim();
    const skuLimpo = String(sku ?? '').trim();
    const estoqueNovo = Number(available_quantity);

    if (!Number.isInteger(estoqueNovo) || estoqueNovo < 0) {
        return respostaErro(res, 400, 'Quantidade de estoque inválida. Informe um número inteiro igual ou maior que zero.');
    }

    if (!tituloLimpo) {
        return respostaErro(res, 400, 'O título do anúncio não pode ficar vazio.');
    }

    if (tituloLimpo.length > 60) {
        return respostaErro(res, 400, 'O título não pode ultrapassar 60 caracteres.');
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
        const estoqueAtual = Number(atual.available_quantity || 0);
        const alterouEstoque = estoqueNovo !== estoqueAtual;

        if (!alterouSku && !alterouTitulo && !alterouEstoque) {
            return res.json({
                sucesso: true,
                alterou: false,
                item: {
                    id: atual.id || id,
                    title: tituloAtual,
                    sku: skuAtual || 'Sem SKU',
                    status: atual.status,
                    sold_quantity: Number(atual.sold_quantity || 0),
                    available_quantity: Number(atual.available_quantity || 0)
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

        // Estoque é atualizado isoladamente para não misturar a alteração com título/SKU.
        if (alterouEstoque) {
            const estoqueRes = await mlFetch(
                `${ML_API}/items/${encodeURIComponent(id)}`,
                token,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ available_quantity: estoqueNovo })
                }
            );
            const estoqueData = await jsonSeguro(estoqueRes);
            if (!estoqueRes.ok) {
                return respostaErro(
                    res,
                    estoqueRes.status || 400,
                    formatarErroMercadoLivre(estoqueData) || 'O Mercado Livre recusou a alteração do estoque.'
                );
            }
            ultimoRetorno = estoqueData;
            alteracoes.push('estoque');
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
                        sold_quantity: Number(atual.sold_quantity || 0),
                        available_quantity: Number(atual.available_quantity || 0)
                    }
                });
            }

            // Existem hoje dois modelos de publicação no Mercado Livre.
            // No modelo legado, o título é editado diretamente em /items/{id}.
            // No novo modelo User Products, o campo title do item é gerado pelo
            // Mercado Livre e tentar alterá-lo diretamente retorna BODY_INVALID_FIELDS.
            // Nesse caso alteramos o family_name da família, que é o campo editável
            // indicado pela API e provoca o recálculo do título dos itens associados.
            let tituloRes;
            let tituloData;

            if (atual.user_product_id) {
                const upRes = await mlFetch(
                    `${ML_API}/user-products/${encodeURIComponent(atual.user_product_id)}`,
                    token
                );
                const upData = await jsonSeguro(upRes);

                if (!upRes.ok || !upData?.family_id) {
                    return res.status(upRes.status || 400).json({
                        sucesso: false,
                        parcial: alterouSku,
                        sku_atualizado: alterouSku,
                        erro: (alterouSku ? 'O SKU foi atualizado, porém não foi possível localizar a família do anúncio: ' : '') +
                            (formatarErroMercadoLivre(upData) || 'Família do User Product não encontrada.'),
                        item: {
                            id: atual.id || id,
                            title: tituloAtual,
                            sku: skuLimpo || skuAtual || 'Sem SKU',
                            status: atual.status,
                            sold_quantity: Number(atual.sold_quantity || 0)
                        }
                    });
                }

                tituloRes = await mlFetch(
                    `${ML_API}/user-products-families/${encodeURIComponent(upData.family_id)}`,
                    token,
                    {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify({ family_name: tituloLimpo })
                    }
                );
                tituloData = await jsonSeguro(tituloRes);
            } else {
                tituloRes = await mlFetch(
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
                tituloData = await jsonSeguro(tituloRes);
            }

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
                        sold_quantity: Number(atual.sold_quantity || 0),
                        available_quantity: Number(atual.available_quantity || 0)
                    }
                });
            }

            ultimoRetorno = tituloData;
            alteracoes.push(atual.user_product_id ? 'nome da família/título' : 'título');
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
                title: atual.user_product_id
                    ? (finalItem.family_name || tituloLimpo)
                    : (finalItem.title || tituloLimpo),
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



/* =========================================================
   ALTERAR STATUS DO ANÚNCIO - PAUSAR / ATIVAR
========================================================= */
app.put('/api/alterar-status-anuncio', async (req, res) => {
    const token = obterToken(req);
    if (!token) return respostaErro(res, 401, 'Token não fornecido.');

    const { id, status } = req.body || {};
    if (!id) return respostaErro(res, 400, 'ID do anúncio não informado.');
    if (!['active', 'paused'].includes(status)) {
        return respostaErro(res, 400, 'Status inválido. Use active ou paused.');
    }

    try {
        const mlRes = await mlFetch(`${ML_API}/items/${encodeURIComponent(id)}`, token, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ status })
        });
        const mlData = await jsonSeguro(mlRes);
        if (!mlRes.ok) {
            return respostaErro(res, mlRes.status || 400, formatarErroMercadoLivre(mlData) || 'O Mercado Livre recusou a alteração de status.');
        }
        return res.json({
            sucesso: true,
            item: {
                id: mlData.id || id,
                status: mlData.status || status,
                available_quantity: Number(mlData.available_quantity || 0)
            }
        });
    } catch (error) {
        console.error('Erro ao alterar status:', error);
        return respostaErro(res, 500, 'Erro de conexão ao alterar status: ' + error.message);
    }
});


/* =========================================================
   ML HUB PRO V2 - ESCALA / 100 MIL+ ANÚNCIOS
   - paginação server-side
   - busca por scan/scroll para sincronização grande
   - filtros
   - operações em massa em lotes controlados
   - alertas operacionais
   - webhook de notificações
========================================================= */

function normalizarItemGestao(item) {
    const attrs = Array.isArray(item.attributes) ? item.attributes : [];
    const skuAttr = attrs.find(a =>
        ['SELLER_SKU', 'SKU'].includes(String(a.id || '').toUpperCase())
    );
    return {
        id: item.id,
        titulo: item.title || '',
        sku: item.seller_custom_field || skuAttr?.value_name || '',
        preco: Number(item.price || 0),
        estoque: Number(item.available_quantity || 0),
        vendidos: Number(item.sold_quantity || 0),
        status: item.status || '',
        listing_type_id: item.listing_type_id || '',
        categoria: item.category_id || '',
        thumbnail: item.thumbnail || item.secure_thumbnail || '',
        permalink: item.permalink || '',
        atualizado_em: item.last_updated || null
    };
}

async function buscarIdsAnunciosPaginados(token, sellerId, { offset=0, limit=100, status='', q='', order='last_updated_desc' }={}) {
    const params = new URLSearchParams({
        offset: String(Math.max(0, Number(offset) || 0)),
        limit: String(Math.min(100, Math.max(1, Number(limit) || 100)))
    });
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    if (order) params.set('orders', order);

    const response = await mlFetch(`${ML_API}/users/${sellerId}/items/search?${params}`, token);
    const data = await jsonSeguro(response);
    if (!response.ok) throw new Error(formatarErroMercadoLivre(data));
    return data;
}

app.get('/api/v2/anuncios', async (req, res) => {
    const token = obterToken(req);
    if (!token) return respostaErro(res, 401, 'Token não fornecido.');

    try {
        const meRes = await mlFetch(`${ML_API}/users/me`, token);
        const me = await jsonSeguro(meRes);
        if (!meRes.ok || !me?.id) return respostaErro(res, 401, 'Token inválido ou expirado.');

        const pagina = Math.max(1, Number(req.query.page || 1));
        const limit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
        const offset = (pagina - 1) * limit;
        const status = String(req.query.status || '').trim();
        const q = String(req.query.q || '').trim();
        const order = String(req.query.order || 'last_updated_desc').trim();

        // Offset é ideal para navegação comum. Sincronizações acima de 1000 usam /api/v2/sync/scan.
        const busca = await buscarIdsAnunciosPaginados(token, me.id, { offset, limit, status, q, order });
        const ids = Array.isArray(busca.results) ? busca.results : [];
        const detalhes = await buscarItensBulk(token, ids);
        const itens = ids.map(id => detalhes[id]).filter(Boolean).map(normalizarItemGestao);

        res.json({
            sucesso: true,
            pagina,
            limite: limit,
            total: Number(busca.paging?.total || itens.length),
            paginas: Math.max(1, Math.ceil(Number(busca.paging?.total || itens.length) / limit)),
            itens
        });
    } catch (erro) {
        respostaErro(res, 500, 'Erro ao listar anúncios: ' + erro.message);
    }
});

app.get('/api/v2/sync/scan', async (req, res) => {
    const token = obterToken(req);
    if (!token) return respostaErro(res, 401, 'Token não fornecido.');

    try {
        const meRes = await mlFetch(`${ML_API}/users/me`, token);
        const me = await jsonSeguro(meRes);
        if (!meRes.ok || !me?.id) return respostaErro(res, 401, 'Token inválido ou expirado.');

        const limit = Math.min(100, Math.max(10, Number(req.query.limit || 100)));
        const scrollId = String(req.query.scroll_id || '').trim();
        const params = new URLSearchParams({ search_type: 'scan', limit: String(limit) });
        if (scrollId) params.set('scroll_id', scrollId);

        const mlRes = await mlFetch(`${ML_API}/users/${me.id}/items/search?${params}`, token);
        const data = await jsonSeguro(mlRes);
        if (!mlRes.ok) return respostaErro(res, mlRes.status, formatarErroMercadoLivre(data));

        const ids = Array.isArray(data.results) ? data.results : [];
        const detalhes = await buscarItensBulk(token, ids);
        res.json({
            sucesso: true,
            scroll_id: data.scroll_id || null,
            terminou: ids.length === 0,
            quantidade: ids.length,
            itens: ids.map(id => detalhes[id]).filter(Boolean).map(normalizarItemGestao)
        });
    } catch (erro) {
        respostaErro(res, 500, 'Erro na sincronização por scan: ' + erro.message);
    }
});

app.post('/api/v2/anuncios/massa', async (req, res) => {
    const token = obterToken(req);
    if (!token) return respostaErro(res, 401, 'Token não fornecido.');

    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter(Boolean))];
    const acao = String(req.body?.acao || '').trim();
    const valor = req.body?.valor;

    if (!ids.length) return respostaErro(res, 400, 'Selecione ao menos um anúncio.');
    if (ids.length > 500) return respostaErro(res, 400, 'Envie no máximo 500 anúncios por lote.');
    if (!['pausar','ativar','estoque','preco_percentual'].includes(acao)) {
        return respostaErro(res, 400, 'Ação em massa inválida.');
    }

    const resultados = [];
    const concorrencia = 5;
    for (let i=0; i<ids.length; i+=concorrencia) {
        const grupo = ids.slice(i, i+concorrencia);
        const lote = await Promise.all(grupo.map(async id => {
            try {
                let body;
                if (acao === 'pausar') body = { status: 'paused' };
                if (acao === 'ativar') body = { status: 'active' };
                if (acao === 'estoque') body = { available_quantity: Math.max(0, Number(valor || 0)) };
                if (acao === 'preco_percentual') {
                    const itemRes = await mlFetch(`${ML_API}/items/${id}`, token);
                    const item = await jsonSeguro(itemRes);
                    if (!itemRes.ok) throw new Error(formatarErroMercadoLivre(item));
                    const percentual = Number(valor || 0);
                    body = { price: Number((Number(item.price || 0) * (1 + percentual/100)).toFixed(2)) };
                }
                const putRes = await mlFetch(`${ML_API}/items/${id}`, token, {
                    method: 'PUT',
                    headers: { 'Content-Type':'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await jsonSeguro(putRes);
                if (!putRes.ok) throw new Error(formatarErroMercadoLivre(data));
                return { id, sucesso:true, novo: body };
            } catch (erro) {
                return { id, sucesso:false, erro:erro.message };
            }
        }));
        resultados.push(...lote);
    }

    res.json({
        sucesso:true,
        total:resultados.length,
        concluidos:resultados.filter(x=>x.sucesso).length,
        erros:resultados.filter(x=>!x.sucesso).length,
        resultados
    });
});

app.get('/api/v2/alertas', async (req, res) => {
    const token = obterToken(req);
    if (!token) return respostaErro(res, 401, 'Token não fornecido.');
    try {
        const meRes = await mlFetch(`${ML_API}/users/me`, token);
        const me = await jsonSeguro(meRes);
        if (!meRes.ok || !me?.id) return respostaErro(res, 401, 'Token inválido ou expirado.');

        const busca = await buscarIdsAnunciosPaginados(token, me.id, { offset:0, limit:100, order:'last_updated_desc' });
        const ids = Array.isArray(busca.results) ? busca.results : [];
        const detalhes = await buscarItensBulk(token, ids);
        const itens = ids.map(id=>detalhes[id]).filter(Boolean).map(normalizarItemGestao);

        const alertas = [];
        itens.forEach(i => {
            if (i.status === 'active' && i.estoque <= 0) alertas.push({tipo:'estoque_zero', nivel:'alto', item_id:i.id, titulo:i.titulo, mensagem:'Anúncio ativo sem estoque.'});
            else if (i.status === 'active' && i.estoque <= 3) alertas.push({tipo:'estoque_critico', nivel:'medio', item_id:i.id, titulo:i.titulo, mensagem:`Estoque crítico: ${i.estoque} unidade(s).`});
            if (!i.sku) alertas.push({tipo:'sem_sku', nivel:'baixo', item_id:i.id, titulo:i.titulo, mensagem:'Anúncio sem SKU identificado.'});
        });

        res.json({sucesso:true, analisados:itens.length, total_conta:Number(busca.paging?.total||0), alertas:alertas.slice(0,100)});
    } catch (erro) {
        respostaErro(res,500,'Erro ao gerar alertas: '+erro.message);
    }
});

// Configure esta URL como callback de notificações no DevCenter.
// O endpoint responde imediatamente; em produção, encaminhe o evento para uma fila/worker persistente.
app.post('/api/notifications', (req, res) => {
    res.status(200).json({ recebido:true });
    const evento = req.body || {};
    setImmediate(async () => {
        console.log('[ML notification]', {topic:evento.topic,resource:evento.resource,user_id:evento.user_id,received:evento.received});
        try {
            if (db) await dbQuery(`INSERT INTO ml_notifications(external_id,seller_id,topic,resource,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
              [evento._id||evento.id||null,evento.user_id||null,String(evento.topic||''),String(evento.resource||''),evento]);
        } catch(e) { console.error('[ML notification queue]',e.message); }
    });
});



/* =========================================================
   ML HUB PRO SUITE V3
   Pós-venda, IA, Bling, auditoria e integrações
========================================================= */
const BLING_STORE_FILE = process.env.BLING_STORE_FILE || path.join(__dirname, 'bling-oauth-store.json');

function lerJsonArquivoSeguro(arquivo) {
    try { return JSON.parse(fs.readFileSync(arquivo,'utf8')); } catch(e) { return {}; }
}
function salvarJsonArquivoSeguro(arquivo, dados) {
    fs.writeFileSync(arquivo, JSON.stringify(dados,null,2), {encoding:'utf8',mode:0o600});
}
async function usuarioML(token) {
    const r=await mlFetch(`${ML_API}/users/me`,token);
    const d=await jsonSeguro(r);
    if(!r.ok||!d?.id) throw new Error('Não foi possível identificar a conta Mercado Livre.');
    return d;
}

app.get('/api/v3/claims', async (req,res)=>{
    const token=obterToken(req); if(!token)return respostaErro(res,401,'Token não fornecido.');
    try{
        const me=await usuarioML(token);
        const status=String(req.query.status||'opened');
        const params=new URLSearchParams({'players.user_id':String(me.id),'players.role':'respondent','limit':'30','offset':'0','sort':'last_updated:desc'});
        if(status)params.set('status',status);
        const r=await mlFetch(`${ML_API}/post-purchase/v1/claims/search?${params}`,token);
        const d=await jsonSeguro(r); if(!r.ok)return respostaErro(res,r.status,formatarErroMercadoLivre(d));
        const base=Array.isArray(d.data)?d.data:[];
        const enriquecidas=await Promise.all(base.slice(0,30).map(async c=>{
            try{const rd=await mlFetch(`${ML_API}/post-purchase/v1/claims/${c.id}/detail`,token);const dd=await jsonSeguro(rd);return {...c,due_date:rd.ok?dd.due_date:null,detail_title:rd.ok?dd.title:null};}catch(e){return c}
        }));
        res.json({sucesso:true,total:Number(d.paging?.total||base.length),reclamacoes:enriquecidas});
    }catch(e){respostaErro(res,500,'Erro ao consultar reclamações: '+e.message)}
});
app.get('/api/v3/claims/:id/impacto',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    try{const r=await mlFetch(`${ML_API}/post-purchase/v1/claims/${encodeURIComponent(req.params.id)}/affects-reputation`,token);const d=await jsonSeguro(r);if(!r.ok)return respostaErro(res,r.status,formatarErroMercadoLivre(d));res.json(d)}catch(e){respostaErro(res,500,e.message)}
});
app.get('/api/v3/bpp/case/:id',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    try{const r=await mlFetch(`${ML_API}/moderations/pppi/case/${encodeURIComponent(req.params.id)}`,token);const d=await jsonSeguro(r);if(!r.ok)return respostaErro(res,r.status,formatarErroMercadoLivre(d));res.json(d)}catch(e){respostaErro(res,500,e.message)}
});



app.get('/api/v10/claims/todas', async (req,res) => {
  const token=obterToken(req);
  if(!token) return respostaErro(res,401,'Token não fornecido.');
  try{
    const me=await usuarioML(token);
    if(!me?.id) return respostaErro(res,401,'Não foi possível identificar o vendedor do token.');

    const sellerId=String(me.id);
    const mapa=new Map();
    const diagnostico=[];

    async function buscarStatus(status){
      let offset=0, total=0, paginas=0;
      do{
        // Regra oficial: players.user_id + players.role, e offset + limit < 10000.
        const limit=50;
        if(offset + limit >= 10000) break;
        const qs=new URLSearchParams();
        qs.set('players.user_id',sellerId);
        qs.set('players.role','respondent');
        qs.set('status',status);
        qs.set('limit',String(limit));
        qs.set('offset',String(offset));

        const url=`${ML_API}/post-purchase/v1/claims/search?${qs.toString()}`;
        const rr=await mlFetch(url,token);
        const body=await jsonSeguro(rr);

        diagnostico.push({status,http:rr.status,offset,quantidade:Array.isArray(body?.data)?body.data.length:0});
        if(!rr.ok){
          const err=new Error(`Busca de reclamações ${status}: HTTP ${rr.status} - ${formatarErroMercadoLivre(body)}`);
          err.http=rr.status; throw err;
        }

        const dados=Array.isArray(body?.data)?body.data:[];
        for(const claim of dados) mapa.set(String(claim.id),claim);

        total=Number(body?.paging?.total || 0);
        paginas++;
        offset += dados.length;
        if(!dados.length || dados.length < limit || offset>=total) break;
      }while(paginas<200);
    }

    // Primeiro abertas: assim uma falha nas fechadas nunca impede as pendentes de aparecerem.
    await buscarStatus('opened');
    try{ await buscarStatus('closed'); }
    catch(e){ diagnostico.push({status:'closed',warning:e.message}); }

    const reclamacoes=[...mapa.values()].sort((x,y)=>
      new Date(y.last_updated||y.date_created||0)-new Date(x.last_updated||x.date_created||0)
    );

    return res.json({
      sucesso:true,
      seller_id:sellerId,
      total:reclamacoes.length,
      reclamacoes,
      diagnostico
    });
  }catch(e){
    console.error('[CLAIMS V15]',e);
    return respostaErro(res,e.http||500,e.message||'Erro ao consultar reclamações.');
  }
});

// Diagnóstico direto para testar a conexão com reclamações sem depender do frontend.
app.get('/api/v15/claims/diagnostico', async (req,res) => {
  const token=obterToken(req);
  if(!token) return respostaErro(res,401,'Token não fornecido.');
  try{
    const me=await usuarioML(token);
    const qs=new URLSearchParams({
      'players.user_id':String(me.id),
      'players.role':'respondent',
      'status':'opened',
      'limit':'30',
      'offset':'0'
    });
    const rr=await mlFetch(`${ML_API}/post-purchase/v1/claims/search?${qs.toString()}`,token);
    const body=await jsonSeguro(rr);
    return res.status(rr.ok?200:rr.status).json({
      sucesso:rr.ok,
      seller_id:String(me.id),
      mercado_livre_http:rr.status,
      total:Number(body?.paging?.total||0),
      quantidade:Array.isArray(body?.data)?body.data.length:0,
      reclamacoes:Array.isArray(body?.data)?body.data:[],
      erro:rr.ok?null:formatarErroMercadoLivre(body)
    });
  }catch(e){return respostaErro(res,500,e.message)}
});

app.get('/api/v9/claims/:id/dossie',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    const id=encodeURIComponent(req.params.id);
    try{
        const urls=[
          `${ML_API}/post-purchase/v1/claims/${id}`,
          `${ML_API}/post-purchase/v1/claims/${id}/detail`,
          `${ML_API}/post-purchase/v1/claims/${id}/messages`,
          `${ML_API}/post-purchase/v1/claims/${id}/affects-reputation`
        ];
        const rr=await Promise.all(urls.map(u=>mlFetch(u,token).then(async r=>({ok:r.ok,status:r.status,data:await jsonSeguro(r)}))));
        if(!rr[0].ok)return respostaErro(res,rr[0].status,formatarErroMercadoLivre(rr[0].data));
        const messages=rr[2].ok&&Array.isArray(rr[2].data)?rr[2].data:[];
        const attachments=[];
        messages.forEach(m=>(m.attachments||[]).forEach(a=>attachments.push({...a,message_date:m.date_created||m.message_date,sender_role:m.sender_role})));
        res.json({sucesso:true,claim:rr[0].data,detail:rr[1].ok?rr[1].data:{},messages,impact:rr[3].ok?rr[3].data:null,attachments});
    }catch(e){respostaErro(res,500,'Erro ao montar dossiê: '+e.message)}
});

app.get('/api/v9/claims/:id/attachments/:file',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    try{
        const u=`${ML_API}/post-purchase/v1/claims/${encodeURIComponent(req.params.id)}/attachments/${encodeURIComponent(req.params.file)}/download`;
        const r=await mlFetch(u,token);
        if(!r.ok){const d=await jsonSeguro(r);return respostaErro(res,r.status,formatarErroMercadoLivre(d))}
        const buf=Buffer.from(await r.arrayBuffer());
        res.setHeader('Content-Type',r.headers.get('content-type')||'application/octet-stream');
        res.setHeader('Cache-Control','private, max-age=60');
        res.send(buf);
    }catch(e){respostaErro(res,500,'Erro ao baixar anexo: '+e.message)}
});


const GEMINI_INTERACTIONS_URL='https://generativelanguage.googleapis.com/v1beta/interactions';

function modelosGeminiDisponiveis(){
    // Modelos atuais documentados pela API Gemini. Se o Render ainda tiver
    // GEMINI_MODEL antigo, ele é tentado primeiro e o fallback continua
    // automaticamente para os modelos atuais quando necessário.
    const configurado=String(process.env.GEMINI_MODEL||'').trim();
    const rapido=String(process.env.GEMINI_FAST_MODEL||'').trim();
    const modelos=[
      rapido,
      'gemini-3.8-flash',
      configurado,
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite'
    ].filter(Boolean);
    return [...new Set(modelos)];
}

function extrairTextoGemini(payload){
    const d=payload?.interaction||payload||{};
    if(typeof d.output_text==='string'&&d.output_text.trim())return d.output_text.trim();
    const textos=[];
    for(const step of (Array.isArray(d.steps)?d.steps:[])){
        if(step?.type!=='model_output')continue;
        for(const part of (Array.isArray(step.content)?step.content:[])){
            if(part?.type==='text'&&typeof part.text==='string')textos.push(part.text);
        }
    }
    return textos.join('\n').trim();
}

function erroGeminiAmigavel(status,payload){
    const msg=String(payload?.error?.message||payload?.message||'Erro ao consultar o Gemini.');
    if(status===400 && /api.?key|key/i.test(msg))return 'A chave GEMINI_API_KEY parece inválida. Confira a chave configurada no Render.';
    if(status===401 || status===403)return 'A chave do Gemini não tem permissão para esta solicitação. Confira GEMINI_API_KEY e o projeto no Google AI Studio.';
    if(status===429)return 'O nível gratuito do Gemini está temporariamente no limite. O sistema tentou outros modelos automaticamente.';
    if(status===503)return 'O Gemini está com alta demanda no momento. O sistema tentou outros modelos automaticamente.';
    if(status>=500)return 'O Gemini apresentou uma instabilidade temporária. O sistema tentou outros modelos automaticamente.';
    return msg;
}

function esperarGemini(ms){
    return new Promise(resolve=>setTimeout(resolve,ms));
}

function erroGeminiTransitorio(status){
    return status===408 || status===429 || status===500 || status===502 || status===503 || status===504;
}

async function chamarGeminiInteracao({input,systemInstruction='',responseSchema=null,tools=[]}){
    const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
    if(!apiKey){
        const e=new Error('IA não configurada. Adicione GEMINI_API_KEY nas variáveis de ambiente do Render.');
        e.status=503;throw e;
    }

    const modelos=modelosGeminiDisponiveis();
    const inicio=Date.now();
    const prazoTotalMs=80000;
    let ultimoErro=null;
    const tentativas=[];

    for(const model of modelos){
        for(let tentativa=1;tentativa<=2;tentativa++){
            const decorrido=Date.now()-inicio;
            const restante=prazoTotalMs-decorrido;
            if(restante<5000)break;

            const body={model,input,store:false};
            if(systemInstruction)body.system_instruction=systemInstruction;
            if(Array.isArray(tools)&&tools.length)body.tools=tools;
            if(responseSchema){
                body.response_format={
                    type:'text',
                    mime_type:'application/json',
                    schema:responseSchema
                };
            }

            const controller=new AbortController();
            const timeoutMs=Math.min(25000,Math.max(5000,restante-1000));
            const timer=setTimeout(()=>controller.abort(),timeoutMs);

            try{
                const r=await fetch(GEMINI_INTERACTIONS_URL,{
                    method:'POST',
                    headers:{
                        'Content-Type':'application/json',
                        'x-goog-api-key':apiKey,
                        'Api-Revision':'2026-05-20'
                    },
                    body:JSON.stringify(body),
                    signal:controller.signal
                });
                const d=await r.json().catch(()=>({}));

                if(r.ok){
                    const texto=extrairTextoGemini(d);
                    if(!texto){
                        ultimoErro={status:502,mensagem:'O Gemini respondeu sem texto utilizável.'};
                        tentativas.push({model,tentativa,status:502});
                        break;
                    }
                    return {
                        texto,
                        model,
                        resposta:d,
                        tentativas
                    };
                }

                const mensagem=erroGeminiAmigavel(r.status,d);
                ultimoErro={status:r.status,mensagem,original:String(d?.error?.message||d?.message||'')};
                tentativas.push({model,tentativa,status:r.status});

                // Chave/permissão: trocar de modelo não resolve.
                if(r.status===401 || r.status===403){
                    const e=new Error(mensagem);e.status=r.status;throw e;
                }

                // Modelo indisponível/incompatível: pula diretamente para o próximo.
                if((r.status===400||r.status===404) &&
                   /model|modelo|not found|not supported|unsupported|unknown|does not exist|no longer available|not available/i.test(String(d?.error?.message||d?.message||''))){
                    break;
                }

                // Alta demanda, limite temporário e 5xx:
                // repete com espera exponencial e depois tenta outro modelo.
                if(erroGeminiTransitorio(r.status)){
                    if(tentativa<2){
                        let espera=tentativa===1?1500:3500;
                        const retryAfter=Number(r.headers.get('retry-after')||0);
                        if(Number.isFinite(retryAfter)&&retryAfter>0)espera=Math.min(8000,retryAfter*1000);
                        await esperarGemini(espera);
                        continue;
                    }
                    break;
                }

                const e=new Error(mensagem);e.status=r.status;throw e;
            }catch(e){
                if(e?.name==='AbortError'){
                    ultimoErro={status:504,mensagem:`O modelo ${model} demorou para responder.`};
                    tentativas.push({model,tentativa,status:504});
                    // Timeout é tratado como transitório e o próximo modelo pode responder.
                    break;
                }
                throw e;
            }finally{
                clearTimeout(timer);
            }
        }
    }

    console.error('[GEMINI FALLBACK ESGOTADO]',{ultimoErro,tentativas});
    const e=new Error(
      ultimoErro?.mensagem ||
      'A IA está temporariamente indisponível. Tente novamente em alguns instantes.'
    );
    e.status=ultimoErro?.status||503;
    e.tentativas=tentativas;
    throw e;
}
async function chamarGeminiTexto(prompt,instructions='',responseSchema=null){
    const r=await chamarGeminiInteracao({
        input:String(prompt||''),
        systemInstruction:String(instructions||''),
        responseSchema
    });
    return r.texto;
}

app.post('/api/v9/claims/:id/analisar',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!process.env.GEMINI_API_KEY)return respostaErro(res,503,'Configure GEMINI_API_KEY no Render para usar a análise de reclamações.');
    const id=encodeURIComponent(req.params.id);
    try{
        const get=async path=>{const r=await mlFetch(`${ML_API}${path}`,token);return {ok:r.ok,data:await jsonSeguro(r)}};
        const [cr,dr,mr,ir]=await Promise.all([
          get(`/post-purchase/v1/claims/${id}`),get(`/post-purchase/v1/claims/${id}/detail`),
          get(`/post-purchase/v1/claims/${id}/messages`),get(`/post-purchase/v1/claims/${id}/affects-reputation`)
        ]);
        if(!cr.ok)return respostaErro(res,404,'Reclamação não encontrada.');

        const msgs=mr.ok&&Array.isArray(mr.data)?mr.data:[];
        const anexos=msgs.flatMap(m=>(m.attachments||[]).map(a=>({
            claim_id:id,
            filename:a.filename||a.id||'',
            type:a.type||a.mime_type||a.content_type||'',
            original_filename:a.original_filename||a.filename||a.id||'anexo',
            sender_role:m.sender_role
        })));

        const evidenciasVisuais=[];
        let bytesImagens=0;
        // Baixa até 6 anexos e inclui apenas imagens reais. Limite total reduz risco de requisição muito grande.
        for(const a of anexos.slice(0,6)){
            if(!a.filename)continue;
            try{
                const ar=await mlFetch(`${ML_API}/post-purchase/v1/claims/${id}/attachments/${encodeURIComponent(a.filename)}/download`,token);
                if(!ar.ok)continue;
                const ct=String(ar.headers.get('content-type')||a.type||'application/octet-stream').split(';')[0].trim().toLowerCase();
                if(!ct.startsWith('image/'))continue;
                const buf=Buffer.from(await ar.arrayBuffer());
                if(buf.length>5*1024*1024)continue;
                if(bytesImagens+buf.length>15*1024*1024)continue;
                bytesImagens+=buf.length;
                evidenciasVisuais.push({
                    type:'image',
                    mime_type:ct,
                    data:buf.toString('base64')
                });
            }catch(e){
                console.warn('[CLAIM ANEXO GEMINI]',a.filename,e.message);
            }
        }

        const contexto={
            claim:cr.data,
            detail:dr.ok?dr.data:{},
            impact:ir.ok?ir.data:null,
            messages:msgs.map(m=>({
                sender_role:m.sender_role,
                receiver_role:m.receiver_role,
                message:m.message,
                translated_message:m.translated_message,
                date_created:m.date_created,
                attachments:m.attachments
            }))
        };

        // Sinal auxiliar: não decide o caso sozinho, apenas chama atenção da IA para
        // indícios explícitos de dano/avaria causados durante a entrega.
        const textoContexto=JSON.stringify(contexto).toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const termosLogistica=[
          'transportadora','transportador','entregador','motorista',
          'jogou','jogado','jogada','arremessou','arremessado','por cima do muro',
          'embalagem danificada','caixa amassada','caixa rasgada','avaria no transporte',
          'danificado no transporte','danificada no transporte','entrega danificou'
        ];
        const indiciosLogistica=termosLogistica.filter(t=>textoContexto.includes(t));

        const prompt=`Analise esta reclamação do Mercado Livre como ASSISTENTE DE DEFESA DO VENDEDOR, com foco em apurar de quem é a responsabilidade pelo problema.

DADOS DA RECLAMAÇÃO:
${JSON.stringify(contexto)}

INDÍCIOS TEXTUAIS DE PROBLEMA LOGÍSTICO DETECTADOS PELO SISTEMA:
${JSON.stringify(indiciosLogistica)}

REGRAS DE ANÁLISE:
1. Trabalhe somente com fatos do dossiê, mensagens e imagens. Nunca invente prova.
2. Determine primeiro a responsabilidade provável: "vendedor", "comprador", "logistica_transportadora" ou "inconclusiva".
3. Diferencie DEFEITO DO PRODUTO de AVARIA LOGÍSTICA. Se o comprador relata que o entregador/transportadora jogou, arremessou, amassou, molhou ou danificou o pacote durante a entrega, e isso é compatível com as evidências, trate como forte indício de responsabilidade logística, não como defeito automaticamente atribuível ao vendedor.
4. Se o produto FOI ENTREGUE ao comprador, mas chegou danificado, não chame isso de "extravio". Use "avaria/dano durante o transporte ou entrega". Só use "extravio" quando os dados realmente mostrarem que a mercadoria não foi entregue ou foi perdida.
5. Quando a responsabilidade provável for "logistica_transportadora":
   - NÃO admita culpa do vendedor;
   - NÃO ofereça espontaneamente reembolso, devolução ou pagamento de etiqueta como se fossem obrigação do vendedor;
   - destaque o relato do próprio comprador e as evidências que apontam para manuseio/entrega inadequados;
   - recomende direcionar a defesa prioritariamente à MEDIAÇÃO/Mercado Livre;
   - peça formalmente que o caso seja tratado como ocorrência logística/avaria de transporte;
   - peça análise para que o vendedor não seja debitado pelo valor do produto, frete ou etiqueta/devolução quando a cobertura/regras aplicáveis permitirem;
   - peça preservação ou compensação do valor da venda conforme a proteção logística aplicável;
   - peça que a reclamação não gere impacto indevido na reputação, ou que o status "not_affected" seja mantido quando a API já indicar isso.
6. Esses pedidos NÃO são garantias. Use linguagem como "solicito", "peço análise", "peço que seja aplicado", "caso previsto pelas regras da plataforma". Nunca diga que o Mercado Livre obrigatoriamente vai isentar, reembolsar ou retirar impacto.
7. Se as evidências forem insuficientes ou contraditórias, diga exatamente o que falta e não force a conclusão a favor do vendedor.
8. Se houver imagens, descreva somente fatos realmente visíveis e explique como eles apoiam ou não a tese logística.
9. Evite respostas genéricas ao comprador. A resposta deve defender a posição do vendedor perante a plataforma quando houver indícios de responsabilidade logística.

OBJETIVO DA RESPOSTA:
Criar uma defesa curta, firme, profissional e factual, pronta para revisão humana, citando os elementos do próprio caso. Quando a responsabilidade provável for logística, a resposta deve pedir ao Mercado Livre/mediação que reconheça a ocorrência de transporte, preserve os direitos do vendedor e não transfira automaticamente a ele custos decorrentes da avaria.`;

        const schema={
            type:'object',
            properties:{
                responsabilidade_provavel:{
                    type:'string',
                    enum:['vendedor','comprador','logistica_transportadora','inconclusiva'],
                    description:'Responsabilidade mais provável conforme as evidências disponíveis.'
                },
                confianca:{
                    type:'string',
                    enum:['alta','media','baixa'],
                    description:'Nível de confiança da classificação com base nas evidências.'
                },
                destinatario_recomendado:{
                    type:'string',
                    enum:['complainant','mediator'],
                    description:'Destinatário mais adequado para a resposta sugerida.'
                },
                fundamentos_defesa:{
                    type:'array',
                    items:{type:'string'},
                    description:'Fatos concretos do caso que sustentam a defesa.'
                },
                analise:{type:'string',description:'Análise factual da reclamação sob a perspectiva do vendedor, distinguindo produto de logística.'},
                estrategia_defesa:{type:'string',description:'Estratégia recomendada ao vendedor sem prometer resultado.'},
                resposta_sugerida:{type:'string',description:'Mensagem profissional de defesa, pronta para revisão humana antes de enviar.'}
            },
            required:[
                'responsabilidade_provavel','confianca','destinatario_recomendado',
                'fundamentos_defesa','analise','estrategia_defesa','resposta_sugerida'
            ]
        };

        const gr=await chamarGeminiInteracao({
            input:[
                {type:'text',text:prompt},
                ...evidenciasVisuais
            ],
            systemInstruction:'Você atua como assistente de defesa do vendedor em pós-venda de marketplace. Sua prioridade é atribuir responsabilidade corretamente com base em evidências. Quando houver dano causado durante transporte/entrega, não transforme isso automaticamente em culpa do vendedor e não ofereça reembolso por iniciativa própria. Formule pedidos de proteção ao vendedor sem garantir resultado, sem fabricar evidências e sem acusar pessoas além do que os dados sustentam.',
            responseSchema:schema
        });

        let parsed;
        try{parsed=extrairJsonIA(gr.texto)}
        catch(e){parsed={analise:gr.texto,resposta_sugerida:'',responsabilidade_provavel:'inconclusiva',confianca:'baixa',destinatario_recomendado:'mediator',fundamentos_defesa:[],estrategia_defesa:''}}

        if(!['vendedor','comprador','logistica_transportadora','inconclusiva'].includes(parsed?.responsabilidade_provavel)){
            parsed.responsabilidade_provavel='inconclusiva';
        }
        if(!['alta','media','baixa'].includes(parsed?.confianca))parsed.confianca='baixa';
        if(!['complainant','mediator'].includes(parsed?.destinatario_recomendado))parsed.destinatario_recomendado='mediator';
        if(!Array.isArray(parsed?.fundamentos_defesa))parsed.fundamentos_defesa=[];
        parsed.indicios_logistica_detectados=indiciosLogistica;

        res.json({
            sucesso:true,
            ...parsed,
            provedor:'gemini',
            modelo:gr.model,
            imagens_analisadas:evidenciasVisuais.length,
            anexos_encontrados:anexos.length,
            fallback_utilizado:Array.isArray(gr.tentativas)&&gr.tentativas.length>0,
            tentativas_anteriores:Array.isArray(gr.tentativas)?gr.tentativas:[]
        });
    }catch(e){
        console.error('[GEMINI CLAIM ANALYSIS]',e);
        const msg=(e.status===429||e.status===503||e.status===504)
          ? 'A IA gratuita está temporariamente ocupada. O sistema tentou modelos alternativos automaticamente. Tente novamente em alguns instantes.'
          : 'Erro na análise da reclamação: '+e.message;
        respostaErro(res,e.status||500,msg);
    }
});

app.post('/api/v9/claims/:id/mensagem',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    const message=String(req.body?.message||'').trim(),receiver=String(req.body?.receiver_role||'complainant');
    if(!message)return respostaErro(res,400,'Mensagem vazia.');
    if(!['complainant','mediator'].includes(receiver))return respostaErro(res,400,'Destinatário inválido.');
    try{
        const r=await mlFetch(`${ML_API}/post-purchase/v1/claims/${encodeURIComponent(req.params.id)}/actions/send-message`,token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({receiver_role:receiver,message,attachments:[]})});
        const d=await jsonSeguro(r);if(!r.ok)return respostaErro(res,r.status,formatarErroMercadoLivre(d));res.status(201).json({sucesso:true,resposta:d});
    }catch(e){respostaErro(res,500,'Erro ao enviar mensagem: '+e.message)}
});

app.get('/api/v3/auditoria',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    try{
        const me=await usuarioML(token);
        const busca=await buscarIdsAnunciosPaginados(token,me.id,{offset:0,limit:100,order:'last_updated_desc'});
        const ids=Array.isArray(busca.results)?busca.results:[];
        const det=await buscarItensBulk(token,ids);
        const itens=ids.map(id=>det[id]).filter(Boolean).map(normalizarItemGestao);
        const semSku=itens.filter(i=>!i.sku), crit=itens.filter(i=>i.status==='active'&&i.estoque<=3), semVenda=itens.filter(i=>i.vendidos<=0);
        let score=100-Math.min(100,Math.round((semSku.length*0.35+crit.length*0.4+semVenda.length*0.15)));
        const oportunidades=[];
        semSku.slice(0,8).forEach(i=>oportunidades.push({tipo:'sku',titulo:i.titulo,mensagem:'Cadastrar SKU para melhorar estoque, ERP e rastreabilidade.'}));
        crit.slice(0,8).forEach(i=>oportunidades.push({tipo:'estoque',titulo:i.titulo,mensagem:`Estoque crítico (${i.estoque}). Repor ou revisar estratégia para evitar ruptura.`}));
        semVenda.slice(0,8).forEach(i=>oportunidades.push({tipo:'conversao',titulo:i.titulo,mensagem:'Sem unidades vendidas registradas. Revisar título, atributos, preço, imagens e Ads.'}));
        res.json({sucesso:true,amostra:itens.length,total_conta:Number(busca.paging?.total||0),metricas:{sem_sku:semSku.length,estoque_critico:crit.length,sem_venda:semVenda.length,score:Math.max(0,score)},oportunidades:oportunidades.slice(0,20)});
    }catch(e){respostaErro(res,500,'Erro na auditoria: '+e.message)}
});

app.get('/api/v3/integracoes/status',(req,res)=>{
    const b=lerJsonArquivoSeguro(BLING_STORE_FILE);
    const configurado=Boolean(process.env.GEMINI_API_KEY);
    res.json({
        sucesso:true,
        gemini:{configurado,modelo:process.env.GEMINI_MODEL||'gemini-3.7-flash'},
        // Mantido só para compatibilidade com versões antigas do front-end.
        openai:{configurado,substituido_por:'gemini'},
        bling:{configurado:Boolean(process.env.BLING_CLIENT_ID&&process.env.BLING_CLIENT_SECRET),conectado:Boolean(b.access_token)},
        mercado_livre:{configurado:true}
    });
});

app.get('/api/v17/gemini/status',(req,res)=>{
    res.json({
        sucesso:true,
        configurado:Boolean(process.env.GEMINI_API_KEY),
        modelo:process.env.GEMINI_MODEL||'gemini-3.7-flash',
        provedor:'Google Gemini'
    });
});

app.post('/api/v3/ia',async(req,res)=>{
    const mensagem=String(req.body?.mensagem||'').trim();
    if(!mensagem)return respostaErro(res,400,'Digite uma mensagem.');
    try{
        const gr=await chamarGeminiInteracao({
            input:mensagem,
            systemInstruction:'Você é o assistente operacional do ML Hub Pro para vendedores brasileiros do Mercado Livre. Responda em português do Brasil, seja objetivo, profissional e útil. Ajude com atendimento, pós-venda, anúncios, estoque, preço, margem, operação e organização. Não invente dados da conta que não foram fornecidos. Não execute alterações; apenas recomende ou redija textos para revisão humana.'
        });
        res.json({sucesso:true,resposta:gr.texto,provedor:'gemini',modelo:gr.model});
    }catch(e){
        respostaErro(res,e.status||500,'Erro ao consultar Gemini: '+e.message);
    }
});

// BLING OAuth 2.0 / JWT
app.get('/api/bling/authorize',(req,res)=>{
    const id=process.env.BLING_CLIENT_ID;
    if(!id||!process.env.BLING_CLIENT_SECRET)return respostaErro(res,503,'Configure BLING_CLIENT_ID e BLING_CLIENT_SECRET no Render.');
    const state=crypto.randomBytes(24).toString('hex');
    const s=lerJsonArquivoSeguro(BLING_STORE_FILE);s.state=state;s.state_created_at=Date.now();salvarJsonArquivoSeguro(BLING_STORE_FILE,s);
    res.json({authorization_url:`https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${encodeURIComponent(id)}&state=${encodeURIComponent(state)}`});
});
app.get('/api/bling/callback',async(req,res)=>{
    try{
        const code=String(req.query.code||''),state=String(req.query.state||''),s=lerJsonArquivoSeguro(BLING_STORE_FILE);
        if(!code||!state||state!==s.state)return res.status(400).send('Autorização Bling inválida ou expirada.');
        const basic=Buffer.from(`${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`).toString('base64');
        const body=new URLSearchParams({grant_type:'authorization_code',code});
        const r=await fetch('https://api.bling.com.br/Api/v3/oauth/token',{method:'POST',headers:{'Authorization':`Basic ${basic}`,'Content-Type':'application/x-www-form-urlencoded','Accept':'1.0','enable-jwt':'1'},body});
        const d=await r.json();if(!r.ok)throw new Error(d.error_description||d.error||'Falha ao gerar token Bling.');
        salvarJsonArquivoSeguro(BLING_STORE_FILE,{access_token:d.access_token,refresh_token:d.refresh_token,expires_at:Date.now()+Number(d.expires_in||21600)*1000,scope:d.scope});
        res.redirect(process.env.FRONTEND_URL||DEFAULT_FRONTEND_URL);
    }catch(e){res.status(500).send('Erro ao conectar Bling: '+e.message)}
});
app.post('/api/bling/webhook',(req,res)=>{res.status(200).json({recebido:true});setImmediate(()=>console.log('[Bling webhook]',req.body?.eventId||req.body?.event||req.body?.type||'evento'));});



/* =========================================================
   ML HUB PRO V4 - CONTEÚDO, QUALIDADE E CATÁLOGO
========================================================= */
function extrairJsonIA(texto) {
    const limpo=String(texto||'').replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
    try{return JSON.parse(limpo)}catch(e){const a=limpo.indexOf('{'),b=limpo.lastIndexOf('}');if(a>=0&&b>a)return JSON.parse(limpo.slice(a,b+1));throw e}
}
app.post('/api/v4/conteudo/titulos',async(req,res)=>{
    try{
        const produtos=(Array.isArray(req.body?.produtos)?req.body.produtos:[]).map(String).map(x=>x.trim()).filter(Boolean).slice(0,50);
        const quantidade=Math.min(10,Math.max(1,Number(req.body?.quantidade||5))),limite=Math.min(200,Math.max(30,Number(req.body?.limite||60)));
        if(!produtos.length)return respostaErro(res,400,'Informe os produtos.');
        const texto=await chamarGeminiTexto(`Produtos:\n${produtos.map((x,i)=>`${i+1}. ${x}`).join('\n')}\n\nCrie ${quantidade} títulos diferentes por produto, cada um com no máximo ${limite} caracteres. Retorne SOMENTE JSON no formato {"resultados":[{"produto":"...","titulos":["..."]}]}. Não invente marca, modelo, material ou característica não fornecida.`, 'Você cria títulos claros e comerciais para anúncios de marketplace brasileiro. Priorize termos descritivos úteis e legibilidade. Não faça alegações falsas nem invente atributos.');
        const obj=extrairJsonIA(texto);
        res.json({sucesso:true,resultados:obj.resultados||[]});
    }catch(e){respostaErro(res,500,e.message)}
});
app.post('/api/v4/conteudo/descricao',async(req,res)=>{
    const base=String(req.body?.base||'').trim();if(!base)return respostaErro(res,400,'Informe os dados do produto.');
    try{const texto=await chamarGeminiTexto(base,'Crie uma descrição profissional em português do Brasil para marketplace. Use somente os fatos fornecidos. Organize benefícios, características, itens inclusos e observações quando aplicável. Não invente especificações. Seja clara e fácil de ler.');res.json({sucesso:true,texto})}catch(e){respostaErro(res,500,e.message)}
});
app.post('/api/v4/conteudo/keywords',async(req,res)=>{
    const produto=String(req.body?.produto||'').trim();if(!produto)return respostaErro(res,400,'Informe o produto.');
    try{const texto=await chamarGeminiTexto(`Produto: ${produto}\nRetorne SOMENTE JSON: {"keywords":["termo 1","termo 2"]}, com até 30 termos relacionados, sem inventar marca ou especificações.`,'Gere palavras-chave relevantes para organização e criação de conteúdo de marketplace brasileiro.');const o=extrairJsonIA(texto);res.json({sucesso:true,keywords:(o.keywords||[]).slice(0,30)})}catch(e){respostaErro(res,500,e.message)}
});
app.post('/api/v4/conteudo/imagem-brief',async(req,res)=>{
    const brief=String(req.body?.brief||'').trim();if(!brief)return respostaErro(res,400,'Informe o briefing.');
    try{const prompt=await chamarGeminiTexto(`Produto/objetivo: ${brief}\nFormato: ${req.body?.formato||'1:1'}\nEstilo: ${req.body?.estilo||'Marketplace profissional'}\nCrie um briefing/prompt visual detalhado para uma imagem comercial de produto. Preserve fielmente características fornecidas e não invente certificações, acessórios ou textos promocionais não solicitados.`,'Você é diretor de arte de e-commerce. Gere apenas o briefing visual, em português do Brasil.');res.json({sucesso:true,prompt,image_generation_available:Boolean(process.env.IMAGE_API_KEY)})}catch(e){respostaErro(res,500,e.message)}
});
app.get('/api/v4/items/:id/performance',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    try{const id=encodeURIComponent(req.params.id);const r=await mlFetch(`${ML_API}/items/${id}/performance`,token);const d=await jsonSeguro(r);if(!r.ok)return respostaErro(res,r.status,formatarErroMercadoLivre(d));res.json({sucesso:true,performance:d})}catch(e){respostaErro(res,500,e.message)}
});
app.get('/api/v4/items/:id/competition',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    try{
        const id=encodeURIComponent(req.params.id);
        const [ir,cr]=await Promise.all([mlFetch(`${ML_API}/items/${id}`,token),mlFetch(`${ML_API}/items/${id}/price_to_win?version=v2`,token)]);
        const item=await jsonSeguro(ir),comp=await jsonSeguro(cr);
        if(!cr.ok)return respostaErro(res,cr.status,formatarErroMercadoLivre(comp));
        res.json({sucesso:true,current_price:Number(item?.price||0),...comp});
    }catch(e){respostaErro(res,500,e.message)}
});


/* =========================================================
   ML HUB PRO V5 - CORE PARA 90 MIL+ ANÚNCIOS
   PostgreSQL + fila persistente + worker + paginação DB
========================================================= */
const DATABASE_URL = process.env.DATABASE_URL || '';
const ML_WORKER_ENABLED = String(process.env.ML_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
const ML_WORKER_CONCURRENCY = Math.max(1, Math.min(5, Number(process.env.ML_WORKER_CONCURRENCY || 2)));
const db = DATABASE_URL ? new Pool({
    connectionString: DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: Math.max(2, Number(process.env.DB_POOL_MAX || 10)),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
}) : null;

async function dbQuery(text, params=[]) {
    if (!db) throw new Error('PostgreSQL não configurado. Adicione DATABASE_URL no Render.');
    return db.query(text, params);
}

async function inicializarBancoEscala() {
    if (!db) {
        console.warn('[ESCALA] DATABASE_URL ausente: modo 90k desativado até configurar PostgreSQL.');
        return;
    }
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS ml_items (
        seller_id BIGINT NOT NULL,
        item_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        sku TEXT NOT NULL DEFAULT '',
        price NUMERIC(18,2) NOT NULL DEFAULT 0,
        available_quantity INTEGER NOT NULL DEFAULT 0,
        sold_quantity INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT '',
        listing_type_id TEXT NOT NULL DEFAULT '',
        category_id TEXT NOT NULL DEFAULT '',
        thumbnail TEXT NOT NULL DEFAULT '',
        permalink TEXT NOT NULL DEFAULT '',
        ml_updated_at TIMESTAMPTZ NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        raw JSONB NULL,
        PRIMARY KEY (seller_id, item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ml_items_seller_status ON ml_items(seller_id,status);
      CREATE INDEX IF NOT EXISTS idx_ml_items_seller_sku ON ml_items(seller_id,sku);
      CREATE INDEX IF NOT EXISTS idx_ml_items_seller_sold ON ml_items(seller_id,sold_quantity DESC);
      CREATE INDEX IF NOT EXISTS idx_ml_items_seller_updated ON ml_items(seller_id,ml_updated_at DESC NULLS LAST);
      CREATE INDEX IF NOT EXISTS idx_ml_items_title_lower ON ml_items(seller_id,lower(title));

      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(18,2) NOT NULL DEFAULT 0;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS free_shipping BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS sale_fee NUMERIC(18,2) NOT NULL DEFAULT 0;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS commission_percentage NUMERIC(8,4) NOT NULL DEFAULT 0;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS commission_synced_at TIMESTAMPTZ NULL;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS net_received NUMERIC(18,2) NOT NULL DEFAULT 0;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS freight_synced_at TIMESTAMPTZ NULL;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS freight_last_attempt_at TIMESTAMPTZ NULL;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS freight_last_error TEXT NULL;
      CREATE INDEX IF NOT EXISTS idx_ml_items_freight_pending
      ON ml_items(seller_id,status,freight_synced_at,freight_last_attempt_at);

      CREATE TABLE IF NOT EXISTS ml_sku_pricing (
        seller_id BIGINT NOT NULL,
        sku TEXT NOT NULL,
        sku_key TEXT NOT NULL,
        cost NUMERIC(18,2) NOT NULL DEFAULT 0,
        desired_margin NUMERIC(8,4) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (seller_id, sku_key)
      );
      CREATE INDEX IF NOT EXISTS idx_ml_sku_pricing_seller
      ON ml_sku_pricing(seller_id,sku_key);

      CREATE TABLE IF NOT EXISTS ml_jobs (
        id BIGSERIAL PRIMARY KEY,
        seller_id BIGINT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        progress_current INTEGER NOT NULL DEFAULT 0,
        progress_total INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        errors INTEGER NOT NULL DEFAULT 0,
        cursor TEXT NULL,
        message TEXT NOT NULL DEFAULT '',
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        locked_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ml_jobs_queue ON ml_jobs(status,available_at,created_at);
      CREATE INDEX IF NOT EXISTS idx_ml_jobs_seller ON ml_jobs(seller_id,created_at DESC);

      CREATE TABLE IF NOT EXISTS ml_notifications (
        id BIGSERIAL PRIMARY KEY,
        external_id TEXT NULL,
        seller_id BIGINT NULL,
        topic TEXT NOT NULL DEFAULT '',
        resource TEXT NOT NULL DEFAULT '',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ml_notifications_external
      ON ml_notifications(external_id) WHERE external_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_ml_notifications_queue ON ml_notifications(status,available_at,created_at);

      ALTER TABLE ml_jobs
      ADD COLUMN IF NOT EXISTS result JSONB NOT NULL DEFAULT '{}'::jsonb;

      CREATE TABLE IF NOT EXISTS ml_sync_seen (
        job_id BIGINT NOT NULL,
        seller_id BIGINT NOT NULL,
        item_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(job_id,item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ml_sync_seen_seller_job
      ON ml_sync_seen(seller_id,job_id);

      CREATE TABLE IF NOT EXISTS ml_price_update_errors (
        job_id BIGINT NOT NULL,
        seller_id BIGINT NOT NULL,
        item_id TEXT NOT NULL,
        requested_price NUMERIC(18,2) NOT NULL DEFAULT 0,
        failure_type TEXT NOT NULL DEFAULT 'erro',
        message_pt TEXT NOT NULL DEFAULT '',
        technical_message TEXT NOT NULL DEFAULT '',
        http_status INTEGER NULL,
        code TEXT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(job_id,item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ml_price_update_errors_job
      ON ml_price_update_errors(job_id,created_at);

      CREATE TABLE IF NOT EXISTS ml_mass_create_results (
        job_id BIGINT NOT NULL,
        seller_id BIGINT NOT NULL,
        seq INTEGER NOT NULL,
        family_seq INTEGER NOT NULL DEFAULT 0,
        variation_seq INTEGER NOT NULL DEFAULT 0,
        title_requested TEXT NOT NULL DEFAULT '',
        item_id TEXT NULL,
        permalink TEXT NULL,
        success BOOLEAN NOT NULL DEFAULT FALSE,
        message TEXT NOT NULL DEFAULT '',
        technical_message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(job_id,seq)
      );
      CREATE INDEX IF NOT EXISTS idx_ml_mass_create_results_job
      ON ml_mass_create_results(job_id,seq);

      DELETE FROM ml_sync_seen
      WHERE created_at < NOW() - INTERVAL '3 days';
    `);
    console.log('[ESCALA] PostgreSQL pronto.');
}

function itemParaDb(item, sellerId) {
    const n=normalizarItemGestao(item);
    const saleFee=Number(item?._sale_fee_amount ?? item?.sale_fee ?? 0);
    const commissionPercentage=Number(item?._commission_percentage ?? item?.commission_percentage ?? 0);
    const commissionSyncedAt=item?._commission_synced_at||item?.commission_synced_at||null;
    const netReceived=Math.max(0,Number(n.preco||0)-Math.max(0,saleFee));

    return [
      sellerId,n.id,n.titulo,n.sku,n.preco,n.estoque,n.vendidos,n.status,
      n.listing_type_id,n.categoria,n.thumbnail,n.permalink,n.atualizado_em,
      item,
      Number.isFinite(saleFee)?saleFee:0,
      Number.isFinite(commissionPercentage)?commissionPercentage:0,
      commissionSyncedAt,
      netReceived
    ];
}

async function upsertItensDb(sellerId, itens) {
    if(!Array.isArray(itens) || !itens.length)return;

    /*
      V36:
      - upsert em blocos via jsonb_to_recordset, muito mais rápido para 90k+;
      - shipping_cost/free_shipping/freight_synced_at NÃO são tocados aqui;
      - portanto Puxar anúncios nunca zera nem altera o frete salvo.
    */
    const TAMANHO=Math.max(100,Math.min(1000,Number(process.env.ML_DB_UPSERT_BATCH||500)));

    for(let inicio=0;inicio<itens.length;inicio+=TAMANHO){
        const lote=itens.slice(inicio,inicio+TAMANHO).map(item=>{
            const n=normalizarItemGestao(item);
            const saleFee=Number(item?._sale_fee_amount ?? item?.sale_fee ?? 0);
            const commissionPercentage=Number(item?._commission_percentage ?? item?.commission_percentage ?? 0);
            const commissionSyncedAt=item?._commission_synced_at||item?.commission_synced_at||null;

            return {
                item_id:String(n.id||''),
                title:String(n.titulo||''),
                sku:String(n.sku||''),
                price:Number(n.preco||0),
                available_quantity:Number(n.estoque||0),
                sold_quantity:Number(n.vendidos||0),
                status:String(n.status||''),
                listing_type_id:String(n.listing_type_id||''),
                category_id:String(n.categoria||''),
                thumbnail:String(n.thumbnail||''),
                permalink:String(n.permalink||''),
                ml_updated_at:n.atualizado_em||null,
                raw:item||{},
                sale_fee:Number.isFinite(saleFee)?saleFee:0,
                commission_percentage:Number.isFinite(commissionPercentage)?commissionPercentage:0,
                commission_synced_at:commissionSyncedAt,
                net_received:Math.max(0,Number(n.preco||0)-Math.max(0,saleFee))
            };
        }).filter(x=>x.item_id);

        if(!lote.length)continue;

        await dbQuery(`
          INSERT INTO ml_items (
            seller_id,item_id,title,sku,price,available_quantity,sold_quantity,
            status,listing_type_id,category_id,thumbnail,permalink,ml_updated_at,
            raw,sale_fee,commission_percentage,commission_synced_at,net_received,synced_at
          )
          SELECT
            $1::bigint,
            x.item_id,x.title,x.sku,x.price,x.available_quantity,x.sold_quantity,
            x.status,x.listing_type_id,x.category_id,x.thumbnail,x.permalink,
            x.ml_updated_at,x.raw,x.sale_fee,x.commission_percentage,
            x.commission_synced_at,x.net_received,NOW()
          FROM jsonb_to_recordset($2::jsonb) AS x(
            item_id text,
            title text,
            sku text,
            price numeric,
            available_quantity integer,
            sold_quantity integer,
            status text,
            listing_type_id text,
            category_id text,
            thumbnail text,
            permalink text,
            ml_updated_at timestamptz,
            raw jsonb,
            sale_fee numeric,
            commission_percentage numeric,
            commission_synced_at timestamptz,
            net_received numeric
          )
          ON CONFLICT(seller_id,item_id) DO UPDATE SET
            title=EXCLUDED.title,
            sku=EXCLUDED.sku,
            price=EXCLUDED.price,
            available_quantity=EXCLUDED.available_quantity,
            sold_quantity=EXCLUDED.sold_quantity,
            status=EXCLUDED.status,
            listing_type_id=EXCLUDED.listing_type_id,
            category_id=EXCLUDED.category_id,
            thumbnail=EXCLUDED.thumbnail,
            permalink=EXCLUDED.permalink,
            ml_updated_at=EXCLUDED.ml_updated_at,

            sale_fee=CASE
              WHEN EXCLUDED.commission_synced_at IS NOT NULL
              THEN EXCLUDED.sale_fee
              ELSE ml_items.sale_fee
            END,

            commission_percentage=CASE
              WHEN EXCLUDED.commission_synced_at IS NOT NULL
              THEN EXCLUDED.commission_percentage
              ELSE ml_items.commission_percentage
            END,

            commission_synced_at=COALESCE(
              EXCLUDED.commission_synced_at,
              ml_items.commission_synced_at
            ),

            /* Frete preservado: só /api/scale/fretes pode alterá-lo. */
            net_received=GREATEST(
              0,
              EXCLUDED.price -
              (
                CASE
                  WHEN EXCLUDED.commission_synced_at IS NOT NULL
                  THEN EXCLUDED.sale_fee
                  ELSE ml_items.sale_fee
                END
              ) -
              ml_items.shipping_cost
            ),

            raw=EXCLUDED.raw,

            synced_at=CASE WHEN
                ml_items.title IS DISTINCT FROM EXCLUDED.title OR
                ml_items.sku IS DISTINCT FROM EXCLUDED.sku OR
                ml_items.price IS DISTINCT FROM EXCLUDED.price OR
                ml_items.available_quantity IS DISTINCT FROM EXCLUDED.available_quantity OR
                ml_items.sold_quantity IS DISTINCT FROM EXCLUDED.sold_quantity OR
                ml_items.status IS DISTINCT FROM EXCLUDED.status OR
                ml_items.listing_type_id IS DISTINCT FROM EXCLUDED.listing_type_id OR
                ml_items.category_id IS DISTINCT FROM EXCLUDED.category_id OR
                ml_items.thumbnail IS DISTINCT FROM EXCLUDED.thumbnail OR
                ml_items.permalink IS DISTINCT FROM EXCLUDED.permalink OR
                ml_items.ml_updated_at IS DISTINCT FROM EXCLUDED.ml_updated_at OR
                ml_items.sale_fee IS DISTINCT FROM (
                  CASE WHEN EXCLUDED.commission_synced_at IS NOT NULL
                       THEN EXCLUDED.sale_fee ELSE ml_items.sale_fee END
                ) OR
                ml_items.commission_percentage IS DISTINCT FROM (
                  CASE WHEN EXCLUDED.commission_synced_at IS NOT NULL
                       THEN EXCLUDED.commission_percentage ELSE ml_items.commission_percentage END
                )
              THEN NOW()
              ELSE ml_items.synced_at
            END
        `,[sellerId,JSON.stringify(lote)]);
    }
}

/* =========================================================
   V28 — CUSTO DE VENDA / COMISSÃO POR ANÚNCIO
   Usa o recurso oficial sites/{site}/listing_prices.
========================================================= */
function flattenListingPricesV28(data){
    const out=[];
    const walk=v=>{
        if(Array.isArray(v)){
            v.forEach(walk);
            return;
        }
        if(v && typeof v==='object')out.push(v);
    };
    walk(data);
    return out;
}

function contextoComissaoMudouV28(anterior,item){
    if(!anterior)return true;

    const oldShipping=anterior?.raw?.shipping||{};
    const newShipping=item?.shipping||{};

    return (
      Number(anterior.price||0)!==Number(item?.price||0) ||
      String(anterior.listing_type_id||'')!==String(item?.listing_type_id||'') ||
      String(anterior.category_id||'')!==String(item?.category_id||'') ||
      String(oldShipping.mode||'')!==String(newShipping.mode||'') ||
      String(oldShipping.logistic_type||'')!==String(newShipping.logistic_type||'') ||
      String(anterior?.raw?.catalog_product_id||'')!==String(item?.catalog_product_id||'')
    );
}

async function consultarComissaoItemV28(item,token){
    const price=Number(item?.price||0);
    const listingType=String(item?.listing_type_id||'').trim();
    if(!(price>0)||!listingType){
        throw new Error('Anúncio sem preço ou listing_type para calcular comissão.');
    }

    const site=String(item?.site_id||'MLB');
    const shipping=item?.shipping||{};
    const params=new URLSearchParams({
        price:String(price),
        currency_id:String(item?.currency_id||'BRL'),
        listing_type_id:listingType
    });

    // A documentação atual recomenda enviar o contexto logístico para
    // o fixed_fee ficar coerente com o que será efetivamente cobrado.
    if(shipping?.logistic_type)params.set('logistic_type',String(shipping.logistic_type));
    if(shipping?.mode)params.set('shipping_mode',String(shipping.mode));

    // Para maior precisão, usa produto de catálogo quando existir;
    // caso contrário usa a categoria.
    if(item?.catalog_product_id){
        params.set('catalog_product_id',String(item.catalog_product_id));
    }else if(item?.category_id){
        params.set('category_id',String(item.category_id));
    }

    let ultimoErro='Falha ao calcular comissão.';
    for(let tentativa=1;tentativa<=3;tentativa++){
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),12000);

        try{
            const r=await mlFetch(
                `${ML_API}/sites/${encodeURIComponent(site)}/listing_prices?${params.toString()}`,
                token,
                {signal:controller.signal}
            );
            const d=await jsonSeguro(r);

            if(r.ok){
                const lista=flattenListingPricesV28(d);
                const row=
                  lista.find(x=>String(x?.listing_type_id||x?.mapping||'')===listingType) ||
                  lista.find(x=>Number.isFinite(Number(x?.sale_fee_amount))) ||
                  null;

                if(row){
                    const saleFee=Number(row.sale_fee_amount);
                    const percentage=Number(row?.sale_fee_details?.percentage_fee);

                    if(Number.isFinite(saleFee)&&saleFee>=0){
                        return {
                            sale_fee_amount:saleFee,
                            percentage_fee:Number.isFinite(percentage)&&percentage>=0?percentage:0
                        };
                    }
                }

                ultimoErro='Listing Prices respondeu sem sale_fee_amount.';
                break;
            }

            ultimoErro=`Comissão HTTP ${r.status}: ${formatarErroMercadoLivre(d)}`;
            if(![408,429,500,502,503,504].includes(r.status))break;

            const retryAfter=Number(r.headers.get('retry-after')||0);
            await new Promise(resolve=>setTimeout(
              resolve,
              retryAfter>0?Math.min(5000,retryAfter*1000):500*tentativa
            ));
        }catch(e){
            ultimoErro=e?.name==='AbortError'
              ? 'Timeout ao consultar comissão.'
              : e.message;
            if(tentativa<3)await new Promise(resolve=>setTimeout(resolve,500*tentativa));
        }finally{
            clearTimeout(timer);
        }
    }

    throw new Error(ultimoErro);
}

async function enriquecerComissoesV28(sellerId,itens,token){
    if(!Array.isArray(itens)||!itens.length)return {itens:[],consultados:0,erros:0};

    const ids=itens.map(x=>String(x.id||'')).filter(Boolean);
    const antigos=await dbQuery(`
      SELECT
        item_id,
        price::float8 AS price,
        listing_type_id,
        category_id,
        sale_fee::float8 AS sale_fee,
        commission_percentage::float8 AS commission_percentage,
        commission_synced_at,
        raw
      FROM ml_items
      WHERE seller_id=$1
        AND item_id=ANY($2::text[])
    `,[sellerId,ids]);

    const mapaAntigos=new Map(antigos.rows.map(x=>[String(x.item_id),x]));
    const alvos=[];

    for(const item of itens){
        const anterior=mapaAntigos.get(String(item.id));

        if(
          !anterior ||
          !anterior.commission_synced_at ||
          contextoComissaoMudouV28(anterior,item)
        ){
            alvos.push(item);
        }else{
            item._sale_fee_amount=Number(anterior.sale_fee||0);
            item._commission_percentage=Number(anterior.commission_percentage||0);
            item._commission_synced_at=anterior.commission_synced_at;
        }
    }

    const concorrencia=Math.max(
      4,
      Math.min(28,Number(process.env.ML_COMMISSION_CONCURRENCY||16))
    );

    let cursor=0;
    let erros=0;

    async function worker(){
        while(true){
            const idx=cursor++;
            if(idx>=alvos.length)return;

            const item=alvos[idx];
            const anterior=mapaAntigos.get(String(item.id));

            try{
                const fee=await consultarComissaoItemV28(item,token);
                item._sale_fee_amount=fee.sale_fee_amount;
                item._commission_percentage=fee.percentage_fee;
                item._commission_synced_at=new Date().toISOString();
            }catch(e){
                erros++;
                console.warn('[COMISSÃO V28]',item.id,e.message);

                // Nunca apaga uma comissão boa já salva por causa de falha temporária.
                if(anterior){
                    item._sale_fee_amount=Number(anterior.sale_fee||0);
                    item._commission_percentage=Number(anterior.commission_percentage||0);
                    item._commission_synced_at=anterior.commission_synced_at||null;
                }else{
                    item._sale_fee_amount=0;
                    item._commission_percentage=0;
                    item._commission_synced_at=null;
                }
            }
        }
    }

    await Promise.all(
      Array.from(
        {length:Math.min(concorrencia,Math.max(1,alvos.length))},
        ()=>worker()
      )
    );

    return {
        itens,
        consultados:alvos.length,
        erros
    };
}

async function criarJob(sellerId,type,payload={}) {
    const r=await dbQuery(`INSERT INTO ml_jobs(seller_id,type,payload) VALUES($1,$2,$3) RETURNING *`,[sellerId,type,payload]);
    return r.rows[0];
}
async function claimJob() {
    const client=await db.connect();
    try {
        await client.query('BEGIN');
        const r=await client.query(`
          SELECT * FROM ml_jobs
          WHERE status='queued' AND available_at<=NOW()
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED LIMIT 1
        `);
        if(!r.rows.length){await client.query('COMMIT');return null}
        const job=r.rows[0];
        await client.query(`UPDATE ml_jobs SET status='running',locked_at=NOW(),updated_at=NOW(),attempts=attempts+1 WHERE id=$1`,[job.id]);
        await client.query('COMMIT');
        return job;
    } catch(e){await client.query('ROLLBACK');throw e} finally{client.release()}
}

async function processarSyncCompleto(job) {
    const token=await obterTokenPersistenteParaSeller(job.seller_id);
    if(!token) throw new Error('Token Mercado Livre indisponível para o seller do job.');

    let scrollId=job.cursor||null;
    let processed=Number(job.processed||0);
    let errors=Number(job.errors||0);
    let total=Number(job.progress_total||0);
    let paginasLidas=0;
    let scanCompleto=false;
    let removidos=0;

    if(processed===0 && !scrollId){
        await dbQuery(`DELETE FROM ml_sync_seen WHERE job_id=$1`,[job.id]);
    }

    // A API de busca entrega no máximo 100 IDs por chamada. A V42 reúne
    // essas páginas em um lote lógico de até 5.000 e só então processa os
    // detalhes em paralelo via /items/bulk, preservando o cursor do scan.
    const TAMANHO_LOTE_LOGICO=5000;
    const MAX_PAGINAS_POR_LOTE=50;

    while(!scanCompleto && paginasLidas<2000){
        const idsLote=[];
        let cursorLote=scrollId;
        let fimEncontrado=false;
        let paginasNoLote=0;

        while(idsLote.length<TAMANHO_LOTE_LOGICO && paginasNoLote<MAX_PAGINAS_POR_LOTE && paginasLidas<2000){
            const params=new URLSearchParams({search_type:'scan',limit:'100'});
            if(cursorLote)params.set('scroll_id',cursorLote);

            const sr=await mlFetch(`${ML_API}/users/${job.seller_id}/items/search?${params}`,token);
            const sd=await jsonSeguro(sr);
            if(!sr.ok)throw new Error(formatarErroMercadoLivre(sd)||`Mercado Livre HTTP ${sr.status}`);

            if(total<=0){
                total=Number(sd?.paging?.total||0);
                if(total>0){
                    await dbQuery(`UPDATE ml_jobs SET progress_total=$2,updated_at=NOW() WHERE id=$1`,[job.id,total]);
                }
            }

            const ids=Array.isArray(sd.results)?sd.results.map(String).filter(Boolean):[];
            paginasLidas++;
            paginasNoLote++;

            if(!ids.length){
                cursorLote=null;
                fimEncontrado=true;
                break;
            }

            idsLote.push(...ids);
            cursorLote=sd.scroll_id||null;

            if(!cursorLote){
                fimEncontrado=true;
                break;
            }

            // Atualização visual leve durante a coleta do lote, sem considerar
            // os itens como processados antes de os detalhes entrarem no banco.
            if(idsLote.length%1000===0 || idsLote.length>=TAMANHO_LOTE_LOGICO){
                const loteNumero=Math.floor(processed/TAMANHO_LOTE_LOGICO)+1;
                await dbQuery(`
                  UPDATE ml_jobs SET message=$2,updated_at=NOW() WHERE id=$1
                `,[job.id,
                   `Preparando lote ${loteNumero.toLocaleString('pt-BR')} · ${idsLote.length.toLocaleString('pt-BR')}/5.000 IDs coletados`]);
            }
        }

        if(!idsLote.length){
            scanCompleto=true;
            scrollId=null;
            break;
        }

        const idsUnicos=[...new Set(idsLote)];

        // Marca todos os IDs do lote em uma única operação SQL.
        await dbQuery(`
          INSERT INTO ml_sync_seen(job_id,seller_id,item_id)
          SELECT $1,$2,x
          FROM unnest($3::text[]) AS x
          ON CONFLICT(job_id,item_id) DO NOTHING
        `,[job.id,job.seller_id,idsUnicos]);

        // Busca detalhes de todo o lote de 5.000 usando requisições bulk
        // paralelas e controladas. /items/bulk aceita até 20 IDs por chamada.
        const detalhes=await buscarItensBulkFreteRapido(token,idsUnicos);
        const itens=idsUnicos.map(id=>detalhes.mapa[String(id)]).filter(Boolean);
        errors+=Math.max(0,idsUnicos.length-itens.length);

        let comissoesConsultadas=0;
        if(itens.length){
            const enriquecidos=await enriquecerComissoesV28(job.seller_id,itens,token);
            comissoesConsultadas=enriquecidos.consultados;
            errors+=enriquecidos.erros;
            await upsertItensDb(job.seller_id,enriquecidos.itens);
        }

        processed+=idsUnicos.length;
        scrollId=cursorLote;
        if(fimEncontrado||!scrollId)scanCompleto=true;

        const loteAtual=Math.ceil(processed/TAMANHO_LOTE_LOGICO);
        const totalExibido=total>0?total:processed;

        await dbQuery(`
          UPDATE ml_jobs SET
            processed=$2,
            progress_current=$2,
            progress_total=CASE WHEN $3>0 THEN $3 ELSE progress_total END,
            errors=$4,
            cursor=$5,
            message=$6,
            updated_at=NOW()
          WHERE id=$1
        `,[
            job.id,
            processed,
            total,
            errors,
            scrollId,
            `Lote ${loteAtual.toLocaleString('pt-BR')} concluído · ${processed.toLocaleString('pt-BR')}/${totalExibido.toLocaleString('pt-BR')} anúncios · até 5.000 por lote · ${comissoesConsultadas.toLocaleString('pt-BR')} comissão(ões) consultada(s)`
        ]);
    }

    if(!scanCompleto){
        throw new Error('A varredura não chegou ao final. A reconciliação de exclusões não foi executada por segurança.');
    }

    // Espelha a conta: IDs que não apareceram na varredura completa são
    // removidos da base local. Fretes dos itens existentes permanecem intactos.
    const del=await dbQuery(`
      DELETE FROM ml_items m
      WHERE m.seller_id=$1
        AND NOT EXISTS(
          SELECT 1
          FROM ml_sync_seen s
          WHERE s.job_id=$2
            AND s.seller_id=$1
            AND s.item_id=m.item_id
        )
      RETURNING m.item_id
    `,[job.seller_id,job.id]);
    removidos=del.rowCount||0;

    await dbQuery(`DELETE FROM ml_sync_seen WHERE job_id=$1`,[job.id]);

    const finalTotal=total>0?total:processed;
    await dbQuery(`
      UPDATE ml_jobs SET
        status='completed',
        progress_current=$2,
        progress_total=$3,
        processed=$2,
        errors=$4,
        cursor=NULL,
        message=$5,
        finished_at=NOW(),
        updated_at=NOW()
      WHERE id=$1
    `,[
        job.id,
        processed,
        finalTotal,
        errors,
        `Anúncios concluídos em lotes de até 5.000: ${processed.toLocaleString('pt-BR')} processado(s) · ${removidos.toLocaleString('pt-BR')} removido(s) da base por não existirem mais na conta · fretes preservados.`
    ]);
}

async function obterTokenPersistenteParaSeller(sellerId) {
    // O projeto atual usa um store OAuth único. Valida se ele pertence ao seller do job.
    try {
        const store=lerOAuthStore();
        if(!store?.access_token) return null;
        const token=await renovarAccessTokenSeNecessario(false);
        const meRes=await mlFetch(`${ML_API}/users/me`,token);
        const me=await jsonSeguro(meRes);
        return String(me?.id)===String(sellerId)?token:null;
    } catch(e){return null}
}

async function processarNotificacaoFila() {
    if(!db) return;
    const client=await db.connect();
    let n=null;
    try {
        await client.query('BEGIN');
        const r=await client.query(`SELECT * FROM ml_notifications WHERE status='queued' AND available_at<=NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
        if(!r.rows.length){await client.query('COMMIT');return}
        n=r.rows[0];
        await client.query(`UPDATE ml_notifications SET status='running',attempts=attempts+1 WHERE id=$1`,[n.id]);
        await client.query('COMMIT');
    } catch(e){await client.query('ROLLBACK');throw e} finally{client.release()}
    try {
        const token=await obterTokenPersistenteParaSeller(n.seller_id);
        if(!token) throw new Error('Token indisponível.');
        const resource=String(n.resource||'');
        if(resource.startsWith('/items/')) {
            const r=await mlFetch(`${ML_API}${resource}`,token);
            const item=await jsonSeguro(r);
            if(r.ok && item?.id) await upsertItensDb(n.seller_id,[item]);
        }
        await dbQuery(`UPDATE ml_notifications SET status='completed',processed_at=NOW() WHERE id=$1`,[n.id]);
    } catch(e) {
        const delay=Math.min(3600,Math.pow(2,Math.min(8,Number(n.attempts||0)+1))*15);
        await dbQuery(`UPDATE ml_notifications SET status=CASE WHEN attempts>=8 THEN 'failed' ELSE 'queued' END,available_at=NOW()+($2||' seconds')::interval WHERE id=$1`,[n.id,String(delay)]);
    }
}


/* =========================================================
   V36 — ATUALIZAÇÃO DE PREÇOS EM JOB PERSISTENTE
   Escala para dezenas de milhares de anúncios sem depender
   do navegador ficar aberto.
========================================================= */

async function gravarErrosPrecoV36(jobId,sellerId,erros){
    if(!erros.length)return;
    const rows=erros.map(e=>({
        item_id:String(e.id||''),
        requested_price:Number(e.requested_price||0),
        failure_type:String(e.tipo_falha||'erro'),
        message_pt:String(e.erro||'Falha sem detalhe.'),
        technical_message:String(e.erro_tecnico||''),
        http_status:e.http_status==null?null:Number(e.http_status),
        code:e.codigo==null?null:String(e.codigo),
        attempts:Number(e.tentativas||0)
    })).filter(x=>x.item_id);

    if(!rows.length)return;

    await dbQuery(`
      INSERT INTO ml_price_update_errors(
        job_id,seller_id,item_id,requested_price,failure_type,
        message_pt,technical_message,http_status,code,attempts,updated_at
      )
      SELECT
        $1::bigint,$2::bigint,x.item_id,x.requested_price,x.failure_type,
        x.message_pt,x.technical_message,x.http_status,x.code,x.attempts,NOW()
      FROM jsonb_to_recordset($3::jsonb) AS x(
        item_id text,
        requested_price numeric,
        failure_type text,
        message_pt text,
        technical_message text,
        http_status integer,
        code text,
        attempts integer
      )
      ON CONFLICT(job_id,item_id) DO UPDATE SET
        requested_price=EXCLUDED.requested_price,
        failure_type=EXCLUDED.failure_type,
        message_pt=EXCLUDED.message_pt,
        technical_message=EXCLUDED.technical_message,
        http_status=EXCLUDED.http_status,
        code=EXCLUDED.code,
        attempts=EXCLUDED.attempts,
        updated_at=NOW()
    `,[jobId,sellerId,JSON.stringify(rows)]);
}

async function processarAtualizacaoPrecosMassaV36(job){
    const token=await obterTokenPersistenteParaSeller(job.seller_id);
    if(!token)throw new Error('Token Mercado Livre indisponível para atualizar preços.');

    const itens=Array.isArray(job.payload?.items)?job.payload.items:[];
    const total=itens.length;
    let indice=Math.max(0,Number(job.cursor||0));
    let sucessos=Number(job.result?.success||0);
    let erros=Number(job.errors||0);
    let bloqueados=Number(job.result?.blocked||0);
    let temporarios=Number(job.result?.temporary||0);

    const CHUNK=Math.max(100,Math.min(1000,Number(process.env.ML_PRICE_MASS_CHUNK||500)));
    const CONCORRENCIA=Math.max(2,Math.min(20,Number(process.env.ML_PRICE_MASS_CONCURRENCY||10)));
    const PAUSA_GRUPO=Math.max(25,Math.min(1000,Number(process.env.ML_PRICE_MASS_GROUP_DELAY_MS||90)));

    if(indice===0){
        await dbQuery(`DELETE FROM ml_price_update_errors WHERE job_id=$1`,[job.id]);
    }

    while(indice<total){
        const lote=itens.slice(indice,Math.min(total,indice+CHUNK));
        const ids=lote.map(x=>String(x.id));

        const meta=await dbQuery(`
          SELECT item_id,status,raw
          FROM ml_items
          WHERE seller_id=$1 AND item_id=ANY($2::text[])
        `,[job.seller_id,ids]);

        const metaMap=new Map(meta.rows.map(r=>[
            String(r.item_id),
            {
                status:String(r.status||''),
                dynamicPricing:Array.isArray(r?.raw?.tags)
                  ? r.raw.tags.includes('dynamic_standard_price')
                  : false,
                subStatus:Array.isArray(r?.raw?.sub_status)?r.raw.sub_status:[]
            }
        ]));

        const resultados=new Array(lote.length);
        let cursorLocal=0;

        async function workerPreco(){
            while(true){
                const pos=cursorLocal++;
                if(pos>=lote.length)return;

                const item=lote[pos];
                const m=metaMap.get(String(item.id))||{};
                const st=String(m.status||'').toLowerCase();

                if(st && st!=='active'){
                    resultados[pos]={
                        id:item.id,
                        requested_price:Number(item.price||0),
                        sucesso:false,
                        bloqueado:true,
                        tipo_falha:'bloqueio',
                        http_status:400,
                        codigo:'item.price.not_modifiable',
                        tentativas:0,
                        erro:motivoBloqueioStatusV35(st),
                        erro_tecnico:`status:${st}`
                    };
                    continue;
                }

                if(m.dynamicPricing){
                    resultados[pos]={
                        id:item.id,
                        requested_price:Number(item.price||0),
                        sucesso:false,
                        bloqueado:true,
                        tipo_falha:'bloqueio',
                        http_status:400,
                        codigo:'item.price.not_modifiable',
                        tentativas:0,
                        erro:'Este anúncio está com Automatização de Preços configurada no Mercado Livre. Desative a automatização antes de alterar o preço manualmente pela API.',
                        erro_tecnico:'dynamic_standard_price'
                    };
                    continue;
                }

                resultados[pos]=await atualizarPrecoItemV35(item,token,m);
            }
        }

        for(let p=0;p<CONCORRENCIA;p++){
            if(p>0)await esperarV35(Math.min(PAUSA_GRUPO,75));
            workerPreco();
        }

        // Espera todos os workers terminarem usando polling leve do cursor/results.
        while(resultados.filter(Boolean).length<lote.length){
            await esperarV35(80);
        }

        const ok=resultados.filter(r=>r?.sucesso);
        const falhas=resultados.filter(r=>!r?.sucesso);

        if(ok.length){
            await atualizarPrecosDbLoteV26(
                job.seller_id,
                ok.map(r=>({id:r.id,price:r.price??r.requested_price}))
            );
        }

        if(falhas.length){
            await gravarErrosPrecoV36(job.id,job.seller_id,falhas);
        }

        sucessos+=ok.length;
        erros+=falhas.length;
        bloqueados+=falhas.filter(x=>x?.bloqueado||x?.tipo_falha==='bloqueio').length;
        temporarios+=falhas.filter(x=>x?.tipo_falha==='temporario').length;
        indice+=lote.length;

        const pct=total?Math.round((indice/total)*100):100;
        const result={
            success:sucessos,
            failed:erros,
            blocked:bloqueados,
            temporary:temporarios,
            concurrency:CONCORRENCIA,
            chunk:CHUNK
        };

        await dbQuery(`
          UPDATE ml_jobs SET
            processed=$2,
            progress_current=$2,
            progress_total=$3,
            errors=$4,
            cursor=$5,
            result=$6::jsonb,
            message=$7,
            updated_at=NOW()
          WHERE id=$1
        `,[
            job.id,indice,total,erros,String(indice),JSON.stringify(result),
            `Atualização de preços: ${indice.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · ${pct}% · ${sucessos.toLocaleString('pt-BR')} atualizado(s) · ${erros.toLocaleString('pt-BR')} não atualizado(s)`
        ]);

        await esperarV35(PAUSA_GRUPO);
    }

    await dbQuery(`
      UPDATE ml_jobs SET
        status='completed',
        processed=$2,
        progress_current=$2,
        progress_total=$3,
        errors=$4,
        cursor=NULL,
        result=$5::jsonb,
        message=$6,
        finished_at=NOW(),
        updated_at=NOW()
      WHERE id=$1
    `,[
        job.id,total,total,erros,
        JSON.stringify({
            success:sucessos,
            failed:erros,
            blocked:bloqueados,
            temporary:temporarios,
            concurrency:CONCORRENCIA,
            chunk:CHUNK
        }),
        `Preços concluídos: ${sucessos.toLocaleString('pt-BR')} atualizado(s), ${erros.toLocaleString('pt-BR')} não atualizado(s).`
    ]);
}

/* =========================================================
   V36 — CRIAÇÃO DE ANÚNCIOS EM MASSA
========================================================= */

function limitarTituloV36(texto,limite=60){
    let t=String(texto||'').replace(/\s+/g,' ').trim();
    if(t.length<=limite)return t;
    t=t.slice(0,limite+1);
    const corte=t.lastIndexOf(' ');
    if(corte>=Math.floor(limite*0.72))t=t.slice(0,corte);
    return t.slice(0,limite).trim();
}

async function gerarImagemGeminiV36(prompt){
    const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
    if(!apiKey)throw new Error('Configure GEMINI_API_KEY no Render para gerar imagens.');

    const model=String(process.env.GEMINI_IMAGE_MODEL||'gemini-3.1-flash-lite-image').trim();
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const r=await fetch(url,{
        method:'POST',
        headers:{
            'Content-Type':'application/json',
            'x-goog-api-key':apiKey
        },
        body:JSON.stringify({
            contents:[{
                parts:[{
                    text:String(prompt||'')+
                      '\nGere uma imagem quadrada 1:1 de produto para marketplace, fundo branco puro, iluminação de estúdio, sem pessoas, sem marcas d’água visuais, sem texto promocional, sem inventar acessórios ou características que não foram informadas.'
                }]
            }],
            generationConfig:{
                responseModalities:['IMAGE']
            }
        })
    });

    const d=await r.json().catch(()=>({}));
    if(!r.ok){
        const msg=String(d?.error?.message||d?.message||`Gemini HTTP ${r.status}`);
        if(r.status===429)throw new Error('O limite gratuito do Gemini para imagens foi atingido temporariamente. Aguarde e tente novamente.');
        throw new Error(msg);
    }

    const parts=d?.candidates?.[0]?.content?.parts||[];
    const imagePart=parts.find(p=>p?.inlineData?.data||p?.inline_data?.data);
    const inline=imagePart?.inlineData||imagePart?.inline_data;

    if(!inline?.data)throw new Error('O Gemini respondeu sem uma imagem utilizável.');

    return {
        buffer:Buffer.from(inline.data,'base64'),
        mime:String(inline.mimeType||inline.mime_type||'image/png'),
        model
    };
}

async function enviarImagemMercadoLivreV36(token,img){
    const mod=await import('node-fetch');
    const form=new mod.FormData();
    const blob=new mod.Blob([img.buffer],{type:img.mime||'image/png'});
    form.append('file',blob,'ml-hub-pro-ai.png');

    const r=await mod.default(`${ML_API}/pictures/items/upload`,{
        method:'POST',
        headers:{Authorization:`Bearer ${token}`},
        body:form
    });
    const d=await r.json().catch(()=>({}));

    if(!r.ok || !d?.id){
        throw new Error(formatarErroMercadoLivre(d)||`Falha ao enviar imagem ao Mercado Livre (HTTP ${r.status}).`);
    }

    const melhor=(Array.isArray(d.variations)?d.variations:[])
      .sort((a,b)=>{
          const aa=String(a.size||'0x0').split('x').map(Number);
          const bb=String(b.size||'0x0').split('x').map(Number);
          return (bb[0]*bb[1])-(aa[0]*aa[1]);
      })[0];

    return {
        id:String(d.id),
        url:String(melhor?.secure_url||melhor?.url||''),
        model:img.model
    };
}



function parseDataUrlV37(dataUrl){
    const m=String(dataUrl||'').match(/^data:([^;]+);base64,(.+)$/);
    if(!m)return null;
    return {mime:m[1],data:m[2]};
}

function modelosGeminiVisionV38(){
    const configurados=[
        String(process.env.GEMINI_VISION_MODEL||'').trim(),
        String(process.env.GEMINI_MODEL||'').trim()
    ].filter(Boolean);
    return [...new Set([
        ...configurados,
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite'
    ])];
}

function modelosGeminiImagemV39(){
    const configurado=String(process.env.GEMINI_IMAGE_MODEL||'').trim();
    return [...new Set([
        configurado,
        'gemini-3.1-flash-image',
        'gemini-3.1-flash-lite-image',
        'gemini-2.5-flash-image'
    ].filter(Boolean))];
}

function erroModeloGeminiV38(msg){
    return /model|modelo|not found|not supported|unsupported|unknown|does not exist|no longer available|not available/i.test(String(msg||''));
}

function erroGeminiImagemAmigavelV38(status,msg){
    const texto=String(msg||'').trim();
    if(status===401||status===403)return 'A chave GEMINI_API_KEY não tem permissão para gerar imagens. Confira o projeto no Google AI Studio.';
    if(status===429)return 'O limite temporário de geração de imagens do Gemini foi atingido. O sistema tentou novamente automaticamente; clique de novo depois para continuar exatamente de onde parou.';
    if(status===503||status===504)return 'O Gemini está com alta demanda para imagens. O sistema tentou novamente automaticamente; você pode continuar a geração depois.';
    if(erroModeloGeminiV38(texto))return 'O modelo de imagem configurado não está disponível. O sistema tentou os modelos atuais automaticamente.';
    return texto||`Gemini HTTP ${status}`;
}

function montarPartesGeminiV38(prompt,referenceImages=[]){
    const parts=[{text:String(prompt||'')}];
    for(const ref of (Array.isArray(referenceImages)?referenceImages:[]).slice(0,8)){
        const img=parseDataUrlV37(ref);
        if(img?.data){
            parts.push({inlineData:{mimeType:img.mime||'image/png',data:img.data}});
        }
    }
    return parts;
}

async function chamarGeminiJsonVisionV37(prompt,referenceImages=[]){
    const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
    if(!apiKey)throw new Error('Configure GEMINI_API_KEY no Render para usar a IA com imagem.');

    const modelos=modelosGeminiVisionV38();
    let ultimoErro=null;

    for(const model of modelos){
        for(let tentativa=1;tentativa<=3;tentativa++){
            try{
                const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
                const r=await fetch(url,{
                    method:'POST',
                    headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
                    body:JSON.stringify({
                        contents:[{parts:montarPartesGeminiV38(prompt,referenceImages)}],
                        generationConfig:{temperature:0.35,responseMimeType:'application/json'}
                    })
                });
                const d=await r.json().catch(()=>({}));
                if(r.ok){
                    const txt=(d?.candidates?.[0]?.content?.parts||[]).map(p=>p?.text||'').join('\n').trim();
                    if(!txt){ultimoErro=new Error('O Gemini respondeu sem conteúdo estruturado.');break;}
                    return extrairJsonIA(txt);
                }

                const bruto=String(d?.error?.message||d?.message||`Gemini HTTP ${r.status}`);
                ultimoErro=new Error(erroGeminiAmigavel(r.status,d));
                if((r.status===400||r.status===404)&&erroModeloGeminiV38(bruto))break;
                if(erroGeminiTransitorio(r.status)){
                    if(tentativa<3){
                        const retryAfter=Number(r.headers.get('retry-after')||0);
                        const espera=retryAfter>0?Math.min(10000,retryAfter*1000):(tentativa===1?1800:4200);
                        await esperarGemini(espera);
                        continue;
                    }
                    break;
                }
                break;
            }catch(e){
                ultimoErro=e;
                if(tentativa<3){await esperarGemini(tentativa===1?1500:3500);continue;}
            }
        }
    }
    throw ultimoErro||new Error('Falha ao analisar o produto com IA.');
}

function erroQuotaImagemSemFaturamentoV40(status,msg){
    if(Number(status)!==429)return false;
    const t=String(msg||'').toLowerCase();
    return /free[_ ]?tier|not available.*free|billing|billed|payment|quota[^\n]*limit[^\n]*0|limit[^\n]*0|quota[^\n]*0/.test(t);
}

function extrairImagemInteracaoGeminiV40(payload){
    const d=payload?.interaction||payload||{};
    if(d?.output_image?.data){
        return {data:d.output_image.data,mime:d.output_image.mime_type||d.output_image.mimeType||'image/png'};
    }
    for(const step of (Array.isArray(d?.steps)?d.steps:[])){
        if(step?.type!=='model_output')continue;
        for(const part of (Array.isArray(step?.content)?step.content:[])){
            if(part?.type==='image'&&part?.data){
                return {data:part.data,mime:part.mime_type||part.mimeType||'image/png'};
            }
        }
    }
    return null;
}

function montarInputInteracaoImagemV40(prompt,referenceImages=[]){
    const input=[{type:'text',text:String(prompt||'')}];
    for(const ref of (Array.isArray(referenceImages)?referenceImages:[]).slice(0,8)){
        const img=parseDataUrlV37(ref);
        if(img?.data){
            input.push({type:'image',mime_type:img.mime||'image/png',data:img.data});
        }
    }
    return input;
}

async function gerarImagemGeminiV37(prompt,referenceImages=[]){
    const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
    if(!apiKey){
        const e=new Error('Configure GEMINI_API_KEY no Render para gerar imagens.');
        e.status=503; throw e;
    }

    const modelos=modelosGeminiImagemV39();
    let ultimoErro=null;
    const promptFinal=String(prompt||'').trim()+
      '\n\nRequisitos obrigatórios: imagem quadrada 1:1, resolução 1K (aprox. 1024x1024, adequada para uso em 1080x1080), alta nitidez, qualidade profissional de marketplace, sem marcas d\'água visuais adicionadas pelo layout, preservando fielmente o produto das fotos de referência.';

    for(const model of modelos){
        for(let tentativa=1;tentativa<=4;tentativa++){
            let r=null,d={};
            try{
                r=await fetch(GEMINI_INTERACTIONS_URL,{
                    method:'POST',
                    headers:{
                        'Content-Type':'application/json',
                        'x-goog-api-key':apiKey,
                        'Api-Revision':'2026-05-20'
                    },
                    body:JSON.stringify({
                        model,
                        input:montarInputInteracaoImagemV40(promptFinal,referenceImages),
                        store:false,
                        response_format:{
                            type:'image',
                            mime_type:'image/png',
                            aspect_ratio:'1:1',
                            image_size:'1K'
                        }
                    })
                });
                d=await r.json().catch(()=>({}));

                if(r.ok){
                    const out=extrairImagemInteracaoGeminiV40(d);
                    if(!out?.data){
                        ultimoErro=new Error('O Gemini respondeu sem uma imagem utilizável.');
                        ultimoErro.status=502;
                        break;
                    }
                    return {
                        buffer:Buffer.from(out.data,'base64'),
                        mime:String(out.mime||'image/png'),
                        model
                    };
                }

                const bruto=String(d?.error?.message||d?.message||`Gemini HTTP ${r.status}`);
                const semFaturamento=erroQuotaImagemSemFaturamentoV40(r.status,bruto);
                const e=new Error(
                    semFaturamento
                      ? 'A cota de geração de imagens do projeto Gemini não está disponível. A API de imagens do Gemini não possui nível gratuito para esses modelos; habilite faturamento para gerar imagens com IA. O painel pode usar o modo visual gratuito com as fotos enviadas.'
                      : erroGeminiImagemAmigavelV38(r.status,bruto)
                );
                e.status=r.status;
                e.quotaUnavailable=semFaturamento;
                e.retryAfter=Number(r.headers.get('retry-after')||0);
                e.technical=bruto;
                ultimoErro=e;

                if(semFaturamento)throw e;
                if((r.status===400||r.status===404)&&erroModeloGeminiV38(bruto))break;
                if(erroGeminiTransitorio(r.status)){
                    if(tentativa<4){
                        const espera=e.retryAfter>0?Math.min(60000,e.retryAfter*1000):[8000,16000,30000][tentativa-1];
                        await esperarGemini(espera||30000);
                        continue;
                    }
                    break;
                }
                break;
            }catch(e){
                if(e?.quotaUnavailable)throw e;
                ultimoErro=e;
                if(tentativa<4){await esperarGemini([5000,12000,22000][tentativa-1]||25000);continue;}
            }
        }
    }
    throw ultimoErro||new Error('Falha ao gerar imagem com IA.');
}


/* =========================================================
   V44 — CLOUDFLARE WORKERS AI PARA GERAÇÃO DE IMAGENS
   - Provedor primário de imagens: FLUX.2 klein 4B
   - Até 4 imagens de referência por chamada
   - Saída 1024x1024
   - Retry automático para indisponibilidade temporária
========================================================= */

function configCloudflareImagemV44(){
    return {
        accountId:String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim(),
        token:String(process.env.CLOUDFLARE_AI_TOKEN||'').trim(),
        model:String(process.env.CLOUDFLARE_IMAGE_MODEL||'@cf/black-forest-labs/flux-2-klein-4b').trim()
    };
}

function cloudflareImagemConfiguradoV44(){
    const c=configCloudflareImagemV44();
    return Boolean(c.accountId && c.token && c.model);
}

function extrairErroCloudflareV44(payload,status){
    const erros=Array.isArray(payload?.errors)?payload.errors:[];
    const primeiro=erros[0]||{};
    const code=Number(primeiro?.code||payload?.code||0);
    const msg=String(
        primeiro?.message||
        payload?.error?.message||
        payload?.message||
        `Cloudflare Workers AI HTTP ${status}`
    ).trim();

    let amigavel=msg;
    let retryable=[408,429,500,502,503,504].includes(Number(status));
    let quotaUnavailable=false;

    if(Number(status)===401){
        amigavel='O token da Cloudflare foi recusado. Confira CLOUDFLARE_AI_TOKEN no Render.';
        retryable=false;
    }else if(Number(status)===403 && code===5035){
        amigavel='Este modelo da Cloudflare exige um plano pago para esta conta. Troque CLOUDFLARE_IMAGE_MODEL por um modelo permitido no plano atual.';
        retryable=false;
        quotaUnavailable=true;
    }else if(Number(status)===403){
        amigavel='A Cloudflare recusou a permissão. Confira se o token possui Workers AI Read e Workers AI Edit e se pertence ao mesmo Account ID configurado no Render.';
        retryable=false;
    }else if(Number(status)===404 || code===3042 || code===5007){
        amigavel='O modelo configurado na Cloudflare não foi encontrado. Confira CLOUDFLARE_IMAGE_MODEL no Render.';
        retryable=false;
    }else if(Number(status)===413 || code===3006){
        amigavel='As imagens de referência ficaram grandes demais para a Cloudflare. O painel reduz as referências automaticamente; tente novamente.';
        retryable=false;
    }else if(code===3036){
        amigavel='A cota gratuita diária do Workers AI foi utilizada. Ela volta a ficar disponível após a renovação diária da Cloudflare.';
        retryable=false;
        quotaUnavailable=true;
    }else if(code===3040){
        amigavel='A Cloudflare está temporariamente sem capacidade para gerar a imagem. O sistema tentará novamente automaticamente.';
        retryable=true;
    }else if(Number(status)===429){
        amigavel='A Cloudflare limitou temporariamente as solicitações. O sistema tentará novamente automaticamente.';
        retryable=true;
    }

    const e=new Error(amigavel);
    e.status=Number(status)||500;
    e.code=code||0;
    e.retryable=retryable;
    e.quotaUnavailable=quotaUnavailable;
    e.technical=msg;
    return e;
}

function extrairImagemCloudflareV44(payload){
    const candidatos=[
        payload?.result?.image,
        payload?.image,
        payload?.result?.output?.image,
        payload?.result?.data?.image
    ];
    for(const x of candidatos){
        if(typeof x==='string' && x.trim())return x.trim();
    }
    return '';
}

async function gerarImagemCloudflareV44(prompt,referenceImages=[]){
    const cfg=configCloudflareImagemV44();
    if(!cfg.accountId || !cfg.token){
        const e=new Error('Configure CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_AI_TOKEN no Render para gerar imagens.');
        e.status=503;
        e.retryable=false;
        throw e;
    }

    const refs=(Array.isArray(referenceImages)?referenceImages:[])
        .map(parseDataUrlV37)
        .filter(Boolean)
        .slice(0,4);

    const mod=await import('node-fetch');
    const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfg.accountId)}/ai/run/${cfg.model}`;
    const promptFinal=String(prompt||'').trim()+
      '\n\nUse as imagens de referência como fonte principal da aparência do produto. Preserve formato, cor, acabamento, acessórios realmente visíveis e identidade visual do item. Não invente marca, modelo, acessórios ou especificações. Saída quadrada profissional para marketplace.';

    let ultimoErro=null;

    for(let tentativa=1;tentativa<=5;tentativa++){
        try{
            const form=new mod.FormData();
            form.append('prompt',promptFinal);
            form.append('width','1080');
            form.append('height','1080');
            form.append('guidance','3.5');

            refs.forEach((img,i)=>{
                const blob=new mod.Blob(
                    [Buffer.from(img.data,'base64')],
                    {type:img.mime||'image/jpeg'}
                );
                const ext=/png/i.test(img.mime||'')?'png':'jpg';
                form.append(`input_image_${i}`,blob,`referencia-${i+1}.${ext}`);
            });

            const r=await mod.default(url,{
                method:'POST',
                headers:{Authorization:`Bearer ${cfg.token}`},
                body:form
            });

            const contentType=String(r.headers.get('content-type')||'').toLowerCase();

            if(r.ok && contentType.startsWith('image/')){
                const ab=await r.arrayBuffer();
                const buffer=Buffer.from(ab);
                if(!buffer.length)throw new Error('A Cloudflare respondeu com uma imagem vazia.');
                return {buffer,mime:contentType.split(';')[0]||'image/png',model:cfg.model,provider:'cloudflare'};
            }

            let d={};
            try{ d=await r.json(); }
            catch{
                const txt=await r.text().catch(()=> '');
                d={message:txt};
            }

            if(r.ok){
                const b64=extrairImagemCloudflareV44(d);
                if(!b64){
                    const e=new Error('A Cloudflare respondeu sem uma imagem utilizável.');
                    e.status=502;
                    throw e;
                }
                return {
                    buffer:Buffer.from(b64,'base64'),
                    mime:'image/png',
                    model:cfg.model,
                    provider:'cloudflare'
                };
            }

            const e=extrairErroCloudflareV44(d,r.status);
            const retryAfter=Number(r.headers.get('retry-after')||0);
            e.retryAfter=retryAfter;
            ultimoErro=e;

            if(!e.retryable || tentativa>=5)throw e;

            const espera=retryAfter>0
                ? Math.min(30000,retryAfter*1000)
                : [2500,5000,8500,12000][tentativa-1]||15000;
            await esperarGemini(espera);
        }catch(e){
            ultimoErro=e;
            if(e?.quotaUnavailable || e?.retryable===false || tentativa>=5)throw e;
            if(tentativa<5){
                await esperarGemini([1800,3500,6500,10000][tentativa-1]||12000);
                continue;
            }
        }
    }

    throw ultimoErro||new Error('Falha ao gerar imagem com Cloudflare Workers AI.');
}

const CENAS_IMAGENS_V38=[
    {chave:'capa',titulo:'Capa premium',prompt:`Use a foto de referência para manter exatamente o mesmo produto. Gere uma imagem 1080x1080 para capa premium de anúncio do Mercado Livre. Fundo branco puro obrigatório, produto fiel e centralizado, iluminação de estúdio, sombra suave, brilho/controlado, composição mais elaborada e elegante, visual de alta conversão, sem poluição, sem pessoas, sem marcas d'água e com o mínimo possível de texto.`},
    {chave:'angulo',titulo:'Ângulo complementar',prompt:`Use a foto de referência. Gere uma imagem 1080x1080 mostrando o mesmo produto em ângulo complementar, com fundo branco limpo, iluminação profissional e aparência fiel ao item real.`},
    {chave:'detalhe',titulo:'Close de detalhe',prompt:`Use a foto de referência. Gere uma imagem 1080x1080 com close-up de detalhe do mesmo produto, destacando textura, material ou acabamento realmente visível, com fundo claro e composição comercial.`},
    {chave:'uso1',titulo:'Aplicação 1',prompt:`Use a foto de referência e os detalhes fornecidos. Gere uma imagem 1080x1080 de aplicação do produto em uso real. A cena deve estar perfeita, sem mãos deformadas, sem dedos extras, sem erros anatômicos. Se houver risco de erro anatômico, prefira mostrar apenas mãos corretas ou uma aplicação indireta do produto, sempre com resultado visual perfeito.`},
    {chave:'uso2',titulo:'Aplicação 2',prompt:`Use a foto de referência. Gere outra imagem 1080x1080 de uso do mesmo produto em ambiente real, mostrando benefício prático e contexto de utilização. A cena deve ser correta e natural; se a aplicação com pessoas não ficar perfeita, mostre o uso com enquadramento seguro e sem deformações.`},
    {chave:'kit',titulo:'Conteúdo da embalagem',prompt:`Use a foto de referência. Gere uma imagem 1080x1080 estilo flat lay mostrando o produto e somente os itens inclusos que estejam visíveis ou claramente informados. Se os acessórios não forem conhecidos, não invente itens.`},
    {chave:'ficha',titulo:'Ficha técnica',prompt:`Use a foto de referência. Gere uma arte 1080x1080 com o mesmo produto e uma ficha visual em português, com textos curtos, técnicos e claros apenas sobre fatos confirmados pelo vendedor ou claramente visíveis. Não invente medidas, materiais ou especificações.`},
    {chave:'medidas',titulo:'Proporção / dimensões',prompt:`Use a foto de referência. Gere uma imagem 1080x1080 que ajude a compreender proporção e escala. Só use números de medidas se eles tiverem sido fornecidos; caso contrário, não invente dimensões.`},
    {chave:'beneficios',titulo:'Benefícios',prompt:`Use a foto de referência. Gere uma arte 1080x1080 com o mesmo produto e de 3 a 5 benefícios em português baseados apenas em características reais ou informadas, com foco em clareza e conversão.`},
    {chave:'seo',titulo:'Destaques de compra',prompt:`Use a foto de referência. Gere uma arte 1080x1080 com o produto em destaque e textos curtos em português com termos de uso e diferenciais reais, em estilo marketplace limpo e voltado para conversão. Evite excesso de texto.`},
    {chave:'lifestyle',titulo:'Lifestyle final',prompt:`Use a foto de referência. Gere uma imagem 1080x1080 lifestyle comercial mostrando o mesmo produto em ambiente bonito e realista, preservando fielmente formato, cor e características visuais.`}
];

async function gerarPacote11ImagensV37({token,produto,detalhes,referenceImages=[]}){
    const pictures=[];
    for(let idx=0;idx<CENAS_IMAGENS_V38.length;idx++){
        const cena=CENAS_IMAGENS_V38[idx];
        const prompt=`Produto: ${produto||'Produto sem nome informado'}\nDetalhes informados: ${detalhes||'Nenhum detalhe adicional.'}\n${cena.prompt}`;
        const img=await gerarImagemGeminiV37(prompt,referenceImages);
        const pic=await enviarImagemMercadoLivreV36(token,img);
        pictures.push({index:idx,tipo:cena.chave,titulo:cena.titulo,id:pic.id,url:pic.url,model:img.model});
        if(idx<CENAS_IMAGENS_V38.length-1)await esperarGemini(900);
    }
    return pictures;
}

function normalizarCategoriasConfigV37(cfg){
    const lista=Array.isArray(cfg?.categories)?cfg.categories:[];
    const out=[];
    const seen=new Set();
    for(const c of lista){
        const id=String(c?.category_id||c?.id||'').trim();
        if(!id||seen.has(id))continue;
        seen.add(id);
        out.push({
            category_id:id,
            category_name:String(c?.category_name||c?.name||id),
            attributes:Array.isArray(c?.attributes)?c.attributes:[]
        });
    }
    if(!out.length && String(cfg?.category_id||'').trim()){
        out.push({category_id:String(cfg.category_id).trim(),category_name:String(cfg.category_name||cfg.category_id),attributes:Array.isArray(cfg?.attributes)?cfg.attributes:[]});
    }
    return out;
}


/* =========================================================
   V50 — MERCADO ENVIOS 2 FIXO + URL MANUAL DE IMAGENS
========================================================= */
const cacheShippingPublicacaoV47=new Map();

function normalizarUrlsManuaisV47(valor){
    const itens=[];
    const entrada=Array.isArray(valor)?valor.join('\n'):String(valor||'');
    const encontrados=entrada.match(/https?:\/\/[^\s,\]\)]+/gi)||[];
    const seen=new Set();
    for(const raw of encontrados){
        const url=String(raw||'').trim().replace(/[;]+$/,'');
        if(!url||seen.has(url))continue;
        try{
            const u=new URL(url);
            if(!['http:','https:'].includes(u.protocol))continue;
            seen.add(url);itens.push(url);
        }catch{}
    }
    return itens.slice(0,30);
}

async function obterPreferenciasEnvioPublicacaoV47(token,sellerId,categoryId,{force=false}={}){
    sellerId=String(sellerId||'').trim();
    categoryId=String(categoryId||'').trim();
    if(!sellerId||!categoryId)throw new Error('Não foi possível identificar vendedor/categoria para configurar o Mercado Envios.');

    const key=`${sellerId}:${categoryId}:me2`;
    const ttl=10*60*1000;
    const cached=cacheShippingPublicacaoV47.get(key);
    if(!force && cached && (Date.now()-cached.at)<ttl)return cached.data;

    const [ur,cr]=await Promise.all([
        mlFetch(`${ML_API}/users/${encodeURIComponent(sellerId)}/shipping_preferences`,token),
        mlFetch(`${ML_API}/categories/${encodeURIComponent(categoryId)}/shipping_preferences`,token)
    ]);
    const [ud,cd]=await Promise.all([jsonSeguro(ur),jsonSeguro(cr)]);
    if(!ur.ok)throw new Error('Não foi possível consultar as preferências de envio da conta: '+formatarErroMercadoLivre(ud));
    if(!cr.ok)throw new Error('Não foi possível consultar os modos de envio da categoria: '+formatarErroMercadoLivre(cd));

    const userModes=[...new Set((Array.isArray(ud?.modes)?ud.modes:[]).map(x=>String(x||'').toLowerCase()).filter(Boolean))];
    const categoryModes=[...new Set((Array.isArray(cd?.logistics)?cd.logistics:[]).map(x=>String(x?.mode||'').toLowerCase()).filter(Boolean))];
    const me2User=userModes.includes('me2');
    const me2Category=categoryModes.includes('me2');

    // O painel publica EXCLUSIVAMENTE com Mercado Envios 2.
    // Não existe mais fallback para ME1, not_specified ou custom.
    if(!me2User){
        const e=new Error('Sua conta não retornou Mercado Envios 2 (me2) como modo habilitado. Confirme o Mercado Envios na conta antes de publicar.');
        e.code='shipping.me2_not_enabled_for_user';
        throw e;
    }
    if(!me2Category){
        const e=new Error('A categoria escolhida não aceita Mercado Envios 2 (me2). Escolha uma categoria compatível com Mercado Envios.');
        e.code='shipping.me2_not_enabled_for_category';
        throw e;
    }

    const shipping={
        mode:'me2',
        local_pick_up:false,
        free_shipping:false,
        free_methods:[]
    };
    const data={
        mode:'me2',
        candidates:['me2'],
        userModes,
        categoryModes,
        shipping,
        restricted:Boolean(cd?.restricted),
        logistics:Array.isArray(cd?.logistics)?cd.logistics:[],
        category_dimensions:cd?.dimensions||null,
        category_me2_restrictions:cd?.me2_restrictions||null,
        user_option:ud?.option??null,
        user_tags:Array.isArray(ud?.tags)?ud.tags:[],
        user_logistics:Array.isArray(ud?.logistics)?ud.logistics:[]
    };
    cacheShippingPublicacaoV47.set(key,{at:Date.now(),data});
    return data;
}

function contemErroModoEnvioV47(data){
    const txt=JSON.stringify(data||{}).toLowerCase();
    return txt.includes('shipping') || txt.includes('me1') || txt.includes('me2');
}



/* =========================================================
   V51 — CAMPOS COMERCIAIS + VALIDAÇÃO SEM BLOQUEAR WARNINGS
========================================================= */
function causasMercadoV51(data){
    return Array.isArray(data?.cause)?data.cause:[];
}
function causasBloqueantesMercadoV51(data){
    return causasMercadoV51(data).filter(c=>String(c?.type||'error').toLowerCase()!=='warning');
}
function somenteWarningsMercadoV51(data){
    const c=causasMercadoV51(data);
    return c.length>0 && causasBloqueantesMercadoV51(data).length===0;
}
function temCodigoCausaV51(data,code){
    const alvo=String(code||'').toLowerCase();
    return causasMercadoV51(data).some(c=>String(c?.code||'').toLowerCase()===alvo);
}
function ehAvisoEnvioAutocorrigivelV51(data){
    const permitidos=new Set([
        'shipping.lost_me1_by_user',
        'shipping.me2_adoption_mandatory',
        'item.shipping.mandatory_free_shipping'
    ]);
    const c=causasMercadoV51(data);
    return c.length>0 && c.every(x=>{
        const tipo=String(x?.type||'warning').toLowerCase();
        const code=String(x?.code||'').toLowerCase();
        return tipo==='warning' || permitidos.has(code);
    });
}
function montarSaleTermsV51(cfg={}){
    const tipo=String(cfg.warranty_type||'none').toLowerCase();
    const numero=Math.max(0,Number(cfg.warranty_time||0));
    const unidadeRaw=String(cfg.warranty_unit||'dias').toLowerCase();
    const unidade=['dias','meses','anos'].includes(unidadeRaw)?unidadeRaw:'dias';

    if(tipo==='none'){
        return [{id:'WARRANTY_TYPE',value_id:'6150835',value_name:'Sem garantia'}];
    }
    const idTipo=tipo==='factory'?'2230279':'2230280';
    const nomeTipo=tipo==='factory'?'Garantia de fábrica':'Garantia do vendedor';
    const termos=[{id:'WARRANTY_TYPE',value_id:idTipo,value_name:nomeTipo}];
    if(numero>0){
        const sing=numero===1?({dias:'dia',meses:'mês',anos:'ano'}[unidade]):unidade;
        termos.push({id:'WARRANTY_TIME',value_name:`${numero} ${sing}`});
    }
    return termos;
}
function aplicarCodigoUniversalV51(payload,cfg={},meta){
    if(!payload)return;
    const modo=String(cfg.universal_code_mode||'no_code').toLowerCase();
    const codigo=String(cfg.universal_code||'').replace(/\s+/g,'').trim();
    const attrs=Array.isArray(payload.attributes)
      ? payload.attributes.filter(a=>!['GTIN','EMPTY_GTIN_REASON'].includes(String(a?.id||'')))
      : [];
    const defMap=meta?.defMap;

    if(modo==='gtin'){
        if(codigo && defMap?.has?.('GTIN'))attrs.push({id:'GTIN',value_name:codigo});
    }else{
        const def=defMap?.get?.('EMPTY_GTIN_REASON');
        if(def){
            const vals=Array.isArray(def.values)?def.values:[];
            const norm=s=>normalizarTextoBuscaV46(s);
            const alvo=vals.find(v=>{
                const n=norm(v?.name||'');
                return n.includes('nao registrado') || n.includes('no registrado') || n.includes('sem codigo') || n.includes('nao cadastrado');
            }) || vals.find(v=>String(v?.id||'')==='17055160');
            if(alvo){
                attrs.push({
                    id:'EMPTY_GTIN_REASON',
                    value_id:String(alvo.id||''),
                    value_name:String(alvo.name||'Não registrado')
                });
            }else{
                attrs.push({id:'EMPTY_GTIN_REASON',value_id:'17055160',value_name:'Não registrado'});
            }
        }
    }
    payload.attributes=attrs;
}
function ajustarSaleTermsCategoriaV51(payload,cfg={},meta){
    if(!payload)return;
    const defs=Array.isArray(meta?.sale_terms)?meta.sale_terms:[];
    if(!defs.length)return;

    const map=new Map(defs.map(d=>[String(d?.id||''),d]));
    const tipo=String(cfg.warranty_type||'none').toLowerCase();
    const termos=[];

    const wt=map.get('WARRANTY_TYPE');
    if(wt){
        const wanted=tipo==='factory'?'2230279':tipo==='seller'?'2230280':'6150835';
        const vals=Array.isArray(wt.values)?wt.values:[];
        const match=vals.find(v=>String(v?.id||'')===wanted);
        if(match)termos.push({id:'WARRANTY_TYPE',value_id:String(match.id),value_name:String(match.name||'')});
        else if(tipo!=='none'){
            termos.push({id:'WARRANTY_TYPE',value_name:tipo==='factory'?'Garantia de fábrica':'Garantia do vendedor'});
        }else{
            termos.push({id:'WARRANTY_TYPE',value_name:'Sem garantia'});
        }
    }

    const tempo=Number(cfg.warranty_time||0);
    const wtime=map.get('WARRANTY_TIME');
    if(tipo!=='none' && wtime && tempo>0){
        const unidadeRaw=String(cfg.warranty_unit||'dias').toLowerCase();
        const unidade=['dias','meses','anos'].includes(unidadeRaw)?unidadeRaw:'dias';
        const sing=tempo===1?({dias:'dia',meses:'mês',anos:'ano'}[unidade]):unidade;
        termos.push({id:'WARRANTY_TIME',value_name:`${tempo} ${sing}`});
    }

    payload.sale_terms=termos;
}

function preferenciaFreteGratisV51(cfg={}){
    return String(cfg.shipping_cost_mode||'buyer').toLowerCase()==='free';
}

/* =========================================================
   V50 — MERCADO ENVIOS 2 FIXO + DIMENSÕES AUTOMÁTICAS
   - nunca remove shipping.mode="me2"
   - completa atributos SELLER_PACKAGE_* quando a categoria fornece defaults
   - usa somente tentativas ME2, sem fallback silencioso para ME1
========================================================= */
function normalizarAvailableModesV50(data){
    const modes=data?.channels?.marketplace?.available_modes;
    return Array.isArray(modes)?modes:[];
}

function regraEnvioObrigatoriaV50(regra){
    return String(regra||'').toLowerCase()==='mandatory';
}

function completarDimensoesPacoteME2V50(payload,shippingPrefs,meta){
    if(!payload || !meta?.defMap)return [];
    const dims=shippingPrefs?.category_dimensions||{};
    const mapa=[
      ['SELLER_PACKAGE_HEIGHT',dims.height,'cm'],
      ['SELLER_PACKAGE_LENGTH',dims.length,'cm'],
      ['SELLER_PACKAGE_WIDTH',dims.width,'cm'],
      ['SELLER_PACKAGE_WEIGHT',dims.weight,'g']
    ];
    const attrs=Array.isArray(payload.attributes)?payload.attributes:[];
    const ids=new Set(attrs.map(a=>String(a?.id||'')));
    const adicionados=[];
    for(const [id,raw,unit] of mapa){
        if(ids.has(id))continue;
        const def=meta.defMap.get(id);
        const num=Number(raw||0);
        if(!def || !Number.isFinite(num) || num<=0)continue;
        // Para SELLER_PACKAGE_* o Mercado Livre espera valor numérico puro;
        // as unidades são definidas pelo próprio atributo da categoria.
        const value_name=String(Math.round(num));
        attrs.push({id,value_name});
        ids.add(id); adicionados.push({id,value_name});
    }
    payload.attributes=attrs;
    return adicionados;
}

function aplicarEstrategiaEnvioV50(payload,shippingInfo,strategyName='me2_full'){
    const base={...payload};
    const free=Boolean(shippingInfo?.free_shipping);
    const local=Boolean(shippingInfo?.local_pick_up);
    if(strategyName==='me2_minimal'){
        base.shipping={mode:'me2',free_shipping:free};
    }else{
        base.shipping={mode:'me2',local_pick_up:local,free_shipping:free,free_methods:[]};
    }
    return base;
}

function ehErroEspecificoEnvioV50(data){
    const causas=Array.isArray(data?.cause)?data.cause:[];
    const codes=causas.map(c=>String(c?.code||'').toLowerCase());
    const txt=JSON.stringify(data||{}).toLowerCase();
    return codes.some(c=>c.startsWith('shipping.')) || /shipping|\bme1\b|\bme2\b|mercado envios/.test(txt);
}

function somenteErroLostMe1V50(data){
    const causas=Array.isArray(data?.cause)?data.cause:[];
    const codes=causas.map(c=>String(c?.code||'').toLowerCase()).filter(Boolean);
    const txt=JSON.stringify(data||{}).toLowerCase();
    if(codes.length)return codes.every(c=>c==='shipping.lost_me1_by_user');
    return txt.includes('shipping.lost_me1_by_user') || (txt.includes('lost_me1_by_user') && !txt.includes('me2_not'));
}

function podeIgnorarLostMe1NoValidadorV50(validacao,shippingInfo){
    const modo=String(validacao?.payload?.shipping?.mode||'').toLowerCase();
    const disponiveis=(shippingInfo?.available_modes||[]).map(x=>String(x).toLowerCase());
    return modo==='me2' && disponiveis.includes('me2') && somenteErroLostMe1V50(validacao?.data);
}

async function consultarShippingModesV50(token,sellerId,payload,meta){
    const attrs=(Array.isArray(payload?.attributes)?payload.attributes:[]).map(a=>{
        const def=meta?.defMap?.get?.(String(a.id||''));
        return {
          id:String(a.id||''),
          ...(def?.name?{name:String(def.name)}:{}),
          ...(a.value_id?{value_id:String(a.value_id)}:{}),
          ...(a.value_name?{value_name:String(a.value_name)}:{})
        };
    }).filter(a=>a.id);
    const body={
        site_id:'MLB',
        seller_id:Number(sellerId),
        title:String(payload?.family_name||payload?.title||'Produto').slice(0,60),
        item_price:Number(payload?.price||0),
        item_currency:String(payload?.currency_id||'BRL'),
        category_id:String(payload?.category_id||''),
        catalog:{
            domain_id:String(meta?.categoria?.domain_id||''),
            attributes:attrs
        },
        sale_terms:Array.isArray(payload?.sale_terms)?payload.sale_terms:[],
        listing_type_id:String(payload?.listing_type_id||'gold_special'),
        buying_mode:String(payload?.buying_mode||'buy_it_now'),
        condition:String(payload?.condition||'new'),
        channels:[{id:'marketplace'}],
        new_format:true,
        verbose:false
    };
    if(!body.catalog.domain_id)delete body.catalog.domain_id;
    const r=await mlFetch(`${ML_API}/users/${encodeURIComponent(sellerId)}/shipping_modes`,token,{
        method:'POST',
        headers:{'Content-Type':'application/json','x-multichannel':'true','X-Format-New':'true'},
        body:JSON.stringify(body)
    });
    const d=await jsonSeguro(r);
    return {ok:r.ok,status:r.status,data:d,body};
}

async function resolverEnvioMercadoV50(token,sellerId,categoryId,payload,meta,cfg={}){
    const base=await obterPreferenciasEnvioPublicacaoV47(token,sellerId,categoryId,{force:true});
    const dimensoes_auto=completarDimensoesPacoteME2V50(payload,base,meta);

    const shippingModes=await consultarShippingModesV50(token,sellerId,payload,meta);
    if(!shippingModes.ok){
        const e=new Error('Não foi possível consultar os modos de Mercado Envios para esta publicação: '+formatarErroMercadoLivre(shippingModes.data));
        e.code='shipping.preflight_failed'; e.shipping_modes=shippingModes.data; throw e;
    }
    const me2Mode=normalizarAvailableModesV50(shippingModes.data)
      .find(m=>String(m?.mode||'').toLowerCase()==='me2')||null;
    if(!me2Mode){
        const e=new Error('O Mercado Livre não liberou Mercado Envios 2 para este produto com os dados atuais. Verifique os dados obrigatórios da categoria.');
        e.code='shipping.me2_not_available_for_item'; e.shipping_modes=shippingModes.data; throw e;
    }

    const logistics=Array.isArray(me2Mode?.logistic_types)?me2Mode.logistic_types:[];
    const def=logistics.find(x=>x?.default===true)||logistics[0]||null;
    const modeAttrs=me2Mode?.shipping_attributes||{};
    const typeAttrs=def?.attributes||{};
    const freeRule=modeAttrs.free_shipping ?? typeAttrs.free_shipping;
    const localRule=modeAttrs.local_pick_up ?? typeAttrs.local_pick_up;

    const mandatoryFree=regraEnvioObrigatoriaV50(freeRule);
    const freeNotAllowed=String(freeRule||'').toLowerCase()==='not_allowed';
    const requestedFree=preferenciaFreteGratisV51(cfg);
    const freeShipping=mandatoryFree ? true : (freeNotAllowed ? false : requestedFree);
    const localPickUp=regraEnvioObrigatoriaV50(localRule);

    return {
        ...base,
        mode:'me2',
        free_shipping:freeShipping,
        free_shipping_required:mandatoryFree,
        free_shipping_rule:String(freeRule||'optional'),
        requested_free_shipping:requestedFree,
        local_pick_up:localPickUp,
        logistic_type:String(def?.type||''),
        shipping_modes_checked:true,
        shipping_modes_status:shippingModes.status,
        available_modes:normalizarAvailableModesV50(shippingModes.data).map(m=>String(m?.mode||'')),
        strategies:['me2_minimal','me2_full'],
        dimensoes_auto,
        shipping:{mode:'me2',local_pick_up:localPickUp,free_shipping:freeShipping,free_methods:[]}
    };
}

async function validarPayloadMercadoComFallbackEnvioV50(token,payload,shippingInfo){
    const strategies=Array.isArray(shippingInfo?.strategies)&&shippingInfo.strategies.length
      ? shippingInfo.strategies : ['me2_minimal','me2_full'];
    const tentativas=[]; let ultimo=null;
    let info={...shippingInfo};

    for(const strategy of strategies){
        let tentativa=aplicarEstrategiaEnvioV50(payload,info,strategy);
        if(String(tentativa?.shipping?.mode||'').toLowerCase()!=='me2'){
            throw new Error('Proteção interna: a publicação tentou sair sem Mercado Envios 2.');
        }

        for(let rodada=0;rodada<2;rodada++){
            const r=await mlFetch(`${ML_API}/items/validate`,token,{
                method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(tentativa)
            });
            const d=await jsonSeguro(r);
            const warningsOnly=!r.ok && somenteWarningsMercadoV51(d);
            tentativas.push({
                strategy,status:r.status,ok:r.ok,warnings_only:warningsOnly,
                shipping:tentativa.shipping,
                erro:(r.ok||warningsOnly)?null:formatarErroMercadoLivre(d),raw:d
            });
            ultimo={response:r,data:d,payload:tentativa,mode:'me2',strategy,tentativas,warnings_only:warningsOnly};

            if(r.ok || warningsOnly)return ultimo;

            if(temCodigoCausaV51(d,'item.shipping.mandatory_free_shipping') && !tentativa.shipping?.free_shipping){
                info={...info,free_shipping:true,free_shipping_required:true};
                tentativa=aplicarEstrategiaEnvioV50(payload,info,strategy);
                continue;
            }
            if(ehAvisoEnvioAutocorrigivelV51(d)){
                ultimo.warnings_only=true;
                return ultimo;
            }
            break;
        }
    }
    return ultimo;
}

async function publicarPayloadMercadoComFallbackEnvioV50(token,payload,shippingInfo){
    const strategies=Array.isArray(shippingInfo?.strategies)&&shippingInfo.strategies.length
      ? shippingInfo.strategies : ['me2_minimal','me2_full'];
    const tentativas=[]; let ultimo=null;
    let info={...shippingInfo};

    for(const strategy of strategies){
        let tentativa=aplicarEstrategiaEnvioV50(payload,info,strategy);
        if(String(tentativa?.shipping?.mode||'').toLowerCase()!=='me2'){
            throw new Error('Proteção interna: a publicação tentou sair sem Mercado Envios 2.');
        }

        for(let rodada=0;rodada<2;rodada++){
            const pr=await mlPostComRetryV36(`${ML_API}/items`,token,tentativa,4);
            tentativas.push({
                strategy,status:pr?.status||null,ok:Boolean(pr?.ok),
                shipping:tentativa.shipping,
                erro:pr?.ok?null:formatarErroMercadoLivre(pr?.data),raw:pr?.data
            });
            ultimo={...pr,payload:tentativa,mode:'me2',strategy,tentativas};
            if(pr?.ok)return ultimo;

            if(temCodigoCausaV51(pr?.data,'item.shipping.mandatory_free_shipping') && !tentativa.shipping?.free_shipping){
                info={...info,free_shipping:true,free_shipping_required:true};
                tentativa=aplicarEstrategiaEnvioV50(payload,info,strategy);
                continue;
            }
            if(!ehErroEspecificoEnvioV50(pr?.data))return ultimo;
            break;
        }
    }
    return ultimo;
}

function normalizarLinhasVariacaoV53(varCfg={}){
    const enabled=Boolean(varCfg?.enabled);
    if(!enabled)return [];
    const rows=Array.isArray(varCfg?.rows)?varCfg.rows:[];
    if(rows.length){
        return rows.slice(0,100).map((r,i)=>({
            index:i+1,
            stock:r?.stock==null||r?.stock===''?null:Math.max(0,Number(r.stock||0)),
            sku_suffix:String(r?.sku_suffix||'').trim(),
            size_grid_row_id:String(r?.size_grid_row_id||'').trim(),
            attributes:(Array.isArray(r?.attributes)?r.attributes:[]).map(a=>({
                id:String(a?.id||'').trim(),
                ...(a?.value_id!=null&&String(a.value_id).trim()?{value_id:String(a.value_id).trim()}:{}),
                ...(a?.value_name!=null&&String(a.value_name).trim()?{value_name:String(a.value_name).trim()}:{}),
            })).filter(a=>a.id&&(a.value_id||a.value_name))
        }));
    }
    // Compatibilidade com o formato anterior: 1 atributo + lista de valores.
    const attrId=String(varCfg?.attribute_id||'').trim();
    const values=Array.isArray(varCfg?.values)?varCfg.values.map(v=>String(v||'').trim()).filter(Boolean):[];
    const count=Math.min(100,Math.max(1,Number(varCfg?.count||values.length||1)));
    return values.slice(0,count).map((value,i)=>({index:i+1,stock:null,sku_suffix:'',size_grid_row_id:'',attributes:attrId?[{id:attrId,value_name:value}]:[]}));
}

function quantidadeVariacoesV53(cfg={},userProductSeller=false){
    if(!cfg?.variations?.enabled)return 1;
    if(!userProductSeller)return 1;
    const rows=normalizarLinhasVariacaoV53(cfg.variations);
    return Math.max(1,rows.length);
}

function assinaturaVariacaoV53(row={},defs=[]){
    const ids=new Set((defs||[]).map(d=>String(d.id)));
    return JSON.stringify((row.attributes||[])
      .filter(a=>ids.has(String(a.id)))
      .map(a=>[String(a.id),String(a.value_id||a.value_name||'').trim().toLowerCase()])
      .filter(x=>x[1])
      .sort((a,b)=>a[0].localeCompare(b[0])));
}

function validarLinhasVariacaoV53(varCfg={},meta){
    if(!varCfg?.enabled)return [];
    const rows=normalizarLinhasVariacaoV53(varCfg);
    if(!rows.length)return ['Ative as variações e preencha pelo menos uma linha de variação.'];
    // V59: SIZE_GRID_ROW_ID e SIZE_GRID_ID são atributos derivados do guia de tamanhos.
    // Eles NÃO devem bloquear esta validação preliminar das linhas, porque o painel
    // resolve e injeta o SIZE_GRID_ROW_ID correto depois, em aplicarGuiaTamanhoV55().
    // Antes disso o usuário já pode ter selecionado visualmente a linha do guia,
    // mas ela fica em row.size_grid_row_id (fora de row.attributes), o que fazia o
    // validador acusar falsamente "faltam ID da linha da guia de tamanhos".
    const atributosGuiaGerados=new Set(['SIZE_GRID_ID','SIZE_GRID_ROW_ID']);
    const defs=[...(meta?.defMap?.values?.()||[])].filter(d=>
        !d.read_only &&
        !atributosGuiaGerados.has(String(d?.id||'')) &&
        (d.child_pk||d.allow_variations||d.variation_attribute)
    );
    const combinacoes=defs.filter(d=>d.child_pk||d.allow_variations);
    if(!combinacoes.length)return ['A categoria selecionada não retornou atributos permitidos para variação.'];
    const obrigatorios=combinacoes.filter(d=>d.child_pk||d.required);
    const assinaturas=new Set();
    const erros=[];
    rows.forEach((row,i)=>{
        const validos=[]; const porId=new Map();
        for(const a of (row.attributes||[])){
            const def=meta?.defMap?.get?.(String(a.id));
            const clean=sanitizarValorAtributoV46(a,def);
            if(clean){validos.push(clean);porId.set(String(clean.id),clean);}
        }
        const faltantes=obrigatorios.filter(d=>!porId.has(String(d.id)));
        if(faltantes.length)erros.push(`Variação ${i+1}: faltam ${faltantes.map(d=>d.name||d.id).join(', ')}.`);
        if(!combinacoes.some(d=>porId.has(String(d.id))))erros.push(`Variação ${i+1}: informe pelo menos um atributo que diferencie a variação.`);
        const sig=assinaturaVariacaoV53({attributes:validos},combinacoes);
        if(sig==='[]')return;
        if(assinaturas.has(sig))erros.push(`Variação ${i+1}: a combinação de atributos está repetida.`);
        assinaturas.add(sig);
    });
    return erros;
}


function normalizarTextoGuiaV55(v){
    return String(v??'')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .trim().toLowerCase()
      .replace(/\b(brasil|br|bra|tamanho|tam\.?|numero|num\.?|nº|no\.?|size)\b/g,' ')
      .replace(/[^a-z0-9.,/+-]+/g,' ')
      .replace(/\s+/g,' ').trim();
}
function candidatosTamanhoV55(v){
    const raw=String(v??'').trim();
    const norm=normalizarTextoGuiaV55(raw);
    const out=new Set([norm]);
    const nums=(norm.match(/\d+(?:[.,]\d+)?/g)||[]).map(x=>x.replace(',','.'));
    nums.forEach(n=>out.add(String(Number(n))));
    if(nums.length)out.add(nums.join('x'));
    return [...out].filter(Boolean);
}
function tamanhoDaLinhaV55(row={},chart=null){
    const idsPreferidos=[
        'SIZE',String(chart?.main_attribute_id||''),'MANUFACTURER_SIZE','BR_SIZE','AR_SIZE','US_SIZE','UK_SIZE','EU_SIZE',
        'M_BR_SIZE','F_BR_SIZE','KIDS_BR_SIZE','FILTRABLE_SIZE'
    ].filter(Boolean);
    for(const id of idsPreferidos){
        const a=(row.attributes||[]).find(x=>String(x?.id||'')===id);
        if(!a)continue;
        const vals=Array.isArray(a?.values)?a.values:[];
        const val=String(a.value_name||a.value_id||vals[0]?.name||vals[0]?.id||'').trim();
        if(val)return val;
    }
    const a=(row.attributes||[]).find(x=>/SIZE|TAMANHO/i.test(String(x?.id||'')));
    if(!a)return '';
    const vals=Array.isArray(a?.values)?a.values:[];
    return String(a.value_name||a.value_id||vals[0]?.name||vals[0]?.id||'').trim();
}
function extrairRowsChartV55(chart){
    // Algumas respostas do Mercado Livre trazem rows direto no chart e outras
    // podem encapsular a estrutura. Fazemos uma busca recursiva segura para
    // localizar qualquer coleção real de linhas da tabela de medidas.
    const encontrados=[];
    const vistos=new Set();
    const walk=(node,depth=0)=>{
        if(node==null||depth>8)return;
        if(Array.isArray(node)){
            for(const item of node)walk(item,depth+1);
            return;
        }
        if(typeof node!=='object')return;
        if(vistos.has(node))return; vistos.add(node);
        if(Array.isArray(node.rows)){
            for(const r of node.rows){
                if(r&&typeof r==='object'&&(r.id!=null||r.row_id!=null||Array.isArray(r.attributes)))encontrados.push(r);
            }
        }
        for(const [k,v] of Object.entries(node)){
            if(k==='rows')continue;
            if(v&&typeof v==='object')walk(v,depth+1);
        }
    };
    walk(chart,0);
    const unicos=[]; const seen=new Set();
    for(const r of encontrados){
        const key=String(r?.id??r?.row_id??JSON.stringify(r?.attributes||[]));
        if(seen.has(key))continue; seen.add(key); unicos.push(r);
    }
    return unicos;
}
function valoresRowChartV55(chart,row){
    const attrs=Array.isArray(row?.attributes)?row.attributes:[];
    const preferidos=new Set([
        'SIZE',String(chart?.main_attribute_id||''),String(chart?.secondary_attribute_id||''),
        'MANUFACTURER_SIZE','BR_SIZE','AR_SIZE','US_SIZE','UK_SIZE','EU_SIZE','M_BR_SIZE','F_BR_SIZE','KIDS_BR_SIZE','FILTRABLE_SIZE'
    ].filter(Boolean));
    const vals=[];
    for(const a of attrs){
        if(!preferidos.has(String(a?.id||'')) && !/SIZE|TAMANHO/i.test(String(a?.id||'')))continue;
        const av=Array.isArray(a?.values)?a.values:[];
        const v=String(a?.value_name||a?.value_id||av[0]?.name||av[0]?.id||'').trim();
        if(v)vals.push(v);
    }
    if(!vals.length){
        for(const a of attrs){
            const av=Array.isArray(a?.values)?a.values:[];
            const v=String(a?.value_name||a?.value_id||av[0]?.name||av[0]?.id||'').trim();
            if(v)vals.push(v);
        }
    }
    return [...new Set(vals)];
}
function formatarGridRowIdV55(gridId,row){
    const raw=String(row?.id||row?.row_id||'').trim();
    if(!raw)return '';
    // O Mercado Livre espera o GRID_ROW associado ao guia. Se a API já devolver
    // o valor completo, preservamos; caso contrário prefixamos o ID do guia.
    return raw.includes(':')?raw:`${String(gridId)}:${raw}`;
}
function normalizarGridRowIdV58(gridId,raw){
    const v=String(raw||'').trim();
    if(!v)return '';
    if(v.includes(':'))return v;
    return `${String(gridId)}:${v}`;
}
function linhasValidasGuiaV58(chart,gridId){
    const map=new Map();
    for(const row of extrairRowsChartV55(chart)){
        const full=formatarGridRowIdV55(gridId,row);
        if(!full)continue;
        map.set(full,row);
        const raw=String(row?.id||row?.row_id||'').trim();
        if(raw)map.set(raw,row);
    }
    return map;
}
function rowCompativelV55(chart,row,tamanho){
    const alvos=candidatosTamanhoV55(tamanho);
    if(!alvos.length)return false;
    const valores=valoresRowChartV55(chart,row).flatMap(candidatosTamanhoV55);
    if(alvos.some(a=>valores.includes(a)))return true;
    // Fallback numérico: 35, "35 BR", "BR 35" e equivalentes devem casar.
    const numsAlvo=new Set(alvos.flatMap(v=>(String(v).match(/\d+(?:[.,]\d+)?/g)||[]).map(n=>String(Number(n.replace(',','.'))))));
    if(!numsAlvo.size)return false;
    const numsValores=new Set(valores.flatMap(v=>(String(v).match(/\d+(?:[.,]\d+)?/g)||[]).map(n=>String(Number(n.replace(',','.'))))));
    return [...numsAlvo].some(n=>numsValores.has(n));
}
async function obterChartV55(token,chartId){
    const id=String(chartId||'').trim();
    if(!id)return null;
    const r=await mlFetch(`${ML_API}/catalog/charts/${encodeURIComponent(id)}`,token);
    const d=await jsonSeguro(r);
    if(!r.ok){
        const e=new Error(`Não foi possível consultar o guia de tamanho ${id}: ${formatarErroMercadoLivre(d)}`);
        e.code='invalid_size_grid';
        throw e;
    }
    return d;
}
function acharRowChartV55(chart,tamanho){
    return extrairRowsChartV55(chart).find(r=>rowCompativelV55(chart,r,tamanho))||null;
}
function extrairDomainIdV55(v){
    const s=String(v||'').trim();
    return s.replace(/^MLB-/i,'');
}
async function descobrirDominioV55(token,categoryId,title=''){
    const q=String(title||'').trim();
    if(q){
        try{
            const r=await mlFetch(`${ML_API}/sites/MLB/domain_discovery/search?limit=8&q=${encodeURIComponent(q)}`,token);
            const d=await jsonSeguro(r);
            if(r.ok&&Array.isArray(d)&&d.length){
                const exato=d.find(x=>String(x?.category_id||'')===String(categoryId||''));
                const alvo=exato||d[0];
                if(alvo?.domain_id)return extrairDomainIdV55(alvo.domain_id);
            }
        }catch{}
    }
    return '';
}
function attrsPayloadParaBuscaGuiaV55(payload={},ids=null){
    const filtro=ids?new Set(ids.map(String)):null;
    return (Array.isArray(payload?.attributes)?payload.attributes:[])
      .filter(a=>a?.id && (!filtro||filtro.has(String(a.id))) && (a.value_name||a.value_id))
      .map(a=>({id:String(a.id),values:[{...(a.value_id?{id:String(a.value_id)}:{}),name:String(a.value_name||a.value_id||'')}]}));
}
function extrairGridTemplateRequiredV55(payload){
    const ids=[]; const seen=new Set();
    const walk=node=>{
        if(!node)return;
        if(Array.isArray(node)){node.forEach(walk);return;}
        if(typeof node!=='object')return;
        if(Array.isArray(node.attributes)){
            for(const a of node.attributes){
                const tags=Array.isArray(a?.tags)?a.tags:Object.keys(a?.tags||{}).filter(k=>a.tags[k]);
                if(tags.map(String).includes('grid_template_required')){
                    const id=String(a?.id||''); if(id&&!seen.has(id)){seen.add(id);ids.push(id);}
                }
            }
        }
        if(Array.isArray(node.groups))node.groups.forEach(walk);
        if(Array.isArray(node.components))node.components.forEach(walk);
        if(Array.isArray(node.content))node.content.forEach(walk);
        if(node.input)walk(node.input);
    };
    walk(payload); return ids;
}
async function buscarChartsAutomaticosV55(token,{domainId,sellerId,payload}){
    if(!domainId||!sellerId)return [];
    let required=[];
    try{
        const tr=await mlFetch(`${ML_API}/domains/MLB-${encodeURIComponent(domainId)}/technical_specs`,token);
        const td=await jsonSeguro(tr);
        if(tr.ok)required=extrairGridTemplateRequiredV55(td);
    }catch{}
    const tentativas=[];
    const attrsReq=attrsPayloadParaBuscaGuiaV55(payload,required);
    if(attrsReq.length)tentativas.push(attrsReq);
    const attrsBG=attrsPayloadParaBuscaGuiaV55(payload,['BRAND','GENDER']);
    if(attrsBG.length)tentativas.push(attrsBG);
    tentativas.push([]);
    const seenBody=new Set();
    for(const attributes of tentativas){
        const sig=JSON.stringify(attributes); if(seenBody.has(sig))continue; seenBody.add(sig);
        const body={domain_id:domainId,site_id:'MLB',seller_id:Number(sellerId),attributes};
        const r=await mlFetch(`${ML_API}/catalog/charts/search?offset=0&limit=100`,token,{method:'POST',headers:{'Content-Type':'application/json','x-caller-id':String(sellerId)},body:JSON.stringify(body)});
        const d=await jsonSeguro(r);
        if(r.ok&&Array.isArray(d?.charts)&&d.charts.length)return d.charts;
        if(Number(r.status)===400 && String(d?.error||'')==='domain_not_active')return [];
    }
    return [];
}
async function resolverGuiaAutomaticoV55(token,payload,cfg,opts={}){
    const varCfg=cfg?.variations||{};
    if(!varCfg?.enabled)return null;
    const rowsCfg=normalizarLinhasVariacaoV53(varCfg);
    const tamanhos=[...new Set(rowsCfg.map(r=>tamanhoDaLinhaV55(r)).filter(Boolean))];
    if(!tamanhos.length)return null;

    const manual=String(varCfg?.size_grid_id||cfg?.size_grid_id||'').trim();
    if(manual){
        // V58: o código do guia informado continua tendo prioridade, porém as linhas
        // NUNCA são aceitas cegamente. Consultamos o chart real para garantir que
        // SIZE_GRID_ROW_ID pertença ao SIZE_GRID_ID e ao tamanho escolhido.
        const chart=await obterChartV55(token,manual);
        const hits=tamanhos.filter(t=>acharRowChartV55(chart,t)).length;
        return {gridId:String(chart?.id||manual),chart,hits,source:hits?'manual-compatible':'manual-guide'};
    }

    const title=String(cfg?.titles?.[Number(opts.familyIndex||0)]||cfg?.product_name||'').trim();
    const domainId=await descobrirDominioV55(token,opts?.category?.category_id||payload?.category_id,title);
    if(!domainId)return null;
    const charts=await buscarChartsAutomaticosV55(token,{domainId,sellerId:opts?.sellerId,payload});
    if(!charts.length)return null;

    const generica=normalizarTextoGuiaV55((payload.attributes||[]).find(a=>String(a.id)==='BRAND')?.value_name||'').includes('generica');
    const ordenados=[...charts].sort((a,b)=>{
        const rank=c=>{
            const type=String(c?.type||'').toUpperCase();
            if(generica)return type==='STANDARD'?30:type==='SPECIFIC'?20:type==='BRAND'?10:0;
            return type==='BRAND'?30:type==='SPECIFIC'?25:type==='STANDARD'?20:0;
        };
        return rank(b)-rank(a);
    });

    let melhor=null;
    for(const c of ordenados.slice(0,20)){
        try{
            const chart=await obterChartV55(token,c.id);
            const hits=tamanhos.filter(t=>acharRowChartV55(chart,t)).length;
            if(!melhor||hits>melhor.hits)melhor={gridId:String(chart?.id||c.id),chart,hits,source:'automatic-search'};
            if(hits===tamanhos.length)return melhor;
        }catch{}
    }
    return melhor?.hits?melhor:null;
}
async function aplicarGuiaTamanhoV55(token,payload,cfg,opts={}){
    const varCfg=cfg?.variations||{};
    if(!varCfg?.enabled)return payload;
    const rowsCfg=normalizarLinhasVariacaoV53(varCfg);
    const temTamanho=rowsCfg.some(r=>Boolean(tamanhoDaLinhaV55(r)));
    const manualGrid=String(varCfg?.size_grid_id||cfg?.size_grid_id||'').trim();
    const temLinhaManual=rowsCfg.some(r=>Boolean(String(r?.size_grid_row_id||'').trim()));
    if(!temTamanho&&!manualGrid&&!temLinhaManual)return payload;

    const resolvido=await resolverGuiaAutomaticoV55(token,payload,cfg,opts);
    if(!resolvido){
        // Se a categoria exigir guia, a validação do Mercado Livre informará isso.
        // Quando houver ID manual, porém, nunca descartamos o que o usuário preencheu.
        if(!manualGrid)return payload;
    }

    const gridId=String(resolvido?.gridId||manualGrid||'').trim();
    if(!gridId)return payload;
    const chart=resolvido?.chart||null;
    const pushUnique=(arr,obj)=>{
        const id=String(obj?.id||'');
        const i=arr.findIndex(x=>String(x?.id||'')===id);
        if(i>=0)arr[i]=obj; else arr.push(obj);
    };
    payload.attributes=Array.isArray(payload.attributes)?payload.attributes:[];
    pushUnique(payload.attributes,{id:'SIZE_GRID_ID',value_name:gridId});

    const linhasValidas=chart?linhasValidasGuiaV58(chart,gridId):new Map();
    const resolver=(row)=>{
        if(!chart)return '';
        const manualRaw=String(row?.size_grid_row_id||'').trim();
        if(manualRaw){
            const manual=normalizarGridRowIdV58(gridId,manualRaw);
            const achouManual=linhasValidas.get(manual)||linhasValidas.get(manualRaw);
            if(achouManual)return formatarGridRowIdV55(gridId,achouManual);
            // ID manual incompatível: não envia. Tenta recuperar pela numeração.
        }
        const tamanho=tamanhoDaLinhaV55(row,chart);
        if(!tamanho)return '';
        const achou=acharRowChartV55(chart,tamanho);
        return formatarGridRowIdV55(gridId,achou);
    };

    if(opts.userProductSeller){
        const row=rowsCfg[Number(opts.variationIndex||0)]||rowsCfg[0];
        const rowId=resolver(row);
        if(!rowId){
            const tam=tamanhoDaLinhaV55(row,chart)||'não informado';
            const e=new Error(`Guia de tamanho ${gridId}: não encontrei uma linha válida para o tamanho ${tam}. O SIZE_GRID_ROW_ID antigo/manual foi ignorado para evitar o erro invalid.fashion_grid.grid_row_id.values. Carregue o guia correto e escolha um tamanho existente nele.`);
            e.code='missing_size_grid_row'; throw e;
        }
        pushUnique(payload.attributes,{id:'SIZE_GRID_ROW_ID',value_name:rowId});
    }else if(Array.isArray(payload.variations)){
        payload.variations=payload.variations.map((v,i)=>{
            const row=rowsCfg[i]||rowsCfg[0];
            const rowId=resolver(row);
            if(!rowId){
                const tam=tamanhoDaLinhaV55(row,chart)||'não informado';
                const e=new Error(`Guia de tamanho ${gridId}: a variação ${i+1} (tamanho ${tam}) não corresponde a nenhuma linha válida do guia. O painel não enviará um SIZE_GRID_ROW_ID inválido.`);
                e.code='missing_size_grid_row'; throw e;
            }
            const attrs=Array.isArray(v.attributes)?v.attributes:[];
            pushUnique(attrs,{id:'SIZE_GRID_ROW_ID',value_name:rowId});
            return {...v,attributes:attrs};
        });
    }
    return payload;
}

function montarPayloadPublicacaoV37(cfg,{familyIndex=0,variationIndex=0,userProductSeller=false,category}){
    const title=limitarTituloV36(cfg.titles?.[familyIndex]||cfg.family_name||cfg.product_name||'',60);
    const price=Number(cfg.price||0);
    const stock=Math.max(1,Number(cfg.stock||1));
    const pictureIds=(Array.isArray(cfg.picture_ids)?cfg.picture_ids:[]).map(String).filter(Boolean);
    const manualPictureSources=normalizarUrlsManuaisV47(cfg.picture_sources_manual||cfg.manual_picture_urls||[]);
    const pictures=manualPictureSources.length?manualPictureSources.map(source=>({source})):pictureIds.map(id=>({id}));

    let attributes=(Array.isArray(category?.attributes)?category.attributes:[])
      .filter(a=>a?.id && (a?.value_id || a?.value_name || a?.value_name===null))
      .map(a=>({id:String(a.id),...(a.value_id?{value_id:String(a.value_id)}:{}),...(String(a.value_id||'')==='-1'?{value_name:null}:(a.value_name?{value_name:String(a.value_name)}:{}))}));

    const varCfg=cfg.variations||{};
    const varRows=normalizarLinhasVariacaoV53(varCfg);
    const idsVariacao=new Set(varRows.flatMap(r=>(r.attributes||[]).map(a=>String(a.id))));
    if(varCfg.enabled&&idsVariacao.size)attributes=attributes.filter(a=>!idsVariacao.has(String(a.id)));

    const rowSelecionada=varRows[variationIndex]||varRows[0]||null;
    if(userProductSeller&&varCfg.enabled&&rowSelecionada){
        for(const a of (rowSelecionada.attributes||[]))attributes.push({...a,id:String(a.id)});
    }

    const base={
        category_id:String(category?.category_id||cfg.category_id||''),
        price,
        currency_id:'BRL',
        available_quantity:userProductSeller&&rowSelecionada?.stock!=null?Math.max(1,Number(rowSelecionada.stock||1)):stock,
        buying_mode:'buy_it_now',
        channels:['marketplace'],
        listing_type_id:String(cfg.listing_type_id||'gold_special'),
        condition:String(cfg.condition||'new'),
        pictures,
        attributes,
        sale_terms:montarSaleTermsV51(cfg)
    };

    const skuPrefix=String(cfg.sku_prefix||'').trim();
    const catKey=String(category?.category_id||'').replace(/[^a-zA-Z0-9]/g,'').slice(-6);
    const familySku=skuPrefix?`${skuPrefix}-${catKey}-${String(familyIndex+1).padStart(5,'0')}`:'';

    if(userProductSeller){
        base.family_name=title;
        if(familySku){
            const suffix=String(rowSelecionada?.sku_suffix||'').trim();
            const skuVariacao=suffix?`${familySku}-${suffix}`:`${familySku}-${String(variationIndex+1).padStart(2,'0')}`;
            // Fluxo atual do Mercado Livre: SKU deve ser enviado como atributo SELLER_SKU.
            base.attributes=base.attributes.filter(a=>String(a.id)!=='SELLER_SKU');
            base.attributes.push({id:'SELLER_SKU',value_name:skuVariacao});
        }
    }else{
        base.title=title;
        if(familySku)base.seller_custom_field=familySku;
        if(varCfg.enabled&&varRows.length){
            base.available_quantity=varRows.reduce((sum,r)=>sum+Math.max(1,Number(r.stock==null?stock:r.stock||1)),0);
            base.variations=varRows.map((row,i)=>({
                attribute_combinations:(row.attributes||[]).map(a=>({id:String(a.id),...(a.value_id?{value_id:String(a.value_id)}:{}),...(a.value_name?{value_name:String(a.value_name)}:{})})),
                price,
                available_quantity:Math.max(1,Number(row.stock==null?stock:row.stock||1)),
                ...(pictureIds.length?{picture_ids:pictureIds}:{}),
                ...(familySku?{seller_custom_field:`${familySku}-${String(row.sku_suffix||'').trim()||String(i+1).padStart(2,'0')}`}:{})
            }));
        }
    }
    return base;
}

async function processarCriacaoMassaV37(job){
    const token=await obterTokenPersistenteParaSeller(job.seller_id);
    if(!token)throw new Error('Token Mercado Livre indisponível para criar anúncios.');

    const cfg=job.payload?.config||{};
    const categories=normalizarCategoriasConfigV37(cfg);
    if(!categories.length)throw new Error('Nenhuma categoria foi configurada para a criação em massa.');

    const meRes=await mlFetch(`${ML_API}/users/me`,token);
    const me=await jsonSeguro(meRes);
    if(!meRes.ok)throw new Error(formatarErroMercadoLivre(me));

    const userProductSeller=Array.isArray(me?.tags)&&me.tags.includes('user_product_seller');
    const families=Math.max(1,Number(cfg.quantity||cfg.titles?.length||1));
    const varRows=normalizarLinhasVariacaoV53(cfg?.variations||{});
    const varCount=quantidadeVariacoesV53(cfg,userProductSeller);
    const perCategory=families*varCount;
    const total=categories.length*perCategory;

    let seq=Math.max(0,Number(job.cursor||0));
    let sucessos=Number(job.result?.success||0);
    let erros=Number(job.errors||0);

    while(seq<total){
        const existing=await dbQuery(`SELECT success FROM ml_mass_create_results WHERE job_id=$1 AND seq=$2`,[job.id,seq]);
        if(existing.rows.length){seq++;continue;}

        const categoryIndex=Math.floor(seq/perCategory);
        const rem=seq%perCategory;
        const familyIndex=Math.floor(rem/varCount);
        const variationIndex=rem%varCount;
        const category=categories[categoryIndex];
        const prepared=await prepararPayloadPublicacaoV46(token,cfg,{familyIndex,variationIndex,userProductSeller,category,sellerId:job.seller_id});
        const payload=prepared.payload;
        const titleRequested=String(cfg.titles?.[familyIndex]||cfg.product_name||'');

        if(prepared.faltantes.length){
            const msg=`Faltam características obrigatórias: ${prepared.faltantes.map(x=>x.name).join(', ')}`;
            await gravarResultadoCriacaoV36(job.id,job.seller_id,{
                seq,family_seq:familyIndex,variation_seq:variationIndex,
                title_requested:`[${category.category_name}] ${titleRequested}`,
                success:false,message:msg,technical_message:msg
            });
            erros++;
            seq++;
            continue;
        }

        const pr=await publicarPayloadMercadoComFallbackEnvioV50(token,payload,prepared.shippingInfo);
        if(pr?.ok && pr?.data?.id){
            let warning='';
            const item=pr.data;
            if(cfg.description){
                const dr=await mlPostComRetryV36(`${ML_API}/items/${encodeURIComponent(item.id)}/description`,token,{plain_text:String(cfg.description).slice(0,50000)},3);
                if(!dr?.ok)warning='Anúncio criado, mas a descrição não foi adicionada: '+formatarErroMercadoLivre(dr?.data);
            }
            await gravarResultadoCriacaoV36(job.id,job.seller_id,{
                seq,
                family_seq:familyIndex,
                variation_seq:variationIndex,
                title_requested:`[${category.category_name}] ${titleRequested}`,
                item_id:item.id,
                permalink:item.permalink||'',
                success:true,
                message:warning||`Anúncio criado com sucesso na categoria ${category.category_name}.`
            });
            await upsertItensDb(job.seller_id,[item]);
            sucessos++;
        }else{
            const tecnico=formatarErroMercadoLivre(pr?.data)||`HTTP ${pr?.status||500}`;
            await gravarResultadoCriacaoV36(job.id,job.seller_id,{
                seq,
                family_seq:familyIndex,
                variation_seq:variationIndex,
                title_requested:`[${category.category_name}] ${titleRequested}`,
                success:false,
                message:`O Mercado Livre recusou a criação deste anúncio na categoria ${category.category_name}. Revise os campos obrigatórios da categoria e os detalhes exibidos.`,
                technical_message:tecnico
            });
            erros++;
        }

        seq++;
        const pct=Math.round((seq/total)*100);
        await dbQuery(`
          UPDATE ml_jobs SET
            processed=$2,
            progress_current=$2,
            progress_total=$3,
            errors=$4,
            cursor=$5,
            result=$6::jsonb,
            message=$7,
            updated_at=NOW()
          WHERE id=$1
        `,[job.id,seq,total,erros,String(seq),JSON.stringify({success:sucessos,failed:erros,mode:userProductSeller?'user_products':'legacy',families,categories:categories.length,items_total:total}),`Criação em massa: ${seq.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · ${pct}% · ${sucessos.toLocaleString('pt-BR')} criado(s)`]);

        await esperarV35(180);
    }

    await dbQuery(`
      UPDATE ml_jobs SET
        status='completed',
        cursor=NULL,
        processed=$2,
        progress_current=$2,
        progress_total=$3,
        errors=$4,
        result=$5::jsonb,
        message=$6,
        finished_at=NOW(),
        updated_at=NOW()
      WHERE id=$1
    `,[job.id,total,total,erros,JSON.stringify({success:sucessos,failed:erros,mode:userProductSeller?'user_products':'legacy',families,categories:categories.length,items_total:total}),`Criação concluída: ${sucessos.toLocaleString('pt-BR')} item(ns) criado(s), ${erros.toLocaleString('pt-BR')} falha(s).`]);
}
async function mlPostComRetryV36(url,token,body,maxTentativas=4){
    let ultimo=null;
    for(let tentativa=1;tentativa<=maxTentativas;tentativa++){
        const r=await mlFetch(url,token,{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(body)
        });
        const d=await jsonSeguro(r);

        if(r.ok)return {ok:true,status:r.status,data:d,tentativa};

        ultimo={ok:false,status:r.status,data:d,tentativa};
        if(![408,429,500,502,503,504].includes(r.status))return ultimo;

        const retryAfter=Number(r.headers.get('retry-after')||0);
        const espera=retryAfter>0
          ? Math.min(20000,retryAfter*1000)
          : Math.min(12000,900*Math.pow(2,tentativa-1)+Math.floor(Math.random()*500));
        await esperarV35(espera);
    }
    return ultimo;
}

function montarPayloadPublicacaoV36(cfg,{familyIndex=0,variationIndex=0,userProductSeller=false}={}){
    const title=limitarTituloV36(cfg.titles?.[familyIndex]||cfg.family_name||cfg.product_name||'',60);
    const price=Number(cfg.price||0);
    const stock=Math.max(1,Number(cfg.stock||1));
    const pictureIds=(Array.isArray(cfg.picture_ids)?cfg.picture_ids:[]).map(String).filter(Boolean);
    const pictures=pictureIds.map(id=>({id}));

    let attributes=(Array.isArray(cfg.attributes)?cfg.attributes:[])
      .filter(a=>a?.id && (a?.value_id || a?.value_name))
      .map(a=>({
          id:String(a.id),
          ...(a.value_id?{value_id:String(a.value_id)}:{}),
          ...(a.value_name?{value_name:String(a.value_name)}:{})
      }));

    const varCfg=cfg.variations||{};
    const varValues=Array.isArray(varCfg.values)?varCfg.values.map(String).filter(Boolean):[];

    if(userProductSeller && varCfg.enabled && varValues.length){
        const value=varValues[variationIndex%varValues.length];
        attributes=attributes.filter(a=>String(a.id)!==String(varCfg.attribute_id));
        attributes.push({
            id:String(varCfg.attribute_id),
            value_name:value
        });
    }

    const base={
        category_id:String(cfg.category_id),
        price,
        currency_id:'BRL',
        available_quantity:stock,
        buying_mode:'buy_it_now',
        listing_type_id:String(cfg.listing_type_id||'gold_special'),
        condition:String(cfg.condition||'new'),
        pictures,
        attributes
    };

    if(userProductSeller){
        base.family_name=title;
    }else{
        base.title=title;

        const skuPrefix=String(cfg.sku_prefix||'').trim();
        if(skuPrefix){
            base.seller_custom_field=`${skuPrefix}-${String(familyIndex+1).padStart(5,'0')}`;
        }

        if(varCfg.enabled && varValues.length){
            const qtd=Math.min(
                Math.max(1,Number(varCfg.count||varValues.length)),
                varValues.length
            );

            base.available_quantity=stock*qtd;
            base.variations=varValues.slice(0,qtd).map((value,i)=>({
                attribute_combinations:[{
                    id:String(varCfg.attribute_id),
                    value_name:String(value)
                }],
                price,
                available_quantity:stock,
                picture_ids:pictureIds,
                ...(skuPrefix?{
                    seller_custom_field:`${skuPrefix}-${String(familyIndex+1).padStart(5,'0')}-${String(i+1).padStart(2,'0')}`
                }:{})
            }));
        }
    }

    return base;
}

async function gravarResultadoCriacaoV36(jobId,sellerId,row){
    await dbQuery(`
      INSERT INTO ml_mass_create_results(
        job_id,seller_id,seq,family_seq,variation_seq,title_requested,
        item_id,permalink,success,message,technical_message
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(job_id,seq) DO UPDATE SET
        item_id=EXCLUDED.item_id,
        permalink=EXCLUDED.permalink,
        success=EXCLUDED.success,
        message=EXCLUDED.message,
        technical_message=EXCLUDED.technical_message
    `,[
        jobId,sellerId,row.seq,row.family_seq,row.variation_seq,row.title_requested,
        row.item_id||null,row.permalink||null,Boolean(row.success),
        String(row.message||''),String(row.technical_message||'')
    ]);
}

async function processarCriacaoMassaV36(job){
    const token=await obterTokenPersistenteParaSeller(job.seller_id);
    if(!token)throw new Error('Token Mercado Livre indisponível para criar anúncios.');

    const cfg=job.payload?.config||{};
    const meRes=await mlFetch(`${ML_API}/users/me`,token);
    const me=await jsonSeguro(meRes);
    if(!meRes.ok)throw new Error(formatarErroMercadoLivre(me));

    const userProductSeller=Array.isArray(me?.tags)&&me.tags.includes('user_product_seller');
    const families=Math.max(1,Number(cfg.quantity||cfg.titles?.length||1));
    const varValues=Array.isArray(cfg?.variations?.values)?cfg.variations.values.filter(Boolean):[];
    const varCount=(cfg?.variations?.enabled && userProductSeller)
      ? Math.min(Math.max(1,Number(cfg.variations.count||varValues.length||1)),Math.max(1,varValues.length))
      : 1;

    const total=families*varCount;
    let seq=Math.max(0,Number(job.cursor||0));
    let sucessos=Number(job.result?.success||0);
    let erros=Number(job.errors||0);

    while(seq<total){
        const existing=await dbQuery(
            `SELECT success FROM ml_mass_create_results WHERE job_id=$1 AND seq=$2`,
            [job.id,seq]
        );
        if(existing.rows.length){
            seq++;
            continue;
        }

        const familyIndex=Math.floor(seq/varCount);
        const variationIndex=seq%varCount;
        const payload=montarPayloadPublicacaoV36(cfg,{
            familyIndex,
            variationIndex,
            userProductSeller
        });

        const titleRequested=String(cfg.titles?.[familyIndex]||cfg.product_name||'');
        const pr=await mlPostComRetryV36(`${ML_API}/items`,token,payload,4);

        if(pr?.ok && pr?.data?.id){
            let warning='';
            const item=pr.data;

            if(cfg.description){
                const dr=await mlPostComRetryV36(
                    `${ML_API}/items/${encodeURIComponent(item.id)}/description`,
                    token,
                    {plain_text:String(cfg.description).slice(0,50000)},
                    3
                );
                if(!dr?.ok){
                    warning='Anúncio criado, mas a descrição não foi adicionada: '+formatarErroMercadoLivre(dr?.data);
                }
            }

            await gravarResultadoCriacaoV36(job.id,job.seller_id,{
                seq,
                family_seq:familyIndex,
                variation_seq:variationIndex,
                title_requested:titleRequested,
                item_id:item.id,
                permalink:item.permalink||'',
                success:true,
                message:warning||'Anúncio criado com sucesso.'
            });

            await upsertItensDb(job.seller_id,[item]);
            sucessos++;
        }else{
            const tecnico=formatarErroMercadoLivre(pr?.data)||`HTTP ${pr?.status||500}`;
            await gravarResultadoCriacaoV36(job.id,job.seller_id,{
                seq,
                family_seq:familyIndex,
                variation_seq:variationIndex,
                title_requested:titleRequested,
                success:false,
                message:'O Mercado Livre recusou a criação deste anúncio. Revise os campos obrigatórios da categoria e os detalhes exibidos.',
                technical_message:tecnico
            });
            erros++;
        }

        seq++;
        const pct=Math.round((seq/total)*100);

        await dbQuery(`
          UPDATE ml_jobs SET
            processed=$2,
            progress_current=$2,
            progress_total=$3,
            errors=$4,
            cursor=$5,
            result=$6::jsonb,
            message=$7,
            updated_at=NOW()
          WHERE id=$1
        `,[
            job.id,seq,total,erros,String(seq),
            JSON.stringify({
                success:sucessos,
                failed:erros,
                mode:userProductSeller?'user_products':'legacy',
                families,
                items_total:total
            }),
            `Criação em massa: ${seq.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · ${pct}% · ${sucessos.toLocaleString('pt-BR')} criado(s)`
        ]);

        // Publicação é naturalmente limitada pela API; pequena pausa reduz picos.
        await esperarV35(180);
    }

    await dbQuery(`
      UPDATE ml_jobs SET
        status='completed',
        cursor=NULL,
        processed=$2,
        progress_current=$2,
        progress_total=$3,
        errors=$4,
        result=$5::jsonb,
        message=$6,
        finished_at=NOW(),
        updated_at=NOW()
      WHERE id=$1
    `,[
        job.id,total,total,erros,
        JSON.stringify({
            success:sucessos,
            failed:erros,
            mode:userProductSeller?'user_products':'legacy',
            families,
            items_total:total
        }),
        `Criação concluída: ${sucessos.toLocaleString('pt-BR')} item(ns) criado(s), ${erros.toLocaleString('pt-BR')} falha(s).`
    ]);
}

async function workerLoop(indice) {
    while(true) {
        try {
            const job=await claimJob();
            if(job) {
                try {
                    if(job.type==='full_sync') await processarSyncCompleto(job);
                    else if(job.type==='price_sync') await processarPrecosEscala(job);
                    else if(job.type==='freight_sync') await processarFretesEscala(job);
                    else if(job.type==='price_update_mass') await processarAtualizacaoPrecosMassaV36(job);
                    else if(job.type==='mass_create') await processarCriacaoMassaV36(job);
                    else if(job.type==='mass_create_v37') await processarCriacaoMassaV37(job);
                    else await dbQuery(`UPDATE ml_jobs SET status='failed',message='Tipo de job desconhecido',finished_at=NOW() WHERE id=$1`,[job.id]);
                } catch(e) {
                    const retry=Number(job.attempts||0)<4;
                    await dbQuery(`UPDATE ml_jobs SET status=$2,message=$3,available_at=NOW()+INTERVAL '30 seconds',updated_at=NOW(),finished_at=CASE WHEN $2='failed' THEN NOW() ELSE NULL END WHERE id=$1`,
                      [job.id,retry?'queued':'failed',e.message.slice(0,500)]);
                }
            }
            await processarNotificacaoFila();
        } catch(e){console.error(`[WORKER ${indice}]`,e.message)}
        await new Promise(r=>setTimeout(r,jobSleepMs()));
    }
}
function jobSleepMs(){return 1200}




async function atualizarPrecosDbLoteV26(sellerId,linhas){
    if(!linhas.length)return;
    const params=[sellerId];
    const values=[];
    for(const x of linhas){
        const base=params.length;
        params.push(String(x.id),Number(x.price||0));
        values.push(`($${base+1}::text,$${base+2}::numeric)`);
    }
    await dbQuery(`
      UPDATE ml_items AS m SET
        price=v.price,
        net_received=GREATEST(0,v.price-m.sale_fee-m.shipping_cost),
        synced_at=NOW()
      FROM (VALUES ${values.join(',')}) AS v(item_id,price)
      WHERE m.seller_id=$1
        AND m.item_id=v.item_id
        AND m.price IS DISTINCT FROM v.price
    `,params);
}

async function processarPrecosEscala(job){
    const token=await obterTokenPersistenteParaSeller(job.seller_id);
    if(!token)throw new Error('Token Mercado Livre indisponível para sincronizar preços.');

    let cursor=String(job.cursor||'');
    let processados=Number(job.processed||0);
    let erros=Number(job.errors||0);
    let total=Number(job.progress_total||0);

    if(total<=0){
        const tr=await dbQuery(`
          SELECT COUNT(*)::int total
          FROM ml_items
          WHERE seller_id=$1 AND status='active'
        `,[job.seller_id]);
        total=Number(tr.rows[0]?.total||0);
    }

    await dbQuery(`
      UPDATE ml_jobs SET
        progress_total=$2,
        progress_current=$3,
        message=$4,
        updated_at=NOW()
      WHERE id=$1
    `,[job.id,total,Math.min(total,processados+erros),
       `Preços: ${Math.min(total,processados+erros).toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · lote de até 1.000`]);

    const LOTE=1000;

    while(true){
        const rr=await dbQuery(`
          SELECT item_id
          FROM ml_items
          WHERE seller_id=$1
            AND status='active'
            AND ($2::text='' OR item_id>$2)
          ORDER BY item_id
          LIMIT $3
        `,[job.seller_id,cursor,LOTE]);

        const ids=rr.rows.map(x=>String(x.item_id));
        if(!ids.length)break;

        const detalhes=await buscarItensBulkFreteRapido(token,ids);
        const linhas=[];
        let falhasLote=0;

        for(const id of ids){
            const item=detalhes.mapa[id];
            const preco=Number(item?.price);
            if(item && Number.isFinite(preco)){
                linhas.push({id,price:preco});
            }else{
                falhasLote++;
            }
        }

        // Um UPDATE em lote para até 1.000 preços.
        await atualizarPrecosDbLoteV26(job.seller_id,linhas);

        processados+=linhas.length;
        erros+=falhasLote;
        cursor=ids[ids.length-1];

        const atual=Math.min(total,processados+erros);
        const pct=total?Math.min(100,Math.round((atual/total)*100)):100;

        await dbQuery(`
          UPDATE ml_jobs SET
            processed=$2,
            errors=$3,
            progress_current=$4,
            progress_total=$5,
            cursor=$6,
            message=$7,
            updated_at=NOW()
          WHERE id=$1
        `,[job.id,processados,erros,atual,total,cursor,
           `Preços: ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · ${pct}% · lote de até 1.000`]);
    }

    const atual=Math.min(total,processados+erros);
    await dbQuery(`
      UPDATE ml_jobs SET
        status='completed',
        progress_current=$2,
        progress_total=$3,
        processed=$4,
        errors=$5,
        cursor=NULL,
        message=$6,
        finished_at=NOW(),
        updated_at=NOW()
      WHERE id=$1
    `,[job.id,atual,total,processados,erros,
       `Preços concluídos: ${processados.toLocaleString('pt-BR')} atualizado(s)${erros?` · ${erros.toLocaleString('pt-BR')} falha(s)`:''}.`]);
}

function esperarFrete(ms){return new Promise(resolve=>setTimeout(resolve,ms))}

async function mlFetchFreteComTimeout(url,token,timeoutMs=15000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
        return await mlFetch(url,token,{signal:controller.signal});
    }finally{
        clearTimeout(timer);
    }
}

function deveRepetirFrete(status){
    return status===408||status===429||status===500||status===502||status===503||status===504;
}

async function buscarItensBulkFreteRapido(token,ids){
    const unicos=[...new Set((ids||[]).filter(Boolean))];
    const blocos=[];
    for(let i=0;i<unicos.length;i+=20)blocos.push(unicos.slice(i,i+20));

    const mapa={};
    const falhas=new Map();
    const concorrencia=Math.max(4,Math.min(24,Number(process.env.ML_BULK_CONCURRENCY||12)));
    let cursor=0;

    async function worker(){
        while(true){
            const idx=cursor++;
            if(idx>=blocos.length)return;
            const bloco=blocos[idx];
            let ultimoErro='Falha ao buscar detalhes do anúncio.';
            for(let tentativa=1;tentativa<=2;tentativa++){
                try{
                    const r=await mlFetchFreteComTimeout(
                      `${ML_API}/items/bulk?ids=${bloco.join(',')}`,
                      token,
                      15000
                    );
                    const d=await jsonSeguro(r);
                    if(r.ok && Array.isArray(d)){
                        for(const reg of d){
                            const body=reg?.body;
                            const id=reg?.id||body?.id;
                            if(id&&body)mapa[String(id)]=body;
                        }
                        ultimoErro='';
                        break;
                    }
                    ultimoErro=`Detalhes HTTP ${r.status}: ${formatarErroMercadoLivre(d)}`;
                    if(!deveRepetirFrete(r.status))break;
                }catch(e){
                    ultimoErro=e?.name==='AbortError'?'Timeout ao buscar detalhes.':e.message;
                }
                if(tentativa<2)await esperarFrete(700*tentativa);
            }
            if(ultimoErro){
                for(const id of bloco)if(!mapa[id])falhas.set(String(id),ultimoErro);
            }else{
                for(const id of bloco)if(!mapa[id])falhas.set(String(id),'Mercado Livre não retornou os detalhes deste anúncio.');
            }
        }
    }

    await Promise.all(
      Array.from(
        {length:Math.min(concorrencia,Math.max(1,blocos.length))},
        ()=>worker()
      )
    );
    return {mapa,falhas};
}

async function calcularFreteEscalaRobusto(item,token){
    const shipping=item?.shipping||{};
    const itemId=item?.id;
    const sellerId=item?.seller_id;
    if(!itemId||!sellerId)throw new Error('Anúncio sem item_id/seller_id para calcular frete.');

    const params=new URLSearchParams({
        item_id:String(itemId),
        item_price:String(Number(item?.price||0)),
        listing_type_id:String(item?.listing_type_id||'gold_special'),
        condition:String(item?.condition||'new'),
        mode:String(shipping?.mode||'me2'),
        free_shipping:shipping.free_shipping?'true':'false',
        verbose:'true'
    });
    if(shipping?.logistic_type)params.set('logistic_type',String(shipping.logistic_type));
    const url=`${ML_API}/users/${sellerId}/shipping_options/free?${params.toString()}`;

    let ultimo='Não foi possível consultar o frete.';
    for(let tentativa=1;tentativa<=3;tentativa++){
        try{
            const r=await mlFetchFreteComTimeout(url,token,12000);
            const d=await jsonSeguro(r);
            if(r.ok){
                const custo=Number(d?.coverage?.all_country?.list_cost);
                if(Number.isFinite(custo)&&custo>=0){
                    return {id:String(itemId),custo,gratis:Boolean(shipping.free_shipping)};
                }
                ultimo='Mercado Livre respondeu sem coverage.all_country.list_cost.';
                break;
            }
            ultimo=`Frete HTTP ${r.status}: ${formatarErroMercadoLivre(d)}`;
            if(!deveRepetirFrete(r.status))break;
            const retryAfter=Number(r.headers.get('retry-after')||0);
            await esperarFrete(retryAfter>0?Math.min(5000,retryAfter*1000):500*tentativa);
        }catch(e){
            ultimo=e?.name==='AbortError'?'Timeout na consulta de frete.':e.message;
            if(tentativa<3)await esperarFrete(500*tentativa);
        }
    }
    throw new Error(ultimo);
}

async function atualizarFretesDbLote(sellerId,linhas){
    if(!linhas.length)return;
    const params=[sellerId];
    const values=[];
    for(const x of linhas){
        const base=params.length;
        params.push(String(x.id),Number(x.custo||0),Boolean(x.gratis));
        values.push(`($${base+1}::text,$${base+2}::numeric,$${base+3}::boolean)`);
    }
    await dbQuery(`
      UPDATE ml_items AS m SET
        shipping_cost=v.shipping_cost,
        free_shipping=v.free_shipping,
        net_received=GREATEST(0,m.price-m.sale_fee-v.shipping_cost),
        freight_synced_at=NOW(),
        freight_last_attempt_at=NOW(),
        freight_last_error=NULL,
        synced_at=CASE
          WHEN m.shipping_cost IS DISTINCT FROM v.shipping_cost
            OR m.free_shipping IS DISTINCT FROM v.free_shipping
          THEN NOW()
          ELSE m.synced_at
        END
      FROM (VALUES ${values.join(',')}) AS v(item_id,shipping_cost,free_shipping)
      WHERE m.seller_id=$1 AND m.item_id=v.item_id
    `,params);
}

async function marcarErrosFreteDbLote(sellerId,linhas){
    if(!linhas.length)return;
    const params=[sellerId];
    const values=[];
    for(const x of linhas){
        const base=params.length;
        params.push(String(x.id),String(x.erro||'Falha ao consultar frete.').slice(0,450));
        values.push(`($${base+1}::text,$${base+2}::text)`);
    }
    await dbQuery(`
      UPDATE ml_items AS m SET
        freight_last_attempt_at=NOW(),
        freight_last_error=v.erro
      FROM (VALUES ${values.join(',')}) AS v(item_id,erro)
      WHERE m.seller_id=$1 AND m.item_id=v.item_id
    `,params);
}

async function adotarProgressoFreteLegado(job){
    const offset=Number(job.payload?.offset||0);
    if(offset<=0||job.payload?.v20_adotado)return job;

    await dbQuery(`
      UPDATE ml_items SET
        freight_synced_at=COALESCE(freight_synced_at,synced_at),
        freight_last_attempt_at=COALESCE(freight_last_attempt_at,synced_at),
        freight_last_error=NULL
      WHERE seller_id=$1 AND item_id IN (
        SELECT item_id FROM ml_items
        WHERE seller_id=$1
        ORDER BY item_id
        LIMIT $2
      )
    `,[job.seller_id,offset]);

    const payload={...(job.payload||{}),v20_adotado:true,offset_legado:offset};
    const r=await dbQuery(
      `UPDATE ml_jobs SET payload=$2,updated_at=NOW(),message=$3 WHERE id=$1 RETURNING *`,
      [job.id,payload,`Retomando fretes a partir de ${offset.toLocaleString('pt-BR')} anúncio(s) já concluídos.`]
    );
    return r.rows[0]||job;
}

async function processarFretesEscala(job){
    const token=await obterTokenPersistenteParaSeller(job.seller_id);
    if(!token)throw new Error('Token Mercado Livre indisponível para sincronizar fretes.');

    let cursor=String(job.cursor||'');
    let processados=Number(job.processed||0);
    let erros=Number(job.errors||0);
    let total=Number(job.progress_total||0);

    if(total<=0){
        const tr=await dbQuery(`
          SELECT COUNT(*)::int total
          FROM ml_items
          WHERE seller_id=$1 AND status='active'
        `,[job.seller_id]);
        total=Number(tr.rows[0]?.total||0);
    }

    await dbQuery(`
      UPDATE ml_jobs SET
        progress_total=$2,
        progress_current=$3,
        message=$4,
        updated_at=NOW()
      WHERE id=$1
    `,[job.id,total,Math.min(total,processados+erros),
       `Fretes: ${Math.min(total,processados+erros).toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · lote de até 1.000`]);

    const LOTE=1000;
    const MICRO=100;
    const CONCORRENCIA=Math.max(8,Math.min(40,Number(process.env.ML_FREIGHT_CONCURRENCY||24)));

    while(true){
        const rr=await dbQuery(`
          SELECT item_id
          FROM ml_items
          WHERE seller_id=$1
            AND status='active'
            AND ($2::text='' OR item_id>$2)
          ORDER BY item_id
          LIMIT $3
        `,[job.seller_id,cursor,LOTE]);

        const ids=rr.rows.map(x=>String(x.item_id));
        if(!ids.length)break;

        const detalhes=await buscarItensBulkFreteRapido(token,ids);

        // O lote oficial do usuário é 1.000; dividimos em microblocos só
        // para heartbeat e para não perder progresso se o Render reiniciar.
        for(let i=0;i<ids.length;i+=MICRO){
            const microIds=ids.slice(i,i+MICRO);
            const itens=microIds.map(id=>detalhes.mapa[id]).filter(Boolean);
            const sucessos=[];
            const falhas=microIds
              .filter(id=>!detalhes.mapa[id])
              .map(id=>({id,erro:detalhes.falhas.get(id)||'Detalhes do anúncio indisponíveis.'}));

            for(let p=0;p<itens.length;p+=CONCORRENCIA){
                const grupo=itens.slice(p,p+CONCORRENCIA);
                const resultados=await Promise.allSettled(
                    grupo.map(item=>calcularFreteEscalaRobusto(item,token))
                );
                resultados.forEach((r,idx)=>{
                    const item=grupo[idx];
                    if(r.status==='fulfilled')sucessos.push(r.value);
                    else falhas.push({
                        id:String(item?.id||''),
                        erro:r.reason?.message||'Falha no frete.'
                    });
                });
            }

            await atualizarFretesDbLote(job.seller_id,sucessos);
            await marcarErrosFreteDbLote(job.seller_id,falhas);

            processados+=sucessos.length;
            erros+=falhas.length;
            cursor=microIds[microIds.length-1];

            const atual=Math.min(total,processados+erros);
            const pct=total?Math.min(100,Math.round((atual/total)*100)):100;

            await dbQuery(`
              UPDATE ml_jobs SET
                processed=$2,
                errors=$3,
                progress_current=$4,
                progress_total=$5,
                cursor=$6,
                message=$7,
                updated_at=NOW()
              WHERE id=$1
            `,[job.id,processados,erros,atual,total,cursor,
               `Fretes: ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · ${pct}% · lote de até 1.000${erros?` · ${erros.toLocaleString('pt-BR')} falha(s)`:''}`]);
        }
    }

    const atual=Math.min(total,processados+erros);
    const msg=erros
      ? `Fretes concluídos: ${processados.toLocaleString('pt-BR')} atualizado(s), ${erros.toLocaleString('pt-BR')} falha(s). Clique novamente para iniciar uma nova varredura completa.`
      : `Fretes sincronizados: ${processados.toLocaleString('pt-BR')} anúncio(s). Clique novamente quando quiser rodar tudo de novo.`;

    await dbQuery(`
      UPDATE ml_jobs SET
        status='completed',
        progress_current=$2,
        progress_total=$3,
        processed=$4,
        errors=$5,
        cursor=NULL,
        message=$6,
        finished_at=NOW(),
        updated_at=NOW()
      WHERE id=$1
    `,[job.id,atual,total,processados,erros,msg]);
}

async function prepararJobEscalaV26(sellerId,type,payload,total,{retomarFalha=true}={}){
    // Se o Render caiu no meio, devolve o job para a fila.
    await dbQuery(`
      UPDATE ml_jobs SET
        status='queued',
        locked_at=NULL,
        available_at=NOW(),
        message='Retomando automaticamente do último ponto salvo.',
        updated_at=NOW()
      WHERE seller_id=$1
        AND type=$2
        AND status='running'
        AND updated_at<NOW()-INTERVAL '90 seconds'
    `,[sellerId,type]);

    const ativo=await dbQuery(`
      SELECT * FROM ml_jobs
      WHERE seller_id=$1 AND type=$2 AND status IN ('queued','running')
      ORDER BY id DESC LIMIT 1
    `,[sellerId,type]);
    if(ativo.rows.length)return {job:ativo.rows[0],retomado:true};

    if(retomarFalha){
        const falho=await dbQuery(`
          SELECT * FROM ml_jobs
          WHERE seller_id=$1 AND type=$2 AND status='failed'
            AND (cursor IS NOT NULL OR progress_current>0)
          ORDER BY id DESC LIMIT 1
        `,[sellerId,type]);

        if(falho.rows.length){
            const r=await dbQuery(`
              UPDATE ml_jobs SET
                status='queued',
                attempts=0,
                available_at=NOW(),
                locked_at=NULL,
                finished_at=NULL,
                message='Retomando do último ponto salvo.',
                updated_at=NOW()
              WHERE id=$1
              RETURNING *
            `,[falho.rows[0].id]);
            return {job:r.rows[0],retomado:true};
        }
    }

    const job=await criarJob(sellerId,type,payload);
    const r=await dbQuery(`
      UPDATE ml_jobs SET
        progress_total=$2,
        progress_current=0,
        processed=0,
        errors=0,
        cursor=NULL,
        message=$3,
        updated_at=NOW()
      WHERE id=$1
      RETURNING *
    `,[job.id,total,payload?.mensagem_inicial||'Sincronização aguardando processamento.']);

    return {job:r.rows[0],retomado:false};
}

app.post('/api/scale/precos',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');
    try{
        const me=await usuarioML(token);
        const tr=await dbQuery(`SELECT COUNT(*)::int total FROM ml_items WHERE seller_id=$1 AND status='active'`,[me.id]);
        const total=Number(tr.rows[0]?.total||0);
        const preparado=await prepararJobEscalaV26(
            me.id,
            'price_sync',
            {modo:'full_refresh_v26',batch_size:1000,mensagem_inicial:`Preços: 0/${total.toLocaleString('pt-BR')} · lote de até 1.000`},
            total,
            {retomarFalha:true}
        );
        return res.status(202).json({
            sucesso:true,
            job:preparado.job,
            retomado:preparado.retomado,
            batch_size:1000,
            mensagem:preparado.retomado
              ? 'Sincronização de preços retomada do último ponto salvo.'
              : 'Sincronização completa de preços iniciada em lotes de até 1.000.'
        });
    }catch(e){
        console.error('[PREÇOS V26 START]',e);
        respostaErro(res,500,'Erro ao iniciar preços: '+e.message);
    }
});

app.post('/api/scale/fretes',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');
    try{
        const me=await usuarioML(token);
        const tr=await dbQuery(`SELECT COUNT(*)::int total FROM ml_items WHERE seller_id=$1 AND status='active'`,[me.id]);
        const total=Number(tr.rows[0]?.total||0);

        const preparado=await prepararJobEscalaV26(
            me.id,
            'freight_sync',
            {modo:'full_refresh_v26',batch_size:1000,mensagem_inicial:`Fretes: 0/${total.toLocaleString('pt-BR')} · lote de até 1.000`},
            total,
            {retomarFalha:true}
        );

        return res.status(202).json({
            sucesso:true,
            job:preparado.job,
            retomado:preparado.retomado,
            batch_size:1000,
            mensagem:preparado.retomado
              ? 'Sincronização de fretes retomada do último ponto salvo.'
              : 'Nova varredura completa de fretes iniciada desde o começo, em lotes de até 1.000.'
        });
    }catch(e){
        console.error('[FRETES V26 START]',e);
        respostaErro(res,500,'Erro ao iniciar fretes: '+e.message);
    }
});

/* =========================================================
   V27 — CUSTO E MARGEM DE LUCRO POR SKU
========================================================= */
function normalizarSkuKeyV27(v){
    return String(v||'').trim().toLowerCase();
}

app.get('/api/v27/sku-pricing',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');

    try{
        const me=await usuarioML(token);
        const includeAvailable=String(req.query?.include_available||'1')!=='0';

        const regrasPromise=dbQuery(`
          SELECT
            sku,
            sku_key,
            cost::float8 AS custo,
            desired_margin::float8 AS margem,
            updated_at
          FROM ml_sku_pricing
          WHERE seller_id=$1
          ORDER BY sku_key
        `,[me.id]);

        const versaoPromise=dbQuery(`
          SELECT
            COUNT(*)::int AS total,
            MAX(updated_at) AS max_updated_at
          FROM ml_sku_pricing
          WHERE seller_id=$1
        `,[me.id]);

        const skusPromise=includeAvailable
          ? dbQuery(`
              SELECT
                MIN(sku) AS sku,
                lower(trim(sku)) AS sku_key,
                COUNT(*)::int AS anuncios
              FROM ml_items
              WHERE seller_id=$1
                AND trim(COALESCE(sku,''))<>''
              GROUP BY lower(trim(sku))
              ORDER BY lower(trim(sku))
              LIMIT 10000
            `,[me.id])
          : Promise.resolve({rows:[]});

        const [regras,versao,skus]=await Promise.all([regrasPromise,versaoPromise,skusPromise]);
        const vr=versao.rows[0]||{};
        const maxAtualizado=vr.max_updated_at?new Date(vr.max_updated_at).toISOString():'0';
        const version=`${Number(vr.total||0)}:${maxAtualizado}`;

        res.set('Cache-Control','private, max-age=15');
        return res.json({
            sucesso:true,
            seller_id:String(me.id),
            version,
            regras:regras.rows,
            skus_disponiveis:skus.rows,
            include_available:includeAvailable
        });
    }catch(e){
        console.error('[SKU PRICING V27 GET]',e);
        respostaErro(res,500,'Erro ao carregar custos por SKU: '+e.message);
    }
});

// V42 — verificação extremamente leve da Base Financeira. A Simulação usa
// esta rota em segundo plano e só baixa a base inteira quando ela mudou.
app.get('/api/v42/sku-pricing/version',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');
    try{
        const me=await usuarioML(token);
        const q=await dbQuery(`
          SELECT COUNT(*)::int AS total, MAX(updated_at) AS max_updated_at
          FROM ml_sku_pricing
          WHERE seller_id=$1
        `,[me.id]);
        const row=q.rows[0]||{};
        const maxAtualizado=row.max_updated_at?new Date(row.max_updated_at).toISOString():'0';
        res.set('Cache-Control','private, max-age=15');
        return res.json({
            sucesso:true,
            seller_id:String(me.id),
            total:Number(row.total||0),
            version:`${Number(row.total||0)}:${maxAtualizado}`
        });
    }catch(e){
        respostaErro(res,500,'Erro ao verificar versão da Base Financeira: '+e.message);
    }
});

app.post('/api/v27/sku-pricing',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');

    const regras=Array.isArray(req.body?.regras)?req.body.regras:[];
    if(!regras.length)return respostaErro(res,400,'Adicione pelo menos um SKU.');
    if(regras.length>5000)return respostaErro(res,400,'Máximo de 5.000 SKUs por salvamento.');

    try{
        const me=await usuarioML(token);
        const normalizadas=[];
        const vistos=new Set();

        for(const r of regras){
            const sku=String(r?.sku||'').trim();
            const skuKey=normalizarSkuKeyV27(sku);
            const custo=Number(r?.custo);
            const margem=Number(r?.margem);

            if(!skuKey)continue;
            if(!Number.isFinite(custo)||custo<0){
                return respostaErro(res,400,`Custo inválido para o SKU ${sku}.`);
            }
            if(!Number.isFinite(margem)||margem<0||margem>=95){
                return respostaErro(res,400,`Margem inválida para o SKU ${sku}. Use um valor entre 0 e 94,99%.`);
            }

            if(vistos.has(skuKey))continue;
            vistos.add(skuKey);
            normalizadas.push({sku,skuKey,custo,margem});
        }

        if(!normalizadas.length)return respostaErro(res,400,'Nenhum SKU válido para salvar.');

        const payload=normalizadas.map(r=>({
            sku:r.sku,
            sku_key:r.skuKey,
            custo:r.custo,
            margem:r.margem
        }));

        await dbQuery(`
          INSERT INTO ml_sku_pricing
            (seller_id,sku,sku_key,cost,desired_margin,updated_at)
          SELECT
            $1::bigint,x.sku,x.sku_key,x.custo,x.margem,NOW()
          FROM jsonb_to_recordset($2::jsonb) AS x(
            sku text,
            sku_key text,
            custo numeric,
            margem numeric
          )
          ON CONFLICT(seller_id,sku_key) DO UPDATE SET
            sku=EXCLUDED.sku,
            cost=EXCLUDED.cost,
            desired_margin=EXCLUDED.desired_margin,
            updated_at=NOW()
        `,[me.id,JSON.stringify(payload)]);

        const v=await dbQuery(`
          SELECT COUNT(*)::int AS total, MAX(updated_at) AS max_updated_at
          FROM ml_sku_pricing WHERE seller_id=$1
        `,[me.id]);
        const vr=v.rows[0]||{};
        const version=`${Number(vr.total||0)}:${vr.max_updated_at?new Date(vr.max_updated_at).toISOString():'0'}`;

        return res.json({
            sucesso:true,
            salvos:normalizadas.length,
            seller_id:String(me.id),
            version,
            mensagem:`${normalizadas.length} SKU(s) salvo(s) na base de custos e margem.`
        });
    }catch(e){
        console.error('[SKU PRICING V27 POST]',e);
        respostaErro(res,500,'Erro ao salvar custos por SKU: '+e.message);
    }
});

app.delete('/api/v27/sku-pricing/:sku',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');

    try{
        const me=await usuarioML(token);
        const skuKey=normalizarSkuKeyV27(decodeURIComponent(req.params.sku||''));
        if(!skuKey)return respostaErro(res,400,'SKU inválido.');

        const r=await dbQuery(`
          DELETE FROM ml_sku_pricing
          WHERE seller_id=$1 AND sku_key=$2
          RETURNING sku
        `,[me.id,skuKey]);

        return res.json({
            sucesso:true,
            removido:Boolean(r.rows.length),
            sku:r.rows[0]?.sku||skuKey
        });
    }catch(e){
        console.error('[SKU PRICING V27 DELETE]',e);
        respostaErro(res,500,'Erro ao remover SKU: '+e.message);
    }
});


/* =========================================================
   ROTAS V36 — PREÇOS EM MASSA
========================================================= */

app.post('/api/scale/price-update/start',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');

    try{
        const me=await usuarioML(token);
        const entrada=Array.isArray(req.body?.items)?req.body.items:[];

        const mapa=new Map();
        for(const x of entrada){
            const id=String(x?.id||'').trim();
            const price=Number(x?.price);
            if(id && Number.isFinite(price) && price>0){
                mapa.set(id,{id,price:Number(price.toFixed(2))});
            }
        }

        const items=[...mapa.values()];
        if(!items.length)return respostaErro(res,400,'Nenhum anúncio válido para atualizar.');
        if(items.length>120000)return respostaErro(res,400,'Limite de segurança: até 120.000 anúncios por execução.');

        const ativo=await dbQuery(`
          SELECT id,seller_id,type,status,progress_current,progress_total,processed,errors,
                 cursor,message,result,created_at,updated_at,finished_at
          FROM ml_jobs
          WHERE seller_id=$1 AND type='price_update_mass'
            AND status IN ('queued','running')
          ORDER BY id DESC LIMIT 1
        `,[me.id]);

        if(ativo.rows.length){
            return res.status(202).json({
                sucesso:true,
                job:ativo.rows[0],
                retomado:true,
                mensagem:'Já existe uma atualização de preços em andamento. O painel continuará acompanhando esse processo.'
            });
        }

        const job=await criarJob(me.id,'price_update_mass',{
            version:'v36',
            items
        });

        const jr=await dbQuery(`
          UPDATE ml_jobs SET
            progress_total=$2,
            progress_current=0,
            processed=0,
            errors=0,
            cursor='0',
            message=$3,
            result='{}'::jsonb,
            updated_at=NOW()
          WHERE id=$1
          RETURNING id,seller_id,type,status,progress_current,progress_total,processed,
                    errors,cursor,message,result,created_at,updated_at,finished_at
        `,[job.id,items.length,
           `Atualização preparada: ${items.length.toLocaleString('pt-BR')} anúncio(s).`]);

        res.status(202).json({
            sucesso:true,
            job:jr.rows[0],
            retomado:false,
            total:items.length,
            mensagem:'Atualização de preços enviada para a fila persistente do servidor.'
        });
    }catch(e){
        console.error('[PRICE UPDATE MASS START V36]',e);
        respostaErro(res,500,'Erro ao iniciar atualização de preços: '+e.message);
    }
});

app.get('/api/scale/price-update/:jobId/errors',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');

    try{
        const me=await usuarioML(token);
        const limit=Math.min(500,Math.max(20,Number(req.query.limit||100)));
        const offset=Math.max(0,Number(req.query.offset||0));

        const [total,rows]=await Promise.all([
            dbQuery(`
              SELECT COUNT(*)::int total
              FROM ml_price_update_errors
              WHERE job_id=$1 AND seller_id=$2
            `,[req.params.jobId,me.id]),
            dbQuery(`
              SELECT item_id id,requested_price,failure_type,message_pt,
                     technical_message,http_status,code,attempts
              FROM ml_price_update_errors
              WHERE job_id=$1 AND seller_id=$2
              ORDER BY updated_at DESC,item_id
              LIMIT $3 OFFSET $4
            `,[req.params.jobId,me.id,limit,offset])
        ]);

        res.json({
            sucesso:true,
            total:Number(total.rows[0]?.total||0),
            limit,offset,
            erros:rows.rows
        });
    }catch(e){
        respostaErro(res,500,'Erro ao carregar falhas da atualização: '+e.message);
    }
});


/* =========================================================
   V46 — ATRIBUTOS VISÍVEIS + PUBLICAÇÃO SEGURA
========================================================= */
const cacheCategoriaV46=new Map();

function normalizarTextoBuscaV46(v=''){
    return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}

function extrairAtributosOutputV46(payload){
    const out=[];
    const seen=new Set();
    const walk=(node,ctx={group_id:'',group_label:'Características',group_relevance:999})=>{
        if(!node)return;
        if(Array.isArray(node))return node.forEach(x=>walk(x,ctx));
        if(typeof node!=='object')return;
        const label=String(node.label||node.name||ctx.group_label||'Características');
        const relevance=Number.isFinite(Number(node.relevance))?Number(node.relevance):ctx.group_relevance;
        const groupId=String(node.id||ctx.group_id||'');
        const next={group_id:groupId,group_label:label,group_relevance:relevance};
        if(Array.isArray(node.attributes)){
            for(const a of node.attributes){
                const id=String(a?.id||'').trim();
                if(!id||seen.has(id))continue;
                seen.add(id);
                out.push({
                    id,
                    group_id:String(ctx.group_id||groupId||''),
                    group_label:ctx.group_label||label,
                    group_relevance:Number.isFinite(Number(ctx.group_relevance))?Number(ctx.group_relevance):relevance,
                    attribute_relevance:Number.isFinite(Number(a?.relevance))?Number(a.relevance):999,
                    output_order:out.length
                });
            }
        }
        if(Array.isArray(node.groups))node.groups.forEach(g=>walk(g,{
            group_id:String(g?.id||''),
            group_label:String(g?.label||g?.name||label),
            group_relevance:Number.isFinite(Number(g?.relevance))?Number(g.relevance):relevance
        }));
        if(Array.isArray(node.components))node.components.forEach(c=>walk(c,next));
        if(Array.isArray(node.content))node.content.forEach(c=>walk(c,next));
    };
    walk(payload,{group_id:'',group_label:'Características',group_relevance:999});
    return out;
}

function mapAtributoDefV46(a={}){
    const hierarchy=String(a?.hierarchy||'').toUpperCase();
    return {
        id:String(a.id||''),
        name:String(a.name||a.id||''),
        value_type:String(a.value_type||'string'),
        value_max_length:Number(a.value_max_length||0)||null,
        values:Array.isArray(a.values)?a.values.slice(0,150).map(v=>({id:v?.id??'',name:String(v?.name||'')})):[],
        required:Boolean(a?.tags?.required),
        conditional_required:Boolean(a?.tags?.conditional_required),
        allow_variations:Boolean(a?.tags?.allow_variations),
        variation_attribute:Boolean(a?.tags?.variation_attribute),
        child_pk:Boolean(a?.tags?.child_pk||hierarchy==='CHILD_PK'),
        parent_pk:Boolean(a?.tags?.parent_pk||hierarchy==='PARENT_PK'),
        read_only:Boolean(a?.tags?.read_only),
        hidden:Boolean(a?.tags?.hidden||a?.tags?.vip_hidden),
        hierarchy,
        attribute_group_id:String(a?.attribute_group_id||''),
        attribute_group_name:String(a?.attribute_group_name||'')
    };
}

function extrairDefsTechnicalSpecsV52(payload){
    const out=[]; const seen=new Set();
    const walk=node=>{
        if(!node)return;
        if(Array.isArray(node)){node.forEach(walk);return;}
        if(typeof node!=='object')return;
        if(Array.isArray(node.attributes)){
            for(const a of node.attributes){
                const id=String(a?.id||'').trim();
                if(!id||seen.has(id))continue;
                seen.add(id);
                const tags=Array.isArray(a?.tags)
                  ? Object.fromEntries(a.tags.map(t=>[String(t),true]))
                  : (a?.tags&&typeof a.tags==='object'?a.tags:{});
                out.push(mapAtributoDefV46({...a,tags}));
            }
        }
        if(Array.isArray(node.groups))node.groups.forEach(walk);
        if(Array.isArray(node.components))node.components.forEach(walk);
        if(Array.isArray(node.content))node.content.forEach(walk);
    };
    walk(payload);
    return out;
}

function selecionarAtributosPrincipaisSecundariosV52(defs=[],fichaMeta=[]){
    const defMap=new Map((defs||[]).map(a=>[String(a.id),a]));
    // V52: usa a estrutura da ficha técnica editável do Mercado Livre e mantém
    // somente características principais/secundárias. Campos logísticos,
    // identificadores, catálogo, embalagem e operação continuam ocultos.
    const internos=/^(GTIN|GTIN14|EAN|UPC|ISBN|MPN|SELLER_SKU|SELLER_PACKAGE_|PACKAGE_|CATALOG_|EMPTY_GTIN_REASON|EMPTY_GTIN_REASON_CODE|INTERNAL_|EXTERNAL_)|(_ID$)/i;
    const candidatos=(fichaMeta||[]).map(meta=>{
        const d=defMap.get(String(meta.id))||null;
        if(!d)return null;
        const label=normalizarTextoBuscaV46(meta.group_label||d.attribute_group_name||'');
        const groupId=String(meta.group_id||d.attribute_group_id||'').toUpperCase();
        // A classificação agora respeita o grupo da ficha. O grupo MAIN/
        // "Características principais" fica como principal; todo outro grupo
        // visível e editável da ficha entra como característica secundária.
        const principal=groupId==='MAIN' || /caracteristicas?\s+principa/.test(label) || /atributos?\s+principa/.test(label);
        return {...d,...meta,display_level:principal?'principal':'secundaria',visible_to_buyer:true};
    }).filter(Boolean)
      .filter(a=>!a.read_only&&!a.hidden&&!internos.test(String(a.id||'')))
      .sort((a,b)=>{
          if(a.display_level!==b.display_level)return a.display_level==='principal'?-1:1;
          const ga=Number(a.group_relevance??999),gb=Number(b.group_relevance??999);
          if(ga!==gb)return ga-gb;
          const aa=Number(a.attribute_relevance??999),ab=Number(b.attribute_relevance??999);
          if(aa!==ab)return aa-ab;
          return Number(a.output_order??9999)-Number(b.output_order??9999);
      });

    const principais=[]; const secundarias=[]; const seen=new Set();
    const add=(dest,a)=>{const id=String(a?.id||''); if(!id||seen.has(id))return; seen.add(id); dest.push(a)};
    for(const a of candidatos){
        if(a.display_level==='principal')add(principais,a);
        else add(secundarias,{...a,display_level:'secundaria'});
    }
    return [...principais,...secundarias];
}
async function obterCategoriaV46(token,categoryId,{force=false}={}){
    const id=String(categoryId||'').trim();
    if(!id)throw new Error('Categoria não informada.');
    const hit=cacheCategoriaV46.get(id);
    if(!force&&hit&&Date.now()-hit.created_at<6*60*60*1000)return hit.data;

    const urls=[
        `${ML_API}/categories/${encodeURIComponent(id)}`,
        `${ML_API}/categories/${encodeURIComponent(id)}/attributes`,
        `${ML_API}/categories/${encodeURIComponent(id)}/technical_specs/input`,
        `${ML_API}/categories/${encodeURIComponent(id)}/technical_specs/output`,
        `${ML_API}/categories/${encodeURIComponent(id)}/sale_terms`
    ];
    const rr=await Promise.all(urls.map(async u=>{
        try{const r=await mlFetch(u,token);return {ok:r.ok,status:r.status,data:await jsonSeguro(r)}}catch(e){return {ok:false,status:500,data:{message:e.message}}}
    }));
    if(!rr[0].ok)throw new Error(formatarErroMercadoLivre(rr[0].data)||`Categoria ${id} indisponível.`);
    if(!rr[1].ok)throw new Error(formatarErroMercadoLivre(rr[1].data)||`Atributos da categoria ${id} indisponíveis.`);

    const categoria=rr[0].data||{};
    const defsBase=(Array.isArray(rr[1].data)?rr[1].data:[]).map(mapAtributoDefV46);
    const defsInput=rr[2].ok?extrairDefsTechnicalSpecsV52(rr[2].data):[];
    const defsMap=new Map(defsBase.map(a=>[String(a.id),a]));
    for(const a of defsInput){
        const id=String(a?.id||''); if(!id)continue;
        const atual=defsMap.get(id);
        if(!atual){defsMap.set(id,a);continue;}
        defsMap.set(id,{
            ...a,...atual,
            values:(Array.isArray(atual.values)&&atual.values.length)?atual.values:a.values,
            value_type:atual.value_type||a.value_type,
            value_max_length:atual.value_max_length||a.value_max_length,
            required:Boolean(atual.required||a.required),
            hidden:Boolean(atual.hidden||a.hidden),
            read_only:Boolean(atual.read_only||a.read_only)
        });
    }
    const defs=[...defsMap.values()];
    const defMap=new Map(defs.map(a=>[a.id,a]));
    const inputMeta=rr[2].ok?extrairAtributosOutputV46(rr[2].data):[];
    const outputMeta=rr[3].ok?extrairAtributosOutputV46(rr[3].data):[];
    const saleTerms=rr[4]?.ok && Array.isArray(rr[4]?.data) ? rr[4].data : [];

    // A ficha INPUT representa os campos que o vendedor realmente pode preencher.
    // Se estiver indisponível, usamos o OUTPUT; por fim, caímos no /attributes.
    const metaCombinada=[];
    const seenMeta=new Set();
    for(const m of [...inputMeta,...outputMeta]){
        const key=String(m?.id||'');
        if(!key||seenMeta.has(key))continue;
        seenMeta.add(key); metaCombinada.push(m);
    }

    let visiveis=[];
    if(metaCombinada.length){
        visiveis=selecionarAtributosPrincipaisSecundariosV52(defs,metaCombinada);
    }else{
        const fallbackMeta=defs
          .filter(a=>!a.read_only&&!a.hidden)
          .map((a,i)=>({
              id:a.id,
              group_id:String(a.attribute_group_id||''),
              group_label:a.attribute_group_name||'Características secundárias',
              group_relevance:a.required?1:2,
              attribute_relevance:a.required?1:2,
              output_order:i
          }));
        visiveis=selecionarAtributosPrincipaisSecundariosV52(defs,fallbackMeta);
    }

    // Caso um atributo seja obrigatório para publicar mas não apareça no output,
    // ele continua conhecido pelo servidor, porém não polui a tela do vendedor.
    const required=defs.filter(a=>a.required&&!a.read_only);
    const data={
        categoria,
        defs,
        defMap,
        visiveis,
        required,
        sale_terms:saleTerms,
        settings:categoria?.settings||{},
        max_pictures_per_item:Number(categoria?.settings?.max_pictures_per_item||0)||null,
        listing_allowed:categoria?.settings?.listing_allowed!==false
    };
    cacheCategoriaV46.set(id,{created_at:Date.now(),data});
    return data;
}

function sanitizarValorAtributoV46(attr,def){
    if(!attr?.id||!def||def.read_only)return null;
    const id=String(attr.id);
    let valueId=attr.value_id!=null?String(attr.value_id).trim():'';
    let valueName=attr.value_name!=null?String(attr.value_name).trim():'';
    const valores=Array.isArray(def.values)?def.values:[];

    // Mercado Livre: N/A é enviado com value_id = -1 e value_name = null.
    // Atributos obrigatórios não podem ser marcados como N/A.
    if(valueId==='-1'){
        if(def.required)return null;
        return {id,value_id:'-1',value_name:null};
    }

    if(valores.length){
        let match=null;
        if(valueId)match=valores.find(v=>String(v.id)===valueId)||null;
        if(!match&&valueName){
            const alvo=normalizarTextoBuscaV46(valueName);
            match=valores.find(v=>normalizarTextoBuscaV46(v.name)===alvo)||null;
        }
        if(match)return {id,value_id:String(match.id||''),value_name:String(match.name||'')};
        if(String(def.value_type)==='list'||String(def.value_type)==='boolean')return null;
    }

    if(!valueName)return null;
    if(['BRAND','MODEL'].includes(id)){
        // Evita keyword stuffing em Marca/Modelo, que costuma causar baixa qualidade
        // e pode provocar recusas de validação.
        valueName=valueName.split(/[\n,;|]/)[0].trim();
        if(valueName.split(/\s+/).length>8)valueName=valueName.split(/\s+/).slice(0,8).join(' ');
    }
    const max=Number(def.value_max_length||0);
    if(max>0&&valueName.length>max)valueName=valueName.slice(0,max).trim();
    if(!valueName)return null;
    return {id,value_name:valueName};
}

async function prepararPayloadPublicacaoV46(token,cfg,opts){
    const category=opts.category||{};
    const meta=await obterCategoriaV46(token,category.category_id);
    const errosVariacaoV53=validarLinhasVariacaoV53(cfg?.variations||{},meta);
    if(errosVariacaoV53.length){
        const e=new Error(errosVariacaoV53.join(' '));
        e.code='invalid_variations';
        throw e;
    }
    if(!meta.listing_allowed){
        const e=new Error(`A categoria ${category.category_name||category.category_id} não permite novas publicações.`);
        e.code='category_listing_not_allowed';throw e;
    }
    let payload=montarPayloadPublicacaoV37(cfg,opts);
    const defMap=meta.defMap;
    const attrs=[];
    const seen=new Set();
    for(const a of (Array.isArray(payload.attributes)?payload.attributes:[])){
        const id=String(a?.id||'');
        if(!id||seen.has(id))continue;
        const clean=sanitizarValorAtributoV46(a,defMap.get(id));
        if(clean){attrs.push(clean);seen.add(id);}
    }
    payload.attributes=attrs;

    aplicarCodigoUniversalV51(payload,cfg,meta);
    ajustarSaleTermsCategoriaV51(payload,cfg,meta);
    await aplicarGuiaTamanhoV55(token,payload,cfg,{...opts,userProductSeller:Boolean(opts?.userProductSeller)});

    // Resolve automaticamente o envio permitido pela conta + categoria.
    // Evita deixar o Mercado Livre assumir ME1 quando a conta não possui mais esse modo.
    const sellerId=String(opts?.sellerId||opts?.seller_id||'').trim();
    let shippingInfo=null;
    if(sellerId){
        if(category?.shipping_strategy && category?.shipping_mode==='me2'){
            shippingInfo={
                mode:'me2',
                candidates:['me2'],
                free_shipping:Boolean(category.shipping_free_shipping),
                local_pick_up:Boolean(category.shipping_local_pick_up),
                logistic_type:String(category.shipping_logistic_type||''),
                strategies:[['me2_full','me2_minimal','me2_mode_only'].includes(String(category.shipping_strategy))?String(category.shipping_strategy):'me2_full'],
                shipping:{
                    mode:'me2',
                    local_pick_up:Boolean(category.shipping_local_pick_up),
                    free_shipping:Boolean(category.shipping_free_shipping),
                    free_methods:[]
                }
            };
        }else{
            shippingInfo=await resolverEnvioMercadoV50(token,sellerId,category.category_id,payload,meta,cfg);
        }
        payload=aplicarEstrategiaEnvioV50(payload,shippingInfo,shippingInfo.strategies?.[0]||'me2_full');
    }

    const maxPics=Number(meta.max_pictures_per_item||0);
    if(maxPics>0&&Array.isArray(payload.pictures)&&payload.pictures.length>maxPics){
        payload.pictures=payload.pictures.slice(0,maxPics);
        if(Array.isArray(payload.variations)){
            const ids=payload.pictures.map(p=>p.id).filter(Boolean);
            payload.variations=payload.variations.map(v=>({...v,picture_ids:(v.picture_ids||[]).filter(id=>ids.includes(id)).slice(0,maxPics)}));
        }
    }

    const enviados=new Set(payload.attributes.map(a=>a.id));
    const enviadosVariacoes=new Set((Array.isArray(payload.variations)?payload.variations:[]).flatMap(v=>(v.attribute_combinations||[]).map(a=>String(a.id))));
    const faltantes=meta.required
      .filter(d=>!enviados.has(d.id)&&!enviadosVariacoes.has(String(d.id)))
      .filter(d=>!['ITEM_CONDITION'].includes(d.id))
      .map(d=>({id:d.id,name:d.name}));

    if(String(cfg.universal_code_mode||'no_code').toLowerCase()==='gtin' && !String(cfg.universal_code||'').trim()){
        if(meta.defMap.has('GTIN') && !faltantes.some(x=>x.id==='GTIN')){
            faltantes.push({id:'GTIN',name:'Código universal do produto (GTIN/EAN/UPC)'});
        }
    }

    return {payload,meta,faltantes,maxPics,shippingInfo};
}

function traduzirErroGradeTamanhoV58(data){
    const causas=Array.isArray(data?.cause)?data.cause:[];
    const achou=causas.find(c=>String(c?.code||'').includes('invalid.fashion_grid.grid_row_id') || String(c?.message||'').includes('SIZE_GRID_ROW_ID'));
    if(!achou)return null;
    return 'A linha da tabela de tamanhos não pertence ao guia selecionado. O painel agora valida o SIZE_GRID_ROW_ID diretamente no guia do Mercado Livre e associa a linha pelo tamanho de cada variação.';
}

function detalhesValidacaoV46(data){
    const grade=traduzirErroGradeTamanhoV58(data);
    if(grade)return [grade];
    const causas=Array.isArray(data?.cause)?data.cause:[];
    if(!causas.length)return [formatarErroMercadoLivre(data)];
    return causas.map(traduzirErroMercadoLivreV46);
}

function expandirTitulosSeoV46({produto='',keywords=[],sementes=[],quantidade=1,limite=60}){
    const clean=x=>String(x||'').replace(/\s+/g,' ').trim();
    const out=[];const seen=new Set();
    const add=x=>{x=clean(x).slice(0,limite).trim();if(x.length>=8&&!seen.has(x.toLowerCase())){seen.add(x.toLowerCase());out.push(x)}};
    sementes.forEach(add);
    const base=clean(produto);
    const kws=(Array.isArray(keywords)?keywords:[]).map(clean).filter(Boolean).slice(0,30);
    const padroes=[
      (a,b)=>`${a} ${b}`,
      (a,b)=>`${b} ${a}`,
      (a,b)=>`${a} ${b} Profissional`,
      (a,b)=>`${a} ${b} Premium`,
      (a,b)=>`${a} ${b} Completo`,
      (a,b)=>`${a} ${b} Prático`,
      (a,b)=>`${a} ${b} Uso Diário`,
      (a,b)=>`${a} ${b} Alta Precisão`
    ];
    for(let i=0;out.length<quantidade&&i<5000;i++){
        const k1=kws[i%Math.max(1,kws.length)]||'';
        const k2=kws[(i+7)%Math.max(1,kws.length)]||'';
        const a=base||k1||'Produto';
        const b=clean([k1,k2].filter(Boolean).join(' '));
        add(padroes[i%padroes.length](a,b));
    }
    const baseRepeticao=[...out];
    if(baseRepeticao.length){
        let i=0;
        while(out.length<quantidade){
            out.push(baseRepeticao[i%baseRepeticao.length]);
            i++;
        }
    }
    return out.slice(0,quantidade);
}

/* =========================================================
   ROTAS V36 — CRIAÇÃO EM MASSA
========================================================= */

app.get('/api/v36/criar/status',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    try{
        const me=await usuarioML(token);
        const up=Array.isArray(me?.tags)&&me.tags.includes('user_product_seller');
        res.json({
            sucesso:true,
            seller_id:me.id,
            user_product_seller:up,
            modo:up?'user_products':'legacy',
            mensagem:up
              ? 'Conta no novo modelo User Products: variações serão publicadas como itens da mesma família.'
              : 'Conta no modelo legado: variações podem ser enviadas no array variations quando a categoria permitir.'
        });
    }catch(e){
        respostaErro(res,500,e.message);
    }
});

app.get('/api/v36/criar/categorias',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    const q=String(req.query.q||'').trim();
    if(!q)return respostaErro(res,400,'Informe o produto para sugerir categorias.');

    try{
        const r=await mlFetch(
            `${ML_API}/sites/MLB/domain_discovery/search?limit=8&q=${encodeURIComponent(q)}`,
            token
        );
        const d=await jsonSeguro(r);
        if(!r.ok)return respostaErro(res,r.status,formatarErroMercadoLivre(d));

        const base=Array.isArray(d)?d:[];
        const categorias=await Promise.all(base.map(async x=>{
            const id=String(x?.category_id||'').trim();
            let detalhe=null;
            if(id){
                try{
                    const cr=await mlFetch(`${ML_API}/categories/${encodeURIComponent(id)}`,token);
                    const cd=await jsonSeguro(cr);
                    if(cr.ok)detalhe=cd;
                }catch(e){}
            }
            const path=Array.isArray(detalhe?.path_from_root)&&detalhe.path_from_root.length
              ? detalhe.path_from_root.map(p=>p?.name).filter(Boolean).join(' > ')
              : String(x?.category_name||id);
            const leaf=Array.isArray(detalhe?.path_from_root)&&detalhe.path_from_root.length
              ? String(detalhe.path_from_root[detalhe.path_from_root.length-1]?.name||x?.category_name||id)
              : String(x?.category_name||id);
            return {
                category_id:x.category_id,
                category_name:x.category_name,
                category_path:path,
                category_leaf_name:leaf,
                domain_id:x.domain_id,
                domain_name:x.domain_name,
                attributes:Array.isArray(x.attributes)?x.attributes:[]
            };
        }));

        res.json({sucesso:true,categorias});
    }catch(e){
        respostaErro(res,500,'Erro ao sugerir categoria: '+e.message);
    }
});

app.get('/api/v36/criar/categorias/:id/atributos',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    const id=String(req.params.id||'').trim();

    try{
        const meta=await obterCategoriaV46(token,id,{force:String(req.query.force||'')==='1'});
        res.json({
            sucesso:true,
            categoria:meta.categoria,
            atributos:meta.visiveis,
            atributos_visiveis:meta.visiveis,
            obrigatorios_publicacao:meta.required.map(a=>({id:a.id,name:a.name,required:true})),
            max_pictures_per_item:meta.max_pictures_per_item,
            listing_allowed:meta.listing_allowed,
            variacoes:meta.defs.filter(a=>!a.read_only&&!a.hidden&&(a.allow_variations||a.child_pk||(a.variation_attribute&&a.required))),
            atributos_variacao:meta.defs.filter(a=>!a.read_only&&!a.hidden&&(a.allow_variations||a.child_pk||(a.variation_attribute&&a.required))),
            fonte:'technical_specs/input+output-principais-secundarias',
            criterio:'Características principais e secundárias editáveis da ficha do Mercado Livre; campos técnicos e identificadores internos ficam ocultos.'
        });
    }catch(e){
        respostaErro(res,500,'Erro ao consultar as características exibidas ao comprador: '+e.message);
    }
});

app.post('/api/v36/criar/ia/conteudo',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    const produto=String(req.body?.produto||'').trim();
    const detalhes=String(req.body?.detalhes||'').trim();
    const quantidade=Math.min(500,Math.max(1,Number(req.body?.quantidade||1)));
    const limite=Math.min(60,Math.max(30,Number(req.body?.limite||60)));
    const categoryId=String(req.body?.category_id||'').trim();

    if(!produto)return respostaErro(res,400,'Informe o produto.');

    try{
        let atributosCategoria=[];
        if(categoryId){
            const ar=await mlFetch(`${ML_API}/categories/${encodeURIComponent(categoryId)}/attributes`,token);
            const ad=await jsonSeguro(ar);
            if(ar.ok && Array.isArray(ad)){
                atributosCategoria=ad
                  .filter(a=>a?.tags?.required || a?.attribute_group_id==='MAIN')
                  .slice(0,35)
                  .map(a=>({id:a.id,name:a.name,value_type:a.value_type,values:(a.values||[]).slice(0,30)}));
            }
        }

        const titulos=[];
        const batch=40;
        let tentativas=0;

        while(titulos.length<quantidade && tentativas<Math.ceil(quantidade/batch)+3){
            const faltam=Math.min(batch,quantidade-titulos.length);
            const txt=await chamarGeminiTexto(
              `Produto: ${produto}
Detalhes reais fornecidos pelo vendedor:
${detalhes||'(nenhum detalhe adicional)'}

Crie ${faltam} títulos diferentes para anúncio no Mercado Livre Brasil.
Cada título deve ter no máximo ${limite} caracteres.
Não invente marca, modelo, material, voltagem, quantidade, certificação ou acessório.
Não use emojis.
Retorne SOMENTE JSON: {"titulos":["..."]}.`,
              'Você cria títulos claros, naturais e comerciais para marketplace. Use somente fatos fornecidos pelo vendedor.'
            );

            const obj=extrairJsonIA(txt);
            for(const t of (Array.isArray(obj?.titulos)?obj.titulos:[])){
                const limpo=limitarTituloV36(t,limite);
                if(limpo && !titulos.some(x=>x.toLowerCase()===limpo.toLowerCase())){
                    titulos.push(limpo);
                }
                if(titulos.length>=quantidade)break;
            }
            tentativas++;
        }

        const ficha=await chamarGeminiTexto(
          `Produto: ${produto}
Detalhes reais:
${detalhes||'(nenhum detalhe adicional)'}

Atributos possíveis/úteis da categoria:
${JSON.stringify(atributosCategoria)}

Retorne SOMENTE JSON no formato:
{
  "descricao":"texto simples profissional em português do Brasil",
  "atributos":[{"id":"ID","value_name":"valor"}]
}

Regras:
- só preencha atributos cuja informação esteja explicitamente disponível nos dados do produto;
- nunca invente marca, GTIN, homologação, modelo, material, dimensão ou certificação;
- descrição em texto simples, sem HTML, sem telefone, link ou promessa falsa.`,
          'Você prepara conteúdo fiel e estruturado para uma publicação de marketplace.'
        );

        const fichaObj=extrairJsonIA(ficha);

        res.json({
            sucesso:true,
            titulos:titulos.slice(0,quantidade),
            descricao:String(fichaObj?.descricao||''),
            atributos:Array.isArray(fichaObj?.atributos)?fichaObj.atributos:[]
        });
    }catch(e){
        respostaErro(res,e.status||500,e.message);
    }
});

app.post('/api/v36/criar/ia/imagem',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    const prompt=String(req.body?.prompt||'').trim();
    const quantidade=Math.min(6,Math.max(1,Number(req.body?.quantidade||1)));
    if(!prompt)return respostaErro(res,400,'Informe o produto ou briefing da imagem.');

    try{
        const pictures=[];
        for(let i=0;i<quantidade;i++){
            const img=await gerarImagemGeminiV36(prompt);
            const pic=await enviarImagemMercadoLivreV36(token,img);
            pictures.push(pic);
        }
        res.json({sucesso:true,pictures});
    }catch(e){
        respostaErro(res,500,'Erro ao gerar/enviar imagem: '+e.message);
    }
});

app.post('/api/v36/criar/validar',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    try{
        const me=await usuarioML(token);
        const up=Array.isArray(me?.tags)&&me.tags.includes('user_product_seller');
        const cfg=req.body?.config||{};
        const varCfg=cfg.variations||{};
        const sample=montarPayloadPublicacaoV36(cfg,{
            familyIndex:0,
            variationIndex:0,
            userProductSeller:up
        });

        if(up && varCfg.enabled){
            // No novo modelo, cada variação será um item separado na mesma família.
            delete sample.variations;
        }

        const vr=await mlFetch(`${ML_API}/items/validate`,token,{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(sample)
        });
        const vd=await jsonSeguro(vr);

        res.status(vr.ok?200:vr.status).json({
            sucesso:vr.ok,
            modo:up?'user_products':'legacy',
            validacao:vd,
            erro:vr.ok?null:formatarErroMercadoLivre(vd)
        });
    }catch(e){
        respostaErro(res,500,'Erro ao validar publicação: '+e.message);
    }
});

app.post('/api/v36/criar/publicar',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');

    try{
        const me=await usuarioML(token);
        const cfg=req.body?.config||{};
        const titles=Array.isArray(cfg.titles)?cfg.titles.map(x=>limitarTituloV36(x,60)).filter(Boolean):[];
        const quantity=Math.min(2000,Math.max(1,Number(cfg.quantity||titles.length||1)));

        if(!String(cfg.category_id||'').trim())return respostaErro(res,400,'Escolha uma categoria.');
        if(!(Number(cfg.price)>0))return respostaErro(res,400,'Informe um preço válido.');
        if(!titles.length)return respostaErro(res,400,'Gere ou informe pelo menos um título/nome de família.');
        if(titles.length<quantity)return respostaErro(res,400,`Existem ${titles.length} título(s), mas foram solicitados ${quantity} anúncio(s). Gere todos os títulos antes de publicar.`);

        const pictureIds=(Array.isArray(cfg.picture_ids)?cfg.picture_ids:[]).filter(Boolean);
        if(!pictureIds.length){
            return respostaErro(res,400,'Adicione pelo menos uma imagem antes de publicar.');
        }

        const up=Array.isArray(me?.tags)&&me.tags.includes('user_product_seller');
        const varCfg=cfg.variations||{};

        if(varCfg.enabled){
            const ar=await mlFetch(`${ML_API}/categories/${encodeURIComponent(cfg.category_id)}/attributes`,token);
            const ad=await jsonSeguro(ar);
            if(!ar.ok)return respostaErro(res,ar.status,formatarErroMercadoLivre(ad));

            const attr=(Array.isArray(ad)?ad:[]).find(a=>String(a.id)===String(varCfg.attribute_id));
            const permitido=up
              ? Boolean(attr?.tags?.child_pk || attr?.tags?.allow_variations)
              : Boolean(attr?.tags?.allow_variations);

            if(!permitido){
                return respostaErro(res,400,'O atributo escolhido não pode ser usado como variação nessa categoria.');
            }

            if(!Array.isArray(varCfg.values) || !varCfg.values.filter(Boolean).length){
                return respostaErro(res,400,'Informe os valores das variações.');
            }
        }

        const ativo=await dbQuery(`
          SELECT id,seller_id,type,status,progress_current,progress_total,processed,
                 errors,cursor,message,result,created_at,updated_at,finished_at
          FROM ml_jobs
          WHERE seller_id=$1 AND type='mass_create'
            AND status IN ('queued','running')
          ORDER BY id DESC LIMIT 1
        `,[me.id]);

        if(ativo.rows.length){
            return res.status(202).json({
                sucesso:true,
                job:ativo.rows[0],
                retomado:true,
                mensagem:'Já existe uma criação em massa em andamento.'
            });
        }

        cfg.titles=titles.slice(0,quantity);
        cfg.quantity=quantity;
        cfg.picture_ids=pictureIds;

        const varCount=(cfg?.variations?.enabled && up)
          ? Math.min(
              Math.max(1,Number(cfg.variations.count||1)),
              Math.max(1,(cfg.variations.values||[]).filter(Boolean).length)
            )
          : 1;
        const total=quantity*varCount;

        const job=await criarJob(me.id,'mass_create',{
            version:'v36',
            config:cfg
        });

        const jr=await dbQuery(`
          UPDATE ml_jobs SET
            progress_total=$2,
            progress_current=0,
            processed=0,
            errors=0,
            cursor='0',
            message=$3,
            result=$4::jsonb,
            updated_at=NOW()
          WHERE id=$1
          RETURNING id,seller_id,type,status,progress_current,progress_total,processed,
                    errors,cursor,message,result,created_at,updated_at,finished_at
        `,[
            job.id,total,
            `Criação em massa preparada: ${total.toLocaleString('pt-BR')} item(ns).`,
            JSON.stringify({mode:up?'user_products':'legacy',families:quantity,items_total:total})
        ]);

        res.status(202).json({
            sucesso:true,
            job:jr.rows[0],
            modo:up?'user_products':'legacy',
            total,
            mensagem:up&&varCfg.enabled
              ? `No modelo User Products, ${quantity} família(s) com ${varCount} variação(ões) gerarão ${total} item(ns).`
              : `${total} anúncio(s) enviado(s) para a fila de criação.`
        });
    }catch(e){
        respostaErro(res,500,'Erro ao iniciar criação em massa: '+e.message);
    }
});

app.get('/api/v36/criar/jobs/:jobId/resultados',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');

    try{
        const me=await usuarioML(token);
        const limit=Math.min(500,Math.max(20,Number(req.query.limit||100)));
        const offset=Math.max(0,Number(req.query.offset||0));

        const [total,rows]=await Promise.all([
            dbQuery(`SELECT COUNT(*)::int total FROM ml_mass_create_results WHERE job_id=$1 AND seller_id=$2`,
              [req.params.jobId,me.id]),
            dbQuery(`
              SELECT seq,family_seq,variation_seq,title_requested,item_id,permalink,
                     success,message,technical_message
              FROM ml_mass_create_results
              WHERE job_id=$1 AND seller_id=$2
              ORDER BY seq
              LIMIT $3 OFFSET $4
            `,[req.params.jobId,me.id,limit,offset])
        ]);

        res.json({
            sucesso:true,
            total:Number(total.rows[0]?.total||0),
            resultados:rows.rows,
            limit,offset
        });
    }catch(e){
        respostaErro(res,500,e.message);
    }
});




const cacheAnaliseCriacaoV45=new Map();
const cacheKeywordsCriacaoV45=new Map();

function nowV45(){return Date.now();}
function limparCacheExpiradoV45(cache,ttlMs){
    const limite=nowV45()-ttlMs;
    for(const [k,v] of cache.entries()){
        if(Number(v?.created_at||0)<limite)cache.delete(k);
    }
}
function assinaturaImagensV45(referenceImages=[]){
    return (Array.isArray(referenceImages)?referenceImages:[])
      .slice(0,4)
      .map(img=>`${String(img||'').length}:${String(img||'').slice(0,48)}`)
      .join('|');
}
function chaveCacheV45(prefix,obj){
    const raw=JSON.stringify(obj||{});
    return `${prefix}:${Buffer.from(raw).toString('base64').slice(0,1800)}`;
}
async function buscarContextoMarketplaceV45(token,produto,detalhes=''){
    const q=String(produto||detalhes||'').trim();
    if(!q)return [];
    try{
        const r=await mlFetch(`${ML_API}/sites/MLB/search?q=${encodeURIComponent(q)}&limit=8`,token);
        const d=await jsonSeguro(r);
        if(!r.ok)return [];
        return (Array.isArray(d?.results)?d.results:[]).slice(0,6).map(x=>(
            {id:x.id,title:String(x.title||''),price:Number(x.price||0),condition:String(x.condition||''),thumbnail:String(x.thumbnail||''),permalink:String(x.permalink||'')}
        ));
    }catch(e){return [];}
}
function resumirContextoMarketplaceV45(lista=[]){
    return (Array.isArray(lista)?lista:[]).slice(0,5).map((x,i)=>{
        const partes=[`${i+1}. ${x.title||'Produto similar'}`];
        if(x.condition)partes.push(`condição: ${x.condition}`);
        if(Number.isFinite(Number(x.price))&&Number(x.price)>0)partes.push(`preço: R$ ${Number(x.price).toFixed(2)}`);
        return partes.join(' | ');
    }).join('\n');
}

/* =========================================================
   ROTAS V37 — CRIAÇÃO COM FOTO, 11 IMAGENS E MULTICATEGORIA
========================================================= */

app.post('/api/v37/criar/ia/analisar-produto',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    const produto=String(req.body?.produto||'').trim();
    const detalhes=String(req.body?.detalhes||'').trim();
    const quantidade=Math.min(1000,Math.max(1,Number(req.body?.quantidade||1)));
    const referenceImages=(Array.isArray(req.body?.reference_images)?req.body.reference_images:[]).filter(Boolean).slice(0,1);
    const categoryIds=[...new Set((Array.isArray(req.body?.category_ids)?req.body.category_ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,10);

    if(!produto && !referenceImages.length)return respostaErro(res,400,'Informe o produto ou envie pelo menos uma foto.');

    try{
        limparCacheExpiradoV45(cacheAnaliseCriacaoV45,1000*60*60*24);
        const cacheKey=chaveCacheV45('analise-v46',{
            produto,detalhes,categoryIds,refs:assinaturaImagensV45(referenceImages)
        });
        const cached=cacheAnaliseCriacaoV45.get(cacheKey);
        if(cached?.data){
            const base=cached.data;
            const titulos=expandirTitulosSeoV46({produto:base.produto_detectado||produto,keywords:base.keywords,sementes:base.titulos_semente||base.titulos,quantidade,limite:60});
            return res.json({...base,titulos,cache:true,cache_source:'server-memory'});
        }

        const categorias=(await Promise.all(categoryIds.map(async id=>{
            try{
                const meta=await obterCategoriaV46(token,id);
                return {
                    category_id:id,
                    category_name:String(meta.categoria?.name||id),
                    category_path:Array.isArray(meta.categoria?.path_from_root)&&meta.categoria.path_from_root.length?meta.categoria.path_from_root.map(p=>p?.name).filter(Boolean).join(' > '):String(meta.categoria?.name||id),
                    category_leaf_name:Array.isArray(meta.categoria?.path_from_root)&&meta.categoria.path_from_root.length?String(meta.categoria.path_from_root.at(-1)?.name||meta.categoria?.name||id):String(meta.categoria?.name||id),
                    atributos:meta.visiveis.map(a=>({id:a.id,name:a.name,value_type:a.value_type,value_max_length:a.value_max_length,required:a.required,values:(a.values||[]).slice(0,30)}))
                };
            }catch(e){return null;}
        }))).filter(Boolean);

        const sementesQtd=Math.min(24,Math.max(10,Math.min(quantidade,24)));
        const prompt=`
Gere conteúdo comercial para Mercado Livre em português do Brasil usando SOMENTE fatos visíveis/informados.
Produto: ${produto||'(identifique pela foto)'}
Detalhes reais: ${detalhes||'(não informados)'}
Categorias: ${categorias.map(c=>`${c.category_name} (${c.category_id})`).join(', ')||'nenhuma'}

Retorne SOMENTE JSON:
{
 "produto_detectado":"...",
 "resumo":"...",
 "keywords":["..."],
 "titulos":["..."],
 "descricao":"...",
 "image_prompt":"...",
 "categorias":[{"category_id":"...","attributes":[{"id":"...","value_name":"..."}]}]
}

Regras essenciais:
- Gere ${sementesQtd} títulos-semente diferentes, cada um com no máximo 60 caracteres. O servidor criará as demais variações localmente até chegar a ${quantidade}.
- Títulos: Produto + característica real + termo de busca, naturais, sem promessas falsas e sem keyword stuffing.
- Descrição: profissional e robusta, normalmente 1500 a 3500 caracteres, com introdução, resumo, benefícios, aplicações, diferenciais, itens inclusos apenas quando reais, cuidados e fechamento comercial.
- Keywords: até 35 termos realmente relacionados.
- Preencha SOMENTE as características listadas abaixo, pois são as que aparecem para o comprador na ficha técnica da categoria.
- BRAND/Marca deve ser somente a marca real e curta. Nunca coloque lista de palavras-chave em Marca.
- MODEL/Modelo deve ser somente o modelo real e curto. Nunca coloque lista de palavras-chave em Modelo.
- Se não houver informação segura para uma característica, NÃO a invente e não a retorne.

Características visíveis por categoria:
${JSON.stringify(categorias.map(c=>({category_id:c.category_id,atributos:c.atributos})))}
        `;

        let obj;
        // Caminho rápido: se o usuário já informou produto + detalhes, não reenviamos imagem pesada.
        if(produto && detalhes.length>=12){
            const texto=await chamarGeminiTexto(prompt,'Você é especialista em anúncios de marketplace. Retorne somente JSON válido. Seja preciso, curto no raciocínio e completo no resultado.');
            obj=extrairJsonIA(texto);
        }else{
            obj=await chamarGeminiJsonVisionV37(prompt,referenceImages);
        }

        const keywords=(Array.isArray(obj?.keywords)?obj.keywords:[]).map(x=>String(x).trim()).filter(Boolean).slice(0,35);
        const sementes=(Array.isArray(obj?.titulos)?obj.titulos:[]).map(t=>limitarTituloV36(t,60)).filter(Boolean).slice(0,24);
        const titulos=expandirTitulosSeoV46({produto:String(obj?.produto_detectado||produto||''),keywords,sementes,quantidade,limite:60});

        const categoriasOut=categorias.map(c=>{
            const defs=new Map(c.atributos.map(a=>[a.id,a]));
            const raw=(Array.isArray(obj?.categorias)?obj.categorias.find(x=>String(x?.category_id||'')===String(c.category_id))?.attributes:[])||[];
            const suggested=[];
            for(const a of raw){
                const def=defs.get(String(a?.id||''));
                const clean=sanitizarValorAtributoV46(a,def);
                if(clean)suggested.push(clean);
            }
            return {
                category_id:c.category_id,
                category_name:c.category_name,
                category_path:c.category_path,
                category_leaf_name:c.category_leaf_name,
                suggested_attributes:suggested,
                atributos:c.atributos
            };
        });

        const payload={
            sucesso:true,
            produto_detectado:String(obj?.produto_detectado||produto||''),
            resumo:String(obj?.resumo||''),
            keywords,
            titulos,
            titulos_semente:sementes,
            descricao:String(obj?.descricao||''),
            image_prompt:String(obj?.image_prompt||produto||''),
            categorias:categoriasOut,
            modo_rapido:true
        };
        cacheAnaliseCriacaoV45.set(cacheKey,{created_at:nowV45(),data:payload});
        res.json(payload);
    }catch(e){
        respostaErro(res,500,'Erro ao gerar títulos, descrição e características: '+e.message);
    }
});

app.post('/api/v38/criar/ia/keywords',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    const produto=String(req.body?.produto||'').trim();
    const detalhes=String(req.body?.detalhes||'').trim();
    const categoryIds=[...new Set((Array.isArray(req.body?.category_ids)?req.body.category_ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,10);
    if(!produto&&!detalhes)return respostaErro(res,400,'Informe o produto ou os detalhes para buscar palavras-chave.');

    const prompt=`Faça uma pesquisa na Web/Google sobre como compradores procuram este tipo de produto no Brasil e identifique termos comerciais recorrentes e relevantes para SEO de marketplace.

Produto: ${produto||'(não informado)'}
Detalhes reais: ${detalhes||'(não informado)'}
Categorias Mercado Livre: ${categoryIds.join(', ')||'não informadas'}

Retorne SOMENTE JSON no formato {"keywords":["..."],"observacao":"..."}. Gere até 35 palavras-chave ou frases curtas de intenção de compra. Não invente marca ou especificações. Não invente volume numérico de busca; se não houver dado público de volume, apenas priorize relevância e recorrência dos termos encontrados.`;

    try{
        limparCacheExpiradoV45(cacheKeywordsCriacaoV45,1000*60*60*12);
        const cacheKey=chaveCacheV45('keywords',{produto,detalhes,categoryIds});
        const cached=cacheKeywordsCriacaoV45.get(cacheKey);
        if(cached?.data)return res.json({...cached.data,cache:true,cache_source:'memory'});

        const permitirPesquisaWeb=String(process.env.GEMINI_GOOGLE_SEARCH_ENABLED||'false').toLowerCase()==='true';
        let fonte=permitirPesquisaWeb?'Pesquisa Google via Gemini':'Gemini (modo rápido com cache local do servidor)';
        let texto='';
        let pesquisaWeb=false;
        if(permitirPesquisaWeb){
            try{
                const gr=await chamarGeminiInteracao({
                    input:prompt,
                    systemInstruction:'Você é especialista em SEO para marketplace brasileiro. Use a Pesquisa Google quando ela ajudar. Retorne apenas JSON válido e não invente volume de busca.',
                    tools:[{type:'google_search'}]
                });
                texto=gr.texto;
                pesquisaWeb=true;
            }catch(e){
                fonte='Gemini sem pesquisa web (fallback automático)';
            }
        }
        if(!texto){
            texto=await chamarGeminiTexto(prompt,'Você é especialista em SEO para marketplace brasileiro. Retorne somente JSON válido com palavras-chave relevantes e não invente volume de busca.');
        }
        const obj=extrairJsonIA(texto);
        const keywords=(Array.isArray(obj?.keywords)?obj.keywords:[]).map(x=>String(x||'').trim()).filter(Boolean).slice(0,35);
        const payload={sucesso:true,keywords,fonte,pesquisa_web:pesquisaWeb,observacao:String(obj?.observacao||'')};
        cacheKeywordsCriacaoV45.set(cacheKey,{created_at:nowV45(),data:payload});
        res.json(payload);
    }catch(e){
        respostaErro(res,e.status||500,'Erro ao buscar palavras-chave: '+e.message);
    }
});

app.post('/api/v38/criar/ia/imagem-item',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    const produto=String(req.body?.produto||'').trim();
    const detalhes=String(req.body?.detalhes||'').trim();
    const referenceImages=(Array.isArray(req.body?.reference_images)?req.body.reference_images:[])
        .filter(Boolean)
        .slice(0,4);
    const index=Math.max(0,Math.min(CENAS_IMAGENS_V38.length-1,Number(req.body?.index||0)));

    if(!produto&&!referenceImages.length){
        return respostaErro(res,400,'Informe o produto ou envie uma foto de referência.');
    }

    try{
        const cena=CENAS_IMAGENS_V38[index];
        const similares=await buscarContextoMarketplaceV45(token,produto,detalhes);
        const contextoMercado=resumirContextoMarketplaceV45(similares);
        const prompt=`Produto: ${produto||'Produto sem nome informado'}
Detalhes reais informados: ${detalhes||'Nenhum detalhe adicional.'}
Contexto visual de marketplace encontrado para este mesmo tipo de produto:
${contextoMercado||'Nenhum contexto adicional encontrado.'}

Diretrizes extras:
- Preserve fielmente o produto das fotos enviadas.
- Gere sempre em proporção quadrada 1080x1080.
- As imagens de aplicação devem ser anatomicamente corretas, sem mãos deformadas e sem erro visual.
- A inspiração do marketplace serve apenas para melhorar composição, clareza e conversão, nunca para trocar o produto real.

${cena.prompt}`;

        const img=await gerarImagemCloudflareV44(prompt,referenceImages);
        const pic=await enviarImagemMercadoLivreV36(token,img);

        res.json({
            sucesso:true,
            provedor:'cloudflare',
            index,
            total:CENAS_IMAGENS_V38.length,
            picture:{
                index,
                tipo:cena.chave,
                titulo:cena.titulo,
                id:pic.id,
                url:pic.url,
                model:img.model,
                provider:'cloudflare'
            },
            referencias_encontradas:similares.length
        });
    }catch(e){
        const msg=String(e?.message||e);
        const retryable=Boolean(e?.retryable) || [408,429,500,502,503,504].includes(Number(e?.status));
        const quotaUnavailable=Boolean(e?.quotaUnavailable);

        res.status(Number(e?.status)||500).json({
            sucesso:false,
            provedor:'cloudflare',
            erro:msg,
            retryable:retryable&&!quotaUnavailable,
            quota_unavailable:quotaUnavailable,
            retry_after:Number(e?.retryAfter||0),
            technical_error:String(e?.technical||''),
            cloudflare_code:Number(e?.code||0),
            index
        });
    }
});

app.get('/api/v44/cloudflare/status',(req,res)=>{
    const cfg=configCloudflareImagemV44();
    res.json({
        sucesso:true,
        configurado:Boolean(cfg.accountId&&cfg.token),
        model:cfg.model,
        account_id_configurado:Boolean(cfg.accountId),
        token_configurado:Boolean(cfg.token)
    });
});


app.post('/api/v40/criar/imagem-upload',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    try{
        const parsed=parseDataUrlV37(req.body?.image_data_url);
        if(!parsed?.data)return respostaErro(res,400,'Imagem em data URL inválida.');
        const buffer=Buffer.from(parsed.data,'base64');
        if(!buffer.length)return respostaErro(res,400,'Imagem vazia.');
        if(buffer.length>12*1024*1024)return respostaErro(res,413,'A imagem ultrapassa 12 MB.');
        const pic=await enviarImagemMercadoLivreV36(token,{buffer,mime:parsed.mime||'image/png',model:'fallback-visual-v40'});
        res.json({
            sucesso:true,
            picture:{
                index:Number(req.body?.index||0),
                tipo:String(req.body?.tipo||'fallback'),
                titulo:String(req.body?.titulo||'Imagem visual'),
                id:pic.id,
                url:pic.url,
                model:'fallback-visual-v40',
                fallback:true
            }
        });
    }catch(e){
        respostaErro(res,500,'Erro ao enviar a imagem visual ao Mercado Livre: '+e.message);
    }
});

app.post('/api/v37/criar/ia/imagens-pack',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    const produto=String(req.body?.produto||'').trim();
    const detalhes=String(req.body?.detalhes||'').trim();
    const referenceImages=(Array.isArray(req.body?.reference_images)?req.body.reference_images:[]).filter(Boolean).slice(0,8);
    if(!produto && !referenceImages.length)return respostaErro(res,400,'Informe o produto ou envie uma foto de referência.');

    try{
        const pictures=await gerarPacote11ImagensV37({token,produto,detalhes,referenceImages});
        res.json({sucesso:true,total:pictures.length,pictures});
    }catch(e){
        respostaErro(res,500,'Erro ao gerar as 11 imagens do anúncio: '+e.message);
    }
});

app.get('/api/v51/build',(req,res)=>{
    res.json({sucesso:true,version:'V59',publication:'user-products-multivariacao-por-titulo',shipping:'ME2-explicito',attributes:'principais-secundarias',variations:'multi-atributo-por-linha+size-grid-100%-automatico',package_dimensions:'auto-category-defaults'});
});

app.post('/api/v51/criar/validar',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    try{
        const me=await usuarioML(token);
        const up=Array.isArray(me?.tags)&&me.tags.includes('user_product_seller');
        const cfg=req.body?.config||{};
        const categories=normalizarCategoriasConfigV37(cfg);
        if(!categories.length)return respostaErro(res,400,'Escolha pelo menos uma categoria.');

        const resultados=[];
        for(const category of categories){
            try{
                const prepared=await prepararPayloadPublicacaoV46(token,cfg,{familyIndex:0,variationIndex:0,userProductSeller:up,category,sellerId:me.id});
                const sample=prepared.payload;
                if(up && cfg?.variations?.enabled) delete sample.variations;

                if(prepared.faltantes.length){
                    resultados.push({
                        category_id:category.category_id,
                        category_name:category.category_name,
                        sucesso:false,
                        erro:`Faltam características obrigatórias para publicar: ${prepared.faltantes.map(x=>x.name).join(', ')}.`,
                        detalhes:prepared.faltantes.map(x=>`Preencha ${x.name} (${x.id}).`),
                        campos_faltando:prepared.faltantes,
                        fotos_enviadas:sample.pictures?.length||0,
                        limite_fotos:prepared.maxPics
                    });
                    continue;
                }

                const validacao=await validarPayloadMercadoComFallbackEnvioV50(token,sample,prepared.shippingInfo);
                const vr=validacao.response;
                const vd=validacao.data;
                const overrideLostMe1=podeIgnorarLostMe1NoValidadorV50(validacao,prepared.shippingInfo);
                const warningsOnly=Boolean(validacao?.warnings_only)||somenteWarningsMercadoV51(vd);
                const liberado=vr.ok||warningsOnly||overrideLostMe1;
                resultados.push({
                    category_id:category.category_id,
                    category_name:category.category_name,
                    sucesso:liberado,
                    validacao:vd,
                    aviso:warningsOnly
                      ? 'O Mercado Livre retornou apenas avisos não bloqueantes. Eles serão aplicados/normalizados automaticamente na publicação.'
                      : (overrideLostMe1?'O pré-validador retornou uma regra antiga de ME1, mas o payload está confirmado em ME2. A publicação real será tentada em ME2.':null),
                    erro:liberado?null:formatarErroMercadoLivre(vd),
                    detalhes:liberado?[]:detalhesValidacaoV46(vd),
                    shipping_mode:validacao.mode||prepared.shippingInfo?.mode||null,
                    shipping_strategy:validacao.strategy||null,
                    shipping_logistic_type:prepared.shippingInfo?.logistic_type||null,
                    shipping_free_shipping:Boolean(validacao.payload?.shipping?.free_shipping),
                    shipping_free_shipping_required:Boolean(prepared.shippingInfo?.free_shipping_required),
                    shipping_payload:validacao.payload?.shipping||null,
                    shipping_tentativas:validacao.tentativas||[],
                    dimensoes_pacote_auto:prepared.shippingInfo?.dimensoes_auto||[],
                    fotos_enviadas:validacao.payload?.pictures?.length||sample.pictures?.length||0,
                    limite_fotos:prepared.maxPics
                });
            }catch(e){
                resultados.push({category_id:category.category_id,category_name:category.category_name,sucesso:false,erro:e.message,detalhes:[e.message]});
            }
        }

        const ok=resultados.every(x=>x.sucesso);
        res.status(ok?200:400).json({
            sucesso:ok,
            modo:up?'user_products':'legacy',
            resultados,
            erro:ok?null:resultados.filter(x=>!x.sucesso).map(x=>`${x.category_name}: ${x.erro}`).join(' | ')
        });
    }catch(e){
        respostaErro(res,500,'Erro ao validar publicação: '+e.message);
    }
});

app.post('/api/v51/criar/publicar',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');

    try{
        const me=await usuarioML(token);
        const cfg=req.body?.config||{};
        const categories=normalizarCategoriasConfigV37(cfg);
        const titles=Array.isArray(cfg.titles)?cfg.titles.map(x=>limitarTituloV36(x,60)).filter(Boolean):[];
        const quantity=Math.min(5000,Math.max(1,Number(cfg.quantity||titles.length||1)));

        if(!categories.length)return respostaErro(res,400,'Escolha pelo menos uma categoria.');
        if(!(Number(cfg.price)>0))return respostaErro(res,400,'Informe um preço válido.');
        if(!titles.length)return respostaErro(res,400,'Gere ou informe pelo menos um título/nome de família.');
        if(titles.length<quantity)return respostaErro(res,400,`Existem ${titles.length} título(s), mas foram solicitados ${quantity} anúncio(s). Gere todos os títulos antes de publicar.`);

        const pictureIds=(Array.isArray(cfg.picture_ids)?cfg.picture_ids:[]).filter(Boolean);
        const manualPictureSources=normalizarUrlsManuaisV47(cfg.picture_sources_manual||cfg.manual_picture_urls||[]);
        if(!pictureIds.length&&!manualPictureSources.length)return respostaErro(res,400,'Adicione pelo menos uma imagem gerada ou informe uma URL pública de imagem antes de publicar.');

        const up=Array.isArray(me?.tags)&&me.tags.includes('user_product_seller');
        const varCfg=cfg.variations||{};
        const varRows=normalizarLinhasVariacaoV53(varCfg);
        if(varCfg.enabled&&!varRows.length){
            return respostaErro(res,400,'Preencha as linhas das variações antes de publicar.');
        }

        // Pré-valida uma amostra em TODAS as categorias antes de abrir o job.
        // Assim a fila não começa condenada por um campo inválido.
        const errosValidacao=[];
        const categoriasLimpas=[];
        let maxPicsGlobal=manualPictureSources.length||pictureIds.length;
        for(const category of categories){
            const prepared=await prepararPayloadPublicacaoV46(token,cfg,{familyIndex:0,variationIndex:0,userProductSeller:up,category,sellerId:me.id});
            if(prepared.maxPics)maxPicsGlobal=Math.min(maxPicsGlobal,prepared.maxPics);
            if(prepared.faltantes.length){
                errosValidacao.push(`${category.category_name}: faltam ${prepared.faltantes.map(x=>x.name).join(', ')}`);
                continue;
            }
            const sample=prepared.payload;
            if(up&&varCfg.enabled)delete sample.variations;
            const validacao=await validarPayloadMercadoComFallbackEnvioV50(token,sample,prepared.shippingInfo);
            const vr=validacao.response;
            const vd=validacao.data;
            const overrideLostMe1=podeIgnorarLostMe1NoValidadorV50(validacao,prepared.shippingInfo);
            const warningsOnly=Boolean(validacao?.warnings_only)||somenteWarningsMercadoV51(vd);
            if(!vr.ok&&!overrideLostMe1&&!warningsOnly){
                errosValidacao.push(`${category.category_name}: ${formatarErroMercadoLivre(vd)}`);
                continue;
            }
            // Se apenas o validador legado reclamar de ME1, mas todo o preflight confirmou ME2,
            // não bloqueamos a fila: o POST /items real será a fonte final de verdade.
            // Salva o modo ME2 para o worker usar a mesma configuração.
            category.shipping_mode='me2';
            category.shipping_strategy=validacao.strategy||'me2_full';
            category.shipping_free_shipping=Boolean(validacao.payload?.shipping?.free_shipping ?? prepared.shippingInfo?.free_shipping);
            category.shipping_local_pick_up=Boolean(validacao.payload?.shipping?.local_pick_up ?? prepared.shippingInfo?.local_pick_up);
            category.shipping_logistic_type=String(prepared.shippingInfo?.logistic_type||'');
            categoriasLimpas.push({
                ...category,
                attributes:prepared.payload.attributes
            });
        }
        if(errosValidacao.length){
            return res.status(400).json({
                sucesso:false,
                erro:'A publicação ainda possui campos que o Mercado Livre recusou.',
                detalhes:errosValidacao,
                mensagem_pt:errosValidacao.join(' | ')
            });
        }

        const ativo=await dbQuery(`
          SELECT id,seller_id,type,status,progress_current,progress_total,processed,errors,cursor,message,result,created_at,updated_at,finished_at
          FROM ml_jobs
          WHERE seller_id=$1 AND type='mass_create_v37' AND status IN ('queued','running')
          ORDER BY id DESC LIMIT 1
        `,[me.id]);
        if(ativo.rows.length){
            return res.status(202).json({sucesso:true,job:ativo.rows[0],retomado:true,mensagem:'Já existe uma criação em massa em andamento.'});
        }

        cfg.titles=titles.slice(0,quantity);
        cfg.quantity=quantity;
        cfg.picture_sources_manual=manualPictureSources.slice(0,Math.max(1,maxPicsGlobal));
        cfg.picture_ids=pictureIds.slice(0,Math.max(1,maxPicsGlobal));
        cfg.categories=categoriasLimpas;

        const varCount=quantidadeVariacoesV53(cfg,up);
        const total=quantity*categoriasLimpas.length*varCount;

        const job=await criarJob(me.id,'mass_create_v37',{version:'v53',config:cfg});
        const jr=await dbQuery(`
          UPDATE ml_jobs SET
            progress_total=$2,
            progress_current=0,
            processed=0,
            errors=0,
            cursor='0',
            message=$3,
            result=$4::jsonb,
            updated_at=NOW()
          WHERE id=$1
          RETURNING id,seller_id,type,status,progress_current,progress_total,processed,errors,cursor,message,result,created_at,updated_at,finished_at
        `,[job.id,total,`Criação em massa preparada: ${total.toLocaleString('pt-BR')} item(ns).`,JSON.stringify({mode:up?'user_products':'legacy',families:quantity,categories:categoriasLimpas.length,items_total:total})]);

        res.status(202).json({
            sucesso:true,
            job:jr.rows[0],
            modo:up?'user_products':'legacy',
            total,
            fotos_por_anuncio:(cfg.picture_sources_manual?.length||cfg.picture_ids.length),
            mensagem:`${categoriasLimpas.length} categoria(s) × ${quantity} anúncio(s)/família(s)${up&&varCfg.enabled?` × ${varCount} variação(ões)`:''}.`
        });
    }catch(e){
        respostaErro(res,500,'Erro ao iniciar criação em massa: '+e.message);
    }
});
app.get('/api/scale/status',async(req,res)=>{
    if(!db)return res.json({sucesso:true,database:false,worker:false,mensagem:'Configure DATABASE_URL para ativar o modo 90k.'});
    try{
        const q=await dbQuery(`SELECT COUNT(*)::int total FROM ml_items`);
        const j=await dbQuery(`SELECT status,COUNT(*)::int total FROM ml_jobs GROUP BY status`);
        res.json({sucesso:true,database:true,worker:ML_WORKER_ENABLED,itens:q.rows[0]?.total||0,jobs:j.rows});
    }catch(e){respostaErro(res,500,e.message)}
});


// Sincronização incremental para o botão "Puxar novos anúncios".
// Não percorre os 90 mil anúncios: consulta os mais recentes e para quando
// encontra uma sequência de itens que já está no PostgreSQL.
app.post('/api/scale/sync-new', async (req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');
    try{
        const me=await usuarioML(token);
        const sellerId=me.id;
        const c=await dbQuery(`SELECT COUNT(*)::int total FROM ml_items WHERE seller_id=$1`,[sellerId]);
        const bancoVazio=Number(c.rows[0]?.total||0)===0;

        // Banco recém-criado: importa primeiro um bloco visível imediatamente.
        // Depois tenta colocar a carga completa em background.
        if(bancoVazio){
            const sr=await mlFetch(`${ML_API}/users/${sellerId}/items/search?limit=100&offset=0`,token);
            const sd=await jsonSeguro(sr);
            if(!sr.ok)throw new Error(formatarErroMercadoLivre(sd)||`Mercado Livre HTTP ${sr.status}`);
            const ids=Array.isArray(sd.results)?sd.results:[];
            const mapa=await buscarItensBulk(token,ids);
            const itens=ids.map(id=>mapa[id]).filter(Boolean);
            if(itens.length)await upsertItensDb(sellerId,itens);

            // Se a conta usa OAuth persistente, o worker continua a carga dos 90 mil.
            let job=null;
            try{
                const existente=await dbQuery(`SELECT id,status FROM ml_jobs WHERE seller_id=$1 AND type='full_sync' AND status IN ('queued','running') ORDER BY id DESC LIMIT 1`,[sellerId]);
                if(existente.rows.length)job=existente.rows[0];
                else job=await criarJob(sellerId,'full_sync',{source:'bootstrap'});
            }catch(e){console.error('[BOOTSTRAP JOB]',e.message)}

            return res.json({
                sucesso:true,novos:itens.length,total:itens.length,bootstrap:true,job,
                mensagem:`${itens.length} anúncio(s) carregado(s) no banco. A sincronização completa foi iniciada em segundo plano.`
            });
        }

        let offset=0, novosTotal=0, paginas=0, conhecidosSeguidos=0;
        const maxPaginas=Math.max(1,Math.min(20,Number(req.body?.max_pages||10)));
        while(paginas<maxPaginas && conhecidosSeguidos<100){
            const params=new URLSearchParams({orders:'start_time_desc',limit:'100',offset:String(offset)});
            const sr=await mlFetch(`${ML_API}/users/${sellerId}/items/search?${params}`,token);
            const sd=await jsonSeguro(sr);
            if(!sr.ok)throw new Error(formatarErroMercadoLivre(sd)||`Mercado Livre HTTP ${sr.status}`);
            const ids=Array.isArray(sd.results)?sd.results:[];
            if(!ids.length)break;
            const ex=await dbQuery(`SELECT item_id FROM ml_items WHERE seller_id=$1 AND item_id = ANY($2::text[])`,[sellerId,ids]);
            const existentes=new Set(ex.rows.map(r=>String(r.item_id)));
            const idsNovos=ids.filter(id=>!existentes.has(String(id)));
            if(idsNovos.length){
                const mapa=await buscarItensBulk(token,idsNovos);
                const itens=idsNovos.map(id=>mapa[id]).filter(Boolean);
                if(itens.length)await upsertItensDb(sellerId,itens);
                novosTotal+=itens.length; conhecidosSeguidos=0;
            }else conhecidosSeguidos+=ids.length;
            paginas++; offset+=ids.length;if(ids.length<100)break;
        }
        const total=await dbQuery(`SELECT COUNT(*)::int total FROM ml_items WHERE seller_id=$1`,[sellerId]);
        res.json({sucesso:true,novos:novosTotal,total:Number(total.rows[0]?.total||0),paginas_verificadas:paginas,
          mensagem:novosTotal?`${novosTotal} anúncio(s) novo(s) adicionado(s).`:'Nenhum anúncio novo encontrado.'});
    }catch(e){
        console.error('[SYNC NOVOS]',e);
        respostaErro(res,500,'Erro ao buscar anúncios novos: '+e.message);
    }
});

app.post('/api/scale/sync',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado. Adicione DATABASE_URL no Render.');

    try{
        const me=await usuarioML(token);

        await dbQuery(`
          UPDATE ml_jobs SET
            status='queued',
            locked_at=NULL,
            available_at=NOW(),
            message='Retomando sincronização de anúncios.',
            updated_at=NOW()
          WHERE seller_id=$1
            AND type='full_sync'
            AND status='running'
            AND updated_at<NOW()-INTERVAL '90 seconds'
        `,[me.id]);

        const ativo=await dbQuery(`
          SELECT * FROM ml_jobs
          WHERE seller_id=$1 AND type='full_sync' AND status IN ('queued','running')
          ORDER BY id DESC LIMIT 1
        `,[me.id]);
        if(ativo.rows.length){
            return res.status(202).json({
                sucesso:true,
                job:ativo.rows[0],
                retomado:true,
                batch_size:5000,
                mensagem:'A sincronização de anúncios já está em andamento e continuará do ponto salvo.'
            });
        }

        // O scroll_id expira em 5 minutos. Só retomamos falha recente;
        // falha antiga recomeça do início para não usar cursor expirado.
        const falhoRecente=await dbQuery(`
          SELECT * FROM ml_jobs
          WHERE seller_id=$1 AND type='full_sync' AND status='failed'
            AND cursor IS NOT NULL
            AND updated_at>NOW()-INTERVAL '4 minutes'
          ORDER BY id DESC LIMIT 1
        `,[me.id]);

        if(falhoRecente.rows.length){
            const r=await dbQuery(`
              UPDATE ml_jobs SET
                status='queued',
                attempts=0,
                available_at=NOW(),
                locked_at=NULL,
                finished_at=NULL,
                message='Retomando anúncios do último scroll válido.',
                updated_at=NOW()
              WHERE id=$1 RETURNING *
            `,[falhoRecente.rows[0].id]);

            return res.status(202).json({
                sucesso:true,
                job:r.rows[0],
                retomado:true,
                batch_size:5000,
                mensagem:'Sincronização de anúncios retomada do ponto salvo.'
            });
        }

        const job=await criarJob(me.id,'full_sync',{
            source:'manual_v26',
            batch_size:5000
        });
        const jr=await dbQuery(`
          UPDATE ml_jobs SET
            message='Anúncios: preparando lote de até 5.000',
            progress_current=0,
            processed=0,
            errors=0,
            cursor=NULL,
            updated_at=NOW()
          WHERE id=$1 RETURNING *
        `,[job.id]);

        return res.status(202).json({
            sucesso:true,
            job:jr.rows[0],
            retomado:false,
            batch_size:5000,
            mensagem:'Sincronização completa de anúncios iniciada em lotes lógicos de até 5.000.'
        });
    }catch(e){
        respostaErro(res,500,e.message);
    }
});

app.get('/api/scale/jobs/:id',async(req,res)=>{
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');
    try{
        const r=await dbQuery(`
          SELECT id,seller_id,type,status,progress_current,progress_total,processed,
                 errors,cursor,message,attempts,result,available_at,locked_at,
                 created_at,updated_at,finished_at
          FROM ml_jobs
          WHERE id=$1
        `,[req.params.id]);
        if(!r.rows.length)return respostaErro(res,404,'Job não encontrado.');
        res.json({sucesso:true,job:r.rows[0]});
    }catch(e){respostaErro(res,500,e.message)}
});

app.get('/api/scale/anuncios',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');
    try{
        const me=await usuarioML(token);
        const page=Math.max(1,Number(req.query.page||1)),limit=Math.min(1000,Math.max(10,Number(req.query.limit||50))),offset=(page-1)*limit;
        const q=String(req.query.q||'').trim(),status=String(req.query.status||'').trim();
        const field=String(req.query.field||'all').trim().toLowerCase();
        const params=[me.id];let where=`seller_id=$1`;
        if(status){params.push(status);where+=` AND status=$${params.length}`}
        if(q){
            if(field==='sku'){
                params.push(q.toLowerCase());
                where+=` AND lower(COALESCE(sku,''))=$${params.length}`;
            }else if(field==='mlb'){
                params.push(q.toLowerCase());
                where+=` AND lower(item_id)=$${params.length}`;
            }else{
                params.push(`%${q.toLowerCase()}%`);
                where+=` AND (lower(title) LIKE $${params.length} OR lower(COALESCE(sku,'')) LIKE $${params.length} OR lower(item_id) LIKE $${params.length})`;
            }
        }
        const count=await dbQuery(`SELECT COUNT(*)::int total FROM ml_items WHERE ${where}`,params);
        const stats=await dbQuery(`SELECT COUNT(*)::int total, COUNT(*) FILTER (WHERE status='active')::int ativos FROM ml_items WHERE seller_id=$1`,[me.id]);
        params.push(limit,offset);
        const rows=await dbQuery(`SELECT item_id id,title,sku,price::float8 price,available_quantity,sold_quantity,status,listing_type_id,category_id,thumbnail,permalink,ml_updated_at last_updated,sale_fee::float8 sale_fee,commission_percentage::float8 commission_percentage,shipping_cost::float8 shipping_cost,free_shipping,net_received::float8 net_received,synced_at last_synced,
        CASE WHEN status='active' AND NOT (COALESCE(raw->'tags','[]'::jsonb) ? 'dynamic_standard_price') THEN true ELSE false END price_update_allowed,
        CASE
          WHEN status='under_review' THEN 'O anúncio está em revisão pelo Mercado Livre. O preço não pode ser alterado enquanto a revisão não terminar.'
          WHEN status='closed' THEN 'O anúncio está encerrado/finalizado. O preço não pode ser alterado nesse estado.'
          WHEN status='paused' THEN 'O anúncio está pausado e não está disponível para alteração de preço por este processo.'
          WHEN status='inactive' THEN 'O anúncio está inativo e não permite alteração de preço.'
          WHEN status<>'active' THEN 'O status atual do anúncio não permite alteração de preço pela API.'
          WHEN (COALESCE(raw->'tags','[]'::jsonb) ? 'dynamic_standard_price') THEN 'O anúncio possui Automatização de Preços configurada no Mercado Livre e a edição manual pela API está bloqueada.'
          ELSE NULL
        END price_update_block_reason
        FROM ml_items WHERE ${where} ORDER BY ml_updated_at DESC NULLS LAST,item_id LIMIT $${params.length-1} OFFSET $${params.length}`,params);
        const total=count.rows[0]?.total||0;
        const totalConta=stats.rows[0]?.total||0, ativos=stats.rows[0]?.ativos||0;
        res.json({sucesso:true,seller_id:String(me.id),pagina:page,limite:limit,total,paginas:Math.max(1,Math.ceil(total/limit)),total_conta:totalConta,ativos,outros:Math.max(0,totalConta-ativos),itens:rows.rows});
    }catch(e){respostaErro(res,500,e.message)}
});


/* V40 — anúncios pausados, inativos, finalizados pelo ML e em revisão. */
app.get('/api/scale/anuncios-restritos',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');
    try{
        const me=await usuarioML(token);
        const sellerId=me.id;
        const limit=Math.min(5000,Math.max(100,Number(req.query.limit||2000)));
        const offset=Math.max(0,Number(req.query.offset||0));
        const filtro=String(req.query.status||'').trim().toLowerCase();
        const validos=new Set(['paused','inactive','closed','under_review']);
        const params=[sellerId];
        let cond=`seller_id=$1 AND status IN ('paused','inactive','closed','under_review')`;
        // "closed + deleted" é exclusão feita pelo seller; o usuário pediu para não listar excluídos.
        cond+=` AND NOT (status='closed' AND LOWER(COALESCE(raw::text,'')) LIKE '%\"deleted\"%')`;
        if(filtro&&validos.has(filtro)){
            params.push(filtro);
            cond+=` AND status=$${params.length}`;
        }

        const [totais,total]=await Promise.all([
            dbQuery(`SELECT
                COUNT(*) FILTER (WHERE status='paused')::int pausados,
                COUNT(*) FILTER (WHERE status='inactive')::int inativos,
                COUNT(*) FILTER (WHERE status='under_review')::int revisao,
                COUNT(*) FILTER (WHERE status='closed' AND LOWER(COALESCE(raw::text,'')) NOT LIKE '%\"deleted\"%')::int finalizados
              FROM ml_items WHERE seller_id=$1`,[sellerId]),
            dbQuery(`SELECT COUNT(*)::int total FROM ml_items WHERE ${cond}`,params)
        ]);

        const queryParams=[...params,limit,offset];
        const rows=await dbQuery(`
          SELECT item_id id,title,sku,price::float8 price,available_quantity,sold_quantity,
                 status,listing_type_id,category_id,thumbnail,permalink,
                 ml_updated_at last_updated,synced_at last_synced,
                 raw->'sub_status' sub_status,
                 raw->'tags' tags,
                 CASE
                   WHEN status='under_review' AND LOWER(COALESCE(raw->>'sub_status','')) LIKE '%waiting_for_patch%' THEN 'O Mercado Livre detectou uma infração no anúncio. É necessário corrigir a publicação para que ela possa voltar a ficar ativa.'
                   WHEN status='under_review' AND LOWER(COALESCE(raw->>'sub_status','')) LIKE '%forbidden%' THEN 'O anúncio foi desativado pelo Mercado Livre por uma moderação e não pode ser reativado.'
                   WHEN status='under_review' AND LOWER(COALESCE(raw->>'sub_status','')) LIKE '%held%' THEN 'O anúncio está oculto enquanto passa por uma revisão manual do Mercado Livre.'
                   WHEN status='under_review' AND LOWER(COALESCE(raw->>'sub_status','')) LIKE '%pending_documentation%' THEN 'O Mercado Livre solicitou documentação relacionada à moderação ou denúncia.'
                   WHEN status='paused' AND LOWER(COALESCE(raw->>'sub_status','')) LIKE '%picture_downloading_pending%' THEN 'O anúncio está pausado enquanto o Mercado Livre processa uma imagem informada por URL.'
                   WHEN status='paused' THEN 'O anúncio está pausado no Mercado Livre.'
                   WHEN status='inactive' THEN 'O anúncio está inativo no Mercado Livre.'
                   WHEN status='closed' THEN 'O anúncio foi finalizado no Mercado Livre.'
                   WHEN status='under_review' THEN 'O anúncio está em revisão pelo Mercado Livre.'
                   ELSE 'Motivo ainda não informado pelo Mercado Livre.'
                 END motivo_pt
          FROM ml_items
          WHERE ${cond}
          ORDER BY
            CASE status WHEN 'under_review' THEN 1 WHEN 'inactive' THEN 2 WHEN 'paused' THEN 3 WHEN 'closed' THEN 4 ELSE 5 END,
            ml_updated_at DESC NULLS LAST,item_id
          LIMIT $${queryParams.length-1} OFFSET $${queryParams.length}
        `,queryParams);

        res.json({
            sucesso:true,
            total:Number(total.rows[0]?.total||0),
            offset,limit,
            totais:totais.rows[0]||{pausados:0,inativos:0,revisao:0,finalizados:0},
            itens:rows.rows
        });
    }catch(e){respostaErro(res,500,'Erro ao carregar anúncios com status especial: '+e.message)}
});


/* V41 — motivo real em português + exclusão selecionada de anúncios restritos. */
function textoSemHtmlV41(v){
    return String(v||'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/\s+/g,' ').trim();
}
function substatusArrayV41(v){
    if(Array.isArray(v))return v.map(x=>String(x).toLowerCase());
    if(v&&typeof v==='object')return Object.values(v).map(x=>String(x).toLowerCase());
    const s=String(v||'').toLowerCase();return s?s.split(',').map(x=>x.trim()).filter(Boolean):[];
}
function motivoFallbackV41(item={}){
    const st=String(item.status||'').toLowerCase();
    const subs=substatusArrayV41(item.sub_status||item?.raw?.sub_status);
    const has=x=>subs.some(s=>s.includes(x));
    if(has('waiting_for_patch'))return 'O Mercado Livre detectou uma infração no anúncio. É necessário corrigir a publicação para que ela possa voltar a ficar ativa.';
    if(has('forbidden'))return 'O anúncio foi desativado pelo Mercado Livre por uma moderação e não pode ser reativado.';
    if(has('held'))return 'O anúncio está oculto enquanto passa por uma revisão manual do Mercado Livre.';
    if(has('pending_documentation'))return 'O Mercado Livre solicitou documentação relacionada a uma moderação ou denúncia. O anúncio ficará oculto até a análise terminar.';
    if(has('suspended_for_prevention'))return 'O anúncio foi suspenso preventivamente durante uma análise de segurança ou risco do Mercado Livre.';
    if(has('suspended'))return 'O anúncio foi suspenso durante uma análise de segurança ou risco do Mercado Livre.';
    if(has('picture_downloading_pending'))return 'O anúncio está pausado enquanto o Mercado Livre processa uma imagem informada por URL.';
    if(has('paused_by_seller'))return 'O anúncio foi pausado pelo vendedor.';
    if(has('out_of_stock'))return 'O anúncio foi pausado por falta de estoque.';
    if(has('expired'))return 'O anúncio foi finalizado porque chegou ao fim do período de publicação.';
    if(st==='under_review')return 'O anúncio está em revisão pelo Mercado Livre.';
    if(st==='inactive')return 'O anúncio está inativo no Mercado Livre.';
    if(st==='paused')return 'O anúncio está pausado no Mercado Livre.';
    if(st==='closed')return 'O anúncio foi finalizado no Mercado Livre.';
    return 'O Mercado Livre não informou um motivo detalhado para este anúncio.';
}
async function consultarMotivoRealV41(itemId,token,itemFallback={}){
    try{
        const ref=`${String(itemId)}-ITM`;
        const r=await mlFetch(`${ML_API}/moderations/last_moderation/${encodeURIComponent(ref)}?language=PT`,token);
        const d=await jsonSeguro(r);
        if(!r.ok)return {id:String(itemId),reason:motivoFallbackV41(itemFallback),remedy:'',name:'',http:r.status};
        const arr=Array.isArray(d)?d:(Array.isArray(d?.data)?d.data:[]);
        const mod=arr[0]||{};
        const words=Array.isArray(mod?.wordings)?mod.wordings:[];
        const reason=words.find(w=>String(w?.type||'').toUpperCase()==='REASON')?.value||'';
        const remedy=words.find(w=>String(w?.type||'').toUpperCase()==='REMEDY')?.value||'';
        return {id:String(itemId),reason:textoSemHtmlV41(reason)||motivoFallbackV41(itemFallback),remedy:textoSemHtmlV41(remedy),name:String(mod?.name||''),http:r.status};
    }catch(e){
        return {id:String(itemId),reason:motivoFallbackV41(itemFallback),remedy:'',name:'',erro:e.message};
    }
}

app.post('/api/v41/anuncios-restritos/motivos',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');
    try{
        const me=await usuarioML(token);
        const ids=[...new Set((Array.isArray(req.body?.ids)?req.body.ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,25);
        if(!ids.length)return res.json({sucesso:true,itens:[]});
        const q=await dbQuery(`SELECT item_id id,status,raw->'sub_status' sub_status,raw FROM ml_items WHERE seller_id=$1 AND item_id=ANY($2::text[])`,[me.id,ids]);
        const mapa=new Map(q.rows.map(x=>[String(x.id),x]));
        const itens=(await mapLimitV21(ids,4,async id=>consultarMotivoRealV41(id,token,mapa.get(String(id))||{}))).filter(Boolean);
        res.set('Cache-Control','no-store');
        res.json({sucesso:true,itens});
    }catch(e){respostaErro(res,500,'Erro ao consultar os motivos reais: '+e.message)}
});

function erroExclusaoPtV41(status,d){
    const raw=String(d?.message||d?.error||d?.cause?.[0]?.message||d?.cause?.[0]?.code||formatarErroMercadoLivre(d)||'').trim();
    const code=String(d?.error||d?.cause?.[0]?.code||'').toLowerCase();
    if(status===404)return 'O anúncio não foi encontrado no Mercado Livre. Ele pode já ter sido excluído.';
    if(status===401)return 'A sessão do Mercado Livre expirou ou o token não é válido.';
    if(status===403||code.includes('forbidden'))return 'O Mercado Livre não autorizou excluir este anúncio com a credencial atual.';
    if(/sold|sale/i.test(raw))return 'O Mercado Livre não permitiu excluir este anúncio por causa do histórico de vendas ou de uma regra comercial aplicada ao item.';
    if(/under.?review|moderation/i.test(raw))return 'O anúncio está sob moderação. O Mercado Livre não permitiu concluir a exclusão neste momento.';
    if(/not.?modifiable|cannot update|not allowed/i.test(raw))return 'O Mercado Livre bloqueou a alteração deste anúncio no estado atual.';
    return raw?`Mercado Livre: ${raw}`:`O Mercado Livre recusou a exclusão (HTTP ${status}).`;
}
async function putItemV41(itemId,token,body){
    const r=await mlFetch(`${ML_API}/items/${encodeURIComponent(itemId)}`,token,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await jsonSeguro(r);return {ok:r.ok,status:r.status,data:d};
}
async function excluirItemRestritoV41(itemId,token,sellerId){
    const id=String(itemId||'').trim();
    if(!id)return {id,sucesso:false,erro:'ID do anúncio inválido.'};
    try{
        const r=await mlFetch(`${ML_API}/items/${encodeURIComponent(id)}`,token);
        const item=await jsonSeguro(r);
        if(!r.ok)return {id,sucesso:false,erro:erroExclusaoPtV41(r.status,item)};
        if(String(item?.seller_id||'')!==String(sellerId))return {id,sucesso:false,erro:'Este anúncio não pertence à conta Mercado Livre conectada.'};
        const status=String(item?.status||'').toLowerCase();
        const allowed=new Set(['paused','inactive','closed','under_review']);
        if(!allowed.has(status))return {id,sucesso:false,erro:`O anúncio está com status ${status||'desconhecido'} e não pertence à lista permitida para exclusão nesta tela.`};
        const subs=substatusArrayV41(item?.sub_status);
        const proibido=status==='under_review'&&subs.some(s=>s.includes('forbidden'));

        // Em forbidden, a documentação permite exclusão direta. Nos demais, fecha antes quando necessário.
        if(proibido){
            const del=await putItemV41(id,token,{deleted:true});
            if(!del.ok)return {id,sucesso:false,erro:erroExclusaoPtV41(del.status,del.data)};
        }else{
            if(status!=='closed'){
                const close=await putItemV41(id,token,{status:'closed'});
                if(!close.ok){
                    // Alguns estados moderados aceitam somente a exclusão direta.
                    const direto=await putItemV41(id,token,{deleted:true});
                    if(!direto.ok)return {id,sucesso:false,erro:erroExclusaoPtV41(direto.status,direto.data)};
                }else{
                    const del=await putItemV41(id,token,{deleted:true});
                    if(!del.ok)return {id,sucesso:false,erro:erroExclusaoPtV41(del.status,del.data)};
                }
            }else{
                const del=await putItemV41(id,token,{deleted:true});
                if(!del.ok)return {id,sucesso:false,erro:erroExclusaoPtV41(del.status,del.data)};
            }
        }
        try{await dbQuery(`DELETE FROM ml_items WHERE seller_id=$1 AND item_id=$2`,[sellerId,id])}catch(_){ }
        return {id,sucesso:true};
    }catch(e){return {id,sucesso:false,erro:'Erro ao excluir o anúncio: '+e.message}}
}

app.post('/api/v41/anuncios-restritos/excluir-lote',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token não fornecido.');
    try{
        const me=await usuarioML(token);
        const ids=[...new Set((Array.isArray(req.body?.ids)?req.body.ids:[]).map(x=>String(x||'').trim()).filter(Boolean))].slice(0,50);
        if(!ids.length)return respostaErro(res,400,'Nenhum anúncio selecionado para exclusão.');
        const resultados=(await mapLimitV21(ids,3,async id=>excluirItemRestritoV41(id,token,me.id))).filter(Boolean);
        const excluidos=resultados.filter(x=>x.sucesso).length;
        const falhas=resultados.length-excluidos;
        res.json({sucesso:true,total:resultados.length,excluidos,falhas,resultados});
    }catch(e){respostaErro(res,500,'Erro ao excluir anúncios selecionados: '+e.message)}
});

/* V32 — somente anúncios alterados desde o último cursor. */
app.get('/api/scale/anuncios/changes',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL não configurado.');
    try{
        const me=await usuarioML(token);
        const sellerId=me.id;
        const limit=Math.min(5000,Math.max(50,Number(req.query.limit||5000)));
        const rawTs=String(req.query.after_ts||'1970-01-01T00:00:00.000Z');
        const rawId=String(req.query.after_id||'');
        const parsed=new Date(rawTs);
        const afterTs=Number.isNaN(parsed.getTime())?'1970-01-01T00:00:00.000Z':parsed.toISOString();

        const [stats,rows]=await Promise.all([
            dbQuery(`SELECT COUNT(*)::int total,MAX(synced_at) max_synced_at FROM ml_items WHERE seller_id=$1`,[sellerId]),
            dbQuery(`
              SELECT item_id id,title,sku,price::float8 price,available_quantity,sold_quantity,
                     status,listing_type_id,category_id,thumbnail,permalink,
                     ml_updated_at last_updated,sale_fee::float8 sale_fee,
                     commission_percentage::float8 commission_percentage,
                     shipping_cost::float8 shipping_cost,free_shipping,
                     net_received::float8 net_received,synced_at last_synced,
                     CASE WHEN status='active' AND NOT (COALESCE(raw->'tags','[]'::jsonb) ? 'dynamic_standard_price') THEN true ELSE false END price_update_allowed,
                     CASE
                       WHEN status='under_review' THEN 'O anúncio está em revisão pelo Mercado Livre. O preço não pode ser alterado enquanto a revisão não terminar.'
                       WHEN status='closed' THEN 'O anúncio está encerrado/finalizado. O preço não pode ser alterado nesse estado.'
                       WHEN status='paused' THEN 'O anúncio está pausado e não está disponível para alteração de preço por este processo.'
                       WHEN status='inactive' THEN 'O anúncio está inativo e não permite alteração de preço.'
                       WHEN status<>'active' THEN 'O status atual do anúncio não permite alteração de preço pela API.'
                       WHEN (COALESCE(raw->'tags','[]'::jsonb) ? 'dynamic_standard_price') THEN 'O anúncio possui Automatização de Preços configurada no Mercado Livre e a edição manual pela API está bloqueada.'
                       ELSE NULL
                     END price_update_block_reason
              FROM ml_items
              WHERE seller_id=$1
                AND (synced_at>$2::timestamptz OR (synced_at=$2::timestamptz AND item_id>$3))
              ORDER BY synced_at ASC,item_id ASC
              LIMIT $4
            `,[sellerId,afterTs,rawId,limit])
        ]);

        const itens=rows.rows;
        const ultimo=itens[itens.length-1]||null;
        res.set('Cache-Control','no-store');
        res.json({
            sucesso:true,
            seller_id:String(sellerId),
            total_conta:Number(stats.rows[0]?.total||0),
            max_synced_at:stats.rows[0]?.max_synced_at||null,
            itens,
            has_more:itens.length===limit,
            next_cursor:ultimo
              ? {after_ts:ultimo.last_synced,after_id:String(ultimo.id)}
              : {after_ts:afterTs,after_id:rawId}
        });
    }catch(e){
        console.error('[ANUNCIOS DELTA V32]',e);
        respostaErro(res,500,'Erro ao consultar alterações dos anúncios: '+e.message);
    }
});

// Substitui o comportamento "só logar": confirma 200 imediatamente e persiste o evento para worker.
app.post('/api/scale/notifications' ,async(req,res)=>{
    res.status(200).json({recebido:true});
    if(!db)return;
    try{
        const e=req.body||{};
        await dbQuery(`INSERT INTO ml_notifications(external_id,seller_id,topic,resource,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [e._id||e.id||null,e.user_id||null,String(e.topic||''),String(e.resource||''),e]);
    }catch(err){console.error('[NOTIFICATION QUEUE]',err.message)}
});

async function iniciarCoreEscala(){
    try{
        await inicializarBancoEscala();
        if(db && ML_WORKER_ENABLED){
            for(let i=1;i<=ML_WORKER_CONCURRENCY;i++) workerLoop(i);
            console.log(`[ESCALA] ${ML_WORKER_CONCURRENCY} worker(s) iniciado(s).`);
        }
    }catch(e){console.error('[ESCALA INIT]',e)}
}
iniciarCoreEscala();


// V57 — Consulta simplificada das linhas do guia de tamanho.
// O frontend usa esta rota para transformar automaticamente Tamanho -> SIZE_GRID_ROW_ID.
app.get('/api/v57/criar/guia-tamanho/:gridId', async (req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');
    const gridId=String(req.params.gridId||'').trim();
    if(!gridId)return respostaErro(res,400,'Informe o código do guia de tamanho.');
    try{
        const chart=await obterChartV55(token,gridId);
        const rows=extrairRowsChartV55(chart);
        if(!rows.length){
            return respostaErro(res,422,`O guia ${gridId} foi encontrado, mas a API não retornou as linhas de tamanho. Abra o guia no Mercado Livre e confirme que ele possui numerações cadastradas.`);
        }
        const saida=rows.map((row,i)=>{
            const row_id=formatarGridRowIdV55(gridId,row);
            const sizes=valoresRowChartV55(chart,row);
            const label=sizes.join(' · ') || `Linha ${i+1}`;
            return {
                row_id,
                row_number:String(row?.id??row?.row_id??i+1),
                label,
                sizes,
                attributes:Array.isArray(row?.attributes)?row.attributes:[]
            };
        }).filter(x=>x.row_id);
        res.json({sucesso:true,grid_id:String(chart?.id||gridId),main_attribute_id:chart?.main_attribute_id||null,total:saida.length,rows:saida});
    }catch(e){
        respostaErro(res,500,'Erro ao consultar o guia de tamanho: '+e.message);
    }
});

app.listen(
    PORT,
    () => {
        console.log(
            `Servidor rodando na porta ${PORT}`
        );
    }
);
