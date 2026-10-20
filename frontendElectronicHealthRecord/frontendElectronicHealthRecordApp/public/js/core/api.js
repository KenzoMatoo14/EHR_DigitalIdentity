/*
 * api.js — CAPA DE DATOS: parte REAL (MySQL vía Gateway) y parte SIMULADA (localStorage).
 *
 * Es el ÚNICO archivo que sabe de dónde salen los datos. Las páginas solo llaman a estas
 * funciones `async` y reciben objetos; nunca tocan localStorage ni fetch directamente.
 *
 *  · REAL (fetch '/api/...' -> server.js -> Gateway -> microservicio EHR -> MySQL), por CURP:
 *      registro del paciente, Ficha de identificación, Antecedentes y Notas SOAP de enfermería.
 *  · SIMULADO (localStorage): agenda, citas, llegada y la consulta del médico. El paciente local
 *      (id P-00x) guarda su `curp`, que es el enlace con MySQL.
 *
 * Cuando el resto tenga backend, se reemplaza el cuerpo de cada función por un fetch con el mismo
 * contrato (mismos argumentos, misma forma de respuesta) y ninguna página tiene que cambiar.
 *
 * Lo que sí se simula a propósito (para no aprender malos hábitos):
 *  - Cada función es async y puede lanzar ApiError, igual que una petición real.
 *  - Autorización por rol (requireRole): recepción/enfermería no puede leer las notas del médico;
 *    sí la ficha, los antecedentes y las notas SOAP de enfermería (camino "resuelto en enfermería").
 *  - Las notas clínicas son SOLO-AGREGAR (append-only): no existe editar ni borrar una nota.
 *    Es lo que exige un expediente y lo que después dará la blockchain (inmutabilidad).
 *  - Todo lo que sale se devuelve como copia (structuredClone): la página no puede mutar
 *    "la base de datos" por accidente.
 */

import { ROLES, STATUS, DURATION_OPTIONS, DEFAULT_DURATION_MIN, APPOINTMENT_TYPES, APPOINTMENT_STATUS } from './config.js';
import { store } from './store.js';
import { getSession } from './session.js';
import { isEmptyValue, normalizeText, fullName } from './util.js';
import { createSeedDatabase } from '../data/seed.js';
import { FICHA_FIELDS, FICHA_ROOT_KEYS, CURP_PATTERN } from '../data/schema.js';
import { CATALOGS } from '../data/catalogs.js';

const DB_KEY = 'db';
const DB_VERSION = 7; // sube si cambia la forma de los datos: la base vieja del navegador se regenera

export class ApiError extends Error {
  constructor(message, code = 'ERROR') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Persistencia interna
// ---------------------------------------------------------------------------

function saveDb(db) {
  if (!store.set(DB_KEY, db)) {
    throw new ApiError('No se pudo guardar: el almacenamiento del navegador está lleno o bloqueado.', 'STORAGE');
  }
}

/**
 * Carga la base; si no existe o es de otra versión, crea la base inicial (sin pacientes).
 * Ya NO se regenera al cambiar de día: antes eran datos demo y daba igual; ahora son pacientes y
 * citas reales y borrarlos cada mañana los perdería.
 */
function loadDb() {
  let db = store.get(DB_KEY, null);
  if (!db || db.version !== DB_VERSION) {
    db = { ...createSeedDatabase(), version: DB_VERSION };
    saveDb(db);
  }
  return db;
}

const clone = (value) => structuredClone(value);
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Autorización y utilidades
// ---------------------------------------------------------------------------

function requireRole(...roles) {
  const session = getSession();
  if (!session) throw new ApiError('Tu sesión expiró. Inicia sesión de nuevo.', 'UNAUTHENTICATED');
  if (!roles.includes(session.user.rol)) throw new ApiError('No tienes permiso para esta acción.', 'FORBIDDEN');
  return session.user;
}

function findVisit(db, folio) {
  const visit = db.visits.find((v) => v.folio === folio);
  if (!visit) throw new ApiError(`No existe la visita con folio ${folio}.`, 'NOT_FOUND');
  return visit;
}

function findPatient(db, patientId) {
  const patient = db.patients.find((p) => p.id === patientId);
  if (!patient) throw new ApiError('No existe ese paciente.', 'NOT_FOUND');
  return patient;
}

function assertState(visit, allowed, action) {
  if (!allowed.includes(visit.estado)) {
    throw new ApiError(`No se puede ${action}: la visita ${visit.folio || visit.id} está en estado "${visit.estado}".`, 'BAD_STATE');
  }
}

const visitTime = (visit) => new Date(visit.fechaHora || visit.llegadaAt).getTime();
const byTime = (a, b) => visitTime(a) - visitTime(b);

/** Paciente tal como lo puede ver `user`: recepción no recibe antecedentes clínicos. */
function viewPatient(patient, user) {
  const copy = clone(patient);
  if (user.rol !== ROLES.MEDICO) delete copy.antecedentes;
  return copy;
}

/** Visita + datos del paciente. El borrador clínico solo lo ve el médico. */
function enrich(db, visit, user) {
  const copy = clone(visit);
  copy.patient = viewPatient(findPatient(db, visit.patientId), user);
  if (user.rol !== ROLES.MEDICO) delete copy.consultaBorrador;
  return copy;
}

const nextFolio = (db) => `REC-${String(db.counters.folio++).padStart(4, '0')}`;

const requireText = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') throw new ApiError(`${label} es obligatorio.`, 'VALIDATION');
  return value.trim();
};

