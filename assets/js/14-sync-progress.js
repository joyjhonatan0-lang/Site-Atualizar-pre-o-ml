
/* =========================================================
   V26 \u2014 PROGRESSO DE AN\u00daNCIOS / PRE\u00c7OS / FRETES
========================================================= */
const syncTimersV26={anuncios:null,precos:null,fretes:null};
const syncQueuedDesdeV76={anuncios:0,precos:0,fretes:0};
const syncWakeTentativaV79={anuncios:0,precos:0,fretes:0};

function syncRefsV26(tipo){
    return {
        bar:document.getElementById(`sync-bar-${tipo}-v26`),
        status:document.getElementById(`sync-status-${tipo}-v26`),
        msg:document.getElementById(`sync-msg-${tipo}-v26`),
        card:document.getElementById(`sync-card-${tipo}-v26`)
    };
}

function atualizarProgressoV26(tipo,{status='running',atual=0,total=0,mensagem=''}={}){
    const r=syncRefsV26(tipo);
    const pct=total>0?Math.max(0,Math.min(100,Math.round((Number(atual||0)/Number(total))*100))):(status==='completed'?100:0);

    if(r.bar){
        r.bar.style.width=`${pct}%`;
        r.bar.classList.toggle('bg-red-400',status==='failed');
    }
    if(r.status){
        r.status.textContent=status==='completed'
          ? 'Conclu\u00eddo'
          : status==='failed'
            ? 'Falhou'
            : status==='queued'
              ? 'Na fila'
              : `${pct}%`;
        r.status.className=`text-[10px] font-bold ${
          status==='completed'?'text-emerald-400':
          status==='failed'?'text-red-400':
          status==='queued'?'text-yellow-400':'text-slate-300'
        }`;
    }
    if(r.msg){
        const numeros=total>0?` \u00b7 ${Number(atual||0).toLocaleString('pt-BR')}/${Number(total).toLocaleString('pt-BR')}`:'';
        r.msg.textContent=(mensagem||'Processando...')+numeros;
    }
}

async function iniciarJobSyncV26(tipo,url){
    const token=obterToken();
    if(!token){solicitarToken();return}

    atualizarProgressoV26(tipo,{
        status:'queued',
        mensagem:tipo==='anuncios'
            ? 'Solicitando sincronização incremental em lotes de até 1.000...'
            : 'Solicitando sincronização ao servidor...'
    });

    try{
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),15000);
        let r;
        try{
            r=await fetch(`${RENDER_URL}${url}?_=${Date.now()}`,{
                method:'POST',
                cache:'no-store',
                signal:controller.signal,
                headers:{Authorization:token,'Content-Type':'application/json'},
                body:'{}'
            });
        }finally{
            clearTimeout(timer);
        }

        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        const jobId=d.job?.id;
        if(!jobId)throw new Error('Servidor não retornou o ID da sincronização.');

        localStorage.setItem(`mlHubPro_sync_v26_${tipo}`,String(jobId));

        atualizarProgressoV26(tipo,{
            status:d.job?.status||'queued',
            atual:Number(d.job?.progress_current||0),
            total:Number(d.job?.progress_total||0),
            mensagem:d.mensagem||d.job?.message||'Sincronização iniciada.'
        });

        acompanharJobSyncV26(tipo,jobId);
    }catch(e){
        const msg=String(e?.message||e||'');
        const temporario=/AbortError|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|fetch|failed to fetch|connection|57P03|database system|recovery|502|503|504/i.test(msg);
        atualizarProgressoV26(tipo,{
            status:'queued',
            mensagem:temporario
                ? 'Servidor/banco temporariamente indisponível. O progresso anterior permanece salvo; tente novamente em alguns segundos.'
                : msg
        });
    }
}


