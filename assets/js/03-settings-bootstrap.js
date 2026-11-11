
document.addEventListener('DOMContentLoaded', () => {
    try {
        const bruto = localStorage.getItem('mlHubPro_indicadoresHome_v1');
        if (!bruto) return;
        const dados = JSON.parse(bruto);
        Object.entries(dados || {}).forEach(([id, valor]) => {
            const el = document.getElementById(id);
            if (el) el.innerText = valor;
        });
    } catch (erro) {
        console.warn('N\u00e3o foi poss\u00edvel restaurar os indicadores da p\u00e1gina inicial:', erro);
    }
});
