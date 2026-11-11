
/* =========================================================
   V89 — PUXAR FRETES DIRETO
   - usa os anúncios já salvos no IndexedDB;
   - não depende do PostgreSQL;
   - processa 1.000 por lote lógico;
   - checkpoint a cada 100 anúncios;
   - retoma do ponto salvo.
========================================================= */

let freteV89Executando=false;

function freteV89Temporario(msg){
  return /AbortError|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timeout|network|fetch|failed to fetch|socket|429|500|502|503|504/i.test(String(msg||''));
}

function freteV89Sleep(ms){
  return new Promise(r=>setTimeout(r,ms));
}

async function freteV89Checkpoint(obj){
  await idbSalvarMetaV32({
    key:'direct_freight_v92',
    offset:Number(obj.offset||0),
    total:Number(obj.total||0),
    completed:Boolean(obj.completed),
    failed:Number(obj.failed||0),
    updated_at:new Date().toISOString(),
    last_error:String(obj.last_error||'')
  });
}

async function freteV89Enviar(ids){
  const token=obterToken();
  if(!token)throw new Error('Token Mercado Livre não informado.');

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),120000);

  try{
    const r=await fetch(`${RENDER_URL}/api/v93/fretes/lote1000?_=${Date.now()}`,{
      method:'POST',
      cache:'no-store',
      signal:controller.signal,
      headers:{
        Authorization:token,
        'Content-Type':'application/json',
        Accept:'application/json'
      },
      body:JSON.stringify({ids:ids.slice(0,1000)})
    });

    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    return d;
  }finally{
    clearTimeout(timer);
  }
}

async function aplicarFretesV89(resultados){
  if(!Array.isArray(resultados)||!resultados.length)return {ok:0,failed:0};

  const alterados=[];
  let ok=0,failed=0;

  for(const r of resultados){
    const id=String(r?.id||'');
    if(!id)continue;

    const atual=masterMapV32.get(id);
    if(!atual)continue;

    if(!r.sucesso || !Number.isFinite(Number(r.shipping_cost))){
      failed++;
      continue;
    }

    const shipping=Number(r.shipping_cost||0);

    const novo={
      ...atual,
      shipping_cost:shipping,
      free_shipping:Boolean(r.free_shipping),
      net_received:Math.max(
        0,
        Number(atual.price||0)
          - Number(atual.sale_fee||0)
          - shipping
      ),
      freight_synced_at:new Date().toISOString()
    };

    masterMapV32.set(id,novo);
    alterados.push(novo);
    ok++;
  }

  if(alterados.length){
    await idbSalvarItensV32(alterados);
    masterAnunciosV32=[...masterMapV32.values()];
    simFiltroRenderKeyV30='';
    atualFiltroRenderKeyV30='';
    anunciosEscalaCacheV30.clear();
  }

  return {ok,failed};
}

