const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { Pool } = require('pg');

const fetch = (...args) =>
    import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();

app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;
const ML_API = 'https://api.mercadolibre.com';
const OAUTH_FILE = process.env.ML_OAUTH_FILE || path.join(__dirname, 'ml-oauth-store.json');
const DEFAULT_FRONTEND_URL = process.env.FRONTEND_URL || 'https://joyjhonatan0-lang.github.io/Site-Atualizar-pre-o-ml/';

const ML_HUB_ADMIN_EMAIL = String(process.env.ML_HUB_ADMIN_EMAIL || '').trim().toLowerCase();
const ML_HUB_ADMIN_PASSWORD = String(process.env.ML_HUB_ADMIN_PASSWORD || '');
const ML_HUB_SESSION_SECRET = String(
    process.env.ML_HUB_SESSION_SECRET ||
    process.env.ML_CLIENT_SECRET ||
    crypto.randomBytes(48).toString('hex')
);
const ML_HUB_TOKEN_ENCRYPTION_KEY = String(process.env.ML_HUB_TOKEN_ENCRYPTION_KEY || '');
const ML_HUB_ALLOW_LEGACY_TOKEN = /^(1|true|yes)$/i.test(String(process.env.ML_HUB_ALLOW_LEGACY_TOKEN || 'false'));

const ML_APP_CLIENT_ID = String(process.env.ML_CLIENT_ID || '').trim();
const ML_APP_CLIENT_SECRET = String(process.env.ML_CLIENT_SECRET || '').trim();
const ML_APP_REDIRECT_URI = String(
    process.env.ML_REDIRECT_URI ||
    'https://site-atualizar-pre-o-ml.onrender.com/auth/callback'
).trim();

const FRONTEND_ORIGIN = (() => {
    try { return new URL(DEFAULT_FRONTEND_URL).origin; }
    catch { return 'https://joyjhonatan0-lang.github.io'; }
})();

const EXTRA_ALLOWED_ORIGINS = String(process.env.ML_HUB_ALLOWED_ORIGINS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);

const ALLOWED_ORIGINS = new Set([
    FRONTEND_ORIGIN,
    ...EXTRA_ALLOWED_ORIGINS,
    'http://localhost:3000',
    'http://127.0.0.1:5500'
]);

const APP_AUTH_CONFIGURED = Boolean(ML_HUB_ADMIN_EMAIL && ML_HUB_ADMIN_PASSWORD);

const ML_HUB_SAAS_AUTH = !/^(0|false|no)$/i.test(String(process.env.ML_HUB_SAAS_AUTH || 'true'));
const ML_HUB_ALLOW_SIGNUP = !/^(0|false|no)$/i.test(String(process.env.ML_HUB_ALLOW_SIGNUP || 'true'));
const ML_HUB_TOKEN_KEY_V95 = crypto.createHash('sha256')
    .update(ML_HUB_TOKEN_ENCRYPTION_KEY || ML_HUB_SESSION_SECRET)
    .digest();
const refreshLocksV95 = new Map();

app.disable('x-powered-by');

app.use(cors({
    origin(origin, callback) {
        if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true);
        return callback(new Error('Origem não autorizada pelo ML Hub Pro.'));
    },
    credentials: true,
    methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization','Accept','X-Requested-With']
}));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
});

function cookiesV94(req) {
    const raw = String(req.headers.cookie || '');
    const out = {};
    raw.split(';').forEach(parte => {
        const i = parte.indexOf('=');
        if (i < 0) return;
        const k = parte.slice(0, i).trim();
        const v = parte.slice(i + 1).trim();
        try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
    });
    return out;
}

function base64urlV94(value) {
    return Buffer.from(value).toString('base64url');
}

function assinaturaV94(payload) {
    return crypto.createHmac('sha256', ML_HUB_SESSION_SECRET).update(payload).digest('base64url');
}

function criarSessaoV94(identidade, remember = false) {
    const ttl = remember ? 30 * 24 * 60 * 60 : 12 * 60 * 60;
    const dados = typeof identidade === 'string'
        ? { email: String(identidade || '').toLowerCase() }
        : (identidade || {});

    const payload = base64urlV94(JSON.stringify({
        sub: String(dados.email || '').toLowerCase(),
        uid: dados.user_id ? String(dados.user_id) : null,
        wid: dados.workspace_id ? String(dados.workspace_id) : null,
        name: dados.name ? String(dados.name) : null,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + ttl,
        nonce: crypto.randomBytes(10).toString('hex')
    }));
    return { token: `${payload}.${assinaturaV94(payload)}`, ttl };
}

function validarSessaoV94(token) {
    try {
        const [payload, sig] = String(token || '').split('.');
        if (!payload || !sig) return null;
        const esperado = assinaturaV94(payload);
        const a = Buffer.from(sig);
        const b = Buffer.from(esperado);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!data?.exp || Date.now() / 1000 >= Number(data.exp)) return null;
        return data;
    } catch { return null; }
}

function setCookieSessaoV94(res, token, ttl) {
    res.setHeader(
        'Set-Cookie',
        `mlhub_session_v94=${encodeURIComponent(token)}; Max-Age=${ttl}; Path=/; HttpOnly; Secure; SameSite=None`
    );
}

function limparCookieSessaoV94(res) {
    res.setHeader(
        'Set-Cookie',
        'mlhub_session_v94=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None'
    );
}

function sessaoAtualV94(req) {
    return validarSessaoV94(cookiesV94(req).mlhub_session_v94);
}

const tentativasLoginV94 = new Map();

function ipV94(req) {
    return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
        .split(',')[0].trim().slice(0, 120);
}

function loginPermitidoV94(req) {
    const chave = ipV94(req) || 'desconhecido';
    const agora = Date.now();
    const janela = 15 * 60 * 1000;
    const atual = tentativasLoginV94.get(chave) || { inicio: agora, tentativas: 0 };
    if (agora - atual.inicio > janela) {
        tentativasLoginV94.set(chave, { inicio: agora, tentativas: 0 });
        return true;
    }
    return atual.tentativas < 8;
}

function registrarFalhaLoginV94(req) {
    const chave = ipV94(req) || 'desconhecido';
    const agora = Date.now();
    const atual = tentativasLoginV94.get(chave) || { inicio: agora, tentativas: 0 };
    if (agora - atual.inicio > 15 * 60 * 1000) {
        tentativasLoginV94.set(chave, { inicio: agora, tentativas: 1 });
    } else {
        atual.tentativas++;
        tentativasLoginV94.set(chave, atual);
    }
}

function limparFalhasLoginV94(req) {
    tentativasLoginV94.delete(ipV94(req) || 'desconhecido');
}

function compararSegredoV94(a, b) {
    const ha = crypto.createHash('sha256').update(String(a || '')).digest();
    const hb = crypto.createHash('sha256').update(String(b || '')).digest();
    return crypto.timingSafeEqual(ha, hb);
}

