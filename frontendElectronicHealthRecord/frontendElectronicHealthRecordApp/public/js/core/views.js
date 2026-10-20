/*
 * views.js — fragmentos de HTML de solo lectura que se repiten en varias páginas
 * (por ahora, el banner del paciente). Devuelven strings ya escapados.
 */

import { escapeHtml, initialsOf } from './ui.js';
import { fullName, patientKind } from './util.js';

/** Tarjeta con iniciales, nombre, tipo de paciente y folio. */
export function patientBannerHtml(patient, folio) {
  const idn = patient.idInstitucional ? ` · ID ${patient.idInstitucional}` : '';
  return `
    <div class="fig-card" style="padding:14px 18px;display:flex;align-items:center;gap:14px">
      <div class="fig-avatar" style="width:40px;height:40px" aria-hidden="true">${escapeHtml(initialsOf(fullName(patient)))}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:20px">${escapeHtml(fullName(patient))}</div>
        <div class="soap-hint">${escapeHtml(patientKind(patient))}${escapeHtml(idn)} · Expediente ${escapeHtml(patient.expediente)}</div>
      </div>
      ${folio ? `<div style="text-align:right;font-size:14px"><span class="soap-hint">Folio</span> <strong style="font-family:monospace">${escapeHtml(folio)}</strong></div>` : ''}
    </div>`;
}
