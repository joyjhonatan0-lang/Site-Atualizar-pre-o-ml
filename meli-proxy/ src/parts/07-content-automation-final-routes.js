
async function descricaoItemV96(token,id){
    const r=await mlFetch(`${ML_API}/items/${encodeURIComponent(id)}/description`,token);
    const d=await jsonSeguro(r);
    if(r.status===404)return {plain_text:'',existe:false};
    if(!r.ok)return {plain_text:'',existe:false,erro:formatarErroMercadoLivre(d)||`HTTP ${r.status}`};
    return {plain_text:String(d?.plain_text||d?.text||''),existe:Boolean(String(d?.plain_text||d?.text||'').trim()),raw:d};
}

function montarFichaV96(item,defs){
    const atuais=new Map((Array.isArray(item?.attributes)?item.attributes:[]).map(a=>[String(a.id),a]));
    const ignorar=new Set(['SELLER_SKU']);
    const principais=[];
    const secundarias=[];

    for(const d of defs){
        const id=String(d?.id||'');
        if(!id||ignorar.has(id)||atributoSomenteLeituraV96(d)||atributoVariacaoV96(d))continue;
        const atual=atuais.get(id)||null;
        const row={
            id,
            name:String(d?.name||id),
            value:valorAttrV96(atual),
            value_id:atual?.value_id??null,
            required:atributoObrigatorioV96(d),
            group_id:String(d?.attribute_group_id||''),
            group_name:String(d?.attribute_group_name||''),
            value_type:String(d?.value_type||'string'),
            values:(Array.isArray(d?.values)?d.values:[]).slice(0,150).map(v=>({id:v?.id??null,name:String(v?.name||'')})),
            missing:!valorAttrV96(atual)
        };
        if(row.required)principais.push(row); else secundarias.push(row);
    }

    const missingMain=principais.filter(x=>x.missing);
    const missingSecondary=secundarias.filter(x=>x.missing);
    return {principais,secundarias,missingMain,missingSecondary};
}

async function detalheConteudoAnuncioV96(token,id){
    const itemRes=await mlFetch(
        `${ML_API}/items/${encodeURIComponent(id)}?include_attributes=all&include_internal_attributes=true`,
        token
    );
    const item=await jsonSeguro(itemRes);
    if(!itemRes.ok)throw Object.assign(new Error(formatarErroMercadoLivre(item)||'Anúncio não encontrado.'),{status:itemRes.status});

    const [descricao,defs]=await Promise.all([
        descricaoItemV96(token,id),
        definicoesCategoriaV96(token,item.category_id).catch(()=>[])
    ]);

    const ficha=montarFichaV96(item,defs);
    const pics=(Array.isArray(item.pictures)?item.pictures:[]).map(p=>({
        id:p?.id||null,
        url:p?.secure_url||p?.url||''
    })).filter(p=>p.id||p.url);

    const principalTotal=ficha.principais.length;
    const secundariaTotal=ficha.secundarias.length;
    const principalOk=principalTotal-ficha.missingMain.length;
    const secundariaOk=secundariaTotal-ficha.missingSecondary.length;
    const descriptionOk=Boolean(descricao.existe);
    const picturesOk=pics.length>=4;

    const score=Math.round(
        (descriptionOk?25:0)+
        Math.min(25,pics.length*5)+
        (principalTotal?30*(principalOk/principalTotal):30)+
        (secundariaTotal?20*(secundariaOk/secundariaTotal):20)
    );

    return {
        id:String(item.id||id),
        title:String(item.title||''),
        sku:String((item.attributes||[]).find(a=>a.id==='SELLER_SKU')?.value_name||''),
        seller_id:String(item.seller_id||''),
        category_id:String(item.category_id||''),
        user_product_id:item.user_product_id||null,
        sold_quantity:Number(item.sold_quantity||0),
        pictures:pics,
        description:descricao.plain_text||'',
        description_exists:descriptionOk,
        attributes:Array.isArray(item.attributes)?item.attributes:[],
        principais:ficha.principais,
        secundarias:ficha.secundarias,
        missing_main:ficha.missingMain,
        missing_secondary:ficha.missingSecondary,
        content_score:Math.max(0,Math.min(100,score)),
        picture_count:pics.length
    };
}

