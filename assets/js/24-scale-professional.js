
/* =========================================================
   V103 — SCALE 300K / UI PROFISSIONAL
   - Gestão pagina no PostgreSQL e usa IndexedDB cursor como fallback.
   - Preço/frete trabalham por cursor, sem criar array com a conta inteira.
   - Automação calcula/atualiza em chunks.
   - Pausa em massa vira job do servidor.
========================================================= */
const MLHUB_SCALE_PAGE_V103=50;
const MLHUB_SIM_PAGE_V103=1000;
const MLHUB_SCALE_MEMORY_LIMIT_V103=5000;
const processosLocaisV103=new Map();
let processosServerTimerV103=null;
let migracaoIndicesV103EmCurso=false;

function toastV103(msg,tipo='info',ms=4200){
  const el=document.createElement('div');
  el.className='mlhub-v103-toast';
  if(tipo==='erro')el.style.borderColor='rgba(255,105,120,.35)';
  if(tipo==='sucesso')el.style.borderColor='rgba(46,230,166,.30)';
  el.textContent=String(msg||'');
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),Math.max(1600,Number(ms||4200)));
}

function alternarSidebarV103(){
  document.body.classList.toggle('mlhub-sidebar-collapsed');
  localStorage.setItem(
    'mlhub_sidebar_v103',
    document.body.classList.contains('mlhub-sidebar-collapsed')?'1':'0'
  );
}

function alternarProcessCenterV103(){
  document.getElementById('mlhub-process-center-v103')
    ?.classList.toggle('mlhub-collapsed-v103');
}

function nomeProcessoV103(tipo){
  return {
    anuncios:'Sincronização de anúncios',
    precos:'Sincronização de preços',
    fretes:'Sincronização de fretes',
    price_update:'Atualização de preços',
    pause_mass_v103:'Pausa em massa',
    full_sync:'Sincronização de anúncios',
    price_sync:'Preços',
    freight_sync:'Fretes',
    price_update_mass:'Atualização de preços',
    promotion_mass_v77:'Promoções',
    promotion_mass_v91:'Promoções'
  }[tipo]||String(tipo||'Processo');
}

function statusProcessoV103(status){
  return {
    queued:'Na fila',
    running:'Executando',
    paused:'Pausado',
    completed:'Concluído',
    failed:'Falhou',
    cancelled:'Cancelado'
  }[status]||String(status||'');
}

