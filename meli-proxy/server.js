const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const app = express();

const PORT = process.env.PORT || 10000;

const ML_API = 'https://api.mercadolibre.com';
const ML_AUTH = 'https://auth.mercadolivre.com.br';
const ML_SITE = 'MLB';

const FRONTEND_URL = (
  process.env.FRONTEND_URL ||
  'https://joyjhonatan0-lang.github.io/Site-Atualizar-preco-ml/'
).replace(/\/$/, '');

const ML_CLIENT_ID = process.env.ML_CLIENT_ID || '';
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET || '';

const ML_REDIRECT_URI =
  process.env.ML_REDIRECT_URI ||
  'https://site-atualizar-pre-o-ml.onrender.com/oauth/callback';

/*
|--------------------------------------------------------------------------
| MEMÓRIA
|--------------------------------------------------------------------------
|
| accounts:
|   Guarda as contas Mercado Livre autorizadas.
|
| sessions:
|   Guarda a sessão do navegador e quais contas ela pode utilizar.
|
| oauthStates:
|   Protege o fluxo OAuth contra CSRF.
|
| IMPORTANTE:
| Esta versão funciona imediatamente no Render, mas os dados ficam
| em memória. Se o Render reiniciar o serviço, será necessário
| autorizar novamente as contas.
|
| Para produção definitiva, recomendo colocar os tokens em banco
| criptografado.
|
*/

const accounts = new Map();
const sessions = new Map();
const oauthStates = new Map();

/*
|--------------------------------------------------------------------------
| MIDDLEWARE
|--------------------------------------------------------------------------
*/

app.use(express.json({ limit: '2mb' }));

const allowedOrigins = [
  FRONTEND_URL,
  'https://joyjhonatan0-lang.github.io'
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(
        new Error('Origem não autorizada pelo CORS: ' + origin)
      );
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-ML-Session'
    ]
  })
);

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

/*
|--------------------------------------------------------------------------
| UTILITÁRIOS
|--------------------------------------------------------------------------
*/

function randomId(size = 32) {
  return crypto.randomBytes(size).toString('hex');
}

function now() {
  return Date.now();
}

function cleanToken(token) {
  if (!token) return null;

  let value = String(token).trim();

  if (value.toLowerCase().startsWith('bearer ')) {
    value = value.substring(7).trim();
  }

  return value || null;
}

function safeError(error) {
  if (!error) return 'Erro desconhecido';

  if (typeof error === 'string') {
    return error;
  }

  return (
    error.message ||
    error.error_description ||
    error.error ||
    'Erro desconhecido'
  );
}

function frontendRedirect(path = '') {
  return FRONTEND_URL + path;
}

function accountPublic(account) {
  if (!account) return null;

  return {
    id: account.id,
    seller_id: account.seller_id,
    nickname: account.nickname || '',
    first_name: account.first_name || '',
    last_name: account.last_name || '',
    email: account.email || '',
    country_id: account.country_id || '',
    site_id: account.site_id || ML_SITE,
    conectado_em: account.connectedAt,
    token_expira_em: account.expiresAt,
    ativo: !!account.active
  };
}

function createSession() {
  const sessionId = randomId(32);

  sessions.set(sessionId, {
    id: sessionId,
    accountIds: [],
    activeAccountId: null,
    createdAt: now(),
    lastAccess: now()
  });

  return sessionId;
}

function getSessionId(req) {
  const header = req.headers['x-ml-session'];

  if (header) {
    return String(header).trim();
  }

  return null;
}