function normalizarPicturesV96(lista){
    return (Array.isArray(lista)?lista:[]).map(p=>{
        if(typeof p==='string'){
            const v=p.trim();
            if(!v)return null;
            if(/^https?:\/\//i.test(v))return {source:v};
            return {id:v};
        }
        if(p?.id)return {id:String(p.id)};
        if(p?.source&&/^https?:\/\//i.test(String(p.source)))return {source:String(p.source)};
        if(p?.url&&/^https?:\/\//i.test(String(p.url)))return {source:String(p.url)};
        return null;
    }).filter(Boolean).slice(0,30);
}

function normalizarAttributesV96(lista,defs=[]){
    const permitidos=new Map(defs.map(x=>[String(x.id),x]));
    return (Array.isArray(lista)?lista:[]).map(a=>{
        const id=String(a?.id||'').trim();
        if(!id||id==='SELLER_SKU')return null;
        const def=permitidos.get(id);
        if(def&&(atributoSomenteLeituraV96(def)||atributoVariacaoV96(def)))return null;
        const valueId=a?.value_id!==undefined&&a?.value_id!==null?String(a.value_id).trim():'';
        const valueName=a?.value_name!==undefined&&a?.value_name!==null?String(a.value_name).trim():'';
        if(valueId==='-1')return {id,value_id:'-1',value_name:null};
        if(valueId)return {id,value_id:valueId};
        if(valueName)return {id,value_name:valueName.slice(0,1000)};
        return null;
    }).filter(Boolean);
}

async function putItemV96(token,id,payload){
    const r=await mlFetch(`${ML_API}/items/${encodeURIComponent(id)}`,token,{
        method:'PUT',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify(payload)
    });
    const d=await jsonSeguro(r);
    if(!r.ok)throw Object.assign(new Error(formatarErroMercadoLivre(d)||`Mercado Livre recusou a alteração (HTTP ${r.status}).`),{status:r.status,data:d});
    return d;
}

async function atualizarDescricaoV96(token,id,texto){
    const plain=String(texto??'').trim();
    const atual=await descricaoItemV96(token,id);

    // V97: nunca envia plain_text vazio. O Mercado Livre rejeita esse payload.
    if(!plain){
        return {alterou:false,ignorado:true,motivo:'descricao_vazia',existente:Boolean(atual.existe)};
    }

    if(String(atual.plain_text||'').trim()===plain){
        return {alterou:false,ignorado:true,motivo:'descricao_sem_alteracao',existente:Boolean(atual.existe)};
    }

    const method=atual.existe?'PUT':'POST';
    const suffix=method==='PUT'?'?api_version=2':'';
    const r=await mlFetch(`${ML_API}/items/${encodeURIComponent(id)}/description${suffix}`,token,{
        method,
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({plain_text:plain})
    });
    const d=await jsonSeguro(r);
    if(!r.ok){
        const erro=formatarErroMercadoLivre(d)||'Mercado Livre recusou a descrição.';
        if(/plain\s*text.*null|plain\s*text.*empty/i.test(String(erro))){
            throw Object.assign(new Error('A descrição está vazia. Preencha um texto antes de atualizar a descrição.'),{status:r.status,data:d});
        }
        throw Object.assign(new Error(erro),{status:r.status,data:d});
    }
    return {alterou:true,ignorado:false,data:d};
}

async function atualizarTituloV96(token,item,title){
    const novo=String(title||'').trim();
    if(!novo||novo===String(item.title||'').trim())return {alterou:false};
    if(novo.length>60)throw Object.assign(new Error('O título não pode ultrapassar 60 caracteres.'),{status:400});
    if(Number(item.sold_quantity||0)>0)throw Object.assign(new Error('O Mercado Livre não permite alterar o título deste anúncio porque ele já possui vendas.'),{status:409});

    if(item.user_product_id){
        const upr=await mlFetch(`${ML_API}/user-products/${encodeURIComponent(item.user_product_id)}`,token);
        const upd=await jsonSeguro(upr);
        if(!upr.ok||!upd?.family_id)throw new Error(formatarErroMercadoLivre(upd)||'Família do User Product não encontrada.');
        const fr=await mlFetch(`${ML_API}/user-products-families/${encodeURIComponent(upd.family_id)}`,token,{
            method:'PUT',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({family_name:novo})
        });
        const fd=await jsonSeguro(fr);
        if(!fr.ok)throw Object.assign(new Error(formatarErroMercadoLivre(fd)||'Título/família recusado pelo Mercado Livre.'),{status:fr.status});
        return {alterou:true,via:'family_name'};
    }

    await putItemV96(token,item.id,{title:novo});
    return {alterou:true,via:'title'};
}

async function aplicarPatchConteudoV96({token,id,patch,sellerId=null}){
    const atualRes=await mlFetch(`${ML_API}/items/${encodeURIComponent(id)}?include_attributes=all&include_internal_attributes=true`,token);
    const atual=await jsonSeguro(atualRes);
    if(!atualRes.ok)throw Object.assign(new Error(formatarErroMercadoLivre(atual)||'Anúncio não encontrado.'),{status:atualRes.status});
    if(sellerId&&String(atual.seller_id)!==String(sellerId))throw Object.assign(new Error('Este anúncio não pertence à conta Mercado Livre ativa.'),{status:403});

    const defs=await definicoesCategoriaV96(token,atual.category_id).catch(()=>[]);
    const alteracoes=[];
    const avisos=[];

    if(patch.title!==undefined){
        try{const r=await atualizarTituloV96(token,atual,patch.title);if(r.alterou)alteracoes.push('título')}
        catch(e){avisos.push(`Título: ${e.message}`)}
    }

    if(patch.pictures!==undefined){
        const pictures=normalizarPicturesV96(patch.pictures);
        if(!pictures.length)throw Object.assign(new Error('O anúncio precisa manter pelo menos uma foto.'),{status:400});
        await putItemV96(token,id,{pictures});
        alteracoes.push('fotos');
    }

    if(patch.attributes!==undefined){
        const attributes=normalizarAttributesV96(patch.attributes,defs);
        if(attributes.length){
            await putItemV96(token,id,{attributes});
            alteracoes.push('características');
        }
    }

    if(patch.description!==undefined){
        const r=await atualizarDescricaoV96(token,id,patch.description);
        if(r.alterou)alteracoes.push('descrição');
        else if(r.motivo==='descricao_vazia')avisos.push('Descrição vazia não foi enviada ao Mercado Livre.');
    }

    if(patch.sku!==undefined){
        const sku=String(patch.sku||'').trim();
        if(sku){
            await putItemV96(token,id,{attributes:[{id:'SELLER_SKU',value_name:sku}]});
            alteracoes.push('SKU');
        }else avisos.push('SKU vazio não foi enviado.');
    }

    const detalhe=await detalheConteudoAnuncioV96(token,id);
    return {id:String(id),sucesso:true,alteracoes,avisos,sem_alteracoes:!alteracoes.length,detalhe};
}

app.get('/api/v96/anuncios/:id/conteudo',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');
    try{
        const d=await detalheConteudoAnuncioV96(token,String(req.params.id||''));
        if(req.mlhubSellerId&&String(d.seller_id)!==String(req.mlhubSellerId))return respostaErro(res,403,'Anúncio de outra conta.');
        res.json({sucesso:true,...d});
    }catch(e){respostaErro(res,e.status||500,e.message)}
});

app.put('/api/v96/anuncios/:id/conteudo',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');
    try{
        const r=await aplicarPatchConteudoV96({
            token,id:String(req.params.id||''),patch:req.body||{},sellerId:req.mlhubSellerId||null
        });
        res.json(r);
    }catch(e){respostaErro(res,e.status||500,e.message)}
});

app.post('/api/v96/anuncios/auditar',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');
    const ids=[...new Set((Array.isArray(req.body?.ids)?req.body.ids:[]).map(String).filter(Boolean))].slice(0,50);
    if(!ids.length)return res.json({sucesso:true,itens:[]});
    const itens=await mapLimitV21(ids,5,async id=>{
        try{
            const d=await detalheConteudoAnuncioV96(token,id);
            if(req.mlhubSellerId&&String(d.seller_id)!==String(req.mlhubSellerId))return {id,sucesso:false,erro:'Outra conta'};
            return {
                id,sucesso:true,picture_count:d.picture_count,description_exists:d.description_exists,
                content_score:d.content_score,missing_main:d.missing_main.map(x=>({id:x.id,name:x.name})),
                missing_secondary:d.missing_secondary.map(x=>({id:x.id,name:x.name}))
            };
        }catch(e){return {id,sucesso:false,erro:e.message}}
    });
    res.json({sucesso:true,itens:itens.filter(Boolean)});
});

