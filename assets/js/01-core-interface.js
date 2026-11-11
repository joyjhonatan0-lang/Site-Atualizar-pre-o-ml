

/* =========================================================
   CONFIGURA\u00c7\u00c3O
========================================================= */

const RENDER_URL =
    "https://site-atualizar-pre-o-ml.onrender.com";

// V94: todas as chamadas ao backend carregam a sessão HttpOnly.
// Nenhuma senha, Client Secret ou Access Token precisa ficar no JavaScript.
const mlHubNativeFetchV94=window.fetch.bind(window);
window.fetch=function(input,init={}){
    try{
        const url=typeof input==='string' ? input : String(input?.url||'');
        if(url.startsWith(RENDER_URL)){
            return mlHubNativeFetchV94(input,{...init,credentials:'include'});
        }
    }catch(e){}
    return mlHubNativeFetchV94(input,init);
};


let cacheItens = [];

const ML_HUB_CACHE_KEY = 'mlHubPro_cacheItens_v1';

function salvarCacheItensLocal() {
    try {
        localStorage.setItem(ML_HUB_CACHE_KEY, JSON.stringify(cacheItens || []));
    } catch (erro) {
        console.warn('N\u00e3o foi poss\u00edvel salvar os an\u00fancios localmente:', erro);
    }
}

function carregarCacheItensLocal() {
    try {
        const bruto = localStorage.getItem(ML_HUB_CACHE_KEY);
        if (!bruto) return false;

        const dados = JSON.parse(bruto);
        if (!Array.isArray(dados) || !dados.length) return false;

        cacheItens = dados;
        return true;
    } catch (erro) {
        console.warn('N\u00e3o foi poss\u00edvel recuperar os an\u00fancios salvos:', erro);
        return false;
    }
}


let novosPrecosCalculados = {};

let abaAtualAtiva =
    'inicio';

let dashboardCache =
    null;


/* =========================================================
   UTILIT\u00c1RIOS
========================================================= */

function escapeHtml(value) {

    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}


function moeda(valor) {

    return Number(
        valor || 0
    ).toLocaleString(
        'pt-BR',
        {
            style:
                'currency',
            currency:
                'BRL'
        }
    );
}


function mostrarLoading(texto) {

    document.getElementById(
        'loading-text'
    ).innerText =
        texto;

    document.getElementById(
        'loading'
    ).classList.remove(
        'hidden'
    );

    document.getElementById(
        'loading'
    ).classList.add(
        'flex'
    );
}


function esconderLoading() {

    document.getElementById(
        'loading'
    ).classList.add(
        'hidden'
    );

    document.getElementById(
        'loading'
    ).classList.remove(
        'flex'
    );
}


function obterToken() {
    // V94: o browser nunca precisa conhecer o Access Token.
    return localStorage.getItem('ml_oauth_connected')==='1' ? 'AUTO' : '';
}


/* =========================================================
   TOKEN
========================================================= */

function solicitarToken() {
    const gate=document.getElementById('oauth-login-gate');
    if(gate)gate.classList.remove('hidden');

    consultarSessaoAppV94().then(sessao=>{
        if(sessao.configured && !sessao.authenticated)mostrarEtapaLoginV94();
        else mostrarEtapaMercadoLivreV94(sessao);
    }).catch(()=>mostrarEtapaLoginV94());
}


function salvarTokenManual() {
    alert('Por segurança, o Access Token não é mais salvo no navegador. Use Conectar Mercado Livre.');
    solicitarToken();
}


function salvarTokenHome() {
    alert('Por segurança, o Access Token não é mais salvo no navegador. Use Conectar Mercado Livre.');
    solicitarToken();
}


function atualizarStatusTokenHome() {

    const status =
        document.getElementById(
            'status-token-home'
        );

    if (!status) {
        return;
    }

    const token =
        obterToken();

    if (token) {

        status.innerHTML =
            `
            <span class="text-emerald-400 font-bold">
                \u25cf Token configurado
            </span>
            <span class="text-slate-600 ml-2">
                Pronto para conectar ao Mercado Livre.
            </span>
            `;

    } else {

        status.innerHTML =
            `
            <span class="text-yellow-400 font-bold">
                \u25cf Token ainda n\u00e3o configurado
            </span>
            `;
    }
}


/* =========================================================
   NAVEGA\u00c7\u00c3O
========================================================= */

function mudarAba(aba) {
    document.body.classList.toggle('pagina-inicial-ativa', String(aba) === 'inicio');
    document.body.classList.toggle('painel-interno-ativo', String(aba) !== 'inicio');

    try {
        localStorage.setItem('mlHubPro_abaAtual_v1', String(aba));
    } catch (erro) {
        console.warn('N\u00e3o foi poss\u00edvel salvar a aba atual:', erro);
    }


    abaAtualAtiva =
        aba;

    const secoes = [
        'inicio',
        'gestao',
        'dashboard',
        'operacao',
        'alertas',
        'central',
        'inteligencia-anuncios',
        'atendimento',
        'pedidos',
        'reclamacoes',
        'criar-massa',
        'agentes-produto',
        'anuncios-restritos',
        'promocoes',
        'integracoes',
        'oportunidades',
        'qualidade',
        'catalogo',
        'perfil',
        'configuracoes',
        'simulacao',
        'sku-base',
        'atualizacao',
        'perguntas'
    ];

    secoes.forEach(
        nome => {

            const secao =
                document.getElementById(
                    `secao-${nome}`
                );

            if (secao) {
                secao.classList.add(
                    'hidden'
                );
            }

            const botao =
                document.getElementById(
                    `btn-${nome}`
                );

            if (botao) {

                botao.classList.remove(
                    'active'
                );

                botao.classList.remove(
                    'font-bold'
                );

                botao.classList.add(
                    'font-semibold'
                );

            }

        }
    );

    const secaoAtiva =
        document.getElementById(
            `secao-${aba}`
        );

    if (secaoAtiva) {

        secaoAtiva.classList.remove(
            'hidden'
        );
    }
    // Carregamento autom\u00e1tico dos m\u00f3dulos profissionais.
    if (aba === 'central' && typeof carregarCentralPro === 'function') carregarCentralPro();
    if (aba === 'reclamacoes' && typeof carregarReclamacoesPro === 'function') carregarReclamacoesPro();
    if (aba === 'criar-massa' && typeof carregarCriacaoMassaV36 === 'function') carregarCriacaoMassaV36();
    if (aba === 'agentes-produto' && typeof carregarAgentesProdutoV62 === 'function') carregarAgentesProdutoV62(false);
    if (aba === 'criar-massa' && typeof carregarAgentesProdutoV62 === 'function') {
        const lazy=()=>carregarAgentesProdutoV62(false).catch?.(()=>{});
        if('requestIdleCallback' in window)requestIdleCallback(lazy,{timeout:1800});else setTimeout(lazy,250);
    }
    if (aba === 'integracoes' && typeof carregarIntegracoesPro === 'function') carregarIntegracoesPro();
    if (aba === 'configuracoes' && typeof carregarSegurancaV94 === 'function') carregarSegurancaV94();
    if (aba === 'oportunidades' && typeof carregarOportunidades === 'function') carregarOportunidades();
    if (aba === 'operacao' && typeof carregarOperacaoV2 === 'function') carregarOperacaoV2(1);
    if (aba === 'alertas' && typeof carregarAlertasV2 === 'function') carregarAlertasV2();
    if (aba === 'inteligencia-anuncios' && typeof carregarInteligenciaV96 === 'function') carregarInteligenciaV96();


    const botaoAtivo =
        document.getElementById(
            `btn-${aba}`
        );

    if (botaoAtivo) {

        botaoAtivo.classList.add(
            'active'
        );

        botaoAtivo.classList.remove(
            'font-semibold'
        );

        botaoAtivo.classList.add(
            'font-bold'
        );
    }

    if (
        aba === 'dashboard' &&
        !dashboardCache
    ) {
        carregarDashboard();
    }

    if (
        aba === 'perguntas'
    ) {
        carregarPerguntas();
    }

    if (
        aba === 'gestao' ||
        aba === 'simulacao' ||
        aba === 'atualizacao'
    ) {
        executarBusca();
    }
}


/* =========================================================
   GEST\u00c3O - FUN\u00c7\u00d5ES ORIGINAIS
========================================================= */

function executarBusca() {

    const termo =
        document
            .getElementById(
                'input-busca'
            )
            ?.value
            .toLowerCase()
            .trim() ||
        '';

    let itensFiltrados =
        cacheItens;

    if (termo !== '') {

        itensFiltrados =
            cacheItens.filter(
                item =>
                    String(
                        item.id
                    )
                        .toLowerCase()
                        .includes(
                            termo
                        ) ||

                    String(
                        item.sku
                    )
                        .toLowerCase()
                        .includes(
                            termo
                        ) ||

                    String(
                        item.title
                    )
                        .toLowerCase()
                        .includes(
                            termo
                        )
            );
    }

    if (
        abaAtualAtiva ===
        'gestao'
    ) {

        montarTabelaGestao(
            itensFiltrados
        );

    } else if (
        abaAtualAtiva ===
        'simulacao'
    ) {

        montarTabelaSimulacao(
            itensFiltrados
        );

    } else if (
        abaAtualAtiva ===
        'atualizacao'
    ) {

        montarTabelaAtualizacao(
            itensFiltrados
        );
    }
}


function limparBusca() {

    const campo =
        document.getElementById(
            'input-busca'
        );

    if (campo) {
        campo.value = '';
    }

    executarBusca();
}


async function carregarDados() {

    const token =
        obterToken();

    if (!token) {

        solicitarToken();

        return;
    }

    mostrarLoading(
        'Buscando todos os seus an\u00fancios na API do Mercado Livre...'
    );

    try {

        const response =
            await fetch(
                `${RENDER_URL}/api/anuncios`,
                {
                    headers: {
                        Authorization:
                            token
                    }
                }
            );

        const data =
            await response.json();

        if (
            response.ok &&
            data.itens
        ) {

            cacheItens =
                data.itens;
        salvarCacheItensLocal();

            atualizarCards(
                cacheItens
            );

            executarBusca();

            mudarAba(
                'gestao'
            );

            alert(
                `Sucesso! ${cacheItens.length} an\u00fancios carregados.`
            );

        } else {

            alert(
                data.erro ||
                'Erro ao carregar an\u00fancios.'
            );

        }

    } catch (error) {

        alert(
            'Erro de comunica\u00e7\u00e3o com o servidor.'
        );

    } finally {

        esconderLoading();
    }
}


