
/* =========================================================
   V37 \u2014 CRIA\u00c7\u00c3O EM MASSA COM FOTO / SEO / URLS / MULTICATEGORIA
========================================================= */
window.criarEstadoV37={
    modo:null,
    userProductSeller:false,
    referenceImages:[],
    selectedCategories:[],
    pictures:[],
    jobId:null,
    jobTimer:null,
    sugest\u00f5es:[],
    variationAttributeIds:[],
    variationRows:[]
};

function lerArquivoDataUrlV37(file){
    return new Promise((resolve,reject)=>{
        const fr=new FileReader();
        fr.onload=()=>resolve(String(fr.result||''));
        fr.onerror=()=>reject(new Error('N\u00e3o foi poss\u00edvel ler o arquivo.'));
        fr.readAsDataURL(file);
    });
}

function debounceV37(fn,wait=250){
    let t=null;return function(...args){clearTimeout(t);t=setTimeout(()=>fn.apply(this,args),wait)};
}

function textoEscapeV37(v){return escapeHtml(String(v??''));}

function bindPreviewListenersV37(){
    document.querySelectorAll('.campo-preview-v37').forEach(el=>{
        if(el.dataset.v37bound==='1')return;
        el.dataset.v37bound='1';
        el.addEventListener('input',debounceV37(renderPlanilhaPreviewV37,150));
        el.addEventListener('change',renderPlanilhaPreviewV37);
    });
}

async function carregarFotosReferenciaV37(ev){
    cancelarConteudoV61();
    try{
        const files=[...(ev?.target?.files||[])].slice(0,8);
        criarEstadoV37.referenceImages=[];
    criarEstadoV37.cloudflareReferenceImages=[];
        for(const file of files){
            criarEstadoV37.referenceImages.push(await lerArquivoDataUrlV37(file));
        }
        renderFotosReferenciaV37();
        renderPlanilhaPreviewV37();
    }catch(e){
        alert('Erro ao carregar fotos: '+e.message);
    }
}

function renderFotosReferenciaV37(){
    const box=document.getElementById('criar-fotos-preview-v37');
    if(!box)return;
    box.innerHTML=(criarEstadoV37.referenceImages||[]).map((src,i)=>`
        <div class="rounded-xl overflow-hidden border border-slate-700 bg-slate-950 aspect-square relative">
            <img src="${src}" class="w-full h-full object-cover">
            <div class="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] px-2 py-1">Foto ${i+1}</div>
        </div>
    `).join('') || '<div class="text-[11px] text-slate-500 col-span-full">Nenhuma foto enviada ainda.</div>';
}

async function carregarCriacaoMassaV37(){
    const token=obterToken();
    bindPreviewListenersV37();
    if(!token)return;
    try{
        const r=await fetch(`${RENDER_URL}/api/v36/criar/status?_=${Date.now()}`,{cache:'no-store',headers:{Authorization:token}});
        const d=await r.json().catch(()=>({}));
        if(r.ok){
            criarEstadoV37.modo=d.modo;
            criarEstadoV37.userProductSeller=Boolean(d.user_product_seller);
            const el=document.getElementById('criar-modo-v37');
            if(el){
                el.innerHTML=d.user_product_seller
                  ? '<span class="text-emerald-400 font-black">User Products ativo</span><div class="text-[10px] text-slate-500 mt-1">Varia\u00e7\u00f5es ser\u00e3o itens separados da mesma fam\u00edlia.</div>'
                  : '<span class="text-yellow-400 font-black">Modelo legado</span><div class="text-[10px] text-slate-500 mt-1">Varia\u00e7\u00f5es ser\u00e3o publicadas no array variations quando permitido.</div>';
            }
        }
    }catch(e){}
    const jobId=localStorage.getItem('mlHubPro_mass_create_job_v37');
    if(jobId)acompanharCriacaoV37(jobId);
    renderFotosReferenciaV37();
    renderCategoriasSelecionadasV37();
    atualizarAtributosVariacaoV37();
    renderPlanilhaPreviewV37();
}
window.carregarCriacaoMassaV36=carregarCriacaoMassaV37;

async function sugerirCategoriaV37(){
    const token=obterToken();
    if(!token){solicitarToken();return}
    const termo=String(document.getElementById('criar-categoria-busca-v37')?.value || document.getElementById('criar-produto-v37')?.value || '').trim();
    if(!termo)return alert('Informe o produto ou o termo da categoria.');
    mostrarLoading('Buscando categorias...');
    try{
        const r=await fetch(`${RENDER_URL}/api/v36/criar/categorias?q=${encodeURIComponent(termo)}`,{headers:{Authorization:token}});
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
        criarEstadoV37.sugest\u00f5es=Array.isArray(d.categorias)?d.categorias:[];
        const sel=document.getElementById('criar-categoria-select-v37');
        sel.innerHTML='<option value="">Escolha uma categoria sugerida</option>'+criarEstadoV37.sugest\u00f5es.map(c=>`<option value="${textoEscapeV37(c.category_id)}">${textoEscapeV37(c.category_path||c.category_name)} \u00b7 ${textoEscapeV37(c.category_id)}</option>`).join('');
        if(criarEstadoV37.sugest\u00f5es[0])sel.value=criarEstadoV37.sugest\u00f5es[0].category_id;
    }catch(e){
        alert('Erro ao sugerir categorias: '+e.message);
    }finally{esconderLoading();}
}

async function adicionarCategoriaSelecionadaV37(){
    const token=obterToken();
    if(!token){solicitarToken();return}
    const sel=document.getElementById('criar-categoria-select-v37');
    const id=String(sel?.value||'').trim();
    if(!id)return alert('Escolha uma categoria para adicionar.');
    if(criarEstadoV37.selectedCategories.some(c=>c.category_id===id))return;
    mostrarLoading('Carregando categoria, subcategorias e caracter\u00edsticas...');
    try{
        const r=await fetch(`${RENDER_URL}/api/v36/criar/categorias/${encodeURIComponent(id)}/atributos`,{headers:{Authorization:token}});
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
        const sug=(criarEstadoV37.sugest\u00f5es||[]).find(x=>String(x.category_id)===id);
        const path=Array.isArray(d?.categoria?.path_from_root)&&d.categoria.path_from_root.length
          ? d.categoria.path_from_root.map(p=>p?.name).filter(Boolean).join(' > ')
          : String(sug?.category_path||sug?.category_name||d?.categoria?.name||id);
        const leaf=Array.isArray(d?.categoria?.path_from_root)&&d.categoria.path_from_root.length
          ? String(d.categoria.path_from_root[d.categoria.path_from_root.length-1]?.name||d?.categoria?.name||id)
          : String(sug?.category_leaf_name||sug?.category_name||d?.categoria?.name||id);
        criarEstadoV37.selectedCategories.push({
            category_id:id,
            category_name:String(sug?.category_name||d?.categoria?.name||id),
            category_path:path,
            category_leaf_name:leaf,
            atributos:Array.isArray(d.atributos_visiveis)?d.atributos_visiveis:(Array.isArray(d.atributos)?d.atributos:[]),
            max_pictures_per_item:Number(d.max_pictures_per_item||0)||null,
            listing_allowed:d.listing_allowed!==false,
            values:{}
        });
        preencherCaracteristicasV65(true);
        renderCategoriasSelecionadasV37();
        atualizarAtributosVariacaoV37();
        renderPlanilhaPreviewV37();
    }catch(e){
        alert('Erro ao adicionar categoria: '+e.message);
    }finally{esconderLoading();}
}

function removerCategoriaV37(id){
    criarEstadoV37.selectedCategories=criarEstadoV37.selectedCategories.filter(c=>c.category_id!==id);
    renderCategoriasSelecionadasV37();
    atualizarAtributosVariacaoV37();
    renderPlanilhaPreviewV37();
}

function aplicarSugestoesCategoriaV37(categoryId,suggestedAttrs=[]){
    const cat=criarEstadoV37.selectedCategories.find(c=>c.category_id===categoryId);
    if(!cat)return;
    for(const a of (suggestedAttrs||[])){
        const key=String(a?.id||'').trim();
        if(!key)continue;
        cat.values[key]={value_id:a.value_id||'',value_name:a.value_name||''};
    }
}

function ordenarAtributosCategoriaV37(lista=[]){
    return [...(Array.isArray(lista)?lista:[])]
      .filter(a=>!a?.read_only && a?.visible_to_buyer!==false)
      .sort((a,b)=>{
          const ga=Number(a?.group_relevance??999),gb=Number(b?.group_relevance??999);
          if(ga!==gb)return ga-gb;
          const oa=Number(a?.output_order??9999),ob=Number(b?.output_order??9999);
          if(oa!==ob)return oa-ob;
          return String(a?.name||a?.id||'').localeCompare(String(b?.name||b?.id||''),'pt-BR');
      });
}

function renderCategoriasSelecionadasV37(){
    const chips=document.getElementById('criar-categorias-selecionadas-v37');
    const forms=document.getElementById('criar-categorias-form-v37');
    if(!chips||!forms)return;

    chips.innerHTML=criarEstadoV37.selectedCategories.map(c=>{
        const path=String(c.category_path||c.category_name||c.category_id||'');
        const leaf=String(c.category_leaf_name||path.split(' > ').pop()||c.category_name||'');
        return `<div class="rounded-2xl bg-slate-900 border border-slate-700 px-4 py-3 text-[11px] text-white min-w-[280px]">
            <div class="flex items-start justify-between gap-3">
                <div>
                    <div class="font-black text-white">${textoEscapeV37(c.category_name)}</div>
                    <div class="text-[10px] text-slate-400 mt-1">${textoEscapeV37(path)}</div>
                    <div class="text-[10px] text-yellow-400 mt-1">Categoria final: ${textoEscapeV37(leaf)}</div>
                    <div class="text-[10px] text-slate-500 mt-1">ID: ${textoEscapeV37(c.category_id)}</div>
                </div>
                <button onclick="removerCategoriaV37('${textoEscapeV37(c.category_id)}')" class="text-red-400 font-black text-lg leading-none">\u00d7</button>
            </div>
        </div>`;
    }).join('') || '<div class="text-[11px] text-slate-500">Nenhuma categoria selecionada.</div>';

    forms.innerHTML=criarEstadoV37.selectedCategories.map(c=>{
        const variacoesAtivas=String(document.getElementById('criar-variacao-enabled-v37')?.value||'0')==='1';
        const idsVariacao=new Set((criarEstadoV37.variationAttributeIds||[]).map(String));
        const attrs=ordenarAtributosCategoriaV37(c.atributos||[]).filter(a=>!(variacoesAtivas&&idsVariacao.has(String(a.id))));
        const path=String(c.category_path||c.category_name||c.category_id||'');
        const leaf=String(c.category_leaf_name||path.split(' > ').pop()||c.category_name||'');
        const grupos=[
            {label:'Caracter\u00edsticas principais',attrs:attrs.filter(a=>String(a.display_level||'').toLowerCase()==='principal')},
            {label:'Caracter\u00edsticas secund\u00e1rias',attrs:attrs.filter(a=>String(a.display_level||'').toLowerCase()!=='principal')}
        ].filter(g=>g.attrs.length);
        return `
        <div class="panel rounded-2xl p-4">
            <div class="text-sm font-black text-white">${textoEscapeV37(c.category_name)}</div>
            <div class="text-[10px] text-slate-400 mt-1">${textoEscapeV37(path)}</div>
            <div class="text-[10px] text-yellow-400 mt-1">Categoria final: ${textoEscapeV37(leaf)}</div>
            <div class="text-[10px] text-emerald-400 mt-2">Exibindo caracter\u00edsticas principais e secund\u00e1rias edit\u00e1veis da ficha do Mercado Livre (${attrs.length}). Campos t\u00e9cnicos internos ficam ocultos.${variacoesAtivas&&idsVariacao.size?' Os atributos escolhidos para variar s\u00e3o preenchidos exclusivamente na se\u00e7\u00e3o 3, uma vez por varia\u00e7\u00e3o.':''}</div>
            <button onclick="preencherCaracteristicasV65()" class="mt-3 border border-emerald-600 text-emerald-300 rounded-lg px-3 py-2 text-xs font-bold">Preencher caracter\u00edsticas com os dados do produto</button>
            ${grupos.map(g=>`<div class="mt-5">
                <div class="text-[11px] uppercase tracking-wider font-black text-white border-b border-slate-800 pb-2">${textoEscapeV37(g.label)}</div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                ${g.attrs.map(a=>{
                    const current=c.values?.[a.id]||{};
                    const labelClass=a.required?'text-yellow-400':'text-slate-400';
                    const badge=a.required?' \u00b7 obrigat\u00f3rio':'';
                    const isAlfanumerico=String(a.id||'').toUpperCase()==='ALPHANUMERIC_MODEL';
                    const isNA=String(current.value_id||'')==='-1';
                    const naHtml=isAlfanumerico && !a.required ? `<label class="mt-2 flex items-center gap-2 text-[10px] text-slate-300 cursor-pointer"><input type="checkbox" ${isNA?'checked':''} onchange="setCategoriaNaoAplicaV52('${textoEscapeV37(c.category_id)}','${textoEscapeV37(a.id)}',this.checked)" class="w-4 h-4 accent-yellow-400"> N\u00e3o se aplica</label>` : '';
                    if(String(a.id).toUpperCase()==='BRAND'){
                        const listId='marcas-v62-'+String(c.category_id).replace(/[^a-z0-9-]/ig,'');
                        return `<div>
                            <label class="text-[9px] uppercase font-black ${labelClass}">${textoEscapeV37(a.name||'Marca')}${badge}</label>
                            <input value="${textoEscapeV37(current.value_name||'')}" list="${listId}" oninput="setCategoriaMarcaV62('${textoEscapeV37(c.category_id)}',this.value)" maxlength="${Number(a.value_max_length)>0?Number(a.value_max_length):120}" class="w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white" placeholder="Selecione ou digite a marca real">
                            <datalist id="${listId}">${(a.values||[]).slice(0,300).map(v=>`<option value="${textoEscapeV37(v.name||'')}"></option>`).join('')}</datalist>
                            <div class="text-[10px] text-slate-500 mt-1">Voc\u00ea pode escrever uma marca que n\u00e3o aparece nas sugest\u00f5es.</div>
                        </div>`;
                    }
                    if(Array.isArray(a.values)&&a.values.length){
                        return `<div>
                            <label class="text-[9px] uppercase font-black ${labelClass}">${textoEscapeV37(a.name||a.id)}${badge}</label>
                            <select ${isNA?'disabled':''} onchange="setCategoriaValorV37('${textoEscapeV37(c.category_id)}','${textoEscapeV37(a.id)}',this)" class="w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white disabled:opacity-50">
                                <option value="">Selecione...</option>
                                ${a.values.slice(0,150).map(v=>`<option value="${textoEscapeV37(v.id||'')}" data-name="${textoEscapeV37(v.name||'')}" ${String(current.value_id||'')===String(v.id||'') || (!current.value_id&&String(current.value_name||'').toLowerCase()===String(v.name||'').toLowerCase()) ? 'selected':''}>${textoEscapeV37(v.name||v.id)}</option>`).join('')}
                            </select>${naHtml}
                        </div>`;
                    }
                    return `<div>
                        <label class="text-[9px] uppercase font-black ${labelClass}">${textoEscapeV37(a.name||a.id)}${badge}</label>
                        <input ${isNA?'disabled':''} value="${textoEscapeV37(isNA?'':(current.value_name||''))}" oninput="setCategoriaTextoV37('${textoEscapeV37(c.category_id)}','${textoEscapeV37(a.id)}',this.value)" class="w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white disabled:opacity-50" placeholder="${isNA?'N\u00e3o se aplica':'Valor'}">${naHtml}
                    </div>`;
                }).join('')}
                </div>
            </div>`).join('')}
        </div>`;
    }).join('');
}

function setCategoriaValorV37(categoryId,attrId,select){
    criarEstadoV37.titulosSessaoV69=null;if(criarEstadoV37.conteudoRunV61)criarEstadoV37.conteudoRunV61.edicaoAtributoV69=true;
    const cat=criarEstadoV37.selectedCategories.find(c=>c.category_id===categoryId); if(!cat)return;
    const opt=select.options[select.selectedIndex];
    cat.values[attrId]={value_id:String(select.value||''),value_name:String(opt?.dataset?.name||opt?.textContent||'').trim()};
    atualizarAtributosVariacaoV37();
    renderPlanilhaPreviewV37();
}
function setCategoriaTextoV37(categoryId,attrId,value){
    criarEstadoV37.titulosSessaoV69=null;if(criarEstadoV37.conteudoRunV61)criarEstadoV37.conteudoRunV61.edicaoAtributoV69=true;
    const cat=criarEstadoV37.selectedCategories.find(c=>c.category_id===categoryId); if(!cat)return;
    cat.values[attrId]={value_name:String(value||'').trim()};
    atualizarAtributosVariacaoV37();
    renderPlanilhaPreviewV37();
}

function setCategoriaNaoAplicaV52(categoryId,attrId,checked){
    criarEstadoV37.titulosSessaoV69=null;if(criarEstadoV37.conteudoRunV61)criarEstadoV37.conteudoRunV61.edicaoAtributoV69=true;
    const cat=criarEstadoV37.selectedCategories.find(c=>c.category_id===categoryId); if(!cat)return;
    if(checked)cat.values[attrId]={value_id:'-1',value_name:null};
    else cat.values[attrId]={value_name:''};
    renderCategoriasSelecionadasV37();
    atualizarAtributosVariacaoV37();
    renderPlanilhaPreviewV37();
}

function atributosVariacaoDisponiveisV53(){
    const map=new Map();
    (criarEstadoV37.selectedCategories||[]).forEach(c=>{
        (c.atributos||[]).forEach(a=>{
            if(a?.read_only)return;
            if(a.allow_variations || a.variation_attribute || a.child_pk){
                const id=String(a.id||'').trim();
                if(!id)return;
                if(!map.has(id))map.set(id,{...a,categories:1});
                else map.get(id).categories=(map.get(id).categories||1)+1;
            }
        });
    });
    return [...map.values()];
}

function defAtributoVariacaoV53(id){
    const key=String(id||'');
    for(const c of (criarEstadoV37.selectedCategories||[])){
        const achou=(c.atributos||[]).find(a=>String(a?.id||'')===key);
        if(achou)return achou;
    }
    return null;
}

function garantirLinhasVariacaoV53(){
    const count=Math.min(100,Math.max(1,Number(document.getElementById('criar-variacao-qtd-v37')?.value||1)));
    const rows=Array.isArray(criarEstadoV37.variationRows)?criarEstadoV37.variationRows:[];
    while(rows.length<count){
        const n=rows.length+1;
        rows.push({
            index:n-1,
            sku_suffix:String(n).padStart(2,'0'),
            price:'',
            stock:'',
            size_grid_row_id:'',
            attributes:{}
        });
    }
    if(rows.length>count)rows.length=count;
    rows.forEach((r,i)=>{
        r.index=i;
        if(!r.attributes||typeof r.attributes!=='object')r.attributes={};
        if(r.size_grid_row_id==null)r.size_grid_row_id='';
        if(r.sku_suffix==null||r.sku_suffix==='')r.sku_suffix=String(i+1).padStart(2,'0');
    });
    criarEstadoV37.variationRows=rows;
    return rows;
}

function sincronizarAtributosVariacaoV53(){
    const defs=atributosVariacaoDisponiveisV53();
    const valid=new Set(defs.map(a=>String(a.id)));
    let selected=(criarEstadoV37.variationAttributeIds||[]).map(String).filter(id=>valid.has(id));

    if(!selected.length && defs.length){
        const child=defs.filter(a=>a.child_pk).map(a=>String(a.id));
        if(child.length){
            selected=[...new Set(child)];
        }else{
            const comuns=defs.filter(a=>/(^|_)(SIZE|COLOR|MAIN_COLOR|FABRIC_DESIGN|DESIGN|PATTERN|VOLTAGE|TAMANHO|COR)(_|$)/i.test(String(a.id||'')) || /(tamanho|cor|desenho|estampa|textura|voltagem)/i.test(String(a.name||''))).slice(0,3).map(a=>String(a.id));
            selected=comuns.length?[...new Set(comuns)]:[String(defs[0].id)];
        }
    }
    criarEstadoV37.variationAttributeIds=selected;
    garantirLinhasVariacaoV53();
}

function valorAtualVariacaoV53(row,attrId){
    const v=row?.attributes?.[attrId]||{};
    return String(v.value_name??v.value_id??'');
}

