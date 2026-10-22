/*
 * soapForm.js — nota SOAP de enfermería (frame "ConsultaSOAP" del Figma), dentro de la pestaña
 * "Consultas" cuando entra recepción/enfermería. Es el camino "resuelto en enfermería".
 *
 *   ┌ Subjetivo ─────────────────────┬ (Alergias: sin campos del Excel, no se dibuja) ┐
 *   ├ Signos vitales | antropométricos┼ Historiales                                    ┤
 *   ├ Exploración física              ┼ Análisis diagnóstico                           ┤
 *   ├ Tratamiento                     ┼ Laboratorio                                    ┤
 *   ├ (PLAN: solo tendría campos de 6.3/6.4, no se dibuja)                              ┤
 *   ├ Guardar nota ────────────────────────────────────────────────────────────────────┤
 *   └ Notas SOAP anteriores (de MySQL, la más reciente primero) ──────────────────────┘
 *
 * Los campos salen de SOAP_PANELS (data/schema.js), que toma las definiciones del Excel; el
 * formulario se genera con formRenderer. Al guardar se agrega una nota en MySQL (POST /api/notaSoap):
 * es SOLO-AGREGAR, por eso se pide confirmación. La fecha y hora del servicio las pone el backend.
 *
 * Pensada para ser RÁPIDA: ningún campo es obligatorio (la enfermera captura solo lo crucial), pero
 * lo que se captura se valida (tipo, tamaño y rango del esquema). El formulario abre VACÍO.
 * En la lista de abajo solo se muestran los campos con dato (renderView omite los vacíos).
 *
 * ANTECEDENTES: la nota ya no los copia. El panel "Historiales" muestra los vigentes de solo
 * lectura (no se vuelven a capturar) y tiene "Actualizar antecedentes", que guarda una versión
 * nueva en la tabla de antecedentes, no en la nota. Al guardar la nota, el backend registra a qué
 * versión apuntaba (antecedentesRef).
 */

import { listSoapNotes, createSoapNote, getAntecedentes } from '/js/core/api.js';
import { escapeHtml, toast, confirmDialog } from '/js/core/ui.js';
import { SOAP_PANELS } from '/js/data/schema.js';
import { renderFields, readValues, validateForm, hasContent, renderView } from '/js/core/formRenderer.js';
import { mountEditor, summaryHtml } from '/js/pages/tabs/antecedentesEditor.js';

const ID_PREFIX = 'soap-';
const ALL_FIELDS = SOAP_PANELS.flatMap((panel) => panel.fields);
// Para la vista de solo lectura: un panel = una sección (sin numeral de la NOM: mezcla varias hojas)
const VIEW_SECTIONS = SOAP_PANELS.filter((panel) => !panel.antecedentes)
  .map((panel) => ({ numeral: '', title: panel.title, fields: panel.fields }));

function panelHtml(panel) {
  return `
    <details class="consulta-card" open data-panel-card="${escapeHtml(panel.id)}">
      <summary>
        <span>${escapeHtml(panel.title)}</span>
        <span class="chev" aria-hidden="true">▶</span>
      </summary>
      <div class="card-body"><div data-panel="${escapeHtml(panel.id)}"></div></div>
    </details>`;
}

const columnHtml = (side) => SOAP_PANELS.filter((panel) => panel.column === side).map(panelHtml).join('');

/** Dibuja los campos de cada panel, vacíos (el de antecedentes se dibuja aparte). */
function renderPanels(form) {
  for (const panel of SOAP_PANELS) {
    if (panel.antecedentes) continue;
    renderFields(form.querySelector(`[data-panel="${panel.id}"]`), panel.fields, {}, { idPrefix: ID_PREFIX });
  }
}

/**
 * Panel "Historiales": resumen de solo lectura + editor plegado para actualizar. El editor es un
 * <div> dentro del <form> de la nota; sus controles no tienen data-path, así que readValues de la
 * nota no los lee, y su botón es type="button" (no envía la nota).
 */
async function mountAntecedentesPanel(form, patient) {
  const box = form.querySelector('[data-panel="historiales"]');
  box.innerHTML = `
    <div data-ant-summary><p class="soap-hint">Cargando…</p></div>
    <div class="soap-actions" style="padding-bottom:10px">
      <button type="button" class="fig-btn fig-btn-neutral" data-ant-toggle>Actualizar antecedentes</button>
    </div>
    <div data-ant-editor hidden></div>`;
  const summary = box.querySelector('[data-ant-summary]');
  const editorBox = box.querySelector('[data-ant-editor]');
  const toggle = box.querySelector('[data-ant-toggle]');

  const show = (saved) => { summary.innerHTML = summaryHtml(saved); };
  let saved = await getAntecedentes(patient.id);
  show(saved);

  toggle.addEventListener('click', () => {
    const opening = editorBox.hidden;
    editorBox.hidden = !opening;
    toggle.textContent = opening ? 'Cerrar sin guardar' : 'Actualizar antecedentes';
    if (opening) {
      mountEditor(editorBox, {
        patient,
        saved,
        onSaved: (version) => {
          saved = version;
          show(saved);
          editorBox.hidden = true;
          toggle.textContent = 'Actualizar antecedentes';
        },
      });
    }
  });
}