let saasInitV95 = null;

async function garantirSaasV95() {
    if (saasInitV95) return saasInitV95;
    saasInitV95 = (async () => {
        if (!db) throw new Error('DATABASE_URL é obrigatória para o modo SaaS.');

        await dbQuery(`
          CREATE TABLE IF NOT EXISTS mlhub_users_v95(
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL DEFAULT '',
            password_hash TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_login_at TIMESTAMPTZ
          )
        `);

        await dbQuery(`
          CREATE TABLE IF NOT EXISTS mlhub_workspaces_v95(
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            owner_user_id TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);

        await dbQuery(`
          CREATE TABLE IF NOT EXISTS mlhub_memberships_v95(
            workspace_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'owner',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY(workspace_id,user_id)
          )
        `);

        await dbQuery(`
          CREATE TABLE IF NOT EXISTS ml_connections_v95(
            id BIGSERIAL PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            seller_id TEXT NOT NULL,
            nickname TEXT,
            access_token_enc TEXT,
            refresh_token_enc TEXT,
            expires_at BIGINT,
            scope TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(workspace_id,seller_id)
          )
        `);

        await dbQuery(`
          CREATE INDEX IF NOT EXISTS idx_ml_connections_v95_user_active
          ON ml_connections_v95(user_id,is_active,updated_at DESC)
        `);

        await dbQuery(`
          CREATE INDEX IF NOT EXISTS idx_ml_connections_v95_seller
          ON ml_connections_v95(seller_id,updated_at DESC)
        `);
    })().catch(e => {
        saasInitV95 = null;
        throw e;
    });
    return saasInitV95;
}

function hashSenhaV95(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
    return `scrypt$${salt}$${hash}`;
}

function validarSenhaV95(password, stored) {
    try {
        const [alg, salt, hash] = String(stored || '').split('$');
        if (alg !== 'scrypt' || !salt || !hash) return false;
        const atual = crypto.scryptSync(String(password || ''), salt, 64);
        const esperado = Buffer.from(hash, 'hex');
        return atual.length === esperado.length && crypto.timingSafeEqual(atual, esperado);
    } catch { return false; }
}

function emailValidoV95(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

function criptografarV95(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', ML_HUB_TOKEN_KEY_V95, iv);
    const enc = Buffer.concat([
        cipher.update(String(valor), 'utf8'),
        cipher.final()
    ]);
    return JSON.stringify({
        v: 1,
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        data: enc.toString('base64')
    });
}

function descriptografarV95(envelope) {
    if (!envelope) return null;
    try {
        const obj = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            ML_HUB_TOKEN_KEY_V95,
            Buffer.from(obj.iv, 'base64')
        );
        decipher.setAuthTag(Buffer.from(obj.tag, 'base64'));
        return Buffer.concat([
            decipher.update(Buffer.from(obj.data, 'base64')),
            decipher.final()
        ]).toString('utf8');
    } catch {
        return null;
    }
}

async function usuarioPorEmailV95(email) {
    await garantirSaasV95();
    const r = await dbQuery(`
      SELECT u.id,u.email,u.name,u.password_hash,u.status,
             m.workspace_id,m.role,w.name workspace_name
      FROM mlhub_users_v95 u
      LEFT JOIN mlhub_memberships_v95 m ON m.user_id=u.id
      LEFT JOIN mlhub_workspaces_v95 w ON w.id=m.workspace_id
      WHERE u.email=$1
      ORDER BY CASE WHEN m.role='owner' THEN 0 ELSE 1 END,m.created_at
      LIMIT 1
    `, [String(email || '').toLowerCase()]);
    return r.rows[0] || null;
}

async function criarUsuarioV95({ email, name, password }) {
    await garantirSaasV95();

    const userId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(name || '').trim().slice(0, 120);
    const passHash = hashSenhaV95(password);

    const client = await dbConnectComRetryV104();
    try {
        await client.query('BEGIN');

        await client.query(`
          INSERT INTO mlhub_users_v95(id,email,name,password_hash)
          VALUES($1,$2,$3,$4)
        `, [userId, cleanEmail, cleanName, passHash]);

        await client.query(`
          INSERT INTO mlhub_workspaces_v95(id,name,owner_user_id)
          VALUES($1,$2,$3)
        `, [workspaceId, cleanName ? `${cleanName} · ML Hub Pro` : 'Meu ML Hub Pro', userId]);

        await client.query(`
          INSERT INTO mlhub_memberships_v95(workspace_id,user_id,role)
          VALUES($1,$2,'owner')
        `, [workspaceId, userId]);

        await client.query('COMMIT');

        return {
            id: userId,
            email: cleanEmail,
            name: cleanName,
            workspace_id: workspaceId,
            role: 'owner'
        };
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw e;
    } finally {
        client.release();
    }
}

async function conexaoAtivaUsuarioV95(userId, workspaceId) {
    await garantirSaasV95();
    const r = await dbQuery(`
      SELECT *
      FROM ml_connections_v95
      WHERE user_id=$1
        AND workspace_id=$2
        AND is_active=TRUE
      ORDER BY updated_at DESC
      LIMIT 1
    `, [String(userId), String(workspaceId)]);
    return r.rows[0] || null;
}

async function conexaoPorIdV95(connectionId, userId, workspaceId) {
    await garantirSaasV95();
    const r = await dbQuery(`
      SELECT *
      FROM ml_connections_v95
      WHERE id=$1 AND user_id=$2 AND workspace_id=$3
      LIMIT 1
    `, [Number(connectionId), String(userId), String(workspaceId)]);
    return r.rows[0] || null;
}

async function renovarConexaoV95(conexao, forcar = false) {
    if (!conexao) return null;

    const expiresAt = Number(conexao.expires_at || 0);
    const access = descriptografarV95(conexao.access_token_enc);

    if (
        !forcar &&
        access &&
        (!expiresAt || Date.now() < expiresAt - 120000)
    ) {
        return access;
    }

    const refresh = descriptografarV95(conexao.refresh_token_enc);
    if (!refresh || !ML_APP_CLIENT_ID || !ML_APP_CLIENT_SECRET) {
        return access || null;
    }

    const lockKey = String(conexao.id);
    if (refreshLocksV95.has(lockKey)) return refreshLocksV95.get(lockKey);

    const p = (async () => {
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: ML_APP_CLIENT_ID,
            client_secret: ML_APP_CLIENT_SECRET,
            refresh_token: refresh
        });

        const r = await fetch(`${ML_API}/oauth/token`, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/x-www-form-urlencoded'
            },
            body
        });

        const d = await jsonSeguro(r);
        if (!r.ok || !d.access_token) {
            throw new Error(formatarErroMercadoLivre(d) || 'Não foi possível renovar o token da conta.');
        }

        const expires = Date.now() + Number(d.expires_in || 21600) * 1000;

        await dbQuery(`
          UPDATE ml_connections_v95 SET
            access_token_enc=$2,
            refresh_token_enc=COALESCE($3,refresh_token_enc),
            expires_at=$4,
            scope=COALESCE($5,scope),
            updated_at=NOW()
          WHERE id=$1
        `, [
            conexao.id,
            criptografarV95(d.access_token),
            d.refresh_token ? criptografarV95(d.refresh_token) : null,
            expires,
            d.scope || null
        ]);

        return d.access_token;
    })();

    refreshLocksV95.set(lockKey, p);
    try { return await p; }
    finally { refreshLocksV95.delete(lockKey); }
}

async function tokenParaSellerV95(sellerId) {
    await garantirSaasV95();
    const r = await dbQuery(`
      SELECT *
      FROM ml_connections_v95
      WHERE seller_id=$1
      ORDER BY updated_at DESC
      LIMIT 1
    `, [String(sellerId)]);
    const c = r.rows[0] || null;
    if (!c) return null;
    return renovarConexaoV95(c, false);
}

app.post('/api/app/login', async (req, res) => {
    if (!ML_HUB_SAAS_AUTH) {
        return res.json({
            sucesso: true,
            configured: false,
            authenticated: true,
            modo: 'compatibilidade'
        });
    }

    if (!loginPermitidoV94(req)) {
        return respostaErro(res, 429, 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.');
    }

    try {
        if (!db) return respostaErro(res, 503, 'PostgreSQL é obrigatório para o login multiusuário.');

        const email = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');
        const remember = Boolean(req.body?.remember);

        if (!email || !password) {
            return respostaErro(res, 400, 'Informe e-mail e senha.');
        }

        await garantirSaasV95();
        let user = await usuarioPorEmailV95(email);

        if (
            !user &&
            APP_AUTH_CONFIGURED &&
            compararSegredoV94(email, ML_HUB_ADMIN_EMAIL) &&
            compararSegredoV94(password, ML_HUB_ADMIN_PASSWORD)
        ) {
            try {
                await criarUsuarioV95({
                    email,
                    name: 'Administrador',
                    password
                });
            } catch (e) {
                if (!String(e?.code || '').includes('23505')) throw e;
            }
            user = await usuarioPorEmailV95(email);
        }

        if (!user || user.status !== 'active' || !validarSenhaV95(password, user.password_hash)) {
            registrarFalhaLoginV94(req);
            return respostaErro(res, 401, 'E-mail ou senha inválidos.');
        }

        limparFalhasLoginV94(req);

        await dbQuery(`
          UPDATE mlhub_users_v95
          SET last_login_at=NOW(),updated_at=NOW()
          WHERE id=$1
        `, [user.id]);

        const sessao = criarSessaoV94({
            email: user.email,
            user_id: user.id,
            workspace_id: user.workspace_id,
            name: user.name
        }, remember);

        setCookieSessaoV94(res, sessao.token, sessao.ttl);

        return res.json({
            sucesso: true,
            configured: true,
            authenticated: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                workspace_id: user.workspace_id,
                workspace_name: user.workspace_name,
                role: user.role
            }
        });
    } catch (e) {
        console.error('[LOGIN V95]', e);
        return respostaErro(res, 500, 'Erro ao entrar: ' + e.message);
    }
});

app.post('/api/app/register', async (req, res) => {
    if (!ML_HUB_SAAS_AUTH) {
        return respostaErro(res, 409, 'Cadastro multiusuário está desativado.');
    }
    if (!ML_HUB_ALLOW_SIGNUP) {
        return respostaErro(res, 403, 'Novos cadastros estão temporariamente fechados.');
    }
    if (!db) return respostaErro(res, 503, 'PostgreSQL é obrigatório para criar contas.');

    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const name = String(req.body?.name || '').trim();
        const password = String(req.body?.password || '');
        const remember = Boolean(req.body?.remember);

        if (!emailValidoV95(email)) {
            return respostaErro(res, 400, 'Informe um e-mail válido.');
        }
        if (name.length < 2) {
            return respostaErro(res, 400, 'Informe seu nome ou nome da empresa.');
        }
        if (password.length < 10) {
            return respostaErro(res, 400, 'A senha precisa ter pelo menos 10 caracteres.');
        }

        const existente = await usuarioPorEmailV95(email);
        if (existente) {
            return respostaErro(res, 409, 'Já existe uma conta com este e-mail.');
        }

        const user = await criarUsuarioV95({ email, name, password });
        const sessao = criarSessaoV94({
            email: user.email,
            user_id: user.id,
            workspace_id: user.workspace_id,
            name: user.name
        }, remember);

        setCookieSessaoV94(res, sessao.token, sessao.ttl);

        return res.status(201).json({
            sucesso: true,
            authenticated: true,
            user
        });
    } catch (e) {
        if (String(e?.code || '') === '23505') {
            return respostaErro(res, 409, 'Já existe uma conta com este e-mail.');
        }
        console.error('[REGISTER V95]', e);
        return respostaErro(res, 500, 'Erro ao criar conta: ' + e.message);
    }
});

app.get('/api/app/session', async (req, res) => {
    if (!ML_HUB_SAAS_AUTH) {
        return res.json({
            configured: false,
            authenticated: true,
            modo: 'compatibilidade'
        });
    }

    const sessao = sessaoAtualV94(req);
    if (!sessao) {
        return res.json({
            configured: true,
            authenticated: false
        });
    }

    let user = null;
    try {
        if (db && sessao.uid) {
            await garantirSaasV95();
            const r = await dbQuery(`
              SELECT u.id,u.email,u.name,u.status,
                     m.workspace_id,m.role,w.name workspace_name
              FROM mlhub_users_v95 u
              JOIN mlhub_memberships_v95 m ON m.user_id=u.id
              JOIN mlhub_workspaces_v95 w ON w.id=m.workspace_id
              WHERE u.id=$1 AND m.workspace_id=$2
              LIMIT 1
            `, [String(sessao.uid), String(sessao.wid)]);
            user = r.rows[0] || null;
        }
    } catch (e) {}

    return res.json({
        configured: true,
        authenticated: true,
        email: user?.email || sessao.sub || null,
        user: user ? {
            id: user.id,
            email: user.email,
            name: user.name,
            workspace_id: user.workspace_id,
            workspace_name: user.workspace_name,
            role: user.role
        } : {
            id: sessao.uid || null,
            email: sessao.sub || null,
            name: sessao.name || null,
            workspace_id: sessao.wid || null
        }
    });
});

app.post('/api/app/logout', (req, res) => {
    limparCookieSessaoV94(res);
    return res.json({ sucesso: true });
});

app.get('/api/healthz', (req, res) => {
    res.json({
        ok: true,
        service: 'ML Hub Pro',
        version: 'ml-hub-pro-v106-sync-resiliente-postgres',
        auth_configured: ML_HUB_SAAS_AUTH,
        oauth_configured: Boolean(ML_APP_CLIENT_ID && ML_APP_CLIENT_SECRET && ML_APP_REDIRECT_URI),
        token_encryption: Boolean(ML_HUB_TOKEN_ENCRYPTION_KEY),
        database_host: hostBancoSeguroV81(),
        database_fallback_configured: Boolean(DATABASE_FALLBACK_URL),
        database_using_fallback: Boolean(dbUsandoFallbackV104)
    });
});

app.use('/api', (req, res, next) => {
    const original = String(req.originalUrl || '').split('?')[0];

    const publicos = new Set([
        '/api/app/login',
        '/api/app/register',
        '/api/app/session',
        '/api/app/logout',
        '/api/healthz',
        '/api/v104/database/status',
        '/api/version',
        '/api/notifications',
        '/api/scale/notifications'
    ]);

    if (publicos.has(original)) return next();
    if (!ML_HUB_SAAS_AUTH) return next();

    const sessao = sessaoAtualV94(req);
    if (!sessao) {
        return respostaErro(res, 401, 'Sessão do ML Hub Pro expirada. Entre novamente.');
    }

    req.mlhubUser = sessao;
    next();
});

app.use('/api', async (req, res, next) => {
    const original = String(req.originalUrl || '').split('?')[0];
    const semTokenML = new Set([
        '/api/app/login',
        '/api/app/register',
        '/api/app/session',
        '/api/app/logout',
        '/api/healthz',
        '/api/v104/database/status',
        '/api/version',
        '/api/oauth/start',
        '/api/oauth/status',
        '/api/oauth/connections',
        '/api/v94/security/status'
    ]);

    if (!ML_HUB_SAAS_AUTH || semTokenML.has(original)) return next();
    if (!req.mlhubUser?.uid || !req.mlhubUser?.wid) return next();

    try {
        const c = await conexaoAtivaUsuarioV95(req.mlhubUser.uid, req.mlhubUser.wid);
        if (c) {
            req.mlhubConnection = c;
            req.mlhubSellerId = String(c.seller_id || '');
            req.mlhubAccessToken = await renovarConexaoV95(c, false);
        }
    } catch (e) {
        console.warn('[TOKEN SESSION V95]', e.message);
    }

    next();
});

app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

    const original = String(req.originalUrl || '').split('?')[0];
    if (['/api/notifications', '/api/scale/notifications'].includes(original)) return next();

    const origin = String(req.headers.origin || '').trim();
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return respostaErro(res, 403, 'Origem não autorizada para alterar dados.');
    }

    next();
});

let auditoriaInitV94 = null;
async function garantirAuditoriaV94() {
    if (auditoriaInitV94) return auditoriaInitV94;
    auditoriaInitV94 = (async () => {
        if (typeof db === 'undefined' || !db) return;
        await dbQuery(`
          CREATE TABLE IF NOT EXISTS ml_audit_v94(
            id BIGSERIAL PRIMARY KEY,
            actor TEXT NOT NULL DEFAULT '',
            seller_id TEXT NULL,
            method TEXT NOT NULL,
            path TEXT NOT NULL,
            status INTEGER NOT NULL DEFAULT 0,
            ip TEXT NULL,
            user_agent TEXT NULL,
            request_id TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await dbQuery(`
          CREATE INDEX IF NOT EXISTS idx_ml_audit_v94_created
          ON ml_audit_v94(created_at DESC)
        `);
    })().catch(e => {
        auditoriaInitV94 = null;
        console.warn('[AUDITORIA V94]', e.message);
    });
    return auditoriaInitV94;
}

async function registrarAuditoriaV94(req, status) {
    try {
        if (typeof db === 'undefined' || !db) return;
        await garantirAuditoriaV94();
        await dbQuery(`
          INSERT INTO ml_audit_v94(
            actor,seller_id,method,path,status,ip,user_agent,request_id
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        `, [
            String(req.mlhubUser?.sub || 'app'),
            req.mlhubSellerId ? String(req.mlhubSellerId) : null,
            String(req.method || ''),
            String(req.originalUrl || '').split('?')[0].slice(0, 500),
            Number(status || 0),
            ipV94(req) || null,
            String(req.headers['user-agent'] || '').slice(0, 500) || null,
            String(req.headers['x-request-id'] || crypto.randomUUID())
        ]);
    } catch (e) {
        console.warn('[AUDITORIA V94 INSERT]', e.message);
    }
}

app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
    const original = String(req.originalUrl || '').split('?')[0];
    if (['/api/notifications', '/api/scale/notifications'].includes(original)) return next();
    res.on('finish', () => setImmediate(() => registrarAuditoriaV94(req, res.statusCode)));
    next();
});