async function puxarNovosAnuncios() {
    const token=obterToken();
    if(!token){solicitarToken();return;}

    mostrarLoading('Buscando somente an\u00fancios novos no Mercado Livre...');
    try{
        const response=await fetch(`${RENDER_URL}/api/scale/sync-new`,{
            method:'POST',
            headers:{
                Authorization:token,
                'Content-Type':'application/json'
            },
            body:JSON.stringify({max_pages:10})
        });

        let data={};
        try{data=await response.json();}catch(e){}

        if(!response.ok){
            throw new Error(data.erro||`Servidor respondeu HTTP ${response.status}`);
        }

        // Recarrega somente a p\u00e1gina atual do PostgreSQL.
        if(typeof carregarGestaoEscala==='function'){
            await carregarGestaoEscala(1,{silencioso:true});
        }
        if(data.job?.id){
            mlScaleJobId=data.job.id;
            acompanharSync90k();
        }

        alert(data.mensagem||'Atualiza\u00e7\u00e3o conclu\u00edda.');
    }catch(error){
        console.error('Erro ao puxar an\u00fancios novos:',error);
        alert('N\u00e3o foi poss\u00edvel puxar os an\u00fancios novos: '+(error.message||'erro de comunica\u00e7\u00e3o com o servidor.'));
    }finally{
        esconderLoading();
    }
}


async function sincronizarPrecosApi() {

    const token =
        obterToken();

    if (!token) {

        solicitarToken();

        return;
    }

    if (
        !cacheItens ||
        cacheItens.length === 0
    ) {

        alert(
            "Nenhum an\u00fancio carregado."
        );

        return;
    }

    mostrarLoading(
        "Puxando pre\u00e7os atuais..."
    );

    try {

        const mlbs =
            cacheItens.map(
                item => item.id
            );

        const response =
            await fetch(
                `${RENDER_URL}/api/sincronizar-precos`,
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json',

                        Authorization:
                            token
                    },

                    body:
                        JSON.stringify({
                            ids:
                                mlbs
                        })
                }
            );

        const data =
            await response.json();

        if (
            response.ok &&
            data.precos
        ) {

            cacheItens.forEach(
                item => {

                    if (
                        data.precos[
                            item.id
                        ] !==
                        undefined
                    ) {

                        item.price =
                            data.precos[
                                item.id
                            ];

                        item.net_received =
                            Math.max(
                                0,
                                Number(item.price || 0) -
                                Number(item.sale_fee || 0) -
                                Number(item.shipping_cost || 0)
                            );
                    }

                }
            );

            // Salva os pre\u00e7os atualizados. Eles s\u00f3 mudam novamente
            // quando o usu\u00e1rio clicar em Puxar pre\u00e7os.
            salvarCacheItensLocal();

            atualizarCards(
                cacheItens
            );

            executarBusca();

            alert(
                'Pre\u00e7os sincronizados com sucesso.'
            );

        } else {

            alert(
                data.erro ||
                'Erro ao sincronizar pre\u00e7os.'
            );
        }

    } catch (error) {

        alert(
            'Erro de comunica\u00e7\u00e3o.'
        );

    } finally {

        esconderLoading();
    }
}


async function sincronizarFretesApi() {
    const token=obterToken();
    if(!token){solicitarToken();return;}

    mostrarLoading('Verificando fretes novos ou alterados...');
    try{
        const response=await fetch(`${RENDER_URL}/api/scale/fretes?_=${Date.now()}`,{
            method:'POST',
            cache:'no-store',
            headers:{'Content-Type':'application/json',Authorization:token},
            body:'{}'
        });
        const data=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(data.erro||`HTTP ${response.status}`);

        const jobId=data.job?.id;
        if(!jobId)throw new Error('Servidor n\u00e3o retornou o trabalho de fretes.');

        if(data.sem_pendencias||data.job?.status==='completed'){
            esconderLoading();
            await carregarGestaoEscala(gestaoPagina,{silencioso:true});
            alert(data.mensagem||'Todos os fretes j\u00e1 est\u00e3o atualizados.');
            return;
        }

        await acompanharFretes90k(jobId);
    }catch(error){
        esconderLoading();
        console.error('Erro ao sincronizar fretes:',error);
        alert('Erro ao sincronizar fretes: '+error.message);
    }
}

async function acompanharFretes90k(jobId){
    const token=obterToken();
    let atualJobId=jobId;
    let ultimoProgresso=-1;
    let ultimoAvanco=Date.now();
    let recuperacoes=0;
    const inicio=Date.now();

    mostrarLoading('Puxando custos de frete...');
    while(true){
        try{
            const r=await fetch(`${RENDER_URL}/api/scale/jobs/${atualJobId}?_=${Date.now()}`,{
                cache:'no-store',
                headers:{Authorization:token}
            });
            const d=await r.json().catch(()=>({}));
            if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

            const j=d.job||{};
            const atual=Number(j.progress_current||0);
            const total=Number(j.progress_total||0);
            const erros=Number(j.errors||0);
            const pct=total?Math.min(100,Math.round((atual/total)*100)):0;

            if(atual!==ultimoProgresso){
                ultimoProgresso=atual;
                ultimoAvanco=Date.now();
            }

            const texto=document.querySelector('#loading-overlay p, #loadingOverlay p, [id*="loading"] p');
            if(texto){
                texto.textContent=total
                  ? `Puxando custos de frete... ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} \u00b7 ${pct}%${erros?` \u00b7 ${erros} falha(s)`:''}`
                  : 'Preparando an\u00fancios que precisam de frete...';
            }

            if(j.status==='completed'){
                esconderLoading();
                await carregarGestaoEscala(gestaoPagina,{silencioso:true});
                alert(j.message||`Fretes conclu\u00eddos: ${atual.toLocaleString('pt-BR')} an\u00fancio(s).`);
                return;
            }

            if(j.status==='failed'){
                esconderLoading();
                alert('Erro ao sincronizar fretes: '+(j.message||'falha no processamento.'));
                return;
            }

            if(Date.now()-ultimoAvanco>120000 && recuperacoes<2){
                recuperacoes++;
                const rr=await fetch(`${RENDER_URL}/api/scale/fretes?_=${Date.now()}`,{
                    method:'POST',
                    cache:'no-store',
                    headers:{'Content-Type':'application/json',Authorization:token},
                    body:'{}'
                });
                const rd=await rr.json().catch(()=>({}));
                if(rr.ok&&rd.job?.id){
                    atualJobId=rd.job.id;
                    ultimoAvanco=Date.now();
                    if(texto)texto.textContent='Retomando sincroniza\u00e7\u00e3o de fretes automaticamente...';
                }
            }

            if(Date.now()-inicio>30*60*1000){
                esconderLoading();
                alert('A sincroniza\u00e7\u00e3o continua em segundo plano, mas demorou mais de 30 minutos. Voc\u00ea pode fechar esta mensagem e voltar depois; os dados j\u00e1 conclu\u00eddos ficam salvos.');
                return;
            }

            await new Promise(resolve=>setTimeout(resolve,1500));
        }catch(e){
            esconderLoading();
            alert('Erro ao acompanhar fretes: '+e.message);
            return;
        }
    }
}

function atualizarCards(
    itens
) {

    const ativos =
        itens.filter(
            item =>
                item.status ===
                'active'
        ).length;

    document.getElementById(
        'total-listado'
    ).innerText =
        itens.length;

    document.getElementById(
        'total-ativos'
    ).innerText =
        ativos;

    document.getElementById(
        'total-outros'
    ).innerText =
        itens.length -
        ativos;
}


