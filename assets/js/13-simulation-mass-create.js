
/* =========================================================
   V21 \u2014 SIMULA\u00c7\u00c3O/ATUALIZA\u00c7\u00c3O SERVER-SIDE + PEDIDOS
========================================================= */

let simPaginaV21=1, simPaginasV21=1, simTotalV21=0, simItensV21=[], simCarregandoV21=false;
let atualPaginaV21=1, atualPaginasV21=1, atualTotalV21=0, atualItensV21=[], atualCarregandoV21=false;
let pedidosPaginaV21=1, pedidosPaginasV21=1, pedidosCarregandoV21=false;
let filtroEscalaV21={campo:'sku',valor:''};

/* V31 \u2014 estado visual da atualiza\u00e7\u00e3o de pre\u00e7os em massa. */
let atualizacaoExecutandoV31=false;
const statusAtualizacaoV31=new Map();
let errosAtualizacaoV31=[];

/* V30 \u2014 cache compartilhado da lista completa.
   Simula\u00e7\u00e3o e Atualiza\u00e7\u00e3o reutilizam os an\u00fancios j\u00e1 carregados. */
const anunciosEscalaCacheV30=new Map();
let simFiltroRenderKeyV30='';
let atualFiltroRenderKeyV30='';

/* V32 \u2014 snapshot persistente dos an\u00fancios no navegador. */
const CACHE_DB_V32='mlHubProAnunciosV43';
const STORE_ITENS_V32='itens';
const STORE_META_V32='meta';
const STORE_SEEN_V85='seen_v85';
const STORE_PERSISTENTE_V90='itens_persistentes_v90';
let dbCachePromiseV32=null;
let masterAnunciosV32=[];
let masterMapV32=new Map();
let masterCarregadoV32=false;
let ultimaVerificacaoDeltaV32=0;
let deltaPromiseV32=null;
const DELTA_INTERVALO_V32=180000;

function abrirDbCacheV32(){
    if(dbCachePromiseV32)return dbCachePromiseV32;
    dbCachePromiseV32=new Promise((resolve,reject)=>{
        const req=indexedDB.open(CACHE_DB_V32,3);
        req.onupgradeneeded=()=>{
            const db=req.result;
            if(!db.objectStoreNames.contains(STORE_ITENS_V32))db.createObjectStore(STORE_ITENS_V32,{keyPath:'id'});
            if(!db.objectStoreNames.contains(STORE_META_V32))db.createObjectStore(STORE_META_V32,{keyPath:'key'});
            if(!db.objectStoreNames.contains(STORE_SEEN_V85))db.createObjectStore(STORE_SEEN_V85,{keyPath:'id'});
            if(!db.objectStoreNames.contains(STORE_PERSISTENTE_V90)){
                const st=db.createObjectStore(STORE_PERSISTENTE_V90,{keyPath:'cache_key'});
                st.createIndex('seller_id','seller_id',{unique:false});
            }
        };
        req.onsuccess=()=>resolve(req.result);
        req.onerror=()=>reject(req.error||new Error('N\u00e3o foi poss\u00edvel abrir o cache local.'));
    });
    return dbCachePromiseV32;
}

async function idbTodosV32(store){
    const db=await abrirDbCacheV32();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction(store,'readonly'),req=tx.objectStore(store).getAll();
        req.onsuccess=()=>resolve(req.result||[]);
        req.onerror=()=>reject(req.error);
    });
}
async function idbMetaV32(key){
    const db=await abrirDbCacheV32();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_META_V32,'readonly'),req=tx.objectStore(STORE_META_V32).get(key);
        req.onsuccess=()=>resolve(req.result||null);
        req.onerror=()=>reject(req.error);
    });
}
async function idbSalvarMetaV32(obj){
    const db=await abrirDbCacheV32();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_META_V32,'readwrite');
        tx.objectStore(STORE_META_V32).put(obj);
        tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
    });
}

async function sellerAtivoV90(){
    const chaves=['direct_sync_v88','direct_sync_v87','direct_sync_v86','direct_sync_v85','sync'];
    for(const chave of chaves){
        try{
            const m=await idbMetaV32(chave);
            const seller=String(m?.seller_id||'').trim();
            if(seller)return seller;
        }catch(e){}
    }
    return '';
}

async function idbItensPersistentesV90(sellerId=''){
    const db=await abrirDbCacheV32();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_PERSISTENTE_V90,'readonly');
        const st=tx.objectStore(STORE_PERSISTENTE_V90);

        if(sellerId && st.indexNames.contains('seller_id')){
            const req=st.index('seller_id').getAll(IDBKeyRange.only(String(sellerId)));
            req.onsuccess=()=>resolve(req.result||[]);
            req.onerror=()=>reject(req.error);
        }else{
            const req=st.getAll();
            req.onsuccess=()=>resolve(req.result||[]);
            req.onerror=()=>reject(req.error);
        }
    });
}

async function migrarCacheAtualParaPersistenteV90(){
    try{
        const atuais=await idbTodosV32(STORE_ITENS_V32);
        if(!atuais?.length)return;

        const seller=await sellerAtivoV90();
        if(!seller)return;

        const db=await abrirDbCacheV32();
        await new Promise((resolve,reject)=>{
            const tx=db.transaction(STORE_PERSISTENTE_V90,'readwrite');
            const st=tx.objectStore(STORE_PERSISTENTE_V90);

            for(const item of atuais){
                const id=String(item?.id||'');
                if(!id)continue;
                st.put({
                    ...item,
                    seller_id:seller,
                    cache_key:`${seller}:${id}`
                });
            }

            tx.oncomplete=()=>resolve();
            tx.onerror=()=>reject(tx.error);
        });
    }catch(e){
        console.warn('[CACHE PERSISTENTE V90 MIGRAÇÃO]',e);
    }
}

async function idbSalvarItensV32(itens){
    if(!Array.isArray(itens)||!itens.length)return;

    const sellerFallback=await sellerAtivoV90();
    const db=await abrirDbCacheV32();

    return new Promise((resolve,reject)=>{
        const tx=db.transaction(
            [STORE_ITENS_V32,STORE_PERSISTENTE_V90],
            'readwrite'
        );

        const normal=tx.objectStore(STORE_ITENS_V32);
        const persistente=tx.objectStore(STORE_PERSISTENTE_V90);

        for(const item of itens){
            const id=String(item?.id||'');
            if(!id)continue;

            normal.put(item);

            const seller=String(
                item?._seller_id ||
                item?.seller_id ||
                sellerFallback ||
                ''
            ).trim();

            if(seller){
                persistente.put({
                    ...item,
                    seller_id:seller,
                    cache_key:`${seller}:${id}`
                });
            }
        }

        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
        tx.onabort=()=>reject(tx.error||new Error('Falha ao salvar cache persistente.'));
    });
}

async function idbSalvarSeenV85(ids){
    const lista=[...new Set((ids||[]).map(String).filter(Boolean))];
    if(!lista.length)return;
    const db=await abrirDbCacheV32();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_SEEN_V85,'readwrite');
        const st=tx.objectStore(STORE_SEEN_V85);
        lista.forEach(id=>st.put({id}));
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
    });
}

async function idbLimparSeenV85(){
    const db=await abrirDbCacheV32();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_SEEN_V85,'readwrite');
        tx.objectStore(STORE_SEEN_V85).clear();
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
    });
}

async function idbContarSeenV85(){
    const db=await abrirDbCacheV32();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE_SEEN_V85,'readonly');
        const req=tx.objectStore(STORE_SEEN_V85).count();
        req.onsuccess=()=>resolve(Number(req.result||0));
        req.onerror=()=>reject(req.error);
    });
}

async function idbLimparV32(){
    /*
      V90: compatibilidade com rotinas antigas.
      Limpa somente a store temporária e o "seen".
      NÃO apaga STORE_PERSISTENTE_V90.
      NÃO apaga checkpoints direct_sync_v88/direct_freight_v92.
    */
    const db=await abrirDbCacheV32();
    return new Promise((resolve,reject)=>{
        const tx=db.transaction(
            [STORE_ITENS_V32,STORE_META_V32,STORE_SEEN_V85],
            'readwrite'
        );

        tx.objectStore(STORE_ITENS_V32).clear();
        tx.objectStore(STORE_SEEN_V85).clear();

        // Só remove o cursor legado do PostgreSQL.
        tx.objectStore(STORE_META_V32).delete('sync');

        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
    });
}
async function carregarMasterLocalV32(){
    if(masterCarregadoV32)return;

    try{
        const seller=await sellerAtivoV90();

        const [normais,persistentes]=await Promise.all([
            idbTodosV32(STORE_ITENS_V32),
            idbItensPersistentesV90(seller)
        ]);

        const mapa=new Map();

        // Persistente primeiro: é a rede de segurança.
        for(const raw of (persistentes||[])){
            const item=normalizarItemEscala(raw);
            if(item?.id)mapa.set(String(item.id),item);
        }

        // Store normal por cima: contém as alterações mais recentes da sessão.
        for(const raw of (normais||[])){
            const item=normalizarItemEscala(raw);
            if(item?.id)mapa.set(String(item.id),item);
        }

        masterMapV32=mapa;
        masterAnunciosV32=[...mapa.values()];
    }catch(e){
        console.warn('[CACHE V90]',e);
        masterAnunciosV32=[];
        masterMapV32=new Map();
    }

    masterCarregadoV32=true;
}
function listaMasterFiltradaV32(){
    const campo=String(filtroEscalaV21.campo||'sku').toLowerCase();
    const valor=String(filtroEscalaV21.valor||'').trim().toLowerCase();
    if(!valor)return masterAnunciosV32;
    if(campo==='mlb')return masterAnunciosV32.filter(x=>String(x.id||'').toLowerCase()===valor);
    return masterAnunciosV32.filter(x=>String(x.sku||'').trim().toLowerCase()===valor);
}
async function aplicarMudancasV32(itens){
    if(!Array.isArray(itens)||!itens.length)return 0;

    const normalizados=itens.map(raw=>{
        const incoming=normalizarItemEscala(raw);
        const anterior=masterMapV32.get(String(incoming.id));
        if(!anterior)return incoming;

        const rawTemQualidade=Object.prototype.hasOwnProperty.call(raw||{},'quality_score');
        if(rawTemQualidade)return incoming;

        return {
            ...incoming,
            quality_score:anterior.quality_score??null,
            quality_level:anterior.quality_level||'',
            quality_pending_actions:Number(anterior.quality_pending_actions||0),
            quality_checked_at:anterior.quality_checked_at||null,
            quality_calculated_at:anterior.quality_calculated_at||null
        };
    });

    normalizados.forEach(item=>masterMapV32.set(String(item.id),item));
    masterAnunciosV32=[...masterMapV32.values()];
    await idbSalvarItensV32(normalizados);
    simFiltroRenderKeyV30='';
    atualFiltroRenderKeyV30='';
    anunciosEscalaCacheV30.clear();
    return normalizados.length;
}
async function sincronizarMudancasV32({forcar=false,mostrarProgresso=false}={}){
    await carregarMasterLocalV32();
    if(!forcar&&masterAnunciosV32.length&&(Date.now()-ultimaVerificacaoDeltaV32)<DELTA_INTERVALO_V32){
        return {alterados:0,total:masterAnunciosV32.length};
    }
    if(deltaPromiseV32)return deltaPromiseV32;

    deltaPromiseV32=(async()=>{
        const token=obterToken();if(!token)throw new Error('Token n\u00e3o dispon\u00edvel.');
        let meta=await idbMetaV32('sync');
        let afterTs=meta?.after_ts||'1970-01-01T00:00:00.000Z';
        let afterId=meta?.after_id||'';
        let sellerAnterior=String(meta?.seller_id||'');
        let totalConta=masterAnunciosV32.length,alterados=0,primeira=true;

        while(true){
            const p=new URLSearchParams({after_ts:afterTs,after_id:afterId,limit:'5000'});
            const r=await fetch(`${RENDER_URL}/api/scale/anuncios/changes?${p.toString()}&_=${Date.now()}`,{
                cache:'no-store',headers:{Authorization:token,Accept:'application/json'}
            });
            const d=await r.json().catch(()=>({}));
            if(!r.ok)throw new Error(d.erro||`Erro HTTP ${r.status} ao consultar altera\u00e7\u00f5es.`);

            const sellerAtual=String(d.seller_id||'');
            totalConta=Number(d.total_conta||0);

            if(primeira&&sellerAnterior&&sellerAtual&&sellerAnterior!==sellerAtual){
                await idbLimparV32();masterAnunciosV32=[];masterMapV32=new Map();
                afterTs='1970-01-01T00:00:00.000Z';afterId='';sellerAnterior='';meta=null;primeira=false;continue;
            }

            alterados+=await aplicarMudancasV32(Array.isArray(d.itens)?d.itens:[]);
            const cursor=d.next_cursor||{};
            afterTs=cursor.after_ts||afterTs;afterId=cursor.after_id||afterId;

            await idbSalvarMetaV32({
                key:'sync',seller_id:sellerAtual,after_ts:afterTs,after_id:afterId,
                total_conta:totalConta,checked_at:Date.now()
            });

            if(mostrarProgresso&&totalConta){
                const el=document.getElementById('loading-text');
                if(el)el.innerText=`Sincronizando an\u00fancios... ${Math.min(masterAnunciosV32.length,totalConta).toLocaleString('pt-BR')}/${totalConta.toLocaleString('pt-BR')}`;
            }

            sellerAnterior=sellerAtual;if(!d.has_more)break;primeira=false;
        }

        if(totalConta&&masterAnunciosV32.length!==totalConta){
            await idbLimparV32();masterAnunciosV32=[];masterMapV32=new Map();
            let ts='1970-01-01T00:00:00.000Z',iid='';
            while(true){
                const p=new URLSearchParams({after_ts:ts,after_id:iid,limit:'5000'});
                const r=await fetch(`${RENDER_URL}/api/scale/anuncios/changes?${p.toString()}&_=${Date.now()}`,{
                    cache:'no-store',headers:{Authorization:token,Accept:'application/json'}
                });
                const d=await r.json().catch(()=>({}));
                if(!r.ok)throw new Error(d.erro||`Erro HTTP ${r.status} ao reconstruir cache.`);
                alterados+=await aplicarMudancasV32(Array.isArray(d.itens)?d.itens:[]);
                const c=d.next_cursor||{};ts=c.after_ts||ts;iid=c.after_id||iid;
                await idbSalvarMetaV32({
                    key:'sync',seller_id:String(d.seller_id||''),after_ts:ts,after_id:iid,
                    total_conta:Number(d.total_conta||0),checked_at:Date.now()
                });
                if(mostrarProgresso){
                    const el=document.getElementById('loading-text');
                    if(el)el.innerText=`Preparando cache local... ${masterAnunciosV32.length.toLocaleString('pt-BR')}/${Number(d.total_conta||0).toLocaleString('pt-BR')}`;
                }
                if(!d.has_more)break;
            }
        }

        ultimaVerificacaoDeltaV32=Date.now();
        return {alterados,total:masterAnunciosV32.length};
    })();

    try{return await deltaPromiseV32}
    finally{deltaPromiseV32=null}
}