function atualizarProcessCenterV103(){
  const list=document.getElementById('mlhub-process-list-v103');
  const summary=document.getElementById('mlhub-process-summary-v103');
  if(!list||!summary)return;

  const all=[...processosLocaisV103.values()];
  const ativos=all.filter(x=>['queued','running','paused'].includes(x.status));
  summary.textContent=ativos.length
    ?`${ativos.length} processo(s) ativo(s)`
    :'Nenhum processo ativo';

  const ordenar=[...all]
    .sort((a,b)=>Number(b.updated_at||0)-Number(a.updated_at||0))
    .slice(0,8);

  list.innerHTML=ordenar.length
    ?ordenar.map(p=>{
      const total=Number(p.total||0),atual=Number(p.atual||0);
      const pct=total>0?Math.max(0,Math.min(100,Math.round(atual/total*100))):(p.status==='completed'?100:0);
      const control=p.server_job&&p.type==='pause_mass_v103'&&['queued','running','paused'].includes(p.status);
      return `
        <div class="mlhub-process-item-v103">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[10px] font-black text-white">${escapeHtml(nomeProcessoV103(p.type))}</div>
              <div class="text-[9px] text-slate-500 mt-1 truncate">${escapeHtml(p.mensagem||statusProcessoV103(p.status))}</div>
            </div>
            <div class="text-[9px] font-black ${p.status==='failed'?'text-red-300':p.status==='completed'?'text-emerald-400':p.status==='paused'?'text-yellow-300':'text-blue-300'}">
              ${escapeHtml(statusProcessoV103(p.status))}
            </div>
          </div>
          <div class="mlhub-process-bar-track-v103"><div class="mlhub-process-bar-v103" style="width:${pct}%"></div></div>
          <div class="flex items-center justify-between gap-2 mt-2">
            <div class="text-[8px] text-slate-600">
              ${total?`${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · ${pct}%`:''}
            </div>
            ${control?`
              <div class="flex gap-1">
                ${p.status==='paused'
                  ?`<button onclick="acaoJobV103('${p.id}','resume')" class="text-[8px] px-2 py-1 rounded bg-emerald-500/10 text-emerald-300">Continuar</button>`
                  :`<button onclick="acaoJobV103('${p.id}','pause')" class="text-[8px] px-2 py-1 rounded bg-yellow-500/10 text-yellow-300">Pausar</button>`}
                <button onclick="acaoJobV103('${p.id}','cancel')" class="text-[8px] px-2 py-1 rounded bg-red-500/10 text-red-300">Cancelar</button>
              </div>`:''}
          </div>
        </div>`;
    }).join('')
    :'<div class="p-3 text-[10px] text-slate-600">Os processos em andamento aparecerão aqui.</div>';
}

function registrarProcessoLocalV103(tipo,{status='running',atual=0,total=0,mensagem=''}={}){
  // V106: o full_sync do servidor é a mesma sincronização representada
  // localmente como "anuncios". Não exibir dois cards para o mesmo job.
  if(tipo==='anuncios'){
    const serverSync=[...processosLocaisV103.values()].find(
      x=>x.server_job && x.type==='full_sync' &&
         ['queued','running','paused'].includes(x.status)
    );
    if(serverSync){
      processosLocaisV103.delete('local:anuncios');
      atualizarProcessCenterV103();
      return;
    }
  }

  processosLocaisV103.set(`local:${tipo}`,{
    id:`local:${tipo}`,
    type:tipo,
    status,
    atual:Number(atual||0),
    total:Number(total||0),
    mensagem:String(mensagem||''),
    updated_at:Date.now(),
    server_job:false
  });
  atualizarProcessCenterV103();
}

async function carregarJobsRecentesV103(){
  if(!obterToken())return;
  try{
    const r=await fetch(`${RENDER_URL}/api/v103/jobs/recent?limit=8&_=${Date.now()}`,{
      cache:'no-store',
      headers:{Authorization:obterToken()}
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)return;

    for(const j of (d.jobs||[])){
      if(String(j.type||'')==='full_sync'){
        processosLocaisV103.delete('local:anuncios');
      }

      processosLocaisV103.set(`server:${j.id}`,{
        id:String(j.id),
        type:String(j.type||'job'),
        status:String(j.status||''),
        atual:Number(j.progress_current||j.processed||0),
        total:Number(j.progress_total||0),
        mensagem:String(j.message||''),
        updated_at:new Date(j.updated_at||Date.now()).getTime(),
        server_job:true
      });
    }

    atualizarProcessCenterV103();
  }catch(e){}
}

async function acaoJobV103(id,action){
  try{
    const r=await fetch(`${RENDER_URL}/api/v103/jobs/${encodeURIComponent(id)}/action`,{
      method:'POST',
      headers:{
        Authorization:obterToken(),
        'Content-Type':'application/json'
      },
      body:JSON.stringify({action})
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    await carregarJobsRecentesV103();
  }catch(e){
    toastV103(e.message,'erro');
  }
}

/* Hook dos progressos já existentes. */
const atualizarProgressoAnteriorV103=atualizarProgressoV26;
atualizarProgressoV26=function(tipo,obj={}){
  atualizarProgressoAnteriorV103(tipo,obj);
  registrarProcessoLocalV103(tipo,{
    status:obj.status||'running',
    atual:obj.atual||0,
    total:obj.total||0,
    mensagem:obj.mensagem||''
  });
};

const atualizarPainelProgressoAnteriorV103=atualizarPainelProgressoV31;
atualizarPainelProgressoV31=function(obj={}){
  atualizarPainelProgressoAnteriorV103(obj);
  registrarProcessoLocalV103('price_update',{
    status:obj.estado==='error'?'failed':(
      Number(obj.total||0)>0&&Number(obj.processados||0)>=Number(obj.total||0)
        ?'completed'
        :'running'
    ),
    atual:obj.processados||0,
    total:obj.total||0,
    mensagem:obj.texto||''
  });
};

/* ---------- IndexedDB v4: índices para escala ---------- */
function enriquecerRegistroV103(item,sellerId=''){
  const seller=String(
    item?._seller_id||
    item?.seller_id||
    sellerId||
    ''
  ).trim();

  const id=String(item?.id||'').trim();
  const sku=String(item?.sku||'').trim();
  const title=String(item?.title||'').trim();
  const tempo=new Date(
    item?.date_created||
    item?.last_updated||
    item?.last_synced||
    item?.synced_at||
    0
  ).getTime();

  return {
    ...item,
    seller_id:seller,
    cache_key:seller&&id?`${seller}:${id}`:item?.cache_key,
    sku_norm:sku.toLowerCase(),
    title_norm:title.toLowerCase(),
    sort_time:Number.isFinite(tempo)&&tempo>0?tempo:0,
    sold_sort:Math.max(0,Number(item?.sold_quantity||0))
  };
}

abrirDbCacheV32=function(){
  if(dbCachePromiseV32)return dbCachePromiseV32;

  dbCachePromiseV32=new Promise((resolve,reject)=>{
    const req=indexedDB.open(CACHE_DB_V32,4);

    req.onupgradeneeded=()=>{
      const db=req.result;

      if(!db.objectStoreNames.contains(STORE_ITENS_V32)){
        db.createObjectStore(STORE_ITENS_V32,{keyPath:'id'});
      }
      if(!db.objectStoreNames.contains(STORE_META_V32)){
        db.createObjectStore(STORE_META_V32,{keyPath:'key'});
      }
      if(!db.objectStoreNames.contains(STORE_SEEN_V85)){
        db.createObjectStore(STORE_SEEN_V85,{keyPath:'id'});
      }

      let st;
      if(!db.objectStoreNames.contains(STORE_PERSISTENTE_V90)){
        st=db.createObjectStore(STORE_PERSISTENTE_V90,{keyPath:'cache_key'});
      }else{
        st=req.transaction.objectStore(STORE_PERSISTENTE_V90);
      }

      if(!st.indexNames.contains('seller_id')){
        st.createIndex('seller_id','seller_id',{unique:false});
      }
      if(!st.indexNames.contains('seller_status_v103')){
        st.createIndex('seller_status_v103',['seller_id','status'],{unique:false});
      }
      if(!st.indexNames.contains('seller_sku_v103')){
        st.createIndex('seller_sku_v103',['seller_id','sku_norm'],{unique:false});
      }
      if(!st.indexNames.contains('seller_time_v103')){
        st.createIndex('seller_time_v103',['seller_id','sort_time'],{unique:false});
      }
      if(!st.indexNames.contains('seller_sold_v103')){
        st.createIndex('seller_sold_v103',['seller_id','sold_sort'],{unique:false});
      }
    };

    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('Não foi possível abrir o cache local.'));
  });

  return dbCachePromiseV32;
};

async function idbCountSellerV103(sellerId){
  const db=await abrirDbCacheV32();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_PERSISTENTE_V90,'readonly');
    const idx=tx.objectStore(STORE_PERSISTENTE_V90).index('seller_id');
    const req=idx.count(IDBKeyRange.only(String(sellerId)));
    req.onsuccess=()=>resolve(Number(req.result||0));
    req.onerror=()=>reject(req.error);
  });
}

async function idbChunkSellerV103({sellerId,afterKey='',limit=1000}={}){
  const seller=String(sellerId||'').trim();
  if(!seller)return {itens:[],last_key:'',done:true};

  const db=await abrirDbCacheV32();

  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_PERSISTENTE_V90,'readonly');
    const st=tx.objectStore(STORE_PERSISTENTE_V90);

    const min=afterKey
      ?String(afterKey)
      :`${seller}:`;
    const max=`${seller}:\uffff`;

    const range=IDBKeyRange.bound(
      min,
      max,
      Boolean(afterKey),
      false
    );

    const req=st.openCursor(range,'next');
    const itens=[];
    let lastKey=afterKey||'';

    req.onsuccess=()=>{
      const cursor=req.result;
      if(!cursor || itens.length>=limit){
        return resolve({
          itens,
          last_key:lastKey,
          done:!cursor
        });
      }

      itens.push(normalizarItemEscala(cursor.value));
      lastKey=String(cursor.primaryKey||'');
      cursor.continue();
    };

    req.onerror=()=>reject(req.error);
  });
}

async function idbBuscarPersistentesV103(sellerId,ids){
  const seller=String(sellerId||'').trim();
  const lista=[...new Set((ids||[]).map(String).filter(Boolean))];
  const mapa=new Map();
  if(!seller||!lista.length)return mapa;

  const db=await abrirDbCacheV32();

  await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_PERSISTENTE_V90,'readonly');
    const st=tx.objectStore(STORE_PERSISTENTE_V90);
    let pend=lista.length;

    for(const id of lista){
      const req=st.get(`${seller}:${id}`);
      req.onsuccess=()=>{
        if(req.result)mapa.set(id,normalizarItemEscala(req.result));
        if(--pend===0)resolve();
      };
      req.onerror=()=>{
        if(--pend===0)resolve();
      };
    }

    tx.onerror=()=>reject(tx.error);
  });

  return mapa;
}