// ---------------------------------------------------------------------------
// Backend real (MySQL vía server.js -> Gateway -> microservicio EHR)
// ---------------------------------------------------------------------------

/**
 * Llama a una ruta `/api/...` de server.js. Devuelve el body si `Result` es "Success"; si no,
 * lanza ApiError con la `Description` del backend (código NOT_FOUND en 404, BACKEND en lo demás).
 * @param {'GET'|'POST'} method
 * @param {string} path p. ej. '/api/antecedentes'
 * @param {{ body?: object, curp?: string, query?: object }} [options] `curp` va como ?curp= en los
 *   GET; `query` agrega otros parámetros (p. ej. { q: 'gomez' }).
 */
async function backend(method, path, { body, curp, query } = {}) {
  const params = new URLSearchParams({ ...(curp ? { curp } : {}), ...(query || {}) });
  const url = params.toString() ? `${path}?${params}` : path;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkError) {
    throw new ApiError('No se pudo conectar con el servidor. Verifica que el API Gateway y el servicio de EHR estén activos.', 'NETWORK');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.Result !== 'Success') {
    throw new ApiError(data.Description || `Error del servidor (${response.status}).`, response.status === 404 ? 'NOT_FOUND' : 'BACKEND');
  }
  return data;
}

/** CURP del paciente o error claro si todavía no la tiene (es la llave en MySQL). */
function requirePatientCurp(patient) {
  if (!patient.curp) {
    throw new ApiError('Este paciente no tiene CURP. Captúrala en la pestaña "Ficha de datos" y guarda.', 'NO_CURP');
  }
  return patient.curp;
}

/** Valida una CURP escrita a mano (formato oficial, 18 caracteres). */
function validateCurp(value) {
  const curp = String(value || '').trim().toUpperCase();
  if (curp === '') throw new ApiError('La CURP es obligatoria.', 'VALIDATION');
  if (curp.length !== 18 || !CURP_PATTERN.test(curp)) {
    throw new ApiError('La CURP no tiene un formato válido (18 caracteres).', 'VALIDATION');
  }
  return curp;
}

// ---------------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------------

/** @returns {Promise<{token: string, user: object}>} */
export async function login(email, password) {
  const db = loadDb();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = db.users.find((u) => u.email === normalizedEmail && u.password === password);
  if (!user) throw new ApiError('Correo o contraseña incorrectos.', 'BAD_CREDENTIALS');
  const { password: _omit, ...publicUser } = user; // nunca devolver la contraseña
  return { token: `demo-${user.id}-${Date.now()}`, user: publicUser };
}

// ---------------------------------------------------------------------------
// Pacientes (recepción y médico)
// ---------------------------------------------------------------------------

/**
 * Busca pacientes por nombre, CURP o ID institucional en MySQL (GET /api/pacientes?q=) y, además,
 * en el navegador por No. de expediente o folio de visita (esos dos solo existen aquí). Sin texto
 * devuelve todos. Los pacientes que vienen de MySQL se agregan/actualizan en el navegador
 * (syncPatientsFromDb) para que el resto de la app (citas, expediente) los pueda usar.
 * Si el backend no responde, se busca solo en el navegador (no se interrumpe la búsqueda).
 */
export async function searchPatients(query = '') {
  const user = requireRole(ROLES.RECEPCION, ROLES.MEDICO);

  let fromDb = [];
  try {
    ({ pacientes: fromDb } = await backend('GET', '/api/pacientes', { query: { q: String(query).trim() } }));
  } catch (error) {
    console.warn('Búsqueda solo en el navegador; la base de datos no respondió:', error.message);
  }

  const db = loadDb();
  const dbIds = new Set(syncPatientsFromDb(db, fromDb));
  if (fromDb.length > 0) saveDb(db);

  const q = normalizeText(query);
  return db.patients
    .filter((p) => {
      if (q === '' || dbIds.has(p.id)) return true;
      const folios = db.visits.filter((v) => v.patientId === p.id).map((v) => v.folio || '').join(' ');
      return normalizeText(`${fullName(p)} ${p.curp || ''} ${p.idInstitucional || ''} ${p.expediente} ${folios}`).includes(q);
    })
    .sort((a, b) => fullName(a).localeCompare(fullName(b), 'es'))
    .map((p) => viewPatient(p, user));
}

