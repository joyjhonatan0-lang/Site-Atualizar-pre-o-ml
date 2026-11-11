
const promocoesEstadoV77={
  promocoes:[],selecionada:null,pagina:1,paginas:1,itens:[],selecionados:new Map(),jobId:null,syncAtivo:false
};

function moedaPromoV77(v){
  const n=Number(v||0);
  return n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
}
function pctPromoV77(v){
  const n=Number(v);
  return Number.isFinite(n)?n:0;
}
function nomeTipoPromoV77(t){
  const m={DEAL:'Campanha tradicional',MARKETPLACE_CAMPAIGN:'Campanha cofinanciada',VOLUME:'Desconto por quantidade',
    DOD:'Oferta do dia',LIGHTNING:'Oferta relâmpago',PRICE_DISCOUNT:'Desconto individual',
    PRE_NEGOTIATED:'Desconto pré-acordado',SELLER_CAMPAIGN:'Campanha do vendedor',SMART:'Campanha SMART',
    PRICE_MATCHING:'Preço competitivo',UNHEALTHY_STOCK:'Liquidação de estoque',SELLER_COUPON_CAMPAIGN:'Cupom do vendedor'};
  return m[String(t||'').toUpperCase()]||String(t||'Promoção');
}
function descontoPadraoPromoV77(p){
  const d=Number(p?.discount_percentage);
  if(Number.isFinite(d)&&d>0)return d;
  const s=Number(p?.seller_percentage||0),m=Number(p?.meli_percentage||0);
  return Math.max(0,s+m);
}
function statusPromoV77(s){
  const m={started:'Ativa',pending:'Programada',candidate:'Disponível',finished:'Finalizada'};
  return m[String(s||'').toLowerCase()]||String(s||'');
}

