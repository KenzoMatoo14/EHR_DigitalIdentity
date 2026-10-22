// notaSoapController.js — nota SOAP de enfermería: la unión de los campos del Excel Norm04
// (hojas 6.1.x, 6.2 y 7.1) repartidos en los paneles del SOAP. Ver notaSoapFields.js.
//
// Una nota es SOLO-AGREGAR: hay POST (crear) y GET (consultar), pero no PUT ni DELETE. Es lo que
// exige un expediente clínico (lo escrito no se altera) y lo que después garantizará la blockchain.
//
// La nota NO copia los antecedentes: guarda `antecedentes_id`, la versión de antecedentes vigente
// cuando se creó (la pone el servidor, no el cliente). Así cada nota dice qué se sabía del paciente
// ese día sin duplicar datos (ni gas).
const pool = require('../db');
const { NOTA_SOAP_FIELDS, SERVICIO_FIELDS } = require('./notaSoapFields');
const { ValidationError, requiredCurp, validateField, getPath, setPath, sendError } = require('./validation');

const ALL_FIELDS = [...SERVICIO_FIELDS, ...NOTA_SOAP_FIELDS];
const COLUMNS = ALL_FIELDS.map((field) => field.column);

const pad = (number) => String(number).padStart(2, '0');

/** Fecha y hora locales del servidor, para 7.1.1 cuando no vienen en la petición. */
function nowDateTime() {
  const now = new Date();
  return {
    fecha: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    hora: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

function validateNota(body) {
  const curp = requiredCurp(body.curp);
  const values = {};
  for (const field of ALL_FIELDS) values[field.column] = validateField(field, getPath(body, field.path));

  // Una nota sin ningún dato clínico no tiene sentido en el expediente.
  if (NOTA_SOAP_FIELDS.every((field) => values[field.column] === null)) {
    throw new ValidationError('La nota está vacía: captura al menos un dato clínico.');
  }

  const now = nowDateTime();
  if (values.fecha_servicio === null) values.fecha_servicio = now.fecha;
  if (values.hora_servicio === null) values.hora_servicio = now.hora;
  return { curp, values };
}

// Columnas de la nota + la versión y hash de los antecedentes a los que apunta.
const SELECT_NOTAS = `
  SELECT n.*, a.version AS antecedentes_version, a.hash AS antecedentes_hash
  FROM nota_soap n LEFT JOIN antecedentes a ON a.id = n.antecedentes_id`;

// Fila MySQL -> JSON con los nombres y objetos del Excel (signosVitales.temperatura, ...).
function toApiShape(row) {
  const nota = { id: row.id, curp: row.curp };
  for (const field of ALL_FIELDS) {
    let value = row[field.column];
    if (value === null || value === undefined) continue;
    if (field.type === 'boolean') value = value === 1;
    if (field.type === 'decimal') value = Number(value); // mysql2 devuelve DECIMAL como string
    if (field.type === 'time') value = String(value).slice(0, 5); // 'hh:mm:ss' -> 'hh:mm'
    setPath(nota, field.path, value);
  }
  // null = la nota se hizo cuando el paciente aún no tenía antecedentes registrados.
  nota.antecedentesRef = row.antecedentes_id
    ? { id: row.antecedentes_id, version: row.antecedentes_version, hash: row.antecedentes_hash }
    : null;
  nota.creadoEn = row.creado_en;
  return nota;
}

// POST /notaSoap — agrega una nota al expediente del paciente.
async function createNota(req, res) {
  try {
    const { curp, values } = validateNota(req.body || {});
    const [latest] = await pool.query(
      'SELECT id FROM antecedentes WHERE curp = ? ORDER BY version DESC LIMIT 1', [curp]
    );
    const antecedentesId = latest.length > 0 ? latest[0].id : null;
    const [result] = await pool.query(
      `INSERT INTO nota_soap (curp, antecedentes_id, ${COLUMNS.join(', ')}) VALUES (?, ?, ${COLUMNS.map(() => '?').join(', ')})`,
      [curp, antecedentesId, ...COLUMNS.map((column) => values[column])]
    );
    const [rows] = await pool.query(`${SELECT_NOTAS} WHERE n.id = ?`, [result.insertId]);
    res.status(201).json({ Result: 'Success', nota: toApiShape(rows[0]) });
  } catch (error) {
    // FOREIGN KEY: la CURP debe existir en ficha_identificacion.
    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(404).json({ Result: 'Error', Description: 'No existe un paciente con esa CURP. Regístralo primero.' });
    }
    sendError(res, error);
  }
}

// GET /notaSoap?curp=MALK050614HJCTPN09 — todas las notas del paciente, la más reciente primero.
async function getNotas(req, res) {
  try {
    const curp = requiredCurp(req.query.curp);
    const [rows] = await pool.query(`${SELECT_NOTAS} WHERE n.curp = ? ORDER BY n.id DESC`, [curp]);
    res.status(200).json({ Result: 'Success', notas: rows.map(toApiShape) });
  } catch (error) {
    sendError(res, error);
  }
}

module.exports = { createNota, getNotas };
