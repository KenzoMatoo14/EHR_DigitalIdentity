/*
 * consultasTab.js — pestaña "Consultas" (frame "Consulta" del Figma, con el contenido de la consulta
 * por secciones NOM).
 *
 *  · Recepción/enfermería: la nota SOAP de enfermería (soapForm.js), guardada en MySQL.
 *  · Con ?folio=… (el médico pulsó "Atender" en la agenda): la consulta en dos columnas (consultaForm.js).
 *  · Sin folio: historial de consultas del paciente (las notas clínicas, más recientes primero).
 */

import { STATUS, ROLES } from '/js/core/config.js';
import { startConsulta, getPatientRecord } from '/js/core/api.js';
import { escapeHtml, getQueryParam } from '/js/core/ui.js';
import { mountConsulta, renderHistorial, MAIN_NOTE_TYPES } from '/js/pages/tabs/consultaForm.js';
import { render as renderSoap } from '/js/pages/tabs/soapForm.js';

const messageHtml = (text, link) => `
  <div class="fig-card" style="padding:20px;margin-top:10px">
    <p style="margin:0 0 10px">${escapeHtml(text)}</p>
    ${link ? `<a class="fig-link" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>` : ''}
  </div>`;

/** @param {HTMLElement} container @param {{user: object, patient: object, folio: string|null}} ctx */
export async function render(container, { user, patient, folio }) {
  // Recepción/enfermería: nota SOAP (frame "ConsultaSOAP"), guardada en MySQL.
  if (user.rol === ROLES.RECEPCION) {
    await renderSoap(container, { patient });
    return;
  }

  const record = await getPatientRecord(patient.id);

  // --- Sin consulta en curso: solo el historial ---
  if (!folio) {
    container.innerHTML = `
      <div style="padding:10px 0">
        <p class="soap-hint" style="margin:0 0 12px">Historial de consultas. Para iniciar una consulta, atiende al paciente desde la agenda.</p>
        <div id="historial"></div>
      </div>`;
    renderHistorial(container.querySelector('#historial'), record.notes.filter((n) => MAIN_NOTE_TYPES.includes(n.tipo)), { openFirst: true });
    return;
  }

  // --- Consulta en curso ---
  const visit = await startConsulta(folio); // "esperando médico" -> "con el médico" (si ya lo estaba, no cambia)
  if (visit.patientId !== patient.id) {
    container.innerHTML = messageHtml('El folio no corresponde a este paciente.', { href: '/medico', label: 'Volver a la agenda →' });
    return;
  }
  if (visit.estado !== STATUS.EN_CONSULTA) {
    container.innerHTML = messageHtml(`La visita ${folio} ya no está en consulta.`, { href: '/medico', label: 'Volver a la agenda →' });
    return;
  }

  // ?tipo= viene del botón "Agregar consulta": soap -> nota de evolución, historial -> historia clínica
  const initialType = { soap: 'evolucion', historial: 'historiaClinica' }[getQueryParam('tipo')];
  mountConsulta(container, { patient, visit, record, initialType });
}