let oauthRefreshPromise = null;

function lerOAuthStore() {
    try {
        if (!fs.existsSync(OAUTH_FILE)) return {};
        const bruto = fs.readFileSync(OAUTH_FILE, 'utf8');
        const obj = JSON.parse(bruto) || {};

        if (obj?.v === 2 && obj?.enc === 'aes-256-gcm') {
            if (!ML_HUB_TOKEN_ENCRYPTION_KEY) {
                throw new Error('ML_HUB_TOKEN_ENCRYPTION_KEY não configurada para abrir o OAuth store.');
            }

            const key = crypto.createHash('sha256')
                .update(ML_HUB_TOKEN_ENCRYPTION_KEY)
                .digest();

            const decipher = crypto.createDecipheriv(
                'aes-256-gcm',
                key,
                Buffer.from(obj.iv, 'base64')
            );

            decipher.setAuthTag(Buffer.from(obj.tag, 'base64'));

            const texto = Buffer.concat([
                decipher.update(Buffer.from(obj.data, 'base64')),
                decipher.final()
            ]).toString('utf8');

            return JSON.parse(texto) || {};
        }

        return obj;
    } catch (erro) {
        console.error('Erro ao ler OAuth store:', erro.message);
        return {};
    }
}

function salvarOAuthStore(dados) {
    const seguro = { ...(dados || {}) };

    if (ML_HUB_TOKEN_ENCRYPTION_KEY) {
        const key = crypto.createHash('sha256')
            .update(ML_HUB_TOKEN_ENCRYPTION_KEY)
            .digest();

        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

        const encrypted = Buffer.concat([
            cipher.update(JSON.stringify(seguro), 'utf8'),
            cipher.final()
        ]);

        const envelope = {
            v: 2,
            enc: 'aes-256-gcm',
            iv: iv.toString('base64'),
            tag: cipher.getAuthTag().toString('base64'),
            data: encrypted.toString('base64')
        };

        fs.writeFileSync(
            OAUTH_FILE,
            JSON.stringify(envelope),
            { encoding: 'utf8', mode: 0o600 }
        );
        return;
    }

    fs.writeFileSync(
        OAUTH_FILE,
        JSON.stringify(seguro, null, 2),
        { encoding: 'utf8', mode: 0o600 }
    );
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

    const clientId = ML_APP_CLIENT_ID || (ML_HUB_ALLOW_LEGACY_TOKEN ? String(store.client_id || '') : '');
    const clientSecret = ML_APP_CLIENT_SECRET || (ML_HUB_ALLOW_LEGACY_TOKEN ? String(store.client_secret || '') : '');
    if (!store.refresh_token || !clientId || !clientSecret) return store.access_token || null;

    if (oauthRefreshPromise) return oauthRefreshPromise;

    oauthRefreshPromise = (async () => {
        const atual = lerOAuthStore();
        const body = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: String(atual.refresh_token)
        });

        const response = await fetch(`${ML_API}/oauth/token`, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/x-www-form-urlencoded'
            },
            body
        });

        const data = await jsonSeguro(response);

        if (!response.ok || !data.access_token) {
            throw new Error(formatarErroMercadoLivre(data) || 'Falha ao renovar Access Token.');
        }

        const novo = {
            ...atual,
            client_id: clientId,
            access_token: data.access_token,
            refresh_token: data.refresh_token || atual.refresh_token,
            expires_in: Number(data.expires_in || 21600),
            expires_at: Date.now() + Number(data.expires_in || 21600) * 1000,
            user_id: data.user_id || atual.user_id,
            scope: data.scope || atual.scope,
            updated_at: new Date().toISOString()
        };

        delete novo.client_secret;
        salvarOAuthStore(novo);
        return novo.access_token;
    })();

    try { return await oauthRefreshPromise; }
    finally { oauthRefreshPromise = null; }
}

