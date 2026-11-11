
function aplicarTema(tema) {
    const valor = ['claro','escuro','azul'].includes(tema) ? tema : 'azul';
    document.body.classList.remove('tema-claro','tema-escuro','tema-azul');
    document.body.classList.add(`tema-${valor}`);
    try { localStorage.setItem('mlHubPro_tema_v1', valor); } catch(e) {}

    document.querySelectorAll('[data-theme-option]').forEach(el => {
        el.classList.toggle('tema-selecionado', el.dataset.themeOption === valor);
    });
}

document.addEventListener('DOMContentLoaded', function () {
    let tema = 'azul';
    try { tema = localStorage.getItem('mlHubPro_tema_v1') || 'azul'; } catch(e) {}
    aplicarTema(tema);

    const homeTop10 = document.getElementById('top10-home');
    if (homeTop10) {
        try {
            const cache = localStorage.getItem('mlHubPro_top10Home_v2');
            if (cache) homeTop10.innerHTML = cache;
        } catch(e) {}
    }

    const token = typeof obterToken === 'function' ? obterToken() : '';
    const perfilStatus = document.getElementById('perfil-status-conta');
    if (perfilStatus) {
        perfilStatus.innerText = token ? '\u25cf Conta conectada' : '\u25cf Token n\u00e3o configurado';
        perfilStatus.className = token ? 'text-xs text-emerald-400 mt-2' : 'text-xs text-yellow-400 mt-2';
    }
});
