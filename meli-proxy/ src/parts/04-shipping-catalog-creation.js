
async function validarPayloadMercadoComFallbackEnvioV50(token,payload,shippingInfo){
    const strategies=Array.isArray(shippingInfo?.strategies)&&shippingInfo.strategies.length
      ? shippingInfo.strategies : ['me2_minimal','me2_full'];
    const tentativas=[]; let ultimo=null;
    let info={...shippingInfo};

    for(const strategy of strategies){
        let tentativa=aplicarEstrategiaEnvioV50(payload,info,strategy);
        if(String(tentativa?.shipping?.mode||'').toLowerCase()!=='me2'){
            throw new Error('Prote\u00e7\u00e3o interna: a publica\u00e7\u00e3o tentou sair sem Mercado Envios 2.');
        }

        for(let rodada=0;rodada<2;rodada++){
            const r=await mlFetch(`${ML_API}/items/validate`,token,{
                method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(tentativa)
            });
            const d=await jsonSeguro(r);
            const warningsOnly=!r.ok && somenteWarningsMercadoV51(d);
            tentativas.push({
                strategy,status:r.status,ok:r.ok,warnings_only:warningsOnly,
                shipping:tentativa.shipping,
                erro:(r.ok||warningsOnly)?null:formatarErroMercadoLivre(d),raw:d
            });
            ultimo={response:r,data:d,payload:tentativa,mode:'me2',strategy,tentativas,warnings_only:warningsOnly};

            if(r.ok || warningsOnly)return ultimo;

            if(temCodigoCausaV51(d,'item.shipping.mandatory_free_shipping') && !tentativa.shipping?.free_shipping){
                info={...info,free_shipping:true,free_shipping_required:true};
                tentativa=aplicarEstrategiaEnvioV50(payload,info,strategy);
                continue;
            }
            if(ehAvisoEnvioAutocorrigivelV51(d)){
                ultimo.warnings_only=true;
                return ultimo;
            }
            break;
        }
    }
    return ultimo;
}

async function publicarPayloadMercadoComFallbackEnvioV50(token,payload,shippingInfo){
    const strategies=Array.isArray(shippingInfo?.strategies)&&shippingInfo.strategies.length
      ? shippingInfo.strategies : ['me2_minimal','me2_full'];
    const tentativas=[]; let ultimo=null;
    let info={...shippingInfo};

    for(const strategy of strategies){
        let tentativa=aplicarEstrategiaEnvioV50(payload,info,strategy);
        if(String(tentativa?.shipping?.mode||'').toLowerCase()!=='me2'){
            throw new Error('Prote\u00e7\u00e3o interna: a publica\u00e7\u00e3o tentou sair sem Mercado Envios 2.');
        }

        for(let rodada=0;rodada<2;rodada++){
            const pr=await mlPostComRetryV36(`${ML_API}/items`,token,tentativa,4);
            tentativas.push({
                strategy,status:pr?.status||null,ok:Boolean(pr?.ok),
                shipping:tentativa.shipping,
                erro:pr?.ok?null:formatarErroMercadoLivre(pr?.data),raw:pr?.data
            });
            ultimo={...pr,payload:tentativa,mode:'me2',strategy,tentativas};
            if(pr?.ok)return ultimo;

            if(temCodigoCausaV51(pr?.data,'item.shipping.mandatory_free_shipping') && !tentativa.shipping?.free_shipping){
                info={...info,free_shipping:true,free_shipping_required:true};
                tentativa=aplicarEstrategiaEnvioV50(payload,info,strategy);
                continue;
            }
            if(!ehErroEspecificoEnvioV50(pr?.data))return ultimo;
            break;
        }
    }
    return ultimo;
}

function normalizarLinhasVariacaoV53(varCfg={}){
    const enabled=Boolean(varCfg?.enabled);
    if(!enabled)return [];
    const rows=Array.isArray(varCfg?.rows)?varCfg.rows:[];
    if(rows.length){
        return rows.slice(0,100).map((r,i)=>({
            index:i+1,
            stock:r?.stock==null||r?.stock===''?null:Math.max(0,Number(r.stock||0)),
            sku_suffix:String(r?.sku_suffix||'').trim(),
            size_grid_row_id:String(r?.size_grid_row_id||'').trim(),
            attributes:(Array.isArray(r?.attributes)?r.attributes:[]).map(a=>({
                id:String(a?.id||'').trim(),
                ...(a?.value_id!=null&&String(a.value_id).trim()?{value_id:String(a.value_id).trim()}:{}),
                ...(a?.value_name!=null&&String(a.value_name).trim()?{value_name:String(a.value_name).trim()}:{}),
            })).filter(a=>a.id&&(a.value_id||a.value_name))
        }));
    }
    // Compatibilidade com o formato anterior: 1 atributo + lista de valores.
    const attrId=String(varCfg?.attribute_id||'').trim();
    const values=Array.isArray(varCfg?.values)?varCfg.values.map(v=>String(v||'').trim()).filter(Boolean):[];
    const count=Math.min(100,Math.max(1,Number(varCfg?.count||values.length||1)));
    return values.slice(0,count).map((value,i)=>({index:i+1,stock:null,sku_suffix:'',size_grid_row_id:'',attributes:attrId?[{id:attrId,value_name:value}]:[]}));
}

function quantidadeVariacoesV53(cfg={},userProductSeller=false){
    if(!cfg?.variations?.enabled)return 1;
    if(!userProductSeller)return 1;
    const rows=normalizarLinhasVariacaoV53(cfg.variations);
    return Math.max(1,rows.length);
}

function assinaturaVariacaoV53(row={},defs=[]){
    const ids=new Set((defs||[]).map(d=>String(d.id)));
    return JSON.stringify((row.attributes||[])
      .filter(a=>ids.has(String(a.id)))
      .map(a=>[String(a.id),String(a.value_id||a.value_name||'').trim().toLowerCase()])
      .filter(x=>x[1])
      .sort((a,b)=>a[0].localeCompare(b[0])));
}

function validarLinhasVariacaoV53(varCfg={},meta){
    if(!varCfg?.enabled)return [];
    const rows=normalizarLinhasVariacaoV53(varCfg);
    if(!rows.length)return ['Ative as varia\u00e7\u00f5es e preencha pelo menos uma linha de varia\u00e7\u00e3o.'];
    // V59: SIZE_GRID_ROW_ID e SIZE_GRID_ID s\u00e3o atributos derivados do guia de tamanhos.
    // Eles N\u00c3O devem bloquear esta valida\u00e7\u00e3o preliminar das linhas, porque o painel
    // resolve e injeta o SIZE_GRID_ROW_ID correto depois, em aplicarGuiaTamanhoV55().
    // Antes disso o usu\u00e1rio j\u00e1 pode ter selecionado visualmente a linha do guia,
    // mas ela fica em row.size_grid_row_id (fora de row.attributes), o que fazia o
    // validador acusar falsamente "faltam ID da linha da guia de tamanhos".
    const atributosGuiaGerados=new Set(['SIZE_GRID_ID','SIZE_GRID_ROW_ID']);
    const defs=[...(meta?.defMap?.values?.()||[])].filter(d=>
        !d.read_only &&
        !atributosGuiaGerados.has(String(d?.id||'')) &&
        (d.child_pk||d.allow_variations||d.variation_attribute)
    );
    const combinacoes=defs.filter(d=>d.child_pk||d.allow_variations);
    if(!combinacoes.length)return ['A categoria selecionada n\u00e3o retornou atributos permitidos para varia\u00e7\u00e3o.'];
    const obrigatorios=combinacoes.filter(d=>d.child_pk||d.required);
    const assinaturas=new Set();
    const erros=[];
    rows.forEach((row,i)=>{
        const validos=[]; const porId=new Map();
        for(const a of (row.attributes||[])){
            const def=meta?.defMap?.get?.(String(a.id));
            const clean=sanitizarValorAtributoV46(a,def);
            if(clean){validos.push(clean);porId.set(String(clean.id),clean);}
        }
        const faltantes=obrigatorios.filter(d=>!porId.has(String(d.id)));
        if(faltantes.length)erros.push(`Varia\u00e7\u00e3o ${i+1}: faltam ${faltantes.map(d=>d.name||d.id).join(', ')}.`);
        if(!combinacoes.some(d=>porId.has(String(d.id))))erros.push(`Varia\u00e7\u00e3o ${i+1}: informe pelo menos um atributo que diferencie a varia\u00e7\u00e3o.`);
        const sig=assinaturaVariacaoV53({attributes:validos},combinacoes);
        if(sig==='[]')return;
        if(assinaturas.has(sig))erros.push(`Varia\u00e7\u00e3o ${i+1}: a combina\u00e7\u00e3o de atributos est\u00e1 repetida.`);
        assinaturas.add(sig);
    });
    return erros;
}


