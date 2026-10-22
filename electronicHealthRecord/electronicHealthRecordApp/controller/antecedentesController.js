// antecedentesController.js — antecedentes del paciente (NOM-004 6.1.1 + alergias de NOM-024 1.3.6).
//
// Son datos de la PERSONA, no de una visita: viven SOLO aquí (la nota SOAP ya no los copia, solo
// apunta a la versión vigente). Se guardan por VERSIONES, solo-agregar: cada POST con cambios
// crea la versión n+1 y las anteriores no se tocan. Así se cumple el historial que pide NOM-024
// ("las que se actualicen en el tiempo") y la NOM-004 (sin enmendaduras).
//
// Cada versión lleva un hash SHA-256 de su contenido normalizado. Es lo que después se puede
// registrar en blockchain (32 bytes, cueste lo que cueste el contenido) en vez de los datos.
const crypto = require('crypto');
const pool = require('../db');
const { ValidationError, requiredCurp, requiredText, optionalText, validateField, sendError } = require('./validation');
const CAT = require('./antecedentesCatalogs');

const MAX_DETALLE = 500; // mismo tamaño que tenían los campos de texto en el Excel
const MAX_ALERGIAS = 30;

// ---------------------------------------------------------------------------
// Validación y normalización
// ---------------------------------------------------------------------------
// normalize() devuelve SIEMPRE el mismo objeto para el mismo contenido (orden de llaves fijo,
// listas ordenadas por catálogo y sin repetidos). Eso hace que el hash sea estable y que guardar
// dos veces lo mismo no cree una versión nueva.

const isBlank = (value) => value === undefined || value === null || value === '';

function catalogCode(value, catalog, label) {
  if (isBlank(value)) return null;
  const code = String(value).trim().toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(catalog, code)) {
    throw new ValidationError(`${label}: "${value}" no está en el catálogo.`);
  }
  return code;
}

/** Lista de códigos de un catálogo, sin repetidos y en el orden del catálogo. */
function codeList(value, catalog, label) {
  if (isBlank(value)) return [];
  if (!Array.isArray(value)) throw new ValidationError(`${label}: debe ser una lista.`);
  const codes = new Set(value.map((item) => catalogCode(item, catalog, label)).filter(Boolean));
  return Object.keys(catalog).filter((code) => codes.has(code));
}

function ensureObject(value, label) {
  if (isBlank(value)) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${label}: debe ser un objeto.`);
  return value;
}

const integer = (value, label, min, max) => validateField({ type: 'integer', label, min, max }, value);
const boolean = (value, label) => validateField({ type: 'boolean', label }, value);
const date = (value, label) => validateField({ type: 'date', label }, value);

/** Pares (padecimiento, parentesco) marcados en la matriz; solo se guardan los positivos. */
function heredoFamiliares(value) {
  if (isBlank(value)) return [];
  if (!Array.isArray(value)) throw new ValidationError('Heredo-familiares: debe ser una lista.');
  const marked = new Set(value.map((item, index) => {
    const pair = ensureObject(item, `Heredo-familiares #${index + 1}`);
    const padecimiento = catalogCode(pair.padecimiento, CAT.HEREDO_PADECIMIENTOS, `Heredo-familiares #${index + 1}, padecimiento`);
    const parentesco = catalogCode(pair.parentesco, CAT.PARENTESCOS, `Heredo-familiares #${index + 1}, parentesco`);
    if (!padecimiento || !parentesco) throw new ValidationError(`Heredo-familiares #${index + 1}: indica padecimiento y parentesco.`);
    return `${padecimiento}|${parentesco}`;
  }));
  const pairs = [];
  for (const padecimiento of Object.keys(CAT.HEREDO_PADECIMIENTOS)) {
    for (const parentesco of Object.keys(CAT.PARENTESCOS)) {
      if (marked.has(`${padecimiento}|${parentesco}`)) pairs.push({ padecimiento, parentesco });
    }
  }
  return pairs;
}

function consumoSustancias(value) {
  const consumo = ensureObject(value, 'Consumo de sustancias');
  return {
    tabaco: catalogCode(consumo.tabaco, CAT.CONSUMO, 'Tabaco'),
    alcohol: catalogCode(consumo.alcohol, CAT.CONSUMO, 'Alcohol'),
    otrasSustancias: catalogCode(consumo.otrasSustancias, CAT.CONSUMO, 'Otras sustancias psicoactivas'),
  };
}

