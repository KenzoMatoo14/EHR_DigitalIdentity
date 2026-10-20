/*
 * modals.js — los tres modales del Figma "ECE UP diseño":
 *   · "Registrar nuevo paciente"  (frame RegistrarPaciente)
 *   · "Pacientes"                 (frames Pacientes / PacientesEjemplo): buscador + lista
 *   · "Cita Edición"              (frame CitaPaciente)
 *   · "Nueva consulta"            (agenda del médico: tipo de consulta del paciente elegido)
 *
 * Cada función abre el modal y devuelve una Promise que se resuelve con el resultado
 * (o `null` si el usuario cancela). Los modales pueden apilarse: "Cita Edición" abre "Pacientes",
 * y "Pacientes" abre "Registrar nuevo paciente".
 *
 * La lógica de negocio (validaciones, permisos) vive en api.js; aquí solo se recoge y se muestra.
 */

import * as api from './api.js';
import { ROLES, DURATION_OPTIONS, DEFAULT_DURATION_MIN, APPOINTMENT_TYPES, APPOINTMENT_STATUS, SLOT_MINUTES } from './config.js';
import { escapeHtml, toast, reportError, confirmDialog } from './ui.js';
import { fullName, patientKind } from './util.js';
import { MONTH_NAMES, birthYears } from '../data/ficha.js';

// ---------------------------------------------------------------------------
// Base común
// ---------------------------------------------------------------------------

/**
 * Abre un modal con el aspecto del Figma (cabecera azul con "X", cuerpo gris) y devuelve una
 * Promise. `setup(root, done)` recibe el elemento del cuerpo y una función `done(resultado)` que
 * cierra el modal y resuelve la Promise.
 */
