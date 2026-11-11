
/* =========================================================
   V101 — Qualidade, pausa em massa, automação e NF-e
========================================================= */
const AUTOMACAO_PRECO_KEY_V101='mlhub_auto_preco_v101';
let qualidadePaginaEmCursoV101=false;
let pausaMassaExecutandoV101=false;
const pedidoFiscalStatusV101=new Map();

function qualidadeHtmlV101(item){
  const score=item?.quality_score;
  if(score===null||score===undefined||score===''){
    return `<div class="text-[10px] font-black text-slate-500">Carregando...</div><div class="text-[8px] text-slate-600 mt-1">Qualidade ML</div>`;
  }
  const n=Math.max(0,Math.min(100,Number(score||0)));
  const level=String(item?.quality_level||'');
  const pend=Number(item?.quality_pending_actions||0);
  const text=n>=80?'text-emerald-400':n>=60?'text-yellow-300':'text-red-300';
  const bar=n>=80?'bg-emerald-400':n>=60?'bg-yellow-400':'bg-red-400';
  return `<div class="min-w-[110px]">
    <div class="flex items-center gap-2"><span class="text-base font-black ${text}">${n.toFixed(0)}%</span><span class="text-[8px] text-slate-500">${escapeHtml(level)}</span></div>
    <div class="mt-1 h-1.5 rounded-full bg-slate-800 overflow-hidden"><div class="h-full ${bar}" style="width:${n}%"></div></div>
    <div class="text-[8px] text-slate-600 mt-1">${pend?`${pend} ação(ões) pendente(s)`:'Sem ação pendente'}</div>
  </div>`;
}

const montarTabelaGestaoBaseV101=montarTabelaGestao;
montarTabelaGestao=function(itens){
  montarTabelaGestaoBaseV101(itens);
  setTimeout(()=>carregarQualidadePaginaV101(itens),60);
};

