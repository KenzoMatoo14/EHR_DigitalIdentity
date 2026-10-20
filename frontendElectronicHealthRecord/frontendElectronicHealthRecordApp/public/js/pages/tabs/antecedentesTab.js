/*
 * antecedentesTab.js — pestaña "Antecedentes" (recepción/enfermería y médico). El Figma la nombra pero
 * no la diseña, así que usa los campos de antecedentes del Excel Norm04 (NOM-004 6.1.1) y el mismo
 * estilo de tarjetas que la consulta. Son datos del PACIENTE (evolucionan con el tiempo), no de una
 * nota: se guardan en MySQL, una fila por CURP (guardar otra vez reemplaza).
 */

import { getAntecedentes, updateAntecedentes } from '/js/core/api.js';
import { toast } from '/js/core/ui.js';
import { NOTE_TYPES, ANTECEDENTES_KEYS } from '/js/data/schema.js';
import { renderFields, readValues, validateForm } from '/js/core/formRenderer.js';

/** @param {HTMLElement} container @param {{patient: object}} ctx */
export async function render(container, { patient }) {
  if (!patient.curp) {
    container.innerHTML = `
      <div class="fig-card" style="padding:20px;margin-top:10px">
        <p style="margin:0 0 10px">Este paciente aún no tiene CURP, que es su llave en la base de datos.</p>
        <a class="fig-link" href="/expediente?paciente=${encodeURIComponent(patient.id)}&tab=ficha">Capturarla en la Ficha de datos →</a>
      </div>`;
    return;
  }

  const fields = NOTE_TYPES.historiaClinica.fields.filter((f) => ANTECEDENTES_KEYS.includes(f.key));

  container.innerHTML = `
    <form id="antForm" novalidate style="padding-top:10px">
      <details class="consulta-card" open>
        <summary>
          <span><span class="num">6.1.1</span>Antecedentes</span>
          <span class="chev" aria-hidden="true">▶</span>
        </summary>
        <div class="card-body"><div data-fields class="soap-cols"></div></div>
      </details>
      <p class="fig-modal-error hidden" data-error role="alert"></p>
      <div class="soap-actions"><button type="submit" class="fig-btn fig-btn-accept">Guardar</button></div>
    </form>`;

  const box = container.querySelector('[data-fields]');
  const errorBox = container.querySelector('[data-error]');
  renderFields(box, fields, await getAntecedentes(patient.id));

  container.querySelector('#antForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    errorBox.classList.add('hidden');
    if (validateForm(box, fields).length > 0) return;
    const button = container.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await updateAntecedentes(patient.id, readValues(box, fields));
      toast('Antecedentes guardados.', 'success');
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    } finally {
      button.disabled = false;
    }
  });
}
