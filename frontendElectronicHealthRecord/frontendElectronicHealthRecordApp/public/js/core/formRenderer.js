/*
 * formRenderer.js — genera formularios, valida y pinta vistas de solo lectura A PARTIR DEL ESQUEMA
 * (data/schema.js). Es lo que convierte el Excel Norm04 en pantallas sin escribir un <input>
 * por cada campo.
 *
 * API (todas reciben una LISTA PLANA de campos del esquema):
 *   renderFields(contenedor, campos, valores, opciones)   -> dibuja los controles
 *   readValues(contenedor, campos)                        -> lee lo capturado como objeto anidado
 *   validateForm(contenedor, campos)                      -> valida tipos/tamaños y marca errores
 *   renderView(contenedor, secciones, valores)            -> vista de solo lectura por secciones
 *
 * Convenciones:
 *  - Cada control lleva `data-path="signosVitales.temperatura"` (ruta dentro del objeto de datos).
 *    Con esa ruta se lee de vuelta el valor y se ubica el mensaje de error.
 *  - "Sin dato" ≠ "No": los booleanos son un <select> de 3 opciones (Sin dato / Sí / No) para no
 *    afirmar un negativo clínico ("no fuma") que nadie preguntó. Un campo vacío NO se guarda.
 *  - Ningún campo es obligatorio a nivel de esquema (el Excel no lo define); la página decide
 *    si exige que la nota tenga al menos un dato.
 */

import { CATALOGS, catalogLabel } from '../data/catalogs.js';
import { getObjectFields, decimalMax } from '../data/schema.js';
import { escapeHtml, CTL } from './ui.js';
import { isEmptyValue } from './util.js';

// `prefix` evita ids repetidos cuando dos formularios de la misma página comparten un campo
// (p. ej. `consumoSustancias` en la nota principal y en la referencia).
const idFor = (path, prefix = '') => `${prefix}f-${path.replace(/\./g, '-')}`;

/** true si el objeto de datos tiene al menos un dato capturado (recursivo). */
export const hasContent = (values) => !isEmptyValue(values);

const isTextarea = (field) => field.type === 'text' && field.max > 100;

// ---------------------------------------------------------------------------
// Render de formulario
// ---------------------------------------------------------------------------

/** "20050614" (aaaammdd, como se guarda) -> "2005-06-14" (como lo pide <input type="date">). */
const date8ToIso = (value) => {
  const digits = String(value || '');
  return digits.length === 8 ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : '';
};