export async function getPatient(patientId) {
  const user = requireRole(ROLES.RECEPCION, ROLES.MEDICO);
  const db = loadDb();
  return viewPatient(findPatient(db, patientId), user);
}

function validateBirth(birth) {
  const day = Number(birth && birth.dia);
  const month = Number(birth && birth.mes);
  const year = Number(birth && birth.anio);
  if (!day || !month || !year) throw new ApiError('La fecha de nacimiento es obligatoria (día, mes y año).', 'VALIDATION');
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new ApiError('La fecha de nacimiento no existe en el calendario.', 'VALIDATION');
  }
  if (date.getTime() > Date.now()) throw new ApiError('La fecha de nacimiento no puede ser futura.', 'VALIDATION');
  return { dia: day, mes: month, anio: year };
}

function validateSex(value) {
  const sex = requireText(value, 'El sexo biológico');
  if (!['Hombre', 'Mujer'].includes(sex)) throw new ApiError('Sexo biológico no válido.', 'VALIDATION');
  return sex;
}

// Sexo biológico del modal -> id del catálogo `sexo` del Excel (catalogs.js)
const SEXO_ID = { Hombre: 1, Mujer: 2 };
const pad2 = (number) => String(number).padStart(2, '0');

/**
 * Modal "Registrar nuevo paciente": obligatorios los campos marcados con * en el Figma + la CURP.
 * Guarda en MySQL lo que es del Excel (CURP, folio = ID institucional, nombre, apellidos, fecha de
 * nacimiento y sexo) y en el navegador el resto (teléfono, correo y tipo, que no son del Excel).
 */
export async function createPatient(payload) {
  requireRole(ROLES.RECEPCION);
  const db = loadDb();

  const tipo = payload.tipo === 'colaborador' ? 'colaborador' : 'alumno';
  const idInstitucional = (payload.idInstitucional || '').trim();

  // El orden de las validaciones sigue el orden visual del formulario (el primer error es el de más arriba)
  const nombre = requireText(payload.nombre, 'El nombre');
  const apellidoP = requireText(payload.apellidoP, 'El apellido paterno');
  const apellidoM = requireText(payload.apellidoM, 'El apellido materno');
  const fechaNacimiento = validateBirth(payload.fechaNacimiento);
  const sexoBiologico = validateSex(payload.sexoBiologico);
  const curp = validateCurp(payload.curp);

  if (db.patients.some((p) => p.curp === curp)) {
    throw new ApiError(`Ya existe un paciente con la CURP ${curp}.`, 'CONFLICT');
  }
  if (idInstitucional && db.patients.some((p) => p.idInstitucional === idInstitucional)) {
    throw new ApiError(`Ya existe un paciente con el ID institucional ${idInstitucional}.`, 'CONFLICT');
  }

  const local = {
    tipo,
    telefono: (payload.telefono || '').trim(),
    correo: (payload.correo || '').trim(),
  };

  // En MySQL guardar = "crear o actualizar" por CURP. Registrar NO debe pisar la ficha de alguien que
  // ya existe (registrado antes o desde otra computadora): en ese caso se AGREGA a este navegador con
  // los datos de la base, y lo capturado en el modal solo aporta lo local (teléfono, correo, tipo).
  const existing = await backend('GET', '/api/fichaIdentificacion', { curp }).catch((error) => {
    if (error.code === 'NOT_FOUND') return null;
    throw error;
  });
  if (existing) return addExistingPatient(db, existing.ficha, local);

  // Campos de la Ficha de identificación del Excel con la forma que espera el backend
  const ficha = {
    curp,
    fechaNacimiento: `${fechaNacimiento.anio}${pad2(fechaNacimiento.mes)}${pad2(fechaNacimiento.dia)}`,
    sexo: SEXO_ID[sexoBiologico],
  };
  if (idInstitucional) ficha.folio = idInstitucional;
  // Solo llega cuando los datos vinieron del acta de ChainIDentity (el modal no tiene ese campo)
  if (payload.entidadNacimiento) ficha.entidadNacimiento = Number(payload.entidadNacimiento);
  await backend('POST', '/api/fichaIdentificacion', { body: { ...ficha, nombre, apellidoP, apellidoM } });

  const patient = {
    id: `P-${String(db.counters.patient++).padStart(3, '0')}`,
    expediente: String(db.counters.expediente++), // autogenerado
    curp,
    idInstitucional,
    nombre,
    apellidoP,
    apellidoM,
    fechaNacimiento,
    sexoBiologico,
    ...local,
    fechaRegistro: nowIso(),
    alergias: '',
    ficha, // la "Ficha de datos" ya abre con CURP, folio, fecha y sexo llenos
    antecedentes: {},
  };
  db.patients.push(patient);
  saveDb(db);
  return clone(patient);
}