app.get('/', (req, res) => {
    res.send('Servidor proxy do Mercado Livre online!');
});

function obterToken(req) {
    if (req?.mlhubAccessToken) return req.mlhubAccessToken;

    if (ML_HUB_ALLOW_LEGACY_TOKEN) {
        let token = req?.headers?.['authorization'];
        if (token) {
            token = token.replace(/^Bearer\s+/i, '').trim();
            if (token && token !== 'AUTO' && token !== 'null' && token !== 'undefined') {
                return token;
            }
        }
    }

    return null;
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

function traduzirErroMercadoLivreV46(causa = {}) {
    const code = String(causa?.code || causa?.error || '').trim();
    const msg = String(causa?.message || '').trim();
    const ref = Array.isArray(causa?.references) ? causa.references.join(', ') : String(causa?.references || '');
    const mapa = {
        'item.attributes.missing_required': 'Falta uma característica obrigatória para esta categoria.',
        'item.attribute.missing_conditional_required': 'Falta uma característica obrigatória/condicional para esta categoria.',
        'item.attributes.invalid_length': 'Uma característica ultrapassou o tamanho máximo permitido.',
        'item.price.invalid': 'O preço informado não é aceito pelo Mercado Livre.',
        'item.pictures.max': 'A quantidade de fotos ultrapassa o limite permitido nesta categoria.',
        'item.listing_type_id.requiresPictures': 'O tipo de publicação escolhido exige pelo menos uma foto.',
        'item.category_id.invalid': 'A categoria escolhida não é válida para esta publicação.',
        'item.category_id.no_listings_allowed': 'O Mercado Livre não permite novas publicações nesta categoria.',
        'item.title.invalid': 'O nome/título da publicação não é válido para esta categoria.',
        'item.attribute.product_identifier.invalid': 'O código universal do produto (GTIN/EAN/UPC) informado é inválido.'
    };
    let pt = mapa[code] || '';
    if (!pt) {
        if (/missing required|required attribute|not present/i.test(msg)) pt = 'Falta uma característica obrigatória para publicar.';
        else if (/picture.*max|max.*picture/i.test(msg)) pt = 'Há mais fotos do que a categoria permite.';
        else pt = msg || code || 'Erro não detalhado pelo Mercado Livre.';
    }
    const detalhe = [];
    if (ref) detalhe.push(`Campo/referência: ${ref}`);
    if (code) detalhe.push(`Código: ${code}`);
    return detalhe.length ? `${pt} ${detalhe.join(' · ')}` : pt;
}

function formatarErroMercadoLivre(data) {
    const causas = Array.isArray(data?.cause) ? data.cause : [];
    if (causas.length) {
        return causas.map(c => traduzirErroMercadoLivreV46(c)).filter(Boolean).join(' | ');
    }
    const base = String(data?.message || data?.error || '').trim();
    if (base) return base;
    try { return JSON.stringify(data); } catch (e) { return 'Erro não detalhado pelo Mercado Livre.'; }
}

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

app.get('/api/oauth/status', async (req, res) => {
    try {
        if (ML_HUB_SAAS_AUTH) {
            if (!req.mlhubUser?.uid || !req.mlhubUser?.wid) {
                return res.json({ connected: false });
            }

            const c = await conexaoAtivaUsuarioV95(req.mlhubUser.uid, req.mlhubUser.wid);
            if (!c) return res.json({ connected: false });

            let token = null;
            try { token = await renovarConexaoV95(c, false); } catch (e) {}

            return res.json({
                connected: Boolean(token),
                renewable: Boolean(c.refresh_token_enc && ML_APP_CLIENT_ID && ML_APP_CLIENT_SECRET),
                connection_id: Number(c.id),
                user_id: String(c.seller_id),
                seller_id: String(c.seller_id),
                nickname: c.nickname || null,
                expires_at: c.expires_at || null,
                token_preview: null,
                workspace_id: String(c.workspace_id)
            });
        }

        const store = lerOAuthStore();
        return res.json({
            connected: Boolean(store.access_token || store.refresh_token),
            renewable: Boolean(store.refresh_token && ML_APP_CLIENT_ID && ML_APP_CLIENT_SECRET),
            user_id: store.user_id || null,
            nickname: store.nickname || null,
            expires_at: store.expires_at || null,
            token_preview: null
        });
    } catch (e) {
        return respostaErro(res, 500, 'Erro ao consultar conexão OAuth: ' + e.message);
    }
});

app.get('/api/oauth/connections', async (req, res) => {
    if (!ML_HUB_SAAS_AUTH) {
        const s = lerOAuthStore();
        return res.json({ sucesso: true, itens: s.user_id ? [{
            id: 1,
            seller_id: String(s.user_id),
            nickname: s.nickname || 'Mercado Livre',
            is_active: true
        }] : [] });
    }

    if (!req.mlhubUser?.uid || !req.mlhubUser?.wid) {
        return respostaErro(res, 401, 'Sessão inválida.');
    }

    try {
        await garantirSaasV95();
        const r = await dbQuery(`
          SELECT id,seller_id,nickname,is_active,connected_at,updated_at
          FROM ml_connections_v95
          WHERE user_id=$1 AND workspace_id=$2
          ORDER BY is_active DESC,updated_at DESC
        `, [String(req.mlhubUser.uid), String(req.mlhubUser.wid)]);

        return res.json({
            sucesso: true,
            itens: r.rows.map(x => ({
                id: Number(x.id),
                seller_id: String(x.seller_id),
                nickname: x.nickname || 'Mercado Livre',
                is_active: Boolean(x.is_active),
                connected_at: x.connected_at,
                updated_at: x.updated_at
            }))
        });
    } catch (e) {
        return respostaErro(res, 500, 'Erro ao listar contas Mercado Livre: ' + e.message);
    }
});

app.post('/api/oauth/connections/:id/activate', async (req, res) => {
    if (!ML_HUB_SAAS_AUTH) return respostaErro(res, 409, 'Modo multiusuário desativado.');
    if (!req.mlhubUser?.uid || !req.mlhubUser?.wid) return respostaErro(res, 401, 'Sessão inválida.');

    try {
        const c = await conexaoPorIdV95(req.params.id, req.mlhubUser.uid, req.mlhubUser.wid);
        if (!c) return respostaErro(res, 404, 'Conta Mercado Livre não encontrada.');

        const client = await dbConnectComRetryV104();
        try {
            await client.query('BEGIN');
            await client.query(`
              UPDATE ml_connections_v95
              SET is_active=FALSE,updated_at=NOW()
              WHERE user_id=$1 AND workspace_id=$2
            `, [String(req.mlhubUser.uid), String(req.mlhubUser.wid)]);
            await client.query(`
              UPDATE ml_connections_v95
              SET is_active=TRUE,updated_at=NOW()
              WHERE id=$1
            `, [Number(c.id)]);
            await client.query('COMMIT');
        } catch (e) {
            try { await client.query('ROLLBACK'); } catch (_) {}
            throw e;
        } finally {
            client.release();
        }

        return res.json({
            sucesso: true,
            seller_id: String(c.seller_id),
            nickname: c.nickname || null
        });
    } catch (e) {
        return respostaErro(res, 500, 'Erro ao trocar conta Mercado Livre: ' + e.message);
    }
});

app.get('/api/version', (req, res) => {
    res.json({
        ok: true,
        service: 'ML Hub Pro',
        version: 'ml-hub-pro-v106-sync-resiliente-postgres',
        oauth_callback: '/auth/callback',
        oauth_start: '/api/oauth/start'
    });
});

function frontendSeguroV94(valor) {
    try {
        const u = new URL(String(valor || DEFAULT_FRONTEND_URL));
        if (ALLOWED_ORIGINS.has(u.origin)) {
            return `${u.origin}${u.pathname || '/'}`;
        }
    } catch {}
    return DEFAULT_FRONTEND_URL;
}

function criarTransacaoOAuthV94(frontendUrl, identidade = null) {
    if (!ML_APP_CLIENT_ID || !ML_APP_CLIENT_SECRET || !ML_APP_REDIRECT_URI) {
        const e = new Error('Configure as credenciais da APLICAÇÃO ML Hub Pro no Render.');
        e.status = 503;
        throw e;
    }

    if (ML_HUB_SAAS_AUTH && (!identidade?.uid || !identidade?.wid)) {
        const e = new Error('Entre no ML Hub Pro antes de conectar uma conta Mercado Livre.');
        e.status = 401;
        throw e;
    }

    const state = crypto.randomBytes(24).toString('hex');
    const codeVerifier = crypto.randomBytes(48).toString('base64url');
    const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

    const payload = base64urlV94(JSON.stringify({
        state,
        verifier: codeVerifier,
        frontend: frontendSeguroV94(frontendUrl),
        uid: identidade?.uid || null,
        wid: identidade?.wid || null,
        email: identidade?.sub || null,
        exp: Math.floor(Date.now() / 1000) + 15 * 60
    }));

    const token = `${payload}.${assinaturaV94(payload)}`;

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: ML_APP_CLIENT_ID,
        redirect_uri: ML_APP_REDIRECT_URI,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
    });

    return {
        cookie: token,
        authorization_url: `https://auth.mercadolivre.com.br/authorization?${params.toString()}`
    };
}