function montarTabelaGestao(
    itens
) {

    const tbody =
        document.getElementById(
            'tabela-gestao'
        );

    if (!tbody) {
        return;
    }

    tbody.innerHTML = '';

    itens.forEach(
        item => {

            const index =
                cacheItens.findIndex(
                    i => i.id === item.id
                );

            const tr =
                document.createElement(
                    'tr'
                );

            tr.innerHTML =
                `
                <td class="p-4">
                    <div class="flex items-center gap-3 min-w-[360px]">

                        <img
                            src="${escapeHtml(item.thumbnail)}"
                            class="w-11 h-11 object-cover rounded-xl border border-slate-700 bg-slate-800 shrink-0"
                        >

                        <div class="min-w-0 flex-1 space-y-2">

                            <div class="relative">
                                <input
                                    id="titulo_gestao_${index}"
                                    type="text"
                                    value="${escapeHtml(tituloSomenteV76(item.title))}"
                                    maxlength="60"
                                    oninput="atualizarContadorTituloGestao(${index})"
                                    class="w-full bg-slate-950 border border-slate-700 text-white text-xs px-3 py-2 pr-14 rounded-lg outline-none focus:border-yellow-400/60"
                                    title="Editar t\u00edtulo do an\u00fancio - limite de 60 caracteres"
                                >
                                <span
                                    id="contador_titulo_gestao_${index}"
                                    class="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold ${tituloSomenteV76(item.title).length > 60 ? 'text-red-500' : 'text-slate-500'}"
                                >
                                    ${tituloSomenteV76(item.title).length}/60
                                </span>
                            </div>

                            <div class="flex items-center gap-2">
                                <span class="text-[10px] text-slate-500 shrink-0">
                                    ${escapeHtml(item.id)}
                                </span>

                                <span class="text-[10px] text-slate-600">\u2022</span>

                                <span class="text-[10px] text-slate-500 shrink-0">SKU:</span>

                                <input
                                    id="sku_gestao_${index}"
                                    type="text"
                                    value="${escapeHtml(item.sku === 'Sem SKU' ? '' : item.sku)}"
                                    class="min-w-[120px] flex-1 bg-slate-950 border border-slate-700 text-slate-300 text-[10px] px-2.5 py-1.5 rounded-lg outline-none focus:border-yellow-400/60"
                                    placeholder="Sem SKU"
                                    title="Editar SKU do an\u00fancio"
                                >
                            </div>

                        </div>

                    </div>
                </td>

                <td class="p-4 min-w-[120px]">
                    <div class="flex items-center gap-2">
                        <img src="${escapeHtml(item.thumbnail||'')}" class="w-10 h-10 object-cover rounded-lg border border-slate-700 bg-white">
                        <div>
                            <div class="text-[10px] font-black ${item.content_audited_at?(Number(item.picture_count||0)>=4?'text-emerald-400':'text-yellow-400'):'text-slate-500'}">
                                ${item.content_audited_at?`${Number(item.picture_count||0)} foto(s)`:'Não auditado'}
                            </div>
                            <button onclick="abrirEditorConteudoV96(${index},'fotos')" class="text-[9px] text-blue-400 font-bold mt-1">Editar fotos</button>
                        </div>
                    </div>
                </td>

                <td class="p-4 min-w-[130px]">
                    <div class="text-[10px] font-black ${item.content_audited_at?(item.description_exists?'text-emerald-400':'text-red-300'):'text-slate-500'}">
                        ${item.content_audited_at?(item.description_exists?'Descrição OK':'Descrição faltando'):'Não auditado'}
                    </div>
                    <button onclick="abrirEditorConteudoV96(${index},'descricao')" class="text-[9px] text-blue-400 font-bold mt-1">Editar descrição</button>
                </td>

                <td class="p-4 min-w-[170px]">
                    <div class="text-[10px] font-black ${item.content_audited_at?(Number(item.missing_main?.length||0)===0?'text-emerald-400':'text-red-300'):'text-slate-500'}">
                        ${item.content_audited_at?`Principais: ${Number(item.missing_main?.length||0)} faltando`:'Não auditado'}
                    </div>
                    <div class="text-[9px] text-slate-500 mt-1">${item.content_audited_at?`Secundárias: ${Number(item.missing_secondary?.length||0)} faltando · score ${Number(item.content_score||0)}%`:'Verificar ficha técnica'}</div>
                    <button onclick="abrirEditorConteudoV96(${index},'caracteristicas')" class="text-[9px] text-blue-400 font-bold mt-1">Editar características</button>
                </td>

                <td class="p-4 min-w-[125px]">
                    <div id="quality_${safeIdV21(item.id)}">
                      ${qualidadeHtmlV101(item)}
                    </div>
                </td>

                <td class="p-4">
                    <span class="font-black text-white">
                        ${moeda(item.price)}
                    </span>
                </td>

                <td class="p-4 text-slate-400">
                    Comiss\u00e3o:
                    <span class="text-slate-300">
                        ${moeda(item.sale_fee)}
                    </span>
                    ${Number(item.commission_percentage||0)>0
                      ? `<span class="text-[9px] text-blue-400 font-bold"> (${Number(item.commission_percentage).toFixed(2)}%)</span>`
                      : ''}

                    <br>

                    Frete:
                    <span class="text-slate-300">
                        ${moeda(item.shipping_cost)}
                    </span>
                </td>

                <td class="p-4">
                    <span class="font-black text-emerald-400">
                        ${moeda(item.net_received)}
                    </span>
                </td>

                <td class="p-4">
                    <div class="flex items-center gap-1.5 min-w-[90px]">
                        <input
                            id="estoque_gestao_${index}"
                            type="number"
                            min="0"
                            step="1"
                            value="${Number(item.available_quantity || 0)}"
                            class="w-20 bg-slate-950 border border-slate-700 text-white text-xs px-2.5 py-2 rounded-lg outline-none focus:border-yellow-400/60"
                            title="Editar quantidade dispon\u00edvel no Mercado Livre"
                        >
                        <span class="text-slate-600">un.</span>
                    </div>
                </td>

                <td class="p-4">
                    <span class="font-black text-white">
                        ${Number(item.sold_quantity || 0)}
                    </span>
                    <span class="text-slate-600">
                        un.
                    </span>
                </td>

                <td class="p-4">

                    <div class="flex items-center gap-2">

                        <span
                            class="status-dot ${item.status === 'active' ? 'bg-emerald-400' : 'bg-slate-500'}"
                        ></span>

                        <span
                            class="text-[11px] font-bold ${item.status === 'active' ? 'text-emerald-400' : 'text-slate-400'}"
                            title="Situa\u00e7\u00e3o retornada pela API do Mercado Livre"
                        >
                            ${escapeHtml(rotuloSituacaoV64(item.status))}
                        </span>

                    </div>

                </td>

                <td class="p-4">
                    <div class="flex flex-col gap-2 min-w-[105px]">

                        <button
                            type="button"
                            onclick="salvarEdicaoAnuncio(${index})"
                            class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-slate-950 text-[10px] font-black"
                        >
                            Salvar
                        </button>

                        ${(item.status === 'active' || item.status === 'paused') ? `
                        <button
                            type="button"
                            onclick="alternarStatusAnuncio(${index})"
                            class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg ${item.status === 'active' ? 'bg-amber-600 hover:bg-amber-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'} text-[10px] font-black"
                        >
                            ${item.status === 'active' ? 'Pausar' : 'Ativar'}
                        </button>
                        ` : ''}

                        <a
                            href="${escapeHtml(item.permalink)}"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-400 text-[10px] font-bold"
                        >
                            Ver an\u00fancio \u2197
                        </a>

                    </div>
                </td>
                `;

            tbody.appendChild(
                tr
            );
        }
    );
}


function atualizarContadorTituloGestao(index) {
    const input = document.getElementById(`titulo_gestao_${index}`);
    const contador = document.getElementById(`contador_titulo_gestao_${index}`);

    if (!input || !contador) return;

    const quantidade = input.value.length;
    contador.textContent = `${quantidade}/60`;

    const ultrapassou = quantidade > 60;
    input.classList.toggle('text-red-500', ultrapassou);
    input.classList.toggle('border-red-500', ultrapassou);
    input.classList.toggle('text-white', !ultrapassou);
    contador.classList.toggle('text-red-500', ultrapassou);
    contador.classList.toggle('text-slate-500', !ultrapassou);
}


async function salvarEdicaoAnuncio(index) {
    const token = obterToken();

    if (!token) {
        solicitarToken();
        return;
    }

    const item = cacheItens[index];

    if (!item) {
        alert('An\u00fancio n\u00e3o encontrado no painel.');
        return;
    }

    const inputTitulo = document.getElementById(`titulo_gestao_${index}`);
    const inputSku = document.getElementById(`sku_gestao_${index}`);
    const inputEstoque = document.getElementById(`estoque_gestao_${index}`);

    const title = inputTitulo?.value.trim() || '';
    const sku = inputSku?.value.trim() || '';
    const available_quantity = Number(inputEstoque?.value);

    if (!Number.isInteger(available_quantity) || available_quantity < 0) {
        alert('Informe uma quantidade de estoque v\u00e1lida, usando um n\u00famero inteiro igual ou maior que zero.');
        inputEstoque?.focus();
        return;
    }

    if (!title) {
        alert('O t\u00edtulo do an\u00fancio n\u00e3o pode ficar vazio.');
        inputTitulo?.focus();
        return;
    }

    if (title.length > 60) {
        atualizarContadorTituloGestao(index);
        alert(`O t\u00edtulo est\u00e1 com ${title.length} caracteres. O limite \u00e9 60 caracteres.`);
        inputTitulo?.focus();
        return;
    }

    mostrarLoading('Salvando t\u00edtulo e SKU no Mercado Livre...');

    try {
        const response = await fetch(`${RENDER_URL}/api/atualizar-anuncio`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: token
            },
            body: JSON.stringify({
                id: item.id,
                title,
                sku,
                available_quantity
            })
        });

        const data = await response.json();

        if (!response.ok || !data.sucesso) {
            // Se o SKU foi salvo, mas o t\u00edtulo n\u00e3o p\u00f4de ser alterado (por
            // exemplo, an\u00fancio que j\u00e1 possui vendas), atualiza o painel com
            // o resultado parcial real antes de mostrar a mensagem da API.
            if (data.parcial && data.item) {
                item.title = data.item.title ?? item.title;
                item.sku = data.item.sku ?? item.sku;
                if (data.item.status !== undefined) item.status = data.item.status;
                if (data.item.sold_quantity !== undefined) item.sold_quantity = Number(data.item.sold_quantity || 0);
                if (data.item.available_quantity !== undefined) item.available_quantity = Number(data.item.available_quantity || 0);
                executarBusca();
                atualizarCards(cacheItens);
            }
            alert(data.erro || 'Erro ao atualizar o an\u00fancio.');
            return;
        }

        item.title = data.item?.title ?? title;
        item.sku = data.item?.sku ?? (sku || 'Sem SKU');

        if (data.item?.status !== undefined) {
            item.status = data.item.status;
        }

        if (data.item?.sold_quantity !== undefined) {
            item.sold_quantity = Number(data.item.sold_quantity || 0);
        }

        if (data.item?.available_quantity !== undefined) {
            item.available_quantity = Number(data.item.available_quantity || 0);
        }

        salvarCacheItensLocal();
        executarBusca();
        atualizarCards(cacheItens);
        alert('An\u00fancio atualizado com sucesso.');

    } catch (error) {
        console.error(error);
        alert('Erro de comunica\u00e7\u00e3o ao atualizar o an\u00fancio.');
    } finally {
        esconderLoading();
    }
}


