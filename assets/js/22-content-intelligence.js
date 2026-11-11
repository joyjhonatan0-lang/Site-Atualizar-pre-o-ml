
let conteudoAtualV96=null;
let inteligenciaAtualV96=null;
let monitorAtualV96=null;
let propostaAtualV96=null;
let propostaItemV96=null;

function fileDataUrlV96(file,maxBytes=6*1024*1024){
  return new Promise((resolve,reject)=>{
    if(!file)return resolve('');
    if(file.size>maxBytes)return reject(new Error('A imagem ultrapassa o limite de 6 MB para análise.'));
    const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(new Error('Não foi possível ler a imagem.'));r.readAsDataURL(file);
  });
}

async function auditarConteudoPaginaV96(){
  const ids=cacheItens.map(x=>String(x.id)).filter(Boolean);
  if(!ids.length)return alert('Nenhum anúncio nesta página.');
  mostrarLoading(`Auditando descrição, fotos e características de ${ids.length} anúncios...`);
  try{
    const r=await fetch(`${RENDER_URL}/api/v96/anuncios/auditar`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:obterToken()},body:JSON.stringify({ids})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    const alterados=[];
    for(const a of d.itens||[]){
      if(!a.sucesso)continue;
      const item=masterMapV32.get(String(a.id));if(!item)continue;
      Object.assign(item,{picture_count:Number(a.picture_count||0),description_exists:Boolean(a.description_exists),content_score:Number(a.content_score||0),missing_main:a.missing_main||[],missing_secondary:a.missing_secondary||[],content_audited_at:new Date().toISOString()});
      alterados.push(item);
    }
    if(alterados.length)await idbSalvarItensV32(alterados);
    masterAnunciosV32=[...masterMapV32.values()];
    await v88CarregarGestaoLocal(gestaoPagina,{silencioso:true});
  }catch(e){alert(e.message)}finally{esconderLoading()}
}

async function abrirConteudoPorSkuV96(){
  await carregarMasterLocalV32();
  const sku=prompt('Digite o SKU exato que deseja editar em massa:');
  if(!sku)return;
  const idx=cacheItens.findIndex(x=>String(x.sku||'').trim().toLowerCase()===String(sku).trim().toLowerCase());
  let item=idx>=0?cacheItens[idx]:masterAnunciosV32.find(x=>String(x.sku||'').trim().toLowerCase()===String(sku).trim().toLowerCase());
  if(!item)return alert('Nenhum anúncio com este SKU foi encontrado no cache da Gestão.');
  const tempIndex=cacheItens.findIndex(x=>String(x.id)===String(item.id));
  if(tempIndex>=0)return abrirEditorConteudoV96(tempIndex,'geral');
  cacheItens=[item,...cacheItens.filter(x=>String(x.id)!==String(item.id))];
  return abrirEditorConteudoV96(0,'geral');
}

async function abrirEditorConteudoV96(index,foco='geral'){
  const item=cacheItens[index];if(!item)return;
  const modal=document.getElementById('modal-conteudo-v96');
  modal.classList.remove('hidden');
  document.getElementById('conteudo-modal-title-v96').innerText=item.title||'Conteúdo do anúncio';
  document.getElementById('conteudo-modal-meta-v96').innerText=`${item.id} · SKU ${item.sku||'—'}`;
  document.getElementById('conteudo-modal-body-v96').innerHTML='<div class="text-xs text-yellow-400">Consultando conteúdo completo no Mercado Livre...</div>';
  try{
    const r=await fetch(`${RENDER_URL}/api/v96/anuncios/${encodeURIComponent(item.id)}/conteudo`,{cache:'no-store',headers:{Authorization:obterToken()}});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    conteudoAtualV96=d;
    renderEditorConteudoV96(d);
    setTimeout(()=>document.getElementById(foco==='fotos'?'v96-fotos-section':foco==='descricao'?'v96-descricao-section':foco==='caracteristicas'?'v96-attrs-section':'conteudo-modal-body-v96')?.scrollIntoView({behavior:'smooth',block:'start'}),120);
  }catch(e){document.getElementById('conteudo-modal-body-v96').innerHTML=`<div class="text-xs text-red-300">${escapeHtml(e.message)}</div>`}
}

function fecharEditorConteudoV96(){document.getElementById('modal-conteudo-v96')?.classList.add('hidden');conteudoAtualV96=null}