function chaveFiltroEscalaV30(){
    const campo=String(filtroEscalaV21.campo||'sku').trim().toLowerCase();
    const valor=String(filtroEscalaV21.valor||'').trim().toLowerCase();
    return `${campo}::${valor}`;
}

function obterCacheEscalaV30(){
    return anunciosEscalaCacheV30.get(chaveFiltroEscalaV30())||null;
}

function salvarCacheEscalaV30(resultado){
    const chave=chaveFiltroEscalaV30();

    // Evita acumular v\u00e1rias listas gigantes em mem\u00f3ria.
    if(!anunciosEscalaCacheV30.has(chave) && anunciosEscalaCacheV30.size>=5){
        const primeira=[...anunciosEscalaCacheV30.keys()][0];
        anunciosEscalaCacheV30.delete(primeira);
    }

    anunciosEscalaCacheV30.set(chave,{
        itens:Array.isArray(resultado?.itens)?resultado.itens:[],
        total:Number(resultado?.total||0),
        salvoEm:Date.now()
    });
}

function invalidarCacheAnunciosV30(){
    anunciosEscalaCacheV30.clear();
    simFiltroRenderKeyV30='';
    atualFiltroRenderKeyV30='';
    ultimaVerificacaoDeltaV32=0;
}

function atualizarPrecoNoCacheV30(id,preco){
    const alvo=String(id),novo=Number(preco);
    for(const cache of anunciosEscalaCacheV30.values()){
        const item=cache.itens.find(x=>String(x.id)===alvo);if(item)item.price=novo;
    }
    const master=masterMapV32.get(alvo);
    if(master){
        master.price=novo;
        master.net_received=Math.max(0,novo-Number(master.sale_fee||0)-Number(master.shipping_cost||0));
        master.last_synced=new Date().toISOString();
        idbSalvarItensV32([master]).catch(e=>console.warn('[CACHE PRE\u00c7O V32]',e));
    }
    const simItem=simItensV21.find(x=>String(x.id)===alvo);if(simItem)simItem.price=novo;
    const atualItem=atualItensV21.find(x=>String(x.id)===alvo);if(atualItem)atualItem.price=novo;
}

const simParametrosPorIdV21={};
const simResultadosPorIdV21={};
const simMassaV21={
    custo:null,
    taxa:null,
    taxaPremium:null,
    taxaClassico:null,
    imposto:null,
    lucro:null
};

/* V27 \u2014 base persistente por SKU */
const baseSkuV27={};
let baseSkuCarregadaV27=false;
let skuDisponiveisV27=[];
let skuLinhaSeqV27=0;

/* V34 \u2014 identifica se a Base Financeira mudou.
   Isso permite atualizar somente os c\u00e1lculos quando custo/margem do SKU mudarem,
   sem recarregar todos os an\u00fancios. */
let baseSkuFingerprintV34='';

function fingerprintBaseSkuV34(){
    return JSON.stringify(
        Object.entries(baseSkuV27)
            .sort(([a],[b])=>a.localeCompare(b))
            .map(([sku,regra])=>[
                sku,
                Number(regra?.custo||0),
                Number(regra?.margem||0),
                regra?.updated_at||null
            ])
    );
}

function normalizarSkuV27(v){
    return String(v||'').trim().toLowerCase();
}

function regraSkuV27(item){
    return baseSkuV27[normalizarSkuV27(item?.sku)]||null;
}

function sincronizarFiltroCamposV21(){
    const campo=filtroEscalaV21.campo||'sku';
    const valor=filtroEscalaV21.valor||'';
    ['sim','atual'].forEach(prefix=>{
        const c=document.getElementById(`${prefix}-filtro-campo`);
        const v=document.getElementById(`${prefix}-filtro-valor`);
        if(c)c.value=campo;
        if(v)v.value=valor;
    });
    const texto=valor
      ? `Filtro ativo: ${campo.toUpperCase()} = ${valor}`
      : 'Sem filtro: todos os an\u00fancios da conta ser\u00e3o considerados.';
    const si=document.getElementById('sim-filtro-info');
    const ai=document.getElementById('atual-filtro-info');
    if(si)si.textContent=texto;
    if(ai)ai.textContent=valor?texto:'Sem filtro: todos os an\u00fancios da conta ser\u00e3o carregados em uma lista cont\u00ednua.';
}

function lerFiltroV21(prefix){
    const campo=document.getElementById(`${prefix}-filtro-campo`)?.value||'sku';
    const valor=document.getElementById(`${prefix}-filtro-valor`)?.value?.trim()||'';
    filtroEscalaV21={campo,valor};
    sincronizarFiltroCamposV21();
}

function queryEscalaV21(page,limit=1000){
    const p=new URLSearchParams({
        page:String(Math.max(1,page)),
        limit:String(Math.max(10,Math.min(1000,Number(limit||1000))))
    });
    if(filtroEscalaV21.valor){
        p.set('q',filtroEscalaV21.valor);
        p.set('field',filtroEscalaV21.campo);
    }
    return p;
}

function aplicarFiltroSimulacaoV21(){
    lerFiltroV21('sim');
    simFiltroRenderKeyV30='';
    carregarSimulacaoEscalaV21();
}
function limparFiltroSimulacaoV21(){
    filtroEscalaV21={campo:'sku',valor:''};
    sincronizarFiltroCamposV21();
    simFiltroRenderKeyV30='';
    carregarSimulacaoEscalaV21();
}
function aplicarFiltroAtualizacaoV21(){
    lerFiltroV21('atual');
    atualFiltroRenderKeyV30='';
    carregarAtualizacaoEscalaV21();
}
function limparFiltroAtualizacaoV21(){
    filtroEscalaV21={campo:'sku',valor:''};
    sincronizarFiltroCamposV21();
    atualFiltroRenderKeyV30='';
    carregarAtualizacaoEscalaV21();
}

function parametrosSimV21(item){
    const salvo=simParametrosPorIdV21[item.id]||{};
    const regra=regraSkuV27(item);

    const premium=String(item.listing_type_id||'')==='gold_pro';
    const taxaManualTipo=premium
      ? simMassaV21.taxaPremium
      : simMassaV21.taxaClassico;

    const taxaApi=Number(item.commission_percentage||0)>0
      ? Number(item.commission_percentage)
      : null;

    const temBase=Boolean(regra);
    const custoBase=temBase ? Number(regra.custo||0) : null;
    const margemBase=temBase ? Number(regra.margem||0) : null;

    return {
        // V73: a comiss&#227;o exata sincronizada pela API do Mercado Livre sempre tem prioridade.
        // Valores manuais antigos ficam somente como fallback caso o item ainda n&#227;o tenha taxa sincronizada.
        taxa:Number(
          taxaApi ??
          salvo.taxa ??
          taxaManualTipo ??
          simMassaV21.taxa ??
          (premium?17:12)
        ),

        /* V34:
           Se o SKU existe na Base Financeira, custo e margem SEMPRE v\u00eam dela.
           Campo individual e preenchimento em massa s\u00f3 valem para SKU sem base. */
        custo:Number(
          temBase
            ? custoBase
            : (salvo.custo ?? simMassaV21.custo ?? 10)
        ),

        imposto:Number(salvo.imposto ?? simMassaV21.imposto ?? 0),

        lucro:Number(
          temBase
            ? margemBase
            : (salvo.lucro ?? simMassaV21.lucro ?? 12)
        ),

        origemBaseSku:temBase
    };
}

