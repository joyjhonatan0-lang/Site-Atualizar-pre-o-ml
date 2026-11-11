
let claimSelecionada=null;
let claimsCacheV10=[];
let claimsFiltroV10='pendentes';
const claimsMarcadasV10=new Set();
function claimEsc(v){return escapeHtml(String(v??''))}
function claimData(v){if(!v)return '\u2014';try{return new Date(v).toLocaleString('pt-BR')}catch(e){return v}}
function claimResolvida(c){const x=String(c.status||'').toLowerCase();return ['closed','resolved','cancelled','canceled'].includes(x)}
function renderListaClaimsV10(){
  const box=document.getElementById('claims-lista');if(!box)return;
  let arr=claimsCacheV10;
  if(claimsFiltroV10==='pendentes')arr=arr.filter(c=>!claimResolvida(c));
  if(claimsFiltroV10==='resolvidas')arr=arr.filter(claimResolvida);
  box.innerHTML=arr.length?arr.map(c=>{
    const resolvida=claimResolvida(c), marcada=claimsMarcadasV10.has(String(c.id));
    return `<div class="p-4 hover:bg-slate-800/60 transition ${marcada?'bg-yellow-400/5':''}">
      <div class="flex gap-3 items-start">
        <label class="mt-0.5 shrink-0 flex items-center gap-2 cursor-pointer border border-yellow-400/60 bg-yellow-400/10 rounded-lg px-2 py-2" title="Selecionar esta reclama\u00e7\u00e3o">
          <input type="checkbox" ${marcada?'checked':''} onchange="marcarClaimV10('${claimEsc(c.id)}',this.checked)" class="w-6 h-6 accent-yellow-400 cursor-pointer">
          <span class="text-[9px] text-yellow-400 font-black">SELECIONAR</span>
        </label>
        <button onclick="abrirDossieClaim('${claimEsc(c.id)}')" class="flex-1 text-left">
          <div class="flex justify-between gap-2"><div class="font-black text-white text-xs">Reclama\u00e7\u00e3o #${claimEsc(c.id)}</div><span class="text-[9px] px-2 py-1 rounded-full ${resolvida?'bg-emerald-400/10 text-emerald-400':'bg-yellow-400/10 text-yellow-400'}">${resolvida?'Resolvida':claimEsc(rotuloSituacaoV64(c.stage||c.status,'reclamacao'))}</span></div>
          <div class="text-[10px] text-slate-500 mt-2">${claimEsc(c.detail_title||c.reason_id||'Clique para abrir o dossi\u00ea')}</div>
          <div class="text-[9px] text-slate-600 mt-2">Atualizada: ${claimData(c.last_updated||c.date_created)}</div>
        </button>
      </div>
      ${!resolvida?`<button onclick="selecionarEAnalisarClaimV11('${claimEsc(c.id)}')" class="w-full mt-3 bg-yellow-400 hover:bg-yellow-300 text-slate-950 px-3 py-2.5 rounded-xl text-[10px] font-black">\u2726 Analisar esta reclama\u00e7\u00e3o com IA</button>`:''}
    </div>`}).join(''):'<div class="p-8 text-center text-xs text-slate-600">Nenhuma reclama\u00e7\u00e3o neste filtro.</div>';
  ['pendentes','resolvidas','todas'].forEach(f=>{const b=document.getElementById('claim-filtro-'+f);if(b){b.className=(f===claimsFiltroV10?'bg-yellow-400 text-slate-950':'bg-slate-800 text-white')+' px-3 py-2 rounded-lg text-[10px] font-black'}});
  atualizarBotaoClaimsV10();
}
function filtrarClaims(f){claimsFiltroV10=f;renderListaClaimsV10()}
function marcarClaimV10(id,checked){checked?claimsMarcadasV10.add(String(id)):claimsMarcadasV10.delete(String(id));renderListaClaimsV10()}
function atualizarBotaoClaimsV10(){
  const b=document.getElementById('claim-analisar-selecionadas');if(!b)return;
  const pend=[...claimsMarcadasV10].filter(id=>{const c=claimsCacheV10.find(x=>String(x.id)===id);return c&&!claimResolvida(c)});
  b.disabled=pend.length!==1;b.textContent=pend.length===1?'\u2726 Analisar reclama\u00e7\u00e3o selecionada':pend.length>1?`Selecione somente 1 pendente (${pend.length} marcadas)`:'\u2726 Analisar reclama\u00e7\u00e3o selecionada';
}
async function carregarReclamacoesPro(){
  const token=obterToken();
  if(!token){solicitarToken();return}
  const box=document.getElementById('claims-lista');
  if(box) box.innerHTML='<div class="p-6 text-center text-xs text-yellow-400">Buscando reclama\u00e7\u00f5es diretamente no Mercado Livre...</div>';
  const ab=document.getElementById('claims-abertas'),di=document.getElementById('claims-disputas'),pr=document.getElementById('claims-prazo');
  if(ab)ab.textContent='\u2026';if(di)di.textContent='\u2026';if(pr)pr.textContent='\u2026';

  try{
    const r=await fetch(`${RENDER_URL}/api/v10/claims/todas?_=${Date.now()}`,{
      method:'GET',
      cache:'no-store',
      headers:{Authorization:token,'Accept':'application/json'}
    });
    let d={};try{d=await r.json()}catch(_){}
    if(!r.ok) throw new Error(d.erro||d.error||`Erro HTTP ${r.status} ao buscar reclama\u00e7\u00f5es.`);

    claimsCacheV10=Array.isArray(d.reclamacoes)?d.reclamacoes:[];
    const pend=claimsCacheV10.filter(c=>!claimResolvida(c));
    if(ab)ab.textContent=String(pend.length);
    if(di)di.textContent=String(pend.filter(x=>{
      const st=String(x.stage||'').toLowerCase();
      return st==='dispute'||st.includes('mediation');
    }).length);
    if(pr){
      const agora=Date.now(),janela=2*86400000;
      pr.textContent=String(pend.filter(x=>x.due_date&&new Date(x.due_date).getTime()>=agora&&new Date(x.due_date).getTime()-agora<=janela).length);
    }
    renderListaClaimsV10();
    if(!claimsCacheV10.length && box){
      box.innerHTML='<div class="p-6 text-center text-xs text-slate-500">O Mercado Livre retornou 0 reclama\u00e7\u00f5es para esta conta.</div>';
    }
  }catch(e){
    console.error('[RECLAMA\u00c7\u00d5ES]',e);
    if(ab)ab.textContent='!';if(di)di.textContent='!';if(pr)pr.textContent='!';
    if(box)box.innerHTML=`<div class="p-5 text-xs text-red-400"><b>Erro ao buscar reclama\u00e7\u00f5es no Mercado Livre.</b><div class="mt-2">${claimEsc(e.message)}</div><button onclick="carregarReclamacoesPro()" class="mt-3 bg-yellow-400 text-slate-950 px-3 py-2 rounded-lg font-black">Tentar novamente</button></div>`;
  }
}
async function selecionarEAnalisarClaimV11(id){
  claimsMarcadasV10.clear();
  claimsMarcadasV10.add(String(id));
  renderListaClaimsV10();
  await abrirDossieClaim(id);
  await analisarClaimIA(id);
}
async function analisarClaimsSelecionadas(){
  const ids=[...claimsMarcadasV10].filter(id=>{const c=claimsCacheV10.find(x=>String(x.id)===id);return c&&!claimResolvida(c)});
  if(ids.length!==1)return alert('Selecione exatamente uma reclama\u00e7\u00e3o pendente para analisar.');
  await abrirDossieClaim(ids[0]);await analisarClaimIA(ids[0]);
}
async function abrirDossieClaim(id){
  const token=obterToken();claimSelecionada=id;mostrarLoading('Montando dossi\u00ea da reclama\u00e7\u00e3o...');
  try{
    const r=await fetch(`${RENDER_URL}/api/v9/claims/${encodeURIComponent(id)}/dossie`,{headers:{Authorization:token}});
    const d=await r.json();if(!r.ok)throw new Error(d.erro||'Erro ao abrir reclama\u00e7\u00e3o.');
    renderDossieClaim(d);
  }catch(e){alert(e.message)}finally{esconderLoading()}
}
function renderDossieClaim(d){
  const c=d.claim||{}, msgs=d.messages||[], anexos=d.attachments||[];
  const box=document.getElementById('claim-dossie');
  box.innerHTML=`<div class="flex flex-col md:flex-row md:items-start justify-between gap-3"><div><div class="text-[10px] text-yellow-400 uppercase font-bold">Dossi\u00ea #${claimEsc(c.id||claimSelecionada)}</div><h2 class="text-xl font-black text-white mt-1">${claimEsc(d.detail?.title||c.reason_id||'Reclama\u00e7\u00e3o')}</h2><div class="text-[10px] text-slate-500 mt-2">Est\u00e1gio: ${claimEsc(rotuloSituacaoV64(c.stage,'reclamacao'))} \u00b7 Situa\u00e7\u00e3o: ${claimEsc(rotuloSituacaoV64(c.status,'reclamacao'))} \u00b7 Prazo: ${claimData(d.detail?.due_date||c.due_date)}</div></div><button onclick="analisarClaimIA('${claimEsc(c.id||claimSelecionada)}')" class="bg-yellow-400 text-slate-950 px-4 py-2.5 rounded-xl text-xs font-black">\u2726 Analisar com IA</button></div>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5"><div class="bg-slate-950 rounded-xl p-3"><div class="text-[9px] text-slate-500 uppercase">Pedido/recurso</div><div class="text-xs text-white mt-1">${claimEsc(c.resource||c.order_id||'\u2014')}</div></div><div class="bg-slate-950 rounded-xl p-3"><div class="text-[9px] text-slate-500 uppercase">Impacto reputa\u00e7\u00e3o</div><div class="text-xs ${d.impact?.affects_reputation===true?'text-red-400':'text-emerald-400'} mt-1">${d.impact?claimEsc(JSON.stringify(d.impact)):'N\u00e3o informado'}</div></div><div class="bg-slate-950 rounded-xl p-3"><div class="text-[9px] text-slate-500 uppercase">Anexos encontrados</div><div class="text-xs text-white mt-1">${anexos.length}</div></div></div>
  <div class="mt-5"><div class="font-black text-white text-xs">Hist\u00f3rico e mensagens</div><div class="space-y-2 mt-3">${msgs.length?msgs.map(m=>`<div class="bg-slate-950 rounded-xl p-3"><div class="text-[9px] text-slate-500">${claimEsc(m.sender_role)} \u2192 ${claimEsc(m.receiver_role)} \u00b7 ${claimData(m.date_created||m.message_date)}</div><div class="text-xs text-slate-200 mt-2 whitespace-pre-wrap">${claimEsc(m.message||m.translated_message||'')}</div>${(m.attachments||[]).length?`<div class="flex flex-wrap gap-2 mt-3">${m.attachments.map(a=>`<button onclick="abrirAnexoClaim('${claimEsc(c.id||claimSelecionada)}','${claimEsc(a.filename)}')" class="text-[10px] bg-slate-800 text-blue-300 px-3 py-2 rounded-lg">\ud83d\uddbc ${claimEsc(a.original_filename||a.filename)}</button>`).join('')}</div>`:''}</div>`).join(''):'<div class="text-xs text-slate-600">Sem mensagens retornadas.</div>'}</div></div>
  <div id="claim-anexo-preview" class="mt-5"></div>
  <div id="claim-ia-box" class="mt-5 hidden"></div>`;
}
function abrirAnexoClaim(id,file){
  const token=obterToken();
  const url=`${RENDER_URL}/api/v9/claims/${encodeURIComponent(id)}/attachments/${encodeURIComponent(file)}`;
  fetch(url,{headers:{Authorization:token}}).then(r=>r.blob()).then(b=>{const u=URL.createObjectURL(b);document.getElementById('claim-anexo-preview').innerHTML=`<div class="font-black text-white text-xs mb-2">Anexo</div><img src="${u}" class="max-h-[420px] rounded-xl border border-slate-700 object-contain bg-slate-950">`}).catch(()=>alert('N\u00e3o foi poss\u00edvel abrir o anexo.'));
}
async function analisarClaimIA(id){
  const token=obterToken();
  const b=document.getElementById('claim-ia-box');
  if(b){
    b.classList.remove('hidden');
    b.innerHTML=`<div class="border border-yellow-400/20 bg-yellow-400/5 rounded-2xl p-4">
      <div class="text-[10px] uppercase text-yellow-400 font-black">An\u00e1lise com Gemini</div>
      <div class="text-xs text-slate-300 mt-2">Analisando reclama\u00e7\u00e3o, hist\u00f3rico e evid\u00eancias. Se um modelo estiver ocupado, o sistema tentar\u00e1 outro automaticamente.</div>
    </div>`;
  }
  mostrarLoading('Gemini analisando contexto e evid\u00eancias...');
  try{
    const r=await fetch(`${RENDER_URL}/api/v9/claims/${encodeURIComponent(id)}/analisar`,{
      method:'POST',
      cache:'no-store',
      headers:{Authorization:token,'Content-Type':'application/json','Accept':'application/json'},
      body:'{}'
    });
    let d={};
    try{d=await r.json()}catch(_){}
    if(!r.ok)throw new Error(d.erro||d.error||`Erro HTTP ${r.status} na an\u00e1lise.`);

    if(!b)throw new Error('\u00c1rea de resultado da IA n\u00e3o encontrada.');
    const modelo=claimEsc(d.modelo||'Gemini');
    const imagens=Number(d.imagens_analisadas||0);
    const fallback=d.fallback_utilizado
      ? '<span class="text-emerald-400">Fallback autom\u00e1tico utilizado \u2713</span>'
      : '<span class="text-slate-500">Modelo principal respondeu normalmente</span>';
    const respMap={
      vendedor:'Vendedor',
      comprador:'Comprador',
      logistica_transportadora:'Log\u00edstica / transportadora',
      inconclusiva:'Inconclusiva'
    };
    const respChave=String(d.responsabilidade_provavel||'inconclusiva');
    const respLabel=claimEsc(respMap[respChave]||'Inconclusiva');
    const confianca=claimEsc(String(d.confianca||'baixa').toUpperCase());
    const fundamentos=Array.isArray(d.fundamentos_defesa)?d.fundamentos_defesa:[];
    const fundamentosHtml=fundamentos.length
      ? fundamentos.map(x=>`<li class="mt-1">${claimEsc(x)}</li>`).join('')
      : '<li class="mt-1">A IA n\u00e3o encontrou fundamentos suficientes para listar.</li>';
    const destino=String(d.destinatario_recomendado||'mediator')==='complainant'?'complainant':'mediator';
    const badgeResp=respChave==='logistica_transportadora'
      ? 'border-sky-400/30 bg-sky-400/10 text-sky-300'
      : respChave==='vendedor'
        ? 'border-red-400/30 bg-red-400/10 text-red-300'
        : 'border-yellow-400/30 bg-yellow-400/10 text-yellow-300';

    b.innerHTML=`<div id="claim-ia-resultado" class="border border-emerald-400/30 bg-emerald-400/5 rounded-2xl p-4">
      <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div class="text-[10px] uppercase text-emerald-400 font-black">\u2713 An\u00e1lise conclu\u00edda \u2014 Defesa do vendedor</div>
          <div class="text-[10px] text-slate-500 mt-1">Modelo: ${modelo} \u00b7 Imagens analisadas: ${imagens} \u00b7 ${fallback}</div>
          <div class="text-[10px] text-slate-500 mt-1">Revise antes de enviar. Quando houver ind\u00edcios de avaria log\u00edstica, a IA prioriza a defesa do vendedor e solicita prote\u00e7\u00e3o ao Mercado Livre, sem prometer resultado.</div>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="rounded-xl border ${badgeResp} p-3">
          <div class="text-[9px] uppercase font-black opacity-70">Responsabilidade prov\u00e1vel</div>
          <div class="text-sm font-black mt-1">${respLabel}</div>
        </div>
        <div class="rounded-xl border border-slate-700 bg-slate-950 p-3">
          <div class="text-[9px] uppercase text-slate-500 font-black">Confian\u00e7a da an\u00e1lise</div>
          <div class="text-sm text-white font-black mt-1">${confianca}</div>
        </div>
        <div class="rounded-xl border border-slate-700 bg-slate-950 p-3">
          <div class="text-[9px] uppercase text-slate-500 font-black">Destino recomendado</div>
          <div class="text-sm text-white font-black mt-1">${destino==='mediator'?'Media\u00e7\u00e3o / Mercado Livre':'Comprador'}</div>
        </div>
      </div>

      <div class="mt-4 bg-slate-950 rounded-xl p-4 border border-slate-800">
        <div class="text-[10px] uppercase text-yellow-400 font-bold mb-2">Fundamentos da defesa</div>
        <ul class="text-xs text-slate-200 leading-relaxed list-disc pl-5">${fundamentosHtml}</ul>
      </div>

      <div class="mt-4 bg-slate-950 rounded-xl p-4 border border-slate-800">
        <div class="text-[10px] uppercase text-yellow-400 font-bold mb-2">An\u00e1lise da reclama\u00e7\u00e3o</div>
        <div class="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">${claimEsc(d.analise||'An\u00e1lise conclu\u00edda sem texto adicional.')}</div>
      </div>

      <div class="mt-4 bg-slate-950 rounded-xl p-4 border border-slate-800">
        <div class="text-[10px] uppercase text-emerald-400 font-bold mb-2">Estrat\u00e9gia de defesa recomendada</div>
        <div class="text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">${claimEsc(d.estrategia_defesa||'Revise os fatos antes de responder.')}</div>
      </div>

      <div class="mt-4">
        <label class="text-[10px] uppercase text-yellow-400 font-bold">Resposta sugerida para revis\u00e3o</label>
        <textarea id="claim-resposta-ia" class="w-full min-h-[180px] mt-2 bg-slate-950 border border-slate-700 focus:border-yellow-400 rounded-xl p-3 text-xs text-white">${claimEsc(d.resposta_sugerida||'')}</textarea>
      </div>

      <div class="flex flex-col md:flex-row gap-2 mt-3">
        <select id="claim-destinatario" class="bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white">
          <option value="complainant" ${destino==='complainant'?'selected':''}>Comprador</option>
          <option value="mediator" ${destino==='mediator'?'selected':''}>Media\u00e7\u00e3o do Mercado Livre</option>
        </select>
        <button onclick="enviarRespostaClaim('${claimEsc(id)}')" class="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-2.5 rounded-xl text-xs font-black">Enviar resposta revisada</button>
      </div>
    </div>`;

    esconderLoading();
    setTimeout(()=>{
      document.getElementById('claim-ia-resultado')?.scrollIntoView({behavior:'smooth',block:'start'});
    },150);
  }catch(e){
    esconderLoading();
    if(b){
      b.classList.remove('hidden');
      b.innerHTML=`<div id="claim-ia-erro" class="border border-amber-400/30 bg-amber-400/5 rounded-2xl p-4">
        <div class="text-[10px] uppercase text-amber-400 font-black">IA temporariamente indispon\u00edvel</div>
        <div class="text-xs text-slate-300 mt-2">${claimEsc(e.message)}</div>
        <div class="text-[10px] text-slate-500 mt-2">Nenhuma resposta foi enviada ao Mercado Livre.</div>
        <button type="button" onclick="analisarClaimIA('${claimEsc(id)}')" class="mt-3 bg-yellow-400 text-slate-950 px-4 py-2.5 rounded-xl text-xs font-black">\u21bb Tentar an\u00e1lise novamente</button>
      </div>`;
      setTimeout(()=>document.getElementById('claim-ia-erro')?.scrollIntoView({behavior:'smooth',block:'center'}),100);
    }
  }
}
async function enviarRespostaClaim(id){
  const msg=document.getElementById('claim-resposta-ia')?.value?.trim(),receiver=document.getElementById('claim-destinatario')?.value||'complainant';
  if(!msg)return alert('Revise e preencha a resposta antes de enviar.');
  if(!confirm('Confirma o envio desta mensagem para a reclama\u00e7\u00e3o?'))return;
  const token=obterToken();mostrarLoading('Enviando resposta...');
  try{const r=await fetch(`${RENDER_URL}/api/v9/claims/${encodeURIComponent(id)}/mensagem`,{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({message:msg,receiver_role:receiver})});const d=await r.json();if(!r.ok)throw new Error(d.erro||'Erro ao enviar.');alert('Resposta enviada com sucesso.');await abrirDossieClaim(id)}catch(e){alert(e.message)}finally{esconderLoading()}
}
