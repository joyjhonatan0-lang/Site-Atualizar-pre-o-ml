/* =========================================================
   V118 — SYNC ULTRARÁPIDA COM SALVAMENTO E FEEDBACK EM TEMPO REAL
   - Processamento em lotes de 1.000 no servidor;
   - Atualização e renderização instantânea da tabela a cada lote concluído;
   - UPSERT incremental e Soft Delete automático.
========================================================= */

let mlHubSyncAnunciosV118Ativo = false;
let mlHubSyncAnunciosV118Timer = null;
let ultimoProcessadoV118 = -1;

function renderizarProgressoSuperiorV118({ status, atual, total, mensagem }) {
  const barraEl = document.getElementById('barra-progresso-anuncios');
  
  if (barraEl && total > 0) {
    const pct = Math.min(100, Math.max(0, Math.round((atual / total) * 100)));
    barraEl.style.width = `${pct}%`;
  }

  if (typeof atualizarProgressoV26 === 'function') {
    atualizarProgressoV26('anuncios', { status, atual, total, mensagem });
  }
}

async function acompanharAnunciosV118(jobId) {
  clearTimeout(mlHubSyncAnunciosV118Timer);

  try {
    const r = await fetch(
      `${RENDER_URL}/api/scale/jobs/${encodeURIComponent(jobId)}?_=${Date.now()}`,
      {
        cache: 'no-store',
        headers: {
          Authorization: obterToken() || '',
          Accept: 'application/json'
        }
      }
    );

    if (!r.ok) {
      if (r.status === 404 || r.status >= 500) {
        mlHubSyncAnunciosV118Timer = setTimeout(() => acompanharAnunciosV118(jobId), 2000);
        return;
      }
      throw new Error(`HTTP ${r.status}`);
    }

    const d = await r.json().catch(() => ({}));
    const j = d.job || {};
    const atual = Number(j.progress_current || j.processed || 0);
    const total = Number(j.progress_total || 0);
    const statusJob = j.status || 'running';
    const mensagem = j.message || `Salvando lotes em tempo real · ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} anúncios`;

    renderizarProgressoSuperiorV118({ status: statusJob, atual, total, mensagem });

    // Se novos itens foram salvos no lote pelo servidor, atualiza a tela na hora em tempo real
    if (atual !== ultimoProcessadoV118) {
      ultimoProcessadoV118 = atual;
      if (typeof v88CarregarGestaoLocal === 'function') {
        try {
          await v88CarregarGestaoLocal(1, { silencioso: true });
        } catch (e) {}
      }
    }

    if (['queued', 'running'].includes(String(statusJob))) {
      // Polling agressivo de 800ms para feedback instantâneo na tela
      mlHubSyncAnunciosV118Timer = setTimeout(
        () => acompanharAnunciosV118(jobId),
        800
      );
      return;
    }

    if (statusJob === 'completed') {
      localStorage.removeItem('mlHubPro_sync_v105_anuncios');
      localStorage.removeItem('mlHubPro_sync_v26_anuncios');

      renderizarProgressoSuperiorV118({
        status: 'completed',
        atual,
        total,
        mensagem: j.message || 'Sincronização em tempo real concluída com sucesso!'
      });

      if (typeof v88CarregarGestaoLocal === 'function') {
        try { await v88CarregarGestaoLocal(1, { silencioso: true }); } catch (e) {}
      }

      mlHubSyncAnunciosV118Ativo = false;
      ultimoProcessadoV118 = -1;
      return;
    }

    if (statusJob === 'failed') {
      renderizarProgressoSuperiorV118({
        status: 'queued',
        atual,
        total,
        mensagem: 'Sincronizadork pausado. Retomando automaticamente...'
      });

      mlHubSyncAnunciosV118Ativo = false;
      setTimeout(() => puxarAnunciosV105({ retomarAutomatico: true }), 3000);
      return;
    }

    mlHubSyncAnunciosV118Ativo = false;
  } catch (e) {
    mlHubSyncAnunciosV118Timer = setTimeout(() => acompanharAnunciosV118(jobId), 2500);
  }
}

async function puxarAnunciosV105({ retomarAutomatico = false } = {}) {
  if (mlHubSyncAnunciosV118Ativo && !retomarAutomatico) return;

  const token = obterToken();
  if (!token) {
    if (!retomarAutomatico && typeof solicitarToken === 'function') {
      solicitarToken();
    }
    return;
  }

  mlHubSyncAnunciosV118Ativo = true;
  ultimoProcessadoV118 = -1;

  renderizarProgressoSuperiorV118({
    status: 'queued',
    atual: 0,
    total: 0,
    mensagem: 'Conectando ao worker para salvamento em tempo real (lotes de 1.000)...'
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
      if (r.status === 401 || r.status === 403) {
        mlHubSyncAnunciosV118Ativo = false;
        renderizarProgressoSuperiorV118({
          status: 'queued',
          mensagem: 'Sessão expirada. Reconecte a conta do Mercado Livre.'
        });
        if (typeof solicitarToken === 'function') solicitarToken();
        return;
      }

      if (r.status === 404 || r.status >= 500) {
        renderizarProgressoSuperiorV118({
          status: 'queued',
          mensagem: 'Servidor aquecendo no Render. Tentando novamente...'
        });
        mlHubSyncAnunciosV118Ativo = false;
        setTimeout(() => puxarAnunciosV105({ retomarAutomatico: true }), 4000);
        return;
      }

      throw new Error(d.erro || `HTTP ${r.status}`);
    }

    const jobId = Number(d.job?.id || 0);
    if (!jobId) {
      mlHubSyncAnunciosV118Ativo = false;
      if (typeof v88CarregarGestaoLocal === 'function') {
        await v88CarregarGestaoLocal(1, { silencioso: true });
      }
      return;
    }

    localStorage.setItem('mlHubPro_sync_v105_anuncios', String(jobId));
    localStorage.removeItem('mlHubPro_sync_v26_anuncios');

    renderizarProgressoSuperiorV118({
      status: d.job?.status || 'queued',
      atual: Number(d.job?.progress_current || 0),
      total: Number(d.job?.progress_total || 0),
      mensagem: d.mensagem || d.job?.message || 'Sincronização em tempo real iniciada...'
    });

    acompanharAnunciosV118(jobId);
  } catch (e) {
    mlHubSyncAnunciosV118Ativo = false;
    setTimeout(() => {
      if (!mlHubSyncAnunciosV118Ativo) {
        puxarAnunciosV105({ retomarAutomatico: true });
      }
    }, 4000);
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

      if (jobId && typeof obterToken === 'function' && obterToken()) {
        mlHubSyncAnunciosV118Ativo = true;
        acompanharAnunciosV118(jobId);
      }
    } catch (e) {}
  }, 1100);
});