function normalizarValorVariacaoV53(attrId,valor){
    const def=defAtributoVariacaoV53(attrId);
    const txt=String(valor||'').trim();
    if(!txt)return {value_id:'',value_name:''};
    const vals=Array.isArray(def?.values)?def.values:[];
    const alvo=txt.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const match=vals.find(v=>{
        const nome=String(v?.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        return nome===alvo || String(v?.id||'')===txt;
    });
    if(match)return {value_id:String(match.id||''),value_name:String(match.name||txt)};
    return {value_id:'',value_name:txt};
}

function setVariacaoAtributoV53(index,attrId,value){
    garantirLinhasVariacaoV53();
    const row=criarEstadoV37.variationRows[Number(index)];if(!row)return;
    row.attributes[String(attrId)]=normalizarValorVariacaoV53(attrId,value);
    if(/SIZE|TAMANHO/i.test(String(attrId||''))){
        const linha=acharLinhaGuiaV57(row);
        if(!aplicarTamanhoCanonicoGuiaV60(row,linha))row.size_grid_row_id='';
    }
    // Mant\u00e9m o foco enquanto o vendedor digita; redesenha ao concluir o campo.
    renderPlanilhaPreviewV37();
}

function setVariacaoCampoV53(index,campo,value){
    garantirLinhasVariacaoV53();
    const row=criarEstadoV37.variationRows[Number(index)];if(!row)return;
    if(campo==='price'||campo==='stock')row[campo]=String(value||'').replace(',','.');
    else row[campo]=String(value||'').trim();
    if(campo==='size_grid_row_id'){
        const linha=(criarEstadoV37.sizeGuideRowsV57||[]).find(l=>String(l.row_id)===String(value));
        if(linha)aplicarTamanhoCanonicoGuiaV60(row,linha);
        else aplicarLinhasGuiaAutomaticamenteV57();
        renderEditorVariacoesV53();
    }
    renderPlanilhaPreviewV37();
}

function toggleAtributoVariacaoV53(attrId,checked){
    const id=String(attrId||'');
    const set=new Set((criarEstadoV37.variationAttributeIds||[]).map(String));
    if(checked)set.add(id); else set.delete(id);
    criarEstadoV37.variationAttributeIds=[...set];
    garantirLinhasVariacaoV53();
    renderCategoriasSelecionadasV37();
    renderEditorVariacoesV53();
    renderPlanilhaPreviewV37();
}

function normalizarTamanhoGuiaV57(valor){
    const raw=String(valor??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    const limpo=raw.replace(/\b(brasil|br|bra|tamanho|tam\.?|numero|num\.?|n\u00ba|no\.?|size)\b/g,' ')
      .replace(/[^a-z0-9.,/+\-]+/g,' ').replace(/\s+/g,' ').trim();
    const nums=(limpo.match(/\d+(?:[.,]\d+)?/g)||[]).map(x=>String(Number(x.replace(',','.'))));
    return {texto:limpo,numeros:nums};
}
function tamanhoLinhaVariacaoV57(row){
    const attrs=row?.attributes||{};
    const pref=['SIZE','BR_SIZE','M_BR_SIZE','F_BR_SIZE','KIDS_BR_SIZE','MANUFACTURER_SIZE','FILTRABLE_SIZE'];
    for(const id of pref){
        const v=attrs[id];
        const txt=String(v?.value_name??v?.value_id??'').trim();
        if(txt)return txt;
    }
    for(const [id,v] of Object.entries(attrs)){
        if(!/SIZE|TAMANHO/i.test(id))continue;
        const txt=String(v?.value_name??v?.value_id??'').trim();
        if(txt)return txt;
    }
    return '';
}
function partesTamanhoGuiaV60(valor,attributeId=''){
    let texto=String(valor??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
      .replace(/\b(tamanho|tam\.?|numero|num\.?|size)\b/g,' ').replace(/brasil|\bbra\b/g,'br').replace(/,/g,'.');
    const sistema=texto.match(/^(br|us|uk|eu|ar|mx|cl|co|pe)(?=\s|\d)|(?:\d|\s)(br|us|uk|eu|ar|mx|cl|co|pe)\s*$/i);
    const sistemaId=String(attributeId).match(/(?:^|_)(BR|US|UK|EU|AR|MX|CL|CO|PE)_SIZE$/i);
    const region=String(sistema?.[1]||sistema?.[2]||sistemaId?.[1]||'').toUpperCase();
    const full=texto.replace(/\s+/g,'').replace(/\d+(?:\.\d+)?/g,n=>String(Number(n)));
    if(sistema){
        texto=texto.replace(/^(br|us|uk|eu|ar|mx|cl|co|pe)(?=\s|\d)|(?:br|us|uk|eu|ar|mx|cl|co|pe)\s*$/i,'');
    }
    const base=texto.replace(/\s+/g,'').replace(/\d+(?:\.\d+)?/g,n=>String(Number(n)));
    return {full,base,region};
}

function pontuarTamanhoGuiaV60(tamanho,valores,mainAttributeId=''){
    const alvo=partesTamanhoGuiaV60(tamanho);
    if(!alvo.base)return 0;
    let melhor=0;
    for(const v of valores||[]){
        const id=String(v?.attribute_id||'');
        const parte=partesTamanhoGuiaV60(v?.value_name,id==='SIZE'?mainAttributeId:id);
        if(alvo.region && parte.region && alvo.region!==parte.region)continue;
        const prioridade=id==='SIZE'?15:id===mainAttributeId?10:0;
        let score=0;
        if(alvo.full===parte.full)score=100+prioridade;
        else if(alvo.base===parte.base){
            if(alvo.region)score=parte.region===alvo.region?90+prioridade:0;
            else if(parte.region==='BR')score=80+prioridade;
            else if(id==='SIZE'||id===mainAttributeId)score=70+prioridade;
            else if(id!=='FILTRABLE_SIZE')score=50+prioridade;
        }
        melhor=Math.max(melhor,score);
    }
    return melhor;
}


function acharLinhaGuiaV57(row){
    const tamanho=tamanhoLinhaVariacaoV57(row);
    if(!tamanho)return null;
    const linhas=Array.isArray(criarEstadoV37.sizeGuideRowsV57)?criarEstadoV37.sizeGuideRowsV57:[];
    const candidatas=linhas.map(l=>({linha:l,score:pontuarTamanhoGuiaV60(tamanho,l.size_values||[...(l.sizes||[])].map((v,i)=>({attribute_id:i===0?'SIZE':'',value_name:v})),String(l.main_attribute_id||''))}))
      .filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
    if(!candidatas.length || (candidatas[1]&&candidatas[0].score===candidatas[1].score))return null;
    return candidatas[0].linha;
}

function aplicarTamanhoCanonicoGuiaV60(row,linha){
    if(!row||!linha?.row_id)return false;
    row.size_grid_row_id=String(linha.row_id);
    const size=linha.size_attribute;
    if(size?.value_name){
        row.attributes=row.attributes||{};
        row.attributes.SIZE={value_name:String(size.value_name),...(size.value_id?{value_id:String(size.value_id)}:{})};
    }
    return true;
}

function atualizarCodigoGuiaV60(){
    const gridId=String(document.getElementById('criar-size-grid-id-v56')?.value||'').trim();
    if(String(criarEstadoV37.sizeGuideIdV60||'')!==gridId){
        criarEstadoV37.sizeGuideRowsV57=[];
        criarEstadoV37.sizeGuideIdV60='';
        (criarEstadoV37.variationRows||[]).forEach(r=>r.size_grid_row_id='');
        const status=document.getElementById('criar-size-grid-status-v57');
        if(status){status.textContent=gridId?'Carregue o guia para associar os tamanhos.':'Informe o c\u00f3digo do guia para carregar os tamanhos.';status.className='text-[10px] text-slate-500 mt-3';}
    }
    renderEditorVariacoesV53();renderPlanilhaPreviewV37();
}
function aplicarLinhasGuiaAutomaticamenteV57(){
    let encontrados=0;
    garantirLinhasVariacaoV53().forEach(row=>{
        const linha=acharLinhaGuiaV57(row);
        if(aplicarTamanhoCanonicoGuiaV60(row,linha))encontrados++;
        else row.size_grid_row_id='';
    });
    return encontrados;
}
async function carregarGuiaTamanhoV57(silencioso=false){
    const gridId=String(document.getElementById('criar-size-grid-id-v56')?.value||'').trim();
    const status=document.getElementById('criar-size-grid-status-v57');
    const requestId=(criarEstadoV37.sizeGuideRequestV60||0)+1;
    criarEstadoV37.sizeGuideRequestV60=requestId;
    criarEstadoV37.sizeGuideRowsV57=[];criarEstadoV37.sizeGuideIdV60='';
    if(!gridId){if(status)status.textContent='Informe o c\u00f3digo do guia para carregar os tamanhos.';return;}
    const token=obterToken();
    if(!token){if(!silencioso)solicitarToken();return;}
    if(status){status.textContent='Consultando o guia de tamanhos no Mercado Livre...';status.className='text-[10px] text-sky-400 mt-3';}
    try{
        const r=await fetch(`${RENDER_URL}/api/v57/criar/guia-tamanho/${encodeURIComponent(gridId)}`,{cache:'no-store',headers:{Authorization:token}});
        const d=await r.json().catch(()=>({}));
        if(requestId!==criarEstadoV37.sizeGuideRequestV60 || gridId!==String(document.getElementById('criar-size-grid-id-v56')?.value||'').trim())return;
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
        criarEstadoV37.sizeGuideRowsV57=Array.isArray(d.rows)?d.rows:[];
        criarEstadoV37.sizeGuideIdV60=gridId;
        const achados=aplicarLinhasGuiaAutomaticamenteV57();
        renderEditorVariacoesV53();renderPlanilhaPreviewV37();
        if(status){status.textContent=`Guia ${gridId} carregado: ${criarEstadoV37.sizeGuideRowsV57.length} linha(s). ${achados} varia\u00e7\u00e3o(\u00f5es) associada(s) automaticamente pelo tamanho.`;status.className='text-[10px] text-emerald-400 mt-3';}
    }catch(e){
        if(requestId!==criarEstadoV37.sizeGuideRequestV60)return;
        criarEstadoV37.sizeGuideRowsV57=[];criarEstadoV37.sizeGuideIdV60='';
        if(status){status.textContent='N\u00e3o foi poss\u00edvel carregar o guia: '+e.message;status.className='text-[10px] text-red-400 mt-3';}
        if(!silencioso)alert('Erro ao carregar guia de tamanhos: '+e.message);
    }
}

function renderEditorVariacoesV53(){
    const ativo=String(document.getElementById('criar-variacao-enabled-v37')?.value||'0')==='1';
    const editor=document.getElementById('criar-variacao-editor-v53');
    const attrBox=document.getElementById('criar-variacao-atributos-v53');
    const rowsBox=document.getElementById('criar-variacao-linhas-v53');
    const resumo=document.getElementById('criar-variacao-resumo-v53');
    if(!editor||!attrBox||!rowsBox)return;

    editor.classList.toggle('hidden',!ativo);
    if(!ativo)return;

    sincronizarAtributosVariacaoV53();
    const defs=atributosVariacaoDisponiveisV53();
    const selected=new Set((criarEstadoV37.variationAttributeIds||[]).map(String));
    const rows=garantirLinhasVariacaoV53();

    attrBox.innerHTML=defs.length?defs.map(a=>{
        const id=String(a.id||'');
        const marcado=selected.has(id);
        const destaque=a.child_pk?'border-emerald-500/40 bg-emerald-500/5':'border-slate-700 bg-slate-900';
        return `<label class="inline-flex items-center gap-2 rounded-xl border ${destaque} px-3 py-2 text-[10px] text-slate-200 cursor-pointer">
            <input type="checkbox" class="w-4 h-4 accent-yellow-400" ${marcado?'checked':''} onchange="toggleAtributoVariacaoV53('${textoEscapeV37(id)}',this.checked)">
            <span><b>${textoEscapeV37(a.name||id)}</b>${a.child_pk?'<span class="text-emerald-400"> \u00b7 varia\u00e7\u00e3o principal</span>':''}</span>
        </label>`;
    }).join(''):'<div class="text-[10px] text-amber-400">A categoria escolhida n\u00e3o informou atributos pr\u00f3prios de varia\u00e7\u00e3o. Se isso estiver incorreto, escolha a categoria final exata do produto.</div>';

    const attrDefs=[...selected].map(id=>defAtributoVariacaoV53(id)).filter(Boolean);
    rowsBox.innerHTML=rows.map((row,i)=>{
        const camposAttrs=attrDefs.map(a=>{
            const id=String(a.id||'');
            const current=valorAtualVariacaoV53(row,id);
            const listId=`var-v53-${i}-${id.replace(/[^a-zA-Z0-9_-]/g,'_')}`;
            const opts=(Array.isArray(a.values)?a.values:[]).slice(0,200);
            return `<div>
                <label class="text-[9px] uppercase font-black ${a.child_pk?'text-emerald-400':'text-sky-400'}">${textoEscapeV37(a.name||id)}</label>
                <input list="${listId}" value="${textoEscapeV37(current)}" oninput="setVariacaoAtributoV53(${i},'${textoEscapeV37(id)}',this.value)" onchange="renderEditorVariacoesV53()" class="w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white" placeholder="Preencha ${textoEscapeV37(a.name||id)}">
                ${opts.length?`<datalist id="${listId}">${opts.map(v=>`<option value="${textoEscapeV37(v.name||v.id||'')}"></option>`).join('')}</datalist>`:''}
            </div>`;
        }).join('');

        return `<div class="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
            <div class="flex items-center justify-between gap-3">
                <div class="text-[11px] font-black text-white">Varia\u00e7\u00e3o ${i+1}</div>
                <div class="text-[9px] text-slate-500">Ser\u00e1 aplicada a todos os t\u00edtulos/fam\u00edlias</div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <div>
                    <label class="text-[9px] uppercase font-black text-slate-500">SKU / sufixo</label>
                    <input value="${textoEscapeV37(row.sku_suffix||'')}" oninput="setVariacaoCampoV53(${i},'sku_suffix',this.value)" class="w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white" placeholder="${String(i+1).padStart(2,'0')}">
                </div>
                <div>
                    <label class="text-[9px] uppercase font-black text-slate-500">Pre\u00e7o desta varia\u00e7\u00e3o \u2014 opcional</label>
                    <input type="number" step="0.01" min="0" value="${textoEscapeV37(row.price||'')}" oninput="setVariacaoCampoV53(${i},'price',this.value)" class="w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white" placeholder="Usar pre\u00e7o geral">
                </div>
                <div>
                    <label class="text-[9px] uppercase font-black text-slate-500">Estoque desta varia\u00e7\u00e3o \u2014 opcional</label>
                    <input type="number" step="1" min="0" value="${textoEscapeV37(row.stock||'')}" oninput="setVariacaoCampoV53(${i},'stock',this.value)" class="w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white" placeholder="Usar estoque geral">
                </div>
            </div>

            <div class="mt-3 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
                <label class="text-[9px] uppercase font-black text-sky-400">Linha do guia de tamanho \u2014 SIZE_GRID_ROW_ID</label>
                ${Array.isArray(criarEstadoV37.sizeGuideRowsV57)&&criarEstadoV37.sizeGuideRowsV57.length?`
                <select onchange="setVariacaoCampoV53(${i},'size_grid_row_id',this.value)" class="w-full mt-2 bg-slate-950 border border-sky-500/30 rounded-lg px-3 py-2 text-xs text-white">
                    <option value="">Selecionar automaticamente pelo tamanho</option>
                    ${criarEstadoV37.sizeGuideRowsV57.map(l=>`<option value="${textoEscapeV37(l.row_id||'')}" ${String(row.size_grid_row_id||'')===String(l.row_id||'')?'selected':''}>${textoEscapeV37(l.label||l.row_id||'')}</option>`).join('')}
                </select>`:`
                <input value="${textoEscapeV37(row.size_grid_row_id||'')}" readonly class="w-full mt-2 bg-slate-950/60 border border-sky-500/20 rounded-lg px-3 py-2 text-xs text-slate-400" placeholder="Autom\u00e1tico: carregue o guia e informe o tamanho">`}
                <div class="text-[9px] text-slate-500 mt-1">V58: este ID \u00e9 t\u00e9cnico e agora \u00e9 validado pelo pr\u00f3prio guia do Mercado Livre. Informe o tamanho; o painel escolhe a linha correta automaticamente.</div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                ${camposAttrs || '<div class="text-[10px] text-slate-500 md:col-span-2">Marque pelo menos um atributo de varia\u00e7\u00e3o acima.</div>'}
            </div>
        </div>`;
    }).join('');

    if(resumo){
        resumo.textContent=`${rows.length} varia\u00e7\u00e3o(\u00f5es) \u00d7 cada t\u00edtulo/fam\u00edlia \u00b7 ${selected.size} atributo(s) vari\u00e1vel(is)`;
    }
}

function atualizarAtributosVariacaoV37(){
    sincronizarAtributosVariacaoV53();
    renderEditorVariacoesV53();
}

function ajustarQuantidadeVariacoesV53(){
    const el=document.getElementById('criar-variacao-qtd-v37');
    if(el){
        let n=Math.round(Number(el.value||1));
        if(!Number.isFinite(n))n=1;
        n=Math.min(100,Math.max(1,n));
        el.value=String(n);
    }
    garantirLinhasVariacaoV53();
    renderEditorVariacoesV53();
    renderPlanilhaPreviewV37();
}

function alternarVariacoesV37(){
    const ativo=String(document.getElementById('criar-variacao-enabled-v37')?.value||'0')==='1';
    const qtd=document.getElementById('criar-variacao-qtd-v37');
    if(qtd)qtd.disabled=!ativo;
    sincronizarAtributosVariacaoV53();
    renderCategoriasSelecionadasV37();
    renderEditorVariacoesV53();
    renderPlanilhaPreviewV37();
}

/* V65 \u2014 t\u00edtulos exclusivos e caracter\u00edsticas confirmadas. */
/* V66: mesma compara\u00e7\u00e3o no navegador e no PostgreSQL. */
function assinaturaTituloV66(valor){
    // V72: unicidade pela SEQUÊNCIA completa das palavras.
    // Normaliza acentos, caixa e pontuação, mas PRESERVA a ordem.
    // Assim, títulos com a mesma sequência são bloqueados; uma ordem realmente diferente
    // é considerada outra sequência e não dispara falso duplicado por “mesmas palavras”.
    return chaveTextoV65(valor);
}

function chaveTextoV65(valor){
    return textoConteudoV61(valor).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function tituloLimpoV65(valor){
    const palavras=textoConteudoV61(valor).replace(/[|/;,]+/g,' ').split(' '),out=[],seen=new Set();
    const ligacao=/^(de|do|da|dos|das|e|com|para|sem|em|a|o)$/i;
    for(const palavra of palavras){const key=chaveTextoV65(palavra);if(!key)continue;if(!ligacao.test(palavra)&&seen.has(key))continue;seen.add(key);out.push(palavra);}
    while(out.length&&ligacao.test(out[out.length-1]))out.pop();
    return out.join(' ');
}
function validarTitulosUnicosV65(config){
    const titulos=Array.isArray(config.titles)?config.titles:[],seen=new Set();
    const falhar=mensagem=>{const e=new Error(mensagem);e.status=422;throw e;};
    const total=Number(config.quantity||titulos.length||1);
    if(!Number.isInteger(total)||total<1)falhar('Informe uma quantidade inteira de t\u00edtulos.');
    if(titulos.length<total)falhar(`Foram solicitados ${total} t\u00edtulos, mas existem ${titulos.length} t\u00edtulos \u00fanicos. Acrescente informa\u00e7\u00f5es ou palavras-chave e gere novamente, ou ajuste a quantidade.`);
    for(let i=0;i<total;i++){
        const t=textoConteudoV61(titulos[i]),key=assinaturaTituloV66(t);
        if(!key)falhar(`O t\u00edtulo ${i+1} est\u00e1 vazio.`);
        if(t.length>60)falhar(`O t\u00edtulo ${i+1} ultrapassa 60 caracteres.`);
        if(seen.has(key))falhar(`O t\u00edtulo ${i+1} repete a mesma sequ\u00eancia de palavras de outro t\u00edtulo. Cada t\u00edtulo precisa ter uma sequ\u00eancia completa \u00fanica.`);
        seen.add(key);
    }
    return true;
}
function expandirTitulosConfirmadosV61(payload,quantidade){
    const seen=new Set(),out=[];
    for(const raw of payload.titulos||payload.titulos_semente||[]){
        if(typeof raw!=='string')continue;
        const t=textoConteudoV61(raw),key=assinaturaTituloV66(t);
        if(!key||t.length>60||seen.has(key))continue;
        seen.add(key);out.push(t);if(out.length>=quantidadeConteudoV61(quantidade))break;
    }return out;
}
function fatosPreenchimentoV65(entrada){
    const agente=entrada.agente_contexto||{},out=[];
    if(agente.brand)out.unshift({name:'Marca',value:agente.brand});
    const textos=[entrada.detalhes,agente.technical_sheet,agente.information,agente.applications,agente.notes].filter(Boolean);
    for(const texto of textos)for(const linha of String(texto).split(/[\n;]+/)){
        const m=linha.trim().match(/^([^:]{2,90}):\s*(.{1,500})$/);
        if(m)out.push({name:m[1].trim(),value:m[2].trim()});
    }
    out.push(...(agente.approved_facts||[]));
    const produto=String(entrada.produto||agente.product||'');
    const modelo=produto.match(/\b[A-Z]{1,6}[- ]?\d{1,6}[A-Z0-9-]*\b/i);
    if(modelo&&!out.some(f=>chaveTextoV65(f.name)==='modelo'))out.push({name:'Modelo',value:modelo[0]});
    const cor=produto.match(/\b(branco|branca|preto|preta|azul|rosa|vermelho|vermelha|verde|dourado|dourada|prateado|prateada|cinza|bege|marrom)\b/i);
    if(cor&&!out.some(f=>chaveTextoV65(f.name)==='cor'))out.push({name:'Cor',value:cor[0]});
    return out;
}
function atributosAutomaticosV65(entrada){
    const fatos=fatosPreenchimentoV65(entrada);
    const aliases={brand:['marca'],model:['modelo'],alphanumeric_model:['modelo alfanumerico'],color:['cor'],voltage:['voltagem','tensao'],
        power:['potencia'],with_rechargeable_battery:['inclui bateria recarregavel','bateria recarregavel'],
        is_wireless:['e sem fio','sem fio'],power_type:['tipo de alimentacao','alimentacao'],
        number_of_combs:['quantidade de pentes'],battery_voltage:['voltagem da bateria','tensao da bateria']};
    const bool=v=>/^(sim|true|s|yes)$/i.test(v)?'sim':/^(nao|n\u00e3o|false|n|no)$/i.test(v)?'nao':chaveTextoV65(v);
    return (entrada.categorias||[]).map(c=>{
        const suggested=[];
        for(const a of c.atributos||[]){
            const id=String(a.id||'');if(!id||a.read_only||/^(SELLER_|SIZE_GRID_|GTIN|EAN|UPC)/.test(id))continue;
            if((entrada.variacao_ids||[]).includes(id))continue;
            if(c.values?.[id]?.value_name||c.values?.[id]?.value_id)continue;
            const nomes=new Set([chaveTextoV65(a.name),chaveTextoV65(id),...(aliases[id.toLowerCase()]||[])]);
            const f=fatos.find(f=>nomes.has(chaveTextoV65(f.name)));if(!f)continue;
            let valor=textoConteudoV61(f.value),value_id='';
            const escolhas=Array.isArray(a.values)?a.values:[];
            if(escolhas.length){
                let escolha=escolhas.find(v=>bool(v.name)===bool(valor));
                if(!escolha&&id==='COLOR')escolha=escolhas.find(v=>chaveTextoV65(v.name).replace(/a$/,'o')===chaveTextoV65(valor).replace(/a$/,'o'));
                if(escolha){valor=String(escolha.name);value_id=String(escolha.id||'');}
                else if(id!=='BRAND')continue;
            }
            if(valor&&valor.length<=Number(a.value_max_length||500))suggested.push({id,value_name:valor,...(value_id?{value_id}:{})});
        }
        return {...c,suggested_attributes:suggested};
    });
}

function textoConteudoV61(valor){
    return String(valor??'').replace(/\s+/g,' ').trim();
}
function quantidadeConteudoV61(valor){
    const n=Number(valor);return Number.isFinite(n)?Math.min(5000,Math.max(1,Math.floor(n))):1;
}
// V65: gera\u00e7\u00e3o exclusiva nas fun\u00e7\u00f5es compartilhadas abaixo.
function termosUnicosV62(lista,limite=80){
    const itens=Array.isArray(lista)?lista:String(lista||'').split(/[,;\n]/);
    const out=[],seen=new Set();
    for(const item of itens){
        const termo=textoConteudoV61(item).slice(0,120);
        const key=termo.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
        if(termo.length>1&&!seen.has(key)){seen.add(key);out.push(termo);}
        if(out.length>=limite)break;
    }
    return out;
}

function fatosConteudoV62(entrada){
    const out=[],seen=new Set();
    const add=(nome,valor)=>{
        nome=textoConteudoV61(nome);valor=textoConteudoV61(valor);
        if(!valor||valor==='-1'||!nome)return;
        const key=(nome+':'+valor).toLowerCase();
        if(!seen.has(key)){seen.add(key);out.push({name:nome,value:valor});}
    };
    // Caracter\u00edsticas do an\u00fancio t\u00eam preced\u00eancia sobre a base do agente.
    for(const c of entrada.categorias||[]){
        const defs=new Map((c.atributos||[]).map(a=>[String(a.id),a]));
        for(const [id,v] of Object.entries(c.values||{})){
            if(String(v?.value_id||'')==='-1'||/^(SIZE_GRID_|SELLER_|GTIN|EAN|UPC)/.test(id))continue;
            add(defs.get(id)?.name||id,v?.value_name);
        }
    }
    const agente=entrada.agente_contexto||{};
    if(agente.brand&&!out.some(f=>/^(marca|brand)$/i.test(f.name)))add('Marca',agente.brand);
    for(const f of agente.approved_facts||[]){
        if(!out.some(x=>x.name.toLowerCase()===String(f.name||'').toLowerCase()))add(f.name,f.value);
    }
    return out.slice(0,80);
}

function baseConfirmadaAgenteV62(agente){
    if(!agente)return '';
    return [agente.brand?'Marca: '+agente.brand:'',agente.information||'',
        agente.technical_sheet?'Ficha t\u00e9cnica informada:\n'+agente.technical_sheet:'',
        agente.applications?'Aplica\u00e7\u00f5es informadas:\n'+agente.applications:'',
        agente.notes?'Informa\u00e7\u00f5es adicionais:\n'+agente.notes:'',
        (agente.approved_facts||[]).length?'Informa\u00e7\u00f5es revisadas:\n'+agente.approved_facts.map(f=>f.name+': '+f.value).join('\n'):''].filter(Boolean).join('\n\n');
}

function keywordsLocaisV62(entrada,fatos=fatosConteudoV62(entrada)){
    const nome=textoConteudoV61(entrada.produto||entrada.agente_contexto?.product);
    const palavras=nome.split(' ').filter(p=>p.length>2&&!/^(com|para|por|dos|das|uma|sem)$/i.test(p));
    const nucleo=palavras[0]||'';
    const lista=[nome,...(entrada.agente_contexto?.keywords||[]),...palavras];
    for(let i=0;i<palavras.length;i++){
        for(let n=2;n<=4&&i+n<=palavras.length;n++)lista.push(palavras.slice(i,i+n).join(' '));
        if(i>0&&nucleo)lista.push(nucleo+' '+palavras[i]);
    }
    for(const f of fatos){
        if(!nucleo||/^(modelo|model|tamanho|size|largura)/i.test(f.name))continue;
        lista.push(nucleo+' '+f.value);
        if(palavras.length>1)lista.push(palavras.slice(0,2).join(' ')+' '+f.value);
    }
    // Express\u00f5es de busca usam apenas informa\u00e7\u00f5es confirmadas; n\u00e3o fabricam volumes.
    return termosUnicosV62(lista,80);
}

function rascunhoConteudoV61(entrada){
    const produto=textoConteudoV61(entrada.produto||entrada.agente_contexto?.product);
    const detalhes=String(entrada.detalhes||'').trim();
    const agente=entrada.agente_contexto||{};
    const fatos=fatosConteudoV62(entrada);
    const keywords=termosUnicosV62([...(entrada.keywords_titulos||[]),...keywordsLocaisV62(entrada,fatos)],120);
    const partes=[];
    if(produto){
        partes.push(produto.toUpperCase());
        const destaque=fatos.filter(f=>!/^(tamanho|size|modelo|model)$/i.test(f.name)).slice(0,4).map(f=>f.name.toLowerCase()+': '+f.value).join('; ');
        partes.push('Conhe\u00e7a '+produto+'. '+(destaque?'A vers\u00e3o apresentada re\u00fane as seguintes caracter\u00edsticas: '+destaque+'. ':'')+
            'A seguir, consulte os detalhes do produto para escolher a op\u00e7\u00e3o adequada ao que voc\u00ea procura.');
    }
    const informacoes=[...new Set([detalhes,String(agente.information||'').trim()].filter(Boolean))];
    if(informacoes.length)partes.push('SOBRE O PRODUTO\n'+informacoes.join('\n\n'));
    const ficha=[agente.technical_sheet||'',...fatos.map(f=>f.name+': '+f.value)].filter(Boolean);
    if(ficha.length)partes.push('CARACTER\u00cdSTICAS E FICHA T\u00c9CNICA\n'+ficha.join('\n'));
    if(agente.applications)partes.push('APLICA\u00c7\u00d5ES E FORMAS DE USO\n'+agente.applications);
    else if(/t[e\u00ea]nis/i.test(produto)&&/casual/i.test(produto)){
        partes.push('ESTILO E COMBINA\u00c7\u00d5ES\nO estilo casual permite compor o visual com pe\u00e7as do dia a dia. Observe a cor, o modelo e as op\u00e7\u00f5es de numera\u00e7\u00e3o do an\u00fancio para escolher a combina\u00e7\u00e3o que voc\u00ea deseja.');
    }
    if(agente.notes)partes.push('INFORMA\u00c7\u00d5ES ADICIONAIS\n'+agente.notes);
    if(produto)partes.push('ORIENTA\u00c7\u00d5ES PARA A COMPRA\nConfira as imagens, as caracter\u00edsticas e a op\u00e7\u00e3o selecionada antes de finalizar o pedido. Quando houver varia\u00e7\u00f5es, escolha o tamanho, a cor ou o modelo correspondente ao produto desejado. Se precisar esclarecer algum detalhe que n\u00e3o esteja na ficha, utilize o campo de perguntas do an\u00fancio.');
    const payload={sucesso:true,produto_detectado:produto,resumo:'',keywords,descricao:partes.join('\n\n'),
        image_prompt:'',categorias:atributosAutomaticosV65(entrada),origem:'rascunho_local',rascunho:true,modo_rapido:true};
    payload.titulos=expandirTitulosConfirmadosV61(payload,entrada.quantidade);
    payload.titulos_semente=[...new Set(payload.titulos)].slice(0,30);
    return payload;
}

function hashConteudoV61(valor){
    const s=String(valor||'');let a=2166136261,b=2246822507;
    for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);a=Math.imul(a^c,16777619);b=Math.imul(b^c,3266489909);}
    return (a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
function entradaConteudoV61(){
    const categorias=(criarEstadoV37.selectedCategories||[]).map(c=>({category_id:String(c.category_id),category_name:String(c.category_name||''),
        category_path:String(c.category_path||''),category_leaf_name:String(c.category_leaf_name||''),
        atributos:(c.atributos||[]).filter(a=>!a.read_only).map(a=>({id:String(a.id),name:String(a.name||a.id),value_type:a.value_type||'string',required:Boolean(a.required),value_max_length:a.value_max_length,
            values:(a.values||[]).slice(0,300).map(v=>({id:v.id,name:v.name}))})),
        values:Object.fromEntries(Object.entries(c.values||{}).sort(([a],[b])=>a.localeCompare(b)).map(([id,v])=>[id,{value_id:v.value_id||'',value_name:v.value_name??''}]))})).sort((a,b)=>a.category_id.localeCompare(b.category_id));
    const entrada={produto:String(document.getElementById('criar-produto-v37')?.value||'').trim(),
        detalhes:String(document.getElementById('criar-detalhes-v37')?.value||'').trim(),
        quantidade:quantidadeConteudoV61(document.getElementById('criar-qtd-v37')?.value),categorias,
        category_ids:categorias.map(c=>c.category_id),reference_images:[...(criarEstadoV37.referenceImages||[])].slice(0,1),
        keywords_titulos:termosUnicosV62(document.getElementById('criar-keywords-v37')?.value||'',120),
        variacao_ids:String(document.getElementById('criar-variacao-enabled-v37')?.value||'0')==='1'?[...(criarEstadoV37.variationAttributeIds||[])]:[],
        agente_id:String(document.getElementById('criar-agente-v62')?.value||'').trim(),
        agente_contexto:typeof contextoAgenteCriacaoV62==='function'?contextoAgenteCriacaoV62():null};
    const identidade={produto:entrada.produto,detalhes:entrada.detalhes,categories:entrada.category_ids,values:categorias.map(c=>[c.category_id,c.values]),
        keywords:entrada.keywords_titulos,variacao_ids:entrada.variacao_ids,foto:entrada.reference_images.map(hashConteudoV61),conta:hashConteudoV61(obterToken()),agente:entrada.agente_contexto,agente_id:entrada.agente_id};
    entrada.identity=hashConteudoV61(JSON.stringify(identidade));
    entrada.cacheKey='mlhubpro_v69_conteudo_'+hashConteudoV61(JSON.stringify({...identidade,values:categorias.map(c=>[c.category_id,c.values])}));
    return entrada;
}
function camposConteudoV61(){
    return Object.fromEntries(['criar-titulos-v37','criar-descricao-v37','criar-keywords-v37'].map(id=>[id,String(document.getElementById(id)?.value||'')]));
}
function aplicarConteudoRapidoV61(d,antes=null){
    if(d.produto_detectado&&!String(document.getElementById('criar-produto-v37')?.value||'').trim())document.getElementById('criar-produto-v37').value=d.produto_detectado;
    const campos={'criar-titulos-v37':(d.titulos||[]).join('\n'),'criar-descricao-v37':d.descricao||'','criar-keywords-v37':(d.keywords||[]).join(', ')};
    for(const [id,value] of Object.entries(campos)){const el=document.getElementById(id);if(el&&(!antes||String(el.value)===antes[id]))el.value=value;}
    for(const c of d.categorias||[]){
        const cat=criarEstadoV37.selectedCategories.find(x=>String(x.category_id)===String(c.category_id));if(!cat)continue;
        for(const a of c.suggested_attributes||[]){
            const id=String(a?.id||'');if(!id||cat.values?.[id]?.value_name||cat.values?.[id]?.value_id)continue;
            cat.values=cat.values||{};cat.values[id]={value_id:a.value_id||'',value_name:a.value_name||''};
        }
    }
    const urls=document.getElementById('criar-imagens-urls-v37');
    if(urls&&!urls.dataset.prompt&&d.image_prompt)urls.dataset.prompt=d.image_prompt;
    renderCategoriasSelecionadasV37();renderPlanilhaPreviewV37();atualizarInformacaoTitulosV65();
}
function statusConteudoV61(texto,tipo='ok'){
    const st=document.getElementById('criar-validacao-v37');if(!st)return;
    st.textContent=texto;st.className=`text-[11px] ${tipo==='ok'?'text-emerald-400':tipo==='erro'?'text-red-400':'text-yellow-400'} mt-1`;
}
function restaurarBotaoConteudoV61(run){
    if(run?.button){run.button.disabled=false;run.button.innerHTML=run.buttonHTML;}
}
function cancelarConteudoV61(){
    const run=criarEstadoV37.conteudoRunV61;if(!run)return;
    run.cancelled=true;clearTimeout(run.previewTimerV68);for(const c of run.controllersV68||[])c.abort();run.controller.abort();clearTimeout(run.timer);restaurarBotaoConteudoV61(run);
    criarEstadoV37.conteudoRunV61=null;
}
function comSinalConteudoV61(promise,signal){
    return new Promise((resolve,reject)=>{
        const abort=()=>{const e=new Error('Prazo r\u00e1pido encerrado.');e.name='AbortError';reject(e);};
        if(signal.aborted){abort();return;}
        signal.addEventListener('abort',abort,{once:true});
        promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value);},e=>{signal.removeEventListener('abort',abort);reject(e);});
    });
}

function chaveCacheConteudoV45(){return entradaConteudoV61().cacheKey;}
function salvarCacheConteudoV45(payload,key=chaveCacheConteudoV45()){
    if(payload?.rascunho)return;
    try{
        localStorage.setItem(key,JSON.stringify({created_at:Date.now(),data:payload}));
        const keys=[];
        for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k?.startsWith('mlhubpro_v69_conteudo_'))keys.push(k);}
        if(keys.length>20){
            keys.sort((a,b)=>{try{return JSON.parse(localStorage.getItem(a)).created_at-JSON.parse(localStorage.getItem(b)).created_at;}catch{return 0;}});
            keys.slice(0,keys.length-20).forEach(k=>localStorage.removeItem(k));
        }
    }catch(e){}
}
function lerCacheConteudoV45(key=chaveCacheConteudoV45()){
    try{
        const obj=JSON.parse(localStorage.getItem(key)||'null');
        if(!obj||obj.data?.rascunho||Date.now()-Number(obj.created_at||0)>12*60*60*1000)return null;
        return obj.data||null;
    }catch(e){return null;}
}
function chaveCacheKeywordsV45(){
    return 'mlhubpro_v67_keywords_'+entradaConteudoV61().identity;
}
function salvarCacheKeywordsV45(payload){
    try{localStorage.setItem(chaveCacheKeywordsV45(),JSON.stringify({created_at:Date.now(),data:payload}));}catch(e){}
}
function lerCacheKeywordsV45(){
    try{
        const raw=localStorage.getItem(chaveCacheKeywordsV45());
        if(!raw)return null;
        const obj=JSON.parse(raw);
        if(Date.now()-Number(obj?.created_at||0)>1000*60*60*12)return null;
        return obj?.data||null;
    }catch(e){return null;}
}
function aplicarConteudoGeradoV45(d){
    if(d.produto_detectado && !String(document.getElementById('criar-produto-v37')?.value||'').trim())document.getElementById('criar-produto-v37').value=d.produto_detectado;
    document.getElementById('criar-titulos-v37').value=(d.titulos||[]).join('\n');
    document.getElementById('criar-descricao-v37').value=d.descricao||'';
    document.getElementById('criar-keywords-v37').value=(d.keywords||[]).join(', ');
    const categorias=Array.isArray(d.categorias)?d.categorias:[];
    categorias.forEach(c=>{
        const local=criarEstadoV37.selectedCategories.find(x=>String(x.category_id)===String(c.category_id));
        if(local){
            if(c.category_path)local.category_path=String(c.category_path);
            if(c.category_leaf_name)local.category_leaf_name=String(c.category_leaf_name);
        }
        aplicarSugestoesCategoriaV37(c.category_id,c.suggested_attributes||[]);
    });
    renderCategoriasSelecionadasV37();
    if(!document.getElementById('criar-detalhes-v37').value && d.resumo){
        document.getElementById('criar-detalhes-v37').value=d.resumo;
    }
    if(!document.getElementById('criar-imagens-urls-v37').dataset.prompt && d.image_prompt){
        document.getElementById('criar-imagens-urls-v37').dataset.prompt=d.image_prompt;
    }
    renderPlanilhaPreviewV37();
}
function removerImagemGeradaV45(indice){
    const idx=Number(indice);
    criarEstadoV37.pictures=(criarEstadoV37.pictures||[]).filter((p,i)=>Number(p.index||i)!==idx);
    renderImagensGeradasV37();
    gerarUrlsFotosV37();
    renderPlanilhaPreviewV37();
    atualizarProgressoImagensV40((criarEstadoV37.pictures||[]).length,'Imagem removida. Clique em \u201cGerar / continuar\u201d para refazer a que faltou.','aviso');
}
function limparImagensGeradasV45(){
    if(!confirm('Deseja apagar as imagens geradas do painel para refazer novamente?'))return;
    criarEstadoV37.pictures=[];
    renderImagensGeradasV37();
    gerarUrlsFotosV37();
    renderPlanilhaPreviewV37();
    atualizarProgressoImagensV40(0,'Imagens apagadas do painel. Gere novamente quando quiser.','aviso');
}