/**
 * Busca a la persona en ChainIDentity (acta de nacimiento en la blockchain) para PRELLENAR el
 * registro. No guarda nada; el registro sigue siendo createPatient.
 *   · { curp }            compara los 16 primeros caracteres de la CURP con los datos de cada acta
 *   · { idInstitucional } usa el StudentID que ChainIDentity vinculó al acta
 * La CURP nunca viene de ChainIDentity (no la tiene). Cada candidato trae `datos` (forma de la
 * ficha: nombre, apellidoP, apellidoM, fechaNacimiento aaaammdd, sexo id, entidadNacimiento id,
 * folio), `correo`, `contractAddress`, `curp16` y `avisos`.
 * @returns {Promise<object[]>} uno o más candidatos (más de uno = homónimos en los 16 caracteres)
 */
export async function lookupChainIdentity({ curp, idInstitucional }) {
  requireRole(ROLES.RECEPCION);
  const query = curp !== undefined
    ? { curp: validateCurp(curp) }
    : { idInstitucional: requireText(idInstitucional, 'El ID institucional') };
  const { candidatos } = await backend('GET', '/api/chainIdentity', { query });
  return candidatos;
}

/**
 * Copia a un paciente local los datos de su ficha en MySQL (la base es la fuente de verdad para
 * todo lo que es del Excel): CURP, folio = ID institucional, nombre, fecha, sexo y la ficha completa.
 * No toca lo que solo vive en el navegador (teléfono, correo, tipo, citas).
 */
function applyFicha(patient, ficha) {
  const digits = ficha.fechaNacimiento || '';
  const fichaLocal = {};
  for (const field of FICHA_STORED_FIELDS) {
    if (ficha[field.key] !== undefined) fichaLocal[field.key] = ficha[field.key];
  }
  Object.assign(patient, {
    curp: ficha.curp,
    idInstitucional: ficha.folio || '',
    nombre: ficha.nombre,
    apellidoP: ficha.apellidoP,
    apellidoM: ficha.apellidoM || '',
    fechaNacimiento: digits.length === 8
      ? { dia: Number(digits.slice(6, 8)), mes: Number(digits.slice(4, 6)), anio: Number(digits.slice(0, 4)) }
      : null,
    sexoBiologico: Object.keys(SEXO_ID).find((label) => SEXO_ID[label] === ficha.sexo) || '',
    ficha: fichaLocal,
  });
  return patient;
}

/** Paciente local NUEVO a partir de su ficha de MySQL (no lo guarda). */
function newPatientFromFicha(db, ficha, local = { tipo: 'alumno', telefono: '', correo: '' }) {
  return applyFicha({
    id: `P-${String(db.counters.patient++).padStart(3, '0')}`,
    expediente: String(db.counters.expediente++),
    ...local,
    fechaRegistro: nowIso(),
    alergias: '',
    antecedentes: {},
  }, ficha);
}

/**
 * Agrega a este navegador un paciente que ya existe en MySQL, con los datos de la base (no se
 * sobrescriben). Devuelve el paciente con `yaExistia: true` para que la pantalla lo avise.
 */
function addExistingPatient(db, ficha, local) {
  const patient = newPatientFromFicha(db, ficha, local);
  db.patients.push(patient);
  saveDb(db);
  return { ...clone(patient), yaExistia: true };
}

/**
 * Pone al día el paciente local de cada ficha de MySQL: si ya existe (misma CURP) actualiza sus datos
 * del Excel; si no, lo crea. Así un paciente registrado en otra computadora, o antes de limpiar el
 * navegador, aparece en las búsquedas y se le pueden agendar citas. Devuelve los ids locales.
 */
function syncPatientsFromDb(db, fichas) {
  return fichas.map((ficha) => {
    const existing = db.patients.find((p) => p.curp === ficha.curp);
    if (existing) return applyFicha(existing, ficha).id;
    const patient = newPatientFromFicha(db, ficha);
    db.patients.push(patient);
    return patient.id;
  });
}

/** Campos de la ficha que se guardan en `paciente.ficha` (los demás viven en la raíz del paciente). */
const FICHA_STORED_FIELDS = FICHA_FIELDS.filter((field) => !FICHA_ROOT_KEYS.includes(field.key));

