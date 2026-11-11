
(function () {
    function sincronizarTop10Home() {
        const origem =
            document.getElementById('top10') ||
            document.getElementById('top10-lista');
        const destino =
            document.getElementById('top10-home') ||
            document.getElementById('top10-lista-home');
        if (!origem || !destino) return;
        destino.innerHTML = origem.innerHTML;
    }

    window.sincronizarTop10Home = sincronizarTop10Home;

    document.addEventListener('DOMContentLoaded', function () {
        const origem =
            document.getElementById('top10') ||
            document.getElementById('top10-lista');
        if (!origem) return;
        sincronizarTop10Home();
        new MutationObserver(sincronizarTop10Home).observe(origem, {
            childList: true,
            subtree: true,
            characterData: true
        });
    });
})();