function expandirTitulosLocalV46(payload,quantidade){
    return expandirTitulosConfirmadosV61({...payload,produto_detectado:payload.produto_detectado||document.getElementById('criar-produto-v37')?.value||''},quantidade);
}
async function referenciaRapidaConteudoV46(){
    const src=(criarEstadoV37.referenceImages||[])[0];
    if(!src)return [];
    try{return [await redimensionarReferenciaCloudflareV44(src,420)]}catch(e){return [src]}
}

async function gerarConteudoCriacaoV37(){
    return gerarFluxoTitulosV67(false);
}

function cancelarKeywordsV62(){
    const run=criarEstadoV37.keywordsRunV62;
    if(!run)return;
    run.controller.abort();
    criarEstadoV37.keywordsRunV62=null;
}

function renderFontesKeywordsV62(d){
    const el=document.getElementById('criar-keywords-fontes-v62');if(!el)return;
    el.innerHTML=(d.sources||[]).map(s=>{const u=urlFonteAgenteV62(s.url);return u?`<a href="${textoEscapeV37(u)}" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline mr-3">${textoEscapeV37(s.title||'Fonte consultada')}</a>`:'';}).join('');
    renderSugestoesGoogleV62(el,d.search_suggestions||'');
}

async function gerarKeywordsV38(){
    const token=obterToken();if(!token){solicitarToken();return;}
    const entrada=entradaConteudoV61();
    if(!entrada.produto)return alert('Informe o nome do produto para gerar palavras-chave.');
    const status=document.getElementById('criar-keywords-status-v38'),campo=document.getElementById('criar-keywords-v37');
    const cached=lerCacheKeywordsV45();
    if(cached){campo.value=(cached.keywords||[]).join(', ');renderFontesKeywordsV62(cached);if(status)status.textContent=`${cached.keywords?.length||0} palavras-chave carregadas da \u00faltima gera\u00e7\u00e3o.`;return;}
    if(criarEstadoV37.keywordsRunV62?.identity===entrada.identity)return;
    cancelarKeywordsV62();
    campo.value=termosUnicosV62([...termosUnicosV62(campo.value),...keywordsLocaisV62(entrada)],80).join(', ');
    const run={identity:entradaConteudoV61().identity,controller:new AbortController(),antes:campo.value};
    criarEstadoV37.keywordsRunV62=run;
    const botao=document.querySelector('button[onclick="gerarKeywordsV38()"]');
    if(botao)botao.disabled=true;
    if(status){status.textContent='Termos da base dispon\u00edveis. A IA est\u00e1 ampliando as sugest\u00f5es em segundo plano...';status.className='text-[10px] text-yellow-400';}
    const timer=setTimeout(()=>run.controller.abort(),90000);
    try{
        const r=await fetch(`${RENDER_URL}/api/v38/criar/ia/keywords`,{method:'POST',
            headers:{Authorization:token,'Content-Type':'application/json'},signal:run.controller.signal,
            body:JSON.stringify({produto:entrada.produto,detalhes:entrada.detalhes,category_ids:entrada.category_ids,categorias:entrada.categorias,agente_id:entrada.agente_id||null})});
        const d=await r.json().catch(()=>({}));
        if(criarEstadoV37.keywordsRunV62!==run||entradaConteudoV61().identity!==run.identity)return;
        if(!r.ok||!d.sucesso)throw new Error(d.erro||'N\u00e3o foi poss\u00edvel gerar as palavras-chave.');
        if(campo.value===run.antes)campo.value=termosUnicosV62(d.keywords||[],80).join(', ');
        if(!d.parcial)salvarCacheKeywordsV45(d);renderFontesKeywordsV62(d);
        if(status){status.textContent=d.parcial?d.observacao:`${d.keywords?.length||0} palavras-chave ${d.pesquisa_web?'ampliadas com apoio de fontes na internet':'geradas com os dados confirmados'}. Suas edi\u00e7\u00f5es foram preservadas.`;status.className=d.parcial?'text-[10px] text-yellow-400':'text-[10px] text-emerald-400';}
    }catch(e){
        if(criarEstadoV37.keywordsRunV62!==run||entradaConteudoV61().identity!==run.identity)return;
        if(status){status.textContent='Os termos da base foram mantidos. '+(e.name==='AbortError'?'A pesquisa n\u00e3o concluiu no prazo; tente novamente.':e.message);status.className='text-[10px] text-yellow-400';}
    }finally{clearTimeout(timer);if(botao)botao.disabled=false;if(criarEstadoV37.keywordsRunV62===run)criarEstadoV37.keywordsRunV62=null;}
}

async function redimensionarReferenciaCloudflareV44(src,maxDim=480){
    const img=await carregarImagemCanvasV40(src);
    const escala=Math.min(1,maxDim/Math.max(img.width,img.height));
    const w=Math.max(1,Math.round(img.width*escala));
    const h=Math.max(1,Math.round(img.height*escala));
    const canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,w,h);
    ctx.drawImage(img,0,0,w,h);
    return canvas.toDataURL('image/jpeg',0.90);
}

async function prepararReferenciasCloudflareV44(){
    const refs=(criarEstadoV37.referenceImages||[]).slice(0,4);
    if(!refs.length)return [];
    if(Array.isArray(criarEstadoV37.cloudflareReferenceImages) &&
       criarEstadoV37.cloudflareReferenceImages.length===refs.length){
        return criarEstadoV37.cloudflareReferenceImages;
    }
    const out=[];
    for(let i=0;i<refs.length;i++){
        out.push(await redimensionarReferenciaCloudflareV44(refs[i],480));
    }
    criarEstadoV37.cloudflareReferenceImages=out;
    return out;
}

function atualizarProgressoImagensV40(atual,msg,tipo='normal'){
    const total=11;
    const pct=Math.max(0,Math.min(100,Math.round((Number(atual||0)/total)*100)));
    const st=document.getElementById('criar-imagens-status-v40');
    const pe=document.getElementById('criar-imagens-pct-v40');
    const bar=document.getElementById('criar-imagens-bar-v40');
    if(st){st.textContent=msg||`${atual}/${total} imagens`;st.className=`text-[10px] ${tipo==='erro'?'text-red-400':tipo==='ok'?'text-emerald-400':tipo==='aviso'?'text-yellow-400':'text-slate-400'}`;}
    if(pe)pe.textContent=`${atual}/${total}`;
    if(bar)bar.style.width=`${pct}%`;
}

function carregarImagemCanvasV40(src){
    return new Promise((resolve,reject)=>{
        const img=new Image();
        img.onload=()=>resolve(img);
        img.onerror=()=>reject(new Error('N\u00e3o foi poss\u00edvel usar uma das fotos de refer\u00eancia.'));
        img.src=src;
    });
}

function desenharContainV40(ctx,img,x,y,w,h,scale=1){
    const r=Math.min(w/img.width,h/img.height)*scale;
    const dw=img.width*r,dh=img.height*r;
    ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
}
function desenharCoverV40(ctx,img,x,y,w,h,zoom=1){
    const r=Math.max(w/img.width,h/img.height)*zoom;
    const dw=img.width*r,dh=img.height*r;
    ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
}

