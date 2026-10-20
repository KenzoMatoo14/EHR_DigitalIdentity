/*
 * interconsultasTab.js — pestaña "Interconsultas": notas de interconsulta (6.3) y de
 * referencia/traslado (6.4) del paciente, en solo lectura. Son notas SOLO-AGREGAR.
 */

import { getPatientRecord } from '/js/core/api.js';
import { escapeHtml, formatDateTime } from '/js/core/ui.js';
import { NOTE_TYPES, getSections } from '/js/data/schema.js';
import { renderView } from '/js/core/formRenderer.js';

const KINDS = ['interconsulta', 'referencia'];

/** @param {HTMLElement} container @param {{patient: object}} ctx */
export async function render(container, { patient }) {
  const { notes } = await getPatientRecord(patient.id);
  const derived = notes.filter((n) => KINDS.includes(n.tipo));

  if (derived.length === 0) {
    container.innerHTML = '<p class="soap-hint" style="padding:16px 0">Este paciente no tiene interconsultas ni referencias.</p>';
    return;
  }

  container.innerHTML = `<div style="padding:10px 0">${derived.map((note, index) => {
    const type = NOTE_TYPES[note.tipo];
    return `
      <details class="soap-note" ${index === 0 ? 'open' : ''}>
        <summary>
          <strong>${escapeHtml(type.label)}</strong>
          <span class="soap-hint"> ${escapeHtml(type.numeral)} · ${escapeHtml(formatDateTime(note.createdAt))} · ${escapeHtml(note.autor)} · ${escapeHtml(note.folio)}</span>
        </summary>
        <div style="padding-top:10px" data-note="${escapeHtml(note.id)}"></div>
      </details>`;
  }).join('')}</div>`;

  for (const note of derived) {
    renderView(container.querySelector(`[data-note="${CSS.escape(note.id)}"]`), getSections(note.tipo), note.data);
  }
}
