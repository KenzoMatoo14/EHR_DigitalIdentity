var express = require('express');
var router = express.Router();
var controller = require('../controller/fichaIdentificacionController');

router.post('/', controller.saveFicha);
router.get('/', controller.getFicha);

module.exports = router;
