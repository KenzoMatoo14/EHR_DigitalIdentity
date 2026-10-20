// fichaIdentificacionController.js — registra al paciente y guarda su Ficha de identificación
// (objeto "FichaIdentificacion" del Excel Norm04 + grupoEtnico de la hoja 6.1.1) en MySQL.
//
// Llave del paciente: `curp`. El `folio` (ID institucional, p. ej. "0263328") es opcional pero no
// se puede repetir entre pacientes. Registrar un paciente y editar su ficha son la MISMA operación
// (upsert por CURP): el registro manda los campos mínimos y la pestaña "Ficha de datos" el resto.
//
// Catálogos: el frontend manda el `id` numérico del <select> (public/js/data/catalogs.js) y aquí
// se convierte al código de ancho fijo del Excel (CHAR(2)/CHAR(1)/VARCHAR(3)). Al consultar se
// hace la conversión inversa, para que el frontend reciba la ficha en la misma forma que la manda.
const pool = require('../db');
const {
  ValidationError, requiredCurp, optionalFolio, requiredText, optionalText, sendError,
} = require('./validation');

// id del catálogo (frontend) -> código del Excel. Debe reflejar exactamente catalogs.js.
const ENTIDAD_CODES = Object.fromEntries(
  Array.from({ length: 32 }, (_, i) => [i + 1, String(i + 1).padStart(2, '0')])
);
ENTIDAD_CODES[33] = '99'; // convención propia para "extranjero" (no es código INEGI)
const SEXO_CODES = { 1: 'H', 2: 'M' };
const NACIONALIDAD_CODES = { 1: 'MEX', 2: 'OTR' };
// grupoEtnico es "Catálogo INT" en el Excel: se guarda el id tal cual. Catálogo PROVISIONAL.
const GRUPO_ETNICO_IDS = [0, 1, 2, 3, 4];

// Conversión inversa (código -> id) para responder con la forma del frontend.
const invert = (codes) => Object.fromEntries(Object.entries(codes).map(([id, code]) => [code, Number(id)]));
const ENTIDAD_IDS = invert(ENTIDAD_CODES);
const SEXO_IDS = invert(SEXO_CODES);
const NACIONALIDAD_IDS = invert(NACIONALIDAD_CODES);

const isBlank = (value) => value === undefined || value === null || value === '';

function optionalCatalogCode(value, label, codes) {
  if (isBlank(value)) return null;
  const code = codes[Number(value)];
  if (code === undefined) throw new ValidationError(`${label}: opción de catálogo no válida.`);
  return code;
}

function optionalCatalogId(value, label, ids) {
  if (isBlank(value)) return null;
  const id = Number(value);
  if (!ids.includes(id)) throw new ValidationError(`${label}: opción de catálogo no válida.`);
  return id;
}

// "2005-06-14" o "20050614" -> "20050614" (Excel: Numérico CHAR(8), aaaammdd).
function optionalDate8(value, label) {
  if (isBlank(value)) return null;
  const digits = String(value).replace(/-/g, '');
  if (!/^\d{8}$/.test(digits)) throw new ValidationError(`${label}: formato inválido (se espera aaaammdd).`);
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new ValidationError(`${label}: no es una fecha calendario válida.`);
  }
  if (date.getTime() > Date.now()) throw new ValidationError(`${label}: no puede ser futura.`);
  return digits;
}

function validateFicha(body) {
  return {
    curp: requiredCurp(body.curp),
    folio: optionalFolio(body.folio),
    nombre: requiredText(body.nombre, 'Nombre', 50),
    apellidoP: requiredText(body.apellidoP, 'Apellido paterno', 50),
    apellidoM: optionalText(body.apellidoM, 'Apellido materno', 50),
    fechaNacimiento: optionalDate8(body.fechaNacimiento, 'Fecha de nacimiento'),
    entidadNacimiento: optionalCatalogCode(body.entidadNacimiento, 'Entidad de nacimiento', ENTIDAD_CODES),
    sexo: optionalCatalogCode(body.sexo, 'Sexo', SEXO_CODES),
    nacionalidad: optionalCatalogCode(body.nacionalidad, 'Nacionalidad', NACIONALIDAD_CODES),
    entidadResidencia: optionalCatalogCode(body.entidadResidencia, 'Entidad de residencia', ENTIDAD_CODES),
    municipioResidencia: optionalText(body.municipioResidencia, 'Municipio de residencia', 3, /^\d{1,3}$/, 'código INEGI de hasta 3 dígitos'),
    localidadResidencia: optionalText(body.localidadResidencia, 'Localidad de residencia', 4, /^\d{1,4}$/, 'código INEGI de hasta 4 dígitos'),
    grupoEtnico: optionalCatalogId(body.grupoEtnico, 'Grupo étnico', GRUPO_ETNICO_IDS),
  };
}

// Fila MySQL -> misma forma que manda el frontend (ids de catálogo, nombres del Excel).
// Los campos vacíos se omiten, igual que hace formRenderer.readValues.
function toApiShape(row) {
  const ficha = {
    curp: row.curp,
    folio: row.folio,
    nombre: row.nombre,
    apellidoP: row.apellido_paterno,
    apellidoM: row.apellido_materno,
    fechaNacimiento: row.fecha_nacimiento,
    entidadNacimiento: ENTIDAD_IDS[row.entidad_nacimiento],
    sexo: SEXO_IDS[row.sexo],
    nacionalidad: NACIONALIDAD_IDS[row.nacionalidad],
    entidadResidencia: ENTIDAD_IDS[row.entidad_residencia],
    municipioResidencia: row.municipio_residencia,
    localidadResidencia: row.localidad_residencia,
    grupoEtnico: row.grupo_etnico,
  };
  for (const key of Object.keys(ficha)) {
    if (ficha[key] === null || ficha[key] === undefined) delete ficha[key];
  }
  return { ...ficha, creadoEn: row.creado_en, actualizadoEn: row.actualizado_en };
}

