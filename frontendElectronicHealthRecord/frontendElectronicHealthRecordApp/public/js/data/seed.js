/*
 * seed.js — base INICIAL del navegador: solo las cuentas de acceso, sin pacientes, citas ni notas.
 *
 * La agenda empieza limpia. Los pacientes se registran desde "Registrar Paciente" (se guardan en
 * MySQL por CURP) y las citas desde la agenda. Antes aquí había una agenda de demostración con
 * pacientes ficticios; se quitó a pedido del usuario.
 *
 * Esta base solo se crea la primera vez o cuando cambia DB_VERSION (ver loadDb en api.js).
 */

import { localDayKey } from '../core/util.js';

const MEDICO = 'Dr. R. Aguilar';
const RECEPCION = 'V. Cadena'; // usuario que aparece en la barra superior del Figma

/** Construye la base inicial: cuentas de acceso y contadores, sin datos de pacientes. */
export function createSeedDatabase() {
  return {
    seedDay: localDayKey(),
    // Los contadores siguen donde quedaba la demo para que folios y expedientes no se reinicien en 1
    counters: { folio: 843, visit: 13, note: 5, patient: 13, expediente: 340000 },
    users: [
      { id: 'U-001', email: 'recepcion@up.edu.mx', password: 'demo1234', nombre: RECEPCION, rol: 'recepcion' },
      { id: 'U-002', email: 'medico@up.edu.mx', password: 'demo1234', nombre: MEDICO, rol: 'medico' },
    ],
    patients: [],
    visits: [],
    notes: [],
  };
}
