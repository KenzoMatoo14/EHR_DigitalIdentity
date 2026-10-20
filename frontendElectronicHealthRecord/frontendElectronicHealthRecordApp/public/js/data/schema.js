/*
 * schema.js — diccionario de datos del ECE, transcrito del Excel "Norm04" (NOM-004-SSA3-2012).
 *
 * IDEA CENTRAL: el Excel se convierte en DATOS, no en HTML repetido. De este archivo se generan
 * (formRenderer.js) los formularios de captura, la validación y las vistas de solo lectura.
 * Así, cambiar un campo del Excel = cambiar UNA línea aquí, y no 5 pantallas.
 * También es el contrato que después se mapeará a structs de Solidity:
 *   VARCHAR(n) -> string (con límite n)   INT -> uint   Booleano -> bool
 *   DECIMAL(p,s) -> entero escalado por 10^s   Catálogo -> uint (id del catálogo)
 *
 * Mapa Excel -> este archivo:
 *   hoja "Objetos"        -> OBJECTS       (structs reutilizables)
 *   hojas 6.1.x           -> NOTE_TYPES.historiaClinica
 *   hoja 6.2              -> NOTE_TYPES.evolucion
 *   hoja 6.3 y 6.4        -> NOTE_TYPES.interconsulta / NOTE_TYPES.referencia
 *   hoja 7.1              -> NOTE_TYPES.urgencias
 *
 * Los nombres de campo (`key`) son los de la columna "Nombre del campo" del Excel, sin cambios.
 * Las DISCREPANCIAS del Excel detectadas al transcribir están marcadas con "DISCREPANCIA" y
 * listadas en el README.
 */

// ---------- Constructores de campos (solo para escribir menos y evitar errores de tipeo) ----------
const text = (key, label, max, section, extra = {}) => ({ key, label, type: 'text', max, section, ...extra });
const int = (key, label, section, extra = {}) => ({ key, label, type: 'integer', section, ...extra });
const dec = (key, label, precision, scale, section, extra = {}) => ({ key, label, type: 'decimal', precision, scale, section, ...extra });
const bool = (key, label, section, extra = {}) => ({ key, label, type: 'boolean', section, ...extra });
const cat = (key, label, catalog, section, extra = {}) => ({ key, label, type: 'catalog', catalog, section, ...extra });
const obj = (key, label, object, section, extra = {}) => ({ key, label, type: 'object', object, section, ...extra });

// CURP: 18 caracteres. Patrón estándar (RENAPO).
export const CURP_PATTERN = /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;

