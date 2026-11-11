
function rotuloSituacaoV64(valor,contexto='anuncio'){
    const code=String(valor??'').trim().toLowerCase();
    const comuns={active:'Ativo',paused:'Pausado',inactive:'Inativo',closed:'Finalizado',under_review:'Em revis\u00e3o',
        pending:'Pendente',queued:'Na fila',running:'Em execu\u00e7\u00e3o',processing:'Processando',completed:'Conclu\u00eddo',
        finished:'Conclu\u00eddo',failed:'Falhou',error:'Erro',cancelled:'Cancelado',canceled:'Cancelado',
        opened:'Aberto',open:'Aberto',resolved:'Resolvido',on_hold:'Suspenso',expired:'Expirado'};
    const grupos={
        pedido:{paid:'Pago',confirmed:'Confirmado',payment_required:'Aguardando pagamento',payment_in_process:'Pagamento em processamento',
            partially_paid:'Parcialmente pago',partially_refunded:'Parcialmente reembolsado',refunded:'Reembolsado',closed:'Finalizado'},
        envio:{pending:'Pendente',handling:'Em prepara\u00e7\u00e3o',ready_to_ship:'Pronto para envio',shipped:'Enviado',delivered:'Entregue',
            not_delivered:'N\u00e3o entregue',to_be_agreed:'A combinar',not_verified:'Aguardando verifica\u00e7\u00e3o',label_printed:'Etiqueta impressa'},
        reclamacao:{claim:'Reclama\u00e7\u00e3o',dispute:'Em media\u00e7\u00e3o',mediation:'Em media\u00e7\u00e3o',recontact:'Recontato',opened:'Aberta',
            open:'Aberta',closed:'Finalizada',resolved:'Resolvida',cancelled:'Cancelada',canceled:'Cancelada',return:'Devolu\u00e7\u00e3o',complaint:'Reclama\u00e7\u00e3o'},
        competicao:{winning:'Em vantagem',competing:'Disputando',sharing_first_place:'Primeiro lugar compartilhado',
            not_listed:'Fora do cat\u00e1logo',not_competing:'Sem disputar',listed:'No cat\u00e1logo',winner:'Vencedor'}
    };
    return grupos[contexto]?.[code]||comuns[code]||(!code||code==='\u2014'?'N\u00e3o informado':'Situa\u00e7\u00e3o a confirmar');
}

function nomeProvedorPtV64(valor){
    return String(valor||'').replace(/Cloudflare Workers AI/g,'IA da Cloudflare');
}

        tailwind.config = {
            theme: {
                extend: {
                    colors: {
                        brand: {
                            400: '#facc15',
                            500: '#eab308',
                            600: '#ca8a04'
                        }
                    },
                    boxShadow: {
                        soft:
                            '0 10px 40px rgba(0,0,0,.20)',
                        card:
                            '0 8px 30px rgba(15,23,42,.08)'
                    }
                }
            }
        };
    