function calcularSimulacaoV21(item,p){
    const PRECO_REFERENCIA=78.90,FRETE_REFERENCIA=10.00;
    const precoAtual=Number(item.price||0),freteAtual=Number(item.shipping_cost||0);
    const taxa=Number(p.taxa||0),custo=Number(p.custo||0),imposto=Number(p.imposto||0),lucro=Number(p.lucro||0);
    const taxaRef=PRECO_REFERENCIA*(taxa/100);
    const impostoRef=PRECO_REFERENCIA*(imposto/100);
    const lucroRef=PRECO_REFERENCIA-custo-taxaRef-impostoRef-FRETE_REFERENCIA;
    const margemRef=PRECO_REFERENCIA>0?(lucroRef/PRECO_REFERENCIA)*100:0;
    const podeReferencia=precoAtual>PRECO_REFERENCIA && margemRef+0.0001>=lucro;
    const freteAplicado=podeReferencia?FRETE_REFERENCIA:freteAtual;
    const divisor=1-((taxa+imposto+lucro)/100);
    let novoPreco=divisor>0?(custo+freteAplicado)/divisor:custo*1.5;
    if(precoAtual>PRECO_REFERENCIA&&!podeReferencia)novoPreco=Math.max(PRECO_REFERENCIA+0.01,novoPreco);
    const valorTaxa=novoPreco*(taxa/100),valorImposto=novoPreco*(imposto/100);
    const lucroLiquido=novoPreco-custo-valorTaxa-valorImposto-freteAplicado;
    const margem=novoPreco>0?(lucroLiquido/novoPreco)*100:0;

    const taxaAtual=precoAtual*(taxa/100);
    const impostoAtual=precoAtual*(imposto/100);
    const lucroAtual=precoAtual-custo-taxaAtual-impostoAtual-freteAtual;
    const margemAtual=precoAtual>0?(lucroAtual/precoAtual)*100:0;
    const diferencaMargem=Math.abs(margemAtual-lucro);

    return {
        preco:novoPreco,freteSimulado:freteAplicado,usouReferencia7890:podeReferencia,
        lucroLiquido,margem,margemAtual,margemDesejada:lucro,diferencaMargem,
        foraDaMargem:diferencaMargem>0.05
    };
}

function safeIdV21(v){return String(v||'').replace(/[^a-zA-Z0-9_-]/g,'_')}

function atributosBaseSkuV34(item,campo){
    const regra=regraSkuV27(item);
    if(!regra)return '';

    const rotulo=campo==='custo'
      ? `Custo definido na Base Financeira: R$ ${Number(regra.custo||0).toFixed(2).replace('.',',')}`
      : `Margem definida na Base Financeira: ${Number(regra.margem||0).toFixed(2).replace('.',',')}%`;

    return `readonly title="${escapeHtml(rotulo)}" class="input-simulacao w-${campo==='custo'?'20':'16'} !border-emerald-400 !bg-emerald-50 !text-emerald-800 cursor-not-allowed"`;
}

function atributosTaxaExataV73(item){
    const taxa=Number(item?.commission_percentage||0);
    const valor=Number(item?.sale_fee||0);
    if(!(taxa>0))return 'class="input-simulacao w-16" title="Taxa ainda n&#227;o sincronizada; usando fallback at&#233; a pr&#243;xima sincroniza&#231;&#227;o."';
    const tipo=String(item?.listing_type_id||'')==='gold_pro'?'Premium':'Cl&#225;ssico';
    const titulo=`Taxa exata ${tipo} trazida pela API do Mercado Livre${valor>0?` &#183; Comiss&#227;o atual: ${moeda(valor)}`:''}`;
    return `readonly class="input-simulacao w-16 !border-blue-400 !bg-blue-50 !text-blue-800 cursor-not-allowed" title="${escapeHtml(titulo)}"`;
}

function montarTabelaSimulacaoV21(itens){
    const tbody=document.getElementById('tabela-simulacao');if(!tbody)return;
    tbody.innerHTML='';
    if(!itens.length){
        tbody.innerHTML='<tr><td colspan="14" class="p-10 text-center text-slate-500">Nenhum an\u00fancio encontrado para este filtro.</td></tr>';
        return;
    }
    itens.forEach(item=>{
        const p=parametrosSimV21(item),sid=safeIdV21(item.id);
        const calc=calcularSimulacaoV21(item,p);simResultadosPorIdV21[item.id]=calc;
        const tipo=item.listing_type_id==='gold_pro'?'Premium':'Cl\u00e1ssico';
        const tr=document.createElement('tr');
        tr.innerHTML=`
          <td class="p-3 font-mono">${escapeHtml(item.id)}</td>
          <td class="p-3 font-mono">
            ${escapeHtml(item.sku)}
            ${regraSkuV27(item)?'<div class="text-[9px] text-emerald-600 font-black mt-1">BASE SKU</div>':''}
          </td>
          <td class="p-3 max-w-[220px] truncate">${escapeHtml(item.title)}</td>
          <td class="p-3 font-bold">${moeda(item.price)}</td>
          <td class="p-3">${moeda(item.shipping_cost)}</td>
          <td class="p-3 font-black text-blue-700 bg-blue-50">R$ 78,90</td>
          <td class="p-3">${tipo}</td>
          <td class="p-3 bg-yellow-50/60"><input type="number" step="0.01" id="taxa_${sid}" value="${Number(p.taxa).toFixed(2)}" oninput="recalcularV21('${escapeHtml(item.id)}')" ${atributosTaxaExataV73(item)}></td>
          <td class="p-3 bg-yellow-50/60"><input type="number" step="0.01" id="custo_${sid}" value="${p.custo}" oninput="recalcularV21('${escapeHtml(item.id)}')" ${regraSkuV27(item)?atributosBaseSkuV34(item,'custo'):'class="input-simulacao w-20"'}></td>
          <td class="p-3 bg-yellow-50/60"><input type="number" step="0.1" id="imposto_${sid}" value="${p.imposto}" oninput="recalcularV21('${escapeHtml(item.id)}')" class="input-simulacao w-16"></td>
          <td class="p-3 bg-yellow-50/60"><input type="number" step="0.1" id="lucro_${sid}" value="${p.lucro}" oninput="recalcularV21('${escapeHtml(item.id)}')" ${regraSkuV27(item)?atributosBaseSkuV34(item,'lucro'):'class="input-simulacao w-16"'}></td>
          <td id="novo_preco_${sid}" class="p-3 bg-emerald-50 font-black text-emerald-800">${moeda(calc.preco)}</td>
          <td id="lucro_sim_${sid}" class="p-3 bg-emerald-50 font-bold text-emerald-700">${moeda(calc.lucroLiquido)}</td>
          <td id="margem_real_${sid}" class="p-3 bg-emerald-50 font-bold text-emerald-900">${calc.margem.toFixed(2)}%</td>`;
        tbody.appendChild(tr);
    });
}

function recalcularV21(id){
    const item=simItensV21.find(x=>String(x.id)===String(id))||atualItensV21.find(x=>String(x.id)===String(id));
    if(!item)return;

    const sid=safeIdV21(id);
    const base=regraSkuV27(item);
    const atuais=parametrosSimV21(item);

    const taxaApiExata=Number(item.commission_percentage||0)>0 ? Number(item.commission_percentage) : null;
    const p={
        // V73: nunca substitui uma taxa exata da API por valor manual/local.
        taxa:taxaApiExata ?? (parseFloat(document.getElementById(`taxa_${sid}`)?.value ?? atuais.taxa)||0),

        // SKU cadastrado na Base Financeira n\u00e3o pode ser sobrescrito por valor antigo/manual.
        custo:base
          ? Number(base.custo||0)
          : (parseFloat(document.getElementById(`custo_${sid}`)?.value ?? atuais.custo)||0),

        imposto:parseFloat(document.getElementById(`imposto_${sid}`)?.value ?? atuais.imposto)||0,

        lucro:base
          ? Number(base.margem||0)
          : (parseFloat(document.getElementById(`lucro_${sid}`)?.value ?? atuais.lucro)||0)
    };

    simParametrosPorIdV21[id]=p;

    // Mant\u00e9m os campos visuais sincronizados com a Base Financeira.
    if(base){
        const custoEl=document.getElementById(`custo_${sid}`);
        const lucroEl=document.getElementById(`lucro_${sid}`);
        if(custoEl)custoEl.value=Number(base.custo||0);
        if(lucroEl)lucroEl.value=Number(base.margem||0);
    }

    const calc=calcularSimulacaoV21(item,p);
    simResultadosPorIdV21[id]=calc;

    const np=document.getElementById(`novo_preco_${sid}`);
    const ls=document.getElementById(`lucro_sim_${sid}`);
    const mr=document.getElementById(`margem_real_${sid}`);

    if(np)np.innerText=moeda(calc.preco);
    if(ls)ls.innerText=moeda(calc.lucroLiquido);
    if(mr)mr.innerText=calc.margem.toFixed(2)+'%';
}

let syncBackgroundV42Agendado=false;

function atualizarTelaAposDeltaV42(alterados=0){
    if(!alterados)return;
    const aba=String(window.abaAtualAtiva||localStorage.getItem('mlHubPro_abaAtual_v1')||'');
    if(aba==='simulacao'){
        simItensV21=listaMasterFiltradaV32();
        renderizarSimulacaoCompletaV29(simItensV21);
        simFiltroRenderKeyV30=chaveFiltroEscalaV30();
        const info=document.getElementById('sim-filtro-info');
        if(info)info.textContent=`${simItensV21.length.toLocaleString('pt-BR')} an\u00fancio(s) carregados \u00b7 ${alterados.toLocaleString('pt-BR')} altera\u00e7\u00e3o(\u00f5es) sincronizada(s) em segundo plano.`;
    }else if(aba==='atualizacao'){
        atualItensV21=listaMasterFiltradaV32();
        renderizarAtualizacaoCompletaV29(atualItensV21);
        atualFiltroRenderKeyV30=chaveFiltroEscalaV30();
    }
}

function agendarSyncBackgroundV42(){
    if(syncBackgroundV42Agendado)return;
    syncBackgroundV42Agendado=true;
    setTimeout(async()=>{
        try{
            const delta=await sincronizarMudancasV32({forcar:false,mostrarProgresso:false});
            atualizarTelaAposDeltaV42(Number(delta?.alterados||0));
        }catch(e){
            console.warn('[SYNC BACKGROUND V42]',e.message);
        }finally{
            syncBackgroundV42Agendado=false;
        }
    },80);
}


/* V43 \u2014 a Simula\u00e7\u00e3o usa um snapshot completo persistido da Gest\u00e3o.
   Ele \u00e9 constru\u00eddo uma \u00fanica vez em lotes de at\u00e9 5.000 registros e depois
   somente recebe deltas de an\u00fancios novos/alterados. */
let prepararCacheCompletoPromiseV43=null;
let simRenderTokenV43=0;

