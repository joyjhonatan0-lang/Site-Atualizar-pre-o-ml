'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PARTS_DIR = path.join(ROOT, 'src', 'parts');
const OUTPUT_DIR = path.join(ROOT, 'dist');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'server.generated.js');

// Ordem obrigatória: estes arquivos são fragmentos sequenciais do mesmo módulo.
// Não carregue cada parte com require(), pois elas compartilham funções e variáveis.
const PARTS = [
  '00-bootstrap-auth-oauth.js',
  '01-orders-claims-dashboard.js',
  '02-marketplace-ai-integrations.js',
  '03-postgres-scale-engine.js',
  '04-shipping-catalog-creation.js',
  '05-sync-prices-freight-jobs.js',
  '06-ad-management-status.js',
  '07-content-automation-final-routes.js'
];

function buildServer() {
  const chunks = PARTS.map((file) => {
    const fullPath = path.join(PARTS_DIR, file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Parte do servidor não encontrada: ${fullPath}`);
    }
    return fs.readFileSync(fullPath, 'utf8');
  });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, chunks.join(''), 'utf8');
  console.log(`[BUILD V107] servidor montado com ${PARTS.length} módulos.`);
  return OUTPUT_FILE;
}

module.exports = { buildServer };