function alergia(item, index) {
  const label = `Alergia #${index + 1}`;
  const data = ensureObject(item, label);
  const agente = catalogCode(data.agente, CAT.ALERGIA_AGENTES, `${label}, agente`);
  if (!agente) throw new ValidationError(`${label}: indica el agente que la causa.`);
  const result = {
    agente,
    medicamento: optionalText(data.medicamento, `${label}, medicamento`, 100),
    tipoReaccion: catalogCode(data.tipoReaccion, CAT.TIPO_REACCION, `${label}, tipo de reacción`),
    descripcion: optionalText(data.descripcion, `${label}, descripción`, 200),
    fechaDeteccion: date(data.fechaDeteccion, `${label}, fecha de detección`),
    // NOM-024 1.3.6 c: reportada por el paciente (false) o verificada por personal de salud (true).
    verificada: boolean(data.verificada, `${label}, verificada`),
  };
  if (agente === 'MEDICAMENTO' && !result.medicamento) {
    throw new ValidationError(`${label}: escribe el nombre del medicamento.`);
  }
  if (agente === 'OTRO' && !result.descripcion) {
    throw new ValidationError(`${label}: describe a qué es alérgico.`);
  }
  if (result.fechaDeteccion && result.fechaDeteccion > new Date().toISOString().slice(0, 10)) {
    throw new ValidationError(`${label}: la fecha de detección no puede ser futura.`);
  }
  return result;
}

function alergias(value) {
  const data = ensureObject(value, 'Alergias');
  const niega = boolean(data.niega, 'Niega alergias');
  let lista = [];
  if (!isBlank(data.lista)) {
    if (!Array.isArray(data.lista)) throw new ValidationError('Alergias: la lista debe ser una lista.');
    if (data.lista.length > MAX_ALERGIAS) throw new ValidationError(`Alergias: máximo ${MAX_ALERGIAS}.`);
    lista = data.lista.map(alergia);
  }
  // "Niega alergias" es una respuesta clínica, distinta de "no se preguntó" (null).
  if (niega === true && lista.length > 0) {
    throw new ValidationError('Alergias: marcaste "niega alergias" pero hay alergias en la lista.');
  }
  return { niega, lista };
}

function ginecoObstetricos(value) {
  const data = ensureObject(value, 'Gineco-obstétricos');
  const result = {
    menarca: integer(data.menarca, 'Menarca (edad)', 6, 25),
    gestas: integer(data.gestas, 'Gestaciones', 0, 30),
    partos: integer(data.partos, 'Partos', 0, 30),
    abortos: integer(data.abortos, 'Abortos', 0, 30),
    cesareas: integer(data.cesareas, 'Cesáreas', 0, 30),
    metodoAnticonceptivo: catalogCode(data.metodoAnticonceptivo, CAT.METODO_ANTICONCEPTIVO, 'Método anticonceptivo'),
  };
  const { gestas, partos, abortos, cesareas } = result;
  if (gestas !== null && (partos || 0) + (abortos || 0) + (cesareas || 0) > gestas) {
    throw new ValidationError('Gineco-obstétricos: partos + abortos + cesáreas no puede ser mayor que gestaciones.');
  }
  return Object.values(result).every((v) => v === null) ? null : result;
}

/**
 * "Negados" = se preguntó y el paciente no tiene ninguno. Es distinto de "sin dato" (no se
 * preguntó): solo se guarda true; false o vacío se guardan como null.
 */
function negados(value, label, hasData) {
  const result = boolean(value, label) === true ? true : null;
  if (result && hasData) throw new ValidationError(`${label}: marcaste "negados" pero también hay datos capturados.`);
  return result;
}

/** Body de la petición -> antecedentes normalizados (orden de llaves fijo). */
function normalize(body) {
  const heredo = heredoFamiliares(body.heredoFamiliares);
  const heredoDetalle = optionalText(body.heredoFamiliaresDetalle, 'Heredo-familiares, detalle', MAX_DETALLE);
  const patologicos = codeList(body.patologicos, CAT.PATOLOGICOS, 'Patológicos');
  const patologicosDetalle = optionalText(body.patologicosDetalle, 'Patológicos, detalle', MAX_DETALLE);
  return {
    heredoFamiliares: heredo,
    heredoFamiliaresDetalle: heredoDetalle,
    heredoFamiliaresNegados: negados(body.heredoFamiliaresNegados, 'Heredo-familiares', heredo.length > 0 || !!heredoDetalle),
    patologicos,
    patologicosDetalle,
    patologicosNegados: negados(body.patologicosNegados, 'Personales patológicos', patologicos.length > 0 || !!patologicosDetalle),
    consumoSustancias: consumoSustancias(body.consumoSustancias),
    noPatologicos: optionalText(body.noPatologicos, 'No patológicos', MAX_DETALLE),
    alergias: alergias(body.alergias),
    ginecoObstetricos: ginecoObstetricos(body.ginecoObstetricos),
    discapacidades: codeList(body.discapacidades, CAT.DISCAPACIDADES, 'Discapacidades'),
  };
}