function openModal({ title, bodyHtml, setup }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fig-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);
    overlay.style.zIndex = String(60 + document.querySelectorAll('.fig-overlay').length * 2);
    overlay.innerHTML = `
      <div class="fig-modal">
        <div class="fig-modal-head">
          <span>${escapeHtml(title)}</span>
          <button type="button" class="fig-modal-x" data-close aria-label="Cerrar">X</button>
        </div>
        <div class="fig-modal-body">${bodyHtml}</div>
      </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const onKeydown = (event) => {
      // Solo el modal que está arriba responde a Esc
      const overlays = document.querySelectorAll('.fig-overlay');
      if (event.key === 'Escape' && overlays[overlays.length - 1] === overlay) done(null);
    };
    document.addEventListener('keydown', onKeydown);

    function done(result) {
      document.removeEventListener('keydown', onKeydown);
      overlay.remove();
      if (document.querySelectorAll('.fig-overlay').length === 0) document.body.style.overflow = '';
      resolve(result);
    }

    overlay.querySelector('[data-close]').addEventListener('click', () => done(null));
    const body = overlay.querySelector('.fig-modal-body');
    setup(body, done);
    const first = body.querySelector('input:not([readonly]), select, textarea');
    if (first) first.focus();
  });
}

const $ = (root, selector) => root.querySelector(selector);

function optionsHtml(items, selected, blankLabel) {
  const blank = blankLabel === undefined ? '' : `<option value="">${escapeHtml(blankLabel)}</option>`;
  return blank + items.map(({ value, label }) =>
    `<option value="${escapeHtml(value)}"${String(value) === String(selected) ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

const showError = (root, message) => {
  const box = $(root, '[data-error]');
  box.textContent = message;
  box.classList.toggle('hidden', message === '');
};

// ---------------------------------------------------------------------------
// Registrar nuevo paciente
// ---------------------------------------------------------------------------

// Las 3 formas de registrar. "curp" e "id" buscan a la persona en ChainIDentity (acta de nacimiento
// en la blockchain) y prellenan el formulario; "manual" es el formulario de siempre.
const REGISTER_MODES = Object.freeze({
  curp: { label: 'CURP', lookupLabel: 'CURP', placeholder: '18 caracteres' },
  id: { label: 'ID institucional', lookupLabel: 'ID Institucional', placeholder: 'p. ej. 0263328' },
  manual: { label: 'A mano' },
});

const shortAddress = (address) => (address && address.length > 14 ? `${address.slice(0, 8)}…${address.slice(-4)}` : address || '');
const SEXO_LABEL = { 1: 'Hombre', 2: 'Mujer' };

/** ¿La CURP empieza con el prefijo calculado del acta? "*" = posición desconocida (estado no reconocido). */
const matchesCurpPrefix = (prefix, curp) => [...prefix].every((char, i) => char === '*' || char === curp[i]);

/** "20050614" -> { dia: 14, mes: 6, anio: 2005 } */
function splitDate8(digits) {
  const text = String(digits || '');
  if (!/^\d{8}$/.test(text)) return null;
  return { dia: Number(text.slice(6, 8)), mes: Number(text.slice(4, 6)), anio: Number(text.slice(0, 4)) };
}

/** @returns {Promise<object|null>} el paciente creado, o null si se canceló */
export function registerPatientModal() {
  const days = Array.from({ length: 31 }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  const months = MONTH_NAMES.map((name, i) => ({ value: i + 1, label: name }));
  const years = birthYears().map((y) => ({ value: y, label: String(y) }));

  const row = (id, label, control, required = false) => `
    <div class="fig-mrow">
      <label class="fig-mlabel" for="${id}">${label}${required ? ' <span class="req">*</span>' : ''}</label>
      ${control}
    </div>`;
  const text = (id, type = 'text', extra = '') => `<input id="${id}" type="${type}" class="fig-input" ${extra}>`;
  const modeButtons = Object.entries(REGISTER_MODES).map(([mode, { label }]) =>
    `<button type="button" class="fig-mode" role="radio" data-mode="${mode}">${escapeHtml(label)}</button>`).join('');

  return openModal({
    title: 'Registrar nuevo paciente',
    bodyHtml: `
      <form novalidate>
        <div class="fig-mrow">
          <span class="fig-mlabel" id="rp-mode-label">Registrar por</span>
          <div class="fig-modes" role="radiogroup" aria-labelledby="rp-mode-label">${modeButtons}</div>
        </div>
        <div data-lookup>
          <div class="fig-mrow">
            <label class="fig-mlabel" for="rp-lookup" data-lookup-label></label>
            <div class="fig-inline">
              <input id="rp-lookup" type="text" class="fig-input fig-lookup-input" autocomplete="off" spellcheck="false">
              <button type="button" class="fig-btn fig-btn-navy2" data-search>Buscar en ChainIDentity</button>
            </div>
          </div>
          <p class="fig-chain-status hidden" data-status role="status"></p>
          <div class="fig-candidates hidden" data-candidates></div>
        </div>
        <div class="fig-chain-note hidden" data-source></div>
        <div data-fields>
        ${row('rp-nombre', 'Nombre', text('rp-nombre', 'text', 'maxlength="50" autocomplete="off"'), true)}
        ${row('rp-apellidoP', 'Apellido Paterno', text('rp-apellidoP', 'text', 'maxlength="50" autocomplete="off"'), true)}
        ${row('rp-apellidoM', 'Apellido Materno', text('rp-apellidoM', 'text', 'maxlength="50" autocomplete="off"'), true)}
        ${row('rp-dia', 'Fecha Nacimiento (día/mes/año)', `
          <div class="fig-inline">
            <select id="rp-dia" class="fig-input" style="width:110px" aria-label="Día">${optionsHtml(days, '', '')}</select>
            <select id="rp-mes" class="fig-input" style="width:160px" aria-label="Mes">${optionsHtml(months, '', '')}</select>
            <select id="rp-anio" class="fig-input" style="width:120px" aria-label="Año">${optionsHtml(years, '', '')}</select>
          </div>`, true)}
        ${row('rp-sexo', 'Sexo Biológico', `<select id="rp-sexo" class="fig-input">${optionsHtml([{ value: 'Hombre', label: 'Hombre' }, { value: 'Mujer', label: 'Mujer' }], '', '')}</select>`, true)}
        ${row('rp-tel', 'Teléfono principal', text('rp-tel', 'tel', 'autocomplete="off"'))}
        ${row('rp-curp', 'CURP', text('rp-curp', 'text', 'maxlength="18" autocomplete="off" spellcheck="false" style="text-transform:uppercase"'), true)}
        ${row('rp-id', 'ID Institucional', text('rp-id', 'text', 'maxlength="18" autocomplete="off" inputmode="numeric"'))}
        ${row('rp-tipo', 'Tipo de paciente', `<select id="rp-tipo" class="fig-input">${optionsHtml([{ value: 'alumno', label: 'Alumno' }, { value: 'colaborador', label: 'Colaborador' }], 'alumno')}</select>`)}
        ${row('rp-correo', 'Correo electronico', text('rp-correo', 'email', 'autocomplete="off"'))}
        </div>
        <p class="fig-modal-error hidden" data-error role="alert"></p>
        <div class="fig-modal-buttons">
          <button type="submit" class="fig-btn fig-btn-accept">Aceptar</button>
          <button type="button" class="fig-btn fig-btn-neutral" data-cancel>Cancelar</button>
        </div>
      </form>`,
    setup(root, done) {
      const lookupInput = $(root, '#rp-lookup');
      const searchButton = $(root, '[data-search]');
      const acceptButton = $(root, 'button[type="submit"]');
      const statusBox = $(root, '[data-status]');
      const candidatesBox = $(root, '[data-candidates]');
      const sourceBox = $(root, '[data-source]');
      const fields = $(root, '[data-fields]');

      let mode = 'curp';
      let selected = null;          // candidato de ChainIDentity elegido (null = datos a mano)
      let mismatchAcceptedFor = ''; // CURP que la enfermera confirmó aunque no coincida con el acta

      const setStatus = (html, kind = '') => {
        statusBox.innerHTML = html;
        statusBox.className = `fig-chain-status${kind ? ` ${kind}` : ''}${html ? '' : ' hidden'}`;
      };
      const showFields = (visible) => {
        fields.classList.toggle('hidden', !visible);
        acceptButton.classList.toggle('hidden', !visible);
      };
      const clearSource = () => {
        selected = null;
        sourceBox.classList.add('hidden');
        sourceBox.innerHTML = '';
      };

      function setMode(next) {
        mode = next;
        for (const button of root.querySelectorAll('[data-mode]')) {
          button.setAttribute('aria-checked', String(button.dataset.mode === mode));
        }
        const config = REGISTER_MODES[mode];
        const isLookup = mode !== 'manual';
        $(root, '[data-lookup]').classList.toggle('hidden', !isLookup);
        candidatesBox.classList.add('hidden');
        setStatus('');
        clearSource();
        showError(root, '');
        if (isLookup) {
          $(root, '[data-lookup-label]').innerHTML = `${config.lookupLabel} <span class="req">*</span>`;
          lookupInput.value = '';
          lookupInput.placeholder = config.placeholder;
          lookupInput.setAttribute('maxlength', '18');
          lookupInput.style.textTransform = mode === 'curp' ? 'uppercase' : '';
          lookupInput.inputMode = mode === 'id' ? 'numeric' : 'text';
          showFields(false);
          lookupInput.focus();
        } else {
          showFields(true);
          $(root, '#rp-nombre').focus();
        }
      }

      /** Pasa a "A mano" conservando lo que se escribió en el buscador. */
      function switchToManual() {
        const typed = lookupInput.value.trim();
        const from = mode;
        setMode('manual');
        if (from === 'curp' && typed) $(root, '#rp-curp').value = typed.toUpperCase();
        if (from === 'id' && typed) $(root, '#rp-id').value = typed;
      }

      /** Llena el formulario con el candidato elegido; la enfermera revisa antes de Aceptar. */
      function applyCandidate(candidate) {
        const { datos } = candidate;
        selected = candidate;
        mismatchAcceptedFor = '';
        $(root, '#rp-nombre').value = datos.nombre || '';
        $(root, '#rp-apellidoP').value = datos.apellidoP || '';
        $(root, '#rp-apellidoM').value = datos.apellidoM || '';
        const birth = splitDate8(datos.fechaNacimiento);
        $(root, '#rp-dia').value = birth ? String(birth.dia) : '';
        $(root, '#rp-mes').value = birth ? String(birth.mes) : '';
        $(root, '#rp-anio').value = birth ? String(birth.anio) : '';
        $(root, '#rp-sexo').value = SEXO_LABEL[datos.sexo] || '';
        // La CURP no está en ChainIDentity: en modo CURP es la que se buscó; en modo ID se captura a mano.
        $(root, '#rp-curp').value = mode === 'curp' ? lookupInput.value.trim().toUpperCase() : '';
        $(root, '#rp-id').value = mode === 'id' ? lookupInput.value.trim() : (datos.folio || '');
        if (candidate.correo) $(root, '#rp-correo').value = candidate.correo;

        const avisos = candidate.avisos.map((aviso) => `<li>${escapeHtml(aviso)}</li>`).join('');
        sourceBox.innerHTML = `
          <strong>Datos tomados del acta de nacimiento en ChainIDentity</strong>
          (contrato <code title="${escapeHtml(candidate.contractAddress)}">${escapeHtml(shortAddress(candidate.contractAddress))}</code>).
          Revísalos antes de aceptar.${mode === 'id' ? ' <strong>Captura la CURP:</strong> ChainIDentity no la tiene.' : ''}
          ${avisos ? `<ul>${avisos}</ul>` : ''}`;
        sourceBox.classList.remove('hidden');
        candidatesBox.classList.add('hidden');
        setStatus('');
        showFields(true);
        (mode === 'id' ? $(root, '#rp-curp') : $(root, '#rp-tel')).focus();
      }

      function showCandidates(candidates) {
        candidatesBox.innerHTML = `
          <p>Hay ${candidates.length} actas que coinciden con esos 16 caracteres (homónimos). Elige la correcta:</p>
          ${candidates.map((candidate, index) => {
    const birth = splitDate8(candidate.datos.fechaNacimiento);
    const date = birth ? `${birth.dia}/${birth.mes}/${birth.anio}` : 'sin fecha';
    return `<button type="button" class="fig-candidate" data-candidate="${index}">
              <span>${escapeHtml(fullName(candidate.datos))}</span>
              <span>${escapeHtml(date)} · ${escapeHtml(candidate.estadoActa || '')}</span>
              <code>${escapeHtml(shortAddress(candidate.contractAddress))}</code>
            </button>`;
  }).join('')}`;
        candidatesBox.classList.remove('hidden');
        for (const button of candidatesBox.querySelectorAll('[data-candidate]')) {
          button.addEventListener('click', () => applyCandidate(candidates[Number(button.dataset.candidate)]));
        }
      }

      async function search() {
        clearSource();
        candidatesBox.classList.add('hidden');
        showFields(false);
        showError(root, '');
        searchButton.disabled = true;
        setStatus('Buscando en ChainIDentity…');
        try {
          const value = lookupInput.value;
          const candidates = await api.lookupChainIdentity(mode === 'curp' ? { curp: value } : { idInstitucional: value });
          if (candidates.length === 1) applyCandidate(candidates[0]);
          else showCandidates(candidates);
        } catch (error) {
          setStatus(`${escapeHtml(error.message)} <button type="button" class="fig-link" data-manual>Capturar a mano</button>`,
            error.code === 'VALIDATION' ? 'bad' : 'warn');
          $(root, '[data-manual]').addEventListener('click', switchToManual);
        } finally {
          searchButton.disabled = false;
        }
      }

      for (const button of root.querySelectorAll('[data-mode]')) {
        button.addEventListener('click', () => setMode(button.dataset.mode));
      }
      searchButton.addEventListener('click', search);
      // Enter en el buscador busca (sin esto enviaría el formulario)
      lookupInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          search();
        }
      });

      $(root, '[data-cancel]').addEventListener('click', () => done(null));
      $(root, 'form').addEventListener('submit', async (event) => {
        event.preventDefault();
        if (fields.classList.contains('hidden')) return; // modo búsqueda sin resultado elegido
        showError(root, '');

        // La CURP capturada debe corresponder al acta en sus 16 primeros caracteres. Si no, se avisa
        // una vez (puede ser un error de captura o un caso que el cálculo no cubre) y un segundo
        // Aceptar guarda de todos modos.
        const curp = $(root, '#rp-curp').value.trim().toUpperCase();
        if (selected && selected.curp16 && curp.length === 18 && !matchesCurpPrefix(selected.curp16, curp)
          && mismatchAcceptedFor !== curp) {
          mismatchAcceptedFor = curp;
          showError(root, `La CURP no corresponde a los datos del acta: con ellos debería empezar con ${selected.curp16}${selected.curp16.includes('*') ? ' (* = cualquier carácter)' : ''}. Revísala; si es correcta, presiona Aceptar otra vez.`);
          return;
        }

        acceptButton.disabled = true;
        try {
          const patient = await api.createPatient({
            nombre: $(root, '#rp-nombre').value,
            apellidoP: $(root, '#rp-apellidoP').value,
            apellidoM: $(root, '#rp-apellidoM').value,
            fechaNacimiento: { dia: $(root, '#rp-dia').value, mes: $(root, '#rp-mes').value, anio: $(root, '#rp-anio').value },
            sexoBiologico: $(root, '#rp-sexo').value,
            telefono: $(root, '#rp-tel').value,
            curp: $(root, '#rp-curp').value,
            idInstitucional: $(root, '#rp-id').value,
            tipo: $(root, '#rp-tipo').value,
            correo: $(root, '#rp-correo').value,
            entidadNacimiento: selected ? selected.datos.entidadNacimiento : undefined,
          });
          done(patient);
        } catch (error) {
          showError(root, error.message);
          acceptButton.disabled = false;
        }
      });

      setMode('curp');
    },
  });
}

