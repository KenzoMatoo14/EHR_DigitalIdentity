/*
 * config.js — constantes compartidas. Un solo lugar en vez de "strings mágicos" repartidos.
 * Se exportan como módulo ES: quien las necesita hace `import { ... } from '/js/core/config.js'`.
 * (Esto reemplaza a las variables `global.*` del backend original: dependencias explícitas.)
 */

export const ROLES = Object.freeze({
  RECEPCION: 'recepcion', // Recepción / Enfermería
  MEDICO: 'medico',       // Médico general
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.RECEPCION]: 'Recepción / Enfermería',
  [ROLES.MEDICO]: 'Médico general',
});

// Página de inicio de cada rol (rutas definidas en server.js)
export const HOME_BY_ROLE = Object.freeze({
  [ROLES.RECEPCION]: '/recepcion',
  [ROLES.MEDICO]: '/medico',
});

// Estados de una visita (folio): agendado -> llegó (esperando médico) -> consulta -> cerrada.
// (El triage del BPMN quedó fuera por ahora: la llegada pasa directo a "esperando médico".)
export const STATUS = Object.freeze({
  AGENDADO: 'agendado',
  ESPERANDO_MEDICO: 'esperando_medico',
  EN_CONSULTA: 'en_consulta',
  CONSULTA_CERRADA: 'consulta_cerrada',
  NO_SE_PRESENTO: 'no_se_presento',
});

// Etiqueta y variante de color (clases `.fig-badge` de app.css) por estado
export const STATUS_META = Object.freeze({
  [STATUS.AGENDADO]:           { label: 'Agendado',              tone: '' },
  [STATUS.ESPERANDO_MEDICO]:   { label: 'Esperando médico',      tone: 'warn' },
  [STATUS.EN_CONSULTA]:        { label: 'Con el médico',         tone: '' },
  [STATUS.CONSULTA_CERRADA]:   { label: 'Consulta cerrada',      tone: 'ok' },
  [STATUS.NO_SE_PRESENTO]:     { label: 'No se presentó',        tone: 'bad' },
});

export const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 h, igual que el JWT del frontend original

// ---------- Agenda (frame "Main" del Figma: filas de 5 minutos) ----------
export const SLOT_MINUTES = 5;        // paso de la rejilla de horarios
export const AGENDA_START_HOUR = 7;   // primera fila: 07:00
export const AGENDA_END_HOUR = 15;    // última fila: 14:55 (el Figma no define el fin de jornada)
export const DEFAULT_DURATION_MIN = 30; // valor por defecto en "Cita Edición"
export const DURATION_OPTIONS = Object.freeze([5, 10, 15, 20, 30, 45, 60]);

// ---------- Campos del modal "Cita Edición" ----------
// El Figma solo muestra los valores por defecto ("Tipo de cita sin indicar", "Cita por confirmar");
// el resto de las opciones son propuesta mía y están por confirmar.
export const APPOINTMENT_TYPES = Object.freeze([
  { id: '', label: 'Tipo de cita sin indicar' },
  { id: 'primera_vez', label: 'Primera vez' },
  { id: 'subsecuente', label: 'Subsecuente' },
  { id: 'urgencia', label: 'Urgencia' },
]);
export const APPOINTMENT_STATUS = Object.freeze([
  { id: 'por_confirmar', label: 'Cita por confirmar' },
  { id: 'confirmada', label: 'Cita confirmada' },
]);

// Prefijo de las llaves de localStorage, para no chocar con otras apps en el mismo origen
export const STORAGE_PREFIX = 'ece.';