async function carregarQualidadePaginaV101(itens){
  if(qualidadePaginaEmCursoV101)return;
  const agora=Date.now();
  const alvos=(Array.isArray(itens)?itens:[]).filter(x=>{
    const ts=x?.quality_checked_at?new Date(x.quality_checked_at).getTime():0;
    return x?.id && (!Number.isFinite(Number(x.quality_score)) || !ts || agora-ts>6*60*60*1000);
  }).slice(0,100);
  if(!alvos.length)return;

  qualidadePaginaEmCursoV101=true;
  try{
    const r=await fetch(`${RENDER_URL}/api/v101/anuncios/qualidade-lote`,{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:obterToken()},
      body:JSON.stringify({ids:alvos.map(x=>x.id)})
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

    const alterados=[];
    for(const q of (d.resultados||[])){
      const id=String(q.id||'');
      const item=masterMapV32.get(id);
      if(!item)continue;

      if(q.title){
        item.title=tituloSomenteV76(q.title);
        const idx=cacheItens.findIndex(x=>String(x.id)===id);
        if(idx>=0){
          cacheItens[idx].title=item.title;
          const input=document.getElementById(`titulo_gestao_${idx}`);
          const count=document.getElementById(`contador_titulo_gestao_${idx}`);
          if(input&&document.activeElement!==input)input.value=item.title;
          if(count)count.textContent=`${item.title.length}/60`;
        }
      }

      if(q.sucesso){
        item.quality_score=q.score;
        item.quality_level=q.level||'';
        item.quality_pending_actions=Number(q.pending_actions||0);
        item.quality_calculated_at=q.calculated_at||null;
      }
      item.quality_checked_at=new Date().toISOString();
      alterados.push(item);

      const box=document.getElementById(`quality_${safeIdV21(id)}`);
      if(box)box.innerHTML=q.sucesso?qualidadeHtmlV101(item):`<div class="text-[9px] text-slate-500">Não disponível</div>`;
    }

    if(alterados.length){
      masterAnunciosV32=[...masterMapV32.values()];
      await idbSalvarItensV32(alterados);
    }
  }catch(e){
    console.warn('[QUALIDADE V101]',e.message);
  }finally{
    qualidadePaginaEmCursoV101=false;
  }
}

/* ---------------- Pausa em massa ---------------- */
function abrirPausaMassaV101(){
  document.getElementById('modal-pausa-massa-v101')?.classList.remove('hidden');
  ajustarPausaMassaV101();
}
function fecharPausaMassaV101(){
  if(pausaMassaExecutandoV101)return;
  document.getElementById('modal-pausa-massa-v101')?.classList.add('hidden');
}
async function ajustarPausaMassaV101(){
  await carregarMasterLocalV32();
  const modo=document.getElementById('pausa-modo-v101')?.value||'all';
  const valor=document.getElementById('pausa-valor-v101')?.value.trim()||'';
  const wrap=document.getElementById('pausa-valor-wrap-v101');
  const label=document.getElementById('pausa-valor-label-v101');
  if(wrap)wrap.classList.toggle('hidden',modo==='all');
  if(label)label.textContent=modo==='sku'?'SKU exato':'MLB exato';

  const ativos=masterAnunciosV32.filter(x=>String(x.status)==='active');
  let lista=ativos;
  if(modo==='sku')lista=valor?ativos.filter(x=>String(x.sku||'').trim().toLowerCase()===valor.toLowerCase()):[];
  if(modo==='mlb')lista=valor?ativos.filter(x=>String(x.id||'').toUpperCase()===valor.toUpperCase()):[];

  const box=document.getElementById('pausa-resumo-v101');
  if(box)box.innerHTML=`<b class="text-white">${lista.length.toLocaleString('pt-BR')}</b> anúncio(s) ativo(s) serão incluídos.<div class="text-[9px] text-slate-600 mt-2">Pausar é reversível. Itens inativos, em revisão ou finalizados não são alterados.</div>`;
  return lista;
}
document.addEventListener('input',e=>{if(e.target?.id==='pausa-valor-v101')ajustarPausaMassaV101()});

async function executarPausaMassaV101(){
  if(pausaMassaExecutandoV101)return;
  const lista=await ajustarPausaMassaV101();
  if(!lista.length)return alert('Nenhum anúncio ativo corresponde ao filtro.');
  if(!confirm(`Pausar ${lista.length.toLocaleString('pt-BR')} anúncio(s)?${(document.getElementById('pausa-modo-v101')?.value||'all')==='all'?'\n\nVocê selecionou TODOS os anúncios ativos da conta.':''}`))return;
  if(lista.length>1000&&!confirm('Confirme novamente: esta operação vai pausar mais de 1.000 anúncios. Continuar?'))return;

  pausaMassaExecutandoV101=true;
  const btn=document.getElementById('pausa-executar-v101');
  const prog=document.getElementById('pausa-progresso-v101');
  const bar=document.getElementById('pausa-bar-v101');
  const msg=document.getElementById('pausa-msg-v101');
  if(btn)btn.disabled=true;if(prog)prog.classList.remove('hidden');
  let done=0,ok=0,fail=0,ignored=0;

  try{
    const ids=lista.map(x=>String(x.id));
    for(let i=0;i<ids.length;i+=200){
      const lote=ids.slice(i,i+200);
      const r=await fetch(`${RENDER_URL}/api/v101/anuncios/pausar-lote`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:obterToken()},body:JSON.stringify({ids:lote})
      });
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

      for(const rr of (d.resultados||[])){
        done++;
        const item=masterMapV32.get(String(rr.id));
        if(rr.sucesso){ok++;if(item)item.status='paused'}
        else if(rr.ignorado){ignored++;if(item&&rr.status)item.status=rr.status}
        else fail++;
      }

      const atualizados=lote.map(id=>masterMapV32.get(String(id))).filter(Boolean);
      if(atualizados.length)await idbSalvarItensV32(atualizados);
      if(bar)bar.style.width=`${Math.round(done/ids.length*100)}%`;
      if(msg)msg.textContent=`${done.toLocaleString('pt-BR')}/${ids.length.toLocaleString('pt-BR')} · ${ok.toLocaleString('pt-BR')} pausados · ${fail.toLocaleString('pt-BR')} falhas`;
    }

    masterAnunciosV32=[...masterMapV32.values()];
    await v88CarregarGestaoLocal(1,{silencioso:true});
    if(msg)msg.textContent=`Concluído: ${ok.toLocaleString('pt-BR')} pausado(s), ${ignored.toLocaleString('pt-BR')} ignorado(s), ${fail.toLocaleString('pt-BR')} falha(s).`;
  }catch(e){if(msg)msg.textContent='Erro: '+e.message;alert(e.message)}
  finally{pausaMassaExecutandoV101=false;if(btn)btn.disabled=false}
}

