/*
 * fichaTab.js — pestaña "Ficha de datos": SOLO lo que pide el Excel Norm04, generado desde el
 * esquema (FICHA_FIELDS en data/schema.js) con el mismo renderizador que las notas clínicas.
 *
 *   CURP · Nombre · Apellido paterno · Apellido materno · Fecha de nacimiento
 *   Entidad de nacimiento · Sexo · Nacionalidad · Folio (ID institucional)
 *   Entidad de residencia · Municipio de residencia · Localidad de residencia · Grupo étnico
 *
 * El diseño de Figma traía además No. de expediente, fecha de registro, género, estado civil,
 * migración, afrodescendencia, indígena, lengua, clasificación, empleador, ocupación,
 * escolaridad y las casillas de aviso de privacidad y consentimiento. Como el Excel no los pide,
 * se quitaron de esta ficha. (El No. de expediente se sigue mostrando en el encabezado de la página.)
 *
 * Se lee y se guarda en MySQL por CURP (api.getPatientFicha / updatePatientFicha). La CURP es la
 * llave del paciente: obligatoria y, una vez guardada, de solo lectura.
 * La pueden editar recepción y médico. Al cerrar una historia clínica, sus valores se copian a la
 * nota (fichaID y grupoEtnico), por eso no se vuelven a capturar en la consulta.
 */

import { getPatientFicha, updatePatientFicha } from '/js/core/api.js';
import { toast } from '/js/core/ui.js';
import { FICHA_FIELDS } from '/js/data/schema.js';
import { renderFields, readValues, validateForm } from '/js/core/formRenderer.js';

const SOURCE_HINT = {
  mysql: 'Datos leídos de la base de datos.',
  local: 'Esta ficha aún no está guardada en la base de datos: captura la CURP y guarda.',
};

/** La CURP es la llave en MySQL: una vez guardada no se edita (api.js también lo impide). */
function lockCurp(box, patient) {
  const input = box.querySelector('[data-path="curp"]');
  if (input && patient.curp) {
    input.readOnly = true;
    input.title = 'La CURP es la llave del paciente y no se puede cambiar.';
  }
}

/** @param {HTMLElement} container @param {{patient: object}} ctx */
export async function render(container, { patient }) {
  container.innerHTML = `
    <form id="fichaForm" novalidate>
      <p class="soap-hint" data-source style="margin:12px 0 0"></p>
      <div id="fichaFields" class="ficha-grid"></div>
      <p class="fig-modal-error hidden" data-error role="alert" style="padding:6px 15px 0;margin:0"></p>
      <div class="ficha-actions">
        <button type="submit" class="fig-btn fig-btn-accept">Guardar</button>
      </div>
    </form>`;

  const box = container.querySelector('#fichaFields');
  const errorBox = container.querySelector('[data-error]');
  const sourceBox = container.querySelector('[data-source]');

  const { values, source } = await getPatientFicha(patient.id);
  renderFields(box, FICHA_FIELDS, values);
  lockCurp(box, patient);
  sourceBox.textContent = SOURCE_HINT[source];

  container.querySelector('#fichaForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.classList.add('hidden');
    if (validateForm(box, FICHA_FIELDS).length > 0) return;

    const button = container.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const updated = await updatePatientFicha(patient.id, readValues(box, FICHA_FIELDS));
      lockCurp(box, updated);
      sourceBox.textContent = SOURCE_HINT.mysql;
      toast('Ficha de datos guardada.', 'success');
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      button.disabled = false;
    }
  });
}