function controlHtml(field, path, value, prefix) {
  const id = idFor(path, prefix);
  const base = `id="${id}" name="${escapeHtml(path)}" data-path="${escapeHtml(path)}"`;
  const raw = value === undefined || value === null ? '' : String(value);

  switch (field.type) {
    // Numérico CHAR(8) del Excel (aaaammdd); se captura como fecha para mejor UX.
    case 'date8':
      return `<input type="date" ${base} value="${escapeHtml(date8ToIso(raw))}" class="${CTL}">`;

    case 'text':
      if (isTextarea(field)) {
        const rows = field.rows || (field.max > 500 ? 4 : 3);
        return `<textarea ${base} rows="${rows}" maxlength="${field.max}" data-max="${field.max}" class="${CTL}">${escapeHtml(raw)}</textarea>
                <div class="fig-counter" data-counter-for="${escapeHtml(path)}">${raw.length}/${field.max}</div>`;
      }
      return `<input type="text" ${base} maxlength="${field.max}" value="${escapeHtml(raw)}"
                placeholder="${escapeHtml(field.placeholder || '')}" class="${CTL}">`;

    case 'identifier':
      return `<input type="text" ${base} maxlength="${field.length}" value="${escapeHtml(raw)}"
                autocomplete="off" spellcheck="false" class="${CTL}" style="text-transform:uppercase">`;

    case 'integer':
      return `<input type="number" ${base} step="1" min="${field.min ?? 0}" ${field.max !== undefined ? `max="${field.max}"` : ''}
                inputmode="numeric" value="${escapeHtml(raw)}" placeholder="${escapeHtml(field.placeholder || '')}" class="${CTL}">`;

    case 'decimal':
      return `<input type="number" ${base} step="${10 ** -field.scale}" min="${field.min ?? 0}" max="${field.max ?? decimalMax(field)}"
                inputmode="decimal" value="${escapeHtml(raw)}" placeholder="${escapeHtml(field.placeholder || '')}" class="${CTL}">`;

    case 'boolean':
      return `<select ${base} class="${CTL}">
                <option value=""${raw === '' ? ' selected' : ''}>Sin dato</option>
                <option value="true"${raw === 'true' ? ' selected' : ''}>Sí</option>
                <option value="false"${raw === 'false' ? ' selected' : ''}>No</option>
              </select>`;

    case 'catalog':
      return `<select ${base} class="${CTL}">
                <option value="">Sin indicar</option>
                ${(CATALOGS[field.catalog] || []).map((item) =>
                  `<option value="${item.id}"${raw === String(item.id) ? ' selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
              </select>`;

    case 'date':
      return `<input type="date" ${base} value="${escapeHtml(raw)}" class="${CTL}">`;

    case 'time':
      return `<input type="time" ${base} value="${escapeHtml(raw)}" class="${CTL}">`;

    default:
      throw new Error(`Tipo de campo no soportado en el esquema: ${field.type}`);
  }
}

function fieldBlockHtml(field, path, values, prefix) {
  const value = values ? values[field.key] : undefined;

  if (field.type === 'object') {
    const children = getObjectFields(field);
    return `
      <fieldset class="fig-subgroup">
        <legend>${escapeHtml(field.label)}</legend>
        <div class="soap-cols">
          ${children.map((child) => fieldBlockHtml(child, `${path}.${child.key}`, value, prefix)).join('')}
        </div>
      </fieldset>`;
  }

  return `
    <div class="fig-field">
      <label for="${idFor(path, prefix)}" class="fig-label">${escapeHtml(field.label)}</label>
      ${controlHtml(field, path, value, prefix)}
      <p class="fig-error hidden" data-error-for="${escapeHtml(path)}" role="alert"></p>
    </div>`;
}

/**
 * Dibuja los campos dentro de `container`.
 * @param {HTMLElement} container
 * @param {Array} fields lista plana de campos del esquema
 * @param {object} [values] valores iniciales (misma forma que devuelve readValues)
 * @param {{idPrefix?: string}} [options] idPrefix: antepone texto a los `id` de los controles (ver idFor).
 */
export function renderFields(container, fields, values = {}, { idPrefix = '' } = {}) {
  container.innerHTML = fields.map((field) => fieldBlockHtml(field, field.key, values, idPrefix)).join('');

  // Contador de caracteres. Se asigna con la PROPIEDAD `oninput` (no addEventListener) para que
  // volver a renderizar sobre el mismo contenedor no acumule oyentes duplicados.
  container.oninput = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement) || !target.dataset.max) return;
    const counter = container.querySelector(`[data-counter-for="${CSS.escape(target.dataset.path)}"]`);
    if (counter) counter.textContent = `${target.value.length}/${target.dataset.max}`;
  };
}

// ---------------------------------------------------------------------------
// Lectura de valores
// ---------------------------------------------------------------------------

function readField(container, field, path) {
  if (field.type === 'object') {
    const nested = readObject(container, getObjectFields(field), path);
    return isEmptyValue(nested) ? undefined : nested;
  }
  const el = container.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (!el) return undefined;
  const raw = el.value.trim();
  if (raw === '') return undefined; // vacío = sin dato (no se guarda)

  switch (field.type) {
    case 'integer':
    case 'decimal':
    case 'catalog':
      return Number(raw);
    case 'boolean':
      return raw === 'true';
    case 'identifier':
      return raw.toUpperCase();
    case 'date8': // <input type="date"> da "2005-06-14"; se guarda como "20050614"
      return raw.replace(/-/g, '');
    default: // text, date, time
      return raw;
  }
}

function readObject(container, fields, prefix) {
  const result = {};
  for (const field of fields) {
    const value = readField(container, field, prefix ? `${prefix}.${field.key}` : field.key);
    if (value !== undefined) result[field.key] = value;
  }
  return result;
}

/** Lee el formulario y devuelve un objeto anidado solo con los campos capturados. */
export function readValues(container, fields) {
  return readObject(container, fields, '');
}

// ---------------------------------------------------------------------------
// Validación (basada en tipos y tamaños del Excel)
// ---------------------------------------------------------------------------

/** Rango clínico del campo (min/max del esquema), si lo tiene. '' = dentro del rango. */
function rangeMessage(field, value) {
  if (field.min === undefined && field.max === undefined) return '';
  if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) {
    return `Debe estar entre ${field.min} y ${field.max}`;
  }
  return '';
}

function validateField(container, field, path, errors) {
  if (field.type === 'object') {
    for (const child of getObjectFields(field)) validateField(container, child, `${path}.${child.key}`, errors);
    return;
  }
  const el = container.querySelector(`[data-path="${CSS.escape(path)}"]`);
  if (!el) return;

  if (el.validity && el.validity.badInput) {
    errors.push({ path, message: 'Valor numérico inválido' });
    return;
  }
  const raw = el.value.trim();
  if (raw === '') return;

  let message = '';
  switch (field.type) {
    case 'identifier': {
      const upper = raw.toUpperCase();
      if (upper.length !== field.length) message = `Debe tener ${field.length} caracteres`;
      else if (field.pattern && !field.pattern.test(upper)) message = field.patternHint || 'Formato inválido';
      break;
    }
    case 'text':
      if (raw.length > field.max) message = `Máximo ${field.max} caracteres`;
      else if (field.pattern && !field.pattern.test(raw)) message = field.patternHint || 'Formato inválido';
      break;
    case 'integer':
      if (!/^\d+$/.test(raw)) message = 'Debe ser un número entero mayor o igual a 0';
      else message = rangeMessage(field, Number(raw));
      break;
    case 'decimal': {
      const regex = new RegExp(`^\\d+(\\.\\d{1,${field.scale}})?$`);
      if (!regex.test(raw)) message = `Número con máximo ${field.scale} decimal${field.scale === 1 ? '' : 'es'}`;
      else if (Number(raw) > decimalMax(field)) message = `El máximo permitido es ${decimalMax(field)}`;
      else message = rangeMessage(field, Number(raw));
      break;
    }
    case 'date8':
      if (new Date(raw).getTime() > Date.now()) message = 'La fecha no puede ser futura';
      break;
    default:
      break;
  }
  if (message) errors.push({ path, message });
}

/**
 * Valida el formulario, muestra los errores junto a cada campo y devuelve la lista.
 * Si hay errores, enfoca el primer campo con problema.
 * @returns {Array<{path: string, message: string}>}
 */
export function validateForm(container, fields) {
  container.querySelectorAll('[data-error-for]').forEach((p) => { p.textContent = ''; p.classList.add('hidden'); });
  container.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));

  const errors = [];
  for (const field of fields) validateField(container, field, field.key, errors);

  for (const { path, message } of errors) {
    const p = container.querySelector(`[data-error-for="${CSS.escape(path)}"]`);
    if (p) { p.textContent = message; p.classList.remove('hidden'); }
    const el = container.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (el) el.setAttribute('aria-invalid', 'true');
  }

  if (errors.length > 0) {
    const first = container.querySelector(`[data-path="${CSS.escape(errors[0].path)}"]`);
    if (first) {
      first.focus();
      first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Vista de solo lectura
// ---------------------------------------------------------------------------

function formatViewValue(field, value) {
  if (field.type === 'boolean') return value ? 'Sí' : 'No';
  if (field.type === 'catalog') return catalogLabel(field.catalog, value);
  if (field.type === 'date8') {
    const digits = String(value);
    return digits.length === 8 ? `${digits.slice(6, 8)}/${digits.slice(4, 6)}/${digits.slice(0, 4)}` : digits;
  }
  return String(value);
}


function viewRowsHtml(fields, values) {
  if (!values) return '';
  return fields.map((field) => {
    const value = values[field.key];
    if (isEmptyValue(value)) return '';

    if (field.type === 'object') {
      const nested = viewRowsHtml(getObjectFields(field), value);
      if (!nested) return '';
      return `
        <div style="margin-bottom:10px">
          <dt class="view-dt">${escapeHtml(field.label)}</dt>
          <dd class="view-nested"><dl style="margin:0">${nested}</dl></dd>
        </div>`;
    }
    return `
      <div style="margin-bottom:8px">
        <dt class="view-dt">${escapeHtml(field.label)}</dt>
        <dd style="margin:0;white-space:pre-wrap">${escapeHtml(formatViewValue(field, value))}</dd>
      </div>`;
  }).join('');
}

/**
 * Pinta los datos de una nota en solo lectura, omitiendo los campos vacíos.
 * Escribe el resultado en `container` y devuelve true si había algo que mostrar.
 * @param {Array} sections resultado de getSections(tipoNota)
 */
export function renderView(container, sections, values) {
  const html = sections.map((section) => {
    const rows = viewRowsHtml(section.fields, values);
    if (!rows) return '';
    return `
      <section style="margin-bottom:18px">
        <h4 style="font-size:14px;font-weight:600;margin:0 0 8px">
          <span class="view-num">${escapeHtml(section.numeral)}</span>${escapeHtml(section.title)}
        </h4>
        <dl style="margin:0">${rows}</dl>
      </section>`;
  }).join('');

  container.innerHTML = html || '<p class="soap-hint">Sin información capturada.</p>';
  return html !== '';
}
