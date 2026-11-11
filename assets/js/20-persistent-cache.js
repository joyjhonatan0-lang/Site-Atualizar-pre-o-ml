
/* =========================================================
   V90 — PROTEÇÃO CONTRA REGRESSÃO DO CACHE
   A fonte da Gestão agora é o IndexedDB persistente.
   Rotinas antigas do PostgreSQL não podem mais reduzir a base.
========================================================= */

document.addEventListener('DOMContentLoaded',()=>{
  setTimeout(async()=>{
    try{
      await migrarCacheAtualParaPersistenteV90();

      // O delta legado era a causa de 32 mil voltarem para ~22 mil:
      // ao comparar com uma base PostgreSQL antiga, ele limpava o IndexedDB.
      sincronizarMudancasV32=async()=>({
        alterados:0,
        total:masterAnunciosV32.length,
        cache:true,
        fonte:'indexeddb_persistente_v90'
      });

      agendarSyncBackgroundV42=()=>{};

      cacheCompletoV43=async()=>{
        masterCarregadoV32=false;
        await carregarMasterLocalV32();
        return masterAnunciosV32.length>0;
      };

      reconstruirCacheCompletoV43=async()=>{
        masterCarregadoV32=false;
        await carregarMasterLocalV32();
        return {
          total:masterAnunciosV32.length,
          total_conta:masterAnunciosV32.length,
          fonte:'indexeddb_persistente_v90'
        };
      };

      // Recarrega a Gestão da união persistente imediatamente.
      masterCarregadoV32=false;
      if(typeof v88CarregarGestaoLocal==='function'){
        await v88CarregarGestaoLocal(1,{silencioso:true});
      }
    }catch(e){
      console.warn('[V90 PERSISTÊNCIA]',e);
    }
  },300);
});