/** Valida un valor de la ficha contra su definición en el Excel (tipo, tamaño, catálogo). */
function validateFichaValue(field, value) {
  switch (field.type) {
    case 'identifier': { // CURP
      const curp = String(value).trim().toUpperCase();
      if (curp.length !== field.length || !field.pattern.test(curp)) {
        throw new ApiError(`${field.label}: ${field.patternHint}.`, 'VALIDATION');
      }
      return curp;
    }
    case 'text': {
      const text = String(value).trim();
      if (text.length > field.max) throw new ApiError(`${field.label}: máximo ${field.max} caracteres.`, 'VALIDATION');
      if (field.pattern && !field.pattern.test(text)) {
        throw new ApiError(`${field.label}: ${field.patternHint || 'formato inválido'}.`, 'VALIDATION');
      }
      return text;
    }
    case 'catalog': {
      const id = Number(value);
      if (!(CATALOGS[field.catalog] || []).some((item) => item.id === id)) {
        throw new ApiError(`${field.label}: opción no válida.`, 'VALIDATION');
      }
      return id;
    }
    case 'date8': { // aaaammdd (8 dígitos), como lo guarda el formulario (formRenderer.js)
      const digits = String(value).trim();
      if (!/^\d{8}$/.test(digits)) throw new ApiError(`${field.label}: fecha inválida.`, 'VALIDATION');
      return digits;
    }
    default:
      throw new ApiError(`Tipo de campo de ficha no soportado: ${field.type}`, 'VALIDATION');
  }
}

/**
 * Ficha de datos del paciente para la pestaña "Ficha de datos": la de MySQL si el paciente ya tiene
 * CURP y existe allá; si no, la copia local. Devuelve valores planos con la forma de FICHA_FIELDS
 * (catálogos como id numérico), listos para formRenderer.
 * @returns {Promise<{ values: object, source: 'mysql'|'local' }>}
 */
export async function getPatientFicha(patientId) {
  requireRole(ROLES.RECEPCION, ROLES.MEDICO);
  const patient = findPatient(loadDb(), patientId);
  const local = { nombre: patient.nombre, apellidoP: patient.apellidoP, apellidoM: patient.apellidoM, ...patient.ficha };
  if (!patient.curp) return { values: local, source: 'local' };

  try {
    const { ficha } = await backend('GET', '/api/fichaIdentificacion', { curp: patient.curp });
    const values = {};
    for (const field of FICHA_FIELDS) {
      if (ficha[field.key] !== undefined) values[field.key] = ficha[field.key];
    }
    return { values, source: 'mysql' };
  } catch (error) {
    if (error.code === 'NOT_FOUND') return { values: local, source: 'local' }; // aún no se guarda allá
    throw error;
  }
}

/**
 * Pestaña "Ficha de datos". `values` es plano y solo puede traer los campos de FICHA_FIELDS
 * (Excel Norm04: los 12 de FichaIdentificacion + grupoEtnico). Lo que no venga (o venga vacío) se
 * borra de la ficha. La CURP es obligatoria (llave en MySQL) y, una vez guardada, no se puede
 * cambiar: cambiarla crearía otro paciente y dejaría sus antecedentes y notas en el anterior.
 */
export async function updatePatientFicha(patientId, values) {
  const user = requireRole(ROLES.RECEPCION, ROLES.MEDICO);
  const db = loadDb();
  const patient = findPatient(db, patientId);

  const curp = validateCurp(values.curp);
  if (patient.curp && patient.curp !== curp) {
    throw new ApiError(`La CURP de este paciente ya es ${patient.curp} y no se puede cambiar.`, 'VALIDATION');
  }
  if (db.patients.some((p) => p.id !== patient.id && p.curp === curp)) {
    throw new ApiError(`Otro paciente ya tiene la CURP ${curp}.`, 'CONFLICT');
  }

  const nombre = requireText(values.nombre, 'El nombre');
  const apellidoP = requireText(values.apellidoP, 'El apellido paterno');
  const apellidoM = String(values.apellidoM || '').trim();

  const ficha = {};
  for (const field of FICHA_STORED_FIELDS) {
    const value = values[field.key];
    if (value === undefined || value === null || value === '') continue;
    ficha[field.key] = validateFichaValue(field, value);
  }

  // El backend valida de nuevo (es la fuente de verdad) y guarda en MySQL por CURP.
  await backend('POST', '/api/fichaIdentificacion', { body: { ...ficha, nombre, apellidoP, apellidoM } });

  patient.curp = curp;
  patient.nombre = nombre;
  patient.apellidoP = apellidoP;
  patient.apellidoM = apellidoM;
  if (ficha.folio) patient.idInstitucional = ficha.folio; // folio = ID institucional
  patient.ficha = ficha; // reemplazo completo: lo que se borra en pantalla se borra de verdad
  patient.actualizadoAt = nowIso();
  saveDb(db);
  return viewPatient(patient, user);
}

/** Quita del objeto del backend lo que no es del Excel (curp, fechas de la tabla). */
function withoutMeta({ curp, actualizadoEn, creadoEn, ...data }) {
  return data;
}

/**
 * Pestaña "Antecedentes" (recepción/enfermería y médico): antecedentes del paciente en MySQL.
 * Devuelve {} si todavía no tiene.
 */
