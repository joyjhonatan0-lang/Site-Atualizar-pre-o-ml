
const ML_HUB_FRONTEND_URL = window.location.origin + window.location.pathname;
const ML_HUB_REMEMBER_EMAIL_V94='mlhub_last_email_v94';

let authModeV95='login';

function modoAuthV95(modo){
    authModeV95=modo==='register'?'register':'login';

    const reg=authModeV95==='register';
    document.getElementById('mlhub-name-field-v95')?.classList.toggle('hidden',!reg);

    const t=document.getElementById('mlhub-login-title-v95');
    const s=document.getElementById('mlhub-login-subtitle-v95');
    const btn=document.getElementById('mlhub-auth-submit-v95');
    const tabLogin=document.getElementById('mlhub-tab-login-v95');
    const tabReg=document.getElementById('mlhub-tab-register-v95');

    if(t)t.innerText=reg?'Criar seu ML Hub Pro':'Entrar no ML Hub Pro';
    if(s)s.innerText=reg
      ?'Crie seu workspace e conecte sua própria conta Mercado Livre em seguida.'
      :'Entre na sua conta. Cada usuário conecta o próprio Mercado Livre depois do login.';

    if(btn){
        btn.onclick=reg?criarContaAppV95:entrarAppV94;
        btn.querySelector('span').innerText=reg?'Criar conta e continuar':'Entrar no workspace';
    }

    if(tabLogin){
        tabLogin.className=reg
          ?'flex-1 text-slate-400 text-[10px] font-black px-3 py-2 rounded-lg'
          :'flex-1 bg-yellow-400 text-slate-950 text-[10px] font-black px-3 py-2 rounded-lg';
    }
    if(tabReg){
        tabReg.className=reg
          ?'flex-1 bg-yellow-400 text-slate-950 text-[10px] font-black px-3 py-2 rounded-lg'
          :'flex-1 text-slate-400 text-[10px] font-black px-3 py-2 rounded-lg';
    }
}

async function criarContaAppV95(){
    const name=document.getElementById('app-login-name-v95')?.value.trim()||'';
    const email=document.getElementById('app-login-email-v94')?.value.trim()||'';
    const password=document.getElementById('app-login-password-v94')?.value||'';
    const remember=document.getElementById('app-login-remember-v94')?.checked===true;

    if(name.length<2)return mostrarStatusLoginOAuth('Informe seu nome ou nome da empresa.',true);
    if(!email)return mostrarStatusLoginOAuth('Informe seu e-mail.',true);
    if(password.length<10)return mostrarStatusLoginOAuth('A senha precisa ter pelo menos 10 caracteres.',true);

    try{
        mostrarStatusLoginOAuth('Criando seu workspace seguro...');

        const r=await fetch(`${RENDER_URL}/api/app/register`,{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({name,email,password,remember})
        });

        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.authenticated)throw new Error(d.erro||'Não foi possível criar sua conta.');

        localStorage.setItem(ML_HUB_REMEMBER_EMAIL_V94,email);
        const pass=document.getElementById('app-login-password-v94');
        if(pass)pass.value='';

        mostrarEtapaMercadoLivreV94({
            email:d.user?.email||email,
            user:d.user
        });
    }catch(e){
        mostrarStatusLoginOAuth(e.message,true);
    }
}

async function carregarContasMLV95(){
    const box=document.getElementById('mlhub-account-switcher-v95');
    const select=document.getElementById('mlhub-account-select-v95');
    if(!box||!select)return;

    try{
        const r=await fetch(`${RENDER_URL}/api/oauth/connections?_=${Date.now()}`,{cache:'no-store'});
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        const itens=Array.isArray(d.itens)?d.itens:[];
        if(!itens.length){
            box.classList.add('hidden');
            box.classList.remove('flex');
            select.innerHTML='';
            return;
        }

        select.innerHTML=itens.map(x=>`
          <option value="${String(x.id)}" ${x.is_active?'selected':''}>
            ${escapeHtml(x.nickname||'Mercado Livre')} · ${escapeHtml(String(x.seller_id||''))}
          </option>
        `).join('');

        box.classList.remove('hidden');
        box.classList.add('flex');
    }catch(e){
        console.warn('[CONTAS ML V95]',e);
    }
}

async function limparCacheContaV95(){
    try{
        const preservar=new Set([ML_HUB_REMEMBER_EMAIL_V94]);
        const remover=[];
        for(let i=0;i<localStorage.length;i++){
            const k=localStorage.key(i);
            if(!k||preservar.has(k))continue;
            if(
                k.startsWith('mlHubPro_') ||
                k.startsWith('mlhub_') ||
                k==='ml_oauth_connected' ||
                k==='ml_access_token'
            )remover.push(k);
        }
        remover.forEach(k=>localStorage.removeItem(k));
    }catch(e){}

    try{
        if(window.indexedDB){
            indexedDB.deleteDatabase('mlHubProAnunciosV43');
        }
    }catch(e){}

    try{
        masterAnunciosV32=[];
        masterMapV32=new Map();
        masterCarregadoV32=false;
        dbCachePromiseV32=null;
    }catch(e){}
}