function lerTransacaoOAuthV94(req) {
    const raw = cookiesV94(req).mlhub_oauth_tx_v94;
    return validarSessaoV94(raw);
}

function setCookieOAuthV94(res, token) {
    res.setHeader(
        'Set-Cookie',
        `mlhub_oauth_tx_v94=${encodeURIComponent(token)}; Max-Age=900; Path=/; HttpOnly; Secure; SameSite=None`
    );
}

function limparCookieOAuthV94(res) {
    res.setHeader(
        'Set-Cookie',
        'mlhub_oauth_tx_v94=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None'
    );
}

app.get('/api/v94/security/status', async (req, res) => {
    let connected = false, sellerId = null, nickname = null;
    try {
        if (ML_HUB_SAAS_AUTH && req.mlhubUser?.uid && req.mlhubUser?.wid) {
            const c = await conexaoAtivaUsuarioV95(req.mlhubUser.uid, req.mlhubUser.wid);
            connected = Boolean(c);
            sellerId = c?.seller_id || null;
            nickname = c?.nickname || null;
        } else {
            const store = lerOAuthStore();
            connected = Boolean(store.access_token || store.refresh_token);
            sellerId = store.user_id || null;
            nickname = store.nickname || null;
        }
    } catch (e) {}

    res.json({
        sucesso: true,
        app_auth_configured: ML_HUB_SAAS_AUTH,
        signup_enabled: ML_HUB_ALLOW_SIGNUP,
        oauth_configured: Boolean(ML_APP_CLIENT_ID && ML_APP_CLIENT_SECRET && ML_APP_REDIRECT_URI),
        token_encryption: true,
        legacy_token_enabled: ML_HUB_ALLOW_LEGACY_TOKEN,
        connected,
        seller_id: sellerId,
        nickname,
        session_user: req.mlhubUser?.sub || null,
        workspace_id: req.mlhubUser?.wid || null,
        multiuser: true,
        multiconnection: true
    });
});