async function criarComposicaoFallbackV40(index){
    const refs=criarEstadoV37.referenceImages||[];
    if(!refs.length)throw new Error('Envie pelo menos uma foto do produto para usar o modo visual gratuito.');
    const a=await carregarImagemCanvasV40(refs[index%refs.length]);
    const b=refs.length>1?await carregarImagemCanvasV40(refs[(index+1)%refs.length]):null;
    const canvas=document.createElement('canvas');canvas.width=1080;canvas.height=1080;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle=index===0?'#ffffff':(index%3===0?'#f8fafc':'#ffffff');ctx.fillRect(0,0,1080,1080);

    if(index===0){
        desenharContainV40(ctx,a,70,70,940,940,.96);
    }else if(index===3 && b){
        ctx.save();ctx.beginPath();ctx.roundRect(55,80,465,820,28);ctx.clip();desenharCoverV40(ctx,a,55,80,465,820,1);ctx.restore();
        ctx.save();ctx.beginPath();ctx.roundRect(560,180,465,820,28);ctx.clip();desenharCoverV40(ctx,b,560,180,465,820,1);ctx.restore();
    }else if(index===5 && b){
        desenharContainV40(ctx,a,40,40,650,650,.95);
        ctx.save();ctx.beginPath();ctx.arc(820,760,210,0,Math.PI*2);ctx.clip();desenharCoverV40(ctx,b,610,550,420,420,1.1);ctx.restore();
    }else if(index===7){
        desenharCoverV40(ctx,a,0,0,1080,1080,1.12);
        ctx.fillStyle='rgba(255,255,255,.88)';ctx.fillRect(0,840,1080,240);
    }else{
        const scales=[.90,1.05,1.20,.82,1.10,.95,1.25,.88,1.08,1.18];
        if(index%2===0)desenharContainV40(ctx,a,70,70,940,940,scales[index%scales.length]);
        else desenharCoverV40(ctx,a,90,90,900,900,Math.min(1.18,scales[index%scales.length]));
    }

    if(index>0){
        const rotulos=['Vista adicional','Detalhe do produto','Composi\u00e7\u00e3o visual','Outra perspectiva','Apresenta\u00e7\u00e3o do produto','Detalhe visual','Enquadramento adicional','Vista complementar','Destaque visual','Apresenta\u00e7\u00e3o final'];
        ctx.fillStyle='rgba(255,255,255,.92)';ctx.fillRect(48,48,390,64);
        ctx.fillStyle='#0f172a';ctx.font='600 28px Arial';ctx.fillText(rotulos[(index-1)%rotulos.length],68,90);
    }
    return canvas.toDataURL('image/jpeg',.94);
}

async function gerarFallbackRestanteV40(token,porIndice,inicio=0){
    const total=11;
    for(let idx=inicio;idx<total;idx++){
        if(porIndice.has(idx))continue;
        atualizarProgressoImagensV40(porIndice.size,`Cloudflare sem cota dispon\u00edvel. Criando composi\u00e7\u00e3o visual gratuita ${idx+1}/${total} a partir das suas fotos...`,'aviso');
        const dataUrl=await criarComposicaoFallbackV40(idx);
        const r=await fetch(`${RENDER_URL}/api/v40/criar/imagem-upload`,{
            method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},
            body:JSON.stringify({image_data_url:dataUrl,index:idx,tipo:'fallback',titulo:idx===0?'Capa em fundo branco':`Imagem visual ${idx+1}`})
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.picture)throw new Error(d.erro||`HTTP ${r.status}`);
        porIndice.set(idx,d.picture);
        criarEstadoV37.pictures=[...porIndice.values()].sort((a,b)=>Number(a.index||0)-Number(b.index||0));
        renderImagensGeradasV37();gerarUrlsFotosV37();renderPlanilhaPreviewV37();
        atualizarProgressoImagensV40(porIndice.size,`${porIndice.size}/${total} imagens prontas.`,'normal');
        await new Promise(r=>setTimeout(r,250));
    }
}

async function gerarPackImagensV37(){
    const token=obterToken();
    if(!token){solicitarToken();return}

    const produto=String(document.getElementById('criar-produto-v37')?.value||'').trim();
    const detalhes=String(document.getElementById('criar-detalhes-v37')?.value||'').trim();
    if(!produto&&!criarEstadoV37.referenceImages.length){
        return alert('Informe o produto ou envie uma foto de refer\u00eancia.');
    }

    const total=11;
    const porIndice=new Map(
        (criarEstadoV37.pictures||[]).map((p,pos)=>[
            Number.isFinite(Number(p.index))?Number(p.index):pos,p
        ])
    );

    let ultimoErro='';
    let usouFallback=false;
    atualizarProgressoImagensV40(porIndice.size,'Preparando as fotos de refer\u00eancia para a Cloudflare...');

    try{
        const refsCloudflare=await prepararReferenciasCloudflareV44();

        for(let idx=0;idx<total;idx++){
            if(porIndice.has(idx))continue;

            let sucesso=false;
            for(let tentativa=1;tentativa<=5&&!sucesso;tentativa++){
                atualizarProgressoImagensV40(
                    porIndice.size,
                    `Cloudflare AI: gerando imagem ${idx+1}/${total} \u00b7 tentativa ${tentativa}/5...`
                );

                const r=await fetch(`${RENDER_URL}/api/v38/criar/ia/imagem-item`,{
                    method:'POST',
                    headers:{
                        Authorization:token,
                        'Content-Type':'application/json'
                    },
                    body:JSON.stringify({
                        index:idx,
                        produto,
                        detalhes,
                        reference_images:refsCloudflare
                    })
                });

                const d=await r.json().catch(()=>({}));

                if(r.ok&&d.picture){
                    porIndice.set(idx,d.picture);
                    criarEstadoV37.pictures=[...porIndice.values()]
                        .sort((a,b)=>Number(a.index||0)-Number(b.index||0));

                    renderImagensGeradasV37();
                    gerarUrlsFotosV37();
                    renderPlanilhaPreviewV37();

                    atualizarProgressoImagensV40(
                        porIndice.size,
                        `${porIndice.size}/${total} imagens geradas pela Cloudflare e enviadas ao Mercado Livre.`
                    );

                    sucesso=true;

                    // Pequeno intervalo para reduzir picos de limite sem deixar o processo lento.
                    if(idx<total-1){
                        await new Promise(resolve=>setTimeout(resolve,900));
                    }
                    break;
                }

                ultimoErro=d.erro||`HTTP ${r.status}`;

                if(d.quota_unavailable){
                    usouFallback=true;
                    atualizarProgressoImagensV40(
                        porIndice.size,
                        `${ultimoErro} Completando o pacote com as fotos reais enviadas...`,
                        'aviso'
                    );
                    await gerarFallbackRestanteV40(token,porIndice,idx);
                    sucesso=true;
                    idx=total;
                    break;
                }

                if(d.retryable&&tentativa<5){
                    const espera=Math.max(
                        3000,
                        Math.min(
                            30000,
                            Number(d.retry_after||0)*1000 ||
                            [3500,6000,9000,14000][tentativa-1]
                        )
                    );
                    atualizarProgressoImagensV40(
                        porIndice.size,
                        `Cloudflare temporariamente ocupada. Nova tentativa em ${Math.ceil(espera/1000)}s...`,
                        'aviso'
                    );
                    await new Promise(resolve=>setTimeout(resolve,espera));
                    continue;
                }

                break;
            }

            if(!sucesso)break;
        }

        criarEstadoV37.pictures=[...porIndice.values()]
            .sort((a,b)=>Number(a.index||0)-Number(b.index||0));

        renderImagensGeradasV37();
        gerarUrlsFotosV37();
        renderPlanilhaPreviewV37();

        if(criarEstadoV37.pictures.length>=total){
            atualizarProgressoImagensV40(
                total,
                usouFallback
                    ? '11 imagens prontas. A cota da Cloudflare terminou e o pacote foi completado com suas fotos reais.'
                    : 'As 11 imagens 1080x1080 foram geradas pela Cloudflare e enviadas para o Mercado Livre.',
                'ok'
            );

            alert(
                usouFallback
                    ? 'As 11 imagens est\u00e3o prontas. Parte delas foi criada pela Cloudflare e, ap\u00f3s o limite dispon\u00edvel, o painel completou o restante usando as fotos reais enviadas.'
                    : 'As 11 imagens 1080x1080 foram geradas pela Cloudflare Workers AI e enviadas ao Mercado Livre com sucesso. As URLs j\u00e1 est\u00e3o dispon\u00edveis no painel.'
            );
        }else{
            atualizarProgressoImagensV40(
                criarEstadoV37.pictures.length,
                `Gera\u00e7\u00e3o pausada: ${ultimoErro||'erro desconhecido'}`,
                'erro'
            );
            alert(
                `Foram conclu\u00eddas ${criarEstadoV37.pictures.length} de ${total} imagens. ${ultimoErro}\n\n`+
                'As imagens conclu\u00eddas foram mantidas. Clique novamente em \u201cGerar / continuar\u201d para retomar exatamente da pr\u00f3xima imagem.'
            );
        }
    }catch(e){
        atualizarProgressoImagensV40(
            porIndice.size,
            `Erro: ${e.message}`,
            'erro'
        );
        alert(
            `A gera\u00e7\u00e3o foi pausada depois de ${porIndice.size} imagem(ns): ${e.message}\n\n`+
            'Nada foi perdido. Clique novamente para continuar.'
        );
    }
}

function renderImagensGeradasV37(){
    const box=document.getElementById('criar-imagens-preview-v37'); if(!box)return;
    const lista=[...(criarEstadoV37.pictures||[])].sort((a,b)=>Number(a.index||0)-Number(b.index||0));
    box.innerHTML=lista.map((p,i)=>`
        <div class="rounded-xl overflow-hidden border border-slate-700 bg-slate-950">
            <div class="aspect-square bg-white flex items-center justify-center overflow-hidden">${p.url?`<img src="${p.url}" class="w-full h-full object-cover">`:'<div class="text-xs text-slate-700">Sem preview</div>'}</div>
            <div class="px-2 py-2 text-[10px] text-white">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                        <div class="font-black">${i+1}. ${textoEscapeV37(p.titulo||p.tipo||'Imagem')}</div>
                        <div class="text-slate-500 truncate">${textoEscapeV37(p.id||'')}</div>
                    </div>
                    <button onclick="removerImagemGeradaV45(${Number(p.index||i)})" class="shrink-0 bg-rose-700 hover:bg-rose-600 text-white rounded-lg px-2 py-1 font-bold">Excluir</button>
                </div>
            </div>
        </div>
    `).join('') || '<div class="text-[11px] text-slate-500 col-span-full">As imagens geradas aparecer\u00e3o aqui.</div>';
}

function gerarUrlsFotosV37(){
    const urls=(criarEstadoV37.pictures||[]).map(p=>p.url).filter(Boolean);
    document.getElementById('criar-imagens-urls-v37').value=urls.length?`[${urls.join(',')}]`:'';
}

function coletarAttributesCategoriaV37(cat){
    return Object.entries(cat.values||{}).map(([id,v])=>{
        const valueId=v?.value_id!=null?String(v.value_id):'';
        if(valueId==='-1')return {id,value_id:'-1',value_name:null};
        const valueName=v?.value_name!=null?String(v.value_name).trim():'';
        return {id,...(valueId?{value_id:valueId}:{}),...(valueName?{value_name:valueName}:{})};
    }).filter(x=>x.id && (x.value_id||x.value_name||x.value_name===null));
}


function urlsManuaisFotosV47(){
    const campo=document.getElementById('criar-imagens-urls-manual-v47');
    const texto=String(campo?.value||'');
    const encontrados=texto.match(/https?:\/\/[^\s,\]\)]+/gi)||[];
    const urls=[];const seen=new Set();
    for(const raw of encontrados){
        const url=String(raw||'').trim().replace(/[;]+$/,'');
        if(!url||seen.has(url))continue;
        try{
            const u=new URL(url);
            if(!['http:','https:'].includes(u.protocol))continue;
            seen.add(url);urls.push(url);
        }catch{}
    }
    const status=document.getElementById('criar-imagens-urls-manual-status-v47');
    if(status){
        status.textContent=urls.length
          ? `${urls.length} URL(s) manual(is) v\u00e1lida(s). Elas substituir\u00e3o as imagens geradas na publica\u00e7\u00e3o.`
          : 'Nenhuma URL manual informada; o painel usar\u00e1 as imagens geradas.';
        status.className=urls.length?'text-[9px] text-amber-300 mt-2':'text-[9px] text-slate-600 mt-2';
    }
    return urls;
}

