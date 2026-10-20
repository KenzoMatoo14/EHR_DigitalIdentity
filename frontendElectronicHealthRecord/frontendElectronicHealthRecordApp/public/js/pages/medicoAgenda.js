/*
 * medicoAgenda.js — inicio del médico: pacientes que ya llegaron, en el orden de su cita
 * (no por tiempo de espera) y los ya atendidos. Usa las mismas filas de la agenda del Figma
 * (chip de hora, nombre, correo, tipo) pero en lugar del estado muestra el MOTIVO de la visita.
 * El botón "Agregar consulta" abre una consulta para cualquier paciente (ver modals.js).
 */

import { ROLES, STATUS } from '/js/core/config.js';
import { requireSession } from '/js/core/session.js';
import { listDoctorAgenda } from '/js/core/api.js';
import { mountShell, escapeHtml, formatHora12, reportError } from '/js/core/ui.js';
import { openModalFromQuery, addConsultationFlow } from '/js/core/modals.js';
import { fullName, patientKind } from '/js/core/util.js';

const $ = (id) => document.getElementById(id);

function rowHtml(visit) {
  const consultaUrl = `/expediente?paciente=${encodeURIComponent(visit.patientId)}&folio=${encodeURIComponent(visit.folio)}&tab=consultas`;
  const recordUrl = `/expediente?paciente=${encodeURIComponent(visit.patientId)}&tab=consultas`;
  const time = visit.fechaHora || visit.llegadaAt;
  const motivo = visit.motivo || 'Consulta general';

  let link;
  if (visit.estado === STATUS.EN_CONSULTA) link = `<a class="fig-link" href="${consultaUrl}">Continuar →</a>`;
  else if (visit.estado === STATUS.ESPERANDO_MEDICO) link = `<a class="fig-link" href="${consultaUrl}">Atender →</a>`;
  else link = `<a class="fig-link" href="${recordUrl}">Ver expediente →</a>`;

  return `
    <div class="fig-slot">
      <div class="fig-slot-time"><div class="fig-hora">${escapeHtml(formatHora12(time))}</div></div>
      <div class="fig-person">
        <span class="fig-person-name">${escapeHtml(fullName(visit.patient))}</span>
        ${visit.patient.correo ? '<img src="/images/correo.png" alt="Correo registrado">' : '<span></span>'}
        <span class="fig-person-tipo">${escapeHtml(patientKind(visit.patient))}</span>
        <div class="fig-person-status"><span class="fig-motivo" title="${escapeHtml(motivo)}">${escapeHtml(motivo)}</span>${link}</div>
      </div>
    </div>`;
}

const emptyHtml = (text) => `<p class="soap-hint" style="padding:16px">${escapeHtml(text)}</p>`;

async function render() {
  const { pending, attended } = await listDoctorAgenda();

  $('pendingList').innerHTML = pending.length > 0
    ? pending.map(rowHtml).join('')
    : emptyHtml('No hay pacientes esperando por ahora.');
  $('attendedList').innerHTML = attended.length > 0
    ? attended.map(rowHtml).join('')
    : emptyHtml('Aún no hay consultas cerradas hoy.');
}

async function main() {
  const user = requireSession([ROLES.MEDICO]);
  if (!user) return;
  const active = new URLSearchParams(window.location.search).has('pacientes') ? 'pacientes' : 'inicio';
  mountShell({ user, active });

  $('addConsultaBtn').addEventListener('click', addConsultationFlow);
  await render();
  await openModalFromQuery(user, render);
}

main().catch(reportError);