idbSalvarItensV32=async function(itens){
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
        item?._seller_id||
        item?.seller_id||
        sellerFallback||
        ''
      ).trim();

      if(seller){
        persistente.put(
          enriquecerRegistroV103(item,seller)
        );
      }
    }

    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error('Falha ao salvar cache persistente.'));
  });
};

async function atualizarRegistroPersistenteV103(id,mutator){
  const seller=await sellerAtivoV90();
  if(!seller)return null;

  const db=await abrirDbCacheV32();

  return new Promise((resolve,reject)=>{
    const tx=db.transaction(
      [STORE_PERSISTENTE_V90,STORE_ITENS_V32],
      'readwrite'
    );
    const p=tx.objectStore(STORE_PERSISTENTE_V90);
    const n=tx.objectStore(STORE_ITENS_V32);
    const key=`${seller}:${id}`;
    let saida=null;

    const req=p.get(key);
    req.onsuccess=()=>{
      const atual=req.result;
      if(!atual)return;
      const novo=enriquecerRegistroV103(
        mutator(normalizarItemEscala(atual))||atual,
        seller
      );
      saida=novo;
      p.put(novo);
      n.put(novo);
    };

    tx.oncomplete=()=>resolve(saida);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error('Falha ao atualizar cache.'));
  });
}

async function migrarIndicesV103(){
  if(migracaoIndicesV103EmCurso)return;
  migracaoIndicesV103EmCurso=true;

  try{
    const seller=await sellerAtivoV90();
    if(!seller)return;

    let meta=await idbMetaV32(`index_migration_v103:${seller}`).catch(()=>null);
    let after=String(meta?.last_key||'');
    let loops=0;

    while(loops++<6){
      const chunk=await idbChunkSellerV103({
        sellerId:seller,
        afterKey:after,
        limit:1000
      });

      if(!chunk.itens.length)break;

      await idbSalvarItensV32(
        chunk.itens.map(x=>({...x,_seller_id:seller}))
      );

      after=chunk.last_key;

      await idbSalvarMetaV32({
        key:`index_migration_v103:${seller}`,
        last_key:after,
        completed:Boolean(chunk.done),
        updated_at:new Date().toISOString()
      });

      if(chunk.done)break;

      await new Promise(r=>setTimeout(r,0));
    }

    if(after && !(await idbMetaV32(`index_migration_v103:${seller}`))?.completed){
      setTimeout(()=>migrarIndicesV103(),1200);
    }
  }catch(e){
    console.warn('[INDEX MIGRATION V103]',e);
  }finally{
    migracaoIndicesV103EmCurso=false;
  }
}

/* ---------- Gestão paginada ---------- */
async function paginaIndexedDbGestaoV103({
  sellerId,
  page=1,
  limit=50,
  q='',
  status='',
  sort='recent',
  forceSellerIndex=false
}={}){
  const seller=String(sellerId||'').trim();
  const busca=String(q||'').trim().toLowerCase();
  const offset=Math.max(0,(Math.max(1,Number(page||1))-1)*limit);
  const db=await abrirDbCacheV32();

  const executar=()=>new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE_PERSISTENTE_V90,'readonly');
    const st=tx.objectStore(STORE_PERSISTENTE_V90);
    const sellerIdx=st.index('seller_id');

    let source=sellerIdx;
    let range=IDBKeyRange.only(seller);
    let direction='next';
    let usingCompound=false;

    if(!forceSellerIndex&&!busca&&status&&st.indexNames.contains('seller_status_v103')){
      source=st.index('seller_status_v103');
      range=IDBKeyRange.only([seller,String(status)]);
      direction=sort==='oldest'?'next':'prev';
      usingCompound=true;
    }else if(!forceSellerIndex&&!busca&&!status&&sort==='sold'&&st.indexNames.contains('seller_sold_v103')){
      source=st.index('seller_sold_v103');
      range=IDBKeyRange.bound([seller,0],[seller,Number.MAX_SAFE_INTEGER]);
      direction='prev';
      usingCompound=true;
    }else if(!forceSellerIndex&&!busca&&!status&&['recent','oldest'].includes(sort)&&st.indexNames.contains('seller_time_v103')){
      source=st.index('seller_time_v103');
      range=IDBKeyRange.bound([seller,0],[seller,Number.MAX_SAFE_INTEGER]);
      direction=sort==='oldest'?'next':'prev';
      usingCompound=true;
    }

    const itens=[];
    let total=0;
    let matchIndex=0;

    const req=source.openCursor(range,direction);

    req.onsuccess=()=>{
      const cursor=req.result;

      if(!cursor){
        return resolve({
          itens,
          total,
          paginas:Math.max(1,Math.ceil(total/limit)),
          usingCompound
        });
      }

      const item=normalizarItemEscala(cursor.value);
      const okStatus=!status||String(item.status||'')===String(status);
      const okBusca=!busca||
        String(item.id||'').toLowerCase().includes(busca)||
        String(item.sku||'').toLowerCase().includes(busca)||
        String(item.title||'').toLowerCase().includes(busca);

      if(okStatus&&okBusca){
        if(matchIndex>=offset&&itens.length<limit){
          itens.push(item);
        }
        matchIndex++;
        total++;
      }

      cursor.continue();
    };

    req.onerror=()=>reject(req.error);
    tx.onerror=()=>reject(tx.error);
  });

  const result=await executar();

  if(
    result.usingCompound &&
    result.total===0 &&
    !busca
  ){
    const sellerCount=await idbCountSellerV103(seller).catch(()=>0);

    if(sellerCount>0){
      return paginaIndexedDbGestaoV103({
        sellerId:seller,
        page,
        limit,
        q,
        status,
        sort,
        forceSellerIndex:true
      });
    }
  }

  return result;
}