function renderAttrInputV96(a){
  const options=Array.isArray(a.values)?a.values:[];
  const val=String(a.value||'');
  const input=options.length?`<select data-v96-attr="${escapeHtml(a.id)}" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[10px] text-white"><option value="">— não informado —</option><option value="-1" ${a.value_id==='-1'?'selected':''}>Não se aplica</option>${options.map(v=>`<option value="${escapeHtml(String(v.id??''))}" data-name="${escapeHtml(v.name||'')}" ${String(a.value_id||'')===String(v.id||'')?'selected':''}>${escapeHtml(v.name||'')}</option>`).join('')}</select>`:`<input data-v96-attr="${escapeHtml(a.id)}" value="${escapeHtml(val)}" class="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-[10px] text-white" placeholder="Preencha somente se souber">`;
  return `<div class="v96-attr-row"><div><div class="text-[10px] font-black ${a.required?'text-yellow-300':'text-slate-300'}">${escapeHtml(a.name)}</div><div class="text-[8px] text-slate-600 mt-1">${escapeHtml(a.id)}${a.required?' · principal/obrigatória':' · secundária'}</div></div><div>${input}</div></div>`;
}

function renderEditorConteudoV96(d){
  const body=document.getElementById('conteudo-modal-body-v96');
  body.innerHTML=`
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <div class="panel rounded-xl p-4"><div class="text-[9px] text-slate-500 uppercase font-black">Score conteúdo</div><div class="text-2xl font-black ${Number(d.content_score)>=80?'text-emerald-400':'text-yellow-400'} mt-2">${Number(d.content_score||0)}%</div></div>
      <div class="panel rounded-xl p-4"><div class="text-[9px] text-slate-500 uppercase font-black">Fotos</div><div class="text-2xl font-black text-white mt-2">${Number(d.picture_count||0)}</div></div>
      <div class="panel rounded-xl p-4"><div class="text-[9px] text-slate-500 uppercase font-black">Principais faltando</div><div class="text-2xl font-black ${d.missing_main?.length?'text-red-300':'text-emerald-400'} mt-2">${Number(d.missing_main?.length||0)}</div></div>
      <div class="panel rounded-xl p-4"><div class="text-[9px] text-slate-500 uppercase font-black">Secundárias faltando</div><div class="text-2xl font-black text-slate-300 mt-2">${Number(d.missing_secondary?.length||0)}</div></div>
    </div>

    <section id="v96-fotos-section" class="mb-8 scroll-mt-28">
      <div class="flex items-end justify-between gap-4"><div><h3 class="text-sm font-black text-white">Fotos</h3><p class="text-[10px] text-slate-500 mt-1">Adicione imagens próprias. Ao salvar, a lista abaixo substitui as fotos atuais.</p></div><label class="bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-black px-3 py-2 rounded-lg cursor-pointer">+ Enviar fotos<input id="v96-upload-fotos" type="file" multiple accept="image/*" class="hidden" onchange="uploadFotosConteudoV96(this.files)"></label></div>
      <div id="v96-fotos-list" class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 mt-4">${(d.pictures||[]).map((p,i)=>`<div class="relative rounded-xl border border-slate-800 bg-white p-1" data-v96-picture data-id="${escapeHtml(p.id||'')}" data-url="${escapeHtml(p.url||'')}"><img src="${escapeHtml(p.url||'')}" class="w-full aspect-square object-contain rounded-lg"><button onclick="this.closest('[data-v96-picture]').remove()" class="absolute top-1 right-1 w-6 h-6 rounded-lg bg-red-600 text-white text-[10px]">✕</button><div class="text-[8px] text-slate-500 truncate px-1 mt-1">${i===0?'CAPA':'Foto '+(i+1)}</div></div>`).join('')}</div>
    </section>

    <section id="v96-descricao-section" class="mb-8 scroll-mt-28"><h3 class="text-sm font-black text-white">Descrição</h3><p class="text-[10px] text-slate-500 mt-1">Texto simples, original e complementar à ficha técnica.</p><textarea id="v96-description" rows="12" class="w-full mt-3 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-xs text-white">${escapeHtml(d.description||'')}</textarea></section>

    <section id="v96-attrs-section" class="scroll-mt-28"><div><h3 class="text-sm font-black text-white">Características principais</h3><p class="text-[10px] text-slate-500 mt-1">Obrigatórias ou centrais para a categoria. Não invente informações.</p></div><div class="mt-3">${(d.principais||[]).map(renderAttrInputV96).join('')||'<div class="text-xs text-slate-500">Nenhuma principal editável encontrada.</div>'}</div><div class="mt-8"><h3 class="text-sm font-black text-white">Características secundárias</h3><p class="text-[10px] text-slate-500 mt-1">Complete as que realmente se aplicam ao produto.</p></div><div class="mt-3 max-h-[560px] overflow-y-auto pr-2">${(d.secundarias||[]).map(renderAttrInputV96).join('')||'<div class="text-xs text-slate-500">Nenhuma secundária editável encontrada.</div>'}</div></section>
  `;
}