/** Formato corto dd/mm/aaaa · hh:mm a partir de 'aaaa-mm-dd' y 'hh:mm'. */
const formatServicio = (fecha, hora) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)} · ${hora}`;

function renderNotes(box, notes) {
  if (notes.length === 0) {
    box.innerHTML = '<p class="soap-hint">Sin notas SOAP previas.</p>';
    return;
  }
  box.innerHTML = notes.map((note, index) => {
    const motivo = note.data.motivoAtencion || note.data.padecimientoActual || '';
    return `
      <details class="soap-note" ${index === 0 ? 'open' : ''}>
        <summary>
          <strong>Nota SOAP #${escapeHtml(note.id)}</strong>
          <span class="soap-hint"> ${escapeHtml(formatServicio(note.fechaServicio, note.horaServicio))}${motivo ? ` · ${escapeHtml(motivo.slice(0, 60))}` : ''}</span>
        </summary>
        <p class="soap-hint" style="margin:10px 0 0">${note.antecedentesRef
          ? `Antecedentes vigentes en esta visita: versión ${escapeHtml(note.antecedentesRef.version)}`
          : 'El paciente no tenía antecedentes registrados en esta visita.'}</p>
        <div style="padding-top:10px" data-note="${escapeHtml(note.id)}"></div>
      </details>`;
  }).join('');
  for (const note of notes) {
    renderView(box.querySelector(`[data-note="${note.id}"]`), VIEW_SECTIONS, note.data);
  }
}

/** @param {HTMLElement} container @param {{patient: object}} ctx */
export async function render(container, { patient }) {
  if (!patient.curp) {
    container.innerHTML = `
      <div class="fig-card" style="padding:20px;margin-top:10px">
        <p style="margin:0 0 10px">Este paciente aún no tiene CURP, que es su llave en la base de datos.</p>
        <a class="fig-link" href="/expediente?paciente=${encodeURIComponent(patient.id)}&tab=ficha">Capturarla en la Ficha de datos →</a>
      </div>`;
    return;
  }

  container.innerHTML = `
    <form id="soapForm" novalidate>
      <p class="soap-hint" style="margin:12px 0 0">Nota SOAP de enfermería. Ningún campo es obligatorio: captura solo lo importante. Cada vez que guardas se agrega una nota nueva al expediente; las notas no se editan ni se borran.</p>
      <div class="consulta-cols">
        <div class="consulta-col">${columnHtml('left')}</div>
        <div class="consulta-col">${columnHtml('right')}</div>
      </div>
      <p class="fig-modal-error hidden" data-error role="alert"></p>
      <div class="soap-actions"><button type="submit" class="fig-btn fig-btn-accept">Guardar nota</button></div>
    </form>
    <section style="padding:0 0 30px">
      <h2 class="consulta-h" style="margin:0 0 10px">Notas SOAP anteriores</h2>
      <div id="soapNotes"><p class="soap-hint">Cargando…</p></div>
    </section>`;

  const form = container.querySelector('#soapForm');
  const errorBox = container.querySelector('[data-error]');
  const notesBox = container.querySelector('#soapNotes');

  renderPanels(form);
  await mountAntecedentesPanel(form, patient);
  renderNotes(notesBox, await listSoapNotes(patient.id));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.classList.add('hidden');
    // Los controles de todos los paneles están dentro del <form>: se valida y se lee de una vez.
    // El botón está al final de una página larga: además del error junto a cada campo, se resume
    // aquí qué campos revisar, para que no parezca que "no hace nada".
    const errors = validateForm(form, ALL_FIELDS);
    if (errors.length > 0) {
      const names = errors.map(({ path, message }) => {
        const label = form.querySelector(`[data-path="${CSS.escape(path)}"]`)?.closest('.fig-field')?.querySelector('label');
        return `${label ? label.textContent.trim() : path} (${message})`;
      });
      errorBox.textContent = `No se guardó. Revisa ${errors.length === 1 ? 'el campo marcado' : 'los campos marcados'} en rojo: ${names.join('; ')}.`;
      errorBox.classList.remove('hidden');
      return;
    }
    const values = readValues(form, ALL_FIELDS);
    if (!hasContent(values)) {
      errorBox.textContent = 'La nota está vacía: captura al menos un dato.';
      errorBox.classList.remove('hidden');
      return;
    }

    const ok = await confirmDialog({
      title: 'Guardar nota SOAP',
      message: 'La nota se agregará al expediente y ya no se podrá editar ni borrar. ¿Guardar?',
      confirmText: 'Guardar nota',
    });
    if (!ok) return;

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const nota = await createSoapNote(patient.id, values);
      toast(`Nota SOAP #${nota.id} guardada.`, 'success');
      renderPanels(form); // formulario limpio para la siguiente
      renderNotes(notesBox, await listSoapNotes(patient.id));
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      button.disabled = false;
    }
  });
}