async function alternarStatusAnuncio(index) {
    const token = obterToken();
    if (!token) { solicitarToken(); return; }

    const item = cacheItens[index];
    if (!item) { alert('An\u00fancio n\u00e3o encontrado no painel.'); return; }

    const novoStatus = item.status === 'active' ? 'paused' : 'active';
    const acao = novoStatus === 'paused' ? 'pausar' : 'ativar';

    mostrarLoading(`${novoStatus === 'paused' ? 'Pausando' : 'Ativando'} an\u00fancio no Mercado Livre...`);
    try {
        const response = await fetch(`${RENDER_URL}/api/alterar-status-anuncio`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: token },
            body: JSON.stringify({ id: item.id, status: novoStatus })
        });
        const data = await response.json();
        if (!response.ok || !data.sucesso) {
            alert(data.erro || `N\u00e3o foi poss\u00edvel ${acao} o an\u00fancio.`);
            return;
        }
        item.status = data.item?.status || novoStatus;
        if (data.item?.available_quantity !== undefined) {
            item.available_quantity = Number(data.item.available_quantity || 0);
        }
        salvarCacheItensLocal();
        executarBusca();
        atualizarCards(cacheItens);
        alert(`An\u00fancio ${item.status === 'active' ? 'ativado' : 'pausado'} com sucesso.`);
    } catch (error) {
        console.error(error);
        alert(`Erro de comunica\u00e7\u00e3o ao ${acao} o an\u00fancio.`);
    } finally {
        esconderLoading();
    }
}


/* =========================================================
   SIMULA\u00c7\u00c3O ORIGINAL
========================================================= */

function montarTabelaSimulacao(
    itens
) {

    const tbody =
        document.getElementById(
            'tabela-simulacao'
        );

    if (!tbody) {
        return;
    }

    tbody.innerHTML = '';

    itens.forEach(
        item => {

            const index =
                cacheItens.findIndex(
                    i =>
                        i.id ===
                        item.id
                );

            const tipoNome =
                item.listing_type_id ===
                'gold_pro'
                    ? 'Premium'
                    : 'Cl\u00e1ssico';

            const comissaoPadrao =
                item.listing_type_id ===
                'gold_pro'
                    ? 17
                    : 12;

            const tr =
                document.createElement(
                    'tr'
                );

            tr.innerHTML =
                `
                <td class="p-3 font-mono">
                    ${escapeHtml(item.id)}
                </td>

                <td class="p-3 font-mono">
                    ${escapeHtml(item.sku)}
                </td>

                <td class="p-3 max-w-[220px] truncate">
                    ${escapeHtml(item.title)}
                </td>

                <td class="p-3 font-bold">
                    ${moeda(item.price)}
                </td>

                <td class="p-3">
                    ${moeda(item.shipping_cost)}
                </td>

                <td class="p-3 font-black text-blue-700 bg-blue-50">
                    R$ 78,90
                </td>

                <td class="p-3">
                    ${tipoNome}
                </td>

                <td class="p-3 bg-yellow-50/60">

                    <input
                        type="number"
                        step="0.1"
                        id="taxa_${index}"
                        value="${comissaoPadrao}"
                        oninput="
                            recalcular(
                                ${index},
                                ${item.shipping_cost},
                                ${item.free_shipping}
                            )
                        "
                        class="input-simulacao w-16"
                    >

                </td>

                <td class="p-3 bg-yellow-50/60">

                    <input
                        type="number"
                        step="0.01"
                        id="custo_${index}"
                        value="10.00"
                        oninput="
                            recalcular(
                                ${index},
                                ${item.shipping_cost},
                                ${item.free_shipping}
                            )
                        "
                        class="input-simulacao w-20"
                    >

                </td>

                <td class="p-3 bg-yellow-50/60">

                    <input
                        type="number"
                        step="0.1"
                        id="imposto_${index}"
                        value="0"
                        oninput="
                            recalcular(
                                ${index},
                                ${item.shipping_cost},
                                ${item.free_shipping}
                            )
                        "
                        class="input-simulacao w-16"
                    >

                </td>

                <td class="p-3 bg-yellow-50/60">

                    <input
                        type="number"
                        step="0.1"
                        id="lucro_${index}"
                        value="12"
                        oninput="
                            recalcular(
                                ${index},
                                ${item.shipping_cost},
                                ${item.free_shipping}
                            )
                        "
                        class="input-simulacao w-16"
                    >

                </td>

                <td
                    class="
                        p-3
                        bg-emerald-50
                        font-black
                        text-emerald-800
                    "
                    id="novo_preco_${index}"
                >
                    R$ 0,00
                </td>

                <td
                    class="
                        p-3
                        bg-emerald-50
                        font-bold
                        text-emerald-700
                    "
                    id="lucro_sim_${index}"
                >
                    R$ 0,00
                </td>

                <td
                    class="
                        p-3
                        bg-emerald-50
                        font-bold
                        text-emerald-900
                    "
                    id="margem_real_${index}"
                >
                    0,00%
                </td>
                `;

            tbody.appendChild(
                tr
            );

            recalcular(
                index,
                item.shipping_cost,
                item.free_shipping
            );
        }
    );
}


function recalcular(
    index,
    custoFrete,
    freteGratis
) {

    const taxaPercent =
        parseFloat(
            document.getElementById(
                `taxa_${index}`
            )?.value
        ) || 0;

    const custo =
        parseFloat(
            document.getElementById(
                `custo_${index}`
            )?.value
        ) || 0;

    const impostoPercent =
        parseFloat(
            document.getElementById(
                `imposto_${index}`
            )?.value
        ) || 0;

    const lucroDesejadoPercent =
        parseFloat(
            document.getElementById(
                `lucro_${index}`
            )?.value
        ) || 0;

    const PRECO_REFERENCIA = 78.90;
    const FRETE_REFERENCIA = 10.00;

    const itemAtual = cacheItens[index] || {};
    const precoAtual = Number(itemAtual.price || 0);
    const freteAtual = Number(custoFrete || 0);

    const somaPercentual =
        taxaPercent +
        impostoPercent +
        lucroDesejadoPercent;

    const divisor =
        1 -
        (
            somaPercentual /
            100
        );

    /*
       REGRA R$ 78,90:
       - S\u00f3 \u00e9 testada quando o an\u00fancio atual est\u00e1 acima de R$ 78,90.
       - Primeiro simulamos R$ 78,90 com frete fixo de R$ 10,00.
       - Se essa combina\u00e7\u00e3o j\u00e1 entrega a margem desejada (ou mais),
         o cen\u00e1rio de frete R$ 10,00 passa a ser usado e R$ 78,90
         funciona como pre\u00e7o m\u00ednimo de refer\u00eancia.
       - Caso contr\u00e1rio, permanece o frete atual do an\u00fancio e o novo
         pre\u00e7o n\u00e3o pode cair para R$ 78,90 ou menos.
    */

    const taxaReferencia =
        PRECO_REFERENCIA *
        (taxaPercent / 100);

    const impostoReferencia =
        PRECO_REFERENCIA *
        (impostoPercent / 100);

    const lucroReferencia =
        PRECO_REFERENCIA -
        custo -
        taxaReferencia -
        impostoReferencia -
        FRETE_REFERENCIA;

    const margemReferencia =
        PRECO_REFERENCIA > 0
            ? (lucroReferencia / PRECO_REFERENCIA) * 100
            : 0;

    const podeUsarReferencia =
        precoAtual > PRECO_REFERENCIA &&
        margemReferencia + 0.0001 >= lucroDesejadoPercent;

    const freteAplicado =
        podeUsarReferencia
            ? FRETE_REFERENCIA
            : freteAtual;

    let novoPreco =
        divisor > 0
            ? (
                custo +
                freteAplicado
            ) / divisor
            : custo * 1.5;

    if (precoAtual > PRECO_REFERENCIA && !podeUsarReferencia) {
        // Se R$ 78,90 com frete de R$ 10,00 N\u00c3O alcan\u00e7ar a margem
        // desejada, mant\u00e9m a regra anterior: usa o frete real e n\u00e3o
        // deixa o pre\u00e7o calculado cair para R$ 78,90 ou menos.
        novoPreco = Math.max(
            PRECO_REFERENCIA + 0.01,
            novoPreco
        );
    }

    // Quando R$ 78,90 + frete fixo de R$ 10,00 j\u00e1 alcan\u00e7a ou supera
    // a margem desejada, N\u00c3O travamos o novo pre\u00e7o em R$ 78,90.
    // A f\u00f3rmula acima calcula diretamente o pre\u00e7o necess\u00e1rio para
    // chegar \u00e0 margem escolhida usando o frete fixo de R$ 10,00.

    const valorTaxa =
        novoPreco *
        (
            taxaPercent /
            100
        );

    const valorImposto =
        novoPreco *
        (
            impostoPercent /
            100
        );

    const lucroLiquidoReal =
        novoPreco -
        custo -
        valorTaxa -
        valorImposto -
        freteAplicado;

    const margemRealPercent =
        novoPreco > 0
            ? (
                lucroLiquidoReal /
                novoPreco
            ) * 100
            : 0;

    const elNovoPreco =
        document.getElementById(
            `novo_preco_${index}`
        );

    const elLucroSim =
        document.getElementById(
            `lucro_sim_${index}`
        );

    const elMargemReal =
        document.getElementById(
            `margem_real_${index}`
        );

    if (elNovoPreco)
        elNovoPreco.innerText =
            moeda(
                novoPreco
            );

    if (elLucroSim)
        elLucroSim.innerText =
            moeda(
                lucroLiquidoReal
            );

    if (elMargemReal)
        elMargemReal.innerText =
            margemRealPercent.toFixed(
                2
            ) + '%';

    novosPrecosCalculados[
        index
    ] = {

        preco:
            novoPreco,

        freteSimulado:
            freteAplicado,

        usouReferencia7890:
            podeUsarReferencia,

        foraDaMargem:
            Math.abs(
                novoPreco -
                cacheItens[index].price
            ) > 0.05
    };
}

function aplicarEmMassa() {

    const custoMassa =
        document.getElementById(
            'massa-custo'
        ).value;

    const impostoMassa =
        document.getElementById(
            'massa-imposto'
        ).value;

    const lucroMassa =
        document.getElementById(
            'massa-lucro'
        ).value;

    cacheItens.forEach(
        (
            item,
            index
        ) => {

            if (
                custoMassa !== ''
            ) {

                const el =
                    document.getElementById(
                        `custo_${index}`
                    );

                if (el)
                    el.value =
                        custoMassa;
            }

            if (
                taxaMassa !== ''
            ) {

                const el =
                    document.getElementById(
                        `taxa_${index}`
                    );

                if (el)
                    el.value =
                        taxaMassa;
            }

            if (
                impostoMassa !== ''
            ) {

                const el =
                    document.getElementById(
                        `imposto_${index}`
                    );

                if (el)
                    el.value =
                        impostoMassa;
            }

            if (
                lucroMassa !== ''
            ) {

                const el =
                    document.getElementById(
                        `lucro_${index}`
                    );

                if (el)
                    el.value =
                        lucroMassa;
            }

            recalcular(
                index,
                item.shipping_cost,
                item.free_shipping
            );
        }
    );
}


