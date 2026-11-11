/* =========================================================
   V113 — SYNC ULTRARÁPIDA SEM ABORT (CORREÇÃO DEFINITIVA)
   - Elimina qualquer cancelamento de sinal (AbortController);
   - Comunicação limpa e direta com o worker do servidor.
========================================================= */

let mlHubSyncAnunciosV113Ativo = false;
let mlHubSyncAnunciosV113Timer = null;

function renderizarProgressoSuperiorV113({ status, atual, total, mensagem }) {
  const barraEl = document.getElementById('barra-progresso-anuncios');
  
  if (barraEl && total > 0) {
    const pct = Math.min(100, Math.max(0, Math.round((atual / total) * 100)));
    barraEl.style.width = `${pct}%`;
  }

  if (typeof atualizarProgressoV26 === 'function') {
    atualizarProgressoV26('anuncios', { status, atual, total, mensagem });
  }
}

async function acompanharAnunciosV113(jobId) {
  clearTimeout(mlHubSyncAnunciosV113Timer);

  try {
    const r = await fetch(
      `${RENDER_URL}/api/scale/jobs/${encodeURIComponent(jobId)}?_=${Date.now()}`,
      {
        cache: 'no-store',
        headers: {
          Authorization: obterToken(),
          Accept: 'application/json'
        }
      }
    );

    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);

    const j = d.job || {};
    const atual = Number(j.progress_current || j.processed || 0);
    const total = Number(j.progress_total || 0);
    const statusJob = j.status || 'running';
    const mensagem = j.message || `Sincronizando anúncios em lotes de 1.000 · ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}`;

    renderizarProgressoSuperiorV113({ status: statusJob, atual, total, mensagem });

    if (atual > 0 && typeof v88CarregarGestaoLocal === 'function') {
      try {
        await v88CarregarGestaoLocal(1, { silencioso: true });
      } catch (e) {}
    }

    if (['queued', 'running'].includes(String(statusJob))) {
      mlHubSyncAnunciosV113Timer = setTimeout(
        () => acompanharAnunciosV113(jobId),
        1500
      );
      return;
    }

    if (statusJob === 'completed') {
      localStorage.removeItem('mlHubPro_sync_v105_anuncios');
      localStorage.removeItem('mlHubPro_sync_v26_anuncios');

      renderizarProgressoSuperiorV113({
        status: 'completed',
        atual,
        total,
        mensagem: j.message || 'Sincronização concluída com sucesso!'
      });

      try {
        await v88CarregarGestaoLocal(1, { silencioso: true });
      } catch (e) {}

      mlHubSyncAnunciosV113Ativo = false;
      return;
    }

    if (statusJob === 'failed') {
      renderizarProgressoSuperiorV113({
        status: 'queued',
        atual,
        total,
        mensagem: (j.message || 'Sincronização pausada.') + ' · Clique em Puxar anúncios para continuar.'
      });

      mlHubSyncAnunciosV113Ativo = false;
      return;
    }

    mlHubSyncAnunciosV113Ativo = false;
  } catch (e) {
    mlHubSyncAnunciosV113Ativo = false;
    renderizarProgressoSuperiorV113({
      status: 'queued',
      mensagem: 'Reconectando ao servidor...'
    });
  }
}

async function puxarAnunciosV105({ retomarAutomatico = false } = {}) {
  if (mlHubSyncAnunciosV113Ativo) return;

  const token = obterToken();
  if (!token) {
    solicitarToken();
    return;
  }

  mlHubSyncAnunciosV113Ativo = true;

  try { 
    if (typeof syncV88Abortar !== 'undefined') syncV88Abortar = true; 
  } catch (e) {}

  renderizarProgressoSuperiorV113({
    status: 'queued',
    atual: 0,
    total: 0,
    mensagem: 'Conectando ao worker para sincronização em lotes simultâneos...'
  });

  try {
    const r = await fetch(`${RENDER_URL}/api/scale/sync-fast?_=${Date.now()}`, {
      method: 'POST',
      cache: 'no-store',
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

    renderizarProgressoSuperiorV113({
      status: d.job?.status || 'queued',
      atual: Number(d.job?.progress_current || 0),
      total: Number(d.job?.progress_total || 0),
      mensagem: d.mensagem || d.job?.message || 'Sincronização iniciada em lotes de 1.000...'
    });

    acompanharAnunciosV113(jobId);
  } catch (e) {
    mlHubSyncAnunciosV113Ativo = false;
    let msg = String(e?.message || e || '');

    // Trata qualquer erro de rede sem exibir avisos de aborto na tela
    if (/aborted|signal/i.test(msg)) {
      msg = 'Servidor processando a solicitação...';
    }

    renderizarProgressoSuperiorV113({
      status: 'queued',
      mensagem: msg
    });

    if (!retomarAutomatico && !/aborted|signal/i.test(String(e?.message || ''))) {
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
        mlHubSyncAnunciosV113Ativo = true;
        acompanharAnunciosV113(jobId);
      }
    } catch (e) {}
  }, 1100);
});
