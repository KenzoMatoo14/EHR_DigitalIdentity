/*
 * consultaForm.js — consulta médica en DOS COLUMNAS (pestaña "Consultas" del expediente).
 *
 * Mezcla de las dos versiones: el marco (barra, pestañas, botones, tipografía) es el del Figma
 * "ECE UP diseño"; el contenido es el de la consulta anterior: la nota clínica por SECCIONES de la
 * NOM-004 generada desde el Excel Norm04 (data/schema.js), más la decisión clínica y el manejo.
 * Ya no hay "Tipo 1 / Tipo 2" del SOAP ni resumen de triage.
 *
 *   ┌ Datos de la visita ────────────┬ Alergias (notas importantes) ┐
 *   ├ Historial de consultas (plegado, ancho completo) ─────────────┤
 *   ├ Tipo de nota: Primera vez · Subsecuente · Urgencia ───────────┤
 *   ├ una tarjeta por sección de la NOM, repartidas en 2 columnas ──┤
 *   ├ Decisión clínica: Interconsulta + Referencia │ Manejo ────────┤
 *   └ Salir sin cerrar · Guardar borrador · Cerrar consulta ────────┘
 *
 * El tipo de nota define qué campos del Excel se dibujan: historia clínica 6.1 (primera vez), nota de
 * evolución 6.2 (subsecuente) o nota inicial de urgencias 7.1. La ficha de identificación y el grupo
 * étnico NO se capturan aquí: se muestran en solo lectura y se copian de la "Ficha de datos" al cerrar.
 *
 * Al cerrar la consulta se crean notas SOLO-AGREGAR (nota principal + interconsulta 6.3 + referencia
 * 6.4 si aplican), por eso se pide confirmación. "Guardar borrador" no toca el expediente.
 */

import { closeConsulta, saveConsultaDraft } from '/js/core/api.js';
import { APPOINTMENT_TYPES } from '/js/core/config.js';
import { escapeHtml, toast, reportError, confirmDialog, formatDateTime } from '/js/core/ui.js';
import { NOTE_TYPES, AUTO_FIELDS, FICHA_FIELDS, FICHA_ROOT_KEYS, getSections } from '/js/data/schema.js';
import { renderFields, readValues, validateForm, hasContent, renderView } from '/js/core/formRenderer.js';
import { MANAGEMENT_OPTIONS, NOTIFIABLE_DISEASES, TRANSFER_OPTIONS, catalogLabel } from '/js/data/catalogs.js';
import { localDayKey, fullName } from '/js/core/util.js';

// Tipos de nota que el médico puede elegir como nota principal de la consulta
export const MAIN_NOTE_TYPES = ['historiaClinica', 'evolucion', 'urgencias'];
const DEFAULT_SENDER = 'Departamento Médico UP'; // 6.4.1 "Establecimiento que envía", precargado

// ---------------------------------------------------------------------------
// Historial (también lo usa la pestaña Consultas cuando no hay consulta en curso)
// ---------------------------------------------------------------------------

/** Lista plegable de notas previas, más recientes primero. Cada nota se pinta con renderView. */
export function renderHistorial(container, notes, { openFirst = false } = {}) {
  if (notes.length === 0) {
    container.innerHTML = '<p class="soap-hint">Sin consultas previas.</p>';
    return;
  }
  container.innerHTML = notes.map((note, index) => {
    const type = NOTE_TYPES[note.tipo];
    const dx = note.data.diagnosticosProblemasClinicos || '';
    return `
      <details class="soap-note" ${openFirst && index === 0 ? 'open' : ''}>
        <summary>
          <strong>${escapeHtml(type ? type.label : note.tipo)}</strong>
          <span class="soap-hint"> ${escapeHtml(formatDateTime(note.createdAt))} · ${escapeHtml(note.autor)}${dx ? ` · Dx: ${escapeHtml(dx.slice(0, 60))}` : ''}</span>
        </summary>
        <div style="padding-top:10px" data-note="${escapeHtml(note.id)}"></div>
      </details>`;
  }).join('');
  for (const note of notes) {
    if (!NOTE_TYPES[note.tipo]) continue;
    renderView(container.querySelector(`[data-note="${CSS.escape(note.id)}"]`), getSections(note.tipo), note.data);
  }
}

// ---------------------------------------------------------------------------
// Piezas de HTML
// ---------------------------------------------------------------------------