// ---------- Hoja "Objetos": structs reutilizables ----------
export const OBJECTS = Object.freeze({
  // Corregido: los 9 campos anteriores (nivelSocioeconomico, vivienda, tipoSanguineo, discapacidad,
  // religion) no correspondían a esta hoja del Excel y se quitaron. Estos 12 sí son los de
  // "Ficha Identificación".
  FichaIdentificacion: [
    { key: 'curp', label: 'CURP', type: 'identifier', length: 18, pattern: CURP_PATTERN, patternHint: 'CURP con formato válido (18 caracteres)' },
    text('nombre', 'Nombre', 50),
    text('apellidoP', 'Apellido paterno', 50),
    text('apellidoM', 'Apellido materno', 50),
    // Numérico CHAR(8), formato aaaammdd. Se captura con selector de fecha (mejor UX) y se
    // convierte a ese formato al leer el formulario (ver formRenderer.js, tipo 'date8').
    { key: 'fechaNacimiento', label: 'Fecha de nacimiento', type: 'date8' },
    cat('entidadNacimiento', 'Entidad de nacimiento', 'entidad'),
    cat('sexo', 'Sexo', 'sexo'),
    cat('nacionalidad', 'Nacionalidad', 'nacionalidad'),
    // folio = ID institucional (p. ej. 0263328). La llave del paciente es la CURP.
    text('folio', 'Folio (ID institucional)', 18),
    cat('entidadResidencia', 'Entidad de residencia', 'entidad'),
    // municipioResidencia/localidadResidencia son catálogos oficiales INEGI (cascada
    // entidad -> municipio -> localidad, miles de combinaciones): no hay catálogo provisional
    // razonable, así que por ahora se capturan como el código directo (CHAR(3)/CHAR(4)).
    text('municipioResidencia', 'Municipio de residencia', 3, undefined, { pattern: /^\d{1,3}$/, patternHint: 'Código INEGI de municipio (hasta 3 dígitos)' }),
    text('localidadResidencia', 'Localidad de residencia', 4, undefined, { pattern: /^\d{1,4}$/, patternHint: 'Código INEGI de localidad (hasta 4 dígitos)' }),
  ],

  ConsumoSustancias: [
    bool('usoTabaco', 'Uso de tabaco'),
    bool('usoAlcohol', 'Uso de alcohol'),
    bool('usoOtrasSustancias', 'Uso de otras sustancias'),
  ],

  // En "Objetos" la columna "Nombre" dice tratamientoConvencional... pero "Nombre del campo"
  // dice tratamientoPrevioConvencional...: se usa "Nombre del campo" (es la llave real).
  TratamientoPrevio: [
    text('tratamientoPrevioConvencional', 'Convencional', 200),
    text('tratamientoPrevioAlternativo', 'Alternativo', 200),
    text('tratamientoPrevioTradicional', 'Tradicional', 200),
  ],

  // min/max: rangos clínicos PROPUESTOS (no vienen del Excel) para rechazar valores imposibles o mal
  // capturados (p. ej. 365 en temperatura). Los mismos valores están en el backend (notaSoapFields.js).
  SignosVitales: [
    dec('temperatura', 'Temperatura (°C)', 3, 1, undefined, { min: 30, max: 45, placeholder: '36.5' }),
    text('tensionArterial', 'Tensión arterial (mmHg)', 10, undefined, { pattern: /^\d{2,3}\/\d{2,3}$/, patternHint: 'Formato sistólica/diastólica, p. ej. 120/80', placeholder: '120/80' }),
    int('frecuenciaCardiaca', 'Frecuencia cardiaca (lpm)', undefined, { min: 20, max: 250, placeholder: '72' }),
    int('frecuenciaRespiratoria', 'Frecuencia respiratoria (rpm)', undefined, { min: 4, max: 80, placeholder: '16' }),
  ],

  DatosExploracionFisica: [
    text('cabeza', 'Cabeza', 500),
    text('cuello', 'Cuello', 500),
    text('torax', 'Tórax', 500),
    text('abdomen', 'Abdomen', 500),
    text('miembros', 'Miembros', 500),
    text('genitales', 'Genitales', 500),
  ],

  ResultadosEstudios: [
    text('laboratorio', 'Laboratorio', 1000),
    text('gabinete', 'Gabinete', 1000),
    text('otros', 'Otros', 1000),
  ],

  TratamientoIndicaciones: [
    text('dosis', 'Dosis', 100),
    text('viaAdministracion', 'Vía de administración', 100),
    text('periodicidad', 'Periodicidad', 50),
  ],
});