async function uploadFotosConteudoV96(files){
  if(!files?.length)return;
  const box=document.getElementById('v96-fotos-list');
  const status=document.getElementById('conteudo-modal-status-v96');
  for(const file of [...files].slice(0,20)){
    try{
      status.innerText=`Enviando ${file.name} ao Mercado Livre...`;
      const data=await fileDataUrlV96(file,12*1024*1024);
      const r=await fetch(`${RENDER_URL}/api/v40/criar/imagem-upload`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:obterToken()},body:JSON.stringify({image_data_url:data,titulo:file.name,tipo:'gestao-v96'})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
      const p=d.picture;
      box.insertAdjacentHTML('beforeend',`<div class="relative rounded-xl border border-slate-800 bg-white p-1" data-v96-picture data-id="${escapeHtml(p.id||'')}" data-url="${escapeHtml(p.url||'')}"><img src="${escapeHtml(p.url||'')}" class="w-full aspect-square object-contain rounded-lg"><button onclick="this.closest('[data-v96-picture]').remove()" class="absolute top-1 right-1 w-6 h-6 rounded-lg bg-red-600 text-white text-[10px]">✕</button></div>`);
    }catch(e){alert(`Foto ${file.name}: ${e.message}`)}
  }
  status.innerText='Fotos carregadas. Clique em Salvar para aplicar ao anúncio.';
}

function coletarPatchConteudoV96(){
  const patch={};
  const avisos=[];
  const original=conteudoAtualV96||{};

  const pictures=[...document.querySelectorAll('#v96-fotos-list [data-v96-picture]')].map(el=>({id:el.dataset.id||undefined,url:el.dataset.url||undefined}));
  const pictureKey=p=>String(p?.id||p?.url||'').trim();
  const atuais=(Array.isArray(original.pictures)?original.pictures:[]).map(pictureKey);
  const novas=pictures.map(pictureKey).filter(Boolean);
  if(JSON.stringify(atuais)!==JSON.stringify(novas)){
    if(!novas.length)throw new Error('O anúncio precisa manter pelo menos uma foto.');
    patch.pictures=pictures;
  }

  const descOriginal=String(original.description||'').trim();
  const descNova=String(document.getElementById('v96-description')?.value||'').trim();
  if(descNova!==descOriginal){
    if(descNova)patch.description=descNova;
    else avisos.push('A descrição ficou vazia e não será enviada. O Mercado Livre não aceita descrição vazia.');
  }

  const originais=new Map([...(original.principais||[]),...(original.secundarias||[])].map(a=>[String(a.id),{
    value_id:a?.value_id!==undefined&&a?.value_id!==null?String(a.value_id):'',
    value:String(a?.value||'').trim()
  }]));
  const attributes=[];

  document.querySelectorAll('[data-v96-attr]').forEach(el=>{
    const id=String(el.dataset.v96Attr||'').trim();if(!id)return;
    const old=originais.get(id)||{value_id:'',value:''};
    if(el.tagName==='SELECT'){
      const value_id=String(el.value||'').trim();
      const value_name=value_id&&value_id!=='-1'?String(el.options[el.selectedIndex]?.dataset?.name||el.options[el.selectedIndex]?.textContent||'').trim():'';
      const oldComparable=old.value_id||old.value;
      const newComparable=value_id==='-1'?'-1':(value_id||value_name);
      if(String(oldComparable||'')===String(newComparable||''))return;
      if(value_id==='-1')attributes.push({id,value_id:'-1',value_name:null});
      else if(value_id)attributes.push({id,value_id});
      else avisos.push(`O campo ${id} ficou sem valor e não será apagado automaticamente.`);
      return;
    }
    const value_name=String(el.value||'').trim();
    if(value_name===String(old.value||'').trim())return;
    if(value_name)attributes.push({id,value_name});
    else avisos.push(`O campo ${id} ficou vazio e não será apagado automaticamente.`);
  });

  if(attributes.length)patch.attributes=attributes;
  return {patch,avisos};
}

