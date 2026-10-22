/*
 * antecedentesEditor.js — editor y vista de solo lectura de los ANTECEDENTES del paciente
 * (NOM-004 6.1.1 + alergias de NOM-024 1.3.6). Lo usan:
 *   · la pestaña "Antecedentes" (antecedentesTab.js), y
 *   · el panel "Historiales" de la nota SOAP (soapForm.js), para actualizarlos sin salir de la nota.
 *
 * No usa formRenderer porque aquí hay listas (matriz heredo-familiar, casillas, alergias) que el
 * esquema del Excel no tiene. Cada guardado crea una VERSIÓN nueva en el backend (solo-agregar); si
 * nada cambió, el backend responde "sin cambios" y no crea otra.
 *
 * Forma de los datos (la misma que valida el backend, antecedentesController.js):
 *   { heredoFamiliares: [{padecimiento, parentesco}], heredoFamiliaresDetalle, heredoFamiliaresNegados,
 *     patologicos: [código], patologicosDetalle, patologicosNegados,      // negados: true | null
 *     consumoSustancias: { tabaco, alcohol, otrasSustancias },   // NO | USO | DEPENDENCIA | EX
 *     noPatologicos,
 *     alergias: { niega: true|false|null, lista: [{agente, medicamento, tipoReaccion, descripcion, fechaDeteccion, verificada}] },
 *     ginecoObstetricos: { menarca, gestas, partos, abortos, cesareas, metodoAnticonceptivo } | null,
 *     discapacidades: [código] }
 */

import { updateAntecedentes } from '/js/core/api.js';
import { escapeHtml, toast, formatDateTime, CTL } from '/js/core/ui.js';
import * as CAT from '/js/data/antecedentesCatalogs.js';

const MAX_DETALLE = 500;
const SEXO_HOMBRE = 1; // id del catálogo `sexo` (catalogs.js)

