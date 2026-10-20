// schema.js — crea las tablas del EHR al arrancar el servicio (antes se creaban en cada POST).
//
// Por qué al arrancar: el CREATE TABLE corre una sola vez, y si MySQL no responde el servicio lo
// dice desde el inicio en vez de fallar en la primera petición de un usuario.
//
// Relación de las tablas (todas cuelgan del paciente por su CURP):
//   ficha_identificacion (1) ── (0..1) antecedentes
//                        (1) ── (0..n) nota_soap      (solo se agregan, nunca se editan)
const pool = require('./db');
const { NOTA_SOAP_FIELDS, SERVICIO_FIELDS, sqlType } = require('./controller/notaSoapFields');

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

// ON DELETE RESTRICT: no se puede borrar un paciente que tenga antecedentes o notas.
const ANTECEDENTES_SQL = `
  CREATE TABLE IF NOT EXISTS antecedentes (
    curp VARCHAR(18) PRIMARY KEY,
    antecedentes_heredo_familiares VARCHAR(500),
    antecedentes_personales_patologicos VARCHAR(500),
    antecedentes_personales_no_patologicos VARCHAR(500),
    uso_tabaco BOOLEAN,
    uso_alcohol BOOLEAN,
    uso_otras_sustancias BOOLEAN,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_nota_soap_curp (curp),
    FOREIGN KEY (curp) REFERENCES ficha_identificacion (curp) ON DELETE RESTRICT
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

async function ensureSchema() {
  await assertPatientKeyIsCurp();
  // En este orden: las tablas con FOREIGN KEY necesitan que ficha_identificacion ya exista.
  await pool.query(FICHA_SQL);
  await pool.query(ANTECEDENTES_SQL);
  await pool.query(NOTA_SOAP_SQL);
}

module.exports = { ensureSchema };
