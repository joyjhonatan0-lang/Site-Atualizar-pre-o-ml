const DATABASE_URL = process.env.DATABASE_URL || '';
const DATABASE_FALLBACK_URL = process.env.DATABASE_FALLBACK_URL || '';
const ML_WORKER_ENABLED = String(process.env.ML_WORKER_ENABLED || 'true').toLowerCase() !== 'false';
const ML_WORKER_CONCURRENCY = Math.max(1, Math.min(2, Number(process.env.ML_WORKER_CONCURRENCY || 1)));

let db = null;
const postgresV107 = createPostgresInfrastructure({
    Pool,
    databaseUrl: DATABASE_URL,
    fallbackUrl: DATABASE_FALLBACK_URL,
    nodeEnv: process.env.NODE_ENV,
    poolMax: process.env.DB_POOL_MAX,
    onPoolChange(pool) { db = pool; }
});
db = postgresV107.db;
const {
    dbQuery,
    dbConnectComRetryV104,
    erroPostgresTemporarioV80,
    erroDnsBancoV81,
    esperarDbV80,
    esperarCooldownDbV83,
    limparCooldownDbV83,
    ativarCooldownDbV83,
    aguardarPostgresProntoV80,
    hostBancoSeguroV81
} = postgresV107;

async function inicializarBuscaRapidaV103(){
    if(!db)return false;

    try{
        await dbQuery(`CREATE EXTENSION IF NOT EXISTS pg_trgm`,[],{tentativas:2});
        await dbQuery(`
          CREATE INDEX IF NOT EXISTS idx_ml_items_title_trgm_v103
          ON ml_items USING gin (lower(title) gin_trgm_ops)
        `,[],{tentativas:2});
        await dbQuery(`
          CREATE INDEX IF NOT EXISTS idx_ml_items_sku_trgm_v103
          ON ml_items USING gin (lower(sku) gin_trgm_ops)
        `,[],{tentativas:2});
        return true;
    }catch(e){
        // Alguns planos/provedores podem não permitir CREATE EXTENSION.
        // O sistema continua funcional com os índices B-tree já existentes.
        console.warn('[V103 BUSCA RÁPIDA] pg_trgm indisponível:',e.message);
        return false;
    }
}

async function inicializarBancoEscala() {
    if (!db) {
        console.warn('[ESCALA] DATABASE_URL ausente: modo 90k desativado at\u00e9 configurar PostgreSQL.');
        return;
    }
    await dbQuery(`
      CREATE TABLE IF NOT EXISTS ml_items (
        seller_id BIGINT NOT NULL,
        item_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        sku TEXT NOT NULL DEFAULT '',
        price NUMERIC(18,2) NOT NULL DEFAULT 0,
        available_quantity INTEGER NOT NULL DEFAULT 0,
        sold_quantity INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT '',
        listing_type_id TEXT NOT NULL DEFAULT '',
        category_id TEXT NOT NULL DEFAULT '',
        thumbnail TEXT NOT NULL DEFAULT '',
        permalink TEXT NOT NULL DEFAULT '',
        ml_updated_at TIMESTAMPTZ NULL,
        synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        raw JSONB NULL,
        PRIMARY KEY (seller_id, item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ml_items_seller_status ON ml_items(seller_id,status);
      CREATE INDEX IF NOT EXISTS idx_ml_items_seller_sku ON ml_items(seller_id,sku);
      CREATE INDEX IF NOT EXISTS idx_ml_items_seller_sold ON ml_items(seller_id,sold_quantity DESC);
      CREATE INDEX IF NOT EXISTS idx_ml_items_seller_updated ON ml_items(seller_id,ml_updated_at DESC NULLS LAST);
      CREATE INDEX IF NOT EXISTS idx_ml_items_title_lower ON ml_items(seller_id,lower(title));
      CREATE INDEX IF NOT EXISTS idx_ml_items_seller_status_updated_v103
      ON ml_items(seller_id,status,ml_updated_at DESC NULLS LAST,item_id);
      CREATE INDEX IF NOT EXISTS idx_ml_items_seller_sku_sold_v103
      ON ml_items(seller_id,lower(sku),sold_quantity DESC,item_id);
      CREATE INDEX IF NOT EXISTS idx_ml_items_seller_date_v103
      ON ml_items(seller_id,((raw->>'date_created')),item_id);

      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(18,2) NOT NULL DEFAULT 0;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS free_shipping BOOLEAN NOT NULL DEFAULT FALSE;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS sale_fee NUMERIC(18,2) NOT NULL DEFAULT 0;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS commission_percentage NUMERIC(8,4) NOT NULL DEFAULT 0;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS commission_synced_at TIMESTAMPTZ NULL;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS net_received NUMERIC(18,2) NOT NULL DEFAULT 0;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS freight_synced_at TIMESTAMPTZ NULL;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS freight_last_attempt_at TIMESTAMPTZ NULL;
      ALTER TABLE ml_items ADD COLUMN IF NOT EXISTS freight_last_error TEXT NULL;
      CREATE INDEX IF NOT EXISTS idx_ml_items_freight_pending
      ON ml_items(seller_id,status,freight_synced_at,freight_last_attempt_at);

      CREATE TABLE IF NOT EXISTS ml_sku_pricing (
        seller_id BIGINT NOT NULL,
        sku TEXT NOT NULL,
        sku_key TEXT NOT NULL,
        cost NUMERIC(18,2) NOT NULL DEFAULT 0,
        desired_margin NUMERIC(8,4) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (seller_id, sku_key)
      );
      CREATE INDEX IF NOT EXISTS idx_ml_sku_pricing_seller
      ON ml_sku_pricing(seller_id,sku_key);

      CREATE TABLE IF NOT EXISTS ml_jobs (
        id BIGSERIAL PRIMARY KEY,
        seller_id BIGINT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        progress_current INTEGER NOT NULL DEFAULT 0,
        progress_total INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        errors INTEGER NOT NULL DEFAULT 0,
        cursor TEXT NULL,
        message TEXT NOT NULL DEFAULT '',
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        locked_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ml_jobs_queue ON ml_jobs(status,available_at,created_at);
      CREATE INDEX IF NOT EXISTS idx_ml_jobs_seller ON ml_jobs(seller_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ml_jobs_seller_status_v103
      ON ml_jobs(seller_id,status,updated_at DESC);

      CREATE TABLE IF NOT EXISTS ml_job_events_v103(
        id BIGSERIAL PRIMARY KEY,
        job_id BIGINT NOT NULL,
        seller_id BIGINT NOT NULL,
        level TEXT NOT NULL DEFAULT 'info',
        code TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL DEFAULT '',
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ml_job_events_v103_job
      ON ml_job_events_v103(job_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ml_job_events_v103_seller
      ON ml_job_events_v103(seller_id,created_at DESC);

      CREATE TABLE IF NOT EXISTS ml_notifications (
        id BIGSERIAL PRIMARY KEY,
        external_id TEXT NULL,
        seller_id BIGINT NULL,
        topic TEXT NOT NULL DEFAULT '',
        resource TEXT NOT NULL DEFAULT '',
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ml_notifications_external
      ON ml_notifications(external_id) WHERE external_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_ml_notifications_queue ON ml_notifications(status,available_at,created_at);

      ALTER TABLE ml_jobs
      ADD COLUMN IF NOT EXISTS result JSONB NOT NULL DEFAULT '{}'::jsonb;

      CREATE TABLE IF NOT EXISTS ml_sync_seen (
        job_id BIGINT NOT NULL,
        seller_id BIGINT NOT NULL,
        item_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(job_id,item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ml_sync_seen_seller_job
      ON ml_sync_seen(seller_id,job_id);

      CREATE TABLE IF NOT EXISTS ml_price_update_errors (
        job_id BIGINT NOT NULL,
        seller_id BIGINT NOT NULL,
        item_id TEXT NOT NULL,
        requested_price NUMERIC(18,2) NOT NULL DEFAULT 0,
        failure_type TEXT NOT NULL DEFAULT 'erro',
        message_pt TEXT NOT NULL DEFAULT '',
        technical_message TEXT NOT NULL DEFAULT '',
        http_status INTEGER NULL,
        code TEXT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(job_id,item_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ml_price_update_errors_job
      ON ml_price_update_errors(job_id,created_at);

      CREATE TABLE IF NOT EXISTS ml_mass_create_results (
        job_id BIGINT NOT NULL,
        seller_id BIGINT NOT NULL,
        seq INTEGER NOT NULL,
        family_seq INTEGER NOT NULL DEFAULT 0,
        variation_seq INTEGER NOT NULL DEFAULT 0,
        title_requested TEXT NOT NULL DEFAULT '',
        item_id TEXT NULL,
        permalink TEXT NULL,
        success BOOLEAN NOT NULL DEFAULT FALSE,
        message TEXT NOT NULL DEFAULT '',
        technical_message TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY(job_id,seq)
      );
      CREATE INDEX IF NOT EXISTS idx_ml_mass_create_results_job
      ON ml_mass_create_results(job_id,seq);

      DELETE FROM ml_sync_seen
      WHERE created_at < NOW() - INTERVAL '3 days';
    `);
    console.log('[ESCALA] PostgreSQL pronto.');
}

function itemParaDb(item, sellerId) {
    const n=normalizarItemGestao(item);
    const saleFee=Number(item?._sale_fee_amount ?? item?.sale_fee ?? 0);
    const commissionPercentage=Number(item?._commission_percentage ?? item?.commission_percentage ?? 0);
    const commissionSyncedAt=item?._commission_synced_at||item?.commission_synced_at||null;
    const netReceived=Math.max(0,Number(n.preco||0)-Math.max(0,saleFee));

    return [
      sellerId,n.id,n.titulo,n.sku,n.preco,n.estoque,n.vendidos,n.status,
      n.listing_type_id,n.categoria,n.thumbnail,n.permalink,n.atualizado_em,
      item,
      Number.isFinite(saleFee)?saleFee:0,
      Number.isFinite(commissionPercentage)?commissionPercentage:0,
      commissionSyncedAt,
      netReceived
    ];
}

