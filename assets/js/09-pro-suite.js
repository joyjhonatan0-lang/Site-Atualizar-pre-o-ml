
async function apiPro(path, options={}) {
  const token=obterToken();
  const headers={...(options.headers||{}),Authorization:token};
  if(options.body && !headers['Content-Type']) headers['Content-Type']='application/json';
  const r=await fetch(`${RENDER_URL}${path}`,{...options,headers});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.erro||d.message||`HTTP ${r.status}`);
  return d;
}
async function carregarCentralPro(){
  const fila=document.getElementById('central-fila');
  fila.innerHTML='<div class="panel rounded-2xl p-6 text-xs text-yellow-400">Analisando operação, filas e integrações...</div>';

  try{
    const [ops,a,c,s,audit]=await Promise.allSettled([
      apiPro('/api/v94/operations/summary'),
      apiPro('/api/v2/alertas'),
      apiPro('/api/v3/claims?status=opened'),
      fetch(`${RENDER_URL}/api/v3/integracoes/status?_=${Date.now()}`,{cache:'no-store'}).then(r=>r.json()),
      apiPro('/api/v94/audit?limit=8')
    ]);

    const op=ops.status==='fulfilled'?ops.value:null;
    const alertas=a.status==='fulfilled'?(a.value.alertas||[]):[];
    const claims=c.status==='fulfilled'?(c.value.reclamacoes||[]):[];

    document.getElementById('central-alertas').innerText=op
      ? Number(op.itens?.sem_estoque||0)+Number(op.itens?.estoque_critico||0)+Number(op.itens?.frete_com_erro||0)
      : alertas.length;

    document.getElementById('central-claims').innerText=claims.length;
    document.getElementById('central-sku').innerText=op?Number(op.itens?.sem_sku||0):alertas.filter(x=>x.tipo==='sem_sku').length;
    document.getElementById('central-estoque').innerText=op
      ? Number(op.itens?.sem_estoque||0)+Number(op.itens?.estoque_critico||0)
      : alertas.filter(x=>String(x.tipo).includes('estoque')).length;

    if(s.status==='fulfilled'){
      document.getElementById('central-integracoes').innerText=
        `ML ✓ · Bling ${s.value.bling?.configurado?'✓':'—'} · IA ${s.value.gemini?.configurado||s.value.openai?.configurado?'✓':'—'}`;
    }

    const cards=[];

    if(op){
      const jobsFalhos=Number(op.jobs?.failed||0);
      const notifPendentes=Number(op.notifications?.queued||0)+Number(op.notifications?.running||0);
      const semComissao=Number(op.itens?.sem_comissao||0);
      const freteErro=Number(op.itens?.frete_com_erro||0);

      if(jobsFalhos)cards.push({t:'Jobs com falha',d:`${jobsFalhos.toLocaleString('pt-BR')} processo(s) exigem atenção`,n:'ALTA'});
      if(notifPendentes)cards.push({t:'Fila de notificações',d:`${notifPendentes.toLocaleString('pt-BR')} evento(s) aguardando processamento`,n:'MÉDIA'});
      if(freteErro)cards.push({t:'Falhas de frete',d:`${freteErro.toLocaleString('pt-BR')} anúncio(s) com erro na última sincronização`,n:'ALTA'});
      if(semComissao)cards.push({t:'Comissão pendente',d:`${semComissao.toLocaleString('pt-BR')} anúncio(s) sem comissão sincronizada`,n:'MÉDIA'});
    }

    cards.push(
      ...claims.slice(0,4).map(x=>({
        t:`Reclamação #${x.id}`,
        d:`${rotuloSituacaoV64(x.stage,'reclamacao')} · ${rotuloSituacaoV64(x.status,'reclamacao')}`,
        n:'ALTA'
      })),
      ...alertas.slice(0,4).map(x=>({
        t:x.titulo||x.item_id,
        d:x.mensagem,
        n:String(x.nivel||'').toUpperCase()
      }))
    );

    const aud=audit.status==='fulfilled'?(audit.value.itens||[]):[];
    if(aud.length){
      cards.push({
        t:'Auditoria ativa',
        d:`Última ação: ${aud[0].method} ${aud[0].path} · HTTP ${aud[0].status}`,
        n:'LOG'
      });
    }

    fila.innerHTML=cards.slice(0,12).map(x=>`
      <div class="panel rounded-2xl p-4">
        <div class="flex justify-between gap-3">
          <div>
            <div class="text-xs font-black text-white">${escapeHtml(x.t)}</div>
            <div class="text-[11px] text-slate-500 mt-1">${escapeHtml(x.d)}</div>
          </div>
          <span class="text-[10px] font-black text-yellow-400">${escapeHtml(x.n)}</span>
        </div>
      </div>
    `).join('')||'<div class="panel rounded-2xl p-8 text-xs text-emerald-400">Nenhuma prioridade crítica encontrada.</div>';
  }catch(e){
    fila.innerHTML=`<div class="panel rounded-2xl p-6 text-xs text-red-300">${escapeHtml(e.message)}</div>`;
  }
}
function atalhoIA(t){document.getElementById('ia-pergunta').value=t; perguntarIA();}
async function perguntarIA(){
  const inp=document.getElementById('ia-pergunta'),chat=document.getElementById('ia-chat'),texto=inp.value.trim(); if(!texto)return;
  chat.innerHTML+=`<div class="ml-auto max-w-[85%] p-4 rounded-xl bg-yellow-400 text-slate-950 text-xs font-semibold">${escapeHtml(texto)}</div>`; inp.value='';
  const load=document.createElement('div');load.className='max-w-[85%] p-4 rounded-xl bg-slate-950 text-xs text-slate-400';load.innerText='Analisando...';chat.appendChild(load);chat.scrollTop=chat.scrollHeight;
  try{const d=await apiPro('/api/v3/ia',{method:'POST',body:JSON.stringify({mensagem:texto})});load.className='max-w-[90%] p-4 rounded-xl bg-slate-950 text-xs text-slate-300 whitespace-pre-wrap';load.innerText=d.resposta||'Sem resposta.';}catch(e){load.className='p-4 rounded-xl bg-red-500/10 text-xs text-red-300';load.innerText=e.message;}
  chat.scrollTop=chat.scrollHeight;
}
async function carregarReclamacoesProAntiga(){
  const box=document.getElementById('claims-lista');box.innerHTML='<div class="panel rounded-2xl p-8 text-xs text-yellow-400">Buscando reclama\u00e7\u00f5es...</div>';
  try{const d=await apiPro('/api/v3/claims?status=opened');const arr=d.reclamacoes||[];document.getElementById('claims-abertas').innerText=arr.length;document.getElementById('claims-disputas').innerText=arr.filter(x=>x.stage==='dispute').length;document.getElementById('claims-prazo').innerText=arr.filter(x=>x.due_date).length;
  box.innerHTML=arr.map(x=>`<div class="panel rounded-2xl p-4"><div class="flex justify-between gap-4"><div><div class="text-xs font-black text-white">Reclama\u00e7\u00e3o #${escapeHtml(String(x.id))}</div><div class="text-[11px] text-slate-500 mt-1">Pedido/recurso: ${escapeHtml(String(x.resource_id||'\u2014'))} \u00b7 ${escapeHtml(rotuloSituacaoV64(x.stage,'reclamacao'))} \u00b7 ${escapeHtml(rotuloSituacaoV64(x.type,'reclamacao'))}</div></div><button onclick="verImpactoClaim('${String(x.id)}')" class="bg-slate-800 px-3 py-2 rounded-lg text-[10px] font-bold text-white">Impacto reputa\u00e7\u00e3o</button></div><div id="impacto-${String(x.id)}" class="text-[10px] text-slate-500 mt-2"></div></div>`).join('')||'<div class="panel rounded-2xl p-8 text-xs text-emerald-400">Nenhuma reclama\u00e7\u00e3o aberta encontrada.</div>';}catch(e){box.innerHTML=`<div class="panel rounded-2xl p-8 text-xs text-red-300">${escapeHtml(e.message)}</div>`}
}
async function verImpactoClaim(id){const el=document.getElementById(`impacto-${id}`);el.innerText='Consultando...';try{const d=await apiPro(`/api/v3/claims/${encodeURIComponent(id)}/impacto`);el.innerText=`Impacto: ${d.affects_reputation||'\u2014'}${d.due_date?' \u00b7 Prazo: '+d.due_date:''}`;}catch(e){el.innerText=e.message}}
async function consultarCasoBPP(){const id=document.getElementById('bpp-case-id').value.trim(),out=document.getElementById('bpp-resultado');if(!id)return;out.classList.remove('hidden');out.innerText='Consultando...';try{out.innerText=JSON.stringify(await apiPro(`/api/v3/bpp/case/${encodeURIComponent(id)}`),null,2)}catch(e){out.innerText=e.message}}
async function carregarIntegracoesPro(){try{const d=await fetch(`${RENDER_URL}/api/v3/integracoes/status?_=${Date.now()}`,{cache:'no-store'}).then(r=>r.json());document.getElementById('bling-status').innerText=d.bling?.conectado?'\u25cf Conectado':d.bling?.configurado?'\u25cf Pronto para conectar':'\u25cb Falta configurar Render';const ok=!!d.gemini?.configurado;const gs=document.getElementById('gemini-status');if(gs)gs.innerText=ok?`\u25cf Gemini configurado (${d.gemini?.modelo||'modelo padr\u00e3o'})`:'\u25cb Adicione GEMINI_API_KEY no Render';const ia=document.getElementById('ia-status');if(ia)ia.innerText=ok?'IA dispon\u00edvel via Google Gemini.':'Para ativar IA, configure GEMINI_API_KEY no Render.';}catch(e){}}
async function conectarBling(){try{const d=await fetch(`${RENDER_URL}/api/bling/authorize`).then(r=>r.json());if(!d.authorization_url)throw new Error(d.erro||'Bling n\u00e3o configurado.');location.href=d.authorization_url;}catch(e){alert(e.message)}}
async function carregarOportunidades(){const box=document.getElementById('op-lista');box.innerHTML='<div class="panel rounded-2xl p-6 text-xs text-yellow-400">Auditando amostra recente...</div>';try{const d=await apiPro('/api/v3/auditoria');document.getElementById('op-sem-venda').innerText=d.metricas.sem_venda;document.getElementById('op-sem-sku').innerText=d.metricas.sem_sku;document.getElementById('op-estoque').innerText=d.metricas.estoque_critico;document.getElementById('op-score').innerText=d.metricas.score+'%';box.innerHTML=(d.oportunidades||[]).map(x=>`<div class="panel rounded-2xl p-4"><div class="text-xs font-black text-white">${escapeHtml(x.titulo)}</div><div class="text-[11px] text-slate-500 mt-1">${escapeHtml(x.mensagem)}</div></div>`).join('')||'<div class="panel rounded-2xl p-6 text-xs text-emerald-400">Nenhuma oportunidade cr\u00edtica na amostra.</div>';}catch(e){box.innerHTML=`<div class="panel rounded-2xl p-6 text-xs text-red-300">${escapeHtml(e.message)}</div>`}}
document.addEventListener('DOMContentLoaded',carregarIntegracoesPro);
