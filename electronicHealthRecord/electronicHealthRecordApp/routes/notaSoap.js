var express = require('express');
var router = express.Router();
var controller = require('../controller/notaSoapController');

// Sin PUT ni DELETE: una nota clínica no se modifica ni se borra.
router.post('/', controller.createNota);
router.get('/', controller.getNotas);

module.exports = router;