app.post('/api/oauth/start', async (req, res) => {
    try {
        const tx = criarTransacaoOAuthV94(req.body?.frontend_url, req.mlhubUser);
        setCookieOAuthV94(res, tx.cookie);
        return res.json({
            sucesso: true,
            authorization_url: tx.authorization_url
        });
    } catch (e) {
        return respostaErro(res, e.status || 500, e.message);
    }
});

const oauthPendingV104 = new Map();
const OAUTH_PENDING_TTL_V104 = 20 * 60 * 1000;

function chaveOauthPendingV104(uid, wid) {
    return `${String(uid || '')}:${String(wid || '')}`;
}

function limparOauthPendingExpiradosV104() {
    const agora = Date.now();
    for (const [key, val] of oauthPendingV104.entries()) {
        if (!val || Number(val.expires_at || 0) <= agora) {
            oauthPendingV104.delete(key);
        }
    }
}

setInterval(limparOauthPendingExpiradosV104, 5 * 60 * 1000).unref?.();

function guardarOauthPendingV104(tx, tokenData, me) {
    const key = chaveOauthPendingV104(tx?.uid, tx?.wid);
    if (!tx?.uid || !tx?.wid || !key) return false;

    oauthPendingV104.set(key, {
        uid: String(tx.uid),
        wid: String(tx.wid),
        seller_id: String(tokenData?.user_id || me?.id || ''),
        nickname: me?.nickname || null,
        access_token: String(tokenData?.access_token || ''),
        refresh_token: tokenData?.refresh_token ? String(tokenData.refresh_token) : null,
        expires_in: Number(tokenData?.expires_in || 21600),
        scope: tokenData?.scope || null,
        created_at: Date.now(),
        expires_at: Date.now() + OAUTH_PENDING_TTL_V104
    });

    return true;
}