/* =========================================================
   ATUALIZA\u00c7\u00c3O ORIGINAL
========================================================= */

function montarTabelaAtualizacao(
    itens
) {

    const tbody =
        document.getElementById(
            'tabela-atualizacao'
        );

    if (!tbody) {
        return;
    }

    tbody.innerHTML = '';

    let contador =
        0;

    itens.forEach(
        item => {

            const index =
                cacheItens.findIndex(
                    i =>
                        i.id ===
                        item.id
                );

            const dadosSim =
                novosPrecosCalculados[
                    index
                ] || {
                    preco:
                        item.price,
                    foraDaMargem:
                        true
                };

            if (
                !dadosSim.foraDaMargem
            ) {
                return;
            }

            contador++;

            const tr =
                document.createElement(
                    'tr'
                );

            tr.innerHTML =
                `
                <td class="p-4">

                    <input
                        type="checkbox"
                        value="${index}"
                        checked
                        class="
                            check-item
                            accent-yellow-400
                            w-4
                            h-4
                        "
                    >

                </td>

                <td class="p-4">

                    <div
                        class="
                            flex
                            items-center
                            gap-3
                            min-w-[280px]
                        "
                    >

                        <img
                            src="${escapeHtml(item.thumbnail)}"
                            class="
                                w-11
                                h-11
                                object-cover
                                rounded-xl
                                border
                                border-slate-700
                            "
                        >

                        <div>

                            <span
                                class="
                                    font-semibold
                                    text-white
                                    block
                                "
                            >
                                ${escapeHtml(item.title)}
                            </span>

                            <span
                                class="
                                    text-[10px]
                                    text-slate-500
                                "
                            >
                                ${escapeHtml(item.id)}
                                \u2022
                                SKU:
                                ${escapeHtml(item.sku)}
                            </span>

                        </div>

                    </div>

                </td>

                <td
                    class="
                        p-4
                        font-bold
                        text-white
                    "
                >
                    ${moeda(item.price)}
                </td>

                <td
                    class="
                        p-4
                        font-black
                        text-emerald-400
                    "
                >
                    ${moeda(dadosSim.preco)}
                </td>

                <td class="p-4">

                    <span
                        class="
                            px-2.5
                            py-1
                            rounded-lg
                            bg-amber-400/10
                            text-amber-400
                            font-bold
                            text-[10px]
                        "
                    >
                        Fora da margem
                    </span>

                </td>

                <td
                    id="status_api_${index}"
                    class="p-4"
                >
                    <span
                        class="
                            text-slate-500
                            text-[10px]
                        "
                    >
                        Pendente
                    </span>
                </td>
                `;

            tbody.appendChild(
                tr
            );
        }
    );

    document.getElementById(
        'contador-atualizacao'
    ).innerText =
        contador;
}


function alternarTodos(
    master
) {

    document
        .querySelectorAll(
            '.check-item'
        )
        .forEach(
            checkbox => {
                checkbox.checked =
                    master.checked;
            }
        );
}


async function atualizarPrecosMassaApi() {

    const token =
        obterToken();

    if (!token) {

        solicitarToken();

        return;
    }

    const checkboxes =
        document.querySelectorAll(
            '.check-item:checked'
        );

    if (
        checkboxes.length === 0
    ) {

        alert(
            'Nenhum an\u00fancio selecionado.'
        );

        return;
    }

    if (
        !confirm(
            `Deseja atualizar ${checkboxes.length} an\u00fancio(s)?`
        )
    ) {
        return;
    }

    let itensParaAtualizar =
        [];

    checkboxes.forEach(
        checkbox => {

            const index =
                checkbox.value;

            const item =
                cacheItens[index];

            const dadosSim =
                novosPrecosCalculados[
                    index
                ];

            const novoPreco =
                dadosSim
                    ? dadosSim.preco
                    : item.price;

            itensParaAtualizar.push({

                index,

                id:
                    item.id,

                price:
                    parseFloat(
                        novoPreco.toFixed(
                            2
                        )
                    )
            });
        }
    );

    const tamanhoLote =
        20;

    for (
        let i = 0;
        i < itensParaAtualizar.length;
        i += tamanhoLote
    ) {

        const lote =
            itensParaAtualizar.slice(
                i,
                i + tamanhoLote
            );

        lote.forEach(
            item => {

                const status =
                    document.getElementById(
                        `status_api_${item.index}`
                    );

                if (status) {

                    status.innerHTML =
                        `
                        <span
                            class="
                                text-blue-400
                                font-bold
                                text-[10px]
                            "
                        >
                            Atualizando...
                        </span>
                        `;
                }
            }
        );

        try {

            const response =
                await fetch(
                    `${RENDER_URL}/api/atualizar-precos`,
                    {
                        method:
                            'POST',

                        headers: {
                            'Content-Type':
                                'application/json',

                            Authorization:
                                token
                        },

                        body:
                            JSON.stringify({
                                itens:
                                    lote.map(
                                        item => ({
                                            id:
                                                item.id,
                                            price:
                                                item.price
                                        })
                                    )
                            })
                    }
                );

            const data =
                await response.json();

            lote.forEach(
                (
                    item,
                    pos
                ) => {

                    const resultado =
                        data.resultados?.[
                            pos
                        ];

                    const status =
                        document.getElementById(
                            `status_api_${item.index}`
                        );

                    if (
                        response.ok &&
                        resultado?.sucesso
                    ) {

                        if (status) {

                            status.innerHTML =
                                `
                                <span
                                    class="
                                        text-emerald-400
                                        font-bold
                                        text-[10px]
                                    "
                                >
                                    \u2713 Atualizado
                                </span>
                                `;
                        }

                        cacheItens[
                            item.index
                        ].price =
                            item.price;

                    } else {

                        const erro =
                            resultado?.erro ||
                            data.erro ||
                            'Falha na API';

                        if (status) {

                            status.innerHTML =
                                `
                                <span
                                    class="
                                        text-red-400
                                        font-bold
                                        text-[10px]
                                    "
                                >
                                    \u2717
                                    ${escapeHtml(
                                        erro
                                    )}
                                </span>
                                `;
                        }
                    }
                }
            );

        } catch (error) {

            lote.forEach(
                item => {

                    const status =
                        document.getElementById(
                            `status_api_${item.index}`
                        );

                    if (status) {

                        status.innerHTML =
                            `
                            <span
                                class="
                                    text-red-400
                                    font-bold
                                    text-[10px]
                                "
                            >
                                Erro de rede
                            </span>
                            `;
                    }
                }
            );
        }

        if (
            i +
            tamanhoLote <
            itensParaAtualizar.length
        ) {

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        1000
                    )
            );
        }
    }

    alert(
        'Processo finalizado!'
    );

    atualizarCards(
        cacheItens
    );

    executarBusca();
}


/* =========================================================
   DASHBOARD NOVO
========================================================= */

function formatarIndicador(
    taxa
) {

    if (
        taxa === null ||
        taxa === undefined
    ) {
        return '\u2014';
    }

    const numero =
        Number(taxa);

    if (
        Number.isNaN(numero)
    ) {
        return String(taxa);
    }

    return (
        numero <= 1
            ? numero * 100
            : numero
    ).toFixed(2) + '%';
}


