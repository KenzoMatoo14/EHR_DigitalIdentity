/*
 * ui.js — piezas de interfaz compartidas por todas las páginas.
 *
 * El shell (barra superior + menú lateral) reproduce el Figma "ECE UP diseño":
 *   barra con logo UP, título, fecha y píldora de usuario; menú con Inicio / Registrar Paciente /
 *   Pacientes. Cada página solo llama a `mountShell()`. (Colores: los de app.css.)
 */

import { ROLES, STATUS_META } from './config.js';
import { clearSession } from './session.js';

// ---------- Clases reutilizables (definidas en app.css a partir del Figma) ----------
export const CTL = 'fig-input';
export const BTN_PRIMARY = 'fig-btn fig-btn-accept';
export const BTN_SECONDARY = 'fig-btn fig-btn-neutral';
export const CARD = 'fig-card';

// ---------- Seguridad: escapar texto antes de meterlo en innerHTML ----------
// El original interpola datos directamente en innerHTML (riesgo de XSS). Aquí, todo dato que
// venga de un usuario pasa por escapeHtml() antes de construir HTML con plantillas.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Formato de fechas (zona horaria local, español de México) ----------
const LOCALE = 'es-MX';
const toDate = (value) => (value instanceof Date ? value : new Date(value));

export const formatTime = (value) =>
  toDate(value).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });

