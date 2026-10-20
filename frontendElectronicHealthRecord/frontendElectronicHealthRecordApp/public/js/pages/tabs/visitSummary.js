/*
 * visitSummary.js — resumen de UNA visita (folio), sin notas clínicas. Es lo que abren los
 * enlaces "Ver →" de la agenda de recepción; el médico además puede saltar al expediente.
 */

import { ROLES, APPOINTMENT_TYPES, APPOINTMENT_STATUS } from '/js/core/config.js';
import { getVisit } from '/js/core/api.js';
import { escapeHtml, statusBadge, formatDateTime } from '/js/core/ui.js';
import { patientBannerHtml } from '/js/core/views.js';
import { MANAGEMENT_OPTIONS } from '/js/data/catalogs.js';

/** Lista de definiciones [nombre, valor]; omite los valores vacíos. */
function listHtml(rows) {
  return `<dl style="margin:0;font-size:14px">${rows.filter(([, value]) => value).map(([name, value]) => `
    <div style="margin-bottom:8px">
      <dt class="view-dt">${escapeHtml(name)}</dt>
      <dd style="margin:0;white-space:pre-wrap">${escapeHtml(value)}</dd>
    </div>`).join('')}</dl>`;
}

function appointmentHtml(visit) {
  return listHtml([
    ['Fecha y hora de la cita', visit.fechaHora ? formatDateTime(visit.fechaHora) : ''],
    ['Tipo de cita', visit.tipoCita ? (APPOINTMENT_TYPES.find((t) => t.id === visit.tipoCita) || {}).label : ''],
    ['Estatus de la cita', (APPOINTMENT_STATUS.find((t) => t.id === visit.estatusCita) || {}).label],
    ['Notas de la cita', visit.notasCita],
  ]);
}

function managementHtml(treatment) {
  return listHtml([
    ['Manejo', (MANAGEMENT_OPTIONS.find((o) => o.id === treatment.manejo) || {}).label],
    ['Medicamento', treatment.medicamento],
    ['Dosis / vía', treatment.dosisVia],
    ['¿Generó RPBI?', treatment.rpbi === true ? 'Sí' : treatment.rpbi === false ? 'No' : ''],
    ['Notificación obligatoria', treatment.notificacionObligatoria ? `Sí — ${treatment.enfermedad || ''}` : ''],
    ['Indicaciones para el paciente', treatment.indicacionesPaciente],
  ]);
}

/** @param {HTMLElement} container @param {{user: object, folio: string}} ctx */
export async function renderVisitSummary(container, { user, folio }) {
  const visit = await getVisit(folio);

  const sections = [['Cita', appointmentHtml(visit)]];
  if (visit.consulta) sections.push(['Manejo e indicaciones del médico', managementHtml(visit.consulta.tratamiento)]);

  const patientId = encodeURIComponent(visit.patientId);
  const links = user.rol === ROLES.MEDICO
    ? `<a class="fig-link" href="/expediente?paciente=${patientId}&tab=consultas">Ver expediente completo →</a>`
    : `<a class="fig-link" href="/expediente?paciente=${patientId}&tab=ficha">Ver ficha de datos →</a>
       <a class="fig-link" href="/expediente?paciente=${patientId}&tab=consultas">Llenar nota SOAP →</a>`;

  container.innerHTML = `
    <div style="padding:6px 0 30px">
      ${patientBannerHtml(visit.patient, visit.folio)}
      <div class="fig-card" style="padding:16px 20px;margin-top:12px;display:flex;flex-wrap:wrap;gap:12px 32px;align-items:center">
        <div><span class="soap-hint" style="display:block">ESTADO</span>${statusBadge(visit.estado)}</div>
        <div><span class="soap-hint" style="display:block">MOTIVO</span>${escapeHtml(visit.motivo)}</div>
        ${visit.resultado ? `<div><span class="soap-hint" style="display:block">RESULTADO</span>${escapeHtml(visit.resultado)}</div>` : ''}
        <div style="margin-left:auto;display:flex;gap:16px;align-items:center;flex-wrap:wrap">${links}</div>
      </div>
      ${sections.map(([title, html]) => `
        <section class="fig-card" style="padding:16px 20px;margin-top:12px">
          <h2 style="font-size:16px;font-weight:600;margin:0 0 10px">${escapeHtml(title)}</h2>
          ${html}
        </section>`).join('')}
    </div>`;
}