v88CarregarGestaoLocal=async function(page=1,{silencioso=false}={}){
  if(gestaoCarregando)return;
  gestaoCarregando=true;

  if(!silencioso)mostrarLoading('Carregando página da Gestão...');

  try{
    const seller=await sellerAtivoV90();

    // V105: o PostgreSQL é a fonte principal da Gestão.
    // Metadados antigos do sync direto V88 não podem mais forçar fallback
    // para um IndexedDB vazio ou desatualizado.
    const syncMeta=null;
    const processed=0;

    let d=null;
    let fonte='postgres';

    try{
      const p=new URLSearchParams({
        page:String(Math.max(1,Number(page||1))),
        limit:String(MLHUB_SCALE_PAGE_V103),
        sort:String(gestaoOrdenacaoV76||'recent')
      });

      if(String(gestaoBusca||'').trim()){
        p.set('q',String(gestaoBusca).trim());
        p.set('field','all');
      }
      if(gestaoStatusV76)p.set('status',gestaoStatusV76);

      const r=await fetch(`${RENDER_URL}/api/scale/anuncios?${p.toString()}&_=${Date.now()}`,{
        cache:'no-store',
        headers:{Authorization:obterToken()}
      });

      const json=await r.json().catch(()=>({}));

      if(!r.ok)throw new Error(json.erro||`HTTP ${r.status}`);

      const dbTotal=Number(json.total_conta||0);

      // V105: se o servidor respondeu, usa sempre a paginação do PostgreSQL.
      // O IndexedDB fica somente como fallback quando a API realmente falha.
      d=json;
    }catch(e){
      fonte='indexeddb';
      const local=await paginaIndexedDbGestaoV103({
        sellerId:seller,
        page,
        limit:MLHUB_SCALE_PAGE_V103,
        q:gestaoBusca,
        status:gestaoStatusV76,
        sort:gestaoOrdenacaoV76
      });

      const totalConta=await idbCountSellerV103(seller).catch(()=>processed||0);

      d={
        pagina:Math.max(1,Number(page||1)),
        total:Number(local.total||0),
        paginas:Number(local.paginas||1),
        total_conta:totalConta,
        ativos:null,
        outros:null,
        itens:local.itens||[]
      };
    }

    gestaoPagina=Math.max(1,Number(d.pagina||page||1));
    gestaoTotalFiltro=Number(d.total||0);
    gestaoPaginas=Math.max(1,Number(d.paginas||1));

    cacheItens=(d.itens||[]).map(normalizarItemEscala);

    // Mescla somente os 50 registros visíveis com o cache local.
    // Assim qualidade, auditoria de fotos/descrição e campos locais não somem
    // quando a página principal vem do PostgreSQL.
    if(seller && cacheItens.length){
      const locais=await idbBuscarPersistentesV103(
        seller,
        cacheItens.map(x=>String(x.id))
      ).catch(()=>new Map());

      cacheItens=cacheItens.map(item=>{
        const old=locais.get(String(item.id));
        if(!old)return item;

        return {
          ...old,
          ...item,
          quality_score:old.quality_score??item.quality_score??null,
          quality_level:old.quality_level||item.quality_level||'',
          quality_pending_actions:Number(old.quality_pending_actions??item.quality_pending_actions??0),
          quality_checked_at:old.quality_checked_at||item.quality_checked_at||null,
          quality_calculated_at:old.quality_calculated_at||item.quality_calculated_at||null,
          content_audited_at:old.content_audited_at||item.content_audited_at||null,
          description_exists:old.description_exists??item.description_exists,
          picture_count:old.picture_count??item.picture_count,
          missing_main:old.missing_main??item.missing_main,
          missing_secondary:old.missing_secondary??item.missing_secondary,
          content_score:old.content_score??item.content_score,
          _seller_id:seller
        };
      });
    }

    // Em modo escala, memória mantém somente a página atual.
    masterMapV32=new Map(cacheItens.map(x=>[String(x.id),x]));
    masterAnunciosV32=[...cacheItens];
    masterCarregadoV32=false;

    montarTabelaGestao(cacheItens);

    const totalConta=Number(d.total_conta||0);

    const tl=document.getElementById('total-listado');
    const ta=document.getElementById('total-ativos');
    const to=document.getElementById('total-outros');

    if(tl)tl.innerText=totalConta.toLocaleString('pt-BR');

    if(d.ativos!==null&&d.ativos!==undefined){
      if(ta)ta.innerText=Number(d.ativos||0).toLocaleString('pt-BR');
      if(to)to.innerText=Number(d.outros||0).toLocaleString('pt-BR');
    }

    atualizarPaginacaoGestao();

    const info=document.getElementById('gestao-paginacao-info');
    if(info){
      info.textContent=
        `${gestaoTotalFiltro.toLocaleString('pt-BR')} resultado(s) · `+
        `${MLHUB_SCALE_PAGE_V103} por página · `+
        `${fonte==='postgres'?'servidor paginado':'cache local paginado'} · modo 300k`;
    }
  }catch(e){
    console.error('[GESTÃO V103]',e);
    toastV103('Erro ao carregar Gestão: '+e.message,'erro');
  }finally{
    gestaoCarregando=false;
    if(!silencioso)esconderLoading();
  }
};
window.carregarGestaoEscala=v88CarregarGestaoLocal;

/* ---------- Merge de anúncios sem criar array global gigante ---------- */
aplicarMudancasV32=async function(itens){
  if(!Array.isArray(itens)||!itens.length)return 0;

  const seller=String(
    itens.find(x=>x?._seller_id)?._seller_id||
    await sellerAtivoV90()||
    ''
  );

  const normalizados=itens.map(raw=>({
    ...normalizarItemEscala(raw),
    _seller_id:String(raw?._seller_id||seller||'')
  }));

  const anteriores=await idbBuscarPersistentesV103(
    seller,
    normalizados.map(x=>x.id)
  ).catch(()=>new Map());

  const finais=normalizados.map(incoming=>{
    const old=anteriores.get(String(incoming.id))||
      masterMapV32.get(String(incoming.id));

    if(!old)return incoming;

    const raw=itens.find(x=>String(x?.id)===String(incoming.id))||{};

    return {
      ...old,
      ...incoming,
      shipping_cost:
        Number(incoming.shipping_cost||0)>0 ||
        Number(old.shipping_cost||0)<=0
          ?Number(incoming.shipping_cost||0)
          :Number(old.shipping_cost||0),
      free_shipping:
        incoming.free_shipping!==undefined
          ?Boolean(incoming.free_shipping)
          :Boolean(old.free_shipping),
      quality_score:
        Object.prototype.hasOwnProperty.call(raw,'quality_score')
          ?incoming.quality_score
          :old.quality_score,
      quality_level:
        Object.prototype.hasOwnProperty.call(raw,'quality_level')
          ?incoming.quality_level
          :old.quality_level,
      quality_pending_actions:
        Object.prototype.hasOwnProperty.call(raw,'quality_pending_actions')
          ?incoming.quality_pending_actions
          :old.quality_pending_actions,
      quality_checked_at:incoming.quality_checked_at||old.quality_checked_at||null,
      content_audited_at:incoming.content_audited_at||old.content_audited_at||null,
      description_exists:
        incoming.description_exists!==undefined
          ?incoming.description_exists
          :old.description_exists,
      picture_count:
        incoming.picture_count!==undefined
          ?incoming.picture_count
          :old.picture_count,
      missing_main:incoming.missing_main??old.missing_main,
      missing_secondary:incoming.missing_secondary??old.missing_secondary,
      content_score:incoming.content_score??old.content_score,
      _seller_id:String(incoming._seller_id||seller||old.seller_id||'')
    };
  });

  await idbSalvarItensV32(finais);

  // Atualiza somente objetos que já estão na página atual.
  for(const item of finais){
    if(masterMapV32.has(String(item.id))){
      masterMapV32.set(String(item.id),item);
    }
  }

  simFiltroRenderKeyV30='';
  atualFiltroRenderKeyV30='';
  anunciosEscalaCacheV30.clear();

  return finais.length;
};