async function upsertItensDb(sellerId, itens, opcoes={}) {
    if(!Array.isArray(itens) || !itens.length)return;

    /*
      V82:
      - blocos de até 1.000 itens;
      - até 2 blocos gravados em paralelo por padrão;
      - frete/comissão boa já existente continuam preservados.
      Isso grava lotes de até 1.000 itens sem saturar o PostgreSQL do Render.
    */
    const TAMANHO=Math.max(250,Math.min(1000,Number(process.env.ML_DB_UPSERT_BATCH||1000)));
    const CONC=1;
    const conflitoSql=opcoes?.somenteNovos
      ? 'ON CONFLICT(seller_id,item_id) DO NOTHING'
      : `ON CONFLICT(seller_id,item_id) DO UPDATE SET
          title=EXCLUDED.title,
          sku=EXCLUDED.sku,
          price=EXCLUDED.price,
          available_quantity=EXCLUDED.available_quantity,
          sold_quantity=EXCLUDED.sold_quantity,
          status=EXCLUDED.status,
          listing_type_id=EXCLUDED.listing_type_id,
          category_id=EXCLUDED.category_id,
          thumbnail=EXCLUDED.thumbnail,
          permalink=EXCLUDED.permalink,
          ml_updated_at=EXCLUDED.ml_updated_at,
          sale_fee=CASE
            WHEN EXCLUDED.commission_synced_at IS NOT NULL
            THEN EXCLUDED.sale_fee ELSE ml_items.sale_fee END,
          commission_percentage=CASE
            WHEN EXCLUDED.commission_synced_at IS NOT NULL
            THEN EXCLUDED.commission_percentage ELSE ml_items.commission_percentage END,
          commission_synced_at=COALESCE(EXCLUDED.commission_synced_at,ml_items.commission_synced_at),
          net_received=GREATEST(
            0,
            EXCLUDED.price - (
              CASE WHEN EXCLUDED.commission_synced_at IS NOT NULL
                   THEN EXCLUDED.sale_fee ELSE ml_items.sale_fee END
            ) - ml_items.shipping_cost
          ),
          raw=EXCLUDED.raw,
          synced_at=CASE WHEN
            ml_items.title IS DISTINCT FROM EXCLUDED.title OR
            ml_items.sku IS DISTINCT FROM EXCLUDED.sku OR
            ml_items.price IS DISTINCT FROM EXCLUDED.price OR
            ml_items.available_quantity IS DISTINCT FROM EXCLUDED.available_quantity OR
            ml_items.sold_quantity IS DISTINCT FROM EXCLUDED.sold_quantity OR
            ml_items.status IS DISTINCT FROM EXCLUDED.status OR
            ml_items.listing_type_id IS DISTINCT FROM EXCLUDED.listing_type_id OR
            ml_items.category_id IS DISTINCT FROM EXCLUDED.category_id OR
            ml_items.thumbnail IS DISTINCT FROM EXCLUDED.thumbnail OR
            ml_items.permalink IS DISTINCT FROM EXCLUDED.permalink OR
            ml_items.ml_updated_at IS DISTINCT FROM EXCLUDED.ml_updated_at OR
            ml_items.sale_fee IS DISTINCT FROM (
              CASE WHEN EXCLUDED.commission_synced_at IS NOT NULL
                   THEN EXCLUDED.sale_fee ELSE ml_items.sale_fee END
            ) OR
            ml_items.commission_percentage IS DISTINCT FROM (
              CASE WHEN EXCLUDED.commission_synced_at IS NOT NULL
                   THEN EXCLUDED.commission_percentage ELSE ml_items.commission_percentage END
            )
          THEN NOW() ELSE ml_items.synced_at END`;

    const lotes=[];
    for(let inicio=0;inicio<itens.length;inicio+=TAMANHO){
        const lote=itens.slice(inicio,inicio+TAMANHO).map(item=>{
            const n=normalizarItemGestao(item);
            const saleFee=Number(item?._sale_fee_amount ?? item?.sale_fee ?? 0);
            const commissionPercentage=Number(item?._commission_percentage ?? item?.commission_percentage ?? 0);
            const commissionSyncedAt=item?._commission_synced_at||item?.commission_synced_at||null;

            return {
                item_id:String(n.id||''),
                title:String(n.titulo||''),
                sku:String(n.sku||''),
                price:Number(n.preco||0),
                available_quantity:Number(n.estoque||0),
                sold_quantity:Number(n.vendidos||0),
                status:String(n.status||''),
                listing_type_id:String(n.listing_type_id||''),
                category_id:String(n.categoria||''),
                thumbnail:String(n.thumbnail||''),
                permalink:String(n.permalink||''),
                ml_updated_at:n.atualizado_em||null,
                raw:item||{},
                sale_fee:Number.isFinite(saleFee)?saleFee:0,
                commission_percentage:Number.isFinite(commissionPercentage)?commissionPercentage:0,
                commission_synced_at:commissionSyncedAt,
                net_received:Math.max(0,Number(n.preco||0)-Math.max(0,saleFee))
            };
        }).filter(x=>x.item_id);
        if(lote.length)lotes.push(lote);
    }

    let cursor=0;
    async function gravador(){
        while(true){
            const idx=cursor++;
            if(idx>=lotes.length)return;
            const lote=lotes[idx];

            await dbQuery(`
              INSERT INTO ml_items (
                seller_id,item_id,title,sku,price,available_quantity,sold_quantity,
                status,listing_type_id,category_id,thumbnail,permalink,ml_updated_at,
                raw,sale_fee,commission_percentage,commission_synced_at,net_received,synced_at
              )
              SELECT
                $1::bigint,
                x.item_id,x.title,x.sku,x.price,x.available_quantity,x.sold_quantity,
                x.status,x.listing_type_id,x.category_id,x.thumbnail,x.permalink,
                x.ml_updated_at,x.raw,x.sale_fee,x.commission_percentage,
                x.commission_synced_at,x.net_received,NOW()
              FROM jsonb_to_recordset($2::jsonb) AS x(
                item_id text,
                title text,
                sku text,
                price numeric,
                available_quantity integer,
                sold_quantity integer,
                status text,
                listing_type_id text,
                category_id text,
                thumbnail text,
                permalink text,
                ml_updated_at timestamptz,
                raw jsonb,
                sale_fee numeric,
                commission_percentage numeric,
                commission_synced_at timestamptz,
                net_received numeric
              )
              ${conflitoSql}
            `,[sellerId,JSON.stringify(lote)]);
        }
    }

    await Promise.all(
        Array.from({length:Math.min(CONC,lotes.length)},()=>gravador())
    );
}

/* =========================================================
   V28 \u2014 CUSTO DE VENDA / COMISS\u00c3O POR AN\u00daNCIO
   Usa o recurso oficial sites/{site}/listing_prices.
========================================================= */
function flattenListingPricesV28(data){
    const out=[];
    const walk=v=>{
        if(Array.isArray(v)){
            v.forEach(walk);
            return;
        }
        if(v && typeof v==='object')out.push(v);
    };
    walk(data);
    return out;
}

function contextoComissaoMudouV28(anterior,item){
    if(!anterior)return true;

    const oldShipping=anterior?.raw?.shipping||{};
    const newShipping=item?.shipping||{};

    return (
      Number(anterior.price||0)!==Number(item?.price||0) ||
      String(anterior.listing_type_id||'')!==String(item?.listing_type_id||'') ||
      String(anterior.category_id||'')!==String(item?.category_id||'') ||
      String(oldShipping.mode||'')!==String(newShipping.mode||'') ||
      String(oldShipping.logistic_type||'')!==String(newShipping.logistic_type||'') ||
      String(anterior?.raw?.catalog_product_id||'')!==String(item?.catalog_product_id||'')
    );
}

async function consultarComissaoItemV28(item,token){
    const price=Number(item?.price||0);
    const listingType=String(item?.listing_type_id||'').trim();
    if(!(price>0)||!listingType){
        throw new Error('An\u00fancio sem pre\u00e7o ou listing_type para calcular comiss\u00e3o.');
    }

    const site=String(item?.site_id||'MLB');
    const shipping=item?.shipping||{};
    const params=new URLSearchParams({
        price:String(price),
        currency_id:String(item?.currency_id||'BRL'),
        listing_type_id:listingType
    });

    // A documenta\u00e7\u00e3o atual recomenda enviar o contexto log\u00edstico para
    // o fixed_fee ficar coerente com o que ser\u00e1 efetivamente cobrado.
    if(shipping?.logistic_type)params.set('logistic_type',String(shipping.logistic_type));
    if(shipping?.mode)params.set('shipping_mode',String(shipping.mode));

    // Para maior precis\u00e3o, usa produto de cat\u00e1logo quando existir;
    // caso contr\u00e1rio usa a categoria.
    if(item?.catalog_product_id){
        params.set('catalog_product_id',String(item.catalog_product_id));
    }else if(item?.category_id){
        params.set('category_id',String(item.category_id));
    }

    let ultimoErro='Falha ao calcular comiss\u00e3o.';
    for(let tentativa=1;tentativa<=3;tentativa++){
        const controller=new AbortController();
        const timer=setTimeout(()=>controller.abort(),12000);

        try{
            const r=await mlFetch(
                `${ML_API}/sites/${encodeURIComponent(site)}/listing_prices?${params.toString()}`,
                token,
                {signal:controller.signal}
            );
            const d=await jsonSeguro(r);

            if(r.ok){
                const lista=flattenListingPricesV28(d);
                const row=
                  lista.find(x=>String(x?.listing_type_id||x?.mapping||'')===listingType) ||
                  lista.find(x=>Number.isFinite(Number(x?.sale_fee_amount))) ||
                  null;

                if(row){
                    const saleFee=Number(row.sale_fee_amount);
                    const percentage=Number(row?.sale_fee_details?.percentage_fee);

                    if(Number.isFinite(saleFee)&&saleFee>=0){
                        return {
                            sale_fee_amount:saleFee,
                            percentage_fee:Number.isFinite(percentage)&&percentage>=0?percentage:0
                        };
                    }
                }

                ultimoErro='Listing Prices respondeu sem sale_fee_amount.';
                break;
            }

            ultimoErro=`Comiss\u00e3o HTTP ${r.status}: ${formatarErroMercadoLivre(d)}`;
            if(![408,429,500,502,503,504].includes(r.status))break;

            const retryAfter=Number(r.headers.get('retry-after')||0);
            await new Promise(resolve=>setTimeout(
              resolve,
              retryAfter>0?Math.min(5000,retryAfter*1000):500*tentativa
            ));
        }catch(e){
            ultimoErro=e?.name==='AbortError'
              ? 'Timeout ao consultar comiss\u00e3o.'
              : e.message;
            if(tentativa<3)await new Promise(resolve=>setTimeout(resolve,500*tentativa));
        }finally{
            clearTimeout(timer);
        }
    }

    throw new Error(ultimoErro);
}

async function enriquecerComissoesV28(sellerId,itens,token){
    if(!Array.isArray(itens)||!itens.length)return {itens:[],consultados:0,erros:0};

    const ids=itens.map(x=>String(x.id||'')).filter(Boolean);
    const antigos=await dbQuery(`
      SELECT
        item_id,
        price::float8 AS price,
        listing_type_id,
        category_id,
        sale_fee::float8 AS sale_fee,
        commission_percentage::float8 AS commission_percentage,
        commission_synced_at,
        raw
      FROM ml_items
      WHERE seller_id=$1
        AND item_id=ANY($2::text[])
    `,[sellerId,ids]);

    const mapaAntigos=new Map(antigos.rows.map(x=>[String(x.item_id),x]));
    const alvos=[];

    for(const item of itens){
        const anterior=mapaAntigos.get(String(item.id));

        if(
          !anterior ||
          !anterior.commission_synced_at ||
          contextoComissaoMudouV28(anterior,item)
        ){
            alvos.push(item);
        }else{
            item._sale_fee_amount=Number(anterior.sale_fee||0);
            item._commission_percentage=Number(anterior.commission_percentage||0);
            item._commission_synced_at=anterior.commission_synced_at;
        }
    }

    const concorrencia=Math.max(
      4,
      Math.min(28,Number(process.env.ML_COMMISSION_CONCURRENCY||16))
    );

    let cursor=0;
    let erros=0;

    async function worker(){
        while(true){
            const idx=cursor++;
            if(idx>=alvos.length)return;

            const item=alvos[idx];
            const anterior=mapaAntigos.get(String(item.id));

            try{
                const fee=await consultarComissaoItemV28(item,token);
                item._sale_fee_amount=fee.sale_fee_amount;
                item._commission_percentage=fee.percentage_fee;
                item._commission_synced_at=new Date().toISOString();
            }catch(e){
                erros++;
                console.warn('[COMISS\u00c3O V28]',item.id,e.message);

                // Nunca apaga uma comiss\u00e3o boa j\u00e1 salva por causa de falha tempor\u00e1ria.
                if(anterior){
                    item._sale_fee_amount=Number(anterior.sale_fee||0);
                    item._commission_percentage=Number(anterior.commission_percentage||0);
                    item._commission_synced_at=anterior.commission_synced_at||null;
                }else{
                    item._sale_fee_amount=0;
                    item._commission_percentage=0;
                    item._commission_synced_at=null;
                }
            }
        }
    }

    await Promise.all(
      Array.from(
        {length:Math.min(concorrencia,Math.max(1,alvos.length))},
        ()=>worker()
      )
    );

    return {
        itens,
        consultados:alvos.length,
        erros
    };
}

async function criarJob(sellerId,type,payload={}) {
    const r=await dbQuery(`INSERT INTO ml_jobs(seller_id,type,payload) VALUES($1,$2,$3) RETURNING *`,[sellerId,type,payload]);
    return r.rows[0];
}
async function claimJob() {
    const client=await dbConnectComRetryV104();
    try {
        await client.query('BEGIN');
        const r=await client.query(`
          SELECT * FROM ml_jobs
          WHERE status='queued' AND available_at<=NOW()
            AND type<>'full_sync'
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED LIMIT 1
        `);
        if(!r.rows.length){await client.query('COMMIT');return null}
        const job=r.rows[0];
        await client.query(`UPDATE ml_jobs SET status='running',locked_at=NOW(),updated_at=NOW(),attempts=attempts+1 WHERE id=$1`,[job.id]);
        await client.query('COMMIT');
        return job;
    } catch(e){await client.query('ROLLBACK');throw e} finally{client.release()}
}


async function claimJobTipoV76(type){
    const client=await dbConnectComRetryV104();
    try{
        await client.query('BEGIN');
        const r=await client.query(`
          SELECT * FROM ml_jobs
          WHERE status='queued' AND available_at<=NOW() AND type=$1
          ORDER BY created_at ASC
          FOR UPDATE SKIP LOCKED LIMIT 1
        `,[type]);
        if(!r.rows.length){await client.query('COMMIT');return null;}
        const job=r.rows[0];
        await client.query(`
          UPDATE ml_jobs
          SET status='running',locked_at=NOW(),updated_at=NOW(),attempts=attempts+1
          WHERE id=$1
        `,[job.id]);
        await client.query('COMMIT');
        return job;
    }catch(e){
        await client.query('ROLLBACK');
        throw e;
    }finally{
        client.release();
    }
}

