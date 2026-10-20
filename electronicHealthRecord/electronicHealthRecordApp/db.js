// db.js — pool de MySQL, igual que en los frontends (frontendBirthCertificateApp/db.js).
// Este microservicio es la única pieza que guarda datos de EHR en una base convencional
// (no Ganache); llega a él a través del API Gateway, como los demás microservicios.
require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // Las columnas DATE se devuelven como texto 'aaaa-mm-dd'. Sin esto mysql2 las convierte a un
  // Date de JS en la zona horaria local, y al pasarlas a JSON pueden correrse un día.
  dateStrings: ['DATE'],
  // MySQL guarda los TIMESTAMP en UTC; sin esto mysql2 los lee como hora local y los corre 6 h.
  timezone: 'Z',
});

module.exports = pool;
