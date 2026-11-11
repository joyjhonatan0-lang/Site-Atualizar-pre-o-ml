/* =========================================================
   V116 — SCALE 300K / UI PROFISSIONAL COM SESSÃO BLINDADA CONTRA QNEDAS DE BANCO
   - Mantém o usuário logado mesmo se o banco de dados do Render oscilar;
   - Carregamento instantâneo do IndexedDB local.
========================================================= */
const MLHUB_SCALE_PAGE_V103 = 50;
const MLHUB_SIM_PAGE_V103 = 1000;
const MLHUB_SCALE_MEMORY_LIMIT_V103 = 5000;
const processosLocaisV103 = new Map();
let processosServerTimerV103 = null;
let migracaoIndicesV103EmCurso = false;

// Garante recuperação segura do seller ativo sem forçar logout por erro de banco
async function sellerAtivoV90() {
  if (typeof window.obterSellerIdAtivo === 'function') {
    try {
      const s = window.obterSellerIdAtivo();
      if (s) return s;
    } catch (e) {}
  }
  return localStorage.getItem('mlhub_seller_id') || localStorage.getItem('mlHubPro_seller_id') || localStorage.getItem('seller_id') || 'default_seller';
}

function toastV103(msg, tipo = 'info', ms = 4200) {
  const el = document.createElement('div');
  el.className = 'mlhub-v103-toast';
  if (tipo === 'erro') el.style.borderColor = 'rgba(255,105,120,.35)';
  if (tipo === 'sucesso') el.style.borderColor = 'rgba(46,230,166,.30)';
  el.textContent = String(msg || '');
  document.body.appendChild(el);
  setTimeout(() => el.remove(), Math.max(1600, Number(ms || 4200)));
}

function alternarSidebarV103() {
  document.body.classList.toggle('mlhub-sidebar-collapsed');
  localStorage.setItem(
    'mlhub_sidebar_v103',
    document.body.classList.contains('mlhub-sidebar-collapsed') ? '1' : '0'
  );
}

function alternarProcessCenterV103() {
  document.getElementById('mlhub-process-center-v103')
    ?.classList.toggle('mlhub-collapsed-v103');
}

function nomeProcessoV103(tipo) {
  return {
    anuncios: 'Sincronização de anúncios',
    precos: 'Sincronização de preços',
    fretes: 'Sincronização de fretes',
    price_update: 'Atualização de preços',
    pause_mass_v103: 'Pausa em massa',
    full_sync: 'Sincronização de anúncios',
    price_sync: 'Preços',
    freight_sync: 'Fretes',
    price_update_mass: 'Atualização de preços'
  }[tipo] || String(tipo || 'Processo');
}

function statusProcessoV103(status) {
  return {
    queued: 'Na fila',
    running: 'Executando',
    paused: 'Pausado',
    completed: 'Concluído',
    failed: 'Falhou',
    cancelled: 'Cancelado'
  }[status] || String(status || '');
}

function atualizarProcessCenterV103() {
  const list = document.getElementById('mlhub-process-list-v103');
  const summary = document.getElementById('mlhub-process-summary-v103');
  if (!list || !summary) return;

  const all = [...processosLocaisV103.values()];
  const ativos = all.filter(x => ['queued', 'running', 'paused'].includes(x.status));
  summary.textContent = ativos.length ? `${ativos.length} processo(s) ativo(s)` : 'Nenhum processo ativo';

  const ordenar = [...all]
    .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))
    .slice(0, 8);

  list.innerHTML = ordenar.length
    ? ordenar.map(p => {
      const total = Number(p.total || 0), atual = Number(p.atual || 0);
      const pct = total > 0 ? Math.max(0, Math.min(100, Math.round(atual / total * 100))) : (p.status === 'completed' ? 100 : 0);
      return `
        <div class="mlhub-process-item-v103">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[10px] font-black text-white">${escapeHtml(nomeProcessoV103(p.type))}</div>
              <div class="text-[9px] text-slate-500 mt-1 truncate">${escapeHtml(p.mensagem || statusProcessoV103(p.status))}</div>
            </div>
            <div class="text-[9px] font-black ${p.status === 'failed' ? 'text-red-300' : p.status === 'completed' ? 'text-emerald-400' : p.status === 'paused' ? 'text-yellow-300' : 'text-blue-300'}">
              ${escapeHtml(statusProcessoV103(p.status))}
            </div>
          </div>
          <div class="mlhub-process-bar-track-v103"><div class="mlhub-process-bar-v103" style="width:${pct}%"></div></div>
        </div>`;
    }).join('')
    : '<div class="p-3 text-[10px] text-slate-600">Os processos em andamento aparecerão aqui.</div>';
}

