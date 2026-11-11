
/* =========================================================
   V86 — IMPORTAÇÃO DIRETA DO MERCADO LIVRE
   Não usa PostgreSQL.
   Checkpoint a cada página de até 100 anúncios.
   Exibição/contador agrupados em lotes de 1.000.
========================================================= */

let syncV88Executando=false;
let syncV88Abortar=false;

function v88Temporario(msg){
    return /AbortError|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timeout|network|fetch|failed to fetch|socket|429|500|502|503|504/i.test(String(msg||''));
}

function v88Sleep(ms){
    return new Promise(r=>setTimeout(r,ms));
}

async function v88BuscarPagina(scrollId){
    const token=obterToken();
    if(!token)throw new Error('Token Mercado Livre não informado.');

    const qs=new URLSearchParams({_t:String(Date.now())});
    if(scrollId)qs.set('scroll_id',scrollId);

    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),120000);

    try{
        const r=await fetch(`${RENDER_URL}/api/v93/anuncios/lote1000?${qs.toString()}`,{
            cache:'no-store',
            signal:controller.signal,
            headers:{
                Authorization:token,
                Accept:'application/json'
            }
        });

        const d=await r.json().catch(()=>({}));

        if(r.status===401){
            throw new Error(d.erro||'Token Mercado Livre inválido ou expirado.');
        }

        if(r.status===409 && d.cursor_expirado){
            return {cursor_expirado:true,seller_id:String(d.seller_id||'')};
        }

        if(!r.ok){
            throw new Error(d.erro||`HTTP ${r.status}`);
        }

        return d;
    }finally{
        clearTimeout(timer);
    }
}

async function v88SalvarCheckpoint({sellerId,total,processed,scrollId,completed,lastError=''}) {
    await idbSalvarMetaV32({
        key:'direct_sync_v88',
        seller_id:String(sellerId||''),
        total:Number(total||0),
        processed:Number(processed||0),
        scroll_id:scrollId||null,
        completed:Boolean(completed),
        last_error:String(lastError||''),
        updated_at:new Date().toISOString()
    });
}

async function v88CarregarGestaoLocal(page=1,{silencioso=false}={}){
    if(gestaoCarregando)return;

    gestaoCarregando=true;
    if(!silencioso)mostrarLoading('Carregando anúncios salvos...');

    try{
        // Força releitura do IndexedDB para refletir tudo que acabou de chegar.
        masterCarregadoV32=false;
        await carregarMasterLocalV32();

        let lista=[...masterAnunciosV32];

        const busca=String(gestaoBusca||'').trim().toLowerCase();
        if(busca){
            lista=lista.filter(x=>
                String(x.id||'').toLowerCase().includes(busca) ||
                String(x.sku||'').toLowerCase().includes(busca) ||
                String(x.title||'').toLowerCase().includes(busca)
            );
        }

        if(gestaoStatusV76){
            lista=lista.filter(x=>String(x.status||'')===String(gestaoStatusV76));
        }

        const tempo=x=>new Date(x.date_created||x.last_updated||x.last_synced||0).getTime()||0;

        if(gestaoOrdenacaoV76==='sold'){
            lista.sort((a,b)=>Number(b.sold_quantity||0)-Number(a.sold_quantity||0)||tempo(b)-tempo(a));
        }else if(gestaoOrdenacaoV76==='oldest'){
            lista.sort((a,b)=>tempo(a)-tempo(b));
        }else if(gestaoOrdenacaoV76==='status'){
            lista.sort((a,b)=>String(a.status||'').localeCompare(String(b.status||''))||tempo(b)-tempo(a));
        }else{
            lista.sort((a,b)=>tempo(b)-tempo(a));
        }

        gestaoTotalFiltro=lista.length;
        gestaoPaginas=Math.max(1,Math.ceil(lista.length/50));
        gestaoPagina=Math.max(1,Math.min(gestaoPaginas,Number(page||1)));

        cacheItens=lista.slice((gestaoPagina-1)*50,gestaoPagina*50);
        montarTabelaGestao(cacheItens);

        const totalConta=masterAnunciosV32.length;
        const ativos=masterAnunciosV32.filter(x=>String(x.status)==='active').length;

        const tl=document.getElementById('total-listado');
        const ta=document.getElementById('total-ativos');
        const to=document.getElementById('total-outros');

        if(tl)tl.innerText=totalConta.toLocaleString('pt-BR');
        if(ta)ta.innerText=ativos.toLocaleString('pt-BR');
        if(to)to.innerText=(totalConta-ativos).toLocaleString('pt-BR');

        atualizarPaginacaoGestao();
    }finally{
        gestaoCarregando=false;
        if(!silencioso)esconderLoading();
    }
}