// ---------- Tipos de nota clínica ----------
// `sections` da el título de cada numeral de la NOM que aparece en la columna "Sección" del Excel.
export const NOTE_TYPES = Object.freeze({
  // ===== Hojas 6.1.1, 6.1.2, 6.1.3-6.1.6 =====
  historiaClinica: {
    label: 'Historia clínica',
    numeral: '6.1',
    when: 'Primera vez',
    sections: {
      '6.1.1': 'Interrogatorio',
      '6.1.2': 'Exploración física',
      '6.1.3': 'Resultados previos y actuales de estudios',
      '6.1.4': 'Diagnósticos o problemas clínicos',
      '6.1.5': 'Pronóstico',
      '6.1.6': 'Indicación terapéutica',
    },
    fields: [
      // --- 6.1.1 ---
      obj('fichaID', 'Ficha de identificación', 'FichaIdentificacion', '6.1.1'),
      cat('grupoEtnico', 'Grupo étnico', 'grupoEtnico', '6.1.1'),
      text('antecedentesHeredoFamiliares', 'Antecedentes heredo-familiares', 500, '6.1.1'),
      text('antecedentesPersonalesPatologicos', 'Antecedentes personales patológicos', 500, '6.1.1'),
      // DISCREPANCIA: el Excel lo lista en la hoja 6.1.1 pero con Sección "6.1.2". Por su
      // "Clasificación" (antecedentes personales patológicos) pertenece a 6.1.1.
      obj('consumoSustancias', 'Consumo de sustancias', 'ConsumoSustancias', '6.1.1'),
      text('antecedentesPersonalesNoPatologicos', 'Antecedentes personales no patológicos', 500, '6.1.1'),
      text('padecimientoActual', 'Padecimiento actual', 500, '6.1.1'),
      obj('tratamientoPrevio', 'Tratamiento previo', 'TratamientoPrevio', '6.1.1'),
      text('interrogatorioAparatosSistemas', 'Interrogatorio por aparatos y sistemas', 1000, '6.1.1'),
      // --- 6.1.2 ---
      text('habitusExterior', 'Habitus exterior', 500, '6.1.2'),
      obj('signosVitales', 'Signos vitales', 'SignosVitales', '6.1.2'),
      // Unidades no vienen en el Excel; se asumen kg y metros (DECIMAL(4,2) => hasta 99.99 m).
      dec('peso', 'Peso (kg)', 5, 2, '6.1.2', { min: 0.5, max: 400, placeholder: '70.5' }),
      dec('talla', 'Talla (m)', 4, 2, '6.1.2', { min: 0.3, max: 2.5, placeholder: '1.75' }),
      obj('datosExploracionFisica', 'Datos de exploración física', 'DatosExploracionFisica', '6.1.2'),
      // --- 6.1.3 a 6.1.6 ---
      obj('resultadosPreviosEstudios', 'Resultados previos de estudios', 'ResultadosEstudios', '6.1.3'),
      obj('resultadosActualesEstudios', 'Resultados actuales de estudios', 'ResultadosEstudios', '6.1.3'),
      text('diagnosticosProblemasClinicos', 'Diagnósticos o problemas clínicos', 1000, '6.1.4'),
      text('pronostico', 'Pronóstico', 1000, '6.1.5'),
      text('indicacionTerapeutica', 'Indicación terapéutica', 1000, '6.1.6'),
    ],
  },

  // ===== Hoja 6.2 =====
  evolucion: {
    label: 'Nota de evolución',
    numeral: '6.2',
    when: 'Subsecuente',
    sections: {
      '6.2.1': 'Evolución y actualización del cuadro clínico',
      '6.2.2': 'Signos vitales',
      '6.2.3': 'Resultados relevantes de estudios auxiliares',
      '6.2.4': 'Diagnósticos o problemas clínicos',
      '6.2.5': 'Pronóstico',
      '6.2.6': 'Tratamiento e indicaciones médicas',
    },
    fields: [
      text('evolucionCuadroClinico', 'Evolución y actualización del cuadro clínico', 1000, '6.2.1'),
      obj('consumoSustancias', 'Consumo de sustancias', 'ConsumoSustancias', '6.2.1'),
      // DISCREPANCIA: aquí el Excel define signosVitales como Texto VARCHAR(500), pero en 6.1.2 y
      // 7.1 es el objeto SignosVitales. Se respeta el Excel; para usar el objeto basta cambiar
      // esta línea por: obj('signosVitales', 'Signos vitales', 'SignosVitales', '6.2.2')
      text('signosVitales', 'Signos vitales', 500, '6.2.2'),
      text('resultadosEstudiosAuxiliares', 'Resultados relevantes de estudios auxiliares', 1000, '6.2.3'),
      text('diagnosticosProblemasClinicos', 'Diagnósticos o problemas clínicos', 1000, '6.2.4'),
      text('pronostico', 'Pronóstico', 500, '6.2.5'),
      // DISCREPANCIA: 6.2.6 tiene un campo de texto Y un objeto con casi la misma información.
      text('tratamientoIndicacionesMedicas', 'Tratamiento e indicaciones médicas', 1000, '6.2.6'),
      obj('tratamientoIndicaciones', 'Indicaciones de tratamiento', 'TratamientoIndicaciones', '6.2.6'),
    ],
  },

  // ===== Hoja 6.3 y 6.4 (parte 6.3) =====
  interconsulta: {
    label: 'Nota de interconsulta',
    numeral: '6.3',
    when: 'Interconsulta interna',
    sections: {
      '6.3.1': 'Criterios diagnósticos',
      '6.3.2': 'Plan de estudios',
      '6.3.3': 'Sugerencias diagnósticas y de tratamiento',
    },
    fields: [
      text('criteriosDiagnosticos', 'Criterios diagnósticos', 1000, '6.3.1'),
      text('planEstudios', 'Plan de estudios', 1000, '6.3.2'),
      text('sugerenciasDiagnosticas', 'Sugerencias diagnósticas', 1000, '6.3.3'),
      text('sugerenciasTratamiento', 'Sugerencias de tratamiento', 1000, '6.3.3'),
    ],
  },

  // ===== Hoja 6.3 y 6.4 (parte 6.4) =====
  referencia: {
    label: 'Nota de referencia / traslado',
    numeral: '6.4',
    when: 'Referencia o traslado',
    sections: {
      '6.4.1': 'Establecimiento que envía',
      '6.4.2': 'Establecimiento receptor',
      '6.4.3.1': 'Motivo de envío',
      '6.4.3.2': 'Impresión diagnóstica',
      '6.4.3.3': 'Terapéutica empleada',
    },
    fields: [
      text('establecimientoEnvia', 'Establecimiento que envía', 200, '6.4.1'),
      text('establecimientoReceptor', 'Establecimiento receptor', 200, '6.4.2'),
      text('motivoEnvio', 'Motivo de envío', 500, '6.4.3.1'),
      text('impresionDiagnostica', 'Impresión diagnóstica', 1000, '6.4.3.2'),
      obj('consumoSustancias', 'Consumo de sustancias', 'ConsumoSustancias', '6.4.3.2'),
      text('terapeuticaEmpleada', 'Terapéutica empleada', 1000, '6.4.3.3'),
    ],
  },

  // ===== Hoja 7.1 =====
  urgencias: {
    label: 'Nota inicial de urgencias',
    numeral: '7.1',
    when: 'Urgencia',
    sections: {
      '7.1.1': 'Fecha y hora del servicio',
      '7.1.2': 'Signos vitales',
      '7.1.3': 'Motivo de la atención',
      '7.1.4': 'Resumen de interrogatorio, exploración y estado mental',
      '7.1.5': 'Resultados relevantes de estudios auxiliares',
      '7.1.6': 'Diagnósticos o problemas clínicos',
      '7.1.7': 'Tratamiento y pronóstico',
    },
    fields: [
      { key: 'fechaServicio', label: 'Fecha en que se otorga el servicio', type: 'date', section: '7.1.1' },
      { key: 'horaServicio', label: 'Hora en que se otorga el servicio', type: 'time', section: '7.1.1' },
      obj('signosVitales', 'Signos vitales', 'SignosVitales', '7.1.2'),
      text('motivoAtencion', 'Motivo de la atención', 500, '7.1.3'),
      text('resumenInterrogatorio', 'Resumen del interrogatorio', 1000, '7.1.4'),
      text('resumenExploracionFisica', 'Resumen de la exploración física', 1000, '7.1.4'),
      text('estadoMental', 'Estado mental', 500, '7.1.4'),
      text('resultadosEstudiosAuxiliares', 'Resultados relevantes de estudios auxiliares', 1000, '7.1.5'),
      text('diagnosticosProblemasClinicos', 'Diagnósticos o problemas clínicos', 1000, '7.1.6'),
      text('tratamiento', 'Tratamiento', 1000, '7.1.7'),
      text('pronostico', 'Pronóstico', 500, '7.1.7'),
    ],
  },
});