/** true si no se capturó nada. */
function isEmpty(a) {
  return a.heredoFamiliares.length === 0 && !a.heredoFamiliaresDetalle && !a.heredoFamiliaresNegados
    && a.patologicos.length === 0 && !a.patologicosDetalle && !a.patologicosNegados
    && Object.values(a.consumoSustancias).every((v) => v === null)
    && !a.noPatologicos
    && a.alergias.niega === null && a.alergias.lista.length === 0
    && a.ginecoObstetricos === null
    && a.discapacidades.length === 0;
}

/**
 * Información mínima de la historia clínica (NOM-004 6.1.1). NOM-024 1.3.7 c pide que el sistema
 * VALIDE su llenado: se informa qué falta (`faltantes`) sin impedir guardar, porque enfermería puede
 * capturar por partes; cada apartado se cumple con un dato o con "negados" / "niega".
 */
const APARTADOS_MINIMOS = [
  ['Alergias (o "niega alergias")', (a) => a.alergias.niega !== null],
  ['Heredo-familiares (o "negados")', (a) => a.heredoFamiliares.length > 0 || !!a.heredoFamiliaresDetalle || a.heredoFamiliaresNegados === true],
  ['Personales patológicos (o "negados")', (a) => a.patologicos.length > 0 || !!a.patologicosDetalle || a.patologicosNegados === true],
  ['Uso y dependencia del tabaco', (a) => a.consumoSustancias.tabaco !== null],
  ['Uso y dependencia del alcohol', (a) => a.consumoSustancias.alcohol !== null],
  ['Uso y dependencia de otras sustancias psicoactivas', (a) => a.consumoSustancias.otrasSustancias !== null],
  ['Personales no patológicos', (a) => !!a.noPatologicos],
];

const faltantes = (a) => APARTADOS_MINIMOS.filter(([, cumple]) => !cumple(a)).map(([nombre]) => nombre);

/**
 * Quién elabora la versión (NOM-004 5.10; NOM-024 5.1.2, 5.1.5 y 3.3.6). Obligatorio. Mientras no
 * haya autenticación en el backend lo manda el frontend con el usuario de la sesión.
 */
function autor(value) {
  const data = ensureObject(value, 'Elaborado por');
  return {
    nombre: requiredText(data.nombre, 'Elaborado por: nombre completo', 120),
    rol: requiredText(data.rol, 'Elaborado por: rol', 30),
  };
}

/**
 * JSON canónico: llaves ordenadas alfabéticamente en todos los niveles. MySQL reordena las llaves de
 * las columnas JSON, así que sin esto el hash no se podría recalcular a partir de lo que devuelve la
 * API (p. ej. para verificarlo contra la blockchain).
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const hashOf = (antecedentes) => crypto.createHash('sha256').update(canonicalJson(antecedentes)).digest('hex');

// ---------------------------------------------------------------------------
// MySQL
// ---------------------------------------------------------------------------

const json = (value) => (value === null ? null : JSON.stringify(value));

function toRow(a) {
  return {
    heredo_familiares: json(a.heredoFamiliares),
    heredo_familiares_detalle: a.heredoFamiliaresDetalle,
    heredo_familiares_negados: a.heredoFamiliaresNegados,
    patologicos: json(a.patologicos),
    patologicos_detalle: a.patologicosDetalle,
    patologicos_negados: a.patologicosNegados,
    consumo_tabaco: a.consumoSustancias.tabaco,
    consumo_alcohol: a.consumoSustancias.alcohol,
    consumo_otras_sustancias: a.consumoSustancias.otrasSustancias,
    no_patologicos: a.noPatologicos,
    niega_alergias: a.alergias.niega,
    alergias: json(a.alergias.lista),
    gineco_obstetricos: json(a.ginecoObstetricos),
    discapacidades: json(a.discapacidades),
  };
}

// mysql2 ya devuelve las columnas JSON como objetos; el BOOLEAN llega como 0/1.
function fromRow(row) {
  return {
    heredoFamiliares: row.heredo_familiares || [],
    heredoFamiliaresDetalle: row.heredo_familiares_detalle,
    heredoFamiliaresNegados: row.heredo_familiares_negados === 1 ? true : null,
    patologicos: row.patologicos || [],
    patologicosDetalle: row.patologicos_detalle,
    patologicosNegados: row.patologicos_negados === 1 ? true : null,
    consumoSustancias: {
      tabaco: row.consumo_tabaco,
      alcohol: row.consumo_alcohol,
      otrasSustancias: row.consumo_otras_sustancias,
    },
    noPatologicos: row.no_patologicos,
    alergias: { niega: row.niega_alergias === null ? null : row.niega_alergias === 1, lista: row.alergias || [] },
    ginecoObstetricos: row.gineco_obstetricos,
    discapacidades: row.discapacidades || [],
  };
}

function toApiShape(row) {
  const antecedentes = fromRow(row);
  const pendientes = faltantes(antecedentes);
  return {
    id: row.id,
    curp: row.curp,
    version: row.version,
    ...antecedentes,
    hash: row.hash, // solo del contenido clínico (sin autor ni fecha)
    // null = versión guardada antes de que se registrara el autor (incluye las migradas)
    elaboradoPor: row.elaborado_por ? { nombre: row.elaborado_por, rol: row.elaborado_por_rol } : null,
    creadoEn: row.creado_en,
    completa: pendientes.length === 0,
    faltantes: pendientes,
  };
}

async function latestRow(curp, connection = pool) {
  const [rows] = await connection.query(
    'SELECT * FROM antecedentes WHERE curp = ? ORDER BY version DESC LIMIT 1', [curp]
  );
  return rows[0] || null;
}

/**
 * Inserta una versión nueva (o nada, si el contenido es igual a la última). Exportada para que
 * schema.js la use al migrar los antecedentes de la versión anterior de la tabla.
 * @returns {{ row: object, created: boolean }}
 */
