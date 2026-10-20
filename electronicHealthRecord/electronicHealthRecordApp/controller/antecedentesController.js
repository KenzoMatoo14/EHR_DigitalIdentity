// antecedentesController.js — antecedentes del paciente (Excel Norm04, hoja 6.1.1): son datos de
// la PERSONA que se actualizan con el tiempo, no de una nota, por eso hay una fila por paciente
// (upsert por CURP). La nota SOAP guarda además una copia de lo capturado en cada visita.
const pool = require('../db');
const { requiredCurp, validateField, getPath, setPath, sendError } = require('./validation');

// Mismos nombres, tipos y tamaños que en el Excel (y que notaSoapFields.js, panel Historiales).
const ANTECEDENTES_FIELDS = Object.freeze([
  { path: ['antecedentesHeredoFamiliares'], column: 'antecedentes_heredo_familiares', label: 'Antecedentes heredo-familiares', type: 'text', max: 500 },
  { path: ['antecedentesPersonalesPatologicos'], column: 'antecedentes_personales_patologicos', label: 'Antecedentes personales patológicos', type: 'text', max: 500 },
  { path: ['antecedentesPersonalesNoPatologicos'], column: 'antecedentes_personales_no_patologicos', label: 'Antecedentes personales no patológicos', type: 'text', max: 500 },
  { path: ['consumoSustancias', 'usoTabaco'], column: 'uso_tabaco', label: 'Uso de tabaco', type: 'boolean' },
  { path: ['consumoSustancias', 'usoAlcohol'], column: 'uso_alcohol', label: 'Uso de alcohol', type: 'boolean' },
  { path: ['consumoSustancias', 'usoOtrasSustancias'], column: 'uso_otras_sustancias', label: 'Uso de otras sustancias', type: 'boolean' },
]);

const COLUMNS = ANTECEDENTES_FIELDS.map((field) => field.column);

// Fila MySQL -> JSON con los nombres del Excel. Los BOOLEAN de MySQL llegan como 0/1.
function toApiShape(row) {
  const antecedentes = {};
  for (const field of ANTECEDENTES_FIELDS) {
    const value = row[field.column];
    if (value === null || value === undefined) continue;
    setPath(antecedentes, field.path, field.type === 'boolean' ? value === 1 : value);
  }
  return { curp: row.curp, ...antecedentes, actualizadoEn: row.actualizado_en };
}

async function findAntecedentes(curp) {
  const [rows] = await pool.query('SELECT * FROM antecedentes WHERE curp = ?', [curp]);
  return rows.length > 0 ? toApiShape(rows[0]) : null;
}

// POST /antecedentes — crea o reemplaza los antecedentes del paciente (upsert por CURP).
async function saveAntecedentes(req, res) {
  try {
    const body = req.body || {};
    const curp = requiredCurp(body.curp);
    const values = ANTECEDENTES_FIELDS.map((field) => validateField(field, getPath(body, field.path)));

    await pool.query(
      `INSERT INTO antecedentes (curp, ${COLUMNS.join(', ')})
       VALUES (?, ${COLUMNS.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${COLUMNS.map((column) => `${column} = VALUES(${column})`).join(', ')}`,
      [curp, ...values]
    );
    res.status(200).json({ Result: 'Success', antecedentes: await findAntecedentes(curp) });
  } catch (error) {
    // FOREIGN KEY: la CURP debe existir en ficha_identificacion.
    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(404).json({ Result: 'Error', Description: 'No existe un paciente con esa CURP. Regístralo primero.' });
    }
    sendError(res, error);
  }
}

// GET /antecedentes?curp=MALK050614HJCTPN09
async function getAntecedentes(req, res) {
  try {
    const curp = requiredCurp(req.query.curp);
    const antecedentes = await findAntecedentes(curp);
    if (!antecedentes) {
      return res.status(404).json({ Result: 'Error', Description: 'Ese paciente no tiene antecedentes registrados.' });
    }
    res.status(200).json({ Result: 'Success', antecedentes });
  } catch (error) {
    sendError(res, error);
  }
}

module.exports = { saveAntecedentes, getAntecedentes };
