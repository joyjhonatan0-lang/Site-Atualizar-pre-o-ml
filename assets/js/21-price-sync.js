
let precoV92Executando=false;

function precoV92Temporario(msg){
  return /AbortError|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timeout|network|fetch|failed to fetch|socket|429|500|502|503|504/i.test(String(msg||''));
}

function precoV92Sleep(ms){
  return new Promise(r=>setTimeout(r,ms));
}

async function precoV92SalvarCheckpoint({offset,total,completed,failed=0,last_error=''}) {
  await idbSalvarMetaV32({
    key:'direct_price_v92',
    offset:Number(offset||0),
    total:Number(total||0),
    completed:Boolean(completed),
    failed:Number(failed||0),
    last_error:String(last_error||''),
    updated_at:new Date().toISOString()
  });
}

async function precoV92Enviar(ids){
  const token=obterToken();
  if(!token)throw new Error('Token Mercado Livre não informado.');

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),120000);

  try{
    const r=await fetch(`${RENDER_URL}/api/v92/precos/direto?_=${Date.now()}`,{
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

async function aplicarPrecosV92(resultados){
  if(!Array.isArray(resultados)||!resultados.length)return {ok:0,failed:0};

  const alterados=[];
  let ok=0,failed=0;

  for(const r of resultados){
    const id=String(r?.id||'');
    if(!id)continue;

    const atual=masterMapV32.get(id);
    if(!atual)continue;

    if(!r.sucesso || !Number.isFinite(Number(r.price))){
      failed++;
      continue;
    }

    const price=Number(r.price);

    const novo={
      ...atual,
      price,
      available_quantity:r.available_quantity!==undefined
        ? Number(r.available_quantity||0)
        : Number(atual.available_quantity||0),
      sold_quantity:r.sold_quantity!==undefined
        ? Number(r.sold_quantity||0)
        : Number(atual.sold_quantity||0),
      status:r.status||atual.status,
      net_received:Math.max(
        0,
        price
          - Number(atual.sale_fee||0)
          - Number(atual.shipping_cost||0)
      ),
      price_synced_at:new Date().toISOString()
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

async function sincronizarPrecosDiretoV92({retomarAutomatico=false}={}){
  if(precoV92Executando)return;

  const token=obterToken();
  if(!token){
    solicitarToken();
    return;
  }

  precoV92Executando=true;
  try{localStorage.removeItem('mlHubPro_sync_v26_precos')}catch(e){}

  try{
    masterCarregadoV32=false;
    await carregarMasterLocalV32();

    const lista=[...masterAnunciosV32]
      .filter(x=>x && x.id)
      .sort((a,b)=>String(a.id).localeCompare(String(b.id)));

    const total=lista.length;
    if(!total){
      atualizarProgressoV26('precos',{
        status:'completed',
        atual:0,
        total:0,
        mensagem:'Nenhum anúncio salvo. Clique primeiro em Puxar anúncios.'
      });
      return;
    }

    let meta=await idbMetaV32('direct_price_v92').catch(()=>null);
    let offset=0;
    let failed=0;

    if(meta && meta.completed===false && Number(meta.total||0)===total){
      offset=Math.max(0,Math.min(total,Math.floor(Number(meta.offset||0)/1000)*1000));
      failed=Number(meta.failed||0);
    }else{
      await precoV92SalvarCheckpoint({offset:0,total,completed:false,failed:0});
    }

    atualizarProgressoV26('precos',{
      status:'running',
      atual:offset,
      total,
      mensagem:offset
        ? `Retomando preços · ${offset.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · lote de 1.000`
        : `Iniciando preços · ${total.toLocaleString('pt-BR')} anúncios · lote de 1.000`
    });

    while(offset<total){
      if(window.automationShouldYieldV101?.()){
        await precoV92SalvarCheckpoint({offset,total,completed:false,failed,last_error:'pausado_pelo_usuario'});
        atualizarProgressoV26('precos',{status:'queued',atual:offset,total,mensagem:`Preços pausados no checkpoint ${offset.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}`});
        return;
      }
      const lote=lista.slice(offset,Math.min(total,offset+1000));
      const loteNumero=Math.floor(offset/1000)+1;
      const ids=lote.map(x=>String(x.id));

      atualizarProgressoV26('precos',{
        status:'running',
        atual:offset,
        total,
        mensagem:`Processando lote ${loteNumero.toLocaleString('pt-BR')} · ${ids.length.toLocaleString('pt-BR')} preços...`
      });

      let d=null;
      let ultimoErro=null;

      for(let tentativa=1;tentativa<=5;tentativa++){
        try{
          d=await precoV92Enviar(ids);
          ultimoErro=null;
          break;
        }catch(e){
          ultimoErro=e;
          const msg=String(e?.message||e||'');

          if(!precoV92Temporario(msg) || tentativa>=5)break;

          await precoV92Sleep(
            Math.min(8000,500*Math.pow(2,tentativa-1))
          );
        }
      }

      if(!d){
        throw ultimoErro||new Error('Falha ao puxar o lote de preços.');
      }

      const ap=await aplicarPrecosV92(d.resultados||[]);
      failed+=Number(ap.failed||0);
      offset+=lote.length;

      await precoV92SalvarCheckpoint({
        offset,
        total,
        completed:offset>=total,
        failed
      });

      const pct=total?Math.min(100,Math.round(offset/total*100)):100;

      atualizarProgressoV26('precos',{
        status:offset>=total?'completed':'running',
        atual:offset,
        total,
        mensagem:offset>=total
          ? `Preços concluídos: ${total.toLocaleString('pt-BR')} anúncio(s)`
          : `Lote ${loteNumero.toLocaleString('pt-BR')} concluído · ${offset.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · ${pct}% · lote de 1.000${failed?` · ${failed.toLocaleString('pt-BR')} falha(s) preservadas`:''}`
      });

      if(typeof v88CarregarGestaoLocal==='function'){
        await v88CarregarGestaoLocal(gestaoPagina,{silencioso:true});
      }

      await precoV92Sleep(0);
    }
  }catch(e){
    const msg=String(e?.message||e||'Erro desconhecido.');
    const meta=await idbMetaV32('direct_price_v92').catch(()=>null);

    await precoV92SalvarCheckpoint({
      offset:Number(meta?.offset||0),
      total:Number(meta?.total||masterAnunciosV32.length||0),
      completed:false,
      failed:Number(meta?.failed||0),
      last_error:msg
    }).catch(()=>{});

    atualizarProgressoV26('precos',{
      status:'queued',
      atual:Number(meta?.offset||0),
      total:Number(meta?.total||masterAnunciosV32.length||0),
      mensagem:`Preços pausados com checkpoint salvo · ${msg} · clique em Puxar preços para continuar`
    });

    if(!retomarAutomatico && !precoV92Temporario(msg)){
      alert('Erro ao puxar preços: '+msg);
    }
  }finally{
    precoV92Executando=false;
  }
}

window.sincronizarPrecosApi=()=>sincronizarPrecosDiretoV92();

document.addEventListener('DOMContentLoaded',()=>{
  setTimeout(async()=>{
    try{
      localStorage.removeItem('mlHubPro_sync_v26_precos');

      const meta=await idbMetaV32('direct_price_v92').catch(()=>null);
      if(meta && meta.completed===false && obterToken()){
        atualizarProgressoV26('precos',{
          status:'running',
          atual:Number(meta.offset||0),
          total:Number(meta.total||0),
          mensagem:'Retomando automaticamente os preços do lote de 1.000'
        });

        sincronizarPrecosDiretoV92({retomarAutomatico:true});
      }
    }catch(e){
      console.warn('[V92 PREÇO BOOT]',e);
    }
  },900);
});