// ---------------------------------------------------------------------------
// Campos de una nota que NO se capturan en la consulta porque se copian de otra fuente al cerrarla.
// La ficha de identificación y el grupo étnico salen de la pestaña "Ficha de datos" (ver FICHA_FIELDS
// y buildFichaID en api.js): la pantalla de consulta los muestra en solo lectura.
// ---------------------------------------------------------------------------
export const AUTO_FIELDS = Object.freeze({
  historiaClinica: ['fichaID', 'grupoEtnico'],
});

/**
 * Agrupa los campos de un tipo de nota por numeral de sección, conservando el orden en que
 * aparecen. Devuelve [{ numeral, title, fields }, ...].
 */
export function getSections(noteTypeKey) {
  const noteType = NOTE_TYPES[noteTypeKey];
  if (!noteType) throw new Error(`Tipo de nota desconocido: ${noteTypeKey}`);

  const groups = new Map();
  for (const field of noteType.fields) {
    if (!groups.has(field.section)) {
      groups.set(field.section, {
        numeral: field.section,
        title: noteType.sections[field.section] || field.section,
        fields: [],
      });
    }
    groups.get(field.section).fields.push(field);
  }
  return [...groups.values()];
}

/** Campos hijos de un campo tipo objeto (p. ej. `signosVitales` -> lista de OBJECTS.SignosVitales). */
export function getObjectFields(field) {
  const children = OBJECTS[field.object];
  if (!children) throw new Error(`Objeto desconocido en el esquema: ${field.object}`);
  return children;
}

