/*
 * login.js — página de inicio de sesión.
 *
 * Diferencias con el login original (auth.js + login.html):
 *  - Es un <form> con evento `submit` (Enter funciona; el original escuchaba solo el click del botón).
 *  - Los errores se muestran en la propia página (no con alert()).
 *  - No existe "Continuar como invitado": un expediente clínico no debe ser público.
 *  - El redireccionamiento depende del ROL (recepción vs. médico).
 */

import { login } from '/js/core/api.js';
import { getSession, saveSession, homeFor } from '/js/core/session.js';

function showError(message) {
  const box = document.getElementById('loginError');
  box.textContent = message;
  box.classList.toggle('hidden', message === '');
}

async function handleSubmit(event) {
  event.preventDefault(); // evita que el navegador recargue la página con el envío nativo
  showError('');

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  if (email.trim() === '' || password === '') {
    showError('Escribe tu correo y contraseña.');
    return;
  }

  const button = document.getElementById('loginBtn');
  button.disabled = true; // evita doble envío mientras se procesa
  try {
    const session = await login(email, password);
    if (!saveSession(session)) {
      showError('No se pudo guardar la sesión (almacenamiento del navegador bloqueado).');
      return;
    }
    window.location.href = homeFor(session.user);
  } catch (error) {
    showError(error.message || 'No se pudo iniciar sesión.');
  } finally {
    button.disabled = false;
  }
}

function main() {
  // Si ya hay sesión vigente, ir directo a la pantalla del rol.
  const existing = getSession();
  if (existing) {
    window.location.replace(homeFor(existing.user));
    return;
  }

  document.getElementById('loginForm').addEventListener('submit', handleSubmit);

  // Botones de cuentas demo: rellenan el formulario (no inician sesión solos).
  document.querySelectorAll('[data-demo-email]').forEach((button) => {
    button.addEventListener('click', () => {
      document.getElementById('email').value = button.dataset.demoEmail;
      document.getElementById('password').value = 'demo1234';
      document.getElementById('password').focus();
    });
  });
}

main();
