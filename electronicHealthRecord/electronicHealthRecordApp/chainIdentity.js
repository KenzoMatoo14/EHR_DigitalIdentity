// chainIdentity.js — cliente de SOLO LECTURA hacia el proyecto ChainIDentity.
//
// De dónde sale cada dato (ChainIDentity no guarda la CURP en ningún lado):
//
//   MySQL de ChainIDentity (tokphy-mysql, el de los frontends)       Blockchain (Ganache), vía API Gateway
//   ─────────────────────────────────────────────────────────       ─────────────────────────────────────
//   BirthCertificates(certificate_string, StudentID)                 BirthCertificate.sol en certificate_string:
//     · lista de TODAS las actas (direcciones de contrato)             /consult        name, fLastName, mLastName,
//     · StudentID = ID institucional (lo llena                                          gender, government (públicos)
//       frontendScholarCurriculum al crear el currículum)             /consultPrivates día, mes, año, estado,
//   users(email, BirthCertificate)                                                     municipio (from = government)
//     · correo de la persona dueña del acta
//
// La blockchain no permite "buscar el acta del ID 0263328": solo se consulta un contrato si ya se
// conoce su dirección. Por eso el índice (ID -> dirección) se lee del MySQL de ChainIDentity, igual
// que lo hace frontendScholarCurriculum (/api/searchStudent).
//
// Las lecturas a la cadena pasan por el API Gateway, como en el resto del proyecto: el EHR no habla
// con Ganache ni con web3 directamente.
require('dotenv').config();
const mysql = require('mysql2/promise');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:5500';
const GATEWAY_TIMEOUT_MS = Number(process.env.CHAIN_TIMEOUT_MS) || 8000;

// ChainIDentity no está disponible (MySQL o Gateway apagados, mal configurados). Se responde 503
// para distinguirlo de "no existe" (404) y de un dato mal capturado (400).
class ChainIdentityUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ChainIdentityUnavailableError';
  }
}

// ---------------------------------------------------------------------------
// MySQL de ChainIDentity (otro servidor que el MySQL del EHR)
// ---------------------------------------------------------------------------

// El pool se crea la primera vez que se usa: si CHAIN_DB_HOST no está en el .env, el EHR arranca
// igual (registro "a mano" sigue funcionando) y solo falla la búsqueda en ChainIDentity.
let chainPool = null;

function getChainPool() {
  if (!process.env.CHAIN_DB_HOST) {
    throw new ChainIdentityUnavailableError('ChainIDentity no está configurado (falta CHAIN_DB_HOST en el .env del EHR).');
  }
  if (!chainPool) {
    chainPool = mysql.createPool({
      host: process.env.CHAIN_DB_HOST,
      port: Number(process.env.CHAIN_DB_PORT) || 3306,
      user: process.env.CHAIN_DB_USER,
      password: process.env.CHAIN_DB_PASSWORD,
      database: process.env.CHAIN_DB_NAME,
      connectionLimit: 4,
    });
  }
  return chainPool;
}

// Errores de MySQL que significan "la tabla/columna todavía no existe": los frontends de ChainIDentity
// crean `BirthCertificates`, `StudentID` y `users.BirthCertificate` hasta que alguien los usa.
const MISSING_SCHEMA = new Set(['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR']);

async function chainQuery(sql, params) {
  try {
    const [rows] = await getChainPool().query(sql, params);
    return rows;
  } catch (error) {
    if (MISSING_SCHEMA.has(error.code)) return [];
    if (error instanceof ChainIdentityUnavailableError) throw error;
    console.error('MySQL de ChainIDentity:', error.message);
    throw new ChainIdentityUnavailableError('No se pudo consultar la base de datos de ChainIDentity.');
  }
}

/** Todas las actas registradas: [{ address, studentId }]. */
async function listActas() {
  let rows = await chainQuery('SELECT certificate_string, StudentID FROM BirthCertificates');
  // Si la tabla la creó frontendBirthCertificate, no tiene la columna StudentID (nadie ha creado currículum).
  if (rows.length === 0) rows = await chainQuery('SELECT certificate_string FROM BirthCertificates');
  return rows.map((row) => ({ address: row.certificate_string, studentId: row.StudentID || null }));
}

