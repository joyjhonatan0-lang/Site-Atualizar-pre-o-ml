const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;

const FRONTEND_URL =
    "https://site-atualizar-pre-o-ml.onrender.com";

const ML_API =
    "https://api.mercadolibre.com";

const ML_AUTH_URL =
    "https://auth.mercadolivre.com.br/authorization";

const ML_TOKEN_URL =
    "https://api.mercadolibre.com/oauth/token";


/* =========================================================
   MIDDLEWARE
   ========================================================= */

app.use(
    cors({
        origin: FRONTEND_URL,
        credentials: true
    })
);

app.use(
    express.json({
        limit: "2mb"
    })
);


/* =========================================================
   NODE FETCH
   ========================================================= */

let fetchFn;

async function getFetch() {

    if (!fetchFn) {

        if (typeof fetch === "function") {

            fetchFn = fetch;

        } else {

            const modulo =
                await import("node-fetch");

            fetchFn =
                modulo.default;
        }
    }

    return fetchFn;
}


/* =========================================================
   ARMAZENAMENTO
   ========================================================= */

const AUTH_FILE =
    path.join(
        __dirname,
        ".ml-auth.enc"
    );

const KEY_FILE =
    path.join(
        __dirname,
        ".ml-auth.key"
    );


function obterChaveCriptografia() {

    try {

        if (
            fs.existsSync(KEY_FILE)
        ) {

            return Buffer.from(
                fs.readFileSync(
                    KEY_FILE,
                    "utf8"
                ),
                "hex"
            );
        }


        const chave =
            crypto.randomBytes(32);


        fs.writeFileSync(
            KEY_FILE,
            chave.toString("hex"),
            {
                mode: 0o600
            }
        );


        return chave;

    } catch (erro) {

        console.error(
            "Erro criando chave:",
            erro
        );

        throw erro;
    }
}


function salvarAuth(auth) {

    const chave =
        obterChaveCriptografia();


    const iv =
        crypto.randomBytes(12);


    const cipher =
        crypto.createCipheriv(
            "aes-256-gcm",
            chave,
            iv
        );


    const texto =
        JSON.stringify(auth);


    let criptografado =
        cipher.update(
            texto,
            "utf8",
            "base64"
        );


    criptografado +=
        cipher.final("base64");


    const tag =
        cipher.getAuthTag();


    const conteudo =
        JSON.stringify({
            iv: iv.toString("base64"),
            tag: tag.toString("base64"),
            data: criptografado
        });


    fs.writeFileSync(
        AUTH_FILE,
        conteudo,
        {
            mode: 0o600
        }
    );
}


function carregarAuth() {

    try {

        if (
            !fs.existsSync(
                AUTH_FILE
            )
        ) {

            return null;
        }


        const conteudo =
            JSON.parse(
                fs.readFileSync(
                    AUTH_FILE,
                    "utf8"
                )
            );


        const chave =
            obterChaveCriptografia();


        const decipher =
            crypto.createDecipheriv(
                "aes-256-gcm",
                chave,
                Buffer.from(
                    conteudo.iv,
                    "base64"
                )
            );


        decipher.setAuthTag(
            Buffer.from(
                conteudo.tag,
                "base64"
            )
        );


        let texto =
            decipher.update(
                conteudo.data,
                "base64",
                "utf8"
            );


        texto +=
            decipher.final("utf8");


        return JSON.parse(texto);

    } catch (erro) {

        console.error(
            "Não foi possível carregar autenticação:",
            erro
        );

        return null;
    }
}


function apagarAuth() {

    try {

        if (
            fs.existsSync(
                AUTH_FILE
            )
        ) {

            fs.unlinkSync(
                AUTH_FILE
            );
        }

    } catch (erro) {

        console.error(
            "Erro apagando autenticação:",
            erro
        );
    }
}


let authData =
    carregarAuth();


/* =========================================================
   OAUTH PENDENTE
   ========================================================= */

const oauthPendentes =
    new Map();


/* =========================================================
   TOKEN
   ========================================================= */

