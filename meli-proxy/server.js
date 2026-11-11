'use strict';

// O Render continua iniciando com: node server.js
// O servidor final é montado a partir dos módulos em src/parts/.
const { buildServer } = require('./build-server');
const generatedServer = buildServer();
require(generatedServer);