function mensagemDbOauthV104(e) {
    if (erroDnsBancoV81(e)) {
        const host = hostBancoSeguroV81();
        return 'O Mercado Livre autorizou a conta, mais o PostgreSQL não pôde ser localizado' +
          (host ? ` (${host})` : '') + '.';
    }
    return 'O Mercado Livre autorizou a conta, mas não foi possível salvar a conexão no PostgreSQL: ' + String(e?.message || e);
}

async function salvarConexaoOauthSaasV104({ uid, wid, tokenData, me }) {
    if (!db) throw Object.assign(
        new Error('PostgreSQL não configurado. Adicione DATABASE_URL no Render.'),
        { code: 'DATABASE_NOT_CONFIGURED' }
    );

    await garantirSaasV95();

    const sellerId = String(tokenData?.user_id || me?.id || '');
    const expires = Date.now() + Number(tokenData?.expires_in || 21600) * 1000;
    const client = await dbConnectComRetryV104({ tentativas: 8 });

    try {
        await client.query('BEGIN');

        await client.query(`
          UPDATE ml_connections_v95
          SET is_active=FALSE,updated_at=NOW()
          WHERE user_id=$1 AND workspace_id=$2
        `, [String(uid), String(wid)]);

        await client.query(`
          INSERT INTO ml_connections_v95(
            workspace_id,user_id,seller_id,nickname,
            access_token_enc,refresh_token_enc,expires_at,scope,
            is_active,connected_at,updated_at
          )
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,TRUE,NOW(),NOW())
          ON CONFLICT(workspace_id,seller_id) DO UPDATE SET
            user_id=EXCLUDED.user_id,
            nickname=EXCLUDED.nickname,
            access_token_enc=EXCLUDED.access_token_enc,
            refresh_token_enc=EXCLUDED.refresh_token_enc,
            expires_at=EXCLUDED.expires_at,
            scope=EXCLUDED.scope,
            is_active=TRUE,
            updated_at=NOW()
        `, [
            String(wid),
            String(uid),
            sellerId,
            me?.nickname || null,
            criptografarV95(tokenData.access_token),
            tokenData.refresh_token ? criptografarV95(tokenData.refresh_token) : null,
            expires,
            tokenData.scope || null
        ]);

        await client.query('COMMIT');
        return { sellerId, expires };
    } catch (e) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        throw e;
    } finally {
        try { client.release(); } catch (_) {}
    }
}

app.get('/auth/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query || {};
    const tx = lerTransacaoOAuthV94(req);
    const frontend = frontendSeguroV94(tx?.frontend || DEFAULT_FRONTEND_URL);

    if (error) {
        limparCookieOAuthV94(res);
        return res.redirect(`${frontend}?oauth=error&message=${encodeURIComponent(error_description || error)}`);
    }

    if (!tx || !code || !state || state !== tx.state) {
        limparCookieOAuthV94(res);
        return res.status(400).send('OAuth inválido ou expirado.');
    }

    try {
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: ML_APP_CLIENT_ID,
            client_secret: ML_APP_CLIENT_SECRET,
            code: String(code),
            redirect_uri: ML_APP_REDIRECT_URI,
            code_verifier: String(tx.verifier || '')
        });

        const tokenRes = await fetch(`${ML_API}/oauth/token`, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/x-www-form-urlencoded'
            },
            body
        });

        const tokenData = await jsonSeguro(tokenRes);

        if (!tokenRes.ok || !tokenData.access_token) {
            limparCookieOAuthV94(res);
            return res.redirect(`${frontend}?oauth=error&message=${encodeURIComponent('Erro ao gerar token: ' + formatarErroMercadoLivre(tokenData))}`);
        }

        const meRes = await fetch(`${ML_API}/users/me`, {
            headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/json' }
        });
        const me = await jsonSeguro(meRes);

        const sellerId = String(tokenData.user_id || me.id);

        if (ML_HUB_SAAS_AUTH) {
            try {
                await salvarConexaoOauthSaasV104({
                    uid: String(tx.uid),
                    wid: String(tx.wid),
                    tokenData,
                    me
                });
            } catch (dbError) {
                guardarOauthPendingV104(tx, tokenData, me);
                limparCookieOAuthV94(res);
                return res.redirect(`${frontend}?oauth=pending_database&seller=${encodeURIComponent(sellerId)}`);
            }
        } else {
            salvarOAuthStore({
                client_id: ML_APP_CLIENT_ID,
                redirect_uri: ML_APP_REDIRECT_URI,
                frontend_url: frontend,
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_at: Date.now() + Number(tokenData.expires_in || 21600) * 1000,
                user_id: sellerId,
                nickname: me.nickname || null
            });
        }

        limparCookieOAuthV94(res);
        return res.redirect(`${frontend}?oauth=success&seller=${encodeURIComponent(sellerId)}`);
    } catch (e) {
        limparCookieOAuthV94(res);
        return res.redirect(`${frontend}?oauth=error&message=${encodeURIComponent(e.message)}`);
    }
});

app.post('/api/oauth/disconnect', async (req, res) => {
    try {
        if (ML_HUB_SAAS_AUTH) {
            if (!req.mlhubUser?.uid || !req.mlhubUser?.wid) {
                return respostaErro(res, 401, 'Sessão inválida.');
            }

            const c = await conexaoAtivaUsuarioV95(req.mlhubUser.uid, req.mlhubUser.wid);
            if (c) {
                await dbQuery(`
                  DELETE FROM ml_connections_v95
                  WHERE id=$1 AND user_id=$2 AND workspace_id=$3
                `, [Number(c.id), String(req.mlhubUser.uid), String(req.mlhubUser.wid)]);
            }

            return res.json({ sucesso: true, connected: false });
        }

        limparOAuthStore();
        return res.json({ sucesso: true, connected: false });
    } catch (e) {
        return respostaErro(res, 500, 'Erro ao desconectar: ' + e.message);
    }
});