/* ---------------- Automação de preços ---------------- */
function lerAutomacaoPrecoV101(){
  try{
    const atual=JSON.parse(localStorage.getItem(AUTOMACAO_PRECO_KEY_V101)||'null')||{status:'stopped',step:'precos'};

    // Migração da sequência antiga V101: a V102 não puxa anúncios
    // e não possui mais uma etapa separada de simulação.
    if(atual.step==='anuncios')atual.step='precos';
    if(atual.step==='simulacao')atual.step='atualizacao';

    return atual;
  }catch{
    return {status:'stopped',step:'precos'};
  }
}
function salvarAutomacaoPrecoV101(state){
  localStorage.setItem(AUTOMACAO_PRECO_KEY_V101,JSON.stringify({...state,updated_at:new Date().toISOString()}));
  atualizarUiAutomacaoPrecoV101();
}
function etapaAutoLabelV101(step){
  return {
    precos:'1/3 · Puxando preços',
    fretes:'2/3 · Puxando fretes',
    atualizacao:'3/3 · Atualizando preços pela margem',
    concluido:'Concluído'
  }[step]||'Aguardando';
}
function atualizarUiAutomacaoPrecoV101(){
  const s=lerAutomacaoPrecoV101();
  const status=document.getElementById('auto-preco-status-v101');
  const etapa=document.getElementById('auto-preco-etapa-v101');
  const bar=document.getElementById('auto-preco-bar-v101');
  const pct={precos:15,fretes:50,atualizacao:82,concluido:100}[s.step]||0;

  if(bar)bar.style.width=`${pct}%`;
  if(etapa)etapa.textContent=etapaAutoLabelV101(s.step);

  if(status){
    if(s.status==='running'){
      status.textContent='Executando: preços → fretes → atualização automática pela margem desejada.';
      status.className='text-[10px] text-emerald-400 mt-1';
    }else if(s.status==='paused'){
      status.textContent='Pausada. Clique em Iniciar auto para continuar do último checkpoint.';
      status.className='text-[10px] text-yellow-300 mt-1';
    }else if(s.status==='completed'){
      status.textContent='Ciclo concluído. Clique em Iniciar auto para atualizar preços e fretes novamente.';
      status.className='text-[10px] text-emerald-400 mt-1';
    }else{
      status.textContent='Parada. Sequência: preços → fretes → atualização automática pela margem desejada.';
      status.className='text-[10px] text-slate-400 mt-1';
    }
  }
}
window.automationShouldYieldV101=()=>{const s=lerAutomacaoPrecoV101();return s.status==='paused'||s.status==='stopped'};

async function esperarAutomacaoSyncV101(fn,metaKey){
  await fn({retomarAutomatico:true});
  const inicio=Date.now();
  while(Date.now()-inicio<12*60*60*1000){
    const state=lerAutomacaoPrecoV101();
    if(state.status!=='running')return false;
    const meta=await idbMetaV32(metaKey).catch(()=>null);
    if(meta?.completed)return true;
    await new Promise(r=>setTimeout(r,1200));
  }
  throw new Error('A etapa excedeu o tempo máximo de acompanhamento. O checkpoint foi preservado.');
}

