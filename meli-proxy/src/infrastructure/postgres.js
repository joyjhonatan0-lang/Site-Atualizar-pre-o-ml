'use strict';

/**
 * Infraestrutura PostgreSQL do ML Hub Pro.
 * Mantém o pool, retries, fallback e monitoramento de clientes em um módulo isolado.
 */
function createPostgresInfrastructure(options={}){
    const Pool=options.Pool;
    const DATABASE_URL=String(options.databaseUrl||'');
    const DATABASE_FALLBACK_URL=String(options.fallbackUrl||'');
    const NODE_ENV=String(options.nodeEnv||'');
    const POOL_MAX=options.poolMax;
    const onPoolChange=typeof options.onPoolChange==='function'?options.onPoolChange:()=>{};

    if(typeof Pool!=='function')throw new Error('O módulo pg.Pool não foi fornecido.');

    function criarPoolPostgresV104(connectionString){
        if(!connectionString)return null;
        return new Pool({
            connectionString,
            ssl:NODE_ENV==='production'?{rejectUnauthorized:false}:false,
            max:Math.max(2,Number(POOL_MAX||10)),
            idleTimeoutMillis:30000,
            connectionTimeoutMillis:12000,
            keepAlive:true,
            keepAliveInitialDelayMillis:10000,
            allowExitOnIdle:false
        });
    }

    let databaseUrlAtivaV104=DATABASE_URL;
    let db=criarPoolPostgresV104(databaseUrlAtivaV104);
    let dbUsandoFallbackV104=false;
    let dbCooldownAteV83=0;
    let dbFalhasConsecutivasV83=0;

    function erroPostgresTemporarioV80(e){
        const code=String(e?.code||'');
        const msg=String(e?.message||e||'').toLowerCase();
        return [
            '57p03','57p01','57p02','57p04','53300','08000','08001','08003',
            '08004','08006','08007','08p01','econnreset','etimedout','econnrefused',
            'epipe','enotfound','eai_again','enodata'
        ].includes(code.toLowerCase())
          || msg.includes('database system is not yet accepting connections')
          || msg.includes('consistent recovery state has not been yet reached')
          || msg.includes('connection terminated unexpectedly')
          || msg.includes('connection terminated')
          || msg.includes('connection reset')
          || msg.includes('socket hang up')
          || msg.includes('server closed the connection unexpectedly')
          || msg.includes('cannot connect now')
          || msg.includes('the database system is starting up')
          || msg.includes('the database system is shutting down')
          || msg.includes('getaddrinfo enotfound')
          || msg.includes('getaddrinfo eai_again')
          || msg.includes('name or service not known')
          || msg.includes('temporary failure in name resolution');
    }

    function esperarDbV80(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

    function ativarCooldownDbV83(e){
        if(!erroPostgresTemporarioV80(e))return;
        dbFalhasConsecutivasV83=Math.min(20,dbFalhasConsecutivasV83+1);
        const ms=Math.min(15000,1000*Math.max(2,dbFalhasConsecutivasV83));
        dbCooldownAteV83=Math.max(dbCooldownAteV83,Date.now()+ms);
    }

    async function esperarCooldownDbV83(){
        const restante=dbCooldownAteV83-Date.now();
        if(restante>0)await esperarDbV80(restante);
    }

    function limparCooldownDbV83(){
        dbFalhasConsecutivasV83=0;
        dbCooldownAteV83=0;
    }

    function hostBancoSeguroV81(){
        try{return databaseUrlAtivaV104?new URL(databaseUrlAtivaV104).hostname:'';}
        catch(_){return '';}
    }

    function erroDnsBancoV81(e){
        const code=String(e?.code||'').toLowerCase();
        const msg=String(e?.message||e||'').toLowerCase();
        return ['enotfound','eai_again','enodata'].includes(code)
          || msg.includes('getaddrinfo enotfound')
          || msg.includes('getaddrinfo eai_again')
          || msg.includes('name or service not known');
    }

    function prepararClientePgV106(client){
        if(!client)return client;
        client.__mlhubPgDeadV106=Boolean(client.__mlhubPgDeadV106);

        // Listener instalado no evento connect/acquire do Pool, antes de qualquer
        // consulta do cliente. Evita Unhandled 'error' event em conexões checked-out.
        if(!client.__mlhubPgErrorListenerV107){
            client.on('error',err=>{
                client.__mlhubPgDeadV106=true;
                if(erroPostgresTemporarioV80(err)){
                    ativarCooldownDbV83(err);
                    console.warn('[POSTGRES V107 CLIENT] conexão temporariamente perdida:',err?.code||'',err?.message||err);
                }else{
                    console.error('[POSTGRES V107 CLIENT] erro de conexão:',err);
                }
            });
            client.__mlhubPgErrorListenerV107=true;
        }

        // O evento connect pode acontecer antes de release estar disponível;
        // por isso verificamos e envolvemos release também no evento acquire.
        if(typeof client.release==='function'&&!client.__mlhubReleaseWrappedV106){
            const liberarOriginal=client.release.bind(client);
            client.release=(err)=>{
                if(err)return liberarOriginal(err);
                if(client.__mlhubPgDeadV106){
                    return liberarOriginal(new Error('Conexão PostgreSQL encerrada durante o uso.'));
                }
                return liberarOriginal();
            };
            client.__mlhubReleaseWrappedV106=true;
        }
        return client;
    }

    function registrarErroPoolV104(pool,label='primary'){
        if(!pool)return;
        // Monitorar todos os clientes, inclusive os usados internamente por pool.query().
        pool.on('connect',client=>prepararClientePgV106(client));
        pool.on('acquire',client=>prepararClientePgV106(client));
        pool.on('error',err=>{
            if(erroPostgresTemporarioV80(err)){
                ativarCooldownDbV83(err);
                console.warn(`[POSTGRES V107 ${label}] conexão temporariamente indisponível:`,err.code||'',err.message);
            }else{
                console.error(`[POSTGRES V107 ${label}] erro de pool:`,err);
            }
        });
    }

    registrarErroPoolV104(db,'primary');
    onPoolChange(db);

    async function ativarFallbackDbV104(causa){
        if(dbUsandoFallbackV104||!DATABASE_FALLBACK_URL||DATABASE_FALLBACK_URL===databaseUrlAtivaV104)return false;
        if(!erroPostgresTemporarioV80(causa))return false;

        const antigo=db;
        const novo=criarPoolPostgresV104(DATABASE_FALLBACK_URL);
        registrarErroPoolV104(novo,'fallback');
        db=novo;
        onPoolChange(db);
        databaseUrlAtivaV104=DATABASE_FALLBACK_URL;
        dbUsandoFallbackV104=true;
        limparCooldownDbV83();
        try{await antigo?.end?.();}catch(_){}
        console.warn('[POSTGRES V107] alternando para DATABASE_FALLBACK_URL.');
        return true;
    }

    async function dbConnectComRetryV104(opcoes={}){
        if(!db)throw new Error('PostgreSQL não configurado. Adicione DATABASE_URL no Render.');
        const maxTentativas=Math.max(1,Math.min(10,Number(opcoes.tentativas||7)));
        let ultimo=null;
        for(let tentativa=1;tentativa<=maxTentativas;tentativa++){
            await esperarCooldownDbV83();
            try{
                const client=prepararClientePgV106(await db.connect());
                limparCooldownDbV83();
                return client;
            }catch(e){
                ultimo=e;
                if(erroPostgresTemporarioV80(e)){
                    ativarCooldownDbV83(e);
                    if(tentativa>=2&&DATABASE_FALLBACK_URL&&!dbUsandoFallbackV104){
                        const trocou=await ativarFallbackDbV104(e);
                        if(trocou)continue;
                    }
                }
                if(!erroPostgresTemporarioV80(e)||tentativa>=maxTentativas)throw e;
                const espera=Math.min(12000,450*Math.pow(2,tentativa-1)+Math.floor(Math.random()*350));
                console.warn(`[POSTGRES V107] connect tentativa ${tentativa}/${maxTentativas} falhou (${e.code||e.message}). Retry em ${espera}ms.`);
                await esperarDbV80(espera);
            }
        }
        throw ultimo;
    }

    async function dbQuery(text,params=[],opcoes={}){
        if(!db)throw new Error('PostgreSQL não configurado. Adicione DATABASE_URL no Render.');
        const maxTentativas=Math.max(1,Math.min(8,Number(opcoes.tentativas||5)));
        let ultimo;
        for(let tentativa=1;tentativa<=maxTentativas;tentativa++){
            await esperarCooldownDbV83();
            try{
                const resposta=await db.query(text,params);
                limparCooldownDbV83();
                return resposta;
            }catch(e){
                ultimo=e;
                if(erroPostgresTemporarioV80(e)){
                    ativarCooldownDbV83(e);
                    if(tentativa>=2&&DATABASE_FALLBACK_URL&&!dbUsandoFallbackV104){
                        const trocou=await ativarFallbackDbV104(e);
                        if(trocou)continue;
                    }
                }
                if(!erroPostgresTemporarioV80(e)||tentativa>=maxTentativas)throw e;
                const espera=Math.min(8000,350*Math.pow(2,tentativa-1));
                if(erroDnsBancoV81(e)){
                    console.warn(`[POSTGRES V107] DNS indisponível (${hostBancoSeguroV81()}) · tentativa ${tentativa}/${maxTentativas}.`);
                }else{
                    console.warn(`[POSTGRES V107] tentativa ${tentativa}/${maxTentativas} falhou (${e.code||e.message}). Nova tentativa em ${espera}ms.`);
                }
                await esperarDbV80(espera);
            }
        }
        throw ultimo;
    }

    async function aguardarPostgresProntoV80(){
        if(!db)return false;
        let tentativa=0;
        while(true){
            tentativa++;
            try{
                await dbQuery('SELECT 1 AS ok',[],{tentativas:1});
                if(tentativa>1)console.log(`[POSTGRES V107] banco disponível após ${tentativa} tentativa(s).`);
                return true;
            }catch(e){
                if(!erroPostgresTemporarioV80(e))throw e;
                const espera=Math.min(15000,1000*Math.min(tentativa,15));
                if(erroDnsBancoV81(e)){
                    console.warn(`[POSTGRES V107] DNS não encontrou o banco "${hostBancoSeguroV81()}". Atualize DATABASE_URL com a Internal Database URL atual do PostgreSQL no Render.`);
                }else{
                    console.warn(`[POSTGRES V107] banco em inicialização/recovery. Tentando novamente em ${espera}ms...`);
                }
                await esperarDbV80(espera);
            }
        }
    }

    return {
        get db(){return db;},
        get dbUsandoFallbackV104(){return dbUsandoFallbackV104;},
        dbQuery,
        dbConnectComRetryV104,
        erroPostgresTemporarioV80,
        erroDnsBancoV81,
        esperarDbV80,
        esperarCooldownDbV83,
        limparCooldownDbV83,
        ativarCooldownDbV83,
        aguardarPostgresProntoV80,
        hostBancoSeguroV81
    };
}

module.exports={createPostgresInfrastructure};