// ---------------------------------------------------------------------------
// Pacientes (buscador)
// ---------------------------------------------------------------------------

/**
 * @param {{ allowRegister?: boolean }} [options] muestra el botón "Registrar Paciente" (solo recepción)
 * @returns {Promise<object|null>} el paciente elegido con "Aceptar", o null
 */
export function patientPickerModal({ allowRegister = false } = {}) {
  return openModal({
    title: 'Pacientes',
    bodyHtml: `
      <div class="fig-mrow" style="max-width:none;grid-template-columns:auto minmax(0,1fr);margin-bottom:16px">
        <label class="fig-mlabel" for="pp-q">Nombre :</label>
        <input id="pp-q" type="search" class="fig-input" autocomplete="off" placeholder="Nombre, CURP, ID institucional o expediente">
      </div>
      <div class="fig-results" data-results role="listbox" aria-label="Resultados"></div>
      <p class="fig-modal-error hidden" data-error role="alert"></p>
      <div class="fig-modal-buttons">
        <button type="button" class="fig-btn fig-btn-accept" data-accept>Aceptar</button>
        <button type="button" class="fig-btn fig-btn-neutral" data-cancel>Cancelar</button>
        ${allowRegister ? '<button type="button" class="fig-btn fig-btn-navy2" data-register>Registrar Paciente</button>' : ''}
      </div>`,
    setup(root, done) {
      let patients = [];
      let selectedId = null;
      let latest = 0; // descarta respuestas viejas si el usuario sigue escribiendo

      const renderList = () => {
        const list = $(root, '[data-results]');
        list.innerHTML = patients.length === 0
          ? '<p class="soap-hint">Sin resultados.</p>'
          : patients.map((p) => `
              <div class="fig-result" role="option" tabindex="0" data-id="${escapeHtml(p.id)}" aria-selected="${p.id === selectedId}">
                <span class="idn">${escapeHtml(p.idInstitucional || p.expediente)}</span>
                <span class="nm">${escapeHtml(fullName(p))}</span>
                ${p.correo ? '<img src="/images/correo.png" alt="Tiene correo">' : '<span></span>'}
                <span class="tp">${escapeHtml(patientKind(p))}</span>
              </div>`).join('');
      };

      const search = async () => {
        const request = ++latest;
        try {
          const result = await api.searchPatients($(root, '#pp-q').value);
          if (request !== latest) return;
          patients = result;
          if (!patients.some((p) => p.id === selectedId)) selectedId = null;
          renderList();
        } catch (error) {
          reportError(error);
        }
      };

      const accept = () => {
        const patient = patients.find((p) => p.id === selectedId);
        if (!patient) { showError(root, 'Selecciona un paciente de la lista.'); return; }
        done(patient);
      };

      let timer = null;
      $(root, '#pp-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(search, 150); });
      const list = $(root, '[data-results]');
      list.addEventListener('click', (event) => {
        const item = event.target.closest('[data-id]');
        if (!item) return;
        selectedId = item.dataset.id;
        showError(root, '');
        renderList();
      });
      list.addEventListener('dblclick', (event) => { if (event.target.closest('[data-id]')) accept(); });
      list.addEventListener('keydown', (event) => {
        const item = event.target.closest('[data-id]');
        if (item && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectedId = item.dataset.id; renderList(); }
      });
      $(root, '[data-accept]').addEventListener('click', accept);
      $(root, '[data-cancel]').addEventListener('click', () => done(null));

      const registerBtn = $(root, '[data-register]');
      if (registerBtn) {
        registerBtn.addEventListener('click', async () => {
          const created = await registerPatientModal();
          if (created) { selectedId = created.id; await search(); }
        });
      }
      search();
    },
  });
}

// ---------------------------------------------------------------------------
// Cita Edición
// ---------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');

/** Próximo múltiplo de SLOT_MINUTES a partir de ahora (para "Nueva cita" sin horario). */
function nextSlot() {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(Math.ceil((date.getMinutes() + 1) / SLOT_MINUTES) * SLOT_MINUTES);
  return date;
}

const toDateInput = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/**
 * @param {{ visit?: object, start?: Date, patient?: object }} [options]
 *   visit: cita existente a editar · start: horario inicial (clic en una fila libre) · patient: paciente preseleccionado
 * @returns {Promise<'saved'|'deleted'|null>}
 */
export function appointmentModal({ visit = null, start = null, patient = null } = {}) {
  const initialStart = visit ? new Date(visit.fechaHora) : (start || nextSlot());
  const hour24 = initialStart.getHours();
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const minuteOptions = Array.from({ length: 60 / SLOT_MINUTES }, (_, i) => ({ value: i * SLOT_MINUTES, label: pad2(i * SLOT_MINUTES) }));
  const hourOptions = Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: String(i + 1) }));
  const selectedPatient = visit ? visit.patient : patient;

  return openModal({
    title: 'Cita Edición',
    bodyHtml: `
      <form novalidate>
        <div class="fig-mstack">
          <label class="fig-mlabel" for="ci-fecha">Fecha</label>
          <input id="ci-fecha" type="date" class="fig-input" style="width:190px" value="${toDateInput(initialStart)}">
        </div>
        <div class="fig-mstack">
          <div class="fig-inline" style="align-items:flex-start;gap:40px">
            <div>
              <span class="fig-mlabel">Horario de la cita</span>
              <div class="fig-inline" style="gap:6px">
                <select id="ci-hora" class="fig-input" style="width:78px" aria-label="Hora">${optionsHtml(hourOptions, hour12)}</select>
                <span aria-hidden="true">:</span>
                <select id="ci-min" class="fig-input" style="width:78px" aria-label="Minutos">${optionsHtml(minuteOptions, initialStart.getMinutes())}</select>
                <select id="ci-ampm" class="fig-input" style="width:84px" aria-label="am o pm">${optionsHtml([{ value: 'am', label: 'Am' }, { value: 'pm', label: 'Pm' }], hour24 < 12 ? 'am' : 'pm')}</select>
              </div>
            </div>
            <div>
              <span class="fig-mlabel">Duración</span>
              <select id="ci-dur" class="fig-input" style="width:190px" aria-label="Duración">
                ${optionsHtml(DURATION_OPTIONS.map((m) => ({ value: m, label: `${m} Minutos` })), visit ? visit.duracionMin : DEFAULT_DURATION_MIN)}
              </select>
            </div>
          </div>
        </div>
        <div class="fig-mstack">
          <label class="fig-mlabel" for="ci-paciente">Paciente</label>
          <div class="fig-inline" style="gap:0;flex-wrap:nowrap;max-width:644px">
            <input id="ci-paciente" type="text" class="fig-input" readonly style="flex:1;min-width:0;width:auto;border-radius:5px 0 0 5px" value="${escapeHtml(selectedPatient ? fullName(selectedPatient) : '')}" placeholder="Elige un paciente">
            <button type="button" class="fig-btn fig-btn-green" style="height:45px;min-width:142px;border-radius:0 5px 5px 0;font-size:20px" data-pick>Pacientes</button>
          </div>
        </div>
        <div class="fig-mstack" style="max-width:560px">
          <label class="fig-mlabel" for="ci-tipo">Tipo de cita</label>
          <select id="ci-tipo" class="fig-input">${optionsHtml(APPOINTMENT_TYPES.map((t) => ({ value: t.id, label: t.label })), visit ? visit.tipoCita : '')}</select>
        </div>
        <div class="fig-mstack" style="max-width:560px">
          <label class="fig-mlabel" for="ci-estatus">Estatus</label>
          <select id="ci-estatus" class="fig-input">${optionsHtml(APPOINTMENT_STATUS.map((s) => ({ value: s.id, label: s.label })), visit ? visit.estatusCita : 'por_confirmar')}</select>
        </div>
        <div class="fig-mstack">
          <label class="fig-mlabel" for="ci-notas">Notas</label>
          <textarea id="ci-notas" class="fig-input" maxlength="300">${escapeHtml(visit ? visit.notasCita : '')}</textarea>
        </div>
        <p class="fig-modal-error hidden" data-error role="alert"></p>
        <div class="fig-modal-buttons">
          <button type="submit" class="fig-btn fig-btn-accept">Aceptar</button>
          <button type="button" class="fig-btn fig-btn-neutral" data-cancel>Cancelar</button>
          ${visit ? '<button type="button" class="fig-btn fig-btn-neutral" data-delete>Eliminar</button>' : ''}
        </div>
      </form>`,
    setup(root, done) {
      let chosenPatient = selectedPatient;

      $(root, '[data-pick]').addEventListener('click', async () => {
        const picked = await patientPickerModal({ allowRegister: true });
        if (picked) {
          chosenPatient = picked;
          $(root, '#ci-paciente').value = fullName(picked);
          showError(root, '');
        }
      });
      $(root, '[data-cancel]').addEventListener('click', () => done(null));

      const deleteBtn = $(root, '[data-delete]');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          const ok = await confirmDialog({ title: 'Eliminar cita', message: `¿Eliminar la cita de ${fullName(chosenPatient)}?`, confirmText: 'Eliminar' });
          if (!ok) return;
          try {
            await api.deleteAppointment(visit.id);
            toast('Cita eliminada.', 'success');
            done('deleted');
          } catch (error) {
            showError(root, error.message);
          }
        });
      }

      $(root, 'form').addEventListener('submit', async (event) => {
        event.preventDefault();
        showError(root, '');
        if (!chosenPatient) { showError(root, 'Elige un paciente con el botón "Pacientes".'); return; }

        // hora 1-12 + am/pm -> hora de 24 h
        let h = Number($(root, '#ci-hora').value) % 12;
        if ($(root, '#ci-ampm').value === 'pm') h += 12;
        const [year, month, day] = $(root, '#ci-fecha').value.split('-').map(Number);
        if (!year) { showError(root, 'Elige la fecha de la cita.'); return; }
        const when = new Date(year, month - 1, day, h, Number($(root, '#ci-min').value), 0, 0);

        const button = $(root, 'button[type="submit"]');
        button.disabled = true;
        try {
          await api.saveAppointment({
            id: visit ? visit.id : undefined,
            fechaHora: when.toISOString(),
            duracionMin: Number($(root, '#ci-dur').value),
            patientId: chosenPatient.id,
            tipoCita: $(root, '#ci-tipo').value,
            estatusCita: $(root, '#ci-estatus').value,
            notasCita: $(root, '#ci-notas').value,
          });
          toast('Cita guardada.', 'success');
          done('saved');
        } catch (error) {
          showError(root, error.message);
          button.disabled = false;
        }
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Nueva consulta (agenda del médico)
// ---------------------------------------------------------------------------

/**
 * Segundo paso de "Agregar consulta": ya hay paciente; se elige qué se le va a hacer y, opcionalmente,
 * el motivo de la visita (es lo que la agenda del médico muestra en cada fila).
 * @returns {Promise<{ tipo: 'soap'|'historial', motivo: string }|null>}
 */
export function consultationTypeModal(patient) {
  return openModal({
    title: `Nueva consulta · ${fullName(patient)}`,
    bodyHtml: `
      <div class="fig-mstack" style="max-width:none">
        <label class="fig-mlabel" for="nc-motivo">Motivo de la visita</label>
        <input id="nc-motivo" type="text" class="fig-input" maxlength="100" autocomplete="off" placeholder="Consulta general">
      </div>
      <p class="fig-mlabel" style="margin:22px 0 10px">¿Qué se le va a hacer al paciente?</p>
      <div class="fig-modal-buttons" style="padding-top:0">
        <button type="button" class="fig-btn fig-btn-accept" data-tipo="soap">Consulta estilo SOAP</button>
        <button type="button" class="fig-btn fig-btn-accept" data-tipo="historial">Historial médico completo</button>
        <button type="button" class="fig-btn fig-btn-neutral" data-cancel>Cancelar</button>
      </div>`,
    setup(root, done) {
      const motivo = $(root, '#nc-motivo');
      root.querySelectorAll('[data-tipo]').forEach((button) => {
        button.addEventListener('click', () => done({ tipo: button.dataset.tipo, motivo: motivo.value.trim() }));
      });
      $(root, '[data-cancel]').addEventListener('click', () => done(null));
    },
  });
}

/**
 * Botón "Agregar consulta" del médico: elige paciente (buscador) -> tipo de consulta -> abre la consulta.
 * Consulta estilo SOAP = nota de evolución; historial médico completo = historia clínica (ambos se pueden
 * cambiar después con el selector "Tipo de nota" de la propia consulta).
 */
export async function addConsultationFlow() {
  const patient = await patientPickerModal();
  if (!patient) return;
  const choice = await consultationTypeModal(patient);
  if (!choice) return;
  try {
    const visit = await api.startWalkInConsulta(patient.id, choice.motivo);
    const params = new URLSearchParams({ paciente: patient.id, tab: 'consultas', folio: visit.folio, tipo: choice.tipo });
    window.location.href = `/expediente?${params}`;
  } catch (error) {
    reportError(error);
  }
}

// ---------------------------------------------------------------------------
// Flujos que comparten la agenda de recepción y la del médico
// ---------------------------------------------------------------------------

/** "+ Registrar paciente" / menú "Registrar Paciente": registra y ofrece agendar la cita enseguida. */
export async function registerPatientFlow() {
  const patient = await registerPatientModal();
  if (!patient) return false;
  toast(patient.yaExistia
    ? `${fullName(patient)} ya estaba en la base de datos: se agregó con sus datos guardados.`
    : `Paciente registrado. Expediente ${patient.expediente}.`, 'success');
  await appointmentModal({ patient });
  return true;
}

/** Menú "Pacientes": recepción agenda una cita; el médico abre el expediente. */
export async function patientsFlow(user) {
  const patient = await patientPickerModal({ allowRegister: user.rol === ROLES.RECEPCION });
  if (!patient) return false;
  if (user.rol === ROLES.MEDICO) {
    window.location.href = `/expediente?paciente=${encodeURIComponent(patient.id)}`;
    return false;
  }
  await appointmentModal({ patient });
  return true;
}

/**
 * Abre el modal que pide la URL (?registrar=1 o ?pacientes=1) — así funcionan los enlaces del menú
 * lateral, que en el Figma abren un modal encima de la agenda. Limpia la URL para que recargar la
 * página no lo vuelva a abrir. `onChanged` se llama si algo cambió (para refrescar la agenda).
 */
export async function openModalFromQuery(user, onChanged) {
  const params = new URLSearchParams(window.location.search);
  const wantsRegister = params.has('registrar') && user.rol === ROLES.RECEPCION;
  const wantsPatients = params.has('pacientes');
  if (!wantsRegister && !wantsPatients) return;
  window.history.replaceState(null, '', window.location.pathname);

  const changed = wantsRegister ? await registerPatientFlow() : await patientsFlow(user);
  if (changed) await onChanged();
}