async function carregarPromocoesV77(forcar=false){
  const token=obterToken();if(!token){solicitarToken();return}
  const st=document.getElementById('promocoes-status-v77');
  if(st)st.textContent=forcar?'Atualizando promoções no Mercado Livre...':'Carregando promoções salvas...';
  try{
    const r=await fetch(`${RENDER_URL}/api/v77/promocoes${forcar?'?refresh=1':''}`,{cache:'no-store',headers:{Authorization:token}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    promocoesEstadoV77.promocoes=Array.isArray(d.promocoes)?d.promocoes:[];
    if(st)st.textContent=`${promocoesEstadoV77.promocoes.length} promoção(ões) disponível(is)${d.erro_refresh?' · mantendo cache: '+d.erro_refresh:''}.`;
    const cache=document.getElementById('promocoes-cache-v77');
    if(cache)cache.textContent=d.synced_at?`Cache: ${new Date(d.synced_at).toLocaleString('pt-BR')}`:'';
    renderPromocoesV77();
    if(promocoesEstadoV77.selecionada){
      const atual=promocoesEstadoV77.promocoes.find(p=>p.id===promocoesEstadoV77.selecionada.id&&p.type===promocoesEstadoV77.selecionada.type);
      if(atual)promocoesEstadoV77.selecionada=atual;
    }
  }catch(e){if(st)st.textContent='Erro: '+e.message}
}

function renderPromocoesV77(){
  const box=document.getElementById('promocoes-cards-v77');if(!box)return;
  const ps=promocoesEstadoV77.promocoes;
  if(!ps.length){box.innerHTML='<div class="border border-slate-800 rounded-xl p-4 text-xs text-slate-600">Nenhuma promoção disponível retornada pelo Mercado Livre.</div>';return}
  box.innerHTML=ps.map((p,i)=>{
    const pct=descontoPadraoPromoV77(p),sel=promocoesEstadoV77.selecionada?.id===p.id&&promocoesEstadoV77.selecionada?.type===p.type;
    const contrib=[p.seller_percentage!=null?`Você ${Number(p.seller_percentage).toFixed(1)}%`:'',p.meli_percentage!=null?`ML ${Number(p.meli_percentage).toFixed(1)}%`:''].filter(Boolean).join(' + ');
    return `<button onclick="selecionarPromocaoV77(${i})" class="text-left rounded-2xl border ${sel?'border-yellow-400 bg-yellow-400/5':'border-slate-800 bg-slate-950/40 hover:border-slate-700'} p-4 transition">
      <div class="flex items-start justify-between gap-2"><div class="text-[10px] text-yellow-400 font-black uppercase">${escapeHtml(nomeTipoPromoV77(p.type))}</div><span class="text-[9px] px-2 py-1 rounded-full bg-slate-800 text-slate-300">${escapeHtml(statusPromoV77(p.status))}</span></div>
      <div class="font-black text-white text-sm mt-2 line-clamp-1">${escapeHtml(p.name||p.id)}</div>
      <div class="text-2xl font-black ${pct?'text-emerald-400':'text-slate-400'} mt-3">${pct?pct.toFixed(1)+'%':'—'}</div>
      <div class="text-[9px] text-slate-500 mt-1">${escapeHtml(contrib||'Percentual definido conforme os itens elegíveis')}</div>
      <div class="text-[9px] text-slate-600 mt-2">${p.finish_date?'Até '+new Date(p.finish_date).toLocaleDateString('pt-BR'):'Sem data final informada'}</div>
    </button>`;
  }).join('');
}

function selecionarPromocaoV77(i){
  const p=promocoesEstadoV77.promocoes[i];if(!p)return;
  promocoesEstadoV77.selecionada=p;
  promocoesEstadoV77.selecionados.clear();
  const pct=descontoPadraoPromoV77(p);
  const pctEl=document.getElementById('promocao-percent-v77');if(pctEl)pctEl.value=pct||'';
  document.getElementById('promocao-selecionada-v77')?.classList.remove('hidden');
  document.getElementById('promocao-acoes-v77')?.classList.remove('hidden');
  const nome=document.getElementById('promocao-nome-v77');if(nome)nome.textContent=p.name||nomeTipoPromoV77(p.type);
  const det=document.getElementById('promocao-detalhe-v77');
  if(det)det.textContent=`${nomeTipoPromoV77(p.type)} · ${p.id} · ${statusPromoV77(p.status)}`;
  renderPromocoesV77();
  aplicarPercentualPromocaoV77(pct);
  carregarAnunciosPromocaoV77(1);
  sincronizarItensPromocaoV77(false);
}

async function sincronizarItensPromocaoV77(reset=false){
  const p=promocoesEstadoV77.selecionada;if(!p||promocoesEstadoV77.syncAtivo)return;
  const token=obterToken();if(!token)return;
  promocoesEstadoV77.syncAtivo=true;
  const st=document.getElementById('promocao-sync-v77');if(st)st.textContent='Sincronizando elegibilidade da promoção em segundo plano...';
  try{
    const r=await fetch(`${RENDER_URL}/api/v77/promocoes/${encodeURIComponent(p.id)}/sincronizar`,{
      method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},
      body:JSON.stringify({promotion_type:p.type,reset,tempo_ms:9000})
    });
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    if(st)st.textContent=`Elegibilidade: +${Number(d.itens||0).toLocaleString('pt-BR')} item(ns) sincronizado(s)${d.parcial?' · continuando em segundo plano...':' · concluída'}.`;
    await carregarAnunciosPromocaoV77(promocoesEstadoV77.pagina);
    if(d.parcial)setTimeout(()=>{promocoesEstadoV77.syncAtivo=false;sincronizarItensPromocaoV77(false)},700);
  }catch(e){if(st)st.textContent='Elegibilidade: '+e.message}
  finally{if(!st?.textContent?.includes('continuando'))promocoesEstadoV77.syncAtivo=false}
}

function aplicarPercentualPromocaoV77(valor){
  const pct=Math.max(0,Math.min(80,Number(valor||0)));
  document.querySelectorAll('[data-promo-percent-v77]').forEach(el=>{el.value=pct});
  document.querySelectorAll('[data-promo-price-v77]').forEach(el=>{
    const base=Number(el.dataset.base||0);
    el.textContent=moedaPromoV77(base*(1-pct/100));
  });
}

async function carregarAnunciosPromocaoV77(page=1){
  const p=promocoesEstadoV77.selecionada;if(!p)return;
  const token=obterToken();if(!token)return;
  const qs=new URLSearchParams({page:String(Math.max(1,page)),limit:'100',promotion_id:p.id,promotion_type:p.type});
  const q=document.getElementById('promocao-busca-v77')?.value.trim();if(q)qs.set('q',q);
  const sf=document.getElementById('promocao-busca-campo-v78')?.value||'sku';qs.set('search_field',sf);
  const s=document.getElementById('promocao-status-filtro-v77')?.value;if(s)qs.set('status',s);
  const pa=document.getElementById('promocao-participacao-filtro-v77')?.value;if(pa)qs.set('participation',pa);
  const st=document.getElementById('promocao-anuncios-status-v77');if(st)st.textContent='Abrindo anúncios do cache da Gestão...';
  try{
    const r=await fetch(`${RENDER_URL}/api/v77/promocoes/anuncios?${qs.toString()}`,{cache:'no-store',headers:{Authorization:token}});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    promocoesEstadoV77.pagina=d.page||1;promocoesEstadoV77.paginas=d.paginas||1;promocoesEstadoV77.itens=d.itens||[];
    const filtroAtual=filtrosAtuaisPromocaoV78();
    const detalheFiltro=filtroAtual.q
      ? ` · filtro ${filtroAtual.search_field==='sku'?'SKU exato':filtroAtual.search_field.toUpperCase()}: ${filtroAtual.q}`
      : '';
    if(st)st.textContent=`${Number(d.total||0).toLocaleString('pt-BR')} anúncio(s) · dados principais carregados do cache da Gestão${detalheFiltro}.`;
    const pg=document.getElementById('promocao-pagina-v77');if(pg)pg.textContent=`Página ${d.page} de ${d.paginas}`;
    renderAnunciosPromocaoV77();
  }catch(e){if(st)st.textContent='Erro: '+e.message}
}

function statusParticipacaoV77(x){
  const s=String(x.promo_status||'').toLowerCase();
  if(s==='started')return ['Participando','text-emerald-400'];
  if(s==='pending')return ['Programado','text-blue-400'];
  if(s==='candidate')return ['Elegível','text-yellow-400'];
  if(s==='finished')return ['Finalizado','text-red-400'];
  return ['Não identificado','text-slate-500'];
}

function renderAnunciosPromocaoV77(){
  const tbody=document.getElementById('promocao-tbody-v77');if(!tbody)return;
  const pctGlobal=Math.max(0,Math.min(80,Number(document.getElementById('promocao-percent-v77')?.value||0)));
  if(!promocoesEstadoV77.itens.length){tbody.innerHTML='<tr><td colspan="8" class="px-4 py-10 text-center text-slate-600">Nenhum anúncio encontrado.</td></tr>';return}
  tbody.innerHTML=promocoesEstadoV77.itens.map(x=>{
    const sel=promocoesEstadoV77.selecionados.has(String(x.id));
    const [status,cls]=statusParticipacaoV77(x);
    const base=Number(x.price||0);
    const suggested=Number(x.suggested_discounted_price);
    const final=(Number.isFinite(suggested)&&suggested>0)?suggested:base*(1-pctGlobal/100);
    const pctReal=base>0?Math.max(0,(1-final/base)*100):pctGlobal;
    return `<tr data-promo-row-v77="${escapeHtml(x.id)}" class="hover:bg-slate-900/50">
      <td class="px-3 py-3 text-center"><input type="checkbox" ${sel?'checked':''} onchange="selecionarItemPromocaoV77('${escapeHtml(x.id)}',this.checked)" class="w-4 h-4 accent-yellow-400"></td>
      <td class="px-3 py-3"><div class="flex items-center gap-3"><img src="${escapeHtml(x.thumbnail||'')}" class="w-10 h-10 rounded-lg object-cover bg-white" onerror="this.style.visibility='hidden'"><div class="font-black text-white max-w-[420px]">${escapeHtml(x.title||'Sem título')}</div></div></td>
      <td class="px-3 py-3"><div class="text-slate-300 font-bold">${escapeHtml(x.id)}</div><div class="text-[9px] text-slate-600 mt-1">SKU: ${escapeHtml(x.sku||'—')}</div></td>
      <td class="px-3 py-3 text-right font-black text-white">${moedaPromoV77(base)}</td>
      <td class="px-3 py-3 text-center"><input data-promo-percent-v77 data-id="${escapeHtml(x.id)}" type="number" min="0" max="80" step="0.1" value="${pctReal.toFixed(1)}" oninput="atualizarLinhaPromocaoV77('${escapeHtml(x.id)}',this.value)" class="w-20 bg-slate-950 border border-slate-700 rounded-lg px-2 py-2 text-center text-yellow-300 font-black"></td>
      <td data-promo-price-v77 data-base="${base}" data-id="${escapeHtml(x.id)}" class="px-3 py-3 text-right font-black text-emerald-400">${moedaPromoV77(final)}</td>
      <td class="px-3 py-3 text-center"><div class="${cls} font-black">${escapeHtml(status)}</div>${x.promo_seller_percentage!=null||x.promo_meli_percentage!=null?`<div class="text-[9px] text-slate-600 mt-1">Você ${Number(x.promo_seller_percentage||0).toFixed(1)}% · ML ${Number(x.promo_meli_percentage||0).toFixed(1)}%</div>`:''}</td>
      <td class="px-3 py-3 text-center"><div class="flex justify-center gap-2"><button onclick="acaoIndividualPromocaoV77('${escapeHtml(x.id)}','join')" class="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-3 py-2 rounded-lg text-[9px] font-black">Participar</button><button onclick="acaoIndividualPromocaoV77('${escapeHtml(x.id)}','leave')" class="bg-red-950 border border-red-800 text-red-200 px-3 py-2 rounded-lg text-[9px] font-black">Sair</button></div></td>
    </tr>`;
  }).join('');
  atualizarResumoSelecaoPromocaoV77();
}

function atualizarLinhaPromocaoV77(id,pct){
  const row=document.querySelector(`[data-promo-row-v77="${CSS.escape(String(id))}"]`);if(!row)return;
  const price=row.querySelector(`[data-promo-price-v77]`),base=Number(price?.dataset.base||0),p=Math.max(0,Math.min(80,Number(pct||0)));
  if(price)price.textContent=moedaPromoV77(base*(1-p/100));
  if(promocoesEstadoV77.selecionados.has(String(id)))promocoesEstadoV77.selecionados.set(String(id),p);
}
function selecionarItemPromocaoV77(id,on){
  if(on){
    const el=document.querySelector(`[data-promo-row-v77="${CSS.escape(String(id))}"] [data-promo-percent-v77]`);
    promocoesEstadoV77.selecionados.set(String(id),Number(el?.value||0));
  }else promocoesEstadoV77.selecionados.delete(String(id));
  atualizarResumoSelecaoPromocaoV77();
}
function selecionarPaginaPromocaoV77(on){
  promocoesEstadoV77.itens.forEach(x=>{
    if(on){
      const el=document.querySelector(`[data-promo-row-v77="${CSS.escape(String(x.id))}"] [data-promo-percent-v77]`);
      promocoesEstadoV77.selecionados.set(String(x.id),Number(el?.value||document.getElementById('promocao-percent-v77')?.value||0));
    }else promocoesEstadoV77.selecionados.delete(String(x.id));
  });
  renderAnunciosPromocaoV77();
}
function atualizarResumoSelecaoPromocaoV77(){
  const el=document.getElementById('promocao-selecao-resumo-v77');
  if(el)el.textContent=`${promocoesEstadoV77.selecionados.size.toLocaleString('pt-BR')} anúncio(s) selecionado(s)`;
}
function paginaPromocaoV77(delta){
  const p=Math.max(1,Math.min(promocoesEstadoV77.paginas,promocoesEstadoV77.pagina+delta));
  if(p!==promocoesEstadoV77.pagina)carregarAnunciosPromocaoV77(p);
}

async function acaoIndividualPromocaoV77(id,action){
  const p=promocoesEstadoV77.selecionada;if(!p)return;
  const token=obterToken();if(!token)return;
  const row=document.querySelector(`[data-promo-row-v77="${CSS.escape(String(id))}"]`);
  const pct=Number(row?.querySelector('[data-promo-percent-v77]')?.value||0);
  const base=Number(row?.querySelector('[data-promo-price-v77]')?.dataset.base||0);
  const deal=Number((base*(1-pct/100)).toFixed(2));
  try{
    const r=await fetch(`${RENDER_URL}/api/v77/promocoes/acao`,{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},
      body:JSON.stringify({id,action,promotion_id:p.id,promotion_type:p.type,percent:pct,deal_price:deal})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    await carregarAnunciosPromocaoV77(promocoesEstadoV77.pagina);
  }catch(e){alert(e.message)}
}


function filtrosAtuaisPromocaoV78(){
  return {
    q:document.getElementById('promocao-busca-v77')?.value.trim()||'',
    search_field:document.getElementById('promocao-busca-campo-v78')?.value||'sku',
    status:document.getElementById('promocao-status-filtro-v77')?.value||'',
    participation:document.getElementById('promocao-participacao-filtro-v77')?.value||''
  };
}

async function acaoMassaPromocaoV77(action,allEligible=false){
  const p=promocoesEstadoV77.selecionada;if(!p)return;
  const token=obterToken();if(!token)return;
  const items=[...promocoesEstadoV77.selecionados.entries()].map(([id,percent])=>({id,percent}));
  if(!allEligible&&!items.length){alert('Selecione pelo menos um anúncio.');return}
  const filter=filtrosAtuaisPromocaoV78();
  const temFiltro=Boolean(filter.q||filter.status||filter.participation);
  const escopo=allEligible
    ? (temFiltro?'todos os anúncios elegíveis que correspondem ao filtro atual':'todos os anúncios elegíveis da promoção')
    : `${items.length} anúncio(s) selecionado(s)`;
  if(!confirm(`${action==='join'?'Participar':'Sair'}: confirmar ação em ${escopo}?`))return;
  try{
    const r=await fetch(`${RENDER_URL}/api/v91/promocoes/acao-massa`,{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},
      body:JSON.stringify({promotion_id:p.id,promotion_type:p.type,action,percent:Number(document.getElementById('promocao-percent-v77')?.value||0),items,all_eligible:allEligible,filter})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    promocoesEstadoV77.jobId=d.job_id;
    const box=document.getElementById('promocao-job-v77');box?.classList.remove('hidden');
    const msg=document.getElementById('promocao-job-msg-v77');
    if(msg)msg.textContent=d.mensagem||`Preparando ${Number(d.total||0).toLocaleString('pt-BR')} anúncio(s) em lotes de 100...`;
    acompanharJobPromocaoV77(d.job_id);
  }catch(e){alert(e.message)}
}

async function acompanharJobPromocaoV77(jobId){
  const token=obterToken();if(!token)return;
  const box=document.getElementById('promocao-job-v77');box?.classList.remove('hidden');
  try{
    const r=await fetch(`${RENDER_URL}/api/scale/jobs/${encodeURIComponent(jobId)}?_=${Date.now()}`,{cache:'no-store',headers:{Authorization:token}});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    const j=d.job||{},total=Number(j.progress_total||0),atual=Number(j.progress_current||0),pct=total?Math.round(atual/total*100):0;
    const msg=document.getElementById('promocao-job-msg-v77');if(msg)msg.textContent=j.message||'Processando...';
    const pe=document.getElementById('promocao-job-pct-v77');if(pe)pe.textContent=pct+'%';
    const bar=document.getElementById('promocao-job-bar-v77');if(bar)bar.style.width=pct+'%';
    if(['queued','running'].includes(j.status)){setTimeout(()=>acompanharJobPromocaoV77(jobId),1500);return}
    promocoesEstadoV77.jobId=null;
    promocoesEstadoV77.selecionados.clear();
    await carregarAnunciosPromocaoV77(promocoesEstadoV77.pagina);
    setTimeout(()=>sincronizarItensPromocaoV77(true),800);
  }catch(e){setTimeout(()=>acompanharJobPromocaoV77(jobId),2500)}
}
