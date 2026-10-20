var express = require('express');
var router = express.Router();
var controller = require('../controller/fichaIdentificacionController');

// Búsqueda de pacientes (solo lectura): GET /pacientes?q=texto
router.get('/', controller.searchPacientes);

module.exports = router;