async function renovarAccessToken() {

    if (!authData) {

        throw new Error(
            "Conta do Mercado Livre não configurada."
        );
    }


    if (
        !authData.client_id ||
        !authData.client_secret ||
        !authData.refresh_token
    ) {

        throw new Error(
            "Refresh token não disponível. Faça a autorização novamente."
        );
    }


    const fetch =
        await getFetch();


    const body =
        new URLSearchParams();


    body.append(
        "grant_type",
        "refresh_token"
    );

    body.append(
        "client_id",
        authData.client_id
    );

    body.append(
        "client_secret",
        authData.client_secret
    );

    body.append(
        "refresh_token",
        authData.refresh_token
    );


    const resposta =
        await fetch(
            ML_TOKEN_URL,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },

                body
            }
        );


    const dados =
        await resposta.json();


    if (!resposta.ok) {

        console.error(
            "Erro renovando token:",
            dados
        );


        if (
            dados.error ===
            "invalid_grant"
        ) {

            authData = null;

            apagarAuth();

            throw new Error(
                "A autorização do Mercado Livre expirou. Conecte novamente."
            );
        }


        throw new Error(
            dados.message ||
            dados.error ||
            "Não foi possível renovar o token."
        );
    }


    authData.access_token =
        dados.access_token;


    if (
        dados.refresh_token
    ) {

        authData.refresh_token =
            dados.refresh_token;
    }


    authData.expires_at =
        Date.now() +
        (
            Number(
                dados.expires_in
            ) * 1000
        );


    salvarAuth(
        authData
    );


    return authData.access_token;
}


async function obterAccessTokenValido() {

    if (!authData) {

        throw new Error(
            "Não autenticado."
        );
    }


    const agora =
        Date.now();


    const validade =
        Number(
            authData.expires_at
        ) || 0;


    const margem =
        5 * 60 * 1000;


    if (
        authData.access_token &&
        validade > agora + margem
    ) {

        return authData.access_token;
    }


    if (
        authData.refresh_token
    ) {

        return await renovarAccessToken();
    }


    if (
        authData.access_token
    ) {

        return authData.access_token;
    }


    throw new Error(
        "Nenhum token disponível."
    );
}


/* =========================================================
   REQUISIÇÃO MERCADO LIVRE
   ========================================================= */

async function mlFetch(
    endpoint,
    options = {}
) {

    const fetch =
        await getFetch();


    const token =
        await obterAccessTokenValido();


    const headers = {
        ...(options.headers || {}),
        Authorization:
            `Bearer ${token}`
    };


    const resposta =
        await fetch(
            ML_API + endpoint,
            {
                ...options,
                headers
            }
        );


    if (
        resposta.status === 401
    ) {

        if (
            authData &&
            authData.refresh_token
        ) {

            const novoToken =
                await renovarAccessToken();


            headers.Authorization =
                `Bearer ${novoToken}`;


            return await fetch(
                ML_API + endpoint,
                {
                    ...options,
                    headers
                }
            );
        }
    }


    return resposta;
}


/* =========================================================
   HOME
   ========================================================= */

app.get(
    "/",
    (req, res) => {

        res.send(
            "Servidor proxy do Mercado Livre online!"
        );
    }
);


/* =========================================================
   STATUS AUTH
   ========================================================= */

app.get(
    "/api/auth/status",
    (req, res) => {

        if (!authData) {

            return res.json({
                autenticado: false
            });
        }


        return res.json({
            autenticado:
                Boolean(
                    authData.access_token ||
                    authData.refresh_token
                ),

            user_id:
                authData.user_id || null
        });
    }
);


/* =========================================================
   INICIAR OAUTH
   ========================================================= */

