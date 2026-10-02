'use strict';

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

/* =========================================================
   CONFIGURAÇÃO
========================================================= */

const PORT = process.env.PORT || 10000;

const ML_API = 'https://api.mercadolibre.com';
const ML_AUTH = 'https://auth.mercadolivre.com.br';
const ML_SITE = 'MLB';

const FRONTEND_URL =
    process.env.FRONTEND_URL ||
    'https://joyjhonatan0-lang.github.io/Site-Atualizar-preco-ml/';

const ML_CLIENT_ID =
    process.env.ML_CLIENT_ID || '';

const ML_CLIENT_SECRET =
    process.env.ML_CLIENT_SECRET || '';

const ML_REDIRECT_URI =
    process.env.ML_REDIRECT_URI ||
    'https://site-atualizar-pre-o-ml.onrender.com/oauth/callback';

/*
 * Sessões em memória.
 *
 * O Access Token e Refresh Token ficam no servidor.
 * Não ficam no localStorage do navegador.
 */
const sessions = new Map();

/*
 * Estados temporários do OAuth.
 */
const oauthStates = new Map();


/* =========================================================
   MIDDLEWARE
========================================================= */

app.use(
    cors({
        origin: FRONTEND_URL.replace(/\/$/, ''),
        credentials: true,
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
    })
);

app.use(
    express.json({
        limit: '10mb'
    })
);

app.use(
    express.urlencoded({
        extended: true
    })
);


/* =========================================================
   FUNÇÕES AUXILIARES
========================================================= */

function money(value) {

    const n = Number(value);

    if (!Number.isFinite(n)) {
        return 0;
    }

    return Number(
        n.toFixed(2)
    );
}


function safeNumber(value) {

    const n = Number(value);

    if (!Number.isFinite(n)) {
        return 0;
    }

    return n;
}