/** Máximo valor que admite un DECIMAL(p,s). Ej.: DECIMAL(3,1) -> 99.9 */
export function decimalMax(field) {
  return 10 ** (field.precision - field.scale) - 10 ** -field.scale;
}


// ---------------------------------------------------------------------------
// "Ficha de datos" del paciente = SOLO lo que pide el Excel Norm04:
//   · los 12 campos del objeto FichaIdentificacion (hoja "Objetos"): curp, nombre, apellidoP, apellidoM,
//     fechaNacimiento, entidadNacimiento, sexo, nacionalidad, folio, entidadResidencia,
//     municipioResidencia, localidadResidencia
//   · grupoEtnico (hoja 6.1.1). El Excel lo lista como campo aparte de la historia clínica, pero es un
//     dato fijo de la persona; se captura una vez aquí y se copia a la historia clínica al cerrarla.
// La pestaña se genera con formRenderer a partir de esta lista, así no puede desviarse del Excel.
// ---------------------------------------------------------------------------
export const FICHA_FIELDS = Object.freeze([
  ...OBJECTS.FichaIdentificacion,
  NOTE_TYPES.historiaClinica.fields.find((field) => field.key === 'grupoEtnico'),
]);

/** Campos de la ficha que viven en la raíz del paciente (los usa todo el sistema); el resto va en `paciente.ficha`. */
export const FICHA_ROOT_KEYS = Object.freeze(['nombre', 'apellidoP', 'apellidoM']);

