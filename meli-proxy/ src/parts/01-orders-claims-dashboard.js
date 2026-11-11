
/* =========================================================
   3. ROTA ORIGINAL - SINCRONIZAR FRETES
========================================================= */

app.post('/api/sincronizar-fretes', async (req, res) => {
    let token = obterToken(req);

    if (!token) {
        return res.status(401).json({
            erro: "Token n\u00e3o fornecido"
        });
    }

    const { ids } = req.body;

    if (
        !ids ||
        !Array.isArray(ids) ||
        ids.length === 0
    ) {
        return res.status(400).json({
            erro:
                "Lista de IDs inv\u00e1lida."
        });
    }

    let fretesMap = {};

    try {
        for (
            let i = 0;
            i < ids.length;
            i += 20
        ) {
            const blocoIds =
                ids
                    .slice(i, i + 20)
                    .join(',');

            const multiRes =
                await mlFetch(
                    `${ML_API}/items?ids=${blocoIds}`,
                    token
                );

            const multiData =
                await jsonSeguro(multiRes);

            if (Array.isArray(multiData)) {
                const itensValidos = multiData
                    .filter(itemObj => itemObj.code === 200 && itemObj.body)
                    .map(itemObj => itemObj.body);

                // Consulta os custos em paralelo para acelerar lotes grandes,
                // sem alterar o carregamento normal dos an\u00fancios.
                const concorrencia = 20;
                for (let j = 0; j < itensValidos.length; j += concorrencia) {
                    const grupo = itensValidos.slice(j, j + concorrencia);
                    const resultados = await Promise.all(
                        grupo.map(async body => {
                            const freeShipping = Boolean(body.shipping?.free_shipping);
                            const custoEnvio = await calcularFreteExato(body, token);
                            return { body, freeShipping, custoEnvio };
                        })
                    );

                    for (const { body, freeShipping, custoEnvio } of resultados) {
                        fretesMap[body.id] = {
                            custo: custoEnvio,
                            shipping_cost: custoEnvio,
                            gratis: freeShipping,
                            free_shipping: freeShipping
                        };
                    }
                }
            }
        }

        res.json({
            fretes: fretesMap
        });

    } catch (e) {
        res.status(500).json({
            erro:
                "Erro ao buscar fretes: " +
                e.message
        });
    }
});

/* =========================================================
   4. ROTA ORIGINAL - ATUALIZAR PRE\u00c7O
========================================================= */

app.post('/api/atualizar-preco', async (req, res) => {
    let token = obterToken(req);

    if (!token) {
        return res.status(401).json({
            erro: "Token n\u00e3o fornecido"
        });
    }

    const {
        id,
        price
    } = req.body;

    if (
        !id ||
        price === undefined
    ) {
        return res.status(400).json({
            erro:
                "ID ou pre\u00e7o n\u00e3o informados."
        });
    }

    try {
        const mlRes =
            await mlFetch(
                `${ML_API}/items/${id}`,
                token,
                {
                    method: 'PUT',
                    headers: {
                        'Content-Type':
                            'application/json'
                    },
                    body:
                        JSON.stringify({
                            price:
                                Number(price)
                        })
                }
            );

        const mlData =
            await jsonSeguro(mlRes);

        if (mlRes.ok) {
            res.json({
                sucesso: true,
                resultado:
                    mlData
            });
        } else {
            const mensagemErro =
                formatarErroMercadoLivre(
                    mlData
                );

            res.status(400).json({
                erro:
                    mensagemErro
            });
        }

    } catch (e) {
        res.status(500).json({
            erro:
                "Erro de conex\u00e3o ao atualizar pre\u00e7o: " +
                e.message
        });
    }
});

/* =========================================================
   V35 \u2014 ATUALIZA\u00c7\u00c3O DE PRE\u00c7OS ROBUSTA
========================================================= */

const esperarV35 = ms => new Promise(resolve => setTimeout(resolve, ms));
let precoCooldownAteV35 = 0;

// V75 — transporte persistente para atualização de preço em alta escala.
// Reutiliza conexões TLS em vez de abrir uma conexão nova para cada anúncio.
const ML_PRICE_KEEP_ALIVE_AGENT_V75 = new https.Agent({
    keepAlive:true,
    keepAliveMsecs:15000,
    maxSockets:Math.max(16,Math.min(96,Number(process.env.ML_PRICE_MAX_SOCKETS||64))),
    maxFreeSockets:Math.max(8,Math.min(48,Number(process.env.ML_PRICE_MAX_FREE_SOCKETS||32))),
    timeout:30000
});


function statusItemPtV35(status){
    const mapa={
        active:'ativo',
        paused:'pausado',
        closed:'encerrado/finalizado',
        inactive:'inativo',
        under_review:'em revis\u00e3o pelo Mercado Livre',
        payment_required:'aguardando regulariza\u00e7\u00e3o de pagamento'
    };
    return mapa[String(status||'').toLowerCase()]||String(status||'desconhecido');
}

function motivoBloqueioStatusV35(status){
    const st=String(status||'').toLowerCase();

    if(st==='under_review'){
        return 'O an\u00fancio est\u00e1 em revis\u00e3o pelo Mercado Livre. Enquanto a revis\u00e3o n\u00e3o terminar, o pre\u00e7o n\u00e3o pode ser alterado pela API.';
    }
    if(st==='closed'){
        return 'O an\u00fancio est\u00e1 encerrado/finalizado no Mercado Livre. An\u00fancios encerrados n\u00e3o permitem altera\u00e7\u00e3o de pre\u00e7o.';
    }
    if(st==='paused'){
        return 'O an\u00fancio est\u00e1 pausado. O Mercado Livre n\u00e3o permite alterar o pre\u00e7o desse an\u00fancio por este processo enquanto ele estiver pausado.';
    }
    if(st==='inactive'){
        return 'O an\u00fancio est\u00e1 inativo. O pre\u00e7o n\u00e3o pode ser alterado enquanto ele estiver nesse estado.';
    }
    if(st==='payment_required'){
        return 'O an\u00fancio est\u00e1 bloqueado aguardando regulariza\u00e7\u00e3o de pagamento. O pre\u00e7o n\u00e3o pode ser alterado enquanto esse bloqueio existir.';
    }

    if(st==='active'){
        return 'O an\u00fancio est\u00e1 ativo, mas o Mercado Livre marcou o pre\u00e7o como n\u00e3o edit\u00e1vel neste momento. Isso pode acontecer por revis\u00e3o/modera\u00e7\u00e3o, promo\u00e7\u00e3o ou automatiza\u00e7\u00e3o de pre\u00e7o, cat\u00e1logo ou outra restri\u00e7\u00e3o tempor\u00e1ria da publica\u00e7\u00e3o.';
    }

    return `O an\u00fancio est\u00e1 com status "${statusItemPtV35(status)}" e o Mercado Livre n\u00e3o permite alterar o pre\u00e7o nesse estado.`;
}

