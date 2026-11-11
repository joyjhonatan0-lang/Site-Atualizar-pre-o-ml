app.put('/api/v100/perguntas/agentes/:id',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');

    try{
        const seller=await contaAgentesV62(req);
        await inicializarPerguntasAgentesV100();

        const anterior=await obterAgenteV62(seller,req.params.id);
        const normalized=normalizarAgenteV62({
            name:req.body?.name,
            product:req.body?.product,
            brand:req.body?.brand,
            manual:{
                information:req.body?.information,
                technical_sheet:req.body?.technical_sheet,
                applications:req.body?.applications,
                notes:req.body?.notes,
                approved_facts:anterior.manual?.approved_facts||[],
                keywords:anterior.manual?.keywords||[]
            },
            instructions:req.body?.instructions,
            urls:anterior.urls||[],
            refresh_enabled:Boolean(req.body?.refresh_enabled),
            interval_hours:Number(req.body?.interval_hours||24)
        },anterior);

        const vinculo=normalizarVinculoPerguntaV100(
            req.body?.match_type,
            req.body?.match_value
        );

        const client=await dbConnectComRetryV104();

        try{
            await client.query('BEGIN');

            const ar=await client.query(`
              UPDATE ml_product_agents_v62 SET
                name=$3,
                product=$4,
                brand=$5,
                manual=$6,
                instructions=$7,
                refresh_enabled=$8,
                interval_hours=$9,
                next_refresh_at=CASE
                  WHEN $8 THEN COALESCE(next_refresh_at,NOW())
                  ELSE NULL
                END,
                version=version+1,
                updated_at=NOW()
              WHERE id=$1 AND seller_id=$2
              RETURNING *
            `,[
                anterior.id,
                seller,
                normalized.name,
                normalized.product,
                normalized.brand,
                normalized.manual,
                normalized.instructions,
                normalized.refresh_enabled,
                normalized.interval_hours
            ]);

            await client.query(
              `DELETE FROM ml_question_agent_links_v100
               WHERE seller_id=$1 AND agent_id=$2`,
              [seller,anterior.id]
            );

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
                anterior.id,
                vinculo.match_type,
                vinculo.match_value
            ]);

            await client.query('COMMIT');

            res.json({
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

app.delete('/api/v100/perguntas/agentes/:id',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');

    try{
        const seller=await contaAgentesV62(req);
        await inicializarPerguntasAgentesV100();

        const r=await dbQuery(
          `DELETE FROM ml_product_agents_v62
           WHERE id=$1 AND seller_id=$2
           RETURNING id`,
          [req.params.id,seller]
        );

        if(!r.rowCount)return respostaErro(res,404,'Agente não encontrado.');
        res.json({sucesso:true});
    }catch(e){
        respostaErro(res,e.status||500,e.message);
    }
});

app.post('/api/v100/perguntas/sugerir-resposta',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Conecte uma conta Mercado Livre.');

    if(!String(process.env.GEMINI_API_KEY||'').trim()){
        return respostaErro(
            res,
            503,
            'Configure GEMINI_API_KEY no Render para gerar respostas com IA.'
        );
    }

    const questionId=String(req.body?.question_id||'').trim();
    const itemId=String(req.body?.item_id||'').trim();
    const question=String(req.body?.question_text||'').trim().slice(0,4000);
    const agentId=String(req.body?.agent_id||'').trim();

    if(!itemId||!question){
        return respostaErro(res,400,'Pergunta ou anúncio não informado.');
    }

    try{
        const seller=await contaAgentesV62(req);

        const ir=await mlFetch(
            `${ML_API}/items/${encodeURIComponent(itemId)}?include_attributes=all&include_internal_attributes=true`,
            token
        );
        const item=await jsonSeguro(ir);

        if(!ir.ok||!item?.id){
            return respostaErro(
                res,
                ir.status||404,
                formatarErroMercadoLivre(item)||'Anúncio não encontrado.'
            );
        }

        if(String(item.seller_id)!==String(seller)){
            return respostaErro(
                res,
                403,
                'Este anúncio não pertence à conta Mercado Livre conectada.'
            );
        }

        const desc=await descricaoItemV96(token,itemId)
          .catch(()=>({plain_text:'',existe:false}));

        const sku=String(
            (item.attributes||[])
              .find(a=>String(a?.id||'').toUpperCase()==='SELLER_SKU')
              ?.value_name||
            ''
        ).trim();

        const agente=await escolherAgentePerguntaV100(
            seller,
            {agentId,itemId,sku}
        );

        const contextoItem=compactarItemPerguntaV100(
            item,
            desc.plain_text||''
        );
        const contextoAgente=fatosConfirmadosAgenteV100(agente);

        const schema={
            type:'object',
            properties:{
                answer:{type:'string'},
                confidence:{
                    type:'string',
                    enum:['high','medium','low']
                },
                should_send:{type:'boolean'},
                reason:{type:'string'},
                missing_information:{
                    type:'array',
                    items:{type:'string'}
                },
                used_sources:{
                    type:'array',
                    items:{type:'string'}
                }
            },
            required:[
                'answer',
                'confidence',
                'should_send',
                'reason',
                'missing_information',
                'used_sources'
            ]
        };

        const systemInstruction=
`Você é o agente de atendimento do vendedor no Mercado Livre Brasil.
Sua função é elaborar UMA RESPOSTA CURTA, educada e correta para a pergunta do comprador.

REGRAS OBRIGATÓRIAS:
1. Use somente fatos confirmados no anúncio, na descrição, nos atributos do Mercado Livre e no cadastro manual do agente do produto.
2. Não invente função, compatibilidade, voltagem, material, medida, autonomia, garantia, acessório ou qualquer especificação ausente.
3. Informações pesquisadas automaticamente pelo agente não são consideradas confirmadas, a menos que estejam em approved_facts.
4. Se a pergunta exigir um fato que não está confirmado, não chute. Escreva uma resposta segura dizendo que essa informação precisa ser confirmada antes de orientar o comprador.
5. Não diga ao cliente que você é uma IA.
6. Não mencione "banco de dados", "prompt", "agente", "API" ou processos internos.
7. Não prometa entrega, estoque futuro ou desempenho que não estejam confirmados.
8. Responda em português do Brasil, de forma natural, comercial e objetiva.
9. Máximo recomendado: 500 caracteres.
10. should_send só pode ser true quando a resposta estiver suficientemente sustentada pelos dados confirmados.`;

        const input=
`PERGUNTA DO CLIENTE:
${question}

ANÚNCIO CONFIRMADO:
${JSON.stringify(contextoItem)}

AGENTE DO PRODUTO — INFORMAÇÕES MANUAIS CONFIRMADAS:
${JSON.stringify(contextoAgente||{})}

ID da pergunta: ${questionId||'não informado'}

Retorne somente o JSON solicitado.`;

        const gr=await chamarGeminiInteracao({
            input,
            systemInstruction,
            responseSchema:schema
        });

        let parsed;
        try{
            parsed=JSON.parse(gr.texto);
        }catch(e){
            const m=String(gr.texto||'').match(/\{[\s\S]*\}/);
            if(!m)throw Object.assign(
                new Error('A IA respondeu em formato inválido. Tente novamente.'),
                {status:502}
            );
            parsed=JSON.parse(m[0]);
        }

        const answer=String(parsed?.answer||'').trim().slice(0,2000);
        if(!answer){
            throw Object.assign(
                new Error('A IA não gerou uma resposta utilizável.'),
                {status:502}
            );
        }

        res.json({
            sucesso:true,
            resposta:answer,
            confidence:['high','medium','low'].includes(parsed.confidence)
              ?parsed.confidence
              :'low',
            should_send:Boolean(parsed.should_send),
            reason:String(parsed.reason||'').slice(0,1000),
            missing_information:Array.isArray(parsed.missing_information)
              ?parsed.missing_information.map(x=>String(x).slice(0,300)).slice(0,20)
              :[],
            used_sources:Array.isArray(parsed.used_sources)
              ?parsed.used_sources.map(x=>String(x).slice(0,120)).slice(0,20)
              :[],
            agente:agente?{
                id:agente.id,
                name:agente.name,
                product:agente.product
            }:null,
            sku,
            modelo:gr.model
        });
    }catch(e){
        console.error('[PERGUNTAS IA V100]',e);
        respostaErro(
            res,
            e.status||500,
            'Erro ao gerar resposta com IA: '+e.message
        );
    }
});

/**
 * POST /api/responder-pergunta
 */
app.post('/api/responder-pergunta', async (req, res) => {
    const token =
        obterToken(req);

    if (!token) {
        return respostaErro(
            res,
            401,
            'Token n\u00e3o fornecido.'
        );
    }

    const {
        question_id,
        text
    } = req.body;

    if (!question_id) {
        return respostaErro(
            res,
            400,
            'ID da pergunta n\u00e3o informado.'
        );
    }

    if (
        !text ||
        !String(text).trim()
    ) {
        return respostaErro(
            res,
            400,
            'Digite uma resposta.'
        );
    }

    const resposta =
        String(text).trim();

    if (resposta.length > 2000) {
        return respostaErro(
            res,
            400,
            'A resposta n\u00e3o pode ultrapassar 2.000 caracteres.'
        );
    }

    try {
        const response =
            await mlFetch(
                `${ML_API}/answers`,
                token,
                {
                    method:
                        'POST',
                    headers: {
                        'Content-Type':
                            'application/json'
                    },
                    body:
                        JSON.stringify({
                            question_id:
                                Number(
                                    question_id
                                ),
                            text:
                                resposta
                        })
                }
            );

        const data =
            await jsonSeguro(
                response
            );

        if (!response.ok) {
            return respostaErro(
                res,
                response.status,
                formatarErroMercadoLivre(
                    data
                )
            );
        }

        res.json({
            sucesso: true,
            mensagem:
                'Resposta enviada ao Mercado Livre.',
            resultado:
                data
        });

    } catch (error) {
        console.error(
            'Erro resposta:',
            error
        );

        return respostaErro(
            res,
            500,
            'Erro ao enviar resposta: ' +
            error.message
        );
    }
});

/* =========================================================
   ATUALIZAR T\u00cdTULO E SKU DO AN\u00daNCIO
========================================================= */

app.put('/api/atualizar-anuncio', async (req, res) => {
    const token = obterToken(req);

    if (!token) {
        return respostaErro(res, 401, 'Token n\u00e3o fornecido.');
    }

    const { id, title, sku, available_quantity } = req.body || {};

    if (!id) {
        return respostaErro(res, 400, 'ID do an\u00fancio n\u00e3o informado.');
    }

    const tituloLimpo = String(title ?? '').trim();
    const skuLimpo = String(sku ?? '').trim();
    const estoqueNovo = Number(available_quantity);

    if (!Number.isInteger(estoqueNovo) || estoqueNovo < 0) {
        return respostaErro(res, 400, 'Quantidade de estoque inv\u00e1lida. Informe um n\u00famero inteiro igual ou maior que zero.');
    }

    if (!tituloLimpo) {
        return respostaErro(res, 400, 'O t\u00edtulo do an\u00fancio n\u00e3o pode ficar vazio.');
    }

    if (tituloLimpo.length > 60) {
        return respostaErro(res, 400, 'O t\u00edtulo n\u00e3o pode ultrapassar 60 caracteres.');
    }

    try {
        // Primeiro consulta o an\u00fancio atual. Isso evita reenviar campos que o
        // usu\u00e1rio n\u00e3o alterou. O Mercado Livre pode rejeitar, por exemplo,
        // o campo title em an\u00fancios que j\u00e1 possuem vendas.
        const atualRes = await mlFetch(
            `${ML_API}/items/${encodeURIComponent(id)}`,
            token
        );
        const atual = await jsonSeguro(atualRes);

        if (!atualRes.ok) {
            return respostaErro(
                res,
                atualRes.status || 400,
                formatarErroMercadoLivre(atual) || 'N\u00e3o foi poss\u00edvel consultar o an\u00fancio antes da altera\u00e7\u00e3o.'
            );
        }

        const attrSkuAtual = Array.isArray(atual.attributes)
            ? atual.attributes.find(a => a.id === 'SELLER_SKU')
            : null;

        const skuAtual = String(attrSkuAtual?.value_name ?? '').trim();
        const tituloAtual = String(atual.title ?? '').trim();
        const alterouSku = skuLimpo !== skuAtual;
        const alterouTitulo = tituloLimpo !== tituloAtual;
        const estoqueAtual = Number(atual.available_quantity || 0);
        const alterouEstoque = estoqueNovo !== estoqueAtual;

        if (!alterouSku && !alterouTitulo && !alterouEstoque) {
            return res.json({
                sucesso: true,
                alterou: false,
                item: {
                    id: atual.id || id,
                    title: tituloAtual,
                    sku: skuAtual || 'Sem SKU',
                    status: atual.status,
                    sold_quantity: Number(atual.sold_quantity || 0),
                    available_quantity: Number(atual.available_quantity || 0)
                }
            });
        }

        let ultimoRetorno = atual;
        const alteracoes = [];

        // SKU \u00e9 atualizado isoladamente. Assim uma restri\u00e7\u00e3o de t\u00edtulo n\u00e3o
        // impede a altera\u00e7\u00e3o do SKU e n\u00e3o enviamos campos desnecess\u00e1rios.
        if (alterouSku) {
            const skuRes = await mlFetch(
                `${ML_API}/items/${encodeURIComponent(id)}`,
                token,
                {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        attributes: [
                            {
                                id: 'SELLER_SKU',
                                value_name: skuLimpo || null
                            }
                        ]
                    })
                }
            );

            const skuData = await jsonSeguro(skuRes);

            if (!skuRes.ok) {
                return respostaErro(
                    res,
                    skuRes.status || 400,
                    formatarErroMercadoLivre(skuData) || 'O Mercado Livre recusou a altera\u00e7\u00e3o do SKU.'
                );
            }

            ultimoRetorno = skuData;
            alteracoes.push('SKU');
        }

        // Estoque \u00e9 atualizado isoladamente para n\u00e3o misturar a altera\u00e7\u00e3o com t\u00edtulo/SKU.
        if (alterouEstoque) {
            const estoqueRes = await mlFetch(
                `${ML_API}/items/${encodeURIComponent(id)}`,
                token,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                    body: JSON.stringify({ available_quantity: estoqueNovo })
                }
            );
            const estoqueData = await jsonSeguro(estoqueRes);
            if (!estoqueRes.ok) {
                return respostaErro(
                    res,
                    estoqueRes.status || 400,
                    formatarErroMercadoLivre(estoqueData) || 'O Mercado Livre recusou a altera\u00e7\u00e3o do estoque.'
                );
            }
            ultimoRetorno = estoqueData;
            alteracoes.push('estoque');
        }

        // O Mercado Livre n\u00e3o permite alterar o t\u00edtulo de um an\u00fancio que j\u00e1
        // possui vendas. S\u00f3 tentamos o PUT de title quando ele realmente mudou.
        if (alterouTitulo) {
            if (Number(atual.sold_quantity || 0) > 0) {
                return res.status(409).json({
                    sucesso: false,
                    parcial: alterouSku,
                    sku_atualizado: alterouSku,
                    erro: alterouSku
                        ? 'O SKU foi atualizado, mas o Mercado Livre n\u00e3o permite alterar o t\u00edtulo deste an\u00fancio porque ele j\u00e1 possui vendas.'
                        : 'O Mercado Livre n\u00e3o permite alterar o t\u00edtulo deste an\u00fancio porque ele j\u00e1 possui vendas.',
                    item: {
                        id: atual.id || id,
                        title: tituloAtual,
                        sku: skuLimpo || skuAtual || 'Sem SKU',
                        status: atual.status,
                        sold_quantity: Number(atual.sold_quantity || 0),
                        available_quantity: Number(atual.available_quantity || 0)
                    }
                });
            }

            // Existem hoje dois modelos de publica\u00e7\u00e3o no Mercado Livre.
            // No modelo legado, o t\u00edtulo \u00e9 editado diretamente em /items/{id}.
            // No novo modelo User Products, o campo title do item \u00e9 gerado pelo
            // Mercado Livre e tentar alter\u00e1-lo diretamente retorna BODY_INVALID_FIELDS.
            // Nesse caso alteramos o family_name da fam\u00edlia, que \u00e9 o campo edit\u00e1vel
            // indicado pela API e provoca o rec\u00e1lculo do t\u00edtulo dos itens associados.
            let tituloRes;
            let tituloData;

            if (atual.user_product_id) {
                const upRes = await mlFetch(
                    `${ML_API}/user-products/${encodeURIComponent(atual.user_product_id)}`,
                    token
                );
                const upData = await jsonSeguro(upRes);

                if (!upRes.ok || !upData?.family_id) {
                    return res.status(upRes.status || 400).json({
                        sucesso: false,
                        parcial: alterouSku,
                        sku_atualizado: alterouSku,
                        erro: (alterouSku ? 'O SKU foi atualizado, por\u00e9m n\u00e3o foi poss\u00edvel localizar a fam\u00edlia do an\u00fancio: ' : '') +
                            (formatarErroMercadoLivre(upData) || 'Fam\u00edlia do User Product n\u00e3o encontrada.'),
                        item: {
                            id: atual.id || id,
                            title: tituloAtual,
                            sku: skuLimpo || skuAtual || 'Sem SKU',
                            status: atual.status,
                            sold_quantity: Number(atual.sold_quantity || 0)
                        }
                    });
                }

                tituloRes = await mlFetch(
                    `${ML_API}/user-products-families/${encodeURIComponent(upData.family_id)}`,
                    token,
                    {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify({ family_name: tituloLimpo })
                    }
                );
                tituloData = await jsonSeguro(tituloRes);
            } else {
                tituloRes = await mlFetch(
                    `${ML_API}/items/${encodeURIComponent(id)}`,
                    token,
                    {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify({ title: tituloLimpo })
                    }
                );
                tituloData = await jsonSeguro(tituloRes);
            }

            if (!tituloRes.ok) {
                return res.status(tituloRes.status || 400).json({
                    sucesso: false,
                    parcial: alterouSku,
                    sku_atualizado: alterouSku,
                    erro: (alterouSku ? 'O SKU foi atualizado, por\u00e9m o t\u00edtulo foi recusado pelo Mercado Livre: ' : '') +
                        (formatarErroMercadoLivre(tituloData) || 'Erro ao atualizar o t\u00edtulo.'),
                    item: {
                        id: atual.id || id,
                        title: tituloAtual,
                        sku: skuLimpo || skuAtual || 'Sem SKU',
                        status: atual.status,
                        sold_quantity: Number(atual.sold_quantity || 0),
                        available_quantity: Number(atual.available_quantity || 0)
                    }
                });
            }

            ultimoRetorno = tituloData;
            alteracoes.push(atual.user_product_id ? 'nome da fam\u00edlia/t\u00edtulo' : 't\u00edtulo');
        }

        // Consulta novamente para devolver ao painel exatamente o que ficou
        // salvo no Mercado Livre.
        const finalRes = await mlFetch(
            `${ML_API}/items/${encodeURIComponent(id)}`,
            token
        );
        const finalData = await jsonSeguro(finalRes);
        const finalItem = finalRes.ok ? finalData : ultimoRetorno;

        const attrSkuFinal = Array.isArray(finalItem.attributes)
            ? finalItem.attributes.find(a => a.id === 'SELLER_SKU')
            : null;

        return res.json({
            sucesso: true,
            alterou: true,
            alteracoes,
            item: {
                id: finalItem.id || id,
                title: atual.user_product_id
                    ? (finalItem.family_name || tituloLimpo)
                    : (finalItem.title || tituloLimpo),
                sku: String(attrSkuFinal?.value_name ?? skuLimpo).trim() || 'Sem SKU',
                status: finalItem.status ?? atual.status,
                sold_quantity: Number(finalItem.sold_quantity ?? atual.sold_quantity ?? 0)
            }
        });

    } catch (error) {
        console.error('Erro ao atualizar t\u00edtulo/SKU:', error);

        return respostaErro(
            res,
            500,
            'Erro de conex\u00e3o ao atualizar an\u00fancio: ' + error.message
        );
    }
});