function normalizarTextoGuiaV55(v){
    return String(v??'')
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .trim().toLowerCase()
      .replace(/\b(brasil|br|bra|tamanho|tam\.?|numero|num\.?|n\u00ba|no\.?|size)\b/g,' ')
      .replace(/[^a-z0-9.,/+-]+/g,' ')
      .replace(/\s+/g,' ').trim();
}
function candidatosTamanhoV55(v){
    const raw=String(v??'').trim();
    const norm=normalizarTextoGuiaV55(raw);
    const out=new Set([norm]);
    const nums=(norm.match(/\d+(?:[.,]\d+)?/g)||[]).map(x=>x.replace(',','.'));
    nums.forEach(n=>out.add(String(Number(n))));
    if(nums.length)out.add(nums.join('x'));
    return [...out].filter(Boolean);
}
function tamanhoDaLinhaV55(row={},chart=null){
    const idsPreferidos=[
        'SIZE',String(chart?.main_attribute_id||''),'MANUFACTURER_SIZE','BR_SIZE','AR_SIZE','US_SIZE','UK_SIZE','EU_SIZE',
        'M_BR_SIZE','F_BR_SIZE','KIDS_BR_SIZE','FILTRABLE_SIZE'
    ].filter(Boolean);
    for(const id of idsPreferidos){
        const a=(row.attributes||[]).find(x=>String(x?.id||'')===id);
        if(!a)continue;
        const vals=Array.isArray(a?.values)?a.values:[];
        const val=String(a.value_name||a.value_id||vals[0]?.name||vals[0]?.id||'').trim();
        if(val)return val;
    }
    const a=(row.attributes||[]).find(x=>/SIZE|TAMANHO/i.test(String(x?.id||'')));
    if(!a)return '';
    const vals=Array.isArray(a?.values)?a.values:[];
    return String(a.value_name||a.value_id||vals[0]?.name||vals[0]?.id||'').trim();
}
function extrairRowsChartV55(chart){
    // Algumas respostas do Mercado Livre trazem rows direto no chart e outras
    // podem encapsular a estrutura. Fazemos uma busca recursiva segura para
    // localizar qualquer cole\u00e7\u00e3o real de linhas da tabela de medidas.
    const encontrados=[];
    const vistos=new Set();
    const walk=(node,depth=0)=>{
        if(node==null||depth>8)return;
        if(Array.isArray(node)){
            for(const item of node)walk(item,depth+1);
            return;
        }
        if(typeof node!=='object')return;
        if(vistos.has(node))return; vistos.add(node);
        if(Array.isArray(node.rows)){
            for(const r of node.rows){
                if(r&&typeof r==='object'&&(r.id!=null||r.row_id!=null||Array.isArray(r.attributes)))encontrados.push(r);
            }
        }
        for(const [k,v] of Object.entries(node)){
            if(k==='rows')continue;
            if(v&&typeof v==='object')walk(v,depth+1);
        }
    };
    walk(chart,0);
    const unicos=[]; const seen=new Set();
    for(const r of encontrados){
        const key=String(r?.id??r?.row_id??JSON.stringify(r?.attributes||[]));
        if(seen.has(key))continue; seen.add(key); unicos.push(r);
    }
    return unicos;
}
function valoresTamanhoGuiaV60(chart,row){
    const attrs=Array.isArray(row?.attributes)?row.attributes:[];
    const principais=new Set(['SIZE',String(chart?.main_attribute_id||''),String(chart?.secondary_attribute_id||'')].filter(Boolean));
    const out=[];
    for(const a of attrs){
        const id=String(a?.id||'');
        if(!principais.has(id) && !/(?:^|_)SIZE$|TAMANHO/i.test(id))continue;
        if(['SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(id))continue;
        const values=Array.isArray(a.values)&&a.values.length?a.values:[{id:a.value_id,name:a.value_name,struct:a.value_struct}];
        for(const v of values){
            const name=String(v?.name??(v?.struct?.number!=null?`${v.struct.number} ${v.struct.unit||''}`:'')).trim();
            if(!name)continue;
            out.push({attribute_id:id,value_name:name,...(v?.id!=null&&String(v.id).trim()?{value_id:String(v.id)}:{})});
        }
    }
    return out;
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

function atributoSizeDaLinhaGuiaV60(chart,row){
    const valores=valoresTamanhoGuiaV60(chart,row);
    const principal=valores.find(v=>v.attribute_id==='SIZE')
      || valores.find(v=>v.attribute_id===String(chart?.main_attribute_id||''))
      || valores.find(v=>/(?:^|_)BR_SIZE$/.test(v.attribute_id))
      || valores.find(v=>v.attribute_id!=='FILTRABLE_SIZE');
    if(!principal)return null;
    // IDs de BR_SIZE/US_SIZE n\u00e3o s\u00e3o IDs de SIZE. Copia o ID somente quando
    // veio do pr\u00f3prio atributo SIZE da linha consultada.
    return {id:'SIZE',value_name:principal.value_name,...(principal.attribute_id==='SIZE'&&principal.value_id?{value_id:principal.value_id}:{})};
}

function valoresRowChartV55(chart,row){
    return [...new Set(valoresTamanhoGuiaV60(chart,row).map(v=>v.value_name))];
}
function formatarGridRowIdV55(gridId,row){
    const raw=String(row?.id||row?.row_id||'').trim();
    if(!raw)return '';
    // O Mercado Livre espera o GRID_ROW associado ao guia. Se a API j\u00e1 devolver
    // o valor completo, preservamos; caso contr\u00e1rio prefixamos o ID do guia.
    return raw.includes(':')?raw:`${String(gridId)}:${raw}`;
}
function normalizarGridRowIdV58(gridId,raw){
    const v=String(raw||'').trim();
    if(!v)return '';
    if(v.includes(':'))return v;
    return `${String(gridId)}:${v}`;
}
function linhasValidasGuiaV58(chart,gridId){
    const map=new Map();
    for(const row of extrairRowsChartV55(chart)){
        const full=formatarGridRowIdV55(gridId,row);
        if(!full)continue;
        map.set(full,row);
        const raw=String(row?.id||row?.row_id||'').trim();
        if(raw)map.set(raw,row);
    }
    return map;
}
function rowCompativelV55(chart,row,tamanho){
    return pontuarTamanhoGuiaV60(tamanho,valoresTamanhoGuiaV60(chart,row),String(chart?.main_attribute_id||''))>0;
}
async function obterChartV55(token,chartId){
    const id=String(chartId||'').trim();
    if(!id)return null;
    const r=await mlFetch(`${ML_API}/catalog/charts/${encodeURIComponent(id)}`,token);
    const d=await jsonSeguro(r);
    if(!r.ok){
        const e=new Error(`N\u00e3o foi poss\u00edvel consultar o guia de tamanho ${id}: ${formatarErroMercadoLivre(d)}`);
        e.code='invalid_size_grid';
        throw e;
    }
    return d;
}
function acharRowChartV55(chart,tamanho){
    const candidatas=extrairRowsChartV55(chart).map(row=>({row,score:pontuarTamanhoGuiaV60(tamanho,valoresTamanhoGuiaV60(chart,row),String(chart?.main_attribute_id||''))}))
      .filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
    if(!candidatas.length || (candidatas[1]&&candidatas[0].score===candidatas[1].score))return null;
    return candidatas[0].row;
}
function extrairDomainIdV55(v){
    const s=String(v||'').trim();
    return s.replace(/^MLB-/i,'');
}
async function descobrirDominioV55(token,categoryId,title=''){
    const q=String(title||'').trim();
    if(q){
        try{
            const r=await mlFetch(`${ML_API}/sites/MLB/domain_discovery/search?limit=8&q=${encodeURIComponent(q)}`,token);
            const d=await jsonSeguro(r);
            if(r.ok&&Array.isArray(d)&&d.length){
                const exato=d.find(x=>String(x?.category_id||'')===String(categoryId||''));
                const alvo=exato||d[0];
                if(alvo?.domain_id)return extrairDomainIdV55(alvo.domain_id);
            }
        }catch{}
    }
    return '';
}
function attrsPayloadParaBuscaGuiaV55(payload={},ids=null){
    const filtro=ids?new Set(ids.map(String)):null;
    return (Array.isArray(payload?.attributes)?payload.attributes:[])
      .filter(a=>a?.id && (!filtro||filtro.has(String(a.id))) && (a.value_name||a.value_id))
      .map(a=>({id:String(a.id),values:[{...(a.value_id?{id:String(a.value_id)}:{}),name:String(a.value_name||a.value_id||'')}]}));
}
function extrairGridTemplateRequiredV55(payload){
    const ids=[]; const seen=new Set();
    const walk=node=>{
        if(!node)return;
        if(Array.isArray(node)){node.forEach(walk);return;}
        if(typeof node!=='object')return;
        if(Array.isArray(node.attributes)){
            for(const a of node.attributes){
                const tags=Array.isArray(a?.tags)?a.tags:Object.keys(a?.tags||{}).filter(k=>a.tags[k]);
                if(tags.map(String).includes('grid_template_required')){
                    const id=String(a?.id||''); if(id&&!seen.has(id)){seen.add(id);ids.push(id);}
                }
            }
        }
        if(Array.isArray(node.groups))node.groups.forEach(walk);
        if(Array.isArray(node.components))node.components.forEach(walk);
        if(Array.isArray(node.content))node.content.forEach(walk);
        if(node.input)walk(node.input);
    };
    walk(payload); return ids;
}
async function buscarChartsAutomaticosV55(token,{domainId,sellerId,payload}){
    if(!domainId||!sellerId)return [];
    let required=[];
    try{
        const tr=await mlFetch(`${ML_API}/domains/MLB-${encodeURIComponent(domainId)}/technical_specs`,token);
        const td=await jsonSeguro(tr);
        if(tr.ok)required=extrairGridTemplateRequiredV55(td);
    }catch{}
    const tentativas=[];
    const attrsReq=attrsPayloadParaBuscaGuiaV55(payload,required);
    if(attrsReq.length)tentativas.push(attrsReq);
    const attrsBG=attrsPayloadParaBuscaGuiaV55(payload,['BRAND','GENDER']);
    if(attrsBG.length)tentativas.push(attrsBG);
    tentativas.push([]);
    const seenBody=new Set();
    for(const attributes of tentativas){
        const sig=JSON.stringify(attributes); if(seenBody.has(sig))continue; seenBody.add(sig);
        const body={domain_id:domainId,site_id:'MLB',seller_id:Number(sellerId),attributes};
        const r=await mlFetch(`${ML_API}/catalog/charts/search?offset=0&limit=100`,token,{method:'POST',headers:{'Content-Type':'application/json','x-caller-id':String(sellerId)},body:JSON.stringify(body)});
        const d=await jsonSeguro(r);
        if(r.ok&&Array.isArray(d?.charts)&&d.charts.length)return d.charts;
        if(Number(r.status)===400 && String(d?.error||'')==='domain_not_active')return [];
    }
    return [];
}
async function resolverGuiaAutomaticoV55(token,payload,cfg,opts={}){
    const varCfg=cfg?.variations||{};
    if(!varCfg?.enabled)return null;
    const rowsCfg=normalizarLinhasVariacaoV53(varCfg);
    const tamanhos=[...new Set(rowsCfg.map(r=>tamanhoDaLinhaV55(r)).filter(Boolean))];
    const manual=String(varCfg?.size_grid_id||cfg?.size_grid_id||'').trim();
    if(!tamanhos.length&&!manual)return null;
    if(manual){
        // V58: o c\u00f3digo do guia informado continua tendo prioridade, por\u00e9m as linhas
        // NUNCA s\u00e3o aceitas cegamente. Consultamos o chart real para garantir que
        // SIZE_GRID_ROW_ID perten\u00e7a ao SIZE_GRID_ID e ao tamanho escolhido.
        let chart=opts.sizeGuideCacheV60?.get(manual);
        if(!chart){chart=await obterChartV55(token,manual);opts.sizeGuideCacheV60?.set(manual,chart);}
        const hits=tamanhos.filter(t=>acharRowChartV55(chart,t)).length;
        return {gridId:String(chart?.id||manual),chart,hits,source:hits?'manual-compatible':'manual-guide'};
    }

    const title=String(cfg?.titles?.[Number(opts.familyIndex||0)]||cfg?.product_name||'').trim();
    const domainId=await descobrirDominioV55(token,opts?.category?.category_id||payload?.category_id,title);
    if(!domainId)return null;
    const charts=await buscarChartsAutomaticosV55(token,{domainId,sellerId:opts?.sellerId,payload});
    if(!charts.length)return null;

    const generica=normalizarTextoGuiaV55((payload.attributes||[]).find(a=>String(a.id)==='BRAND')?.value_name||'').includes('generica');
    const ordenados=[...charts].sort((a,b)=>{
        const rank=c=>{
            const type=String(c?.type||'').toUpperCase();
            if(generica)return type==='STANDARD'?30:type==='SPECIFIC'?20:type==='BRAND'?10:0;
            return type==='BRAND'?30:type==='SPECIFIC'?25:type==='STANDARD'?20:0;
        };
        return rank(b)-rank(a);
    });

    let melhor=null;
    for(const c of ordenados.slice(0,20)){
        try{
            const chart=await obterChartV55(token,c.id);
            const hits=tamanhos.filter(t=>acharRowChartV55(chart,t)).length;
            if(!melhor||hits>melhor.hits)melhor={gridId:String(chart?.id||c.id),chart,hits,source:'automatic-search'};
            if(hits===tamanhos.length)return melhor;
        }catch{}
    }
    return melhor?.hits?melhor:null;
}
async function aplicarGuiaTamanhoV55(token,payload,cfg,opts={}){
    const varCfg=cfg?.variations||{};
    if(!varCfg?.enabled)return payload;
    const rowsCfg=normalizarLinhasVariacaoV53(varCfg);
    const manualGrid=String(varCfg?.size_grid_id||cfg?.size_grid_id||'').trim();
    if(!rowsCfg.some(r=>tamanhoDaLinhaV55(r)||r.size_grid_row_id)&&!manualGrid)return payload;
    const resolvido=await resolverGuiaAutomaticoV55(token,payload,cfg,opts);
    if(!resolvido)return payload;
    const gridId=String(resolvido.gridId||manualGrid);
    const chart=resolvido.chart;
    const linhasValidas=linhasValidasGuiaV58(chart,gridId);
    const pushUnique=(arr,obj)=>{
        const i=arr.findIndex(x=>String(x?.id||'')===String(obj.id));
        if(i>=0)arr[i]=obj;else arr.push(obj);
    };
    // Resolve TODAS as linhas, mesmo quando a conta publica um item por varia\u00e7\u00e3o.
    const resolvidas=rowsCfg.map((row,i)=>{
        const tamanho=tamanhoDaLinhaV55(row,chart);
        const raw=String(row.size_grid_row_id||'');
        let linha=linhasValidas.get(normalizarGridRowIdV58(gridId,raw))||linhasValidas.get(raw);
        if(linha&&tamanho&&!rowCompativelV55(chart,linha,tamanho))linha=null;
        if(!linha&&tamanho)linha=acharRowChartV55(chart,tamanho);
        const rowId=linha?formatarGridRowIdV55(gridId,linha):'';
        const size=linha?atributoSizeDaLinhaGuiaV60(chart,linha):null;
        if(!rowId||!size){
            const e=new Error(`Guia ${gridId}: a varia\u00e7\u00e3o ${i+1} (tamanho ${tamanho||'n\u00e3o informado'}) n\u00e3o corresponde a uma linha \u00fanica e v\u00e1lida. Escolha uma numera\u00e7\u00e3o existente nesse guia.`);
            e.code='missing_size_grid_row';throw e;
        }
        const attributes=(row.attributes||[]).filter(a=>!['SIZE','SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(String(a.id)));
        attributes.push(size);
        return {...row,size_grid_row_id:rowId,attributes,size};
    });
    // Usa os valores can\u00f4nicos tamb\u00e9m na valida\u00e7\u00e3o de campos obrigat\u00f3rios e
    // duplicidade, evitando rejeitar "34" quando a ficha exige "34 BR".
    opts.variationsConfigV60={...varCfg,rows:resolvidas};
    payload.attributes=Array.isArray(payload.attributes)?payload.attributes:[];
    pushUnique(payload.attributes,{id:'SIZE_GRID_ID',value_name:gridId});
    if(opts.userProductSeller){
        const row=resolvidas[Number(opts.variationIndex||0)]||resolvidas[0];
        pushUnique(payload.attributes,{...row.size});
        pushUnique(payload.attributes,{id:'SIZE_GRID_ROW_ID',value_name:row.size_grid_row_id});
    }else if(Array.isArray(payload.variations)){
        // No modelo legado SIZE fica na combina\u00e7\u00e3o e ROW_ID nos atributos da
        // pr\u00f3pria varia\u00e7\u00e3o, sem um tamanho \u00fanico conflitante no n\u00edvel do item.
        payload.attributes=payload.attributes.filter(a=>!['SIZE','SIZE_GRID_ROW_ID'].includes(String(a.id)));
        payload.variations=payload.variations.map((v,i)=>{
            const row=resolvidas[i];
            const combinations=(v.attribute_combinations||[]).filter(a=>!['SIZE','SIZE_GRID_ID','SIZE_GRID_ROW_ID'].includes(String(a.id)));
            pushUnique(combinations,{...row.size});
            const attrs=(v.attributes||[]).filter(a=>String(a.id)!=='SIZE');
            pushUnique(attrs,{id:'SIZE_GRID_ROW_ID',value_name:row.size_grid_row_id});
            return {...v,attribute_combinations:combinations,attributes:attrs};
        });
    }
    return payload;
}

function montarPayloadPublicacaoV37(cfg,{familyIndex=0,variationIndex=0,userProductSeller=false,category}){
    const title=limitarTituloV36(cfg.titles?.[familyIndex]||cfg.family_name||cfg.product_name||'',60);
    const price=Number(cfg.price||0);
    const stock=Math.max(1,Number(cfg.stock||1));
    const pictureIds=(Array.isArray(cfg.picture_ids)?cfg.picture_ids:[]).map(String).filter(Boolean);
    const manualPictureSources=normalizarUrlsManuaisV47(cfg.picture_sources_manual||cfg.manual_picture_urls||[]);
    const pictures=manualPictureSources.length?manualPictureSources.map(source=>({source})):pictureIds.map(id=>({id}));

    let attributes=(Array.isArray(category?.attributes)?category.attributes:[])
      .filter(a=>a?.id && (a?.value_id || a?.value_name || a?.value_name===null))
      .map(a=>({id:String(a.id),...(a.value_id?{value_id:String(a.value_id)}:{}),...(String(a.value_id||'')==='-1'?{value_name:null}:(a.value_name?{value_name:String(a.value_name)}:{}))}));

    const varCfg=cfg.variations||{};
    const varRows=normalizarLinhasVariacaoV53(varCfg);
    const idsVariacao=new Set(varRows.flatMap(r=>(r.attributes||[]).map(a=>String(a.id))));
    if(varCfg.enabled&&idsVariacao.size)attributes=attributes.filter(a=>!idsVariacao.has(String(a.id)));

    const rowSelecionada=varRows[variationIndex]||varRows[0]||null;
    if(userProductSeller&&varCfg.enabled&&rowSelecionada){
        for(const a of (rowSelecionada.attributes||[]))attributes.push({...a,id:String(a.id)});
    }

    const base={
        category_id:String(category?.category_id||cfg.category_id||''),
        price,
        currency_id:'BRL',
        available_quantity:userProductSeller&&rowSelecionada?.stock!=null?Math.max(1,Number(rowSelecionada.stock||1)):stock,
        buying_mode:'buy_it_now',
        channels:['marketplace'],
        listing_type_id:String(cfg.listing_type_id||'gold_special'),
        condition:String(cfg.condition||'new'),
        pictures,
        attributes,
        sale_terms:montarSaleTermsV51(cfg)
    };

    const skuPrefix=String(cfg.sku_prefix||'').trim();
    const catKey=String(category?.category_id||'').replace(/[^a-zA-Z0-9]/g,'').slice(-6);
    const familySku=skuPrefix?`${skuPrefix}-${catKey}-${String(familyIndex+1).padStart(5,'0')}`:'';

    if(userProductSeller){
        base.family_name=title;
        if(familySku){
            const suffix=String(rowSelecionada?.sku_suffix||'').trim();
            const skuVariacao=suffix?`${familySku}-${suffix}`:`${familySku}-${String(variationIndex+1).padStart(2,'0')}`;
            // Fluxo atual do Mercado Livre: SKU deve ser enviado como atributo SELLER_SKU.
            base.attributes=base.attributes.filter(a=>String(a.id)!=='SELLER_SKU');
            base.attributes.push({id:'SELLER_SKU',value_name:skuVariacao});
        }
    }else{
        base.title=title;
        if(familySku)base.seller_custom_field=familySku;
        if(varCfg.enabled&&varRows.length){
            base.available_quantity=varRows.reduce((sum,r)=>sum+Math.max(1,Number(r.stock==null?stock:r.stock||1)),0);
            base.variations=varRows.map((row,i)=>({
                attribute_combinations:(row.attributes||[]).map(a=>({id:String(a.id),...(a.value_id?{value_id:String(a.value_id)}:{}),...(a.value_name?{value_name:String(a.value_name)}:{})})),
                price,
                available_quantity:Math.max(1,Number(row.stock==null?stock:row.stock||1)),
                ...(pictureIds.length?{picture_ids:pictureIds}:{}),
                ...(familySku?{seller_custom_field:`${familySku}-${String(row.sku_suffix||'').trim()||String(i+1).padStart(2,'0')}`}:{})
            }));
        }
    }
    return base;
}

async function processarCriacaoMassaV37(job){
    const token=await obterTokenPersistenteParaSeller(job.seller_id);
    if(!token)throw new Error('Token Mercado Livre indispon\u00edvel para criar an\u00fancios.');

    const cfg=job.payload?.config||{};
    const categories=normalizarCategoriasConfigV37(cfg);
    if(!categories.length)throw new Error('Nenhuma categoria foi configurada para a cria\u00e7\u00e3o em massa.');

    const meRes=await mlFetch(`${ML_API}/users/me`,token);
    const me=await jsonSeguro(meRes);
    if(!meRes.ok)throw new Error(formatarErroMercadoLivre(me));

    const userProductSeller=Array.isArray(me?.tags)&&me.tags.includes('user_product_seller');
    const families=Math.max(1,Number(cfg.quantity||cfg.titles?.length||1));
    const varRows=normalizarLinhasVariacaoV53(cfg?.variations||{});
    const varCount=quantidadeVariacoesV53(cfg,userProductSeller);
    const perCategory=families*varCount;
    const total=categories.length*perCategory;

    let seq=Math.max(0,Number(job.cursor||0));
    let sucessos=Number(job.result?.success||0);
    let erros=Number(job.errors||0);

    while(seq<total){
        const existing=await dbQuery(`SELECT success FROM ml_mass_create_results WHERE job_id=$1 AND seq=$2`,[job.id,seq]);
        if(existing.rows.length){seq++;continue;}

        const categoryIndex=Math.floor(seq/perCategory);
        const rem=seq%perCategory;
        const familyIndex=Math.floor(rem/varCount);
        const variationIndex=rem%varCount;
        const category=categories[categoryIndex];
        const prepared=await prepararPayloadPublicacaoV46(token,cfg,{familyIndex,variationIndex,userProductSeller,category,sellerId:job.seller_id});
        const payload=prepared.payload;
        const titleRequested=String(cfg.titles?.[familyIndex]||cfg.product_name||'');

        if(prepared.faltantes.length){
            const msg=`Faltam caracter\u00edsticas obrigat\u00f3rias: ${prepared.faltantes.map(x=>x.name).join(', ')}`;
            await gravarResultadoCriacaoV36(job.id,job.seller_id,{
                seq,family_seq:familyIndex,variation_seq:variationIndex,
                title_requested:`[${category.category_name}] ${titleRequested}`,
                success:false,message:msg,technical_message:msg
            });
            erros++;
            seq++;
            continue;
        }

        const pr=await publicarPayloadMercadoComFallbackEnvioV50(token,payload,prepared.shippingInfo);
        if(pr?.ok && pr?.data?.id){
            let warning='';
            const item=pr.data;
            if(cfg.description){
                const dr=await mlPostComRetryV36(`${ML_API}/items/${encodeURIComponent(item.id)}/description`,token,{plain_text:String(cfg.description).slice(0,50000)},3);
                if(!dr?.ok)warning='An\u00fancio criado, mas a descri\u00e7\u00e3o n\u00e3o foi adicionada: '+formatarErroMercadoLivre(dr?.data);
            }
            await gravarResultadoCriacaoV36(job.id,job.seller_id,{
                seq,
                family_seq:familyIndex,
                variation_seq:variationIndex,
                title_requested:`[${category.category_name}] ${titleRequested}`,
                item_id:item.id,
                permalink:item.permalink||'',
                success:true,
                message:warning||`An\u00fancio criado com sucesso na categoria ${category.category_name}.`
            });
            await upsertItensDb(job.seller_id,[item]);
            sucessos++;
        }else{
            const tecnico=formatarErroMercadoLivre(pr?.data)||`HTTP ${pr?.status||500}`;
            await gravarResultadoCriacaoV36(job.id,job.seller_id,{
                seq,
                family_seq:familyIndex,
                variation_seq:variationIndex,
                title_requested:`[${category.category_name}] ${titleRequested}`,
                success:false,
                message:`O Mercado Livre recusou a cria\u00e7\u00e3o deste an\u00fancio na categoria ${category.category_name}. Revise os campos obrigat\u00f3rios da categoria e os detalhes exibidos.`,
                technical_message:tecnico
            });
            erros++;
        }

        seq++;
        const pct=Math.round((seq/total)*100);
        await dbQuery(`
          UPDATE ml_jobs SET
            processed=$2,
            progress_current=$2,
            progress_total=$3,
            errors=$4,
            cursor=$5,
            result=$6::jsonb,
            message=$7,
            updated_at=NOW()
          WHERE id=$1
        `,[job.id,seq,total,erros,String(seq),JSON.stringify({success:sucessos,failed:erros,mode:userProductSeller?'user_products':'legacy',families,categories:categories.length,items_total:total}),`Cria\u00e7\u00e3o em massa: ${seq.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} \u00b7 ${pct}% \u00b7 ${sucessos.toLocaleString('pt-BR')} criado(s)`]);

        await esperarV35(180);
    }

    await dbQuery(`
      UPDATE ml_jobs SET
        status='completed',
        cursor=NULL,
        processed=$2,
        progress_current=$2,
        progress_total=$3,
        errors=$4,
        result=$5::jsonb,
        message=$6,
        finished_at=NOW(),
        updated_at=NOW()
      WHERE id=$1
    `,[job.id,total,total,erros,JSON.stringify({success:sucessos,failed:erros,mode:userProductSeller?'user_products':'legacy',families,categories:categories.length,items_total:total}),`Cria\u00e7\u00e3o conclu\u00edda: ${sucessos.toLocaleString('pt-BR')} item(ns) criado(s), ${erros.toLocaleString('pt-BR')} falha(s).`]);
}
async function mlPostComRetryV36(url,token,body,maxTentativas=4){
    let ultimo=null;
    for(let tentativa=1;tentativa<=maxTentativas;tentativa++){
        const r=await mlFetch(url,token,{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(body)
        });
        const d=await jsonSeguro(r);

        if(r.ok)return {ok:true,status:r.status,data:d,tentativa};

        ultimo={ok:false,status:r.status,data:d,tentativa};
        if(![408,429,500,502,503,504].includes(r.status))return ultimo;

        const retryAfter=Number(r.headers.get('retry-after')||0);
        const espera=retryAfter>0
          ? Math.min(20000,retryAfter*1000)
          : Math.min(12000,900*Math.pow(2,tentativa-1)+Math.floor(Math.random()*500));
        await esperarV35(espera);
    }
    return ultimo;
}

function montarPayloadPublicacaoV36(cfg,{familyIndex=0,variationIndex=0,userProductSeller=false}={}){
    const title=limitarTituloV36(cfg.titles?.[familyIndex]||cfg.family_name||cfg.product_name||'',60);
    const price=Number(cfg.price||0);
    const stock=Math.max(1,Number(cfg.stock||1));
    const pictureIds=(Array.isArray(cfg.picture_ids)?cfg.picture_ids:[]).map(String).filter(Boolean);
    const pictures=pictureIds.map(id=>({id}));

    let attributes=(Array.isArray(cfg.attributes)?cfg.attributes:[])
      .filter(a=>a?.id && (a?.value_id || a?.value_name))
      .map(a=>({
          id:String(a.id),
          ...(a.value_id?{value_id:String(a.value_id)}:{}),
          ...(a.value_name?{value_name:String(a.value_name)}:{})
      }));

    const varCfg=cfg.variations||{};
    const varValues=Array.isArray(varCfg.values)?varCfg.values.map(String).filter(Boolean):[];

    if(userProductSeller && varCfg.enabled && varValues.length){
        const value=varValues[variationIndex%varValues.length];
        attributes=attributes.filter(a=>String(a.id)!==String(varCfg.attribute_id));
        attributes.push({
            id:String(varCfg.attribute_id),
            value_name:value
        });
    }

    const base={
        category_id:String(cfg.category_id),
        price,
        currency_id:'BRL',
        available_quantity:stock,
        buying_mode:'buy_it_now',
        listing_type_id:String(cfg.listing_type_id||'gold_special'),
        condition:String(cfg.condition||'new'),
        pictures,
        attributes
    };

    if(userProductSeller){
        base.family_name=title;
    }else{
        base.title=title;

        const skuPrefix=String(cfg.sku_prefix||'').trim();
        if(skuPrefix){
            base.seller_custom_field=`${skuPrefix}-${String(familyIndex+1).padStart(5,'0')}`;
        }

        if(varCfg.enabled && varValues.length){
            const qtd=Math.min(
                Math.max(1,Number(varCfg.count||varValues.length)),
                varValues.length
            );

            base.available_quantity=stock*qtd;
            base.variations=varValues.slice(0,qtd).map((value,i)=>({
                attribute_combinations:[{
                    id:String(varCfg.attribute_id),
                    value_name:String(value)
                }],
                price,
                available_quantity:stock,
                picture_ids:pictureIds,
                ...(skuPrefix?{
                    seller_custom_field:`${skuPrefix}-${String(familyIndex+1).padStart(5,'0')}-${String(i+1).padStart(2,'0')}`
                }:{})
            }));
        }
    }

    return base;
}

async function gravarResultadoCriacaoV36(jobId,sellerId,row){
    await dbQuery(`
      INSERT INTO ml_mass_create_results(
        job_id,seller_id,seq,family_seq,variation_seq,title_requested,
        item_id,permalink,success,message,technical_message
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT(job_id,seq) DO UPDATE SET
        item_id=EXCLUDED.item_id,
        permalink=EXCLUDED.permalink,
        success=EXCLUDED.success,
        message=EXCLUDED.message,
        technical_message=EXCLUDED.technical_message
    `,[
        jobId,sellerId,row.seq,row.family_seq,row.variation_seq,row.title_requested,
        row.item_id||null,row.permalink||null,Boolean(row.success),
        String(row.message||''),String(row.technical_message||'')
    ]);
}

async function processarCriacaoMassaV36(job){
    const token=await obterTokenPersistenteParaSeller(job.seller_id);
    if(!token)throw new Error('Token Mercado Livre indispon\u00edvel para criar an\u00fancios.');

    const cfg=job.payload?.config||{};
    const meRes=await mlFetch(`${ML_API}/users/me`,token);
    const me=await jsonSeguro(meRes);
    if(!meRes.ok)throw new Error(formatarErroMercadoLivre(me));

    const userProductSeller=Array.isArray(me?.tags)&&me.tags.includes('user_product_seller');
    const families=Math.max(1,Number(cfg.quantity||cfg.titles?.length||1));
    const varValues=Array.isArray(cfg?.variations?.values)?cfg.variations.values.filter(Boolean):[];
    const varCount=(cfg?.variations?.enabled && userProductSeller)
      ? Math.min(Math.max(1,Number(cfg.variations.count||varValues.length||1)),Math.max(1,varValues.length))
      : 1;

    const total=families*varCount;
    let seq=Math.max(0,Number(job.cursor||0));
    let sucessos=Number(job.result?.success||0);
    let erros=Number(job.errors||0);

    while(seq<total){
        const existing=await dbQuery(
            `SELECT success FROM ml_mass_create_results WHERE job_id=$1 AND seq=$2`,
            [job.id,seq]
        );
        if(existing.rows.length){
            seq++;
            continue;
        }

        const familyIndex=Math.floor(seq/varCount);
        const variationIndex=seq%varCount;
        const payload=montarPayloadPublicacaoV36(cfg,{
            familyIndex,
            variationIndex,
            userProductSeller
        });

        const titleRequested=String(cfg.titles?.[familyIndex]||cfg.product_name||'');
        const pr=await mlPostComRetryV36(`${ML_API}/items`,token,payload,4);

        if(pr?.ok && pr?.data?.id){
            let warning='';
            const item=pr.data;

            if(cfg.description){
                const dr=await mlPostComRetryV36(
                    `${ML_API}/items/${encodeURIComponent(item.id)}/description`,
                    token,
                    {plain_text:String(cfg.description).slice(0,50000)},
                    3
                );
                if(!dr?.ok){
                    warning='An\u00fancio criado, mas a descri\u00e7\u00e3o n\u00e3o foi adicionada: '+formatarErroMercadoLivre(dr?.data);
                }
            }

            await gravarResultadoCriacaoV36(job.id,job.seller_id,{
                seq,
                family_seq:familyIndex,
                variation_seq:variationIndex,
                title_requested:titleRequested,
                item_id:item.id,
                permalink:item.permalink||'',
                success:true,
                message:warning||'An\u00fancio criado com sucesso.'
            });

            await upsertItensDb(job.seller_id,[item]);
            sucessos++;
        }else{
            const tecnico=formatarErroMercadoLivre(pr?.data)||`HTTP ${pr?.status||500}`;
            await gravarResultadoCriacaoV36(job.id,job.seller_id,{
                seq,
                family_seq:familyIndex,
                variation_seq:variationIndex,
                title_requested:titleRequested,
                success:false,
                message:'O Mercado Livre recusou a cria\u00e7\u00e3o deste an\u00fancio. Revise os campos obrigat\u00f3rios da categoria e os detalhes exibidos.',
                technical_message:tecnico
            });
            erros++;
        }

        seq++;
        const pct=Math.round((seq/total)*100);

        await dbQuery(`
          UPDATE ml_jobs SET
            processed=$2,
            progress_current=$2,
            progress_total=$3,
            errors=$4,
            cursor=$5,
            result=$6::jsonb,
            message=$7,
            updated_at=NOW()
          WHERE id=$1
        `,[
            job.id,seq,total,erros,String(seq),
            JSON.stringify({
                success:sucessos,
                failed:erros,
                mode:userProductSeller?'user_products':'legacy',
                families,
                items_total:total
            }),
            `Cria\u00e7\u00e3o em massa: ${seq.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} \u00b7 ${pct}% \u00b7 ${sucessos.toLocaleString('pt-BR')} criado(s)`
        ]);

        // Publica\u00e7\u00e3o \u00e9 naturalmente limitada pela API; pequena pausa reduz picos.
        await esperarV35(180);
    }

    await dbQuery(`
      UPDATE ml_jobs SET
        status='completed',
        cursor=NULL,
        processed=$2,
        progress_current=$2,
        progress_total=$3,
        errors=$4,
        result=$5::jsonb,
        message=$6,
        finished_at=NOW(),
        updated_at=NOW()
      WHERE id=$1
    `,[
        job.id,total,total,erros,
        JSON.stringify({
            success:sucessos,
            failed:erros,
            mode:userProductSeller?'user_products':'legacy',
            families,
            items_total:total
        }),
        `Cria\u00e7\u00e3o conclu\u00edda: ${sucessos.toLocaleString('pt-BR')} item(ns) criado(s), ${erros.toLocaleString('pt-BR')} falha(s).`
    ]);
}


async function pausarUmItemV103(token,id){
    let ultimo=null;

    for(let tentativa=1;tentativa<=5;tentativa++){
        try{
            const r=await mlFetch(
              `${ML_API}/items/${encodeURIComponent(id)}`,
              token,
              {
                method:'PUT',
                headers:{
                    'Content-Type':'application/json',
                    Accept:'application/json'
                },
                body:JSON.stringify({status:'paused'})
              }
            );
            const d=await jsonSeguro(r);

            if(r.ok){
                return {
                    id:String(id),
                    sucesso:true,
                    status:r.status,
                    tentativa
                };
            }

            const msg=formatarErroMercadoLivre(d)||`HTTP ${r.status}`;
            ultimo={status:r.status,msg};

            if(!erroTemporarioHttpV103(r.status,msg) || tentativa>=5){
                return {
                    id:String(id),
                    sucesso:false,
                    status:r.status,
                    erro:msg,
                    tentativa
                };
            }

            const retryAfter=Number(r.headers.get('retry-after')||0);
            await sleepV103(
              retryAfter>0
                ?Math.min(15000,retryAfter*1000)
                :Math.min(12000,jitterV103(500*Math.pow(2,tentativa-1)))
            );
        }catch(e){
            ultimo={status:0,msg:e.message};
            if(tentativa>=5 || !erroTemporarioHttpV103(0,e.message)){
                return {
                    id:String(id),
                    sucesso:false,
                    status:0,
                    erro:String(e.message||e),
                    tentativa
                };
            }
            await sleepV103(Math.min(12000,jitterV103(500*Math.pow(2,tentativa-1))));
        }
    }

    return {
        id:String(id),
        sucesso:false,
        status:Number(ultimo?.status||0),
        erro:String(ultimo?.msg||'Falha ao pausar anúncio.')
    };
}

async function processarPausaMassaV103(job){
    const token=await obterTokenPersistenteParaSeller(job.seller_id);
    if(!token)throw new Error('Token Mercado Livre indisponível para pausar anúncios.');

    const payload=job.payload||{};
    const mode=String(payload.mode||'all').toLowerCase();
    const value=String(payload.value||'').trim();

    if(!['all','sku','mlb'].includes(mode)){
        throw new Error('Modo de pausa inválido.');
    }

    const paramsBase=[job.seller_id];
    let where=`seller_id=$1 AND status='active'`;

    if(mode==='sku'){
        paramsBase.push(value.toLowerCase());
        where+=` AND lower(COALESCE(sku,''))=$${paramsBase.length}`;
    }else if(mode==='mlb'){
        paramsBase.push(value.toUpperCase());
        where+=` AND upper(item_id)=$${paramsBase.length}`;
    }

    const totalR=await dbQuery(
      `SELECT COUNT(*)::int total FROM ml_items WHERE ${where}`,
      paramsBase
    );
    const total=Number(totalR.rows[0]?.total||0);

    let cursor=String(job.cursor||'');
    let processados=Number(job.processed||0);
    let erros=Number(job.errors||0);
    let sucessos=Math.max(0,processados-erros);
    let concorrencia=Math.max(3,Math.min(16,Number(payload.concurrency||8)));

    await dbQuery(`
      UPDATE ml_jobs SET
        progress_total=$2,
        progress_current=$3,
        message=$4,
        updated_at=NOW()
      WHERE id=$1
    `,[
      job.id,
      total,
      processados,
      `Pausa em massa: ${processados.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · concorrência ${concorrencia}`
    ]);

    await registrarEventoJobV103(
      job.id,
      job.seller_id,
      'info',
      'pause_started',
      'Pausa em massa iniciada.',
      {mode,value,total,concorrencia}
    );

    const LOTE_DB=500;

    while(true){
        const controle=await estadoJobV103(job.id);
        if(!controle)return;

        if(controle.status==='paused'){
            await registrarEventoJobV103(
              job.id,job.seller_id,'info','pause_paused',
              'Job pausado pelo usuário.',
              {processados,total}
            );
            return;
        }

        if(controle.status==='cancelled'){
            await registrarEventoJobV103(
              job.id,job.seller_id,'info','pause_cancelled',
              'Job cancelado pelo usuário.',
              {processados,total}
            );
            return;
        }

        const params=[...paramsBase];
        params.push(cursor);
        const cursorPos=params.length;
        params.push(LOTE_DB);
        const limitPos=params.length;

        const r=await dbQuery(`
          SELECT item_id
          FROM ml_items
          WHERE ${where}
            AND ($${cursorPos}::text='' OR item_id>$${cursorPos})
          ORDER BY item_id
          LIMIT $${limitPos}
        `,params);

        const ids=r.rows.map(x=>String(x.item_id));
        if(!ids.length)break;

        let posicao=0;
        const pausadosLote=[];
        const falhasLote=[];

        while(posicao<ids.length){
            const grupo=ids.slice(posicao,posicao+concorrencia);
            const respostas=await Promise.all(
              grupo.map(id=>pausarUmItemV103(token,id))
            );

            let teve429=false;
            let teveTemporario=false;

            for(const rr of respostas){
                processados++;
                if(rr.sucesso){
                    sucessos++;
                    pausadosLote.push(String(rr.id));
                }else{
                    erros++;
                    falhasLote.push(rr);
                    if(Number(rr.status)===429)teve429=true;
                    if(erroTemporarioHttpV103(rr.status,rr.erro))teveTemporario=true;
                }
            }

            if(teve429){
                concorrencia=Math.max(2,Math.floor(concorrencia/2));
                await sleepV103(jitterV103(1600));
            }else if(teveTemporario){
                concorrencia=Math.max(3,concorrencia-1);
                await sleepV103(jitterV103(700));
            }else if(concorrencia<16){
                concorrencia++;
            }

            posicao+=grupo.length;
        }

        if(pausadosLote.length){
            await dbQuery(`
              UPDATE ml_items
              SET status='paused',
                  synced_at=NOW(),
                  ml_updated_at=COALESCE(ml_updated_at,NOW())
              WHERE seller_id=$1
                AND item_id=ANY($2::text[])
            `,[job.seller_id,pausadosLote]);
        }

        cursor=String(ids[ids.length-1]||cursor);

        const result={
            success:sucessos,
            failed:erros,
            concurrency:concorrencia,
            mode,
            value,
            last_failures:falhasLote.slice(-25)
        };

        await dbQuery(`
          UPDATE ml_jobs SET
            cursor=$2,
            processed=$3,
            progress_current=$3,
            progress_total=$4,
            errors=$5,
            result=$6::jsonb,
            message=$7,
            updated_at=NOW()
          WHERE id=$1
        `,[
          job.id,
          cursor,
          processados,
          total,
          erros,
          JSON.stringify(result),
          `Pausa em massa: ${processados.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · ${sucessos.toLocaleString('pt-BR')} pausados · ${erros.toLocaleString('pt-BR')} falhas · concorrência ${concorrencia}`
        ]);

        if(falhasLote.length){
            await registrarEventoJobV103(
              job.id,
              job.seller_id,
              'warn',
              'pause_batch_failures',
              `${falhasLote.length} falha(s) no lote.`,
              {falhas:falhasLote.slice(-25)}
            );
        }

        await sleepV103(40);
    }

    await dbQuery(`
      UPDATE ml_jobs SET
        status='completed',
        processed=$2,
        progress_current=$3,
        progress_total=$3,
        errors=$4,
        cursor=NULL,
        result=$5::jsonb,
        message=$6,
        finished_at=NOW(),
        updated_at=NOW()
      WHERE id=$1
    `,[
      job.id,
      processados,
      total,
      erros,
      JSON.stringify({
        success:sucessos,
        failed:erros,
        mode,
        value
      }),
      `Pausa concluída: ${sucessos.toLocaleString('pt-BR')} anúncio(s) pausado(s), ${erros.toLocaleString('pt-BR')} falha(s).`
    ]);

    await registrarEventoJobV103(
      job.id,
      job.seller_id,
      'info',
      'pause_completed',
      'Pausa em massa concluída.',
      {success:sucessos,failed:erros,total}
    );
}

app.post('/api/v103/anuncios/pausar-job',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');
    if(!db)return respostaErro(res,503,'PostgreSQL indisponível. A pausa em massa de escala precisa do banco.');

    try{
        const me=await usuarioML(token);
        const mode=String(req.body?.mode||'all').trim().toLowerCase();
        const value=String(req.body?.value||'').trim();

        if(!['all','sku','mlb'].includes(mode)){
            return respostaErro(res,400,'Modo de pausa inválido.');
        }
        if(mode!=='all'&&!value){
            return respostaErro(res,400,'Informe o SKU ou MLB.');
        }
        if(mode==='mlb'&&!/^MLB\d+$/i.test(value)){
            return respostaErro(res,400,'Informe um MLB válido.');
        }

        const p=[me.id];
        let where=`seller_id=$1 AND status='active'`;
        if(mode==='sku'){
            p.push(value.toLowerCase());
            where+=` AND lower(COALESCE(sku,''))=$${p.length}`;
        }else if(mode==='mlb'){
            p.push(value.toUpperCase());
            where+=` AND upper(item_id)=$${p.length}`;
        }

        const c=await dbQuery(
          `SELECT COUNT(*)::int total FROM ml_items WHERE ${where}`,
          p
        );
        const total=Number(c.rows[0]?.total||0);

        if(!total){
            return respostaErro(res,404,'Nenhum anúncio ativo corresponde a esse filtro.');
        }

        const job=await criarJob(
          me.id,
          'pause_mass_v103',
          {
            mode,
            value,
            concurrency:8,
            created_from:'ml_hub_pro_v103'
          }
        );

        await dbQuery(`
          UPDATE ml_jobs SET
            progress_total=$2,
            message=$3,
            updated_at=NOW()
          WHERE id=$1
        `,[
          job.id,
          total,
          `Na fila para pausar ${total.toLocaleString('pt-BR')} anúncio(s).`
        ]);

        res.status(202).json({
            sucesso:true,
            job:{...job,progress_total:total},
            total
        });
    }catch(e){
        respostaErro(res,500,'Erro ao criar job de pausa: '+e.message);
    }
});

app.post('/api/v103/jobs/:id/action',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');
    if(!db)return respostaErro(res,503,'PostgreSQL indisponível.');

    try{
        const me=await usuarioML(token);
        const action=String(req.body?.action||'').toLowerCase();

        const q=await dbQuery(`
          SELECT * FROM ml_jobs
          WHERE id=$1 AND seller_id=$2
          LIMIT 1
        `,[req.params.id,me.id]);

        const job=q.rows[0];
        if(!job)return respostaErro(res,404,'Processo não encontrado.');

        if(job.type!=='pause_mass_v103'){
            return respostaErro(
              res,
              409,
              'Este processo ainda não suporta controle manual nesta versão.'
            );
        }

        let status=null;
        if(action==='pause' && ['queued','running'].includes(job.status))status='paused';
        if(action==='resume' && ['paused','failed'].includes(job.status))status='queued';
        if(action==='cancel' && ['queued','running','paused','failed'].includes(job.status))status='cancelled';

        if(!status){
            return respostaErro(res,409,'Ação não permitida para o estado atual do processo.');
        }

        const r=await dbQuery(`
          UPDATE ml_jobs SET
            status=$3,
            locked_at=NULL,
            available_at=CASE WHEN $3='queued' THEN NOW() ELSE available_at END,
            finished_at=CASE WHEN $3='cancelled' THEN NOW() ELSE NULL END,
            updated_at=NOW(),
            message=CASE
              WHEN $3='paused' THEN 'Processo pausado pelo usuário.'
              WHEN $3='queued' THEN 'Processo retomado e aguardando worker.'
              WHEN $3='cancelled' THEN 'Processo cancelado pelo usuário.'
              ELSE message
            END
          WHERE id=$1 AND seller_id=$2
          RETURNING *
        `,[job.id,me.id,status]);

        res.json({sucesso:true,job:r.rows[0]});
    }catch(e){
        respostaErro(res,500,e.message);
    }
});

app.get('/api/v103/jobs/recent',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');
    if(!db)return res.json({sucesso:true,jobs:[],database:false});

    try{
        const me=await usuarioML(token);
        const limit=Math.max(1,Math.min(20,Number(req.query.limit||8)));
        const r=await dbQuery(`
          SELECT id,type,status,progress_current,progress_total,processed,
                 errors,message,result,created_at,updated_at,finished_at
          FROM ml_jobs
          WHERE seller_id=$1
          ORDER BY updated_at DESC
          LIMIT $2
        `,[me.id,limit]);

        res.json({sucesso:true,database:true,jobs:r.rows});
    }catch(e){
        respostaErro(res,500,e.message);
    }
});

app.get('/api/v103/runtime/status',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');

    try{
        const me=await usuarioML(token);
        let dbStatus={available:Boolean(db),items:0,jobs_running:0};

        if(db){
            try{
                const [i,j]=await Promise.all([
                    dbQuery(`SELECT COUNT(*)::int total FROM ml_items WHERE seller_id=$1`,[me.id]),
                    dbQuery(`SELECT COUNT(*)::int total FROM ml_jobs WHERE seller_id=$1 AND status IN ('queued','running','paused')`,[me.id])
                ]);
                dbStatus={
                    available:true,
                    items:Number(i.rows[0]?.total||0),
                    jobs_running:Number(j.rows[0]?.total||0)
                };
            }catch(e){
                dbStatus={available:false,items:0,jobs_running:0,error:e.message};
            }
        }

        res.json({
            sucesso:true,
            version:'V103',
            seller_id:String(me.id),
            database:dbStatus,
            worker:Boolean(ML_WORKER_ENABLED),
            limits:{
                ui_page:50,
                sync_batch:1000,
                pause_db_batch:500,
                pause_concurrency_max:16
            }
        });
    }catch(e){
        respostaErro(res,500,e.message);
    }
});

async function workerLoop(indice) {
    while(true) {
        try {
            await esperarCooldownDbV83();
            const job=await claimJob();
            if(job) {
                try {
                    if(job.type==='price_sync') await processarPrecosEscala(job);
                    else if(job.type==='freight_sync') await processarFretesEscala(job);
                    else if(job.type==='pause_mass_v103') await processarPausaMassaV103(job);
                    else if(job.type==='price_update_mass') await processarAtualizacaoPrecosMassaV36(job);
                    else if(job.type==='mass_create') await processarCriacaoMassaV36(job);
                    else if(job.type==='mass_create_v37') await processarCriacaoMassaV37(job);
                    else if(job.type==='promotion_mass_v77') await processarPromocaoMassaV77(job);
                    else if(job.type==='promotion_mass_v91') await processarPromocaoMassaV91(job);
                    else await dbQuery(`UPDATE ml_jobs SET status='failed',message='Tipo de job desconhecido',finished_at=NOW() WHERE id=$1`,[job.id]);
                } catch(e) {
                    const retry=Number(job.attempts||0)<4;
                    await dbQuery(`UPDATE ml_jobs SET status=$2,message=$3,available_at=NOW()+INTERVAL '30 seconds',updated_at=NOW(),finished_at=CASE WHEN $2='failed' THEN NOW() ELSE NULL END WHERE id=$1`,
                      [job.id,retry?'queued':'failed',e.message.slice(0,500)]);
                }
            }
            await processarNotificacaoFila();
        } catch(e){
            if(erroPostgresTemporarioV80(e))console.warn(`[WORKER ${indice}] PostgreSQL temporariamente indisponível.`);
            else console.error(`[WORKER ${indice}]`,e.message);
        }
        await new Promise(r=>setTimeout(r,jobSleepMs()));
    }
}
function jobSleepMs(){return 1200}




async function atualizarPrecosDbLoteV26(sellerId,linhas){
    if(!linhas.length)return;
    const params=[sellerId];
    const values=[];
    for(const x of linhas){
        const base=params.length;
        params.push(String(x.id),Number(x.price||0));
        values.push(`($${base+1}::text,$${base+2}::numeric)`);
    }
    await dbQuery(`
      UPDATE ml_items AS m SET
        price=v.price,
        net_received=GREATEST(0,v.price-m.sale_fee-m.shipping_cost),
        synced_at=NOW()
      FROM (VALUES ${values.join(',')}) AS v(item_id,price)
      WHERE m.seller_id=$1
        AND m.item_id=v.item_id
        AND m.price IS DISTINCT FROM v.price
    `,params);
}

async function processarPrecosEscala(job){
    const token=await obterTokenPersistenteParaSeller(job.seller_id);
    if(!token)throw new Error('Token Mercado Livre indispon\u00edvel para sincronizar pre\u00e7os.');

    let cursor=String(job.cursor||'');
    let processados=Number(job.processed||0);
    let erros=Number(job.errors||0);
    let total=Number(job.progress_total||0);

    if(total<=0){
        const tr=await dbQuery(`
          SELECT COUNT(*)::int total
          FROM ml_items
          WHERE seller_id=$1 AND status='active'
        `,[job.seller_id]);
        total=Number(tr.rows[0]?.total||0);
    }

    await dbQuery(`
      UPDATE ml_jobs SET
        progress_total=$2,
        progress_current=$3,
        message=$4,
        updated_at=NOW()
      WHERE id=$1
    `,[job.id,total,Math.min(total,processados+erros),
       `Pre\u00e7os: ${Math.min(total,processados+erros).toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} \u00b7 lote de at\u00e9 1.000`]);

    const LOTE=1000;

    while(true){
        const rr=await dbQuery(`
          SELECT item_id
          FROM ml_items
          WHERE seller_id=$1
            AND status='active'
            AND ($2::text='' OR item_id>$2)
          ORDER BY item_id
          LIMIT $3
        `,[job.seller_id,cursor,LOTE]);

        const ids=rr.rows.map(x=>String(x.item_id));
        if(!ids.length)break;

        const detalhes=await buscarItensBulkFreteRapido(token,ids);
        const linhas=[];
        let falhasLote=0;

        for(const id of ids){
            const item=detalhes.mapa[id];
            const preco=Number(item?.price);
            if(item && Number.isFinite(preco)){
                linhas.push({id,price:preco});
            }else{
                falhasLote++;
            }
        }

        // Um UPDATE em lote para at\u00e9 1.000 pre\u00e7os.
        await atualizarPrecosDbLoteV26(job.seller_id,linhas);

        processados+=linhas.length;
        erros+=falhasLote;
        cursor=ids[ids.length-1];

        const atual=Math.min(total,processados+erros);
        const pct=total?Math.min(100,Math.round((atual/total)*100)):100;

        await dbQuery(`
          UPDATE ml_jobs SET
            processed=$2,
            errors=$3,
            progress_current=$4,
            progress_total=$5,
            cursor=$6,
            message=$7,
            updated_at=NOW()
          WHERE id=$1
        `,[job.id,processados,erros,atual,total,cursor,
           `Pre\u00e7os: ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} \u00b7 ${pct}% \u00b7 lote de at\u00e9 1.000`]);
    }

    const atual=Math.min(total,processados+erros);
    await dbQuery(`
      UPDATE ml_jobs SET
        status='completed',
        progress_current=$2,
        progress_total=$3,
        processed=$4,
        errors=$5,
        cursor=NULL,
        message=$6,
        finished_at=NOW(),
        updated_at=NOW()
      WHERE id=$1
    `,[job.id,atual,total,processados,erros,
       `Pre\u00e7os conclu\u00eddos: ${processados.toLocaleString('pt-BR')} atualizado(s)${erros?` \u00b7 ${erros.toLocaleString('pt-BR')} falha(s)`:''}.`]);
}

function esperarFrete(ms){return new Promise(resolve=>setTimeout(resolve,ms))}

async function mlFetchFreteComTimeout(url,token,timeoutMs=15000){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
        return await mlFetch(url,token,{signal:controller.signal});
    }finally{
        clearTimeout(timer);
    }
}