async function reconstruirCacheCompletoV43({mostrarProgresso=false}={}){
    if(prepararCacheCompletoPromiseV43)return prepararCacheCompletoPromiseV43;

    prepararCacheCompletoPromiseV43=(async()=>{
        const token=obterToken();
        if(!token)throw new Error('Token n\u00e3o dispon\u00edvel.');

        await idbLimparV32();
        masterAnunciosV32=[];
        masterMapV32=new Map();
        masterCarregadoV32=true;

        let ts='1970-01-01T00:00:00.000Z';
        let iid='';
        let totalConta=0;
        let sellerId='';
        let maxSyncedAt=null;

        while(true){
            const p=new URLSearchParams({after_ts:ts,after_id:iid,limit:'5000'});
            const r=await fetch(`${RENDER_URL}/api/scale/anuncios/changes?${p.toString()}&_=${Date.now()}`,{
                cache:'no-store',headers:{Authorization:token,Accept:'application/json'}
            });
            const d=await r.json().catch(()=>({}));
            if(!r.ok)throw new Error(d.erro||`Erro HTTP ${r.status} ao preparar a base completa de an\u00fancios.`);

            sellerId=String(d.seller_id||sellerId||'');
            totalConta=Number(d.total_conta||totalConta||0);
            maxSyncedAt=d.max_synced_at||maxSyncedAt||null;
            await aplicarMudancasV32(Array.isArray(d.itens)?d.itens:[]);

            const c=d.next_cursor||{};
            ts=c.after_ts||ts;
            iid=c.after_id||iid;

            await idbSalvarMetaV32({
                key:'sync',seller_id:sellerId,after_ts:ts,after_id:iid,
                total_conta:totalConta,max_synced_at:maxSyncedAt,
                checked_at:Date.now(),snapshot_version:43
            });

            if(mostrarProgresso){
                const el=document.getElementById('loading-text');
                if(el)el.innerText=`Preparando a Simula\u00e7\u00e3o uma \u00fanica vez... ${Math.min(masterAnunciosV32.length,totalConta||masterAnunciosV32.length).toLocaleString('pt-BR')}/${Number(totalConta||masterAnunciosV32.length).toLocaleString('pt-BR')}`;
            }

            if(!d.has_more)break;
        }

        ultimaVerificacaoDeltaV32=Date.now();
        simFiltroRenderKeyV30='';
        atualFiltroRenderKeyV30='';
        anunciosEscalaCacheV30.clear();
        return {total:masterAnunciosV32.length,total_conta:totalConta};
    })();

    try{return await prepararCacheCompletoPromiseV43}
    finally{prepararCacheCompletoPromiseV43=null}
}

async function cacheCompletoV43(){
    await carregarMasterLocalV32();
    try{
        const meta=await idbMetaV32('sync');
        const esperado=Number(meta?.total_conta||0);
        return Boolean(meta?.snapshot_version===43 && esperado>0 && masterAnunciosV32.length===esperado);
    }catch(e){return false}
}

function aquecerCacheSimulacaoV43(){
    setTimeout(async()=>{
        try{
            if(await cacheCompletoV43())return;
            await reconstruirCacheCompletoV43({mostrarProgresso:false});
        }catch(e){
            console.warn('[CACHE SIMULA\u00c7\u00c3O V43]',e.message);
        }
    },150);
}

function linhaSimulacaoV43(item){
    const p=parametrosSimV21(item),sid=safeIdV21(item.id);
    const calc=calcularSimulacaoV21(item,p);
    simResultadosPorIdV21[item.id]=calc;
    const tipo=item.listing_type_id==='gold_pro'?'Premium':'Cl\u00e1ssico';

    return `
      <tr>
        <td class="p-3 font-mono">${escapeHtml(item.id)}</td>
        <td class="p-3 font-mono">
          ${escapeHtml(item.sku)}
          ${regraSkuV27(item)?'<div class="text-[9px] text-emerald-600 font-black mt-1">BASE SKU</div>':''}
        </td>
        <td class="p-3 max-w-[220px] truncate">${escapeHtml(item.title)}</td>
        <td class="p-3 font-bold">${moeda(item.price)}</td>
        <td class="p-3">${moeda(item.shipping_cost)}</td>
        <td class="p-3 font-black text-blue-700 bg-blue-50">R$ 78,90</td>
        <td class="p-3">${tipo}</td>
        <td class="p-3 bg-yellow-50/60"><input type="number" step="0.01" id="taxa_${sid}" value="${Number(p.taxa).toFixed(2)}" oninput="recalcularV21('${escapeHtml(item.id)}')" ${atributosTaxaExataV73(item)}></td>
        <td class="p-3 bg-yellow-50/60"><input type="number" step="0.01" id="custo_${sid}" value="${p.custo}" oninput="recalcularV21('${escapeHtml(item.id)}')" ${regraSkuV27(item)?atributosBaseSkuV34(item,'custo'):'class="input-simulacao w-20"'}></td>
        <td class="p-3 bg-yellow-50/60"><input type="number" step="0.1" id="imposto_${sid}" value="${p.imposto}" oninput="recalcularV21('${escapeHtml(item.id)}')" class="input-simulacao w-16"></td>
        <td class="p-3 bg-yellow-50/60"><input type="number" step="0.1" id="lucro_${sid}" value="${p.lucro}" oninput="recalcularV21('${escapeHtml(item.id)}')" ${regraSkuV27(item)?atributosBaseSkuV34(item,'lucro'):'class="input-simulacao w-16"'}></td>
        <td id="novo_preco_${sid}" class="p-3 bg-emerald-50 font-black text-emerald-800">${moeda(calc.preco)}</td>
        <td id="lucro_sim_${sid}" class="p-3 bg-emerald-50 font-bold text-emerald-700">${moeda(calc.lucroLiquido)}</td>
        <td id="margem_real_${sid}" class="p-3 bg-emerald-50 font-bold text-emerald-900">${calc.margem.toFixed(2)}%</td>
      </tr>`;
}

async function buscarTodosAnunciosEscalaV29(tipo='simulacao',{forcar=false}={}){
    await carregarMasterLocalV32();
    const completo=await cacheCompletoV43();

    if(!completo){
        mostrarLoading('Preparando todos os an\u00fancios da Gest\u00e3o uma \u00fanica vez...');
        try{
            await reconstruirCacheCompletoV43({mostrarProgresso:true});
        }finally{
            esconderLoading();
        }
    }

    if(forcar){
        const delta=await sincronizarMudancasV32({forcar:true,mostrarProgresso:false});
        const itensAtualizados=listaMasterFiltradaV32();
        return {
            itens:itensAtualizados,total:itensAtualizados.length,
            total_conta:masterAnunciosV32.length,
            alterados:Number(delta?.alterados||0),cache:false
        };
    }

    // Depois da primeira prepara\u00e7\u00e3o, abre imediatamente do IndexedDB.
    // A verifica\u00e7\u00e3o de an\u00fancios novos/alterados acontece em segundo plano.
    const itens=listaMasterFiltradaV32();
    agendarSyncBackgroundV42();
    return {itens,total:itens.length,total_conta:masterAnunciosV32.length,alterados:0,cache:true};
}

function renderizarSimulacaoCompletaV29(itens){
    const tbody=document.getElementById('tabela-simulacao');
    if(!tbody)return;

    const token=++simRenderTokenV43;
    if(!itens.length){
        tbody.innerHTML='<tr><td colspan="14" class="p-10 text-center text-slate-500">Nenhum an\u00fancio encontrado para este filtro.</td></tr>';
        return;
    }

    // Todos os an\u00fancios j\u00e1 est\u00e3o carregados em mem\u00f3ria/cache. O DOM \u00e9 montado
    // em blocos para a p\u00e1gina n\u00e3o congelar mesmo com dezenas de milhares de itens.
    tbody.innerHTML='';
    let pos=0;
    const PRIMEIRO_BLOCO=220;
    const BLOCO=320;

    const inserir=(quantidade)=>{
        if(token!==simRenderTokenV43)return false;
        const fim=Math.min(itens.length,pos+quantidade);
        let html='';
        for(;pos<fim;pos++)html+=linhaSimulacaoV43(itens[pos]);
        if(html)tbody.insertAdjacentHTML('beforeend',html);
        return pos<itens.length;
    };

    const continuar=()=>{
        if(token!==simRenderTokenV43)return;
        if(!inserir(BLOCO))return;
        if('requestIdleCallback' in window){
            requestIdleCallback(continuar,{timeout:120});
        }else{
            setTimeout(continuar,0);
        }
    };

    inserir(PRIMEIRO_BLOCO);
    if(pos<itens.length){
        if('requestIdleCallback' in window){
            requestIdleCallback(continuar,{timeout:80});
        }else{
            setTimeout(continuar,0);
        }
    }
}

function statusHtmlAtualizacaoV31(id){
    const status=statusAtualizacaoV31.get(String(id));

    if(!status){
        return '<span class="text-slate-500 text-[10px]">Pendente</span>';
    }

    if(status.estado==='fila'){
        return '<span class="text-amber-400 font-bold text-[10px]">\u25cf Na fila</span>';
    }

    if(status.estado==='processando'){
        return '<span class="text-blue-400 font-bold text-[10px]">\u25cf Atualizando...</span>';
    }

    if(status.estado==='sucesso'){
        return `
          <div>
            <span class="text-emerald-400 font-black text-[10px]">\u2713 Atualizado</span>
            <div class="text-[9px] text-slate-500 mt-1">
              ${status.http_status?`HTTP ${escapeHtml(status.http_status)}`:'Mercado Livre confirmou a altera\u00e7\u00e3o'}
            </div>
          </div>`;
    }

    const motivo=String(status.motivo||'O Mercado Livre n\u00e3o aceitou a atualiza\u00e7\u00e3o.');
    const temporario=status.tipo_falha==='temporario';
    const bloqueio=status.tipo_falha==='bloqueio';
    const titulo=temporario?'\u23f3 Limite/instabilidade tempor\u00e1ria':(bloqueio?'\u26d4 Altera\u00e7\u00e3o bloqueada':'\u2717 N\u00e3o atualizado');
    const cor=temporario?'text-amber-400':(bloqueio?'text-orange-400':'text-red-400');

    return `
      <div class="max-w-[420px]">
        <div class="${cor} font-black text-[10px]">${titulo}</div>
        <div class="text-[10px] text-slate-200 mt-1 whitespace-normal break-words">${escapeHtml(motivo)}</div>
        ${(status.http_status||status.codigo)
          ? `<div class="text-[9px] text-slate-600 mt-1">Detalhe t\u00e9cnico: ${status.http_status?`HTTP ${escapeHtml(status.http_status)}`:''}${status.codigo?` \u00b7 ${escapeHtml(status.codigo)}`:''}</div>`
          : ''}
      </div>`;
}

function atualizarStatusLinhaV31(id){
    const el=document.getElementById(`status_api_${safeIdV21(id)}`);
    if(el)el.innerHTML=statusHtmlAtualizacaoV31(id);
}

function atualizarPainelProgressoV31({total=0,processados=0,sucessos=0,falhas=0,texto='',estado='running'}={}){
    const painel=document.getElementById('atualizacao-progresso-v31');
    const bar=document.getElementById('atualizacao-progresso-bar-v31');
    const percent=document.getElementById('atualizacao-progresso-percent-v31');
    const textoEl=document.getElementById('atualizacao-progresso-texto-v31');

    if(painel)painel.classList.remove('hidden');

    const pct=total>0?Math.max(0,Math.min(100,Math.round((processados/total)*100))):0;
    if(bar){
        bar.style.width=`${pct}%`;
        bar.classList.toggle('bg-red-400',estado==='error');
        bar.classList.toggle('bg-emerald-400',estado!=='error');
    }
    if(percent)percent.textContent=`${pct}%`;
    if(textoEl)textoEl.textContent=texto||`${processados.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}`;

    const proc=document.getElementById('atualizacao-processados-v31');
    const suc=document.getElementById('atualizacao-sucessos-v31');
    const fal=document.getElementById('atualizacao-falhas-v31');
    const rest=document.getElementById('atualizacao-restantes-v31');

    if(proc)proc.textContent=Number(processados||0).toLocaleString('pt-BR');
    if(suc)suc.textContent=Number(sucessos||0).toLocaleString('pt-BR');
    if(fal)fal.textContent=Number(falhas||0).toLocaleString('pt-BR');
    if(rest)rest.textContent=Math.max(0,Number(total||0)-Number(processados||0)).toLocaleString('pt-BR');
}