/* =========================================================
   SERVIDOR
========================================================= */



/* =========================================================
   ALTERAR STATUS DO AN\u00daNCIO - PAUSAR / ATIVAR
========================================================= */
app.put('/api/alterar-status-anuncio', async (req, res) => {
    const token = obterToken(req);
    if (!token) return respostaErro(res, 401, 'Token n\u00e3o fornecido.');

    const { id, status } = req.body || {};
    if (!id) return respostaErro(res, 400, 'ID do an\u00fancio n\u00e3o informado.');
    if (!['active', 'paused'].includes(status)) {
        return respostaErro(res, 400, 'Status inv\u00e1lido. Use active ou paused.');
    }

    try {
        const mlRes = await mlFetch(`${ML_API}/items/${encodeURIComponent(id)}`, token, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ status })
        });
        const mlData = await jsonSeguro(mlRes);
        if (!mlRes.ok) {
            return respostaErro(res, mlRes.status || 400, formatarErroMercadoLivre(mlData) || 'O Mercado Livre recusou a altera\u00e7\u00e3o de status.');
        }
        return res.json({
            sucesso: true,
            item: {
                id: mlData.id || id,
                status: mlData.status || status,
                available_quantity: Number(mlData.available_quantity || 0)
            }
        });
    } catch (error) {
        console.error('Erro ao alterar status:', error);
        return respostaErro(res, 500, 'Erro de conex\u00e3o ao alterar status: ' + error.message);
    }
});


/* =========================================================
   ML HUB PRO V2 - ESCALA / 100 MIL+ AN\u00daNCIOS
   - pagina\u00e7\u00e3o server-side
   - busca por scan/scroll para sincroniza\u00e7\u00e3o grande
   - filtros
   - opera\u00e7\u00f5es em massa em lotes controlados
   - alertas operacionais
   - webhook de notifica\u00e7\u00f5es
========================================================= */


function limparTituloRealV76(valor,raw=null){
    return String(valor??'')
      .replace(/\u0000/g,' ')
      .replace(/<[^>]*>/g,' ')
      .replace(/\r?\n+/g,' ')
      .replace(/\s+/g,' ')
      .trim();
}

function normalizarItemGestao(item) {
    const attrs = Array.isArray(item.attributes) ? item.attributes : [];
    const skuAttr = attrs.find(a =>
        ['SELLER_SKU', 'SKU'].includes(String(a.id || '').toUpperCase())
    );
    return {
        id: item.id,
        titulo: limparTituloRealV76(item.title,item),
        sku: item.seller_custom_field || skuAttr?.value_name || '',
        preco: Number(item.price || 0),
        estoque: Number(item.available_quantity || 0),
        vendidos: Number(item.sold_quantity || 0),
        status: item.status || '',
        listing_type_id: item.listing_type_id || '',
        categoria: item.category_id || '',
        thumbnail: item.thumbnail || item.secure_thumbnail || '',
        permalink: item.permalink || '',
        atualizado_em: item.last_updated || null
    };
}

async function buscarIdsAnunciosPaginados(token, sellerId, { offset=0, limit=100, status='', q='', order='last_updated_desc' }={}) {
    const params = new URLSearchParams({
        offset: String(Math.max(0, Number(offset) || 0)),
        limit: String(Math.min(100, Math.max(1, Number(limit) || 100)))
    });
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    if (order) params.set('orders', order);

    const response = await mlFetch(`${ML_API}/users/${sellerId}/items/search?${params}`, token);
    const data = await jsonSeguro(response);
    if (!response.ok) throw new Error(formatarErroMercadoLivre(data));
    return data;
}

