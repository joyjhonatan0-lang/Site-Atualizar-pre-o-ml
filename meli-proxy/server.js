const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT =
    process.env.PORT || 3000;


/* =========================================================
   CONFIGURAÇÃO
   ========================================================= */

const SITE_URL =
    process.env.SITE_URL ||
    "https://site-atualizar-pre-o-ml.onrender.com";


const MERCADO_LIVRE_API =
    "https://api.mercadolibre.com";


const MERCADO_LIVRE_AUTH =
    "https://auth.mercadolivre.com.br/authorization";


const MERCADO_LIVRE_TOKEN =
    "https://api.mercadolibre.com/oauth/token";


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


const INDEX_FILE =
    path.join(
        __dirname,
        "index.html"
    );


/* =========================================================
   MIDDLEWARE
   ========================================================= */

app.use(
    express.json({
        limit: "2mb"
    })
);


app.use(
    express.urlencoded({
        extended: true
    })
);


/*
 * O próprio Render vai servir o index.html.
 * Isso evita o problema de CORS quando o frontend
 * e a API estão em endereços diferentes.
 */

app.use(
    express.static(
        __dirname
    )
);


/*
 * CORS fica habilitado também para o domínio do projeto.
 */

app.use(
    cors({
        origin: [
            SITE_URL,
            "https://www.mercadolivre.com.br"
        ],

        credentials: true
    })
);


/* =========================================================
   FETCH
   ========================================================= */

let fetchFunction = null;


async function getFetch() {

    if (fetchFunction) {

        return fetchFunction;
    }


    if (
        typeof fetch ===
        "function"
    ) {

        fetchFunction =
            fetch;

        return fetchFunction;
    }


    const modulo =
        await import(
            "node-fetch"
        );


    fetchFunction =
        modulo.default;


    return fetchFunction;
}


/* =========================================================
   CRIPTOGRAFIA
   ========================================================= */

function obterChaveCriptografia() {

    if (
        process.env.AUTH_ENCRYPTION_KEY
    ) {

        const chave =
            Buffer.from(
                process.env.AUTH_ENCRYPTION_KEY,
                "hex"
            );


        if (
            chave.length === 32
        ) {

            return chave;
        }
    }


    if (
        fs.existsSync(
            KEY_FILE
        )
    ) {

        const chave =
            Buffer.from(
                fs.readFileSync(
                    KEY_FILE,
                    "utf8"
                ).trim(),
                "hex"
            );


        if (
            chave.length === 32
        ) {

            return chave;
        }
    }


    const chave =
        crypto.randomBytes(32);


    try {

        fs.writeFileSync(
            KEY_FILE,
            chave.toString("hex"),
            {
                mode: 0o600
            }
        );

    } catch (erro) {

        console.error(
            "Não foi possível salvar a chave:",
            erro.message
        );
    }


    return chave;
}


function salvarAuth(
    dados
) {

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
        JSON.stringify(
            dados
        );


    let encrypted =
        cipher.update(
            texto,
            "utf8",
            "base64"
        );


    encrypted +=
        cipher.final(
            "base64"
        );


    const tag =
        cipher.getAuthTag();


    const arquivo =
        JSON.stringify({
            iv:
                iv.toString("base64"),

            tag:
                tag.toString("base64"),

            data:
                encrypted
        });


    fs.writeFileSync(
        AUTH_FILE,
        arquivo,
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


        const arquivo =
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
                    arquivo.iv,
                    "base64"
                )
            );


        decipher.setAuthTag(
            Buffer.from(
                arquivo.tag,
                "base64"
            )
        );


        let texto =
            decipher.update(
                arquivo.data,
                "base64",
                "utf8"
            );


        texto +=
            decipher.final(
                "utf8"
            );


        return JSON.parse(
            texto
        );

    } catch (erro) {

        console.error(
            "Erro lendo autenticação:",
            erro.message
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
            erro.message
        );
    }
}


let authData =
    carregarAuth();


/* =========================================================
   OAUTH PENDENTE
   ========================================================= */

const oauthStates =
    new Map();


/* =========================================================
   LIMPAR STATES
   ========================================================= */

function limparOAuthStates() {

    const agora =
        Date.now();


    for (
        const [
            state,
            dados
        ]
        of oauthStates
    ) {

        if (
            agora -
            dados.criado_em >
            10 * 60 * 1000
        ) {

            oauthStates.delete(
                state
            );
        }
    }
}