const options = (catalog, selected, emptyLabel = 'Sin dato') => `
  <option value="">${escapeHtml(emptyLabel)}</option>
  ${CAT.entries(catalog).map(({ code, label }) =>
    `<option value="${code}"${code === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}`;

const textarea = (name, label, value, placeholder = '') => `
  <div class="fig-field">
    <label class="fig-label" for="ant-${name}">${escapeHtml(label)}</label>
    <textarea id="ant-${name}" data-ant="${name}" rows="3" maxlength="${MAX_DETALLE}" class="${CTL}"
      placeholder="${escapeHtml(placeholder)}">${escapeHtml(value || '')}</textarea>
  </div>`;

const card = (title, body, { open = true, num = '' } = {}) => `
  <details class="consulta-card" ${open ? 'open' : ''}>
    <summary><span>${num ? `<span class="num">${num}</span>` : ''}${escapeHtml(title)}</span><span class="chev" aria-hidden="true">▶</span></summary>
    <div class="card-body">${body}</div>
  </details>`;

// ---------------------------------------------------------------------------
// Secciones del editor
// ---------------------------------------------------------------------------

function alergiaRowHtml(item = {}) {
  return `
    <fieldset class="fig-subgroup" data-alergia>
      <legend>Alergia</legend>
      <div class="soap-cols">
        <div class="fig-field"><label class="fig-label">Agente</label>
          <select data-al="agente" class="${CTL}">${options(CAT.ALERGIA_AGENTES, item.agente, 'Selecciona…')}</select></div>
        <div class="fig-field" data-al-medicamento ${item.agente === 'MEDICAMENTO' ? '' : 'hidden'}><label class="fig-label">Medicamento</label>
          <input type="text" data-al="medicamento" maxlength="100" class="${CTL}" value="${escapeHtml(item.medicamento || '')}"></div>
        <div class="fig-field"><label class="fig-label">Tipo de reacción</label>
          <select data-al="tipoReaccion" class="${CTL}">${options(CAT.TIPO_REACCION, item.tipoReaccion)}</select></div>
        <div class="fig-field"><label class="fig-label">Fecha de detección</label>
          <input type="date" data-al="fechaDeteccion" class="${CTL}" value="${escapeHtml(item.fechaDeteccion || '')}"></div>
      </div>
      <div class="fig-field"><label class="fig-label">Descripción de la reacción</label>
        <input type="text" data-al="descripcion" maxlength="200" class="${CTL}" value="${escapeHtml(item.descripcion || '')}"></div>
      <div class="ant-row">
        <label class="ant-check"><input type="checkbox" data-al="verificada" ${item.verificada ? 'checked' : ''}> Verificada por personal de salud (si no, la reportó el paciente)</label>
        <button type="button" class="fig-link" data-al-remove>Quitar</button>
      </div>
    </fieldset>`;
}

function alergiasHtml(alergias) {
  const estado = alergias.niega === true ? 'niega' : alergias.lista.length > 0 || alergias.niega === false ? 'tiene' : '';
  return card('Alergias y reacciones adversas', `
    <div class="fig-field">
      <label class="fig-label" for="ant-alergiasEstado">¿Tiene alergias?</label>
      <select id="ant-alergiasEstado" data-ant="alergiasEstado" class="${CTL}">
        <option value="">Sin dato (no se preguntó)</option>
        <option value="niega"${estado === 'niega' ? ' selected' : ''}>Niega alergias</option>
        <option value="tiene"${estado === 'tiene' ? ' selected' : ''}>Sí</option>
      </select>
    </div>
    <div data-alergias-box ${estado === 'tiene' ? '' : 'hidden'}>
      <div data-alergias-list>${alergias.lista.map(alergiaRowHtml).join('')}</div>
      <button type="button" class="fig-btn fig-btn-neutral" data-al-add>+ Agregar alergia</button>
    </div>`, { num: 'NOM-024' });
}

/** "Negados" = se preguntó y no hay ninguno (distinto de no capturar nada = sin dato). */
const negadosHtml = (key, checked) => `
  <label class="ant-check" style="margin:0 0 12px"><input type="checkbox" data-negados="${key}" ${checked ? 'checked' : ''}>
    Negados (se preguntó y no hay ninguno)</label>`;

function heredoHtml(a) {
  const marked = new Set(a.heredoFamiliares.map((p) => `${p.padecimiento}|${p.parentesco}`));
  const parentescos = CAT.entries(CAT.PARENTESCOS);
  const rows = CAT.entries(CAT.HEREDO_PADECIMIENTOS).map(({ code, label }) => `
    <tr><th scope="row">${escapeHtml(label)}</th>
      ${parentescos.map((p) => `<td><input type="checkbox" data-heredo="${code}|${p.code}" aria-label="${escapeHtml(`${label} — ${p.label}`)}" ${marked.has(`${code}|${p.code}`) ? 'checked' : ''}></td>`).join('')}
    </tr>`).join('');
  return card('Heredo-familiares', `
    ${negadosHtml('heredoFamiliares', a.heredoFamiliaresNegados)}
    <div class="ant-matrix-wrap">
      <table class="ant-matrix">
        <thead><tr><th></th>${parentescos.map((p) => `<th scope="col">${escapeHtml(p.label)}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    ${textarea('heredoFamiliaresDetalle', 'Otros padecimientos / detalle', a.heredoFamiliaresDetalle)}`, { num: '6.1.1' });
}

function patologicosHtml(a) {
  const marked = new Set(a.patologicos);
  const groups = CAT.PATOLOGICOS_GRUPOS.map((group) => `
    <fieldset class="soap-fieldset"><legend>${escapeHtml(group.title)}</legend>
      <div class="ant-checks">
        ${group.codes.map((code) => `<label class="ant-check"><input type="checkbox" data-patologico="${code}" ${marked.has(code) ? 'checked' : ''}> ${escapeHtml(CAT.PATOLOGICOS[code])}</label>`).join('')}
      </div>
    </fieldset>`).join('');
  const consumo = (key, label) => `
    <div class="fig-field"><label class="fig-label" for="ant-consumo-${key}">${escapeHtml(label)}</label>
      <select id="ant-consumo-${key}" data-consumo="${key}" class="${CTL}">${options(CAT.CONSUMO, a.consumoSustancias[key])}</select></div>`;
  return card('Personales patológicos', `
    ${negadosHtml('patologicos', a.patologicosNegados)}
    ${groups}
    ${textarea('patologicosDetalle', 'Detalle (cuál cirugía, cuándo, tratamiento, otras enfermedades…)', a.patologicosDetalle)}
    <fieldset class="fig-subgroup"><legend>Uso y dependencia de sustancias</legend>
      <div class="soap-cols">
        ${consumo('tabaco', 'Tabaco')}
        ${consumo('alcohol', 'Alcohol')}
        ${consumo('otrasSustancias', 'Otras sustancias psicoactivas')}
      </div>
    </fieldset>`, { num: '6.1.1' });
}