app.post('/api/v96/anuncios/conteudo-massa',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');
    const ids=[...new Set((Array.isArray(req.body?.ids)?req.body.ids:[]).map(String).filter(Boolean))].slice(0,250);
    const patch=req.body?.patch||{};
    if(!ids.length)return respostaErro(res,400,'Nenhum anúncio informado.');
    const resultados=await mapLimitV21(ids,5,async id=>{
        try{return await aplicarPatchConteudoV96({token,id,patch,sellerId:req.mlhubSellerId||null})}
        catch(e){return {id,sucesso:false,erro:e.message,status:e.status||500}}
    });
    const ok=resultados.filter(x=>x?.sucesso).length;
    res.json({sucesso:true,total:ids.length,atualizados:ok,falhas:ids.length-ok,resultados});
});

async function garantirInteligenciaV96(){
    if(inteligenciaInitV96)return inteligenciaInitV96;
    inteligenciaInitV96=(async()=>{
        if(!db)throw new Error('PostgreSQL é necessário para a Inteligência de Anúncios.');
        await dbQuery(`
          CREATE TABLE IF NOT EXISTS ml_product_monitors_v96(
            id BIGSERIAL PRIMARY KEY,
            workspace_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            seller_id TEXT NOT NULL,
            product_name TEXT NOT NULL,
            search_query TEXT NOT NULL,
            target_sku TEXT,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            interval_minutes INTEGER NOT NULL DEFAULT 60,
            last_scan_at TIMESTAMPTZ,
            next_scan_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            locked_until TIMESTAMPTZ,
            last_snapshot JSONB,
            last_recommendations JSONB,
            last_error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await dbQuery(`CREATE INDEX IF NOT EXISTS idx_monitor_v96_due ON ml_product_monitors_v96(enabled,next_scan_at)`);
        await dbQuery(`CREATE INDEX IF NOT EXISTS idx_monitor_v96_workspace ON ml_product_monitors_v96(workspace_id,user_id,updated_at DESC)`);
        await dbQuery(`
          CREATE TABLE IF NOT EXISTS ml_product_monitor_runs_v96(
            id BIGSERIAL PRIMARY KEY,
            monitor_id BIGINT NOT NULL,
            snapshot JSONB NOT NULL,
            recommendations JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        await dbQuery(`CREATE INDEX IF NOT EXISTS idx_monitor_runs_v96 ON ml_product_monitor_runs_v96(monitor_id,created_at DESC)`);
    })().catch(e=>{inteligenciaInitV96=null;throw e});
    return inteligenciaInitV96;
}

const STOPWORDS_TITULO_V96=new Set('de da do das dos para com sem em no na nos nas e o a os as um uma por kit produto original novo nova cor modelo tamanho tipo'.split(' '));
function palavrasTituloV96(t){
    return String(t||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'')
      .replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(x=>x.length>=3&&!STOPWORDS_TITULO_V96.has(x));
}
function medianaV96(nums){
    const a=nums.filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return 0;
    const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;
}

async function buscarPrimeiraPaginaMercadoV96(token,produto){
    const q=String(produto||'').trim();
    if(!q)throw Object.assign(new Error('Informe o nome do produto.'),{status:400});

    async function montarSnapshotItens(results,totalSearch,meta={}){
        const ids=(Array.isArray(results)?results:[])
          .map(x=>String(x?.id||x||''))
          .filter(Boolean)
          .slice(0,24);

        if(!ids.length){
            return {
                query:q,
                total_search:Number(totalSearch||0),
                items:[],
                summary:{analyzed:0,total_search:Number(totalSearch||0)},
                source:meta.source||'marketplace_search',
                source_label:meta.source_label||'Busca do Mercado Livre',
                category_id:meta.category_id||null,
                category_name:meta.category_name||null,
                notice:meta.notice||null
            };
        }

        const bulk=await buscarItensBulkFreteRapido(token,ids);
        const order=new Map(ids.map((id,i)=>[id,i+1]));
        const me=await usuarioML(token).catch(()=>({id:null}));
        const ownSeller=String(me?.id||'');

        const detalhes=ids
          .map(id=>bulk?.mapa?.[id])
          .filter(Boolean)
          .filter(item=>!ownSeller || String(item?.seller_id||'')!==ownSeller);

        const descs=await mapLimitV21(detalhes,6,async item=>{
            const d=await descricaoItemV96(token,item.id).catch(()=>({plain_text:'',existe:false}));
            return [String(item.id),d];
        });
        const descMap=new Map(descs.filter(Boolean));

        const items=[];
        for(const item of detalhes){
            const defs=await definicoesCategoriaV96(token,item.category_id).catch(()=>[]);
            const ficha=montarFichaV96(item,defs);
            const required=ficha.principais.length;
            const filled=required-ficha.missingMain.length;
            const desc=descMap.get(String(item.id))||{plain_text:'',existe:false};

            items.push({
                position:order.get(String(item.id))||999,
                id:String(item.id),
                title:String(item.title||''),
                price:Number(item.price||0),
                sold_quantity:Number(item.sold_quantity||0),
                free_shipping:Boolean(item.shipping?.free_shipping),
                listing_type_id:String(item.listing_type_id||''),
                picture_count:Array.isArray(item.pictures)?item.pictures.length:0,
                description_exists:Boolean(desc.existe),
                description_length:String(desc.plain_text||'').length,
                required_attributes_total:required,
                required_attributes_filled:filled,
                required_completion:required?Math.round(100*filled/required):100,
                category_id:String(item.category_id||''),
                permalink:String(item.permalink||''),
                thumbnail:String(item.thumbnail||item.pictures?.[0]?.secure_url||''),
                reference_type:'ITEM',
                sales_signal:Number(item.sold_quantity||0)>0
                    ? `${Number(item.sold_quantity||0).toLocaleString('pt-BR')} vendidos`
                    : null
            });
        }

        items.sort((a,b)=>a.position-b.position);

        const precos=items.map(x=>x.price).filter(x=>x>0);
        const freq=new Map();
        items.forEach(x=>palavrasTituloV96(x.title).forEach(w=>freq.set(w,(freq.get(w)||0)+1)));
        const keywords=[...freq.entries()]
          .sort((a,b)=>b[1]-a[1])
          .slice(0,20)
          .map(([term,count])=>({term,count}));

        const summary={
            analyzed:items.length,
            total_search:Number(totalSearch||0),
            median_price:Number(medianaV96(precos).toFixed(2)),
            min_price:precos.length?Math.min(...precos):0,
            max_price:precos.length?Math.max(...precos):0,
            avg_sold:items.length
                ?Number((items.reduce((a,x)=>a+x.sold_quantity,0)/items.length).toFixed(1))
                :0,
            free_shipping_pct:items.length
                ?Math.round(100*items.filter(x=>x.free_shipping).length/items.length)
                :0,
            description_pct:items.length
                ?Math.round(100*items.filter(x=>x.description_exists).length/items.length)
                :0,
            avg_pictures:items.length
                ?Number((items.reduce((a,x)=>a+x.picture_count,0)/items.length).toFixed(1))
                :0,
            avg_required_completion:items.length
                ?Math.round(items.reduce((a,x)=>a+x.required_completion,0)/items.length)
                :0,
            common_title_terms:keywords
        };

        return {
            query:q,
            total_search:Number(totalSearch||0),
            items,
            summary,
            source:meta.source||'marketplace_search',
            source_label:meta.source_label||'Primeira página da busca',
            category_id:meta.category_id||null,
            category_name:meta.category_name||null,
            notice:meta.notice||null
        };
    }

    async function buscaMarketplaceDireta(){
        const url=`${ML_API}/sites/MLB/search?q=${encodeURIComponent(q)}&limit=24`;
        const sr=await mlFetch(url,token);
        const sd=await jsonSeguro(sr);

        if(!sr.ok){
            const erro=new Error(
                formatarErroMercadoLivre(sd)||
                'Não foi possível pesquisar a listagem do Mercado Livre.'
            );
            erro.status=sr.status;
            erro.data=sd;
            throw erro;
        }

        const results=Array.isArray(sd?.results)?sd.results.slice(0,24):[];

        return montarSnapshotItens(
            results,
            Number(sd?.paging?.total||0),
            {
                source:'marketplace_search',
                source_label:'Primeira página da busca',
                notice:null
            }
        );
    }

    async function preverCategoria(){
        const pr=await mlFetch(
            `${ML_API}/sites/MLB/domain_discovery/search?limit=3&q=${encodeURIComponent(q)}`,
            token
        );
        const pd=await jsonSeguro(pr);

        if(!pr.ok){
            throw Object.assign(
                new Error(
                    formatarErroMercadoLivre(pd)||
                    'Não foi possível identificar a categoria do produto.'
                ),
                {status:pr.status,data:pd}
            );
        }

        const lista=Array.isArray(pd)?pd:[];
        const primeiro=lista.find(x=>x?.category_id)||null;

        if(!primeiro?.category_id){
            throw Object.assign(
                new Error('O Mercado Livre não identificou uma categoria para este produto.'),
                {status:404}
            );
        }

        return primeiro;
    }

    async function detalheReferenciaRanking(ref,ownSeller){
        const id=String(ref?.id||'');
        const type=String(ref?.type||'').toUpperCase();
        const position=Number(ref?.position||999);

        if(!id)return null;

        if(type==='ITEM'){
            const ir=await mlFetch(`${ML_API}/items/${encodeURIComponent(id)}`,token);
            const item=await jsonSeguro(ir);
            if(!ir.ok || !item?.id)return null;
            if(ownSeller && String(item.seller_id||'')===String(ownSeller))return null;

            const [desc,defs]=await Promise.all([
                descricaoItemV96(token,id).catch(()=>({plain_text:'',existe:false})),
                definicoesCategoriaV96(token,item.category_id).catch(()=>[])
            ]);

            const ficha=montarFichaV96(item,defs);
            const required=ficha.principais.length;
            const filled=required-ficha.missingMain.length;

            return {
                position,
                id:String(item.id),
                title:String(item.title||''),
                price:Number(item.price||0),
                sold_quantity:Number(item.sold_quantity||0),
                free_shipping:Boolean(item.shipping?.free_shipping),
                listing_type_id:String(item.listing_type_id||''),
                picture_count:Array.isArray(item.pictures)?item.pictures.length:0,
                description_exists:Boolean(desc.existe),
                description_length:String(desc.plain_text||'').length,
                required_attributes_total:required,
                required_attributes_filled:filled,
                required_completion:required?Math.round(100*filled/required):100,
                category_id:String(item.category_id||''),
                permalink:String(item.permalink||''),
                thumbnail:String(item.thumbnail||item.pictures?.[0]?.secure_url||''),
                reference_type:'ITEM',
                sales_signal:`Top ${position} de mais vendidos`
            };
        }

        if(type==='PRODUCT'){
            const pr=await mlFetch(`${ML_API}/products/${encodeURIComponent(id)}`,token);
            const p=await jsonSeguro(pr);
            if(!pr.ok || !p?.id)return null;

            const pictures=Array.isArray(p.pictures)?p.pictures:[];
            const attrs=Array.isArray(p.attributes)?p.attributes:[];
            const preenchidos=attrs.filter(a=>
                a?.value_name ||
                a?.value_id ||
                (Array.isArray(a?.values)&&a.values.length)
            ).length;

            return {
                position,
                id:String(p.id),
                title:String(p.name||p.family_name||p.short_name||id),
                price:0,
                sold_quantity:0,
                free_shipping:false,
                listing_type_id:'',
                picture_count:pictures.length,
                description_exists:false,
                description_length:0,
                required_attributes_total:attrs.length,
                required_attributes_filled:preenchidos,
                required_completion:attrs.length?Math.round(100*preenchidos/attrs.length):100,
                category_id:String(p.category_id||''),
                permalink:String(p.permalink||''),
                thumbnail:String(
                    pictures?.[0]?.secure_url||
                    pictures?.[0]?.url||
                    p.main_features?.[0]?.value_name||
                    ''
                ),
                reference_type:'PRODUCT',
                sales_signal:`Top ${position} de mais vendidos`
            };
        }

        if(type==='USER_PRODUCT'){
            // User Product de outro seller pode não ser legível pela conta atual.
            // Tentamos; se a API negar, mantemos ao menos o sinal oficial do ranking.
            const ur=await mlFetch(`${ML_API}/user-products/${encodeURIComponent(id)}`,token);
            const u=await jsonSeguro(ur);

            if(ur.ok && u?.id){
                const pictures=Array.isArray(u.pictures)?u.pictures:[];
                const attrs=Array.isArray(u.attributes)?u.attributes:[];
                const preenchidos=attrs.filter(a=>
                    a?.value_name ||
                    a?.value_id ||
                    (Array.isArray(a?.values)&&a.values.length)
                ).length;

                return {
                    position,
                    id:String(u.id),
                    title:String(u.family_name||u.name||id),
                    price:0,
                    sold_quantity:0,
                    free_shipping:false,
                    listing_type_id:'',
                    picture_count:pictures.length,
                    description_exists:false,
                    description_length:0,
                    required_attributes_total:attrs.length,
                    required_attributes_filled:preenchidos,
                    required_completion:attrs.length?Math.round(100*preenchidos/attrs.length):100,
                    category_id:String(u.category_id||''),
                    permalink:'',
                    thumbnail:String(
                        pictures?.[0]?.secure_url||
                        pictures?.[0]?.url||
                        ''
                    ),
                    reference_type:'USER_PRODUCT',
                    sales_signal:`Top ${position} de mais vendidos`
                };
            }

            return {
                position,
                id,
                title:`Produto do vendedor ${id}`,
                price:0,
                sold_quantity:0,
                free_shipping:false,
                listing_type_id:'',
                picture_count:0,
                description_exists:false,
                description_length:0,
                required_attributes_total:0,
                required_attributes_filled:0,
                required_completion:0,
                category_id:'',
                permalink:'',
                thumbnail:'',
                reference_type:'USER_PRODUCT',
                sales_signal:`Top ${position} de mais vendidos`
            };
        }

        return null;
    }

    async function buscaMaisVendidosOficial(motivoFallback=''){
        const categoria=await preverCategoria();
        const categoryId=String(categoria.category_id);

        const hr=await mlFetch(
            `${ML_API}/highlights/MLB/category/${encodeURIComponent(categoryId)}`,
            token
        );
        const hd=await jsonSeguro(hr);

        if(!hr.ok){
            throw Object.assign(
                new Error(
                    formatarErroMercadoLivre(hd)||
                    'A categoria não possui ranking de mais vendidos disponível.'
                ),
                {status:hr.status,data:hd}
            );
        }

        const refs=Array.isArray(hd?.content)
            ? hd.content.slice(0,20)
            : [];

        const me=await usuarioML(token).catch(()=>({id:null}));
        const ownSeller=String(me?.id||'');

        const detalhes=await mapLimitV21(
            refs,
            6,
            ref=>detalheReferenciaRanking(ref,ownSeller)
        );

        const items=detalhes
          .filter(Boolean)
          .sort((a,b)=>a.position-b.position);

        const precos=items.map(x=>Number(x.price||0)).filter(x=>x>0);
        const freq=new Map();

        items.forEach(x=>
            palavrasTituloV96(x.title)
              .forEach(w=>freq.set(w,(freq.get(w)||0)+1))
        );

        const keywords=[...freq.entries()]
          .sort((a,b)=>b[1]-a[1])
          .slice(0,20)
          .map(([term,count])=>({term,count}));

        const itemRows=items.filter(x=>x.reference_type==='ITEM');

        const summary={
            analyzed:items.length,
            total_search:refs.length,
            median_price:Number(medianaV96(precos).toFixed(2)),
            min_price:precos.length?Math.min(...precos):0,
            max_price:precos.length?Math.max(...precos):0,
            avg_sold:itemRows.length
                ?Number((itemRows.reduce((a,x)=>a+Number(x.sold_quantity||0),0)/itemRows.length).toFixed(1))
                :0,
            free_shipping_pct:itemRows.length
                ?Math.round(100*itemRows.filter(x=>x.free_shipping).length/itemRows.length)
                :0,
            description_pct:itemRows.length
                ?Math.round(100*itemRows.filter(x=>x.description_exists).length/itemRows.length)
                :0,
            avg_pictures:items.length
                ?Number((items.reduce((a,x)=>a+Number(x.picture_count||0),0)/items.length).toFixed(1))
                :0,
            avg_required_completion:items.length
                ?Math.round(items.reduce((a,x)=>a+Number(x.required_completion||0),0)/items.length)
                :0,
            common_title_terms:keywords,
            ranking_type:'BEST_SELLER'
        };

        return {
            query:q,
            total_search:refs.length,
            items,
            summary,
            source:'highlights_category',
            source_label:'Mais vendidos da categoria',
            category_id:categoryId,
            category_name:String(categoria.category_name||''),
            notice:
              'A busca textual de anúncios retornou 403 para esta aplicação. '+
              'A análise foi automaticamente transferida para o ranking oficial de mais vendidos do Mercado Livre.'+
              (motivoFallback?` Motivo técnico: ${motivoFallback}`:'')
        };
    }

    try{
        return await buscaMarketplaceDireta();
    }catch(e){
        if(Number(e?.status)!==401 && Number(e?.status)!==403){
            throw e;
        }

        return buscaMaisVendidosOficial(
            String(e?.message||'forbidden').slice(0,160)
        );
    }
}

function fallbackRecomendacoesV96(snapshot){
    const s=snapshot.summary||{};
    const termos=(s.common_title_terms||[]).slice(0,8).map(x=>x.term).join(', ');
    const fonte=snapshot.source_label||'referências oficiais analisadas';

    return {
        diagnostic:`Análise baseada em sinais observáveis de ${fonte}. A posição e o ranking são dinâmicos e a API não expõe a fórmula de relevância.`,
        opportunities:[
            `Use somente termos realmente pertinentes ao produto que aparecem com frequência nas referências: ${termos||'revise os termos principais da categoria'}.`,
            s.median_price>0
              ?`Compare seu preço com a mediana observada de R$ ${Number(s.median_price||0).toFixed(2)} sem reduzir abaixo da sua margem.`
              :'Use preço apenas quando a referência oficial disponibilizar valor comparável.',
            `As referências analisadas usam em média ${Number(s.avg_pictures||0).toFixed(1)} fotos; priorize fotos próprias, nítidas e completas.`,
            `Preencha todas as características obrigatórias e as secundárias realmente conhecidas do produto.`
        ],
        title_strategy:'Título claro, específico, até 60 caracteres, usando o nome exato do produto e atributos confirmados mais relevantes.',
        description_strategy:'Descrição original em texto simples, complementando a ficha técnica sem copiar concorrentes.',
        image_strategy:'Use fotos próprias do produto, capa limpa e imagens adicionais mostrando ângulos e detalhes reais. Não copie imagens de terceiros.',
        pricing_strategy:'Use referências de preço apenas como comparação e respeite custo, comissão, frete, imposto e margem.',
        priority_actions:['Completar características obrigatórias','Revisar título','Revisar fotos','Revisar descrição','Comparar preço e margem'],
        caveat:'Ranking e correlação não provam causa. Nenhuma recomendação garante posição ou vendas.'
    };
}

async function recomendacoesMercadoV96(snapshot,imageDataUrl=''){
    const fallback=fallbackRecomendacoesV96(snapshot);
    if(!String(process.env.GEMINI_API_KEY||'').trim())return fallback;

    const dados=snapshot.items.slice(0,18).map(x=>({
        position:x.position,title:x.title,price:x.price,sold_quantity:x.sold_quantity,
        free_shipping:x.free_shipping,pictures:x.picture_count,description_length:x.description_length,
        required_completion:x.required_completion,listing_type_id:x.listing_type_id
    }));

    const schema={type:'object',properties:{
        diagnostic:{type:'string'},opportunities:{type:'array',items:{type:'string'}},
        title_strategy:{type:'string'},description_strategy:{type:'string'},image_strategy:{type:'string'},
        pricing_strategy:{type:'string'},priority_actions:{type:'array',items:{type:'string'}},caveat:{type:'string'}
    },required:['diagnostic','opportunities','title_strategy','description_strategy','image_strategy','pricing_strategy','priority_actions','caveat']};

    const prompt=`Analise os sinais OBSERVÁVEIS das referências oficiais do Mercado Livre Brasil para o produto "${snapshot.query}". Fonte: ${snapshot.source_label||snapshot.source||'Mercado Livre'}. Categoria: ${snapshot.category_name||snapshot.category_id||'não informada'}.
Não afirme conhecer a fórmula de ranking. Não diga que um fator causa posição ou vendas; use termos como correlação, padrão observado e hipótese prática.
Não copie títulos, descrições ou imagens. Gere estratégias originais.
Dados agregados: ${JSON.stringify(snapshot.summary)}
Amostra ordenada por posição: ${JSON.stringify(dados)}
Objetivo: encontrar padrões úteis de título, conteúdo, fotos, preço, frete e completude da ficha para melhorar anúncios próprios sem inventar especificações e sem prometer vendas.`;

    const input=[{type:'text',text:prompt}];
    if(imageDataUrl){
        try{
            const parsed=parseDataUrlV37(imageDataUrl);
            if(parsed?.data){
                const buf=Buffer.from(parsed.data,'base64');
                if(buf.length<=6*1024*1024)input.push({type:'image',mime_type:parsed.mime||'image/jpeg',data:buf.toString('base64')});
            }
        }catch(e){}
    }

    try{
        const g=await chamarGeminiInteracao({
            input,
            systemInstruction:'Você é um analista de marketplace. Use somente os dados fornecidos e fatos visuais claros. Não invente características do produto, não copie conteúdo de concorrentes e não prometa ranking ou vendas.',
            responseSchema:schema
        });
        const obj=extrairJsonIA(g.texto);
        return {...fallback,...obj,model:g.model};
    }catch(e){
        return {...fallback,ai_warning:e.message};
    }
}

async function executarAnaliseMercadoV96({token,produto,imageDataUrl=''}){
    const snapshot=await buscarPrimeiraPaginaMercadoV96(token,produto);
    const recommendations=await recomendacoesMercadoV96(snapshot,imageDataUrl);
    return {snapshot,recommendations};
}

async function salvarRunMonitorV96(monitorId,snapshot,recommendations){
    await dbQuery(`INSERT INTO ml_product_monitor_runs_v96(monitor_id,snapshot,recommendations) VALUES($1,$2::jsonb,$3::jsonb)`,[
        monitorId,JSON.stringify(snapshot),JSON.stringify(recommendations)
    ]);
    await dbQuery(`DELETE FROM ml_product_monitor_runs_v96 WHERE monitor_id=$1 AND id NOT IN (SELECT id FROM ml_product_monitor_runs_v96 WHERE monitor_id=$1 ORDER BY created_at DESC LIMIT 30)`,[monitorId]);
}

app.post('/api/v96/inteligencia/analisar',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');
    const produto=String(req.body?.produto||'').trim().slice(0,300);
    const sku=String(req.body?.sku||'').trim().slice(0,200);
    const imageDataUrl=String(req.body?.image_data_url||'');
    const monitor=Boolean(req.body?.monitor);
    if(!produto)return respostaErro(res,400,'Informe o nome do produto.');
    try{
        const out=await executarAnaliseMercadoV96({token,produto,imageDataUrl});
        let monitorId=null;
        if(monitor){
            await garantirInteligenciaV96();
            const r=await dbQuery(`
              INSERT INTO ml_product_monitors_v96(workspace_id,user_id,seller_id,product_name,search_query,target_sku,enabled,interval_minutes,last_scan_at,next_scan_at,last_snapshot,last_recommendations,updated_at)
              VALUES($1,$2,$3,$4,$4,$5,TRUE,60,NOW(),NOW()+INTERVAL '60 minutes',$6::jsonb,$7::jsonb,NOW())
              RETURNING id
            `,[
                String(req.mlhubUser?.wid||''),String(req.mlhubUser?.uid||''),String(req.mlhubSellerId||''),produto,sku||null,
                JSON.stringify(out.snapshot),JSON.stringify(out.recommendations)
            ]);
            monitorId=Number(r.rows[0]?.id||0)||null;
            if(monitorId)await salvarRunMonitorV96(monitorId,out.snapshot,out.recommendations);
        }
        res.json({sucesso:true,monitor_id:monitorId,...out});
    }catch(e){respostaErro(res,e.status||500,'Erro na análise de mercado: '+e.message)}
});

app.get('/api/v96/inteligencia/monitores',async(req,res)=>{
    try{
        await garantirInteligenciaV96();
        const r=await dbQuery(`
          SELECT id,product_name,search_query,target_sku,enabled,interval_minutes,last_scan_at,next_scan_at,last_snapshot,last_recommendations,last_error,updated_at
          FROM ml_product_monitors_v96
          WHERE workspace_id=$1 AND user_id=$2 AND seller_id=$3
          ORDER BY updated_at DESC
          LIMIT 100
        `,[String(req.mlhubUser?.wid||''),String(req.mlhubUser?.uid||''),String(req.mlhubSellerId||'')]);
        res.json({sucesso:true,itens:r.rows});
    }catch(e){respostaErro(res,500,'Erro ao carregar monitores: '+e.message)}
});

app.patch('/api/v96/inteligencia/monitores/:id',async(req,res)=>{
    try{
        await garantirInteligenciaV96();
        const enabled=Boolean(req.body?.enabled);
        const interval=Math.max(30,Math.min(1440,Number(req.body?.interval_minutes||60)));
        const r=await dbQuery(`
          UPDATE ml_product_monitors_v96 SET enabled=$5,interval_minutes=$6,
            next_scan_at=CASE WHEN $5 THEN LEAST(next_scan_at,NOW()) ELSE next_scan_at END,updated_at=NOW()
          WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND seller_id=$4
          RETURNING *
        `,[Number(req.params.id),String(req.mlhubUser?.wid||''),String(req.mlhubUser?.uid||''),String(req.mlhubSellerId||''),enabled,interval]);
        if(!r.rowCount)return respostaErro(res,404,'Monitor não encontrado.');
        res.json({sucesso:true,item:r.rows[0]});
    }catch(e){respostaErro(res,500,e.message)}
});

app.post('/api/v96/inteligencia/monitores/:id/executar',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');
    try{
        await garantirInteligenciaV96();
        const mr=await dbQuery(`SELECT * FROM ml_product_monitors_v96 WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND seller_id=$4 LIMIT 1`,[
            Number(req.params.id),String(req.mlhubUser?.wid||''),String(req.mlhubUser?.uid||''),String(req.mlhubSellerId||'')
        ]);
        const m=mr.rows[0];if(!m)return respostaErro(res,404,'Monitor não encontrado.');
        const out=await executarAnaliseMercadoV96({token,produto:m.search_query});
        await dbQuery(`UPDATE ml_product_monitors_v96 SET last_scan_at=NOW(),next_scan_at=NOW()+($2::text||' minutes')::interval,last_snapshot=$3::jsonb,last_recommendations=$4::jsonb,last_error=NULL,locked_until=NULL,updated_at=NOW() WHERE id=$1`,[
            m.id,String(Math.max(30,Number(m.interval_minutes||60))),JSON.stringify(out.snapshot),JSON.stringify(out.recommendations)
        ]);
        await salvarRunMonitorV96(m.id,out.snapshot,out.recommendations);
        res.json({sucesso:true,...out});
    }catch(e){respostaErro(res,e.status||500,e.message)}
});

