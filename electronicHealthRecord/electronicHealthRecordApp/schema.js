// schema.js — crea las tablas del EHR al arrancar el servicio (antes se creaban en cada POST).
//
// Por qué al arrancar: el CREATE TABLE corre una sola vez, y si MySQL no responde el servicio lo
// dice desde el inicio en vez de fallar en la primera petición de un usuario.
//
// Relación de las tablas (todas cuelgan del paciente por su CURP):
//   ficha_identificacion (1) ── (0..n) antecedentes   (versiones; solo se agregan)
//                        (1) ── (0..n) nota_soap      (solo se agregan, nunca se editan)
//   nota_soap.antecedentes_id ──> la versión de antecedentes vigente cuando se hizo la nota
const pool = require('./db');
const { NOTA_SOAP_FIELDS, SERVICIO_FIELDS, sqlType } = require('./controller/notaSoapFields');
const { normalize, insertVersion, hashOf, fromRow } = require('./controller/antecedentesController');

// folio = ID institucional: opcional, pero dos pacientes no pueden compartirlo (UNIQUE admite
// varios NULL, así que los pacientes sin folio no chocan entre sí).
const FICHA_SQL = `
  CREATE TABLE IF NOT EXISTS ficha_identificacion (
    curp VARCHAR(18) PRIMARY KEY,
    folio VARCHAR(18) UNIQUE,
    nombre VARCHAR(50) NOT NULL,
    apellido_paterno VARCHAR(50) NOT NULL,
    apellido_materno VARCHAR(50),
    fecha_nacimiento CHAR(8),
    entidad_nacimiento CHAR(2),
    sexo CHAR(1),
    nacionalidad VARCHAR(3),
    entidad_residencia CHAR(2),
    municipio_residencia CHAR(3),
    localidad_residencia CHAR(4),
    grupo_etnico INT,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`;

// Una fila = una VERSIÓN de los antecedentes del paciente (solo-agregar). Las listas (matriz
// heredo-familiar, patológicos, alergias...) van como JSON de códigos de catálogo. `hash` = SHA-256
// del contenido normalizado (ver antecedentesController.js): lo que se registraría en blockchain.
// ON DELETE RESTRICT: no se puede borrar un paciente que tenga antecedentes o notas.
const ANTECEDENTES_SQL = `
  CREATE TABLE IF NOT EXISTS antecedentes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    curp VARCHAR(18) NOT NULL,
    version SMALLINT UNSIGNED NOT NULL,
    heredo_familiares JSON,
    heredo_familiares_detalle VARCHAR(500),
    heredo_familiares_negados BOOLEAN,
    patologicos JSON,
    patologicos_detalle VARCHAR(500),
    patologicos_negados BOOLEAN,
    consumo_tabaco VARCHAR(12),
    consumo_alcohol VARCHAR(12),
    consumo_otras_sustancias VARCHAR(12),
    no_patologicos VARCHAR(500),
    niega_alergias BOOLEAN,
    alergias JSON,
    gineco_obstetricos JSON,
    discapacidades JSON,
    hash CHAR(64) NOT NULL,
    elaborado_por VARCHAR(120),
    elaborado_por_rol VARCHAR(30),
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_antecedentes_curp_version (curp, version),
    FOREIGN KEY (curp) REFERENCES ficha_identificacion (curp) ON DELETE RESTRICT
  )
`;

// Las columnas clínicas se generan desde notaSoapFields.js para que tabla y validación no se
// desincronicen. Sin actualizado_en: una nota no se modifica.
const NOTA_SOAP_SQL = `
  CREATE TABLE IF NOT EXISTS nota_soap (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    curp VARCHAR(18) NOT NULL,
    ${[...SERVICIO_FIELDS, ...NOTA_SOAP_FIELDS].map((field) => `${field.column} ${sqlType(field)}`).join(',\n    ')},
    antecedentes_id INT UNSIGNED,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_nota_soap_curp (curp),
    FOREIGN KEY (curp) REFERENCES ficha_identificacion (curp) ON DELETE RESTRICT,
    CONSTRAINT fk_nota_soap_antecedentes FOREIGN KEY (antecedentes_id) REFERENCES antecedentes (id) ON DELETE RESTRICT
  )
`;

/**
 * Hubo una versión intermedia con llave = folio. CREATE TABLE IF NOT EXISTS no cambia una tabla
 * que ya existe, así que si quedaron esas tablas se avisa y se detiene el arranque en vez de
 * borrarlas automáticamente.
 */
async function assertPatientKeyIsCurp() {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ficha_identificacion' AND CONSTRAINT_NAME = 'PRIMARY'`
  );
  if (rows.length > 0 && rows[0].COLUMN_NAME !== 'curp') {
    throw new Error(
      'Las tablas del EHR son de la versión con llave = folio. Renómbralas (conservan sus datos) con:\n' +
      '  docker exec tokphy-mysql-ehr mysql -utokuser -puser_pw123 tokphydb -e "RENAME TABLE ' +
      'ficha_identificacion TO ficha_identificacion_v2, antecedentes TO antecedentes_v2, nota_soap TO nota_soap_v2;"\n' +
      'y vuelve a arrancar el servicio.'
    );
  }
}