function traduzirErroPrecoV35({httpStatus,codigo,mensagem,itemStatus,dynamicPricing=false}){
    const code=String(codigo||'').toLowerCase();
    const msg=String(mensagem||'');
    const lower=msg.toLowerCase();
    const status=String(itemStatus||'').toLowerCase();

    if(httpStatus===429 || code==='too_many_requests' || lower.includes('too many requests') || lower.includes('quota exceeded')){
        return {
            tipo:'temporario',
            retryable:true,
            mensagem:'O Mercado Livre limitou temporariamente a quantidade de altera\u00e7\u00f5es de pre\u00e7o. O sistema aguardou e tentou novamente automaticamente, mas o limite ainda estava ativo. Aguarde alguns minutos e tente somente os an\u00fancios restantes.'
        };
    }

    if(dynamicPricing || lower.includes('dynamic pricing')){
        return {
            tipo:'bloqueio',
            retryable:false,
            mensagem:'Este an\u00fancio est\u00e1 com Automatiza\u00e7\u00e3o de Pre\u00e7os configurada no Mercado Livre. O Mercado Livre bloqueia a altera\u00e7\u00e3o manual do pre\u00e7o pela API enquanto essa automatiza\u00e7\u00e3o estiver ativa.'
        };
    }

    if(code==='item.price.not_modifiable' || lower.includes('cannot update item') || lower.includes('price.not_modifiable')){
        if(status){
            return {
                tipo:'bloqueio',
                retryable:false,
                mensagem:motivoBloqueioStatusV35(status)
            };
        }

        const statusMatch=lower.match(/status\s*:\s*([a-z_]+)/i);
        if(statusMatch?.[1]){
            return {
                tipo:'bloqueio',
                retryable:false,
                mensagem:motivoBloqueioStatusV35(statusMatch[1])
            };
        }

        return {
            tipo:'bloqueio',
            retryable:false,
            mensagem:'O Mercado Livre bloqueou a edi\u00e7\u00e3o do pre\u00e7o deste an\u00fancio. Isso pode acontecer quando o an\u00fancio est\u00e1 em revis\u00e3o, encerrado, inativo ou possui uma regra de pre\u00e7o que impede edi\u00e7\u00e3o pela API.'
        };
    }

    if(httpStatus===401 || code==='unauthorized' || code==='invalid_token'){
        return {
            tipo:'autenticacao',
            retryable:false,
            mensagem:'A autoriza\u00e7\u00e3o da conta do Mercado Livre expirou ou n\u00e3o \u00e9 v\u00e1lida. Reconecte a conta antes de tentar atualizar os pre\u00e7os.'
        };
    }

    if(httpStatus===403 || code==='forbidden'){
        return {
            tipo:'permissao',
            retryable:false,
            mensagem:'O Mercado Livre recusou a altera\u00e7\u00e3o porque a conta ou o aplicativo n\u00e3o possui permiss\u00e3o para editar esse an\u00fancio.'
        };
    }

    if(httpStatus===404 || code==='not_found' || code==='item_not_found'){
        return {
            tipo:'bloqueio',
            retryable:false,
            mensagem:'O an\u00fancio n\u00e3o foi encontrado pelo Mercado Livre ou n\u00e3o pertence mais \u00e0 conta conectada.'
        };
    }

    if([500,502,503,504].includes(Number(httpStatus))){
        return {
            tipo:'temporario',
            retryable:true,
            mensagem:'O Mercado Livre apresentou uma instabilidade tempor\u00e1ria ao alterar este pre\u00e7o. O sistema tentou novamente automaticamente, mas a API continuou indispon\u00edvel.'
        };
    }

    if(httpStatus===400){
        return {
            tipo:'validacao',
            retryable:false,
            mensagem:'O Mercado Livre recusou esse novo pre\u00e7o por uma regra de valida\u00e7\u00e3o do an\u00fancio. Verifique o estado do an\u00fancio, promo\u00e7\u00f5es ativas, automatiza\u00e7\u00e3o de pre\u00e7os e os limites permitidos para o valor.'
        };
    }

    return {
        tipo:'erro',
        retryable:false,
        mensagem:msg
            ? `O Mercado Livre recusou a atualiza\u00e7\u00e3o. Detalhe recebido: ${msg}`
            : 'O Mercado Livre recusou a atualiza\u00e7\u00e3o do pre\u00e7o sem informar um motivo detalhado.'
    };
}

async function esperarCooldownPrecoV35(){
    const restante=precoCooldownAteV35-Date.now();
    if(restante>0)await esperarV35(restante);
}

async function atualizarPrecoItemV35(item,token,meta={}){
    // V75: timeout por chamada + keep-alive + retry curto.
    const maxTentativas=Math.max(2,Math.min(4,Number(process.env.ML_PRICE_UPDATE_RETRIES||3)));
    const timeoutMs=Math.max(5000,Math.min(30000,Number(process.env.ML_PRICE_REQUEST_TIMEOUT_MS||12000)));
    let ultimo=null;

    for(let tentativa=1;tentativa<=maxTentativas;tentativa++){
        await esperarCooldownPrecoV35();

        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),timeoutMs);

        try{
            const mlRes=await mlFetch(
                `${ML_API}/items/${item.id}`,
                token,
                {
                    method:'PUT',
                    headers:{
                        'Content-Type':'application/json',
                        'Accept':'application/json',
                        'Connection':'keep-alive'
                    },
                    body:JSON.stringify({price:Number(item.price)}),
                    signal:controller.signal,
                    agent:ML_PRICE_KEEP_ALIVE_AGENT_V75
                }
            );

            const mlData=await jsonSeguro(mlRes);

            const warning=(Array.isArray(mlData?.warnings)?mlData.warnings:[])
                .find(w=>String(w?.code||'').toLowerCase()==='item.price.not_modifiable');

            if(mlRes.ok && !warning){
                return {
                    id:item.id,
                    sucesso:true,
                    requested_price:Number(item.price),
                    price:Number(mlData?.price ?? item.price),
                    http_status:mlRes.status,
                    tentativas:tentativa
                };
            }

            const codigo=
                warning?.code ||
                mlData?.cause?.[0]?.code ||
                mlData?.error ||
                null;

            const mensagemOriginal=
                warning?.message ||
                mlData?.message ||
                formatarErroMercadoLivre(mlData) ||
                `HTTP ${mlRes.status}`;

            const traduzido=traduzirErroPrecoV35({
                httpStatus:mlRes.status,
                codigo,
                mensagem:mensagemOriginal,
                itemStatus:meta.status,
                dynamicPricing:Boolean(meta.dynamicPricing)
            });

            ultimo={
                id:item.id,
                sucesso:false,
                requested_price:Number(item.price),
                http_status:mlRes.status,
                codigo,
                erro:traduzido.mensagem,
                erro_tecnico:mensagemOriginal,
                tipo_falha:traduzido.tipo,
                retryable:Boolean(traduzido.retryable),
                tentativas:tentativa
            };

            if(!traduzido.retryable || tentativa>=maxTentativas){
                return ultimo;
            }

            const retryAfter=Number(mlRes.headers.get('retry-after')||0);
            const espera=retryAfter>0
                ? Math.min(20000,retryAfter*1000)
                : Math.min(8000,450*Math.pow(2,tentativa-1));

            if(mlRes.status===429){
                precoCooldownAteV35=Math.max(precoCooldownAteV35,Date.now()+espera);
            }

            await esperarV35(espera);
        }catch(err){
            const timeout=err?.name==='AbortError';
            ultimo={
                id:item.id,
                sucesso:false,
                requested_price:Number(item.price),
                http_status:null,
                codigo:timeout?'request_timeout':'network_error',
                erro:timeout
                  ? 'A chamada ao Mercado Livre demorou além do limite e foi reenviada automaticamente.'
                  : 'Falha temporária de conexão ao atualizar o preço. O sistema tentou novamente automaticamente.',
                erro_tecnico:String(err?.message||err||'Falha de conexão.'),
                tipo_falha:'temporario',
                retryable:true,
                tentativas:tentativa
            };

            if(tentativa>=maxTentativas)return ultimo;
            await esperarV35(Math.min(5000,350*Math.pow(2,tentativa-1)));
        }finally{
            clearTimeout(timer);
        }
    }

    return ultimo;
}

/* =========================================================
   5. ROTA ORIGINAL - ATUALIZA\u00c7\u00c3O EM LOTE
========================================================= */