function configCriacaoV37(){
    const titles=String(document.getElementById('criar-titulos-v37')?.value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const varEnabled=String(document.getElementById('criar-variacao-enabled-v37')?.value||'0')==='1';
    const varCount=Math.min(100,Math.max(1,Number(document.getElementById('criar-variacao-qtd-v37')?.value||1)));
    const rows=garantirLinhasVariacaoV53().slice(0,varCount).map((r,i)=>({
        index:i,
        sku_suffix:String(r.sku_suffix||String(i+1).padStart(2,'0')).trim(),
        price:Number(r.price)>0?Number(r.price):null,
        stock:String(r.stock??'').trim()!==''?Math.max(0,Number(r.stock)||0):null,
        size_grid_row_id:String(r.size_grid_row_id||'').trim(),
        attributes:(criarEstadoV37.variationAttributeIds||[]).map(id=>{
            const v=r.attributes?.[id]||{};
            const out={id:String(id)};
            if(v.value_id)out.value_id=String(v.value_id);
            if(v.value_name)out.value_name=String(v.value_name);
            return out;
        }).filter(a=>a.value_id||a.value_name)
    }));
    const primeiroAttr=String((criarEstadoV37.variationAttributeIds||[])[0]||'');
    return {
        product_name:String(document.getElementById('criar-produto-v37')?.value||'').trim(),
        quantity:Math.max(1,Number(document.getElementById('criar-qtd-v37')?.value||titles.length||1)),
        titles,
        price:Number(document.getElementById('criar-preco-v37')?.value||0),
        stock:Math.max(1,Number(document.getElementById('criar-estoque-v37')?.value||1)),
        listing_type_id:String(document.getElementById('criar-listing-v37')?.value||'gold_special'),
        condition:String(document.getElementById('criar-condicao-v37')?.value||'new'),
        sku_prefix:String(document.getElementById('criar-sku-v37')?.value||'').trim(),
        universal_code_mode:String(document.getElementById('criar-gtin-modo-v51')?.value||'no_code'),
        universal_code:String(document.getElementById('criar-gtin-v51')?.value||'').trim(),
        shipping_mode:String(document.getElementById('criar-shipping-mode-v51')?.value||'me2'),
        shipping_cost_mode:String(document.getElementById('criar-shipping-cost-v51')?.value||'buyer'),
        warranty_type:String(document.getElementById('criar-garantia-tipo-v51')?.value||'none'),
        warranty_time:Math.max(0,Number(document.getElementById('criar-garantia-tempo-v51')?.value||0)),
        warranty_unit:String(document.getElementById('criar-garantia-unidade-v51')?.value||'dias'),
        description:String(document.getElementById('criar-descricao-v37')?.value||'').trim(),
        picture_ids:(criarEstadoV37.pictures||[]).map(p=>p.id).filter(Boolean),
        picture_sources_manual:urlsManuaisFotosV47(),
        categories:criarEstadoV37.selectedCategories.map(c=>({category_id:c.category_id,category_name:c.category_name,attributes:coletarAttributesCategoriaV37(c)})),
        variations:{
            enabled:varEnabled,
            count:varCount,
            size_grid_id:String(document.getElementById('criar-size-grid-id-v56')?.value||'').trim(), // V56: manual quando informado; autom\u00e1tico como fallback
            attribute_ids:[...(criarEstadoV37.variationAttributeIds||[])],
            rows,
            // Compatibilidade com vers\u00f5es anteriores do server. O V53 usa rows.
            attribute_id:primeiroAttr,
            values:rows.map(r=>{
                const a=(r.attributes||[]).find(x=>String(x.id)===primeiroAttr);
                return a?.value_name||a?.value_id||'';
            }).filter(Boolean)
        }
    };
}

function descricaoVariacaoPreviewV53(row){
    return (row?.attributes||[]).map(a=>{
        const def=defAtributoVariacaoV53(a.id);
        return `${def?.name||a.id}: ${a.value_name||a.value_id||''}`;
    }).filter(Boolean).join(' \u00b7 ');
}

function skuVariacaoPreviewV53(prefix,familyIndex,variationIndex,row){
    const base=String(prefix||'').trim();
    if(!base)return '';
    const fam=String(familyIndex+1).padStart(3,'0');
    const suf=String(row?.sku_suffix||variationIndex+1).replace(/\s+/g,'-').slice(0,30);
    return `${base}-${fam}-${suf}`;
}

function renderPlanilhaPreviewV37(){
    const tbody=document.getElementById('criar-planilha-preview-v37'); if(!tbody)return;
    const cfg=configCriacaoV37();
    const titles=cfg.titles.length?cfg.titles:[cfg.product_name||'T\u00edtulo do an\u00fancio'];
    const urlsManuais=urlsManuaisFotosV47();
    const urls=urlsManuais.length?urlsManuais:(criarEstadoV37.pictures||[]).map(p=>p.url).filter(Boolean);
    const cats=cfg.categories.length?cfg.categories:[{category_id:'',category_name:'Sem categoria',attributes:[]}];
    const rows=[];
    const LIMITE_PREVIEW=600;
    const shownTitles=titles.slice(0,Math.max(1,cfg.quantity));
    const variationRows=cfg.variations.enabled && cfg.variations.rows.length
      ? cfg.variations.rows
      : [{index:0,sku_suffix:'',price:null,stock:null,attributes:[]}];

    const totalRows=cats.length*shownTitles.length*variationRows.length;
    previewRowsV61: for(const cat of cats){
        for(let familyIndex=0;familyIndex<shownTitles.length;familyIndex++){
            const title=shownTitles[familyIndex];
            for(let variationIndex=0;variationIndex<variationRows.length;variationIndex++){
                if(rows.length>=LIMITE_PREVIEW)break previewRowsV61;
                const vr=variationRows[variationIndex];
                const variationIds=new Set((vr.attributes||[]).map(a=>String(a.id)));
                const attrsBase=(cat.attributes||[]).filter(a=>!variationIds.has(String(a.id)));
                const attrs=[...attrsBase,...(vr.attributes||[])];
                rows.push({
                    category:cat.category_name || cat.category_id || 'Sem categoria',
                    title,
                    variation:cfg.variations.enabled?`V${variationIndex+1} \u00b7 ${descricaoVariacaoPreviewV53(vr)||'preencher varia\u00e7\u00e3o'}`:'Sem varia\u00e7\u00e3o',
                    condition:cfg.condition,
                    price:Number(vr.price)>0?Number(vr.price):cfg.price,
                    stock:vr.stock!=null?Number(vr.stock):cfg.stock,
                    sku:cfg.variations.enabled
                      ? skuVariacaoPreviewV53(cfg.sku_prefix,familyIndex,variationIndex,vr)
                      : (cfg.sku_prefix?`${cfg.sku_prefix}-${String(familyIndex+1).padStart(3,'0')}`:''),
                    attrs:attrs.map(a=>`${a.id}: ${a.value_name??a.value_id??''}`).join(' | '),
                    urls:urls.slice(0,3).join(' | ')+(urls.length>3?` +${urls.length-3}`:'')
                });
            }
        }
    }
    const visiveis=rows.slice(0,LIMITE_PREVIEW);
    tbody.innerHTML=visiveis.map(r=>`
        <tr class="align-top">
            <td class="px-3 py-3 text-slate-200">${textoEscapeV37(r.category)}</td>
            <td class="px-3 py-3 text-white font-medium">${textoEscapeV37(r.title)}</td>
            <td class="px-3 py-3 text-yellow-300">${textoEscapeV37(r.variation)}</td>
            <td class="px-3 py-3 text-slate-300">${textoEscapeV37(({new:'Novo',used:'Usado',not_specified:'N\u00e3o especificado',refurbished:'Recondicionado'})[r.condition]||r.condition)}</td>
            <td class="px-3 py-3 text-emerald-400">${textoEscapeV37(moeda(Number(r.price||0)))}</td>
            <td class="px-3 py-3 text-slate-300">${textoEscapeV37(r.stock)}</td>
            <td class="px-3 py-3 text-slate-300">${textoEscapeV37(r.sku)}</td>
            <td class="px-3 py-3 text-slate-400">${textoEscapeV37(r.attrs || '-')}</td>
            <td class="px-3 py-3 text-sky-400 break-all">${textoEscapeV37(r.urls || '-')}</td>
        </tr>
    `).join('') || '<tr><td colspan="9" class="px-3 py-6 text-center text-slate-500">Preencha as informa\u00e7\u00f5es do an\u00fancio para visualizar a pr\u00e9via.</td></tr>';

    if(totalRows>LIMITE_PREVIEW){
        tbody.innerHTML+=`<tr><td colspan="9" class="px-3 py-4 text-center text-amber-400 font-bold">Pr\u00e9via limitada \u00e0s primeiras ${LIMITE_PREVIEW.toLocaleString('pt-BR')} linhas para manter o painel r\u00e1pido. A publica\u00e7\u00e3o continuar\u00e1 usando todas as ${totalRows.toLocaleString('pt-BR')} combina\u00e7\u00f5es.</td></tr>`;
    }
}

async function prepararGuiaTamanhoAntesValidarV58(){
    const ativo=String(document.getElementById('criar-variacao-enabled-v37')?.value||'0')==='1';
    if(!ativo)return true;
    const gridId=String(document.getElementById('criar-size-grid-id-v56')?.value||'').trim();
    if(!gridId)return true;

    // Sempre consulta/valida o guia antes de validar/publicar. Assim um ID de linha
    // antigo ou digitado incorretamente nunca \u00e9 enviado ao Mercado Livre.
    await carregarGuiaTamanhoV57(true);
    if(String(document.getElementById('criar-size-grid-id-v56')?.value||'').trim()!==gridId || criarEstadoV37.sizeGuideIdV60!==gridId){
        throw new Error('O c\u00f3digo do guia mudou durante a consulta. Carregue o guia atual e tente novamente.');
    }

    const linhas=Array.isArray(criarEstadoV37.sizeGuideRowsV57)?criarEstadoV37.sizeGuideRowsV57:[];
    if(!linhas.length)throw new Error(`N\u00e3o foi poss\u00edvel carregar as linhas do guia ${gridId}. Confira o c\u00f3digo do guia de tamanhos.`);

    const rows=garantirLinhasVariacaoV53();
    const faltando=[];
    rows.forEach((row,i)=>{
        const tamanho=tamanhoLinhaVariacaoV57(row);
        const linha=acharLinhaGuiaV57(row);
        if(linha?.row_id)aplicarTamanhoCanonicoGuiaV60(row,linha);
        else faltando.push(`Varia\u00e7\u00e3o ${i+1}${tamanho?` (tamanho ${tamanho})`:''}`);
    });
    renderEditorVariacoesV53();
    renderPlanilhaPreviewV37();
    if(faltando.length){
        throw new Error(`O guia ${gridId} n\u00e3o possui uma linha compat\u00edvel para: ${faltando.join(', ')}. Escolha tamanhos existentes nesse guia ou use o guia correto.`);
    }
    return true;
}

async function validarCriacaoV37(){
    cancelarConteudoV61();
    if(typeof cancelarKeywordsV62==='function')cancelarKeywordsV62();
    const token=obterToken();
    if(!token){solicitarToken();return false}
    const out=document.getElementById('criar-validacao-v37');
    try{
        await prepararGuiaTamanhoAntesValidarV58();
    }catch(e){
        out.textContent='Valida\u00e7\u00e3o recusada: '+e.message;
        out.className='text-[11px] text-red-400 mt-1';
        return false;
    }
    const cfg=configCriacaoV37();
    if(!cfg.categories.length){out.textContent='Adicione pelo menos uma categoria.';out.className='text-[11px] text-red-400 mt-1';return false;}
    if(!cfg.titles.length){out.textContent='Gere ou informe pelo menos um t\u00edtulo.';out.className='text-[11px] text-red-400 mt-1';return false;}
    try{
        validarTitulosUnicosV65(cfg);
        out.textContent='Validando os campos no Mercado Livre...'; out.className='text-[11px] text-yellow-400 mt-1';
        const r=await fetch(`${RENDER_URL}/api/v51/criar/validar`,{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({config:cfg})});
        const d=await r.json().catch(()=>({}));
        if(!r.ok || !d.sucesso){
            const falhas=(d.resultados||[]).filter(x=>!x.sucesso);
            const detalhes=falhas.map(x=>{
                const lista=Array.isArray(x.detalhes)&&x.detalhes.length?x.detalhes.join(' / '):(x.erro||'Erro de valida\u00e7\u00e3o');
                return `${x.category_name||x.category_id}${cfg.variations.enabled&&criarEstadoV37.userProductSeller&&x.variation_index!=null?` \u00b7 varia\u00e7\u00e3o ${Number(x.variation_index)+1}`:''}: ${lista}`;
            }).join(' | ');
            const backendMsg=r.status===404 ? 'O SERVER V51 ainda n\u00e3o est\u00e1 ativo no Render. Publique o server V51 e tente novamente.' : (detalhes||d.erro||`HTTP ${r.status}`);
            out.textContent='Valida\u00e7\u00e3o recusada: '+backendMsg;
            out.className='text-[11px] text-red-400 mt-1';
            return false;
        }
        const fotos=(d.resultados||[]).map(x=>x.limite_fotos?`${x.category_name}: ${x.fotos_enviadas}/${x.limite_fotos} fotos`:'').filter(Boolean).join(' \u00b7 ');
        const envios=[...new Set((d.resultados||[]).map(x=>x.shipping_mode).filter(Boolean))].join(', ').toUpperCase();
        const estrategias=[...new Set((d.resultados||[]).map(x=>x.shipping_strategy).filter(Boolean))].join(', ');
        const logisticas=[...new Set((d.resultados||[]).map(x=>x.shipping_logistic_type).filter(Boolean))].join(', ');
        const dims=(d.resultados||[]).flatMap(x=>Array.isArray(x.dimensoes_pacote_auto)?x.dimensoes_pacote_auto:[]);
        const freteGratis=(d.resultados||[]).some(x=>x.shipping_free_shipping===true);
        const freteObrigatorio=(d.resultados||[]).some(x=>x.shipping_free_shipping_required===true);
        out.textContent=`\u2713 Pronto para publicar no Mercado Livre${cfg.variations.enabled?` \u00b7 ${cfg.variations.rows.length} varia\u00e7\u00e3o(\u00f5es) verificadas`:''}${envios?' \u00b7 Mercado Envios: '+envios:''}${logisticas?' \u00b7 log\u00edstica: '+logisticas:''}${freteGratis?' \u00b7 frete gr\u00e1tis'+(freteObrigatorio?' obrigat\u00f3rio pelo Mercado Livre':''):''}${fotos?' \u00b7 '+fotos:''}.`;
        out.className='text-[11px] text-emerald-400 mt-1';
        return true;
    }catch(e){
        out.textContent='Erro ao validar: '+e.message; out.className='text-[11px] text-red-400 mt-1'; return false;
    }
}

async function publicarCriacaoV37(){
    const token=obterToken();
    if(!token){solicitarToken();return}
    const ok=await validarCriacaoV37(); if(!ok)return;
    // V58: recria a configura\u00e7\u00e3o depois da valida\u00e7\u00e3o porque o guia pode ter
    // preenchido/ajustado automaticamente os SIZE_GRID_ROW_ID das varia\u00e7\u00f5es.
    const cfg=configCriacaoV37();
    if(!confirm(`Confirma a cria\u00e7\u00e3o em massa em ${cfg.categories.length} categoria(s)?`))return;
    try{
        const r=await fetch(`${RENDER_URL}/api/v51/criar/publicar`,{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({config:cfg})});
        const d=await r.json().catch(()=>({}));
        if(!r.ok){
            const detalhe=Array.isArray(d.detalhes)&&d.detalhes.length?` ${d.detalhes.join(' | ')}`:'';
            if(r.status===404)throw new Error('O SERVER V51 ainda n\u00e3o est\u00e1 ativo no Render. Publique o server V51 antes do index.');
            throw new Error((d.mensagem_pt||d.erro||`HTTP ${r.status}`)+detalhe);
        }
        const jobId=d.job?.id; if(!jobId)throw new Error('O servidor n\u00e3o retornou o ID da cria\u00e7\u00e3o.');
        criarEstadoV37.jobId=String(jobId); localStorage.setItem('mlHubPro_mass_create_job_v37',String(jobId));
        document.getElementById('criar-job-msg-v37').textContent=d.mensagem||'Cria\u00e7\u00e3o iniciada.';
        acompanharCriacaoV37(jobId);
    }catch(e){ alert('Erro ao iniciar publica\u00e7\u00e3o: '+e.message); }
}

async function carregarResultadosCriacaoV37(jobId){
    const token=obterToken(); if(!token)return;
    try{
        const r=await fetch(`${RENDER_URL}/api/v36/criar/jobs/${encodeURIComponent(jobId)}/resultados?limit=200&_=${Date.now()}`,{cache:'no-store',headers:{Authorization:token}});
        const d=await r.json().catch(()=>({})); if(!r.ok)return;
        const box=document.getElementById('criar-resultados-v37'); if(!box)return;
        const rows=d.resultados||[]; if(!rows.length){box.classList.add('hidden');return;}
        box.classList.remove('hidden');
        box.innerHTML=rows.map(x=>`
          <div class="p-3">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-[10px] font-black ${x.success?'text-emerald-400':'text-red-400'}">${x.success?'\u2713 Criado':'\u2717 Falhou'} \u00b7 ${textoEscapeV37(x.title_requested||'An\u00fancio')}</div>
                <div class="text-[10px] text-slate-400 mt-1">${textoEscapeV37(x.message||'')}</div>
                ${x.technical_message?`<div class="text-[9px] text-red-300 mt-1">${textoEscapeV37(x.technical_message)}</div>`:''}
              </div>
              ${x.item_id?`<a href="${textoEscapeV37(x.permalink||'#')}" target="_blank" class="text-[10px] text-blue-400 font-bold">${textoEscapeV37(x.item_id)}</a>`:''}
            </div>
          </div>`).join('');
    }catch(e){}
}

async function acompanharCriacaoV37(jobId){
    clearTimeout(criarEstadoV37.jobTimer);
    const token=obterToken(); if(!token)return;
    try{
        const r=await fetch(`${RENDER_URL}/api/scale/jobs/${encodeURIComponent(jobId)}?_=${Date.now()}`,{cache:'no-store',headers:{Authorization:token}});
        const d=await r.json().catch(()=>({})); if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
        const j=d.job||{}; const total=Number(j.progress_total||0); const atual=Number(j.progress_current||0); const pct=total?Math.min(100,Math.round((atual/total)*100)):0;
        const bar=document.getElementById('criar-job-bar-v37'), pctEl=document.getElementById('criar-job-pct-v37'), msg=document.getElementById('criar-job-msg-v37');
        if(bar)bar.style.width=`${pct}%`; if(pctEl)pctEl.textContent=`${pct}%`; if(msg)msg.textContent=j.message||'Processando cria\u00e7\u00e3o...';
        if(atual%10===0 || ['completed','failed'].includes(j.status))carregarResultadosCriacaoV37(jobId);
        if(['queued','running'].includes(j.status)){
            localStorage.setItem('mlHubPro_mass_create_job_v37',String(jobId));
            criarEstadoV37.jobTimer=setTimeout(()=>acompanharCriacaoV37(jobId),1500);
            return;
        }
        localStorage.removeItem('mlHubPro_mass_create_job_v37');
        criarEstadoV37.jobId=null;
        await carregarResultadosCriacaoV37(jobId);
        if(j.status==='completed' && typeof invalidarCacheAnunciosV30==='function')invalidarCacheAnunciosV30();
    }catch(e){
        const msg=document.getElementById('criar-job-msg-v37'); if(msg)msg.textContent='Erro ao acompanhar: '+e.message;
        criarEstadoV37.jobTimer=setTimeout(()=>acompanharCriacaoV37(jobId),3000);
    }
}


let anunciosRestritosV40=[];
let anunciosRestritosCarregadoV40=false;
let filtroRestritosV40='';
const restritosSelecionadosV41=new Set();
let restritosCarregandoMotivosV41=false;
let restritosExcluindoV41=false;
const restritosErrosExclusaoV41=new Map();
let restritosStatusRealAtualizadoV72=false;
let restritosRefreshRealEmCursoV72=false;

function normalizarSubstatusV40(v){
    if(Array.isArray(v))return v.join(', ');
    if(v&&typeof v==='object')return Object.values(v).join(', ');
    return String(v||'').replace(/^"|"$/g,'');
}
function nomeStatusRestritoV40(status){
    return ({paused:'Pausado',inactive:'Inativo',closed:'Finalizado pelo ML',under_review:'Em revis\u00e3o'})[String(status)]||rotuloSituacaoV64(status);
}
function classeStatusRestritoV40(status){
    return ({paused:'text-yellow-400',inactive:'text-orange-400',closed:'text-red-400',under_review:'text-fuchsia-400'})[String(status)]||'text-slate-300';
}

function statusRestritoLocalV99(item={}){
    const candidatos=[
        item.status_real,
        item.status,
        item.status_api
    ].map(x=>String(x||'').trim().toLowerCase()).filter(Boolean);

    for(const st of candidatos){
        if(['paused','inactive','closed','under_review'].includes(st))return st;
        if(/pause/.test(st))return 'paused';
        if(/review|moderation/.test(st))return 'under_review';
        if(/close|finish|finaliz|expired/.test(st))return 'closed';
        if(/inactive|disabled|suspend|blocked/.test(st))return 'inactive';
    }

    const motivo=String(item.price_update_block_reason||'').toLowerCase();

    if(/revis/.test(motivo))return 'under_review';
    if(/paus/.test(motivo))return 'paused';
    if(/encerr|finaliz/.test(motivo))return 'closed';
    if(/inativ/.test(motivo))return 'inactive';

    // Tudo que a Gestão conta em "Outras situações" e não é ativo
    // deve aparecer nesta central, sem sumir por causa do PostgreSQL.
    const bruto=String(item.status||'').trim().toLowerCase();
    if(bruto && bruto!=='active')return 'inactive';

    return '';
}

function minVendasProtegidasV99(){
    const el=document.getElementById('restritos-min-vendas-v99');
    const n=Math.floor(Number(el?.value||0));
    return Number.isFinite(n)?Math.max(0,n):0;
}

function itemProtegidoVendasV99(item){
    const limite=minVendasProtegidasV99();
    return limite>0 && Number(item?.sold_quantity||0)>=limite;
}

function atualizarProtecaoVendasRestritosV99(){
    const limite=minVendasProtegidasV99();
    const info=document.getElementById('restritos-protecao-info-v99');

    if(info){
        info.textContent=limite>0
          ?`${limite.toLocaleString('pt-BR')}+ vendas protegidas`
          :'Proteção por vendas desativada';
        info.className='text-[8px] mt-1 whitespace-nowrap '+
          (limite>0?'text-emerald-400':'text-yellow-400');
    }

    // Remove da seleção qualquer anúncio que passou a ficar protegido.
    for(const id of [...restritosSelecionadosV41]){
        const item=anunciosRestritosV40.find(x=>String(x.id)===String(id));
        if(item&&itemProtegidoVendasV99(item)){
            restritosSelecionadosV41.delete(String(id));
        }
    }

    renderAnunciosRestritosV40();
}

function listaRestritosElegiveisExclusaoV99(){
    return listaRestritosVisiveisV41().filter(i=>!itemProtegidoVendasV99(i));
}

async function idbRemoverItensV99(ids){
    const lista=[...new Set((ids||[]).map(String).filter(Boolean))];
    if(!lista.length)return;

    const seller=await sellerAtivoV90().catch(()=>'');
    const db=await abrirDbCacheV32();

    await new Promise((resolve,reject)=>{
        const tx=db.transaction(
            [STORE_ITENS_V32,STORE_PERSISTENTE_V90,STORE_SEEN_V85],
            'readwrite'
        );

        const normal=tx.objectStore(STORE_ITENS_V32);
        const persistente=tx.objectStore(STORE_PERSISTENTE_V90);
        const seen=tx.objectStore(STORE_SEEN_V85);

        for(const id of lista){
            normal.delete(id);
            seen.delete(id);
            if(seller)persistente.delete(`${seller}:${id}`);
        }

        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error);
        tx.onabort=()=>reject(tx.error||new Error('Falha ao remover anúncios do cache local.'));
    });

    for(const id of lista)masterMapV32.delete(String(id));
    masterAnunciosV32=masterAnunciosV32.filter(x=>!lista.includes(String(x.id)));
    anunciosEscalaCacheV30.clear();
    simFiltroRenderKeyV30='';
    atualFiltroRenderKeyV30='';
}

function listaRestritosVisiveisV41(){
    return filtroRestritosV40?anunciosRestritosV40.filter(x=>String(x.status)===filtroRestritosV40):anunciosRestritosV40;
}
function traduzirSubstatusRestritoV41(status,sub,tags=[]){
    const s=String(sub||'').toLowerCase();
    const lista=Array.isArray(tags)?tags.map(x=>String(x).toLowerCase()):[];
    const mapa={
      waiting_for_patch:'O Mercado Livre detectou uma infra\u00e7\u00e3o no an\u00fancio. \u00c9 necess\u00e1rio corrigir a publica\u00e7\u00e3o para que ela possa voltar a ficar ativa.',
      forbidden:'O an\u00fancio foi desativado pelo Mercado Livre por uma modera\u00e7\u00e3o e n\u00e3o pode ser reativado.',
      held:'O an\u00fancio est\u00e1 oculto enquanto passa por uma revis\u00e3o manual do Mercado Livre.',
      pending_documentation:'O Mercado Livre solicitou documenta\u00e7\u00e3o relacionada a uma modera\u00e7\u00e3o ou den\u00fancia. O an\u00fancio ficar\u00e1 oculto at\u00e9 a an\u00e1lise terminar.',
      suspended:'O an\u00fancio foi suspenso pelo Mercado Livre durante uma an\u00e1lise de seguran\u00e7a ou risco.',
      suspended_for_prevention:'O an\u00fancio foi suspenso preventivamente pelo Mercado Livre por uma an\u00e1lise de seguran\u00e7a ou risco.',
      picture_downloading_pending:'O an\u00fancio est\u00e1 pausado enquanto o Mercado Livre processa ou baixa uma imagem informada por URL.',
      paused_by_seller:'O an\u00fancio foi pausado pelo vendedor.',
      out_of_stock:'O an\u00fancio foi pausado por falta de estoque.',
      warning:'O Mercado Livre identificou uma corre\u00e7\u00e3o pendente na publica\u00e7\u00e3o.',
      expired:'O an\u00fancio foi finalizado porque chegou ao fim do per\u00edodo de publica\u00e7\u00e3o.',
      freezed:'O an\u00fancio foi finalizado e congelado pelo Mercado Livre.'
    };
    if(mapa[s])return mapa[s];
    if(lista.includes('moderation_penalty'))return 'O an\u00fancio possui uma penalidade ou modera\u00e7\u00e3o aplicada pelo Mercado Livre. Aguarde o motivo detalhado da modera\u00e7\u00e3o.';
    if(status==='under_review')return 'O an\u00fancio est\u00e1 em revis\u00e3o pelo Mercado Livre. Aguarde a consulta do motivo detalhado.';
    if(status==='inactive')return 'O an\u00fancio est\u00e1 inativo no Mercado Livre.';
    if(status==='paused')return 'O an\u00fancio est\u00e1 pausado no Mercado Livre.';
    if(status==='closed')return 'O an\u00fancio foi finalizado no Mercado Livre.';
    return 'Motivo ainda n\u00e3o informado pelo Mercado Livre.';
}
function atualizarBotaoExcluirRestritosV41(){
    const btn=document.getElementById('restritos-excluir-btn-v41');

    if(btn){
        btn.disabled=restritosSelecionadosV41.size===0||restritosExcluindoV41;
        btn.textContent=`🗑 Excluir selecionados (${restritosSelecionadosV41.size.toLocaleString('pt-BR')})`;
    }

    const all=document.getElementById('restritos-check-all-v41');
    const vis=listaRestritosVisiveisV41();
    const elegiveis=listaRestritosElegiveisExclusaoV99();

    if(all){
        all.checked=elegiveis.length>0 &&
          elegiveis.every(i=>restritosSelecionadosV41.has(String(i.id)));
        all.disabled=!elegiveis.length||restritosExcluindoV41;
    }

    const todos=document.getElementById('restritos-excluir-todos-v72');

    if(todos){
        todos.disabled=!elegiveis.length||restritosExcluindoV41;

        const rot=filtroRestritosV40
          ?`Excluir elegíveis: ${nomeStatusRestritoV40(filtroRestritosV40)}`
          :'Excluir elegíveis dos 4 status';

        todos.textContent=`🗑 ${rot} (${elegiveis.length.toLocaleString('pt-BR')})`;
    }

    const limite=minVendasProtegidasV99();
    const protegidos=vis.filter(itemProtegidoVendasV99).length;
    const info=document.getElementById('restritos-protecao-info-v99');

    if(info){
        info.textContent=limite>0
          ?`${protegidos.toLocaleString('pt-BR')} protegido(s) · ${limite.toLocaleString('pt-BR')}+ vendas`
          :'Proteção por vendas desativada';
    }
}
function alternarSelecaoRestritoV41(id,checked){
    const key=String(id||'');
    if(!key)return;
    if(checked)restritosSelecionadosV41.add(key);else restritosSelecionadosV41.delete(key);
    atualizarBotaoExcluirRestritosV41();
}
function selecionarVisiveisRestritosV41(marcar=true){
    const lista=marcar
      ? listaRestritosElegiveisExclusaoV99()
      : listaRestritosVisiveisV41();

    lista.forEach(i=>
      marcar
        ? restritosSelecionadosV41.add(String(i.id))
        : restritosSelecionadosV41.delete(String(i.id))
    );

    renderAnunciosRestritosV40();
}

async function carregarAnunciosRestritosV40(forcar=false){
    if(anunciosRestritosCarregadoV40&&!forcar){
        renderAnunciosRestritosV40();
        return;
    }

    const st=document.getElementById('restritos-status-v40');

    try{
        if(st){
            st.textContent='Carregando da mesma base persistente usada pela Gestão de anúncios...';
        }

        // V99: NÃO depende mais da tabela ml_items do PostgreSQL para montar
        // a lista. A Gestão possui dezenas de milhares de itens no IndexedDB
        // persistente; agora esta tela usa exatamente a mesma fonte.
        if(forcar)masterCarregadoV32=false;
        await carregarMasterLocalV32();

        const mapa=new Map();

        for(const raw of masterAnunciosV32){
            const statusReal=statusRestritoLocalV99(raw);
            if(!statusReal)continue;

            const id=String(raw?.id||'');
            if(!id)continue;

            mapa.set(id,{
                ...raw,
                id,
                status_api:String(raw.status||''),
                status_real:statusReal,
                status:statusReal,
                sold_quantity:Number(raw.sold_quantity||0),
                available_quantity:Number(raw.available_quantity||0),
                motivo_pt:String(raw.price_update_block_reason||'') ||
                  traduzirSubstatusRestritoV41(statusReal,'',[])
            });
        }

        anunciosRestritosV40=[...mapa.values()];
        anunciosRestritosCarregadoV40=true;

        // Itens que deixaram de existir na lista não permanecem selecionados.
        const idsAtuais=new Set(anunciosRestritosV40.map(x=>String(x.id)));
        for(const id of [...restritosSelecionadosV41]){
            if(!idsAtuais.has(String(id)))restritosSelecionadosV41.delete(String(id));
        }

        const totais={
            pausados:anunciosRestritosV40.filter(x=>x.status==='paused').length,
            inativos:anunciosRestritosV40.filter(x=>x.status==='inactive').length,
            finalizados:anunciosRestritosV40.filter(x=>x.status==='closed').length,
            revisao:anunciosRestritosV40.filter(x=>x.status==='under_review').length
        };

        [
          ['restritos-pausados-v40',totais.pausados],
          ['restritos-inativos-v40',totais.inativos],
          ['restritos-finalizados-v40',totais.finalizados],
          ['restritos-revisao-v40',totais.revisao]
        ].forEach(([id,v])=>{
            const el=document.getElementById(id);
            if(el)el.textContent=Number(v||0).toLocaleString('pt-BR');
        });

        renderAnunciosRestritosV40();

        if(st){
            st.textContent=
              `${anunciosRestritosV40.length.toLocaleString('pt-BR')} anúncio(s) não ativo(s) carregado(s) da mesma base da Gestão. `+
              `Cada anúncio é revalidado no Mercado Livre antes da exclusão.`;
        }

        const motivosLazy=()=>carregarMotivosReaisRestritosV41(40);

        if('requestIdleCallback' in window){
            requestIdleCallback(motivosLazy,{timeout:2500});
        }else{
            setTimeout(motivosLazy,500);
        }
    }catch(e){
        if(st)st.textContent='Erro ao carregar: '+e.message;
    }finally{
        restritosRefreshRealEmCursoV72=false;
    }
}
function filtrarAnunciosRestritosV40(status=''){
    filtroRestritosV40=String(status||'');
    const sel=document.getElementById('restritos-filtro-select-v41');if(sel&&sel.value!==filtroRestritosV40)sel.value=filtroRestritosV40;
    if(!anunciosRestritosCarregadoV40)return carregarAnunciosRestritosV40(false);
    renderAnunciosRestritosV40();
}
function renderAnunciosRestritosV40(){
    const tbody=document.getElementById('restritos-tbody-v40');
    if(!tbody)return;

    const lista=listaRestritosVisiveisV41();
    const st=document.getElementById('restritos-status-v40');
    const limite=minVendasProtegidasV99();
    const protegidos=lista.filter(itemProtegidoVendasV99).length;
    const elegiveis=lista.length-protegidos;

    if(st){
        st.textContent=
          `${lista.length.toLocaleString('pt-BR')} anúncio(s) exibido(s)`+
          `${filtroRestritosV40?` · filtro: ${nomeStatusRestritoV40(filtroRestritosV40)}`:' · todas as quatro situações'}`+
          ` · ${elegiveis.toLocaleString('pt-BR')} elegível(is) para exclusão`+
          (limite>0?` · ${protegidos.toLocaleString('pt-BR')} protegido(s) por vendas`:'');
    }

    if(!lista.length){
        tbody.innerHTML=
          '<tr><td colspan="10" class="px-4 py-10 text-center text-slate-600">Nenhum anúncio encontrado neste status.</td></tr>';

        atualizarBotaoExcluirRestritosV41();
        return;
    }

    tbody.innerHTML=lista.map(i=>{
        const sub=normalizarSubstatusV40(i.sub_status)||'—';
        const dt=i.last_updated
          ?new Date(i.last_updated).toLocaleString('pt-BR')
          :'—';

        const statusVisual=String(i.status_real||i.status||'');
        const motivo=String(
          i.moderation_reason||
          i.motivo_pt||
          traduzirSubstatusRestritoV41(statusVisual,sub,i.tags)||
          ''
        );

        const remedy=String(i.moderation_remedy||'');
        const vendas=Math.max(0,Number(i.sold_quantity||0));
        const protegido=itemProtegidoVendasV99(i);
        const checked=!protegido&&restritosSelecionadosV41.has(String(i.id));
        const erroExcluir=restritosErrosExclusaoV41.get(String(i.id))||'';

        const statusOriginal=String(i.status_api||'');
        const statusExtra=
          statusOriginal &&
          statusOriginal!==statusVisual
            ?`<div class="text-[8px] text-slate-600 mt-1">API/cache: ${textoEscapeV37(statusOriginal)}</div>`
            :'';

        return `
        <tr id="restrito-row-${textoEscapeV37(i.id)}"
            class="${protegido?'bg-emerald-950/10 ':''}hover:bg-slate-900/50">

          <td class="px-3 py-3 text-center">
            <input
              type="checkbox"
              class="w-4 h-4 accent-yellow-400 disabled:opacity-25"
              ${checked?'checked':''}
              ${protegido?'disabled':''}
              title="${protegido?`Protegido: ${vendas} venda(s)`:''}"
              onchange="alternarSelecaoRestritoV41('${textoEscapeV37(i.id)}',this.checked)"
            >
          </td>

          <td class="px-3 py-3">
            <div class="flex items-center gap-3">
              ${i.thumbnail?`<img src="${textoEscapeV37(i.thumbnail)}" class="w-11 h-11 rounded-lg object-cover bg-white">`:''}
              <div class="max-w-[420px]">
                <div class="font-bold text-white line-clamp-2">${textoEscapeV37(i.title||'Sem título')}</div>
              </div>
            </div>
          </td>

          <td class="px-3 py-3">
            <div class="font-mono text-slate-300">${textoEscapeV37(i.id||'')}</div>
            <div class="text-[10px] text-slate-500 mt-1">SKU: ${textoEscapeV37(i.sku||'—')}</div>
          </td>

          <td class="px-3 py-3">
            <div class="font-black ${classeStatusRestritoV40(statusVisual)}">${textoEscapeV37(nomeStatusRestritoV40(statusVisual))}</div>
            <div class="text-[9px] text-emerald-500 mt-1">Status salvo na Gestão</div>
            ${statusExtra}
          </td>

          <td id="restrito-motivo-${textoEscapeV37(i.id)}" class="px-3 py-3 max-w-[480px]">
            <div class="text-slate-200 font-semibold leading-relaxed">${textoEscapeV37(motivo)}</div>
            ${remedy?`<div class="text-emerald-400 mt-1 leading-relaxed"><b>Solução:</b> ${textoEscapeV37(remedy)}</div>`:''}
            <div class="text-[9px] text-slate-600 mt-1">Detalhe da situação: ${textoEscapeV37(sub)}</div>
          </td>

          <td class="px-3 py-3 text-right text-white font-bold">
            ${textoEscapeV37(moeda(Number(i.price||0)))}
          </td>

          <td class="px-3 py-3 text-right text-slate-300">
            ${Number(i.available_quantity||0).toLocaleString('pt-BR')}
          </td>

          <td class="px-3 py-3 text-right">
            <div class="font-black ${protegido?'text-emerald-400':vendas>0?'text-yellow-300':'text-slate-500'}">
              ${vendas.toLocaleString('pt-BR')}
            </div>
            ${protegido?`
              <div class="text-[8px] text-emerald-500 mt-1">
                PROTEGIDO ${limite.toLocaleString('pt-BR')}+
              </div>
            `:''}
          </td>

          <td class="px-3 py-3 text-slate-500">
            ${textoEscapeV37(dt)}
          </td>

          <td class="px-3 py-3 text-center">
            <div class="flex flex-col gap-2 items-center">
              ${i.permalink?`
                <a href="${textoEscapeV37(i.permalink)}"
                   target="_blank"
                   class="bg-slate-800 hover:bg-slate-700 text-blue-300 px-3 py-2 rounded-lg font-bold">
                  Ver anúncio
                </a>
              `:'—'}
              ${erroExcluir?`
                <div class="text-[9px] text-red-400 max-w-[180px]">
                  ${textoEscapeV37(erroExcluir)}
                </div>
              `:''}
            </div>
          </td>
        </tr>`;
    }).join('');

    atualizarBotaoExcluirRestritosV41();
}