app.post(
    "/api/auth/start",
    async (req, res) => {

        try {

            const {
                client_id,
                client_secret,
                redirect_uri,
                access_token
            } = req.body;


            if (
                !client_id ||
                !client_secret ||
                !redirect_uri
            ) {

                return res.status(400).json({
                    erro:
                        "Client ID, Client Secret e URL de retorno são obrigatórios."
                });
            }


            /*
             * Se o usuário forneceu somente um Access Token,
             * validamos e salvamos o token.
             *
             * Porém, Access Token sozinho não permite
             * renovação automática.
             */

            if (access_token) {

                const fetch =
                    await getFetch();


                const resposta =
                    await fetch(
                        `${ML_API}/users/me`,
                        {
                            headers: {
                                Authorization:
                                    `Bearer ${access_token}`
                            }
                        }
                    );


                const dados =
                    await resposta.json();


                if (!resposta.ok) {

                    return res.status(401).json({
                        erro:
                            "O Access Token informado não é válido."
                    });
                }


                authData = {

                    client_id,

                    client_secret,

                    redirect_uri,

                    access_token,

                    refresh_token:
                        null,

                    expires_at:
                        Date.now() +
                        5 * 60 * 60 * 1000,

                    user_id:
                        dados.id
                };


                salvarAuth(
                    authData
                );


                return res.json({
                    sucesso: true,
                    autenticado: true,
                    renovacao_automatica: false
                });
            }


            /*
             * OAuth com refresh token.
             */

            const state =
                crypto.randomBytes(32)
                    .toString("hex");


            oauthPendentes.set(
                state,
                {
                    client_id,
                    client_secret,
                    redirect_uri,
                    criado_em: Date.now()
                }
            );


            /*
             * Limpeza automática de estados antigos.
             */

            for (
                const [chave, valor]
                of oauthPendentes
            ) {

                if (
                    Date.now() -
                    valor.criado_em >
                    10 * 60 * 1000
                ) {

                    oauthPendentes.delete(
                        chave
                    );
                }
            }


            const parametros =
                new URLSearchParams({
                    response_type:
                        "code",

                    client_id,

                    redirect_uri,

                    state
                });


            const authUrl =
                `${ML_AUTH_URL}?${parametros.toString()}`;


            return res.json({
                auth_url: authUrl
            });

        } catch (erro) {

            console.error(
                erro
            );

            return res.status(500).json({
                erro:
                    erro.message ||
                    "Erro iniciando OAuth."
            });
        }
    }
);


/* =========================================================
   CALLBACK OAUTH
   ========================================================= */