function deveRepetirFrete(status){
    return status===408||status===429||status===500||status===502||status===503||status===504;
}

async function buscarItensBulkFreteRapido(token,ids){
    const unicos=[...new Set((ids||[]).map(String).filter(Boolean))];
    const blocos=[];
    for(let i=0;i<unicos.length;i+=20)blocos.push(unicos.slice(i,i+20));

    const mapa={};
    const falhas=new Map();

    // V107: micro-lotes menores e concorrência moderada reduzem picos no Render/ML.
    const concorrencia=Math.max(4,Math.min(12,Number(process.env.ML_BULK_CONCURRENCY||8)));
    let cursor=0;

    async function worker(){
        while(true){
            const idx=cursor++;
            if(idx>=blocos.length)return;
            const bloco=blocos[idx];
            let ultimoErro='Falha ao buscar detalhes do anúncio.';

            for(let tentativa=1;tentativa<=4;tentativa++){
                try{
                    const r=await mlFetchFreteComTimeout(
                        `${ML_API}/items/bulk?ids=${bloco.join(',')}`,
                        token,
                        15000
                    );
                    const d=await jsonSeguro(r);

                    if(r.ok && Array.isArray(d)){
                        for(const reg of d){
                            const body=reg?.body;
                            const id=reg?.id||body?.id;
                            if(id&&body)mapa[String(id)]=body;
                        }

                        // Se o bulk respondeu mas faltaram alguns IDs, tenta esses
                        // novamente nas próximas tentativas antes de desistir.
                        const faltaram=bloco.filter(id=>!mapa[String(id)]);
                        if(!faltaram.length){
                            ultimoErro='';
                            break;
                        }
                        ultimoErro=`Mercado Livre não retornou ${faltaram.length} item(ns) do bloco.`;
                    }else{
                        ultimoErro=`Detalhes HTTP ${r.status}: ${formatarErroMercadoLivre(d)}`;
                        if(!deveRepetirFrete(r.status))break;
                    }

                    const retryAfter=Number(r.headers?.get?.('retry-after')||0);
                    const espera=retryAfter>0
                        ? Math.min(8000,retryAfter*1000)
                        : Math.min(3000,300*Math.pow(2,tentativa-1));
                    await esperarFrete(espera);
                }catch(e){
                    ultimoErro=e?.name==='AbortError'
                        ? 'Timeout ao buscar detalhes.'
                        : String(e?.message||e);
                    if(tentativa<4)await esperarFrete(Math.min(3000,300*Math.pow(2,tentativa-1)));
                }
            }

            for(const id of bloco){
                if(!mapa[String(id)])falhas.set(String(id),ultimoErro);
            }
        }
    }

    await Promise.all(
        Array.from({length:Math.min(concorrencia,Math.max(1,blocos.length))},()=>worker())
    );

    return {mapa,falhas};
}