async function syncWorkerDedicadoV76(){
    while(true){
        let encontrouJob=false;
        try{
            await esperarCooldownDbV83();
            const job=await claimJobTipoV76('full_sync');
            if(job){
                encontrouJob=true;
                try{
                    await processarSyncCompleto(job);
                }catch(e){
                    const dbTemp=erroPostgresTemporarioV80(e);
                    const retry=dbTemp || Number(job.attempts||0)<20;
                    try{
                        await dbQuery(`
                          UPDATE ml_jobs SET
                            status=$2,
                            locked_at=NULL,
                            message=$3,
                            available_at=NOW()+INTERVAL '2 seconds',
                            updated_at=NOW(),
                            finished_at=CASE WHEN $2='failed' THEN NOW() ELSE NULL END
                          WHERE id=$1
                        `,[job.id,retry?'queued':'failed',
                           dbTemp?'PostgreSQL reiniciando. Retomada automática ativa.':String(e.message||e).slice(0,500)]);
                    }catch(e2){
                        if(!erroPostgresTemporarioV80(e2))console.error('[SYNC WORKER V109 REQUEUE]',e2.message);
                    }
                    if(dbTemp)await esperarDbV80(1500);
                }
            }
        }catch(e){
            if(erroPostgresTemporarioV80(e))console.warn('[SYNC WORKER V107] PostgreSQL indisponível; aguardando reconexão.');
            else console.error('[SYNC WORKER V107]',e.message);
        }
        // Em repouso, consultar a fila a cada 1,5s em vez de 120ms.
        await new Promise(r=>setTimeout(r,encontrouJob?250:1500));
    }
}


let syncWakeV79=false;
async function acordarSyncV79(){
    if(syncWakeV79||!db||!ML_WORKER_ENABLED)return;
    syncWakeV79=true;
    setImmediate(async()=>{
        try{
            const job=await claimJobTipoV76('full_sync');
            if(job){
                try{await processarSyncCompleto(job)}
                catch(e){
                    const dbTemp=erroPostgresTemporarioV80(e);
                    const retry=dbTemp || Number(job.attempts||0)<20;
                    try{
                        await dbQuery(`
                          UPDATE ml_jobs SET status=$2,locked_at=NULL,available_at=NOW()+INTERVAL '2 seconds',
                            message=$3,updated_at=NOW(),finished_at=CASE WHEN $2='failed' THEN NOW() ELSE NULL END
                          WHERE id=$1
                        `,[job.id,retry?'queued':'failed',
                           dbTemp?'PostgreSQL reiniciando. Retomada automática ativa.':String(e.message||e).slice(0,500)]);
                    }catch(e2){
                        if(!erroPostgresTemporarioV80(e2))console.error('[SYNC WAKE V80 REQUEUE]',e2.message);
                    }
                }
            }
        }catch(e){console.error('[SYNC WAKE V84]',e.message)}
        finally{syncWakeV79=false}
    });
}


function erroCursorScanV84(status,data){
    const txt=(String(data?.message||'')+' '+String(data?.error||'')+' '+JSON.stringify(data?.cause||[])).toLowerCase();
    return status===400 && (
        txt.includes('scroll') ||
        txt.includes('search_type') ||
        txt.includes('invalid') ||
        txt.includes('expired')
    );
}

async function buscarPaginaScanV84({sellerId,token,scrollId}){
    let ultimoErro=null;

    for(let tentativa=1;tentativa<=5;tentativa++){
        try{
            const params=new URLSearchParams({search_type:'scan',limit:'100'});
            if(scrollId)params.set('scroll_id',scrollId);

            const controller=new AbortController();
            const timer=setTimeout(()=>controller.abort(),15000);
            let r;
            try{
                r=await mlFetch(
                    `${ML_API}/users/${sellerId}/items/search?${params.toString()}`,
                    token,
                    {signal:controller.signal,headers:{Accept:'application/json'}}
                );
            }finally{
                clearTimeout(timer);
            }

            const d=await jsonSeguro(r);

            if(r.ok){
                return {
                    ok:true,
                    results:Array.isArray(d?.results)?d.results.map(String).filter(Boolean):[],
                    scroll_id:d?.scroll_id||null,
                    total:Number(d?.paging?.total||0)
                };
            }

            if(scrollId && erroCursorScanV84(r.status,d)){
                return {ok:false,cursor_expirado:true,status:r.status,data:d};
            }

            ultimoErro=new Error(formatarErroMercadoLivre(d)||`Mercado Livre HTTP ${r.status}`);

            if(![408,429,500,502,503,504].includes(r.status))throw ultimoErro;

            const retryAfter=Number(r.headers?.get?.('retry-after')||0);
            const espera=retryAfter>0
                ? Math.min(10000,retryAfter*1000)
                : Math.min(5000,500*Math.pow(2,tentativa-1));
            await esperarFrete(espera);
        }catch(e){
            ultimoErro=e;
            if(tentativa>=5)break;
            await esperarFrete(Math.min(5000,500*Math.pow(2,tentativa-1)));
        }
    }

    throw ultimoErro||new Error('Falha ao consultar a lista de anúncios do Mercado Livre.');
}


/* =========================================================
   V106 — HEARTBEAT + RECUPERAÇÃO DE FULL SYNC
========================================================= */
function heartbeatSyncV106(jobId,mensagem='Processando lote de anúncios...'){
    let ocupado=false;

    const timer=setInterval(async()=>{
        if(ocupado)return;
        ocupado=true;
        try{
            await dbQuery(`
              UPDATE ml_jobs
              SET updated_at=NOW(),
                  message=CASE
                    WHEN status='running' THEN COALESCE(NULLIF(message,''),$2)
                    ELSE message
                  END
              WHERE id=$1 AND status='running'
            `,[jobId,mensagem],{tentativas:1});
        }catch(e){
            // O heartbeat nunca derruba o worker. O checkpoint já salvo permanece.
            if(!erroPostgresTemporarioV80(e)){
                console.warn('[SYNC V109 HEARTBEAT]',e.message);
            }
        }finally{
            ocupado=false;
        }
    },15000);

    timer.unref?.();
    return ()=>clearInterval(timer);
}

let recuperarSyncV106Busy=false;

async function normalizarJobsFullSyncV106({startup=false}={}){
    if(!db || recuperarSyncV106Busy)return 0;
    recuperarSyncV106Busy=true;

    try{
        let retomados=0;

        // No startup, qualquer job running pertence ao processo Node anterior.
        // Em runtime, só recupera se perdeu heartbeat por tempo suficiente.
        const rr=startup
          ? await dbQuery(`
              UPDATE ml_jobs
              SET status='queued',
                  locked_at=NULL,
                  available_at=NOW(),
                  message='Servidor reiniciado. Retomando automaticamente do último checkpoint.',
                  updated_at=NOW()
              WHERE type='full_sync' AND status='running'
              RETURNING id,seller_id
            `)
          : await dbQuery(`
              UPDATE ml_jobs
              SET status='queued',
                  locked_at=NULL,
                  available_at=NOW(),
                  message='Worker interrompido. Retomando automaticamente do último checkpoint.',
                  updated_at=NOW()
              WHERE type='full_sync'
                AND status='running'
                AND updated_at<NOW()-INTERVAL '120 seconds'
              RETURNING id,seller_id
            `,[],{tentativas:2});

        retomados=Number(rr?.rowCount||0);

        // Se versões anteriores criaram jobs duplicados para o mesmo seller,
        // mantém somente o mais recente em queued/running.
        const duplicados=await dbQuery(`
          WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER(
                     PARTITION BY seller_id
                     ORDER BY GREATEST(COALESCE(progress_current,0),COALESCE(processed,0)) DESC,
                              updated_at DESC,
                              id DESC
                   ) AS rn
            FROM ml_jobs
            WHERE type='full_sync'
              AND status IN ('queued','running')
          )
          UPDATE ml_jobs j
          SET status='failed',
              locked_at=NULL,
              finished_at=NOW(),
              message='Processo duplicado encerrado automaticamente pela V106. O job mais recente continuará do checkpoint.',
              updated_at=NOW()
          FROM ranked r
          WHERE j.id=r.id AND r.rn>1
          RETURNING j.id
        `,[],{tentativas:2});

        if(retomados || Number(duplicados.rowCount||0)){
            console.warn(
              '[SYNC V109 RECOVERY]',
              'retomados=',retomados,
              'duplicados encerrados=',Number(duplicados.rowCount||0)
            );
            setTimeout(()=>acordarSyncV79(),200);
        }

        return retomados;
    }catch(e){
        if(!erroPostgresTemporarioV80(e)){
            console.warn('[SYNC V109 RECOVERY]',e.message);
        }
        return 0;
    }finally{
        recuperarSyncV106Busy=false;
    }
}

let syncRecoveryTimerV106=null;
function iniciarRecoverySyncV106(){
    if(syncRecoveryTimerV106)return;
    syncRecoveryTimerV106=setInterval(
        ()=>normalizarJobsFullSyncV106({startup:false}),
        30000
    );
    syncRecoveryTimerV106.unref?.();
}