async function salvarEditorConteudoV96(massa=false){
  if(!conteudoAtualV96)return;
  const status=document.getElementById('conteudo-modal-status-v96');
  let coletado;
  try{coletado=coletarPatchConteudoV96()}
  catch(e){status.innerText='Erro: '+e.message;return}

  const patch=coletado.patch||{};
  const avisosLocais=coletado.avisos||[];
  if(!Object.keys(patch).length){
    status.innerText=avisosLocais.length?`Nenhuma alteração enviada. ${avisosLocais.join(' ')}`:'Nenhuma alteração foi detectada.';
    return;
  }

  if(!massa){
    status.innerText='Salvando somente os campos alterados no Mercado Livre...';
    try{
      const r=await fetch(`${RENDER_URL}/api/v96/anuncios/${encodeURIComponent(conteudoAtualV96.id)}/conteudo`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:obterToken()},body:JSON.stringify(patch)});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
      aplicarDetalheLocalV96(d.detalhe);conteudoAtualV96=d.detalhe;renderEditorConteudoV96(d.detalhe);
      const todosAvisos=[...avisosLocais,...(d.avisos||[])];
      status.innerText=d.alteracoes?.length?`Salvo: ${d.alteracoes.join(', ')}.${todosAvisos.length?' Aviso: '+todosAvisos.join(' '):''}`:`Nenhuma alteração necessária.${todosAvisos.length?' '+todosAvisos.join(' '):''}`;
      await v88CarregarGestaoLocal(gestaoPagina,{silencioso:true});
    }catch(e){
      const msg=/plain\s*text.*null|plain\s*text.*empty/i.test(String(e.message||''))?'A descrição está vazia. Ela não pode ser enviada vazia ao Mercado Livre.':e.message;
      status.innerText='Erro: '+msg;
    }
    return;
  }

  const sku=String(conteudoAtualV96.sku||'').trim();
  if(!sku)return alert('Este anúncio não possui SKU. Preencha um SKU antes de usar a atualização em massa.');
  await carregarMasterLocalV32();
  const ids=masterAnunciosV32.filter(x=>String(x.sku||'').trim().toLowerCase()===sku.toLowerCase()).map(x=>String(x.id));
  if(!ids.length)return alert('Nenhum anúncio com este SKU foi encontrado.');
  const nomes={pictures:'fotos',description:'descrição',attributes:'características',title:'título',sku:'SKU'};
  const campos=Object.keys(patch).map(k=>nomes[k]||k);
  if(!confirm(`Aplicar ${campos.join(', ')} em ${ids.length.toLocaleString('pt-BR')} anúncio(s) do SKU ${sku}?\n\nSomente os campos realmente alterados serão enviados.`))return;

  let done=0,fail=0;
  for(let i=0;i<ids.length;i+=25){
    const lote=ids.slice(i,i+25);status.innerText=`Atualizando SKU ${sku}: ${done}/${ids.length}...`;
    try{
      const r=await fetch(`${RENDER_URL}/api/v96/anuncios/conteudo-massa`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:obterToken()},body:JSON.stringify({ids:lote,patch})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
      done+=Number(d.atualizados||0);fail+=Number(d.falhas||0);
      for(const rr of d.resultados||[])if(rr?.sucesso&&rr.detalhe)aplicarDetalheLocalV96(rr.detalhe);
    }catch(e){fail+=lote.length}
  }
  await idbSalvarItensV32(ids.map(id=>masterMapV32.get(id)).filter(Boolean));
  await v88CarregarGestaoLocal(gestaoPagina,{silencioso:true});
  status.innerText=`Concluído: ${done} atualizado(s), ${fail} falha(s).${avisosLocais.length?' '+avisosLocais.join(' '):''}`;
}

function aplicarDetalheLocalV96(d){
  if(!d?.id)return;
  const item=masterMapV32.get(String(d.id));if(!item)return;
  Object.assign(item,{title:d.title?tituloSomenteV76(d.title):item.title,sku:d.sku||item.sku,thumbnail:d.pictures?.[0]?.url||item.thumbnail,picture_count:Number(d.picture_count||0),description_exists:Boolean(d.description_exists),content_score:Number(d.content_score||0),missing_main:(d.missing_main||[]).map(x=>({id:x.id,name:x.name})),missing_secondary:(d.missing_secondary||[]).map(x=>({id:x.id,name:x.name})),content_audited_at:new Date().toISOString()});
}

function preencherSkusInteligenciaV96(){
  const dl=document.getElementById('intel-skus-v96');if(!dl)return;
  const skus=[...new Set(masterAnunciosV32.map(x=>String(x.sku||'').trim()).filter(x=>x&&x!=='Sem SKU'))].sort().slice(0,5000);
  dl.innerHTML=skus.map(s=>`<option value="${escapeHtml(s)}"></option>`).join('');
}

async function carregarInteligenciaV96(){
  await carregarMasterLocalV32();preencherSkusInteligenciaV96();renderMeusAnunciosIntelV96();carregarMonitoresV96();
}

