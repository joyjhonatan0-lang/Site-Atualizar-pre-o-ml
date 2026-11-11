/* =========================================================
   V115 — SYNC ULTRARÁPIDA COM TOLERÂNCIA A FALHAS DE REDE/HTTP 404
   - Trata erros de servidor e quedas de banco de forma silenciosa;
   - Realiza novas tentativas automáticas sem exibir alertas incômodos.
========================================================= */

let mlHubSyncAnunciosV115Ativo = false;
let mlHubSyncAnunciosV115Timer = null;

function renderizarProgressoSuperiorV115({ status, atual, total, mensagem }) {
  const barraEl = document.getElementById('barra-progresso-anuncios');
  
  if (barraEl && total > 0) {
    const pct = Math.min(100, Math.max(0, Math.round((atual / total) * 100)));
    barraEl.style.width = `${pct}%`;
  }

  if (typeof atualizarProgressoV26 === 'function') {
    atualizarProgressoV26('anuncios', { status, atual, total, mensagem });
  }
}

async function acompanharAnunciosV115(jobId) {
  clearTimeout(mlHubSyncAnunciosV115Timer);

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
      // Se der 404 ou instabilidade temporária, apenas aguarda e tenta de novo sem crashar
      if (r.status === 404 || r.status >= 500) {
        mlHubSyncAnunciosV115Timer = setTimeout(() => acompanharAnunciosV115(jobId), 3000);
        return;
      }
      throw new Error(`HTTP ${r.status}`);
    }

    const d = await r.json().catch(() => ({}));
    const j = d.job || {};
    const atual = Number(j.progress_current || j.processed || 0);
    const total = Number(j.progress_total || 0);
    const statusJob = j.status || 'running';
    const mensagem = j.message || `Sincronizando anúncios em lotes de 1.000 · ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}`;

    renderizarProgressoSuperiorV115({ status: statusJob, atual, total, mensagem });

    if (atual > 0 && typeof v88CarregarGestaoLocal === 'function') {
      try {
        await v88CarregarGestaoLocal(1, { silencioso: true });
      } catch (e) {}
    }

    if (['queued', 'running'].includes(String(statusJob))) {
      mlHubSyncAnunciosV115Timer = setTimeout(
        () => acompanharAnunciosV115(jobId),
        1500
      );
      return;
    }

    if (statusJob === 'completed') {
      localStorage.removeItem('mlHubPro_sync_v105_anuncios');
      localStorage.removeItem('mlHubPro_sync_v26_anuncios');

      renderizarProgressoSuperiorV115({
        status: 'completed',
        atual,
        total,
        mensagem: j.message || 'Sincronização concluída com sucesso!'
      });

      try {
        await v88CarregarGestaoLocal(1, { silencioso: true });
      } catch (e) {}

      mlHubSyncAnunciosV115Ativo = false;
      return;
    }

    if (statusJob === 'failed') {
      renderizarProgressoSuperiorV115({
        status: 'queued',
        atual,
        total,
        mensagem: 'Servidor reconectando ao banco de dados. Tentando novamente...'
      });

      // Tenta retomar automaticamente após falha de conexão do banco
      setTimeout(() => puxarAnunciosV105({ retomarAutomatico: true }), 4000);
      return;
    }

    mlHubSyncAnunciosV115Ativo = false;
  } catch (e) {
    // Erros de rede/404 são tratados de forma resiliente em segundo plano
    mlHubSyncAnunciosV115Timer = setTimeout(() => acompanharAnunciosV115(jobId), 4000);
  }
}

async function puxarAnunciosV105({ retomarAutomatico = false } = {}) {
  if (mlHubSyncAnunciosV115Ativo && !retomarAutomatico) return;

  const token = obterToken();
  if (!token) {
    if (!retomarAutomatico) solicitarToken();
    return;
  }

  mlHubSyncAnunciosV115Ativo = true;

  renderizarProgressoSuperiorV115({
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
      // Se o banco caiu no Render (404 ou 500), aguarda 5 segundos e tenta de novo automaticamente
      if (r.status === 404 || r.status >= 500) {
        renderizarProgressoSuperiorV115({
          status: 'queued',
          mensagem: 'Banco acordando no Render. Tentando reconectar em instantes...'
        });
        mlHubSyncAnunciosV115Ativo = false;
        setTimeout(() => puxarAnunciosV105({ retomarAutomatico: true }), 5000);
        return;
      }
      throw new Error(d.erro || `HTTP ${r.status}`);
    }

    const jobId = Number(d.job?.id || 0);
    if (!jobId) {
      // Se não retornou ID mas deu ok, tenta recarregar a gestão local
      mlHubSyncAnunciosV115Ativo = false;
      if (typeof v88CarregarGestaoLocal === 'function') {
        await v88CarregarGestaoLocal(1, { silencioso: true });
      }
      return;
    }

    localStorage.setItem('mlHubPro_sync_v105_anuncios', String(jobId));
    localStorage.removeItem('mlHubPro_sync_v26_anuncios');

    renderizarProgressoSuperiorV115({
      status: d.job?.status || 'queued',
      atual: Number(d.job?.progress_current || 0),
      total: Number(d.job?.progress_total || 0),
      mensagem: d.mensagem || d.job?.message || 'Sincronização iniciada em lotes de 1.000...'
    });

    acompanharAnunciosV115(jobId);
  } catch (e) {
    mlHubSyncAnunciosV115Ativo = false;
    
    // Tenta novamente de forma automática caso o servidor esteja inicializando no Render
    setTimeout(() => {
      if (!mlHubSyncAnunciosV115Ativo) {
        puxarAnunciosV105({ retomarAutomatico: true });
      }
    }, 6000);
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
        mlHubSyncAnunciosV115Ativo = true;
        acompanharAnunciosV115(jobId);
      }
    } catch (e) {}
  }, 1100);
});