async function atualizarPrecosAutomaticosV101(){
  await carregarMasterLocalV32();
  await carregarBaseSkuRapidaV42();
  const tentados=new Set();
  let processados=0,ok=0,erros=0;

  const pendentes=()=>[...masterAnunciosV32].map(item=>({item,calc:calcularSimulacaoV21(item,parametrosSimV21(item))}))
    .filter(x=>x.calc?.foraDaMargem && x.item.price_update_allowed!==false && String(x.item.status||'')==='active' && !tentados.has(String(x.item.id)));

  let fila=pendentes();
  atualizarPainelProgressoV31({total:fila.length,processados:0,sucessos:0,falhas:0,texto:`Automação: ${fila.length.toLocaleString('pt-BR')} preço(s) para revisar.`});

  while(fila.length){
    if(window.automationShouldYieldV101())return false;
    const lote=fila.slice(0,20).map(({item,calc})=>({id:item.id,title:item.title,sku:item.sku,price:parseFloat(Number(calc.preco||item.price).toFixed(2))}));
    lote.forEach(x=>tentados.add(String(x.id)));

    const r=await fetch(`${RENDER_URL}/api/atualizar-precos`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:obterToken()},body:JSON.stringify({itens:lote.map(x=>({id:x.id,price:x.price}))})
    });
    const d=await r.json().catch(()=>({}));
    if(!r.ok&&!Array.isArray(d.resultados))throw new Error(d.erro||`HTTP ${r.status}`);
    const retorno=new Map((d.resultados||[]).map(x=>[String(x.id),x]));

    for(const alvo of lote){
      processados++;
      const rr=retorno.get(String(alvo.id));
      if(rr?.sucesso){
        ok++;
        atualizarPrecoNoCacheV30(alvo.id,alvo.price);
        document.getElementById(`linha_atualizacao_${safeIdV21(alvo.id)}`)?.remove();
        statusAtualizacaoV31.set(String(alvo.id),{estado:'sucesso',http_status:rr.http_status||200});
      }else{
        erros++;
        statusAtualizacaoV31.set(String(alvo.id),{estado:'erro',motivo:rr?.erro||'Preço não atualizado.',http_status:rr?.http_status||null,codigo:rr?.codigo||null,tipo_falha:rr?.tipo_falha||'erro'});
      }
    }

    atualizarPainelProgressoV31({total:Math.max(processados,fila.length),processados,sucessos:ok,falhas:erros,texto:`Automação: ${processados.toLocaleString('pt-BR')} processados · ${ok.toLocaleString('pt-BR')} atualizados · ${erros.toLocaleString('pt-BR')} impedidos/falhas.`});
    await new Promise(r=>setTimeout(r,450));
    fila=pendentes();
  }

  atualFiltroRenderKeyV30='';
  atualItensV21=listaMasterFiltradaV32();
  renderizarAtualizacaoCompletaV29(atualItensV21);
  return true;
}