async function calcularFreteEscalaRobusto(item,token){
    const shipping=item?.shipping||{};
    const itemId=item?.id;
    const sellerId=item?.seller_id;
    if(!itemId||!sellerId)throw new Error('An\u00fancio sem item_id/seller_id para calcular frete.');

    const params=new URLSearchParams({
        item_id:String(itemId),
        item_price:String(Number(item?.price||0)),
        listing_type_id:String(item?.listing_type_id||'gold_special'),
        condition:String(item?.condition||'new'),
        mode:String(shipping?.mode||'me2'),
        free_shipping:shipping.free_shipping?'true':'false',
        verbose:'true'
    });
    if(shipping?.logistic_type)params.set('logistic_type',String(shipping.logistic_type));
    const url=`${ML_API}/users/${sellerId}/shipping_options/free?${params.toString()}`;

    let ultimo='N\u00e3o foi poss\u00edvel consultar o frete.';
    for(let tentativa=1;tentativa<=3;tentativa++){
        try{
            const r=await mlFetchFreteComTimeout(url,token,12000);
            const d=await jsonSeguro(r);
            if(r.ok){
                const custo=Number(d?.coverage?.all_country?.list_cost);
                if(Number.isFinite(custo)&&custo>=0){
                    return {id:String(itemId),custo,gratis:Boolean(shipping.free_shipping)};
                }
                ultimo='Mercado Livre respondeu sem coverage.all_country.list_cost.';
                break;
            }
            ultimo=`Frete HTTP ${r.status}: ${formatarErroMercadoLivre(d)}`;
            if(!deveRepetirFrete(r.status))break;
            const retryAfter=Number(r.headers.get('retry-after')||0);
            await esperarFrete(retryAfter>0?Math.min(5000,retryAfter*1000):500*tentativa);
        }catch(e){
            ultimo=e?.name==='AbortError'?'Timeout na consulta de frete.':e.message;
            if(tentativa<3)await esperarFrete(500*tentativa);
        }
    }
    throw new Error(ultimo);
}

