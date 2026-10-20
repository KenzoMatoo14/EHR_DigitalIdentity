var express = require('express');
var router = express.Router();
var controller = require('../controller/antecedentesController');

router.post('/', controller.saveAntecedentes);
router.get('/', controller.getAntecedentes);

module.exports = router;