app.post('/api/atualizar-precos', async (req, res) => {
    const token=obterToken(req);

    if(!token){
        return res.status(401).json({erro:'Token n\u00e3o fornecido'});
    }

    const itens=Array.isArray(req.body?.itens)?req.body.itens:[];

    if(!itens.length){
        return res.status(400).json({
            erro:'Nenhum item informado para atualiza\u00e7\u00e3o em lote.'
        });
    }

    try{
        const metaPorId=new Map();

        if(db){
            try{
                const ids=itens.map(x=>String(x.id));
                const r=await dbQuery(`
                    SELECT item_id,status,raw
                    FROM ml_items
                    WHERE item_id=ANY($1::text[])
                `,[ids]);

                for(const row of r.rows){
                    const tags=Array.isArray(row?.raw?.tags)?row.raw.tags:[];
                    metaPorId.set(String(row.item_id),{
                        status:String(row.status||''),
                        dynamicPricing:tags.includes('dynamic_standard_price')
                    });
                }
            }catch(e){
                console.warn('[PRE\u00c7O V35 META]',e.message);
            }
        }

        const resultados=new Array(itens.length);
        const concorrencia=Math.max(1,Math.min(3,Number(process.env.ML_PRICE_UPDATE_CONCURRENCY||2)));
        const intervalo=Math.max(250,Math.min(2000,Number(process.env.ML_PRICE_UPDATE_DELAY_MS||450)));
        let cursor=0;

        async function worker(){
            while(true){
                const idx=cursor++;
                if(idx>=itens.length)return;

                const item=itens[idx];
                const meta=metaPorId.get(String(item.id))||{};
                const status=String(meta.status||'').toLowerCase();

                if(status && status!=='active'){
                    resultados[idx]={
                        id:item.id,
                        sucesso:false,
                        requested_price:Number(item.price),
                        http_status:400,
                        codigo:'item.price.not_modifiable',
                        erro:motivoBloqueioStatusV35(status),
                        erro_tecnico:`status:${status}`,
                        tipo_falha:'bloqueio',
                        retryable:false,
                        bloqueado:true,
                        tentativas:0
                    };
                    continue;
                }

                if(meta.dynamicPricing){
                    resultados[idx]={
                        id:item.id,
                        sucesso:false,
                        requested_price:Number(item.price),
                        http_status:400,
                        codigo:'item.price.not_modifiable',
                        erro:'Este an\u00fancio est\u00e1 com Automatiza\u00e7\u00e3o de Pre\u00e7os configurada no Mercado Livre. O pre\u00e7o n\u00e3o pode ser alterado manualmente pela API enquanto essa automatiza\u00e7\u00e3o estiver ativa.',
                        erro_tecnico:'dynamic_standard_price',
                        tipo_falha:'bloqueio',
                        retryable:false,
                        bloqueado:true,
                        tentativas:0
                    };
                    continue;
                }

                resultados[idx]=await atualizarPrecoItemV35(item,token,meta);
                await esperarV35(intervalo);
            }
        }

        await Promise.all(
            Array.from({length:Math.min(concorrencia,itens.length)},()=>worker())
        );

        try{
            if(db){
                const sucessos=resultados.filter(x=>x?.sucesso);
                const mapaPreco=new Map(itens.map(x=>[String(x.id),Number(x.price||0)]));

                if(sucessos.length){
                    const params=[];
                    const values=[];

                    sucessos.forEach(x=>{
                        const base=params.length;
                        params.push(String(x.id),mapaPreco.get(String(x.id)));
                        values.push(`($${base+1}::text,$${base+2}::numeric)`);
                    });

                    await dbQuery(`
                        UPDATE ml_items AS m SET
                          price=v.price,
                          net_received=GREATEST(0,v.price-m.sale_fee-m.shipping_cost),
                          freight_synced_at=NULL,
                          freight_last_attempt_at=NULL,
                          synced_at=NOW()
                        FROM (VALUES ${values.join(',')}) AS v(item_id,price)
                        WHERE m.item_id=v.item_id
                    `,params);
                }
            }
        }catch(e){
            console.warn('[DB PRE\u00c7OS]',e.message);
        }

        res.json({
            sucesso:true,
            resultados,
            resumo:{
                total:resultados.length,
                atualizados:resultados.filter(x=>x?.sucesso).length,
                bloqueados:resultados.filter(x=>x?.bloqueado).length,
                temporarios:resultados.filter(x=>!x?.sucesso&&x?.tipo_falha==='temporario').length,
                falhas:resultados.filter(x=>!x?.sucesso).length
            }
        });
    }catch(err){
        res.status(500).json({
            erro:'Erro ao atualizar pre\u00e7os: '+err.message
        });
    }
});

/* =========================================================
   NOVAS FUN\u00c7\u00d5ES
   DASHBOARD / INDICADORES / VENDAS / TOP 10
========================================================= */

/**
 * Busca todos os pedidos dispon\u00edveis no per\u00edodo
 * permitido pela API.
 *
 * A API do Mercado Livre mant\u00e9m pedidos por at\u00e9 12 meses.
 */
async function buscarPedidosDoVendedor(
    token,
    sellerId
) {
    const agora =
        new Date();

    const inicio =
        new Date(agora);

    inicio.setFullYear(
        inicio.getFullYear() - 1
    );

    let pedidos = [];
    let offset = 0;
    const limit = 50;

    while (true) {
        const params =
            new URLSearchParams({
                seller:
                    String(sellerId),
                'order.date_created.from':
                    inicio.toISOString(),
                'order.date_created.to':
                    agora.toISOString(),
                sort:
                    'date_desc',
                offset:
                    String(offset),
                limit:
                    String(limit)
            });

        const response =
            await mlFetch(
                `${ML_API}/orders/search?${params.toString()}`,
                token
            );

        const data =
            await jsonSeguro(
                response
            );

        if (!response.ok) {
            throw new Error(
                formatarErroMercadoLivre(
                    data
                )
            );
        }

        const resultados =
            data.results || [];

        pedidos =
            pedidos.concat(
                resultados
            );

        const total =
            Number(
                data.paging?.total || 0
            );

        offset +=
            resultados.length;

        if (
            resultados.length === 0 ||
            offset >= total
        ) {
            break;
        }

        // Prote\u00e7\u00e3o
        if (offset > 50000) {
            break;
        }
    }

    return pedidos;
}

/**
 * Busca t\u00edtulos e informa\u00e7\u00f5es dos an\u00fancios
 * usados no ranking.
 */
async function buscarItensBulk(
    token,
    ids
) {
    const mapa = {};

    const idsUnicos =
        [...new Set(
            ids.filter(Boolean)
        )];

    for (
        let i = 0;
        i < idsUnicos.length;
        i += 20
    ) {
        const bloco =
            idsUnicos.slice(
                i,
                i + 20
            );

        if (bloco.length === 0) {
            continue;
        }

        const response =
            await mlFetch(
                `${ML_API}/items/bulk?ids=${bloco.join(',')}`,
                token
            );

        const data =
            await jsonSeguro(
                response
            );

        if (!response.ok) {
            continue;
        }

        if (Array.isArray(data)) {
            data.forEach(
                registro => {
                    const body =
                        registro.body;

                    const id =
                        registro.id ||
                        body?.id;

                    if (
                        id &&
                        body
                    ) {
                        mapa[id] =
                            body;
                    }
                }
            );
        }
    }

    return mapa;
}


/**
 * Busca os 10 an\u00fancios com maior quantidade vendida na conta.
 * Usa a ordena\u00e7\u00e3o sold_quantity_desc do endpoint oficial do vendedor
 * e depois consulta os detalhes dos itens com o token propriet\u00e1rio.
 */
async function montarTop10PorPedidosPagos(token,pedidos){
    const mapa=new Map();

    for(const pedido of (Array.isArray(pedidos)?pedidos:[])){
        if(String(pedido?.status||'').toLowerCase()!=='paid')continue;

        for(const oi of (Array.isArray(pedido?.order_items)?pedido.order_items:[])){
            const item=oi?.item||{};
            const id=String(item.id||'').trim();
            if(!id)continue;

            const quantidade=Number(oi.quantity||0);
            const unitPrice=Number(oi.unit_price||0);

            if(!mapa.has(id)){
                mapa.set(id,{
                    item_id:id,
                    titulo:item.title||id,
                    unidades:0,
                    faturamento:0
                });
            }

            const reg=mapa.get(id);
            reg.unidades+=quantidade;
            reg.faturamento+=quantidade*unitPrice;
        }
    }

    const ranking=[...mapa.values()]
      .filter(x=>x.unidades>0)
      .sort((a,b)=>b.unidades-a.unidades || b.faturamento-a.faturamento)
      .slice(0,10);

    if(!ranking.length)return [];

    const detalhes=await buscarItensBulk(token,ranking.map(x=>x.item_id));

    return ranking.map(item=>{
        const detalhe=detalhes[item.item_id]||{};
        return {
            item_id:item.item_id,
            titulo:detalhe.title||item.titulo||item.item_id,
            unidades:Number(item.unidades||0),
            faturamento:Number(Number(item.faturamento||0).toFixed(2)),
            preco_atual:Number(detalhe.price||0),
            thumbnail:detalhe.thumbnail||detalhe.secure_thumbnail||'',
            permalink:detalhe.permalink||'#',
            status:detalhe.status||''
        };
    });
}