function preencherDashboard(data) {
    dashboardCache=data;

    const setTxt=(id,valor)=>{
        const el=document.getElementById(id);
        if(el)el.innerText=valor;
    };

    const vendas=data?.vendas_reais||{};
    const indicadores=data?.indicadores||{};

    setTxt('dashboard-vendas',moeda(vendas.valor_total));
    setTxt('dashboard-pedidos',Number(vendas.pedidos_pagos||0).toLocaleString('pt-BR'));
    setTxt('dashboard-unidades',Number(vendas.unidades||0).toLocaleString('pt-BR'));

    setTxt('home-dashboard-vendas',moeda(vendas.valor_total));
    setTxt('home-dashboard-pedidos',Number(vendas.pedidos_pagos||0).toLocaleString('pt-BR'));
    setTxt('home-dashboard-unidades',Number(vendas.unidades||0).toLocaleString('pt-BR'));

    const visitas=data?.visitas_dia||{};
    setTxt(
      'home-dashboard-visitas',
      visitas.total!==null&&visitas.total!==undefined
        ? Number(visitas.total||0).toLocaleString('pt-BR')
        : '\u2014'
    );
    setTxt('home-dashboard-visitas-periodo',visitas.periodo||'Visitas aos an\u00fancios da conta');

    const periodo=data?.periodo_vendas;
    const textoPeriodo=periodo
      ? `Per\u00edodo consultado: ${formatarData(periodo.inicio)} at\u00e9 ${formatarData(periodo.fim)}. ${periodo.observacao||''}`
      : 'Dados atualizados.';
    setTxt('dashboard-periodo',textoPeriodo);
    setTxt('home-dashboard-periodo',textoPeriodo);

    const vendasMetric=indicadores.vendas||{};
    const reclamacoes=indicadores.reclamacoes||{};
    const atrasos=indicadores.atrasos||{};
    const cancelamentos=indicadores.cancelamentos||{};

    // A p\u00e1gina atual usa IDs home-metric-*. Os IDs antigos metric-* podem n\u00e3o existir.
    const pares=[
      ['home-metric-vendas',vendasMetric.valor??'\u2014'],
      ['home-metric-vendas-periodo',vendasMetric.periodo||'Per\u00edodo da API'],
      ['home-metric-reclamacoes',formatarIndicador(reclamacoes.taxa)],
      ['home-metric-reclamacoes-extra',reclamacoes.valor!==null&&reclamacoes.valor!==undefined?`Valor: ${reclamacoes.valor}`:'Dados da API'],
      ['home-metric-atrasos',formatarIndicador(atrasos.taxa)],
      ['home-metric-atrasos-extra',atrasos.valor!==null&&atrasos.valor!==undefined?`Valor: ${atrasos.valor}`:'Dados da API'],
      ['home-metric-cancelamentos',formatarIndicador(cancelamentos.taxa)],
      ['home-metric-cancelamentos-extra',cancelamentos.valor!==null&&cancelamentos.valor!==undefined?`Valor: ${cancelamentos.valor}`:'Dados da API'],

      // Compatibilidade, caso esses elementos existam em outra vers\u00e3o do layout.
      ['metric-vendas',vendasMetric.valor??'\u2014'],
      ['metric-vendas-periodo',vendasMetric.periodo||'Per\u00edodo da API'],
      ['metric-reclamacoes',formatarIndicador(reclamacoes.taxa)],
      ['metric-reclamacoes-extra',reclamacoes.valor!==null&&reclamacoes.valor!==undefined?`Valor: ${reclamacoes.valor}`:'Dados da API'],
      ['metric-atrasos',formatarIndicador(atrasos.taxa)],
      ['metric-atrasos-extra',atrasos.valor!==null&&atrasos.valor!==undefined?`Valor: ${atrasos.valor}`:'Dados da API'],
      ['metric-cancelamentos',formatarIndicador(cancelamentos.taxa)],
      ['metric-cancelamentos-extra',cancelamentos.valor!==null&&cancelamentos.valor!==undefined?`Valor: ${cancelamentos.valor}`:'Dados da API']
    ];
    pares.forEach(([id,v])=>setTxt(id,v));

    if(Array.isArray(data?.top10))montarTop10(data.top10);

    try{
        localStorage.setItem('mlHubPro_resumoHome_v1',JSON.stringify({
          vendas:document.getElementById('home-dashboard-vendas')?.innerText||'',
          pedidos:document.getElementById('home-dashboard-pedidos')?.innerText||'',
          unidades:document.getElementById('home-dashboard-unidades')?.innerText||'',
          visitas:document.getElementById('home-dashboard-visitas')?.innerText||'',
          visitas_periodo:document.getElementById('home-dashboard-visitas-periodo')?.innerText||''
        }));
        localStorage.setItem('mlHubPro_periodoHome_v1',textoPeriodo);

        const indicadoresHomeCache={};
        [
          'home-metric-vendas','home-metric-vendas-periodo',
          'home-metric-reclamacoes','home-metric-reclamacoes-extra',
          'home-metric-atrasos','home-metric-atrasos-extra',
          'home-metric-cancelamentos','home-metric-cancelamentos-extra'
        ].forEach(id=>{
            const el=document.getElementById(id);
            if(el)indicadoresHomeCache[id]=el.innerText;
        });
        localStorage.setItem('mlHubPro_indicadoresHome_v1',JSON.stringify(indicadoresHomeCache));
        localStorage.setItem('mlHubPro_dashboardHome_v64',JSON.stringify(data));
    }catch(e){
        console.warn('Cache da Home:',e);
    }
}

function formatarData(
    valor
) {

    if (!valor) {
        return '-';
    }

    const data =
        new Date(
            valor
        );

    if (
        Number.isNaN(
            data.getTime()
        )
    ) {
        return valor;
    }

    return data.toLocaleDateString(
        'pt-BR'
    );
}


function montarTop10(lista) {

    const container = document.getElementById('top10-container');
    const containerHome = document.getElementById('top10-home');

    const vazia = `
        <div class="text-center py-12 text-xs text-slate-600">
            Nenhum an\u00fancio com vendas foi encontrado na conta.
        </div>
    `;

    let html = vazia;

    if (Array.isArray(lista) && lista.length > 0) {
        html = `
            <div class="space-y-3">
                ${lista.slice(0, 10).map((item, index) => `
                    <div class="flex items-center gap-4 p-4 rounded-xl bg-slate-950/60 border border-slate-800">
                        <div class="w-9 h-9 rounded-lg bg-yellow-400/10 text-yellow-400 flex items-center justify-center font-black">
                            ${index + 1}
                        </div>

                        <img
                            src="${escapeHtml(item.thumbnail || '')}"
                            class="w-14 h-14 rounded-xl object-cover bg-slate-800"
                            onerror="this.style.visibility='hidden'"
                        >

                        <div class="min-w-0 flex-1">
                            <div class="font-bold text-white text-sm truncate">
                                ${escapeHtml(item.titulo || '')}
                            </div>
                            <div class="text-[10px] text-slate-500 mt-1">
                                ${escapeHtml(item.item_id || '')}
                            </div>
                        </div>

                        <div class="text-right">
                            <div class="text-lg font-black text-emerald-400">
                                ${Number(item.unidades || 0).toLocaleString('pt-BR')}
                            </div>
                            <div class="text-[10px] text-slate-500">unidades</div>
                        </div>

                        <div class="hidden md:block text-right w-28">
                            <div class="text-xs font-bold text-white">
                                ${moeda(item.faturamento)}
                            </div>
                            <div class="text-[10px] text-slate-600 mt-1">faturamento</div>
                        </div>

                        <a
                            href="${escapeHtml(item.permalink || '#')}"
                            target="_blank"
                            class="hidden lg:flex px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-400 text-[10px] font-bold"
                        >Ver</a>
                    </div>
                `).join('')}
            </div>
        `;
    }

    if (container) container.innerHTML = html;
    if (containerHome) containerHome.innerHTML = html;

    try {
        localStorage.setItem('mlHubPro_top10Home_v2', html);
    } catch (erro) {
        console.warn('N\u00e3o foi poss\u00edvel salvar o Top 10:', erro);
    }
}