app.get('/api/v2/anuncios', async (req, res) => {
    const token = obterToken(req);
    if (!token) return respostaErro(res, 401, 'Token n\u00e3o fornecido.');

    try {
        const meRes = await mlFetch(`${ML_API}/users/me`, token);
        const me = await jsonSeguro(meRes);
        if (!meRes.ok || !me?.id) return respostaErro(res, 401, 'Token inv\u00e1lido ou expirado.');

        const pagina = Math.max(1, Number(req.query.page || 1));
        const limit = Math.min(100, Math.max(10, Number(req.query.limit || 50)));
        const offset = (pagina - 1) * limit;
        const status = String(req.query.status || '').trim();
        const q = String(req.query.q || '').trim();
        const order = String(req.query.order || 'last_updated_desc').trim();

        // Offset \u00e9 ideal para navega\u00e7\u00e3o comum. Sincroniza\u00e7\u00f5es acima de 1000 usam /api/v2/sync/scan.
        const busca = await buscarIdsAnunciosPaginados(token, me.id, { offset, limit, status, q, order });
        const ids = Array.isArray(busca.results) ? busca.results : [];
        const detalhes = await buscarItensBulk(token, ids);
        const itens = ids.map(id => detalhes[id]).filter(Boolean).map(normalizarItemGestao);

        res.json({
            sucesso: true,
            pagina,
            limite: limit,
            total: Number(busca.paging?.total || itens.length),
            paginas: Math.max(1, Math.ceil(Number(busca.paging?.total || itens.length) / limit)),
            itens
        });
    } catch (erro) {
        respostaErro(res, 500, 'Erro ao listar an\u00fancios: ' + erro.message);
    }
});



/* =========================================================
   V86 — PUXAR ANÚNCIOS DIRETO / SEM POSTGRESQL
   100 anúncios por página, checkpoint no navegador.
========================================================= */


async function consultarComissaoItemV88(item,token){
    const price=Number(item?.price||0);
    const listingType=String(item?.listing_type_id||'').trim();
    if(!(price>0)||!listingType)throw new Error('Anúncio sem preço/listing_type.');

    const site=String(item?.site_id||'MLB');
    const shipping=item?.shipping||{};

    const baseParams={
        price:String(price),
        currency_id:String(item?.currency_id||'BRL'),
        listing_type_id:listingType
    };

    if(item?.catalog_product_id){
        baseParams.catalog_product_id=String(item.catalog_product_id);
    }else if(item?.category_id){
        baseParams.category_id=String(item.category_id);
    }

    // A documentação do ML tem exemplos com shipping_mode e shipping_modes.
    // Tentamos os formatos mais completos primeiro e fazemos fallback sem logística
    // para nunca zerar a comissão por incompatibilidade de parâmetro.
    const variantes=[];

    if(shipping?.logistic_type || shipping?.mode){
        const v1={...baseParams};
        if(shipping?.logistic_type)v1.logistic_type=String(shipping.logistic_type);
        if(shipping?.mode)v1.shipping_mode=String(shipping.mode);
        variantes.push(v1);

        const v2={...baseParams};
        if(shipping?.logistic_type)v2.logistic_type=String(shipping.logistic_type);
        if(shipping?.mode)v2.shipping_modes=String(shipping.mode);
        variantes.push(v2);
    }

    variantes.push({...baseParams});

    let ultimo='Falha ao consultar comissão.';

    for(const variante of variantes){
        const params=new URLSearchParams(variante);

        for(let tentativa=1;tentativa<=3;tentativa++){
            const controller=new AbortController();
            const timer=setTimeout(()=>controller.abort(),12000);

            try{
                const r=await mlFetch(
                    `${ML_API}/sites/${encodeURIComponent(site)}/listing_prices?${params.toString()}`,
                    token,
                    {signal:controller.signal,headers:{Accept:'application/json'}}
                );
                const d=await jsonSeguro(r);

                if(r.ok){
                    const lista=flattenListingPricesV28(d);
                    const row=
                      lista.find(x=>String(x?.listing_type_id||x?.mapping||'')===listingType && Number.isFinite(Number(x?.sale_fee_amount))) ||
                      lista.find(x=>Number.isFinite(Number(x?.sale_fee_amount))) ||
                      null;

                    if(row){
                        const saleFee=Number(row.sale_fee_amount);
                        let percentage=Number(row?.sale_fee_details?.percentage_fee);

                        // Só como fallback visual quando a API não manda percentage_fee.
                        // sale_fee_amount continua sendo o valor oficial usado no "Você recebe".
                        if(!Number.isFinite(percentage) && price>0){
                            percentage=(saleFee/price)*100;
                        }

                        if(Number.isFinite(saleFee) && saleFee>=0){
                            return {
                                sale_fee_amount:Number(saleFee.toFixed(2)),
                                percentage_fee:Number.isFinite(percentage)?Number(percentage.toFixed(4)):0,
                                source:'listing_prices'
                            };
                        }
                    }

                    ultimo='Listing Prices respondeu sem sale_fee_amount.';
                    break;
                }

                ultimo=`Comissão HTTP ${r.status}: ${formatarErroMercadoLivre(d)}`;

                // 400 pode ser incompatibilidade de parâmetro; passa para a próxima variante.
                if(r.status===400)break;

                if(![408,429,500,502,503,504].includes(r.status))break;

                const retryAfter=Number(r.headers?.get?.('retry-after')||0);
                await new Promise(resolve=>setTimeout(
                    resolve,
                    retryAfter>0?Math.min(6000,retryAfter*1000):400*tentativa
                ));
            }catch(e){
                ultimo=e?.name==='AbortError'?'Timeout ao consultar comissão.':String(e?.message||e);
                if(tentativa<3)await new Promise(r=>setTimeout(r,400*tentativa));
            }finally{
                clearTimeout(timer);
            }
        }
    }

    throw new Error(ultimo);
}

function chaveComissaoDiretaV87(item){
    const shipping=item?.shipping||{};
    return [
        String(item?.site_id||'MLB'),
        Number(item?.price||0).toFixed(2),
        String(item?.currency_id||'BRL'),
        String(item?.listing_type_id||''),
        String(item?.catalog_product_id||''),
        String(item?.category_id||''),
        String(shipping?.logistic_type||''),
        String(shipping?.mode||'')
    ].join('|');
}

async function enriquecerComissoesDiretoV87(rawItens,token){
    const itens=Array.isArray(rawItens)?rawItens:[];
    if(!itens.length)return {mapa:new Map(),erros:0,consultas:0};

    // Muitos anúncios possuem exatamente o mesmo contexto de taxa.
    // Consultamos a API uma vez por combinação realmente diferente.
    const grupos=new Map();
    for(const item of itens){
        const k=chaveComissaoDiretaV87(item);
        if(!grupos.has(k))grupos.set(k,[]);
        grupos.get(k).push(item);
    }

    const entradas=[...grupos.entries()];
    const resultados=new Map();
    let cursor=0;
    let erros=0;

    const concorrencia=Math.max(
        4,
        Math.min(24,Number(process.env.ML_COMMISSION_CONCURRENCY||16))
    );

    async function worker(){
        while(true){
            const idx=cursor++;
            if(idx>=entradas.length)return;

            const [key,grupo]=entradas[idx];
            const amostra=grupo[0];

            try{
                const fee=await consultarComissaoItemV88(amostra,token);
                resultados.set(key,{
                    sale_fee:Number(fee.sale_fee_amount||0),
                    commission_percentage:Number(fee.percentage_fee||0),
                    erro:null
                });
            }catch(e){
                erros++;
                resultados.set(key,{
                    sale_fee:0,
                    commission_percentage:0,
                    erro:String(e?.message||e||'Falha ao consultar comissão.')
                });
            }
        }
    }

    await Promise.all(
        Array.from(
            {length:Math.min(concorrencia,Math.max(1,entradas.length))},
            ()=>worker()
        )
    );

    const mapa=new Map();
    for(const item of itens){
        const r=resultados.get(chaveComissaoDiretaV87(item))||{
            sale_fee:0,
            commission_percentage:0,
            erro:'Comissão não retornada.'
        };
        mapa.set(String(item.id),r);
    }

    return {
        mapa,
        erros,
        consultas:entradas.length
    };
}




/* =========================================================
   V103 — RESILIÊNCIA / MIRROR / JOB CONTROL
========================================================= */
function sleepV103(ms){
    return new Promise(resolve=>setTimeout(resolve,Math.max(0,Number(ms||0))));
}

function jitterV103(base=250){
    const b=Math.max(50,Number(base||250));
    return Math.floor(b*(0.75+Math.random()*0.5));
}

function erroTemporarioHttpV103(status,msg=''){
    return [408,425,429,500,502,503,504].includes(Number(status)) ||
      /timeout|timed out|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|socket|network|fetch/i.test(String(msg||''));
}

async function registrarEventoJobV103(jobId,sellerId,level,code,message,meta={}){
    if(!db)return;
    try{
        await dbQuery(`
          INSERT INTO ml_job_events_v103(job_id,seller_id,level,code,message,meta)
          VALUES($1,$2,$3,$4,$5,$6::jsonb)
        `,[
          Number(jobId),
          Number(sellerId),
          String(level||'info').slice(0,30),
          String(code||'').slice(0,80),
          String(message||'').slice(0,800),
          JSON.stringify(meta||{})
        ],{tentativas:2});
    }catch(e){}
}

async function estadoJobV103(jobId){
    if(!db)return null;
    const r=await dbQuery(
      `SELECT id,status,type,progress_current,progress_total,processed,errors,cursor,message,result,updated_at
       FROM ml_jobs WHERE id=$1`,
      [Number(jobId)],
      {tentativas:2}
    );
    return r.rows[0]||null;
}

async function espelharAnunciosDiretosV103(sellerId,raws,comissoes){
    if(!db || !Array.isArray(raws) || !raws.length)return false;

    const itens=raws.map(raw=>{
        const fee=comissoes?.mapa?.get?.(String(raw?.id))||{};
        return {
            ...raw,
            _sale_fee_amount:Number(fee.sale_fee||0),
            _commission_percentage:Number(fee.commission_percentage||0),
            _commission_synced_at:new Date().toISOString()
        };
    });

    try{
        await Promise.race([
            upsertItensDb(sellerId,itens),
            new Promise((_,reject)=>setTimeout(
                ()=>reject(new Error('timeout_mirror_db_v103')),
                12000
            ))
        ]);
        return true;
    }catch(e){
        console.warn('[V103 MIRROR ANÚNCIOS]',e.message);
        return false;
    }
}

async function sellerIdRequestV103(req,token){
    if(req?.mlhubSellerId)return String(req.mlhubSellerId);
    const me=await usuarioML(token);
    return String(me.id);
}