async function analisarMercadoV96(monitor=false){
  const produto=document.getElementById('intel-produto-v96')?.value.trim()||'';
  const sku=document.getElementById('intel-sku-v96')?.value.trim()||'';

  if(!produto)return alert('Informe o nome do produto.');

  const status=document.getElementById('intel-status-v96');
  status.innerText='Consultando o Mercado Livre e procurando as melhores referências disponíveis...';

  try{
    const file=document.getElementById('intel-foto-v96')?.files?.[0];
    const image_data_url=file?await fileDataUrlV96(file):'';

    const r=await fetch(
      `${RENDER_URL}/api/v96/inteligencia/analisar`,
      {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          Authorization:obterToken()
        },
        body:JSON.stringify({
          produto,
          sku,
          image_data_url,
          monitor
        })
      }
    );

    const d=await r.json().catch(()=>({}));

    if(!r.ok){
      throw new Error(d.erro||`HTTP ${r.status}`);
    }

    inteligenciaAtualV96=d;
    monitorAtualV96=d.monitor_id||monitorAtualV96;

    renderInteligenciaV96(d);

    const fonte=d.snapshot?.source_label||'Mercado Livre';
    const analisados=Number(d.snapshot?.summary?.analyzed||0);
    const aviso=d.snapshot?.notice
      ?` ${d.snapshot.notice}`
      :'';

    status.innerText=
      `Análise concluída: ${analisados} referência(s) · ${fonte}.`+
      aviso+
      (d.monitor_id?' Monitoramento periódico ativado.':'');

    renderMeusAnunciosIntelV96();

    if(monitor)carregarMonitoresV96();
  }catch(e){
    const msg=String(e?.message||'');

    status.innerText=/forbidden/i.test(msg)
      ?'A busca textual foi bloqueada pela API. Atualize para a V98, que usa automaticamente o ranking oficial de mais vendidos como alternativa.'
      :'Erro: '+msg;
  }
}

function renderInteligenciaV96(d){
  const snapshot=d.snapshot||{};
  const s=snapshot.summary||{};

  const fonteTitle=document.getElementById('intel-fonte-title-v98');
  const fonteSub=document.getElementById('intel-fonte-sub-v98');

  if(fonteTitle){
    fonteTitle.innerText=snapshot.source_label||'Referências do Mercado Livre';
  }

  if(fonteSub){
    const cat=snapshot.category_name
      ?` · ${snapshot.category_name}`
      :'';

    fonteSub.innerText=snapshot.source==='highlights_category'
      ?`Ranking oficial BEST_SELLER do Mercado Livre${cat}. A posição representa o ranking de mais vendidos.`
      :`Ordem retornada pela busca do Mercado Livre no momento da análise${cat}.`;
  }

  const cards=[
    ['Analisados',s.analyzed||0],
    ['Preço mediano',Number(s.median_price||0)>0?moeda(Number(s.median_price||0)):'—'],
    ['Frete grátis',`${Number(s.free_shipping_pct||0)}%`],
    ['Com descrição',`${Number(s.description_pct||0)}%`],
    ['Média de fotos',Number(s.avg_pictures||0).toFixed(1)],
    ['Ficha técnica',`${Number(s.avg_required_completion||0)}%`]
  ];

  const box=document.getElementById('intel-resumo-v96');
  box.classList.remove('hidden');
  box.innerHTML=cards.map(([l,v])=>`
    <div class="panel rounded-2xl p-4">
      <div class="text-[9px] uppercase text-slate-500 font-black">${escapeHtml(l)}</div>
      <div class="text-xl font-black text-white mt-2">${escapeHtml(String(v))}</div>
    </div>
  `).join('');

  document.getElementById('intel-concorrentes-v96').innerHTML=
    (snapshot.items||[]).map(x=>{
      const sales=x.sales_signal
        ?escapeHtml(String(x.sales_signal))
        :Number(x.sold_quantity||0).toLocaleString('pt-BR');

      const price=Number(x.price||0)>0
        ?moeda(Number(x.price||0))
        :'—';

      const frete=x.reference_type==='ITEM'
        ?(x.free_shipping?'Grátis':'Pago')
        :'—';

      const link=x.permalink
        ?`<a href="${escapeHtml(x.permalink)}" target="_blank" class="text-[8px] text-blue-400">${escapeHtml(x.id)}</a>`
        :`<span class="text-[8px] text-slate-600">${escapeHtml(x.id)} · ${escapeHtml(x.reference_type||'')}</span>`;

      const img=x.thumbnail
        ?`<img src="${escapeHtml(x.thumbnail)}" class="w-10 h-10 rounded-lg object-cover bg-white">`
        :`<div class="w-10 h-10 rounded-lg bg-slate-900 border border-slate-800 grid place-items-center text-[8px] text-slate-600">ML</div>`;

      return `
        <tr>
          <td class="p-3 text-slate-500 font-black">${Number(x.position||0)}</td>
          <td class="p-3">
            <div class="flex items-center gap-3">
              ${img}
              <div>
                <div class="text-[10px] font-black text-white max-w-[360px]">${escapeHtml(x.title||'')}</div>
                ${link}
              </div>
            </div>
          </td>
          <td class="p-3 font-black text-white">${price}</td>
          <td class="p-3 text-slate-300">${sales}</td>
          <td class="p-3 ${x.free_shipping?'text-emerald-400':'text-slate-500'}">${frete}</td>
          <td class="p-3 text-slate-300">${Number(x.picture_count||0)}</td>
          <td class="p-3">
            <span class="${Number(x.required_completion)>=90?'text-emerald-400':'text-yellow-400'} font-black">
              ${Number(x.required_completion||0)}%
            </span>
          </td>
        </tr>
      `;
    }).join('');

  const r=d.recommendations||{};

  document.getElementById('intel-recomendacoes-v96').innerHTML=`
    ${snapshot.notice?`
      <div class="rounded-xl bg-blue-500/10 border border-blue-500/20 p-4">
        <div class="text-[9px] uppercase text-blue-400 font-black">Fonte alternativa automática</div>
        <div class="text-[10px] text-slate-300 mt-2 leading-5">${escapeHtml(snapshot.notice)}</div>
      </div>
    `:''}

    <div class="rounded-xl bg-slate-950/70 border border-slate-800 p-4">
      <div class="text-[9px] uppercase text-yellow-400 font-black">Diagnóstico</div>
      <div class="text-xs text-slate-300 mt-2 leading-5">${escapeHtml(r.diagnostic||'')}</div>
    </div>

    ${(r.priority_actions||[]).map((x,i)=>`
      <div class="rounded-xl border border-slate-800 p-3 flex gap-3">
        <span class="text-yellow-400 font-black text-[10px]">${String(i+1).padStart(2,'0')}</span>
        <span class="text-xs text-slate-300">${escapeHtml(x)}</span>
      </div>
    `).join('')}

    <div class="rounded-xl border border-slate-800 p-4 text-[10px] text-slate-400 space-y-2">
      <div><b class="text-white">Título:</b> ${escapeHtml(r.title_strategy||'')}</div>
      <div><b class="text-white">Descrição:</b> ${escapeHtml(r.description_strategy||'')}</div>
      <div><b class="text-white">Fotos:</b> ${escapeHtml(r.image_strategy||'')}</div>
      <div><b class="text-white">Preço:</b> ${escapeHtml(r.pricing_strategy||'')}</div>
    </div>

    <div class="text-[9px] text-slate-600">${escapeHtml(r.caveat||'')}</div>
  `;
}