async function carregarMotivosReaisRestritosV41(limite=40){
    if(restritosCarregandoMotivosV41||!anunciosRestritosV40.length)return;
    const token=obterToken();if(!token)return;
    restritosCarregandoMotivosV41=true;
    const status=document.getElementById('restritos-motivos-status-v41');
    try{
        const alvos=anunciosRestritosV40.filter(i=>!i.moderation_checked&&String(i.status_api||i.status)==='under_review').slice(0,Math.max(1,Number(limite)||40)).map(i=>String(i.id));
        let done=0;
        for(let p=0;p<alvos.length;p+=25){
            const bloco=alvos.slice(p,p+25);
            if(status)status.textContent=`Consultando motivo real no Mercado Livre: ${done.toLocaleString('pt-BR')}/${alvos.length.toLocaleString('pt-BR')}...`;
            const r=await fetch(`${RENDER_URL}/api/v41/anuncios-restritos/motivos`,{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({ids:bloco})});
            const d=await r.json().catch(()=>({}));
            if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);
            for(const m of (d.itens||[])){
                const item=anunciosRestritosV40.find(x=>String(x.id)===String(m.id));
                if(item){item.moderation_checked=true;item.moderation_reason=m.reason||item.motivo_pt;item.moderation_remedy=m.remedy||'';item.moderation_name=m.name||'';}
            }
            done+=bloco.length;
            renderAnunciosRestritosV40();
        }
        if(status)status.textContent=`Motivos reais consultados em portugu\u00eas para ${done.toLocaleString('pt-BR')} an\u00fancio(s).`;
    }catch(e){
        if(status)status.textContent='N\u00e3o foi poss\u00edvel consultar todos os motivos reais: '+e.message;
    }finally{restritosCarregandoMotivosV41=false;}
}

function atualizarProgressoExclusaoV41(processados,total,sucesso,falhas,msg=''){
    const wrap=document.getElementById('restritos-progresso-exclusao-v41');if(wrap)wrap.classList.remove('hidden');
    const pct=total?Math.round((processados/total)*100):0;
    const ids={
      'restritos-exclusao-processados-v41':processados,
      'restritos-exclusao-sucesso-v41':sucesso,
      'restritos-exclusao-falhas-v41':falhas,
      'restritos-exclusao-restantes-v41':Math.max(0,total-processados)
    };
    Object.entries(ids).forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.textContent=Number(v||0).toLocaleString('pt-BR');});
    const st=document.getElementById('restritos-exclusao-status-v41');if(st)st.textContent=`${processados.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}`;
    const pe=document.getElementById('restritos-exclusao-pct-v41');if(pe)pe.textContent=`${pct}%`;
    const bar=document.getElementById('restritos-exclusao-bar-v41');if(bar)bar.style.width=`${pct}%`;
    const me=document.getElementById('restritos-exclusao-msg-v41');if(me)me.textContent=msg||'Excluindo an\u00fancios no Mercado Livre...';
}


async function excluirIdsRestritosV72(ids,{confirmar=true}={}){
    if(restritosExcluindoV41)return;

    const limite=minVendasProtegidasV99();

    ids=[...new Set((ids||[]).map(String).filter(Boolean))];

    const alvos=ids
      .map(id=>anunciosRestritosV40.find(x=>String(x.id)===String(id)))
      .filter(Boolean);

    const protegidosLocais=alvos.filter(itemProtegidoVendasV99);
    const elegiveis=alvos.filter(x=>!itemProtegidoVendasV99(x));
    ids=elegiveis.map(x=>String(x.id));

    if(!ids.length){
        return alert(
          limite>0
            ?`Nenhum anúncio elegível para excluir. Os anúncios com ${limite.toLocaleString('pt-BR')} vendas ou mais estão protegidos.`
            :'Nenhum anúncio destas situações foi encontrado para excluir.'
        );
    }

    if(confirmar){
        const textoProtecao=limite>0
          ?`\n\nProteção ativa: anúncios com ${limite.toLocaleString('pt-BR')} vendas ou mais NÃO serão excluídos. `+
           `${protegidosLocais.length.toLocaleString('pt-BR')} anúncio(s) já foram retirados desta operação pela proteção.`
          :'';

        const ok=confirm(
          `ATENÇÃO: você está prestes a excluir permanentemente ${ids.length.toLocaleString('pt-BR')} anúncio(s) do Mercado Livre.`+
          textoProtecao+
          `\n\nAntes de excluir, o servidor confere novamente o status e a quantidade de vendas de cada anúncio. Continuar?`
        );

        if(!ok)return;

        const ok2=confirm(
          'Confirme novamente: a exclusão é irreversível. '+
          (limite>0
            ?`Qualquer anúncio que tiver ${limite.toLocaleString('pt-BR')} vendas ou mais no Mercado Livre será protegido automaticamente.`
            :'A proteção por quantidade de vendas está desativada.')
        );

        if(!ok2)return;
    }

    const token=obterToken();
    if(!token){
        solicitarToken();
        return;
    }

    restritosExcluindoV41=true;
    restritosErrosExclusaoV41.clear();
    atualizarBotaoExcluirRestritosV41();

    const errosEl=document.getElementById('restritos-exclusao-erros-v41');
    if(errosEl){
        errosEl.classList.add('hidden');
        errosEl.innerHTML='';
    }

    let processados=0;
    let sucesso=0;
    let falhas=0;
    let protegidosServidor=0;

    const erros=[];
    const removidos=[];

    atualizarProgressoExclusaoV41(
      0,
      ids.length,
      0,
      0,
      limite>0
        ?`Preparando exclusão · proteção ${limite.toLocaleString('pt-BR')}+ vendas ativa...`
        :'Preparando exclusão...'
    );

    try{
        // Lotes de 200 no Hub; o backend usa concorrência controlada.
        for(let p=0;p<ids.length;p+=200){
            const bloco=ids.slice(p,p+200);

            atualizarProgressoExclusaoV41(
              processados,
              ids.length,
              sucesso,
              falhas,
              `Excluindo lote ${Math.floor(p/200)+1}...`
            );

            const r=await fetch(
              `${RENDER_URL}/api/v41/anuncios-restritos/excluir-lote`,
              {
                method:'POST',
                headers:{
                  Authorization:token,
                  'Content-Type':'application/json'
                },
                body:JSON.stringify({
                  ids:bloco,
                  min_sales_protected:limite
                })
              }
            );

            const d=await r.json().catch(()=>({}));

            if(!r.ok){
                throw new Error(d.erro||`HTTP ${r.status}`);
            }

            for(const x of (d.resultados||[])){
                processados++;

                if(x.sucesso){
                    sucesso++;
                    removidos.push(String(x.id));
                    restritosSelecionadosV41.delete(String(x.id));
                    anunciosRestritosV40=anunciosRestritosV40.filter(
                      i=>String(i.id)!==String(x.id)
                    );
                }else if(x.protegido){
                    protegidosServidor++;
                    restritosSelecionadosV41.delete(String(x.id));

                    const item=anunciosRestritosV40.find(
                      i=>String(i.id)===String(x.id)
                    );

                    if(item && x.sold_quantity!==undefined){
                        item.sold_quantity=Number(x.sold_quantity||0);
                    }
                }else{
                    falhas++;
                    const msg=String(
                      x.erro||
                      'Mercado Livre não permitiu excluir este anúncio.'
                    );

                    restritosErrosExclusaoV41.set(String(x.id),msg);
                    erros.push(`${x.id}: ${msg}`);
                }
            }

            if(removidos.length){
                const loteRemover=removidos.splice(0,removidos.length);
                await idbRemoverItensV99(loteRemover).catch(e=>
                  console.warn('[RESTRITOS V99 CACHE]',e)
                );
            }

            atualizarProgressoExclusaoV41(
              processados,
              ids.length,
              sucesso,
              falhas,
              `Excluindo: ${processados.toLocaleString('pt-BR')}/${ids.length.toLocaleString('pt-BR')}`+
              (protegidosServidor
                ?` · ${protegidosServidor.toLocaleString('pt-BR')} protegido(s) pela venda real`
                :'')
            );

            renderAnunciosRestritosV40();
            await new Promise(resolve=>setTimeout(resolve,30));
        }

        atualizarProgressoExclusaoV41(
          processados,
          ids.length,
          sucesso,
          falhas,
          `Concluído: ${sucesso.toLocaleString('pt-BR')} excluído(s), `+
          `${protegidosServidor.toLocaleString('pt-BR')} protegido(s) por vendas e `+
          `${falhas.toLocaleString('pt-BR')} falha(s).`
        );

        if(erros.length&&errosEl){
            errosEl.classList.remove('hidden');
            errosEl.innerHTML=
              '<div class="font-black mb-2">Anúncios que o Mercado Livre não permitiu excluir:</div>'+
              erros.map(e=>
                `<div class="py-1 border-t border-red-900/50">${textoEscapeV37(e)}</div>`
              ).join('');
        }

        // Recalcula a lista a partir do MESMO cache da Gestão,
        // sem depender do PostgreSQL antigo.
        anunciosRestritosCarregadoV40=false;
        masterCarregadoV32=false;
        await carregarAnunciosRestritosV40(false);

        if(typeof v88CarregarGestaoLocal==='function'){
            await v88CarregarGestaoLocal(
              typeof gestaoPagina==='number'?gestaoPagina:1,
              {silencioso:true}
            );
        }
    }catch(e){
        atualizarProgressoExclusaoV41(
          processados,
          ids.length,
          sucesso,
          falhas,
          'Erro durante a exclusão: '+e.message
        );
    }finally{
        restritosExcluindoV41=false;
        atualizarBotaoExcluirRestritosV41();
    }
}

function excluirTodosRestritosV72(){
    const ids=listaRestritosElegiveisExclusaoV99().map(i=>String(i.id));
    return excluirIdsRestritosV72(ids,{confirmar:true});
}

async function excluirSelecionadosRestritosV41(){
    const ids=[...restritosSelecionadosV41].filter(id=>{
        const item=anunciosRestritosV40.find(x=>String(x.id)===String(id));
        return item && !itemProtegidoVendasV99(item);
    });

    return excluirIdsRestritosV72(ids,{confirmar:true});
}


document.addEventListener('DOMContentLoaded',()=>{
    setTimeout(()=>{try{bindPreviewListenersV37();renderPlanilhaPreviewV37();}catch(e){}},300);
});
/* V62 \u2014 editor de agentes e integra\u00e7\u00e3o com a cria\u00e7\u00e3o de an\u00fancios. */
const agentesEstadoV62={conta:'',lista:[],cache:new Map(),agente:null,carregado:false,dirty:false,busy:false,
    saving:null,pollTimer:null,pollAttempts:0,pollBusy:false,selecao:0,organiza\u00e7\u00e3o:null};

function elAgenteV62(id){return document.getElementById(id);}
function valorAgenteV62(id){return String(elAgenteV62(id)?.value||'').trim();}
function statusAgenteV62(texto,tipo='info'){
    const el=elAgenteV62('agentes-status-v62');
    if(el){el.textContent=texto;el.className='hub-info '+(tipo==='erro'?'text-rose-400':tipo==='ok'?'text-emerald-400':'text-slate-300');}
}

function conferirContaAgentesV62(){
    const conta=hashConteudoV61(obterToken());
    if(agentesEstadoV62.conta!==conta){
        clearTimeout(agentesEstadoV62.pollTimer);
        Object.assign(agentesEstadoV62,{conta,lista:[],cache:new Map(),agente:null,carregado:false,dirty:false,busy:false,saving:null,pollTimer:null,organiza\u00e7\u00e3o:null});
        agentesEstadoV62.selecao++;
        criarEstadoV37.agenteV62=null;
        if(elAgenteV62('criar-agente-v62'))elAgenteV62('criar-agente-v62').value='';
        elAgenteV62('agentes-editor-v62')?.classList.add('hidden');
        elAgenteV62('agente-conhecimento-v62')?.classList.add('hidden');
    }
    return conta;
}

async function apiAgenteV62(caminho,method='GET',body=null){
    const token=obterToken();if(!token)throw new Error('Conecte a conta Mercado Livre para usar os agentes.');
    const conta=conferirContaAgentesV62(),controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),method==='POST'&&caminho.endsWith('/chat')?75000:20000);
    try{
        const r=await fetch(RENDER_URL+'/api/v62/agentes'+caminho,{method,
            headers:{Authorization:token,'Content-Type':'application/json'},signal:controller.signal,
            ...(body!==null?{body:JSON.stringify(body)}:{})});
        const d=await r.json().catch(()=>({}));
        if(hashConteudoV61(obterToken())!==conta)throw new Error('A conta mudou. Carregue os agentes novamente.');
        if(!r.ok||!d.sucesso){const e=new Error(d.erro||'N\u00e3o foi poss\u00edvel acessar os agentes.');e.status=r.status;throw e;}
        return d;
    }catch(e){if(e.name==='AbortError')throw new Error('O servidor demorou a responder. Aguarde alguns segundos e tente novamente.');throw e;}
    finally{clearTimeout(timer);}
}

function guardarAgenteV62(a){
    agentesEstadoV62.cache.set(a.id,a);
    const index=agentesEstadoV62.lista.findIndex(x=>x.id===a.id);
    if(index<0)agentesEstadoV62.lista.unshift(a);else agentesEstadoV62.lista[index]=a;
    if(criarEstadoV37.agenteV62?.id===a.id)criarEstadoV37.agenteV62=a;
    renderListaAgentesV62();renderSelecaoAgenteCriacaoV62();
}

async function carregarAgentesProdutoV62(forcar=false){
    conferirContaAgentesV62();
    if(agentesEstadoV62.carregado&&!forcar){renderListaAgentesV62();renderSelecaoAgenteCriacaoV62();return;}
    try{
        statusAgenteV62('Carregando agentes de produto...');
        const d=await apiAgenteV62('');
        agentesEstadoV62.lista=d.agentes||[];agentesEstadoV62.carregado=true;
        agentesEstadoV62.provedores={pesquisa:Boolean(d.pesquisa_habilitada),ia:Boolean(d.ia_habilitada)};
        renderListaAgentesV62();renderSelecaoAgenteCriacaoV62();
        statusAgenteV62(agentesEstadoV62.lista.length?`${agentesEstadoV62.lista.length} agente(s) dispon\u00edvel(is). Escolha um produto para editar.`:'Crie seu primeiro agente e salve a base do produto.');
    }catch(e){
        statusAgenteV62(e.message,'erro');
        const hint=elAgenteV62('criar-agente-info-v62');if(hint)hint.textContent=e.message;
    }
}

function renderListaAgentesV62(){
    const el=elAgenteV62('agentes-lista-v62');if(!el)return;
    const busca=valorAgenteV62('agentes-busca-v62').toLocaleLowerCase('pt-BR');
    const lista=agentesEstadoV62.lista.filter(a=>[a.name,a.product,a.brand].join(' ').toLocaleLowerCase('pt-BR').includes(busca));
    el.innerHTML=lista.map(a=>`<button onclick="abrirAgenteProdutoV62('${a.id}')" class="w-full text-left rounded-xl border ${agentesEstadoV62.agente?.id===a.id?'border-yellow-400':'border-slate-700'} bg-slate-950 p-3">
        <div class="text-xs font-black text-white">${textoEscapeV37(a.name)}</div>
        <div class="text-[11px] text-slate-400 mt-1">${textoEscapeV37(a.product)}</div>
        <div class="text-[10px] text-slate-500 mt-2">${a.refreshing?'Pesquisa em andamento':a.refresh_enabled?'Atualiza\u00e7\u00e3o autom\u00e1tica ativa':'Atualiza\u00e7\u00e3o manual'}</div></button>`).join('')||'<p class="text-xs text-slate-500">Nenhum agente encontrado. Clique em Novo agente para come\u00e7ar.</p>';
}

function renderSelecaoAgenteCriacaoV62(){
    const el=elAgenteV62('criar-agente-v62');if(!el)return;
    const atual=el.value||criarEstadoV37.agenteV62?.id||'';
    const busca=valorAgenteV62('criar-agente-busca-v62').toLocaleLowerCase('pt-BR');
    const lista=agentesEstadoV62.lista.filter(a=>a.id===atual||[a.name,a.product,a.brand].join(' ').toLocaleLowerCase('pt-BR').includes(busca));
    el.innerHTML='<option value="">Gerar com os dados preenchidos abaixo</option>'+lista.map(a=>`<option value="${a.id}">${textoEscapeV37(a.product+' \u2014 '+a.name)}</option>`).join('');
    el.value=lista.some(a=>a.id===atual)?atual:'';
}

function podeTrocarAgenteV62(){
    if(agentesEstadoV62.busy||agentesEstadoV62.saving){statusAgenteV62('Aguarde a opera\u00e7\u00e3o atual terminar.');return false;}
    return !agentesEstadoV62.dirty||confirm('H\u00e1 altera\u00e7\u00f5es n\u00e3o salvas neste agente. Deseja continuar sem salv\u00e1-las?');
}

function novoAgenteProdutoV62(){
    conferirContaAgentesV62();if(!podeTrocarAgenteV62())return;
    clearTimeout(agentesEstadoV62.pollTimer);
    agentesEstadoV62.agente={id:'',version:0,name:'',product:'',brand:'',manual:{},knowledge:{},chat:[],urls:[],instructions:'',refresh_enabled:false,interval_hours:168};
    renderEditorAgenteV62();statusAgenteV62('Preencha o produto espec\u00edfico, a ficha e os detalhes que voc\u00ea conhece.');
    elAgenteV62('agente-nome-v62')?.focus();
}

async function abrirAgenteProdutoV62(id){
    if(!podeTrocarAgenteV62())return;
    clearTimeout(agentesEstadoV62.pollTimer);
    const request=++agentesEstadoV62.selecao;
    try{
        statusAgenteV62('Abrindo agente...');
        const d=await apiAgenteV62('/'+encodeURIComponent(id));
        if(request!==agentesEstadoV62.selecao)return;
        agentesEstadoV62.agente=d.agente;guardarAgenteV62(d.agente);renderEditorAgenteV62();
        statusAgenteV62('Agente carregado. Voc\u00ea pode editar a base, pesquisar ou conversar no chat.');
        if(d.agente.refreshing)agendarPollAgenteV62(id,true);
    }catch(e){statusAgenteV62(e.message,'erro');}
}

