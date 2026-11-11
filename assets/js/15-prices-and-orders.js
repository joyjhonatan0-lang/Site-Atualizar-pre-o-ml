
/* =========================================================
   V36 \u2014 PRE\u00c7OS 90K+ + CRIA\u00c7\u00c3O EM MASSA
========================================================= */

let priceUpdateJobV36=null;
let priceUpdateTimerV36=null;
let criarEstadoV36={
    modo:null,
    userProductSeller:false,
    atributos:[],
    variacoes:[],
    pictures:[],
    cloudflareReferenceImages:[],
    jobId:null
};
let criarTimerV36=null;

function traduzirTipoFalhaV36(tipo){
    const mapa={
        temporario:'Limite ou instabilidade tempor\u00e1ria',
        bloqueio:'Altera\u00e7\u00e3o bloqueada pelo Mercado Livre',
        autenticacao:'Problema de autoriza\u00e7\u00e3o',
        permissao:'Sem permiss\u00e3o',
        validacao:'Regra de valida\u00e7\u00e3o',
        erro:'Erro'
    };
    return mapa[String(tipo||'erro')]||'Erro';
}

async function carregarFalhasPrecoV36(jobId){
    try{
        const token=obterToken();
        const r=await fetch(`${RENDER_URL}/api/scale/price-update/${encodeURIComponent(jobId)}/errors?limit=200&_=${Date.now()}`,{
            cache:'no-store',
            headers:{Authorization:token,Accept:'application/json'}
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)return;

        const lista=document.getElementById('atualizacao-erros-lista-v31');
        const details=document.getElementById('atualizacao-erros-detalhes-v31');
        const ultimo=document.getElementById('atualizacao-ultimo-erro-v31');
        const ultimoTexto=document.getElementById('atualizacao-ultimo-erro-texto-v31');

        if(!lista||!details)return;

        const erros=Array.isArray(d.erros)?d.erros:[];
        if(!erros.length){
            lista.innerHTML='';
            details.classList.add('hidden');
            if(ultimo)ultimo.classList.add('hidden');
            return;
        }

        details.classList.remove('hidden');
        lista.innerHTML=erros.map(e=>`
          <div class="p-3">
            <div class="flex flex-col md:flex-row md:justify-between gap-2">
              <div>
                <div class="text-[10px] font-black text-white">${escapeHtml(e.id)}</div>
                <div class="text-[10px] text-red-300 mt-1">${escapeHtml(traduzirTipoFalhaV36(e.failure_type))}</div>
              </div>
              <div class="text-[10px] text-slate-500">${moeda(Number(e.requested_price||0))}</div>
            </div>
            <div class="text-[10px] text-slate-200 mt-2">${escapeHtml(e.message_pt||'Falha sem detalhe.')}</div>
            ${(e.http_status||e.code)
              ? `<div class="text-[9px] text-slate-600 mt-1">Detalhe t\u00e9cnico: ${e.http_status?`HTTP ${escapeHtml(e.http_status)}`:''}${e.code?` \u00b7 ${escapeHtml(e.code)}`:''} \u00b7 ${Number(e.attempts||0)} tentativa(s)</div>`
              : ''}
          </div>
        `).join('');

        const primeira=erros[0];
        if(ultimo)ultimo.classList.remove('hidden');
        if(ultimoTexto){
            ultimoTexto.textContent=`${primeira.id}: ${primeira.message_pt||'Falha sem detalhe.'}`;
        }
    }catch(e){
        console.warn('[FALHAS PRE\u00c7O V36]',e);
    }
}

async function acompanharAtualizacaoPrecosV36(jobId){
    clearTimeout(priceUpdateTimerV36);
    const token=obterToken();
    if(!token)return;

    try{
        const r=await fetch(`${RENDER_URL}/api/scale/jobs/${encodeURIComponent(jobId)}?_=${Date.now()}`,{
            cache:'no-store',
            headers:{Authorization:token,Accept:'application/json'}
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        const j=d.job||{};
        const total=Number(j.progress_total||0);
        const atual=Number(j.progress_current||0);
        const sucessos=Number(j.result?.success||0);
        const falhas=Number(j.errors||j.result?.failed||0);
        const pct=total?Math.min(100,Math.round((atual/total)*100)):0;

        atualizarPainelProgressoV31({
            total,
            processados:atual,
            sucessos,
            falhas,
            texto:j.message||'Atualizando pre\u00e7os...',
            estado:j.status==='failed'?'error':'running'
        });

        const botao=document.getElementById('btn-atualizar-precos-v31');
        if(botao){
            const rodando=['queued','running'].includes(j.status);
            botao.disabled=rodando;
            botao.textContent=rodando?'Atualizando no servidor...':'\u2197 Atualizar pre\u00e7os';
            botao.classList.toggle('opacity-60',rodando);
        }

        if(falhas>0 && (atual%500===0 || ['completed','failed'].includes(j.status))){
            carregarFalhasPrecoV36(jobId);
        }

        if(['queued','running'].includes(j.status)){
            localStorage.setItem('mlHubPro_price_update_job_v36',String(jobId));
            priceUpdateTimerV36=setTimeout(()=>acompanharAtualizacaoPrecosV36(jobId),1200);
            return;
        }

        localStorage.removeItem('mlHubPro_price_update_job_v36');
        priceUpdateJobV36=null;

        await carregarFalhasPrecoV36(jobId);

        if(j.status==='completed'){
            atualizarPainelProgressoV31({
                total,
                processados:total,
                sucessos,
                falhas,
                texto:j.message||'Atualiza\u00e7\u00e3o conclu\u00edda.'
            });

            // N\u00e3o baixa tudo: for\u00e7a apenas o delta dos pre\u00e7os alterados.
            if(typeof invalidarCacheAnunciosV30==='function')invalidarCacheAnunciosV30();

            setTimeout(()=>{
                if(abaAtualAtiva==='atualizacao' && typeof carregarAtualizacaoEscalaV21==='function'){
                    carregarAtualizacaoEscalaV21().catch(()=>{});
                }
            },500);
        }else{
            atualizarPainelProgressoV31({
                total,
                processados:atual,
                sucessos,
                falhas,
                texto:j.message||'Atualiza\u00e7\u00e3o interrompida.',
                estado:'error'
            });
        }
    }catch(e){
        atualizarPainelProgressoV31({
            total:1,processados:0,sucessos:0,falhas:1,
            texto:'Erro ao acompanhar atualiza\u00e7\u00e3o: '+e.message,
            estado:'error'
        });
        priceUpdateTimerV36=setTimeout(()=>acompanharAtualizacaoPrecosV36(jobId),3000);
    }
}

// Substitui o envio em lotes pelo navegador.
// Agora um \u00fanico job persistente processa tudo no servidor.
atualizarPrecosMassaApi=async function(){
    if(priceUpdateJobV36)return;

    const token=obterToken();
    if(!token){solicitarToken();return}

    const selecionados=[...document.querySelectorAll('#tabela-atualizacao .check-item:checked:not(:disabled)')];
    if(!selecionados.length){
        alert('Nenhum an\u00fancio atualiz\u00e1vel est\u00e1 selecionado.');
        return;
    }

    if(!confirm(`Enviar ${selecionados.length.toLocaleString('pt-BR')} an\u00fancio(s) para a fila de atualiza\u00e7\u00e3o? Voc\u00ea pode sair desta tela e o servidor continuar\u00e1 o trabalho.`))return;

    const mapa=new Map(atualItensV21.map(x=>[String(x.id),x]));
    const items=[];

    for(const check of selecionados){
        const item=mapa.get(String(check.value));
        if(!item || item.price_update_allowed===false)continue;

        const calc=calcularSimulacaoV21(item,parametrosSimV21(item));
        if(!calc?.foraDaMargem)continue;

        items.push({
            id:String(item.id),
            price:Number(calc.preco.toFixed(2))
        });
    }

    if(!items.length){
        alert('Nenhum an\u00fancio v\u00e1lido ficou na fila depois das valida\u00e7\u00f5es.');
        return;
    }

    prepararProgressoAtualizacaoV31(items.length);
    atualizarPainelProgressoV31({
        total:items.length,
        processados:0,
        sucessos:0,
        falhas:0,
        texto:`Enviando ${items.length.toLocaleString('pt-BR')} an\u00fancio(s) para a fila persistente...`
    });

    const botao=document.getElementById('btn-atualizar-precos-v31');
    if(botao){
        botao.disabled=true;
        botao.textContent='Preparando...';
        botao.classList.add('opacity-60');
    }

    try{
        const r=await fetch(`${RENDER_URL}/api/scale/price-update/start`,{
            method:'POST',
            headers:{
                Authorization:token,
                'Content-Type':'application/json'
            },
            body:JSON.stringify({items})
        });

        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        const jobId=d.job?.id;
        if(!jobId)throw new Error('O servidor n\u00e3o retornou o ID do trabalho.');

        priceUpdateJobV36=String(jobId);
        localStorage.setItem('mlHubPro_price_update_job_v36',String(jobId));
        acompanharAtualizacaoPrecosV36(jobId);
    }catch(e){
        priceUpdateJobV36=null;
        if(botao){
            botao.disabled=false;
            botao.textContent='\u2197 Atualizar pre\u00e7os';
            botao.classList.remove('opacity-60');
        }
        atualizarPainelProgressoV31({
            total:items.length,
            processados:0,
            sucessos:0,
            falhas:1,
            texto:'N\u00e3o foi poss\u00edvel iniciar: '+e.message,
            estado:'error'
        });
    }
};

/* =========================================================
   CRIA\u00c7\u00c3O EM MASSA
========================================================= */

function valorElV36(id){
    return document.getElementById(id)?.value??'';
}

function listaLinhasV36(id){
    return String(valorElV36(id)||'')
      .split(/\r?\n/)
      .map(x=>x.trim())
      .filter(Boolean);
}

async function carregarCriacaoMassaV36(){
    const token=obterToken();
    if(!token)return;

    try{
        const r=await fetch(`${RENDER_URL}/api/v36/criar/status?_=${Date.now()}`,{
            cache:'no-store',
            headers:{Authorization:token}
        });
        const d=await r.json().catch(()=>({}));
        if(r.ok){
            criarEstadoV36.modo=d.modo;
            criarEstadoV36.userProductSeller=Boolean(d.user_product_seller);
            const el=document.getElementById('criar-modo-v36');
            if(el){
                el.innerHTML=d.user_product_seller
                  ? '<span class="text-emerald-400 font-black">User Products ativo</span><div class="text-[10px] text-slate-500 mt-1">Varia\u00e7\u00f5es ser\u00e3o itens da mesma fam\u00edlia; o Mercado Livre gera o t\u00edtulo final.</div>'
                  : '<span class="text-yellow-400 font-black">Modelo legado</span><div class="text-[10px] text-slate-500 mt-1">Varia\u00e7\u00f5es ser\u00e3o publicadas no array variations quando permitido.</div>';
            }
        }
    }catch(e){}

    const jobId=localStorage.getItem('mlHubPro_mass_create_job_v36');
    if(jobId)acompanharCriacaoV36(jobId);
}

async function sugerirCategoriaV36(){
    const token=obterToken();
    if(!token){solicitarToken();return}

    const produto=String(valorElV36('criar-produto-v36')).trim();
    if(!produto)return alert('Informe o produto primeiro.');

    mostrarLoading('Consultando o preditor de categorias do Mercado Livre...');
    try{
        const r=await fetch(`${RENDER_URL}/api/v36/criar/categorias?q=${encodeURIComponent(produto)}`,{
            headers:{Authorization:token}
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        const sel=document.getElementById('criar-categoria-select-v36');
        sel.innerHTML='<option value="">Escolha uma categoria sugerida</option>'+
          (d.categorias||[]).map(c=>`<option value="${escapeHtml(c.category_id)}">${escapeHtml(c.category_name)} \u00b7 ${escapeHtml(c.category_id)}</option>`).join('');

        if(d.categorias?.[0]){
            sel.value=d.categorias[0].category_id;
            document.getElementById('criar-categoria-id-v36').value=d.categorias[0].category_id;
            await carregarAtributosCategoriaV36();
        }
    }catch(e){
        alert('Erro ao sugerir categoria: '+e.message);
    }finally{
        esconderLoading();
    }
}

function selecionarCategoriaV36(){
    const sel=document.getElementById('criar-categoria-select-v36');
    const id=String(sel?.value||'');
    if(id){
        document.getElementById('criar-categoria-id-v36').value=id;
        carregarAtributosCategoriaV36();
    }
}

async function carregarAtributosCategoriaV36(){
    const token=obterToken();
    if(!token)return;

    const id=String(valorElV36('criar-categoria-id-v36')).trim();
    if(!id)return alert('Informe ou escolha uma categoria.');

    mostrarLoading('Carregando ficha t\u00e9cnica da categoria...');
    try{
        const r=await fetch(`${RENDER_URL}/api/v36/criar/categorias/${encodeURIComponent(id)}/atributos`,{
            headers:{Authorization:token}
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        criarEstadoV36.atributos=Array.isArray(d.atributos)?d.atributos:[];
        criarEstadoV36.variacoes=Array.isArray(d.variacoes)?d.variacoes:[];

        const box=document.getElementById('criar-atributos-v36');
        const importantes=criarEstadoV36.atributos
          .filter(a=>a.required || ['BRAND','MODEL','ITEM_CONDITION','GTIN'].includes(String(a.id)))
          .slice(0,30);

        box.innerHTML=importantes.map(a=>`
          <div class="rounded-xl border ${a.required?'border-yellow-400/30':'border-slate-800'} bg-slate-950/60 p-3">
            <label class="text-[9px] uppercase font-black ${a.required?'text-yellow-400':'text-slate-500'}">
              ${escapeHtml(a.name||a.id)} ${a.required?'\u00b7 obrigat\u00f3rio':''}
            </label>
            ${
              Array.isArray(a.values)&&a.values.length
              ? `<select data-attr-id="${escapeHtml(a.id)}" data-attr-name="${escapeHtml(a.name||a.id)}" class="criar-attr-v36 w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white">
                   <option value="">Selecione...</option>
                   ${a.values.slice(0,100).map(v=>`<option value="${escapeHtml(v.id||'')}" data-name="${escapeHtml(v.name||'')}">${escapeHtml(v.name||v.id)}</option>`).join('')}
                 </select>`
              : `<input data-attr-id="${escapeHtml(a.id)}" data-attr-name="${escapeHtml(a.name||a.id)}" class="criar-attr-v36 w-full mt-2 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white" placeholder="Valor">`
            }
          </div>
        `).join('');

        const varSel=document.getElementById('criar-variacao-atributo-v36');
        varSel.innerHTML='<option value="">Escolha o atributo da varia\u00e7\u00e3o</option>'+
          criarEstadoV36.variacoes.map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.name||a.id)} \u00b7 ${escapeHtml(a.id)}</option>`).join('');

        alternarVariacoesV36();
    }catch(e){
        alert('Erro ao carregar atributos: '+e.message);
    }finally{
        esconderLoading();
    }
}

function aplicarAtributosIaV36(lista){
    const map=new Map((lista||[]).map(x=>[String(x.id),x]));
    document.querySelectorAll('.criar-attr-v36').forEach(el=>{
        const x=map.get(String(el.dataset.attrId||''));
        if(!x)return;

        if(el.tagName==='SELECT'){
            const options=[...el.options];
            const alvo=options.find(o=>
                String(o.value)===String(x.value_id||'') ||
                String(o.dataset.name||'').toLowerCase()===String(x.value_name||'').toLowerCase()
            );
            if(alvo)el.value=alvo.value;
        }else if(x.value_name){
            el.value=x.value_name;
        }
    });
}

async function gerarConteudoCriacaoV36(){
    const token=obterToken();
    if(!token){solicitarToken();return}

    const produto=String(valorElV36('criar-produto-v36')).trim();
    if(!produto)return alert('Informe o produto.');

    const quantidade=Math.min(500,Math.max(1,Number(valorElV36('criar-qtd-v36')||1)));
    const category_id=String(valorElV36('criar-categoria-id-v36')).trim();

    mostrarLoading(`Gerando ${quantidade} t\u00edtulo(s), descri\u00e7\u00e3o e ficha t\u00e9cnica com IA...`);
    try{
        const r=await fetch(`${RENDER_URL}/api/v36/criar/ia/conteudo`,{
            method:'POST',
            headers:{Authorization:token,'Content-Type':'application/json'},
            body:JSON.stringify({
                produto,
                detalhes:String(valorElV36('criar-detalhes-v36')).trim(),
                quantidade,
                limite:60,
                category_id
            })
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        document.getElementById('criar-titulos-v36').value=(d.titulos||[]).join('\n');
        document.getElementById('criar-descricao-v36').value=d.descricao||'';

        if(!valorElV36('criar-imagem-prompt-v36')){
            document.getElementById('criar-imagem-prompt-v36').value=
              `${produto}. ${String(valorElV36('criar-detalhes-v36')).trim()}`;
        }

        aplicarAtributosIaV36(d.atributos||[]);

        if((d.titulos||[]).length<quantidade){
            alert(`A IA gerou ${(d.titulos||[]).length} t\u00edtulo(s) \u00fanicos de ${quantidade}. Revise e complete antes de publicar.`);
        }
    }catch(e){
        alert('Erro na gera\u00e7\u00e3o com IA: '+e.message);
    }finally{
        esconderLoading();
    }
}

function alternarVariacoesV36(){
    const ativo=String(valorElV36('criar-variacao-enabled-v36'))==='1';
    ['criar-variacao-qtd-v36','criar-variacao-atributo-v36','criar-variacao-valores-v36'].forEach(id=>{
        const el=document.getElementById(id);
        if(el)el.disabled=!ativo;
    });
}

async function gerarImagensCriacaoV36(){
    const token=obterToken();
    if(!token){solicitarToken();return}

    const prompt=String(valorElV36('criar-imagem-prompt-v36')).trim() ||
      String(valorElV36('criar-produto-v36')).trim();
    if(!prompt)return alert('Informe o produto ou o briefing da imagem.');

    const quantidade=Math.min(6,Math.max(1,Number(valorElV36('criar-imagem-qtd-v36')||1)));

    mostrarLoading(`Gerando e enviando ${quantidade} imagem(ns)...`);
    try{
        const r=await fetch(`${RENDER_URL}/api/v36/criar/ia/imagem`,{
            method:'POST',
            headers:{Authorization:token,'Content-Type':'application/json'},
            body:JSON.stringify({prompt,quantidade})
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        criarEstadoV36.pictures=d.pictures||[];

        const box=document.getElementById('criar-imagens-preview-v36');
        box.innerHTML=criarEstadoV36.pictures.map(p=>`
          <div class="rounded-xl border border-slate-700 overflow-hidden bg-white aspect-square flex items-center justify-center">
            ${p.url?`<img src="${escapeHtml(p.url)}" class="w-full h-full object-contain">`:`<div class="text-xs text-slate-700">${escapeHtml(p.id)}</div>`}
          </div>
        `).join('');
    }catch(e){
        alert(e.message);
    }finally{
        esconderLoading();
    }
}

function lerAtributosCriacaoV36(){
    const out=[];

    document.querySelectorAll('.criar-attr-v36').forEach(el=>{
        const id=String(el.dataset.attrId||'').trim();
        if(!id)return;

        if(el.tagName==='SELECT'){
            const opt=el.options[el.selectedIndex];
            if(!el.value)return;
            out.push({
                id,
                value_id:String(el.value),
                value_name:String(opt?.dataset?.name||opt?.textContent||'').trim()
            });
        }else{
            const value=String(el.value||'').trim();
            if(value)out.push({id,value_name:value});
        }
    });

    return out;
}

function configCriacaoV36(){
    const titles=listaLinhasV36('criar-titulos-v36').map(t=>t.slice(0,60));
    const enabled=String(valorElV36('criar-variacao-enabled-v36'))==='1';
    const varSelect=document.getElementById('criar-variacao-atributo-v36');
    const varOpt=varSelect?.options[varSelect.selectedIndex];

    return {
        product_name:String(valorElV36('criar-produto-v36')).trim(),
        quantity:Math.max(1,Number(valorElV36('criar-qtd-v36')||titles.length||1)),
        titles,
        category_id:String(valorElV36('criar-categoria-id-v36')).trim(),
        price:Number(valorElV36('criar-preco-v36')||0),
        stock:Math.max(1,Number(valorElV36('criar-estoque-v36')||1)),
        listing_type_id:String(valorElV36('criar-listing-v36')||'gold_special'),
        condition:String(valorElV36('criar-condicao-v36')||'new'),
        sku_prefix:String(valorElV36('criar-sku-v36')).trim(),
        description:String(valorElV36('criar-descricao-v36')).trim(),
        picture_ids:(criarEstadoV36.pictures||[]).map(p=>p.id),
        attributes:lerAtributosCriacaoV36(),
        variations:{
            enabled,
            count:Math.max(1,Number(valorElV36('criar-variacao-qtd-v36')||1)),
            attribute_id:String(varSelect?.value||''),
            attribute_name:String(varOpt?.textContent||'').split('\u00b7')[0].trim(),
            values:listaLinhasV36('criar-variacao-valores-v36')
        }
    };
}

async function validarCriacaoV36(){
    const token=obterToken();
    if(!token){solicitarToken();return false}

    const cfg=configCriacaoV36();
    const out=document.getElementById('criar-validacao-v36');

    if(!cfg.titles.length){
        out.textContent='Gere ou informe pelo menos um t\u00edtulo.';
        out.className='text-[11px] text-red-400 mt-1';
        return false;
    }

    try{
        out.textContent='Validando exemplo no Mercado Livre...';
        out.className='text-[11px] text-yellow-400 mt-1';

        const r=await fetch(`${RENDER_URL}/api/v36/criar/validar`,{
            method:'POST',
            headers:{Authorization:token,'Content-Type':'application/json'},
            body:JSON.stringify({config:cfg})
        });
        const d=await r.json().catch(()=>({}));

        if(!r.ok || !d.sucesso){
            out.textContent='Valida\u00e7\u00e3o recusada: '+(d.erro||`HTTP ${r.status}`);
            out.className='text-[11px] text-red-400 mt-1';
            return false;
        }

        out.textContent=`\u2713 Exemplo validado no Mercado Livre \u00b7 modo ${d.modo==='user_products'?'User Products':'legado'}.`;
        out.className='text-[11px] text-emerald-400 mt-1';
        return true;
    }catch(e){
        out.textContent='Erro ao validar: '+e.message;
        out.className='text-[11px] text-red-400 mt-1';
        return false;
    }
}

async function publicarCriacaoV36(){
    const token=obterToken();
    if(!token){solicitarToken();return}

    const cfg=configCriacaoV36();
    const ok=await validarCriacaoV36();
    if(!ok)return;

    if(!confirm(`Confirma a cria\u00e7\u00e3o em massa de ${cfg.quantity.toLocaleString('pt-BR')} an\u00fancio(s)/fam\u00edlia(s)?`))return;

    try{
        const r=await fetch(`${RENDER_URL}/api/v36/criar/publicar`,{
            method:'POST',
            headers:{Authorization:token,'Content-Type':'application/json'},
            body:JSON.stringify({config:cfg})
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        const jobId=d.job?.id;
        if(!jobId)throw new Error('O servidor n\u00e3o retornou o ID da cria\u00e7\u00e3o.');

        criarEstadoV36.jobId=String(jobId);
        localStorage.setItem('mlHubPro_mass_create_job_v36',String(jobId));

        const msg=document.getElementById('criar-job-msg-v36');
        if(msg)msg.textContent=d.mensagem||'Cria\u00e7\u00e3o iniciada.';

        acompanharCriacaoV36(jobId);
    }catch(e){
        alert('Erro ao iniciar publica\u00e7\u00e3o: '+e.message);
    }
}

async function carregarResultadosCriacaoV36(jobId){
    const token=obterToken();
    if(!token)return;

    try{
        const r=await fetch(`${RENDER_URL}/api/v36/criar/jobs/${encodeURIComponent(jobId)}/resultados?limit=200&_=${Date.now()}`,{
            cache:'no-store',
            headers:{Authorization:token}
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)return;

        const box=document.getElementById('criar-resultados-v36');
        const rows=d.resultados||[];
        if(!box)return;

        if(!rows.length){
            box.classList.add('hidden');
            return;
        }

        box.classList.remove('hidden');
        box.innerHTML=rows.map(x=>`
          <div class="p-3">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-[10px] font-black ${x.success?'text-emerald-400':'text-red-400'}">
                  ${x.success?'\u2713 Criado':'\u2717 Falhou'} \u00b7 ${escapeHtml(x.title_requested||'An\u00fancio')}
                </div>
                <div class="text-[10px] text-slate-400 mt-1">${escapeHtml(x.message||'')}</div>
                ${x.technical_message?`<div class="text-[9px] text-red-300 mt-1">${escapeHtml(x.technical_message)}</div>`:''}
              </div>
              ${x.item_id?`<a href="${escapeHtml(x.permalink||'#')}" target="_blank" class="text-[10px] text-blue-400 font-bold">${escapeHtml(x.item_id)}</a>`:''}
            </div>
          </div>
        `).join('');
    }catch(e){}
}

async function acompanharCriacaoV36(jobId){
    clearTimeout(criarTimerV36);
    const token=obterToken();
    if(!token)return;

    try{
        const r=await fetch(`${RENDER_URL}/api/scale/jobs/${encodeURIComponent(jobId)}?_=${Date.now()}`,{
            cache:'no-store',
            headers:{Authorization:token}
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        const j=d.job||{};
        const total=Number(j.progress_total||0);
        const atual=Number(j.progress_current||0);
        const pct=total?Math.min(100,Math.round((atual/total)*100)):0;

        const bar=document.getElementById('criar-job-bar-v36');
        const pctEl=document.getElementById('criar-job-pct-v36');
        const msg=document.getElementById('criar-job-msg-v36');

        if(bar)bar.style.width=`${pct}%`;
        if(pctEl)pctEl.textContent=`${pct}%`;
        if(msg)msg.textContent=j.message||'Processando cria\u00e7\u00e3o...';

        if(atual%20===0 || ['completed','failed'].includes(j.status)){
            carregarResultadosCriacaoV36(jobId);
        }

        if(['queued','running'].includes(j.status)){
            localStorage.setItem('mlHubPro_mass_create_job_v36',String(jobId));
            criarTimerV36=setTimeout(()=>acompanharCriacaoV36(jobId),1500);
            return;
        }

        localStorage.removeItem('mlHubPro_mass_create_job_v36');
        criarEstadoV36.jobId=null;
        await carregarResultadosCriacaoV36(jobId);

        if(j.status==='completed'){
            if(typeof invalidarCacheAnunciosV30==='function')invalidarCacheAnunciosV30();
        }
    }catch(e){
        const msg=document.getElementById('criar-job-msg-v36');
        if(msg)msg.textContent='Erro ao acompanhar: '+e.message;
        criarTimerV36=setTimeout(()=>acompanharCriacaoV36(jobId),3000);
    }
}

document.addEventListener('DOMContentLoaded',()=>{
    const priceJob=localStorage.getItem('mlHubPro_price_update_job_v36');
    if(priceJob){
        priceUpdateJobV36=String(priceJob);
        acompanharAtualizacaoPrecosV36(priceJob);
    }

    const createJob=localStorage.getItem('mlHubPro_mass_create_job_v36');
    if(createJob){
        criarEstadoV36.jobId=String(createJob);
    }
});