function getSession(req) {
  const sessionId = getSessionId(req);

  if (!sessionId) {
    return null;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  session.lastAccess = now();

  return session;
}

function requireSession(req, res) {
  const session = getSession(req);

  if (!session) {
    res.status(401).json({
      erro: 'Sessão do ML Hub Pro não encontrada.',
      codigo: 'SESSION_REQUIRED'
    });

    return null;
  }

  return session;
}

function getAccountForRequest(req, res) {
  const session = requireSession(req, res);

  if (!session) {
    return null;
  }

  const requestedAccount =
    req.headers['x-ml-account'] ||
    req.body?.account_id ||
    req.query?.account_id ||
    session.activeAccountId;

  if (!requestedAccount) {
    res.status(400).json({
      erro: 'Nenhuma conta Mercado Livre foi selecionada.',
      codigo: 'ACCOUNT_REQUIRED'
    });

    return null;
  }

  if (!session.accountIds.includes(requestedAccount)) {
    res.status(403).json({
      erro: 'Essa conta não pertence à sessão atual.',
      codigo: 'ACCOUNT_NOT_ALLOWED'
    });

    return null;
  }

  const account = accounts.get(requestedAccount);

  if (!account) {
    res.status(404).json({
      erro: 'Conta Mercado Livre não encontrada.',
      codigo: 'ACCOUNT_NOT_FOUND'
    });

    return null;
  }

  return {
    session,
    account
  };
}

/*
|--------------------------------------------------------------------------
| MERCADO LIVRE API
|--------------------------------------------------------------------------
*/

async function mlRequest(account, path, options = {}) {
  if (!account) {
    throw new Error('Conta Mercado Livre não encontrada.');
  }

  const token = await getValidAccessToken(account);

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...(options.headers || {})
  };

  const response = await fetch(`${ML_API}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  /*
   * Se o token estiver inválido, tenta renovar uma vez.
   */
  if (
    response.status === 401 &&
    account.refresh_token
  ) {
    await refreshAccountToken(account);

    const newToken = cleanToken(account.access_token);

    const retryResponse = await fetch(`${ML_API}${path}`, {
      method: options.method || 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${newToken}`,
        ...(options.headers || {})
      },
      body: options.body
    });

    const retryText = await retryResponse.text();

    let retryData = null;

    try {
      retryData = retryText ? JSON.parse(retryText) : null;
    } catch {
      retryData = retryText;
    }

    if (!retryResponse.ok) {
      const error = new Error(
        retryData?.message ||
        retryData?.error_description ||
        retryData?.error ||
        `Mercado Livre retornou HTTP ${retryResponse.status}`
      );

      error.status = retryResponse.status;
      error.data = retryData;

      throw error;
    }

    return retryData;
  }

  if (!response.ok) {
    const error = new Error(
      data?.message ||
      data?.error_description ||
      data?.error ||
      `Mercado Livre retornou HTTP ${response.status}`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

/*
|--------------------------------------------------------------------------
| TOKEN
|--------------------------------------------------------------------------
*/

async function exchangeAuthorizationCode(code) {
  if (!ML_CLIENT_ID || !ML_CLIENT_SECRET) {
    throw new Error(
      'ML_CLIENT_ID ou ML_CLIENT_SECRET não configurado no Render.'
    );
  }

  const body = new URLSearchParams();

  body.set('grant_type', 'authorization_code');
  body.set('client_id', ML_CLIENT_ID);
  body.set('client_secret', ML_CLIENT_SECRET);
  body.set('code', code);
  body.set('redirect_uri', ML_REDIRECT_URI);

  const response = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.error_description ||
      data.message ||
      data.error ||
      `Falha no OAuth: HTTP ${response.status}`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

async function refreshAccountToken(account) {
  if (!account.refresh_token) {
    throw new Error(
      'Esta conta não possui refresh_token. É necessário conectar novamente.'
    );
  }

  const body = new URLSearchParams();

  body.set('grant_type', 'refresh_token');
  body.set('client_id', ML_CLIENT_ID);
  body.set('client_secret', ML_CLIENT_SECRET);
  body.set('refresh_token', account.refresh_token);

  const response = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    account.invalid = true;

    const error = new Error(
      data.error_description ||
      data.message ||
      data.error ||
      `Falha ao renovar token: HTTP ${response.status}`
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  account.access_token = data.access_token;

  /*
   * O Mercado Livre gera um novo refresh_token.
   * O anterior não deve continuar sendo usado.
   */
  if (data.refresh_token) {
    account.refresh_token = data.refresh_token;
  }

  account.expiresAt =
    now() + ((Number(data.expires_in) || 21600) * 1000);

  account.invalid = false;

  return account.access_token;
}

async function getValidAccessToken(account) {
  if (!account.access_token) {
    throw new Error(
      'A conta não possui Access Token. Conecte novamente.'
    );
  }

  /*
   * Renova 5 minutos antes de expirar.
   */
  const safetyWindow = 5 * 60 * 1000;

  if (
    account.expiresAt &&
    now() >= account.expiresAt - safetyWindow
  ) {
    await refreshAccountToken(account);
  }

  return cleanToken(account.access_token);
}

/*
|--------------------------------------------------------------------------
| TESTE DA CONFIGURAÇÃO
|--------------------------------------------------------------------------
*/

app.get('/api/config/status', (req, res) => {
  res.json({
    ok: true,
    mercado_livre: {
      client_id_configurado: !!ML_CLIENT_ID,
      client_secret_configurado: !!ML_CLIENT_SECRET,
      redirect_uri: ML_REDIRECT_URI,
      auth_url: ML_AUTH,
      api_url: ML_API
    },
    frontend: FRONTEND_URL
  });
});

/*
|--------------------------------------------------------------------------
| ROOT / HEALTH
|--------------------------------------------------------------------------
*/

app.get('/', (req, res) => {
  res.json({
    ok: true,
    sistema: 'ML Hub Pro',
    status: 'online',
    multi_contas: true,
    oauth: true,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    status: 'online'
  });
});

/*
|--------------------------------------------------------------------------
| OAUTH
|--------------------------------------------------------------------------
*/

/*
 * Inicia uma nova conexão.
 *
 * Cada vez que o usuário clicar em "Adicionar conta",
 * uma nova autorização será iniciada.
 */
app.get('/oauth/authorize', (req, res) => {
  try {
    if (!ML_CLIENT_ID || !ML_CLIENT_SECRET) {
      return res.status(500).send(`
        <h1>Configuração incompleta</h1>
        <p>ML_CLIENT_ID ou ML_CLIENT_SECRET não configurado.</p>
        <p>Configure essas variáveis no Render.</p>
      `);
    }

    /*
     * Recupera sessão existente.
     * Se não existir, cria uma.
     */
    let sessionId = getSessionId(req);

    if (!sessionId || !sessions.has(sessionId)) {
      sessionId = createSession();
    }

    const state = randomId(32);

    oauthStates.set(state, {
      state,
      sessionId,
      createdAt: now()
    });

    const params = new URLSearchParams();

    params.set('response_type', 'code');
    params.set('client_id', ML_CLIENT_ID);
    params.set('redirect_uri', ML_REDIRECT_URI);
    params.set('state', state);

    /*
     * Solicitamos acesso offline para permitir renovação
     * através do refresh_token.
     */
    params.set('scope', 'offline_access read write');

    const url =
      `${ML_AUTH}/authorization?${params.toString()}`;

    /*
     * O sessionId será entregue ao frontend depois do callback.
     * Não enviamos Access Token para o navegador.
     */

    return res.redirect(url);
  } catch (error) {
    console.error('Erro /oauth/authorize:', error);

    return res.status(500).send(`
      <h1>Erro ao iniciar conexão</h1>
      <pre>${escapeHtml(safeError(error))}</pre>
    `);
  }
});

/*
|--------------------------------------------------------------------------
| CALLBACK OAUTH
|--------------------------------------------------------------------------
*/

app.get('/oauth/callback', async (req, res) => {
  const {
    code,
    state,
    error,
    error_description
  } = req.query;

  try {
    if (error) {
      return res.status(400).send(`
        <!doctype html>
        <html lang="pt-BR">
        <head>
          <meta charset="UTF-8">
          <title>Erro Mercado Livre</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 40px;
              background: #f5f5f5;
            }
            .box {
              max-width: 700px;
              margin: auto;
              background: white;
              padding: 30px;
              border-radius: 14px;
              box-shadow: 0 5px 30px rgba(0,0,0,.08);
            }
            .error {
              color: #b00020;
              font-weight: bold;
            }
            button {
              border: 0;
              padding: 12px 18px;
              border-radius: 8px;
              cursor: pointer;
              background: #ffe600;
            }
          </style>
        </head>
        <body>
          <div class="box">
            <h1>Não foi possível conectar a conta</h1>

            <p class="error">
              ${escapeHtml(error || 'erro_desconhecido')}
            </p>

            <p>
              ${escapeHtml(
                error_description ||
                'O Mercado Livre recusou a autorização.'
              )}
            </p>

            <p>
              Verifique principalmente o Redirect URI cadastrado
              no aplicativo do Mercado Livre.
            </p>

            <button onclick="history.back()">
              Voltar
            </button>
          </div>
        </body>
        </html>
      `);
    }

    if (!state) {
      return res.status(400).send('State OAuth ausente.');
    }

    const oauth = oauthStates.get(String(state));

    if (!oauth) {
      return res.status(400).send(`
        <h1>OAuth inválido</h1>
        <p>O state expirou ou já foi utilizado.</p>
      `);
    }

    /*
     * State é de uso único.
     */
    oauthStates.delete(String(state));

    /*
     * State válido por apenas 10 minutos.
     */
    if (now() - oauth.createdAt > 10 * 60 * 1000) {
      return res.status(400).send(`
        <h1>OAuth expirado</h1>
        <p>Inicie a conexão novamente.</p>
      `);
    }

    if (!code) {
      return res.status(400).send(`
        <h1>Authorization code não recebido</h1>
      `);
    }

    const session = sessions.get(oauth.sessionId);

    if (!session) {
      return res.status(400).send(`
        <h1>Sessão expirada</h1>
        <p>Inicie a conexão novamente.</p>
      `);
    }

    /*
     * Troca CODE por Access Token + Refresh Token.
     */
    const tokenData = await exchangeAuthorizationCode(
      String(code)
    );

    if (!tokenData.access_token) {
      throw new Error(
        'O Mercado Livre não retornou access_token.'
      );
    }

    /*
     * Descobre o seller autorizado.
     */
    const meResponse = await fetch(
      `${ML_API}/users/me`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization:
            `Bearer ${tokenData.access_token}`
        }
      }
    );

    const me = await meResponse.json().catch(() => ({}));

    if (!meResponse.ok) {
      throw new Error(
        me.message ||
        me.error ||
        `Não foi possível consultar /users/me: HTTP ${meResponse.status}`
      );
    }

    const sellerId = String(
      tokenData.user_id ||
      me.id
    );

    /*
     * Se essa conta já foi autorizada anteriormente,
     * atualizamos os tokens.
     *
     * Caso seja uma conta nova, criamos outra.
     */
    let existingAccount = null;

    for (const account of accounts.values()) {
      if (
        String(account.seller_id) === sellerId
      ) {
        existingAccount = account;
        break;
      }
    }

    const account =
      existingAccount || {
        id: `acc_${randomId(16)}`,
        connectedAt: new Date().toISOString(),
        createdAt: now()
      };

    account.seller_id = sellerId;
    account.nickname = me.nickname || '';
    account.first_name = me.first_name || '';
    account.last_name = me.last_name || '';
    account.email = me.email || '';
    account.country_id = me.country_id || '';
    account.site_id = me.site_id || ML_SITE;

    account.access_token = tokenData.access_token;

    if (tokenData.refresh_token) {
      account.refresh_token =
        tokenData.refresh_token;
    }

    account.expiresAt =
      now() +
      ((Number(tokenData.expires_in) || 21600) * 1000);

    account.invalid = false;
    account.active = true;

    accounts.set(account.id, account);

    /*
     * Coloca a conta na sessão caso ainda não esteja.
     */
    if (!session.accountIds.includes(account.id)) {
      session.accountIds.push(account.id);
    }

    /*
     * Essa passa a ser a conta ativa.
     */
    session.activeAccountId = account.id;

    session.lastAccess = now();

    /*
     * Em vez de colocar tokens na URL,
     * enviamos somente um identificador de sessão.
     */
    const params = new URLSearchParams();

    params.set('ml_session', oauth.sessionId);
    params.set('connected', '1');
    params.set('account', account.id);

    return res.redirect(
      `${FRONTEND_URL}/?${params.toString()}`
    );
  } catch (error) {
    console.error(
      'Erro no OAuth callback:',
      error
    );

    const status =
      error.status >= 400 &&
      error.status < 600
        ? error.status
        : 500;

    const apiError =
      error.data?.error ||
      error.data?.message ||
      '';

    const description =
      error.data?.error_description ||
      safeError(error);

    return res.status(status).send(`
      <!doctype html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Erro OAuth Mercado Livre</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background: #f5f5f5;
            padding: 30px;
          }

          .box {
            max-width: 800px;
            margin: auto;
            background: white;
            padding: 30px;
            border-radius: 15px;
            box-shadow: 0 5px 30px rgba(0,0,0,.08);
          }

          .danger {
            color: #b00020;
          }

          code {
            background: #eee;
            padding: 3px 6px;
            border-radius: 5px;
          }
        </style>
      </head>

      <body>
        <div class="box">

          <h1>Erro ao conectar Mercado Livre</h1>

          <p>
            <strong>HTTP:</strong>
            ${status}
          </p>

          ${
            apiError
              ? `
                <p>
                  <strong>Erro:</strong>
                  <span class="danger">
                    ${escapeHtml(apiError)}
                  </span>
                </p>
              `
              : ''
          }

          <p>
            <strong>Mensagem:</strong>
            ${escapeHtml(description)}
          </p>

          <hr>

          <p>
            Redirect URI usado:
          </p>

          <code>
            ${escapeHtml(ML_REDIRECT_URI)}
          </code>

          <p style="margin-top:20px">
            Confira se esse endereço é exatamente igual ao
            Redirect URI cadastrado no aplicativo Mercado Livre.
          </p>

          <button
            onclick="window.location.href='${escapeJs(
              FRONTEND_URL
            )}'"
          >
            Voltar para o ML Hub Pro
          </button>

        </div>
      </body>
      </html>
    `);
  }
});

/*
|--------------------------------------------------------------------------
| SESSÃO / CONTAS
|--------------------------------------------------------------------------
*/

app.get('/api/auth/status', (req, res) => {
  const session = getSession(req);

  if (!session) {
    return res.json({
      conectado: false,
      contas: [],
      conta_ativa: null
    });
  }

  const validAccounts = session.accountIds
    .map(id => accounts.get(id))
    .filter(Boolean);

  return res.json({
    conectado: validAccounts.length > 0,
    session_id: getSessionId(req),
    contas: validAccounts.map(accountPublic),
    conta_ativa: accountPublic(
      accounts.get(session.activeAccountId)
    )
  });
});

/*
 * Cria uma sessão sem precisar conectar uma conta.
 */
app.post('/api/session', (req, res) => {
  const sessionId = createSession();

  res.json({
    ok: true,
    session_id: sessionId
  });
});

/*
 * Lista as contas conectadas.
 */
app.get('/api/contas', (req, res) => {
  const session = requireSession(req, res);

  if (!session) return;

  const contas = session.accountIds
    .map(id => accounts.get(id))
    .filter(Boolean)
    .map(accountPublic);

  res.json({
    contas,
    conta_ativa: accountPublic(
      accounts.get(session.activeAccountId)
    )
  });
});

/*
 * Troca a conta ativa.
 */
app.post('/api/contas/selecionar', (req, res) => {
  const session = requireSession(req, res);

  if (!session) return;

  const accountId = String(
    req.body?.account_id || ''
  );

  if (!accountId) {
    return res.status(400).json({
      erro: 'Informe account_id.'
    });
  }

  if (!session.accountIds.includes(accountId)) {
    return res.status(403).json({
      erro: 'Conta não pertence à sessão.'
    });
  }

  const account = accounts.get(accountId);

  if (!account) {
    return res.status(404).json({
      erro: 'Conta não encontrada.'
    });
  }

  session.activeAccountId = accountId;

  res.json({
    ok: true,
    conta_ativa: accountPublic(account)
  });
});

/*
 * Remove uma conta somente da sessão atual.
 */
app.delete('/api/contas/:accountId', (req, res) => {
  const session = requireSession(req, res);

  if (!session) return;

  const accountId = req.params.accountId;

  const index =
    session.accountIds.indexOf(accountId);

  if (index === -1) {
    return res.status(404).json({
      erro: 'Conta não encontrada na sessão.'
    });
  }

  session.accountIds.splice(index, 1);

  if (session.activeAccountId === accountId) {
    session.activeAccountId =
      session.accountIds[0] || null;
  }

  res.json({
    ok: true,
    contas: session.accountIds
      .map(id => accounts.get(id))
      .filter(Boolean)
      .map(accountPublic)
  });
});

/*
 * Logout da sessão inteira.
 */
app.post('/api/auth/logout', (req, res) => {
  const sessionId = getSessionId(req);

  if (sessionId) {
    sessions.delete(sessionId);
  }

  res.json({
    ok: true
  });
});

/*
|--------------------------------------------------------------------------
| /api/me
|--------------------------------------------------------------------------
*/

app.get('/api/me', async (req, res) => {
  try {
    const result = getAccountForRequest(req, res);

    if (!result) return;

    const { account } = result;

    const me = await mlRequest(
      account,
      '/users/me'
    );

    res.json({
      ok: true,
      conta: accountPublic(account),
      mercado_livre: me
    });
  } catch (error) {
    console.error('/api/me:', error);

    res.status(
      error.status || 500
    ).json({
      erro: safeError(error),
      detalhe: error.data || null
    });
  }
});

/*
|--------------------------------------------------------------------------
| ANÚNCIOS
|--------------------------------------------------------------------------
*/

async function getAllActiveItemIds(account) {
  const ids = [];

  const limit = 100;

  let offset = 0;

  while (true) {
    const data = await mlRequest(
      account,
      `/users/${account.seller_id}/items/search?status=active&limit=${limit}&offset=${offset}`
    );

    const results =
      Array.isArray(data?.results)
        ? data.results
        : [];

    ids.push(...results);

    if (
      results.length < limit ||
      !data?.paging ||
      offset + limit >= data.paging.total
    ) {
      break;
    }

    offset += limit;

    if (offset >= 1000) {
      break;
    }
  }

  return [...new Set(ids)];
}

async function getItemDetails(account, ids) {
  if (!ids.length) return [];

  const all = [];

  const batchSize = 20;

  for (
    let i = 0;
    i < ids.length;
    i += batchSize
  ) {
    const batch =
      ids.slice(i, i + batchSize);

    const query = batch.join(',');

    try {
      const data = await mlRequest(
        account,
        `/items?ids=${encodeURIComponent(query)}`
      );

      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry?.body) {
            all.push(entry.body);
          }
        }
      }
    } catch (error) {
      console.error(
        'Erro ao consultar lote de anúncios:',
        error
      );
    }
  }

  return all;
}