/* V65 \u2014 consulta \u00e0s pesquisas acumuladas e gera\u00e7\u00e3o com as palavras-chave atuais. */
function atualizarInformacaoTitulosV65(){
    const el=document.getElementById('criar-titulos-info-v65');if(!el)return;
    const titles=String(document.getElementById('criar-titulos-v37')?.value||'').split(/\r?\n/).map(textoConteudoV61).filter(Boolean);
    const unicos=new Set(titles.map(assinaturaTituloV66)).size,q=quantidadeConteudoV61(document.getElementById('criar-qtd-v37')?.value);
    el.textContent=`V69 \u00b7 ${unicos} de ${q} t\u00edtulos \u00fanicos${titles.length!==unicos?' \u00b7 H\u00e1 t\u00edtulos repetidos: gere a lista novamente.':unicos<q?' \u00b7 Acrescente detalhes/palavras-chave ou ajuste a quantidade.':' \u00b7 Lista sem repeti\u00e7\u00f5es.'}`;
    el.className='text-[11px] mt-2 '+(unicos>=q&&unicos===titles.length?'text-emerald-400':'text-yellow-400');
}
function preencherCaracteristicasV65(silencioso=false){
    const entrada=entradaConteudoV61();let preenchidos=0;
    entrada.categorias=entrada.categorias.map(c=>({...c,atributos:criarEstadoV37.selectedCategories.find(x=>x.category_id===c.category_id)?.atributos||c.atributos}));
    for(const c of atributosAutomaticosV65(entrada)){
        const cat=criarEstadoV37.selectedCategories.find(x=>x.category_id===c.category_id);if(!cat)continue;
        cat.values=cat.values||{};
        for(const a of c.suggested_attributes||[]){if(cat.values[a.id]?.value_name||cat.values[a.id]?.value_id)continue;cat.values[a.id]={value_name:a.value_name,value_id:a.value_id||''};preenchidos++;}
    }
    renderCategoriasSelecionadasV37();renderPlanilhaPreviewV37();
    if(!silencioso)statusConteudoV61(`${preenchidos} caracter\u00edstica(s) preenchida(s) com os dados informados e revisados. Confira os campos antes de publicar.`);
    return preenchidos;
}
async function gerarTitulosKeywordsV65(){
    return gerarFluxoTitulosV67(true);
}
async function organizarFontesSalvasV65(){
    if(agentesEstadoV62.busy||agentesEstadoV62.agente?.refreshing)return;
    let a=agentesEstadoV62.agente;if(!a)return;
    if(!a.id||agentesEstadoV62.dirty){a=await salvarAgenteProdutoV62(true);if(!a)return;}
    agentesEstadoV62.busy=true;atualizarStatusAtualizacaoAgenteV62();
    try{
        const d=await apiAgenteV62('/'+a.id+'/organizar','POST',{});
        agentesEstadoV62.agente=d.agente;guardarAgenteV62(d.agente);
        statusAgenteV62('Organiza\u00e7\u00e3o por IA iniciada com as fontes salvas. Voc\u00ea pode continuar usando o painel.');
        agendarPollAgenteV62(a.id,true);
    }catch(e){statusAgenteV62(e.message,'erro');}
    finally{agentesEstadoV62.busy=false;atualizarStatusAtualizacaoAgenteV62();}
}
async function consultarAcervoAgenteV65(pagina=1){
    const a=agentesEstadoV62.agente;if(!a?.id){statusAgenteV62('Salve o agente para consultar seu acervo.');return;}
    const box=elAgenteV62('agente-acervo-v65'),out=elAgenteV62('agente-acervo-resultados-v65');if(!box||!out)return;
    box.open=true;
    const request=(agentesEstadoV62.acervoRequest||0)+1;agentesEstadoV62.acervoRequest=request;
    const params=new URLSearchParams({q:valorAgenteV62('agente-acervo-busca-v65'),tipo:valorAgenteV62('agente-acervo-tipo-v65'),pagina:String(Math.max(1,pagina)),todos:elAgenteV62('agente-acervo-todos-v65')?.checked?'1':'0'});
    out.innerHTML='<p class="text-xs text-slate-400">Consultando informa\u00e7\u00f5es salvas...</p>';
    try{
        const d=await apiAgenteV62('/'+a.id+'/acervo?'+params);
        if(agentesEstadoV62.agente?.id!==a.id||agentesEstadoV62.acervoRequest!==request)return;
        agentesEstadoV62.acervoPagina=d.pagina;
        const labels={fact:'Especifica\u00e7\u00e3o',keyword:'Palavra-chave',source:'Fonte consultada',title:'T\u00edtulo sugerido',summary:'Resumo da pesquisa',application:'Aplica\u00e7\u00e3o'};
        const fontes=urls=>(urls||[]).map(u=>{const safe=urlFonteAgenteV62(u);return safe?`<a href="${textoEscapeV37(safe)}" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline">Consultar fonte</a>`:'';}).join(' \u00b7 ');
        const rows=(d.entradas||[]).map(e=>{
            const p=e.payload||{},texto=e.entry_kind==='fact'?p.name+': '+p.value:e.entry_kind==='source'?[p.title,p.content].filter(Boolean).join('\n'):p.text||'';
            const date=e.first_seen_at?new Date(e.first_seen_at).toLocaleString('pt-BR'):'';
            return `<div class="border border-slate-700 rounded-xl p-3"><div class="text-[10px] font-bold text-yellow-400">${labels[e.entry_kind]||'Informa\u00e7\u00e3o'} \u00b7 Salvo em ${textoEscapeV37(date)}</div><div class="text-xs text-slate-200 whitespace-pre-wrap mt-2">${textoEscapeV37(texto)}</div><div class="text-[10px] mt-2">${fontes(p.url?[p.url]:p.sources||[])}</div></div>`;
        }).join('');
        const total=Number(d.total||0),pages=Math.max(1,Math.ceil(total/Number(d.por_pagina||40)));
        elAgenteV62('agente-acervo-resumo-v65').textContent=`${total} registro(s) encontrado(s). `+(d.contagens||[]).map(c=>(labels[c.entry_kind]||c.entry_kind)+': '+Number(c.total)).join(' \u00b7 ');
        out.innerHTML=rows||'<p class="text-xs text-slate-500">Nenhum registro encontrado. As pr\u00f3ximas pesquisas ser\u00e3o salvas aqui, sem duplica\u00e7\u00e3o.</p>';
        elAgenteV62('agente-acervo-pagina-v65').textContent=`P\u00e1gina ${d.pagina} de ${pages}`;
        elAgenteV62('agente-acervo-anterior-v65').disabled=d.pagina<=1;
        elAgenteV62('agente-acervo-proximo-v65').disabled=d.pagina>=pages;
    }catch(e){if(agentesEstadoV62.agente?.id===a.id)out.innerHTML=`<p class="text-xs text-red-300">${textoEscapeV37(e.message)}</p>`;}
}

function contextoTitulosV69(entrada){
    // O agente pode atualizar vers\u00e3o, fichas e metadados em segundo plano.
    // Apenas os campos de entrada desta gera\u00e7\u00e3o identificam a lista ativa.
    return JSON.stringify({produto:entrada.produto,detalhes:entrada.detalhes,conta:obterToken(),
        categorias:entrada.category_ids,agente:entrada.agente_id,keywords:entrada.keywords_titulos,
        base:document.getElementById('titulo-base-ia-v67')?.value||''});
}
function normalizarListaTitulosV69(texto){return String(texto||'').replace(/\r\n?/g,'\n').trim();}
async function lerRespostaTitulosV69(r){
    const text=await r.text();let d;try{d=JSON.parse(text);}catch(e){
        const err=new Error(`O servidor respondeu HTTP ${r.status} fora do formato esperado. Confira o deploy do server V69 no Render.`);err.status=r.status||502;throw err;
    }
    if(!r.ok||!d.sucesso){const err=new Error(d.erro||d.error||d.message||`Falha HTTP ${r.status} ao gerar t\u00edtulos.`);err.status=r.status;throw err;}return d;
}
async function pesquisarTermosTitulosV69(entrada,run,ativo){
    const controller=new AbortController();run.controllersV68.add(controller);const timer=setTimeout(()=>controller.abort(),85000);
    try{
        const r=await fetch(`${RENDER_URL}/api/v38/criar/ia/keywords`,{method:'POST',headers:{Authorization:obterToken(),'Content-Type':'application/json'},signal:controller.signal,
            body:JSON.stringify({produto:entrada.produto,detalhes:entrada.detalhes,category_ids:entrada.category_ids,categorias:entrada.categorias,agente_id:entrada.agente_id||null})});
        const d=await lerRespostaTitulosV69(r);
        if(ativo()){
            run.keywordsV69=termosUnicosV62([...(run.keywordsV69||[]),...(d.keywords||[])],300);
            renderFontesKeywordsV62(d);
            const el=document.getElementById('titulos-pesquisa-status-v69');if(el)el.textContent=d.parcial?(d.observacao||'Pesquisa parcial; os termos dispon\u00edveis foram aproveitados.'):`${run.keywordsV69.length} termos dispon\u00edveis para os pr\u00f3ximos lotes.`;
        }
    }catch(e){if(ativo()){const el=document.getElementById('titulos-pesquisa-status-v69');if(el)el.textContent='Pesquisa n\u00e3o conclu\u00edda: '+(e.name==='AbortError'?'prazo excedido.':e.message)+' A gera\u00e7\u00e3o usa a base e as palavras-chave dispon\u00edveis.';}}
    finally{clearTimeout(timer);run.controllersV68.delete(controller);}
}

/* V71: micro-lotes contínuos + unicidade pela sequência completa das palavras. */
function esperarTitulosV70(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
async function executarLotesTitulosV68({total,request,aceitar,ativo,progresso,iniciais=[],bloqueados=[]}){
    let etapa=0,reservados=0,vaziasConsecutivas=0,falhasConsecutivas=0;
    const paralelo=2,tamanhoLote=24,titles=[],seen=new Set(),erros=[];
    const bloqueadosLimpos=[];
    for(const t of bloqueados){const key=assinaturaTituloV66(t);if(key&&!seen.has(key)){seen.add(key);bloqueadosLimpos.push(t);}}
    for(const t of iniciais){const key=assinaturaTituloV66(t);if(key&&!seen.has(key)&&titles.length<total){seen.add(key);titles.push(t);}}
    const maxEtapas=Math.max(120,Math.ceil(total/8)*10);
    async function worker(){
        while(ativo()&&titles.length<total&&etapa<maxEtapas&&vaziasConsecutivas<40&&falhasConsecutivas<18){
            const restante=total-titles.length-reservados;if(restante<=0){await esperarTitulosV70(40);continue;}
            const index=etapa++,quantidade=Math.min(tamanhoLote,restante);reservados+=quantidade;
            try{
                const existentes=[...bloqueadosLimpos,...titles].slice(-15000);
                const d=await request({quantidade,etapa:index,existentes});
                if(!ativo())return;
                if(d.origem!=='ia')throw new Error('Atualize o servidor para a V70.');
                const antes=titles.length,limite=Math.min(60,Number(d.limite)||60),minimo=Math.min(42,limite);
                for(const raw of Array.isArray(d.titulos)?d.titulos:[]){
                    if(typeof raw!=='string')continue;
                    const t=textoConteudoV61(raw),key=assinaturaTituloV66(t);
                    if(!key||t.length<minimo||t.length>limite||seen.has(key))continue;
                    seen.add(key);titles.push(t);if(titles.length>=total)break;
                }
                if(titles.length===antes){vaziasConsecutivas++;await esperarTitulosV70(Math.min(1400,150+vaziasConsecutivas*60));}
                else{vaziasConsecutivas=0;falhasConsecutivas=0;}
                aceitar(titles.slice());progresso(titles.length,total);
            }catch(e){
                if(ativo()){
                    erros.push(e);falhasConsecutivas++;progresso(titles.length,total);
                    const temporario=e.name==='AbortError'||[408,429,500,502,503,504].includes(Number(e.status));
                    if(!temporario)throw e;
                    await esperarTitulosV70(Math.min(5000,500*falhasConsecutivas));
                }
            }finally{reservados-=quantidade;}
        }
    }
    try{await Promise.all(Array.from({length:paralelo},()=>worker()));}
    catch(e){return {titulos:titles,erro:e};}
    const esgotou=titles.length<total&&(falhasConsecutivas>=18||vaziasConsecutivas>=40||etapa>=maxEtapas);
    return {titulos:titles,erro:esgotou?(erros.at(-1)||new Error(`A IA parou após ${titles.length} títulos únicos. Clique em Gerar novamente para continuar sem perder os já criados.`)):null};
}

function chaveHistoricoTitulosV70(entrada,tituloBase){
    const bruto=JSON.stringify({produto:String(entrada?.produto||'').toLowerCase().trim(),titulo_base:String(tituloBase||'').toLowerCase().trim(),categorias:(entrada?.category_ids||[]).slice().sort()});
    let hash=2166136261;for(let i=0;i<bruto.length;i++){hash^=bruto.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return 'mlhub_titulos_v70_'+(hash>>>0).toString(36);
}
function lerHistoricoTitulosV70(entrada,tituloBase){
    try{const d=JSON.parse(localStorage.getItem(chaveHistoricoTitulosV70(entrada,tituloBase))||'[]');return Array.isArray(d)?d.filter(x=>typeof x==='string').slice(-15000):[];}catch(e){return [];}
}
function salvarHistoricoTitulosV70(entrada,tituloBase,lista){
    try{
        const base=lerHistoricoTitulosV70(entrada,tituloBase),out=[],seen=new Set();
        for(const t of [...base,...lista]){const txt=textoConteudoV61(t),key=assinaturaTituloV66(txt);if(key&&!seen.has(key)){seen.add(key);out.push(txt);}}
        localStorage.setItem(chaveHistoricoTitulosV70(entrada,tituloBase),JSON.stringify(out.slice(-15000)));
    }catch(e){}
}

async function gerarFluxoTitulosV67(somenteTitulos=false){
    const token=obterToken();if(!token){solicitarToken();return;}
    if(criarEstadoV37.conteudoRunV61&&!criarEstadoV37.conteudoRunV61.cancelled)return criarEstadoV37.conteudoRunV61.promise;
    if(document.getElementById('criar-agente-v62')?.value&&!contextoAgenteCriacaoV62()){await selecionarAgenteCriacaoV62();if(!contextoAgenteCriacaoV62())return;}
    let entrada=entradaConteudoV61();if(!entrada.produto&&!entrada.reference_images.length)return alert('Informe o produto ou envie uma foto.');
    const pedido=Number(document.getElementById('criar-qtd-v37')?.value||entrada.quantidade);
    if(!Number.isInteger(pedido)||pedido<1||pedido>5000)return alert('Informe de 1 a 5.000 t\u00edtulos por lote. Use novos lotes para volumes maiores.');
    const field=document.getElementById('criar-titulos-v37');
    const baseDigitada=document.getElementById('titulo-base-ia-v67')?.value||'';
    const tituloBase=baseDigitada.trim()||entrada.produto;
    const historicoV70=lerHistoricoTitulosV70(entrada,tituloBase);
    const contextoInicial=contextoTitulosV69(entrada),sessao=criarEstadoV37.titulosSessaoV69;
    const continuar=sessao?.contexto===contextoInicial&&sessao.titulos.length<entrada.quantidade;
    const conhecidos=new Set((sessao?.titulos||[]).map(assinaturaTituloV66));
    const iniciais=continuar?String(field.value||'').split(/\r?\n/).map(textoConteudoV61).filter(t=>conhecidos.has(assinaturaTituloV66(t))):[];
    const cached=lerCacheConteudoV45(entrada.cacheKey);
    let conteudo=somenteTitulos?{keywords:entrada.keywords_titulos,produto_detectado:entrada.produto}:cached||rascunhoConteudoV61(entrada);
    if(!somenteTitulos)aplicarConteudoRapidoV61({...conteudo,titulos:iniciais});else field.value=iniciais.join('\n');
    entrada=entradaConteudoV61();
    const run={identity:contextoTitulosV69(entrada),quantidade:entrada.quantidade,controller:new AbortController(),cancelled:false,controllersV68:new Set(),campos:camposConteudoV61(),button:document.querySelector('button[onclick="gerarConteudoCriacaoV37()"]')};
    if(run.button){run.buttonHTML=run.button.innerHTML;run.button.disabled=true;run.button.textContent='Gerando t\u00edtulos por IA...';}
    criarEstadoV37.conteudoRunV61=run;
    const atual=()=>!run.cancelled&&criarEstadoV37.conteudoRunV61===run&&contextoTitulosV69(entradaConteudoV61())===run.identity&&!run.edicaoAtributoV69&&entradaConteudoV61().quantidade===run.quantidade&&(document.getElementById('titulo-base-ia-v67')?.value||'')===baseDigitada;
    statusConteudoV61('Preparando os dados do produto para a IA...','aviso');
    run.promise=(async()=>{
        try{
            if(!somenteTitulos&&!cached){
                const completarConteudo=async()=>{
                    const controller=new AbortController();run.controllersV68.add(controller);
                    const timer=setTimeout(()=>controller.abort(),8500);
                    try{
                        const refs=await comSinalConteudoV61(referenciaRapidaConteudoV46(),controller.signal);
                        const r=await fetch(`${RENDER_URL}/api/v37/criar/ia/analisar-produto`,{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},signal:controller.signal,
                            body:JSON.stringify({produto:entrada.produto,detalhes:entrada.detalhes,quantidade:entrada.quantidade,reference_images:refs,
                                category_ids:entrada.category_ids,categorias:entrada.categorias,agente_id:entrada.agente_id||null,
                                keywords_titulos:entrada.keywords_titulos,variacao_ids:entrada.variacao_ids,apenas_conteudo:true,modo_rapido:true})});
                        const d=await r.json();return r.ok&&d.sucesso?d:null;
                    }catch(e){return null;}finally{clearTimeout(timer);run.controllersV68.delete(controller);}
                };
                if(entrada.produto){
                    // O nome j\u00e1 \u00e9 conhecido: descri\u00e7\u00e3o e t\u00edtulos come\u00e7am juntos.
                    run.contentPromiseV68=completarConteudo();
                }else{
                    const d=await completarConteudo();if(d)conteudo=d;
                    if(!atual())return;
                    aplicarConteudoRapidoV61({...conteudo,titulos:[]},run.campos);
                    salvarCacheConteudoV45({...conteudo,titulos:[],titulos_semente:[]},entrada.cacheKey);
                }
            }
            entrada=entradaConteudoV61();run.identity=contextoTitulosV69(entrada);
            if(!entrada.produto)throw new Error('Informe o nome do produto para a IA criar os t\u00edtulos.');
            let esperado=field.value;
            const valido=()=>atual()&&normalizarListaTitulosV69(field.value)===normalizarListaTitulosV69(esperado);
            run.keywordsV69=termosUnicosV62([...(entrada.keywords_titulos||[]),...(conteudo.keywords||[])],300);
            if(document.getElementById('titulos-pesquisar-v69')?.checked)run.pesquisaPromiseV69=pesquisarTermosTitulosV69(entrada,run,valido);
            const result=await executarLotesTitulosV68({total:entrada.quantidade,ativo:valido,iniciais,bloqueados:continuar?[]:historicoV70,
                request:async lote=>{
                    const controller=new AbortController();run.controllersV68.add(controller);
                    const timer=setTimeout(()=>controller.abort(),120000);
                    try{
                        const r=await fetch(`${RENDER_URL}/api/v69/titulos/gerar`,{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},signal:controller.signal,
                            body:JSON.stringify({produto:entrada.produto,titulo_base:tituloBase||entrada.produto,detalhes:entrada.detalhes,...lote,
                                category_ids:entrada.category_ids,agente_id:entrada.agente_id||null,agente_version:entrada.agente_contexto?.version||0,
                                keywords:run.keywordsV69,atributos_confirmados:entrada.categorias.map(c=>({category_id:c.category_id,values:c.values}))})});
                        return await lerRespostaTitulosV69(r);
                    }finally{clearTimeout(timer);run.controllersV68.delete(controller);}
                },
                aceitar:titles=>{field.value=titles.join('\n');esperado=field.value;
                    criarEstadoV37.titulosSessaoV69={contexto:run.identity,titulos:titles.slice()};atualizarInformacaoTitulosV65();
                    if(!run.previewTimerV68)run.previewTimerV68=setTimeout(()=>{run.previewTimerV68=null;if(atual())renderPlanilhaPreviewV37();},120);},
                progresso:(n,q)=>statusConteudoV61(`IA criando t\u00edtulos em paralelo: ${n} de ${q} prontos...`,'aviso')});
            if(!valido()){if(!run.cancelled)statusConteudoV61('Um campo de entrada foi alterado durante a gera\u00e7\u00e3o. Os t\u00edtulos prontos foram preservados. Clique novamente para continuar com os dados atuais.','aviso');return;}
            const titles=result.titulos;
            if(result.erro){renderPlanilhaPreviewV37();throw result.erro;}
            if(titles.length===entrada.quantidade)salvarHistoricoTitulosV70(entrada,tituloBase,titles);
            preencherCaracteristicasV65(true);atualizarInformacaoTitulosV65();
            statusConteudoV61(titles.length===entrada.quantidade?`${titles.length} títulos únicos criados pela IA. O histórico deste produto foi salvo para os próximos lotes não repetirem estes títulos.`:`A IA criou ${titles.length} de ${entrada.quantidade} títulos únicos. Os prontos foram preservados; clique em Gerar novamente para continuar.`,titles.length===entrada.quantidade?'ok':'aviso');
            if(run.contentPromiseV68){
                const d=await run.contentPromiseV68;
                if(d&&atual()){
                    aplicarConteudoRapidoV61({...d,titulos:field.value.split(/\r?\n/).filter(Boolean)},run.campos);
                    salvarCacheConteudoV45({...d,titulos:[],titulos_semente:[]},entrada.cacheKey);
                    if(criarEstadoV37.titulosSessaoV69)criarEstadoV37.titulosSessaoV69.contexto=contextoTitulosV69(entradaConteudoV61());
                }
            }
        }catch(e){
            if(!run.cancelled&&criarEstadoV37.conteudoRunV61===run)statusConteudoV61(e.name==='AbortError'?'A IA n\u00e3o concluiu esta etapa no prazo. Os t\u00edtulos prontos foram mantidos; clique em Gerar para continuar.':e.message,'erro');
        }finally{clearTimeout(run.timer);clearTimeout(run.previewTimerV68);for(const c of run.controllersV68)c.abort();if(criarEstadoV37.conteudoRunV61===run){restaurarBotaoConteudoV61(run);criarEstadoV37.conteudoRunV61=null;}}
    })();return run.promise;
}

function pararTitulosIAV67(){
    cancelarConteudoV61();atualizarInformacaoTitulosV65();statusConteudoV61('Gera\u00e7\u00e3o interrompida. Os t\u00edtulos j\u00e1 criados foram mantidos.','aviso');
}

function camposEditorAgenteV62(){
    return {'agente-nome-v62':'name','agente-produto-v62':'product','agente-marca-v62':'brand','agente-instrucoes-v62':'instructions',
        'agente-informacoes-v62':'information','agente-ficha-v62':'technical_sheet','agente-aplicacoes-v62':'applications',
        'agente-notas-v62':'notes','agente-keywords-v62':'keywords','agente-links-v62':'urls'};
}