/** "07:05 am" — formato de las filas de la agenda del Figma. */
export function formatHora12(value) {
  const date = toDate(value);
  const h = date.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${String(hour12).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

export const formatDate = (value) =>
  toDate(value).toLocaleDateString(LOCALE, { day: '2-digit', month: 'short', year: 'numeric' });

export const formatDateTime = (value) => `${formatDate(value)} · ${formatTime(value)}`;

const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/** "Vie 21 Ago 2026 00:00" — formato de la barra superior del Figma. */
function formatTopbarDate(date = new Date()) {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${DAYS[date.getDay()]} ${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()]} ${date.getFullYear()} ${hh}:${mm}`;
}

export const initialsOf = (fullName) =>
  String(fullName || '?')
    .replace(/^Dr\.?\s*/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

// ---------- Etiqueta de estado de una visita ----------
export function statusBadge(status) {
  const meta = STATUS_META[status] || { label: status, tone: '' };
  return `<span class="fig-badge ${meta.tone}">${escapeHtml(meta.label)}</span>`;
}

// ---------- Menú lateral por rol ----------
// `key` se compara con el `active` que pasa cada página. "Registrar Paciente" y "Pacientes" abren
// modales sobre la agenda (así están en el Figma), por eso enlazan con un parámetro de la URL.
const NAV_ITEMS = {
  inicio: { label: 'Inicio', icon: '<img src="/images/icon-inicio.svg" alt="">' },
  registrar: { label: 'Registrar Paciente', icon: '<span class="fig-nav-plus" aria-hidden="true">+</span>' },
  pacientes: { label: 'Pacientes', icon: '<img src="/images/icon-pacientes.png" alt="">' },
};

const NAV_BY_ROLE = {
  [ROLES.RECEPCION]: [
    { key: 'inicio', href: '/recepcion' },
    { key: 'registrar', href: '/recepcion?registrar=1' },
    { key: 'pacientes', href: '/recepcion?pacientes=1' },
  ],
  [ROLES.MEDICO]: [
    { key: 'inicio', href: '/medico' },
    { key: 'pacientes', href: '/medico?pacientes=1' },
  ],
};

/**
 * Pinta la barra superior y el menú lateral dentro de #topbar y #sidebar (contenedores vacíos
 * que declara cada HTML).
 * @param {{ user: object, active: 'inicio'|'registrar'|'pacientes' }} options
 */
export function mountShell({ user, active }) {
  const sidebar = document.getElementById('sidebar');
  const topbar = document.getElementById('topbar');
  if (!sidebar || !topbar) throw new Error('Faltan los contenedores #sidebar y #topbar en la página');

  const items = NAV_BY_ROLE[user.rol] || [];

  topbar.innerHTML = `
    <div class="fig-brand">
      <div class="fig-brand-box" aria-hidden="true">UP</div>
      <div>
        <div class="fig-brand-title">Expediente Clínico Electronico</div>
        <div class="fig-brand-sub">Departamento Medico - Universidad Panamericana</div>
      </div>
    </div>
    <div class="fig-topbar-right">
      <span id="clock" class="fig-date"></span>
      <button type="button" id="userBtn" class="fig-user" title="Cerrar sesión" aria-label="Usuario ${escapeHtml(user.nombre)}. Cerrar sesión">
        <span class="fig-avatar" aria-hidden="true">${escapeHtml(initialsOf(user.nombre))}</span>
        <span>${escapeHtml(user.nombre)}</span>
      </button>
    </div>`;

  sidebar.innerHTML = `<nav aria-label="Navegación principal">${items.map((item) => `
    <a class="fig-nav-item ${item.key === active ? 'active' : ''}" href="${item.href}" ${item.key === active ? 'aria-current="page"' : ''}>
      <span class="fig-nav-icon">${NAV_ITEMS[item.key].icon}</span>${escapeHtml(NAV_ITEMS[item.key].label)}
    </a>`).join('')}</nav>`;

  // Tira de enlaces para pantallas angostas (el menú lateral se oculta bajo 768 px)
  const mobileNav = document.createElement('nav');
  mobileNav.className = 'fig-mobile-nav';
  mobileNav.setAttribute('aria-label', 'Navegación móvil');
  mobileNav.innerHTML = items.map((item) => `
    <a class="${item.key === active ? 'active' : ''}" href="${item.href}">${escapeHtml(NAV_ITEMS[item.key].label)}</a>`).join('');
  topbar.insertAdjacentElement('afterend', mobileNav);

  document.getElementById('userBtn').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Cerrar sesión', message: `¿Cerrar la sesión de ${user.nombre}?`, confirmText: 'Cerrar sesión' });
    if (!ok) return;
    clearSession();
    window.location.href = '/login';
  });

  // Reloj: un único temporizador de 30 s (no hay "polling" de nada más en esta app).
  const clock = document.getElementById('clock');
  const tick = () => { clock.textContent = formatTopbarDate(); };
  tick();
  setInterval(tick, 30_000);
}

// ---------- Toasts (sustituyen a alert()) ----------
export function toast(message, type = 'info') {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
  }
  const el = document.createElement('div');
  el.className = `fig-toast ${type}`; // colores en app.css (.fig-toast.success / .error)
  el.textContent = message; // textContent: no interpreta HTML
  root.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3500);
}

/** Convierte cualquier error en un mensaje legible para el usuario y lo muestra. */
export function reportError(error, fallback = 'Ocurrió un error inesperado') {
  console.error(error);
  toast(error && error.message ? error.message : fallback, 'error');
}

// ---------- Diálogo de confirmación con <dialog> nativo ----------
/** @returns {Promise<boolean>} true si el usuario confirma */
export function confirmDialog({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar' }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ece-dialog';
    dialog.innerHTML = `
      <div class="dlg-head">${escapeHtml(title)}</div>
      <div class="dlg-body">${escapeHtml(message)}</div>
      <div class="dlg-foot">
        <button type="button" data-action="cancel" class="fig-btn fig-btn-neutral">${escapeHtml(cancelText)}</button>
        <button type="button" data-action="ok" class="fig-btn fig-btn-accept">${escapeHtml(confirmText)}</button>
      </div>`;
    document.body.appendChild(dialog);

    const finish = (result) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    dialog.querySelector('[data-action="ok"]').addEventListener('click', () => finish(true));
    dialog.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); }); // tecla Esc
    dialog.showModal();
  });
}

// ---------- Lectura de parámetros de la URL ----------
export const getQueryParam = (name) => new URLSearchParams(window.location.search).get(name);
