/*
 * session.js — sesión del usuario en el navegador.
 *
 * Reemplaza a public/js/auth.js del original, que además de guardar el token PARCHEABA
 * `window.fetch` para inyectar el header Authorization en TODAS las peticiones (efecto global
 * difícil de rastrear). Aquí el token vive en la sesión y quien haga la llamada lo pasa
 * explícitamente (ver api.js).
 *
 * IMPORTANTE: mientras no haya backend, esto NO es seguridad real: cualquiera puede editar
 * localStorage. Las guardas de rol de las páginas son solo experiencia de usuario; la
 * autorización de verdad la hará el backend con el JWT.
 */

import { HOME_BY_ROLE, SESSION_TTL_MS } from './config.js';
import { store } from './store.js';

const SESSION_KEY = 'session';

export function saveSession({ token, user }) {
  return store.set(SESSION_KEY, { token, user, expiresAt: Date.now() + SESSION_TTL_MS });
}

/** @returns {{token: string, user: object, expiresAt: number} | null} */
export function getSession() {
  const session = store.get(SESSION_KEY, null);
  if (!session || !session.user || typeof session.expiresAt !== 'number') return null;
  if (Date.now() > session.expiresAt) {
    store.remove(SESSION_KEY); // sesión vencida
    return null;
  }
  return session;
}

export function clearSession() {
  store.remove(SESSION_KEY);
}

export function homeFor(user) {
  return HOME_BY_ROLE[user.rol] || '/login';
}

/**
 * Guarda de página. Devuelve el usuario si puede estar aquí; si no, redirige y devuelve null.
 * Las páginas deben hacer `const user = requireSession([...]); if (!user) return;`
 * (una redirección no detiene la ejecución del script por sí sola).
 *
 * @param {string[]} [allowedRoles] roles permitidos; sin argumento basta con estar autenticado
 */
export function requireSession(allowedRoles) {
  const session = getSession();
  if (!session) {
    window.location.replace('/login');
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(session.user.rol)) {
    window.location.replace(homeFor(session.user));
    return null;
  }
  return session.user;
}