// ---------------------------------------------------------------------------
// Nota SOAP de enfermería (frame "ConsultaSOAP" del Figma): la UNIÓN de los campos de las hojas
// 6.1.x, 6.2 y 7.1 del Excel, repartidos en los paneles del Figma. No define campos nuevos: toma las
// definiciones de NOTE_TYPES, así tipos y tamaños son los mismos que valida el backend
// (electronicHealthRecordApp/controller/notaSoapFields.js).
//   · Fuera: hojas 6.3/6.4 (camino del médico), fichaID y grupoEtnico (viven en la Ficha de datos).
//   · Paneles del Figma sin campos del Excel ("Alergias", "PLAN"): no se dibujan por ahora.
//   · fechaServicio/horaServicio (7.1.1) no se capturan: el backend pone la fecha y hora actuales.
//   · Cuando un campo existe en varias hojas se toma el de mayor tamaño (pronostico: 1000 de 6.1.5).
//   · `column` 'left' | 'right': columna del Figma en la que va el panel.
// ---------------------------------------------------------------------------

/** Campo `key` del tipo de nota `noteTypeKey` (falla al cargar si el Excel/esquema cambia de nombre). */
function noteField(noteTypeKey, key) {
  const field = NOTE_TYPES[noteTypeKey].fields.find((f) => f.key === key);
  if (!field) throw new Error(`Campo ${key} no existe en ${noteTypeKey}`);
  return field;
}

export const SOAP_PANELS = Object.freeze([
  {
    id: 'subjetivo', title: 'Subjetivo (motivos de la consulta)', column: 'left',
    fields: [
      noteField('urgencias', 'motivoAtencion'),
      noteField('historiaClinica', 'padecimientoActual'),
      noteField('evolucion', 'evolucionCuadroClinico'),
      noteField('historiaClinica', 'interrogatorioAparatosSistemas'),
      noteField('urgencias', 'resumenInterrogatorio'),
      noteField('historiaClinica', 'tratamientoPrevio'),
    ],
  },
  {
    id: 'signosVitales', title: 'Signos Vitales | Datos antropométricos', column: 'left',
    fields: [
      noteField('historiaClinica', 'signosVitales'),
      noteField('historiaClinica', 'peso'),
      noteField('historiaClinica', 'talla'),
    ],
  },
  {
    id: 'historiales', title: 'Historiales', column: 'right',
    fields: [
      noteField('historiaClinica', 'antecedentesHeredoFamiliares'),
      noteField('historiaClinica', 'antecedentesPersonalesPatologicos'),
      noteField('historiaClinica', 'antecedentesPersonalesNoPatologicos'),
      noteField('historiaClinica', 'consumoSustancias'),
    ],
  },
  {
    id: 'exploracionFisica', title: 'Exploración física (Observaciones)', column: 'left',
    fields: [
      noteField('historiaClinica', 'habitusExterior'),
      noteField('historiaClinica', 'datosExploracionFisica'),
      noteField('urgencias', 'resumenExploracionFisica'),
      noteField('urgencias', 'estadoMental'),
    ],
  },
  {
    id: 'analisis', title: 'Análisis diagnóstico', column: 'right',
    fields: [
      noteField('historiaClinica', 'diagnosticosProblemasClinicos'),
      noteField('historiaClinica', 'pronostico'),
    ],
  },
  {
    id: 'tratamiento', title: 'Tratamiento', column: 'left',
    fields: [
      noteField('historiaClinica', 'indicacionTerapeutica'),
      noteField('evolucion', 'tratamientoIndicacionesMedicas'),
      noteField('evolucion', 'tratamientoIndicaciones'),
      noteField('urgencias', 'tratamiento'),
    ],
  },
  {
    id: 'laboratorio', title: 'Laboratorio', column: 'right',
    fields: [
      noteField('historiaClinica', 'resultadosPreviosEstudios'),
      noteField('historiaClinica', 'resultadosActualesEstudios'),
      noteField('evolucion', 'resultadosEstudiosAuxiliares'),
    ],
  },
]);

/** Campos de antecedentes (hoja 6.1.1): pestaña "Antecedentes" y panel "Historiales" del SOAP. */
export const ANTECEDENTES_KEYS = Object.freeze([
  'antecedentesHeredoFamiliares',
  'antecedentesPersonalesPatologicos',
  'antecedentesPersonalesNoPatologicos',
  'consumoSustancias',
]);