/** Tarjeta plegable (<details>). `numeral` es el de la NOM (6.1.1, 6.2.4…), si aplica. */
const cardHtml = ({ title, numeral = '', body, open = true, id = '' }) => `
  <details class="consulta-card" ${open ? 'open' : ''} ${id ? `data-card="${escapeHtml(id)}"` : ''}>
    <summary>
      <span>${numeral ? `<span class="num">${escapeHtml(numeral)}</span>` : ''}${escapeHtml(title)}</span>
      <span class="chev" aria-hidden="true">▶</span>
    </summary>
    <div class="card-body">${body}</div>
  </details>`;

/** Lista de datos de solo lectura en dos columnas. `rows` = [[nombre, valor | null]]; null = "Sin dato". */
const datosHtml = (rows) => `<dl class="consulta-datos cols">${rows.map(([name, value]) => {
  const empty = value === null || value === undefined || value === '';
  return `<div><dt class="view-dt">${escapeHtml(name)}</dt><dd${empty ? ' class="vacio"' : ''}>${escapeHtml(empty ? 'Sin dato' : value)}</dd></div>`;
}).join('')}</dl>`;

/**
 * Reparte en dos columnas las tarjetas que hay en la primera `.consulta-col` de `box`. Mide la altura REAL
 * de cada tarjeta (ya con sus campos dibujados; estimar por número de campos falla porque un área de
 * texto y un campo corto miden distinto) y usa uno de dos repartos:
 *   1. En orden: la izquierda conserva las primeras y la derecha el resto, cortando donde la diferencia
 *      de altura sea menor. Es lo que se prefiere porque respeta la secuencia de la NOM.
 *   2. Si aun así una columna queda más de 15 % más larga (una tarjeta enorme lo provoca), cada tarjeta
 *      va a la columna más corta en ese momento. El orden se mantiene dentro de cada columna.
 */
function balanceColumns(box) {
  const [first, second] = box.querySelectorAll(':scope > .consulta-col');
  const items = [...first.children];
  const heights = items.map((item) => item.offsetHeight);
  const total = heights.reduce((sum, h) => sum + h, 0);

  let acc = 0;
  let cut = items.length;
  let cutDiff = Infinity;
  heights.forEach((h, index) => {
    acc += h;
    const diff = Math.abs(acc - (total - acc));
    if (diff < cutDiff) { cutDiff = diff; cut = index + 1; }
  });
  if (cutDiff <= total * 0.15) {
    items.slice(cut).forEach((item) => second.appendChild(item));
    return;
  }

  let left = 0;
  let right = 0;
  items.forEach((item, index) => {
    if (left <= right) { left += heights[index]; return; }
    right += heights[index];
    second.appendChild(item);
  });
}

/** Secciones editables de un tipo de nota (sin los campos que se copian de la Ficha de datos). */
function editableSections(noteType) {
  const auto = AUTO_FIELDS[noteType] || [];
  return getSections(noteType)
    .map((section) => ({ ...section, fields: section.fields.filter((field) => !auto.includes(field.key)) }))
    .filter((section) => section.fields.length > 0);
}