async function sincronizarAnunciosDiretoV88({retomarAutomatico=false}={}){
    if(syncV88Executando)return;

    const token=obterToken();
    if(!token){
        solicitarToken();
        return;
    }

    syncV88Executando=true;
    syncV88Abortar=false;

    await carregarMasterLocalV32();

    let meta=await idbMetaV32('direct_sync_v88').catch(()=>null);
    let scrollId=null;
    let total=0;
    let sellerId='';
    let processed=0;

    if(meta && meta.completed===false){
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
          ? `Retomando no lote seguinte · ${processed.toLocaleString('pt-BR')} já salvos`
          : 'Preparando primeiro lote simultâneo de até 1.000 anúncios...'
    });

    let falhasSeguidas=0;
    let reiniciosCursor=0;

    try{
        while(!syncV88Abortar && !window.automationShouldYieldV101?.()){
            let d;

            try{
                d=await v88BuscarPagina(scrollId);
                falhasSeguidas=0;
            }catch(e){
                const msg=String(e?.message||e||'');

                if(!v88Temporario(msg))throw e;

                falhasSeguidas++;
                const espera=Math.min(15000,1000*Math.max(1,falhasSeguidas));

                atualizarProgressoV26('anuncios',{
                    status:'running',
                    atual:processed,
                    total,
                    mensagem:`Lote preservado · conexão temporária · nova tentativa em ${Math.ceil(espera/1000)}s`
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
                    throw new Error('O cursor expirou repetidamente. Clique em Puxar anúncios para reconstruir a leitura do checkpoint.');
                }

                continue;
            }

            const sellerAtual=String(d.seller_id||'');

            if(sellerId && sellerAtual && sellerId!==sellerAtual){
                await idbLimparV32();
                await idbLimparSeenV85();
                masterAnunciosV32=[];
                masterMapV32=new Map();
                masterCarregadoV32=true;
                processed=0;
                scrollId=null;
                total=0;
            }

            sellerId=sellerAtual||sellerId;
            total=Number(d.total||total||0);

            const itens=(Array.isArray(d.itens)?d.itens:[])
                .map(x=>({...normalizarItemEscala(x),_seller_id:sellerAtual||sellerId||''}));

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

            const loteNumero=Math.max(1,Math.ceil(processed/1000));
            const pct=total?Math.min(100,Math.round(processed/total*100)):0;

            atualizarProgressoV26('anuncios',{
                status:d.terminou?'completed':'running',
                atual:processed,
                total,
                mensagem:d.terminou
                  ? `Concluído · ${processed.toLocaleString('pt-BR')} anúncios salvos`
                  : `Lote ${loteNumero.toLocaleString('pt-BR')} concluído · ${Number(d.ids_count||itens.length).toLocaleString('pt-BR')} processados simultaneamente · ${processed.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · ${pct}%`
            });

            await v88CarregarGestaoLocal(1,{silencioso:true});
            await v88Sleep(0);

            if(d.terminou)return;
        }
    }catch(e){
        const msg=String(e?.message||e||'Erro desconhecido');

        await v88SalvarCheckpoint({
            sellerId,
            total,
            processed,
            scrollId,
            completed:false,
            lastError:msg
        }).catch(()=>{});

        atualizarProgressoV26('anuncios',{
            status:'queued',
            atual:processed,
            total,
            mensagem:`Pausado com checkpoint salvo · ${msg} · clique em Puxar anúncios para continuar`
        });

        if(!retomarAutomatico && !v88Temporario(msg)){
            alert(msg);
        }
    }finally{
        syncV88Executando=false;
    }
}

// O botão chama DIRETAMENTE esta função.
window.sincronizarAnunciosDiretoV88=sincronizarAnunciosDiretoV88;
window.puxarNovosAnuncios=()=>sincronizarAnunciosDiretoV88();

// Gestão passa a ler o IndexedDB local em vez do PostgreSQL.
window.carregarGestaoEscala=v88CarregarGestaoLocal;

document.addEventListener('DOMContentLoaded',()=>{
    setTimeout(async()=>{
        try{
            // Remove job antigo de anúncios do sistema PostgreSQL.
            localStorage.removeItem('mlHubPro_sync_v26_anuncios');

            await v88CarregarGestaoLocal(1,{silencioso:true});

            const meta=await idbMetaV32('direct_sync_v88').catch(()=>null);
            if(meta && meta.completed===false && obterToken()){
                atualizarProgressoV26('anuncios',{
                    status:'running',
                    atual:Number(meta.processed||0),
                    total:Number(meta.total||0),
                    mensagem:'Retomando automaticamente do checkpoint local'
                });

                puxarAnunciosV105({retomarAutomatico:true});
            }
        }catch(e){
            console.warn('[V88 BOOT]',e);
        }
    },700);
});
