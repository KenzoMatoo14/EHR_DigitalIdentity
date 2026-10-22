/*
 * antecedentesTab.js — pestaña "Antecedentes" (recepción/enfermería y médico).
 *
 * Arriba, el editor (antecedentesEditor.js): alergias primero (NOM-024 1.3.6), luego heredo-
 * familiares, patológicos (con uso y dependencia de sustancias), no patológicos y los opcionales.
 * Abajo, el HISTORIAL: cada guardado con cambios es una versión nueva en MySQL (solo-agregar), y
 * aquí se pueden consultar todas. La nota SOAP apunta a la versión vigente al momento de la visita.
 */

import { getAntecedentes, getAntecedentesHistorial } from '/js/core/api.js';
import { escapeHtml, formatDateTime } from '/js/core/ui.js';
import { mountEditor, summaryHtml, versionText } from '/js/pages/tabs/antecedentesEditor.js';

function historialHtml(versions) {
  if (versions.length === 0) return '<p class="soap-hint">Sin versiones todavía.</p>';
  return versions.map((v, index) => `
    <details class="soap-note">
      <summary>
        <strong>Versión ${escapeHtml(v.version)}</strong>
        <span class="soap-hint"> ${escapeHtml(formatDateTime(v.creadoEn))}${index === 0 ? ' · vigente' : ''}</span>
      </summary>
      <div style="padding-top:10px">
        <p class="soap-hint" style="margin:0 0 8px">${escapeHtml(versionText(v))}</p>
        ${summaryHtml(v)}
        <p class="soap-hint" style="margin:0;overflow-wrap:anywhere">Hash SHA-256: <code>${escapeHtml(v.hash)}</code></p>
      </div>
    </details>`).join('');
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
    <p class="soap-hint" style="margin:12px 0 0">Cada vez que guardas con cambios se crea una versión nueva; las anteriores se conservan en el historial.</p>
    <div id="antEditor" style="padding-top:10px"></div>
    <section style="padding:0 0 30px">
      <h2 class="consulta-h" style="margin:0 0 10px">Historial de versiones</h2>
      <div id="antHistorial"><p class="soap-hint">Cargando…</p></div>
    </section>`;

  const historialBox = container.querySelector('#antHistorial');
  const refreshHistorial = async () => { historialBox.innerHTML = historialHtml(await getAntecedentesHistorial(patient.id)); };

  mountEditor(container.querySelector('#antEditor'), {
    patient,
    saved: await getAntecedentes(patient.id),
    onSaved: refreshHistorial,
  });
  await refreshHistorial();
}