/* =========================================================
   HOME
   ========================================================= */

app.get(
    "/",
    (req, res) => {

        res.sendFile(
            INDEX_FILE
        );
    }
);


/* =========================================================
   STATUS
   ========================================================= */

app.get(
    "/api/auth/status",
    (req, res) => {

        if (
            !authData
        ) {

            return res.json({
                autenticado:
                    false
            });
        }


        return res.json({

            autenticado:
                Boolean(
                    authData.access_token ||
                    authData.refresh_token
                ),

            user_id:
                authData.user_id ||
                null,

            renovacao_automatica:
                Boolean(
                    authData.refresh_token
                )

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

            limparOAuthStates();


            const clientId =
                String(
                    req.body.client_id ||
                    ""
                ).trim();


            const clientSecret =
                String(
                    req.body.client_secret ||
                    ""
                ).trim();


            const redirectUri =
                String(
                    req.body.redirect_uri ||
                    ""
                ).trim();


            const accessToken =
                String(
                    req.body.access_token ||
                    ""
                ).trim();


            if (
                !clientId ||
                !clientSecret ||
                !redirectUri
            ) {

                return res.status(
                    400
                ).json({

                    erro:
                        "Client ID, Client Secret e URL de retorno são obrigatórios."

                });
            }


            /*
             * A URL usada pelo OAuth precisa ser
             * exatamente a mesma cadastrada no ML.
             */

            try {

                const url =
                    new URL(
                        redirectUri
                    );


                if (
                    url.protocol !==
                    "https:"
                ) {

                    return res.status(
                        400
                    ).json({

                        erro:
                            "A URL de retorno precisa utilizar HTTPS."

                    });
                }

            } catch (erroUrl) {

                return res.status(
                    400
                ).json({

                    erro:
                        "A URL de retorno informada é inválida."

                });
            }


            /*
             * Modo manual:
             *
             * Mantido apenas como compatibilidade.
             * Access Token sozinho não fornece refresh token.
             */

            if (
                accessToken
            ) {

                const fetch =
                    await getFetch();


                const resposta =
                    await fetch(
                        `${MERCADO_LIVRE_API}/users/me`,
                        {
                            headers: {
                                Authorization:
                                    `Bearer ${accessToken}`
                            }
                        }
                    );


                const dados =
                    await resposta.json();


                if (
                    !resposta.ok
                ) {

                    return res.status(
                        401
                    ).json({

                        erro:
                            dados.message ||
                            "Access Token inválido."

                    });
                }


                authData = {

                    client_id:
                        clientId,

                    client_secret:
                        clientSecret,

                    redirect_uri:
                        redirectUri,

                    access_token:
                        accessToken,

                    refresh_token:
                        null,

                    expires_at:
                        Date.now() +
                        (
                            5 *
                            60 *
                            60 *
                            1000
                        ),

                    user_id:
                        dados.id ||
                        null

                };


                salvarAuth(
                    authData
                );


                return res.json({

                    sucesso:
                        true,

                    autenticado:
                        true,

                    renovacao_automatica:
                        false

                });
            }


            /*
             * OAuth normal.
             */

            const state =
                crypto
                    .randomBytes(32)
                    .toString("hex");


            oauthStates.set(
                state,
                {

                    client_id:
                        clientId,

                    client_secret:
                        clientSecret,

                    redirect_uri:
                        redirectUri,

                    criado_em:
                        Date.now()

                }
            );


            /*
             * O scope offline_access é importante
             * para receber refresh token.
             */

            const parametros =
                new URLSearchParams();


            parametros.set(
                "response_type",
                "code"
            );


            parametros.set(
                "client_id",
                clientId
            );


            parametros.set(
                "redirect_uri",
                redirectUri
            );


            parametros.set(
                "state",
                state
            );


            parametros.set(
                "scope",
                "offline_access read write"
            );


            const authUrl =
                `${MERCADO_LIVRE_AUTH}?${parametros.toString()}`;


            return res.json({

                auth_url:
                    authUrl

            });

        } catch (erro) {

            console.error(
                "Erro iniciando OAuth:",
                erro
            );


            return res.status(
                500
            ).json({

                erro:
                    erro.message ||
                    "Erro ao iniciar OAuth."

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

            const code =
                String(
                    req.query.code ||
                    ""
                );


            const state =
                String(
                    req.query.state ||
                    ""
                );


            const oauthError =
                String(
                    req.query.error ||
                    ""
                );


            const errorDescription =
                String(
                    req.query.error_description ||
                    ""
                );


            if (
                oauthError
            ) {

                return res.status(
                    400
                ).send(`
                    <!DOCTYPE html>

                    <html lang="pt-BR">

                    <head>
                        <meta charset="UTF-8">
                        <title>Erro Mercado Livre</title>
                    </head>

                    <body style="
                        margin:0;
                        font-family:Arial,sans-serif;
                        background:#f8fafc;
                        padding:50px;
                    ">

                        <div style="
                            max-width:650px;
                            margin:auto;
                            background:white;
                            padding:35px;
                            border-radius:20px;
                            box-shadow:0 10px 40px rgba(0,0,0,.10);
                        ">

                            <h1>
                                Autorização não concluída
                            </h1>

                            <p>
                                ${
                                    errorDescription ||
                                    oauthError
                                }
                            </p>

                            <a
                                href="${SITE_URL}"
                                style="
                                    display:inline-block;
                                    margin-top:20px;
                                    padding:12px 20px;
                                    background:#111827;
                                    color:white;
                                    border-radius:10px;
                                    text-decoration:none;
                                "
                            >
                                Voltar ao ML Hub Pro
                            </a>

                        </div>

                    </body>

                    </html>
                `);
            }


            if (
                !code ||
                !state
            ) {

                return res.status(
                    400
                ).send(
                    "Código ou state não informado."
                );
            }


            const pendente =
                oauthStates.get(
                    state
                );


            if (
                !pendente
            ) {

                return res.status(
                    400
                ).send(
                    "Estado OAuth inválido ou expirado. Inicie a conexão novamente."
                );
            }


            oauthStates.delete(
                state
            );


            const fetch =
                await getFetch();


            const body =
                new URLSearchParams();


            body.set(
                "grant_type",
                "authorization_code"
            );


            body.set(
                "client_id",
                pendente.client_id
            );


            body.set(
                "client_secret",
                pendente.client_secret
            );


            body.set(
                "code",
                code
            );


            body.set(
                "redirect_uri",
                pendente.redirect_uri
            );


            const resposta =
                await fetch(
                    MERCADO_LIVRE_TOKEN,
                    {

                        method:
                            "POST",

                        headers: {

                            Accept:
                                "application/json",

                            "Content-Type":
                                "application/x-www-form-urlencoded"

                        },

                        body:
                            body

                    }
                );


            const dados =
                await resposta.json();


            if (
                !resposta.ok
            ) {

                console.error(
                    "Mercado Livre recusou OAuth:",
                    dados
                );


                return res.status(
                    400
                ).send(`
                    <!DOCTYPE html>

                    <html lang="pt-BR">

                    <head>
                        <meta charset="UTF-8">
                        <title>Erro OAuth</title>
                    </head>

                    <body style="
                        margin:0;
                        font-family:Arial,sans-serif;
                        background:#f8fafc;
                        padding:50px;
                    ">

                        <div style="
                            max-width:650px;
                            margin:auto;
                            background:white;
                            padding:35px;
                            border-radius:20px;
                            box-shadow:0 10px 40px rgba(0,0,0,.10);
                        ">

                            <h1>
                                Erro ao conectar
                            </h1>

                            <p>
                                ${
                                    dados.message ||
                                    dados.error_description ||
                                    dados.error ||
                                    "O Mercado Livre não autorizou a conexão."
                                }
                            </p>

                            <a
                                href="${SITE_URL}"
                                style="
                                    display:inline-block;
                                    margin-top:20px;
                                    padding:12px 20px;
                                    background:#111827;
                                    color:white;
                                    border-radius:10px;
                                    text-decoration:none;
                                "
                            >
                                Voltar
                            </a>

                        </div>

                    </body>

                    </html>
                `);
            }


            if (
                !dados.access_token
            ) {

                throw new Error(
                    "Mercado Livre não retornou access_token."
                );
            }


            if (
                !dados.refresh_token
            ) {

                return res.status(
                    400
                ).send(`
                    <!DOCTYPE html>

                    <html lang="pt-BR">

                    <head>
                        <meta charset="UTF-8">
                        <title>Refresh Token não recebido</title>
                    </head>

                    <body style="
                        margin:0;
                        font-family:Arial,sans-serif;
                        background:#f8fafc;
                        padding:50px;
                    ">

                        <div style="
                            max-width:650px;
                            margin:auto;
                            background:white;
                            padding:35px;
                            border-radius:20px;
                            box-shadow:0 10px 40px rgba(0,0,0,.10);
                        ">

                            <h1>
                                Refresh Token não recebido
                            </h1>

                            <p>
                                O Mercado Livre não retornou um
                                refresh_token. Verifique se a aplicação
                                possui a permissão offline_access.
                            </p>

                            <a
                                href="${SITE_URL}"
                                style="
                                    display:inline-block;
                                    margin-top:20px;
                                    padding:12px 20px;
                                    background:#111827;
                                    color:white;
                                    border-radius:10px;
                                    text-decoration:none;
                                "
                            >
                                Voltar
                            </a>

                        </div>

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
                            dados.expires_in ||
                            21600
                        ) *
                        1000
                    ),

                user_id:
                    dados.user_id ||
                    null

            };


            /*
             * Se o Mercado Livre não tiver enviado user_id,
             * descobrimos através do /users/me.
             */

            if (
                !authData.user_id
            ) {

                try {

                    const respostaUsuario =
                        await fetch(
                            `${MERCADO_LIVRE_API}/users/me`,
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
                            usuario.id ||
                            null;
                    }

                } catch (erro) {

                    console.error(
                        "Erro buscando usuário:",
                        erro.message
                    );
                }
            }


            salvarAuth(
                authData
            );


            return res.redirect(
                `${SITE_URL}/?oauth=success`
            );

        } catch (erro) {

            console.error(
                "Erro no callback OAuth:",
                erro
            );


            return res.status(
                500
            ).send(`
                <!DOCTYPE html>

                <html lang="pt-BR">

                <head>
                    <meta charset="UTF-8">
                    <title>Erro</title>
                </head>

                <body style="
                    font-family:Arial;
                    padding:50px;
                    background:#f8fafc;
                ">

                    <h1>
                        Erro interno
                    </h1>

                    <p>
                        ${erro.message}
                    </p>

                    <a href="${SITE_URL}">
                        Voltar
                    </a>

                </body>

                </html>
            `);
        }
    }
);


/* =========================================================
   RENOVAR TOKEN
   ========================================================= */

async function renovarAccessToken() {

    if (
        !authData
    ) {

        throw new Error(
            "Nenhuma conta conectada."
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


    body.set(
        "grant_type",
        "refresh_token"
    );


    body.set(
        "client_id",
        authData.client_id
    );


    body.set(
        "client_secret",
        authData.client_secret
    );


    body.set(
        "refresh_token",
        authData.refresh_token
    );


    const resposta =
        await fetch(
            MERCADO_LIVRE_TOKEN,
            {

                method:
                    "POST",

                headers: {

                    Accept:
                        "application/json",

                    "Content-Type":
                        "application/x-www-form-urlencoded"

                },

                body:
                    body

            }
        );


    const dados =
        await resposta.json();


    if (
        !resposta.ok
    ) {

        console.error(
            "Erro renovando token:",
            dados
        );


        if (
            dados.error ===
            "invalid_grant"
        ) {

            authData =
                null;


            apagarAuth();


            throw new Error(
                "O refresh token expirou ou já foi utilizado. Faça a conexão novamente."
            );
        }


        throw new Error(
            dados.message ||
            dados.error_description ||
            dados.error ||
            "Não foi possível renovar o token."
        );
    }


    if (
        !dados.access_token
    ) {

        throw new Error(
            "O Mercado Livre não retornou um novo access token."
        );
    }


    authData.access_token =
        dados.access_token;


    /*
     * MUITO IMPORTANTE:
     *
     * O Mercado Livre gera um NOVO refresh token
     * a cada renovação.
     *
     * O novo deve substituir o anterior.
     */

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
                dados.expires_in ||
                21600
            ) *
            1000
        );


    salvarAuth(
        authData
    );


    return authData.access_token;
}


/* =========================================================
   TOKEN VÁLIDO
   ========================================================= */

async function obterAccessTokenValido() {

    if (
        !authData
    ) {

        throw new Error(
            "Conta não conectada."
        );
    }


    const agora =
        Date.now();


    const expiresAt =
        Number(
            authData.expires_at ||
            0
        );


    /*
     * Renovamos com 5 minutos de margem.
     */

    const margem =
        5 *
        60 *
        1000;


    if (
        authData.access_token &&
        expiresAt >
            agora +
            margem
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
   FETCH MERCADO LIVRE
   ========================================================= */

async function mlFetch(
    endpoint,
    options = {}
) {

    let token =
        await obterAccessTokenValido();


    const fetch =
        await getFetch();


    const headers = {
        ...(options.headers || {}),

        Authorization:
            `Bearer ${token}`
    };


    let resposta =
        await fetch(
            `${MERCADO_LIVRE_API}${endpoint}`,
            {
                ...options,

                headers
            }
        );


    /*
     * Se mesmo assim retornar 401,
     * força uma renovação e tenta novamente.
     */

    if (
        resposta.status ===
        401 &&
        authData &&
        authData.refresh_token
    ) {

        token =
            await renovarAccessToken();


        headers.Authorization =
            `Bearer ${token}`;


        resposta =
            await fetch(
                `${MERCADO_LIVRE_API}${endpoint}`,
                {
                    ...options,

                    headers
                }
            );
    }


    return resposta;
}


/* =========================================================
   CALCULAR FRETE
   ========================================================= */

async function calcularFreteExato(
    item
) {

    try {

        if (
            item &&
            item.shipping &&
            item.shipping.free_shipping
        ) {

            try {

                const resposta =
                    await mlFetch(
                        `/items/${item.id}/sale_fee?quantity=1`
                    );


                if (
                    resposta.ok
                ) {

                    const dados =
                        await resposta.json();


                    if (
                        dados &&
                        dados.shipping_cost != null
                    ) {

                        return Number(
                            dados.shipping_cost
                        );
                    }
                }

            } catch (erro) {

                console.error(
                    "Erro sale_fee:",
                    erro.message
                );
            }


            if (
                item.shipping.cost != null
            ) {

                return Number(
                    item.shipping.cost
                );
            }


            return 12.95;
        }


        if (
            item &&
            item.shipping &&
            item.shipping.cost != null
        ) {

            return Number(
                item.shipping.cost
            );
        }


        return 6.85;

    } catch (erro) {

        console.error(
            "Erro calculando frete:",
            erro.message
        );


        return 6.85;
    }
}


/* =========================================================
   BUSCAR SKU
   ========================================================= */

function obterSku(
    item
) {

    if (
        item.seller_custom_field
    ) {

        return item.seller_custom_field;
    }


    if (
        Array.isArray(
            item.attributes
        )
    ) {

        const atributo =
            item.attributes.find(
                attr =>
                    String(
                        attr.id ||
                        ""
                    ).toUpperCase() ===
                    "SELLER_SKU"
            );


        if (
            atributo
        ) {

            return (
                atributo.value_name ||
                atributo.value_id ||
                ""
            );
        }
    }


    return "";
}


/* =========================================================
   BUSCAR ANÚNCIOS
   ========================================================= */

app.get(
    "/api/anuncios",
    async (req, res) => {

        try {

            const respostaUsuario =
                await mlFetch(
                    "/users/me"
                );


            const dadosUsuario =
                await respostaUsuario.json();


            if (
                !respostaUsuario.ok
            ) {

                return res.status(
                    respostaUsuario.status
                ).json({

                    erro:
                        dadosUsuario.message ||
                        dadosUsuario.error ||
                        "Não foi possível consultar o usuário."

                });
            }


            const userId =
                dadosUsuario.id;


            const ids =
                [];


            /*
             * Busca por scan.
             */

            let url =
                `/users/${userId}/items/search?search_type=scan&limit=100`;


            while (url) {

                const resposta =
                    await mlFetch(
                        url
                    );


                if (
                    !resposta.ok
                ) {

                    const erro =
                        await resposta.text();


                    throw new Error(
                        erro ||
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


                if (
                    dados.scroll_id &&
                    dados.results &&
                    dados.results.length
                ) {

                    url =
                        `/users/${userId}/items/search?search_type=scan&scroll_id=${encodeURIComponent(dados.scroll_id)}`;

                } else {

                    url =
                        null;
                }
            }


            const idsUnicos =
                [
                    ...new Set(ids)
                ];


            const listaFinal =
                [];


            /*
             * Mercado Livre limita quantidade por chamada,
             * então buscamos os itens em lotes.
             */

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


                const itens =
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


                                    return await resposta.json();

                                } catch (erro) {

                                    console.error(
                                        `Erro item ${id}:`,
                                        erro.message
                                    );


                                    return null;
                                }
                            }
                        )
                    );


                for (
                    const item
                    of itens
                ) {

                    if (
                        !item
                    ) {

                        continue;
                    }


                    const preco =
                        Number(
                            item.price
                        ) || 0;


                    let comissao =
                        0;


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
                                    fee.sale_fee_amount ??
                                    fee.sale_fee ??
                                    fee.total_fee ??
                                    0
                                );
                        }

                    } catch (erro) {

                        console.error(
                            "Erro calculando comissão:",
                            erro.message
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


                    listaFinal.push({

                        id:
                            item.id,

                        titulo:
                            item.title,

                        sku:
                            obterSku(item),

                        status:
                            item.status,

                        preco:
                            preco,

                        comissao:
                            comissao,

                        frete:
                            frete,

                        liquido:
                            liquido,

                        shipping:
                            item.shipping ||
                            null

                    });
                }
            }


            return res.json({

                itens:
                    listaFinal

            });

        } catch (erro) {

            console.error(
                "Erro /api/anuncios:",
                erro
            );


            return res.status(
                500
            ).json({

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


            const precos =
                {};


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

                                        id:
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

                precos:
                    precos

            });

        } catch (erro) {

            console.error(
                erro
            );


            return res.status(
                500
            ).json({

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


            const fretes =
                {};


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


                                    const gratis =
                                        Boolean(
                                            item.shipping &&
                                            item.shipping.free_shipping
                                        );


                                    return {

                                        id:
                                            id,

                                        custo:
                                            custo,

                                        shipping_cost:
                                            custo,

                                        gratis:
                                            gratis,

                                        free_shipping:
                                            gratis

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

                            fretes[
                                resultado.id
                            ] =
                                resultado;
                        }
                    }
                );
            }


            return res.json({

                fretes:
                    fretes

            });

        } catch (erro) {

            console.error(
                erro
            );


            return res.status(
                500
            ).json({

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

            const id =
                String(
                    req.body.id ||
                    ""
                );


            const preco =
                Number(
                    req.body.preco
                );


            if (
                !id ||
                !Number.isFinite(
                    preco
                ) ||
                preco <= 0
            ) {

                return res.status(
                    400
                ).json({

                    erro:
                        "ID e preço válido são obrigatórios."

                });
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

                sucesso:
                    true,

                item:
                    dados

            });

        } catch (erro) {

            console.error(
                erro
            );


            return res.status(
                500
            ).json({

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


            if (
                !itens.length
            ) {

                return res.status(
                    400
                ).json({

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
                                    String(
                                        item.id ||
                                        ""
                                    );


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

                                        id:
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

                                        id:
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

                                    id:
                                        id,

                                    sucesso:
                                        true,

                                    preco:
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

                resultados:
                    resultados

            });

        } catch (erro) {

            console.error(
                erro
            );


            return res.status(
                500
            ).json({

                erro:
                    erro.message ||
                    "Erro atualizando preços."

            });
        }
    }
);


/* =========================================================
   ERRO GERAL
   ========================================================= */

app.use(
    (erro, req, res, next) => {

        console.error(
            "Erro geral:",
            erro
        );


        if (
            res.headersSent
        ) {

            return next(
                erro
            );
        }


        return res.status(
            500
        ).json({

            erro:
                "Erro interno do servidor."

        });
    }
);


/* =========================================================
   INICIAR
   ========================================================= */

app.listen(
    PORT,
    () => {

        console.log(
            "======================================"
        );

        console.log(
            "ML Hub Pro iniciado"
        );

        console.log(
            `Porta: ${PORT}`
        );

        console.log(
            `Site: ${SITE_URL}`
        );

        console.log(
            `Callback: ${SITE_URL}/auth/callback`
        );

        console.log(
            "======================================"
        );

    }
);
