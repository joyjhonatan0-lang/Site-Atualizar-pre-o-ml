
let mlScaleJobId=null, mlScaleTimer=null;
let gestaoPagina=1, gestaoPaginas=1, gestaoTotalFiltro=0, gestaoBusca='', gestaoCarregando=false;
let gestaoOrdenacaoV76='recent', gestaoStatusV76='';

async function verificarModoEscala(){
  try{const r=await fetch(`${RENDER_URL}/api/scale/status`),d=await r.json();return !!d.database}catch(e){return false}
}

function tituloSomenteV76(valor){
  return String(valor??'')
    .replace(/\u0000/g,' ')
    .replace(/<[^>]*>/g,' ')
    .replace(/\r?\n+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

function normalizarItemEscala(i){
  return {
    id:i.id||'', title:tituloSomenteV76(i.title), sku:i.sku||'Sem SKU',
    price:Number(i.price||0), sale_fee:Number(i.sale_fee||0),
    commission_percentage:Number(i.commission_percentage||0),
    shipping_cost:Number(i.shipping_cost||0), net_received:Number(i.net_received ?? i.price ?? 0),
    available_quantity:Number(i.available_quantity||0), sold_quantity:Number(i.sold_quantity||0),
    status:i.status||'', listing_type_id:i.listing_type_id||'',
    category_id:i.category_id||'', thumbnail:i.thumbnail||'', permalink:i.permalink||'',
    last_updated:i.last_updated||null,date_created:i.date_created||null,last_synced:i.last_synced||null,
    price_update_allowed:i.price_update_allowed!==false,
    price_update_block_reason:i.price_update_block_reason||'',
    picture_count:Number(i.picture_count||0),
    description_exists:i.description_exists===true,
    content_score:Number(i.content_score||0),
    missing_main:Array.isArray(i.missing_main)?i.missing_main:[],
    missing_secondary:Array.isArray(i.missing_secondary)?i.missing_secondary:[],
    content_audited_at:i.content_audited_at||null,
    quality_score:(i.quality_score===null||i.quality_score===undefined||i.quality_score==='')?null:Number(i.quality_score),
    quality_level:String(i.quality_level||''),
    quality_pending_actions:Number(i.quality_pending_actions||0),
    quality_checked_at:i.quality_checked_at||null,
    quality_calculated_at:i.quality_calculated_at||null
  };
}


async function carregarGestaoLocalV85(page=1,{silencioso=false}={}){
    if(gestaoCarregando)return;
    gestaoCarregando=true;
    if(!silencioso)mostrarLoading('Carregando anúncios salvos localmente...');
    try{
        await carregarMasterLocalV32();

        let lista=[...masterAnunciosV32];
        const busca=String(gestaoBusca||'').trim().toLowerCase();
        if(busca){
            lista=lista.filter(x=>
                String(x.id||'').toLowerCase().includes(busca) ||
                String(x.sku||'').toLowerCase().includes(busca) ||
                String(x.title||'').toLowerCase().includes(busca)
            );
        }
        if(gestaoStatusV76){
            lista=lista.filter(x=>String(x.status||'')===String(gestaoStatusV76));
        }

        const tempo=x=>new Date(x.date_created||x.last_updated||x.last_synced||0).getTime()||0;
        if(gestaoOrdenacaoV76==='sold'){
            lista.sort((a,b)=>Number(b.sold_quantity||0)-Number(a.sold_quantity||0)||tempo(b)-tempo(a));
        }else if(gestaoOrdenacaoV76==='oldest'){
            lista.sort((a,b)=>tempo(a)-tempo(b));
        }else if(gestaoOrdenacaoV76==='status'){
            lista.sort((a,b)=>String(a.status||'').localeCompare(String(b.status||''))||tempo(b)-tempo(a));
        }else{
            lista.sort((a,b)=>tempo(b)-tempo(a));
        }

        gestaoTotalFiltro=lista.length;
        gestaoPaginas=Math.max(1,Math.ceil(lista.length/50));
        gestaoPagina=Math.max(1,Math.min(gestaoPaginas,Number(page||1)));
        cacheItens=lista.slice((gestaoPagina-1)*50,gestaoPagina*50);
        montarTabelaGestao(cacheItens);

        const totalConta=masterAnunciosV32.length;
        const ativos=masterAnunciosV32.filter(x=>x.status==='active').length;
        const tl=document.getElementById('total-listado');
        const ta=document.getElementById('total-ativos');
        const to=document.getElementById('total-outros');
        if(tl)tl.innerText=totalConta.toLocaleString('pt-BR');
        if(ta)ta.innerText=ativos.toLocaleString('pt-BR');
        if(to)to.innerText=(totalConta-ativos).toLocaleString('pt-BR');
        atualizarPaginacaoGestao();

        const meta=await idbMetaV32('direct_sync_v85').catch(()=>null);
        const info=document.getElementById('gestao-paginacao-info');
        if(info && meta?.processed!=null){
            info.textContent=`${gestaoTotalFiltro.toLocaleString('pt-BR')} resultado(s) · cache local · ${Number(meta.processed||0).toLocaleString('pt-BR')}/${Number(meta.total||0).toLocaleString('pt-BR')} sincronizados`;
        }
    }finally{
        gestaoCarregando=false;
        if(!silencioso)esconderLoading();
    }
}

async function carregarGestaoEscala(page=1,{silencioso=false}={}){
  if(gestaoCarregando)return;
  const token=obterToken(); if(!token){solicitarToken();return}
  gestaoCarregando=true;
  if(!silencioso)mostrarLoading('Carregando an\u00fancios do banco...');
  try{
    const p=new URLSearchParams({page:String(Math.max(1,page)),limit:'50',sort:gestaoOrdenacaoV76||'recent'});
    if(gestaoBusca)p.set('q',gestaoBusca);
    if(gestaoStatusV76)p.set('status',gestaoStatusV76);
    const r=await fetch(`${RENDER_URL}/api/scale/anuncios?${p}`,{headers:{Authorization:token}});
    const d=await r.json(); if(!r.ok)throw new Error(d.erro||'Erro ao consultar an\u00fancios.');
    gestaoPagina=Number(d.pagina||1); gestaoPaginas=Number(d.paginas||1); gestaoTotalFiltro=Number(d.total||0);
    const itensBanco=(d.itens||[]).map(normalizarItemEscala);
    if(Number(d.total_conta||0)>0 || itensBanco.length>0){
      cacheItens=itensBanco; // somente a p\u00e1gina atual; nunca 90 mil no navegador
      montarTabelaGestao(cacheItens);
      const tl=document.getElementById('total-listado'),ta=document.getElementById('total-ativos'),to=document.getElementById('total-outros');
      if(tl)tl.innerText=Number(d.total_conta||0).toLocaleString('pt-BR');
      if(ta)ta.innerText=Number(d.ativos||0).toLocaleString('pt-BR');
      if(to)to.innerText=Number(d.outros||0).toLocaleString('pt-BR');
      atualizarPaginacaoGestao();
    } else {
      // Banco novo ainda vazio: preserva/restaura os an\u00fancios que j\u00e1 estavam salvos no navegador.
      let antigos=[];
      try{antigos=JSON.parse(localStorage.getItem('mlHubPro_cacheItens_v1')||'[]')}catch(e){}
      if(Array.isArray(antigos)&&antigos.length){
        cacheItens=antigos;
        montarTabelaGestao(cacheItens);
        const ativos=cacheItens.filter(x=>x.status==='active').length;
        const tl=document.getElementById('total-listado'),ta=document.getElementById('total-ativos'),to=document.getElementById('total-outros');
        if(tl)tl.innerText=cacheItens.length.toLocaleString('pt-BR');
        if(ta)ta.innerText=ativos.toLocaleString('pt-BR');
        if(to)to.innerText=(cacheItens.length-ativos).toLocaleString('pt-BR');
        const info=document.getElementById('gestao-paginacao-info');
        if(info)info.textContent=`${cacheItens.length.toLocaleString('pt-BR')} an\u00fancio(s) salvos localmente \u00b7 aguardando migra\u00e7\u00e3o ao banco`;
      } else {
        montarTabelaGestao([]);
        atualizarPaginacaoGestao();
      }
    }
    // V43: enquanto o usu\u00e1rio est\u00e1 na Gest\u00e3o, prepara silenciosamente uma \u00fanica
    // c\u00f3pia completa para a Simula\u00e7\u00e3o. Depois disso a Simula\u00e7\u00e3o abre do cache local.
    if(typeof aquecerCacheSimulacaoV43==='function')aquecerCacheSimulacaoV43();
  }catch(e){alert(e.message)}finally{gestaoCarregando=false;if(!silencioso)esconderLoading()}
}


function aplicarFiltrosGestaoV76(){
  gestaoOrdenacaoV76=document.getElementById('gestao-ordenacao-v76')?.value||'recent';
  gestaoStatusV76=document.getElementById('gestao-status-v76')?.value||'';
  gestaoPagina=1;
  try{
    localStorage.setItem('mlHubPro_gestaoOrdenacao_v76',gestaoOrdenacaoV76);
    localStorage.setItem('mlHubPro_gestaoStatus_v76',gestaoStatusV76);
  }catch(e){}
  const resumo=document.getElementById('gestao-filtro-resumo-v76');
  if(resumo){
    const nomes={recent:'Mais recentes',sold:'Mais vendidos',oldest:'Mais antigos',status:'Por situação'};
    const sts={active:'Ativos',paused:'Pausados',under_review:'Em revisão',inactive:'Inativos',closed:'Finalizados'};
    resumo.textContent=`${nomes[gestaoOrdenacaoV76]||'Mais recentes'} · ${sts[gestaoStatusV76]||'Todas as situações'}`;
  }
  return carregarGestaoEscala(1);
}

function atualizarPaginacaoGestao(){
  const info=document.getElementById('gestao-paginacao-info'),pag=document.getElementById('gestao-pagina-atual');
  const ant=document.getElementById('gestao-anterior'),prox=document.getElementById('gestao-proxima');
  if(info)info.textContent=`${gestaoTotalFiltro.toLocaleString('pt-BR')} resultado(s) \u00b7 50 por p\u00e1gina`;
  if(pag)pag.textContent=`${gestaoPagina.toLocaleString('pt-BR')} / ${gestaoPaginas.toLocaleString('pt-BR')}`;
  if(ant)ant.disabled=gestaoPagina<=1;if(prox)prox.disabled=gestaoPagina>=gestaoPaginas;
}
function gestaoIrPagina(delta){
  const p=gestaoPagina+delta;if(p<1||p>gestaoPaginas)return;
  carregarGestaoEscala(p);window.scrollTo({top:0,behavior:'smooth'});
}

async function iniciarSincronizacao90k(){
  const token=obterToken();if(!token){solicitarToken();return}
  try{
    mostrarLoading('Colocando sincroniza\u00e7\u00e3o completa na fila...');
    const r=await fetch(`${RENDER_URL}/api/scale/sync`,{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:'{}'});
    const d=await r.json();if(!r.ok)throw new Error(d.erro||'Falha ao iniciar sincroniza\u00e7\u00e3o.');
    mlScaleJobId=d.job?.id;
    alert((d.mensagem||'Sincroniza\u00e7\u00e3o iniciada.')+'\n\nEla continuar\u00e1 no servidor mesmo se voc\u00ea fechar esta p\u00e1gina.');
    if(mlScaleJobId)acompanharSync90k();
  }catch(e){alert(e.message)}finally{esconderLoading()}
}
async function acompanharSync90k(){
  if(!mlScaleJobId)return;clearTimeout(mlScaleTimer);
  try{
    const r=await fetch(`${RENDER_URL}/api/scale/jobs/${mlScaleJobId}`),d=await r.json(),j=d.job;
    if(j&&['queued','running'].includes(j.status)){mlScaleTimer=setTimeout(acompanharSync90k,2500);return}
    if(j?.status==='completed'){await carregarGestaoEscala(1,{silencioso:true});alert(j.message||'Sincroniza\u00e7\u00e3o conclu\u00edda.')}
    else if(j?.status==='failed')alert('A sincroniza\u00e7\u00e3o falhou: '+(j.message||'erro desconhecido'));
  }catch(e){mlScaleTimer=setTimeout(acompanharSync90k,5000)}
}

// Gest\u00e3o V6: busca e pagina\u00e7\u00e3o acontecem no PostgreSQL.
async function executarBusca(){
  const termo=document.getElementById('input-busca')?.value?.trim()||'';
  if(abaAtualAtiva==='gestao'){gestaoBusca=termo;gestaoPagina=1;return carregarGestaoEscala(1)}
  const lower=termo.toLowerCase();
  const filtrados=!lower?cacheItens:cacheItens.filter(item=>String(item.id).toLowerCase().includes(lower)||String(item.sku).toLowerCase().includes(lower)||String(item.title).toLowerCase().includes(lower));
  if(abaAtualAtiva==='simulacao')montarTabelaSimulacao(filtrados);
  else if(abaAtualAtiva==='atualizacao')montarTabelaAtualizacao(filtrados);
}
async function limparBusca(){
  const c=document.getElementById('input-busca');if(c)c.value='';
  if(abaAtualAtiva==='gestao'){gestaoBusca='';return carregarGestaoEscala(1)}
  return executarBusca();
}

// Bot\u00e3o principal e "Puxar an\u00fancios" agora iniciam job no servidor; n\u00e3o baixam 90 mil itens no browser.
async function carregarDados(){
  mudarAba('gestao');
  const modo=await verificarModoEscala();
  if(!modo){alert('O PostgreSQL de escala n\u00e3o est\u00e1 dispon\u00edvel.');return}
  await carregarGestaoEscala(1);
}


// Ao entrar em Gest\u00e3o, consulta apenas 50 registros.
const _mudarAbaV6=mudarAba;
mudarAba=function(aba){
  _mudarAbaV6(aba);
  if(aba==='gestao')setTimeout(()=>carregarGestaoEscala(gestaoPagina,{silencioso:true}),0);
};