async function findFicha(curp) {
  const [rows] = await pool.query('SELECT * FROM ficha_identificacion WHERE curp = ?', [curp]);
  return rows.length > 0 ? toApiShape(rows[0]) : null;
}

// POST /fichaIdentificacion — registra al paciente o actualiza su ficha (upsert por CURP).
// Reemplazo completo: un campo que no viene se guarda como NULL (lo borrado en pantalla se borra).
async function saveFicha(req, res) {
  try {
    const ficha = validateFicha(req.body || {});

    // ON DUPLICATE KEY UPDATE se dispara con CUALQUIER llave única, también con el folio: sin esta
    // revisión, mandar el folio de otro paciente sobrescribiría a ese otro paciente.
    if (ficha.folio) {
      const [owners] = await pool.query(
        'SELECT curp FROM ficha_identificacion WHERE folio = ? AND curp <> ?', [ficha.folio, ficha.curp]
      );
      if (owners.length > 0) {
        throw new ValidationError(`Ese folio ya está registrado con la CURP ${owners[0].curp}.`);
      }
    }

    await pool.query(
      `INSERT INTO ficha_identificacion
        (curp, folio, nombre, apellido_paterno, apellido_materno, fecha_nacimiento, entidad_nacimiento,
         sexo, nacionalidad, entidad_residencia, municipio_residencia, localidad_residencia, grupo_etnico)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        folio = VALUES(folio),
        nombre = VALUES(nombre),
        apellido_paterno = VALUES(apellido_paterno),
        apellido_materno = VALUES(apellido_materno),
        fecha_nacimiento = VALUES(fecha_nacimiento),
        entidad_nacimiento = VALUES(entidad_nacimiento),
        sexo = VALUES(sexo),
        nacionalidad = VALUES(nacionalidad),
        entidad_residencia = VALUES(entidad_residencia),
        municipio_residencia = VALUES(municipio_residencia),
        localidad_residencia = VALUES(localidad_residencia),
        grupo_etnico = VALUES(grupo_etnico)`,
      [
        ficha.curp, ficha.folio, ficha.nombre, ficha.apellidoP, ficha.apellidoM, ficha.fechaNacimiento,
        ficha.entidadNacimiento, ficha.sexo, ficha.nacionalidad, ficha.entidadResidencia,
        ficha.municipioResidencia, ficha.localidadResidencia, ficha.grupoEtnico,
      ]
    );
    res.status(200).json({ Result: 'Success', ficha: await findFicha(ficha.curp) });
  } catch (error) {
    // Respaldo por si dos peticiones simultáneas pasan la revisión de arriba.
    if (error.code === 'ER_DUP_ENTRY') {
      return sendError(res, new ValidationError('Ese folio ya está registrado con otra CURP.'));
    }
    sendError(res, error);
  }
}

// GET /fichaIdentificacion?curp=MALK050614HJCTPN09 — consulta por CURP.
async function getFicha(req, res) {
  try {
    const curp = requiredCurp(req.query.curp);
    const ficha = await findFicha(curp);
    if (!ficha) {
      return res.status(404).json({ Result: 'Error', Description: 'No existe un paciente con esa CURP.' });
    }
    res.status(200).json({ Result: 'Success', ficha });
  } catch (error) {
    sendError(res, error);
  }
}

// GET /pacientes?q=texto — busca pacientes por nombre y apellidos, CURP o folio (ID institucional).
// Sin `q` devuelve todos. Máximo SEARCH_LIMIT resultados, ordenados por apellidos y nombre.
// La comparación no distingue mayúsculas ni acentos ("gomez" encuentra "Gómez"): es la intercalación
// por defecto de MySQL 8 (utf8mb4_0900_ai_ci; "ai" = accent insensitive, "ci" = case insensitive).
const SEARCH_LIMIT = 100;

async function searchPacientes(req, res) {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length > 100) throw new ValidationError('Búsqueda: máximo 100 caracteres.');

    // LIKE trata % y _ como comodines: se escapan para buscar el texto tal cual lo escribió el usuario.
    const like = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const [rows] = q === ''
      ? await pool.query(
        'SELECT * FROM ficha_identificacion ORDER BY apellido_paterno, apellido_materno, nombre LIMIT ?', [SEARCH_LIMIT])
      : await pool.query(
        `SELECT * FROM ficha_identificacion
         WHERE CONCAT_WS(' ', nombre, apellido_paterno, apellido_materno) LIKE ?
            OR curp LIKE ?
            OR folio LIKE ?
         ORDER BY apellido_paterno, apellido_materno, nombre
         LIMIT ?`,
        [like, like, like, SEARCH_LIMIT]
      );
    res.status(200).json({ Result: 'Success', pacientes: rows.map(toApiShape) });
  } catch (error) {
    sendError(res, error);
  }
}

module.exports = { saveFicha, getFicha, searchPacientes };