/* ---------- Importação de anúncios sem getAll() ---------- */
sincronizarAnunciosDiretoV88=async function({retomarAutomatico=false}={}){
  if(syncV88Executando)return;

  const token=obterToken();
  if(!token){solicitarToken();return}

  syncV88Executando=true;
  syncV88Abortar=false;

  let meta=await idbMetaV32('direct_sync_v88').catch(()=>null);
  let scrollId=null,total=0,sellerId='',processed=0;

  if(meta&&meta.completed===false){
    scrollId=meta.scroll_id||null;
    total=Number(meta.total||0);
    sellerId=String(meta.seller_id||'');
    processed=Number(meta.processed||0);
  }else{
    await idbLimparSeenV85();
    meta=null;
  }

  atualizarProgressoV26('anuncios',{
    status:'running',
    atual:processed,
    total,
    mensagem:processed
      ?`Retomando do checkpoint · ${processed.toLocaleString('pt-BR')} já salvos`
      :'Preparando lote de até 1.000 anúncios...'
  });

  let falhasSeguidas=0,reiniciosCursor=0;

  try{
    while(!syncV88Abortar&&!window.automationShouldYieldV101?.()){
      let d;

      try{
        d=await v88BuscarPagina(scrollId);
        falhasSeguidas=0;
      }catch(e){
        const msg=String(e?.message||e||'');
        if(!v88Temporario(msg))throw e;

        falhasSeguidas++;
        const espera=Math.min(
          30000,
          700*Math.pow(2,Math.min(falhasSeguidas,5))+
          Math.floor(Math.random()*500)
        );

        atualizarProgressoV26('anuncios',{
          status:'running',
          atual:processed,
          total,
          mensagem:`Instabilidade temporária · checkpoint preservado · nova tentativa em ${Math.ceil(espera/1000)}s`
        });

        await v88Sleep(espera);
        continue;
      }

      if(d.cursor_expirado){
        reiniciosCursor++;
        scrollId=null;

        await v88SalvarCheckpoint({
          sellerId:sellerId||d.seller_id,
          total,
          processed,
          scrollId:null,
          completed:false,
          lastError:'cursor_expirado'
        });

        if(reiniciosCursor>8){
          throw new Error('O cursor expirou repetidamente. Reinicie a sincronização para reconstruir a leitura.');
        }
        continue;
      }

      const sellerAtual=String(d.seller_id||sellerId||'');
      sellerId=sellerAtual;
      total=Number(d.total||total||0);

      const itens=(Array.isArray(d.itens)?d.itens:[])
        .map(x=>({
          ...normalizarItemEscala(x),
          _seller_id:sellerAtual
        }));

      if(itens.length){
        await aplicarMudancasV32(itens);
        await idbSalvarSeenV85(itens.map(x=>String(x.id)));
      }

      processed=await idbContarSeenV85().catch(()=>processed+itens.length);
      scrollId=d.scroll_id||null;

      await v88SalvarCheckpoint({
        sellerId,
        total,
        processed,
        scrollId,
        completed:Boolean(d.terminou)
      });

      const pct=total?Math.min(100,Math.round(processed/total*100)):0;

      atualizarProgressoV26('anuncios',{
        status:d.terminou?'completed':'running',
        atual:processed,
        total,
        mensagem:d.terminou
          ?`Concluído · ${processed.toLocaleString('pt-BR')} anúncios salvos`
          :`${processed.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · ${pct}% · lote de até 1.000`
      });

      // Atualiza só a página atual, sem reabrir 300 mil objetos.
      if(
        String(window.abaAtualAtiva||'')==='gestao' &&
        (d.terminou || processed%5000===0 || processed<=1000)
      ){
        await v88CarregarGestaoLocal(1,{silencioso:true});
      }

      if(d.terminou){
        setTimeout(()=>migrarIndicesV103(),200);
        return;
      }

      await v88Sleep(0);
    }
  }catch(e){
    const msg=String(e?.message||e||'Erro desconhecido');

    await v88SalvarCheckpoint({
      sellerId,total,processed,scrollId,
      completed:false,lastError:msg
    }).catch(()=>{});

    atualizarProgressoV26('anuncios',{
      status:'queued',
      atual:processed,
      total,
      mensagem:`Pausado com checkpoint salvo · ${msg}`
    });

    if(!retomarAutomatico&&!v88Temporario(msg))alert(msg);
  }finally{
    syncV88Executando=false;
  }
};
window.sincronizarAnunciosDiretoV88=sincronizarAnunciosDiretoV88;
window.puxarNovosAnuncios=()=>sincronizarAnunciosDiretoV88();

/* ---------- Preços: cursor de 1.000 sem array global ---------- */
async function aplicarPrecosV103(resultados){
  let ok=0,failed=0;
  for(const r of (resultados||[])){
    if(!r?.id)continue;

    if(!r.sucesso||!Number.isFinite(Number(r.price))){
      failed++;
      continue;
    }

    const atualizado=await atualizarRegistroPersistenteV103(
      String(r.id),
      atual=>{
        const price=Number(r.price);
        return {
          ...atual,
          price,
          available_quantity:r.available_quantity!==undefined
            ?Number(r.available_quantity||0)
            :Number(atual.available_quantity||0),
          sold_quantity:r.sold_quantity!==undefined
            ?Number(r.sold_quantity||0)
            :Number(atual.sold_quantity||0),
          status:r.status||atual.status,
          net_received:Math.max(
            0,
            price-Number(atual.sale_fee||0)-Number(atual.shipping_cost||0)
          ),
          price_synced_at:new Date().toISOString()
        };
      }
    );

    if(atualizado){
      if(masterMapV32.has(String(r.id)))masterMapV32.set(String(r.id),atualizado);
      ok++;
    }else{
      failed++;
    }
  }
  return {ok,failed};
}
aplicarPrecosV92=aplicarPrecosV103;

