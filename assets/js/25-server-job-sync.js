/* =========================================================
   V109 — SYNC ULTRARÁPIDA COM ESPELHAMENTO DE PROGRESSO COMPLETO
   - Atualiza tanto a central flutuante quanto a barra superior;
   - UPSERT incremental e remoção automática de excluídos.
========================================================= */

let mlHubSyncAnunciosV109Ativo = false;
let mlHubSyncAnunciosV109Timer = null;

function renderizarProgressoSuperiorV109({ status, atual, total, mensagem }) {
  // Atualiza elementos de progresso na interface superior se existirem
  const barraEl = document.getElementById('barra-progresso-anuncios');
  const textoEl = document.getElementById('texto-progresso-anuncios');
  
  if (barraEl && total > 0) {
    const pct = Math.min(100, Math.max(0, Math.round((atual / total) * 100)));
    barraEl.style.width = `${pct}%`;
  }

  // Atualiza também via o mecanismo padrão do painel se disponível
  if (typeof atualizarProgressoV26 === 'function') {
    atualizarProgressoV26('anuncios', { status, atual, total, mensagem });
  }
}

async function acompanharAnunciosV109(jobId) {
  clearTimeout(mlHubSyncAnunciosV109Timer);

  try {
    const controller = new AbortController();
    const requestTimer = setTimeout(() => controller.abort(), 10000);
    let r;
    try {
      r = await fetch(
        `${RENDER_URL}/api/scale/jobs/${encodeURIComponent(jobId)}?_=${Date.now()}`,
        {
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            Authorization: obterToken(),
            Accept: 'application/json'
          }
        }
      );
    } finally {
      clearTimeout(requestTimer);
    }

    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);

    const j = d.job || {};
    const atual = Number(j.progress_current || j.processed || 0);
    const total = Number(j.progress_total || 0);
    const statusJob = j.status || 'running';
    const mensagem = j.message || `Sincronizando anúncios em lotes de 1.000 · ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}`;

    // Atualiza a barra superior e a central flutuante simultaneamente
    renderizarProgressoSuperiorV109({ status: statusJob, atual, total, mensagem });

    // Atualiza a tabela da Gestão incrementalmente conforme os lotes chegam
    if (atual > 0 && typeof v88CarregarGestaoLocal === 'function') {
      try {
        await v88CarregarGestaoLocal(1, { silencioso: true });
      } catch (e) {}
    }

    if (['queued', 'running'].includes(String(statusJob))) {
      mlHubSyncAnunciosV109Timer = setTimeout(
        () => acompanharAnunciosV109(jobId),
        1200
      );
      return;
    }

    if (statusJob === 'completed') {
      localStorage.removeItem('mlHubPro_sync_v105_anuncios');
      localStorage.removeItem('mlHubPro_sync_v26_anuncios');

      renderizarProgressoSuperiorV109({
        status: 'completed',
        atual,
        total,
        mensagem: j.message || 'Sincronização concluída com sucesso!'
      });

      try {
        await v88CarregarGestaoLocal(1, { silencioso: true });
      } catch (e) {}

      mlHubSyncAnunciosV109Ativo = false;
      return;
    }

    if (statusJob === 'failed') {
      renderizarProgressoSuperiorV109({
        status: 'queued',
        atual,
        total,
        mensagem: (j.message || 'Sincronização pausada.') + ' · Clique em Puxar anúncios para continuar.'
      });

      mlHubSyncAnunciosV109Ativo = false;
      return;
    }

    mlHubSyncAnunciosV109Ativo = false;
  } catch (e) {
    mlHubSyncAnunciosV109Ativo = false;
    renderizarProgressoSuperiorV109({
      status: 'queued',
      mensagem: 'Sincronização pausada por instabilidade de rede. Clique em Puxar anúncios para retomar.'
    });
  }
}

async function puxarAnunciosV105({ retomarAutomatico = false } = {}) {
  if (mlHubSyncAnunciosV109Ativo) return;

  const token = obterToken();
  if (!token) {
    solicitarToken();
    return;
  }

  mlHubSyncAnunciosV109Ativo = true;

  try { syncV88Abortar = true; } catch (e) {}

  renderizarProgressoSuperiorV109({
    status: 'queued',
    atual: 0,
    total: 0,
    mensagem: 'Conectando ao worker para sincronização em lotes simultâneos...'
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    let r;
    try {
      r = await fetch(`${RENDER_URL}/api/scale/sync-fast?_=${Date.now()}`, {
        method: 'POST',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          batch_size: 1000,
          incremental: true,
          clean_removed: true
        })
      });
    } finally {
      clearTimeout(timer);
    }

    const d = await r.json().catch(() => ({}));

    if (!r.ok) {
      if (r.status === 401 || r.status === 409) {
        throw new Error(d.erro || 'Sessão expirada ou conexão com o Mercado Livre indisponível. Reconecte a conta.');
      }
      throw new Error(d.erro || `HTTP ${r.status}`);
    }

    const jobId = Number(d.job?.id || 0);
    if (!jobId) throw new Error('O servidor não retornou o ID do job de sincronização.');

    localStorage.setItem('mlHubPro_sync_v105_anuncios', String(jobId));
    localStorage.removeItem('mlHubPro_sync_v26_anuncios');

    renderizarProgressoSuperiorV109({
      status: d.job?.status || 'queued',
      atual: Number(d.job?.progress_current || 0),
      total: Number(d.job?.progress_total || 0),
      mensagem: d.mensagem || d.job?.message || 'Sincronização iniciada em lotes de 1.000...'
    });

    acompanharAnunciosV109(jobId);
  } catch (e) {
    mlHubSyncAnunciosV109Ativo = false;
    const msg = String(e?.message || e || '');
    renderizarProgressoSuperiorV109({
      status: 'queued',
      mensagem: msg
    });

    if (!retomarAutomatico) {
      if (/sessão|reconecte|401|token/i.test(msg)) {
        try { solicitarToken(); } catch (_) {}
      }
      alert(msg);
    }
  }
}

// Compatibilidade total com os botões e atalhos do sistema
window.puxarAnunciosV105 = puxarAnunciosV105;
window.sincronizarAnunciosDiretoV88 = puxarAnunciosV105;
window.puxarNovosAnuncios = () => puxarAnunciosV105();

// Retomada automática segura após refresh
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(async () => {
    try {
      const jobId = Number(
        localStorage.getItem('mlHubPro_sync_v105_anuncios') ||
        localStorage.getItem('mlHubPro_sync_v26_anuncios') ||
        0
      );

      if (jobId && obterToken()) {
        mlHubSyncAnunciosV109Ativo = true;
        acompanharAnunciosV109(jobId);
      }
    } catch (e) {}
  }, 1100);
});