export async function getAntecedentes(patientId) {
  requireRole(ROLES.RECEPCION, ROLES.MEDICO);
  const patient = findPatient(loadDb(), patientId);
  const curp = requirePatientCurp(patient);
  try {
    const { antecedentes } = await backend('GET', '/api/antecedentes', { curp });
    return withoutMeta(antecedentes);
  } catch (error) {
    if (error.code === 'NOT_FOUND') return {};
    throw error;
  }
}

/** Guarda (reemplaza) los antecedentes del paciente en MySQL; deja una copia local para el médico. */
export async function updateAntecedentes(patientId, antecedentes) {
  requireRole(ROLES.RECEPCION, ROLES.MEDICO);
  const db = loadDb();
  const patient = findPatient(db, patientId);
  const curp = requirePatientCurp(patient);

  const saved = await backend('POST', '/api/antecedentes', { body: { curp, ...antecedentes } });

  patient.antecedentes = withoutMeta(saved.antecedentes);
  patient.actualizadoAt = nowIso();
  saveDb(db);
  return clone(patient.antecedentes);
}

// ---------------------------------------------------------------------------
// Notas SOAP de enfermería (pestaña "Consultas" para recepción/enfermería) — MySQL
// ---------------------------------------------------------------------------

/** Notas SOAP del paciente, la más reciente primero. Cada una: { id, fechaServicio, horaServicio, creadoEn, data }. */
export async function listSoapNotes(patientId) {
  requireRole(ROLES.RECEPCION, ROLES.MEDICO);
  const patient = findPatient(loadDb(), patientId);
  const { notas } = await backend('GET', '/api/notaSoap', { curp: requirePatientCurp(patient) });
  return notas.map(({ id, fechaServicio, horaServicio, creadoEn, curp, ...data }) => ({ id, fechaServicio, horaServicio, creadoEn, data }));
}

/**
 * Agrega una nota SOAP (solo-agregar: no hay editar ni borrar). `values` = lo que leyó formRenderer
 * de los paneles (nombres y objetos del Excel). La fecha y hora del servicio las pone el backend.
 */
export async function createSoapNote(patientId, values) {
  requireRole(ROLES.RECEPCION, ROLES.MEDICO);
  const patient = findPatient(loadDb(), patientId);
  if (isEmptyValue(values)) throw new ApiError('La nota está vacía: captura al menos un dato.', 'VALIDATION');
  const { nota } = await backend('POST', '/api/notaSoap', { body: { curp: requirePatientCurp(patient), ...values } });
  return nota;
}

// ---------------------------------------------------------------------------
// Agenda y citas (recepción)
// ---------------------------------------------------------------------------

/** Todas las visitas y citas de hoy, ordenadas por horario, con los datos del paciente. */
export async function listAgenda() {
  const user = requireRole(ROLES.RECEPCION);
  const db = loadDb();
  return db.visits.map((v) => enrich(db, v, user)).sort(byTime);
}

/**
 * Modal "Cita Edición": crea o modifica una cita.
 * payload = { id?, fechaHora (ISO), duracionMin, patientId, tipoCita, estatusCita, notasCita }
 */
export async function saveAppointment(payload) {
  const user = requireRole(ROLES.RECEPCION);
  const db = loadDb();

  const patient = findPatient(db, requireText(payload.patientId, 'El paciente'));
  const start = new Date(payload.fechaHora);
  if (Number.isNaN(start.getTime())) throw new ApiError('La fecha y hora de la cita no son válidas.', 'VALIDATION');
  const duracionMin = Number(payload.duracionMin);
  if (!DURATION_OPTIONS.includes(duracionMin)) throw new ApiError('Duración no válida.', 'VALIDATION');
  const tipoCita = payload.tipoCita || '';
  if (!APPOINTMENT_TYPES.some((t) => t.id === tipoCita)) throw new ApiError('Tipo de cita no válido.', 'VALIDATION');
  const estatusCita = payload.estatusCita || 'por_confirmar';
  if (!APPOINTMENT_STATUS.some((s) => s.id === estatusCita)) throw new ApiError('Estatus de cita no válido.', 'VALIDATION');

  const data = {
    patientId: patient.id,
    fechaHora: start.toISOString(),
    duracionMin,
    tipoCita,
    estatusCita,
    notasCita: (payload.notasCita || '').trim(),
  };

  let visit;
  if (payload.id) {
    visit = db.visits.find((v) => v.id === payload.id);
    if (!visit) throw new ApiError('No existe esa cita.', 'NOT_FOUND');
    assertState(visit, [STATUS.AGENDADO, STATUS.NO_SE_PRESENTO], 'modificar la cita');
    Object.assign(visit, data);
    visit.estado = STATUS.AGENDADO; // guardar una cita "no presentada" la reagenda
  } else {
    visit = {
      id: `V-${String(db.counters.visit++).padStart(3, '0')}`,
      folio: null, llegadaAt: null, motivo: 'Consulta general', estado: STATUS.AGENDADO,
      consulta: null, resultado: '', ...data,
    };
    db.visits.push(visit);
  }
  saveDb(db);
  return enrich(db, visit, user);
}