precoV92SalvarCheckpoint=async function({
  processed=0,total=0,completed=false,failed=0,last_error='',
  last_key='',seller_id=''
}={}){
  await idbSalvarMetaV32({
    key:'direct_price_v92',
    processed:Number(processed||0),
    offset:Number(processed||0),
    total:Number(total||0),
    completed:Boolean(completed),
    failed:Number(failed||0),
    last_error:String(last_error||''),
    last_key:String(last_key||''),
    seller_id:String(seller_id||''),
    updated_at:new Date().toISOString()
  });
};

sincronizarPrecosDiretoV92=async function({retomarAutomatico=false}={}){
  if(precoV92Executando)return;

  const token=obterToken();
  if(!token){solicitarToken();return}

  precoV92Executando=true;

  try{
    const seller=await sellerAtivoV90();
    const total=await idbCountSellerV103(seller);

    if(!total){
      atualizarProgressoV26('precos',{
        status:'completed',atual:0,total:0,
        mensagem:'Nenhum anúncio salvo. Clique primeiro em Puxar anúncios.'
      });
      return;
    }

    let meta=await idbMetaV32('direct_price_v92').catch(()=>null);
    let processed=0,failed=0,lastKey='';

    if(
      meta&&meta.completed===false&&
      String(meta.seller_id||seller)===String(seller)
    ){
      processed=Math.min(total,Number(meta.processed??meta.offset??0));
      failed=Number(meta.failed||0);
      lastKey=String(meta.last_key||'');
    }else{
      await precoV92SalvarCheckpoint({
        processed:0,total,completed:false,failed:0,
        last_key:'',seller_id:seller
      });
    }

    atualizarProgressoV26('precos',{
      status:'running',atual:processed,total,
      mensagem:processed
        ?`Retomando preços · ${processed.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}`
        :`Preços em lotes de 1.000 · ${total.toLocaleString('pt-BR')} anúncios`
    });

    while(processed<total){
      if(window.automationShouldYieldV101?.()){
        await precoV92SalvarCheckpoint({
          processed,total,completed:false,failed,
          last_error:'pausado_pelo_usuario',
          last_key:lastKey,seller_id:seller
        });
        return;
      }

      const chunk=await idbChunkSellerV103({
        sellerId:seller,
        afterKey:lastKey,
        limit:1000
      });

      if(!chunk.itens.length)break;

      const ids=chunk.itens.map(x=>String(x.id));
      let d=null,ultimoErro=null;

      for(let tentativa=1;tentativa<=5;tentativa++){
        try{
          d=await precoV92Enviar(ids);
          ultimoErro=null;
          break;
        }catch(e){
          ultimoErro=e;
          if(!precoV92Temporario(e.message)||tentativa>=5)break;
          await precoV92Sleep(
            Math.min(15000,500*Math.pow(2,tentativa-1)+Math.floor(Math.random()*350))
          );
        }
      }

      if(!d)throw ultimoErro||new Error('Falha ao puxar lote de preços.');

      const ap=await aplicarPrecosV103(d.resultados||[]);
      failed+=Number(ap.failed||0);
      processed+=chunk.itens.length;
      lastKey=chunk.last_key||lastKey;

      await precoV92SalvarCheckpoint({
        processed,total,
        completed:processed>=total||chunk.done,
        failed,last_key:lastKey,seller_id:seller
      });

      atualizarProgressoV26('precos',{
        status:(processed>=total||chunk.done)?'completed':'running',
        atual:Math.min(processed,total),total,
        mensagem:`Preços · ${Math.min(processed,total).toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}${failed?` · ${failed.toLocaleString('pt-BR')} falha(s)`:''}`
      });

      if(String(window.abaAtualAtiva||'')==='gestao' && processed%5000===0){
        await v88CarregarGestaoLocal(gestaoPagina,{silencioso:true});
      }

      if(chunk.done)break;
      await precoV92Sleep(0);
    }
  }catch(e){
    const meta=await idbMetaV32('direct_price_v92').catch(()=>null);
    atualizarProgressoV26('precos',{
      status:'queued',
      atual:Number(meta?.processed??meta?.offset??0),
      total:Number(meta?.total||0),
      mensagem:`Preços pausados com checkpoint · ${e.message}`
    });
    if(!retomarAutomatico&&!precoV92Temporario(e.message))alert(e.message);
  }finally{
    precoV92Executando=false;
  }
};
window.sincronizarPrecosApi=()=>sincronizarPrecosDiretoV92();

/* ---------- Fretes: cursor de 1.000 sem array global ---------- */
freteV89Checkpoint=async function(obj={}){
  await idbSalvarMetaV32({
    key:'direct_freight_v92',
    processed:Number(obj.processed??obj.offset??0),
    offset:Number(obj.processed??obj.offset??0),
    total:Number(obj.total||0),
    completed:Boolean(obj.completed),
    failed:Number(obj.failed||0),
    last_key:String(obj.last_key||''),
    seller_id:String(obj.seller_id||''),
    updated_at:new Date().toISOString(),
    last_error:String(obj.last_error||'')
  });
};

aplicarFretesV89=async function(resultados){
  let ok=0,failed=0;

  for(const r of (resultados||[])){
    if(!r?.id)continue;

    if(!r.sucesso||!Number.isFinite(Number(r.shipping_cost))){
      failed++;
      continue;
    }

    const atualizado=await atualizarRegistroPersistenteV103(
      String(r.id),
      atual=>{
        const shipping=Number(r.shipping_cost||0);
        return {
          ...atual,
          shipping_cost:shipping,
          free_shipping:Boolean(r.free_shipping),
          net_received:Math.max(
            0,
            Number(atual.price||0)-Number(atual.sale_fee||0)-shipping
          ),
          freight_synced_at:new Date().toISOString()
        };
      }
    );

    if(atualizado){
      if(masterMapV32.has(String(r.id)))masterMapV32.set(String(r.id),atualizado);
      ok++;
    }else{
      failed++;
    }
  }

  return {ok,failed};
};

