const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT =
    process.env.PORT || 3000;


/* =========================================================
   CONFIGURAÇÕES
========================================================= */

const SITE_URL = (
    process.env.SITE_URL ||
    "https://site-atualizar-pre-o-ml.onrender.com"
).replace(/\/$/, "");


const CALLBACK_URL =
    `${SITE_URL}/auth/callback`;


const ML_API =
    "https://api.mercadolibre.com";


const ML_AUTH =
    "https://auth.mercadolivre.com.br/authorization";


const ML_TOKEN =
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
   EXPRESS
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
 * CORS.
 *
 * O site normalmente será same-origin no Render,
 * mas deixamos o domínio explicitamente permitido.
 */

app.use(
    cors({
        origin: SITE_URL,
        credentials: true
    })
);


/*
 * O próprio Node/Express serve o index.html.
 *
 * Isso é importante:
 *
 * Render Web Service
 *        ↓
 * server.js
 *        ↓
 * index.html
 *
 * Não deixe o frontend como Static Site separado.
 */

app.use(
    express.static(
        __dirname
    )
);


/* =========================================================
   FETCH
========================================================= */

async function fazerFetch(
    url,
    options = {}
) {

    if (
        typeof fetch ===
        "function"
    ) {

        return fetch(
            url,
            options
        );
    }


    const modulo =
        await import(
            "node-fetch"
        );


    return modulo.default(
        url,
        options
    );
}


/* =========================================================
   CRIPTOGRAFIA
========================================================= */

function obterChave() {

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


    fs.writeFileSync(
        KEY_FILE,
        chave.toString("hex"),
        {
            mode: 0o600
        }
    );


    return chave;
}


function salvarDados(
    dados
) {

    const chave =
        obterChave();


    const iv =
        crypto.randomBytes(12);


    const cipher =
        crypto.createCipheriv(
            "aes-256-gcm",
            chave,
            iv
        );


    let texto =
        cipher.update(
            JSON.stringify(dados),
            "utf8",
            "base64"
        );


    texto +=
        cipher.final(
            "base64"
        );


    const tag =
        cipher.getAuthTag();


    fs.writeFileSync(
        AUTH_FILE,
        JSON.stringify({
            iv:
                iv.toString("base64"),

            tag:
                tag.toString("base64"),

            data:
                texto
        }),
        {
            mode: 0o600
        }
    );
}


function carregarDados() {

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
            obterChave();


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
            "Erro lendo arquivo de autenticação:",
            erro.message
        );


        return null;
    }
}