async function processarSyncCompleto(job) {
    console.log('[SYNC V109 WORKER] iniciando job',job.id,'seller',job.seller_id);

    const token=await obterTokenPersistenteParaSeller(job.seller_id);
    if(!token){
        console.warn('[SYNC V109 WORKER] token persistente indisponível · job',job.id,'seller',job.seller_id);
        throw new Error('Token Mercado Livre indisponível para o seller do job.');
    }

    // V109: lotes de até 1.000 IDs percorridos por ciclo.
    // Somente IDs ausentes em ml_items recebem busca de detalhes.
    // Cada lote é gravado e confirmado no PostgreSQL antes de avançar o cursor.
    const TAMANHO_LOTE=1000;
    const detalheConfigurado=Number(process.env.ML_SYNC_DETAIL_CHUNK||1000);
    const concorrenciaConfigurada=Number(process.env.ML_SYNC_BULK_CONCURRENCY||12);
    const TAMANHO_SUBLOTE=Math.max(100,Math.min(1000,Number.isFinite(detalheConfigurado)?detalheConfigurado:1000));
    const CONCORRENCIA_BULK_SYNC=Math.max(4,Math.min(16,Number.isFinite(concorrenciaConfigurada)?concorrenciaConfigurada:12));
    const PAGINAS_POR_LOTE=Math.max(1,Math.ceil(TAMANHO_LOTE/100));

    let scrollId=job.cursor||null;
    let total=Number(job.progress_total||0);
    let errors=Number(job.errors||0);
    let novosGravados=0;
    let existentesPreservados=0;

    let seenCount=Number((await dbQuery(
        `SELECT COUNT(*)::int total FROM ml_sync_seen WHERE job_id=$1`,
        [job.id]
    )).rows[0]?.total||0);

    let processed=Math.max(Number(job.processed||0),seenCount);

    // Só limpa o controle temporário deste job novo. Nunca apaga ml_items.
    if(processed===0 && !scrollId){
        await dbQuery(`DELETE FROM ml_sync_seen WHERE job_id=$1`,[job.id]);
        seenCount=0;
    }

    await dbQuery(`
      UPDATE ml_jobs SET
        status='running',
        processed=$2,
        progress_current=$2,
        message=$3,
        updated_at=NOW()
      WHERE id=$1
    `,[job.id,processed,
       processed
         ? `Retomando do checkpoint · ${processed.toLocaleString('pt-BR')} IDs já percorridos · lote de até 1.000 · somente anúncios novos serão baixados.`
         : `Iniciando leitura incremental · lotes de até 1.000 · anúncios já salvos serão preservados.`
    ]);

    let terminou=false;
    let paginasDesdeHeartbeat=0;
    let reiniciosCursor=0;
    const pararHeartbeat=heartbeatSyncV106(
        job.id,
        'Sincronização incremental ativa · lotes de 1.000 · salvamento contínuo no PostgreSQL'
    );

    try{
      while(!terminou){
        const idsNovos=[];
        const idsNovosSet=new Set();
        const idsLidosSub=[];
        const idsLidosSet=new Set();
        let cursorSeguroSub=scrollId;
        let cursorExpirou=false;
        let paginasNoLote=0;

        // O scan do ML retorna até 100 IDs por página. A cada até 10 páginas,
        // compara com o banco, baixa apenas IDs ausentes e salva o checkpoint.
        while(
          !terminou &&
          idsLidosSub.length<TAMANHO_LOTE &&
          idsNovos.length<TAMANHO_SUBLOTE &&
          paginasNoLote<PAGINAS_POR_LOTE
        ){
            const pagina=await buscarPaginaScanV84({
                sellerId:job.seller_id,
                token,
                scrollId
            });

            if(pagina.cursor_expirado){
                reiniciosCursor++;
                cursorExpirou=true;
                scrollId=null;
                await dbQuery(`
                  UPDATE ml_jobs SET
                    cursor=NULL,
                    message=$2,
                    updated_at=NOW()
                  WHERE id=$1
                `,[job.id,
                   `Cursor do Mercado Livre expirou. Reconstruindo a leitura; anúncios já gravados continuam preservados.`
                ]);
                if(reiniciosCursor>10){
                    throw new Error('O Mercado Livre invalidou o cursor repetidas vezes. A sincronização será retomada automaticamente do checkpoint.');
                }
                break;
            }

            if(total<=0 && pagina.total>0){
                total=pagina.total;
                await dbQuery(`
                  UPDATE ml_jobs SET progress_total=$2,updated_at=NOW() WHERE id=$1
                `,[job.id,total]);
            }

            const idsPagina=Array.isArray(pagina.results)?pagina.results.map(String).filter(Boolean):[];
            if(!idsPagina.length){
                terminou=true;
                scrollId=null;
                cursorSeguroSub=null;
                break;
            }

            // Uma única consulta identifica IDs já salvos e IDs já contabilizados
            // neste job. IDs ausentes no banco são candidatos a download, mesmo
            // que tenham sido tentados em uma execução anterior e não retornaram.
            const estado=await dbQuery(`
              SELECT
                p.item_id,
                (m.item_id IS NOT NULL) AS existe_db,
                (s.item_id IS NOT NULL) AS visto_job
              FROM unnest($3::text[]) AS p(item_id)
              LEFT JOIN ml_items m
                ON m.seller_id=$1 AND m.item_id=p.item_id
              LEFT JOIN ml_sync_seen s
                ON s.job_id=$2 AND s.item_id=p.item_id
            `,[job.seller_id,job.id,idsPagina]);

            for(const row of estado.rows){
                const itemId=String(row.item_id||'');
                if(!itemId)continue;

                if(!row.visto_job && !idsLidosSet.has(itemId)){
                    idsLidosSet.add(itemId);
                    idsLidosSub.push(itemId);
                }

                // Registros existentes nunca são baixados novamente neste fluxo.
                // Se um ID ainda não existe no banco, ele volta a ser tentado.
                if(!row.existe_db && !idsNovosSet.has(itemId)){
                    idsNovosSet.add(itemId);
                    idsNovos.push(itemId);
                }
            }

            scrollId=pagina.scroll_id||null;
            cursorSeguroSub=scrollId;
            paginasNoLote++;
            if(!scrollId)terminou=true;

            if(idsLidosSub.length===0 && idsNovos.length===0){
                // Página totalmente conhecida: o cursor pode avançar sem download.
                await dbQuery(`
                  UPDATE ml_jobs SET cursor=$2,updated_at=NOW(),message=$3 WHERE id=$1
                `,[job.id,scrollId,
                   `Verificando IDs · ${processed.toLocaleString('pt-BR')} já percorridos · anúncios existentes preservados.`
                ]);
            }

            paginasDesdeHeartbeat++;
            if(paginasDesdeHeartbeat>=5){
                paginasDesdeHeartbeat=0;
                await dbQuery(`
                  UPDATE ml_jobs SET
                    processed=$2,
                    progress_current=$2,
                    progress_total=CASE WHEN $3>0 THEN $3 ELSE progress_total END,
                    message=$4,
                    updated_at=NOW()
                  WHERE id=$1
                `,[job.id,processed,total,
                   `Lendo IDs · lote de até 1.000 · ${processed.toLocaleString('pt-BR')} já confirmados no checkpoint`
                ],{tentativas:2});
            }
        }

        // Se o cursor expirou no meio do lote, recomeça a leitura. Os itens já
        // gravados são reconhecidos por ml_items e não serão baixados de novo.
        if(cursorExpirou)continue;

        if(!idsLidosSub.length && !idsNovos.length){
            if(terminou)break;
            continue;
        }

        let itens=[];
        let falhasSub=0;

        if(idsNovos.length){
            await dbQuery(`
              UPDATE ml_jobs SET message=$2,updated_at=NOW() WHERE id=$1
            `,[job.id,
               `Baixando ${idsNovos.length.toLocaleString('pt-BR')} anúncio(s) novo(s) · ${idsLidosSub.length.toLocaleString('pt-BR')} IDs verificados neste lote.`
            ]);

            const detalhes=await buscarItensBulkFreteRapido(
                token,
                idsNovos,
                {concurrency:CONCORRENCIA_BULK_SYNC}
            );

            itens=idsNovos.map(id=>detalhes.mapa[String(id)]).filter(Boolean);
            falhasSub=Math.max(0,idsNovos.length-itens.length);

            // Persiste imediatamente os detalhes retornados, antes do checkpoint.
            // O upsert preserva campos locais de frete/comissão já existentes.
            if(itens.length){
                await upsertItensDb(job.seller_id,itens,{somenteNovos:true});
                novosGravados+=itens.length;
            }
        }

        // Registra os IDs lidos somente depois de terminar a gravação do lote.
        // IDs sem detalhe continuam ausentes de ml_items e serão tentados de novo
        // na próxima sincronização, sem apagar nem substituir registros antigos.
        if(idsLidosSub.length){
            await dbQuery(`
              INSERT INTO ml_sync_seen(job_id,seller_id,item_id)
              SELECT $1,$2,x
              FROM unnest($3::text[]) AS x
              ON CONFLICT(job_id,item_id) DO NOTHING
            `,[job.id,job.seller_id,idsLidosSub]);
            seenCount+=idsLidosSub.length;
            existentesPreservados+=Math.max(0,idsLidosSub.length-idsNovos.length);
        }

        errors+=falhasSub;
        processed=Math.max(processed,seenCount);
        const totalExibido=total>0?total:processed;
        const pct=totalExibido?Math.min(100,Math.round(processed/totalExibido*100)):0;
        const existentesNoLote=Math.max(0,idsLidosSub.length-idsNovos.length);

        await dbQuery(`
          UPDATE ml_jobs SET
            status='running',
            processed=$2,
            progress_current=$2,
            progress_total=CASE WHEN $3>0 THEN $3 ELSE progress_total END,
            errors=$4,
            cursor=$5,
            message=$6,
            updated_at=NOW()
          WHERE id=$1
        `,[job.id,processed,total,errors,cursorSeguroSub,
           `Checkpoint salvo · lote de 1.000 · ${itens.length.toLocaleString('pt-BR')} novo(s) salvo(s) · ${existentesNoLote.toLocaleString('pt-BR')} já existente(s) preservado(s) · total verificado ${processed.toLocaleString('pt-BR')}/${totalExibido.toLocaleString('pt-BR')} (${pct}%)${falhasSub?` · ${falhasSub} detalhe(s) não retornado(s); serão tentados novamente na próxima execução`:''}`
        ]);

        console.log(
          '[SYNC V109 WORKER] job',job.id,
          '· checkpoint',processed,'/',totalExibido,
          '· novos',itens.length,
          '· existentes preservados',existentesNoLote,
          '· falhas detalhe',falhasSub
        );
      }

      // V109 NÃO remove anúncios antigos. A tabela ml_items é cumulativa:
      // somente anúncios novos são inseridos; o que já existe permanece salvo.
      await dbQuery(`DELETE FROM ml_sync_seen WHERE job_id=$1`,[job.id]);

      const finalTotal=total>0?total:processed;
      await dbQuery(`
        UPDATE ml_jobs SET
          status='completed',
          progress_current=$2,
          progress_total=$3,
          processed=$2,
          errors=$4,
          cursor=NULL,
          message=$5,
          finished_at=NOW(),
          updated_at=NOW()
        WHERE id=$1
      `,[job.id,processed,finalTotal,errors,
         `Concluído: ${processed.toLocaleString('pt-BR')} IDs verificados · ${novosGravados.toLocaleString('pt-BR')} anúncio(s) novo(s) salvo(s) nesta execução · anúncios existentes preservados · ${errors.toLocaleString('pt-BR')} detalhe(s) não retornado(s) e que poderão ser tentados novamente · ${existentesPreservados.toLocaleString('pt-BR')} existente(s) preservado(s) contabilizado(s) nesta execução. Nenhum anúncio existente foi apagado.`
      ]);
    }finally{
      pararHeartbeat();
    }
}

async function obterTokenPersistenteParaSeller(sellerId) {
    try{
        if(ML_HUB_SAAS_AUTH){
            return await tokenParaSellerV95(String(sellerId));
        }

        const store=lerOAuthStore();
        if(!store?.access_token)return null;
        const token=await renovarAccessTokenSeNecessario(false);
        const meRes=await mlFetch(`${ML_API}/users/me`,token);
        const me=await jsonSeguro(meRes);
        return String(me?.id)===String(sellerId)?token:null;
    }catch(e){
        return null;
    }
}