function chunks(array, size) {

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


function getErrorMessage(
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


function escapeHtml(value) {

    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll(
            "'",
            '&#039;'
        );
}


/* =========================================================
   AUTHORIZATION HEADER
========================================================= */

function getAuthorizationToken(req) {

    const authorization =
        req.headers.authorization || '';

    if (!authorization) {
        return null;
    }

    let token =
        String(
            authorization
        ).trim();

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

    return token || null;
}


/* =========================================================
   COOKIE
========================================================= */

function getCookie(
    req,
    name
) {

    const header =
        req.headers.cookie || '';

    if (!header) {
        return null;
    }

    const cookies =
        header.split(';');

    for (
        const cookie
        of cookies
    ) {

        const index =
            cookie.indexOf('=');

        if (index === -1) {
            continue;
        }

        const key =
            cookie
                .substring(
                    0,
                    index
                )
                .trim();

        const value =
            cookie
                .substring(
                    index + 1
                )
                .trim();

        if (
            key === name
        ) {

            return decodeURIComponent(
                value
            );
        }
    }

    return null;
}


function setSessionCookie(
    res,
    sessionId
) {

    res.setHeader(
        'Set-Cookie',
        [
            `ml_session=${encodeURIComponent(sessionId)}`,
            'Path=/',
            'HttpOnly',
            'Secure',
            'SameSite=None',
            'Max-Age=2592000'
        ].join('; ')
    );
}


function clearSessionCookie(res) {

    res.setHeader(
        'Set-Cookie',
        [
            'ml_session=',
            'Path=/',
            'HttpOnly',
            'Secure',
            'SameSite=None',
            'Max-Age=0'
        ].join('; ')
    );
}


/* =========================================================
   MERCADO LIVRE API
========================================================= */

async function mlFetch(
    path,
    token,
    options = {}
) {

    const headers = {
        'Accept':
            'application/json',

        'Authorization':
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


/* =========================================================
   OAUTH CONFIG
========================================================= */

function oauthConfigured() {

    return Boolean(
        ML_CLIENT_ID &&
        ML_CLIENT_SECRET &&
        ML_REDIRECT_URI
    );
}


/* =========================================================
   TROCA CODE POR TOKEN
========================================================= */

async function exchangeCodeForToken(
    code
) {

    const body =
        new URLSearchParams();

    body.set(
        'grant_type',
        'authorization_code'
    );

    body.set(
        'client_id',
        ML_CLIENT_ID
    );

    body.set(
        'client_secret',
        ML_CLIENT_SECRET
    );

    body.set(
        'code',
        code
    );

    body.set(
        'redirect_uri',
        ML_REDIRECT_URI
    );

    const response =
        await fetch(
            `${ML_API}/oauth/token`,
            {
                method: 'POST',

                headers: {
                    'Accept':
                        'application/json',

                    'Content-Type':
                        'application/x-www-form-urlencoded'
                },

                body:
                    body.toString()
            }
        );

    let data = null;

    try {

        data =
            await response.json();

    } catch {

        data = null;
    }

    if (!response.ok) {

        throw new Error(
            data?.message ||
            data?.error_description ||
            data?.error ||
            `Erro OAuth HTTP ${response.status}`
        );
    }

    return data;
}


/* =========================================================
   RENOVA TOKEN
========================================================= */

async function refreshAccessToken(
    refreshToken
) {

    const body =
        new URLSearchParams();

    body.set(
        'grant_type',
        'refresh_token'
    );

    body.set(
        'client_id',
        ML_CLIENT_ID
    );

    body.set(
        'client_secret',
        ML_CLIENT_SECRET
    );

    body.set(
        'refresh_token',
        refreshToken
    );

    const response =
        await fetch(
            `${ML_API}/oauth/token`,
            {
                method: 'POST',

                headers: {
                    'Accept':
                        'application/json',

                    'Content-Type':
                        'application/x-www-form-urlencoded'
                },

                body:
                    body.toString()
            }
        );

    let data = null;

    try {

        data =
            await response.json();

    } catch {

        data = null;
    }

    if (!response.ok) {

        throw new Error(
            data?.message ||
            data?.error_description ||
            data?.error ||
            `Erro ao renovar token HTTP ${response.status}`
        );
    }

    return data;
}


/* =========================================================
   CRIAR SESSÃO
========================================================= */

function createSession(
    tokens
) {

    const sessionId =
        crypto
            .randomBytes(32)
            .toString('hex');

    const expiresIn =
        Number(
            tokens.expires_in ||
            21600
        );

    sessions.set(
        sessionId,
        {

            accessToken:
                tokens.access_token,

            refreshToken:
                tokens.refresh_token ||
                null,

            expiresAt:
                Date.now() +
                expiresIn * 1000,

            userId:
                tokens.user_id ||
                null,

            scope:
                tokens.scope ||
                ''
        }
    );

    return sessionId;
}


/* =========================================================
   OBTER TOKEN DA SESSÃO
========================================================= */

async function getSessionToken(
    req,
    res
) {

    /*
     * Primeiro permite Authorization manual.
     * Útil para testes.
     */
    const manualToken =
        getAuthorizationToken(req);

    if (manualToken) {

        return {
            token:
                manualToken,

            sessionId:
                null
        };
    }

    /*
     * Depois tenta sessão OAuth.
     */
    const sessionId =
        getCookie(
            req,
            'ml_session'
        );

    if (!sessionId) {
        return null;
    }

    const session =
        sessions.get(
            sessionId
        );

    if (!session) {
        return null;
    }

    /*
     * Renova com 2 minutos de antecedência.
     */
    const margem =
        2 * 60 * 1000;

    if (
        Date.now() <
        session.expiresAt - margem
    ) {

        return {

            token:
                session.accessToken,

            sessionId
        };
    }

    /*
     * Não possui refresh token.
     */
    if (
        !session.refreshToken
    ) {

        return {

            token:
                session.accessToken,

            sessionId
        };
    }

    try {

        const refreshed =
            await refreshAccessToken(
                session.refreshToken
            );

        session.accessToken =
            refreshed.access_token;

        /*
         * O Mercado Livre pode devolver
         * um novo refresh token.
         */
        if (
            refreshed.refresh_token
        ) {

            session.refreshToken =
                refreshed.refresh_token;
        }

        session.expiresAt =
            Date.now() +
            Number(
                refreshed.expires_in ||
                21600
            ) * 1000;

        if (
            refreshed.user_id
        ) {

            session.userId =
                refreshed.user_id;
        }

        if (
            refreshed.scope
        ) {

            session.scope =
                refreshed.scope;
        }

        return {

            token:
                session.accessToken,

            sessionId
        };

    } catch (error) {

        console.error(
            'Erro renovando token:',
            error.message
        );

        sessions.delete(
            sessionId
        );

        clearSessionCookie(
            res
        );

        return null;
    }
}


/* =========================================================
   REQUIRE TOKEN
========================================================= */

async function requireToken(
    req,
    res
) {

    const result =
        await getSessionToken(
            req,
            res
        );

    if (
        !result?.token
    ) {

        res.status(401).json({

            erro:
                'Conta do Mercado Livre não conectada ou sessão expirada.',

            codigo:
                'AUTH_REQUIRED'
        });

        return null;
    }

    return result.token;
}


/* =========================================================
   ROTA PRINCIPAL
========================================================= */

app.get(
    '/',
    (req, res) => {

        res.json({

            ok: true,

            message:
                'ML Hub Pro API online',

            version:
                '4.0.0',

            oauth:
                oauthConfigured(),

            timestamp:
                new Date()
                    .toISOString()
        });
    }
);


/* =========================================================
   HEALTH
========================================================= */

app.get(
    '/health',
    (req, res) => {

        res.json({

            ok: true,

            status:
                'online',

            service:
                'ML Hub Pro',

            timestamp:
                new Date()
                    .toISOString()
        });
    }
);


/* =========================================================
   OAUTH AUTHORIZE
========================================================= */

app.get(
    '/oauth/authorize',
    (req, res) => {

        if (
            !oauthConfigured()
        ) {

            return res.status(500).send(`
                <h2>OAuth não configurado</h2>
                <p>Configure ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI no Render.</p>
            `);
        }

        const state =
            crypto
                .randomBytes(32)
                .toString('hex');

        oauthStates.set(
            state,
            {
                createdAt:
                    Date.now()
            }
        );

        /*
         * Remove states antigos.
         */
        for (
            const [
                key,
                value
            ]
            of oauthStates
        ) {

            if (
                Date.now() -
                value.createdAt >
                10 * 60 * 1000
            ) {

                oauthStates.delete(
                    key
                );
            }
        }

        const params =
            new URLSearchParams();

        params.set(
            'response_type',
            'code'
        );

        params.set(
            'client_id',
            ML_CLIENT_ID
        );

        params.set(
            'redirect_uri',
            ML_REDIRECT_URI
        );

        params.set(
            'state',
            state
        );

        const authorizationUrl =
            `${ML_AUTH}/authorization?${params.toString()}`;

        return res.redirect(
            authorizationUrl
        );
    }
);


/* =========================================================
   OAUTH CALLBACK
========================================================= */

app.get(
    '/oauth/callback',
    async (req, res) => {

        try {

            const {
                code,
                state,
                error,
                error_description
            } = req.query;

            if (error) {

                return res.status(400).send(`
                    <h2>Mercado Livre não autorizou a conta</h2>

                    <p>${escapeHtml(
                        error_description ||
                        error
                    )}</p>

                    <p>
                        <a href="${escapeHtml(
                            FRONTEND_URL
                        )}">
                            Voltar para o ML Hub Pro
                        </a>
                    </p>
                `);
            }

            if (!code) {

                return res.status(400).send(`
                    <h2>Erro de autorização</h2>
                    <p>O Mercado Livre não enviou o código.</p>
                `);
            }

            if (!state) {

                return res.status(400).send(`
                    <h2>Erro de segurança</h2>
                    <p>State não informado.</p>
                `);
            }

            const savedState =
                oauthStates.get(
                    String(state)
                );

            if (!savedState) {

                return res.status(400).send(`
                    <h2>Erro de segurança</h2>
                    <p>State inválido ou expirado.</p>
                `);
            }

            /*
             * State é de uso único.
             */
            oauthStates.delete(
                String(state)
            );

            /*
             * Expira em 10 minutos.
             */
            if (
                Date.now() -
                savedState.createdAt >
                10 * 60 * 1000
            ) {

                return res.status(400).send(`
                    <h2>Autorização expirada</h2>
                    <p>Clique novamente em conectar conta.</p>
                `);
            }

            /*
             * Troca CODE pelo token.
             */
            const tokens =
                await exchangeCodeForToken(
                    String(code)
                );

            if (
                !tokens?.access_token
            ) {

                throw new Error(
                    'Mercado Livre não retornou access_token.'
                );
            }

            /*
             * Cria sessão.
             */
            const sessionId =
                createSession(
                    tokens
                );

            /*
             * Cookie seguro.
             */
            setSessionCookie(
                res,
                sessionId
            );

            /*
             * Volta para o GitHub Pages.
             */
            const redirect =
                new URL(
                    FRONTEND_URL
                );

            redirect.searchParams.set(
                'connected',
                '1'
            );

            return res.redirect(
                redirect.toString()
            );

        } catch (error) {

            console.error(
                'Erro OAuth callback:',
                error
            );

            return res.status(500).send(`
                <h2>Erro ao conectar Mercado Livre</h2>

                <p>${escapeHtml(
                    error.message ||
                    'Erro desconhecido.'
                )}</p>

                <p>
                    <a href="${escapeHtml(
                        FRONTEND_URL
                    )}">
                        Voltar
                    </a>
                </p>
            `);
        }
    }
);


/* =========================================================
   STATUS DA CONTA
========================================================= */

app.get(
    '/api/auth/status',
    async (req, res) => {

        const token =
            await requireToken(
                req,
                res
            );

        if (!token) {
            return;
        }

        try {

            const result =
                await mlFetch(
                    '/users/me',
                    token
                );

            if (
                !result.response.ok
            ) {

                return res.status(
                    result.response.status
                ).json({

                    conectado:
                        false,

                    erro:
                        getErrorMessage(
                            result,
                            'Sessão inválida.'
                        )
                });
            }

            return res.json({

                conectado:
                    true,

                usuario:
                    result.data?.nickname ||
                    result.data?.first_name ||
                    null,

                user_id:
                    result.data?.id ||
                    null
            });

        } catch (error) {

            return res.status(500).json({

                conectado:
                    false,

                erro:
                    error.message
            });
        }
    }
);


/* =========================================================
   LOGOUT
========================================================= */

app.post(
    '/oauth/logout',
    (req, res) => {

        const sessionId =
            getCookie(
                req,
                'ml_session'
            );

        if (
            sessionId
        ) {

            sessions.delete(
                sessionId
            );
        }

        clearSessionCookie(
            res
        );

        return res.json({
            ok: true
        });
    }
);


/* =========================================================
   API ME
========================================================= */

app.get(
    '/api/me',
    async (req, res) => {

        const token =
            await requireToken(
                req,
                res
            );

        if (!token) return;

        try {

            const result =
                await mlFetch(
                    '/users/me',
                    token
                );

            if (
                !result.response.ok
            ) {

                return res.status(
                    result.response.status
                ).json({

                    erro:
                        getErrorMessage(
                            result,
                            'Erro ao consultar usuário.'
                        )
                });
            }

            return res.json(
                result.data
            );

        } catch (error) {

            return res.status(500).json({

                erro:
                    error.message
            });
        }
    }
);


/* =========================================================
   BUSCAR IDS DOS ANÚNCIOS
========================================================= */

async function buscarIdsAnuncios(
    sellerId,
    token
) {

    const ids = [];

    let offset = 0;

    const limit = 100;

    while (true) {

        const params =
            new URLSearchParams();

        params.set(
            'status',
            'active'
        );

        params.set(
            'limit',
            String(limit)
        );

        params.set(
            'offset',
            String(offset)
        );

        const result =
            await mlFetch(
                `/users/${sellerId}/items/search?${params.toString()}`,
                token
            );

        if (
            !result.response.ok
        ) {

            const error =
                new Error(
                    getErrorMessage(
                        result,
                        'Erro ao buscar anúncios.'
                    )
                );

            error.status =
                result.response.status;

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
                result.data?.paging?.total ||
                0
            );

        offset +=
            results.length;

        if (
            results.length === 0 ||
            results.length < limit ||
            (
                total > 0 &&
                offset >= total
            ) ||
            offset >= 1000
        ) {

            break;
        }
    }

    return ids;
}


/* =========================================================
   BUSCAR ITENS
========================================================= */

async function buscarItens(
    ids,
    token
) {

    if (
        !ids.length
    ) {

        return [];
    }

    const resultado = [];

    const lotes =
        chunks(
            ids,
            20
        );

    for (
        const lote
        of lotes
    ) {

        const params =
            new URLSearchParams();

        params.set(
            'ids',
            lote.join(',')
        );

        /*
         * Primeiro endpoint atual.
         */
        let result =
            await mlFetch(
                `/items/bulk?${params.toString()}`,
                token
            );

        /*
         * Fallback.
         */
        if (
            !result.response.ok
        ) {

            result =
                await mlFetch(
                    `/items?${params.toString()}`,
                    token
                );
        }

        if (
            !result.response.ok
        ) {

            const error =
                new Error(
                    getErrorMessage(
                        result,
                        'Erro ao consultar anúncios.'
                    )
                );

            error.status =
                result.response.status;

            throw error;
        }

        if (
            !Array.isArray(
                result.data
            )
        ) {

            continue;
        }

        for (
            const item
            of result.data
        ) {

            if (
                item?.body
            ) {

                resultado.push(
                    item.body
                );

            } else if (
                item?.id
            ) {

                resultado.push(
                    item
                );
            }
        }
    }

    return resultado;
}


/* =========================================================
   BUSCAR COMISSÃO
========================================================= */

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
                safeNumber(
                    item.price
                )
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

        const lista =
            Array.isArray(
                result.data
            )
                ? result.data
                : [];

        const selecionado =
            lista.find(
                itemPrice =>
                    itemPrice?.listing_type_id ===
                    item.listing_type_id
            ) ||
            lista[0];

        return {

            saleFee:
                safeNumber(
                    selecionado?.sale_fee_amount
                ),

            listingFee:
                safeNumber(
                    selecionado?.listing_fee_amount
                )
        };

    } catch {

        return {
            saleFee: 0,
            listingFee: 0
        };
    }
}


/* =========================================================
   API ANÚNCIOS
========================================================= */

app.get(
    '/api/anuncios',
    async (req, res) => {

        const token =
            await requireToken(
                req,
                res
            );

        if (!token) return;

        try {

            const user =
                await mlFetch(
                    '/users/me',
                    token
                );

            if (
                !user.response.ok ||
                !user.data?.id
            ) {

                return res.status(401).json({

                    erro:
                        'Token inválido ou expirado.'
                });
            }

            const sellerId =
                user.data.id;

            const ids =
                await buscarIdsAnuncios(
                    sellerId,
                    token
                );

            const itens =
                await buscarItens(
                    ids,
                    token
                );

            const resposta = [];

            for (
                const item
                of itens
            ) {

                const price =
                    safeNumber(
                        item.price
                    );

                const shipping =
                    item.shipping ||
                    {};

                const shippingCost =
                    safeNumber(
                        shipping.cost
                    );

                const freeShipping =
                    Boolean(
                        shipping.free_shipping
                    );

                const comissao =
                    await buscarComissao(
                        item,
                        token
                    );

                const saleFee =
                    comissao.saleFee;

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
                        money(
                            price
                        ),

                    sale_fee:
                        money(
                            saleFee
                        ),

                    shipping_cost:
                        money(
                            shippingCost
                        ),

                    net_received:
                        money(
                            netReceived
                        ),

                    available_quantity:
                        safeNumber(
                            item.available_quantity
                        ),

                    status:
                        item.status ||
                        null,

                    listing_type_id:
                        item.listing_type_id ||
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

                ok:
                    true,

                total:
                    resposta.length,

                itens:
                    resposta,

                ultima_atualizacao:
                    new Date()
                        .toISOString()
            });

        } catch (error) {

            console.error(
                'Erro /api/anuncios:',
                error
            );

            return res.status(
                error.status || 500
            ).json({

                erro:
                    error.message ||
                    'Erro ao carregar anúncios.'
            });
        }
    }
);


/* =========================================================
   SINCRONIZAR PREÇOS
========================================================= */

app.post(
    '/api/sincronizar-precos',
    async (req, res) => {

        const token =
            await requireToken(
                req,
                res
            );

        if (!token) return;

        try {

            const solicitados =
                req.body?.precos ||
                {};

            const ids =
                Object.keys(
                    solicitados
                );

            if (
                !ids.length
            ) {

                return res.json({

                    ok:
                        true,

                    precos:
                        {}
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

                if (
                    item?.id
                ) {

                    precos[
                        String(item.id)
                    ] =
                        money(
                            item.price
                        );
                }
            }

            return res.json({

                ok:
                    true,

                precos
            });

        } catch (error) {

            console.error(
                'Erro preços:',
                error
            );

            return res.status(
                error.status || 500
            ).json({

                erro:
                    error.message ||
                    'Erro ao sincronizar preços.'
            });
        }
    }
);


/* =========================================================
   SINCRONIZAR FRETES
========================================================= */

app.post(
    '/api/sincronizar-fretes',
    async (req, res) => {

        const token =
            await requireToken(
                req,
                res
            );

        if (!token) return;

        try {

            const solicitados =
                req.body?.fretes ||
                {};

            const ids =
                Object.keys(
                    solicitados
                );

            if (
                !ids.length
            ) {

                return res.json({

                    ok:
                        true,

                    fretes:
                        {}
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

                if (
                    !item?.id
                ) {
                    continue;
                }

                const shipping =
                    item.shipping ||
                    {};

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

                ok:
                    true,

                fretes
            });

        } catch (error) {

            console.error(
                'Erro fretes:',
                error
            );

            return res.status(
                error.status || 500
            ).json({

                erro:
                    error.message ||
                    'Erro ao sincronizar fretes.'
            });
        }
    }
);


/* =========================================================
   ATUALIZAR PREÇOS
========================================================= */

app.post(
    '/api/atualizar-precos',
    async (req, res) => {

        const token =
            await requireToken(
                req,
                res
            );

        if (!token) return;

        try {

            const itens =
                Array.isArray(
                    req.body?.itens
                )
                    ? req.body.itens
                    : [];

            if (
                !itens.length
            ) {

                return res.status(400).json({

                    erro:
                        'Nenhum item informado para atualização.'
                });
            }

            const resultados = [];

            for (
                const item
                of itens
            ) {

                const id =
                    String(
                        item?.id ||
                        ''
                    ).trim();

                const price =
                    safeNumber(
                        item?.price
                    );

                if (
                    !id
                ) {

                    resultados.push({

                        id:
                            null,

                        ok:
                            false,

                        erro:
                            'ID do anúncio não informado.'
                    });

                    continue;
                }

                if (
                    price <= 0
                ) {

                    resultados.push({

                        id,

                        ok:
                            false,

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

                                method:
                                    'PUT',

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

                            ok:
                                false,

                            erro:
                                getErrorMessage(
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

                        ok:
                            true,

                        price:
                            money(
                                result.data?.price ??
                                price
                            )
                    });

                } catch (error) {

                    resultados.push({

                        id,

                        ok:
                            false,

                        erro:
                            error.message
                    });
                }
            }

            const sucesso =
                resultados.filter(
                    item =>
                        item.ok
                ).length;

            const falhas =
                resultados.length -
                sucesso;

            if (
                sucesso === 0
            ) {

                return res.status(400).json({

                    ok:
                        false,

                    sucesso:
                        0,

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

        } catch (error) {

            console.error(
                'Erro atualização:',
                error
            );

            return res.status(500).json({

                erro:
                    'Erro ao atualizar preços: ' +
                    error.message
            });
        }
    }
);


/* =========================================================
   DASHBOARD
========================================================= */

app.get(
    '/api/dashboard',
    async (req, res) => {

        const token =
            await requireToken(
                req,
                res
            );

        if (!token) return;

        try {

            const user =
                await mlFetch(
                    '/users/me',
                    token
                );

            if (
                !user.response.ok ||
                !user.data?.id
            ) {

                return res.status(401).json({

                    erro:
                        'Token inválido ou expirado.'
                });
            }

            const sellerId =
                user.data.id;

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

            const ordersMap =
                new Map();

            let cursor =
                new Date(
                    inicio
                );

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

                        return res.status(
                            result.response.status
                        ).json({

                            erro:
                                getErrorMessage(
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
                                String(
                                    order.id
                                ),
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

            const orders =
                Array.from(
                    ordersMap.values()
                );

            let faturamento = 0;

            let unidades = 0;

            const produtos =
                new Map();

            const dias =
                new Map();

            for (
                const order
                of orders
            ) {

                faturamento +=
                    safeNumber(
                        order.total_amount ??
                        order.paid_amount ??
                        0
                    );

                const data =
                    order.date_created
                        ? new Date(
                            order.date_created
                        )
                        : null;

                if (
                    data &&
                    !Number.isNaN(
                        data.getTime()
                    )
                ) {

                    const dia =
                        data
                            .toISOString()
                            .slice(
                                0,
                                10
                            );

                    dias.set(
                        dia,
                        (
                            dias.get(dia) ||
                            0
                        ) + 1
                    );
                }

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
                        safeNumber(
                            orderItem.quantity ||
                            1
                        );

                    const preco =
                        safeNumber(
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

                                sales:
                                    0,

                                revenue:
                                    0,

                                orders:
                                    0
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
                .slice(
                    0,
                    10
                )
                .map(
                    item => ({

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
                            item.orders
                    })
                );

            const series = [];

            for (
                let i = 59;
                i >= 0;
                i--
            ) {

                const date =
                    new Date(
                        agora.getTime() -
                        i *
                        24 *
                        60 *
                        60 *
                        1000
                    );

                const day =
                    date
                        .toISOString()
                        .slice(
                            0,
                            10
                        );

                series.push({

                    date:
                        day,

                    value:
                        dias.get(day) ||
                        0
                });
            }

            const pedidos =
                orders.length;

            const ticket =
                pedidos > 0
                    ? faturamento /
                      pedidos
                    : 0;

            return res.json({

                ok:
                    true,

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

        } catch (error) {

            console.error(
                'Erro dashboard:',
                error
            );

            return res.status(500).json({

                erro:
                    'Erro ao montar dashboard: ' +
                    error.message
            });
        }
    }
);


/* =========================================================
   404
========================================================= */

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


/* =========================================================
   ERRO GLOBAL
========================================================= */

app.use(
    (
        error,
        req,
        res,
        next
    ) => {

        console.error(
            'Erro global:',
            error
        );

        if (
            res.headersSent
        ) {

            return next(error);
        }

        return res.status(500).json({

            erro:
                error.message ||
                'Erro interno do servidor.'
        });
    }
);


/* =========================================================
   START
========================================================= */

app.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log(
            '========================================'
        );

        console.log(
            'ML HUB PRO API ONLINE'
        );

        console.log(
            `PORTA: ${PORT}`
        );

        console.log(
            `FRONTEND: ${FRONTEND_URL}`
        );

        console.log(
            `REDIRECT: ${ML_REDIRECT_URI}`
        );

        console.log(
            `OAUTH CONFIGURADO: ${oauthConfigured()}`
        );

        console.log(
            '========================================'
        );
    }
);