function registrarErroAtualizacaoV31({id,titulo='',sku='',preco=0,motivo='',http_status=null,codigo=null,tipo_falha='erro'}){
    const item={
        id:String(id||''),
        titulo:String(titulo||''),
        sku:String(sku||''),
        preco:Number(preco||0),
        motivo:String(motivo||'Falha n\u00e3o detalhada.'),
        http_status:http_status||null,
        codigo:codigo||null,
        tipo_falha:String(tipo_falha||'erro')
    };

    errosAtualizacaoV31.push(item);

    const box=document.getElementById('atualizacao-ultimo-erro-v31');
    const texto=document.getElementById('atualizacao-ultimo-erro-texto-v31');
    if(box)box.classList.remove('hidden');
    if(texto){
        texto.textContent=`${item.id}${item.sku?` \u00b7 SKU ${item.sku}`:''}: ${item.motivo}`;
    }

    const details=document.getElementById('atualizacao-erros-detalhes-v31');
    const lista=document.getElementById('atualizacao-erros-lista-v31');
    if(details)details.classList.remove('hidden');

    if(lista){
        lista.insertAdjacentHTML('beforeend',`
          <div class="p-3">
            <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
              <div>
                <div class="text-[10px] font-black text-white">${escapeHtml(item.id)}${item.sku?` \u00b7 SKU ${escapeHtml(item.sku)}`:''}</div>
                <div class="text-[10px] text-slate-400 mt-1">${escapeHtml(item.titulo||'An\u00fancio')}</div>
              </div>
              <div class="text-[10px] text-slate-500">${moeda(item.preco)}</div>
            </div>
            <div class="text-[10px] text-red-200 mt-2 break-words">
              ${escapeHtml(item.motivo)}
            </div>
            ${(item.http_status||item.codigo)
              ? `<div class="text-[9px] text-slate-600 mt-1">Detalhe t\u00e9cnico: ${item.http_status?`HTTP ${escapeHtml(item.http_status)}`:''}${item.codigo?` \u00b7 ${escapeHtml(item.codigo)}`:''}</div>`
              : ''}
          </div>`);
    }
}

function prepararProgressoAtualizacaoV31(total){
    errosAtualizacaoV31=[];

    const lista=document.getElementById('atualizacao-erros-lista-v31');
    const details=document.getElementById('atualizacao-erros-detalhes-v31');
    const ultimo=document.getElementById('atualizacao-ultimo-erro-v31');

    if(lista)lista.innerHTML='';
    if(details){
        details.classList.add('hidden');
        details.open=false;
    }
    if(ultimo)ultimo.classList.add('hidden');

    atualizarPainelProgressoV31({
        total,
        processados:0,
        sucessos:0,
        falhas:0,
        texto:`Preparando ${Number(total||0).toLocaleString('pt-BR')} an\u00fancio(s) para atualiza\u00e7\u00e3o...`
    });
}

function atualizarContadorSelecionadosV31(){
    const selecionados=[...document.querySelectorAll('#tabela-atualizacao .check-item:checked:not(:disabled)')].length;
    const c=document.getElementById('contador-atualizacao');
    if(c)c.textContent=selecionados.toLocaleString('pt-BR');
}

function renderizarAtualizacaoCompletaV29(itens){
    const tbody=document.getElementById('tabela-atualizacao');
    if(!tbody)return;

    let contador=0;
    const linhas=[];

    for(const item of itens){
        const calc=calcularSimulacaoV21(item,parametrosSimV21(item));
        simResultadosPorIdV21[item.id]=calc;
        if(!calc.foraDaMargem)continue;

        if(item.price_update_allowed!==false)contador++;
        const sid=safeIdV21(item.id);

        const st=statusAtualizacaoV31.get(String(item.id));
        const bloqueioMercadoLivre=item.price_update_allowed===false;
        const jaAtualizado=st?.estado==='sucesso';
        const bloqueado=jaAtualizado||bloqueioMercadoLivre;

        const statusInicial=bloqueioMercadoLivre && !st
          ? `<div class="max-w-[420px]">
               <div class="text-orange-400 font-black text-[10px]">\u26d4 N\u00e3o pode ser atualizado</div>
               <div class="text-[10px] text-slate-200 mt-1">${escapeHtml(item.price_update_block_reason||'O estado atual do an\u00fancio n\u00e3o permite altera\u00e7\u00e3o de pre\u00e7o.')}</div>
             </div>`
          : statusHtmlAtualizacaoV31(item.id);

        linhas.push(`
          <tr id="linha_atualizacao_${sid}" class="${bloqueioMercadoLivre?'opacity-70':''}">
            <td class="p-4"><input type="checkbox" value="${escapeHtml(item.id)}" ${bloqueado?'':'checked'} ${bloqueado?'disabled':''} class="check-item accent-yellow-400 w-4 h-4"></td>
            <td class="p-4">
              <div class="flex items-center gap-3 min-w-[280px]">
                <img src="${escapeHtml(item.thumbnail)}" class="w-11 h-11 object-cover rounded-xl border border-slate-700">
                <div>
                  <span class="font-semibold text-white block">${escapeHtml(item.title)}</span>
                  <span class="text-[10px] text-slate-500">${escapeHtml(item.id)} \u2022 SKU: ${escapeHtml(item.sku)}</span>
                </div>
              </div>
            </td>
            <td id="preco_atual_${sid}" class="p-4 font-bold text-white">${moeda(item.price)}</td>
            <td id="novo_preco_${sid}_atualizacao" class="p-4 font-black text-emerald-400">${moeda(calc.preco)}</td>
            <td id="situacao_${sid}" class="p-4">${
                jaAtualizado
                  ? '<span class="px-2.5 py-1 rounded-lg bg-emerald-400/10 text-emerald-400 font-bold text-[10px]">Atualizado</span>'
                  : bloqueioMercadoLivre
                    ? '<span class="px-2.5 py-1 rounded-lg bg-orange-400/10 text-orange-400 font-bold text-[10px]">Bloqueado pelo ML</span>'
                    : `<div>
                       <span class="px-2.5 py-1 rounded-lg bg-amber-400/10 text-amber-400 font-bold text-[10px]">Fora da margem</span>
                       <div class="text-[9px] text-slate-500 mt-1">${calc.margemAtual.toFixed(2)}% \u2192 ${calc.margemDesejada.toFixed(2)}%</div>
                     </div>`
            }</td>
            <td id="status_api_${sid}" class="p-4 min-w-[320px]">${statusInicial}</td>
          </tr>`);
    }

    tbody.innerHTML=linhas.length
      ? linhas.join('')
      : '<tr><td colspan="6" class="p-10 text-center text-slate-500">Nenhum an\u00fancio precisa ser atualizado.</td></tr>';

    const c=document.getElementById('contador-atualizacao');
    if(c)c.innerText=contador.toLocaleString('pt-BR');

    setTimeout(()=>atualizarContadorSelecionadosV31(),0);
}

async function carregarSimulacaoEscalaV21(page=1){
    if(simCarregandoV21)return;
    const token=obterToken();if(!token){solicitarToken();return}
    simCarregandoV21=true;
    try{
        const baseInfo=await carregarBaseSkuRapidaV42();
        const resultado=await buscarTodosAnunciosEscalaV29('simulacao');
        const chave=chaveFiltroEscalaV30();
        simPaginaV21=1;simPaginasV21=1;simTotalV21=Number(resultado.total||0);simItensV21=resultado.itens;

        const precisaRenderizar=
          simFiltroRenderKeyV30!==chave ||
          Number(resultado.alterados||0)>0 ||
          Boolean(baseInfo?.mudou) ||
          !document.querySelector('#tabela-simulacao tr');

        if(precisaRenderizar){
            renderizarSimulacaoCompletaV29(simItensV21);
            simFiltroRenderKeyV30=chave;
        }

        const info=document.getElementById('sim-filtro-info');
        if(info){
            const n=Number(resultado.alterados||0);
            const delta=n?` \u00b7 ${n.toLocaleString('pt-BR')} altera\u00e7\u00e3o(\u00f5es) aplicada(s)`:' \u00b7 sem altera\u00e7\u00f5es novas';
            info.textContent=filtroEscalaV21.valor
              ? `Filtro: ${filtroEscalaV21.campo.toUpperCase()} = ${filtroEscalaV21.valor} \u00b7 ${simItensV21.length.toLocaleString('pt-BR')} an\u00fancio(s)${delta}`
              : `${simItensV21.length.toLocaleString('pt-BR')} an\u00fancio(s) da Gest\u00e3o carregados e salvos no navegador${delta}.`;
        }
    }catch(e){alert(e.message)}
    finally{simCarregandoV21=false}
}
// Compatibilidade: pagina\u00e7\u00e3o foi removida na V29.
function atualizarPaginacaoSimV21(){}
function simIrPaginaV21(){}


aplicarEmMassa=function(){
    const vals={
      custo:document.getElementById('massa-custo')?.value,
      imposto:document.getElementById('massa-imposto')?.value,
      lucro:document.getElementById('massa-lucro')?.value
    };
    // V73: remove substitui&#231;&#245;es manuais antigas para a simula&#231;&#227;o usar a taxa exata da API.
    simMassaV21.taxa=null;
    simMassaV21.taxaPremium=null;
    simMassaV21.taxaClassico=null;
    Object.entries(vals).forEach(([k,v])=>{if(v!==''&&v!==undefined)simMassaV21[k]=Number(v)});
    simItensV21.forEach(item=>{delete simParametrosPorIdV21[item.id]});
    renderizarSimulacaoCompletaV29(simItensV21);
};

function montarTabelaAtualizacaoV21(itens){
    return renderizarAtualizacaoCompletaV29(itens);
}

async function carregarAtualizacaoEscalaV21(page=1){
    if(atualCarregandoV21)return;
    const token=obterToken();if(!token){solicitarToken();return}
    atualCarregandoV21=true;
    try{
        const baseInfo=await carregarBaseSkuRapidaV42();
        const resultado=await buscarTodosAnunciosEscalaV29('atualizacao');
        const chave=chaveFiltroEscalaV30();
        atualPaginaV21=1;atualPaginasV21=1;atualTotalV21=Number(resultado.total||0);atualItensV21=resultado.itens;

        const precisaRenderizar=
          atualFiltroRenderKeyV30!==chave ||
          Number(resultado.alterados||0)>0 ||
          Boolean(baseInfo?.mudou) ||
          !document.querySelector('#tabela-atualizacao tr');

        if(precisaRenderizar){
            renderizarAtualizacaoCompletaV29(atualItensV21);
            atualFiltroRenderKeyV30=chave;
        }

        const contagemAtualizacao=atualItensV21.reduce((acc,item)=>{
            const calc=calcularSimulacaoV21(item,parametrosSimV21(item));
            if(!calc.foraDaMargem)return acc;
            acc.fora++;
            if(item.price_update_allowed===false)acc.bloqueados++;
            else acc.atualizaveis++;
            return acc;
        },{fora:0,atualizaveis:0,bloqueados:0});

        const qtdAtualizar=contagemAtualizacao.atualizaveis;

        const c=document.getElementById('contador-atualizacao');
        if(c)c.textContent=qtdAtualizar.toLocaleString('pt-BR');

        const info=document.getElementById('atual-filtro-info');
        if(info){
            const n=Number(resultado.alterados||0);
            const delta=n?` \u00b7 ${n.toLocaleString('pt-BR')} altera\u00e7\u00e3o(\u00f5es) aplicada(s)`:' \u00b7 sem altera\u00e7\u00f5es novas';
            info.textContent=filtroEscalaV21.valor
              ? `Filtro: ${filtroEscalaV21.campo.toUpperCase()} = ${filtroEscalaV21.valor} \u00b7 ${qtdAtualizar.toLocaleString('pt-BR')} com margem diferente${delta}`
              : `${atualItensV21.length.toLocaleString('pt-BR')} an\u00fancio(s) analisados \u00b7 ${contagemAtualizacao.fora.toLocaleString('pt-BR')} fora da margem \u00b7 ${contagemAtualizacao.atualizaveis.toLocaleString('pt-BR')} atualiz\u00e1veis \u00b7 ${contagemAtualizacao.bloqueados.toLocaleString('pt-BR')} bloqueados pelo Mercado Livre${delta}.`;
        }
    }catch(e){alert(e.message)}
    finally{atualCarregandoV21=false}
}
// Compatibilidade: pagina\u00e7\u00e3o foi removida na V29.
function atualizarPaginacaoAtualV21(){}
function atualIrPaginaV21(){}