const noPatologicosHtml = (a) => card('Personales no patológicos', textarea('noPatologicos', 'Hábitos y condiciones de vida', a.noPatologicos,
  'Alimentación, actividad física, sueño, higiene, vivienda y servicios, escolaridad, ocupación, pasatiempos…'), { num: '6.1.1' });

function ginecoHtml(g) {
  const n = (key, label, min, max) => `
    <div class="fig-field"><label class="fig-label" for="ant-gin-${key}">${escapeHtml(label)}</label>
      <input type="number" id="ant-gin-${key}" data-gin="${key}" min="${min}" max="${max}" step="1" inputmode="numeric" class="${CTL}" value="${g[key] ?? ''}"></div>`;
  return card('Gineco-obstétricos (opcional)', `
    <div class="soap-cols">
      ${n('menarca', 'Menarca (edad en años)', 6, 25)}
      <div class="fig-field"><label class="fig-label" for="ant-gin-metodo">Método anticonceptivo</label>
        <select id="ant-gin-metodo" data-gin="metodoAnticonceptivo" class="${CTL}">${options(CAT.METODO_ANTICONCEPTIVO, g.metodoAnticonceptivo)}</select></div>
      ${n('gestas', 'Gestaciones', 0, 30)}
      ${n('partos', 'Partos', 0, 30)}
      ${n('abortos', 'Abortos', 0, 30)}
      ${n('cesareas', 'Cesáreas', 0, 30)}
    </div>`, { open: Object.values(g).some((v) => v !== null && v !== undefined) });
}