/** Elimina una cita que todavía no se atendió (agendada o no presentada). */
export async function deleteAppointment(visitId) {
  requireRole(ROLES.RECEPCION);
  const db = loadDb();
  const index = db.visits.findIndex((v) => v.id === visitId);
  if (index === -1) throw new ApiError('No existe esa cita.', 'NOT_FOUND');
  assertState(db.visits[index], [STATUS.AGENDADO, STATUS.NO_SE_PRESENTO], 'eliminar la cita');
  db.visits.splice(index, 1);
  saveDb(db);
}

/** Marca la llegada de un paciente agendado: se le asigna folio y queda esperando al médico. */
export async function registerArrival(visitId) {
  const user = requireRole(ROLES.RECEPCION);
  const db = loadDb();
  const visit = db.visits.find((v) => v.id === visitId);
  if (!visit) throw new ApiError('No existe esa cita.', 'NOT_FOUND');
  assertState(visit, [STATUS.AGENDADO], 'registrar la llegada');

  visit.folio = nextFolio(db);
  visit.llegadaAt = nowIso();
  visit.estado = STATUS.ESPERANDO_MEDICO;
  saveDb(db);
  return enrich(db, visit, user);
}

/** @param {string} folio */
export async function getVisit(folio) {
  const user = requireRole(ROLES.RECEPCION, ROLES.MEDICO);
  const db = loadDb();
  return enrich(db, findVisit(db, folio), user);
}

// ---------------------------------------------------------------------------
// Médico
// ---------------------------------------------------------------------------

export async function listDoctorAgenda() {
  const user = requireRole(ROLES.MEDICO);
  const db = loadDb();
  const derived = db.visits
    .filter((v) => [STATUS.ESPERANDO_MEDICO, STATUS.EN_CONSULTA, STATUS.CONSULTA_CERRADA].includes(v.estado))
    .sort(byTime)
    .map((v) => enrich(db, v, user));
  return {
    pending: derived.filter((v) => v.estado !== STATUS.CONSULTA_CERRADA),
    attended: derived.filter((v) => v.estado === STATUS.CONSULTA_CERRADA),
  };
}

export async function startConsulta(folio) {
  const user = requireRole(ROLES.MEDICO);
  const db = loadDb();
  const visit = findVisit(db, folio);
  assertState(visit, [STATUS.ESPERANDO_MEDICO, STATUS.EN_CONSULTA], 'iniciar la consulta');
  if (visit.estado === STATUS.ESPERANDO_MEDICO) {
    visit.estado = STATUS.EN_CONSULTA;
    saveDb(db);
  }
  return enrich(db, visit, user);
}

/**
 * "Agregar consulta" (botón de la agenda del médico): abre una consulta para CUALQUIER paciente, sin
 * cita previa. Crea la visita con folio y la deja "con el médico". Si el paciente ya tiene una visita
 * abierta (esperando médico o en consulta) se reutiliza esa, para no duplicar folios.
 * `motivo` es opcional (por defecto "Consulta general").
 */
export async function startWalkInConsulta(patientId, motivo = '') {
  const user = requireRole(ROLES.MEDICO);
  const db = loadDb();
  const patient = findPatient(db, patientId);
  const reason = String(motivo).trim();

  let visit = db.visits.find((v) => v.patientId === patient.id && [STATUS.ESPERANDO_MEDICO, STATUS.EN_CONSULTA].includes(v.estado));
  if (visit) {
    visit.estado = STATUS.EN_CONSULTA;
    if (reason) visit.motivo = reason;
  } else {
    const now = nowIso();
    visit = {
      id: `V-${String(db.counters.visit++).padStart(3, '0')}`,
      folio: nextFolio(db),
      patientId: patient.id,
      fechaHora: now, llegadaAt: now, duracionMin: DEFAULT_DURATION_MIN,
      tipoCita: '', estatusCita: 'confirmada', notasCita: '',
      motivo: reason || 'Consulta general',
      consulta: null, resultado: '', estado: STATUS.EN_CONSULTA,
    };
    db.visits.push(visit);
  }
  saveDb(db);
  return enrich(db, visit, user);
}

/** Guarda un borrador de la consulta (aún no genera notas del expediente). */
export async function saveConsultaDraft(folio, draft) {
  const user = requireRole(ROLES.MEDICO);
  const db = loadDb();
  const visit = findVisit(db, folio);
  assertState(visit, [STATUS.EN_CONSULTA], 'guardar el borrador');
  visit.consultaBorrador = { ...clone(draft), guardadoAt: nowIso() };
  saveDb(db);
  return enrich(db, visit, user);
}