async function processarNotificacaoFila() {
    if(!db) return;
    const client=await dbConnectComRetryV104();
    let n=null;
    try {
        await client.query('BEGIN');
        const r=await client.query(`SELECT * FROM ml_notifications WHERE status='queued' AND available_at<=NOW() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
        if(!r.rows.length){await client.query('COMMIT');return}
        n=r.rows[0];
        await client.query(`UPDATE ml_notifications SET status='running',attempts=attempts+1 WHERE id=$1`,[n.id]);
        await client.query('COMMIT');
    } catch(e){await client.query('ROLLBACK');throw e} finally{client.release()}
    try {
        const token=await obterTokenPersistenteParaSeller(n.seller_id);
        if(!token) throw new Error('Token indispon\u00edvel.');
        const resource=String(n.resource||'');
        if(resource.startsWith('/items/')) {
            const r=await mlFetch(`${ML_API}${resource}`,token);
            const item=await jsonSeguro(r);
            if(r.ok && item?.id) await upsertItensDb(n.seller_id,[item]);
        }
        await dbQuery(`UPDATE ml_notifications SET status='completed',processed_at=NOW() WHERE id=$1`,[n.id]);
    } catch(e) {
        const delay=Math.min(3600,Math.pow(2,Math.min(8,Number(n.attempts||0)+1))*15);
        await dbQuery(`UPDATE ml_notifications SET status=CASE WHEN attempts>=8 THEN 'failed' ELSE 'queued' END,available_at=NOW()+($2||' seconds')::interval WHERE id=$1`,[n.id,String(delay)]);
    }
}


/* =========================================================
   V36 \u2014 ATUALIZA\u00c7\u00c3O DE PRE\u00c7OS EM JOB PERSISTENTE
   Escala para dezenas de milhares de an\u00fancios sem depender
   do navegador ficar aberto.
========================================================= */

async function gravarErrosPrecoV36(jobId,sellerId,erros){
    if(!erros.length)return;
    const rows=erros.map(e=>({
        item_id:String(e.id||''),
        requested_price:Number(e.requested_price||0),
        failure_type:String(e.tipo_falha||'erro'),
        message_pt:String(e.erro||'Falha sem detalhe.'),
        technical_message:String(e.erro_tecnico||''),
        http_status:e.http_status==null?null:Number(e.http_status),
        code:e.codigo==null?null:String(e.codigo),
        attempts:Number(e.tentativas||0)
    })).filter(x=>x.item_id);

    if(!rows.length)return;

    await dbQuery(`
      INSERT INTO ml_price_update_errors(
        job_id,seller_id,item_id,requested_price,failure_type,
        message_pt,technical_message,http_status,code,attempts,updated_at
      )
      SELECT
        $1::bigint,$2::bigint,x.item_id,x.requested_price,x.failure_type,
        x.message_pt,x.technical_message,x.http_status,x.code,x.attempts,NOW()
      FROM jsonb_to_recordset($3::jsonb) AS x(
        item_id text,
        requested_price numeric,
        failure_type text,
        message_pt text,
        technical_message text,
        http_status integer,
        code text,
        attempts integer
      )
      ON CONFLICT(job_id,item_id) DO UPDATE SET
        requested_price=EXCLUDED.requested_price,
        failure_type=EXCLUDED.failure_type,
        message_pt=EXCLUDED.message_pt,
        technical_message=EXCLUDED.technical_message,
        http_status=EXCLUDED.http_status,
        code=EXCLUDED.code,
        attempts=EXCLUDED.attempts,
        updated_at=NOW()
    `,[jobId,sellerId,JSON.stringify(rows)]);
}

async function processarAtualizacaoPrecosMassaV36(job){
    const token=await obterTokenPersistenteParaSeller(job.seller_id);
    if(!token)throw new Error('Token Mercado Livre indisponível para atualizar preços.');

    const itens=Array.isArray(job.payload?.items)?job.payload.items:[];
    const total=itens.length;
    let indice=Math.max(0,Number(job.cursor||0));
    let sucessos=Number(job.result?.success||0);
    let erros=Number(job.errors||0);
    let bloqueados=Number(job.result?.blocked||0);
    let temporarios=Number(job.result?.temporary||0);

    // V75 — pool de alta escala para 90 mil+ anúncios.
    const CHUNK=Math.max(250,Math.min(5000,Number(process.env.ML_PRICE_MASS_CHUNK||2000)));
    const CONCORRENCIA=Math.max(4,Math.min(50,Number(process.env.ML_PRICE_MASS_CONCURRENCY||30)));
    const PAUSA_GRUPO=Math.max(0,Math.min(500,Number(process.env.ML_PRICE_MASS_GROUP_DELAY_MS||0)));

    if(indice===0){
        await dbQuery(`DELETE FROM ml_price_update_errors WHERE job_id=$1`,[job.id]);
    }

    while(indice<total){
        const lote=itens.slice(indice,Math.min(total,indice+CHUNK));
        const ids=lote.map(x=>String(x.id));

        // Uma única leitura de metadata por lote.
        const meta=await dbQuery(`
          SELECT item_id,status,raw
          FROM ml_items
          WHERE seller_id=$1 AND item_id=ANY($2::text[])
        `,[job.seller_id,ids]);

        const metaMap=new Map(meta.rows.map(r=>[
            String(r.item_id),
            {
                status:String(r.status||''),
                dynamicPricing:Array.isArray(r?.raw?.tags)
                  ? r.raw.tags.includes('dynamic_standard_price')
                  : false,
                subStatus:Array.isArray(r?.raw?.sub_status)?r.raw.sub_status:[]
            }
        ]));

        const resultados=new Array(lote.length);
        let cursorLocal=0;

        async function workerPrecoV75(){
            while(true){
                const pos=cursorLocal++;
                if(pos>=lote.length)return;

                const item=lote[pos];
                const m=metaMap.get(String(item.id))||{};
                const st=String(m.status||'').toLowerCase();

                if(st && st!=='active'){
                    resultados[pos]={
                        id:item.id,
                        requested_price:Number(item.price||0),
                        sucesso:false,
                        bloqueado:true,
                        tipo_falha:'bloqueio',
                        http_status:400,
                        codigo:'item.price.not_modifiable',
                        tentativas:0,
                        erro:motivoBloqueioStatusV35(st),
                        erro_tecnico:`status:${st}`
                    };
                    continue;
                }

                if(m.dynamicPricing){
                    resultados[pos]={
                        id:item.id,
                        requested_price:Number(item.price||0),
                        sucesso:false,
                        bloqueado:true,
                        tipo_falha:'bloqueio',
                        http_status:400,
                        codigo:'item.price.not_modifiable',
                        tentativas:0,
                        erro:'Este anúncio está com Automatização de Preços configurada no Mercado Livre. Desative a automatização antes de alterar o preço manualmente pela API.',
                        erro_tecnico:'dynamic_standard_price'
                    };
                    continue;
                }

                resultados[pos]=await atualizarPrecoItemV35(item,token,m);
            }
        }

        // Todos os workers começam imediatamente. Não há mais atraso artificial de inicialização.
        await Promise.all(
            Array.from(
                {length:Math.min(CONCORRENCIA,lote.length)},
                ()=>workerPrecoV75()
            )
        );

        const ok=resultados.filter(r=>r?.sucesso);
        const falhas=resultados.filter(r=>r && !r.sucesso);

        // Banco atualizado em massa e em paralelo com a gravação das falhas.
        await Promise.all([
            ok.length
              ? atualizarPrecosDbLoteV26(
                    job.seller_id,
                    ok.map(r=>({id:r.id,price:r.price??r.requested_price}))
                )
              : Promise.resolve(),
            falhas.length
              ? gravarErrosPrecoV36(job.id,job.seller_id,falhas)
              : Promise.resolve()
        ]);

        sucessos+=ok.length;
        erros+=falhas.length;
        bloqueados+=falhas.filter(x=>x?.bloqueado||x?.tipo_falha==='bloqueio').length;
        temporarios+=falhas.filter(x=>x?.tipo_falha==='temporario').length;
        indice+=lote.length;

        const pct=total?Math.round((indice/total)*100):100;
        const result={
            success:sucessos,
            failed:erros,
            blocked:bloqueados,
            temporary:temporarios,
            concurrency:CONCORRENCIA,
            chunk:CHUNK,
            engine:'v75-fast-price-pool'
        };

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
            job.id,indice,total,erros,String(indice),JSON.stringify(result),
            `Atualização rápida: ${indice.toLocaleString('pt-BR')}/${total.toLocaleString('pt-BR')} · ${pct}% · ${sucessos.toLocaleString('pt-BR')} atualizado(s) · ${erros.toLocaleString('pt-BR')} não atualizado(s) · ${CONCORRENCIA} conexões paralelas`
        ]);

        if(PAUSA_GRUPO>0)await esperarV35(PAUSA_GRUPO);
    }

    await dbQuery(`
      UPDATE ml_jobs SET
        status='completed',
        processed=$2,
        progress_current=$2,
        progress_total=$3,
        errors=$4,
        cursor=NULL,
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
            blocked:bloqueados,
            temporary:temporarios,
            concurrency:CONCORRENCIA,
            chunk:CHUNK,
            engine:'v75-fast-price-pool'
        }),
        `Preços concluídos: ${sucessos.toLocaleString('pt-BR')} atualizado(s), ${erros.toLocaleString('pt-BR')} não atualizado(s).`
    ]);
}

/* =========================================================
   V36 \u2014 CRIA\u00c7\u00c3O DE AN\u00daNCIOS EM MASSA
========================================================= */

function limitarTituloV36(texto,limite=60){
    let t=String(texto||'').replace(/\s+/g,' ').trim();
    if(t.length<=limite)return t;
    t=t.slice(0,limite+1);
    const corte=t.lastIndexOf(' ');
    if(corte>=Math.floor(limite*0.72))t=t.slice(0,corte);
    return t.slice(0,limite).trim();
}

async function gerarImagemGeminiV36(prompt){
    const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
    if(!apiKey)throw new Error('Configure GEMINI_API_KEY no Render para gerar imagens.');

    const model=String(process.env.GEMINI_IMAGE_MODEL||'gemini-3.1-flash-lite-image').trim();
    const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const r=await fetch(url,{
        method:'POST',
        headers:{
            'Content-Type':'application/json',
            'x-goog-api-key':apiKey
        },
        body:JSON.stringify({
            contents:[{
                parts:[{
                    text:String(prompt||'')+
                      '\nGere uma imagem quadrada 1:1 de produto para marketplace, fundo branco puro, ilumina\u00e7\u00e3o de est\u00fadio, sem pessoas, sem marcas d\u2019\u00e1gua visuais, sem texto promocional, sem inventar acess\u00f3rios ou caracter\u00edsticas que n\u00e3o foram informadas.'
                }]
            }],
            generationConfig:{
                responseModalities:['IMAGE']
            }
        })
    });

    const d=await r.json().catch(()=>({}));
    if(!r.ok){
        const msg=String(d?.error?.message||d?.message||`Gemini HTTP ${r.status}`);
        if(r.status===429)throw new Error('O limite gratuito do Gemini para imagens foi atingido temporariamente. Aguarde e tente novamente.');
        throw new Error(msg);
    }

    const parts=d?.candidates?.[0]?.content?.parts||[];
    const imagePart=parts.find(p=>p?.inlineData?.data||p?.inline_data?.data);
    const inline=imagePart?.inlineData||imagePart?.inline_data;

    if(!inline?.data)throw new Error('O Gemini respondeu sem uma imagem utiliz\u00e1vel.');

    return {
        buffer:Buffer.from(inline.data,'base64'),
        mime:String(inline.mimeType||inline.mime_type||'image/png'),
        model
    };
}

async function enviarImagemMercadoLivreV36(token,img){
    const mod=await import('node-fetch');
    const form=new mod.FormData();
    const blob=new mod.Blob([img.buffer],{type:img.mime||'image/png'});
    form.append('file',blob,'ml-hub-pro-ai.png');

    const r=await mod.default(`${ML_API}/pictures/items/upload`,{
        method:'POST',
        headers:{Authorization:`Bearer ${token}`},
        body:form
    });
    const d=await r.json().catch(()=>({}));

    if(!r.ok || !d?.id){
        throw new Error(formatarErroMercadoLivre(d)||`Falha ao enviar imagem ao Mercado Livre (HTTP ${r.status}).`);
    }

    const melhor=(Array.isArray(d.variations)?d.variations:[])
      .sort((a,b)=>{
          const aa=String(a.size||'0x0').split('x').map(Number);
          const bb=String(b.size||'0x0').split('x').map(Number);
          return (bb[0]*bb[1])-(aa[0]*aa[1]);
      })[0];

    return {
        id:String(d.id),
        url:String(melhor?.secure_url||melhor?.url||''),
        model:img.model
    };
}



function parseDataUrlV37(dataUrl){
    const m=String(dataUrl||'').match(/^data:([^;]+);base64,(.+)$/);
    if(!m)return null;
    return {mime:m[1],data:m[2]};
}

function modelosGeminiVisionV38(){
    const configurados=[
        String(process.env.GEMINI_VISION_MODEL||'').trim(),
        String(process.env.GEMINI_MODEL||'').trim()
    ].filter(Boolean);
    return [...new Set([
        ...configurados,
        'gemini-3.8-flash',
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-3.5-flash',
        'gemini-3.5-flash-lite',
        'gemini-3.1-flash-lite'
    ])];
}

function modelosGeminiImagemV39(){
    const configurado=String(process.env.GEMINI_IMAGE_MODEL||'').trim();
    return [...new Set([
        configurado,
        'gemini-3.1-flash-image',
        'gemini-3.1-flash-lite-image',
        'gemini-2.5-flash-image'
    ].filter(Boolean))];
}

function erroModeloGeminiV38(msg){
    return /model|modelo|not found|not supported|unsupported|unknown|does not exist|no longer available|not available/i.test(String(msg||''));
}

function erroGeminiImagemAmigavelV38(status,msg){
    const texto=String(msg||'').trim();
    if(status===401||status===403)return 'A chave GEMINI_API_KEY n\u00e3o tem permiss\u00e3o para gerar imagens. Confira o projeto no Google AI Studio.';
    if(status===429)return 'O limite tempor\u00e1rio de gera\u00e7\u00e3o de imagens do Gemini foi atingido. O sistema tentou novamente automaticamente; clique de novo depois para continuar exatamente de onde parou.';
    if(status===503||status===504)return 'O Gemini est\u00e1 com alta demanda para imagens. O sistema tentou novamente automaticamente; voc\u00ea pode continuar a gera\u00e7\u00e3o depois.';
    if(erroModeloGeminiV38(texto))return 'O modelo de imagem configurado n\u00e3o est\u00e1 dispon\u00edvel. O sistema tentou os modelos atuais automaticamente.';
    return texto||`Gemini HTTP ${status}`;
}

function montarPartesGeminiV38(prompt,referenceImages=[]){
    const parts=[{text:String(prompt||'')}];
    for(const ref of (Array.isArray(referenceImages)?referenceImages:[]).slice(0,8)){
        const img=parseDataUrlV37(ref);
        if(img?.data){
            parts.push({inlineData:{mimeType:img.mime||'image/png',data:img.data}});
        }
    }
    return parts;
}

async function chamarGeminiJsonVisionV37(prompt,referenceImages=[]){
    const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
    if(!apiKey)throw new Error('Configure GEMINI_API_KEY no Render para usar a IA com imagem.');

    const modelos=modelosGeminiVisionV38();
    let ultimoErro=null;

    for(const model of modelos){
        for(let tentativa=1;tentativa<=3;tentativa++){
            try{
                const url=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
                const r=await fetch(url,{
                    method:'POST',
                    headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
                    body:JSON.stringify({
                        contents:[{parts:montarPartesGeminiV38(prompt,referenceImages)}],
                        generationConfig:{temperature:0.35,responseMimeType:'application/json'}
                    })
                });
                const d=await r.json().catch(()=>({}));
                if(r.ok){
                    const txt=(d?.candidates?.[0]?.content?.parts||[]).map(p=>p?.text||'').join('\n').trim();
                    if(!txt){ultimoErro=new Error('O Gemini respondeu sem conte\u00fado estruturado.');break;}
                    return extrairJsonIA(txt);
                }

                const bruto=String(d?.error?.message||d?.message||`Gemini HTTP ${r.status}`);
                ultimoErro=new Error(erroGeminiAmigavel(r.status,d));
                if((r.status===400||r.status===404)&&erroModeloGeminiV38(bruto))break;
                if(erroGeminiTransitorio(r.status)){
                    if(tentativa<3){
                        const retryAfter=Number(r.headers.get('retry-after')||0);
                        const espera=retryAfter>0?Math.min(10000,retryAfter*1000):(tentativa===1?1800:4200);
                        await esperarGemini(espera);
                        continue;
                    }
                    break;
                }
                break;
            }catch(e){
                ultimoErro=e;
                if(tentativa<3){await esperarGemini(tentativa===1?1500:3500);continue;}
            }
        }
    }
    throw ultimoErro||new Error('Falha ao analisar o produto com IA.');
}

function erroQuotaImagemSemFaturamentoV40(status,msg){
    if(Number(status)!==429)return false;
    const t=String(msg||'').toLowerCase();
    return /free[_ ]?tier|not available.*free|billing|billed|payment|quota[^\n]*limit[^\n]*0|limit[^\n]*0|quota[^\n]*0/.test(t);
}