const columnExists = async (table, column) => {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
};

const tableExists = async (table) => {
  const [rows] = await pool.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [table]
  );
  return rows.length > 0;
};

/**
 * La versión anterior de `antecedentes` tenía una fila por paciente con 3 textos y 3 booleanos.
 * Si sigue así, se renombra a `antecedentes_legacy` (no se borra nada) para crear la tabla nueva.
 * @returns {boolean} true si hay que copiar sus filas después de crear la tabla nueva.
 */
async function renameLegacyAntecedentes() {
  if (!(await columnExists('antecedentes', 'antecedentes_heredo_familiares'))) return false;
  if (await tableExists('antecedentes_legacy')) {
    throw new Error('Existen "antecedentes" (formato viejo) y "antecedentes_legacy" a la vez; revisa cuál conservar.');
  }
  await pool.query('RENAME TABLE antecedentes TO antecedentes_legacy');
  return true;
}

// Booleano viejo "uso de ..." -> código nuevo. true no dice si había dependencia: se guarda como USO.
const legacyConsumo = (value) => (value === null ? null : value === 1 ? 'USO' : 'NO');

/** Copia cada fila vieja como versión 1 (los textos pasan a los campos de detalle). */
async function copyLegacyAntecedentes() {
  const [rows] = await pool.query('SELECT * FROM antecedentes_legacy');
  for (const row of rows) {
    const antecedentes = normalize({
      heredoFamiliaresDetalle: row.antecedentes_heredo_familiares,
      patologicosDetalle: row.antecedentes_personales_patologicos,
      noPatologicos: row.antecedentes_personales_no_patologicos,
      consumoSustancias: {
        tabaco: legacyConsumo(row.uso_tabaco),
        alcohol: legacyConsumo(row.uso_alcohol),
        otrasSustancias: legacyConsumo(row.uso_otras_sustancias),
      },
    });
    await insertVersion(row.curp, antecedentes, { creadoEn: row.actualizado_en });
  }
  console.log(`Antecedentes: ${rows.length} paciente(s) migrados a versiones; la tabla vieja quedó como antecedentes_legacy.`);
}

/** nota_soap creada antes de esta versión: le falta la referencia a los antecedentes. */
async function addNotaAntecedentesColumn() {
  if (await columnExists('nota_soap', 'antecedentes_id')) return;
  await pool.query(`
    ALTER TABLE nota_soap
      ADD COLUMN antecedentes_id INT UNSIGNED NULL AFTER hora_servicio,
      ADD CONSTRAINT fk_nota_soap_antecedentes FOREIGN KEY (antecedentes_id) REFERENCES antecedentes (id) ON DELETE RESTRICT`);
}

// Columnas agregadas después de crear la tabla de versiones (2026-10-22): "negados" de dos apartados
// y autor de la versión. CREATE TABLE IF NOT EXISTS no las agrega a una tabla que ya existe.
const ANTECEDENTES_NEW_COLUMNS = [
  ['heredo_familiares_negados', 'BOOLEAN AFTER heredo_familiares_detalle'],
  ['patologicos_negados', 'BOOLEAN AFTER patologicos_detalle'],
  ['elaborado_por', 'VARCHAR(120) AFTER hash'],
  ['elaborado_por_rol', 'VARCHAR(30) AFTER elaborado_por'],
];

/**
 * Agrega las columnas que falten. Si se agregó alguna, el contenido normalizado ganó llaves nuevas
 * (los "negados", en null), así que se recalcula el hash de las versiones existentes para que siga
 * siendo reproducible a partir de los datos. Los datos clínicos no cambian.
 */
async function addAntecedentesColumns() {
  let added = false;
  for (const [column, definition] of ANTECEDENTES_NEW_COLUMNS) {
    if (await columnExists('antecedentes', column)) continue;
    await pool.query(`ALTER TABLE antecedentes ADD COLUMN ${column} ${definition}`);
    added = true;
  }
  if (!added) return;
  const [rows] = await pool.query('SELECT * FROM antecedentes');
  for (const row of rows) {
    await pool.query('UPDATE antecedentes SET hash = ? WHERE id = ?', [hashOf(fromRow(row)), row.id]);
  }
  console.log(`Antecedentes: columnas nuevas agregadas; hash recalculado en ${rows.length} versión(es).`);
}

async function ensureSchema() {
  await assertPatientKeyIsCurp();
  // En este orden: las tablas con FOREIGN KEY necesitan que ficha_identificacion ya exista.
  await pool.query(FICHA_SQL);
  const migrate = await renameLegacyAntecedentes();
  await pool.query(ANTECEDENTES_SQL);
  await addAntecedentesColumns();
  if (migrate) await copyLegacyAntecedentes();
  await pool.query(NOTA_SOAP_SQL);
  await addNotaAntecedentesColumn();
}

module.exports = { ensureSchema };
