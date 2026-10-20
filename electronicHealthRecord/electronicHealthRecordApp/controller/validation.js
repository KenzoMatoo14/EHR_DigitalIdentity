// validation.js — validadores compartidos por los controllers del EHR (mismo papel que
// controller/utilities.js en birthCertificate). Cada función recibe el valor crudo del body y
// devuelve el valor listo para MySQL, o lanza ValidationError con un mensaje para el usuario.
//
// Los tipos siguen la columna "Tipo de dato / Tamaño" del Excel Norm04:
//   Texto VARCHAR(n) -> text   ·   Número DECIMAL(p,s) -> decimal   ·   Número INT -> integer
//   Booleano -> boolean        ·   Fecha -> date ('aaaa-mm-dd')     ·   Hora -> time ('hh:mm')

// Error de datos del usuario (400). Cualquier otro error (MySQL caído, bug) se responde como 500.
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

const isBlank = (value) => value === undefined || value === null || value === '';

// CURP = llave del paciente (Excel: Identificador CHAR(18)). Patrón oficial RENAPO; mismo que
// CURP_PATTERN en frontendElectronicHealthRecordApp/public/js/data/schema.js.
const CURP_PATTERN = /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;

function requiredCurp(value) {
  const curp = isBlank(value) ? '' : String(value).trim().toUpperCase();
  if (curp === '') throw new ValidationError('CURP es obligatoria.');
  if (curp.length !== 18 || !CURP_PATTERN.test(curp)) {
    throw new ValidationError('CURP: formato inválido (18 caracteres).');
  }
  return curp;
}

// Folio = ID institucional (Excel: Identificador VARCHAR(18)). Opcional. Se guarda como TEXTO, no
// número, para no perder ceros a la izquierda: "0263328" como número sería 263328.
const FOLIO_PATTERN = /^[A-Za-z0-9-]{1,18}$/;

function optionalFolio(value) {
  if (isBlank(value)) return null;
  const folio = String(value).trim().toUpperCase();
  if (folio === '') return null;
  if (!FOLIO_PATTERN.test(folio)) {
    throw new ValidationError('Folio (ID institucional): hasta 18 letras, dígitos o guiones.');
  }
  return folio;
}

function requiredText(value, label, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text === '') throw new ValidationError(`${label} es obligatorio.`);
  if (text.length > max) throw new ValidationError(`${label}: máximo ${max} caracteres.`);
  return text;
}

function optionalText(value, label, max, pattern, patternHint) {
  if (isBlank(value)) return null;
  const text = String(value).trim();
  if (text === '') return null;
  if (text.length > max) throw new ValidationError(`${label}: máximo ${max} caracteres.`);
  if (pattern && !pattern.test(text)) throw new ValidationError(`${label}: ${patternHint}.`);
  return text;
}

/** Rango clínico opcional (min/max del campo). */
function checkRange(number, label, min, max) {
  if ((min !== undefined && number < min) || (max !== undefined && number > max)) {
    throw new ValidationError(`${label}: debe estar entre ${min} y ${max}.`);
  }
  return number;
}

function optionalInteger(value, label, min, max) {
  if (isBlank(value)) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new ValidationError(`${label}: debe ser un entero mayor o igual a 0.`);
  }
  return checkRange(number, label, min, max);
}

// DECIMAL(p,s): como máximo s decimales y (p - s) dígitos enteros. Ej. DECIMAL(3,1) -> 0 a 99.9
function optionalDecimal(value, label, precision, scale, min, max) {
  if (isBlank(value)) return null;
  const text = String(value).trim();
  const pattern = new RegExp(`^\\d{1,${precision - scale}}(\\.\\d{1,${scale}})?$`);
  if (!pattern.test(text)) {
    throw new ValidationError(`${label}: número de hasta ${precision - scale} enteros y ${scale} decimales.`);
  }
  return checkRange(Number(text), label, min, max);
}

// "Sin dato" (null) ≠ "No" (false): no se afirma un negativo clínico que nadie preguntó.
function optionalBoolean(value, label) {
  if (isBlank(value)) return null;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new ValidationError(`${label}: debe ser true o false.`);
}

// Fecha de calendario real en formato 'aaaa-mm-dd'.
function optionalDate(value, label) {
  if (isBlank(value)) return null;
  const text = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) throw new ValidationError(`${label}: formato aaaa-mm-dd.`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new ValidationError(`${label}: no es una fecha calendario válida.`);
  }
  return text;
}

// Hora 'hh:mm' (24 h).
function optionalTime(value, label) {
  if (isBlank(value)) return null;
  const text = String(value).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) throw new ValidationError(`${label}: formato hh:mm (24 h).`);
  return text;
}

/**
 * Valida un campo descrito como { type, label, max, precision, scale, min, max, pattern, patternHint }.
 * (`max` es el tamaño del texto en los campos 'text' y el valor máximo en los numéricos.)
 * Es lo que permite declarar las 40+ columnas de la nota SOAP como una lista en lugar de
 * escribir una validación por campo.
 */
function validateField(field, value) {
  switch (field.type) {
    case 'text': return optionalText(value, field.label, field.max, field.pattern, field.patternHint);
    case 'integer': return optionalInteger(value, field.label, field.min, field.max);
    case 'decimal': return optionalDecimal(value, field.label, field.precision, field.scale, field.min, field.max);
    case 'boolean': return optionalBoolean(value, field.label);
    case 'date': return optionalDate(value, field.label);
    case 'time': return optionalTime(value, field.label);
    default: throw new Error(`Tipo de campo no soportado: ${field.type}`);
  }
}

/** Lee body.a.b siguiendo una ruta ['a', 'b']; undefined si algún nivel no existe. */
function getPath(object, path) {
  return path.reduce((current, key) => (current && typeof current === 'object' ? current[key] : undefined), object);
}

/** Escribe value en target.a.b creando los objetos intermedios. */
function setPath(target, path, value) {
  let current = target;
  path.slice(0, -1).forEach((key) => {
    if (!current[key]) current[key] = {};
    current = current[key];
  });
  current[path[path.length - 1]] = value;
}

/** Respuesta de error uniforme: 400 si es culpa de los datos, 500 si es del servidor. */
function sendError(res, error) {
  if (error instanceof ValidationError) {
    return res.status(400).json({ Result: 'Error', Description: error.message });
  }
  console.error(error);
  return res.status(500).json({ Result: 'Error', Description: 'Error interno del servicio EHR.' });
}

module.exports = {
  ValidationError,
  requiredCurp,
  optionalFolio,
  requiredText,
  optionalText,
  validateField,
  getPath,
  setPath,
  sendError,
};