function extrairImagemInteracaoGeminiV40(payload){
    const d=payload?.interaction||payload||{};
    if(d?.output_image?.data){
        return {data:d.output_image.data,mime:d.output_image.mime_type||d.output_image.mimeType||'image/png'};
    }
    for(const step of (Array.isArray(d?.steps)?d.steps:[])){
        if(step?.type!=='model_output')continue;
        for(const part of (Array.isArray(step?.content)?step.content:[])){
            if(part?.type==='image'&&part?.data){
                return {data:part.data,mime:part.mime_type||part.mimeType||'image/png'};
            }
        }
    }
    return null;
}

function montarInputInteracaoImagemV40(prompt,referenceImages=[]){
    const input=[{type:'text',text:String(prompt||'')}];
    for(const ref of (Array.isArray(referenceImages)?referenceImages:[]).slice(0,8)){
        const img=parseDataUrlV37(ref);
        if(img?.data){
            input.push({type:'image',mime_type:img.mime||'image/png',data:img.data});
        }
    }
    return input;
}

async function gerarImagemGeminiV37(prompt,referenceImages=[]){
    const apiKey=String(process.env.GEMINI_API_KEY||'').trim();
    if(!apiKey){
        const e=new Error('Configure GEMINI_API_KEY no Render para gerar imagens.');
        e.status=503; throw e;
    }

    const modelos=modelosGeminiImagemV39();
    let ultimoErro=null;
    const promptFinal=String(prompt||'').trim()+
      '\n\nRequisitos obrigat\u00f3rios: imagem quadrada 1:1, resolu\u00e7\u00e3o 1K (aprox. 1024x1024, adequada para uso em 1080x1080), alta nitidez, qualidade profissional de marketplace, sem marcas d\'\u00e1gua visuais adicionadas pelo layout, preservando fielmente o produto das fotos de refer\u00eancia.';

    for(const model of modelos){
        for(let tentativa=1;tentativa<=4;tentativa++){
            let r=null,d={};
            try{
                r=await fetch(GEMINI_INTERACTIONS_URL,{
                    method:'POST',
                    headers:{
                        'Content-Type':'application/json',
                        'x-goog-api-key':apiKey,
                        'Api-Revision':'2026-05-20'
                    },
                    body:JSON.stringify({
                        model,
                        input:montarInputInteracaoImagemV40(promptFinal,referenceImages),
                        store:false,
                        response_format:{
                            type:'image',
                            mime_type:'image/png',
                            aspect_ratio:'1:1',
                            image_size:'1K'
                        }
                    })
                });
                d=await r.json().catch(()=>({}));

                if(r.ok){
                    const out=extrairImagemInteracaoGeminiV40(d);
                    if(!out?.data){
                        ultimoErro=new Error('O Gemini respondeu sem uma imagem utiliz\u00e1vel.');
                        ultimoErro.status=502;
                        break;
                    }
                    return {
                        buffer:Buffer.from(out.data,'base64'),
                        mime:String(out.mime||'image/png'),
                        model
                    };
                }

                const bruto=String(d?.error?.message||d?.message||`Gemini HTTP ${r.status}`);
                const semFaturamento=erroQuotaImagemSemFaturamentoV40(r.status,bruto);
                const e=new Error(
                    semFaturamento
                      ? 'A cota de gera\u00e7\u00e3o de imagens do projeto Gemini n\u00e3o est\u00e1 dispon\u00edvel. A API de imagens do Gemini n\u00e3o possui n\u00edvel gratuito para esses modelos; habilite faturamento para gerar imagens com IA. O painel pode usar o modo visual gratuito com as fotos enviadas.'
                      : erroGeminiImagemAmigavelV38(r.status,bruto)
                );
                e.status=r.status;
                e.quotaUnavailable=semFaturamento;
                e.retryAfter=Number(r.headers.get('retry-after')||0);
                e.technical=bruto;
                ultimoErro=e;

                if(semFaturamento)throw e;
                if((r.status===400||r.status===404)&&erroModeloGeminiV38(bruto))break;
                if(erroGeminiTransitorio(r.status)){
                    if(tentativa<4){
                        const espera=e.retryAfter>0?Math.min(60000,e.retryAfter*1000):[8000,16000,30000][tentativa-1];
                        await esperarGemini(espera||30000);
                        continue;
                    }
                    break;
                }
                break;
            }catch(e){
                if(e?.quotaUnavailable)throw e;
                ultimoErro=e;
                if(tentativa<4){await esperarGemini([5000,12000,22000][tentativa-1]||25000);continue;}
            }
        }
    }
    throw ultimoErro||new Error('Falha ao gerar imagem com IA.');
}


/* =========================================================
   V44 \u2014 CLOUDFLARE WORKERS AI PARA GERA\u00c7\u00c3O DE IMAGENS
   - Provedor prim\u00e1rio de imagens: FLUX.2 klein 4B
   - At\u00e9 4 imagens de refer\u00eancia por chamada
   - Sa\u00edda 1024x1024
   - Retry autom\u00e1tico para indisponibilidade tempor\u00e1ria
========================================================= */

function configCloudflareImagemV44(){
    return {
        accountId:String(process.env.CLOUDFLARE_ACCOUNT_ID||'').trim(),
        token:String(process.env.CLOUDFLARE_AI_TOKEN||'').trim(),
        model:String(process.env.CLOUDFLARE_IMAGE_MODEL||'@cf/black-forest-labs/flux-2-klein-4b').trim()
    };
}

function cloudflareImagemConfiguradoV44(){
    const c=configCloudflareImagemV44();
    return Boolean(c.accountId && c.token && c.model);
}

function extrairErroCloudflareV44(payload,status){
    const erros=Array.isArray(payload?.errors)?payload.errors:[];
    const primeiro=erros[0]||{};
    const code=Number(primeiro?.code||payload?.code||0);
    const msg=String(
        primeiro?.message||
        payload?.error?.message||
        payload?.message||
        `Cloudflare Workers AI HTTP ${status}`
    ).trim();

    let amigavel=msg;
    let retryable=[408,429,500,502,503,504].includes(Number(status));
    let quotaUnavailable=false;

    if(Number(status)===401){
        amigavel='O token da Cloudflare foi recusado. Confira CLOUDFLARE_AI_TOKEN no Render.';
        retryable=false;
    }else if(Number(status)===403 && code===5035){
        amigavel='Este modelo da Cloudflare exige um plano pago para esta conta. Troque CLOUDFLARE_IMAGE_MODEL por um modelo permitido no plano atual.';
        retryable=false;
        quotaUnavailable=true;
    }else if(Number(status)===403){
        amigavel='A Cloudflare recusou a permiss\u00e3o. Confira se o token possui Workers AI Read e Workers AI Edit e se pertence ao mesmo Account ID configurado no Render.';
        retryable=false;
    }else if(Number(status)===404 || code===3042 || code===5007){
        amigavel='O modelo configurado na Cloudflare n\u00e3o foi encontrado. Confira CLOUDFLARE_IMAGE_MODEL no Render.';
        retryable=false;
    }else if(Number(status)===413 || code===3006){
        amigavel='As imagens de refer\u00eancia ficaram grandes demais para a Cloudflare. O painel reduz as refer\u00eancias automaticamente; tente novamente.';
        retryable=false;
    }else if(code===3036){
        amigavel='A cota gratuita di\u00e1ria do Workers AI foi utilizada. Ela volta a ficar dispon\u00edvel ap\u00f3s a renova\u00e7\u00e3o di\u00e1ria da Cloudflare.';
        retryable=false;
        quotaUnavailable=true;
    }else if(code===3040){
        amigavel='A Cloudflare est\u00e1 temporariamente sem capacidade para gerar a imagem. O sistema tentar\u00e1 novamente automaticamente.';
        retryable=true;
    }else if(Number(status)===429){
        amigavel='A Cloudflare limitou temporariamente as solicita\u00e7\u00f5es. O sistema tentar\u00e1 novamente automaticamente.';
        retryable=true;
    }

    const e=new Error(amigavel);
    e.status=Number(status)||500;
    e.code=code||0;
    e.retryable=retryable;
    e.quotaUnavailable=quotaUnavailable;
    e.technical=msg;
    return e;
}

function extrairImagemCloudflareV44(payload){
    const candidatos=[
        payload?.result?.image,
        payload?.image,
        payload?.result?.output?.image,
        payload?.result?.data?.image
    ];
    for(const x of candidatos){
        if(typeof x==='string' && x.trim())return x.trim();
    }
    return '';
}

async function gerarImagemCloudflareV44(prompt,referenceImages=[]){
    const cfg=configCloudflareImagemV44();
    if(!cfg.accountId || !cfg.token){
        const e=new Error('Configure CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_AI_TOKEN no Render para gerar imagens.');
        e.status=503;
        e.retryable=false;
        throw e;
    }

    const refs=(Array.isArray(referenceImages)?referenceImages:[])
        .map(parseDataUrlV37)
        .filter(Boolean)
        .slice(0,4);

    const mod=await import('node-fetch');
    const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cfg.accountId)}/ai/run/${cfg.model}`;
    const promptFinal=String(prompt||'').trim()+
      '\n\nUse as imagens de refer\u00eancia como fonte principal da apar\u00eancia do produto. Preserve formato, cor, acabamento, acess\u00f3rios realmente vis\u00edveis e identidade visual do item. N\u00e3o invente marca, modelo, acess\u00f3rios ou especifica\u00e7\u00f5es. Sa\u00edda quadrada profissional para marketplace.';

    let ultimoErro=null;

    for(let tentativa=1;tentativa<=5;tentativa++){
        try{
            const form=new mod.FormData();
            form.append('prompt',promptFinal);
            form.append('width','1080');
            form.append('height','1080');
            form.append('guidance','3.5');

            refs.forEach((img,i)=>{
                const blob=new mod.Blob(
                    [Buffer.from(img.data,'base64')],
                    {type:img.mime||'image/jpeg'}
                );
                const ext=/png/i.test(img.mime||'')?'png':'jpg';
                form.append(`input_image_${i}`,blob,`referencia-${i+1}.${ext}`);
            });

            const r=await mod.default(url,{
                method:'POST',
                headers:{Authorization:`Bearer ${cfg.token}`},
                body:form
            });

            const contentType=String(r.headers.get('content-type')||'').toLowerCase();

            if(r.ok && contentType.startsWith('image/')){
                const ab=await r.arrayBuffer();
                const buffer=Buffer.from(ab);
                if(!buffer.length)throw new Error('A Cloudflare respondeu com uma imagem vazia.');
                return {buffer,mime:contentType.split(';')[0]||'image/png',model:cfg.model,provider:'cloudflare'};
            }

            let d={};
            try{ d=await r.json(); }
            catch{
                const txt=await r.text().catch(()=> '');
                d={message:txt};
            }

            if(r.ok){
                const b64=extrairImagemCloudflareV44(d);
                if(!b64){
                    const e=new Error('A Cloudflare respondeu sem uma imagem utiliz\u00e1vel.');
                    e.status=502;
                    throw e;
                }
                return {
                    buffer:Buffer.from(b64,'base64'),
                    mime:'image/png',
                    model:cfg.model,
                    provider:'cloudflare'
                };
            }

            const e=extrairErroCloudflareV44(d,r.status);
            const retryAfter=Number(r.headers.get('retry-after')||0);
            e.retryAfter=retryAfter;
            ultimoErro=e;

            if(!e.retryable || tentativa>=5)throw e;

            const espera=retryAfter>0
                ? Math.min(30000,retryAfter*1000)
                : [2500,5000,8500,12000][tentativa-1]||15000;
            await esperarGemini(espera);
        }catch(e){
            ultimoErro=e;
            if(e?.quotaUnavailable || e?.retryable===false || tentativa>=5)throw e;
            if(tentativa<5){
                await esperarGemini([1800,3500,6500,10000][tentativa-1]||12000);
                continue;
            }
        }
    }

    throw ultimoErro||new Error('Falha ao gerar imagem com Cloudflare Workers AI.');
}

const CENAS_IMAGENS_V38=[
    {chave:'capa',titulo:'Capa premium',prompt:`Use a foto de refer\u00eancia para manter exatamente o mesmo produto. Gere uma imagem 1080x1080 para capa premium de an\u00fancio do Mercado Livre. Fundo branco puro obrigat\u00f3rio, produto fiel e centralizado, ilumina\u00e7\u00e3o de est\u00fadio, sombra suave, brilho/controlado, composi\u00e7\u00e3o mais elaborada e elegante, visual de alta convers\u00e3o, sem polui\u00e7\u00e3o, sem pessoas, sem marcas d'\u00e1gua e com o m\u00ednimo poss\u00edvel de texto.`},
    {chave:'angulo',titulo:'\u00c2ngulo complementar',prompt:`Use a foto de refer\u00eancia. Gere uma imagem 1080x1080 mostrando o mesmo produto em \u00e2ngulo complementar, com fundo branco limpo, ilumina\u00e7\u00e3o profissional e apar\u00eancia fiel ao item real.`},
    {chave:'detalhe',titulo:'Close de detalhe',prompt:`Use a foto de refer\u00eancia. Gere uma imagem 1080x1080 com close-up de detalhe do mesmo produto, destacando textura, material ou acabamento realmente vis\u00edvel, com fundo claro e composi\u00e7\u00e3o comercial.`},
    {chave:'uso1',titulo:'Aplica\u00e7\u00e3o 1',prompt:`Use a foto de refer\u00eancia e os detalhes fornecidos. Gere uma imagem 1080x1080 de aplica\u00e7\u00e3o do produto em uso real. A cena deve estar perfeita, sem m\u00e3os deformadas, sem dedos extras, sem erros anat\u00f4micos. Se houver risco de erro anat\u00f4mico, prefira mostrar apenas m\u00e3os corretas ou uma aplica\u00e7\u00e3o indireta do produto, sempre com resultado visual perfeito.`},
    {chave:'uso2',titulo:'Aplica\u00e7\u00e3o 2',prompt:`Use a foto de refer\u00eancia. Gere outra imagem 1080x1080 de uso do mesmo produto em ambiente real, mostrando benef\u00edcio pr\u00e1tico e contexto de utiliza\u00e7\u00e3o. A cena deve ser correta e natural; se a aplica\u00e7\u00e3o com pessoas n\u00e3o ficar perfeita, mostre o uso com enquadramento seguro e sem deforma\u00e7\u00f5es.`},
    {chave:'kit',titulo:'Conte\u00fado da embalagem',prompt:`Use a foto de refer\u00eancia. Gere uma imagem 1080x1080 estilo flat lay mostrando o produto e somente os itens inclusos que estejam vis\u00edveis ou claramente informados. Se os acess\u00f3rios n\u00e3o forem conhecidos, n\u00e3o invente itens.`},
    {chave:'ficha',titulo:'Ficha t\u00e9cnica',prompt:`Use a foto de refer\u00eancia. Gere uma arte 1080x1080 com o mesmo produto e uma ficha visual em portugu\u00eas, com textos curtos, t\u00e9cnicos e claros apenas sobre fatos confirmados pelo vendedor ou claramente vis\u00edveis. N\u00e3o invente medidas, materiais ou especifica\u00e7\u00f5es.`},
    {chave:'medidas',titulo:'Propor\u00e7\u00e3o / dimens\u00f5es',prompt:`Use a foto de refer\u00eancia. Gere uma imagem 1080x1080 que ajude a compreender propor\u00e7\u00e3o e escala. S\u00f3 use n\u00fameros de medidas se eles tiverem sido fornecidos; caso contr\u00e1rio, n\u00e3o invente dimens\u00f5es.`},
    {chave:'beneficios',titulo:'Benef\u00edcios',prompt:`Use a foto de refer\u00eancia. Gere uma arte 1080x1080 com o mesmo produto e de 3 a 5 benef\u00edcios em portugu\u00eas baseados apenas em caracter\u00edsticas reais ou informadas, com foco em clareza e convers\u00e3o.`},
    {chave:'seo',titulo:'Destaques de compra',prompt:`Use a foto de refer\u00eancia. Gere uma arte 1080x1080 com o produto em destaque e textos curtos em portugu\u00eas com termos de uso e diferenciais reais, em estilo marketplace limpo e voltado para convers\u00e3o. Evite excesso de texto.`},
    {chave:'lifestyle',titulo:'Lifestyle final',prompt:`Use a foto de refer\u00eancia. Gere uma imagem 1080x1080 lifestyle comercial mostrando o mesmo produto em ambiente bonito e realista, preservando fielmente formato, cor e caracter\u00edsticas visuais.`}
];

