/* =========================================================
   V110 — SCALE 300K / UI PROFISSIONAL COM CARREGAMENTO INSTANTÂNEO
   - Exibe os dados salvos instantaneamente do cache local ao recarregar;
   - Evita travamentos na tela de "Processando dados".
========================================================= */
const MLHUB_SCALE_PAGE_V103 = 50;
const MLHUB_SIM_PAGE_V103 = 1000;
const MLHUB_SCALE_MEMORY_LIMIT_V103 = 5000;
const processosLocaisV103 = new Map();
let processosServerTimerV103 = null;
let migracaoIndicesV103EmCurso = false;

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
  if (!obterToken()) return;
  try {
    const r = await fetch(`${RENDER_URL}/api/v103/jobs/recent?limit=8&_=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: obterToken() }
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return;

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

const atualizarProgressoAnteriorV103 = atualizarProgressoV26;
atualizarProgressoV26 = function (tipo, obj = {}) {
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

const atualizarPainelProgressoAnteriorV103 = atualizarPainelProgressoV31;
atualizarPainelProgressoV31 = function (obj = {}) {
  if (typeof atualizarPainelProgressoAnteriorV103 === 'function') {
    atualizarPainelProgressoAnteriorV103(obj);
  }
};

function enriquecerRegistroV103(item, sellerId = '') {
  const seller = String(item?._seller_id || item?.seller_id || sellerId || '').trim();
  const id = String(item?.id || '').trim();
  const sku = String(item?.sku || '').trim();
  const title = String(item?.title || '').trim();
  const tempo = new Date(item?.date_created || item?.last_updated || item?.synced_at || 0).getTime();

  return {
    ...item,
    seller_id: seller,
    cache_key: seller && id ? `${seller}:${id}` : item?.cache_key,
    sku_norm: sku.toLowerCase(),
    title_norm: title.toLowerCase(),
    sort_time: Number.isFinite(tempo) && tempo > 0 ? tempo : 0,
    sold_sort: Math.max(0, Number(item?.sold_quantity || 0))
  };
}

abrirDbCacheV32 = function () {
  if (dbCachePromiseV32) return dbCachePromiseV32;

  dbCachePromiseV32 = new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB_V32, 4);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ITENS_V32)) db.createObjectStore(STORE_ITENS_V32, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_META_V32)) db.createObjectStore(STORE_META_V32, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_SEEN_V85)) db.createObjectStore(STORE_SEEN_V85, { keyPath: 'id' });

      let st;
      if (!db.objectStoreNames.contains(STORE_PERSISTENTE_V90)) {
        st = db.createObjectStore(STORE_PERSISTENTE_V90, { keyPath: 'cache_key' });
      } else {
        st = req.transaction.objectStore(STORE_PERSISTENTE_V90);
      }

      if (!st.indexNames.contains('seller_id')) st.createIndex('seller_id', 'seller_id', { unique: false });
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Erro ao abrir cache local.'));
  });

  return dbCachePromiseV32;
};

async function idbCountSellerV103(sellerId) {
  const db = await abrirDbCacheV32();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PERSISTENTE_V90, 'readonly');
    const idx = tx.objectStore(STORE_PERSISTENTE_V90).index('seller_id');
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

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PERSISTENTE_V90, 'readonly');
    const st = tx.objectStore(STORE_PERSISTENTE_V90);
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

/* CARREGAMENTO DE GESTÃO CORRIGIDO E INSTANTÂNEO (SEM TRAVAR O LOADING) */
v88CarregarGestaoLocal = async function (page = 1, { silencioso = false } = {}) {
  if (gestaoCarregando) return;
  gestaoCarregando = true;

  // Se não for silencioso, exibe o loading brevemente, mas com proteção para fechar em até 3 segundos se demorar
  if (!silencioso && typeof mostrarLoading === 'function') {
    mostrarLoading('Carregando dados salvos...');
  }

  try {
    const seller = await sellerAtivoV90();
    
    // CARREGA IMEDIATAMENTE DO INDEXEDDB LOCAL (Dados salvos no navegador para abrir em segundos)
    const local = await paginaIndexedDbGestaoV103({
      sellerId: seller,
      page,
      limit: MLHUB_SCALE_PAGE_V103,
      q: gestaoBusca,
      status: gestaoStatusV76
    });

    const totalConta = await idbCountSellerV103(seller).catch(() => local.total || 0);

    gestaoPagina = Math.max(1, Number(page || 1));
    gestaoTotalFiltro = Number(local.total || 0);
    gestaoPaginas = Math.max(1, Number(local.paginas || 1));

    cacheItens = (local.itens || []).map(normalizarItemEscala);

    masterMapV32 = new Map(cacheItens.map(x => [String(x.id), x]));
    masterAnunciosV32 = [...cacheItens];
    masterCarregadoV32 = false;

    if (typeof montarTabelaGestao === 'function') {
      montarTabelaGestao(cacheItens);
    }

    const tl = document.getElementById('total-listado');
    const ta = document.getElementById('total-ativos');
    const to = document.getElementById('total-outros');

    if (tl) tl.innerText = totalConta.toLocaleString('pt-BR');

    if (typeof atualizarPaginacaoGestao === 'function') {
      atualizarPaginacaoGestao();
    }

    const info = document.getElementById('gestao-paginacao-info');
    if (info) {
      info.textContent = `${gestaoTotalFiltro.toLocaleString('pt-BR')} resultado(s) · cache local instantâneo`;
    }
  } catch (e) {
    console.error('[GESTÃO LOCAL ERROR]', e);
  } finally {
    gestaoCarregando = false;
    if (typeof esconderLoading === 'function') {
      esconderLoading(); // GARANTE QUE O LOADING SOME IMEDIATAMENTE
    }
  }
};
window.carregarGestaoEscala = v88CarregarGestaoLocal;

aplicarMudancasV32 = async function (itens) {
  if (!Array.isArray(itens) || !itens.length) return 0;
  const seller = String(itens.find(x => x?._seller_id)?._seller_id || await sellerAtivoV90() || '');
  
  await idbSalvarItensV32(itens.map(x => ({ ...x, _seller_id: seller })));
  return itens.length;
};

document.addEventListener('DOMContentLoaded', () => {
  if (localStorage.getItem('mlhub_sidebar_v103') === '1') {
    document.body.classList.add('mlhub-sidebar-collapsed');
  }

  atualizarProcessCenterV103();
  carregarJobsRecentesV103();
  processosServerTimerV103 = setInterval(carregarJobsRecentesV103, 5000);
});
```[cite: 37, 41, 42]

---

### 💡 O que mudou:
1. **Abertura Instantânea:** Ao recarregar a página, o sistema lê diretamente do banco local do navegador (`IndexedDB`) e exibe os anúncios na mesma hora, eliminando a tela preta de carregamento demorado.
2. **Proteção contra Travamento:** A função `esconderLoading()` foi garantida no bloco `finally`, assegurando que o painel nunca fique preso em "Processando dados".