function renderMeusAnunciosIntelV96(){
  const sku=document.getElementById('intel-sku-v96')?.value.trim()||'';
  const box=document.getElementById('intel-meus-anuncios-v96');if(!box)return;
  if(!sku){box.innerHTML='<div class="text-xs text-slate-500">Informe um SKU para listar seus anúncios.</div>';return}
  const itens=masterAnunciosV32.filter(x=>String(x.sku||'').trim().toLowerCase()===sku.toLowerCase()).slice(0,200);
  box.innerHTML=itens.map(x=>`<div class="rounded-2xl border border-slate-800 bg-slate-950/40 p-4 flex items-center gap-3"><img src="${escapeHtml(x.thumbnail||'')}" class="w-12 h-12 rounded-xl object-cover bg-white"><div class="min-w-0 flex-1"><div class="text-xs font-black text-white truncate">${escapeHtml(x.title)}</div><div class="text-[9px] text-slate-500 mt-1">${escapeHtml(x.id)} · ${moeda(x.price)} · ${Number(x.sold_quantity||0)} vendido(s)</div></div><button onclick="melhorarAnuncioV96('${escapeHtml(x.id)}')" class="bg-yellow-400 text-slate-950 text-[9px] font-black px-3 py-2 rounded-lg">Melhorar</button></div>`).join('')||'<div class="text-xs text-slate-500">Nenhum anúncio encontrado para este SKU.</div>';
}

document.addEventListener('input',e=>{if(e.target?.id==='intel-sku-v96')renderMeusAnunciosIntelV96()});

async function melhorarAnuncioV96(itemId){
  const monitorId=Number(monitorAtualV96||inteligenciaAtualV96?.monitor_id||0);
  if(!monitorId)return alert('Para gerar a melhoria, primeiro clique em Monitorar para salvar a análise deste produto.');
  mostrarLoading('Gerando uma proposta original para o seu anúncio...');
  try{
    const r=await fetch(`${RENDER_URL}/api/v96/inteligencia/melhorar`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:obterToken()},body:JSON.stringify({monitor_id:monitorId,item_id:itemId})});
    const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    propostaAtualV96=d.proposal;propostaItemV96=itemId;renderPropostaV96(d.proposal,itemId);
  }catch(e){alert(e.message)}finally{esconderLoading()}
}