/* =========================================================
   V93 — ANÚNCIOS · LOTE REAL DE ATÉ 1.000
   - o scan do ML é encadeado (scroll_id), portanto as 10 páginas
     de 100 precisam ser obtidas em sequência;
   - assim que os 1.000 IDs estão reunidos, detalhes e comissão
     são processados em paralelo com concorrência controlada;
   - o frontend salva um checkpoint somente após fechar o lote.
========================================================= */
app.get('/api/v93/anuncios/lote1000',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    try{
        const me=await usuarioML(token);
        const sellerId=String(me.id);
        let scrollId=String(req.query.scroll_id||'').trim()||null;

        const ids=[];
        let total=0;
        let terminou=false;

        for(let paginaN=0;paginaN<10 && !terminou;paginaN++){
            const pagina=await buscarPaginaScanV84({
                sellerId,
                token,
                scrollId
            });

            if(pagina.cursor_expirado){
                return res.status(409).json({
                    sucesso:false,
                    cursor_expirado:true,
                    seller_id:sellerId,
                    erro:'Cursor expirado.'
                });
            }

            if(total<=0 && Number(pagina.total||0)>0){
                total=Number(pagina.total||0);
            }

            const novos=Array.isArray(pagina.results)
                ? pagina.results.map(String).filter(Boolean)
                : [];

            for(const id of novos){
                if(!ids.includes(id)){
                    ids.push(id);
                    if(ids.length>=1000)break;
                }
            }

            scrollId=pagina.scroll_id||null;

            if(!novos.length || !scrollId || ids.length>=1000){
                terminou=!scrollId || !novos.length;
                break;
            }
        }

        let mapa={};
        if(ids.length){
            const detalhes=await buscarItensBulkFreteRapido(token,ids);
            mapa=detalhes?.mapa||{};
        }

        const raws=ids.map(id=>mapa[String(id)]).filter(Boolean);

        const comissoes=raws.length
            ? await enriquecerComissoesDiretoV87(raws,token)
            : {mapa:new Map(),erros:0,consultas:0};

        const itens=[];

        for(const id of ids){
            const raw=mapa[String(id)];
            if(!raw)continue;

            const n=normalizarItemGestao(raw);
            const fee=comissoes.mapa.get(String(id))||{
                sale_fee:0,
                commission_percentage:0
            };

            const price=Number(n.preco||0);
            const saleFee=Math.max(0,Number(fee.sale_fee||0));

            itens.push({
                id:String(n.id||id),
                title:String(n.titulo||''),
                sku:String(n.sku||''),
                price,
                sale_fee:saleFee,
                commission_percentage:Math.max(0,Number(fee.commission_percentage||0)),
                shipping_cost:Number(raw?.shipping_cost||0),
                net_received:Math.max(0,price-saleFee-Number(raw?.shipping_cost||0)),
                available_quantity:Number(n.estoque||0),
                sold_quantity:Number(n.vendidos||0),
                status:String(n.status||''),
                listing_type_id:String(n.listing_type_id||''),
                category_id:String(n.categoria||''),
                thumbnail:String(n.thumbnail||''),
                permalink:String(n.permalink||''),
                last_updated:n.atualizado_em||raw?.last_updated||null,
                date_created:raw?.date_created||null
            });
        }

        const dbMirrored=await espelharAnunciosDiretosV103(
            sellerId,
            raws,
            comissoes
        );

        return res.json({
            sucesso:true,
            mode:'direct_v93_batch_1000',
            db_mirrored:dbMirrored,
            seller_id:sellerId,
            total,
            ids_count:ids.length,
            itens_count:itens.length,
            commission_queries:Number(comissoes.consultas||0),
            commission_errors:Number(comissoes.erros||0),
            scroll_id:scrollId,
            terminou:Boolean(terminou),
            itens
        });
    }catch(e){
        const msg=String(e?.message||e||'');
        const temp=/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|AbortError|timeout|socket|fetch|network|429|500|502|503|504/i.test(msg);

        return respostaErro(
            res,
            temp?503:500,
            temp
              ? 'Instabilidade temporária no lote de anúncios. O checkpoint anterior permanece válido.'
              : 'Erro ao puxar lote de 1.000 anúncios: '+msg
        );
    }
});

app.get('/api/v88/anuncios/scan', async (req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    try{
        const me=await usuarioML(token);
        const sellerId=String(me.id);
        const scrollId=String(req.query.scroll_id||'').trim();

        const pagina=await buscarPaginaScanV84({
            sellerId,
            token,
            scrollId:scrollId||null
        });

        if(pagina.cursor_expirado){
            return res.status(409).json({
                sucesso:false,
                cursor_expirado:true,
                seller_id:sellerId,
                erro:'Cursor expirado.'
            });
        }

        const ids=Array.isArray(pagina.results)?pagina.results.map(String).filter(Boolean):[];
        let mapa={};

        if(ids.length){
            const detalhes=await buscarItensBulkFreteRapido(token,ids);
            mapa=detalhes?.mapa||{};
        }

        const raws=ids.map(id=>mapa[String(id)]).filter(Boolean);

        // Comissão exata via listing_prices, com deduplicação por contexto.
        const comissoes=raws.length
          ? await enriquecerComissoesDiretoV87(raws,token)
          : {mapa:new Map(),erros:0,consultas:0};

        const itens=[];
        for(const id of ids){
            const raw=mapa[String(id)];
            if(!raw)continue;

            const n=normalizarItemGestao(raw);
            const fee=comissoes.mapa.get(String(id))||{
                sale_fee:0,
                commission_percentage:0
            };

            const price=Number(n.preco||0);
            const shippingCost=Number(raw?.shipping_cost||0);
            const saleFee=Math.max(0,Number(fee.sale_fee||0));
            const commissionPercentage=Math.max(0,Number(fee.commission_percentage||0));

            itens.push({
                id:String(n.id||id),
                title:String(n.titulo||''),
                sku:String(n.sku||''),
                price,
                sale_fee:saleFee,
                commission_percentage:commissionPercentage,
                shipping_cost:shippingCost,
                net_received:Math.max(0,price-saleFee-shippingCost),
                available_quantity:Number(n.estoque||0),
                sold_quantity:Number(n.vendidos||0),
                status:String(n.status||''),
                listing_type_id:String(n.listing_type_id||''),
                category_id:String(n.categoria||''),
                thumbnail:String(n.thumbnail||''),
                permalink:String(n.permalink||''),
                last_updated:n.atualizado_em||raw?.last_updated||null,
                date_created:raw?.date_created||null
            });
        }

        return res.json({
            sucesso:true,
            mode:'direct_v88_commission',
            seller_id:sellerId,
            total:Number(pagina.total||0),
            ids_count:ids.length,
            itens_count:itens.length,
            commission_queries:Number(comissoes.consultas||0),
            commission_errors:Number(comissoes.erros||0),
            scroll_id:pagina.scroll_id||null,
            terminou:ids.length===0 || !pagina.scroll_id,
            itens
        });
    }catch(e){
        const msg=String(e?.message||e||'');
        const temp=/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|AbortError|timeout|socket|fetch|network|429|500|502|503|504/i.test(msg);

        return respostaErro(
            res,
            temp?503:500,
            temp
              ? 'Instabilidade temporária. Repita a chamada; o checkpoint local continua salvo.'
              : 'Erro ao puxar anúncios e comissão: '+msg
        );
    }
});

app.get('/api/v87/anuncios/scan', async (req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    try{
        const me=await usuarioML(token);
        const sellerId=String(me.id);
        const scrollId=String(req.query.scroll_id||'').trim();

        const pagina=await buscarPaginaScanV84({
            sellerId,
            token,
            scrollId:scrollId||null
        });

        if(pagina.cursor_expirado){
            return res.status(409).json({
                sucesso:false,
                cursor_expirado:true,
                seller_id:sellerId,
                erro:'Cursor expirado.'
            });
        }

        const ids=Array.isArray(pagina.results)?pagina.results.map(String).filter(Boolean):[];
        let mapa={};

        if(ids.length){
            const detalhes=await buscarItensBulkFreteRapido(token,ids);
            mapa=detalhes?.mapa||{};
        }

        const raws=ids.map(id=>mapa[String(id)]).filter(Boolean);

        // Comissão exata via listing_prices, com deduplicação por contexto.
        const comissoes=raws.length
          ? await enriquecerComissoesDiretoV87(raws,token)
          : {mapa:new Map(),erros:0,consultas:0};

        const itens=[];
        for(const id of ids){
            const raw=mapa[String(id)];
            if(!raw)continue;

            const n=normalizarItemGestao(raw);
            const fee=comissoes.mapa.get(String(id))||{
                sale_fee:0,
                commission_percentage:0
            };

            const price=Number(n.preco||0);
            const shippingCost=Number(raw?.shipping_cost||0);
            const saleFee=Math.max(0,Number(fee.sale_fee||0));
            const commissionPercentage=Math.max(0,Number(fee.commission_percentage||0));

            itens.push({
                id:String(n.id||id),
                title:String(n.titulo||''),
                sku:String(n.sku||''),
                price,
                sale_fee:saleFee,
                commission_percentage:commissionPercentage,
                shipping_cost:shippingCost,
                net_received:Math.max(0,price-saleFee-shippingCost),
                available_quantity:Number(n.estoque||0),
                sold_quantity:Number(n.vendidos||0),
                status:String(n.status||''),
                listing_type_id:String(n.listing_type_id||''),
                category_id:String(n.categoria||''),
                thumbnail:String(n.thumbnail||''),
                permalink:String(n.permalink||''),
                last_updated:n.atualizado_em||raw?.last_updated||null,
                date_created:raw?.date_created||null
            });
        }

        return res.json({
            sucesso:true,
            mode:'direct_v87_commission',
            seller_id:sellerId,
            total:Number(pagina.total||0),
            ids_count:ids.length,
            itens_count:itens.length,
            commission_queries:Number(comissoes.consultas||0),
            commission_errors:Number(comissoes.erros||0),
            scroll_id:pagina.scroll_id||null,
            terminou:ids.length===0 || !pagina.scroll_id,
            itens
        });
    }catch(e){
        const msg=String(e?.message||e||'');
        const temp=/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|AbortError|timeout|socket|fetch|network|429|500|502|503|504/i.test(msg);

        return respostaErro(
            res,
            temp?503:500,
            temp
              ? 'Instabilidade temporária. Repita a chamada; o checkpoint local continua salvo.'
              : 'Erro ao puxar anúncios e comissão: '+msg
        );
    }
});

app.get('/api/v86/anuncios/scan', async (req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    try{
        const me=await usuarioML(token);
        const sellerId=String(me.id);
        const scrollId=String(req.query.scroll_id||'').trim();

        const pagina=await buscarPaginaScanV84({
            sellerId,
            token,
            scrollId:scrollId||null
        });

        if(pagina.cursor_expirado){
            return res.status(409).json({
                sucesso:false,
                cursor_expirado:true,
                seller_id:sellerId,
                erro:'Cursor expirado.'
            });
        }

        const ids=Array.isArray(pagina.results)?pagina.results.map(String).filter(Boolean):[];
        let mapa={};

        if(ids.length){
            const detalhes=await buscarItensBulkFreteRapido(token,ids);
            mapa=detalhes?.mapa||{};
        }

        const itens=[];
        for(const id of ids){
            const raw=mapa[String(id)];
            if(!raw)continue;

            const n=normalizarItemGestao(raw);
            itens.push({
                id:String(n.id||id),
                title:String(n.titulo||''),
                sku:String(n.sku||''),
                price:Number(n.preco||0),
                sale_fee:Number(raw?.sale_fee||0),
                commission_percentage:Number(raw?.commission_percentage||0),
                shipping_cost:Number(raw?.shipping_cost||0),
                net_received:Number(n.preco||0),
                available_quantity:Number(n.estoque||0),
                sold_quantity:Number(n.vendidos||0),
                status:String(n.status||''),
                listing_type_id:String(n.listing_type_id||''),
                category_id:String(n.categoria||''),
                thumbnail:String(n.thumbnail||''),
                permalink:String(n.permalink||''),
                last_updated:n.atualizado_em||raw?.last_updated||null,
                date_created:raw?.date_created||null
            });
        }

        return res.json({
            sucesso:true,
            mode:'direct_v86',
            seller_id:sellerId,
            total:Number(pagina.total||0),
            ids_count:ids.length,
            itens_count:itens.length,
            scroll_id:pagina.scroll_id||null,
            terminou:ids.length===0 || !pagina.scroll_id,
            itens
        });
    }catch(e){
        const msg=String(e?.message||e||'');
        const temp=/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|AbortError|timeout|socket|fetch|network|429|500|502|503|504/i.test(msg);
        return respostaErro(
            res,
            temp?503:500,
            temp
              ? 'Instabilidade temporária. Repita a chamada; o checkpoint local continua salvo.'
              : 'Erro ao puxar anúncios: '+msg
        );
    }
});