app.get('/api/v96/inteligencia/monitores/:id/historico',async(req,res)=>{
    try{
        await garantirInteligenciaV96();
        const own=await dbQuery(`SELECT id FROM ml_product_monitors_v96 WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND seller_id=$4`,[
            Number(req.params.id),String(req.mlhubUser?.wid||''),String(req.mlhubUser?.uid||''),String(req.mlhubSellerId||'')
        ]);
        if(!own.rowCount)return respostaErro(res,404,'Monitor não encontrado.');
        const r=await dbQuery(`SELECT id,snapshot,recommendations,created_at FROM ml_product_monitor_runs_v96 WHERE monitor_id=$1 ORDER BY created_at DESC LIMIT 30`,[Number(req.params.id)]);
        res.json({sucesso:true,itens:r.rows});
    }catch(e){respostaErro(res,500,e.message)}
});

app.post('/api/v96/inteligencia/melhorar',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');
    const itemId=String(req.body?.item_id||'').trim();
    const monitorId=Number(req.body?.monitor_id||0);
    if(!itemId||!monitorId)return respostaErro(res,400,'Informe o anúncio e a análise de mercado.');
    try{
        await garantirInteligenciaV96();
        const mr=await dbQuery(`SELECT * FROM ml_product_monitors_v96 WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND seller_id=$4 LIMIT 1`,[
            monitorId,String(req.mlhubUser?.wid||''),String(req.mlhubUser?.uid||''),String(req.mlhubSellerId||'')
        ]);
        const m=mr.rows[0];if(!m)return respostaErro(res,404,'Monitor não encontrado.');
        const own=await detalheConteudoAnuncioV96(token,itemId);
        if(req.mlhubSellerId&&String(own.seller_id)!==String(req.mlhubSellerId))return respostaErro(res,403,'Anúncio de outra conta.');

        const defs=[...own.principais,...own.secundarias].map(x=>({id:x.id,name:x.name,current:x.value,required:x.required,value_type:x.value_type}));
        const market={summary:m.last_snapshot?.summary||{},recommendations:m.last_recommendations||{},top:(m.last_snapshot?.items||[]).slice(0,12).map(x=>({position:x.position,title:x.title,price:x.price,sold:x.sold_quantity,free_shipping:x.free_shipping,pictures:x.picture_count,required_completion:x.required_completion}))};

        const fallback={
            title:own.title,
            description:own.description,
            attributes:[],
            needs_input:own.missing_main.map(x=>({id:x.id,name:x.name,reason:'Característica obrigatória faltando; precisa de dado real do produto.'})),
            image_recommendations:[m.last_recommendations?.image_strategy||'Revise capa e fotos adicionais com imagens próprias do produto.'],
            rationale:'A IA não estava disponível; revise as recomendações de mercado e preencha apenas dados confirmados.'
        };

        if(!String(process.env.GEMINI_API_KEY||'').trim())return res.json({sucesso:true,proposal:fallback});

        const schema={type:'object',properties:{
            title:{type:'string'},description:{type:'string'},
            attributes:{type:'array',items:{type:'object',properties:{id:{type:'string'},value_name:{type:'string'}},required:['id','value_name']}},
            needs_input:{type:'array',items:{type:'object',properties:{id:{type:'string'},name:{type:'string'},reason:{type:'string'}},required:['id','name','reason']}},
            image_recommendations:{type:'array',items:{type:'string'}},rationale:{type:'string'}
        },required:['title','description','attributes','needs_input','image_recommendations','rationale']};

        const prompt=`Melhore um anúncio PRÓPRIO usando padrões observados na primeira página, sem copiar concorrentes e sem inventar especificações.
ANÚNCIO PRÓPRIO: ${JSON.stringify({title:own.title,description:own.description,attributes:defs,sold_quantity:own.sold_quantity,picture_count:own.picture_count})}
MERCADO OBSERVADO: ${JSON.stringify(market)}
REGRAS:
- título máximo 60 caracteres;
- descrição original em texto simples;
- só proponha valor de atributo quando ele estiver claramente confirmado pelo próprio anúncio (título, descrição ou atributos existentes). Nunca deduza uma especificação do concorrente;
- atributos obrigatórios sem prova vão em needs_input, não em attributes;
- não copie fotos; apenas recomende quais fotos próprias produzir;
- nenhuma afirmação de ranking ou venda garantida.`;
        const g=await chamarGeminiInteracao({input:prompt,systemInstruction:'Você otimiza anúncios de marketplace com foco em clareza e completude. Não invente fatos do produto e não copie conteúdo de terceiros.',responseSchema:schema});
        const proposal={...fallback,...extrairJsonIA(g.texto),model:g.model};
        proposal.title=String(proposal.title||own.title).slice(0,60);
        const validIds=new Set(defs.map(x=>x.id));
        proposal.attributes=(Array.isArray(proposal.attributes)?proposal.attributes:[]).filter(x=>validIds.has(String(x.id))&&String(x.value_name||'').trim());
        res.json({sucesso:true,proposal});
    }catch(e){respostaErro(res,e.status||500,'Erro ao gerar melhoria: '+e.message)}
});