async function atualizarFretesDbLote(sellerId,linhas){
    if(!linhas.length)return;
    const params=[sellerId];
    const values=[];
    for(const x of linhas){
        const base=params.length;
        params.push(String(x.id),Number(x.custo||0),Boolean(x.gratis));
        values.push(`($${base+1}::text,$${base+2}::numeric,$${base+3}::boolean)`);
    }
    await dbQuery(`
      UPDATE ml_items AS m SET
        shipping_cost=v.shipping_cost,
        free_shipping=v.free_shipping,
        net_received=GREATEST(0,m.price-m.sale_fee-v.shipping_cost),
        freight_synced_at=NOW(),
        freight_last_attempt_at=NOW(),
        freight_last_error=NULL,
        synced_at=CASE
          WHEN m.shipping_cost IS DISTINCT FROM v.shipping_cost
            OR m.free_shipping IS DISTINCT FROM v.free_shipping
          THEN NOW()
          ELSE m.synced_at
        END
      FROM (VALUES ${values.join(',')}) AS v(item_id,shipping_cost,free_shipping)
      WHERE m.seller_id=$1 AND m.item_id=v.item_id
    `,params);
}

async function marcarErrosFreteDbLote(sellerId,linhas){
    if(!linhas.length)return;
    const params=[sellerId];
    const values=[];
    for(const x of linhas){
        const base=params.length;
        params.push(String(x.id),String(x.erro||'Falha ao consultar frete.').slice(0,450));
        values.push(`($${base+1}::text,$${base+2}::text)`);
    }
    await dbQuery(`
      UPDATE ml_items AS m SET
        freight_last_attempt_at=NOW(),
        freight_last_error=v.erro
      FROM (VALUES ${values.join(',')}) AS v(item_id,erro)
      WHERE m.seller_id=$1 AND m.item_id=v.item_id
    `,params);
}