/** Ficha de identificación en solo lectura (viene de la pestaña "Ficha de datos"). */
function fichaHtml(patient) {
  const rows = FICHA_FIELDS.map((field) => {
    const raw = FICHA_ROOT_KEYS.includes(field.key) ? patient[field.key] : (patient.ficha || {})[field.key];
    const empty = raw === undefined || raw === null || raw === '';
    return [field.label, empty ? null : (field.type === 'catalog' ? catalogLabel(field.catalog, raw) : String(raw))];
  });
  const href = `/expediente?paciente=${encodeURIComponent(patient.id)}&tab=ficha`;
  return `${datosHtml(rows)}
    <p class="soap-hint">Se copia de la Ficha de datos al cerrar la consulta.
      <a class="fig-link" href="${href}" target="_blank" rel="noopener">Completarla ↗</a></p>`;
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 * @param {{ patient: object, visit: object, record: {notes: object[]}, initialType?: string }} ctx
 * `initialType`: tipo de nota con el que abre (si no, el que corresponde según haya o no historia clínica).
 */
export function mountConsulta(container, { patient, visit, record, initialType }) {
  const folio = visit.folio;
  const hasHistoria = record.notes.some((note) => note.tipo === 'historiaClinica');
  const historyNotes = record.notes.filter((note) => MAIN_NOTE_TYPES.includes(note.tipo));

  // Estado de la pantalla (todo en un objeto: nada de variables globales sueltas)
  const state = {
    type: MAIN_NOTE_TYPES.includes(initialType) ? initialType : (hasHistoria ? 'evolucion' : 'historiaClinica'),
    valuesByType: {}, // lo capturado por tipo de nota, para no perderlo al cambiar de tipo
    cards: [],        // tarjetas editables de la nota principal: { fields, box }
  };

  const $ = (selector) => container.querySelector(selector);
  const getRadio = (name) => { const el = container.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; };
  const setRadio = (name, value) => { const el = container.querySelector(`input[name="${name}"][value="${value}"]`); if (el) el.checked = true; };
  const triBool = (name) => { const v = getRadio(name); return v === 'si' ? true : v === 'no' ? false : null; };
  const radios = (name, items) => items.map((item) =>
    `<label class="soap-radio"><input type="radio" name="${name}" value="${escapeHtml(item.value)}"> ${escapeHtml(item.label)}</label>`).join('');
  const yesNo = (name, checked) => `
    <label class="soap-radio"><input type="radio" name="${name}" value="no"${checked === 'no' ? ' checked' : ''}> No</label>
    <label class="soap-radio"><input type="radio" name="${name}" value="si"${checked === 'si' ? ' checked' : ''}> Sí</label>`;

  // ------------------------- esqueleto -------------------------
  const appointmentType = (APPOINTMENT_TYPES.find((t) => t.id === visit.tipoCita) || {}).label;
  const visitRows = [
    ['Folio', visit.folio],
    ['Cita', visit.fechaHora ? formatDateTime(visit.fechaHora) : ''],
    ['Tipo de cita', visit.tipoCita ? appointmentType : ''],
    ['Motivo de la cita', visit.motivo],
    ['Notas de la cita', visit.notasCita],
  ].filter(([, value]) => value);

  const typeSelector = `
    <div style="display:flex;gap:8px 32px;flex-wrap:wrap">
      ${MAIN_NOTE_TYPES.map((key) => `
        <label class="soap-radio"><input type="radio" name="tipoNota" value="${key}">
          <span><strong>${escapeHtml(NOTE_TYPES[key].when)}</strong> → ${escapeHtml(NOTE_TYPES[key].label)} <span class="soap-hint">(${escapeHtml(NOTE_TYPES[key].numeral)})</span></span></label>`).join('')}
    </div>
    <p class="soap-hint" id="noteTypeHint" style="margin:4px 0 8px"></p>`;

  const interconsultaBody = `
    <fieldset class="soap-fieldset">
      <legend>¿Interconsulta interna necesaria?</legend>
      ${yesNo('interconsulta', 'no')}
      <p class="soap-hint" style="margin:0">Único servicio interno además de atención primaria: <strong>psicología</strong>. Traumatología no es interconsulta: es referencia externa.</p>
    </fieldset>
    <div id="interconsultaBlock" class="consulta-sub hidden">
      <p class="consulta-sub-title">Servicio: Psicología</p>
      <div id="interconsultaForm"></div>
    </div>`;

  const referenciaBody = `
    <fieldset class="soap-fieldset">
      <legend>¿Referencia o traslado?</legend>
      ${yesNo('referencia', 'no')}
    </fieldset>
    <div id="referenciaBlock" class="consulta-sub hidden">
      <div id="referenciaForm"></div>
      <fieldset class="soap-fieldset">
        <legend>¿Urgencia real? — traslado</legend>
        ${radios('traslado', TRANSFER_OPTIONS.map((o) => ({ value: o.id, label: o.label })))}
      </fieldset>
    </div>`;

  const manejoBody = `
    <fieldset class="soap-fieldset">
      <legend>Manejo</legend>
      ${radios('manejo', MANAGEMENT_OPTIONS.map((o) => ({ value: o.id, label: o.label })))}
      <p class="soap-hint" style="margin:4px 0 0">No se entregan recetas impresas en el consultorio: el manejo queda documentado aquí.</p>
    </fieldset>
    <div id="medicamentoBlock" class="hidden soap-cols">
      <div class="fig-field"><label class="fig-label" for="medicamento">Medicamento</label><input id="medicamento" class="fig-input" maxlength="100" placeholder="Butilhioscina 10mg"></div>
      <div class="fig-field"><label class="fig-label" for="dosisVia">Dosis / vía</label><input id="dosisVia" class="fig-input" maxlength="100" placeholder="1 tableta, vía oral"></div>
    </div>
    <fieldset class="soap-fieldset"><legend>¿Generó RPBI?</legend>${yesNo('rpbi', '')}</fieldset>
    <fieldset class="soap-fieldset">
      <legend>¿Padecimiento de notificación obligatoria? <span class="soap-hint">(NOM-017 / SUIVE)</span></legend>
      ${yesNo('notificable', '')}
      <select id="enfermedad" class="fig-input hidden" aria-label="Padecimiento notificable">${NOTIFIABLE_DISEASES.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}</select>
    </fieldset>
    <div class="fig-field">
      <label class="fig-label" for="indicacionesPaciente">Indicaciones para el paciente</label>
      <textarea id="indicacionesPaciente" class="fig-input" rows="4" maxlength="1000"></textarea>
    </div>`;

  container.innerHTML = `
    <div style="padding-top:6px">
      <div class="consulta-cols">
        <div class="consulta-col">${cardHtml({ title: 'Datos de la visita', body: datosHtml(visitRows) })}</div>
        <div class="consulta-col">${cardHtml({
          title: 'Alergias (notas importantes)',
          body: `<div class="fig-field"><label class="fig-label" for="alergias">Alergias, contraindicaciones o cualquier nota importante del paciente</label>
            <textarea id="alergias" class="fig-input" rows="3" maxlength="500"></textarea></div>`,
        })}</div>
      </div>

      ${cardHtml({ title: `Historial de consultas (${historyNotes.length})`, open: false, body: '<div id="historial"></div>' })}
      ${cardHtml({ title: 'Tipo de nota', body: typeSelector })}

      <div id="noteCols" class="consulta-cols" style="padding-top:0"></div>

      <h3 class="consulta-h">Decisión clínica y manejo</h3>
      <div class="consulta-cols">
        <div class="consulta-col">
          ${cardHtml({ title: 'Interconsulta interna', numeral: '6.3', body: interconsultaBody })}
          ${cardHtml({ title: 'Referencia o traslado', numeral: '6.4', body: referenciaBody })}
        </div>
        <div class="consulta-col">
          ${cardHtml({ title: 'Manejo / resolución', body: manejoBody })}
        </div>
      </div>

      <p id="consultaError" class="fig-modal-error hidden" role="alert"></p>
      <div class="soap-actions">
        <a class="fig-btn fig-btn-neutral" href="/medico">Salir sin cerrar</a>
        <button type="button" id="saveDraftBtn" class="fig-btn fig-btn-neutral">Guardar borrador</button>
        <button type="button" id="closeConsultaBtn" class="fig-btn fig-btn-accept">Cerrar consulta</button>
      </div>
    </div>`;

  // ------------------------- nota principal (generada desde el esquema) -------------------------
  function defaultValues(type) {
    if (type === 'urgencias') {
      const now = new Date();
      return { fechaServicio: localDayKey(now), horaServicio: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}` };
    }
    return {};
  }

  /** Dibuja las tarjetas de la nota según el tipo elegido y las reparte en dos columnas. */
  function renderNote() {
    const values = state.valuesByType[state.type] || defaultValues(state.type);

    const cards = [];
    if (state.type === 'historiaClinica') {
      cards.push({ id: 'ficha', numeral: '6.1.1', title: 'Ficha de identificación', body: fichaHtml(patient) });
    }
    for (const section of editableSections(state.type)) {
      cards.push({ id: section.numeral, numeral: section.numeral, title: section.title, fields: section.fields, body: `<div data-fields="${escapeHtml(section.numeral)}"></div>` });
    }

    // Primero todas en la columna izquierda; balanceColumns() mueve el resto a la derecha al medirlas
    $('#noteCols').innerHTML = `<div class="consulta-col">${cards.map((card) => cardHtml(card)).join('')}</div><div class="consulta-col"></div>`;

    state.cards = cards.filter((card) => card.fields).map((card) => {
      const box = $(`#noteCols [data-fields="${CSS.escape(card.id)}"]`);
      renderFields(box, card.fields, values);
      return { fields: card.fields, box };
    });
    balanceColumns($('#noteCols'));

    setRadio('tipoNota', state.type);
    $('#noteTypeHint').textContent = state.type === 'historiaClinica' && hasHistoria
      ? 'Este paciente ya tiene historia clínica; en una consulta subsecuente corresponde una nota de evolución.'
      : state.type === 'evolucion' && !hasHistoria
        ? 'Este paciente aún no tiene historia clínica; en su primera consulta corresponde la historia clínica.'
        : '';
  }

  /** Lee todas las tarjetas y junta los valores en un solo objeto (la nota principal). */
  const collectNote = () => Object.assign({}, ...state.cards.map((card) => readValues(card.box, card.fields)));

  /**
   * Valida cada tarjeta y devuelve el total de errores. Abre las tarjetas plegadas que tengan errores
   * y deja el foco en el primer campo con problema (validateForm enfoca uno por tarjeta).
   */
  function validateNote() {
    let count = 0;
    for (const card of state.cards) {
      const errors = validateForm(card.box, card.fields);
      if (errors.length > 0) card.box.closest('details').open = true;
      count += errors.length;
    }
    const first = $('#noteCols [aria-invalid="true"]');
    if (first) { first.focus(); first.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    return count;
  }

  /** Valores que la pantalla precarga por comodidad: no cuentan como "contenido clínico". */
  function withoutPrefilled(kind, data) {
    const copy = structuredClone(data);
    if (kind === 'urgencias') { delete copy.fechaServicio; delete copy.horaServicio; }
    if (kind === 'referencia' && copy.establecimientoEnvia === DEFAULT_SENDER) delete copy.establecimientoEnvia;
    return copy;
  }

  // ------------------------- interconsulta / referencia / manejo -------------------------
  const interFields = NOTE_TYPES.interconsulta.fields;
  const refFields = NOTE_TYPES.referencia.fields;

  function syncBlocks() {
    $('#interconsultaBlock').classList.toggle('hidden', getRadio('interconsulta') !== 'si');
    $('#referenciaBlock').classList.toggle('hidden', getRadio('referencia') !== 'si');
    $('#medicamentoBlock').classList.toggle('hidden', getRadio('manejo') !== 'medicamento');
    $('#enfermedad').classList.toggle('hidden', getRadio('notificable') !== 'si');
  }

  function readTratamiento() {
    const manejo = getRadio('manejo');
    const notificable = triBool('notificable');
    return {
      manejo,
      medicamento: manejo === 'medicamento' ? $('#medicamento').value.trim() : '',
      dosisVia: manejo === 'medicamento' ? $('#dosisVia').value.trim() : '',
      rpbi: triBool('rpbi'),
      notificacionObligatoria: notificable,
      enfermedad: notificable ? $('#enfermedad').value : '',
      indicacionesPaciente: $('#indicacionesPaciente').value.trim(),
    };
  }

  // ------------------------- borrador -------------------------
  function collectDraft() {
    state.valuesByType[state.type] = collectNote();
    return {
      tipoNota: state.type,
      valoresPorTipo: state.valuesByType,
      alergias: $('#alergias').value,
      interconsultaSi: getRadio('interconsulta') === 'si',
      interconsulta: readValues($('#interconsultaForm'), interFields),
      referenciaSi: getRadio('referencia') === 'si',
      referencia: readValues($('#referenciaForm'), refFields),
      urgenciaTraslado: getRadio('traslado'),
      tratamiento: readTratamiento(),
    };
  }

  function applyDraft(draft) {
    if (draft && MAIN_NOTE_TYPES.includes(draft.tipoNota)) {
      state.type = draft.tipoNota;
      state.valuesByType = draft.valoresPorTipo || {};
    }
    renderNote();

    $('#alergias').value = draft && typeof draft.alergias === 'string' ? draft.alergias : (patient.alergias || '');
    renderFields($('#interconsultaForm'), interFields, (draft && draft.interconsulta) || {}, { idPrefix: 'int-' });
    renderFields($('#referenciaForm'), refFields, (draft && draft.referencia) || { establecimientoEnvia: DEFAULT_SENDER }, { idPrefix: 'ref-' });

    if (!draft) { syncBlocks(); return; }
    setRadio('interconsulta', draft.interconsultaSi ? 'si' : 'no');
    setRadio('referencia', draft.referenciaSi ? 'si' : 'no');
    if (draft.urgenciaTraslado) setRadio('traslado', draft.urgenciaTraslado);
    const t = draft.tratamiento || {};
    if (t.manejo) setRadio('manejo', t.manejo);
    $('#medicamento').value = t.medicamento || '';
    $('#dosisVia').value = t.dosisVia || '';
    if (t.rpbi === true) setRadio('rpbi', 'si'); else if (t.rpbi === false) setRadio('rpbi', 'no');
    if (t.notificacionObligatoria === true) setRadio('notificable', 'si'); else if (t.notificacionObligatoria === false) setRadio('notificable', 'no');
    if (t.enfermedad) $('#enfermedad').value = t.enfermedad;
    $('#indicacionesPaciente').value = t.indicacionesPaciente || '';
    syncBlocks();
  }

  // ------------------------- acciones -------------------------
  const showError = (message) => { const box = $('#consultaError'); box.textContent = message; box.classList.toggle('hidden', message === ''); };
  const setBusy = (busy) => { $('#saveDraftBtn').disabled = busy; $('#closeConsultaBtn').disabled = busy; };

  async function handleSaveDraft() {
    showError('');
    setBusy(true);
    try {
      await saveConsultaDraft(folio, collectDraft());
      toast('Borrador guardado.', 'success');
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    showError('');

    // 1) Validar formatos y tamaños del Excel, formulario por formulario
    if (validateNote() > 0) { showError('Corrige los campos marcados en la nota clínica.'); return; }
    const useInterconsulta = getRadio('interconsulta') === 'si';
    const useReferencia = getRadio('referencia') === 'si';
    if (useInterconsulta && validateForm($('#interconsultaForm'), interFields).length > 0) { showError('Corrige los campos marcados en la interconsulta.'); return; }
    if (useReferencia && validateForm($('#referenciaForm'), refFields).length > 0) { showError('Corrige los campos marcados en la referencia.'); return; }

    // 2) Reglas de contenido
    const nota = collectNote();
    if (!hasContent(withoutPrefilled(state.type, nota))) { showError('La nota clínica está vacía: captura al menos un dato.'); return; }
    const interconsulta = useInterconsulta ? readValues($('#interconsultaForm'), interFields) : null;
    if (useInterconsulta && !hasContent(interconsulta)) { showError('Marcaste interconsulta pero no capturaste ningún dato: complétala o cambia a "No".'); return; }
    const referencia = useReferencia ? readValues($('#referenciaForm'), refFields) : null;
    if (useReferencia && !hasContent(withoutPrefilled('referencia', referencia))) { showError('Marcaste referencia pero no capturaste ningún dato: complétala o cambia a "No".'); return; }
    const tratamiento = readTratamiento();
    if (tratamiento.indicacionesPaciente === '') { showError('Escribe las indicaciones para el paciente (tarjeta "Manejo / resolución").'); $('#indicacionesPaciente').focus(); return; }

    // 3) Confirmar: las notas no se pueden editar después
    const ok = await confirmDialog({
      title: 'Cerrar consulta',
      message: `Las notas de ${fullName(patient)} se agregarán al expediente y no podrán editarse ni borrarse. ¿Cerrar la consulta?`,
      confirmText: 'Cerrar consulta',
    });
    if (!ok) return;

    setBusy(true);
    try {
      await closeConsulta(folio, {
        tipoNota: state.type,
        nota,
        alergias: $('#alergias').value,
        interconsulta,
        referencia,
        urgenciaTraslado: useReferencia ? getRadio('traslado') : '',
        tratamiento,
      });
      toast(`Consulta ${folio} cerrada. Las notas se agregaron al expediente.`, 'success');
      window.location.href = '/medico';
    } catch (error) {
      showError(error.message);
      setBusy(false);
    }
  }

  // ------------------------- arranque -------------------------
  renderHistorial($('#historial'), historyNotes);
  applyDraft(visit.consultaBorrador);

  container.addEventListener('change', (event) => {
    if (event.target.name === 'tipoNota') {
      state.valuesByType[state.type] = collectNote(); // conservar lo capturado del tipo anterior
      state.type = event.target.value;
      renderNote();
    } else if (['interconsulta', 'referencia', 'manejo', 'notificable'].includes(event.target.name)) {
      syncBlocks();
    }
  });
  $('#saveDraftBtn').addEventListener('click', handleSaveDraft);
  $('#closeConsultaBtn').addEventListener('click', handleClose);
}