async function gerarPacote11ImagensV37({token,produto,detalhes,referenceImages=[]}){
    const pictures=[];
    for(let idx=0;idx<CENAS_IMAGENS_V38.length;idx++){
        const cena=CENAS_IMAGENS_V38[idx];
        const prompt=`Produto: ${produto||'Produto sem nome informado'}\nDetalhes informados: ${detalhes||'Nenhum detalhe adicional.'}\n${cena.prompt}`;
        const img=await gerarImagemGeminiV37(prompt,referenceImages);
        const pic=await enviarImagemMercadoLivreV36(token,img);
        pictures.push({index:idx,tipo:cena.chave,titulo:cena.titulo,id:pic.id,url:pic.url,model:img.model});
        if(idx<CENAS_IMAGENS_V38.length-1)await esperarGemini(900);
    }
    return pictures;
}

function normalizarCategoriasConfigV37(cfg){
    const lista=Array.isArray(cfg?.categories)?cfg.categories:[];
    const out=[];
    const seen=new Set();
    for(const c of lista){
        const id=String(c?.category_id||c?.id||'').trim();
        if(!id||seen.has(id))continue;
        seen.add(id);
        out.push({
            category_id:id,
            category_name:String(c?.category_name||c?.name||id),
            attributes:Array.isArray(c?.attributes)?c.attributes:[]
        });
    }
    if(!out.length && String(cfg?.category_id||'').trim()){
        out.push({category_id:String(cfg.category_id).trim(),category_name:String(cfg.category_name||cfg.category_id),attributes:Array.isArray(cfg?.attributes)?cfg.attributes:[]});
    }
    return out;
}


/* =========================================================
   V50 \u2014 MERCADO ENVIOS 2 FIXO + URL MANUAL DE IMAGENS
========================================================= */
const cacheShippingPublicacaoV47=new Map();

function normalizarUrlsManuaisV47(valor){
    const itens=[];
    const entrada=Array.isArray(valor)?valor.join('\n'):String(valor||'');
    const encontrados=entrada.match(/https?:\/\/[^\s,\]\)]+/gi)||[];
    const seen=new Set();
    for(const raw of encontrados){
        const url=String(raw||'').trim().replace(/[;]+$/,'');
        if(!url||seen.has(url))continue;
        try{
            const u=new URL(url);
            if(!['http:','https:'].includes(u.protocol))continue;
            seen.add(url);itens.push(url);
        }catch{}
    }
    return itens.slice(0,30);
}

async function obterPreferenciasEnvioPublicacaoV47(token,sellerId,categoryId,{force=false}={}){
    sellerId=String(sellerId||'').trim();
    categoryId=String(categoryId||'').trim();
    if(!sellerId||!categoryId)throw new Error('N\u00e3o foi poss\u00edvel identificar vendedor/categoria para configurar o Mercado Envios.');

    const key=`${sellerId}:${categoryId}:me2`;
    const ttl=10*60*1000;
    const cached=cacheShippingPublicacaoV47.get(key);
    if(!force && cached && (Date.now()-cached.at)<ttl)return cached.data;

    const [ur,cr]=await Promise.all([
        mlFetch(`${ML_API}/users/${encodeURIComponent(sellerId)}/shipping_preferences`,token),
        mlFetch(`${ML_API}/categories/${encodeURIComponent(categoryId)}/shipping_preferences`,token)
    ]);
    const [ud,cd]=await Promise.all([jsonSeguro(ur),jsonSeguro(cr)]);
    if(!ur.ok)throw new Error('N\u00e3o foi poss\u00edvel consultar as prefer\u00eancias de envio da conta: '+formatarErroMercadoLivre(ud));
    if(!cr.ok)throw new Error('N\u00e3o foi poss\u00edvel consultar os modos de envio da categoria: '+formatarErroMercadoLivre(cd));

    const userModes=[...new Set((Array.isArray(ud?.modes)?ud.modes:[]).map(x=>String(x||'').toLowerCase()).filter(Boolean))];
    const categoryModes=[...new Set((Array.isArray(cd?.logistics)?cd.logistics:[]).map(x=>String(x?.mode||'').toLowerCase()).filter(Boolean))];
    const me2User=userModes.includes('me2');
    const me2Category=categoryModes.includes('me2');

    // O painel publica EXCLUSIVAMENTE com Mercado Envios 2.
    // N\u00e3o existe mais fallback para ME1, not_specified ou custom.
    if(!me2User){
        const e=new Error('Sua conta n\u00e3o retornou Mercado Envios 2 (me2) como modo habilitado. Confirme o Mercado Envios na conta antes de publicar.');
        e.code='shipping.me2_not_enabled_for_user';
        throw e;
    }
    if(!me2Category){
        const e=new Error('A categoria escolhida n\u00e3o aceita Mercado Envios 2 (me2). Escolha uma categoria compat\u00edvel com Mercado Envios.');
        e.code='shipping.me2_not_enabled_for_category';
        throw e;
    }

    const shipping={
        mode:'me2',
        local_pick_up:false,
        free_shipping:false,
        free_methods:[]
    };
    const data={
        mode:'me2',
        candidates:['me2'],
        userModes,
        categoryModes,
        shipping,
        restricted:Boolean(cd?.restricted),
        logistics:Array.isArray(cd?.logistics)?cd.logistics:[],
        category_dimensions:cd?.dimensions||null,
        category_me2_restrictions:cd?.me2_restrictions||null,
        user_option:ud?.option??null,
        user_tags:Array.isArray(ud?.tags)?ud.tags:[],
        user_logistics:Array.isArray(ud?.logistics)?ud.logistics:[]
    };
    cacheShippingPublicacaoV47.set(key,{at:Date.now(),data});
    return data;
}

function contemErroModoEnvioV47(data){
    const txt=JSON.stringify(data||{}).toLowerCase();
    return txt.includes('shipping') || txt.includes('me1') || txt.includes('me2');
}



/* =========================================================
   V51 \u2014 CAMPOS COMERCIAIS + VALIDA\u00c7\u00c3O SEM BLOQUEAR WARNINGS
========================================================= */
function causasMercadoV51(data){
    return Array.isArray(data?.cause)?data.cause:[];
}
function causasBloqueantesMercadoV51(data){
    return causasMercadoV51(data).filter(c=>String(c?.type||'error').toLowerCase()!=='warning');
}
function somenteWarningsMercadoV51(data){
    const c=causasMercadoV51(data);
    return c.length>0 && causasBloqueantesMercadoV51(data).length===0;
}
function temCodigoCausaV51(data,code){
    const alvo=String(code||'').toLowerCase();
    return causasMercadoV51(data).some(c=>String(c?.code||'').toLowerCase()===alvo);
}
function ehAvisoEnvioAutocorrigivelV51(data){
    const permitidos=new Set([
        'shipping.lost_me1_by_user',
        'shipping.me2_adoption_mandatory',
        'item.shipping.mandatory_free_shipping'
    ]);
    const c=causasMercadoV51(data);
    return c.length>0 && c.every(x=>{
        const tipo=String(x?.type||'warning').toLowerCase();
        const code=String(x?.code||'').toLowerCase();
        return tipo==='warning' || permitidos.has(code);
    });
}
function montarSaleTermsV51(cfg={}){
    const tipo=String(cfg.warranty_type||'none').toLowerCase();
    const numero=Math.max(0,Number(cfg.warranty_time||0));
    const unidadeRaw=String(cfg.warranty_unit||'dias').toLowerCase();
    const unidade=['dias','meses','anos'].includes(unidadeRaw)?unidadeRaw:'dias';

    if(tipo==='none'){
        return [{id:'WARRANTY_TYPE',value_id:'6150835',value_name:'Sem garantia'}];
    }
    const idTipo=tipo==='factory'?'2230279':'2230280';
    const nomeTipo=tipo==='factory'?'Garantia de f\u00e1brica':'Garantia do vendedor';
    const termos=[{id:'WARRANTY_TYPE',value_id:idTipo,value_name:nomeTipo}];
    if(numero>0){
        const sing=numero===1?({dias:'dia',meses:'m\u00eas',anos:'ano'}[unidade]):unidade;
        termos.push({id:'WARRANTY_TIME',value_name:`${numero} ${sing}`});
    }
    return termos;
}
function aplicarCodigoUniversalV51(payload,cfg={},meta){
    if(!payload)return;
    const modo=String(cfg.universal_code_mode||'no_code').toLowerCase();
    const codigo=String(cfg.universal_code||'').replace(/\s+/g,'').trim();
    const attrs=Array.isArray(payload.attributes)
      ? payload.attributes.filter(a=>!['GTIN','EMPTY_GTIN_REASON'].includes(String(a?.id||'')))
      : [];
    const defMap=meta?.defMap;

    if(modo==='gtin'){
        if(codigo && defMap?.has?.('GTIN'))attrs.push({id:'GTIN',value_name:codigo});
    }else{
        const def=defMap?.get?.('EMPTY_GTIN_REASON');
        if(def){
            const vals=Array.isArray(def.values)?def.values:[];
            const norm=s=>normalizarTextoBuscaV46(s);
            const alvo=vals.find(v=>{
                const n=norm(v?.name||'');
                return n.includes('nao registrado') || n.includes('no registrado') || n.includes('sem codigo') || n.includes('nao cadastrado');
            }) || vals.find(v=>String(v?.id||'')==='17055160');
            if(alvo){
                attrs.push({
                    id:'EMPTY_GTIN_REASON',
                    value_id:String(alvo.id||''),
                    value_name:String(alvo.name||'N\u00e3o registrado')
                });
            }else{
                attrs.push({id:'EMPTY_GTIN_REASON',value_id:'17055160',value_name:'N\u00e3o registrado'});
            }
        }
    }
    payload.attributes=attrs;
}
function ajustarSaleTermsCategoriaV51(payload,cfg={},meta){
    if(!payload)return;
    const defs=Array.isArray(meta?.sale_terms)?meta.sale_terms:[];
    if(!defs.length)return;

    const map=new Map(defs.map(d=>[String(d?.id||''),d]));
    const tipo=String(cfg.warranty_type||'none').toLowerCase();
    const termos=[];

    const wt=map.get('WARRANTY_TYPE');
    if(wt){
        const wanted=tipo==='factory'?'2230279':tipo==='seller'?'2230280':'6150835';
        const vals=Array.isArray(wt.values)?wt.values:[];
        const match=vals.find(v=>String(v?.id||'')===wanted);
        if(match)termos.push({id:'WARRANTY_TYPE',value_id:String(match.id),value_name:String(match.name||'')});
        else if(tipo!=='none'){
            termos.push({id:'WARRANTY_TYPE',value_name:tipo==='factory'?'Garantia de f\u00e1brica':'Garantia do vendedor'});
        }else{
            termos.push({id:'WARRANTY_TYPE',value_name:'Sem garantia'});
        }
    }

    const tempo=Number(cfg.warranty_time||0);
    const wtime=map.get('WARRANTY_TIME');
    if(tipo!=='none' && wtime && tempo>0){
        const unidadeRaw=String(cfg.warranty_unit||'dias').toLowerCase();
        const unidade=['dias','meses','anos'].includes(unidadeRaw)?unidadeRaw:'dias';
        const sing=tempo===1?({dias:'dia',meses:'m\u00eas',anos:'ano'}[unidade]):unidade;
        termos.push({id:'WARRANTY_TIME',value_name:`${tempo} ${sing}`});
    }

    payload.sale_terms=termos;
}