async function adotarProgressoFreteLegado(job){
    const offset=Number(job.payload?.offset||0);
    if(offset<=0||job.payload?.v20_adotado)return job;

    await dbQuery(`
      UPDATE ml_items SET
        freight_synced_at=COALESCE(freight_synced_at,synced_at),
        freight_last_attempt_at=COALESCE(freight_last_attempt_at,synced_at),
        freight_last_error=NULL
      WHERE seller_id=$1 AND item_id IN (
        SELECT item_id FROM ml_items
        WHERE seller_id=$1
        ORDER BY item_id
        LIMIT $2
      )
    `,[job.seller_id,offset]);

    const payload={...(job.payload||{}),v20_adotado:true,offset_legado:offset};
    const r=await dbQuery(
      `UPDATE ml_jobs SET payload=$2,updated_at=NOW(),message=$3 WHERE id=$1 RETURNING *`,
      [job.id,payload,`Retomando fretes a partir de ${offset.toLocaleString('pt-BR')} an\u00fancio(s) j\u00e1 conclu\u00eddos.`]
    );
    return r.rows[0]||job;
}

async function processarFretesEscala(job){
    const token=await obterTokenPersistenteParaSeller(job.seller_id);
    if(!token)throw new Error('Token Mercado Livre indispon\u00edvel para sincronizar fretes.');

    let cursor=String(job.cursor||'');
    let processados=Number(job.processed||0);
    let erros=Number(job.errors||0);
    let total=Number(job.progress_total||0);

    if(total<=0){
        const tr=await dbQuery(`
          SELECT COUNT(*)::int total
          FROM ml_items
          WHERE seller_id=$1 AND status='active'
        `,[job.seller_id]);
        total=Number(tr.rows[0]?.total||0);
    }

    await dbQuery(`
      UPDATE ml_jobs SET
        progress_total=$2,
        progress_current=$3,
        message=$4,
        updated_at=NOW()
      WHERE id=$1
    `,[job.id,total,Math.min(total,processados+erros),
       `Fretes: ${Math.min(total,processados+erros).toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} \u00b7 lote de at\u00e9 1.000`]);

    const LOTE=1000;
    const MICRO=100;
    const CONCORRENCIA=Math.max(8,Math.min(40,Number(process.env.ML_FREIGHT_CONCURRENCY||24)));

    while(true){
        const rr=await dbQuery(`
          SELECT item_id
          FROM ml_items
          WHERE seller_id=$1
            AND status='active'
            AND ($2::text='' OR item_id>$2)
          ORDER BY item_id
          LIMIT $3
        `,[job.seller_id,cursor,LOTE]);

        const ids=rr.rows.map(x=>String(x.item_id));
        if(!ids.length)break;

        const detalhes=await buscarItensBulkFreteRapido(token,ids);

        // O lote oficial do usu\u00e1rio \u00e9 1.000; dividimos em microblocos s\u00f3
        // para heartbeat e para n\u00e3o perder progresso se o Render reiniciar.
        for(let i=0;i<ids.length;i+=MICRO){
            const microIds=ids.slice(i,i+MICRO);
            const itens=microIds.map(id=>detalhes.mapa[id]).filter(Boolean);
            const sucessos=[];
            const falhas=microIds
              .filter(id=>!detalhes.mapa[id])
              .map(id=>({id,erro:detalhes.falhas.get(id)||'Detalhes do an\u00fancio indispon\u00edveis.'}));

            for(let p=0;p<itens.length;p+=CONCORRENCIA){
                const grupo=itens.slice(p,p+CONCORRENCIA);
                const resultados=await Promise.allSettled(
                    grupo.map(item=>calcularFreteEscalaRobusto(item,token))
                );
                resultados.forEach((r,idx)=>{
                    const item=grupo[idx];
                    if(r.status==='fulfilled')sucessos.push(r.value);
                    else falhas.push({
                        id:String(item?.id||''),
                        erro:r.reason?.message||'Falha no frete.'
                    });
                });
            }

            await atualizarFretesDbLote(job.seller_id,sucessos);
            await marcarErrosFreteDbLote(job.seller_id,falhas);

            processados+=sucessos.length;
            erros+=falhas.length;
            cursor=microIds[microIds.length-1];

            const atual=Math.min(total,processados+erros);
            const pct=total?Math.min(100,Math.round((atual/total)*100)):100;

            await dbQuery(`
              UPDATE ml_jobs SET
                processed=$2,
                errors=$3,
                progress_current=$4,
                progress_total=$5,
                cursor=$6,
                message=$7,
                updated_at=NOW()
              WHERE id=$1
            `,[job.id,processados,erros,atual,total,cursor,
               `Fretes: ${atual.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} \u00b7 ${pct}% \u00b7 lote de at\u00e9 1.000${erros?` \u00b7 ${erros.toLocaleString('pt-BR')} falha(s)`:''}`]);
        }
    }

    const atual=Math.min(total,processados+erros);
    const msg=erros
      ? `Fretes conclu\u00eddos: ${processados.toLocaleString('pt-BR')} atualizado(s), ${erros.toLocaleString('pt-BR')} falha(s). Clique novamente para iniciar uma nova varredura completa.`
      : `Fretes sincronizados: ${processados.toLocaleString('pt-BR')} an\u00fancio(s). Clique novamente quando quiser rodar tudo de novo.`;

    await dbQuery(`
      UPDATE ml_jobs SET
        status='completed',
        progress_current=$2,
        progress_total=$3,
        processed=$4,
        errors=$5,
        cursor=NULL,
        message=$6,
        finished_at=NOW(),
        updated_at=NOW()
      WHERE id=$1
    `,[job.id,atual,total,processados,erros,msg]);
}