async function trocarContaMLV95(connectionId){
    if(!connectionId)return;

    try{
        const r=await fetch(`${RENDER_URL}/api/oauth/connections/${encodeURIComponent(connectionId)}/activate`,{
            method:'POST'
        });
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||'Não foi possível trocar a conta.');

        await limparCacheContaV95();
        localStorage.setItem('ml_oauth_connected','1');
        await atualizarStatusOAuthML();
        await carregarContasMLV95();

        if(typeof mudarAba==='function')mudarAba('inicio');
        if(typeof carregarDashboard==='function')carregarDashboard();
    }catch(e){
        alert(e.message);
        carregarContasMLV95();
    }
}


function mostrarStatusLoginOAuth(mensagem,erro=false,connect=false){
    const id=connect?'oauth-login-status-connect-v94':'oauth-login-status';
    const el=document.getElementById(id);
    if(!el)return;
    el.classList.remove('hidden');
    el.className=`v93-login-status ${erro?'bg-red-500/10 text-red-300 border border-red-500/20':'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'}`;
    el.innerText=mensagem;
}

async function consultarSessaoAppV94(){
    try{
        const r=await fetch(`${RENDER_URL}/api/app/session`,{cache:'no-store'});
        return await r.json();
    }catch(e){
        return {configured:true,authenticated:false,offline:true};
    }
}

function mostrarEtapaLoginV94(){
    document.getElementById('mlhub-app-login-stage-v94')?.classList.remove('hidden');
    document.getElementById('mlhub-ml-connect-stage-v94')?.classList.add('hidden');
    document.getElementById('oauth-login-gate')?.classList.remove('hidden');
}

function mostrarEtapaMercadoLivreV94(sessao={}){
    document.getElementById('mlhub-app-login-stage-v94')?.classList.add('hidden');
    document.getElementById('mlhub-ml-connect-stage-v94')?.classList.remove('hidden');
    document.getElementById('oauth-login-gate')?.classList.remove('hidden');
    const el=document.getElementById('mlhub-session-email-v94');
    if(el)el.innerText=sessao?.email?`Workspace: ${sessao.email}`:'Workspace autenticado';
}

async function entrarAppV94(){
    const email=document.getElementById('app-login-email-v94')?.value.trim()||'';
    const password=document.getElementById('app-login-password-v94')?.value||'';
    const remember=document.getElementById('app-login-remember-v94')?.checked===true;

    if(!email||!password){
        mostrarStatusLoginOAuth('Preencha e-mail e senha.',true);
        return;
    }

    try{
        mostrarStatusLoginOAuth('Validando acesso seguro...');

        const r=await fetch(`${RENDER_URL}/api/app/login`,{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({email,password,remember})
        });

        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.authenticated)throw new Error(d.erro||'Não foi possível entrar.');

        localStorage.setItem(ML_HUB_REMEMBER_EMAIL_V94,email);
        const pass=document.getElementById('app-login-password-v94');
        if(pass)pass.value='';

        const oauth=await consultarStatusOAuthML();
        if(oauth.connected){
            document.getElementById('oauth-login-gate')?.classList.add('hidden');
            await carregarContasMLV95();
            if(typeof mudarAba==='function')mudarAba('inicio');
        }else{
            mostrarEtapaMercadoLivreV94({
                email:d.user?.email||email,
                user:d.user
            });
        }
    }catch(e){
        mostrarStatusLoginOAuth(e.message,true);
    }
}

async function sairAppV94(){
    try{
        await fetch(`${RENDER_URL}/api/app/logout`,{method:'POST'});
    }catch(e){}

    await limparCacheContaV95();
    localStorage.removeItem('ml_oauth_connected');
    localStorage.removeItem('ml_access_token');

    modoAuthV95('login');
    mostrarEtapaLoginV94();
}

async function consultarStatusOAuthML(){
    try{
        const r=await fetch(`${RENDER_URL}/api/oauth/status`,{cache:'no-store'});
        if(r.status===401)return {connected:false,session_expired:true};
        const d=await r.json().catch(()=>({}));
        if(r.ok&&d.connected){
            localStorage.setItem('ml_oauth_connected','1');
            localStorage.removeItem('ml_access_token');
            return d;
        }
        localStorage.removeItem('ml_oauth_connected');
        return d||{connected:false};
    }catch(e){
        return {connected:localStorage.getItem('ml_oauth_connected')==='1',offline:true};
    }
}

