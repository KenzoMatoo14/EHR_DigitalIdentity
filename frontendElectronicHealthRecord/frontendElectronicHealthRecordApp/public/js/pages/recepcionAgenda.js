/*
 * recepcionAgenda.js — "Agenda del día" de Recepción / Enfermería (frame "Main" del Figma).
 *
 * Una fila por cada bloque de 5 minutos: chip de hora cian, nombre, icono de correo y tipo de
 * paciente. Los huecos libres se ven solo con la hora y, al hacer clic, abren "Cita Edición".
 * A la derecha (zona vacía en el Figma) se muestra el estado de la visita y la acción que sigue.
 */

import { ROLES, STATUS, SLOT_MINUTES, AGENDA_START_HOUR, AGENDA_END_HOUR, APPOINTMENT_STATUS } from '/js/core/config.js';
import { requireSession } from '/js/core/session.js';
import { listAgenda, registerArrival } from '/js/core/api.js';
import { mountShell, escapeHtml, formatHora12, statusBadge, toast, reportError } from '/js/core/ui.js';
import { appointmentModal, registerPatientFlow, openModalFromQuery } from '/js/core/modals.js';
import { fullName, patientKind } from '/js/core/util.js';

const $ = (id) => document.getElementById(id);

// Últimas visitas cargadas: el clic en una fila las consulta para saber qué cita se edita
let visitsCache = [];

const slotKey = (date) => `${date.getHours()}:${date.getMinutes()}`;

/** Estatus de la cita (por confirmar / confirmada) mientras el paciente aún no llega. */
function appointmentBadge(visit) {
  const label = (APPOINTMENT_STATUS.find((s) => s.id === visit.estatusCita) || {}).label || 'Cita por confirmar';
  return `<span class="fig-badge ${visit.estatusCita === 'confirmada' ? 'ok' : 'warn'}">${escapeHtml(label)}</span>`;
}

function statusCell(visit) {
  const folio = encodeURIComponent(visit.folio || '');
  switch (visit.estado) {
    case STATUS.AGENDADO:
      return `${appointmentBadge(visit)}<button type="button" class="fig-link" data-arrival="${escapeHtml(visit.id)}">Registrar llegada</button>`;
    case STATUS.NO_SE_PRESENTO:
      return `${statusBadge(visit.estado)}<button type="button" class="fig-link" data-edit="${escapeHtml(visit.id)}">Reagendar</button>`;
    default: // esperando médico, con el médico, cerrada
      return `${statusBadge(visit.estado)}<a class="fig-link" href="/expediente?folio=${folio}">Ver →</a>`;
  }
}

/** Solo se pueden editar las citas que todavía no se atienden. */
const isEditable = (visit) => visit.estado === STATUS.AGENDADO || visit.estado === STATUS.NO_SE_PRESENTO;

function rowHtml({ slotDate, visit, showTime, isNow }) {
  const clickable = !visit || isEditable(visit);
  const attrs = visit
    ? (isEditable(visit) ? `data-edit="${escapeHtml(visit.id)}" data-clickable` : '')
    : `data-new="${slotDate.toISOString()}" data-clickable`;
  const person = visit
    ? `<span class="fig-person-name">${escapeHtml(fullName(visit.patient))}</span>
       ${visit.patient.correo ? '<img src="/images/correo.png" alt="Correo registrado">' : '<span></span>'}
       <span class="fig-person-tipo">${escapeHtml(patientKind(visit.patient))}</span>
       <div class="fig-person-status">${statusCell(visit)}</div>`
    : '';
  return `
    <div class="fig-slot" ${attrs} ${clickable ? 'title="' + (visit ? 'Editar cita' : 'Nueva cita a esta hora') + '"' : ''}>
      <div class="fig-slot-time">${showTime ? `<div class="fig-hora ${isNow ? 'now' : ''}" ${isNow ? 'id="nowSlot"' : ''}>${formatHora12(slotDate)}</div>` : ''}</div>
      <div class="fig-person">${person}</div>
    </div>`;
}

async function render() {
  const visits = await listAgenda();
  visitsCache = visits;

  // Rango de filas: el de la jornada, ampliado si alguna cita cae fuera
  const hours = visits.filter((v) => v.fechaHora).map((v) => new Date(v.fechaHora).getHours());
  const startHour = Math.min(AGENDA_START_HOUR, ...hours);
  const endHour = Math.max(AGENDA_END_HOUR, ...hours.map((h) => h + 1));

  // Agrupar las visitas por bloque de 5 minutos (si dos comparten bloque, se muestran una bajo otra)
  const bySlot = new Map();
  for (const visit of visits.filter((v) => v.fechaHora)) {
    const start = new Date(visit.fechaHora);
    start.setMinutes(Math.floor(start.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES, 0, 0);
    const key = slotKey(start);
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key).push(visit);
  }

  const now = new Date();
  const nowKey = slotKey(new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), Math.floor(now.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES));

  const rows = [];
  for (let h = startHour; h < endHour; h += 1) {
    for (let m = 0; m < 60; m += SLOT_MINUTES) {
      const slotDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
      const key = slotKey(slotDate);
      const isNow = key === nowKey;
      const here = bySlot.get(key) || [];
      if (here.length === 0) rows.push(rowHtml({ slotDate, visit: null, showTime: true, isNow }));
      else here.forEach((visit, i) => rows.push(rowHtml({ slotDate, visit, showTime: i === 0, isNow })));
    }
  }
  $('agenda').innerHTML = rows.join('');
}

/** Deja a la vista la hora actual (o la primera cita) sin mover la página completa. */
function scrollToNow() {
  const container = $('agenda');
  const target = $('nowSlot') || container.querySelector('[data-edit]');
  if (target) container.scrollTop = Math.max(0, target.closest('.fig-slot').offsetTop - container.offsetTop - 60);
}

async function refresh() {
  const top = $('agenda').scrollTop;
  await render();
  $('agenda').scrollTop = top; // conservar la posición al refrescar después de un cambio
}

async function handleAgendaClick(event) {
  const arrival = event.target.closest('[data-arrival]');
  if (arrival) {
    event.stopPropagation();
    arrival.disabled = true;
    try {
      const visit = await registerArrival(arrival.dataset.arrival);
      toast(`Llegada registrada. Folio ${visit.folio}`, 'success');
      await refresh();
    } catch (error) {
      arrival.disabled = false;
      reportError(error);
    }
    return;
  }
  if (event.target.closest('a')) return; // los enlaces navegan solos

  const editRow = event.target.closest('[data-edit]');
  if (editRow) {
    const visit = visitsCache.find((v) => v.id === editRow.dataset.edit);
    if (visit && (await appointmentModal({ visit }))) await refresh();
    return;
  }
  const newRow = event.target.closest('[data-new]');
  if (newRow && (await appointmentModal({ start: new Date(newRow.dataset.new) }))) await refresh();
}

async function main() {
  const user = requireSession([ROLES.RECEPCION]);
  if (!user) return;
  const params = new URLSearchParams(window.location.search);
  mountShell({ user, active: params.has('registrar') ? 'registrar' : params.has('pacientes') ? 'pacientes' : 'inicio' });

  $('agenda').addEventListener('click', handleAgendaClick);
  $('newAppointmentBtn').addEventListener('click', async () => { if (await appointmentModal({})) await refresh(); });
  $('registerPatientBtn').addEventListener('click', async () => { if (await registerPatientFlow()) await refresh(); });

  await render();
  scrollToNow();
  await openModalFromQuery(user, refresh);
}

main().catch(reportError);