function registrarProcessoLocalV103(tipo, { status = 'running', atual = 0, total = 0, mensagem = '' } = {}) {
  processosLocaisV103.set(`local:${tipo}`, {
    id: `local:${tipo}`,
    type: tipo,
    status,
    atual: Number(atual || 0),
    total: Number(total || 0),
    mensagem: String(mensagem || ''),
    updated_at: Date.now(),
    server_job: false
  });
  atualizarProcessCenterV103();
}

async function carregarJobsRecentesV103() {
  if (typeof obterToken !== 'function' || !obterToken()) return;
  try {
    const r = await fetch(`${RENDER_URL}/api/v103/jobs/recent?limit=8&_=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: obterToken() }
    });
    if (!r.ok) return; // Silencia erros de banco para não afetar a interface
    const d = await r.json().catch(() => ({}));

    for (const j of (d.jobs || [])) {
      processosLocaisV103.set(`server:${j.id}`, {
        id: String(j.id),
        type: String(j.type || 'job'),
        status: String(j.status || ''),
        atual: Number(j.progress_current || j.processed || 0),
        total: Number(j.progress_total || 0),
        mensagem: String(j.message || ''),
        updated_at: new Date(j.updated_at || Date.now()).getTime(),
        server_job: true
      });
    }
    atualizarProcessCenterV103();
  } catch (e) {}
}

const atualizarProgressoAnteriorV103 = window.atualizarProgressoV26;
window.atualizarProgressoV26 = function (tipo, obj = {}) {
  if (typeof atualizarProgressoAnteriorV103 === 'function') {
    atualizarProgressoAnteriorV103(tipo, obj);
  }
  registrarProcessoLocalV103(tipo, {
    status: obj.status || 'running',
    atual: obj.atual || 0,
    total: obj.total || 0,
    mensagem: obj.mensagem || ''
  });
};

window.abrirDbCacheV32 = function () {
  if (window.dbCachePromiseV32) return window.dbCachePromiseV32;

  window.dbCachePromiseV32 = new Promise((resolve, reject) => {
    const req = indexedDB.open(typeof CACHE_DB_V32 !== 'undefined' ? CACHE_DB_V32 : 'mlhub_cache_v32', 4);

    req.onupgradeneeded = () => {
      const db = req.result;
      const storeItens = typeof STORE_ITENS_V32 !== 'undefined' ? STORE_ITENS_V32 : 'itens';
      const storeMeta = typeof STORE_META_V32 !== 'undefined' ? STORE_META_V32 : 'meta';
      const storeSeen = typeof STORE_SEEN_V85 !== 'undefined' ? STORE_SEEN_V85 : 'seen';
      const storePersist = typeof STORE_PERSISTENTE_V90 !== 'undefined' ? STORE_PERSISTENTE_V90 : 'persistente';

      if (!db.objectStoreNames.contains(storeItens)) db.createObjectStore(storeItens, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(storeMeta)) db.createObjectStore(storeMeta, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(storeSeen)) db.createObjectStore(storeSeen, { keyPath: 'id' });

      let st;
      if (!db.objectStoreNames.contains(storePersist)) {
        st = db.createObjectStore(storePersist, { keyPath: 'cache_key' });
      } else {
        st = req.transaction.objectStore(storePersist);
      }

      if (!st.indexNames.contains('seller_id')) st.createIndex('seller_id', 'seller_id', { unique: false });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro ao abrir cache local.'));
  });

  return window.dbCachePromiseV32;
};

async function idbCountSellerV103(sellerId) {
  const db = await abrirDbCacheV32();
  const storePersist = typeof STORE_PERSISTENTE_V90 !== 'undefined' ? STORE_PERSISTENTE_V90 : 'persistente';
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storePersist, 'readonly');
    const idx = tx.objectStore(storePersist).index('seller_id');
    const req = idx.count(IDBKeyRange.only(String(sellerId)));
    req.onsuccess = () => resolve(Number(req.result || 0));
    req.onerror = () => reject(req.error);
  });
}

async function paginaIndexedDbGestaoV103({ sellerId, page = 1, limit = 50, q = '', status = '' } = {}) {
  const seller = String(sellerId || '').trim();
  const busca = String(q || '').trim().toLowerCase();
  const offset = Math.max(0, (Math.max(1, Number(page || 1)) - 1) * limit);
  const db = await abrirDbCacheV32();
  const storePersist = typeof STORE_PERSISTENTE_V90 !== 'undefined' ? STORE_PERSISTENTE_V90 : 'persistente';

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storePersist, 'readonly');
    const st = tx.objectStore(storePersist);
    const sellerIdx = st.index('seller_id');
    const range = IDBKeyRange.only(seller);

    const itens = [];
    let total = 0;
    let matchIndex = 0;

    const req = sellerIdx.openCursor(range, 'next');

    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        return resolve({
          itens,
          total,
          paginas: Math.max(1, Math.ceil(total / limit))
        });
      }

      const item = cursor.value;
      const okStatus = !status || String(item.status || '') === String(status);
      const okBusca = !busca ||
        String(item.id || '').toLowerCase().includes(busca) ||
        String(item.sku || '').toLowerCase().includes(busca) ||
        String(item.title || '').toLowerCase().includes(busca);

      if (okStatus && okBusca) {
        if (matchIndex >= offset && itens.length < limit) {
          itens.push(item);
        }
        matchIndex++;
        total++;
      }

      cursor.continue();
    };

    req.onerror = () => reject(req.error);
  });
}

// GESTÃO LOCAL INSTANTÂNEA E PROTEGIDA CONTRA QUEDAS DE BANCO
window.v88CarregarGestaoLocal = async function (page = 1, { silencioso = false } = {}) {
  if (typeof gestaoCarregando !== 'undefined' && gestaoCarregando) return;
  if (typeof gestaoCarregando !== 'undefined') gestaoCarregando = true;

  if (!silencioso && typeof mostrarLoading === 'function') {
    mostrarLoading('Carregando dados salvos...');
  }

  try {
    const seller = await sellerAtivoV90();
    
    const local = await paginaIndexedDbGestaoV103({
      sellerId: seller,
      page,
      limit: MLHUB_SCALE_PAGE_V103,
      q: typeof gestaoBusca !== 'undefined' ? gestaoBusca : '',
      status: typeof gestaoStatusV76 !== 'undefined' ? gestaoStatusV76 : ''
    });

    const totalConta = await idbCountSellerV103(seller).catch(() => local.total || 0);

    if (typeof gestaoPagina !== 'undefined') gestaoPagina = Math.max(1, Number(page || 1));
    if (typeof gestaoTotalFiltro !== 'undefined') gestaoTotalFiltro = Number(local.total || 0);
    if (typeof gestaoPaginas !== 'undefined') gestaoPaginas = Math.max(1, Number(local.paginas || 1));

    if (typeof cacheItens !== 'undefined') {
      cacheItens = (local.itens || []).map(x => typeof normalizarItemEscala === 'function' ? normalizarItemEscala(x) : x);
    }

    if (typeof masterMapV32 !== 'undefined') {
      masterMapV32 = new Map((cacheItens || []).map(x => [String(x.id), x]));
    }
    if (typeof masterAnunciosV32 !== 'undefined') {
      masterAnunciosV32 [...(cacheItens || [])];
    }
    if (typeof masterCarregadoV32 !== 'undefined') {
      masterCarregadoV32 = false;
    }

    if (typeof montarTabelaGestao === 'function' && cacheItens) {
      montarTabelaGestao(cacheItens);
    }

    const tl = document.getElementById('total-listado');
    if (tl) tl.innerText = totalConta.toLocaleString('pt-BR');

    if (typeof atualizarPaginacaoGestao === 'function') {
      atualizarPaginacaoGestao();
    }

    const info = document.getElementById('gestao-paginacao-info');
    if (info) {
      info.textContent = `${(local.total || 0).toLocaleString('pt-BR')} resultado(s) · cache local instantâneo`;
    }
  } catch (e) {
    console.error('[GESTÃO LOCAL ERROR]', e);
  } finally {
    if (typeof gestaoCarregando !== 'undefined') gestaoCarregando = false;
    if (typeof esconderLoading === 'function') {
      esconderLoading();
    }
  }
};
window.carregarGestaoEscala = window.v88CarregarGestaoLocal;

window.aplicarMudancasV32 = async function (itens) {
  if (!Array.isArray(itens) || !itens.length) return 0;
  const seller = String(itens.find(x => x?._seller_id)?._seller_id || await sellerAtivoV90() || '');
  if (typeof idbSalvarItensV32 === 'function') {
    await idbSalvarItensV32(itens.map(x => ({ ...x, _seller_id: seller })));
  }
  return itens.length;
};

document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('mlhub_sidebar_v103') === '1') {
    document.body.classList.add('mlhub-sidebar-collapsed');
  }

  atualizarProcessCenterV103();
  carregarJobsRecentesV103();
  processosServerTimerV103 = setInterval(carregarJobsRecentesV103, 10000);
});
```[cite: 37, 41, 42]
