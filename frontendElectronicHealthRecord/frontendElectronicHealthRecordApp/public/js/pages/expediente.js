/*
 * expediente.js — página del paciente (frame "Expediente" del Figma).
 *
 *   /expediente?paciente=P-004&tab=ficha|antecedentes|consultas|interconsultas   (&folio=REC-XXXX)
 *   /expediente?folio=REC-0840                                                    resumen de una visita
 *
 * Es solo el "router": pinta el encabezado y la barra de pestañas y delega cada pestaña en su
 * módulo (`tabs/*.js`). Cada módulo exporta `render(container, ctx)`.
 *
 * Privacidad: recepción/enfermería ve "Ficha de datos", "Antecedentes" y "Consultas" (ahí llena la
 * nota SOAP de enfermería) y el resumen de visita. "Interconsultas" y las notas del médico solo las
 * ve el médico; api.js lo vuelve a comprobar (requireRole) por si alguien se salta esta pantalla.
 */

import { ROLES } from '/js/core/config.js';
import { requireSession, homeFor } from '/js/core/session.js';
import { getPatient, getAntecedentes } from '/js/core/api.js';
import { alergiasOrdenadas, alergiaText } from '/js/pages/tabs/antecedentesEditor.js';
import { mountShell, escapeHtml, getQueryParam, reportError } from '/js/core/ui.js';
import { renderVisitSummary } from '/js/pages/tabs/visitSummary.js';
import { render as renderFicha } from '/js/pages/tabs/fichaTab.js';
import { render as renderAntecedentes } from '/js/pages/tabs/antecedentesTab.js';
import { render as renderConsultas } from '/js/pages/tabs/consultasTab.js';
import { render as renderInterconsultas } from '/js/pages/tabs/interconsultasTab.js';
import { fullName } from '/js/core/util.js';

const $ = (id) => document.getElementById(id);

// Pestañas en el orden del Figma. `clinical`: solo el médico las ve. Recepción/enfermería ve
// Antecedentes y Consultas (donde llena la nota SOAP) para el camino "resuelto en enfermería".
const TABS = [
  { id: 'ficha', label: 'Ficha de datos', render: renderFicha, clinical: false },
  { id: 'antecedentes', label: 'Antecedentes', render: renderAntecedentes, clinical: false },
  { id: 'consultas', label: 'Consultas', render: renderConsultas, clinical: false },
  { id: 'interconsultas', label: 'Interconsultas', render: renderInterconsultas, clinical: true },
];

function renderTabs(visibleTabs, active, patientId, folio) {
  const nav = $('tabs');
  nav.innerHTML = visibleTabs.map((tab) => {
    const params = new URLSearchParams({ paciente: patientId, tab: tab.id });
    if (folio) params.set('folio', folio);
    return `<a class="fig-tab ${tab.id === active ? 'active' : ''}" href="/expediente?${params}" ${tab.id === active ? 'aria-current="page"' : ''}>${escapeHtml(tab.label)}</a>`;
  }).join('');
  nav.classList.remove('hidden');
}

/**
 * Alergias visibles en cualquier pestaña del expediente (NOM-024 1.3.3: alergias y reacciones
 * adversas como primera vista de la información del paciente, las más severas primero).
 * Si falla la consulta no rompe la página: solo no se muestra.
 */
async function renderAlergiasBanner(box, patient) {
  if (!patient.curp) return;
  try {
    const saved = await getAntecedentes(patient.id);
    const lista = alergiasOrdenadas(saved);
    let html;
    if (lista.length > 0) {
      html = `<div class="ant-banner bad"><strong>Alergias:</strong> ${lista.map((al) => escapeHtml(alergiaText(al))).join(' · ')}</div>`;
    } else if (saved && saved.alergias.niega === true) {
      html = '<div class="ant-banner ok"><strong>Alergias:</strong> niega alergias</div>';
    } else {
      html = '<div class="ant-banner warn"><strong>Alergias:</strong> sin dato (no se ha preguntado)</div>';
    }
    box.innerHTML = html;
  } catch (error) {
    box.innerHTML = '';
  }
}

async function main() {
  const user = requireSession([ROLES.RECEPCION, ROLES.MEDICO]);
  if (!user) return;
  mountShell({ user, active: 'pacientes' });

  const folio = getQueryParam('folio');
  const patientId = getQueryParam('paciente');

  // Solo ?folio=…: resumen de la visita (es lo que abren los enlaces "Ver →" de la agenda de recepción)
  if (folio && !patientId) {
    await renderVisitSummary($('tabBody'), { user, folio });
    return;
  }
  if (!patientId) {
    window.location.replace(`${homeFor(user)}?pacientes=1`); // sin paciente: abrir el buscador
    return;
  }

  const patient = await getPatient(patientId);
  const visibleTabs = TABS.filter((tab) => !tab.clinical || user.rol === ROLES.MEDICO);
  const requested = getQueryParam('tab') || 'ficha';
  const tab = visibleTabs.find((t) => t.id === requested) || visibleTabs[0];

  $('patientHead').innerHTML = `
    <div class="fig-pagehead" style="margin-bottom:0">
      <div>
        <h1 class="fig-title">${escapeHtml(fullName(patient).toUpperCase())}</h1>
        <p class="fig-subtitle">Expediente - ${escapeHtml(patient.expediente)}</p>
      </div>
    </div>
    <div id="alergiasBanner"></div>`;
  renderTabs(visibleTabs, tab.id, patient.id, folio);
  renderAlergiasBanner($('alergiasBanner'), patient); // sin await: no retrasa la pestaña

  await tab.render($('tabBody'), { user, patient, folio });
}

main().catch((error) => {
  reportError(error);
  $('tabBody').innerHTML = `<div class="fig-card" style="padding:20px">${escapeHtml(error.message || 'No se pudo cargar el expediente.')}</div>`;
});