function normalizeItem(item) {
  const shipping =
    item.shipping || {};

  const price =
    Number(item.price) || 0;

  const available =
    Number(item.available_quantity) || 0;

  let shippingCost = 0;

  if (
    shipping.cost !== undefined &&
    shipping.cost !== null
  ) {
    shippingCost =
      Number(shipping.cost) || 0;
  }

  const freeShipping =
    shipping.free_shipping === true;

  const saleFee =
    Number(
      item.sale_fee ||
      item.sale_fees ||
      0
    ) || 0;

  const netReceived =
    price -
    saleFee -
    shippingCost;

  return {
    id: item.id,
    title: item.title || '',
    sku:
      item.seller_custom_field ||
      item.seller_sku ||
      '',
    price,
    sale_fee: saleFee,
    shipping_cost: shippingCost,
    net_received: netReceived,
    available_quantity: available,
    status: item.status || '',
    listing_type_id:
      item.listing_type_id || '',
    thumbnail:
      item.thumbnail || '',
    permalink:
      item.permalink || '',
    free_shipping: freeShipping,
    category_id:
      item.category_id || '',
    condition:
      item.condition || '',
    sold_quantity:
      Number(item.sold_quantity) || 0
  };
}

app.get('/api/anuncios', async (req, res) => {
  try {
    const result = getAccountForRequest(req, res);

    if (!result) return;

    const { account } = result;

    const ids =
      await getAllActiveItemIds(account);

    const items =
      await getItemDetails(account, ids);

    res.json({
      ok: true,
      conta: accountPublic(account),
      total: items.length,
      itens: items.map(normalizeItem)
    });
  } catch (error) {
    console.error('/api/anuncios:', error);

    res.status(
      error.status || 500
    ).json({
      erro: safeError(error),
      detalhe: error.data || null
    });
  }
});