/**
 * Top 10 por vendas reais.
 * A API de orders conserva os pedidos por at\u00e9 12 meses; usamos somente orders
 * pagas e somamos quantity + unit_price de cada an\u00fancio.
 */
async function buscarTop10MaisVendidosDaConta(token,sellerId){
    const pedidos=await buscarPedidosDoVendedor(token,sellerId);
    return montarTop10PorPedidosPagos(token,pedidos);
}

/**
 * GET /api/v22/top10
 * Ranking r\u00e1pido e independente do dashboard completo.
 */
async function responderTop10V23(req,res){
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');

    try{
        const me=await usuarioML(token);
        const sellerId=me.id;
        let top10=[];
        let fonte='pedidos_pagos_12_meses';

        try{
            top10=await buscarTop10MaisVendidosDaConta(token,sellerId);
        }catch(e){
            console.warn('[TOP10 V23 PEDIDOS]',e.message);
        }

        // Fallback somente se a busca de pedidos n\u00e3o retornar ranking.
        if((!Array.isArray(top10)||!top10.length) && db){
            const r=await dbQuery(`
              SELECT item_id,title,price::float8 price,sold_quantity,thumbnail,permalink,status
              FROM ml_items
              WHERE seller_id=$1 AND sold_quantity>0
              ORDER BY sold_quantity DESC,item_id
              LIMIT 10
            `,[sellerId]);

            if(r.rows.length){
                fonte='postgresql_fallback';
                top10=r.rows.map(item=>({
                    item_id:item.item_id,
                    titulo:item.title||item.item_id,
                    unidades:Number(item.sold_quantity||0),
                    faturamento:Number(item.sold_quantity||0)*Number(item.price||0),
                    preco_atual:Number(item.price||0),
                    thumbnail:item.thumbnail||'',
                    permalink:item.permalink||'#',
                    status:item.status||''
                }));
            }
        }

        res.set('Cache-Control','no-store');
        return res.json({
            sucesso:true,
            fonte,
            periodo:'ultimos_12_meses',
            total:top10.length,
            top10
        });
    }catch(e){
        console.error('[TOP10 V23]',e);
        return respostaErro(res,500,'Erro ao buscar Top 10: '+e.message);
    }
}

app.get('/api/v23/top10',responderTop10V23);
// Compatibilidade com o index anterior durante o deploy.
app.get('/api/v22/top10',responderTop10V23);

/**
 * GET /api/dashboard
 *
 * Retorna:
 * - dados da conta
 * - 4 indicadores
 * - vendas reais
 * - top 10 an\u00fancios
 */

function dataHoraSaoPauloV93(date=new Date()){
    const tz='America/Sao_Paulo';
    const fmt=new Intl.DateTimeFormat('en-CA',{
        timeZone:tz,
        year:'numeric',
        month:'2-digit',
        day:'2-digit',
        hour:'2-digit',
        minute:'2-digit',
        second:'2-digit',
        hourCycle:'h23'
    });

    const parts=Object.fromEntries(
        fmt.formatToParts(date)
          .filter(x=>x.type!=='literal')
          .map(x=>[x.type,x.value])
    );

    const y=Number(parts.year),m=Number(parts.month),d=Number(parts.day);
    const hh=Number(parts.hour),mm=Number(parts.minute),ss=Number(parts.second);

    // Calcula o offset real do fuso naquela data; não fixa -03:00 no código.
    const localComoUtc=Date.UTC(y,m-1,d,hh,mm,ss);
    const offsetMin=Math.round((localComoUtc-date.getTime())/60000);
    const sinal=offsetMin>=0?'+':'-';
    const abs=Math.abs(offsetMin);
    const offH=String(Math.floor(abs/60)).padStart(2,'0');
    const offM=String(abs%60).padStart(2,'0');
    const offset=`${sinal}${offH}:${offM}`;

    const dia=`${parts.year}-${parts.month}-${parts.day}`;
    const hora=`${parts.hour}:${parts.minute}:${parts.second}`;

    return {
        dia,
        hora,
        offset,
        inicio:`${dia}T00:00:00${offset}`,
        agora:`${dia}T${hora}${offset}`,
        data_br:`${parts.day}/${parts.month}/${parts.year}`
    };
}

async function buscarVisitasHojeV93(token,sellerId){
    const sp=dataHoraSaoPauloV93(new Date());

    const url=
      `${ML_API}/users/${encodeURIComponent(String(sellerId))}/items_visits`+
      `?date_from=${encodeURIComponent(sp.inicio)}`+
      `&date_to=${encodeURIComponent(sp.agora)}`;

    const r=await mlFetch(url,token);
    const d=await jsonSeguro(r);

    if(!r.ok){
        const e=new Error(
            formatarErroMercadoLivre(d) ||
            `Não foi possível consultar as visitas de hoje (HTTP ${r.status}).`
        );
        e.status=r.status;
        throw e;
    }

    return {
        total:Number(d?.total_visits??0),
        periodo:`${sp.data_br} · hoje · atualizado ${sp.hora.slice(0,5)}`,
        data_local:sp.dia,
        atualizado_em:sp.agora,
        date_from:d?.date_from||sp.inicio,
        date_to:d?.date_to||sp.agora
    };
}