app.get(
    "/auth/callback",
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
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Erro de autorização</title>
                    </head>

                    <body style="
                        font-family:Arial;
                        padding:40px;
                        background:#f8fafc;
                    ">

                        <h1>Autorização não concluída</h1>

                        <p>
                            ${error_description || error}
                        </p>

                        <a href="${FRONTEND_URL}">
                            Voltar para o ML Hub Pro
                        </a>

                    </body>
                    </html>
                `);
            }


            if (
                !code ||
                !state
            ) {

                return res.status(400).send(
                    "Código ou state ausente."
                );
            }


            const pendente =
                oauthPendentes.get(
                    state
                );


            if (!pendente) {

                return res.status(400).send(
                    "Sessão OAuth inválida ou expirada."
                );
            }


            oauthPendentes.delete(
                state
            );


            const fetch =
                await getFetch();


            const body =
                new URLSearchParams();


            body.append(
                "grant_type",
                "authorization_code"
            );

            body.append(
                "client_id",
                pendente.client_id
            );

            body.append(
                "client_secret",
                pendente.client_secret
            );

            body.append(
                "code",
                code
            );

            body.append(
                "redirect_uri",
                pendente.redirect_uri
            );


            const resposta =
                await fetch(
                    ML_TOKEN_URL,
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/x-www-form-urlencoded"
                        },

                        body
                    }
                );


            const dados =
                await resposta.json();


            if (!resposta.ok) {

                console.error(
                    "Erro trocando code:",
                    dados
                );


                return res.status(400).send(`
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Erro OAuth</title>
                    </head>

                    <body style="
                        font-family:Arial;
                        padding:40px;
                        background:#f8fafc;
                    ">

                        <h1>Erro ao conectar ao Mercado Livre</h1>

                        <p>
                            ${
                                dados.message ||
                                dados.error ||
                                "Não foi possível obter o token."
                            }
                        </p>

                        <a href="${FRONTEND_URL}">
                            Voltar
                        </a>

                    </body>
                    </html>
                `);
            }


            authData = {

                client_id:
                    pendente.client_id,

                client_secret:
                    pendente.client_secret,

                redirect_uri:
                    pendente.redirect_uri,

                access_token:
                    dados.access_token,

                refresh_token:
                    dados.refresh_token,

                expires_at:
                    Date.now() +
                    (
                        Number(
                            dados.expires_in
                        ) * 1000
                    ),

                user_id:
                    dados.user_id || null
            };


            /*
             * Tenta descobrir o usuário caso o
             * retorno OAuth não tenha enviado user_id.
             */

            if (!authData.user_id) {

                try {

                    const respostaUsuario =
                        await fetch(
                            `${ML_API}/users/me`,
                            {
                                headers: {
                                    Authorization:
                                        `Bearer ${authData.access_token}`
                                }
                            }
                        );


                    if (
                        respostaUsuario.ok
                    ) {

                        const usuario =
                            await respostaUsuario.json();


                        authData.user_id =
                            usuario.id;
                    }

                } catch (erroUsuario) {

                    console.error(
                        "Erro buscando usuário:",
                        erroUsuario
                    );
                }
            }


            salvarAuth(
                authData
            );


            return res.redirect(
                `${FRONTEND_URL}?oauth=success`
            );

        } catch (erro) {

            console.error(
                "Erro callback OAuth:",
                erro
            );


            return res.status(500).send(
                "Erro interno ao finalizar a autorização."
            );
        }
    }
);


/* =========================================================
   LOGOUT
   ========================================================= */

app.post(
    "/api/auth/logout",
    (req, res) => {

        authData = null;

        apagarAuth();


        res.json({
            sucesso: true
        });
    }
);


/* =========================================================
   ANÚNCIOS
   ========================================================= */

async function calcularFreteExato(
    itemObj
) {

    try {

        if (
            itemObj &&
            itemObj.shipping &&
            itemObj.shipping.free_shipping
        ) {

            try {

                const resposta =
                    await mlFetch(
                        `/items/${itemObj.id}/sale_fee?quantity=1`
                    );


                if (resposta.ok) {

                    const dados =
                        await resposta.json();


                    if (
                        dados &&
                        dados.shipping_cost
                    ) {

                        return Number(
                            dados.shipping_cost
                        );
                    }
                }

            } catch (erro) {

                console.error(
                    "Erro consultando sale_fee:",
                    erro.message
                );
            }


            if (
                itemObj.shipping.cost != null
            ) {

                return Number(
                    itemObj.shipping.cost
                );
            }


            return 12.95;
        }


        if (
            itemObj &&
            itemObj.shipping &&
            itemObj.shipping.cost != null
        ) {

            return Number(
                itemObj.shipping.cost
            );
        }


        return 6.85;

    } catch (erro) {

        console.error(
            "Erro calculando frete:",
            erro
        );

        return 6.85;
    }
}


app.get(
    "/api/anuncios",
    async (req, res) => {

        try {

            const respostaUsuario =
                await mlFetch(
                    "/users/me"
                );


            if (!respostaUsuario.ok) {

                const erro =
                    await respostaUsuario.text();

                return res.status(
                    respostaUsuario.status
                ).json({
                    erro:
                        erro ||
                        "Não foi possível consultar o usuário."
                });
            }


            const usuario =
                await respostaUsuario.json();


            const userId =
                usuario.id;


            let offset = 0;

            const limit = 50;

            const ids = [];


            while (true) {

                const resposta =
                    await mlFetch(
                        `/users/${userId}/items/search?search_type=scan&limit=${limit}&offset=${offset}`
                    );


                if (!resposta.ok) {

                    throw new Error(
                        "Erro buscando anúncios."
                    );
                }


                const dados =
                    await resposta.json();


                if (
                    Array.isArray(
                        dados.results
                    )
                ) {

                    ids.push(
                        ...dados.results
                    );
                }


                const scrollId =
                    dados.scroll_id;


                if (
                    !scrollId ||
                    !dados.results ||
                    !dados.results.length
                ) {

                    break;
                }


                const proxima =
                    await mlFetch(
                        `/users/${userId}/items/search?search_type=scan&limit=${limit}&scroll_id=${encodeURIComponent(scrollId)}`
                    );


                if (!proxima.ok) {
                    break;
                }


                const proximaDados =
                    await proxima.json();


                if (
                    !Array.isArray(
                        proximaDados.results
                    ) ||
                    !proximaDados.results.length
                ) {

                    break;
                }


                ids.push(
                    ...proximaDados.results
                );


                if (
                    proximaDados.results.length <
                    limit
                ) {

                    break;
                }


                offset += limit;


                if (
                    offset > 10000
                ) {

                    break;
                }
            }


            const idsUnicos =
                [
                    ...new Set(ids)
                ];


            const listaFinal = [];


            for (
                let inicio = 0;
                inicio < idsUnicos.length;
                inicio += 20
            ) {

                const lote =
                    idsUnicos.slice(
                        inicio,
                        inicio + 20
                    );


                const respostas =
                    await Promise.all(
                        lote.map(
                            id =>
                                mlFetch(
                                    `/items/${id}`
                                )
                        )
                    );


                const itens =
                    await Promise.all(
                        respostas.map(
                            async resposta => {

                                if (
                                    !resposta.ok
                                ) {
                                    return null;
                                }

                                return await resposta.json();
                            }
                        )
                    );


                for (
                    const item
                    of itens
                ) {

                    if (!item) {
                        continue;
                    }


                    const preco =
                        Number(
                            item.price
                        ) || 0;


                    let comissao = 0;


                    try {

                        const respostaFee =
                            await mlFetch(
                                `/items/${item.id}/sale_fee?price=${encodeURIComponent(preco)}&quantity=1`
                            );


                        if (
                            respostaFee.ok
                        ) {

                            const fee =
                                await respostaFee.json();


                            comissao =
                                Number(
                                    fee.sale_fee ||
                                    fee.sale_fee_amount ||
                                    fee.total_fee ||
                                    0
                                );
                        }

                    } catch (erroFee) {

                        console.error(
                            "Erro comissão:",
                            erroFee.message
                        );
                    }


                    const frete =
                        await calcularFreteExato(
                            item
                        );


                    const liquido =
                        preco -
                        comissao -
                        frete;


                    let sku = "";


                    if (
                        item.attributes &&
                        Array.isArray(
                            item.attributes
                        )
                    ) {

                        const atributoSku =
                            item.attributes.find(
                                atributo =>
                                    String(
                                        atributo.id || ""
                                    ).toUpperCase() ===
                                    "SELLER_SKU"
                            );


                        if (
                            atributoSku
                        ) {

                            sku =
                                atributoSku.value_name ||
                                atributoSku.value_id ||
                                "";
                        }
                    }


                    if (
                        !sku &&
                        item.seller_custom_field
                    ) {

                        sku =
                            item.seller_custom_field;
                    }


                    listaFinal.push({

                        id:
                            item.id,

                        titulo:
                            item.title,

                        sku,

                        status:
                            item.status,

                        preco,

                        comissao,

                        frete,

                        liquido,

                        shipping:
                            item.shipping || null
                    });
                }
            }


            return res.json({
                itens: listaFinal
            });

        } catch (erro) {

            console.error(
                "Erro /api/anuncios:",
                erro
            );


            return res.status(500).json({
                erro:
                    erro.message ||
                    "Erro ao buscar anúncios."
            });
        }
    }
);


/* =========================================================
   SINCRONIZAR PREÇOS
   ========================================================= */

app.post(
    "/api/sincronizar-precos",
    async (req, res) => {

        try {

            const ids =
                Array.isArray(
                    req.body.ids
                )
                    ? req.body.ids
                    : [];


            const precos = {};


            for (
                let inicio = 0;
                inicio < ids.length;
                inicio += 20
            ) {

                const lote =
                    ids.slice(
                        inicio,
                        inicio + 20
                    );


                const resultados =
                    await Promise.all(
                        lote.map(
                            async id => {

                                try {

                                    const resposta =
                                        await mlFetch(
                                            `/items/${id}`
                                        );


                                    if (
                                        !resposta.ok
                                    ) {

                                        return null;
                                    }


                                    const item =
                                        await resposta.json();


                                    return {
                                        id,
                                        preco:
                                            Number(
                                                item.price
                                            ) || 0
                                    };

                                } catch (erro) {

                                    return null;
                                }
                            }
                        )
                    );


                resultados.forEach(
                    resultado => {

                        if (
                            resultado
                        ) {

                            precos[
                                resultado.id
                            ] =
                                resultado.preco;
                        }
                    }
                );
            }


            return res.json({
                precos
            });

        } catch (erro) {

            console.error(
                erro
            );


            return res.status(500).json({
                erro:
                    erro.message ||
                    "Erro sincronizando preços."
            });
        }
    }
);


/* =========================================================
   SINCRONIZAR FRETES
   ========================================================= */

app.post(
    "/api/sincronizar-fretes",
    async (req, res) => {

        try {

            const ids =
                Array.isArray(
                    req.body.ids
                )
                    ? req.body.ids
                    : [];


            const fretes = {};


            for (
                let inicio = 0;
                inicio < ids.length;
                inicio += 20
            ) {

                const lote =
                    ids.slice(
                        inicio,
                        inicio + 20
                    );


                const resultados =
                    await Promise.all(
                        lote.map(
                            async id => {

                                try {

                                    const resposta =
                                        await mlFetch(
                                            `/items/${id}`
                                        );


                                    if (
                                        !resposta.ok
                                    ) {

                                        return null;
                                    }


                                    const item =
                                        await resposta.json();


                                    const custo =
                                        await calcularFreteExato(
                                            item
                                        );


                                    return {
                                        id,
                                        custo,
                                        shipping_cost:
                                            custo,

                                        gratis:
                                            Boolean(
                                                item.shipping &&
                                                item.shipping.free_shipping
                                            ),

                                        free_shipping:
                                            Boolean(
                                                item.shipping &&
                                                item.shipping.free_shipping
                                            )
                                    };

                                } catch (erro) {

                                    console.error(
                                        erro
                                    );

                                    return null;
                                }
                            }
                        )
                    );


                resultados.forEach(
                    resultado => {

                        if (
                            resultado
                        ) {

                            fretes[
                                resultado.id
                            ] =
                                resultado;
                        }
                    }
                );
            }


            return res.json({
                fretes
            });

        } catch (erro) {

            console.error(
                erro
            );


            return res.status(500).json({
                erro:
                    erro.message ||
                    "Erro sincronizando fretes."
            });
        }
    }
);


/* =========================================================
   ATUALIZAR PREÇO INDIVIDUAL
   ========================================================= */

app.post(
    "/api/atualizar-preco",
    async (req, res) => {

        try {

            const {
                id,
                preco
            } = req.body;


            if (
                !id ||
                !Number.isFinite(
                    Number(preco)
                )
            ) {

                return res.status(400).json({
                    erro:
                        "ID e preço são obrigatórios."
                });
            }


            const resposta =
                await mlFetch(
                    `/items/${id}`,
                    {
                        method: "PUT",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            price:
                                Number(preco)
                        })
                    }
                );


            const dados =
                await resposta.json();


            if (!resposta.ok) {

                return res.status(
                    resposta.status
                ).json({
                    erro:
                        dados.message ||
                        dados.error ||
                        "Erro atualizando preço.",
                    detalhes:
                        dados
                });
            }


            return res.json({
                sucesso: true,
                item: dados
            });

        } catch (erro) {

            console.error(
                erro
            );


            return res.status(500).json({
                erro:
                    erro.message ||
                    "Erro atualizando preço."
            });
        }
    }
);


/* =========================================================
   ATUALIZAR PREÇOS EM MASSA
   ========================================================= */

app.post(
    "/api/atualizar-precos",
    async (req, res) => {

        try {

            const itens =
                Array.isArray(
                    req.body.itens
                )
                    ? req.body.itens
                    : [];


            if (!itens.length) {

                return res.status(400).json({
                    erro:
                        "Nenhum item enviado."
                });
            }


            const resultados =
                await Promise.all(
                    itens.map(
                        async item => {

                            try {

                                const id =
                                    item.id;


                                const preco =
                                    Number(
                                        item.preco
                                    );


                                if (
                                    !id ||
                                    !Number.isFinite(
                                        preco
                                    ) ||
                                    preco <= 0
                                ) {

                                    return {

                                        id,

                                        sucesso:
                                            false,

                                        erro:
                                            "Preço inválido."
                                    };
                                }


                                const resposta =
                                    await mlFetch(
                                        `/items/${id}`,
                                        {
                                            method:
                                                "PUT",

                                            headers: {
                                                "Content-Type":
                                                    "application/json"
                                            },

                                            body:
                                                JSON.stringify({
                                                    price:
                                                        preco
                                                })
                                        }
                                    );


                                const dados =
                                    await resposta.json();


                                if (
                                    !resposta.ok
                                ) {

                                    return {

                                        id,

                                        sucesso:
                                            false,

                                        erro:
                                            dados.message ||
                                            dados.error ||
                                            "Erro na API.",

                                        detalhes:
                                            dados
                                    };
                                }


                                return {

                                    id,

                                    sucesso:
                                        true,

                                    preco,

                                    item:
                                        dados
                                };

                            } catch (erro) {

                                return {

                                    id:
                                        item.id,

                                    sucesso:
                                        false,

                                    erro:
                                        erro.message
                                };
                            }
                        }
                    )
                );


            return res.json({
                resultados
            });

        } catch (erro) {

            console.error(
                erro
            );


            return res.status(500).json({
                erro:
                    erro.message ||
                    "Erro atualizando preços."
            });
        }
    }
);


/* =========================================================
   INICIAR SERVIDOR
   ========================================================= */

app.listen(
    PORT,
    () => {

        console.log(
            `Servidor ML Hub Pro rodando na porta ${PORT}`
        );

    }
);