function renderPropostaV96(p,itemId){
  const modal=document.getElementById('modal-proposta-v96');modal.classList.remove('hidden');
  document.getElementById('proposta-body-v96').innerHTML=`<div class="text-[10px] text-slate-500 mb-5">${escapeHtml(itemId)}</div><label class="text-[9px] uppercase text-slate-500 font-black">Título proposto</label><input id="proposta-title-v96" maxlength="60" value="${escapeHtml(p.title||'')}" class="w-full mt-2 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-xs text-white"><label class="block text-[9px] uppercase text-slate-500 font-black mt-5">Descrição proposta</label><textarea id="proposta-desc-v96" rows="14" class="w-full mt-2 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-xs text-white">${escapeHtml(p.description||'')}</textarea><div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5"><div class="rounded-xl border border-slate-800 p-4"><div class="text-[10px] text-emerald-400 font-black">Características seguras sugeridas</div><div class="mt-3 text-[10px] text-slate-300 space-y-2">${(p.attributes||[]).map(a=>`<div>${escapeHtml(a.id)} = ${escapeHtml(a.value_name)}</div>`).join('')||'<div class="text-slate-600">Nenhuma característica preenchida automaticamente.</div>'}</div></div><div class="rounded-xl border border-slate-800 p-4"><div class="text-[10px] text-yellow-400 font-black">Precisa de informação real</div><div class="mt-3 text-[10px] text-slate-300 space-y-2">${(p.needs_input||[]).map(a=>`<div><b>${escapeHtml(a.name||a.id)}</b><br><span class="text-slate-500">${escapeHtml(a.reason||'')}</span></div>`).join('')||'<div class="text-slate-600">Nada obrigatório pendente detectado.</div>'}</div></div></div><div class="rounded-xl border border-slate-800 p-4 mt-5"><div class="text-[10px] text-blue-400 font-black">Plano de fotos</div><div class="mt-2 text-[10px] text-slate-300 space-y-1">${(p.image_recommendations||[]).map(x=>`<div>• ${escapeHtml(x)}</div>`).join('')}</div></div><div class="text-[10px] text-slate-500 mt-5">${escapeHtml(p.rationale||'')}</div><div class="flex flex-wrap justify-end gap-2 mt-6"><button onclick="fecharPropostaV96()" class="bg-slate-800 text-slate-300 text-[10px] font-black px-4 py-2.5 rounded-xl">Cancelar</button><button onclick="aplicarPropostaV96(false)" class="bg-yellow-400 text-slate-950 text-[10px] font-black px-4 py-2.5 rounded-xl">Aplicar neste anúncio</button><button onclick="aplicarPropostaV96(true)" class="bg-emerald-500 text-slate-950 text-[10px] font-black px-4 py-2.5 rounded-xl">Aplicar no mesmo SKU</button></div>`;
}
function fecharPropostaV96(){document.getElementById('modal-proposta-v96')?.classList.add('hidden');propostaAtualV96=null;propostaItemV96=null}

async function aplicarPropostaV96(massa){
  if(!propostaAtualV96||!propostaItemV96)return;
  const item=masterMapV32.get(String(propostaItemV96));if(!item)return alert('Anúncio não encontrado no cache.');
  const patch={};
  const titulo=String(document.getElementById('proposta-title-v96')?.value||'').trim();
  const descricao=String(document.getElementById('proposta-desc-v96')?.value||'').trim();
  const attrs=Array.isArray(propostaAtualV96.attributes)?propostaAtualV96.attributes.filter(a=>a?.id&&(a?.value_id||a?.value_name)):[];
  if(titulo)patch.title=titulo;if(descricao)patch.description=descricao;if(attrs.length)patch.attributes=attrs;
  if(!Object.keys(patch).length)return alert('A proposta está vazia. Não há conteúdo seguro para aplicar.');

  if(!massa){
    mostrarLoading('Aplicando melhoria no Mercado Livre...');
    try{
      const r=await fetch(`${RENDER_URL}/api/v96/anuncios/${encodeURIComponent(item.id)}/conteudo`,{method:'PUT',headers:{'Content-Type':'application/json',Authorization:obterToken()},body:JSON.stringify(patch)});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
      aplicarDetalheLocalV96(d.detalhe);alert((d.avisos||[]).length?`Conteúdo salvo com aviso: ${(d.avisos||[]).join(' | ')}`:'Melhoria aplicada.');fecharPropostaV96();await v88CarregarGestaoLocal(gestaoPagina,{silencioso:true});
    }catch(e){alert(e.message)}finally{esconderLoading()}
    return;
  }
  const sku=String(item.sku||'').trim();if(!sku)return alert('Este anúncio não tem SKU.');
  const ids=masterAnunciosV32.filter(x=>String(x.sku||'').trim().toLowerCase()===sku.toLowerCase()).map(x=>String(x.id));
  if(!confirm(`Aplicar somente os campos preenchidos da proposta em ${ids.length} anúncio(s) do SKU ${sku}?`))return;
  mostrarLoading('Aplicando melhoria em massa por SKU...');let ok=0,fail=0;
  try{
    for(let i=0;i<ids.length;i+=25){
      const r=await fetch(`${RENDER_URL}/api/v96/anuncios/conteudo-massa`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:obterToken()},body:JSON.stringify({ids:ids.slice(i,i+25),patch})});
      const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
      ok+=Number(d.atualizados||0);fail+=Number(d.falhas||0);for(const rr of d.resultados||[])if(rr?.sucesso&&rr.detalhe)aplicarDetalheLocalV96(rr.detalhe);
    }
    alert(`Concluído: ${ok} atualizado(s), ${fail} falha(s).`);fecharPropostaV96();await v88CarregarGestaoLocal(gestaoPagina,{silencioso:true});
  }catch(e){alert(e.message)}finally{esconderLoading()}
}

