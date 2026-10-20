// chainIdentityController.js — busca a una persona en ChainIDentity y devuelve sus datos con la
// forma de la Ficha de identificación del EHR, para PRELLENAR el registro del paciente.
//
//   GET /chainIdentity?idInstitucional=0263328   índice StudentID -> acta (MySQL de ChainIDentity)
//   GET /chainIdentity?curp=MALK050614HJCTPN09    recorre las actas y compara los 16 primeros
//                                                 caracteres de la CURP calculada con los del acta
//
// No guarda nada: solo lee. El registro sigue siendo el POST /fichaIdentificacion de siempre, así la
// enfermera revisa lo que llegó antes de guardarlo. La CURP NUNCA viene de ChainIDentity (no la
// tiene): en la búsqueda por ID se captura a mano; `curp16` sirve para revisar que corresponda.
const { ValidationError, requiredCurp, optionalFolio, sendError } = require('./validation');
const { curpPrefix, curpMatches } = require('./curp');
const { findEntidad } = require('./entidades');
const chain = require('../chainIdentity');

// Ids del catálogo `sexo` del frontend (catalogs.js): 1 = Hombre, 2 = Mujer.
const SEXO_ID = { H: 1, M: 2 };
// Cuántas actas se leen a la vez al buscar por CURP (cada una son 6 llamadas al Gateway).
const SCAN_CONCURRENCY = 5;

const pad2 = (number) => String(number).padStart(2, '0');

/**
 * Acta de la cadena -> candidato para el registro.
 * `datos` usa los nombres y catálogos de la ficha (POST /fichaIdentificacion), así el frontend lo
 * puede mandar tal cual. Lo que no se pudo convertir se explica en `avisos`.
 */
function toCandidate(acta, { idInstitucional, correo }) {
  const avisos = [];
  const sexo = acta.hombre ? 'H' : 'M';
  const entidad = findEntidad(acta.estado);
  if (!entidad) {
    avisos.push(`El estado del acta ("${acta.estado}") no se reconoció: captura la entidad de nacimiento a mano.`);
  }

  const datos = {
    nombre: acta.nombre,
    apellidoP: acta.apellidoP,
    apellidoM: acta.apellidoM,
    fechaNacimiento: `${acta.anio}${pad2(acta.mes)}${pad2(acta.dia)}`, // aaaammdd, como en la ficha
    sexo: SEXO_ID[sexo],
  };
  if (entidad) datos.entidadNacimiento = entidad.id;
  if (idInstitucional) datos.folio = idInstitucional;

  return {
    contractAddress: acta.address,
    datos,
    correo: correo || null,             // no es del Excel: el frontend lo guarda solo en el navegador
    estadoActa: acta.estado,            // texto original, para mostrarlo si no se reconoció
    municipioNacimiento: acta.municipio, // el Excel no lo pide (solo municipio de RESIDENCIA)
    // Con el estado sin reconocer, las posiciones 12-13 vienen como "**" (comodín).
    curp16: curpPrefix({ ...acta, sexo, entidadCurp: entidad ? entidad.curp : undefined }),
    avisos,
  };
}

/** Ejecuta `task` sobre cada elemento con como máximo `limit` a la vez. */
async function mapLimited(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Lee un acta; si ESA acta falla (contrato borrado tras reiniciar Ganache, dirección vieja en el MySQL)
 * devuelve null para no tirar toda la búsqueda. Si lo que falla es el Gateway entero, sí se propaga.
 */
async function readActaOrNull(address) {
  try {
    return await chain.readActa(address);
  } catch (error) {
    if (error instanceof chain.ChainIdentityUnavailableError) throw error;
    console.warn(`Acta ${address} omitida: ${error.message}`);
    return null;
  }
}

async function byIdInstitucional(idInstitucional) {
  const rows = await chain.findActasByStudentId(idInstitucional);
  const candidates = [];
  for (const row of rows) {
    const acta = await readActaOrNull(row.address);
    if (!acta) continue;
    const correo = await chain.findCorreoByActa(row.address);
    // Se devuelve el ID tal como lo escribió la enfermera (con sus ceros a la izquierda).
    candidates.push(toCandidate(acta, { idInstitucional, correo }));
  }
  return { candidates, revisadas: rows.length };
}

async function byCurp(curp) {
  const actas = await chain.listActas();
  const read = await mapLimited(actas, SCAN_CONCURRENCY, (row) => readActaOrNull(row.address));
  const candidates = [];
  for (let i = 0; i < actas.length; i++) {
    if (!read[i]) continue;
    const candidate = toCandidate(read[i], { idInstitucional: actas[i].studentId });
    if (!curpMatches(candidate.curp16, curp)) continue;
    candidate.correo = await chain.findCorreoByActa(actas[i].address);
    candidates.push(candidate);
  }
  return { candidates, revisadas: actas.length };
}

// GET /chainIdentity?curp= | ?idInstitucional=
async function lookup(req, res) {
  try {
    const hasCurp = typeof req.query.curp === 'string' && req.query.curp.trim() !== '';
    const hasId = typeof req.query.idInstitucional === 'string' && req.query.idInstitucional.trim() !== '';
    if (hasCurp === hasId) {
      throw new ValidationError('Indica solo uno: ?curp= o ?idInstitucional=.');
    }

    const { candidates, revisadas } = hasCurp
      ? await byCurp(requiredCurp(req.query.curp))
      : await byIdInstitucional(optionalFolio(req.query.idInstitucional));

    if (candidates.length === 0) {
      const description = hasCurp
        ? `Ninguna de las ${revisadas} actas de ChainIDentity corresponde a esa CURP (se comparan los primeros 16 caracteres).`
        : 'Ese ID institucional no está vinculado a ningún acta en ChainIDentity.';
      return res.status(404).json({ Result: 'Error', Description: description });
    }
    res.status(200).json({ Result: 'Success', candidatos: candidates });
  } catch (error) {
    if (error instanceof chain.ChainIdentityUnavailableError) {
      return res.status(503).json({ Result: 'Error', Description: error.message });
    }
    sendError(res, error);
  }
}

module.exports = { lookup };