/* =========================================================
   V85 — SINCRONIZAÇÃO DIRETA DE ANÚNCIOS, SEM POSTGRESQL
   Esta rota depende somente da API do Mercado Livre.
========================================================= */
app.get('/api/v85/anuncios/scan',async(req,res)=>{
    const token=obterToken(req);
    if(!token)return respostaErro(res,401,'Token não fornecido.');

    try{
        const me=await usuarioML(token);
        const scrollId=String(req.query.scroll_id||'').trim();

        const pagina=await buscarPaginaScanV84({
            sellerId:me.id,
            token,
            scrollId:scrollId||null
        });

        if(pagina.cursor_expirado){
            return res.status(409).json({
                sucesso:false,
                cursor_expirado:true,
                seller_id:String(me.id),
                erro:'O cursor do Mercado Livre expirou. Reinicie a leitura; os anúncios já salvos localmente não serão perdidos.'
            });
        }

        const ids=Array.isArray(pagina.results)?pagina.results:[];
        const detalhes=ids.length
          ? await buscarItensBulkFreteRapido(token,ids)
          : {mapa:{},falhas:new Map()};

        const itens=[];
        for(const id of ids){
            const raw=detalhes.mapa[String(id)];
            if(!raw)continue;
            const n=normalizarItemGestao(raw);
            itens.push({
                id:String(n.id||id),
                title:String(n.titulo||''),
                sku:String(n.sku||''),
                price:Number(n.preco||0),
                sale_fee:0,
                commission_percentage:0,
                shipping_cost:0,
                net_received:Number(n.preco||0),
                available_quantity:Number(n.estoque||0),
                sold_quantity:Number(n.vendidos||0),
                status:String(n.status||''),
                listing_type_id:String(n.listing_type_id||''),
                category_id:String(n.categoria||''),
                thumbnail:String(n.thumbnail||''),
                permalink:String(n.permalink||''),
                last_updated:n.atualizado_em||raw?.last_updated||null,
                date_created:raw?.date_created||null
            });
        }

        res.json({
            sucesso:true,
            mode:'direct_v85',
            seller_id:String(me.id),
            total:Number(pagina.total||0),
            quantidade_ids:ids.length,
            quantidade_itens:itens.length,
            scroll_id:pagina.scroll_id||null,
            terminou:ids.length===0 || !pagina.scroll_id,
            itens
        });
    }catch(e){
        const msg=String(e?.message||e||'');
        const temporario=/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timeout|socket|fetch|network|429|502|503|504/i.test(msg);
        respostaErro(res,temporario?503:500,
            temporario
              ? 'Conexão temporária ao Mercado Livre/servidor. Tente novamente; o checkpoint local continua salvo.'
              : 'Erro ao puxar anúncios do Mercado Livre: '+msg
        );
    }
});

app.get('/api/v2/sync/scan', async (req, res) => {
    const token = obterToken(req);
    if (!token) return respostaErro(res, 401, 'Token n\u00e3o fornecido.');

    try {
        const meRes = await mlFetch(`${ML_API}/users/me`, token);
        const me = await jsonSeguro(meRes);
        if (!meRes.ok || !me?.id) return respostaErro(res, 401, 'Token inv\u00e1lido ou expirado.');

        const limit = Math.min(100, Math.max(10, Number(req.query.limit || 100)));
        const scrollId = String(req.query.scroll_id || '').trim();
        const params = new URLSearchParams({ search_type: 'scan', limit: String(limit) });
        if (scrollId) params.set('scroll_id', scrollId);

        const mlRes = await mlFetch(`${ML_API}/users/${me.id}/items/search?${params}`, token);
        const data = await jsonSeguro(mlRes);
        if (!mlRes.ok) return respostaErro(res, mlRes.status, formatarErroMercadoLivre(data));

        const ids = Array.isArray(data.results) ? data.results : [];
        const detalhes = await buscarItensBulk(token, ids);
        res.json({
            sucesso: true,
            scroll_id: data.scroll_id || null,
            terminou: ids.length === 0,
            quantidade: ids.length,
            itens: ids.map(id => detalhes[id]).filter(Boolean).map(normalizarItemGestao)
        });
    } catch (erro) {
        respostaErro(res, 500, 'Erro na sincroniza\u00e7\u00e3o por scan: ' + erro.message);
    }
});

