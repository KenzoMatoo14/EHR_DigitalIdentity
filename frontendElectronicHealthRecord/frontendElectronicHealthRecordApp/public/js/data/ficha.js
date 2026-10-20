/*
 * ficha.js — listas para el selector de fecha de nacimiento del modal "Registrar nuevo paciente".
 *
 * La "Ficha de datos" del paciente YA NO se define aquí: sus campos salen del Excel Norm04
 * (FICHA_FIELDS en data/schema.js).
 */

export const MONTH_NAMES = Object.freeze([
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]);

/** Años para el selector de fecha de nacimiento: del año actual hacia atrás (120 años). */
export function birthYears() {
  const current = new Date().getFullYear();
  return Array.from({ length: 121 }, (_, i) => current - i);
}