async function atualizarStatusOAuthML(){
    const data=await consultarStatusOAuthML();
    const el=document.getElementById('oauth-status-config');

    if(el){
        if(data.connected){
            el.className='text-xs text-emerald-400 font-bold mt-4';
            el.innerText=`● Conta conectada${data.nickname?' · '+data.nickname:''}${data.renewable?' · renovação automática':''}`;
        }else{
            el.className='text-xs text-yellow-400 font-bold mt-4';
            el.innerText='● Conta Mercado Livre não conectada';
        }
    }

    return data;
}

async function iniciarOAuthML(origem='login'){
    try{
        if(origem==='login'){
            mostrarStatusLoginOAuth('Abrindo autorização oficial do Mercado Livre...',false,true);
        }

        const r=await fetch(`${RENDER_URL}/api/oauth/start`,{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({frontend_url:ML_HUB_FRONTEND_URL})
        });

        const d=await r.json().catch(()=>({}));
        if(!r.ok||!d.authorization_url){
            throw new Error(d.erro||'Não foi possível iniciar o OAuth.');
        }

        window.location.href=d.authorization_url;
    }catch(e){
        if(origem==='login')mostrarStatusLoginOAuth(e.message,true,true);
        else alert(e.message);
    }
}

async function desconectarOAuthML(){
    if(!confirm('Desconectar a conta Mercado Livre ativa deste workspace?'))return;

    try{
        const r=await fetch(`${RENDER_URL}/api/oauth/disconnect`,{method:'POST'});
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||'Não foi possível desconectar.');
    }catch(e){
        return alert(e.message);
    }

    await limparCacheContaV95();
    localStorage.removeItem('ml_oauth_connected');

    const sessao=await consultarSessaoAppV94();
    const contas=await fetch(`${RENDER_URL}/api/oauth/connections?_=${Date.now()}`,{cache:'no-store'})
        .then(r=>r.json()).catch(()=>({itens:[]}));

    if(Array.isArray(contas.itens)&&contas.itens.some(x=>x.is_active)){
        localStorage.setItem('ml_oauth_connected','1');
        document.getElementById('oauth-login-gate')?.classList.add('hidden');
        await carregarContasMLV95();
    }else{
        mostrarEtapaMercadoLivreV94(sessao);
    }

    atualizarStatusOAuthML();
}

async function carregarSegurancaV94(){
    const el=document.getElementById('v94-security-status');
    if(!el)return;
    try{
        const r=await fetch(`${RENDER_URL}/api/v94/security/status?_=${Date.now()}`,{cache:'no-store'});
        const d=await r.json().catch(()=>({}));
        if(!r.ok)throw new Error(d.erro||`HTTP ${r.status}`);

        el.innerHTML=[
            `<div>Autenticação do workspace: <b class="${d.app_auth_configured?'text-emerald-400':'text-yellow-400'}">${d.app_auth_configured?'ATIVA':'COMPATIBILIDADE'}</b></div>`,
            `<div class="mt-1">Aplicativo OAuth no servidor: <b class="${d.oauth_configured?'text-emerald-400':'text-red-300'}">${d.oauth_configured?'CONFIGURADO':'FALTA CONFIGURAR'}</b></div>`,
            `<div class="mt-1">Criptografia de tokens: <b class="${d.token_encryption?'text-emerald-400':'text-yellow-400'}">${d.token_encryption?'ATIVA':'RECOMENDADA'}</b></div>`,
            `<div class="mt-1">Login manual por token: <b class="${d.legacy_token_enabled?'text-yellow-400':'text-emerald-400'}">${d.legacy_token_enabled?'LEGADO ATIVO':'DESATIVADO'}</b></div>`
        ].join('');
    }catch(e){
        el.innerText='Não foi possível consultar o status de segurança.';
    }
}

// Compatibilidade com chamadas antigas.
function lerCamposOAuth(){return {frontend_url:ML_HUB_FRONTEND_URL}}
async function salvarCredenciaisEEntrar(){return entrarAppV94()}
async function salvarTokenTemporarioConfig(){
    alert('O login manual por Access Token foi removido da interface. Use Conectar Mercado Livre.');
}
function apagarLoginLocalV93(){
    localStorage.removeItem(ML_HUB_REMEMBER_EMAIL_V94);
    const el=document.getElementById('app-login-email-v94');
    if(el)el.value='';
}