sincronizarFretesDiretoV89=async function({retomarAutomatico=false}={}){
  if(freteV89Executando)return;

  const token=obterToken();
  if(!token){solicitarToken();return}

  freteV89Executando=true;

  try{
    const seller=await sellerAtivoV90();
    const total=await idbCountSellerV103(seller);

    if(!total){
      atualizarProgressoV26('fretes',{
        status:'completed',atual:0,total:0,
        mensagem:'Nenhum anúncio salvo. Clique primeiro em Puxar anúncios.'
      });
      return;
    }

    let meta=await idbMetaV32('direct_freight_v92').catch(()=>null);
    let processed=0,failed=0,lastKey='';

    if(
      meta&&meta.completed===false&&
      String(meta.seller_id||seller)===String(seller)
    ){
      processed=Math.min(total,Number(meta.processed??meta.offset??0));
      failed=Number(meta.failed||0);
      lastKey=String(meta.last_key||'');
    }else{
      await freteV89Checkpoint({
        processed:0,total,completed:false,failed:0,
        last_key:'',seller_id:seller
      });
    }

    atualizarProgressoV26('fretes',{
      status:'running',atual:processed,total,
      mensagem:processed
        ?`Retomando fretes · ${processed.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}`
        :`Fretes em lotes de 1.000 · ${total.toLocaleString('pt-BR')} anúncios`
    });

    while(processed<total){
      if(window.automationShouldYieldV101?.()){
        await freteV89Checkpoint({
          processed,total,completed:false,failed,
          last_error:'pausado_pelo_usuario',
          last_key:lastKey,seller_id:seller
        });
        return;
      }

      const chunk=await idbChunkSellerV103({
        sellerId:seller,
        afterKey:lastKey,
        limit:1000
      });
      if(!chunk.itens.length)break;

      const ids=chunk.itens.map(x=>String(x.id));
      let d=null,ultimoErro=null;

      for(let tentativa=1;tentativa<=5;tentativa++){
        try{
          d=await freteV89Enviar(ids);
          ultimoErro=null;
          break;
        }catch(e){
          ultimoErro=e;
          if(!freteV89Temporario(e.message)||tentativa>=5)break;
          await freteV89Sleep(
            Math.min(18000,700*Math.pow(2,tentativa-1)+Math.floor(Math.random()*450))
          );
        }
      }

      if(!d)throw ultimoErro||new Error('Falha no lote de fretes.');

      const ap=await aplicarFretesV89(d.resultados||[]);
      failed+=Number(ap.failed||0);
      processed+=chunk.itens.length;
      lastKey=chunk.last_key||lastKey;

      await freteV89Checkpoint({
        processed,total,
        completed:processed>=total||chunk.done,
        failed,last_key:lastKey,seller_id:seller
      });

      atualizarProgressoV26('fretes',{
        status:(processed>=total||chunk.done)?'completed':'running',
        atual:Math.min(processed,total),total,
        mensagem:`Fretes · ${Math.min(processed,total).toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}${failed?` · ${failed.toLocaleString('pt-BR')} falha(s)`:''}`
      });

      if(String(window.abaAtualAtiva||'')==='gestao' && processed%5000===0){
        await v88CarregarGestaoLocal(gestaoPagina,{silencioso:true});
      }

      if(chunk.done)break;
      await freteV89Sleep(0);
    }
  }catch(e){
    const meta=await idbMetaV32('direct_freight_v92').catch(()=>null);
    atualizarProgressoV26('fretes',{
      status:'queued',
      atual:Number(meta?.processed??meta?.offset??0),
      total:Number(meta?.total||0),
      mensagem:`Fretes pausados com checkpoint · ${e.message}`
    });

    if(!retomarAutomatico&&!freteV89Temporario(e.message))alert(e.message);
  }finally{
    freteV89Executando=false;
  }
};
window.sincronizarFretesApi=()=>sincronizarFretesDiretoV89();

