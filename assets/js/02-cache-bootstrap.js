
document.addEventListener('DOMContentLoaded', () => {
    if (!carregarCacheItensLocal()) return;

    try {
        if (typeof atualizarCards === 'function') atualizarCards(cacheItens);
        if (typeof montarTabelaGestao === 'function') montarTabelaGestao(cacheItens);
        if (typeof renderizarTabelaSimulacao === 'function') renderizarTabelaSimulacao(cacheItens);
        if (typeof atualizarTabelaSimulacao === 'function') atualizarTabelaSimulacao();
    } catch (erro) {
        console.warn('Os an\u00fancios foram recuperados do navegador, mas alguma tela ainda n\u00e3o estava pronta:', erro);
    }
});