async function tentarConcluirOauthPendenteV104({tentativas=8}={}){
    const statusMsg=document.getElementById('login-oauth-status');

    for(let i=1;i<=tentativas;i++){
        try{
            mostrarStatusLoginOAuth(
                `Conta autorizada pelo Mercado Livre. Reconectando ao banco de dados… tentativa ${i}/${tentativas}`,
                false,
                true
            );

            const r=await fetch(`${RENDER_URL}/api/oauth/retry-pending`,{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                cache:'no-store'
            });
            const d=await r.json().catch(()=>({}));

            if(r.ok&&d.sucesso){
                mostrarStatusLoginOAuth(
                    'Conta Mercado Livre conectada com segurança.',
                    false,
                    true
                );
                await limparCacheContaV95();
                localStorage.setItem('ml_oauth_connected','1');
                return {sucesso:true,seller_id:d.seller_id};
            }

            if(d.code==='DB_DNS_UNAVAILABLE'){
                mostrarStatusLoginOAuth(
                    'O Mercado Livre autorizou sua conta, mas o banco do Render não está acessível. Verifique a variável DATABASE_URL e se o Web Service e o PostgreSQL estão na mesma região.',
                    true,
                    true
                );
                return {sucesso:false,permanente:true,erro:d.erro||d.message};
            }

            if(!d.retryable && r.status!==503){
                throw new Error(d.erro||d.message||`HTTP ${r.status}`);
            }
        }catch(e){
            if(i>=tentativas){
                mostrarStatusLoginOAuth(
                    'Não foi possível salvar a conexão no PostgreSQL. Corrija DATABASE_URL no Render e tente conectar novamente.',
                    true,
                    true
                );
                return {sucesso:false,erro:e.message};
            }
        }

        await new Promise(resolve=>setTimeout(
            resolve,
            Math.min(7000,1200*Math.pow(1.45,i-1))
        ));
    }

    return {sucesso:false};
}

async function diagnosticarBancoV104(){
    try{
        const r=await fetch(`${RENDER_URL}/api/v104/database/status?_=${Date.now()}`,{
            cache:'no-store'
        });
        return await r.json().catch(()=>({ok:false}));
    }catch(e){
        return {ok:false,message:e.message};
    }
}

document.addEventListener('DOMContentLoaded',async()=>{
    modoAuthV95('login');
    const emailSalvo=localStorage.getItem(ML_HUB_REMEMBER_EMAIL_V94)||'';
    const email=document.getElementById('app-login-email-v94');
    if(email&&!email.value)email.value=emailSalvo;

    const params=new URLSearchParams(window.location.search);
    const oauth=params.get('oauth');

    const sessao=await consultarSessaoAppV94();

    if(sessao.configured && !sessao.authenticated){
        mostrarEtapaLoginV94();
        return;
    }

    if(oauth==='error'){
        const mensagem=params.get('message')||'O Mercado Livre não concluiu a autorização.';
        history.replaceState({},document.title,window.location.pathname);
        mostrarEtapaMercadoLivreV94(sessao);
        mostrarStatusLoginOAuth(mensagem,true,true);
        return;
    }

    if(oauth==='pending_database'){
        const mensagem=params.get('message')||
          'O Mercado Livre autorizou a conta, mas o PostgreSQL está temporariamente indisponível.';

        history.replaceState({},document.title,window.location.pathname);
        mostrarEtapaMercadoLivreV94(sessao);
        mostrarStatusLoginOAuth(mensagem,false,true);

        const concluido=await tentarConcluirOauthPendenteV104({tentativas:8});

        if(!concluido.sucesso){
            const dbStatus=await diagnosticarBancoV104();

            if(dbStatus?.code==='DB_DNS_UNAVAILABLE'){
                mostrarStatusLoginOAuth(
                    `Banco indisponível: o hostname ${dbStatus.host||'configurado'} não foi encontrado. Atualize DATABASE_URL no Render. Se estiver usando a URL interna, Web Service e PostgreSQL precisam estar no mesmo workspace e região.`,
                    true,
                    true
                );
            }
            return;
        }
    }

    if(oauth==='success'){
        history.replaceState({},document.title,window.location.pathname);
        await limparCacheContaV95();
        localStorage.setItem('ml_oauth_connected','1');
    }

    const status=await consultarStatusOAuthML();

    if(status.connected){
        document.getElementById('oauth-login-gate')?.classList.add('hidden');
        await carregarContasMLV95();

        const perfilNome=document.getElementById('perfil-nome-conta');
        const perfilStatus=document.getElementById('perfil-status-conta');

        if(perfilNome&&status.nickname)perfilNome.innerText=status.nickname;
        if(perfilStatus){
            perfilStatus.innerText='● Conta conectada · OAuth seguro';
            perfilStatus.className='text-xs text-emerald-400 mt-2';
        }
    }else{
        mostrarEtapaMercadoLivreV94(sessao);
    }

    atualizarStatusOAuthML();
    carregarSegurancaV94();
});