/* ---------- Simulação/Atualização: nunca renderiza 300k ---------- */
buscarTodosAnunciosEscalaV29=async function(tipo='simulacao',{forcar=false}={}){
  const seller=await sellerAtivoV90();
  const p=queryEscalaV21(1,MLHUB_SIM_PAGE_V103);

  try{
    const r=await fetch(`${RENDER_URL}/api/scale/anuncios?${p.toString()}&_=${Date.now()}`,{
      cache:'no-store',
      headers:{Authorization:obterToken()}
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

    return {
      itens:(d.itens||[]).map(normalizarItemEscala),
      total:Number(d.total||0),
      total_conta:Number(d.total_conta||0),
      alterados:0,
      cache:false,
      truncated:Number(d.total||0)>Number((d.itens||[]).length)
    };
  }catch(e){
    const local=await paginaIndexedDbGestaoV103({
      sellerId:seller,
      page:1,
      limit:MLHUB_SIM_PAGE_V103,
      q:filtroEscalaV21.valor,
      status:'',
      sort:'recent'
    });

    return {
      itens:local.itens,
      total:Number(local.total||0),
      total_conta:await idbCountSellerV103(seller).catch(()=>local.total||0),
      alterados:0,
      cache:true,
      truncated:Number(local.total||0)>Number(local.itens.length)
    };
  }
};

/* ---------- Automação de atualização em cursor ---------- */
atualizarPrecosAutomaticosV101=async function(){
  const state=lerAutomacaoPrecoV101();
  if(state.status!=='running')return false;

  await carregarBaseSkuRapidaV42();

  const seller=await sellerAtivoV90();
  const total=await idbCountSellerV103(seller);
  let lastKey=String(state.update_last_key||'');
  let scanned=Number(state.update_scanned||0);
  let atualizados=Number(state.update_success||0);
  let falhas=Number(state.update_failed||0);

  atualizarPainelProgressoV31({
    total,
    processados:scanned,
    sucessos:atualizados,
    falhas,
    texto:`Automação: analisando ${total.toLocaleString('pt-BR')} anúncios em modo escala.`
  });

  while(scanned<total){
    if(window.automationShouldYieldV101())return false;

    const chunk=await idbChunkSellerV103({
      sellerId:seller,
      afterKey:lastKey,
      limit:1000
    });

    if(!chunk.itens.length)break;

    const candidatos=[];

    for(const item of chunk.itens){
      if(String(item.status||'')!=='active')continue;
      if(item.price_update_allowed===false)continue;

      const calc=calcularSimulacaoV21(
        item,
        parametrosSimV21(item)
      );

      if(calc.foraDaMargem){
        candidatos.push({
          item,
          price:parseFloat(calc.preco.toFixed(2))
        });
      }
    }

    for(let i=0;i<candidatos.length;i+=20){
      if(window.automationShouldYieldV101())return false;

      const lote=candidatos.slice(i,i+20);

      const r=await fetch(`${RENDER_URL}/api/atualizar-precos`,{
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          Authorization:obterToken()
        },
        body:JSON.stringify({
          itens:lote.map(x=>({
            id:x.item.id,
            price:x.price
          }))
        })
      });

      const d=await r.json().catch(()=>({}));
      if(!r.ok&&!Array.isArray(d.resultados)){
        throw new Error(d.erro||`HTTP ${r.status}`);
      }

      const map=new Map((d.resultados||[]).map(x=>[String(x.id),x]));

      for(const alvo of lote){
        const rr=map.get(String(alvo.item.id));

        if(rr?.sucesso){
          atualizados++;
          await atualizarRegistroPersistenteV103(
            String(alvo.item.id),
            atual=>({
              ...atual,
              price:alvo.price,
              net_received:Math.max(
                0,
                alvo.price-
                Number(atual.sale_fee||0)-
                Number(atual.shipping_cost||0)
              ),
              price_synced_at:new Date().toISOString()
            })
          );
        }else{
          falhas++;
        }
      }

      await new Promise(r=>setTimeout(r,250));
    }

    scanned+=chunk.itens.length;
    lastKey=chunk.last_key||lastKey;

    salvarAutomacaoPrecoV101({
      ...lerAutomacaoPrecoV101(),
      status:'running',
      step:'atualizacao',
      update_last_key:lastKey,
      update_scanned:scanned,
      update_success:atualizados,
      update_failed:falhas
    });

    atualizarPainelProgressoV31({
      total,
      processados:Math.min(scanned,total),
      sucessos:atualizados,
      falhas,
      texto:`Automação: ${Math.min(scanned,total).toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} analisados · ${atualizados.toLocaleString('pt-BR')} atualizados · ${falhas.toLocaleString('pt-BR')} impedidos/falhas.`
    });

    if(chunk.done)break;
  }

  if(String(window.abaAtualAtiva||'')==='atualizacao'){
    await carregarAtualizacaoEscalaV21(1);
  }

  return true;
};

/* Limpa cursor de atualização quando começa novo ciclo. */
const iniciarAutomacaoPrecoAnteriorV103=iniciarAutomacaoPrecoV101;
iniciarAutomacaoPrecoV101=function(){
  const antes=lerAutomacaoPrecoV101();
  if(antes.status==='completed'||antes.status==='stopped'){
    const limpo={
      ...antes,
      update_last_key:'',
      update_scanned:0,
      update_success:0,
      update_failed:0
    };
    localStorage.setItem(AUTOMACAO_PRECO_KEY_V101,JSON.stringify(limpo));
  }
  return iniciarAutomacaoPrecoAnteriorV103();
};

/* ---------- Pausa em massa vira job do servidor ---------- */
ajustarPausaMassaV101=async function(){
  const modo=document.getElementById('pausa-modo-v101')?.value||'all';
  const wrap=document.getElementById('pausa-valor-wrap-v101');
  const label=document.getElementById('pausa-valor-label-v101');
  const valor=document.getElementById('pausa-valor-v101')?.value.trim()||'';

  if(wrap)wrap.classList.toggle('hidden',modo==='all');
  if(label)label.textContent=modo==='sku'?'SKU exato':'MLB exato';

  const resumo=document.getElementById('pausa-resumo-v101');
  if(resumo){
    resumo.innerHTML=`
      <div class="font-black text-white">Modo escala V103</div>
      <div class="mt-1">A seleção será feita no servidor, sem carregar todos os anúncios no navegador.</div>
      <div class="text-[9px] text-slate-600 mt-2">
        ${modo==='all'
          ?'Todos os anúncios ativos serão processados em job com checkpoint.'
          :valor
            ?`Filtro: ${escapeHtml(modo.toUpperCase())} = ${escapeHtml(valor)}`
            :'Informe o valor do filtro.'}
      </div>`;
  }

  return {modo,valor};
};

executarPausaMassaV101=async function(){
  if(pausaMassaExecutandoV101)return;

  const {modo,valor}=await ajustarPausaMassaV101();

  if(modo!=='all'&&!valor){
    return alert('Informe o SKU ou MLB.');
  }

  if(!confirm(
    modo==='all'
      ?'Criar um processo para pausar TODOS os anúncios ativos da conta? O job continuará no servidor mesmo se você navegar para outra tela.'
      :`Criar um processo para pausar anúncios com ${modo.toUpperCase()} = ${valor}?`
  ))return;

  pausaMassaExecutandoV101=true;
  const btn=document.getElementById('pausa-executar-v101');
  if(btn)btn.disabled=true;

  try{
    const r=await fetch(`${RENDER_URL}/api/v103/anuncios/pausar-job`,{
      method:'POST',
      headers:{
        Authorization:obterToken(),
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        mode:modo,
        value:valor
      })
    });

    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

    toastV103(
      `Processo criado: ${Number(d.total||0).toLocaleString('pt-BR')} anúncio(s) na fila.`,
      'sucesso'
    );

    fecharPausaMassaV101();
    document.getElementById('mlhub-process-center-v103')?.classList.remove('mlhub-collapsed-v103');
    await carregarJobsRecentesV103();
  }catch(e){
    alert(e.message);
  }finally{
    pausaMassaExecutandoV101=false;
    if(btn)btn.disabled=false;
  }
};

/* ---------- Não migrar com getAll() ---------- */
migrarCacheAtualParaPersistenteV90=async function(){
  // A V103 nunca usa getAll() para migrar uma conta grande.
  setTimeout(()=>migrarIndicesV103(),350);
};

/* ---------- UI info de modo escala ---------- */
function aplicarBadgeEscalaV103(){
  const h=document.querySelector('#secao-gestao h1');
  if(h && !h.parentElement.querySelector('.mlhub-v103-scale-badge')){
    const b=document.createElement('div');
    b.className='mlhub-v103-scale-badge mt-3';
    b.textContent='Scale engine · 300k · OAuth resiliente V104';
    h.parentElement.appendChild(b);
  }
}

document.addEventListener('DOMContentLoaded',()=>{
  if(localStorage.getItem('mlhub_sidebar_v103')==='1'){
    document.body.classList.add('mlhub-sidebar-collapsed');
  }

  aplicarBadgeEscalaV103();
  atualizarProcessCenterV103();

  setTimeout(()=>{
    // V90 redefine estas funções no boot; a V103 neutraliza o caminho que
    // reconstruía arrays completos para Simulação/Atualização.
    cacheCompletoV43=async()=>true;
    reconstruirCacheCompletoV43=async()=>({
      total:0,
      total_conta:0,
      fonte:'v103_paginado'
    });
    agendarSyncBackgroundV42=()=>{};

    migrarIndicesV103();
  },900);

  carregarJobsRecentesV103();
  processosServerTimerV103=setInterval(carregarJobsRecentesV103,5000);
});