app.get('/api/anuncios', async (req, res) => {
    let token = obterToken(req);
    if (!token) return res.status(401).json({ erro: 'Token não fornecido' });

    try {
        const userRes = await mlFetch(`${ML_API}/users/me`, token);
        const userData = await jsonSeguro(userRes);

        if (!userData.id) {
            return res.status(401).json({ erro: 'Token inválido ou expirado.' });
        }

        let allIds = [];
        let scrollId = null;
        let hasMore = true;

        while (hasMore) {
            let url = `${ML_API}/users/${userData.id}/items/search?search_type=scan&limit=50`;
            if (scrollId) url += `&scroll_id=${encodeURIComponent(scrollId)}`;

            const searchRes = await mlFetch(url, token);
            const searchData = await jsonSeguro(searchRes);
            const results = searchData.results || [];

            if (results.length > 0) allIds = allIds.concat(results);
            scrollId = searchData.scroll_id;

            if (results.length === 0 || !scrollId) hasMore = false;
        }

        let listaFinal = [];
        for (let i = 0; i < allIds.length; i += 20) {
            const chunk = allIds.slice(i, i + 20);
            try {
                const multiRes = await mlFetch(`${ML_API}/items?ids=${chunk.join(',')}`, token);
                const multiData = await jsonSeguro(multiRes);

                if (Array.isArray(multiData)) {
                    for (const itemObj of multiData) {
                        if (itemObj && itemObj.code === 200 && itemObj.body) {
                            const body = itemObj.body;
                            const preco = body.price || 0;
                            const comissao = body.sale_fee || (body.listing_type_id === 'gold_pro' ? preco * 0.16 : preco * 0.11);
                            let custoEnvio = 0;
                            if (Array.isArray(body.shipping?.costs)) {
                                const custo = body.shipping.costs.find(c => Number.isFinite(Number(c?.cost)));
                                if (custo) custoEnvio = Number(custo.cost);
                            }

                            listaFinal.push({
                                id: body.id,
                                title: body.title || 'Sem Título',
                                price: preco,
                                status: body.status || 'active',
                                listing_type_id: body.listing_type_id || 'gold_special',
                                available_quantity: body.available_quantity || 0,
                                sold_quantity: Number(body.sold_quantity || 0),
                                sku: body.attributes?.find(a => a.id === 'SELLER_SKU')?.value_name || 'Sem SKU',
                                permalink: body.permalink || '#',
                                thumbnail: body.thumbnail || '',
                                sale_fee: comissao,
                                shipping_cost: custoEnvio,
                                free_shipping: Boolean(body.shipping?.free_shipping),
                                net_received: Math.max(0, preco - comissao - custoEnvio)
                            });
                        }
                    }
                }
            } catch (chunkErr) {
                console.error('Erro lote IDs:', chunkErr);
            }
        }

        res.json({ itens: listaFinal });
    } catch (e) {
        res.status(500).json({ erro: 'Erro ao processar dados da API: ' + e.message });
    }
});

app.post('/api/atualizar-preco', async (req, res) => {
    let token = obterToken(req);
    if (!token) return res.status(401).json({ erro: 'Token não fornecido' });

    const { id, price } = req.body;
    if (!id || price === undefined) return res.status(400).json({ erro: 'ID ou preço não informados.' });

    try {
        const mlRes = await mlFetch(`${ML_API}/items/${id}`, token, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ price: Number(price) })
        });
        const mlData = await jsonSeguro(mlRes);

        if (mlRes.ok) {
            res.json({ sucesso: true, resultado: mlData });
        } else {
            res.status(400).json({ erro: formatarErroMercadoLivre(mlData) });
        }
    } catch (e) {
        res.status(500).json({ erro: 'Erro de conexão ao atualizar preço: ' + e.message });
    }
});

/* =========================================================
   CONFIGURAÇÃO FINAL DO POOL V106 E INICIALIZAÇÃO DO SERVIDOR
========================================================= */

const ML_PRICE_KEEP_ALIVE_AGENT_V75 = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 15000,
    maxSockets: 64,
    maxFreeSockets: 32,
    timeout: 30000
});

async function atualizarPrecosDbLoteV26(sellerId, itens) {
    if (!db || !Array.isArray(itens) || !itens.length) return;
    const valores = [];
    const params = [];
    let idx = 1;
    for (const i of itens) {
        params.push(sellerId, String(i.id), Number(i.price));
        valores.push(`($${idx++}::bigint, $${idx++}::text, $${idx++}::numeric)`);
    }
    await dbQuery(`
        UPDATE ml_items AS m SET
          price=v.price,
          net_received=GREATEST(0, v.price - m.sale_fee - m.shipping_cost),
          synced_at=NOW()
        FROM (VALUES ${valores.join(',')}) AS v(seller_id, item_id, price)
        WHERE m.seller_id=v.seller_id AND m.item_id=v.item_id
    `, params);
}

app.post('/api/v2/anuncios/massa', async (req, res) => {
    const token = obterToken(req);
    if (!token) return respostaErro(res, 401, 'Token não fornecido.');

    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter(Boolean))];
    const acao = String(req.body?.acao || '').trim();
    const valor = req.body?.valor;

    if (!ids.length) return respostaErro(res, 400, 'Selecione ao menos um anúncio.');

    const resultados = [];
    for (const id of ids) {
        try {
            let body = {};
            if (acao === 'pausar') body = { status: 'paused' };
            if (acao === 'ativar') body = { status: 'active' };
            if (acao === 'estoque') body = { available_quantity: Math.max(0, Number(valor || 0)) };

            const putRes = await mlFetch(`${ML_API}/items/${id}`, token, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await jsonSeguro(putRes);
            if (!putRes.ok) throw new Error(formatarErroMercadoLivre(data));
            resultados.push({ id, sucesso: true });
        } catch (erro) {
            resultados.push({ id, sucesso: false, erro: erro.message });
        }
    }

    res.json({ sucesso: true, total: resultados.length, concluidos: resultados.filter(x => x.sucesso).length });
});

async function iniciarServidor() {
    if (db) {
        try {
            await aguardarPostgresProntoV80();
            await inicializarBancoEscala();
            await normalizarJobsFullSyncV106({ startup: true });
            iniciarRecoverySyncV106();
            if (ML_WORKER_ENABLED) {
                setImmediate(() => syncWorkerDedicadoV76());
            }
            console.log('[ML HUB PRO] Servidor inicializado com sucesso com suporte a PostgreSQL.');
        } catch (e) {
            console.warn('[ML HUB PRO] AVISO: PostgreSQL iniciou com limitações:', e.message);
        }
    }

    app.listen(PORT, () => {
        console.log(`[ML HUB PRO V106] Servidor rodando na porta ${PORT}`);
    });
}

iniciarServidor();
