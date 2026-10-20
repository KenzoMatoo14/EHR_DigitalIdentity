var express = require('express');
var router = express.Router();
var controller = require('../controller/chainIdentityController');

// Solo lectura: GET /chainIdentity?curp=... o ?idInstitucional=... (datos para prellenar el registro)
router.get('/', controller.lookup);

module.exports = router;
