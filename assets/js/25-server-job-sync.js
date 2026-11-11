/* =========================================================
   V108 — ULTRARÁPIDA SYNC + UPSERT INCREMENTAL + SOFT DELETE
========================================================= */

let mlHubSyncAnunciosV108Ativo = false;
let mlHubSyncAnunciosV108Timer = null;

async function puxarAnunciosV105({ retomarAutomatico = false } = {}) {
  if (mlHubSyncAnunciosV108Ativo) return;

  const token = obterToken();
  if (!token) {
    solicitarToken();
    return;
  }

  mlHubSyncAnunciosV108Ativo = true;

  // Cancela qualquer execução legada local
  try { syncV88Abortar = true; } catch (e) {}

  atualizarProgressoV26('anuncios', {
    status: 'running',
    atual: 0,
    total: 0,
    mensagem: 'Iniciando sincronização simultânea (Modo Ultra)...'
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);

    const r = await fetch(`${RENDER_URL}/api/scale/sync-fast?_=${Date.now()}`, {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        batch_size: 1000,       // Lotes simultâneos de 1000
        concurrency: 20,         // Sub-lotes paralelos de 50 na API do ML
        incremental: true,      // Não reseta, apenas acrescenta/atualiza (UPSERT)
        clean_removed: true     // Apaga do site os que não existem mais no ML
      })
    });

    clearTimeout(timer);
    const d = await r.json().catch(() => ({}));

    if (!r.ok) {
      throw new Error(d.erro || `HTTP ${r.status}`);
    }

    const jobId = Number(d.job?.id || 0);
    if (jobId) {
      localStorage.setItem('mlHubPro_sync_v105_anuncios', String(jobId));
      acompanharAnunciosV108(jobId);
    }
  } catch (e) {
    mlHubSyncAnunciosV108Ativo = false;
    const msg = String(e?.message || e || '');
    atualizarProgressoV26('anuncios', { status: 'queued', mensagem: `Erro: ${msg}` });
    if (!retomarAutomatico) alert(msg);
  }
}

async function acompanharAnunciosV108(jobId) {
  clearTimeout(mlHubSyncAnunciosV108Timer);

  try {
    const r = await fetch(`${RENDER_URL}/api/scale/jobs/${encodeURIComponent(jobId)}?_=${Date.now()}`, {
      cache: 'no-store',
      headers: { Authorization: obterToken(), Accept: 'application/json' }
    });

    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);

    const j = d.job || {};
    const atual = Number(j.progress_current || 0);
    const total = Number(j.progress_total || 0);

    atualizarProgressoV26('anuncios', {
      status: j.status || 'running',
      atual,
      total,
      mensagem: j.message || `Sincronizados ${atual.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}...`
    });

    // Atualiza a visualização na tela sem travar a interface
    if (atual > 0 && typeof v88CarregarGestaoLocal === 'function') {
      await v88CarregarGestaoLocal(1, { silencioso: true });
    }

    if (['queued', 'running'].includes(String(j.status || ''))) {
      // Polling rápido (1.2s) para dar feedback imediato de alta velocidade
      mlHubSyncAnunciosV108Timer = setTimeout(() => acompanharAnunciosV108(jobId), 1200);
      return;
    }

    if (j.status === 'completed') {
      localStorage.removeItem('mlHubPro_sync_v105_anuncios');
      atualizarProgressoV26('anuncios', {
        status: 'completed',
        atual,
        total,
        mensagem: `Concluído! ${atual.toLocaleString('pt-BR')} anúncios sincronizados. Excluídos removidos.`
      });
      mlHubSyncAnunciosV108Ativo = false;
      if (typeof v88CarregarGestaoLocal === 'function') await v88CarregarGestaoLocal(1, { silencioso: true });
    }
  } catch (e) {
    mlHubSyncAnunciosV108Ativo = false;
  }
}

window.puxarAnunciosV105 = puxarAnunciosV105;
window.sincronizarAnunciosDiretoV88 = puxarAnunciosV105;
window.puxarNovosAnuncios = () => puxarAnunciosV105();