atualizarPrecosMassaApi=async function(){
    if(atualizacaoExecutandoV31)return;

    const token=obterToken();
    if(!token){solicitarToken();return}

    const checks=[...document.querySelectorAll('#tabela-atualizacao .check-item:checked:not(:disabled)')];
    if(!checks.length)return alert('Nenhum an\u00fancio selecionado para atualiza\u00e7\u00e3o.');
    if(!confirm(`Deseja atualizar ${checks.length.toLocaleString('pt-BR')} an\u00fancio(s) selecionado(s)?`))return;

    const mapa=new Map(atualItensV21.map(x=>[String(x.id),x]));
    const itens=checks.map(c=>{
        const item=mapa.get(String(c.value));
        const calc=item?calcularSimulacaoV21(item,parametrosSimV21(item)):null;
        return item&&calc?{
            id:item.id,
            title:item.title,
            sku:item.sku,
            price:parseFloat(calc.preco.toFixed(2))
        }:null;
    }).filter(Boolean);

    if(!itens.length)return alert('Nenhum pre\u00e7o v\u00e1lido para atualizar.');

    atualizacaoExecutandoV31=true;
    const botao=document.getElementById('btn-atualizar-precos-v31');
    if(botao){
        botao.disabled=true;
        botao.classList.add('opacity-60','cursor-not-allowed');
        botao.textContent='Atualizando...';
    }

    prepararProgressoAtualizacaoV31(itens.length);

    // Tudo que foi selecionado entra inicialmente na fila.
    itens.forEach(x=>{
        statusAtualizacaoV31.set(String(x.id),{estado:'fila'});
        atualizarStatusLinhaV31(x.id);
    });

    let ok=0;
    let erros=0;
    let processados=0;
    let fatal=null;

    try{
        const TAMANHO_LOTE=20;

        for(let i=0;i<itens.length;i+=TAMANHO_LOTE){
            const lote=itens.slice(i,i+TAMANHO_LOTE);

            lote.forEach(x=>{
                statusAtualizacaoV31.set(String(x.id),{estado:'processando'});
                atualizarStatusLinhaV31(x.id);
            });

            atualizarPainelProgressoV31({
                total:itens.length,
                processados,
                sucessos:ok,
                falhas:erros,
                texto:`Atualizando lote ${Math.floor(i/TAMANHO_LOTE)+1} \u00b7 an\u00fancios ${i+1} a ${Math.min(i+TAMANHO_LOTE,itens.length)}`
            });

            let resposta=null;
            let dados=null;
            let erroLote=null;

            // Uma nova tentativa autom\u00e1tica para falhas tempor\u00e1rias de conex\u00e3o.
            for(let tentativa=1;tentativa<=2;tentativa++){
                try{
                    resposta=await fetch(`${RENDER_URL}/api/atualizar-precos`,{
                        method:'POST',
                        headers:{
                            'Content-Type':'application/json',
                            Authorization:token
                        },
                        body:JSON.stringify({
                            itens:lote.map(({id,price})=>({id,price}))
                        })
                    });
                    dados=await resposta.json().catch(()=>({}));

                    if(resposta.ok || Array.isArray(dados?.resultados)){
                        erroLote=null;
                        break;
                    }

                    erroLote=dados?.erro||`HTTP ${resposta.status}`;
                }catch(e){
                    erroLote='Erro de conex\u00e3o: '+e.message;
                }

                if(tentativa<2){
                    await new Promise(resolve=>setTimeout(resolve,700));
                }
            }

            if(!Array.isArray(dados?.resultados)){
                const motivo=erroLote||'O servidor n\u00e3o retornou o resultado deste lote.';

                for(const item of lote){
                    erros++;
                    processados++;

                    statusAtualizacaoV31.set(String(item.id),{
                        estado:'erro',
                        motivo,
                        http_status:resposta?.status||null,
                        codigo:null,
                        tipo_falha:'temporario'
                    });
                    atualizarStatusLinhaV31(item.id);

                    const original=mapa.get(String(item.id));
                    registrarErroAtualizacaoV31({
                        id:item.id,
                        titulo:original?.title||item.title,
                        sku:original?.sku||item.sku,
                        preco:item.price,
                        motivo,
                        http_status:resposta?.status||null
                    });
                }

                atualizarPainelProgressoV31({
                    total:itens.length,
                    processados,
                    sucessos:ok,
                    falhas:erros,
                    texto:`${processados.toLocaleString('pt-BR')} de ${itens.length.toLocaleString('pt-BR')} processados \u00b7 ${erros.toLocaleString('pt-BR')} falha(s)`
                });

                // Continua nos pr\u00f3ximos lotes para n\u00e3o perder o restante da opera\u00e7\u00e3o.
                continue;
            }

            const retornoPorId=new Map(
                dados.resultados.map(x=>[String(x.id),x])
            );

            for(const item of lote){
                const resultado=retornoPorId.get(String(item.id)) || {
                    id:item.id,
                    sucesso:false,
                    erro:'O Mercado Livre n\u00e3o retornou resultado para este an\u00fancio.'
                };

                processados++;

                const original=mapa.get(String(item.id));
                const sid=safeIdV21(item.id);

                if(resultado.sucesso){
                    ok++;

                    atualizarPrecoNoCacheV30(item.id,item.price);

                    statusAtualizacaoV31.set(String(item.id),{
                        estado:'sucesso',
                        http_status:resultado.http_status||200
                    });
                    atualizarStatusLinhaV31(item.id);

                    const preco=document.getElementById(`preco_atual_${sid}`);
                    if(preco)preco.textContent=moeda(item.price);

                    const situacao=document.getElementById(`situacao_${sid}`);
                    if(situacao){
                        situacao.innerHTML='<span class="px-2.5 py-1 rounded-lg bg-emerald-400/10 text-emerald-400 font-bold text-[10px]">Atualizado</span>';
                    }

                    const check=document.querySelector(`#linha_atualizacao_${sid} .check-item`);
                    if(check){
                        check.checked=false;
                        check.disabled=true;
                    }
                }else{
                    erros++;

                    const motivo=String(resultado.erro||'O Mercado Livre n\u00e3o aceitou a atualiza\u00e7\u00e3o.');
                    statusAtualizacaoV31.set(String(item.id),{
                        estado:'erro',
                        motivo,
                        http_status:resultado.http_status||null,
                        codigo:resultado.codigo||null,
                        tipo_falha:resultado.tipo_falha||'erro',
                        tentativas:resultado.tentativas||0
                    });
                    atualizarStatusLinhaV31(item.id);

                    registrarErroAtualizacaoV31({
                        id:item.id,
                        titulo:original?.title||item.title,
                        sku:original?.sku||item.sku,
                        preco:item.price,
                        motivo,
                        http_status:resultado.http_status||null,
                        codigo:resultado.codigo||null,
                        tipo_falha:resultado.tipo_falha||'erro'
                    });
                }
            }

            atualizarContadorSelecionadosV31();

            atualizarPainelProgressoV31({
                total:itens.length,
                processados,
                sucessos:ok,
                falhas:erros,
                texto:`${processados.toLocaleString('pt-BR')} de ${itens.length.toLocaleString('pt-BR')} processados \u00b7 ${ok.toLocaleString('pt-BR')} atualizados \u00b7 ${erros.toLocaleString('pt-BR')} falha(s)`
            });

            // D\u00e1 tempo para a barra ser pintada e reduz rajadas entre lotes.
            await new Promise(resolve=>setTimeout(resolve,650));
        }

        atualizarPainelProgressoV31({
            total:itens.length,
            processados,
            sucessos:ok,
            falhas:erros,
            texto:erros
              ? `Conclu\u00eddo com ${ok.toLocaleString('pt-BR')} atualiza\u00e7\u00e3o(\u00f5es) e ${erros.toLocaleString('pt-BR')} falha(s). Os motivos est\u00e3o nas linhas e na lista de falhas.`
              : `Conclu\u00eddo: ${ok.toLocaleString('pt-BR')} an\u00fancio(s) atualizado(s) com sucesso.`
        });

        // Mant\u00e9m os resultados vis\u00edveis. N\u00e3o abre o antigo modal e n\u00e3o recarrega os 8 mil an\u00fancios.
        atualFiltroRenderKeyV30=chaveFiltroEscalaV30();

        if(simItensV21.length){
            simFiltroRenderKeyV30='';
        }

    }catch(e){
        fatal=e;
        atualizarPainelProgressoV31({
            total:itens.length,
            processados,
            sucessos:ok,
            falhas:erros,
            texto:'A atualiza\u00e7\u00e3o foi interrompida: '+e.message,
            estado:'error'
        });
    }finally{
        atualizacaoExecutandoV31=false;

        if(botao){
            botao.disabled=false;
            botao.classList.remove('opacity-60','cursor-not-allowed');
            botao.textContent='\u2197 Atualizar pre\u00e7os';
        }

        atualizarContadorSelecionadosV31();

        if(fatal){
            const box=document.getElementById('atualizacao-ultimo-erro-v31');
            const texto=document.getElementById('atualizacao-ultimo-erro-texto-v31');
            if(box)box.classList.remove('hidden');
            if(texto)texto.textContent='Processo interrompido: '+fatal.message;
        }
    }
};