/*
|--------------------------------------------------------------------------
| SINCRONIZAR PREÇOS
|--------------------------------------------------------------------------
*/

app.post(
  '/api/sincronizar-precos',
  async (req, res) => {
    try {
      const result =
        getAccountForRequest(req, res);

      if (!result) return;

      const { account } = result;

      const precos = req.body?.precos || {};

      const ids =
        Object.keys(precos);

      const atualizados = {};

      for (const id of ids) {
        try {
          const item =
            await mlRequest(
              account,
              `/items/${encodeURIComponent(id)}`
            );

          atualizados[id] =
            Number(item.price) || 0;
        } catch (error) {
          atualizados[id] = null;
        }
      }

      res.json({
        ok: true,
        precos: atualizados
      });
    } catch (error) {
      console.error(
        '/api/sincronizar-precos:',
        error
      );

      res.status(
        error.status || 500
      ).json({
        erro: safeError(error)
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SINCRONIZAR FRETES
|--------------------------------------------------------------------------
*/

app.post(
  '/api/sincronizar-fretes',
  async (req, res) => {
    try {
      const result =
        getAccountForRequest(req, res);

      if (!result) return;

      const { account } = result;

      const fretes =
        req.body?.fretes || {};

      const ids =
        Object.keys(fretes);

      const resposta = {};

      for (const id of ids) {
        try {
          const item =
            await mlRequest(
              account,
              `/items/${encodeURIComponent(id)}`
            );

          const shipping =
            item.shipping || {};

          resposta[id] = {
            custo:
              Number(shipping.cost) || 0,

            gratis:
              shipping.free_shipping === true
          };
        } catch {
          resposta[id] = {
            custo: 0,
            gratis: false
          };
        }
      }

      res.json({
        ok: true,
        fretes: resposta
      });
    } catch (error) {
      console.error(
        '/api/sincronizar-fretes:',
        error
      );

      res.status(
        error.status || 500
      ).json({
        erro: safeError(error)
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| ATUALIZAR PREÇOS
|--------------------------------------------------------------------------
*/

app.post(
  '/api/atualizar-precos',
  async (req, res) => {
    try {
      const result =
        getAccountForRequest(req, res);

      if (!result) return;

      const { account } = result;

      const itens =
        Array.isArray(req.body?.itens)
          ? req.body.itens
          : [];

      if (!itens.length) {
        return res.status(400).json({
          erro: 'Nenhum item enviado.'
        });
      }

      const resultados = [];

      for (const item of itens) {
        const id =
          String(item.id || '');

        const price =
          Number(item.price);

        if (!id || !Number.isFinite(price)) {
          resultados.push({
            id,
            sucesso: false,
            erro: 'ID ou preço inválido.'
          });

          continue;
        }

        try {
          const atualizado =
            await mlRequest(
              account,
              `/items/${encodeURIComponent(id)}`,
              {
                method: 'PUT',
                headers: {
                  'Content-Type':
                    'application/json'
                },
                body: JSON.stringify({
                  price
                })
              }
            );

          resultados.push({
            id,
            sucesso: true,
            price:
              Number(atualizado?.price) ||
              price
          });
        } catch (error) {
          resultados.push({
            id,
            sucesso: false,
            erro: safeError(error),
            detalhe: error.data || null
          });
        }
      }

      const falhas =
        resultados.filter(
          x => !x.sucesso
        );

      res.json({
        ok: falhas.length === 0,
        total: resultados.length,
        sucesso:
          resultados.length - falhas.length,
        falhas: falhas.length,
        resultados
      });
    } catch (error) {
      console.error(
        '/api/atualizar-precos:',
        error
      );

      res.status(
        error.status || 500
      ).json({
        erro: safeError(error)
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| DASHBOARD
|--------------------------------------------------------------------------
*/

function startOfDay(date) {
  const d = new Date(date);

  d.setHours(
    0,
    0,
    0,
    0
  );

  return d;
}

function formatDateML(date) {
  return new Date(date)
    .toISOString();
}

async function fetchOrdersWindow(
  account,
  from,
  to
) {
  const orders = [];

  const limit = 50;

  let offset = 0;

  while (true) {
    const url =
      `/orders/search?seller=${encodeURIComponent(
        account.seller_id
      )}` +
      `&order.status=paid` +
      `&order.date_created.from=${encodeURIComponent(
        formatDateML(from)
      )}` +
      `&order.date_created.to=${encodeURIComponent(
        formatDateML(to)
      )}` +
      `&sort=date_desc` +
      `&limit=${limit}` +
      `&offset=${offset}`;

    const data =
      await mlRequest(
        account,
        url
      );

    const results =
      Array.isArray(data?.results)
        ? data.results
        : [];

    orders.push(...results);

    const total =
      Number(data?.paging?.total) ||
      results.length;

    offset += limit;

    if (
      results.length < limit ||
      offset >= total
    ) {
      break;
    }

    /*
     * Segurança para evitar loops.
     */
    if (offset > 10000) {
      break;
    }
  }

  return orders;
}

app.get('/api/dashboard', async (req, res) => {
  try {
    const result =
      getAccountForRequest(req, res);

    if (!result) return;

    const { account } = result;

    const dias = 60;

    const end =
      new Date();

    const start =
      new Date(
        end.getTime() -
        dias *
          24 *
          60 *
          60 *
          1000
      );

    /*
     * Divide em janelas de 15 dias.
     */
    const windows = [];

    let cursor =
      new Date(start);

    while (cursor < end) {
      const windowEnd =
        new Date(
          Math.min(
            cursor.getTime() +
              15 *
                24 *
                60 *
                60 *
                1000,
            end.getTime()
          )
        );

      windows.push([
        new Date(cursor),
        windowEnd
      ]);

      cursor = windowEnd;
    }

    const allOrders = [];

    for (const [from, to] of windows) {
      try {
        const orders =
          await fetchOrdersWindow(
            account,
            from,
            to
          );

        allOrders.push(...orders);
      } catch (error) {
        console.error(
          'Erro ao buscar janela de pedidos:',
          error
        );
      }
    }

    /*
     * Remove duplicados.
     */
    const orderMap = new Map();

    for (const order of allOrders) {
      if (order?.id) {
        orderMap.set(
          String(order.id),
          order
        );
      }
    }

    const orders =
      [...orderMap.values()]
      .filter(
        order =>
          order.status === 'paid' ||
          !order.status
      );

    let faturamento = 0;
    let unidades = 0;

    const products = new Map();

    for (const order of orders) {
      const total =
        Number(
          order.total_amount
        ) || 0;

      faturamento += total;

      const orderItems =
        Array.isArray(
          order.order_items
        )
          ? order.order_items
          : [];

      for (const orderItem of orderItems) {
        const item =
          orderItem.item || {};

        const quantity =
          Number(
            orderItem.quantity
          ) || 0;

        const unitPrice =
          Number(
            orderItem.unit_price
          ) || 0;

        unidades += quantity;

        const id =
          item.id ||
          item.title ||
          'sem-id';

        if (!products.has(id)) {
          products.set(id, {
            id,
            title:
              item.title ||
              'Produto sem nome',
            quantity: 0,
            revenue: 0
          });
        }

        const product =
          products.get(id);

        product.quantity +=
          quantity;

        product.revenue +=
          quantity *
          unitPrice;
      }
    }

    const top10 =
      [...products.values()]
        .sort(
          (a, b) =>
            b.quantity -
            a.quantity
        )
        .slice(0, 10);

    /*
     * Série dos últimos 60 dias.
     */
    const seriesMap =
      new Map();

    for (let i = 0; i < dias; i++) {
      const date =
        new Date(
          start.getTime() +
            i *
              24 *
              60 *
              60 *
              1000
        );

      const key =
        date
          .toISOString()
          .slice(0, 10);

      seriesMap.set(
        key,
        {
          data: key,
          vendas: 0,
          faturamento: 0
        }
      );
    }

    for (const order of orders) {
      const created =
        order.date_created ||
        order.date_closed;

      if (!created) continue;

      const key =
        new Date(created)
          .toISOString()
          .slice(0, 10);

      if (!seriesMap.has(key)) {
        continue;
      }

      const entry =
        seriesMap.get(key);

      entry.vendas += 1;

      entry.faturamento +=
        Number(
          order.total_amount
        ) || 0;
    }

    const series60 =
      [...seriesMap.values()];

    const ticketMedio =
      orders.length > 0
        ? faturamento /
          orders.length
        : 0;

    /*
     * Dados de anúncios.
     */
    let anuncios = [];

    try {
      const ids =
        await getAllActiveItemIds(
          account
        );

      const details =
        await getItemDetails(
          account,
          ids
        );

      anuncios =
        details.map(
          normalizeItem
        );
    } catch (error) {
      console.error(
        'Erro ao carregar anúncios do dashboard:',
        error
      );
    }

    const estoque =
      anuncios.reduce(
        (sum, item) =>
          sum +
          Number(
            item.available_quantity
          ),
        0
      );

    const valorEstoque =
      anuncios.reduce(
        (sum, item) =>
          sum +
          Number(item.price) *
            Number(
              item.available_quantity
            ),
        0
      );

    const precoMedio =
      anuncios.length > 0
        ? anuncios.reduce(
            (sum, item) =>
              sum +
              Number(item.price),
            0
          ) /
          anuncios.length
        : 0;

    const premium =
      anuncios.filter(
        item =>
          item.listing_type_id ===
          'gold_pro'
      ).length;

    const classic =
      anuncios.filter(
        item =>
          item.listing_type_id ===
          'gold_special'
      ).length;

    res.json({
      ok: true,

      periodo_dias: dias,

      conta: accountPublic(
        account
      ),

      total_pedidos:
        orders.length,

      vendas_60_dias:
        orders.length,

      total_vendas_60_dias:
        orders.length,

      total_unidades:
        unidades,

      faturamento_60_dias:
        faturamento,

      ticket_medio:
        ticketMedio,

      estoque_total:
        estoque,

      valor_estoque:
        valorEstoque,

      anuncios_ativos:
        anuncios.length,

      preco_medio:
        precoMedio,

      premium,

      classic,

      top_10:
        top10,

      series_60_dias:
        series60,

      ultima_atualizacao:
        new Date().toISOString()
    });
  } catch (error) {
    console.error(
      '/api/dashboard:',
      error
    );

    res.status(
      error.status || 500
    ).json({
      erro: safeError(error),
      detalhe: error.data || null
    });
  }
});

/*
|--------------------------------------------------------------------------
| ERROS
|--------------------------------------------------------------------------
*/

app.use((req, res) => {
  res.status(404).json({
    erro: 'Rota não encontrada.',
    rota: req.originalUrl
  });
});

app.use((error, req, res, next) => {
  console.error(
    'Erro global:',
    error
  );

  if (res.headersSent) {
    return next(error);
  }

  res.status(500).json({
    erro:
      error.message ||
      'Erro interno do servidor.'
  });
});

/*
|--------------------------------------------------------------------------
| LIMPEZA
|--------------------------------------------------------------------------
*/

setInterval(() => {
  const expiration =
    now() -
    10 * 60 * 1000;

  for (const [
    state,
    data
  ] of oauthStates.entries()) {
    if (data.createdAt < expiration) {
      oauthStates.delete(state);
    }
  }

  /*
   * Sessões inativas há mais de 30 dias.
   */
  const sessionExpiration =
    now() -
    30 *
      24 *
      60 *
      60 *
      1000;

  for (const [
    id,
    session
  ] of sessions.entries()) {
    if (
      session.lastAccess <
      sessionExpiration
    ) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

/*
|--------------------------------------------------------------------------
| HTML ESCAPE
|--------------------------------------------------------------------------
*/

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeJs(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r');
}

/*
|--------------------------------------------------------------------------
| START
|--------------------------------------------------------------------------
*/

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log(
      `ML Hub Pro rodando na porta ${PORT}`
    );

    console.log(
      `Frontend: ${FRONTEND_URL}`
    );

    console.log(
      `Redirect URI: ${ML_REDIRECT_URI}`
    );

    console.log(
      `Client ID configurado: ${
        ML_CLIENT_ID ? 'SIM' : 'NÃO'
      }`
    );

    console.log(
      `Client Secret configurado: ${
        ML_CLIENT_SECRET ? 'SIM' : 'NÃO'
      }`
    );
  }
);