async function executarMonitorBackgroundV96(m){
    const token=await tokenParaSellerV95(String(m.seller_id));
    if(!token)throw new Error('Token da conta Mercado Livre indisponível.');
    const out=await executarAnaliseMercadoV96({token,produto:m.search_query});
    await dbQuery(`UPDATE ml_product_monitors_v96 SET last_scan_at=NOW(),next_scan_at=NOW()+($2::text||' minutes')::interval,last_snapshot=$3::jsonb,last_recommendations=$4::jsonb,last_error=NULL,locked_until=NULL,updated_at=NOW() WHERE id=$1`,[
        m.id,String(Math.max(30,Number(m.interval_minutes||60))),JSON.stringify(out.snapshot),JSON.stringify(out.recommendations)
    ]);
    await salvarRunMonitorV96(m.id,out.snapshot,out.recommendations);
}

async function processarMonitoresV96(){
    if(monitorInteligenciaBusyV96||!db)return;
    monitorInteligenciaBusyV96=true;
    try{
        await garantirInteligenciaV96();
        const client=await dbConnectComRetryV104();
        let lista=[];
        try{
            await client.query('BEGIN');
            const r=await client.query(`
              SELECT * FROM ml_product_monitors_v96
              WHERE enabled=TRUE AND next_scan_at<=NOW() AND (locked_until IS NULL OR locked_until<NOW())
              ORDER BY next_scan_at ASC
              FOR UPDATE SKIP LOCKED
              LIMIT 2
            `);
            lista=r.rows;
            for(const m of lista){
                await client.query(`UPDATE ml_product_monitors_v96 SET locked_until=NOW()+INTERVAL '15 minutes',updated_at=NOW() WHERE id=$1`,[m.id]);
            }
            await client.query('COMMIT');
        }catch(e){try{await client.query('ROLLBACK')}catch(_){};throw e}
        finally{client.release()}

        for(const m of lista){
            try{await executarMonitorBackgroundV96(m)}
            catch(e){
                await dbQuery(`UPDATE ml_product_monitors_v96 SET last_error=$2,next_scan_at=NOW()+INTERVAL '20 minutes',locked_until=NULL,updated_at=NOW() WHERE id=$1`,[m.id,String(e.message||e).slice(0,1000)]).catch(()=>{});
            }
        }
    }catch(e){console.warn('[INTELIGENCIA V96 WORKER]',e.message)}
    finally{monitorInteligenciaBusyV96=false}
}