async function executarAutomacaoPrecoV101(){
  let s=lerAutomacaoPrecoV101();
  if(s.status!=='running')return;

  try{
    // V102: não puxa anúncios e não abre/roda a etapa de simulação.
    // Usa os anúncios já salvos na Gestão, atualiza preço/frete e então
    // calcula internamente o preço-alvo usando a margem configurada.
    if(s.step==='precos'){
      if(!await esperarAutomacaoSyncV101(
        sincronizarPrecosDiretoV92,
        'direct_price_v92'
      ))return;

      salvarAutomacaoPrecoV101({...s,step:'fretes'});
      s=lerAutomacaoPrecoV101();
    }

    if(s.step==='fretes'){
      if(!await esperarAutomacaoSyncV101(
        sincronizarFretesDiretoV89,
        'direct_freight_v92'
      ))return;

      salvarAutomacaoPrecoV101({...s,step:'atualizacao'});
      s=lerAutomacaoPrecoV101();
    }

    if(s.step==='atualizacao'){
      if(!await atualizarPrecosAutomaticosV101())return;

      salvarAutomacaoPrecoV101({
        ...s,
        status:'completed',
        step:'concluido',
        completed_at:new Date().toISOString()
      });
    }
  }catch(e){
    const now=lerAutomacaoPrecoV101();
    salvarAutomacaoPrecoV101({...now,status:'paused',last_error:e.message});

    const el=document.getElementById('auto-preco-status-v101');
    if(el)el.textContent='Automação pausada por erro: '+e.message;

    console.error('[AUTOMAÇÃO V102]',e);
  }
}
function iniciarAutomacaoPrecoV101(){
  let s=lerAutomacaoPrecoV101();
  if(s.status==='running')return;

  const novoCiclo=s.status==='completed'||s.status==='stopped';

  if(novoCiclo && !confirm(
    'Iniciar a automação de preços?\n\n'+
    'O sistema vai fazer SOMENTE:\n'+
    '1. Puxar todos os preços atuais\n'+
    '2. Puxar todos os fretes atuais\n'+
    '3. Atualizar automaticamente os preços fora da margem desejada\n\n'+
    'Não vai puxar anúncios e não vai executar outras etapas.\n\nContinuar?'
  ))return;

  if(novoCiclo){
    s={
      status:'running',
      step:'precos',
      started_at:new Date().toISOString()
    };
  }else{
    s={...s,status:'running'};
  }

  // O controle de aborto ainda é reutilizado pelos sincronizadores existentes.
  syncV88Abortar=false;
  salvarAutomacaoPrecoV101(s);
  executarAutomacaoPrecoV101();
}
function pausarAutomacaoPrecoV101(){const s=lerAutomacaoPrecoV101();if(s.status!=='running')return;salvarAutomacaoPrecoV101({...s,status:'paused'});syncV88Abortar=true}
async function pararAutomacaoPrecoV101(){
  if(!confirm(
    'Parar a automação? Os preços e fretes já sincronizados continuarão salvos. O próximo Iniciar começará novamente pela leitura de preços.'
  ))return;

  const s=lerAutomacaoPrecoV101();
  syncV88Abortar=true;

  salvarAutomacaoPrecoV101({
    ...s,
    status:'stopped',
    step:'precos'
  });

  // Fecha apenas checkpoints das etapas usadas pela V102.
  for(const key of ['direct_price_v92','direct_freight_v92']){
    try{
      const meta=await idbMetaV32(key);
      if(meta){
        await idbSalvarMetaV32({
          ...meta,
          key,
          completed:true,
          stopped_at:new Date().toISOString()
        });
      }
    }catch(e){}
  }
}

const atualizarPrecosMassaApiBaseV101=atualizarPrecosMassaApi;
atualizarPrecosMassaApi=async function(){
  await atualizarPrecosMassaApiBaseV101();
  atualFiltroRenderKeyV30='';atualItensV21=listaMasterFiltradaV32();renderizarAtualizacaoCompletaV29(atualItensV21);
};

