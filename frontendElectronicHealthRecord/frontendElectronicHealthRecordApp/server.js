'use strict';

/*
 * server.js — servidor del frontend ECE: estático + UN proxy real hacia el API Gateway.
 *
 * Igual que frontendBirthCertificate/server.js: el navegador nunca le habla al Gateway
 * directamente (evita CORS y no expone su URL/puerto); le pega a ESTE servidor, que reenvía
 * con axios. /api/fichaIdentificacion, /api/antecedentes, /api/notaSoap, /api/pacientes y /api/chainIdentity van -> Gateway ->
 * microservicio electronicHealthRecord -> MySQL (ver electronicHealthRecord/electronicHealthRecordApp).
 * El resto (agenda, citas, consulta del médico) sigue simulado en el navegador
 * (public/js/core/api.js) hasta que también tenga su propio backend.
 *
 * Conceptos de Express que se usan (repaso):
 *  - app.use(express.static(dir)): middleware que sirve archivos de `dir` tal cual.
 *  - app.get(ruta, handler): responde solo a GET en esa ruta.
 *  - Los middlewares se ejecutan EN ORDEN de registro: primero los estáticos,
 *    luego las rutas de páginas y al final el 404 y el manejador de errores.
 */

const path = require('path');
const express = require('express');
const axios = require('axios');

// URL del API Gateway (apigateway/apigatewayApp, gateway.config.yml -> http.port: 5500).
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:5500';

// El puerto sale del entorno; 5514 es el siguiente libre después de 5510-5513 (los otros frontends).
const PORT = Number(process.env.PORT) || 5514;

const PUBLIC_DIR = path.join(__dirname, 'public');
const PAGES_DIR = path.join(__dirname, 'app', 'pages');

// Tabla ruta limpia -> archivo HTML. Un solo lugar para ver todas las pantallas.
// "Registrar Paciente" y "Pacientes" NO son páginas: en el Figma son modales sobre la agenda
// (se abren con ?registrar=1 / ?pacientes=1). La consulta médica vive dentro del expediente
// (pestaña "Consultas"), no en una página propia.
const PAGE_ROUTES = {
  '/': 'login/login.html',
  '/login': 'login/login.html',
  '/recepcion': 'recepcion/agenda.html',
  '/medico': 'medico/agenda.html',
  '/expediente': 'expediente/expediente.html',
};

// Rutas de la versión anterior: se conservan como redirecciones para no romper enlaces guardados.
const REDIRECTS = {
  '/recepcion/registro': '/recepcion?registrar=1',
  '/medico/consulta': '/medico',
  '/recepcion/triage': '/recepcion', // el triage quedó fuera por ahora
};

const app = express();
app.disable('x-powered-by'); // no anunciar "Express" en cada respuesta

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

for (const [route, file] of Object.entries(PAGE_ROUTES)) {
  app.get(route, (req, res) => {
    res.sendFile(path.join(PAGES_DIR, file));
  });
}

for (const [from, to] of Object.entries(REDIRECTS)) {
  app.get(from, (req, res) => res.redirect(301, to));
}

/**
 * Crea un handler que reenvía la petición al Gateway y devuelve su respuesta TAL CUAL (mismo status
 * y mismo body). Así un 400/404 del microservicio llega al navegador con su `Description`, y solo
 * si el Gateway no responde se contesta 502 (Bad Gateway).
 * GET reenvía el query string (?curp=, ?q=); POST reenvía el body JSON completo.
 */
function proxyToGateway(method, path) {
  return async (req, res) => {
    try {
      const response = method === 'get'
        ? await axios.get(`${GATEWAY_URL}${path}`, { params: req.query })
        : await axios.post(`${GATEWAY_URL}${path}`, req.body);
      res.status(response.status).json(response.data);
    } catch (error) {
      if (error.response) {
        res.status(error.response.status).json(error.response.data);
      } else {
        console.error('Error contactando el API Gateway:', error.message);
        res.status(502).json({ Result: 'Error', Description: 'No se pudo contactar al API Gateway.' });
      }
    }
  };
}

// Paciente + Ficha de identificación (POST registra o actualiza; GET ?curp=)
app.post('/api/fichaIdentificacion', proxyToGateway('post', '/fichaIdentificacion'));
app.get('/api/fichaIdentificacion', proxyToGateway('get', '/fichaIdentificacion'));
// Antecedentes del paciente (POST crea o reemplaza; GET ?curp=)
app.post('/api/antecedentes', proxyToGateway('post', '/antecedentes'));
app.get('/api/antecedentes', proxyToGateway('get', '/antecedentes'));
// Notas SOAP de enfermería (POST agrega; GET ?curp= lista). No hay PUT ni DELETE: no se editan.
app.post('/api/notaSoap', proxyToGateway('post', '/notaSoap'));
app.get('/api/notaSoap', proxyToGateway('get', '/notaSoap'));
// Búsqueda de pacientes registrados en MySQL (GET ?q= nombre, CURP o folio)
app.get('/api/pacientes', proxyToGateway('get', '/pacientes'));
// Datos de una persona en ChainIDentity (acta de nacimiento) para prellenar el registro
// (GET ?curp= o ?idInstitucional=; solo lectura, no guarda nada)
app.get('/api/chainIdentity', proxyToGateway('get', '/chainIdentity'));

// 404: se llega aquí solo si ninguna ruta anterior respondió.
app.use((req, res) => {
  res.status(404).type('text/plain').send('404 - Página no encontrada');
});

// Manejador de errores: Express lo reconoce por tener 4 parámetros.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Error no controlado:', err);
  res.status(500).type('text/plain').send('500 - Error interno del servidor');
});

app.listen(PORT, () => {
  console.log(`ECE frontend escuchando en http://localhost:${PORT}`);
});