/**
 * Actas cuyo StudentID es `idInstitucional`. Se compara también sin ceros a la izquierda: el
 * contrato de currículum guarda `studentId` como uint (0263328 -> 263328) y el MySQL como texto.
 */
async function findActasByStudentId(idInstitucional) {
  const rows = await chainQuery(
    `SELECT certificate_string, StudentID FROM BirthCertificates
     WHERE StudentID = ? OR TRIM(LEADING '0' FROM StudentID) = TRIM(LEADING '0' FROM ?)`,
    [idInstitucional, idInstitucional]
  );
  return rows.map((row) => ({ address: row.certificate_string, studentId: row.StudentID }));
}

/** Correo del usuario de ChainIDentity dueño del acta, o null. */
async function findCorreoByActa(address) {
  const rows = await chainQuery('SELECT email FROM users WHERE BirthCertificate = ? LIMIT 1', [address]);
  return rows.length > 0 ? rows[0].email : null;
}

// ---------------------------------------------------------------------------
// Blockchain vía API Gateway (microservicio birthCertificate)
// ---------------------------------------------------------------------------

/** GET al Gateway. Los microservicios de ChainIDentity responden 200 con { Result: 'Error' } al fallar. */
async function gatewayGet(path, params) {
  const url = `${GATEWAY_URL}${path}?${new URLSearchParams(params)}`;
  let response;
  try {
    // fetch viene incluido en Node 18+; AbortSignal.timeout corta la espera si el Gateway no contesta.
    response = await fetch(url, { signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS) });
  } catch (error) {
    throw new ChainIdentityUnavailableError(`No se pudo contactar al API Gateway (${GATEWAY_URL}).`);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.Result !== 'Success') {
    const detail = data && data.Description ? data.Description : `HTTP ${response.status}`;
    throw new Error(`${path}: ${detail}`);
  }
  return data;
}

/** Atributo público del acta (/consult?publicMethod=name). */
async function readPublic(address, publicMethod) {
  const data = await gatewayGet('/consult', { contractAdd: address, publicMethod });
  return data.Value;
}

// Los datos de un acta no cambian después de crearla (el constructor de BirthCertificate.sol es el
// único que los asigna), así que se guardan en memoria: buscar por CURP recorre TODAS las actas y
// sin esto cada búsqueda repetiría cientos de llamadas a la cadena.
const actaCache = new Map();

/**
 * Lee un acta de la cadena.
 * Los datos privados (fecha, estado, municipio) solo los puede leer el dueño o una cuenta de gobierno
 * (modifier ownerOrGovernment); se usa el `government` que creó el acta, que es atributo público.
 * @returns {Promise<{address, nombre, apellidoP, apellidoM, hombre, dia, mes, anio, estado, municipio}>}
 */
async function readActa(address) {
  const key = String(address).toLowerCase();
  if (actaCache.has(key)) return actaCache.get(key);

  const [nombre, apellidoP, apellidoM, hombre, government] = await Promise.all(
    ['name', 'fLastName', 'mLastName', 'gender', 'government'].map((method) => readPublic(address, method))
  );
  const privates = await gatewayGet('/consultPrivates', { contractAdd: address, from: government });

  const acta = {
    address,
    nombre,
    apellidoP,
    apellidoM,
    hombre: hombre === true || hombre === 'true', // en el contrato: true = hombre, false = mujer
    dia: Number(privates.Data.Day),
    mes: Number(privates.Data.Month),
    anio: Number(privates.Data.Year),
    estado: privates.Data.State,
    municipio: privates.Data.Municipality,
  };
  actaCache.set(key, acta);
  return acta;
}

module.exports = {
  ChainIdentityUnavailableError,
  listActas,
  findActasByStudentId,
  findCorreoByActa,
  readActa,
};
