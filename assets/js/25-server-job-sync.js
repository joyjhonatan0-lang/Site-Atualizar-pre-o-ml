
/* =========================================================
   V107 — PUXAR ANÚNCIOS COM MICROCHeckpoint + RECOVERY AUTOMÁTICO
   - corrige conflito entre V88/V93 direto e Gestão V103/V104;
   - PostgreSQL passa a ser a fonte principal;
   - lote lógico de 1.000 no backend;
   - checkpoint e retomada pelo ml_jobs;
   - página da Gestão atualiza durante o processamento.
========================================================= */

let mlHubSyncAnunciosV105Ativo=false;
let mlHubSyncAnunciosV105Timer=null;
let mlHubSyncAnunciosV105UltimoRender=0;
let mlHubSyncAnunciosV105Falhas=0;

async function acompanharAnunciosV105(jobId){
  clearTimeout(mlHubSyncAnunciosV105Timer);

  try{
    const controller=new AbortController();
    const requestTimer=setTimeout(()=>controller.abort(),10000);
    let r;
    try{
      r=await fetch(
        `${RENDER_URL}/api/scale/jobs/${encodeURIComponent(jobId)}?_=${Date.now()}`,
        {
          cache:'no-store',
          signal:controller.signal,
          headers:{
            Authorization:obterToken(),
            Accept:'application/json'
          }
        }
      );
    }finally{
      clearTimeout(requestTimer);
    }
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    mlHubSyncAnunciosV105Falhas=0;

    const j=d.job||{};
    const atual=Number(j.progress_current||j.processed||0);
    const total=Number(j.progress_total||0);

    // V107: se o backend reiniciou ou perdeu o PostgreSQL e o job ficou
    // sem heartbeat, solicita ao endpoint idempotente que acorde/retome
    // o MESMO checkpoint. Limite de 1 tentativa por minuto.
    const atualizadoEm=new Date(j.updated_at||0).getTime();
    if(
      j.status==='running' &&
      atualizadoEm>0 &&
      Date.now()-atualizadoEm>120000 &&
      (!window.__mlhubV106UltimoWake || Date.now()-window.__mlhubV106UltimoWake>60000)
    ){
      window.__mlhubV106UltimoWake=Date.now();
      fetch(`${RENDER_URL}/api/scale/sync`,{
        method:'POST',
        cache:'no-store',
        headers:{
          Authorization:obterToken(),
          'Content-Type':'application/json',
          Accept:'application/json'
        },
        body:'{}'
      }).catch(()=>{});
    }

    atualizarProgressoV26('anuncios',{
      status:j.status||'running',
      atual,
      total,
      mensagem:j.message||'Sincronizando anúncios...'
    });

    // Mostra os anúncios à medida que cada lote de ~1.000 chega ao PostgreSQL.
    if(
      atual>0 &&
      (
        mlHubSyncAnunciosV105UltimoRender===0 ||
        atual-mlHubSyncAnunciosV105UltimoRender>=500
      )
    ){
      mlHubSyncAnunciosV105UltimoRender=atual;
      try{
        await v88CarregarGestaoLocal(1,{silencioso:true});
      }catch(e){}
    }

    if(['queued','running'].includes(String(j.status||''))){
      mlHubSyncAnunciosV105Timer=setTimeout(
        ()=>acompanharAnunciosV105(jobId),
        3500
      );
      return;
    }

    if(j.status==='completed'){
      localStorage.removeItem('mlHubPro_sync_v105_anuncios');
      localStorage.removeItem('mlHubPro_sync_v26_anuncios');

      atualizarProgressoV26('anuncios',{
        status:'completed',
        atual,
        total,
        mensagem:j.message||'Sincronização concluída.'
      });

      try{
        await v88CarregarGestaoLocal(1,{silencioso:true});
      }catch(e){}

      mlHubSyncAnunciosV105Ativo=false;
      return;
    }

    if(j.status==='failed'){
      atualizarProgressoV26('anuncios',{
        status:'queued',
        atual,
        total,
        mensagem:(j.message||'Sincronização pausada.')+
          ' · Clique em Puxar anúncios para retomar do checkpoint.'
      });

      mlHubSyncAnunciosV105Ativo=false;
      return;
    }

    mlHubSyncAnunciosV105Ativo=false;
  }catch(e){
    const msg=String(e?.message||e||'');
    const temporario=/AbortError|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|network|fetch|failed to fetch|connection|57P03|57P01|database system|recovery|429|500|502|503|504/i.test(msg);

    atualizarProgressoV26('anuncios',{
      status:temporario?'running':'queued',
      mensagem:temporario
        ? 'PostgreSQL reconectando · checkpoint preservado · retomada automática ativa'
        : 'Sincronização pausada: '+msg
    });

    if(temporario){
      mlHubSyncAnunciosV105Falhas=Math.min(5,mlHubSyncAnunciosV105Falhas+1);
      const espera=Math.min(20000,4000*Math.pow(2,mlHubSyncAnunciosV105Falhas-1));
      mlHubSyncAnunciosV105Timer=setTimeout(
        ()=>acompanharAnunciosV105(jobId),
        espera
      );
      return;
    }

    mlHubSyncAnunciosV105Ativo=false;
  }
}