async function prepararJobEscalaV26(sellerId,type,payload,total,{retomarFalha=true}={}){
    // Se o Render caiu no meio, devolve o job para a fila.
    await dbQuery(`
      UPDATE ml_jobs SET
        status='queued',
        locked_at=NULL,
        available_at=NOW(),
        message='Retomando automaticamente do \u00faltimo ponto salvo.',
        updated_at=NOW()
      WHERE seller_id=$1
        AND type=$2
        AND status='running'
        AND updated_at<NOW()-INTERVAL '45 seconds'
    `,[sellerId,type]);

    const ativo=await dbQuery(`
      SELECT * FROM ml_jobs
      WHERE seller_id=$1 AND type=$2 AND status IN ('queued','running')
      ORDER BY id DESC LIMIT 1
    `,[sellerId,type]);
    if(ativo.rows.length)return {job:ativo.rows[0],retomado:true};

    if(retomarFalha){
        const falho=await dbQuery(`
          SELECT * FROM ml_jobs
          WHERE seller_id=$1 AND type=$2 AND status='failed'
            AND (cursor IS NOT NULL OR progress_current>0)
          ORDER BY id DESC LIMIT 1
        `,[sellerId,type]);

        if(falho.rows.length){
            const r=await dbQuery(`
              UPDATE ml_jobs SET
                status='queued',
                attempts=0,
                available_at=NOW(),
                locked_at=NULL,
                finished_at=NULL,
                message='Retomando do \u00faltimo ponto salvo.',
                updated_at=NOW()
              WHERE id=$1
              RETURNING *
            `,[falho.rows[0].id]);
            return {job:r.rows[0],retomado:true};
        }
    }

    const job=await criarJob(sellerId,type,payload);
    const r=await dbQuery(`
      UPDATE ml_jobs SET
        progress_total=$2,
        progress_current=0,
        processed=0,
        errors=0,
        cursor=NULL,
        message=$3,
        updated_at=NOW()
      WHERE id=$1
      RETURNING *
    `,[job.id,total,payload?.mensagem_inicial||'Sincroniza\u00e7\u00e3o aguardando processamento.']);

    return {job:r.rows[0],retomado:false};
}