async function insertVersion(curp, antecedentes, { creadoEn, elaboradoPor } = {}) {
  const hash = hashOf(antecedentes);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    // FOR UPDATE: dos guardados simultáneos del mismo paciente no pueden tomar el mismo número.
    const [[{ last }]] = await connection.query(
      'SELECT MAX(version) AS last FROM antecedentes WHERE curp = ? FOR UPDATE', [curp]
    );
    const previous = last ? await latestRow(curp, connection) : null;
    if (previous && previous.hash === hash) {
      await connection.commit();
      return { row: previous, created: false };
    }
    const row = { curp, version: (last || 0) + 1, ...toRow(antecedentes), hash };
    if (elaboradoPor) {
      row.elaborado_por = elaboradoPor.nombre;
      row.elaborado_por_rol = elaboradoPor.rol;
    }
    if (creadoEn) row.creado_en = creadoEn;
    const columns = Object.keys(row);
    const [result] = await connection.query(
      `INSERT INTO antecedentes (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      columns.map((column) => row[column])
    );
    await connection.commit();
    const [[saved]] = await pool.query('SELECT * FROM antecedentes WHERE id = ?', [result.insertId]);
    return { row: saved, created: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

// POST /antecedentes — guarda una versión nueva de los antecedentes (si cambió algo).
async function saveAntecedentes(req, res) {
  try {
    const body = req.body || {};
    const curp = requiredCurp(body.curp);
    const antecedentes = normalize(body);
    const elaboradoPor = autor(body.elaboradoPor);

    const [fichas] = await pool.query('SELECT sexo FROM ficha_identificacion WHERE curp = ?', [curp]);
    if (fichas.length === 0) {
      return res.status(404).json({ Result: 'Error', Description: 'No existe un paciente con esa CURP. Regístralo primero.' });
    }
    if (antecedentes.ginecoObstetricos && fichas[0].sexo === 'H') {
      throw new ValidationError('Gineco-obstétricos: solo aplica a pacientes mujeres (según la ficha).');
    }
    // Vacío solo se acepta como corrección de algo que ya existía (p. ej. quitar lo último).
    if (isEmpty(antecedentes) && !(await latestRow(curp))) {
      throw new ValidationError('Los antecedentes están vacíos: captura al menos un dato.');
    }

    const { row, created } = await insertVersion(curp, antecedentes, { elaboradoPor });
    res.status(created ? 201 : 200).json({
      Result: 'Success',
      sinCambios: !created, // true = era igual a la última versión, no se creó otra
      antecedentes: toApiShape(row),
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ Result: 'Error', Description: 'Otra persona guardó los antecedentes al mismo tiempo. Vuelve a cargarlos.' });
    }
    sendError(res, error);
  }
}

// GET /antecedentes?curp=...              -> versión vigente
// GET /antecedentes?curp=...&historial=1  -> todas las versiones, la más reciente primero
// (Parámetro y no ruta nueva para no tener que agregar otra ruta en el API Gateway.)
async function getAntecedentes(req, res) {
  try {
    const curp = requiredCurp(req.query.curp);
    if (req.query.historial === '1' || req.query.historial === 'true') {
      const [rows] = await pool.query('SELECT * FROM antecedentes WHERE curp = ? ORDER BY version DESC', [curp]);
      return res.status(200).json({ Result: 'Success', historial: rows.map(toApiShape) });
    }
    const row = await latestRow(curp);
    if (!row) {
      return res.status(404).json({ Result: 'Error', Description: 'Ese paciente no tiene antecedentes registrados.' });
    }
    res.status(200).json({ Result: 'Success', antecedentes: toApiShape(row) });
  } catch (error) {
    sendError(res, error);
  }
}

module.exports = { saveAntecedentes, getAntecedentes, normalize, insertVersion, hashOf, fromRow };