async function puxarAnunciosV105({retomarAutomatico=false}={}){
  if(mlHubSyncAnunciosV105Ativo)return;

  const token=obterToken();
  if(!token){
    solicitarToken();
    return;
  }

  mlHubSyncAnunciosV105Ativo=true;
  mlHubSyncAnunciosV105Falhas=0;

  // Desliga qualquer execução direta antiga no navegador.
  try{syncV88Abortar=true}catch(e){}

  atualizarProgressoV26('anuncios',{
    status:'queued',
    atual:0,
    total:0,
    mensagem:'Conectando ao worker · preparando job persistente...'
  });

  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);

    let r;
    try{
      r=await fetch(`${RENDER_URL}/api/scale/sync?_=${Date.now()}`,{
        method:'POST',
        cache:'no-store',
        signal:controller.signal,
        headers:{
          Authorization:token,
          'Content-Type':'application/json',
          Accept:'application/json'
        },
        body:'{}'
      });
    }finally{
      clearTimeout(timer);
    }

    const d=await r.json().catch(()=>({}));

    if(!r.ok){
      if(r.status===401 || r.status===409){
        throw new Error(
          d.erro||
          'A conexão com o Mercado Livre não está disponível. Reconecte a conta.'
        );
      }
      throw new Error(d.erro||`HTTP ${r.status}`);
    }

    const jobId=Number(d.job?.id||0);
    if(!jobId)throw new Error('O servidor não retornou o ID do job de anúncios.');

    localStorage.setItem('mlHubPro_sync_v105_anuncios',String(jobId));
    localStorage.removeItem('mlHubPro_sync_v26_anuncios');

    atualizarProgressoV26('anuncios',{
      status:d.job?.status||'queued',
      atual:Number(d.job?.progress_current||0),
      total:Number(d.job?.progress_total||0),
      mensagem:d.mensagem||d.job?.message||
        'Job iniciado em lotes de 1.000.'
    });

    mlHubSyncAnunciosV105UltimoRender=0;
    acompanharAnunciosV105(jobId);
  }catch(e){
    mlHubSyncAnunciosV105Ativo=false;

    const msg=String(e?.message||e||'');
    atualizarProgressoV26('anuncios',{
      status:'queued',
      mensagem:msg
    });

    if(!retomarAutomatico){
      if(/sessão|conexão com o mercado livre|reconecte|401|token/i.test(msg)){
        try{solicitarToken()}catch(_){}
      }
      alert(msg);
    }
  }
}

// Mantém compatibilidade com todos os botões e chamadas antigas.
window.puxarAnunciosV105=puxarAnunciosV105;
window.sincronizarAnunciosDiretoV88=puxarAnunciosV105;
window.puxarNovosAnuncios=()=>puxarAnunciosV105();

// Retoma o job SERVER-SIDE após refresh, sem voltar ao endpoint direto V93.
document.addEventListener('DOMContentLoaded',()=>{
  setTimeout(async()=>{
    try{
      const jobId=Number(
        localStorage.getItem('mlHubPro_sync_v105_anuncios')||
        localStorage.getItem('mlHubPro_sync_v26_anuncios')||
        0
      );

      if(jobId && obterToken()){
        mlHubSyncAnunciosV105Ativo=true;
        mlHubSyncAnunciosV105UltimoRender=0;
        mlHubSyncAnunciosV105Falhas=0;
        acompanharAnunciosV105(jobId);
      }
    }catch(e){}
  },1100);
});