function renderEditorAgenteV62(){
    const a=agentesEstadoV62.agente;if(!a)return;
    for(const [id,key] of Object.entries(camposEditorAgenteV62())){
        const el=elAgenteV62(id);if(!el)continue;
        const v=['name','product','brand','instructions','urls'].includes(key)?a[key]:a.manual?.[key];
        el.value=Array.isArray(v)?v.join(key==='keywords'?', ':'\n'):String(v||'');
    }
    elAgenteV62('agente-auto-v62').checked=Boolean(a.refresh_enabled);
    elAgenteV62('agente-intervalo-v62').value=String(a.interval_hours||168);
    elAgenteV62('agentes-editor-v62').classList.remove('hidden');
    elAgenteV62('agente-conhecimento-v62').classList.remove('hidden');
    elAgenteV62('agente-excluir-v62').disabled=!a.id;
    const acervo=elAgenteV62('agente-acervo-v65');if(acervo){acervo.open=false;elAgenteV62('agente-acervo-resultados-v65').innerHTML='';elAgenteV62('agente-acervo-resumo-v65').textContent='';}
    agentesEstadoV62.dirty=false;agentesEstadoV62.organiza\u00e7\u00e3o=null;
    elAgenteV62('agente-aplicar-organizacao-v62').classList.add('hidden');
    elAgenteV62('agente-chat-mensagem-v62').value='';
    atualizarStatusAtualizacaoAgenteV62();renderPesquisaAgenteV62();renderChatAgenteV62();renderListaAgentesV62();
}

function marcarEdicaoAgenteV62(){
    agentesEstadoV62.dirty=true;
    const el=elAgenteV62('agente-salvo-v62');if(el)el.textContent='Altera\u00e7\u00f5es nos campos ainda n\u00e3o foram salvas.';
}

function atualizarStatusAtualizacaoAgenteV62(){
    const a=agentesEstadoV62.agente;if(!a)return;
    const data=v=>v?new Date(v).toLocaleString('pt-BR'):'Ainda n\u00e3o pesquisado';
    elAgenteV62('agente-salvo-v62').textContent=agentesEstadoV62.dirty?'Altera\u00e7\u00f5es nos campos ainda n\u00e3o foram salvas.':a.id?'Base salva. Produto: '+a.product:'Agente novo. Salve para iniciar a pesquisa e o chat.';
    elAgenteV62('agente-atualizacao-v62').textContent=a.refreshing?'Pesquisando fontes na internet...':
        '\u00daltima pesquisa: '+data(a.last_refreshed_at)+(a.refresh_enabled?' \u00b7 Pr\u00f3xima: '+data(a.next_refresh_at):' \u00b7 Atualiza\u00e7\u00e3o autom\u00e1tica desativada')+(a.last_error?' \u00b7 '+a.last_error:'');
    const botao=elAgenteV62('agente-pesquisar-v62');
    botao.disabled=a.refreshing||agentesEstadoV62.busy;
    botao.textContent=a.refreshing?'\u2315 Pesquisando...':'\u2315 Pesquisar na internet';
}

function aprovadosCamposAgenteV62(){
    const a=agentesEstadoV62.agente||{};
    const todos=[...(a.manual?.approved_facts||[]),...(a.knowledge?.facts||[])];
    const boxes=[...document.querySelectorAll('#agente-pesquisa-v62 input[data-fato-v62]')];
    if(!boxes.length)return a.manual?.approved_facts||[];
    const keys=new Set(boxes.filter(b=>b.checked).map(b=>b.dataset.fatoV62));
    return todos.filter((f,i)=>keys.has(hashConteudoV61(f.name+'\n'+f.value))&&todos.findIndex(x=>x.name===f.name&&x.value===f.value)===i);
}

function corpoAgenteV62(){
    return {name:valorAgenteV62('agente-nome-v62'),product:valorAgenteV62('agente-produto-v62'),brand:valorAgenteV62('agente-marca-v62'),
        instructions:valorAgenteV62('agente-instrucoes-v62'),urls:valorAgenteV62('agente-links-v62').split('\n'),
        refresh_enabled:Boolean(elAgenteV62('agente-auto-v62')?.checked),interval_hours:Number(valorAgenteV62('agente-intervalo-v62')||168),
        version:agentesEstadoV62.agente?.version||0,manual:{information:valorAgenteV62('agente-informacoes-v62'),
            technical_sheet:valorAgenteV62('agente-ficha-v62'),applications:valorAgenteV62('agente-aplicacoes-v62'),
            notes:valorAgenteV62('agente-notas-v62'),keywords:termosUnicosV62(valorAgenteV62('agente-keywords-v62'),80),approved_facts:aprovadosCamposAgenteV62()}};
}

async function salvarAgenteProdutoV62(silencioso=false){
    if(agentesEstadoV62.saving)return agentesEstadoV62.saving;
    if(agentesEstadoV62.busy)return null;
    const a=agentesEstadoV62.agente;if(!a)return null;
    const body=corpoAgenteV62();
    if(!body.name||!body.product){statusAgenteV62('Preencha o nome do agente e o produto espec\u00edfico.','erro');return null;}
    const botao=elAgenteV62('agente-salvar-v62');botao.disabled=true;
    agentesEstadoV62.saving=(async()=>{
        try{
            const d=await apiAgenteV62(a.id?'/'+a.id:'',a.id?'PUT':'POST',body);
            // Edi\u00e7\u00f5es realizadas enquanto o salvamento responde continuam nos campos.
            const atual=corpoAgenteV62();const semVersao=x=>JSON.stringify({...x,version:0});
            const mudou=semVersao(atual)!==semVersao(body);
            agentesEstadoV62.agente=d.agente;guardarAgenteV62(d.agente);
            if(!mudou)renderEditorAgenteV62();else{agentesEstadoV62.dirty=true;atualizarStatusAtualizacaoAgenteV62();}
            if(!silencioso)statusAgenteV62(mudou?'Agente salvo. Suas novas edi\u00e7\u00f5es continuam nos campos para um pr\u00f3ximo salvamento.':'Agente salvo. Esta base j\u00e1 pode ser usada na cria\u00e7\u00e3o de an\u00fancios.','ok');
            return d.agente;
        }catch(e){statusAgenteV62(e.message,'erro');return null;}
        finally{botao.disabled=false;agentesEstadoV62.saving=null;}
    })();
    return agentesEstadoV62.saving;
}

function urlFonteAgenteV62(valor){
    try{const u=new URL(String(valor||''));return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch(e){return '';}
}

function renderSugestoesGoogleV62(container,html){
    if(!container||!html)return;
    const frame=document.createElement('iframe');
    frame.title='Sugest\u00f5es da Pesquisa Google';frame.setAttribute('sandbox','allow-popups allow-popups-to-escape-sandbox');
    frame.referrerPolicy='no-referrer';frame.className='w-full rounded-xl bg-white mt-3';frame.style.height='170px';
    frame.srcdoc='<base target="_blank">'+html;container.appendChild(frame);
}

function renderPesquisaAgenteV62(){
    const el=elAgenteV62('agente-pesquisa-v62');if(!el)return;
    const a=agentesEstadoV62.agente||{},k=a.knowledge||{};
    const antes=agentesEstadoV62.dirty?[...document.querySelectorAll('#agente-pesquisa-v62 input[data-fato-v62]')]:[];
    const marcados=new Set(antes.length?antes.filter(b=>b.checked).map(b=>b.dataset.fatoV62):(a.manual?.approved_facts||[]).map(f=>hashConteudoV61(f.name+'\n'+f.value)));
    const fatos=[...(a.manual?.approved_facts||[]),...(k.facts||[])].filter((f,i,list)=>list.findIndex(x=>x.name===f.name&&x.value===f.value)===i);
    const fontes=k.sources||[];
    const links=urls=>urls.map(url=>{const segura=urlFonteAgenteV62(url);return segura?`<a href="${textoEscapeV37(segura)}" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline">Fonte ${fontes.findIndex(s=>s.url===url)+1||'consultada'}</a>`:'';}).join(' \u00b7 ');
    el.innerHTML=(k.warning?`<div class="hub-info text-yellow-300">${textoEscapeV37(k.warning)}</div>`:'')+(k.provider?`<div class="text-[10px] text-slate-500">${textoEscapeV37(nomeProvedorPtV64(k.provider))}${k.search_cache?' \u00b7 busca reaproveitada (at\u00e9 24 horas)':''}</div>`:'')+(k.summary?`<div class="text-xs leading-6 text-slate-300 whitespace-pre-wrap">${textoEscapeV37(k.summary)}</div>`:'<p class="text-xs text-slate-500">Clique em Pesquisar na internet para reunir informa\u00e7\u00f5es, palavras-chave e fontes deste produto.</p>')+
        (fatos.length?`<div><div class="hub-label">Especifica\u00e7\u00f5es para sua revis\u00e3o</div>${fatos.map(f=>{
            const key=hashConteudoV61(f.name+'\n'+f.value);
            return `<div class="rounded-xl border border-slate-700 p-3 mt-2"><label class="flex gap-2 items-start text-xs text-slate-200"><input type="checkbox" data-fato-v62="${key}" ${marcados.has(key)?'checked':''} onchange="marcarEdicaoAgenteV62()" class="w-4 h-4 mt-0.5 accent-yellow-400"><span><strong>${textoEscapeV37(f.name)}:</strong> ${textoEscapeV37(f.value)}<span class="block text-[10px] text-slate-500 mt-1">Usar esta informa\u00e7\u00e3o no an\u00fancio ap\u00f3s salvar o agente</span></span></label><div class="text-[10px] mt-2">${links(f.sources||[])}</div></div>`;
        }).join('')}</div>`:'')+
        (k.applications?`<div><div class="hub-label">Aplica\u00e7\u00f5es encontradas \u2014 confira o modelo</div><p class="text-xs text-slate-300 whitespace-pre-wrap">${textoEscapeV37(k.applications)}</p></div>`:'')+
        ((k.keywords||[]).length?`<div><div class="hub-label">${k.keywords.length} palavras-chave sugeridas</div><div class="flex flex-wrap gap-1.5">${k.keywords.map(w=>`<span class="hub-badge">${textoEscapeV37(w)}</span>`).join('')}</div></div>`:'')+
        ((k.titles||[]).length?`<div><div class="hub-label">Ideias de t\u00edtulos</div><ol class="list-decimal pl-5 text-xs text-slate-300 space-y-2">${k.titles.map(t=>`<li>${textoEscapeV37(t)}</li>`).join('')}</ol></div>`:'')+
        ((k.pending||[]).length?`<div class="hub-info"><div class="font-bold text-yellow-400">Informa\u00e7\u00f5es a confirmar</div><ul class="list-disc pl-4 mt-2">${k.pending.map(p=>`<li>${textoEscapeV37(p)}</li>`).join('')}</ul></div>`:'')+
        (fontes.length?`<div><div class="hub-label">Fontes da \u00faltima pesquisa</div><ol class="list-decimal pl-5 space-y-2 text-xs">${fontes.map(s=>{const u=urlFonteAgenteV62(s.url);return u?`<li><a href="${textoEscapeV37(u)}" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline">${textoEscapeV37(s.title||u)}</a></li>`:'';}).join('')}</ol></div>`:'')+
        ((k.queries||[]).length?`<div class="text-[10px] text-slate-500">Buscas utilizadas: ${textoEscapeV37(k.queries.join(' \u00b7 '))}</div>`:'');
    renderSugestoesGoogleV62(el,k.search_suggestions||'');
}

function renderChatAgenteV62(){
    const el=elAgenteV62('agente-chat-historico-v62');if(!el)return;
    const chat=agentesEstadoV62.agente?.chat||[];
    el.innerHTML=chat.map(m=>`<div class="rounded-xl border ${m.role==='user'?'border-slate-700 bg-slate-950':'border-emerald-900 bg-emerald-950/20'} p-3"><div class="text-[10px] uppercase font-black ${m.role==='user'?'text-slate-500':'text-emerald-400'}">${m.role==='user'?'Voc\u00ea':'Agente'}</div><div class="text-xs leading-6 text-slate-200 whitespace-pre-wrap mt-1">${textoEscapeV37(m.text)}</div></div>`).join('')||'<p class="text-xs text-slate-500">Comece contando o que voc\u00ea sabe sobre o produto ou pe\u00e7a para organizar a base preenchida.</p>';
    el.scrollTop=el.scrollHeight;
    const ultima=[...chat].reverse().find(m=>m.role==='assistant'&&m.organization);
    agentesEstadoV62.organiza\u00e7\u00e3o=ultima?.organization||null;
    elAgenteV62('agente-aplicar-organizacao-v62').classList.toggle('hidden',!agentesEstadoV62.organiza\u00e7\u00e3o);
}

function agendarPollAgenteV62(id,reiniciar=false){
    clearTimeout(agentesEstadoV62.pollTimer);if(reiniciar)agentesEstadoV62.pollAttempts=0;
    agentesEstadoV62.pollTimer=setTimeout(()=>pollAgenteV62(id),3000);
}

async function pollAgenteV62(id){
    if(agentesEstadoV62.agente?.id!==id||agentesEstadoV62.pollBusy)return;
    agentesEstadoV62.pollBusy=true;
    try{
        const d=await apiAgenteV62('/'+id);
        if(agentesEstadoV62.agente?.id!==id)return;
        agentesEstadoV62.agente=d.agente;guardarAgenteV62(d.agente);
        atualizarStatusAtualizacaoAgenteV62();renderPesquisaAgenteV62();
        if(d.agente.refreshing&&++agentesEstadoV62.pollAttempts<50)agendarPollAgenteV62(id);
        else if(d.agente.refreshing)statusAgenteV62('A pesquisa continua no servidor. Reabra o agente para consultar o resultado.');
        else statusAgenteV62(d.agente.last_error||d.agente.knowledge?.warning||'Pesquisa conclu\u00edda. Revise as fontes e as especifica\u00e7\u00f5es antes de usar no an\u00fancio.',d.agente.last_error?'erro':'ok');
    }catch(e){statusAgenteV62(e.message,'erro');}
    finally{agentesEstadoV62.pollBusy=false;}
}

async function pesquisarProdutoAgenteV62(){
    if(agentesEstadoV62.busy||agentesEstadoV62.agente?.refreshing)return;
    let a=agentesEstadoV62.agente;if(!a)return;
    if(!a.id||agentesEstadoV62.dirty){a=await salvarAgenteProdutoV62(true);if(!a)return;}
    agentesEstadoV62.busy=true;atualizarStatusAtualizacaoAgenteV62();
    try{
        const d=await apiAgenteV62('/'+a.id+'/pesquisar','POST',{});
        agentesEstadoV62.agente=d.agente;guardarAgenteV62(d.agente);
        statusAgenteV62('Pesquisa iniciada. Voc\u00ea pode continuar usando o painel enquanto o agente re\u00fane as fontes.');
        agendarPollAgenteV62(a.id,true);
    }catch(e){statusAgenteV62(e.message,'erro');}
    finally{agentesEstadoV62.busy=false;atualizarStatusAtualizacaoAgenteV62();}
}

async function enviarChatAgenteV62(){
    if(agentesEstadoV62.busy)return;
    const message=valorAgenteV62('agente-chat-mensagem-v62');if(!message){statusAgenteV62('Escreva a mensagem para o agente.');return;}
    let a=agentesEstadoV62.agente;if(!a)return;
    if(!a.id||agentesEstadoV62.dirty){a=await salvarAgenteProdutoV62(true);if(!a)return;}
    agentesEstadoV62.busy=true;const botao=elAgenteV62('agente-chat-enviar-v62');botao.disabled=true;
    statusAgenteV62('O agente est\u00e1 organizando sua resposta...');
    try{
        const d=await apiAgenteV62('/'+a.id+'/chat','POST',{message});
        agentesEstadoV62.agente=d.agente;guardarAgenteV62(d.agente);renderChatAgenteV62();
        if(valorAgenteV62('agente-chat-mensagem-v62')===message)elAgenteV62('agente-chat-mensagem-v62').value='';
        statusAgenteV62('Resposta salva no hist\u00f3rico. Voc\u00ea pode aplicar a organiza\u00e7\u00e3o aos campos.','ok');
    }catch(e){statusAgenteV62(e.message,'erro');}
    finally{agentesEstadoV62.busy=false;botao.disabled=false;atualizarStatusAtualizacaoAgenteV62();}
}

function organizarIdeiasAgenteV62(){
    elAgenteV62('agente-chat-mensagem-v62').value='Organize todas as informa\u00e7\u00f5es que preenchi em informa\u00e7\u00f5es do produto, ficha t\u00e9cnica, aplica\u00e7\u00f5es, observa\u00e7\u00f5es e palavras-chave. Preserve os fatos e indique os pontos que ainda preciso confirmar.';
    enviarChatAgenteV62();
}

function aplicarOrganizacaoAgenteV62(){
    const o=agentesEstadoV62.organiza\u00e7\u00e3o;if(!o)return;
    const campos={'agente-informacoes-v62':'information','agente-ficha-v62':'technical_sheet','agente-aplicacoes-v62':'applications','agente-notas-v62':'notes','agente-keywords-v62':'keywords'};
    for(const [id,key] of Object.entries(campos)){if(o[key]&&(!Array.isArray(o[key])||o[key].length))elAgenteV62(id).value=Array.isArray(o[key])?o[key].join(', '):o[key];}
    marcarEdicaoAgenteV62();statusAgenteV62('Organiza\u00e7\u00e3o aplicada aos campos. Confira o conte\u00fado e salve o agente.');
}

async function excluirAgenteProdutoV62(){
    const a=agentesEstadoV62.agente;if(!a?.id||agentesEstadoV62.busy||agentesEstadoV62.saving)return;
    if(!confirm('Excluir o agente \u201c'+a.name+'\u201d e seu hist\u00f3rico de pesquisa/chat?'))return;
    agentesEstadoV62.busy=true;
    try{
        await apiAgenteV62('/'+a.id,'DELETE',{version:a.version});
        clearTimeout(agentesEstadoV62.pollTimer);agentesEstadoV62.cache.delete(a.id);
        agentesEstadoV62.lista=agentesEstadoV62.lista.filter(x=>x.id!==a.id);agentesEstadoV62.agente=null;agentesEstadoV62.dirty=false;
        if(criarEstadoV37.agenteV62?.id===a.id){criarEstadoV37.agenteV62=null;elAgenteV62('criar-agente-v62').value='';cancelarConteudoV61();}
        elAgenteV62('agentes-editor-v62').classList.add('hidden');elAgenteV62('agente-conhecimento-v62').classList.add('hidden');
        renderListaAgentesV62();renderSelecaoAgenteCriacaoV62();statusAgenteV62('Agente exclu\u00eddo.','ok');
    }catch(e){statusAgenteV62(e.message,'erro');}
    finally{agentesEstadoV62.busy=false;}
}

function contextoAgenteCriacaoV62(){
    conferirContaAgentesV62();
    const a=criarEstadoV37.agenteV62;
    const id=valorAgenteV62('criar-agente-v62');if(!a||a.id!==id)return null;
    const m=a.manual||{},k=a.knowledge||{};
    return {id:a.id,version:a.version,name:a.name,product:a.product,brand:a.brand,information:m.information||'',
        technical_sheet:m.technical_sheet||'',applications:m.applications||'',notes:m.notes||'',approved_facts:m.approved_facts||[],
        instructions:a.instructions||'',keywords:termosUnicosV62([...(m.keywords||[]),...(k.keywords||[])],80),title_ideas:k.titles||[]};
}

async function selecionarAgenteCriacaoV62(){
    const id=valorAgenteV62('criar-agente-v62'),request=++agentesEstadoV62.selecao;
    cancelarConteudoV61();criarEstadoV37.agenteV62=null;
    const info=elAgenteV62('criar-agente-info-v62');
    if(!id){info.textContent='A gera\u00e7\u00e3o usar\u00e1 o produto, os detalhes e as caracter\u00edsticas preenchidas no an\u00fancio.';return;}
    info.textContent='Carregando a base deste agente...';
    try{
        const d=await apiAgenteV62('/'+id);
        if(request!==agentesEstadoV62.selecao||valorAgenteV62('criar-agente-v62')!==id)return;
        criarEstadoV37.agenteV62=d.agente;guardarAgenteV62(d.agente);
        if(!valorAgenteV62('criar-produto-v37'))elAgenteV62('criar-produto-v37').value=d.agente.product;
        info.textContent='Base selecionada: '+d.agente.product+'. A gera\u00e7\u00e3o usar\u00e1 a ficha e as informa\u00e7\u00f5es revisadas deste agente. Use o bot\u00e3o abaixo para preencher tamb\u00e9m os campos.';
    }catch(e){info.textContent=e.message;}
}

async function usarInformacoesAgenteCriacaoV62(){
    if(!criarEstadoV37.agenteV62)await selecionarAgenteCriacaoV62();
    const a=contextoAgenteCriacaoV62();if(!a)return;
    cancelarConteudoV61();elAgenteV62('criar-produto-v37').value=a.product;
    const dados=baseConfirmadaAgenteV62(a),atual=valorAgenteV62('criar-detalhes-v37');
    if(dados&&!atual.includes(dados))elAgenteV62('criar-detalhes-v37').value=[atual,dados].filter(Boolean).join('\n\n');
    elAgenteV62('criar-keywords-v37').value=termosUnicosV62([...termosUnicosV62(valorAgenteV62('criar-keywords-v37')),...a.keywords],80).join(', ');
    for(const c of criarEstadoV37.selectedCategories||[]){
        c.values=c.values||{};
        if(a.brand&&!c.values.BRAND?.value_name&&!c.values.BRAND?.value_id&&c.atributos?.some(d=>d.id==='BRAND'))setCategoriaMarcaV62(c.category_id,a.brand);
    }
    preencherCaracteristicasV65(true);
    renderCategoriasSelecionadasV37();renderPlanilhaPreviewV37();
    elAgenteV62('criar-agente-info-v62').textContent='Informa\u00e7\u00f5es do agente aplicadas. Ajuste os detalhes desta vers\u00e3o e clique em gerar o conte\u00fado.';
}

async function anunciarComAgenteV62(){
    let a=agentesEstadoV62.agente;if(!a)return;
    if(!a.id||agentesEstadoV62.dirty){a=await salvarAgenteProdutoV62(true);if(!a)return;}
    guardarAgenteV62(a);mudarAba('criar-massa');
    elAgenteV62('criar-agente-busca-v62').value='';renderSelecaoAgenteCriacaoV62();
    elAgenteV62('criar-agente-v62').value=a.id;criarEstadoV37.agenteV62=a;
    await usarInformacoesAgenteCriacaoV62();
}

function setCategoriaMarcaV62(categoryId,value){
    const cat=criarEstadoV37.selectedCategories.find(c=>c.category_id===categoryId);if(!cat)return;
    const nome=String(value||'').trim(),def=cat.atributos?.find(a=>String(a.id)==='BRAND');
    const normal=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
    const match=(def?.values||[]).find(v=>normal(v.name)===normal(nome));
    cat.values=cat.values||{};
    cat.values.BRAND=match?{value_id:String(match.id||''),value_name:String(match.name||nome)}:{value_name:nome};
    renderPlanilhaPreviewV37();
}

document.addEventListener('DOMContentLoaded',()=>{
    for(const id of [...Object.keys(camposEditorAgenteV62()),'agente-auto-v62','agente-intervalo-v62']){
        const el=elAgenteV62(id);if(el)el.addEventListener(el.tagName==='SELECT'||el.type==='checkbox'?'change':'input',marcarEdicaoAgenteV62);
    }
});