function iniciarMonitorInteligenciaV96(){
    if(monitorInteligenciaTimerV96)return;
    monitorInteligenciaTimerV96=setInterval(()=>processarMonitoresV96(),5*60*1000);
    setTimeout(()=>processarMonitoresV96(),15000);
}

let coreEscalaIniciadoV80=false;

async function iniciarCoreEscala(){
    if(coreEscalaIniciadoV80)return;
    try{
        if(!db){
            console.warn('[ESCALA] PostgreSQL não configurado.');
            return;
        }

        // Não abandona a inicialização se o PostgreSQL do Render estiver reiniciando.
        await aguardarPostgresProntoV80();
        await inicializarBancoEscala();
        await inicializarBuscaRapidaV103();

        try{
            await inicializarAgentesV62();
            await inicializarAcervoV65();
            iniciarAtualizacaoAgentesV62();
        }catch(e){
            console.error('[AGENTES INIT V62]',e.message);
        }

        try{
            await garantirInteligenciaV96();
            iniciarMonitorInteligenciaV96();
        }catch(e){
            console.error('[INTELIGENCIA INIT V96]',e.message);
        }

        if(ML_WORKER_ENABLED){
            // V106: após restart do Render, os jobs que estavam "running"
            // pertencem ao processo anterior e devem voltar para queued.
            await normalizarJobsFullSyncV106({startup:true});

            coreEscalaIniciadoV80=true;
            syncWorkerDedicadoV76();
            for(let i=1;i<=ML_WORKER_CONCURRENCY;i++)workerLoop(i);
            iniciarRecoverySyncV106();

            console.log(`[ESCALA V107] ${ML_WORKER_CONCURRENCY} worker(s) + worker dedicado de sync iniciados · checkpoint + recovery automático ativos.`);
        }
    }catch(e){
        console.error('[ESCALA INIT V80]',e);
        if(erroPostgresTemporarioV80(e)){
            console.warn('[ESCALA INIT V80] PostgreSQL temporariamente indisponível. Reiniciando inicialização em 5s.');
            setTimeout(()=>iniciarCoreEscala().catch(err=>console.error('[ESCALA RETRY V80]',err)),5000);
        }
    }
}
iniciarCoreEscala();


