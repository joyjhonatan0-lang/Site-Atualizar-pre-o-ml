/* =========================================================
   V108 — SYNC ULTRARÁPIDA COM UPSERT INCREMENTAL + SOFT DELETE
   - Puxa anúncios em lotes simultâneos otimizados;
   - Acréscimo incremental (não reseta os dados existentes);
   - Remove do painel os anúncios excluídos/finalizados no ML.
========================================================= */

let mlHubSyncAnunciosV108Ativo = false;
let mlHubSyncAnunciosV108Timer = null;

async function acompanharAnunciosV108(jobId) {
  clearTimeout(mlHubSyncAnunciosV108Timer);

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

    atualizarProgressoV26('anuncios', {
      status: j.status || 'running',
      atual,
      total,
      mensagem: j.message || `Sincronizando anúncios em lotes de 1.000 · ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')}`
    });

    // Atualiza a tabela da Gestão incrementalmente conforme o progresso avança
    if (atual > 0 && typeof v88CarregarGestaoLocal === 'function') {
      try {
        await v88CarregarGestaoLocal(1, { silencioso: true });
      } catch (e) {}
    }

    if (['queued', 'running'].includes(String(j.status || ''))) {
      // Polling rápido para feedback visual fluido e imediato
      mlHubSyncAnunciosV108Timer = setTimeout(
        () => acompanharAnunciosV108(jobId),
        1200
      );
      return;
    }

    if (j.status === 'completed') {
      localStorage.removeItem('mlHubPro_sync_v105_anuncios');
      localStorage.removeItem('mlHubPro_sync_v26_anuncios');

      atualizarProgressoV26('anuncios', {
        status: 'completed',
        atual,
        total,
        mensagem: j.message || 'Sincronização ultrarrápida concluída. Novos anúncios adicionados, atualizados e excluídos removidos.'
      });

      try {
        await v88CarregarGestaoLocal(1, { silencioso: true });
      } catch (e) {}

      mlHubSyncAnunciosV108Ativo = false;
      return;
    }

    if (j.status === 'failed') {
      atualizarProgressoV26('anuncios', {
        status: 'queued',
        atual,
        total,
        mensagem: (j.message || 'Sincronização pausada.') + ' · Clique em Puxar anúncios para continuar.'
      });

      mlHubSyncAnunciosV108Ativo = false;
      return;
    }

    mlHubSyncAnunciosV108Ativo = false;
  } catch (e) {
    mlHubSyncAnunciosV108Ativo = false;
    atualizarProgressoV26('anuncios', {
      status: 'queued',
      mensagem: 'Sincronização pausada por instabilidade de rede. Clique em Puxar anúncios para retomar.'
    });
  }
}

async function puxarAnunciosV105({ retomarAutomatico = false } = {}) {
  if (mlHubSyncAnunciosV108Ativo) return;

  const token = obterToken();
  if (!token) {
    solicitarToken();
    return;
  }

  mlHubSyncAnunciosV108Ativo = true;

  // Encerra qualquer processo legado antigo no navegador
  try { syncV88Abortar = true; } catch (e) {}

  atualizarProgressoV26('anuncios', {
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
          batch_size: 1000,       // Processamento em blocos de 1.000
          incremental: true,      // Preserva dados existentes e adiciona novos (UPSERT)
          clean_removed: true     // Apaga da base os anúncios que foram excluídos no ML
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

    atualizarProgressoV26('anuncios', {
      status: d.job?.status || 'queued',
      atual: Number(d.job?.progress_current || 0),
      total: Number(d.job?.progress_total || 0),
      mensagem: d.mensagem || d.job?.message || 'Sincronização iniciada em lotes de 1.000...'
    });

    acompanharAnunciosV108(jobId);
  } catch (e) {
    mlHubSyncAnunciosV108Ativo = false;
    const msg = String(e?.message || e || '');
    atualizarProgressoV26('anuncios', {
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

// Mantém total compatibilidade com todas as chamadas e botões existentes do sistema
window.puxarAnunciosV105 = puxarAnunciosV105;
window.sincronizarAnunciosDiretoV88 = puxarAnunciosV105;
window.puxarNovosAnuncios = () => puxarAnunciosV105();

// Retomada automática segura após refresh da página
document.addEventListener('DOMContentLoaded', () => {
  setTimeout(async () => {
    try {
      const jobId = Number(
        localStorage.getItem('mlHubPro_sync_v105_anuncios') ||
        localStorage.getItem('mlHubPro_sync_v26_anuncios') ||
        0
      );

      if (jobId && obterToken()) {
        mlHubSyncAnunciosV108Ativo = true;
        acompanharAnunciosV108(jobId);
      }
    } catch (e) {}
  }, 1100);
});