function apagarDados() {

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
    carregarDados();


/* =========================================================
   OAUTH STATE
========================================================= */

const oauthStates =
    new Map();


function gerarState() {

    return crypto
        .randomBytes(32)
        .toString("hex");
}


function limparStates() {

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
            dados.criadoEm >
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
   HEALTH CHECK
========================================================= */

app.get(
    "/health",
    (req, res) => {

        res.json({
            ok:
                true,

            service:
                "ML Hub Pro",

            callback:
                CALLBACK_URL
        });
    }
);


/* =========================================================
   STATUS
========================================================= */

app.get(
    "/api/auth/status",
    (req, res) => {

        res.json({

            autenticado:
                Boolean(
                    authData &&
                    authData.access_token
                ),

            user_id:
                authData?.user_id ||
                null,

            renovacao_automatica:
                Boolean(
                    authData?.refresh_token
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

            limparStates();


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
                !clientSecret
            ) {

                return res.status(
                    400
                ).json({

                    erro:
                        "Client ID e Client Secret são obrigatórios."

                });
            }


            /*
             * Para evitar erros de configuração,
             * usamos somente o callback deste servidor.
             */

            if (
                redirectUri !==
                CALLBACK_URL
            ) {

                return res.status(
                    400
                ).json({

                    erro:
                        "A URL de retorno deve ser exatamente: " +
                        CALLBACK_URL

                });
            }


            /*
             * Modo manual.
             *
             * Funciona para um access token já existente,
             * mas não permite renovação automática sem
             * refresh token.
             */

            if (
                accessToken
            ) {

                const resposta =
                    await fazerFetch(
                        `${ML_API}/users/me`,
                        {
                            headers: {
                                Authorization:
                                    `Bearer ${accessToken}`
                            }
                        }
                    );


                const usuario =
                    await resposta.json();


                if (
                    !resposta.ok
                ) {

                    return res.status(
                        401
                    ).json({

                        erro:
                            usuario.message ||
                            "Access Token inválido."

                    });
                }


                authData = {

                    client_id:
                        clientId,

                    client_secret:
                        clientSecret,

                    redirect_uri:
                        CALLBACK_URL,

                    access_token:
                        accessToken,

                    refresh_token:
                        null,

                    expires_at:
                        Date.now() +
                        5 * 60 * 60 * 1000,

                    user_id:
                        usuario.id ||
                        null

                };


                salvarDados(
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
             * OAuth.
             */

            const state =
                gerarState();


            oauthStates.set(
                state,
                {

                    clientId:
                        clientId,

                    clientSecret:
                        clientSecret,

                    redirectUri:
                        CALLBACK_URL,

                    criadoEm:
                        Date.now()

                }
            );


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
                CALLBACK_URL
            );


            parametros.set(
                "state",
                state
            );


            /*
             * O Mercado Livre aceita:
             *
             * offline_access
             * read
             * write
             *
             * offline_access é o que permite
             * trabalhar com refresh token.
             */

            parametros.set(
                "scope",
                "offline_access read write"
            );


            const authUrl =
                `${ML_AUTH}?${parametros.toString()}`;


            console.log(
                "OAuth iniciado para Client ID:",
                clientId
            );


            return res.json({

                auth_url:
                    authUrl

            });

        } catch (erro) {

            console.error(
                "Erro /api/auth/start:",
                erro
            );


            return res.status(
                500
            ).json({

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

async function processarCallback(
    req,
    res
) {

    try {

        const code =
            String(
                req.query.code ||
                req.body?.code ||
                ""
            ).trim();


        const state =
            String(
                req.query.state ||
                req.body?.state ||
                ""
            ).trim();


        const oauthError =
            String(
                req.query.error ||
                req.body?.error ||
                ""
            ).trim();


        const errorDescription =
            String(
                req.query.error_description ||
                req.body?.error_description ||
                ""
            ).trim();


        if (
            oauthError
        ) {

            return res.status(
                400
            ).send(`
                <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>OAuth cancelado</title>
                    </head>

                    <body style="
                        font-family:Arial;
                        padding:40px;
                        background:#f8fafc;
                    ">

                        <div style="
                            max-width:600px;
                            margin:auto;
                            background:white;
                            padding:30px;
                            border-radius:20px;
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

                            <a href="${SITE_URL}">
                                Voltar para o ML Hub Pro
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
                "Código OAuth ou state não informado."
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
                "State OAuth inválido ou expirado. Volte ao painel e tente conectar novamente."
            );
        }


        oauthStates.delete(
            state
        );


        /*
         * Troca authorization_code por
         * access_token + refresh_token.
         *
         * O Mercado Livre exige POST com os dados
         * no BODY.
         */

        const body =
            new URLSearchParams();


        body.set(
            "grant_type",
            "authorization_code"
        );


        body.set(
            "client_id",
            pendente.clientId
        );


        body.set(
            "client_secret",
            pendente.clientSecret
        );


        body.set(
            "code",
            code
        );


        body.set(
            "redirect_uri",
            CALLBACK_URL
        );


        const resposta =
            await fazerFetch(
                ML_TOKEN,
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
                "Erro retornado pelo Mercado Livre:",
                dados
            );


            return res.status(
                400
            ).send(`
                <html>
                    <head>
                        <meta charset="UTF-8">
                        <title>Erro Mercado Livre</title>
                    </head>

                    <body style="
                        font-family:Arial;
                        padding:40px;
                        background:#f8fafc;
                    ">

                        <div style="
                            max-width:650px;
                            margin:auto;
                            background:white;
                            padding:30px;
                            border-radius:20px;
                        ">

                            <h1>
                                Erro ao conectar
                            </h1>

                            <p>
                                ${
                                    dados.message ||
                                    dados.error_description ||
                                    dados.error ||
                                    "O Mercado Livre recusou a autorização."
                                }
                            </p>

                            <p>
                                Confira se o Redirect URI
                                cadastrado no Mercado Livre é:
                            </p>

                            <pre>${CALLBACK_URL}</pre>

                            <a href="${SITE_URL}">
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

            throw new Error(
                "Mercado Livre não retornou refresh_token. Verifique se offline_access está habilitado para a aplicação."
            );
        }


        authData = {

            client_id:
                pendente.clientId,

            client_secret:
                pendente.clientSecret,

            redirect_uri:
                CALLBACK_URL,

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
         * Se necessário, consulta /users/me.
         */

        if (
            !authData.user_id
        ) {

            try {

                const respostaUsuario =
                    await fazerFetch(
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
                        usuario.id ||
                        null;
                }

            } catch (erro) {

                console.error(
                    "Erro consultando usuário:",
                    erro.message
                );
            }
        }


        /*
         * Salva tudo criptografado.
         */

        salvarDados(
            authData
        );


        console.log(
            "OAuth concluído. Usuário:",
            authData.user_id
        );


        /*
         * Volta para o painel.
         */

        return res.redirect(
            `${SITE_URL}/?oauth=success`
        );

    } catch (erro) {

        console.error(
            "Erro no callback:",
            erro
        );


        return res.status(
            500
        ).send(`
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

                    <div style="
                        max-width:650px;
                        margin:auto;
                        background:white;
                        padding:30px;
                        border-radius:20px;
                    ">

                        <h1>
                            Erro na conexão
                        </h1>

                        <p>
                            ${erro.message}
                        </p>

                        <a href="${SITE_URL}">
                            Voltar ao painel
                        </a>

                    </div>

                </body>

            </html>
        `);
    }
}


/*
 * GET:
 *
 * É o fluxo normal do OAuth.
 */

app.get(
    "/auth/callback",
    processarCallback
);


/*
 * POST:
 *
 * Mantemos também para evitar 405 caso algum
 * fluxo/proxy envie POST.
 */

app.post(
    "/auth/callback",
    processarCallback
);


/* =========================================================
   RENOVAÇÃO
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
        !authData.refresh_token
    ) {

        throw new Error(
            "Refresh token não disponível."
        );
    }


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
        await fazerFetch(
            ML_TOKEN,
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
            "Falha no refresh:",
            dados
        );


        if (
            dados.error ===
            "invalid_grant"
        ) {

            authData =
                null;


            apagarDados();


            throw new Error(
                "O refresh token não é mais válido. Faça a conexão novamente."
            );
        }


        throw new Error(
            dados.message ||
            dados.error_description ||
            dados.error ||
            "Erro renovando token."
        );
    }


    if (
        !dados.access_token
    ) {

        throw new Error(
            "Novo access token não retornado."
        );
    }


    authData.access_token =
        dados.access_token;


    /*
     * ESSA PARTE É FUNDAMENTAL.
     *
     * O Mercado Livre devolve um novo
     * refresh_token a cada renovação.
     *
     * O antigo deixa de ser válido.
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


    salvarDados(
        authData
    );


    console.log(
        "Access Token renovado automaticamente."
    );


    return authData.access_token;
}


/* =========================================================
   TOKEN VÁLIDO
========================================================= */

async function obterTokenValido() {

    if (
        !authData
    ) {

        throw new Error(
            "Conta não conectada."
        );
    }


    const agora =
        Date.now();


    const expiracao =
        Number(
            authData.expires_at ||
            0
        );


    /*
     * Renovação antecipada:
     * 5 minutos antes de expirar.
     */

    const margem =
        5 * 60 * 1000;


    if (
        authData.access_token &&
        expiracao >
            agora +
            margem
    ) {

        return authData.access_token;
    }


    if (
        authData.refresh_token
    ) {

        return renovarAccessToken();
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
   REQUEST MERCADO LIVRE
========================================================= */

async function mlFetch(
    endpoint,
    options = {}
) {

    let token =
        await obterTokenValido();


    const headers = {
        ...(options.headers || {}),

        Authorization:
            `Bearer ${token}`
    };


    let resposta =
        await fazerFetch(
            `${ML_API}${endpoint}`,
            {
                ...options,
                headers
            }
        );


    /*
     * Se o token expirou apesar da margem,
     * tenta renovar uma vez.
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
            await fazerFetch(
                `${ML_API}${endpoint}`,
                {
                    ...options,
                    headers
                }
            );
    }


    return resposta;
}


/* =========================================================
   SKU
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

        const sku =
            item.attributes.find(
                atributo =>
                    String(
                        atributo.id ||
                        ""
                    ).toUpperCase() ===
                    "SELLER_SKU"
            );


        if (
            sku
        ) {

            return (
                sku.value_name ||
                sku.value_id ||
                ""
            );
        }
    }


    return "";
}


/* =========================================================
   FRETE
========================================================= */

async function calcularFrete(
    item
) {

    try {

        if (
            item.shipping &&
            item.shipping.cost != null
        ) {

            return Number(
                item.shipping.cost
            );
        }


        if (
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
                        dados.shipping_cost != null
                    ) {

                        return Number(
                            dados.shipping_cost
                        );
                    }
                }

            } catch {}
        }


        return 0;

    } catch {

        return 0;
    }
}


/* =========================================================
   ANÚNCIOS
========================================================= */

app.get(
    "/api/anuncios",
    async (req, res) => {

        try {

            const usuarioResponse =
                await mlFetch(
                    "/users/me"
                );


            const usuario =
                await usuarioResponse.json();


            if (
                !usuarioResponse.ok
            ) {

                return res.status(
                    usuarioResponse.status
                ).json({

                    erro:
                        usuario.message ||
                        "Erro consultando usuário."

                });
            }


            const userId =
                usuario.id;


            /*
             * Busca IDs.
             */

            let searchUrl =
                `/users/${userId}/items/search?search_type=scan&limit=100`;


            const ids = [];


            while (
                searchUrl
            ) {

                const resposta =
                    await mlFetch(
                        searchUrl
                    );


                const dados =
                    await resposta.json();


                if (
                    !resposta.ok
                ) {

                    throw new Error(
                        dados.message ||
                        "Erro buscando anúncios."
                    );
                }


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

                    searchUrl =
                        `/users/${userId}/items/search?search_type=scan&scroll_id=${encodeURIComponent(dados.scroll_id)}`;

                } else {

                    searchUrl =
                        null;
                }
            }


            const unicos =
                [
                    ...new Set(ids)
                ];


            const itens = [];


            /*
             * Busca os itens em lotes.
             */

            for (
                let i = 0;
                i < unicos.length;
                i += 20
            ) {

                const lote =
                    unicos.slice(
                        i,
                        i + 20
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


                                    return resposta.json();

                                } catch {

                                    return null;
                                }
                            }
                        )
                    );


                for (
                    const item
                    of resultados
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

                        const resposta =
                            await mlFetch(
                                `/items/${item.id}/sale_fee?price=${encodeURIComponent(preco)}&quantity=1`
                            );


                        if (
                            resposta.ok
                        ) {

                            const fee =
                                await resposta.json();


                            comissao =
                                Number(
                                    fee.sale_fee_amount ??
                                    fee.sale_fee ??
                                    fee.total_fee ??
                                    0
                                );
                        }

                    } catch {}


                    const frete =
                        await calcularFrete(
                            item
                        );


                    itens.push({

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
                            preco -
                            comissao -
                            frete

                    });
                }
            }


            return res.json({
                itens
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
                    "Erro carregando anúncios."

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
                const id
                of ids
            ) {

                try {

                    const resposta =
                        await mlFetch(
                            `/items/${id}`
                        );


                    if (
                        !resposta.ok
                    ) {

                        continue;
                    }


                    const item =
                        await resposta.json();


                    precos[id] =
                        Number(
                            item.price
                        ) || 0;

                } catch {}
            }


            return res.json({
                precos
            });

        } catch (erro) {

            return res.status(
                500
            ).json({

                erro:
                    erro.message

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
                const id
                of ids
            ) {

                try {

                    const resposta =
                        await mlFetch(
                            `/items/${id}`
                        );


                    if (
                        !resposta.ok
                    ) {

                        continue;
                    }


                    const item =
                        await resposta.json();


                    const custo =
                        await calcularFrete(
                            item
                        );


                    fretes[id] = {

                        custo:
                            custo,

                        shipping_cost:
                            custo

                    };

                } catch {}
            }


            return res.json({
                fretes
            });

        } catch (erro) {

            return res.status(
                500
            ).json({

                erro:
                    erro.message

            });
        }
    }
);


/* =========================================================
   ATUALIZAR PREÇO
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
                        "ID ou preço inválido."

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
                        "Erro atualizando preço."

                });
            }


            return res.json({

                sucesso:
                    true,

                item:
                    dados

            });

        } catch (erro) {

            return res.status(
                500
            ).json({

                erro:
                    erro.message

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


            const resultados =
                [];


            for (
                const item
                of itens
            ) {

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

                        resultados.push({

                            id:
                                id,

                            sucesso:
                                false,

                            erro:
                                "Preço inválido."

                        });

                        continue;
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


                    resultados.push({

                        id:
                            id,

                        sucesso:
                            resposta.ok,

                        preco:
                            preco,

                        erro:
                            resposta.ok
                                ? null
                                : (
                                    dados.message ||
                                    dados.error ||
                                    "Erro na API."
                                )

                    });

                } catch (erro) {

                    resultados.push({

                        id:
                            item.id,

                        sucesso:
                            false,

                        erro:
                            erro.message

                    });
                }
            }


            return res.json({
                resultados
            });

        } catch (erro) {

            return res.status(
                500
            ).json({

                erro:
                    erro.message

            });
        }
    }
);


/* =========================================================
   LOGOUT
========================================================= */

app.post(
    "/api/auth/logout",
    (req, res) => {

        authData =
            null;


        apagarDados();


        return res.json({
            sucesso:
                true
        });
    }
);


/* =========================================================
   404
========================================================= */

app.use(
    (req, res) => {

        res.status(
            404
        ).json({

            erro:
                "Rota não encontrada.",

            metodo:
                req.method,

            caminho:
                req.originalUrl

        });
    }
);


/* =========================================================
   START
========================================================= */

app.listen(
    PORT,
    () => {

        console.log(
            "========================================"
        );

        console.log(
            "ML HUB PRO"
        );

        console.log(
            `Porta: ${PORT}`
        );

        console.log(
            `Site: ${SITE_URL}`
        );

        console.log(
            `Callback OAuth: ${CALLBACK_URL}`
        );

        console.log(
            "========================================"
        );

    }
);