app.get('/api/dashboard', async (req, res) => {
    const token =
        obterToken(req);

    if (!token) {
        return respostaErro(
            res,
            401,
            'Token n\u00e3o fornecido.'
        );
    }

    try {
        const userResponse =
            await mlFetch(
                `${ML_API}/users/me`,
                token
            );

        const user =
            await jsonSeguro(
                userResponse
            );

        if (
            !userResponse.ok ||
            !user.id
        ) {
            return respostaErro(
                res,
                401,
                'Token inv\u00e1lido ou expirado.'
            );
        }

        const sellerId =
            user.id;
        // V93: visitas somente do DIA LOCAL atual do vendedor.
        // O antigo last=1&unit=day fechava uma janela diária completa e podia
        // exibir o dia anterior. Agora usamos 00:00 de São Paulo até o instante atual.
        let visitasDia = {
            total: null,
            periodo: 'Visitas de hoje',
            data_local: dataHoraSaoPauloV93(new Date()).dia
        };
        try {
            visitasDia = await buscarVisitasHojeV93(token, sellerId);
        } catch (e) {
            console.warn('[DASHBOARD VISITAS V93]', e.message);
        }

const pedidos =
            await buscarPedidosDoVendedor(
                token,
                sellerId
            );

        /*
         * Somente pedidos pagos entram no
         * c\u00e1lculo de venda real.
         */
        const pedidosPagos =
            pedidos.filter(
                pedido =>
                    pedido.status ===
                    'paid'
            );

        let totalVendas =
            0;

        let totalUnidades =
            0;

        const vendasPorItem =
            {};

        pedidosPagos.forEach(
            pedido => {
                totalVendas +=
                    Number(
                        pedido.paid_amount ||
                        pedido.total_amount ||
                        0
                    );

                const itens =
                    pedido.order_items ||
                    [];

                itens.forEach(
                    orderItem => {
                        const item =
                            orderItem.item ||
                            {};

                        const itemId =
                            item.id;

                        const quantidade =
                            Number(
                                orderItem.quantity ||
                                0
                            );

                        const unitPrice =
                            Number(
                                orderItem.unit_price ||
                                0
                            );

                        if (!itemId) {
                            return;
                        }

                        totalUnidades +=
                            quantidade;

                        if (
                            !vendasPorItem[
                                itemId
                            ]
                        ) {
                            vendasPorItem[
                                itemId
                            ] = {
                                item_id:
                                    itemId,
                                titulo:
                                    item.title ||
                                    itemId,
                                unidades:
                                    0,
                                faturamento:
                                    0
                            };
                        }

                        vendasPorItem[
                            itemId
                        ].unidades +=
                            quantidade;

                        vendasPorItem[
                            itemId
                        ].faturamento +=
                            quantidade *
                            unitPrice;
                    }
                );
            }
        );

        const topIds =
            Object.values(
                vendasPorItem
            )
                .sort(
                    (a, b) =>
                        b.unidades -
                        a.unidades
                )
                .slice(0, 10)
                .map(
                    item =>
                        item.item_id
                );

        const itensDetalhes =
            await buscarItensBulk(
                token,
                topIds
            );

        // Top 10 real do per\u00edodo: soma unidades e faturamento dos pedidos pagos.
        // Reaproveita os pedidos que o dashboard j\u00e1 buscou, sem fazer outra varredura.
        let top10;

        try {
            top10 = await montarTop10PorPedidosPagos(
                token,
                pedidosPagos
            );
        } catch (erroTop10) {
            console.warn('[TOP10 DASHBOARD V23]', erroTop10.message);
            top10 = Object.values(vendasPorItem)
                .sort((a, b) => b.unidades - a.unidades || b.faturamento - a.faturamento)
                .slice(0, 10)
                .map(item => {
                    const detalhe = itensDetalhes[item.item_id];
                    return {
                        ...item,
                        titulo: detalhe?.title || item.titulo,
                        preco_atual: Number(detalhe?.price || 0),
                        thumbnail: detalhe?.thumbnail || detalhe?.secure_thumbnail || '',
                        permalink: detalhe?.permalink || '#',
                        status: detalhe?.status || ''
                    };
                });
        }

        // PostgreSQL \u00e9 fallback. A consulta direta ao Mercado Livre acima
        // \u00e9 priorizada para o ranking ficar atualizado no clique.
        if (!Array.isArray(top10) || top10.length === 0) {
            try {
                if (db) {
                    const rankDb = await dbQuery(`
                        SELECT item_id,title,price::float8 price,sold_quantity,thumbnail,permalink,status
                        FROM ml_items
                        WHERE seller_id=$1 AND sold_quantity>0
                        ORDER BY sold_quantity DESC, item_id
                        LIMIT 10
                    `,[sellerId]);
                    if (rankDb.rows.length) {
                        top10 = rankDb.rows.map(item => ({
                            item_id:item.item_id,
                            titulo:item.title || item.item_id,
                            unidades:Number(item.sold_quantity||0),
                            faturamento:Number(item.sold_quantity||0)*Number(item.price||0),
                            preco_atual:Number(item.price||0),
                            thumbnail:item.thumbnail||'',
                            permalink:item.permalink||'#',
                            status:item.status||''
                        }));
                    }
                }
            } catch (e) {
                console.warn('[TOP10 DB FALLBACK]', e.message);
            }
        }


        /*
         * Busca os dados completos do vendedor.
         * seller_reputation.metrics cont\u00e9m:
         * sales
         * claims
         * delayed_handling_time
         * cancellations
         */
        const sellerResponse =
            await mlFetch(
                `${ML_API}/users/${sellerId}?attributes=seller_reputation`,
                token
            );

        const sellerData =
            await jsonSeguro(
                sellerResponse
            );

        const reputation =
            sellerData.seller_reputation ||
            {};

        const metrics =
            reputation.metrics ||
            {};

        const salesMetric =
            metrics.sales ||
            {};

        const claimsMetric =
            metrics.claims ||
            {};

        const delayedMetric =
            metrics.delayed_handling_time ||
            {};

        const cancellationsMetric =
            metrics.cancellations ||
            {};

        res.json({
            sucesso: true,

            periodo_vendas: {
                inicio:
                    inicioISO12Meses(),
                fim:
                    new Date().toISOString(),
                observacao:
                    'A API de pedidos do Mercado Livre disponibiliza pedidos por at\u00e9 12 meses.'
            },

            conta: {
                id:
                    sellerData.id ||
                    sellerId,
                nickname:
                    sellerData.nickname ||
                    user.nickname ||
                    '',
                permalink:
                    sellerData.permalink ||
                    ''
            },

            indicadores: {
                vendas: {
                    nome:
                        'Vendas',
                    valor:
                        salesMetric.completed ??
                        salesMetric.value ??
                        null,
                    periodo:
                        salesMetric.period ??
                        null
                },

                reclamacoes: {
                    nome:
                        'Reclama\u00e7\u00f5es',
                    taxa:
                        claimsMetric.rate ??
                        null,
                    valor:
                        claimsMetric.value ??
                        null,
                    periodo:
                        claimsMetric.period ??
                        null
                },

                atrasos: {
                    nome:
                        'Atrasos',
                    taxa:
                        delayedMetric.rate ??
                        null,
                    valor:
                        delayedMetric.value ??
                        null,
                    periodo:
                        delayedMetric.period ??
                        null
                },

                cancelamentos: {
                    nome:
                        'Cancelamentos',
                    taxa:
                        cancellationsMetric.rate ??
                        null,
                    valor:
                        cancellationsMetric.value ??
                        null,
                    periodo:
                        cancellationsMetric.period ??
                        null
                }
            },

            visitas_dia: visitasDia,

            vendas_reais: {
                pedidos_pagos:
                    pedidosPagos.length,
                unidades:
                    totalUnidades,
                valor_total:
                    Number(
                        totalVendas.toFixed(2)
                    ),
                moeda:
                    'BRL'
            },

            top10
        });

    } catch (error) {
        console.error(
            'Erro dashboard:',
            error
        );

        return respostaErro(
            res,
            500,
            'Erro ao carregar o dashboard: ' +
            error.message
        );
    }
});

function inicioISO12Meses() {
    const data =
        new Date();

    data.setFullYear(
        data.getFullYear() - 1
    );

    return data.toISOString();
}

async function mapLimitV21(lista,limite,fn){
    const saida=new Array(lista.length);
    let cursor=0;
    async function worker(){
        while(true){
            const i=cursor++;
            if(i>=lista.length)return;
            try{saida[i]=await fn(lista[i],i)}
            catch(e){saida[i]=null}
        }
    }
    await Promise.all(Array.from({length:Math.min(limite,Math.max(1,lista.length))},()=>worker()));
    return saida;
}

app.get('/api/v21/pedidos', async (req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');
    try{
        const me=await usuarioML(token);
        const page=Math.max(1,Number(req.query.page||1));
        const limit=Math.min(50,Math.max(10,Number(req.query.limit||30)));
        const offset=(page-1)*limit;
        const params=new URLSearchParams({
            seller:String(me.id),
            sort:'date_desc',
            offset:String(offset),
            limit:String(limit)
        });
        const or=await mlFetch(`${ML_API}/orders/search?${params.toString()}`,token);
        const od=await jsonSeguro(or);
        if(!or.ok)return respostaErro(res,or.status,formatarErroMercadoLivre(od));

        const orders=Array.isArray(od?.results)?od.results:[];
        const enriquecidos=await mapLimitV21(orders,8,async order=>{
            let shipment=null;
            try{
                const sr=await mlFetch(`${ML_API}/orders/${order.id}/shipments`,token,{
                    headers:{'x-format-new':'true'}
                });
                const sd=await jsonSeguro(sr);
                if(sr.ok)shipment=sd;
            }catch(e){}

            const shipmentStatus=String(shipment?.status||order?.shipping?.status||'').toLowerCase();
            const orderStatus=String(order?.status||'').toLowerCase();
            let situacao='em_andamento';
            if(orderStatus==='cancelled'||orderStatus==='canceled'||shipmentStatus==='cancelled')situacao='cancelado';
            else if(shipmentStatus==='delivered')situacao='entregue';
            else if(orderStatus!=='paid'||['pending','ready_to_ship','handling'].includes(shipmentStatus))situacao='pendente';

            return {
                id:order.id,
                pack_id:order.pack_id||null,
                date_created:order.date_created,
                date_closed:order.date_closed,
                status:order.status,
                status_detail:order.status_detail,
                total_amount:Number(order.total_amount||order.paid_amount||0),
                paid_amount:Number(order.paid_amount||0),
                currency_id:order.currency_id||'BRL',
                buyer:{
                    id:order.buyer?.id||null,
                    nickname:order.buyer?.nickname||''
                },
                items:(order.order_items||[]).map(oi=>({
                    id:oi.item?.id||'',
                    title:oi.item?.title||oi.item?.id||'Produto',
                    quantity:Number(oi.quantity||0),
                    unit_price:Number(oi.unit_price||0)
                })),
                shipping:{
                    id:shipment?.id||order?.shipping?.id||null,
                    status:shipment?.status||order?.shipping?.status||null,
                    substatus:shipment?.substatus||order?.shipping?.substatus||null
                },
                situacao
            };
        });

        const pedidos=enriquecidos.filter(Boolean);
        const total=Number(od?.paging?.total||0);
        res.json({
            sucesso:true,
            pagina:page,
            limite:limit,
            total,
            paginas:Math.max(1,Math.ceil(total/limit)),
            pedidos
        });
    }catch(e){
        console.error('[PEDIDOS V21]',e);
        respostaErro(res,500,'Erro ao buscar pedidos: '+e.message);
    }
});