async function sincronizarFretesDiretoV89({retomarAutomatico=false}={}){
  if(freteV89Executando)return;

  const token=obterToken();
  if(!token){
    solicitarToken();
    return;
  }

  freteV89Executando=true;
  try{localStorage.removeItem('mlHubPro_sync_v26_fretes')}catch(e){}

  try{
    masterCarregadoV32=false;
    await carregarMasterLocalV32();

    const lista=[...masterAnunciosV32]
      .filter(x=>x && x.id)
      .sort((a,b)=>String(a.id).localeCompare(String(b.id)));

    const total=lista.length;

    if(!total){
      atualizarProgressoV26('fretes',{
        status:'completed',
        atual:0,
        total:0,
        mensagem:'Nenhum anúncio salvo. Clique primeiro em Puxar anúncios.'
      });
      return;
    }

    let meta=await idbMetaV32('direct_freight_v92').catch(()=>null);
    let offset=0;
    let failed=0;

    if(meta && meta.completed===false && Number(meta.total||0)===total){
      offset=Math.max(0,Math.min(total,Math.floor(Number(meta.offset||0)/1000)*1000));
      failed=Number(meta.failed||0);
    }else{
      await freteV89Checkpoint({offset:0,total,completed:false,failed:0});
    }

    atualizarProgressoV26('fretes',{
      status:'running',
      atual:offset,
      total,
      mensagem:offset
        ? `Retomando fretes do lote ${Math.floor(offset/1000)+1} · ${offset.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}`
        : `Preparando 1.000 fretes por lote simultâneo · ${total.toLocaleString('pt-BR')} anúncios`
    });

    while(offset<total){
      if(window.automationShouldYieldV101?.()){
        await freteV89Checkpoint({offset,total,completed:false,failed,last_error:'pausado_pelo_usuario'});
        atualizarProgressoV26('fretes',{status:'queued',atual:offset,total,mensagem:`Fretes pausados no checkpoint ${offset.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}`});
        return;
      }
      const lote=lista.slice(offset,Math.min(total,offset+1000));
      const loteNumero=Math.floor(offset/1000)+1;
      const ids=lote.map(x=>String(x.id));

      atualizarProgressoV26('fretes',{
        status:'running',
        atual:offset,
        total,
        mensagem:`Processando lote ${loteNumero.toLocaleString('pt-BR')} · ${ids.length.toLocaleString('pt-BR')} fretes simultâneos...`
      });

      let d=null;
      let ultimoErro=null;

      for(let tentativa=1;tentativa<=5;tentativa++){
        try{
          d=await freteV89Enviar(ids);
          ultimoErro=null;
          break;
        }catch(e){
          ultimoErro=e;
          const msg=String(e?.message||e||'');

          if(!freteV89Temporario(msg) || tentativa>=5)break;

          await freteV89Sleep(
            Math.min(10000,700*Math.pow(2,tentativa-1))
          );
        }
      }

      if(!d){
        throw ultimoErro||new Error('Falha no lote de fretes.');
      }

      const ap=await aplicarFretesV89(d.resultados||[]);
      failed+=Number(ap.failed||0);
      offset+=lote.length;

      await freteV89Checkpoint({
        offset,
        total,
        completed:offset>=total,
        failed
      });

      const pct=total?Math.min(100,Math.round(offset/total*100)):100;

      atualizarProgressoV26('fretes',{
        status:offset>=total?'completed':'running',
        atual:offset,
        total,
        mensagem:offset>=total
          ? `Fretes concluídos · ${total.toLocaleString('pt-BR')} anúncios`
          : `Lote ${loteNumero.toLocaleString('pt-BR')} concluído · ${offset.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · ${pct}%${failed?` · ${failed.toLocaleString('pt-BR')} falha(s) preservadas`:''}`
      });

      if(typeof v88CarregarGestaoLocal==='function'){
        await v88CarregarGestaoLocal(gestaoPagina,{silencioso:true});
      }

      await freteV89Sleep(0);
    }
  }catch(e){
    const msg=String(e?.message||e||'Erro desconhecido.');
    const meta=await idbMetaV32('direct_freight_v92').catch(()=>null);

    await freteV89Checkpoint({
      offset:Number(meta?.offset||0),
      total:Number(meta?.total||masterAnunciosV32.length||0),
      completed:false,
      failed:Number(meta?.failed||0),
      last_error:msg
    }).catch(()=>{});

    atualizarProgressoV26('fretes',{
      status:'queued',
      atual:Number(meta?.offset||0),
      total:Number(meta?.total||masterAnunciosV32.length||0),
      mensagem:`Fretes pausados com checkpoint salvo · ${msg} · clique em Puxar fretes para continuar`
    });

    if(!retomarAutomatico && !freteV89Temporario(msg)){
      alert('Erro ao puxar fretes: '+msg);
    }
  }finally{
    freteV89Executando=false;
  }
}

// Substitui definitivamente o botão antigo baseado em PostgreSQL.
window.sincronizarFretesApi=()=>sincronizarFretesDiretoV89();

document.addEventListener('DOMContentLoaded',()=>{
  setTimeout(async()=>{
    try{
      localStorage.removeItem('mlHubPro_sync_v26_fretes');

      const meta=await idbMetaV32('direct_freight_v92').catch(()=>null);
      if(meta && meta.completed===false && obterToken()){
        atualizarProgressoV26('fretes',{
          status:'running',
          atual:Number(meta.offset||0),
          total:Number(meta.total||0),
          mensagem:'Retomando automaticamente os fretes do checkpoint local'
        });

        sincronizarFretesDiretoV89({retomarAutomatico:true});
      }
    }catch(e){
      console.warn('[V89 FRETE BOOT]',e);
    }
  },1000);
});
