
(function () {
    let atualizacaoHomeEmAndamento = false;

    function homeEstaVisivel() {
        const inicio = document.getElementById('secao-inicio');
        return inicio && !inicio.classList.contains('hidden');
    }

    async function atualizarHomeTempoReal(forcar = false) {
        if (atualizacaoHomeEmAndamento) return;
        if (!forcar && !homeEstaVisivel()) return;

        const token = typeof obterToken === 'function' ? obterToken() : '';
        if (!token) return;

        atualizacaoHomeEmAndamento = true;
        const status = document.getElementById('home-tempo-real-status');

        try {
            if (status) {
                status.innerText = '\u25cf Atualizando dados...';
                status.className = 'text-[10px] text-yellow-400 font-bold';
            }

            const response = await fetch(`${RENDER_URL}/api/dashboard`, {
                headers: { Authorization: token }
            });
            const data = await response.json();

            if (!response.ok || !data.sucesso) {
                throw new Error(data.erro || 'Falha ao atualizar os dados da p\u00e1gina inicial.');
            }

            preencherDashboard(data);

            try {
                localStorage.setItem('mlHubPro_dashboardHome_v64', JSON.stringify(data));
            } catch (erro) {}

            if (status) {
                status.innerText = '\u25cf Atualizado agora';
                status.className = 'text-[10px] text-emerald-400 font-bold';
            }
        } catch (erro) {
            console.warn('Atualiza\u00e7\u00e3o autom\u00e1tica da Home:', erro);
            if (status) {
                status.innerText = '\u25cf Mantendo \u00faltimos dados salvos';
                status.className = 'text-[10px] text-slate-500 font-bold';
            }
        } finally {
            atualizacaoHomeEmAndamento = false;
        }
    }

    window.atualizarHomeTempoReal = atualizarHomeTempoReal;

    document.addEventListener('DOMContentLoaded', function () {
        // Restaura imediatamente os \u00faltimos dados, sem deixar a Home vazia.
        try {
            const resumo = JSON.parse(localStorage.getItem('mlHubPro_resumoHome_v1') || '{}');
            if (resumo.vendas && document.getElementById('home-dashboard-vendas'))
                document.getElementById('home-dashboard-vendas').innerText = resumo.vendas;
            if (resumo.pedidos && document.getElementById('home-dashboard-pedidos'))
                document.getElementById('home-dashboard-pedidos').innerText = resumo.pedidos;
            if (resumo.unidades && document.getElementById('home-dashboard-unidades'))
                document.getElementById('home-dashboard-unidades').innerText = resumo.unidades;
            if (resumo.visitas && document.getElementById('home-dashboard-visitas'))
                document.getElementById('home-dashboard-visitas').innerText = resumo.visitas;
            if (resumo.visitas_periodo && document.getElementById('home-dashboard-visitas-periodo'))
                document.getElementById('home-dashboard-visitas-periodo').innerText = resumo.visitas_periodo;

            const periodo = localStorage.getItem('mlHubPro_periodoHome_v1');
            if (periodo && document.getElementById('home-dashboard-periodo'))
                document.getElementById('home-dashboard-periodo').innerText = periodo;

            const top10 = localStorage.getItem('mlHubPro_top10Home_v2');
            if (top10 && document.getElementById('top10-home'))
                document.getElementById('top10-home').innerHTML = top10;

            const dashboardSalvo = localStorage.getItem('mlHubPro_dashboardHome_v64');
            if (dashboardSalvo) {
                const salvo=JSON.parse(dashboardSalvo);
                const hoje=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());
                if(!salvo?.visitas_dia?.data_local || salvo.visitas_dia.data_local===hoje){
                    preencherDashboard(salvo);
                }else{
                    const v=document.getElementById('home-dashboard-visitas');
                    const vp=document.getElementById('home-dashboard-visitas-periodo');
                    if(v)v.innerText='0';
                    if(vp)vp.innerText='Hoje · aguardando atualização';
                }
            }
        } catch (erro) {
            console.warn('N\u00e3o foi poss\u00edvel restaurar os dados da Home:', erro);
        }

        // Atualiza ao entrar e depois consulta novamente a cada 60 segundos
        // enquanto a p\u00e1gina inicial estiver aberta.
        setTimeout(() => atualizarHomeTempoReal(false), 800);
        setInterval(() => atualizarHomeTempoReal(false), 30000);
    });

    // Atualiza tamb\u00e9m quando a aba do navegador volta a ficar vis\u00edvel.
    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) atualizarHomeTempoReal(false);
    });

    let diaHomeV93=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());
    setInterval(()=>{
        const agoraDia=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo'}).format(new Date());
        if(agoraDia!==diaHomeV93){
            diaHomeV93=agoraDia;

            const visitas=document.getElementById('home-dashboard-visitas');
            const periodo=document.getElementById('home-dashboard-visitas-periodo');

            if(visitas)visitas.innerText='0';
            if(periodo)periodo.innerText='Hoje · iniciando novo dia';

            try{localStorage.removeItem('mlHubPro_dashboardHome_v64')}catch(e){}

            atualizarHomeTempoReal(true);
        }
    },15000);
})();