async function acompanharJobSyncV26(tipo,jobId){
    clearTimeout(syncTimersV26[tipo]);

    const token=obterToken();
    if(!token)return;

    try{
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),12000);
        let r;
        try{
            r=await fetch(`${RENDER_URL}/api/scale/jobs/${encodeURIComponent(jobId)}?_=${Date.now()}`,{
                cache:'no-store',
                signal:controller.signal,
                headers:{Authorization:token,Accept:'application/json'}
            });
        }finally{
            clearTimeout(timer);
        }

        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        const j=d.job||{};

        atualizarProgressoV26(tipo,{
            status:j.status||'running',
            atual:Number(j.progress_current||0),
            total:Number(j.progress_total||0),
            mensagem:j.message||'Processando...'
        });

        if(['queued','running'].includes(j.status)){
            // Se a fila ficar quieta, apenas "acorda" o servidor. Não cria outro job.
            if(j.status==='queued'){
                if(!syncQueuedDesdeV76[tipo])syncQueuedDesdeV76[tipo]=Date.now();
                const segundos=(Date.now()-syncQueuedDesdeV76[tipo])/1000;

                if(tipo==='anuncios' && segundos>=10 && Date.now()-(syncWakeTentativaV79.anuncios||0)>10000){
                    syncWakeTentativaV79.anuncios=Date.now();
                    fetch(`${RENDER_URL}/api/scale/sync`,{
                        method:'POST',
                        cache:'no-store',
                        headers:{Authorization:token,'Content-Type':'application/json'},
                        body:'{}'
                    }).catch(()=>{});
                }
            }else{
                syncQueuedDesdeV76[tipo]=0;
            }

            syncTimersV26[tipo]=setTimeout(()=>acompanharJobSyncV26(tipo,jobId),1500);
            return;
        }

        if(j.status==='completed'){
            localStorage.removeItem(`mlHubPro_sync_v26_${tipo}`);
            syncQueuedDesdeV76[tipo]=0;

            if(typeof invalidarCacheAnunciosV30==='function')invalidarCacheAnunciosV30();

            if(typeof carregarGestaoEscala==='function'){
                await carregarGestaoEscala(1,{silencioso:true});
            }
            return;
        }

        if(j.status==='failed'){
            /*
              O job fica salvo no navegador de propósito.
              Ao clicar em Puxar anúncios novamente, o servidor V84 retoma o MESMO
              job/checkpoint, em vez de começar tudo do zero.
            */
            atualizarProgressoV26(tipo,{
                status:'queued',
                atual:Number(j.progress_current||0),
                total:Number(j.progress_total||0),
                mensagem:(j.message||'Sincronização pausada.')+' · Clique em Puxar anúncios para retomar do ponto salvo.'
            });
            return;
        }
    }catch(e){
        const msg=String(e?.message||e||'');
        const temporario=/AbortError|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|fetch|failed to fetch|connection|57P03|57P01|database system|recovery|502|503|504/i.test(msg);

        if(temporario){
            atualizarProgressoV26(tipo,{
                status:'running',
                mensagem:tipo==='anuncios'
                    ? 'Conexão temporariamente indisponível · o checkpoint está salvo e a sincronização será retomada'
                    : 'Servidor reconectando · retomada automática'
            });
            syncTimersV26[tipo]=setTimeout(()=>acompanharJobSyncV26(tipo,jobId),3000);
            return;
        }

        atualizarProgressoV26(tipo,{
            status:'queued',
            mensagem:'Acompanhamento pausado: '+msg+' · o progresso foi preservado'
        });
    }
}

// Sobrescreve somente os tr\u00eas bot\u00f5es de sincroniza\u00e7\u00e3o.
window.puxarNovosAnuncios=function(){
    return sincronizarAnunciosDiretoV88();
};

window.sincronizarPrecosApi=function(){
    return sincronizarPrecosDiretoV92();
};

window.sincronizarFretesApi=function(){
    return sincronizarFretesDiretoV89();
};

document.addEventListener('DOMContentLoaded',()=>{
    try{
        gestaoOrdenacaoV76=localStorage.getItem('mlHubPro_gestaoOrdenacao_v76')||'recent';
        gestaoStatusV76=localStorage.getItem('mlHubPro_gestaoStatus_v76')||'';
        const so=document.getElementById('gestao-ordenacao-v76');if(so)so.value=gestaoOrdenacaoV76;
        const ss=document.getElementById('gestao-status-v76');if(ss)ss.value=gestaoStatusV76;
    }catch(e){}
    [].forEach(tipo=>{
        const id=localStorage.getItem(`mlHubPro_sync_v26_${tipo}`);
        if(id)acompanharJobSyncV26(tipo,id);
    });
});