function discapacidadesHtml(a) {
  const marked = new Set(a.discapacidades);
  return card('Discapacidad (opcional)', `
    <div class="ant-checks">
      ${CAT.entries(CAT.DISCAPACIDADES).map(({ code, label }) => `<label class="ant-check"><input type="checkbox" data-discapacidad="${code}" ${marked.has(code) ? 'checked' : ''}> ${escapeHtml(label)}</label>`).join('')}
    </div>`, { open: a.discapacidades.length > 0 });
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Antecedentes vacíos (paciente sin registro). */
export const EMPTY = Object.freeze({
  heredoFamiliares: [], heredoFamiliaresDetalle: null, heredoFamiliaresNegados: null,
  patologicos: [], patologicosDetalle: null, patologicosNegados: null,
  consumoSustancias: { tabaco: null, alcohol: null, otrasSustancias: null },
  noPatologicos: null,
  alergias: { niega: null, lista: [] },
  ginecoObstetricos: null,
  discapacidades: [],
});

const valueOf = (root, selector) => {
  const el = root.querySelector(selector);
  const value = el ? el.value.trim() : '';
  return value === '' ? null : value;
};

/** Lee el editor. Lanza Error con un mensaje para el usuario si algo no cuadra. */
function readEditor(root, showGineco) {
  const estado = valueOf(root, '[data-ant="alergiasEstado"]');
  const lista = estado === 'tiene'
    ? [...root.querySelectorAll('[data-alergia]')].map((row) => ({
        agente: valueOf(row, '[data-al="agente"]'),
        medicamento: valueOf(row, '[data-al="medicamento"]'),
        tipoReaccion: valueOf(row, '[data-al="tipoReaccion"]'),
        descripcion: valueOf(row, '[data-al="descripcion"]'),
        fechaDeteccion: valueOf(row, '[data-al="fechaDeteccion"]'),
        verificada: row.querySelector('[data-al="verificada"]').checked,
      }))
    : [];
  if (estado === 'tiene' && lista.length === 0) throw new Error('Alergias: elegiste "Sí" pero no agregaste ninguna.');
  lista.forEach((item, index) => {
    if (!item.agente) throw new Error(`Alergia #${index + 1}: elige el agente.`);
    if (item.agente !== 'MEDICAMENTO') item.medicamento = null; // el campo está oculto
  });

  let ginecoObstetricos = null;
  if (showGineco) {
    const g = {};
    for (const el of root.querySelectorAll('[data-gin]')) {
      const raw = el.value.trim();
      g[el.dataset.gin] = raw === '' ? null : el.type === 'number' ? Number(raw) : raw;
    }
    if (Object.values(g).some((v) => v !== null)) ginecoObstetricos = g;
  }

  const heredo = [...root.querySelectorAll('[data-heredo]:checked')].map((el) => {
    const [padecimiento, parentesco] = el.dataset.heredo.split('|');
    return { padecimiento, parentesco };
  });
  const heredoDetalle = valueOf(root, '[data-ant="heredoFamiliaresDetalle"]');
  const patologicos = [...root.querySelectorAll('[data-patologico]:checked')].map((el) => el.dataset.patologico);
  const patologicosDetalle = valueOf(root, '[data-ant="patologicosDetalle"]');
  const negado = (key) => (root.querySelector(`[data-negados="${key}"]`).checked ? true : null);
  if (negado('heredoFamiliares') && (heredo.length > 0 || heredoDetalle)) {
    throw new Error('Heredo-familiares: marcaste "Negados" pero también hay datos capturados.');
  }
  if (negado('patologicos') && (patologicos.length > 0 || patologicosDetalle)) {
    throw new Error('Personales patológicos: marcaste "Negados" pero también hay datos capturados.');
  }

  return {
    heredoFamiliares: heredo,
    heredoFamiliaresDetalle: heredoDetalle,
    heredoFamiliaresNegados: negado('heredoFamiliares'),
    patologicos,
    patologicosDetalle,
    patologicosNegados: negado('patologicos'),
    consumoSustancias: {
      tabaco: valueOf(root, '[data-consumo="tabaco"]'),
      alcohol: valueOf(root, '[data-consumo="alcohol"]'),
      otrasSustancias: valueOf(root, '[data-consumo="otrasSustancias"]'),
    },
    noPatologicos: valueOf(root, '[data-ant="noPatologicos"]'),
    alergias: { niega: estado === 'niega' ? true : estado === 'tiene' ? false : null, lista },
    ginecoObstetricos,
    discapacidades: [...root.querySelectorAll('[data-discapacidad]:checked')].map((el) => el.dataset.discapacidad),
  };
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/** "Versión 3 · 22 oct 2026 · 10:15 · por V. Cadena (recepcion)" */
export const versionText = (saved) => {
  if (!saved || !saved.version) return 'Sin antecedentes registrados todavía.';
  const autor = saved.elaboradoPor
    ? `por ${saved.elaboradoPor.nombre} (${saved.elaboradoPor.rol})`
    : 'autor no registrado (versión anterior a que se guardara el autor)';
  return `Versión ${saved.version} · ${formatDateTime(saved.creadoEn)} · ${autor}`;
};

/**
 * Aviso de información mínima (NOM-004 6.1.1; NOM-024 1.3.7 c pide validarla). No impide guardar:
 * enfermería puede capturar por partes. Los faltantes los calcula el backend.
 */
function faltantesHtml(saved) {
  if (!saved || saved.completa) return '';
  return `
    <div class="ant-aviso" role="status">
      <strong>Historia clínica incompleta (NOM-004 6.1.1).</strong> Falta: ${escapeHtml(saved.faltantes.join(' · '))}.
    </div>`;
}

/**
 * Dibuja el editor en `container` (un <div>; puede estar dentro de otro <form>).
 * @param {{ patient: object, saved: object|null, onSaved?: (saved: object) => void, saveLabel?: string }} options
 *   saved = versión vigente que devolvió el backend (o null).
 */
export function mountEditor(container, { patient, saved, onSaved, saveLabel = 'Guardar antecedentes' }) {
  const a = { ...EMPTY, ...(saved || {}) };
  const showGineco = patient.ficha?.sexo !== SEXO_HOMBRE;

  container.innerHTML = `
    <div class="ant-editor">
      ${alergiasHtml(a.alergias)}
      ${heredoHtml(a)}
      ${patologicosHtml(a)}
      ${noPatologicosHtml(a)}
      ${showGineco ? ginecoHtml(a.ginecoObstetricos || {}) : ''}
      ${discapacidadesHtml(a)}
      <div data-ant-faltantes>${faltantesHtml(saved)}</div>
      <p class="fig-modal-error hidden" data-ant-error role="alert"></p>
      <div class="soap-actions" style="align-items:center">
        <span class="soap-hint" data-ant-version style="margin-right:auto">${escapeHtml(versionText(saved))}</span>
        <button type="button" class="fig-btn fig-btn-accept" data-ant-save>${escapeHtml(saveLabel)}</button>
      </div>
    </div>`;

  const errorBox = container.querySelector('[data-ant-error]');
  const list = container.querySelector('[data-alergias-list]');
  const addRow = () => list.insertAdjacentHTML('beforeend', alergiaRowHtml());

  // Un solo oyente por tipo de evento en el contenedor (delegación), asignado como propiedad para
  // que volver a montar no acumule oyentes.
  container.onchange = (event) => {
    const target = event.target;
    if (target.matches('[data-ant="alergiasEstado"]')) {
      const tiene = target.value === 'tiene';
      container.querySelector('[data-alergias-box]').hidden = !tiene;
      if (tiene && !list.querySelector('[data-alergia]')) addRow();
    }
    if (target.matches('[data-al="agente"]')) {
      target.closest('[data-alergia]').querySelector('[data-al-medicamento]').hidden = target.value !== 'MEDICAMENTO';
    }
  };
  // Enter en un input no debe enviar el <form> de la nota SOAP que puede contener al editor.
  container.onkeydown = (event) => {
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault();
  };
  container.onclick = async (event) => {
    const target = event.target;
    if (target.closest('[data-al-add]')) addRow();
    if (target.closest('[data-al-remove]')) target.closest('[data-alergia]').remove();
    if (!target.closest('[data-ant-save]')) return;

    errorBox.classList.add('hidden');
    const button = target.closest('[data-ant-save]');
    button.disabled = true;
    try {
      const values = readEditor(container, showGineco);
      const { antecedentes, sinCambios } = await updateAntecedentes(patient.id, values);
      container.querySelector('[data-ant-version]').textContent = versionText(antecedentes);
      container.querySelector('[data-ant-faltantes]').innerHTML = faltantesHtml(antecedentes);
      toast(sinCambios ? 'Sin cambios: se conserva la versión actual.' : `Antecedentes guardados (versión ${antecedentes.version}).`, sinCambios ? 'info' : 'success');
      if (onSaved) onSaved(antecedentes);
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      button.disabled = false;
    }
  };
}

// ---------------------------------------------------------------------------
// Vista de solo lectura (resumen)
// ---------------------------------------------------------------------------

const label = (catalog, code) => catalog[code] || code;

// NOM-024 1.3.3 b: listas comenzando por las de mayor severidad o más recientes.
const SEVERIDAD = ['ANAFILAXIA', 'RESPIRATORIA', 'ADVERSA', 'CUTANEA', 'GASTROINTESTINAL', 'OTRA'];
const severidad = (al) => (al.tipoReaccion ? SEVERIDAD.indexOf(al.tipoReaccion) : SEVERIDAD.length);
const porSeveridad = (lista) => [...lista].sort((x, y) =>
  severidad(x) - severidad(y) || String(y.fechaDeteccion || '').localeCompare(String(x.fechaDeteccion || '')));

/** Texto corto de una alergia: "Penicilina (Anafilaxia, verificada)". */
export function alergiaText(al) {
  const what = al.agente === 'MEDICAMENTO' ? al.medicamento : al.agente === 'OTRO' ? al.descripcion : label(CAT.ALERGIA_AGENTES, al.agente);
  const extra = [al.tipoReaccion && label(CAT.TIPO_REACCION, al.tipoReaccion), al.verificada ? 'verificada' : 'reportada por el paciente']
    .filter(Boolean).join(', ');
  return `${what} (${extra})`;
}

/** Alergias ordenadas por severidad, para el banner del expediente y el resumen. */
export const alergiasOrdenadas = (saved) => porSeveridad((saved && saved.alergias && saved.alergias.lista) || []);

/** HTML de solo lectura con lo que tenga dato. Alergias siempre primero (NOM-024 1.3.6). */
export function summaryHtml(saved) {
  if (!saved) return '<p class="soap-hint">Sin antecedentes registrados todavía.</p>';
  const a = { ...EMPTY, ...saved };
  const items = [];
  const add = (title, value) => items.push(`<dt class="view-dt">${escapeHtml(title)}</dt><dd>${value}</dd>`);

  if (a.alergias.niega === true) add('Alergias', 'Niega alergias');
  else if (a.alergias.lista.length > 0) {
    add('Alergias', `<strong>${porSeveridad(a.alergias.lista).map((al) => escapeHtml(alergiaText(al))).join('<br>')}</strong>`);
  } else add('Alergias', '<span class="soap-hint">Sin dato (no se preguntó)</span>');

  if (a.heredoFamiliares.length > 0) {
    const byDisease = new Map();
    for (const { padecimiento, parentesco } of a.heredoFamiliares) {
      if (!byDisease.has(padecimiento)) byDisease.set(padecimiento, []);
      byDisease.get(padecimiento).push(label(CAT.PARENTESCOS, parentesco));
    }
    add('Heredo-familiares', [...byDisease].map(([code, who]) => escapeHtml(`${label(CAT.HEREDO_PADECIMIENTOS, code)}: ${who.join(', ')}`)).join('<br>'));
  }
  if (a.heredoFamiliaresNegados) add('Heredo-familiares', 'Negados');
  if (a.heredoFamiliaresDetalle) add('Heredo-familiares (detalle)', escapeHtml(a.heredoFamiliaresDetalle));
  if (a.patologicosNegados) add('Patológicos', 'Negados');
  if (a.patologicos.length > 0) add('Patológicos', escapeHtml(a.patologicos.map((c) => label(CAT.PATOLOGICOS, c)).join(', ')));
  if (a.patologicosDetalle) add('Patológicos (detalle)', escapeHtml(a.patologicosDetalle));

  const consumo = [['tabaco', 'Tabaco'], ['alcohol', 'Alcohol'], ['otrasSustancias', 'Otras sustancias']]
    .filter(([key]) => a.consumoSustancias[key])
    .map(([key, name]) => `${name}: ${label(CAT.CONSUMO, a.consumoSustancias[key])}`);
  if (consumo.length > 0) add('Sustancias', escapeHtml(consumo.join(' · ')));
  if (a.noPatologicos) add('No patológicos', escapeHtml(a.noPatologicos));

  const g = a.ginecoObstetricos;
  if (g) {
    const parts = [];
    if (g.menarca !== null) parts.push(`Menarca ${g.menarca} años`);
    if ([g.gestas, g.partos, g.abortos, g.cesareas].some((v) => v !== null)) {
      parts.push(`G${g.gestas ?? '-'} P${g.partos ?? '-'} A${g.abortos ?? '-'} C${g.cesareas ?? '-'}`);
    }
    if (g.metodoAnticonceptivo) parts.push(`Método: ${label(CAT.METODO_ANTICONCEPTIVO, g.metodoAnticonceptivo)}`);
    add('Gineco-obstétricos', escapeHtml(parts.join(' · ')));
  }
  if (a.discapacidades.length > 0) add('Discapacidad', escapeHtml(a.discapacidades.map((c) => label(CAT.DISCAPACIDADES, c)).join(', ')));

  return `<dl class="consulta-datos">${items.join('')}</dl>`;
}
