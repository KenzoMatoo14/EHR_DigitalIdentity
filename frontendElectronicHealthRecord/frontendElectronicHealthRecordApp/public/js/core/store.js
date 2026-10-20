/*
 * store.js — envoltorio seguro de localStorage.
 *
 * Por qué un envoltorio:
 *  - localStorage solo guarda strings: aquí se serializa/deserializa JSON en un único punto.
 *  - Puede lanzar excepciones (modo privado, cuota llena, JSON corrupto). Aquí se capturan y
 *    la app degrada de forma explícita en vez de romperse.
 */

import { STORAGE_PREFIX } from './config.js';

const fullKey = (key) => STORAGE_PREFIX + key;

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(fullKey(key));
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
      console.error(`store.get("${key}") falló:`, error);
      return fallback;
    }
  },

  /** @returns {boolean} true si se pudo guardar */
  set(key, value) {
    try {
      localStorage.setItem(fullKey(key), JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`store.set("${key}") falló:`, error);
      return false;
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(fullKey(key));
    } catch (error) {
      console.error(`store.remove("${key}") falló:`, error);
    }
  },
};