app.post('/api/v2/anuncios/massa', async (req, res) => {
    const token = obterToken(req);
    if (!token) return respostaErro(res, 401, 'Token n\u00e3o fornecido.');

    const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).filter(Boolean))];
    const acao = String(req.body?.acao || '').trim();
    const valor = req.body?.valor;

    if (!ids.length) return respostaErro(res, 400, 'Selecione ao menos um an\u00fancio.');
    if (ids.length > 500) return respostaErro(res, 400, 'Envie no m\u00e1ximo 500 an\u00fancios por lote.');
    if (!['pausar','ativar','estoque','preco_percentual'].includes(acao)) {
        return respostaErro(res, 400, 'A\u00e7\u00e3o em massa inv\u00e1lida.');
    }

    const resultados = [];
    const concorrencia = 5;
    for (let i=0; i<ids.length; i+=concorrencia) {
        const grupo = ids.slice(i, i+concorrencia);
        const lote = await Promise.all(grupo.map(async id => {
            try {
                let body;
                if (acao === 'pausar') body = { status: 'paused' };
                if (acao === 'ativar') body = { status: 'active' };
                if (acao === 'estoque') body = { available_quantity: Math.max(0, Number(valor || 0)) };
                if (acao === 'preco_percentual') {
                    const itemRes = await mlFetch(`${ML_API}/items/${id}`, token);
                    const item = await jsonSeguro(itemRes);
                    if (!itemRes.ok) throw new Error(formatarErroMercadoLivre(item));
                    const percentual = Number(valor || 0);
                    body = { price: Number((Number(item.price || 0) * (1 + percentual/100)).toFixed(2)) };
                }
                const putRes = await mlFetch(`${ML_API}/items/${id}`, token, {
                    method: 'PUT',
                    headers: { 'Content-Type':'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await jsonSeguro(putRes);
                if (!putRes.ok) throw new Error(formatarErroMercadoLivre(data));
                return { id, sucesso:true, novo: body };
            } catch (erro) {
                return { id, sucesso:false, erro:erro.message };
            }
        }));
        resultados.push(...lote);
    }

    res.json({
        sucesso:true,
        total:resultados.length,
        concluidos:resultados.filter(x=>x.sucesso).length,
        erros:resultados.filter(x=>!x.sucesso).length,
        resultados
    });
});

app.get('/api/v2/alertas', async (req, res) => {
    const token = obterToken(req);
    if (!token) return respostaErro(res, 401, 'Token n\u00e3o fornecido.');
    try {
        const meRes = await mlFetch(`${ML_API}/users/me`, token);
        const me = await jsonSeguro(meRes);
        if (!meRes.ok || !me?.id) return respostaErro(res, 401, 'Token inv\u00e1lido ou expirado.');

        const busca = await buscarIdsAnunciosPaginados(token, me.id, { offset:0, limit:100, order:'last_updated_desc' });
        const ids = Array.isArray(busca.results) ? busca.results : [];
        const detalhes = await buscarItensBulk(token, ids);
        const itens = ids.map(id=>detalhes[id]).filter(Boolean).map(normalizarItemGestao);

        const alertas = [];
        itens.forEach(i => {
            if (i.status === 'active' && i.estoque <= 0) alertas.push({tipo:'estoque_zero', nivel:'alto', item_id:i.id, titulo:i.titulo, mensagem:'An\u00fancio ativo sem estoque.'});
            else if (i.status === 'active' && i.estoque <= 3) alertas.push({tipo:'estoque_critico', nivel:'medio', item_id:i.id, titulo:i.titulo, mensagem:`Estoque cr\u00edtico: ${i.estoque} unidade(s).`});
            if (!i.sku) alertas.push({tipo:'sem_sku', nivel:'baixo', item_id:i.id, titulo:i.titulo, mensagem:'An\u00fancio sem SKU identificado.'});
        });

        res.json({sucesso:true, analisados:itens.length, total_conta:Number(busca.paging?.total||0), alertas:alertas.slice(0,100)});
    } catch (erro) {
        respostaErro(res,500,'Erro ao gerar alertas: '+erro.message);
    }
});

// Configure esta URL como callback de notifica\u00e7\u00f5es no DevCenter.
// O endpoint responde imediatamente; em produ\u00e7\u00e3o, encaminhe o evento para uma fila/worker persistente.
app.post('/api/notifications', (req, res) => {
    res.status(200).json({ recebido:true });
    const evento = req.body || {};
    setImmediate(async () => {
        console.log('[ML notification]', {topic:evento.topic,resource:evento.resource,user_id:evento.user_id,received:evento.received});
        try {
            if (db) await dbQuery(`INSERT INTO ml_notifications(external_id,seller_id,topic,resource,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
              [evento._id||evento.id||null,evento.user_id||null,String(evento.topic||''),String(evento.resource||''),evento]);
        } catch(e) { console.error('[ML notification queue]',e.message); }
    });
});



/* =========================================================
   ML HUB PRO SUITE V3
   P\u00f3s-venda, IA, Bling, auditoria e integra\u00e7\u00f5es
========================================================= */
const BLING_STORE_FILE = process.env.BLING_STORE_FILE || path.join(APP_ROOT, 'bling-oauth-store.json');

function lerJsonArquivoSeguro(arquivo) {
    try { return JSON.parse(fs.readFileSync(arquivo,'utf8')); } catch(e) { return {}; }
}
function salvarJsonArquivoSeguro(arquivo, dados) {
    fs.writeFileSync(arquivo, JSON.stringify(dados,null,2), {encoding:'utf8',mode:0o600});
}
async function usuarioML(token) {
    const r=await mlFetch(`${ML_API}/users/me`,token);
    const d=await jsonSeguro(r);
    if(!r.ok||!d?.id) throw new Error('N\u00e3o foi poss\u00edvel identificar a conta Mercado Livre.');
    return d;
}

app.get('/api/v3/claims', async (req,res)=>{
    const token=obterToken(req); if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');
    try{
        const me=await usuarioML(token);
        const status=String(req.query.status||'opened');
        const params=new URLSearchParams({'players.user_id':String(me.id),'players.role':'respondent','limit':'30','offset':'0','sort':'last_updated:desc'});
        if(status)params.set('status',status);
        const r=await mlFetch(`${ML_API}/post-purchase/v1/claims/search?${params}`,token);
        const d=await jsonSeguro(r); if(!r.ok)return respostaErro(res,r.status,formatarErroMercadoLivre(d));
        const base=Array.isArray(d.data)?d.data:[];
        const enriquecidas=await Promise.all(base.slice(0,30).map(async c=>{
            try{const rd=await mlFetch(`${ML_API}/post-purchase/v1/claims/${c.id}/detail`,token);const dd=await jsonSeguro(rd);return {...c,due_date:rd.ok?dd.due_date:null,detail_title:rd.ok?dd.title:null};}catch(e){return c}
        }));
        res.json({sucesso:true,total:Number(d.paging?.total||base.length),reclamacoes:enriquecidas});
    }catch(e){respostaErro(res,500,'Erro ao consultar reclama\u00e7\u00f5es: '+e.message)}
});
app.get('/api/v3/claims/:id/impacto',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');
    try{const r=await mlFetch(`${ML_API}/post-purchase/v1/claims/${encodeURIComponent(req.params.id)}/affects-reputation`,token);const d=await jsonSeguro(r);if(!r.ok)return respostaErro(res,r.status,formatarErroMercadoLivre(d));res.json(d)}catch(e){respostaErro(res,500,e.message)}
});
app.get('/api/v3/bpp/case/:id',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');
    try{const r=await mlFetch(`${ML_API}/moderations/pppi/case/${encodeURIComponent(req.params.id)}`,token);const d=await jsonSeguro(r);if(!r.ok)return respostaErro(res,r.status,formatarErroMercadoLivre(d));res.json(d)}catch(e){respostaErro(res,500,e.message)}
});



app.get('/api/v10/claims/todas', async (req,res) => {
  const token=obterToken(req);
  if(!token) return respostaErro(res,401,'Token n\u00e3o fornecido.');
  try{
    const me=await usuarioML(token);
    if(!me?.id) return respostaErro(res,401,'N\u00e3o foi poss\u00edvel identificar o vendedor do token.');

    const sellerId=String(me.id);
    const mapa=new Map();
    const diagnostico=[];

    async function buscarStatus(status){
      let offset=0, total=0, paginas=0;
      do{
        // Regra oficial: players.user_id + players.role, e offset + limit < 10000.
        const limit=50;
        if(offset + limit >= 10000) break;
        const qs=new URLSearchParams();
        qs.set('players.user_id',sellerId);
        qs.set('players.role','respondent');
        qs.set('status',status);
        qs.set('limit',String(limit));
        qs.set('offset',String(offset));

        const url=`${ML_API}/post-purchase/v1/claims/search?${qs.toString()}`;
        const rr=await mlFetch(url,token);
        const body=await jsonSeguro(rr);

        diagnostico.push({status,http:rr.status,offset,quantidade:Array.isArray(body?.data)?body.data.length:0});
        if(!rr.ok){
          const err=new Error(`Busca de reclama\u00e7\u00f5es ${status}: HTTP ${rr.status} - ${formatarErroMercadoLivre(body)}`);
          err.http=rr.status; throw err;
        }

        const dados=Array.isArray(body?.data)?body.data:[];
        for(const claim of dados) mapa.set(String(claim.id),claim);

        total=Number(body?.paging?.total || 0);
        paginas++;
        offset += dados.length;
        if(!dados.length || dados.length < limit || offset>=total) break;
      }while(paginas<200);
    }

    // Primeiro abertas: assim uma falha nas fechadas nunca impede as pendentes de aparecerem.
    await buscarStatus('opened');
    try{ await buscarStatus('closed'); }
    catch(e){ diagnostico.push({status:'closed',warning:e.message}); }

    const reclamacoes=[...mapa.values()].sort((x,y)=>
      new Date(y.last_updated||y.date_created||0)-new Date(x.last_updated||x.date_created||0)
    );

    return res.json({
      sucesso:true,
      seller_id:sellerId,
      total:reclamacoes.length,
      reclamacoes,
      diagnostico
    });
  }catch(e){
    console.error('[CLAIMS V15]',e);
    return respostaErro(res,e.http||500,e.message||'Erro ao consultar reclama\u00e7\u00f5es.');
  }
});

// Diagn\u00f3stico direto para testar a conex\u00e3o com reclama\u00e7\u00f5es sem depender do frontend.
app.get('/api/v15/claims/diagnostico', async (req,res) => {
  const token=obterToken(req);
  if(!token) return respostaErro(res,401,'Token n\u00e3o fornecido.');
  try{
    const me=await usuarioML(token);
    const qs=new URLSearchParams({
      'players.user_id':String(me.id),
      'players.role':'respondent',
      'status':'opened',
      'limit':'30',
      'offset':'0'
    });
    const rr=await mlFetch(`${ML_API}/post-purchase/v1/claims/search?${qs.toString()}`,token);
    const body=await jsonSeguro(rr);
    return res.status(rr.ok?200:rr.status).json({
      sucesso:rr.ok,
      seller_id:String(me.id),
      mercado_livre_http:rr.status,
      total:Number(body?.paging?.total||0),
      quantidade:Array.isArray(body?.data)?body.data.length:0,
      reclamacoes:Array.isArray(body?.data)?body.data:[],
      erro:rr.ok?null:formatarErroMercadoLivre(body)
    });
  }catch(e){return respostaErro(res,500,e.message)}
});

app.get('/api/v9/claims/:id/dossie',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');
    const id=encodeURIComponent(req.params.id);
    try{
        const urls=[
          `${ML_API}/post-purchase/v1/claims/${id}`,
          `${ML_API}/post-purchase/v1/claims/${id}/detail`,
          `${ML_API}/post-purchase/v1/claims/${id}/messages`,
          `${ML_API}/post-purchase/v1/claims/${id}/affects-reputation`
        ];
        const rr=await Promise.all(urls.map(u=>mlFetch(u,token).then(async r=>({ok:r.ok,status:r.status,data:await jsonSeguro(r)}))));
        if(!rr[0].ok)return respostaErro(res,rr[0].status,formatarErroMercadoLivre(rr[0].data));
        const messages=rr[2].ok&&Array.isArray(rr[2].data)?rr[2].data:[];
        const attachments=[];
        messages.forEach(m=>(m.attachments||[]).forEach(a=>attachments.push({...a,message_date:m.date_created||m.message_date,sender_role:m.sender_role})));
        res.json({sucesso:true,claim:rr[0].data,detail:rr[1].ok?rr[1].data:{},messages,impact:rr[3].ok?rr[3].data:null,attachments});
    }catch(e){respostaErro(res,500,'Erro ao montar dossi\u00ea: '+e.message)}
});

app.get('/api/v9/claims/:id/attachments/:file',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');
    try{
        const u=`${ML_API}/post-purchase/v1/claims/${encodeURIComponent(req.params.id)}/attachments/${encodeURIComponent(req.params.file)}/download`;
        const r=await mlFetch(u,token);
        if(!r.ok){const d=await jsonSeguro(r);return respostaErro(res,r.status,formatarErroMercadoLivre(d))}
        const buf=Buffer.from(await r.arrayBuffer());
        res.setHeader('Content-Type',r.headers.get('content-type')||'application/octet-stream');
        res.setHeader('Cache-Control','private, max-age=60');
        res.send(buf);
    }catch(e){respostaErro(res,500,'Erro ao baixar anexo: '+e.message)}
});


const GEMINI_INTERACTIONS_URL='https://generativelanguage.googleapis.com/v1beta/interactions';

function modelosGeminiDisponiveis(){
    // Modelos atuais documentados pela API Gemini. Se o Render ainda tiver
    // GEMINI_MODEL antigo, ele \u00e9 tentado primeiro e o fallback continua
    // automaticamente para os modelos atuais quando necess\u00e1rio.
    const configurado=String(process.env.GEMINI_MODEL||'').trim();
    const rapido=String(process.env.GEMINI_FAST_MODEL||'').trim();
    const modelos=[
      rapido,
      'gemini-3.8-flash',
      configurado,
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite'
    ].filter(Boolean);
    return [...new Set(modelos)];
}

function extrairTextoGemini(payload){
    const d=payload?.interaction||payload||{};
    if(typeof d.output_text==='string'&&d.output_text.trim())return d.output_text.trim();
    const textos=[];
    for(const step of (Array.isArray(d.steps)?d.steps:[])){
        if(step?.type!=='model_output')continue;
        for(const part of (Array.isArray(step.content)?step.content:[])){
            if(part?.type==='text'&&typeof part.text==='string')textos.push(part.text);
        }
    }
    return textos.join('\n').trim();
}

function erroGeminiAmigavel(status,payload){
    const msg=String(payload?.error?.message||payload?.message||'Erro ao consultar o Gemini.');
    if(status===400 && /api.?key|key/i.test(msg))return 'A chave GEMINI_API_KEY parece inv\u00e1lida. Confira a chave configurada no Render.';
    if(status===401 || status===403)return 'A chave do Gemini n\u00e3o tem permiss\u00e3o para esta solicita\u00e7\u00e3o. Confira GEMINI_API_KEY e o projeto no Google AI Studio.';
    if(status===429)return 'O n\u00edvel gratuito do Gemini est\u00e1 temporariamente no limite. O sistema tentou outros modelos automaticamente.';
    if(status===503)return 'O Gemini est\u00e1 com alta demanda no momento. O sistema tentou outros modelos automaticamente.';
    if(status>=500)return 'O Gemini apresentou uma instabilidade tempor\u00e1ria. O sistema tentou outros modelos automaticamente.';
    return msg;
}

function esperarGemini(ms){
    return new Promise(resolve=>setTimeout(resolve,ms));
}

function erroGeminiTransitorio(status){
    return status===408 || status===429 || status===500 || status===502 || status===503 || status===504;
}

async function chamarGeminiInteracao({input,systemInstruction='',responseSchema=null,tools=[]}){
    const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
    if(!apiKey){
        const e=new Error('IA n\u00e3o configurada. Adicione GEMINI_API_KEY nas vari\u00e1veis de ambiente do Render.');
        e.status=503;throw e;
    }

    const modelos=modelosGeminiDisponiveis();
    const inicio=Date.now();
    const prazoTotalMs=80000;
    let ultimoErro=null;
    const tentativas=[];

    for(const model of modelos){
        for(let tentativa=1;tentativa<=2;tentativa++){
            const decorrido=Date.now()-inicio;
            const restante=prazoTotalMs-decorrido;
            if(restante<5000)break;

            const body={model,input,store:false};
            if(systemInstruction)body.system_instruction=systemInstruction;
            if(Array.isArray(tools)&&tools.length)body.tools=tools;
            if(responseSchema){
                body.response_format={
                    type:'text',
                    mime_type:'application/json',
                    schema:responseSchema
                };
            }

            const controller=new AbortController();
            const timeoutMs=Math.min(25000,Math.max(5000,restante-1000));
            const timer=setTimeout(()=>controller.abort(),timeoutMs);

            try{
                const r=await fetch(GEMINI_INTERACTIONS_URL,{
                    method:'POST',
                    headers:{
                        'Content-Type':'application/json',
                        'x-goog-api-key':apiKey,
                        'Api-Revision':'2026-05-20'
                    },
                    body:JSON.stringify(body),
                    signal:controller.signal
                });
                const d=await r.json().catch(()=>({}));

                if(r.ok){
                    const texto=extrairTextoGemini(d);
                    if(!texto){
                        ultimoErro={status:502,mensagem:'O Gemini respondeu sem texto utiliz\u00e1vel.'};
                        tentativas.push({model,tentativa,status:502});
                        break;
                    }
                    return {
                        texto,
                        model,
                        resposta:d,
                        tentativas
                    };
                }

                const mensagem=erroGeminiAmigavel(r.status,d);
                ultimoErro={status:r.status,mensagem,original:String(d?.error?.message||d?.message||'')};
                tentativas.push({model,tentativa,status:r.status});

                // Chave/permiss\u00e3o: trocar de modelo n\u00e3o resolve.
                if(r.status===401 || r.status===403){
                    const e=new Error(mensagem);e.status=r.status;throw e;
                }

                // Modelo indispon\u00edvel/incompat\u00edvel: pula diretamente para o pr\u00f3ximo.
                if((r.status===400||r.status===404) &&
                   /model|modelo|not found|not supported|unsupported|unknown|does not exist|no longer available|not available/i.test(String(d?.error?.message||d?.message||''))){
                    break;
                }

                // Alta demanda, limite tempor\u00e1rio e 5xx:
                // repete com espera exponencial e depois tenta outro modelo.
                if(erroGeminiTransitorio(r.status)){
                    if(tentativa<2){
                        let espera=tentativa===1?1500:3500;
                        const retryAfter=Number(r.headers.get('retry-after')||0);
                        if(Number.isFinite(retryAfter)&&retryAfter>0)espera=Math.min(8000,retryAfter*1000);
                        await esperarGemini(espera);
                        continue;
                    }
                    break;
                }

                const e=new Error(mensagem);e.status=r.status;throw e;
            }catch(e){
                if(e?.name==='AbortError'){
                    ultimoErro={status:504,mensagem:`O modelo ${model} demorou para responder.`};
                    tentativas.push({model,tentativa,status:504});
                    // Timeout \u00e9 tratado como transit\u00f3rio e o pr\u00f3ximo modelo pode responder.
                    break;
                }
                throw e;
            }finally{
                clearTimeout(timer);
            }
        }
    }

    console.error('[GEMINI FALLBACK ESGOTADO]',{ultimoErro,tentativas});
    const e=new Error(
      ultimoErro?.mensagem ||
      'A IA est\u00e1 temporariamente indispon\u00edvel. Tente novamente em alguns instantes.'
    );
    e.status=ultimoErro?.status||503;
    e.tentativas=tentativas;
    throw e;
}
async function chamarGeminiTexto(prompt,instructions='',responseSchema=null){
    // Compatibilidade com as telas de conte\u00fado j\u00e1 existentes; texto via Cloudflare.
    const json=Boolean(responseSchema)||/somente\s+json|retorne\s+json/i.test(String(prompt)+' '+String(instructions));
    const r=await chamarTextoCloudflareV63(String(instructions||'')+'\n'+String(prompt||''),{json});
    return json?JSON.stringify(r.obj):r.texto;
}

app.post('/api/v9/claims/:id/analisar',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');
    if(!process.env.GEMINI_API_KEY)return respostaErro(res,503,'Configure GEMINI_API_KEY no Render para usar a an\u00e1lise de reclama\u00e7\u00f5es.');
    const id=encodeURIComponent(req.params.id);
    try{
        const get=async path=>{const r=await mlFetch(`${ML_API}${path}`,token);return {ok:r.ok,data:await jsonSeguro(r)}};
        const [cr,dr,mr,ir]=await Promise.all([
          get(`/post-purchase/v1/claims/${id}`),get(`/post-purchase/v1/claims/${id}/detail`),
          get(`/post-purchase/v1/claims/${id}/messages`),get(`/post-purchase/v1/claims/${id}/affects-reputation`)
        ]);
        if(!cr.ok)return respostaErro(res,404,'Reclama\u00e7\u00e3o n\u00e3o encontrada.');

        const msgs=mr.ok&&Array.isArray(mr.data)?mr.data:[];
        const anexos=msgs.flatMap(m=>(m.attachments||[]).map(a=>({
            claim_id:id,
            filename:a.filename||a.id||'',
            type:a.type||a.mime_type||a.content_type||'',
            original_filename:a.original_filename||a.filename||a.id||'anexo',
            sender_role:m.sender_role
        })));

        const evidenciasVisuais=[];
        let bytesImagens=0;
        // Baixa at\u00e9 6 anexos e inclui apenas imagens reais. Limite total reduz risco de requisi\u00e7\u00e3o muito grande.
        for(const a of anexos.slice(0,6)){
            if(!a.filename)continue;
            try{
                const ar=await mlFetch(`${ML_API}/post-purchase/v1/claims/${id}/attachments/${encodeURIComponent(a.filename)}/download`,token);
                if(!ar.ok)continue;
                const ct=String(ar.headers.get('content-type')||a.type||'application/octet-stream').split(';')[0].trim().toLowerCase();
                if(!ct.startsWith('image/'))continue;
                const buf=Buffer.from(await ar.arrayBuffer());
                if(buf.length>5*1024*1024)continue;
                if(bytesImagens+buf.length>15*1024*1024)continue;
                bytesImagens+=buf.length;
                evidenciasVisuais.push({
                    type:'image',
                    mime_type:ct,
                    data:buf.toString('base64')
                });
            }catch(e){
                console.warn('[CLAIM ANEXO GEMINI]',a.filename,e.message);
            }
        }

        const contexto={
            claim:cr.data,
            detail:dr.ok?dr.data:{},
            impact:ir.ok?ir.data:null,
            messages:msgs.map(m=>({
                sender_role:m.sender_role,
                receiver_role:m.receiver_role,
                message:m.message,
                translated_message:m.translated_message,
                date_created:m.date_created,
                attachments:m.attachments
            }))
        };

        // Sinal auxiliar: n\u00e3o decide o caso sozinho, apenas chama aten\u00e7\u00e3o da IA para
        // ind\u00edcios expl\u00edcitos de dano/avaria causados durante a entrega.
        const textoContexto=JSON.stringify(contexto).toLowerCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        const termosLogistica=[
          'transportadora','transportador','entregador','motorista',
          'jogou','jogado','jogada','arremessou','arremessado','por cima do muro',
          'embalagem danificada','caixa amassada','caixa rasgada','avaria no transporte',
          'danificado no transporte','danificada no transporte','entrega danificou'
        ];
        const indiciosLogistica=termosLogistica.filter(t=>textoContexto.includes(t));

        const prompt=`Analise esta reclama\u00e7\u00e3o do Mercado Livre como ASSISTENTE DE DEFESA DO VENDEDOR, com foco em apurar de quem \u00e9 a responsabilidade pelo problema.

DADOS DA RECLAMA\u00c7\u00c3O:
${JSON.stringify(contexto)}

IND\u00cdCIOS TEXTUAIS DE PROBLEMA LOG\u00cdSTICO DETECTADOS PELO SISTEMA:
${JSON.stringify(indiciosLogistica)}

REGRAS DE AN\u00c1LISE:
1. Trabalhe somente com fatos do dossi\u00ea, mensagens e imagens. Nunca invente prova.
2. Determine primeiro a responsabilidade prov\u00e1vel: "vendedor", "comprador", "logistica_transportadora" ou "inconclusiva".
3. Diferencie DEFEITO DO PRODUTO de AVARIA LOG\u00cdSTICA. Se o comprador relata que o entregador/transportadora jogou, arremessou, amassou, molhou ou danificou o pacote durante a entrega, e isso \u00e9 compat\u00edvel com as evid\u00eancias, trate como forte ind\u00edcio de responsabilidade log\u00edstica, n\u00e3o como defeito automaticamente atribu\u00edvel ao vendedor.
4. Se o produto FOI ENTREGUE ao comprador, mas chegou danificado, n\u00e3o chame isso de "extravio". Use "avaria/dano durante o transporte ou entrega". S\u00f3 use "extravio" quando os dados realmente mostrarem que a mercadoria n\u00e3o foi entregue ou foi perdida.
5. Quando a responsabilidade prov\u00e1vel for "logistica_transportadora":
   - N\u00c3O admita culpa do vendedor;
   - N\u00c3O ofere\u00e7a espontaneamente reembolso, devolu\u00e7\u00e3o ou pagamento de etiqueta como se fossem obriga\u00e7\u00e3o do vendedor;
   - destaque o relato do pr\u00f3prio comprador e as evid\u00eancias que apontam para manuseio/entrega inadequados;
   - recomende direcionar a defesa prioritariamente \u00e0 MEDIA\u00c7\u00c3O/Mercado Livre;
   - pe\u00e7a formalmente que o caso seja tratado como ocorr\u00eancia log\u00edstica/avaria de transporte;
   - pe\u00e7a an\u00e1lise para que o vendedor n\u00e3o seja debitado pelo valor do produto, frete ou etiqueta/devolu\u00e7\u00e3o quando a cobertura/regras aplic\u00e1veis permitirem;
   - pe\u00e7a preserva\u00e7\u00e3o ou compensa\u00e7\u00e3o do valor da venda conforme a prote\u00e7\u00e3o log\u00edstica aplic\u00e1vel;
   - pe\u00e7a que a reclama\u00e7\u00e3o n\u00e3o gere impacto indevido na reputa\u00e7\u00e3o, ou que o status "not_affected" seja mantido quando a API j\u00e1 indicar isso.
6. Esses pedidos N\u00c3O s\u00e3o garantias. Use linguagem como "solicito", "pe\u00e7o an\u00e1lise", "pe\u00e7o que seja aplicado", "caso previsto pelas regras da plataforma". Nunca diga que o Mercado Livre obrigatoriamente vai isentar, reembolsar ou retirar impacto.
7. Se as evid\u00eancias forem insuficientes ou contradit\u00f3rias, diga exatamente o que falta e n\u00e3o force a conclus\u00e3o a favor do vendedor.
8. Se houver imagens, descreva somente fatos realmente vis\u00edveis e explique como eles apoiam ou n\u00e3o a tese log\u00edstica.
9. Evite respostas gen\u00e9ricas ao comprador. A resposta deve defender a posi\u00e7\u00e3o do vendedor perante a plataforma quando houver ind\u00edcios de responsabilidade log\u00edstica.

OBJETIVO DA RESPOSTA:
Criar uma defesa curta, firme, profissional e factual, pronta para revis\u00e3o humana, citando os elementos do pr\u00f3prio caso. Quando a responsabilidade prov\u00e1vel for log\u00edstica, a resposta deve pedir ao Mercado Livre/media\u00e7\u00e3o que reconhe\u00e7a a ocorr\u00eancia de transporte, preserve os direitos do vendedor e n\u00e3o transfira automaticamente a ele custos decorrentes da avaria.`;

        const schema={
            type:'object',
            properties:{
                responsabilidade_provavel:{
                    type:'string',
                    enum:['vendedor','comprador','logistica_transportadora','inconclusiva'],
                    description:'Responsabilidade mais prov\u00e1vel conforme as evid\u00eancias dispon\u00edveis.'
                },
                confianca:{
                    type:'string',
                    enum:['alta','media','baixa'],
                    description:'N\u00edvel de confian\u00e7a da classifica\u00e7\u00e3o com base nas evid\u00eancias.'
                },
                destinatario_recomendado:{
                    type:'string',
                    enum:['complainant','mediator'],
                    description:'Destinat\u00e1rio mais adequado para a resposta sugerida.'
                },
                fundamentos_defesa:{
                    type:'array',
                    items:{type:'string'},
                    description:'Fatos concretos do caso que sustentam a defesa.'
                },
                analise:{type:'string',description:'An\u00e1lise factual da reclama\u00e7\u00e3o sob a perspectiva do vendedor, distinguindo produto de log\u00edstica.'},
                estrategia_defesa:{type:'string',description:'Estrat\u00e9gia recomendada ao vendedor sem prometer resultado.'},
                resposta_sugerida:{type:'string',description:'Mensagem profissional de defesa, pronta para revis\u00e3o humana antes de enviar.'}
            },
            required:[
                'responsabilidade_provavel','confianca','destinatario_recomendado',
                'fundamentos_defesa','analise','estrategia_defesa','resposta_sugerida'
            ]
        };

        const gr=await chamarGeminiInteracao({
            input:[
                {type:'text',text:prompt},
                ...evidenciasVisuais
            ],
            systemInstruction:'Voc\u00ea atua como assistente de defesa do vendedor em p\u00f3s-venda de marketplace. Sua prioridade \u00e9 atribuir responsabilidade corretamente com base em evid\u00eancias. Quando houver dano causado durante transporte/entrega, n\u00e3o transforme isso automaticamente em culpa do vendedor e n\u00e3o ofere\u00e7a reembolso por iniciativa pr\u00f3pria. Formule pedidos de prote\u00e7\u00e3o ao vendedor sem garantir resultado, sem fabricar evid\u00eancias e sem acusar pessoas al\u00e9m do que os dados sustentam.',
            responseSchema:schema
        });

        let parsed;
        try{parsed=extrairJsonIA(gr.texto)}
        catch(e){parsed={analise:gr.texto,resposta_sugerida:'',responsabilidade_provavel:'inconclusiva',confianca:'baixa',destinatario_recomendado:'mediator',fundamentos_defesa:[],estrategia_defesa:''}}

        if(!['vendedor','comprador','logistica_transportadora','inconclusiva'].includes(parsed?.responsabilidade_provavel)){
            parsed.responsabilidade_provavel='inconclusiva';
        }
        if(!['alta','media','baixa'].includes(parsed?.confianca))parsed.confianca='baixa';
        if(!['complainant','mediator'].includes(parsed?.destinatario_recomendado))parsed.destinatario_recomendado='mediator';
        if(!Array.isArray(parsed?.fundamentos_defesa))parsed.fundamentos_defesa=[];
        parsed.indicios_logistica_detectados=indiciosLogistica;

        res.json({
            sucesso:true,
            ...parsed,
            provedor:'gemini',
            modelo:gr.model,
            imagens_analisadas:evidenciasVisuais.length,
            anexos_encontrados:anexos.length,
            fallback_utilizado:Array.isArray(gr.tentativas)&&gr.tentativas.length>0,
            tentativas_anteriores:Array.isArray(gr.tentativas)?gr.tentativas:[]
        });
    }catch(e){
        console.error('[GEMINI CLAIM ANALYSIS]',e);
        const msg=(e.status===429||e.status===503||e.status===504)
          ? 'A IA gratuita est\u00e1 temporariamente ocupada. O sistema tentou modelos alternativos automaticamente. Tente novamente em alguns instantes.'
          : 'Erro na an\u00e1lise da reclama\u00e7\u00e3o: '+e.message;
        respostaErro(res,e.status||500,msg);
    }
});

app.post('/api/v9/claims/:id/mensagem',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');
    const message=String(req.body?.message||'').trim(),receiver=String(req.body?.receiver_role||'complainant');
    if(!message)return respostaErro(res,400,'Mensagem vazia.');
    if(!['complainant','mediator'].includes(receiver))return respostaErro(res,400,'Destinat\u00e1rio inv\u00e1lido.');
    try{
        const r=await mlFetch(`${ML_API}/post-purchase/v1/claims/${encodeURIComponent(req.params.id)}/actions/send-message`,token,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({receiver_role:receiver,message,attachments:[]})});
        const d=await jsonSeguro(r);if(!r.ok)return respostaErro(res,r.status,formatarErroMercadoLivre(d));res.status(201).json({sucesso:true,resposta:d});
    }catch(e){respostaErro(res,500,'Erro ao enviar mensagem: '+e.message)}
});

app.get('/api/v3/auditoria',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');
    try{
        const me=await usuarioML(token);
        const busca=await buscarIdsAnunciosPaginados(token,me.id,{offset:0,limit:100,order:'last_updated_desc'});
        const ids=Array.isArray(busca.results)?busca.results:[];
        const det=await buscarItensBulk(token,ids);
        const itens=ids.map(id=>det[id]).filter(Boolean).map(normalizarItemGestao);
        const semSku=itens.filter(i=>!i.sku), crit=itens.filter(i=>i.status==='active'&&i.estoque<=3), semVenda=itens.filter(i=>i.vendidos<=0);
        let score=100-Math.min(100,Math.round((semSku.length*0.35+crit.length*0.4+semVenda.length*0.15)));
        const oportunidades=[];
        semSku.slice(0,8).forEach(i=>oportunidades.push({tipo:'sku',titulo:i.titulo,mensagem:'Cadastrar SKU para melhorar estoque, ERP e rastreabilidade.'}));
        crit.slice(0,8).forEach(i=>oportunidades.push({tipo:'estoque',titulo:i.titulo,mensagem:`Estoque cr\u00edtico (${i.estoque}). Repor ou revisar estrat\u00e9gia para evitar ruptura.`}));
        semVenda.slice(0,8).forEach(i=>oportunidades.push({tipo:'conversao',titulo:i.titulo,mensagem:'Sem unidades vendidas registradas. Revisar t\u00edtulo, atributos, pre\u00e7o, imagens e Ads.'}));
        res.json({sucesso:true,amostra:itens.length,total_conta:Number(busca.paging?.total||0),metricas:{sem_sku:semSku.length,estoque_critico:crit.length,sem_venda:semVenda.length,score:Math.max(0,score)},oportunidades:oportunidades.slice(0,20)});
    }catch(e){respostaErro(res,500,'Erro na auditoria: '+e.message)}
});

app.get('/api/v3/integracoes/status',(req,res)=>{
    const b=lerJsonArquivoSeguro(BLING_STORE_FILE);
    const configurado=Boolean(process.env.GEMINI_API_KEY);
    res.json({
        sucesso:true,
        gemini:{configurado,modelo:process.env.GEMINI_MODEL||'gemini-3.7-flash'},
        // Mantido s\u00f3 para compatibilidade com vers\u00f5es antigas do front-end.
        openai:{configurado,substituido_por:'gemini'},
        bling:{configurado:Boolean(process.env.BLING_CLIENT_ID&&process.env.BLING_CLIENT_SECRET),conectado:Boolean(b.access_token)},
        mercado_livre:{configurado:true}
    });
});

app.get('/api/v17/gemini/status',(req,res)=>{
    res.json({
        sucesso:true,
        configurado:Boolean(process.env.GEMINI_API_KEY),
        modelo:process.env.GEMINI_MODEL||'gemini-3.7-flash',
        provedor:'Google Gemini'
    });
});

app.post('/api/v3/ia',async(req,res)=>{
    const mensagem=String(req.body?.mensagem||'').trim();
    if(!mensagem)return respostaErro(res,400,'Digite uma mensagem.');
    try{
        const gr=await chamarGeminiInteracao({
            input:mensagem,
            systemInstruction:'Voc\u00ea \u00e9 o assistente operacional do ML Hub Pro para vendedores brasileiros do Mercado Livre. Responda em portugu\u00eas do Brasil, seja objetivo, profissional e \u00fatil. Ajude com atendimento, p\u00f3s-venda, an\u00fancios, estoque, pre\u00e7o, margem, opera\u00e7\u00e3o e organiza\u00e7\u00e3o. N\u00e3o invente dados da conta que n\u00e3o foram fornecidos. N\u00e3o execute altera\u00e7\u00f5es; apenas recomende ou redija textos para revis\u00e3o humana.'
        });
        res.json({sucesso:true,resposta:gr.texto,provedor:'gemini',modelo:gr.model});
    }catch(e){
        respostaErro(res,e.status||500,'Erro ao consultar Gemini: '+e.message);
    }
});

// BLING OAuth 2.0 / JWT
app.get('/api/bling/authorize',(req,res)=>{
    const id=process.env.BLING_CLIENT_ID;
    if(!id||!process.env.BLING_CLIENT_SECRET)return respostaErro(res,503,'Configure BLING_CLIENT_ID e BLING_CLIENT_SECRET no Render.');
    const state=crypto.randomBytes(24).toString('hex');
    const s=lerJsonArquivoSeguro(BLING_STORE_FILE);s.state=state;s.state_created_at=Date.now();salvarJsonArquivoSeguro(BLING_STORE_FILE,s);
    res.json({authorization_url:`https://www.bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=${encodeURIComponent(id)}&state=${encodeURIComponent(state)}`});
});
app.get('/api/bling/callback',async(req,res)=>{
    try{
        const code=String(req.query.code||''),state=String(req.query.state||''),s=lerJsonArquivoSeguro(BLING_STORE_FILE);
        if(!code||!state||state!==s.state)return res.status(400).send('Autoriza\u00e7\u00e3o Bling inv\u00e1lida ou expirada.');
        const basic=Buffer.from(`${process.env.BLING_CLIENT_ID}:${process.env.BLING_CLIENT_SECRET}`).toString('base64');
        const body=new URLSearchParams({grant_type:'authorization_code',code});
        const r=await fetch('https://api.bling.com.br/Api/v3/oauth/token',{method:'POST',headers:{'Authorization':`Basic ${basic}`,'Content-Type':'application/x-www-form-urlencoded','Accept':'1.0','enable-jwt':'1'},body});
        const d=await r.json();if(!r.ok)throw new Error(d.error_description||d.error||'Falha ao gerar token Bling.');
        salvarJsonArquivoSeguro(BLING_STORE_FILE,{access_token:d.access_token,refresh_token:d.refresh_token,expires_at:Date.now()+Number(d.expires_in||21600)*1000,scope:d.scope});
        res.redirect(process.env.FRONTEND_URL||DEFAULT_FRONTEND_URL);
    }catch(e){res.status(500).send('Erro ao conectar Bling: '+e.message)}
});
app.post('/api/bling/webhook',(req,res)=>{res.status(200).json({recebido:true});setImmediate(()=>console.log('[Bling webhook]',req.body?.eventId||req.body?.event||req.body?.type||'evento'));});



/* =========================================================
   ML HUB PRO V4 - CONTE\u00daDO, QUALIDADE E CAT\u00c1LOGO
========================================================= */
function extrairJsonIA(texto) {
    const limpo=String(texto||'').replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
    try{return JSON.parse(limpo)}catch(e){const a=limpo.indexOf('{'),b=limpo.lastIndexOf('}');if(a>=0&&b>a)return JSON.parse(limpo.slice(a,b+1));throw e}
}
app.post('/api/v4/conteudo/titulos',async(req,res)=>{
    try{
        const produtos=(Array.isArray(req.body?.produtos)?req.body.produtos:[]).map(String).map(x=>x.trim()).filter(Boolean).slice(0,50);
        const quantidade=Math.min(10,Math.max(1,Number(req.body?.quantidade||5))),limite=Math.min(200,Math.max(30,Number(req.body?.limite||60)));
        if(!produtos.length)return respostaErro(res,400,'Informe os produtos.');
        const texto=await chamarGeminiTexto(`Produtos:\n${produtos.map((x,i)=>`${i+1}. ${x}`).join('\n')}\n\nCrie ${quantidade} t\u00edtulos diferentes por produto, cada um com no m\u00e1ximo ${limite} caracteres. Retorne SOMENTE JSON no formato {"resultados":[{"produto":"...","titulos":["..."]}]}. N\u00e3o invente marca, modelo, material ou caracter\u00edstica n\u00e3o fornecida.`, 'Voc\u00ea cria t\u00edtulos claros e comerciais para an\u00fancios de marketplace brasileiro. Priorize termos descritivos \u00fateis e legibilidade. N\u00e3o fa\u00e7a alega\u00e7\u00f5es falsas nem invente atributos.');
        const obj=extrairJsonIA(texto);
        res.json({sucesso:true,resultados:obj.resultados||[]});
    }catch(e){respostaErro(res,500,e.message)}
});
app.post('/api/v4/conteudo/descricao',async(req,res)=>{
    const base=String(req.body?.base||'').trim();if(!base)return respostaErro(res,400,'Informe os dados do produto.');
    try{const texto=await chamarGeminiTexto(base,'Crie uma descri\u00e7\u00e3o profissional em portugu\u00eas do Brasil para marketplace. Use somente os fatos fornecidos. Organize benef\u00edcios, caracter\u00edsticas, itens inclusos e observa\u00e7\u00f5es quando aplic\u00e1vel. N\u00e3o invente especifica\u00e7\u00f5es. Seja clara e f\u00e1cil de ler.');res.json({sucesso:true,texto})}catch(e){respostaErro(res,500,e.message)}
});
app.post('/api/v4/conteudo/keywords',async(req,res)=>{
    const produto=String(req.body?.produto||'').trim();if(!produto)return respostaErro(res,400,'Informe o produto.');
    try{const texto=await chamarGeminiTexto(`Produto: ${produto}\nRetorne SOMENTE JSON: {"keywords":["termo 1","termo 2"]}, com at\u00e9 30 termos relacionados, sem inventar marca ou especifica\u00e7\u00f5es.`,'Gere palavras-chave relevantes para organiza\u00e7\u00e3o e cria\u00e7\u00e3o de conte\u00fado de marketplace brasileiro.');const o=extrairJsonIA(texto);res.json({sucesso:true,keywords:(o.keywords||[]).slice(0,30)})}catch(e){respostaErro(res,500,e.message)}
});
app.post('/api/v4/conteudo/imagem-brief',async(req,res)=>{
    const brief=String(req.body?.brief||'').trim();if(!brief)return respostaErro(res,400,'Informe o briefing.');
    try{const prompt=await chamarGeminiTexto(`Produto/objetivo: ${brief}\nFormato: ${req.body?.formato||'1:1'}\nEstilo: ${req.body?.estilo||'Marketplace profissional'}\nCrie um briefing/prompt visual detalhado para uma imagem comercial de produto. Preserve fielmente caracter\u00edsticas fornecidas e n\u00e3o invente certifica\u00e7\u00f5es, acess\u00f3rios ou textos promocionais n\u00e3o solicitados.`,'Voc\u00ea \u00e9 diretor de arte de e-commerce. Gere apenas o briefing visual, em portugu\u00eas do Brasil.');res.json({sucesso:true,prompt,image_generation_available:Boolean(process.env.IMAGE_API_KEY)})}catch(e){respostaErro(res,500,e.message)}
});
app.get('/api/v4/items/:id/performance',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');
    try{const id=encodeURIComponent(req.params.id);const r=await mlFetch(`${ML_API}/items/${id}/performance`,token);const d=await jsonSeguro(r);if(!r.ok)return respostaErro(res,r.status,formatarErroMercadoLivre(d));res.json({sucesso:true,performance:d})}catch(e){respostaErro(res,500,e.message)}
});
app.get('/api/v4/items/:id/competition',async(req,res)=>{
    const token=obterToken(req);if(!token)return respostaErro(res,401,'Token n\u00e3o fornecido.');
    try{
        const id=encodeURIComponent(req.params.id);
        const [ir,cr]=await Promise.all([mlFetch(`${ML_API}/items/${id}`,token),mlFetch(`${ML_API}/items/${id}/price_to_win?version=v2`,token)]);
        const item=await jsonSeguro(ir),comp=await jsonSeguro(cr);
        if(!cr.ok)return respostaErro(res,cr.status,formatarErroMercadoLivre(comp));
        res.json({sucesso:true,current_price:Number(item?.price||0),...comp});
    }catch(e){respostaErro(res,500,e.message)}
});


/* =========================================================
   ML HUB PRO V5 - CORE PARA 90 MIL+ AN\u00daNCIOS
   PostgreSQL + fila persistente + worker + pagina\u00e7\u00e3o DB
========================================================= */