/* =========================================================
   V101 — GESTÃO EM MASSA / QUALIDADE / NF-e / AUTOMAÇÃO
========================================================= */

function erroFiscalV101(status,data){
    const causa=Array.isArray(data?.cause)
      ?data.cause.map(x=>x?.message||x?.code||'').filter(Boolean).join(' · ')
      :'';

    const msg=String(
      data?.display_message||
      data?.message||
      data?.error||
      causa||
      `HTTP ${status}`
    );

    if(Number(status)===403){
        return 'O Mercado Livre negou acesso ao faturamento. Verifique se a permissão funcional "Faturamento" está habilitada no aplicativo e se esta conta está habilitada no Faturador do Mercado Livre. Detalhe: '+msg;
    }

    return msg;
}

function invoiceObjetoV101(data){
    if(!data)return null;
    if(Array.isArray(data))return data[0]||null;
    if(Array.isArray(data?.results))return data.results[0]||null;
    if(Array.isArray(data?.invoices))return data.invoices[0]||null;
    return typeof data==='object'?data:null;
}

async function consultarInvoicePedidoV101(token,sellerId,orderId){
    const r=await mlFetch(
      `${ML_API}/users/${encodeURIComponent(sellerId)}/invoices/orders/${encodeURIComponent(orderId)}`,
      token
    );
    const d=await jsonSeguro(r);

    if(r.status===404){
        return {existe:false,status_http:404,invoice:null};
    }

    if(!r.ok){
        const e=new Error(erroFiscalV101(r.status,d));
        e.status=r.status;
        e.data=d;
        throw e;
    }

    return {
        existe:true,
        status_http:r.status,
        invoice:invoiceObjetoV101(d),
        raw:d
    };
}

async function idsOrdersMesmoSellerV101(token,sellerId,order){
    const baseId=String(order?.id||'').trim();
    const packId=String(order?.pack_id||'').trim();

    if(!packId)return baseId?[baseId]:[];

    const pr=await mlFetch(
      `${ML_API}/packs/${encodeURIComponent(packId)}`,
      token
    );
    const pd=await jsonSeguro(pr);

    if(!pr.ok || !Array.isArray(pd?.orders)){
        return baseId?[baseId]:[];
    }

    const ids=pd.orders
      .map(x=>String(x?.id||'').trim())
      .filter(Boolean);

    if(!ids.length)return baseId?[baseId]:[];

    const detalhes=await mapLimitV21(ids,6,async id=>{
        const or=await mlFetch(`${ML_API}/orders/${encodeURIComponent(id)}`,token);
        const od=await jsonSeguro(or);
        if(!or.ok)return null;
        return String(od?.seller?.id||'')===String(sellerId)
          ?String(od.id||id)
          :null;
    });

    const filtrados=[...new Set(detalhes.filter(Boolean))];
    return filtrados.length?filtrados:(baseId?[baseId]:[]);
}

app.post('/api/v101/anuncios/pausar-lote',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');

    try{
        const me=await usuarioML(token);
        const sellerId=String(me.id);

        const ids=[...new Set(
          (Array.isArray(req.body?.ids)?req.body.ids:[])
            .map(x=>String(x||'').trim().toUpperCase())
            .filter(x=>/^MLB\d+$/.test(x))
        )].slice(0,500);

        if(!ids.length){
            return respostaErro(res,400,'Nenhum MLB válido foi informado.');
        }

        const bulk=await buscarItensBulkFreteRapido(token,ids);
        const mapa=bulk?.mapa||{};

        const resultados=(
          await mapLimitV21(ids,10,async id=>{
            const item=mapa[id];

            if(!item){
                return {id,sucesso:false,erro:'Anúncio não encontrado.'};
            }

            if(String(item.seller_id||'')!==sellerId){
                return {id,sucesso:false,erro:'Anúncio não pertence à conta conectada.'};
            }

            const status=String(item.status||'').toLowerCase();

            if(status==='paused'){
                return {
                    id,
                    sucesso:true,
                    ja_estava_pausado:true,
                    status:'paused'
                };
            }

            if(status!=='active'){
                return {
                    id,
                    sucesso:false,
                    ignorado:true,
                    status,
                    erro:`Status ${status||'desconhecido'} não pode ser pausado por esta operação.`
                };
            }

            const rr=await mlFetch(
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
            const dd=await jsonSeguro(rr);

            if(!rr.ok){
                return {
                    id,
                    sucesso:false,
                    status,
                    erro:formatarErroMercadoLivre(dd)||`HTTP ${rr.status}`
                };
            }

            return {
                id,
                sucesso:true,
                status:'paused'
            };
          })
        ).filter(Boolean);

        res.json({
            sucesso:true,
            total:resultados.length,
            pausados:resultados.filter(x=>x.sucesso&&!x.ja_estava_pausado).length,
            ja_pausados:resultados.filter(x=>x.ja_estava_pausado).length,
            falhas:resultados.filter(x=>!x.sucesso&&!x.ignorado).length,
            ignorados:resultados.filter(x=>x.ignorado).length,
            resultados
        });
    }catch(e){
        respostaErro(res,500,'Erro ao pausar anúncios: '+e.message);
    }
});

app.post('/api/v101/anuncios/qualidade-lote',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');

    try{
        const me=await usuarioML(token);
        const sellerId=String(me.id);

        const ids=[...new Set(
          (Array.isArray(req.body?.ids)?req.body.ids:[])
            .map(x=>String(x||'').trim().toUpperCase())
            .filter(x=>/^MLB\d+$/.test(x))
        )].slice(0,100);

        if(!ids.length){
            return res.json({sucesso:true,resultados:[]});
        }

        const bulk=await buscarItensBulkFreteRapido(token,ids);
        const mapa=bulk?.mapa||{};

        const resultados=(
          await mapLimitV21(ids,6,async id=>{
            const item=mapa[id];

            if(!item || String(item.seller_id||'')!==sellerId){
                return {
                    id,
                    sucesso:false,
                    erro:'Anúncio não encontrado na conta conectada.'
                };
            }

            let r=await mlFetch(
              `${ML_API}/item/${encodeURIComponent(id)}/performance`,
              token
            );
            let d=await jsonSeguro(r);

            if(r.status===404){
                r=await mlFetch(
                  `${ML_API}/items/${encodeURIComponent(id)}/performance`,
                  token
                );
                d=await jsonSeguro(r);
            }

            if(!r.ok){
                return {
                    id,
                    sucesso:false,
                    title:String(item.title||''),
                    erro:formatarErroMercadoLivre(d)||`HTTP ${r.status}`
                };
            }

            return {
                id,
                sucesso:true,
                title:String(item.title||''),
                score:Number.isFinite(Number(d?.score))
                  ?Math.max(0,Math.min(100,Number(d.score)))
                  :null,
                level:String(d?.level_wording||d?.level||''),
                calculated_at:d?.calculated_at||null,
                pending_actions:Array.isArray(d?.buckets)
                  ?d.buckets.filter(x=>String(x?.status||'').toUpperCase()==='PENDING').length
                  :0
            };
          })
        ).filter(Boolean);

        res.json({sucesso:true,resultados});
    }catch(e){
        respostaErro(res,500,'Erro ao consultar qualidade dos anúncios: '+e.message);
    }
});