const MAIN_NOTE_TYPES = ['historiaClinica', 'evolucion', 'urgencias'];

/**
 * FichaIdentificacion completa (Excel, hoja Objetos) copiada de la "Ficha de datos": no se recaptura.
 * Solo se incluyen los campos que tienen valor.
 */
function buildFichaID(patient) {
  const fichaID = { nombre: patient.nombre, apellidoP: patient.apellidoP };
  if (patient.apellidoM) fichaID.apellidoM = patient.apellidoM;
  for (const field of FICHA_STORED_FIELDS) {
    if (field.key !== 'grupoEtnico' && patient.ficha && patient.ficha[field.key] !== undefined) {
      fichaID[field.key] = patient.ficha[field.key];
    }
  }
  return fichaID;
}

/**
 * Cierra la consulta: crea las notas del expediente (append-only) y marca la visita como cerrada.
 * payload = {
 *   tipoNota,                       // 'historiaClinica' | 'evolucion' | 'urgencias'
 *   nota,                           // datos de la nota principal (forma del esquema)
 *   alergias,                       // "Alergias (notas importantes)": dato del paciente, no de la nota
 *   interconsulta, referencia,      // datos de las notas 6.3 / 6.4, o null si no aplican
 *   urgenciaTraslado,               // 'observacion' | 'por_su_cuenta' | ''
 *   tratamiento,                    // manejo institucional (medicamento, RPBI, SUIVE, indicaciones)
 * }
 */
export async function closeConsulta(folio, payload) {
  const user = requireRole(ROLES.MEDICO);
  const db = loadDb();
  const visit = findVisit(db, folio);
  assertState(visit, [STATUS.EN_CONSULTA], 'cerrar la consulta');
  const patient = findPatient(db, visit.patientId);

  if (!MAIN_NOTE_TYPES.includes(payload.tipoNota)) throw new ApiError('Tipo de nota no válido.', 'VALIDATION');
  if (isEmptyValue(payload.nota)) {
    throw new ApiError('La nota clínica no puede estar vacía: captura al menos un dato.', 'VALIDATION');
  }
  const indicaciones = requireText(payload.tratamiento && payload.tratamiento.indicacionesPaciente, 'Las indicaciones para el paciente');

  const createdAt = nowIso();
  const notaIds = [];
  const addNote = (tipo, data) => {
    const id = `N-${String(db.counters.note++).padStart(3, '0')}`;
    db.notes.push({ id, patientId: visit.patientId, folio: visit.folio, tipo, createdAt, autor: user.nombre, data: clone(data) });
    notaIds.push(id);
  };

  const mainData = clone(payload.nota);
  if (payload.tipoNota === 'historiaClinica') {
    mainData.fichaID = buildFichaID(patient);
    if (patient.ficha && typeof patient.ficha.grupoEtnico === 'number') mainData.grupoEtnico = patient.ficha.grupoEtnico;
  }
  addNote(payload.tipoNota, mainData);

  const hasInterconsulta = !isEmptyValue(payload.interconsulta);
  const hasReferencia = !isEmptyValue(payload.referencia);
  if (hasInterconsulta) addNote('interconsulta', payload.interconsulta);
  if (hasReferencia) addNote('referencia', payload.referencia);

  let resultado = 'Cerrado';
  if (hasReferencia) {
    const receptor = payload.referencia.establecimientoReceptor;
    resultado = receptor ? `Referido a ${receptor}` : 'Referido';
  } else if (hasInterconsulta) {
    resultado = 'Interconsulta con psicología';
  }

  if (typeof payload.alergias === 'string') patient.alergias = payload.alergias.trim();

  visit.consulta = {
    tipoNota: payload.tipoNota,
    notaIds,
    interconsulta: hasInterconsulta,
    referencia: hasReferencia,
    urgenciaTraslado: payload.urgenciaTraslado || '',
    tratamiento: { ...clone(payload.tratamiento), indicacionesPaciente: indicaciones },
    medico: user.nombre,
    cerradaAt: createdAt,
  };
  visit.resultado = resultado;
  visit.estado = STATUS.CONSULTA_CERRADA;
  delete visit.consultaBorrador;
  saveDb(db);
  return enrich(db, visit, user);
}

/** Expediente completo de un paciente: notas (más recientes primero) y visitas. */
export async function getPatientRecord(patientId) {
  const user = requireRole(ROLES.MEDICO);
  const db = loadDb();
  const patient = findPatient(db, patientId);
  return {
    patient: viewPatient(patient, user),
    notes: clone(db.notes.filter((n) => n.patientId === patientId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    visits: db.visits.filter((v) => v.patientId === patientId && v.folio).sort((a, b) => visitTime(b) - visitTime(a)).map((v) => enrich(db, v, user)),
  };
}