/* =========================================================
   V92 — PREÇOS DIRETO · LOTE REAL DE ATÉ 1.000
   Não depende do PostgreSQL.
========================================================= */
app.post('/api/v92/precos/direto',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    try{
        const ids=[...new Set(
            (Array.isArray(req.body?.ids)?req.body.ids:[])
              .map(String)
              .filter(Boolean)
        )].slice(0,1000);

        if(!ids.length){
            return res.json({
                sucesso:true,
                mode:'direct_price_v92',
                total:0,
                resultados:[]
            });
        }

        const detalhes=await buscarItensBulkFreteRapido(token,ids);

        const resultados=ids.map(id=>{
            const item=detalhes?.mapa?.[String(id)];
            const price=Number(item?.price);

            if(item && Number.isFinite(price)){
                return {
                    id:String(id),
                    sucesso:true,
                    price,
                    available_quantity:Number(item.available_quantity||0),
                    sold_quantity:Number(item.sold_quantity||0),
                    status:String(item.status||'')
                };
            }

            return {
                id:String(id),
                sucesso:false,
                price:null,
                erro:detalhes?.falhas?.get?.(String(id))||'Mercado Livre não retornou o preço deste anúncio.'
            };
        });

        let db_mirrored=false;
        if(db){
            try{
                const sellerId=await sellerIdRequestV103(req,token);
                const linhas=resultados
                  .filter(x=>x.sucesso&&Number.isFinite(Number(x.price)))
                  .map(x=>({id:String(x.id),price:Number(x.price)}));
                if(linhas.length){
                    await atualizarPrecosDbLoteV26(sellerId,linhas);
                }
                db_mirrored=true;
            }catch(e){
                console.warn('[V103 MIRROR PREÇOS]',e.message);
            }
        }

        return res.json({
            sucesso:true,
            mode:'direct_price_v92',
            total:resultados.length,
            falhas:resultados.filter(x=>!x.sucesso).length,
            db_mirrored,
            resultados
        });
    }catch(e){
        const msg=String(e?.message||e||'');
        const temp=/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|AbortError|timeout|socket|fetch|network|429|500|502|503|504/i.test(msg);

        return respostaErro(
            res,
            temp?503:500,
            temp
              ? 'Instabilidade temporária ao consultar preços. Tente novamente; o checkpoint local permanece salvo.'
              : 'Erro ao puxar preços: '+msg
        );
    }
});

app.post('/api/scale/precos',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');
    if(!db)return respostaErro(res,503,'PostgreSQL n\u00e3o configurado.');
    try{
        const me=await usuarioML(token);
        const tr=await dbQuery(`SELECT COUNT(*)::int total FROM ml_items WHERE seller_id=$1 AND status='active'`,[me.id]);
        const total=Number(tr.rows[0]?.total||0);
        const preparado=await prepararJobEscalaV26(
            me.id,
            'price_sync',
            {modo:'full_refresh_v26',batch_size:1000,mensagem_inicial:`Pre\u00e7os: 0/${total.toLocaleString('pt-BR')} \u00b7 lote de at\u00e9 1.000`},
            total,
            {retomarFalha:true}
        );
        return res.status(202).json({
            sucesso:true,
            job:preparado.job,
            retomado:preparado.retomado,
            batch_size:1000,
            mensagem:preparado.retomado
              ? 'Sincroniza\u00e7\u00e3o de pre\u00e7os retomada do \u00faltimo ponto salvo.'
              : 'Sincroniza\u00e7\u00e3o completa de pre\u00e7os iniciada em lotes de at\u00e9 1.000.'
        });
    }catch(e){
        console.error('[PRE\u00c7OS V26 START]',e);
        respostaErro(res,500,'Erro ao iniciar pre\u00e7os: '+e.message);
    }
});


/* =========================================================
   V89 — FRETE DIRETO, SEM POSTGRESQL
   Recebe até 100 IDs já salvos no navegador, consulta o
   Mercado Livre e devolve o custo exato por anúncio.
========================================================= */

/* =========================================================
   V93 — FRETES · LOTE REAL DE ATÉ 1.000
   O lote inteiro chega de uma vez. Internamente usamos workers
   adaptativos para manter velocidade sem explodir rate limit.
========================================================= */
app.post('/api/v93/fretes/lote1000',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    try{
        const ids=[...new Set(
            (Array.isArray(req.body?.ids)?req.body.ids:[])
              .map(String)
              .filter(Boolean)
        )].slice(0,1000);

        if(!ids.length){
            return res.json({
                sucesso:true,
                mode:'direct_freight_v93_batch_1000',
                total:0,
                falhas:0,
                resultados:[]
            });
        }

        const detalhes=await buscarItensBulkFreteRapido(token,ids);
        const raws=ids.map(id=>detalhes?.mapa?.[String(id)]).filter(Boolean);

        const resultados=new Array(raws.length);
        let cursor=0;

        const CONC=Math.max(
            8,
            Math.min(32,Number(process.env.ML_FREIGHT_V93_CONCURRENCY||20))
        );

        async function worker(){
            while(true){
                const idx=cursor++;
                if(idx>=raws.length)return;

                const item=raws[idx];
                let ultimoErro=null;

                for(let tentativa=1;tentativa<=5;tentativa++){
                    try{
                        const fr=await calcularFreteEscalaRobusto(item,token);

                        resultados[idx]={
                            id:String(item.id),
                            sucesso:true,
                            shipping_cost:Number(fr.custo||0),
                            free_shipping:Boolean(fr.gratis),
                            attempts:tentativa,
                            erro:null
                        };

                        ultimoErro=null;
                        break;
                    }catch(e){
                        ultimoErro=e;
                        const msg=String(e?.message||e||'');

                        const temporario=
                          /429|408|500|502|503|504|timeout|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|socket|fetch|network/i.test(msg);

                        if(!temporario || tentativa>=5)break;

                        await esperarFrete(
                            Math.min(7000,350*Math.pow(2,tentativa-1))
                        );
                    }
                }

                if(ultimoErro && !resultados[idx]){
                    try{
                        const custo=await calcularFreteExato(item,token);
                        resultados[idx]={
                            id:String(item.id),
                            sucesso:true,
                            shipping_cost:Number(custo||0),
                            free_shipping:Boolean(item?.shipping?.free_shipping),
                            fallback:true,
                            erro:null
                        };
                    }catch(e2){
                        resultados[idx]={
                            id:String(item.id),
                            sucesso:false,
                            shipping_cost:null,
                            free_shipping:Boolean(item?.shipping?.free_shipping),
                            erro:String(e2?.message||ultimoErro?.message||'Falha ao consultar frete.')
                        };
                    }
                }
            }
        }

        await Promise.all(
            Array.from(
                {length:Math.min(CONC,Math.max(1,raws.length))},
                ()=>worker()
            )
        );

        const porId=new Map(
            (resultados||[])
              .filter(Boolean)
              .map(x=>[String(x.id),x])
        );

        const saida=ids.map(id=>{
            if(porId.has(String(id)))return porId.get(String(id));

            return {
                id:String(id),
                sucesso:false,
                shipping_cost:null,
                free_shipping:false,
                erro:detalhes?.falhas?.get?.(String(id))||
                    'Mercado Livre não retornou os detalhes deste anúncio.'
            };
        });

        let db_mirrored=false;
        if(db){
            try{
                const sellerId=await sellerIdRequestV103(req,token);
                const bons=saida
                  .filter(x=>x.sucesso&&Number.isFinite(Number(x.shipping_cost)))
                  .map(x=>({
                      id:String(x.id),
                      custo:Number(x.shipping_cost||0),
                      gratis:Boolean(x.free_shipping)
                  }));
                const ruins=saida
                  .filter(x=>!x.sucesso)
                  .map(x=>({
                      id:String(x.id),
                      erro:String(x.erro||'Falha ao consultar frete.')
                  }));

                if(bons.length)await atualizarFretesDbLote(sellerId,bons);
                if(ruins.length)await marcarErrosFreteDbLote(sellerId,ruins);
                db_mirrored=true;
            }catch(e){
                console.warn('[V103 MIRROR FRETES]',e.message);
            }
        }

        return res.json({
            sucesso:true,
            mode:'direct_freight_v93_batch_1000',
            total:saida.length,
            falhas:saida.filter(x=>!x.sucesso).length,
            db_mirrored,
            resultados:saida
        });
    }catch(e){
        const msg=String(e?.message||e||'');
        const temp=/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|AbortError|timeout|socket|fetch|network|429|500|502|503|504/i.test(msg);

        return respostaErro(
            res,
            temp?503:500,
            temp
              ? 'Instabilidade temporária no lote de fretes. Tente novamente; o checkpoint não foi perdido.'
              : 'Erro ao puxar lote de 1.000 fretes: '+msg
        );
    }
});

app.post('/api/v89/fretes/direto',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    try{
        const ids=[...new Set(
            (Array.isArray(req.body?.ids)?req.body.ids:[])
              .map(String)
              .filter(Boolean)
        )].slice(0,100);

        if(!ids.length){
            return res.json({
                sucesso:true,
                resultados:[],
                total:0,
                falhas:0
            });
        }

        const detalhes=await buscarItensBulkFreteRapido(token,ids);
        const raws=ids
          .map(id=>detalhes?.mapa?.[String(id)])
          .filter(Boolean);

        const resultados=new Array(raws.length);
        let cursor=0;

        const CONC=Math.max(
            4,
            Math.min(20,Number(process.env.ML_FREIGHT_DIRECT_CONCURRENCY||12))
        );

        async function worker(){
            while(true){
                const idx=cursor++;
                if(idx>=raws.length)return;

                const item=raws[idx];
                try{
                    const fr=await calcularFreteEscalaRobusto(item,token);
                    resultados[idx]={
                        id:String(item.id),
                        sucesso:true,
                        shipping_cost:Number(fr.custo||0),
                        free_shipping:Boolean(fr.gratis),
                        erro:null
                    };
                }catch(e){
                    // Fallback legado: ainda tenta shipping_options/free + shipping.costs.
                    try{
                        const custo=await calcularFreteExato(item,token);
                        resultados[idx]={
                            id:String(item.id),
                            sucesso:true,
                            shipping_cost:Number(custo||0),
                            free_shipping:Boolean(item?.shipping?.free_shipping),
                            fallback:true,
                            erro:null
                        };
                    }catch(e2){
                        resultados[idx]={
                            id:String(item.id),
                            sucesso:false,
                            shipping_cost:null,
                            free_shipping:Boolean(item?.shipping?.free_shipping),
                            erro:String(e2?.message||e?.message||'Falha ao consultar frete.')
                        };
                    }
                }
            }
        }

        await Promise.all(
            Array.from(
                {length:Math.min(CONC,Math.max(1,raws.length))},
                ()=>worker()
            )
        );

        const porId=new Map((resultados||[]).filter(Boolean).map(x=>[String(x.id),x]));

        // IDs não retornados pelo /items/bulk ficam explícitos como falha,
        // para o navegador preservar o valor anterior.
        const saida=ids.map(id=>{
            if(porId.has(String(id)))return porId.get(String(id));
            return {
                id:String(id),
                sucesso:false,
                shipping_cost:null,
                free_shipping:false,
                erro:detalhes?.falhas?.get?.(String(id))||'Mercado Livre não retornou os detalhes deste anúncio.'
            };
        });

        const falhas=saida.filter(x=>!x.sucesso).length;

        return res.json({
            sucesso:true,
            mode:'direct_freight_v89',
            total:saida.length,
            falhas,
            resultados:saida
        });
    }catch(e){
        const msg=String(e?.message||e||'');
        const temp=/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|AbortError|timeout|socket|fetch|network|429|500|502|503|504/i.test(msg);

        return respostaErro(
            res,
            temp?503:500,
            temp
              ? 'Instabilidade temporária ao consultar fretes. Tente novamente; o progresso local continua salvo.'
              : 'Erro ao puxar fretes: '+msg
        );
    }
});