async function carregarTop10V22(){
    const token=obterToken();
    if(!token)return {ok:false,erro:'Token n\u00e3o dispon\u00edvel.'};

    try{
        const r=await fetch(`${RENDER_URL}/api/v23/top10?_=${Date.now()}`,{
            cache:'no-store',
            headers:{Authorization:token,Accept:'application/json'}
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.sucesso)throw new Error(d.erro||`HTTP ${r.status}`);
        montarTop10(Array.isArray(d.top10)?d.top10:[]);
        return {ok:true,total:Number(d.total||0),fonte:d.fonte||''};
    }catch(e){
        console.error('[TOP10 V22 FRONT]',e);
        return {ok:false,erro:e.message};
    }
}

async function carregarDashboard() {
    const token=obterToken();
    if(!token){solicitarToken();return;}

    mostrarLoading('Buscando vendas, indicadores e Top 10...');

    try{
        const r=await fetch(`${RENDER_URL}/api/dashboard?_=${Date.now()}`,{
            cache:'no-store',
            headers:{Authorization:token,Accept:'application/json'}
        });
        const d=await r.json().catch(()=>({}));

        if(!r.ok||!d.sucesso){
            throw new Error(d.erro||`HTTP ${r.status}`);
        }

        preencherDashboard(d);

        // O dashboard V23 j\u00e1 traz unidades + faturamento reais pelos pedidos pagos.
        // S\u00f3 chama a rota independente como fallback quando o ranking vier vazio.
        if(!Array.isArray(d.top10)||!d.top10.length){
            const fallback=await carregarTop10V22();
            if(!fallback.ok)console.warn('[TOP10 V23 FALLBACK]',fallback.erro);
        }

        const status=document.getElementById('home-tempo-real-status');
        if(status){
            status.innerText='\u25cf Painel e Top 10 atualizados agora';
            status.className='text-[10px] text-emerald-400 font-bold';
        }
    }catch(e){
        console.error('[DASHBOARD V23]',e);
        alert('Erro ao carregar o painel: '+e.message);
    }finally{
        esconderLoading();
    }
}



let perguntasAgentesV100=[];
let perguntasUltimaListaV100=[];
let perguntaPrefillAgenteV100=null;
let geracaoRespostasV100EmCurso=false;

function agenteLinkPrincipalV100(agente){
    return Array.isArray(agente?.links)&&agente.links.length
      ?agente.links[0]
      :{match_type:'default',match_value:'*'};
}

function rotuloVinculoAgenteV100(link){
    if(!link)return 'Sem vínculo';
    if(link.match_type==='item_id')return `MLB ${link.match_value}`;
    if(link.match_type==='sku')return `SKU ${link.match_value}`;
    return 'Padrão da conta';
}

function agenteAutomaticoPerguntaV100(pergunta){
    const itemId=String(pergunta?.item_id||'').toUpperCase();
    const sku=String(pergunta?.sku||'').trim().toLowerCase();

    const candidatos=[
      ...perguntasAgentesV100.filter(a=>
        (a.links||[]).some(l=>
          l.match_type==='item_id' &&
          String(l.match_value||'').toUpperCase()===itemId
        )
      ),
      ...perguntasAgentesV100.filter(a=>
        sku &&
        (a.links||[]).some(l=>
          l.match_type==='sku' &&
          String(l.match_value||'').trim().toLowerCase()===sku
        )
      ),
      ...perguntasAgentesV100.filter(a=>
        (a.links||[]).some(l=>l.match_type==='default')
      )
    ];

    return candidatos[0]||null;
}

function opcoesAgentesPerguntaV100(pergunta,selected=''){
    const auto=agenteAutomaticoPerguntaV100(pergunta);
    const sel=String(selected||auto?.id||'');

    return [
      `<option value="">Sem agente específico</option>`,
      ...perguntasAgentesV100.map(a=>{
        const link=agenteLinkPrincipalV100(a);
        return `<option value="${escapeHtml(String(a.id))}" ${String(a.id)===sel?'selected':''}>${escapeHtml(a.name)} · ${escapeHtml(rotuloVinculoAgenteV100(link))}</option>`;
      })
    ].join('');
}

async function carregarAgentesPerguntasV100(){
    try{
        const r=await fetch(
          `${RENDER_URL}/api/v100/perguntas/agentes?_=${Date.now()}`,
          {headers:{Authorization:obterToken()},cache:'no-store'}
        );
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        perguntasAgentesV100=Array.isArray(d.agentes)?d.agentes:[];

        const select=document.getElementById('perguntas-agente-global-v100');
        if(select){
            select.innerHTML=[
              '<option value="">Selecione um agente...</option>',
              ...perguntasAgentesV100.map(a=>`
                <option value="${escapeHtml(String(a.id))}">
                  ${escapeHtml(a.name)} · ${escapeHtml(rotuloVinculoAgenteV100(agenteLinkPrincipalV100(a)))}
                </option>
              `)
            ].join('');
        }

        return perguntasAgentesV100;
    }catch(e){
        const status=document.getElementById('perguntas-ia-status-v100');
        if(status)status.textContent='Agentes indisponíveis: '+e.message;
        perguntasAgentesV100=[];
        return [];
    }
}

function limparFormAgentePerguntasV100(){
    [
      'agente-perguntas-id-v100',
      'agente-perguntas-name-v100',
      'agente-perguntas-product-v100',
      'agente-perguntas-brand-v100',
      'agente-perguntas-match-value-v100',
      'agente-perguntas-information-v100',
      'agente-perguntas-technical-v100',
      'agente-perguntas-applications-v100',
      'agente-perguntas-notes-v100',
      'agente-perguntas-instructions-v100'
    ].forEach(id=>{
        const el=document.getElementById(id);
        if(el)el.value='';
    });

    const type=document.getElementById('agente-perguntas-match-type-v100');
    if(type)type.value='item_id';

    const refresh=document.getElementById('agente-perguntas-refresh-v100');
    if(refresh)refresh.checked=false;

    const interval=document.getElementById('agente-perguntas-interval-v100');
    if(interval)interval.value='24';

    document.getElementById('agente-perguntas-delete-v100')?.classList.add('hidden');
}


function abrirAgentePerguntaPorIdV100(questionId){
    const pergunta=perguntasUltimaListaV100.find(
      x=>String(x.id)===String(questionId)
    );
    abrirAgentePerguntasV100(pergunta||null,'');
}

function abrirAgentePerguntasV100(pergunta=null,agenteId=''){
    limparFormAgentePerguntasV100();

    const modal=document.getElementById('modal-agente-perguntas-v100');
    if(!modal)return;
    modal.classList.remove('hidden');

    let agente=agenteId
      ?perguntasAgentesV100.find(a=>String(a.id)===String(agenteId))
      :null;

    if(agente){
        const m=agente.manual||{};
        const link=agenteLinkPrincipalV100(agente);

        document.getElementById('agente-perguntas-id-v100').value=agente.id||'';
        document.getElementById('agente-perguntas-name-v100').value=agente.name||'';
        document.getElementById('agente-perguntas-product-v100').value=agente.product||'';
        document.getElementById('agente-perguntas-brand-v100').value=agente.brand||'';
        document.getElementById('agente-perguntas-match-type-v100').value=link.match_type||'item_id';
        document.getElementById('agente-perguntas-match-value-v100').value=link.match_type==='default'?'':(link.match_value||'');
        document.getElementById('agente-perguntas-information-v100').value=m.information||'';
        document.getElementById('agente-perguntas-technical-v100').value=m.technical_sheet||'';
        document.getElementById('agente-perguntas-applications-v100').value=m.applications||'';
        document.getElementById('agente-perguntas-notes-v100').value=m.notes||'';
        document.getElementById('agente-perguntas-instructions-v100').value=agente.instructions||'';
        document.getElementById('agente-perguntas-refresh-v100').checked=Boolean(agente.refresh_enabled);
        document.getElementById('agente-perguntas-interval-v100').value=String(agente.interval_hours||24);
        document.getElementById('agente-perguntas-modal-title-v100').textContent='Editar agente';
        document.getElementById('agente-perguntas-delete-v100')?.classList.remove('hidden');
        return;
    }

    document.getElementById('agente-perguntas-modal-title-v100').textContent='Novo agente';

    if(pergunta){
        document.getElementById('agente-perguntas-name-v100').value=`Agente ${pergunta.titulo||pergunta.sku||pergunta.item_id}`;
        document.getElementById('agente-perguntas-product-v100').value=pergunta.titulo||'';

        if(pergunta.sku){
            document.getElementById('agente-perguntas-match-type-v100').value='sku';
            document.getElementById('agente-perguntas-match-value-v100').value=pergunta.sku;
        }else{
            document.getElementById('agente-perguntas-match-type-v100').value='item_id';
            document.getElementById('agente-perguntas-match-value-v100').value=pergunta.item_id||'';
        }
    }
}

function fecharAgentePerguntasV100(){
    document.getElementById('modal-agente-perguntas-v100')?.classList.add('hidden');
}

function editarAgenteSelecionadoPerguntasV100(){
    const id=document.getElementById('perguntas-agente-global-v100')?.value||'';
    if(!id)return alert('Selecione um agente para editar.');
    abrirAgentePerguntasV100(null,id);
}

async function salvarAgentePerguntasV100(){
    const id=document.getElementById('agente-perguntas-id-v100')?.value.trim()||'';
    const payload={
      name:document.getElementById('agente-perguntas-name-v100')?.value.trim()||'',
      product:document.getElementById('agente-perguntas-product-v100')?.value.trim()||'',
      brand:document.getElementById('agente-perguntas-brand-v100')?.value.trim()||'',
      match_type:document.getElementById('agente-perguntas-match-type-v100')?.value||'item_id',
      match_value:document.getElementById('agente-perguntas-match-value-v100')?.value.trim()||'',
      information:document.getElementById('agente-perguntas-information-v100')?.value.trim()||'',
      technical_sheet:document.getElementById('agente-perguntas-technical-v100')?.value.trim()||'',
      applications:document.getElementById('agente-perguntas-applications-v100')?.value.trim()||'',
      notes:document.getElementById('agente-perguntas-notes-v100')?.value.trim()||'',
      instructions:document.getElementById('agente-perguntas-instructions-v100')?.value.trim()||'',
      refresh_enabled:document.getElementById('agente-perguntas-refresh-v100')?.checked===true,
      interval_hours:Number(document.getElementById('agente-perguntas-interval-v100')?.value||24)
    };

    if(!payload.name||!payload.product){
        return alert('Informe o nome do agente e o produto.');
    }

    if(payload.match_type!=='default'&&!payload.match_value){
        return alert('Informe o MLB ou SKU usado no vínculo.');
    }

    try{
        const r=await fetch(
          `${RENDER_URL}/api/v100/perguntas/agentes${id?'/'+encodeURIComponent(id):''}`,
          {
            method:id?'PUT':'POST',
            headers:{
              'Content-Type':'application/json',
              Authorization:obterToken()
            },
            body:JSON.stringify(payload)
          }
        );
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        fecharAgentePerguntasV100();
        await carregarAgentesPerguntasV100();
        renderizarPerguntas(perguntasUltimaListaV100);
    }catch(e){
        alert(e.message);
    }
}

async function excluirAgentePerguntasV100(){
    const id=document.getElementById('agente-perguntas-id-v100')?.value.trim()||'';
    if(!id)return;
    if(!confirm('Excluir este agente de produto?'))return;

    try{
        const r=await fetch(
          `${RENDER_URL}/api/v100/perguntas/agentes/${encodeURIComponent(id)}`,
          {
            method:'DELETE',
            headers:{Authorization:obterToken()}
          }
        );
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        fecharAgentePerguntasV100();
        await carregarAgentesPerguntasV100();
        renderizarPerguntas(perguntasUltimaListaV100);
    }catch(e){
        alert(e.message);
    }
}

function badgeConfiancaV100(conf){
    if(conf==='high')return {txt:'Alta confiança',cls:'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'};
    if(conf==='medium')return {txt:'Confiança média',cls:'text-yellow-300 bg-yellow-500/10 border-yellow-500/20'};
    return {txt:'Baixa confiança',cls:'text-red-300 bg-red-500/10 border-red-500/20'};
}

async function gerarRespostaIAV100(questionId,silencioso=false){
    const pergunta=perguntasUltimaListaV100.find(x=>String(x.id)===String(questionId));
    if(!pergunta)return;

    const textarea=document.getElementById(`resposta_${questionId}`);
    const status=document.getElementById(`ia_status_${questionId}`);
    const btn=document.getElementById(`ia_btn_${questionId}`);
    const select=document.getElementById(`agente_${questionId}`);

    if(!textarea)return;

    if(btn)btn.disabled=true;
    if(status){
        status.innerHTML='<span class="text-blue-400">IA analisando anúncio + agente do produto...</span>';
    }

    try{
        const r=await fetch(
          `${RENDER_URL}/api/v100/perguntas/sugerir-resposta`,
          {
            method:'POST',
            headers:{
              'Content-Type':'application/json',
              Authorization:obterToken()
            },
            body:JSON.stringify({
              question_id:pergunta.id,
              item_id:pergunta.item_id,
              question_text:pergunta.pergunta,
              agent_id:select?.value||''
            })
          }
        );

        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        textarea.value=d.resposta||'';

        const b=badgeConfiancaV100(d.confidence);
        const faltas=(d.missing_information||[]);

        if(status){
            status.innerHTML=`
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-2 py-1 rounded-lg border text-[9px] font-black ${b.cls}">${b.txt}</span>
                <span class="text-[9px] ${d.should_send?'text-emerald-400':'text-yellow-400'}">
                  ${d.should_send?'Resposta sustentada pelos dados confirmados.':'Revise antes de enviar: faltam dados confirmados.'}
                </span>
                ${d.agente?`<span class="text-[9px] text-slate-500">Agente: ${escapeHtml(d.agente.name)}</span>`:''}
              </div>
              ${faltas.length?`
                <div class="text-[9px] text-yellow-300 mt-2">
                  Falta confirmar: ${escapeHtml(faltas.join(' · '))}
                </div>
              `:''}
            `;
        }

        if(!silencioso){
            textarea.focus();
        }
        return true;
    }catch(e){
        if(status)status.innerHTML=`<span class="text-red-300">${escapeHtml(e.message)}</span>`;
        if(!silencioso)alert(e.message);
        return false;
    }finally{
        if(btn)btn.disabled=false;
    }
}

async function gerarRespostasPendentesV100(){
    if(geracaoRespostasV100EmCurso)return;

    const pendentes=perguntasUltimaListaV100.filter(p=>!p.respondida);
    if(!pendentes.length)return alert('Não há perguntas pendentes.');

    if(!confirm(
      `Gerar rascunhos com IA para ${pendentes.length} pergunta(s)?\n\n`+
      `Nada será enviado automaticamente ao cliente. Você continuará revisando cada resposta antes do envio.`
    ))return;

    geracaoRespostasV100EmCurso=true;
    const status=document.getElementById('perguntas-ia-status-v100');

    let idx=0;
    let ok=0;
    let falhas=0;

    async function worker(){
        while(true){
            const p=pendentes[idx++];
            if(!p)return;

            if(status){
                status.textContent=`Gerando respostas: ${ok+falhas}/${pendentes.length} concluídas...`;
            }

            try{
                const gerou=await gerarRespostaIAV100(p.id,true);
                if(gerou)ok++;
                else falhas++;
            }catch(e){
                falhas++;
            }
        }
    }

    try{
        await Promise.all([worker(),worker()]);

        if(status){
            status.textContent=
              `IA concluiu ${ok} rascunho(s)`+
              (falhas?` · ${falhas} falha(s)`:``)+
              `. Revise antes de enviar.`;
        }
    }finally{
        geracaoRespostasV100EmCurso=false;
    }
}

/* =========================================================
   PERGUNTAS
========================================================= */

async function carregarPerguntas() {
    const token=obterToken();

    if(!token){
        solicitarToken();
        return;
    }

    const container=document.getElementById('lista-perguntas');

    if(container){
        container.innerHTML=`
          <div class="panel rounded-2xl p-10 text-center">
            <div class="loading-ring animate-spin rounded-full h-8 w-8 mx-auto"></div>
            <div class="text-xs text-slate-500 mt-4">
              Buscando perguntas e agentes de produto...
            </div>
          </div>
        `;
    }

    try{
        await carregarAgentesPerguntasV100();

        const response=await fetch(
            `${RENDER_URL}/api/perguntas?limit=100`,
            {headers:{Authorization:token}}
        );

        const data=await response.json();

        if(!response.ok||!data.sucesso){
            alert(data.erro||'Erro ao buscar perguntas.');
            return;
        }

        perguntasUltimaListaV100=data.perguntas||[];
        renderizarPerguntas(perguntasUltimaListaV100);
    }catch(error){
        console.error(error);
        alert('Erro de comunicação ao buscar perguntas.');
    }
}


function renderizarPerguntas(perguntas){
    const container=document.getElementById('lista-perguntas');
    const total=perguntas.length;
    const pendentes=perguntas.filter(pergunta=>!pergunta.respondida).length;
    const respondidas=total-pendentes;

    document.getElementById('perguntas-total').innerText=total;
    document.getElementById('perguntas-pendentes').innerText=pendentes;
    document.getElementById('perguntas-respondidas').innerText=respondidas;

    if(!perguntas.length){
        container.innerHTML=`
          <div class="panel rounded-2xl p-10 text-center text-xs text-slate-600">
            <div class="text-3xl">✓</div>
            <div class="text-sm font-bold text-white mt-3">Nenhuma pergunta encontrada.</div>
            <div class="text-xs text-slate-500 mt-2">Sua caixa de perguntas está vazia.</div>
          </div>
        `;
        return;
    }

    container.innerHTML=perguntas.map(pergunta=>{
        const respondida=pergunta.respondida;
        const agenteAuto=agenteAutomaticoPerguntaV100(pergunta);

        return `
          <div class="panel rounded-2xl overflow-hidden">
            <div class="p-5 border-b border-slate-800">
              <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div class="flex items-center gap-3">
                  ${pergunta.thumbnail?`
                    <img src="${escapeHtml(pergunta.thumbnail)}"
                      class="w-12 h-12 rounded-xl object-cover bg-slate-800">
                  `:''}

                  <div>
                    <div class="text-sm font-bold text-white">${escapeHtml(pergunta.titulo)}</div>
                    <div class="text-[10px] text-slate-500 mt-1">
                      ${escapeHtml(pergunta.item_id)}
                      ${pergunta.sku?` · SKU: ${escapeHtml(pergunta.sku)}`:''}
                      · ${Number(pergunta.vendas||0).toLocaleString('pt-BR')} venda(s)
                    </div>
                  </div>
                </div>

                <div class="flex flex-wrap items-center gap-2">
                  ${agenteAuto?`
                    <span class="px-2 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[9px] font-black">
                      Agente automático: ${escapeHtml(agenteAuto.name)}
                    </span>
                  `:''}

                  <span class="inline-flex px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                    respondida
                      ?'bg-emerald-400/10 text-emerald-400'
                      :'bg-yellow-400/10 text-yellow-400'
                  }">
                    ${respondida?'Respondida':'Aguardando resposta'}
                  </span>
                </div>
              </div>
            </div>

            <div class="p-5 space-y-4">
              <div>
                <div class="text-[10px] uppercase tracking-wider text-slate-600 font-bold mb-2">
                  Pergunta
                </div>
                <div class="rounded-xl bg-slate-950 border border-slate-800 p-4 text-sm text-slate-200 leading-6">
                  ${escapeHtml(pergunta.pergunta)}
                </div>
              </div>

              ${respondida?`
                <div>
                  <div class="text-[10px] uppercase tracking-wider text-emerald-500 font-bold mb-2">
                    Sua resposta
                  </div>
                  <div class="rounded-xl bg-emerald-400/5 border border-emerald-400/10 p-4 text-sm text-slate-300">
                    ${escapeHtml(pergunta.resposta)}
                  </div>
                </div>
              `:`
                <div class="rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
                  <div class="flex flex-col xl:flex-row xl:items-end gap-3">
                    <label class="flex-1">
                      <span class="block text-[9px] uppercase tracking-wider text-blue-400 font-black mb-2">
                        Agente de produto para esta resposta
                      </span>
                      <select id="agente_${pergunta.id}"
                        class="w-full rounded-xl px-3 py-2.5 text-xs">
                        ${opcoesAgentesPerguntaV100(pergunta)}
                      </select>
                    </label>

                    <button
                      onclick="abrirAgentePerguntaPorIdV100('${pergunta.id}')"
                      class="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold">
                      + Criar agente deste produto
                    </button>

                    <button
                      id="ia_btn_${pergunta.id}"
                      onclick="gerarRespostaIAV100('${pergunta.id}')"
                      class="bg-blue-500 hover:bg-blue-400 text-white px-4 py-2.5 rounded-xl text-xs font-black">
                      ✦ Gerar resposta com IA
                    </button>
                  </div>

                  <div id="ia_status_${pergunta.id}" class="text-[9px] text-slate-500 mt-3">
                    A IA usa dados do anúncio e apenas informações confirmadas do agente.
                  </div>
                </div>

                <div>
                  <div class="text-[10px] uppercase tracking-wider text-yellow-400 font-bold mb-2">
                    Resposta para revisar
                  </div>

                  <textarea id="resposta_${pergunta.id}" maxlength="2000" rows="4"
                    placeholder="Digite sua resposta ou gere um rascunho com IA..."
                    class="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-sm text-white outline-none focus:border-yellow-400/50 resize-y"></textarea>

                  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-3">
                    <span class="text-[10px] text-slate-600">
                      Máximo de 2.000 caracteres. A IA nunca envia automaticamente.
                    </span>

                    <button onclick="responderPergunta('${pergunta.id}')"
                      class="bg-yellow-400 hover:bg-yellow-300 text-slate-950 px-5 py-2.5 rounded-xl text-xs font-black">
                      Enviar resposta
                    </button>
                  </div>
                </div>
              `}
            </div>
          </div>
        `;
    }).join('');
}


async function responderPergunta(
    questionId
) {

    const token =
        obterToken();

    if (!token) {

        solicitarToken();

        return;
    }

    const textarea =
        document.getElementById(
            `resposta_${questionId}`
        );

    if (!textarea) {
        return;
    }

    const texto =
        textarea.value.trim();

    if (!texto) {

        alert(
            'Digite uma resposta.'
        );

        return;
    }

    if (
        texto.length >
        2000
    ) {

        alert(
            'A resposta n\u00e3o pode ultrapassar 2.000 caracteres.'
        );

        return;
    }

    textarea.disabled =
        true;

    try {

        const response =
            await fetch(
                `${RENDER_URL}/api/responder-pergunta`,
                {
                    method:
                        'POST',

                    headers: {
                        'Content-Type':
                            'application/json',

                        Authorization:
                            token
                    },

                    body:
                        JSON.stringify({
                            question_id:
                                questionId,
                            text:
                                texto
                        })
                }
            );

        const data =
            await response.json();

        if (
            !response.ok ||
            !data.sucesso
        ) {

            alert(
                data.erro ||
                'Erro ao enviar resposta.'
            );

            textarea.disabled =
                false;

            return;
        }

        alert(
            'Resposta enviada para o Mercado Livre.'
        );

        carregarPerguntas();

    } catch (error) {

        console.error(
            error
        );

        textarea.disabled =
            false;

        alert(
            'Erro de comunica\u00e7\u00e3o ao enviar resposta.'
        );
    }
}


/* =========================================================
   INICIALIZA\u00c7\u00c3O
========================================================= */

document.addEventListener(
    'DOMContentLoaded',
    () => {

        atualizarStatusTokenHome();

        const token =
            obterToken();

        if (token) {

            const input =
                document.getElementById(
                    'input-token-home'
                );

            if (input) {
                input.value =
                    token;
            }
        }

        const abaSalva =
            localStorage.getItem('mlHubPro_abaAtual_v1');

        const abasValidas = [
            'inicio','gestao','pedidos','simulacao','atualizacao','promocoes',
            'criar-massa','perguntas','reclamacoes','anuncios-restritos','inteligencia-anuncios'
        ];

        mudarAba(
            abaSalva && abasValidas.includes(abaSalva)
                ? abaSalva
                : 'inicio'
        );
    }
);