app.get('/api/v101/pedidos/:orderId/nfe',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');

    try{
        const me=await usuarioML(token);
        const orderId=String(req.params.orderId||'').trim();

        const info=await consultarInvoicePedidoV101(
          token,
          String(me.id),
          orderId
        );

        if(!info.existe){
            return res.json({
                sucesso:true,
                existe:false,
                order_id:orderId,
                mensagem:'Ainda não há NF-e emitida para este pedido.'
            });
        }

        const inv=info.invoice||{};
        res.json({
            sucesso:true,
            existe:true,
            order_id:orderId,
            invoice:{
                id:inv.id||null,
                status:inv.status||null,
                transaction_status:inv.transaction_status||null,
                issued_date:inv.issued_date||null,
                invoice_series:inv.invoice_series||null,
                invoice_number:inv.invoice_number||null,
                invoice_key:inv?.attributes?.invoice_key||inv.invoice_key||null,
                status_description:inv?.attributes?.status_description||null,
                danfe_available:Boolean(
                  inv?.attributes?.danfe_location||
                  inv?.danfe_location||
                  inv?.attributes?.danfe||
                  inv?.danfe
                )
            }
        });
    }catch(e){
        respostaErro(res,e.status||500,e.message);
    }
});

app.post('/api/v101/pedidos/:orderId/nfe/emitir',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');

    try{
        const me=await usuarioML(token);
        const sellerId=String(me.id);
        const orderId=String(req.params.orderId||'').trim();

        const or=await mlFetch(
          `${ML_API}/orders/${encodeURIComponent(orderId)}`,
          token
        );
        const order=await jsonSeguro(or);

        if(!or.ok){
            return respostaErro(
              res,
              or.status,
              formatarErroMercadoLivre(order)||'Pedido não encontrado.'
            );
        }

        if(String(order?.seller?.id||'')!==sellerId){
            return respostaErro(
              res,
              403,
              'Este pedido não pertence à conta Mercado Livre conectada.'
            );
        }

        try{
            const existente=await consultarInvoicePedidoV101(token,sellerId,orderId);
            if(existente.existe){
                return res.json({
                    sucesso:true,
                    ja_existia:true,
                    invoice:invoiceObjetoV101(existente.raw)||existente.invoice
                });
            }
        }catch(e){
            if(Number(e.status)===403)throw e;
        }

        const orders=await idsOrdersMesmoSellerV101(
          token,
          sellerId,
          order
        );

        if(!orders.length){
            return respostaErro(res,400,'Não foi possível identificar as vendas do pedido para faturamento.');
        }

        const rr=await mlFetch(
          `${ML_API}/users/${encodeURIComponent(sellerId)}/invoices/orders`,
          token,
          {
            method:'POST',
            headers:{
                'Content-Type':'application/json',
                Accept:'application/json'
            },
            body:JSON.stringify({
                orders:orders.map(x=>Number(x))
            })
          }
        );
        const dd=await jsonSeguro(rr);

        if(!rr.ok){
            return respostaErro(
              res,
              rr.status,
              erroFiscalV101(rr.status,dd)
            );
        }

        res.json({
            sucesso:true,
            ja_existia:false,
            orders,
            invoice:invoiceObjetoV101(dd)||dd
        });
    }catch(e){
        respostaErro(res,e.status||500,e.message);
    }
});

app.get('/api/v101/pedidos/:orderId/nfe/danfe',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');

    try{
        const me=await usuarioML(token);
        const sellerId=String(me.id);
        const orderId=String(req.params.orderId||'').trim();

        const info=await consultarInvoicePedidoV101(
          token,
          sellerId,
          orderId
        );

        if(!info.existe){
            return respostaErro(res,404,'Ainda não há NF-e emitida para este pedido.');
        }

        const inv=info.invoice||{};
        let location=
          inv?.attributes?.danfe_location||
          inv?.danfe_location||
          inv?.attributes?.danfe||
          inv?.danfe||
          '';

        location=String(location||'').trim();

        if(!location){
            return respostaErro(
              res,
              409,
              'A NF-e existe, mas o DANFE ainda não está disponível. Aguarde a autorização e tente novamente.'
            );
        }

        const url=/^https?:\/\//i.test(location)
          ?location
          :`${ML_API}${location.startsWith('/')?'':'/'}${location}`;

        const rr=await mlFetch(url,token);
        if(!rr.ok){
            const dd=await jsonSeguro(rr);
            return respostaErro(
              res,
              rr.status,
              erroFiscalV101(rr.status,dd)
            );
        }

        const buffer=Buffer.from(await rr.arrayBuffer());
        const contentType=rr.headers.get('content-type')||'application/pdf';

        res.setHeader('Content-Type',contentType);
        res.setHeader(
          'Content-Disposition',
          `inline; filename="DANFE-${orderId}.pdf"`
        );
        res.setHeader('Cache-Control','private, no-store');
        return res.end(buffer);
    }catch(e){
        respostaErro(res,e.status||500,e.message);
    }
});


/* =========================================================
   PERGUNTAS E RESPOSTAS
========================================================= */

/**
 * GET /api/perguntas
 *
 * Busca perguntas recebidas pelo vendedor.
 */
app.get('/api/perguntas', async (req, res) => {
    const token=obterToken(req);

    if(!token){
        return respostaErro(res,401,'Token não fornecido.');
    }

    try{
        const userResponse=await mlFetch(`${ML_API}/users/me`,token);
        const user=await jsonSeguro(userResponse);

        if(!userResponse.ok||!user.id){
            return respostaErro(res,401,'Token inválido ou expirado.');
        }

        const sellerId=user.id;
        const limit=Math.min(Number(req.query.limit||50),100);
        const offset=Math.max(Number(req.query.offset||0),0);
        const status=req.query.status||'';

        const params=new URLSearchParams({
            seller_id:String(sellerId),
            api_version:'4',
            limit:String(limit),
            offset:String(offset),
            sort_fields:'date_created',
            sort_types:'DESC'
        });

        if(status)params.set('status',status);

        const response=await mlFetch(
            `${ML_API}/questions/search?${params.toString()}`,
            token
        );
        const data=await jsonSeguro(response);

        if(!response.ok){
            return respostaErro(
                res,
                response.status,
                formatarErroMercadoLivre(data)
            );
        }

        const perguntas=Array.isArray(data.questions)?data.questions:[];
        const ids=[...new Set(perguntas.map(p=>String(p.item_id||'')).filter(Boolean))];
        const itens=await buscarItensBulk(token,ids);

        const resultado=perguntas.map(pergunta=>{
            const item=itens[String(pergunta.item_id)]||{};
            const attrs=Array.isArray(item.attributes)?item.attributes:[];
            const sku=String(
                attrs.find(a=>String(a?.id||'').toUpperCase()==='SELLER_SKU')?.value_name||
                ''
            ).trim();

            return {
                id:pergunta.id,
                item_id:pergunta.item_id,
                sku,
                titulo:item?.title||pergunta.item_id,
                thumbnail:item?.thumbnail||item?.secure_thumbnail||'',
                permalink:item?.permalink||'#',
                pergunta:pergunta.text||'',
                status:pergunta.status||'',
                respondida:
                    pergunta.status==='ANSWERED'||
                    Boolean(pergunta.answer),
                resposta:pergunta.answer?.text||'',
                data:pergunta.date_created||null,
                preco:Number(item?.price||0),
                estoque:Number(item?.available_quantity||0),
                vendas:Number(item?.sold_quantity||0),
                categoria:String(item?.category_id||'')
            };
        });

        res.json({
            sucesso:true,
            total:Number(data.total||resultado.length),
            limit,
            offset,
            perguntas:resultado
        });
    }catch(error){
        console.error('Erro perguntas:',error);
        return respostaErro(
            res,
            500,
            'Erro ao carregar perguntas: '+error.message
        );
    }
});


/* =========================================================
   V100 — AGENTES DE PRODUTO + IA PARA PERGUNTAS
========================================================= */

let bancoPerguntasAgentesV100Promise=null;

async function inicializarPerguntasAgentesV100(){
    await inicializarAgentesV62();

    if(!bancoPerguntasAgentesV100Promise){
        bancoPerguntasAgentesV100Promise=dbQuery(`
          CREATE TABLE IF NOT EXISTS ml_question_agent_links_v100(
            seller_id BIGINT NOT NULL,
            agent_id UUID NOT NULL REFERENCES ml_product_agents_v62(id) ON DELETE CASCADE,
            match_type TEXT NOT NULL,
            match_value TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY(seller_id,match_type,match_value)
          );

          CREATE INDEX IF NOT EXISTS idx_question_agent_links_v100_agent
          ON ml_question_agent_links_v100(seller_id,agent_id);
        `).catch(e=>{
            bancoPerguntasAgentesV100Promise=null;
            throw e;
        });
    }

    return bancoPerguntasAgentesV100Promise;
}