/* ---------------- NF-e / DANFE ---------------- */
function rotuloFiscalV101(status){
  const s=String(status||'').toLowerCase();
  if(s==='authorized')return 'Autorizada';if(s==='processing'||s==='pending')return 'Processando';if(s==='cancelled'||s==='canceled')return 'Cancelada';if(s==='forbidden_disablement')return 'Bloqueada';return status||'Não emitida';
}
function htmlFiscalPedidoV101(orderId){
  const st=pedidoFiscalStatusV101.get(String(orderId));
  return `<div class="min-w-[190px] space-y-2">
    <div id="fiscal_status_${orderId}" class="text-[9px] font-black ${st?.existe?'text-emerald-400':'text-slate-500'}">${st?.existe?escapeHtml(rotuloFiscalV101(st.status)):'NF-e não consultada'}</div>
    <div class="flex flex-wrap gap-1.5">
      <button onclick="consultarNfePedidoV101('${orderId}')" class="bg-slate-800 hover:bg-slate-700 text-blue-300 px-2.5 py-1.5 rounded-lg text-[9px] font-bold">Consultar</button>
      <button onclick="emitirNfePedidoV101('${orderId}')" class="bg-yellow-400 hover:bg-yellow-300 text-slate-950 px-2.5 py-1.5 rounded-lg text-[9px] font-black">Emitir NF-e</button>
      <button onclick="imprimirNfePedidoV101('${orderId}')" class="bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 px-2.5 py-1.5 rounded-lg text-[9px] font-bold">Imprimir</button>
    </div></div>`;
}
async function consultarNfePedidoV101(orderId,{silencioso=false}={}){
  const el=document.getElementById(`fiscal_status_${orderId}`);if(el)el.textContent='Consultando NF-e...';
  try{
    const r=await fetch(`${RENDER_URL}/api/v101/pedidos/${encodeURIComponent(orderId)}/nfe?_=${Date.now()}`,{cache:'no-store',headers:{Authorization:obterToken()}});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    const data=d.existe?{existe:true,status:d.invoice?.status||d.invoice?.transaction_status||'',invoice:d.invoice}:{existe:false,status:''};
    pedidoFiscalStatusV101.set(String(orderId),data);
    if(el){el.textContent=d.existe?`${rotuloFiscalV101(data.status)}${d.invoice?.invoice_number?` · NF ${d.invoice.invoice_number}`:''}`:'Ainda não emitida';el.className='text-[9px] font-black '+(d.existe&&String(data.status).toLowerCase()==='authorized'?'text-emerald-400':d.existe?'text-yellow-300':'text-slate-500')}
    return data;
  }catch(e){if(el){el.textContent='Fiscal: '+e.message;el.className='text-[9px] font-black text-red-300'}if(!silencioso)alert(e.message);return null}
}
async function emitirNfePedidoV101(orderId){
  if(!confirm(`Emitir a NF-e do pedido ${orderId} pelo Faturador do Mercado Livre?\n\nA conta e os produtos precisam estar fiscalmente configurados.`))return;
  const el=document.getElementById(`fiscal_status_${orderId}`);if(el)el.textContent='Solicitando emissão...';
  try{
    const r=await fetch(`${RENDER_URL}/api/v101/pedidos/${encodeURIComponent(orderId)}/nfe/emitir`,{method:'POST',headers:{Authorization:obterToken()}});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    await consultarNfePedidoV101(orderId,{silencioso:true});
    alert(d.ja_existia?'Este pedido já possui NF-e.':'Emissão solicitada. Se estiver processando, aguarde e consulte novamente.');
  }catch(e){if(el){el.textContent='Erro fiscal: '+e.message;el.className='text-[9px] font-black text-red-300'}alert(e.message)}
}
async function imprimirNfePedidoV101(orderId){
  const win=window.open('','_blank');if(!win)return alert('Libere pop-ups para imprimir o DANFE.');
  win.document.write('<p style="font-family:Arial;padding:24px">Carregando DANFE...</p>');
  try{
    const r=await fetch(`${RENDER_URL}/api/v101/pedidos/${encodeURIComponent(orderId)}/nfe/danfe`,{cache:'no-store',headers:{Authorization:obterToken()}});
    if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(d.erro||`HTTP ${r.status}`)}
    const blob=await r.blob();const url=URL.createObjectURL(blob);win.location.href=url;
    setTimeout(()=>{try{win.focus();win.print()}catch(e){}},1800);setTimeout(()=>URL.revokeObjectURL(url),300000);
  }catch(e){win.close();alert(e.message)}
}

document.addEventListener('DOMContentLoaded',()=>{
  atualizarUiAutomacaoPrecoV101();
  setTimeout(()=>{const s=lerAutomacaoPrecoV101();if(s.status==='running'&&obterToken())executarAutomacaoPrecoV101()},1800);
});