/* PEDIDOS */
function statusPedidoLabelV21(p){
    const map={
      pendente:['Pendente','text-yellow-400','bg-yellow-400/10'],
      em_andamento:['Em andamento','text-blue-400','bg-blue-400/10'],
      entregue:['Entregue','text-emerald-400','bg-emerald-400/10'],
      cancelado:['Cancelado','text-red-400','bg-red-400/10']
    };
    return map[p]||['Em andamento','text-blue-400','bg-blue-400/10'];
}
function formatarDataHoraV21(v){
    if(!v)return '\u2014';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleString('pt-BR');
}
async function carregarPedidosV21(page=1){
    if(pedidosCarregandoV21)return;
    const token=obterToken();if(!token){solicitarToken();return}
    pedidosCarregandoV21=true;mostrarLoading('Buscando pedidos e status de entrega...');
    try{
        const r=await fetch(`${RENDER_URL}/api/v21/pedidos?page=${Math.max(1,page)}&limit=30&_=${Date.now()}`,{
            cache:'no-store',headers:{Authorization:token}
        });
        const d=await r.json();if(!r.ok)throw new Error(d.erro||'Erro ao carregar pedidos.');
        pedidosPaginaV21=Number(d.pagina||1);pedidosPaginasV21=Number(d.paginas||1);
        const pedidos=Array.isArray(d.pedidos)?d.pedidos:[];
        const tbody=document.getElementById('pedidos-tabela');
        if(tbody){
            tbody.innerHTML=pedidos.length?pedidos.map(p=>{
                const [lbl,cor,bg]=statusPedidoLabelV21(p.situacao);
                const itens=(p.items||[]).map(i=>`${Number(i.quantity||0)}x ${escapeHtml(i.title||i.id)}`).join('<br>');
                const buyer=p.buyer?.nickname||p.buyer?.id||'\u2014';
                return `<tr>
                  <td class="p-4 font-mono text-white">${escapeHtml(p.id)}</td>
                  <td class="p-4 text-slate-300">${formatarDataHoraV21(p.date_created)}</td>
                  <td class="p-4 text-slate-200 min-w-[280px]">${itens||'\u2014'}</td>
                  <td class="p-4 text-slate-300">${escapeHtml(buyer)}</td>
                  <td class="p-4 font-black text-emerald-400">${moeda(p.paid_amount||p.total_amount)}</td>
                  <td class="p-4"><span class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-200 text-[10px] font-bold">${escapeHtml(rotuloSituacaoV64(p.status,'pedido'))}</span></td>
                  <td class="p-4"><span class="px-2.5 py-1 rounded-lg ${bg} ${cor} text-[10px] font-black">${lbl}</span><div class="text-[9px] text-slate-600 mt-1">${escapeHtml(rotuloSituacaoV64(p.shipping?.status,'envio'))}</div></td>
                  <td class="p-4">${htmlFiscalPedidoV101(String(p.id))}</td>
                </tr>`;
            }).join(''):'<tr><td colspan="8" class="p-10 text-center text-slate-500">Nenhum pedido encontrado.</td></tr>';
        }
        const stats={
          pendente:pedidos.filter(x=>x.situacao==='pendente').length,
          em_andamento:pedidos.filter(x=>x.situacao==='em_andamento').length,
          entregue:pedidos.filter(x=>x.situacao==='entregue').length
        };
        const tp=document.getElementById('pedidos-total-pagina'),pe=document.getElementById('pedidos-pendentes'),pa=document.getElementById('pedidos-andamento'),pd=document.getElementById('pedidos-entregues');
        if(tp)tp.innerText=pedidos.length.toLocaleString('pt-BR');if(pe)pe.innerText=stats.pendente.toLocaleString('pt-BR');if(pa)pa.innerText=stats.em_andamento.toLocaleString('pt-BR');if(pd)pd.innerText=stats.entregue.toLocaleString('pt-BR');
        const pag=document.getElementById('pedidos-paginacao');if(pag)pag.textContent=`${Number(d.total||0).toLocaleString('pt-BR')} pedido(s) \u00b7 P\u00e1gina ${pedidosPaginaV21}/${pedidosPaginasV21}`;
        const ant=document.getElementById('pedidos-anterior'),prox=document.getElementById('pedidos-proxima');
        if(ant)ant.disabled=pedidosPaginaV21<=1;if(prox)prox.disabled=pedidosPaginaV21>=pedidosPaginasV21;
    }catch(e){alert(e.message)}finally{pedidosCarregandoV21=false;esconderLoading()}
}
function pedidosIrPaginaV21(delta){const p=pedidosPaginaV21+delta;if(p<1||p>pedidosPaginasV21)return;carregarPedidosV21(p)}


/* =========================================================
   V27 \u2014 BASE DE CUSTO E MARGEM POR SKU
========================================================= */
const BASE_SKU_CACHE_KEY_V42='mlHubPro_baseSku_v42';
let baseSkuSellerIdV42='';
let baseSkuVersionV42='';
let baseSkuCheckAtV42=0;
let baseSkuCheckPromiseV42=null;

function aplicarRegrasBaseSkuV42(regras=[]){
    Object.keys(baseSkuV27).forEach(k=>delete baseSkuV27[k]);
    (Array.isArray(regras)?regras:[]).forEach(regra=>{
        const key=normalizarSkuV27(regra.sku_key||regra.sku);
        if(!key)return;
        baseSkuV27[key]={
            sku:String(regra.sku||'').trim(),
            custo:Number(regra.custo||0),
            margem:Number(regra.margem||0),
            updated_at:regra.updated_at||null
        };
    });
    baseSkuCarregadaV27=true;
    baseSkuFingerprintV34=fingerprintBaseSkuV34();
}

function salvarBaseSkuCacheV42(){
    try{
        localStorage.setItem(BASE_SKU_CACHE_KEY_V42,JSON.stringify({
            seller_id:String(baseSkuSellerIdV42||''),
            version:String(baseSkuVersionV42||''),
            regras:Object.values(baseSkuV27),
            saved_at:Date.now()
        }));
    }catch(e){console.warn('[BASE SKU CACHE V42]',e)}
}

async function hidratarBaseSkuCacheV42(){
    if(baseSkuCarregadaV27)return true;
    try{
        const raw=localStorage.getItem(BASE_SKU_CACHE_KEY_V42);
        if(!raw)return false;
        const c=JSON.parse(raw);
        if(!Array.isArray(c?.regras))return false;

        // Evita usar dados de outra conta quando j\u00e1 sabemos o seller atual.
        let sellerAtual='';
        try{sellerAtual=String((await idbMetaV32('sync'))?.seller_id||'')}catch(e){}
        if(sellerAtual&&c?.seller_id&&String(c.seller_id)!==sellerAtual)return false;

        baseSkuSellerIdV42=String(c?.seller_id||sellerAtual||'');
        baseSkuVersionV42=String(c?.version||'');
        aplicarRegrasBaseSkuV42(c.regras);
        return true;
    }catch(e){
        console.warn('[BASE SKU HYDRATE V42]',e);
        return false;
    }
}