async function melhorarTodosSkuV96(){
  const sku=document.getElementById('intel-sku-v96')?.value.trim()||'';if(!sku)return alert('Informe um SKU.');
  const item=masterAnunciosV32.find(x=>String(x.sku||'').trim().toLowerCase()===sku.toLowerCase());if(!item)return alert('Nenhum anúncio com este SKU.');
  melhorarAnuncioV96(item.id);
}

async function carregarMonitoresV96(){
  const box=document.getElementById('intel-monitores-v96');if(!box)return;
  try{
    const r=await fetch(`${RENDER_URL}/api/v96/inteligencia/monitores?_=${Date.now()}`,{cache:'no-store',headers:{Authorization:obterToken()}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
    const itens=d.itens||[];box.innerHTML=itens.map(m=>`<div class="rounded-2xl border border-slate-800 bg-slate-950/40 p-4"><div class="flex justify-between gap-3"><div><div class="text-xs font-black text-white">${escapeHtml(m.product_name)}</div><div class="text-[9px] text-slate-500 mt-1">SKU: ${escapeHtml(m.target_sku||'—')} · a cada ${Number(m.interval_minutes||60)} min</div></div><span class="v96-chip ${m.enabled?'text-emerald-400':'text-slate-500'}">${m.enabled?'ATIVO':'PAUSADO'}</span></div><div class="text-[9px] text-slate-600 mt-3">Última: ${m.last_scan_at?new Date(m.last_scan_at).toLocaleString('pt-BR'):'—'} · Próxima: ${m.next_scan_at?new Date(m.next_scan_at).toLocaleString('pt-BR'):'—'}</div>${m.last_error?`<div class="text-[9px] text-red-300 mt-2">${escapeHtml(m.last_error)}</div>`:''}<div class="flex flex-wrap gap-2 mt-4"><button onclick="usarMonitorV96(${Number(m.id)})" class="bg-yellow-400 text-slate-950 text-[9px] font-black px-3 py-2 rounded-lg">Abrir análise</button><button onclick="executarMonitorV96(${Number(m.id)})" class="bg-slate-800 text-slate-200 text-[9px] font-black px-3 py-2 rounded-lg">Analisar agora</button><button onclick="toggleMonitorV96(${Number(m.id)},${m.enabled?'false':'true'})" class="bg-slate-900 text-slate-400 text-[9px] font-black px-3 py-2 rounded-lg">${m.enabled?'Pausar':'Ativar'}</button></div></div>`).join('')||'<div class="text-xs text-slate-500">Nenhum produto monitorado ainda.</div>';
    window._monitoresV96=itens;
  }catch(e){box.innerHTML=`<div class="text-xs text-red-300">${escapeHtml(e.message)}</div>`}
}
function usarMonitorV96(id){const m=(window._monitoresV96||[]).find(x=>Number(x.id)===Number(id));if(!m)return;monitorAtualV96=Number(m.id);document.getElementById('intel-produto-v96').value=m.product_name||'';document.getElementById('intel-sku-v96').value=m.target_sku||'';inteligenciaAtualV96={monitor_id:Number(m.id),snapshot:m.last_snapshot||{},recommendations:m.last_recommendations||{}};renderInteligenciaV96(inteligenciaAtualV96);renderMeusAnunciosIntelV96();document.getElementById('intel-status-v96').innerText='Análise salva carregada. Você pode executar uma nova leitura a qualquer momento.'}
async function executarMonitorV96(id){const status=document.getElementById('intel-status-v96');status.innerText='Atualizando monitor...';try{const r=await fetch(`${RENDER_URL}/api/v96/inteligencia/monitores/${id}/executar`,{method:'POST',headers:{Authorization:obterToken()}});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);monitorAtualV96=Number(id);inteligenciaAtualV96={monitor_id:Number(id),...d};renderInteligenciaV96(d);status.innerText='Monitor atualizado.';carregarMonitoresV96()}catch(e){status.innerText='Erro: '+e.message}}
async function toggleMonitorV96(id,enabled){try{const r=await fetch(`${RENDER_URL}/api/v96/inteligencia/monitores/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json',Authorization:obterToken()},body:JSON.stringify({enabled,interval_minutes:60})});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);carregarMonitoresV96()}catch(e){alert(e.message)}}
