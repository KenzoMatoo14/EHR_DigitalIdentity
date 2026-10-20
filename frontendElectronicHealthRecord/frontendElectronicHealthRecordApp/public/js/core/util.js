/*
 * util.js — funciones puras sin dependencias (ni DOM ni almacenamiento), compartidas por
 * la capa de datos (api.js) y por el renderizador de formularios.
 */

/** true si el valor está vacío: undefined/null/'' o un objeto cuyos valores están todos vacíos. */
export function isEmptyValue(value) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value === 'object') return Object.values(value).every(isEmptyValue);
  return false;
}

/** Fecha local en formato AAAA-MM-DD (para comparar "el mismo día" sin líos de zona horaria). */
export function localDayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Normaliza texto para búsquedas: minúsculas y sin acentos. */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** "Sofía Ramírez Torres" a partir de un paciente. */
export function fullName(patient) {
  return [patient.nombre, patient.apellidoP, patient.apellidoM].filter(Boolean).join(' ');
}

/** Tipo de paciente tal como lo muestra la agenda del Figma: "Alumno" o "Colaborador". */
export function patientKind(patient) {
  return patient.tipo === 'alumno' ? 'Alumno' : 'Colaborador';
}