async function carregarBaseSkuV27(force=false,{includeAvailable=true}={}){
    if(baseSkuCarregadaV27&&!force){
        return {mudou:false,fingerprint:baseSkuFingerprintV34,version:baseSkuVersionV42};
    }

    const token=obterToken();
    if(!token)return {mudou:false,fingerprint:baseSkuFingerprintV34,version:baseSkuVersionV42};

    const fingerprintAntes=baseSkuFingerprintV34||fingerprintBaseSkuV34();
    const p=new URLSearchParams({include_available:includeAvailable?'1':'0'});
    const r=await fetch(`${RENDER_URL}/api/v27/sku-pricing?${p.toString()}`,{
        headers:{Authorization:token,Accept:'application/json'}
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.erro||'Erro ao carregar a base de custos por SKU.');

    aplicarRegrasBaseSkuV42(d.regras||[]);
    if(includeAvailable){
        skuDisponiveisV27=Array.isArray(d.skus_disponiveis)?d.skus_disponiveis:[];
    }
    baseSkuSellerIdV42=String(d.seller_id||baseSkuSellerIdV42||'');
    baseSkuVersionV42=String(d.version||baseSkuVersionV42||'');

    const fingerprintDepois=fingerprintBaseSkuV34();
    const mudou=fingerprintAntes!==fingerprintDepois;
    baseSkuFingerprintV34=fingerprintDepois;
    salvarBaseSkuCacheV42();

    return {mudou,fingerprint:fingerprintDepois,version:baseSkuVersionV42};
}

async function verificarBaseSkuV42EmBackground(){
    const agora=Date.now();
    if(baseSkuCheckPromiseV42)return baseSkuCheckPromiseV42;
    if(agora-baseSkuCheckAtV42<60000)return {mudou:false};
    baseSkuCheckAtV42=agora;

    baseSkuCheckPromiseV42=(async()=>{
        const token=obterToken();
        if(!token)return {mudou:false};
        const r=await fetch(`${RENDER_URL}/api/v42/sku-pricing/version`,{
            headers:{Authorization:token,Accept:'application/json'}
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||'Erro ao verificar a Base Financeira.');

        const seller=String(d.seller_id||'');
        const version=String(d.version||'');
        if(baseSkuSellerIdV42&&seller&&seller!==baseSkuSellerIdV42){
            baseSkuCarregadaV27=false;
            Object.keys(baseSkuV27).forEach(k=>delete baseSkuV27[k]);
            baseSkuVersionV42='';
        }

        if(!baseSkuCarregadaV27 || version!==baseSkuVersionV42){
            const info=await carregarBaseSkuV27(true,{includeAvailable:false});
            simFiltroRenderKeyV30='';
            atualFiltroRenderKeyV30='';

            const aba=String(window.abaAtualAtiva||localStorage.getItem('mlHubPro_abaAtual_v1')||'');
            if(aba==='simulacao'&&simItensV21.length){
                renderizarSimulacaoCompletaV29(simItensV21);
                simFiltroRenderKeyV30=chaveFiltroEscalaV30();
            }
            if(aba==='atualizacao'&&atualItensV21.length){
                renderizarAtualizacaoCompletaV29(atualItensV21);
                atualFiltroRenderKeyV30=chaveFiltroEscalaV30();
            }
            return {mudou:Boolean(info?.mudou)};
        }
        return {mudou:false};
    })();

    try{return await baseSkuCheckPromiseV42}
    finally{baseSkuCheckPromiseV42=null}
}

async function carregarBaseSkuRapidaV42(){
    if(!baseSkuCarregadaV27)await hidratarBaseSkuCacheV42();
    if(!baseSkuCarregadaV27){
        return carregarBaseSkuV27(true,{includeAvailable:false});
    }

    // N\u00e3o bloqueia a Simula\u00e7\u00e3o/Atualiza\u00e7\u00e3o: verifica mudan\u00e7a depois de abrir.
    setTimeout(()=>verificarBaseSkuV42EmBackground().catch(e=>console.warn('[BASE SKU CHECK V42]',e.message)),50);
    return {mudou:false,fingerprint:baseSkuFingerprintV34,version:baseSkuVersionV42,cache:true};
}

function anunciosSkuV27(sku){
    const key=normalizarSkuV27(sku);
    return Number(skuDisponiveisV27.find(x=>normalizarSkuV27(x.sku_key||x.sku)===key)?.anuncios||0);
}

function dataCurtaSkuV27(v){
    if(!v)return '\u2014';
    const d=new Date(v);
    return Number.isNaN(d.getTime())?'\u2014':d.toLocaleString('pt-BR');
}

function linhaSkuV27(regra={}){
    skuLinhaSeqV27++;
    const id=`sku-row-v27-${skuLinhaSeqV27}`;
    const sku=String(regra.sku||'');
    const custo=regra.custo!==undefined&&regra.custo!==null?Number(regra.custo):'';
    const margem=regra.margem!==undefined&&regra.margem!==null?Number(regra.margem):'';
    const anuncios=sku?anunciosSkuV27(sku):0;
    const atualizado=regra.updated_at?dataCurtaSkuV27(regra.updated_at):'Nova linha';

    return `<tr id="${id}" data-sku-original="${escapeHtml(sku)}">
      <td class="p-4 min-w-[230px]">
        <input list="sku-base-list-v27" value="${escapeHtml(sku)}"
          class="sku-v27-input w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"
          placeholder="Digite ou selecione um SKU"
          oninput="atualizarContagemLinhaSkuV27('${id}')">
      </td>
      <td class="p-4">
        <span class="sku-v27-contagem text-slate-300 font-bold">${anuncios.toLocaleString('pt-BR')}</span>
      </td>
      <td class="p-4 min-w-[170px]">
        <input type="number" min="0" step="0.01" value="${custo}"
          class="sku-v27-custo w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"
          placeholder="Ex.: 25,00">
      </td>
      <td class="p-4 min-w-[170px]">
        <input type="number" min="0" max="94.99" step="0.1" value="${margem}"
          class="sku-v27-margem w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white"
          placeholder="Ex.: 20">
      </td>
      <td class="p-4 text-slate-500 text-[10px]">${escapeHtml(atualizado)}</td>
      <td class="p-4">
        <button onclick="removerLinhaSkuV27('${id}')" class="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 px-3 py-2 rounded-lg text-[10px] font-black">
          Remover
        </button>
      </td>
    </tr>`;
}

function preencherDatalistSkuV27(){
    const dl=document.getElementById('sku-base-list-v27');
    if(!dl)return;
    dl.innerHTML=skuDisponiveisV27
      .map(x=>`<option value="${escapeHtml(x.sku||'')}">${Number(x.anuncios||0).toLocaleString('pt-BR')} an\u00fancio(s)</option>`)
      .join('');
}

function renderBaseSkuV27(){
    preencherDatalistSkuV27();

    const tbody=document.getElementById('sku-base-tabela-v27');
    if(!tbody)return;

    const regras=Object.values(baseSkuV27).sort((a,b)=>String(a.sku).localeCompare(String(b.sku),'pt-BR'));
    tbody.innerHTML=regras.length
      ? regras.map(linhaSkuV27).join('')
      : linhaSkuV27({});

    const total=document.getElementById('sku-base-total-v27');
    const disp=document.getElementById('sku-base-disponiveis-v27');
    if(total)total.innerText=regras.length.toLocaleString('pt-BR');
    if(disp)disp.innerText=skuDisponiveisV27.length.toLocaleString('pt-BR');

    const st=document.getElementById('sku-base-status-v27');
    if(st)st.textContent=regras.length
      ? `${regras.length.toLocaleString('pt-BR')} SKU(s) com custo e margem salvos.`
      : 'Nenhum custo por SKU cadastrado ainda.';
}

async function abrirBaseSkuV27(){
    mostrarLoading('Carregando custos e margens por SKU...');
    try{
        await carregarBaseSkuV27(true,{includeAvailable:true});
        renderBaseSkuV27();
    }catch(e){
        const tb=document.getElementById('sku-base-tabela-v27');
        if(tb)tb.innerHTML=`<tr><td colspan="6" class="p-8 text-center text-red-400">${escapeHtml(e.message)}</td></tr>`;
    }finally{
        esconderLoading();
    }
}

function adicionarLinhaSkuV27(){
    const tbody=document.getElementById('sku-base-tabela-v27');
    if(!tbody)return;
    const vazio=tbody.querySelector('td[colspan="6"]');
    if(vazio)tbody.innerHTML='';
    tbody.insertAdjacentHTML('beforeend',linhaSkuV27({}));
    tbody.lastElementChild?.querySelector('.sku-v27-input')?.focus();
}

function atualizarContagemLinhaSkuV27(rowId){
    const row=document.getElementById(rowId);
    if(!row)return;
    const sku=row.querySelector('.sku-v27-input')?.value||'';
    const el=row.querySelector('.sku-v27-contagem');
    if(el)el.textContent=anunciosSkuV27(sku).toLocaleString('pt-BR');
}

async function removerLinhaSkuV27(rowId){
    const row=document.getElementById(rowId);
    if(!row)return;

    const skuOriginal=String(row.dataset.skuOriginal||'').trim();
    const skuAtual=String(row.querySelector('.sku-v27-input')?.value||'').trim();

    if(skuOriginal && baseSkuV27[normalizarSkuV27(skuOriginal)]){
        if(!confirm(`Remover a base de custo e margem do SKU ${skuOriginal}?`))return;

        const token=obterToken();
        try{
            const r=await fetch(`${RENDER_URL}/api/v27/sku-pricing/${encodeURIComponent(skuOriginal)}`,{
                method:'DELETE',
                headers:{Authorization:token}
            });
            const d=await r.json().catch(()=>({}));
            if(!r.ok)throw new Error(d.erro||'Erro ao remover SKU.');

            delete baseSkuV27[normalizarSkuV27(skuOriginal)];
            baseSkuFingerprintV34=fingerprintBaseSkuV34();
            baseSkuVersionV42='';
            baseSkuCheckAtV42=0;
            salvarBaseSkuCacheV42();
            simFiltroRenderKeyV30='';
            atualFiltroRenderKeyV30='';

            row.remove();
            renderBaseSkuV27();

            if(simItensV21.length)renderizarSimulacaoCompletaV29(simItensV21);
            if(atualItensV21.length)renderizarAtualizacaoCompletaV29(atualItensV21);
        }catch(e){
            alert(e.message);
        }
        return;
    }

    row.remove();
    const tbody=document.getElementById('sku-base-tabela-v27');
    if(tbody&&!tbody.children.length)tbody.innerHTML=linhaSkuV27({});
}

async function salvarBaseSkuV27(){
    const token=obterToken();
    if(!token){solicitarToken();return}

    const rows=[...document.querySelectorAll('#sku-base-tabela-v27 tr')];
    const mapa=new Map();

    for(const row of rows){
        const sku=String(row.querySelector('.sku-v27-input')?.value||'').trim();
        const custoTexto=row.querySelector('.sku-v27-custo')?.value;
        const margemTexto=row.querySelector('.sku-v27-margem')?.value;

        if(!sku&&!custoTexto&&!margemTexto)continue;
        if(!sku)return alert('Existe uma linha sem SKU. Preencha ou remova essa linha.');

        const custo=Number(custoTexto);
        const margem=Number(margemTexto);

        if(!Number.isFinite(custo)||custo<0)return alert(`Custo inv\u00e1lido no SKU ${sku}.`);
        if(!Number.isFinite(margem)||margem<0||margem>=95)return alert(`Margem inv\u00e1lida no SKU ${sku}. Use de 0 at\u00e9 94,99%.`);

        mapa.set(normalizarSkuV27(sku),{sku,custo,margem});
    }

    const regras=[...mapa.values()];
    if(!regras.length)return alert('Adicione pelo menos um SKU com custo e margem.');

    mostrarLoading(`Salvando ${regras.length.toLocaleString('pt-BR')} SKU(s)...`);
    try{
        const r=await fetch(`${RENDER_URL}/api/v27/sku-pricing`,{
            method:'POST',
            headers:{Authorization:token,'Content-Type':'application/json'},
            body:JSON.stringify({regras})
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||'Erro ao salvar a base.');

        // Limpa edi\u00e7\u00f5es tempor\u00e1rias para a nova base passar a valer imediatamente.
        Object.keys(simParametrosPorIdV21).forEach(k=>delete simParametrosPorIdV21[k]);
        baseSkuCarregadaV27=false;
        baseSkuFingerprintV34='';
        baseSkuVersionV42=String(d.version||'');
        baseSkuSellerIdV42=String(d.seller_id||baseSkuSellerIdV42||'');
        baseSkuCheckAtV42=Date.now();
        await carregarBaseSkuV27(true,{includeAvailable:true});

        simFiltroRenderKeyV30='';
        atualFiltroRenderKeyV30='';

        renderBaseSkuV27();

        const st=document.getElementById('sku-base-status-v27');
        if(st)st.innerHTML=`<span class="text-emerald-400 font-bold">\u2713 ${escapeHtml(d.mensagem||'Base salva com sucesso.')}</span>`;

        // Se a simula\u00e7\u00e3o j\u00e1 tem dados carregados, reaplica a nova base imediatamente.
        if(simItensV21.length)renderizarSimulacaoCompletaV29(simItensV21);
        if(atualItensV21.length)renderizarAtualizacaoCompletaV29(atualItensV21);
    }catch(e){
        alert(e.message);
    }finally{
        esconderLoading();
    }
}

/* Navega\u00e7\u00e3o V21: Gest\u00e3o continua paginada; Simula\u00e7\u00e3o/Atualiza\u00e7\u00e3o/Pedidos ganham seus loaders pr\u00f3prios. */
const _mudarAbaV21=mudarAba;
mudarAba=function(aba){
    const destino=String(aba);
    const abasPainelV24=['gestao','simulacao','atualizacao','pedidos','perguntas','reclamacoes','criar-massa','anuncios-restritos','promocoes','inteligencia-anuncios'];

    document.body.classList.toggle('atendimento-isolado',destino==='atendimento');
    document.body.classList.toggle('configuracoes-isolado-v23',destino==='configuracoes');
    document.body.classList.toggle('configuracoes-isolado-v24',destino==='configuracoes');
    document.body.classList.toggle('perfil-isolado-v24',destino==='perfil');
    document.body.classList.toggle('pagina-inicio-v23',destino==='inicio');
    document.body.classList.toggle('painel-menu-v24',abasPainelV24.includes(destino));

    _mudarAbaV21(aba);

    const destaqueMenu=destino==='sku-base'?'simulacao':(destino==='agentes-produto'?'criar-massa':destino);
    document.querySelectorAll('#painel-sidebar-v24 [data-aba]').forEach(btn=>{
        btn.classList.toggle('active',btn.dataset.aba===destaqueMenu);
    });

    if(aba==='sku-base')setTimeout(()=>abrirBaseSkuV27(),0);
    if(aba==='simulacao')setTimeout(()=>{sincronizarFiltroCamposV21();carregarSimulacaoEscalaV21()},0);
    if(aba==='atualizacao')setTimeout(()=>{sincronizarFiltroCamposV21();carregarAtualizacaoEscalaV21()},0);
    if(aba==='pedidos')setTimeout(()=>carregarPedidosV21(pedidosPaginaV21),0);
    if(aba==='anuncios-restritos')setTimeout(()=>carregarAnunciosRestritosV40(false),0);
    if(aba==='promocoes')setTimeout(()=>carregarPromocoesV77(false),0);
    if(aba==='inteligencia-anuncios'&&typeof carregarInteligenciaV96==='function')setTimeout(()=>carregarInteligenciaV96(),0);
};

document.addEventListener('DOMContentLoaded',()=>{
    sincronizarFiltroCamposV21();
    hidratarBaseSkuCacheV42().catch(e=>console.warn('[BASE SKU START V42]',e));
    const abaInicial=localStorage.getItem('mlHubPro_abaAtual_v1')||'inicio';
    const abasPainelV24=['gestao','simulacao','atualizacao','pedidos','perguntas','reclamacoes','criar-massa','anuncios-restritos','promocoes','inteligencia-anuncios'];

    document.body.classList.toggle('configuracoes-isolado-v23',abaInicial==='configuracoes');
    document.body.classList.toggle('configuracoes-isolado-v24',abaInicial==='configuracoes');
    document.body.classList.toggle('perfil-isolado-v24',abaInicial==='perfil');
    document.body.classList.toggle('pagina-inicio-v23',abaInicial==='inicio');
    document.body.classList.toggle('atendimento-isolado',abaInicial==='atendimento');
    document.body.classList.toggle('painel-menu-v24',abasPainelV24.includes(abaInicial));

    const destaqueInicial=abaInicial==='sku-base'?'simulacao':(abaInicial==='agentes-produto'?'criar-massa':abaInicial);
    document.querySelectorAll('#painel-sidebar-v24 [data-aba]').forEach(btn=>{
        btn.classList.toggle('active',btn.dataset.aba===destaqueInicial);
    });
    if(abaInicial==='sku-base')setTimeout(()=>abrirBaseSkuV27(),0);

    // Enter aplica o filtro rapidamente nas duas p\u00e1ginas.
    document.getElementById('sim-filtro-valor')?.addEventListener('keydown',e=>{if(e.key==='Enter')aplicarFiltroSimulacaoV21()});
    document.getElementById('atual-filtro-valor')?.addEventListener('keydown',e=>{if(e.key==='Enter')aplicarFiltroAtualizacaoV21()});

    document.getElementById('tabela-atualizacao')?.addEventListener('change',e=>{
        if(e.target?.classList?.contains('check-item')){
            atualizarContadorSelecionadosV31();
        }
    });
});