// V57 \u2014 Consulta simplificada das linhas do guia de tamanho.
// O frontend usa esta rota para transformar automaticamente Tamanho -> SIZE_GRID_ROW_ID.
app.get('/api/v57/criar/guia-tamanho/:gridId', async (req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');
    const gridId=String(req.params.gridId||'').trim();
    if(!gridId)return respostaErro(res,400,'Informe o c\u00f3digo do guia de tamanho.');
    try{
        const chart=await obterChartV55(token,gridId);
        const rows=extrairRowsChartV55(chart);
        if(!rows.length){
            return respostaErro(res,422,`O guia ${gridId} foi encontrado, mas a API n\u00e3o retornou as linhas de tamanho. Abra o guia no Mercado Livre e confirme que ele possui numera\u00e7\u00f5es cadastradas.`);
        }
        const saida=rows.map((row,i)=>{
            const row_id=formatarGridRowIdV55(gridId,row);
            const sizes=valoresRowChartV55(chart,row);
            const label=sizes.join(' \u00b7 ') || `Linha ${i+1}`;
            return {
                row_id,
                row_number:String(row?.id??row?.row_id??i+1),
                label,
                sizes,
                size_values:valoresTamanhoGuiaV60(chart,row),
                size_attribute:atributoSizeDaLinhaGuiaV60(chart,row),
                main_attribute_id:String(chart?.main_attribute_id||''),
                attributes:Array.isArray(row?.attributes)?row.attributes:[]
            };
        }).filter(x=>x.row_id);
        res.json({sucesso:true,grid_id:String(chart?.id||gridId),main_attribute_id:chart?.main_attribute_id||null,total:saida.length,rows:saida});
    }catch(e){
        respostaErro(res,500,'Erro ao consultar o guia de tamanho: '+e.message);
    }
});

app.listen(
    PORT,
    () => {
        console.log(
            `Servidor rodando na porta ${PORT}`
        );
    }
);