function preferenciaFreteGratisV51(cfg={}){
    return String(cfg.shipping_cost_mode||'buyer').toLowerCase()==='free';
}

/* =========================================================
   V50 \u2014 MERCADO ENVIOS 2 FIXO + DIMENS\u00d5ES AUTOM\u00c1TICAS
   - nunca remove shipping.mode="me2"
   - completa atributos SELLER_PACKAGE_* quando a categoria fornece defaults
   - usa somente tentativas ME2, sem fallback silencioso para ME1
========================================================= */
function normalizarAvailableModesV50(data){
    const modes=data?.channels?.marketplace?.available_modes;
    return Array.isArray(modes)?modes:[];
}

function regraEnvioObrigatoriaV50(regra){
    return String(regra||'').toLowerCase()==='mandatory';
}

function completarDimensoesPacoteME2V50(payload,shippingPrefs,meta){
    if(!payload || !meta?.defMap)return [];
    const dims=shippingPrefs?.category_dimensions||{};
    const mapa=[
      ['SELLER_PACKAGE_HEIGHT',dims.height,'cm'],
      ['SELLER_PACKAGE_LENGTH',dims.length,'cm'],
      ['SELLER_PACKAGE_WIDTH',dims.width,'cm'],
      ['SELLER_PACKAGE_WEIGHT',dims.weight,'g']
    ];
    const attrs=Array.isArray(payload.attributes)?payload.attributes:[];
    const adicionados=[];
    for(const [id,raw,unit] of mapa){
        const def=meta.defMap.get(id);
        if(!def || def.read_only)continue;
        const existente=attrs.find(a=>String(a?.id||'')===id);
        if(existente){
            const clean=normalizarMedidaAtributoV60(existente,def);
            if(clean)Object.assign(existente,clean);
            continue;
        }
        // As dimens\u00f5es retornadas nas prefer\u00eancias s\u00e3o cm; o peso \u00e9 em g.
        // O POST /items exige a unidade no value_name, inclusive nos defaults.
        const clean=normalizarMedidaAtributoV60({id,value_name:String(raw??'')},def,unit);
        if(!clean)continue;
        attrs.push(clean); adicionados.push({...clean});
    }
    payload.attributes=attrs;
    return adicionados;
}

function normalizarMedidaAtributoV60(attr,def,unidadePreferida=''){
    const id=String(attr?.id||'');
    const pacote=/^SELLER_PACKAGE_(HEIGHT|LENGTH|WIDTH|WEIGHT)$/.test(id);
    const struct=attr?.value_struct;
    const raw=String(attr?.value_name??(struct?.number!=null?`${struct.number} ${struct.unit||''}`:'')).trim();
    const match=raw.replace(',','.').match(/^([+]?(?:\d+(?:\.\d+)?|\.\d+))\s*([^\d]*)$/);
    if(!match)return null;
    let numero=Number(match[1]);
    if(!Number.isFinite(numero) || (pacote && numero<=0))return null;
    let unit=String(match[2]||struct?.unit||'').trim();
    if(pacote){
        const peso=id==='SELLER_PACKAGE_WEIGHT';
        const destino=peso?'g':'cm';
        unit=unit.toLowerCase()||destino;
        const fatores=peso?{g:1,kg:1000,mg:0.001}:{cm:1,mm:0.1,m:100,in:2.54,pulgadas:2.54,ft:30.48};
        if(fatores[unit]==null)return null;
        // A API aceita apenas inteiros em cm/g. Arredonda para cima para n\u00e3o
        // declarar uma embalagem menor ou mais leve que a medida informada.
        numero=Math.ceil(Number((numero*fatores[unit]).toFixed(8)));
        unit=destino;
    }else{
        const units=Array.isArray(def?.allowed_units)?def.allowed_units:[];
        unit=unit||unidadePreferida||String(def?.default_unit||'');
        if(!unit)return null;
        const permitido=units.find(u=>String(u.id).toLowerCase()===unit.toLowerCase() || String(u.name).toLowerCase()===unit.toLowerCase());
        if(units.length&&!permitido)return null;
        if(permitido)unit=String(permitido.id);
    }
    return {id,value_name:`${numero} ${unit}`};
}

function aplicarEstrategiaEnvioV50(payload,shippingInfo,strategyName='me2_full'){
    const base={...payload};
    const free=Boolean(shippingInfo?.free_shipping);
    const local=Boolean(shippingInfo?.local_pick_up);
    if(strategyName==='me2_minimal'){
        base.shipping={mode:'me2',free_shipping:free};
    }else{
        base.shipping={mode:'me2',local_pick_up:local,free_shipping:free,free_methods:[]};
    }
    return base;
}

function ehErroEspecificoEnvioV50(data){
    const causas=Array.isArray(data?.cause)?data.cause:[];
    const codes=causas.map(c=>String(c?.code||'').toLowerCase());
    const txt=JSON.stringify(data||{}).toLowerCase();
    return codes.some(c=>c.startsWith('shipping.')) || /shipping|\bme1\b|\bme2\b|mercado envios/.test(txt);
}

function somenteErroLostMe1V50(data){
    const causas=Array.isArray(data?.cause)?data.cause:[];
    const codes=causas.map(c=>String(c?.code||'').toLowerCase()).filter(Boolean);
    const txt=JSON.stringify(data||{}).toLowerCase();
    if(codes.length)return codes.every(c=>c==='shipping.lost_me1_by_user');
    return txt.includes('shipping.lost_me1_by_user') || (txt.includes('lost_me1_by_user') && !txt.includes('me2_not'));
}

function podeIgnorarLostMe1NoValidadorV50(validacao,shippingInfo){
    const modo=String(validacao?.payload?.shipping?.mode||'').toLowerCase();
    const disponiveis=(shippingInfo?.available_modes||[]).map(x=>String(x).toLowerCase());
    return modo==='me2' && disponiveis.includes('me2') && somenteErroLostMe1V50(validacao?.data);
}

async function consultarShippingModesV50(token,sellerId,payload,meta){
    const attrs=(Array.isArray(payload?.attributes)?payload.attributes:[]).map(a=>{
        const def=meta?.defMap?.get?.(String(a.id||''));
        return {
          id:String(a.id||''),
          ...(def?.name?{name:String(def.name)}:{}),
          ...(a.value_id?{value_id:String(a.value_id)}:{}),
          ...(a.value_name?{value_name:String(a.value_name)}:{})
        };
    }).filter(a=>a.id);
    const body={
        site_id:'MLB',
        seller_id:Number(sellerId),
        title:String(payload?.family_name||payload?.title||'Produto').slice(0,60),
        item_price:Number(payload?.price||0),
        item_currency:String(payload?.currency_id||'BRL'),
        category_id:String(payload?.category_id||''),
        catalog:{
            domain_id:String(meta?.categoria?.domain_id||''),
            attributes:attrs
        },
        sale_terms:Array.isArray(payload?.sale_terms)?payload.sale_terms:[],
        listing_type_id:String(payload?.listing_type_id||'gold_special'),
        buying_mode:String(payload?.buying_mode||'buy_it_now'),
        condition:String(payload?.condition||'new'),
        channels:[{id:'marketplace'}],
        new_format:true,
        verbose:false
    };
    if(!body.catalog.domain_id)delete body.catalog.domain_id;
    const r=await mlFetch(`${ML_API}/users/${encodeURIComponent(sellerId)}/shipping_modes`,token,{
        method:'POST',
        headers:{'Content-Type':'application/json','x-multichannel':'true','X-Format-New':'true'},
        body:JSON.stringify(body)
    });
    const d=await jsonSeguro(r);
    return {ok:r.ok,status:r.status,data:d,body};
}

async function resolverEnvioMercadoV50(token,sellerId,categoryId,payload,meta,cfg={}){
    const base=await obterPreferenciasEnvioPublicacaoV47(token,sellerId,categoryId,{force:true});
    const dimensoes_auto=completarDimensoesPacoteME2V50(payload,base,meta);

    const shippingModes=await consultarShippingModesV50(token,sellerId,payload,meta);
    if(!shippingModes.ok){
        const e=new Error('N\u00e3o foi poss\u00edvel consultar os modos de Mercado Envios para esta publica\u00e7\u00e3o: '+formatarErroMercadoLivre(shippingModes.data));
        e.code='shipping.preflight_failed'; e.shipping_modes=shippingModes.data; throw e;
    }
    const me2Mode=normalizarAvailableModesV50(shippingModes.data)
      .find(m=>String(m?.mode||'').toLowerCase()==='me2')||null;
    if(!me2Mode){
        const e=new Error('O Mercado Livre n\u00e3o liberou Mercado Envios 2 para este produto com os dados atuais. Verifique os dados obrigat\u00f3rios da categoria.');
        e.code='shipping.me2_not_available_for_item'; e.shipping_modes=shippingModes.data; throw e;
    }

    const logistics=Array.isArray(me2Mode?.logistic_types)?me2Mode.logistic_types:[];
    const def=logistics.find(x=>x?.default===true)||logistics[0]||null;
    const modeAttrs=me2Mode?.shipping_attributes||{};
    const typeAttrs=def?.attributes||{};
    const freeRule=modeAttrs.free_shipping ?? typeAttrs.free_shipping;
    const localRule=modeAttrs.local_pick_up ?? typeAttrs.local_pick_up;

    const mandatoryFree=regraEnvioObrigatoriaV50(freeRule);
    const freeNotAllowed=String(freeRule||'').toLowerCase()==='not_allowed';
    const requestedFree=preferenciaFreteGratisV51(cfg);
    const freeShipping=mandatoryFree ? true : (freeNotAllowed ? false : requestedFree);
    const localPickUp=regraEnvioObrigatoriaV50(localRule);

    return {
        ...base,
        mode:'me2',
        free_shipping:freeShipping,
        free_shipping_required:mandatoryFree,
        free_shipping_rule:String(freeRule||'optional'),
        requested_free_shipping:requestedFree,
        local_pick_up:localPickUp,
        logistic_type:String(def?.type||''),
        shipping_modes_checked:true,
        shipping_modes_status:shippingModes.status,
        available_modes:normalizarAvailableModesV50(shippingModes.data).map(m=>String(m?.mode||'')),
        strategies:['me2_minimal','me2_full'],
        dimensoes_auto,
        shipping:{mode:'me2',local_pick_up:localPickUp,free_shipping:freeShipping,free_methods:[]}
    };
}