function normalizarVinculoPerguntaV100(tipo,valor){
    const t=String(tipo||'').trim().toLowerCase();
    let v=String(valor||'').trim();

    if(!['item_id','sku','default'].includes(t)){
        throw erroAgenteV62('Escolha o vínculo do agente: MLB, SKU ou padrão.');
    }

    if(t==='item_id'){
        v=v.toUpperCase().replace(/\s+/g,'');
        if(!/^MLB\d+$/i.test(v)){
            throw erroAgenteV62('Informe um MLB válido para vincular este agente.');
        }
    }

    if(t==='sku'&&!v){
        throw erroAgenteV62('Informe o SKU para vincular este agente.');
    }

    if(t==='default')v='*';

    return {match_type:t,match_value:v.slice(0,300)};
}

async function listarAgentesPerguntasV100(seller){
    await inicializarPerguntasAgentesV100();

    const [agentes,links]=await Promise.all([
        dbQuery(
          `SELECT * FROM ml_product_agents_v62
           WHERE seller_id=$1
           ORDER BY updated_at DESC
           LIMIT 1000`,
          [seller]
        ),
        dbQuery(
          `SELECT seller_id,agent_id,match_type,match_value,updated_at
           FROM ml_question_agent_links_v100
           WHERE seller_id=$1`,
          [seller]
        )
    ]);

    const linkByAgent=new Map();
    for(const l of links.rows){
        if(!linkByAgent.has(String(l.agent_id)))linkByAgent.set(String(l.agent_id),[]);
        linkByAgent.get(String(l.agent_id)).push({
            match_type:l.match_type,
            match_value:l.match_value,
            updated_at:l.updated_at
        });
    }

    return agentes.rows.map(row=>({
        ...agentePublicoV62(row,false),
        links:linkByAgent.get(String(row.id))||[]
    }));
}

async function escolherAgentePerguntaV100(seller,{agentId='',itemId='',sku=''}={}){
    await inicializarPerguntasAgentesV100();

    if(agentId){
        return obterAgenteV62(seller,agentId);
    }

    const item=String(itemId||'').trim().toUpperCase();
    const skuClean=String(sku||'').trim();

    const r=await dbQuery(`
      SELECT a.*
      FROM ml_question_agent_links_v100 l
      JOIN ml_product_agents_v62 a
        ON a.id=l.agent_id
       AND a.seller_id=l.seller_id
      WHERE l.seller_id=$1
        AND (
          (l.match_type='item_id' AND UPPER(l.match_value)=UPPER($2))
          OR
          (l.match_type='sku' AND LOWER(l.match_value)=LOWER($3))
          OR
          (l.match_type='default' AND l.match_value='*')
        )
      ORDER BY
        CASE l.match_type
          WHEN 'item_id' THEN 1
          WHEN 'sku' THEN 2
          ELSE 3
        END
      LIMIT 1
    `,[seller,item,skuClean]);

    return r.rows[0]?hidratarAcervoV65(r.rows[0]):null;
}

function fatosConfirmadosAgenteV100(row){
    if(!row)return null;

    const m=row.manual||{};

    return {
        id:row.id,
        name:row.name,
        product:row.product,
        brand:row.brand,
        information:String(m.information||'').slice(0,10000),
        technical_sheet:String(m.technical_sheet||'').slice(0,10000),
        applications:String(m.applications||'').slice(0,5000),
        notes:String(m.notes||'').slice(0,8000),
        approved_facts:Array.isArray(m.approved_facts)
          ?m.approved_facts.slice(0,80)
          :[],
        instructions:String(row.instructions||'').slice(0,4000)
    };
}

function compactarItemPerguntaV100(item,descricao=''){
    const attrs=(Array.isArray(item?.attributes)?item.attributes:[])
      .filter(a=>a?.id && (
          a?.value_name ||
          a?.value_id ||
          (Array.isArray(a?.values)&&a.values.length)
      ))
      .slice(0,120)
      .map(a=>({
          id:String(a.id),
          name:String(a.name||a.id),
          value:String(
              a.value_name||
              a.values?.[0]?.name||
              a.value_id||
              ''
          ).slice(0,500)
      }));

    const variations=(Array.isArray(item?.variations)?item.variations:[])
      .slice(0,30)
      .map(v=>({
          id:v.id,
          available_quantity:Number(v.available_quantity||0),
          attributes:(v.attribute_combinations||[]).map(a=>({
              id:a.id,
              name:a.name,
              value:a.value_name||a.value_id||''
          }))
      }));

    return {
        id:String(item?.id||''),
        title:String(item?.title||''),
        category_id:String(item?.category_id||''),
        price:Number(item?.price||0),
        available_quantity:Number(item?.available_quantity||0),
        sold_quantity:Number(item?.sold_quantity||0),
        condition:String(item?.condition||''),
        warranty:String(item?.warranty||''),
        shipping:{
            free_shipping:Boolean(item?.shipping?.free_shipping),
            logistic_type:String(item?.shipping?.logistic_type||''),
            mode:String(item?.shipping?.mode||'')
        },
        attributes:attrs,
        variations,
        description:String(descricao||'').slice(0,12000)
    };
}

app.get('/api/v100/perguntas/agentes',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');

    try{
        const seller=await contaAgentesV62(req);
        const agentes=await listarAgentesPerguntasV100(seller);

        res.json({
            sucesso:true,
            agentes,
            ia_habilitada:Boolean(String(process.env.GEMINI_API_KEY||'').trim()),
            auto_refresh_habilitado:String(process.env.PRODUCT_AGENT_WORKER_ENABLED||'true').toLowerCase()!=='false'
        });
    }catch(e){
        respostaErro(res,e.status||500,e.message);
    }
});

app.post('/api/v100/perguntas/agentes',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');

    try{
        const seller=await contaAgentesV62(req);
        await inicializarPerguntasAgentesV100();

        const normalized=normalizarAgenteV62({
            name:req.body?.name,
            product:req.body?.product,
            brand:req.body?.brand,
            manual:{
                information:req.body?.information,
                technical_sheet:req.body?.technical_sheet,
                applications:req.body?.applications,
                notes:req.body?.notes,
                keywords:[]
            },
            instructions:req.body?.instructions,
            urls:[],
            refresh_enabled:Boolean(req.body?.refresh_enabled),
            interval_hours:Number(req.body?.interval_hours||24)
        });

        const vinculo=normalizarVinculoPerguntaV100(
            req.body?.match_type,
            req.body?.match_value
        );

        const id=crypto.randomUUID();
        const client=await dbConnectComRetryV104();

        try{
            await client.query('BEGIN');

            const ar=await client.query(`
              INSERT INTO ml_product_agents_v62(
                id,seller_id,name,product,brand,manual,urls,instructions,
                refresh_enabled,interval_hours,next_refresh_at
              )
              VALUES(
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                CASE WHEN $9 THEN NOW() ELSE NULL END
              )
              RETURNING *
            `,[
                id,
                seller,
                normalized.name,
                normalized.product,
                normalized.brand,
                normalized.manual,
                JSON.stringify(normalized.urls),
                normalized.instructions,
                normalized.refresh_enabled,
                normalized.interval_hours
            ]);

            await client.query(`
              INSERT INTO ml_question_agent_links_v100(
                seller_id,agent_id,match_type,match_value
              )
              VALUES($1,$2,$3,$4)
              ON CONFLICT(seller_id,match_type,match_value)
              DO UPDATE SET
                agent_id=EXCLUDED.agent_id,
                updated_at=NOW()
            `,[
                seller,
                id,
                vinculo.match_type,
                vinculo.match_value
            ]);

            await client.query('COMMIT');

            res.status(201).json({
                sucesso:true,
                agente:{
                    ...agentePublicoV62(ar.rows[0],false),
                    links:[vinculo]
                }
            });
        }catch(e){
            try{await client.query('ROLLBACK')}catch(_){}
            throw e;
        }finally{
            client.release();
        }
    }catch(e){
        respostaErro(res,e.status||500,e.message);
    }
});

