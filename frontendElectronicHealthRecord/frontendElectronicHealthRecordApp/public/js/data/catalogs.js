/*
 * catalogs.js — catálogos de campos tipo "Catálogo" del Excel (Norm04).
 *
 * ATENCIÓN: en la interfaz cada opción se identifica con un `id` NUMÉRICO (para reutilizar el
 * mismo <select> y validación que cualquier otro campo tipo 'catalog'), aunque el Excel guarde
 * el campo como CHAR/VARCHAR (p. ej. entidad = CHAR(2), nacionalidad = VARCHAR(3)): esa
 * conversión id -> código la hace el backend (electronicHealthRecord/electronicHealthRecordApp)
 * al guardar. `entidad` usa el código oficial INEGI; `sexo`, `nacionalidad` y `grupoEtnico`
 * son PROVISIONALES y deben sustituirse por los catálogos oficiales antes de usarse en serio.
 */

export const CATALOGS = Object.freeze({
  // Códigos oficiales INEGI de entidad federativa (2 dígitos). El id numérico coincide con el
  // código: id 9 -> CHAR(2) "09". Se usa para entidadNacimiento y entidadResidencia.
  // id 33 no es INEGI: convención propia para "nacido/reside en el extranjero" (el backend lo
  // guarda como "99", ver electronicHealthRecord/electronicHealthRecordApp).
  entidad: [
    { id: 1, label: 'Aguascalientes' },
    { id: 2, label: 'Baja California' },
    { id: 3, label: 'Baja California Sur' },
    { id: 4, label: 'Campeche' },
    { id: 5, label: 'Coahuila' },
    { id: 6, label: 'Colima' },
    { id: 7, label: 'Chiapas' },
    { id: 8, label: 'Chihuahua' },
    { id: 9, label: 'Ciudad de México' },
    { id: 10, label: 'Durango' },
    { id: 11, label: 'Guanajuato' },
    { id: 12, label: 'Guerrero' },
    { id: 13, label: 'Hidalgo' },
    { id: 14, label: 'Jalisco' },
    { id: 15, label: 'México' },
    { id: 16, label: 'Michoacán' },
    { id: 17, label: 'Morelos' },
    { id: 18, label: 'Nayarit' },
    { id: 19, label: 'Nuevo León' },
    { id: 20, label: 'Oaxaca' },
    { id: 21, label: 'Puebla' },
    { id: 22, label: 'Querétaro' },
    { id: 23, label: 'Quintana Roo' },
    { id: 24, label: 'San Luis Potosí' },
    { id: 25, label: 'Sinaloa' },
    { id: 26, label: 'Sonora' },
    { id: 27, label: 'Tabasco' },
    { id: 28, label: 'Tamaulipas' },
    { id: 29, label: 'Tlaxcala' },
    { id: 30, label: 'Veracruz' },
    { id: 31, label: 'Yucatán' },
    { id: 32, label: 'Zacatecas' },
    { id: 33, label: 'Extranjero' },
  ],
  sexo: [
    { id: 1, label: 'Hombre' },
    { id: 2, label: 'Mujer' },
  ],
  // VARCHAR(3): lista PROVISIONAL (falta el catálogo oficial de nacionalidades). El backend
  // guarda el código de 3 letras correspondiente (ver electronicHealthRecordApp).
  nacionalidad: [
    { id: 1, label: 'Mexicana' },
    { id: 2, label: 'Extranjera' },
  ],
  grupoEtnico: [
    { id: 0, label: 'No pertenece a un grupo étnico' },
    { id: 1, label: 'Pueblo indígena' },
    { id: 2, label: 'Afrodescendiente' },
    { id: 3, label: 'Otro' },
    { id: 4, label: 'Prefiere no decir' },
  ],
});

/** Busca la etiqueta de un id de catálogo. Devuelve el propio id si no existe. */
export function catalogLabel(catalogName, id) {
  const entry = (CATALOGS[catalogName] || []).find((item) => item.id === id);
  return entry ? entry.label : String(id);
}

// ---------- Catálogos propios de la interfaz (no vienen del Excel) ----------

// Manejo/resolución que decide el médico al cerrar la consulta
export const MANAGEMENT_OPTIONS = Object.freeze([
  { id: 'medicamento', label: 'Medicamento en sitio' },
  { id: 'referencia', label: 'Referencia externa' },
  { id: 'estudio', label: 'Estudio solicitado' },
  { id: 'ninguno', label: 'Sin manejo adicional' },
]);

// Padecimientos de notificación obligatoria (NOM-017 / SUIVE) — catálogo de referencia
export const NOTIFIABLE_DISEASES = Object.freeze([
  'Dengue', 'Sarampión', 'COVID-19', 'Picadura de alacrán', 'Otro',
]);

// Qué hace el paciente si hay una urgencia real que requiere traslado
export const TRANSFER_OPTIONS = Object.freeze([
  { id: 'observacion', label: 'Observación en sitio, espera ambulancia / familiar' },
  { id: 'por_su_cuenta', label: 'Se retira por su cuenta' },
]);
