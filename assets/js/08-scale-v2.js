
let v2PaginaAtual = 1;
let v2Paginas = 1;
let v2Selecionados = new Set();

function atualizarContadorSelecionadosV2() {
    const el = document.getElementById('v2-selecionados');
    if (el) el.innerText = v2Selecionados.size.toLocaleString('pt-BR');
}
function selecionarPaginaV2(marcado) {
    document.querySelectorAll('.v2-check-item').forEach(c => {
        c.checked = marcado;
        if (marcado) v2Selecionados.add(c.value); else v2Selecionados.delete(c.value);
    });
    atualizarContadorSelecionadosV2();
}
function alternarSelecionadoV2(id, marcado) {
    if (marcado) v2Selecionados.add(id); else v2Selecionados.delete(id);
    atualizarContadorSelecionadosV2();
}
async function carregarOperacaoV2(pagina=1) {
    const token = obterToken();
    if (!token) return solicitarToken();
    const tabela = document.getElementById('v2-tabela');
    if (tabela) tabela.innerHTML = '<tr><td colspan="7" class="p-10 text-center text-xs text-yellow-400">Carregando an\u00fancios...</td></tr>';
    const q = document.getElementById('v2-busca')?.value.trim() || '';
    const status = document.getElementById('v2-status')?.value || '';
    const order = document.getElementById('v2-order')?.value || 'last_updated_desc';
    try {
        const params = new URLSearchParams({page:String(pagina),limit:'50',q,status,order});
        const r = await fetch(`${RENDER_URL}/api/v2/anuncios?${params}`, {headers:{Authorization:token}});
        const d = await r.json();
        if (!r.ok || !d.sucesso) throw new Error(d.erro || 'Falha ao carregar an\u00fancios.');
        v2PaginaAtual=d.pagina; v2Paginas=d.paginas;
        document.getElementById('v2-total').innerText=Number(d.total||0).toLocaleString('pt-BR');
        document.getElementById('v2-pagina').innerText=`${d.pagina}/${d.paginas}`;
        document.getElementById('v2-paginacao').innerText=`P\u00e1gina ${d.pagina} de ${d.paginas} \u00b7 ${Number(d.total||0).toLocaleString('pt-BR')} an\u00fancios`;
        tabela.innerHTML = (d.itens||[]).map(i=>`<tr class="hover:bg-slate-900/50">
            <td class="p-3"><input class="v2-check-item" type="checkbox" value="${escapeHtml(i.id)}" ${v2Selecionados.has(i.id)?'checked':''} onchange="alternarSelecionadoV2(this.value,this.checked)"></td>
            <td class="p-3"><div class="flex items-center gap-3"><img src="${escapeHtml(i.thumbnail||'')}" class="w-10 h-10 rounded-lg object-cover"><div><div class="text-xs font-bold text-white max-w-md truncate">${escapeHtml(i.titulo)}</div><div class="text-[10px] text-slate-500">${escapeHtml(i.id)}</div></div></div></td>
            <td class="p-3 text-xs text-slate-300">${escapeHtml(i.sku||'\u2014')}</td>
            <td class="p-3 text-xs font-bold text-white">${moeda(i.preco)}</td>
            <td class="p-3 text-xs text-white">${Number(i.estoque||0).toLocaleString('pt-BR')}</td>
            <td class="p-3 text-xs font-bold text-emerald-400">${Number(i.vendidos||0).toLocaleString('pt-BR')}</td>
            <td class="p-3 text-xs text-slate-300">${escapeHtml(rotuloSituacaoV64(i.status))}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="p-10 text-center text-xs text-slate-600">Nenhum an\u00fancio encontrado.</td></tr>';
        atualizarContadorSelecionadosV2();
    } catch(e) {
        tabela.innerHTML=`<tr><td colspan="7" class="p-10 text-center text-xs text-red-300">${escapeHtml(e.message)}</td></tr>`;
    }
}
async function acaoMassaV2(acao) {
    if (!v2Selecionados.size) return alert('Selecione ao menos um an\u00fancio.');
    if (v2Selecionados.size > 500) return alert('Fa\u00e7a a opera\u00e7\u00e3o em lotes de at\u00e9 500 an\u00fancios.');
    let valor=null;
    if (acao==='estoque') valor=document.getElementById('v2-estoque-massa')?.value;
    if (acao==='preco_percentual') valor=document.getElementById('v2-percentual')?.value;
    if (!confirm(`Aplicar "${acao}" em ${v2Selecionados.size} an\u00fancio(s)?`)) return;
    const status=document.getElementById('v2-massa-status');
    if(status) status.innerText='Processando lote...';
    try {
        const r=await fetch(`${RENDER_URL}/api/v2/anuncios/massa`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:obterToken()},body:JSON.stringify({ids:[...v2Selecionados],acao,valor})});
        const d=await r.json();
        if(!r.ok||!d.sucesso) throw new Error(d.erro||'Erro na opera\u00e7\u00e3o.');
        if(status) status.innerText=`Conclu\u00eddo: ${d.concluidos} sucesso(s), ${d.erros} erro(s).`;
        v2Selecionados.clear(); atualizarContadorSelecionadosV2(); carregarOperacaoV2(v2PaginaAtual);
    } catch(e) { if(status) status.innerText='Erro: '+e.message; }
}
async function carregarAlertasV2() {
    const token=obterToken(); if(!token)return solicitarToken();
    const lista=document.getElementById('v2-alertas-lista');
    lista.innerHTML='<div class="panel rounded-2xl p-10 text-center text-xs text-yellow-400">Analisando...</div>';
    try {
        const r=await fetch(`${RENDER_URL}/api/v2/alertas`,{headers:{Authorization:token}});
        const d=await r.json(); if(!r.ok||!d.sucesso)throw new Error(d.erro||'Falha ao gerar alertas.');
        document.getElementById('v2-alertas-total').innerText=Number(d.alertas?.length||0).toLocaleString('pt-BR');
        document.getElementById('v2-alertas-analisados').innerText=Number(d.analisados||0).toLocaleString('pt-BR');
        document.getElementById('v2-alertas-conta').innerText=Number(d.total_conta||0).toLocaleString('pt-BR');
        lista.innerHTML=(d.alertas||[]).map(a=>`<div class="panel rounded-2xl p-4 flex items-center justify-between gap-4"><div><div class="text-xs font-black text-white">${escapeHtml(a.titulo||a.item_id)}</div><div class="text-[11px] text-slate-500 mt-1">${escapeHtml(a.mensagem)}</div></div><div class="text-[10px] uppercase font-black ${a.nivel==='alto'?'text-red-400':a.nivel==='medio'?'text-yellow-400':'text-blue-400'}">${escapeHtml(a.nivel)}</div></div>`).join('') || '<div class="panel rounded-2xl p-10 text-center text-xs text-emerald-400">Nenhum alerta encontrado na amostra analisada.</div>';
    } catch(e){lista.innerHTML=`<div class="panel rounded-2xl p-10 text-center text-xs text-red-300">${escapeHtml(e.message)}</div>`;}
}
