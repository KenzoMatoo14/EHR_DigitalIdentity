// notaSoapFields.js — campos de la nota SOAP de enfermería = la UNIÓN de los campos del Excel
// Norm04 de las hojas 6.1.1, 6.1.2, 6.1.3-6.1.6, 6.2 y 7.1, repartidos en los paneles del frame
// "ConsultaSOAP" del Figma. Las hojas 6.3 y 6.4 (interconsulta y referencia) quedan fuera: son
// del camino del médico. fichaID y grupoEtnico tampoco van aquí: viven en ficha_identificacion.
//
// De esta lista salen la tabla (schema.js), la validación y la respuesta del controller.
// Cada campo:
//   path   -> ruta en el JSON de la petición, con los nombres del Excel. Los objetos del Excel
//             (signosVitales, consumoSustancias, ...) llegan anidados, igual que los arma
//             formRenderer.readValues en el frontend.
//   column -> columna MySQL.
//   type   -> ver validation.js. max / precision / scale = tamaño del Excel.
//
// Cuando un campo aparece en varias hojas con tamaños distintos se usa el MAYOR, para que quepa
// lo que cualquiera de ellas permite (p. ej. pronostico: 1000 en 6.1.5, 500 en 6.2.5 y 7.1.7).

const text = (path, column, label, max, panel, extra = {}) => ({ path, column, label, type: 'text', max, panel, ...extra });
const decimal = (path, column, label, precision, scale, panel, extra = {}) => ({ path, column, label, type: 'decimal', precision, scale, panel, ...extra });
const integer = (path, column, label, panel, extra = {}) => ({ path, column, label, type: 'integer', panel, ...extra });

const NOTA_SOAP_FIELDS = Object.freeze([
  // ===== Subjetivo (motivos de la consulta) =====
  text(['motivoAtencion'], 'motivo_atencion', 'Motivo de la atención', 500, 'subjetivo'), // 7.1.3
  text(['padecimientoActual'], 'padecimiento_actual', 'Padecimiento actual', 500, 'subjetivo'), // 6.1.1
  text(['evolucionCuadroClinico'], 'evolucion_cuadro_clinico', 'Evolución y actualización del cuadro clínico', 1000, 'subjetivo'), // 6.2.1
  text(['interrogatorioAparatosSistemas'], 'interrogatorio_aparatos_sistemas', 'Interrogatorio por aparatos y sistemas', 1000, 'subjetivo'), // 6.1.1
  text(['resumenInterrogatorio'], 'resumen_interrogatorio', 'Resumen del interrogatorio', 1000, 'subjetivo'), // 7.1.4
  // Objeto TratamientoPrevio (6.1.1)
  text(['tratamientoPrevio', 'tratamientoPrevioConvencional'], 'tratamiento_previo_convencional', 'Tratamiento previo convencional', 200, 'subjetivo'),
  text(['tratamientoPrevio', 'tratamientoPrevioAlternativo'], 'tratamiento_previo_alternativo', 'Tratamiento previo alternativo', 200, 'subjetivo'),
  text(['tratamientoPrevio', 'tratamientoPrevioTradicional'], 'tratamiento_previo_tradicional', 'Tratamiento previo tradicional', 200, 'subjetivo'),

  // ===== Signos vitales | Datos antropométricos =====
  // Objeto SignosVitales (6.1.2 y 7.1.2). En 6.2.2 el Excel lo define como texto VARCHAR(500);
  // al juntar las hojas se usa el objeto, que es más específico.
  // min/max: rangos clínicos PROPUESTOS (no vienen del Excel) para rechazar valores imposibles o mal
  // capturados. Los mismos están en el frontend (public/js/data/schema.js).
  decimal(['signosVitales', 'temperatura'], 'temperatura', 'Temperatura (°C)', 3, 1, 'signosVitales', { min: 30, max: 45 }),
  text(['signosVitales', 'tensionArterial'], 'tension_arterial', 'Tensión arterial (mmHg)', 10, 'signosVitales',
    { pattern: /^\d{2,3}\/\d{2,3}$/, patternHint: 'formato sistólica/diastólica, p. ej. 120/80' }),
  integer(['signosVitales', 'frecuenciaCardiaca'], 'frecuencia_cardiaca', 'Frecuencia cardiaca (lpm)', 'signosVitales', { min: 20, max: 250 }),
  integer(['signosVitales', 'frecuenciaRespiratoria'], 'frecuencia_respiratoria', 'Frecuencia respiratoria (rpm)', 'signosVitales', { min: 4, max: 80 }),
  decimal(['peso'], 'peso', 'Peso (kg)', 5, 2, 'signosVitales', { min: 0.5, max: 400 }), // 6.1.2
  decimal(['talla'], 'talla', 'Talla (m)', 4, 2, 'signosVitales', { min: 0.3, max: 2.5 }), // 6.1.2

  // ===== Historiales =====
  // Los antecedentes (6.1.1) y el consumo de sustancias (6.1.1 / 6.2.1) ya NO se copian en cada
  // nota: viven en la tabla `antecedentes` (por versiones) y la nota guarda `antecedentes_id`, la
  // versión vigente al momento de la visita. Ver antecedentesController.js.

  // ===== Exploración física (observaciones) =====
  text(['habitusExterior'], 'habitus_exterior', 'Habitus exterior', 500, 'exploracionFisica'), // 6.1.2
  // Objeto DatosExploracionFisica (6.1.2)
  text(['datosExploracionFisica', 'cabeza'], 'exploracion_cabeza', 'Cabeza', 500, 'exploracionFisica'),
  text(['datosExploracionFisica', 'cuello'], 'exploracion_cuello', 'Cuello', 500, 'exploracionFisica'),
  text(['datosExploracionFisica', 'torax'], 'exploracion_torax', 'Tórax', 500, 'exploracionFisica'),
  text(['datosExploracionFisica', 'abdomen'], 'exploracion_abdomen', 'Abdomen', 500, 'exploracionFisica'),
  text(['datosExploracionFisica', 'miembros'], 'exploracion_miembros', 'Miembros', 500, 'exploracionFisica'),
  text(['datosExploracionFisica', 'genitales'], 'exploracion_genitales', 'Genitales', 500, 'exploracionFisica'),
  text(['resumenExploracionFisica'], 'resumen_exploracion_fisica', 'Resumen de la exploración física', 1000, 'exploracionFisica'), // 7.1.4
  text(['estadoMental'], 'estado_mental', 'Estado mental', 500, 'exploracionFisica'), // 7.1.4

  // ===== Análisis diagnóstico =====
  text(['diagnosticosProblemasClinicos'], 'diagnosticos_problemas_clinicos', 'Diagnósticos o problemas clínicos', 1000, 'analisis'), // 6.1.4, 6.2.4, 7.1.6
  text(['pronostico'], 'pronostico', 'Pronóstico', 1000, 'analisis'), // 6.1.5, 6.2.5, 7.1.7

  // ===== Tratamiento =====
  text(['indicacionTerapeutica'], 'indicacion_terapeutica', 'Indicación terapéutica', 1000, 'tratamiento'), // 6.1.6
  text(['tratamientoIndicacionesMedicas'], 'tratamiento_indicaciones_medicas', 'Tratamiento e indicaciones médicas', 1000, 'tratamiento'), // 6.2.6
  // Objeto TratamientoIndicaciones (6.2.6)
  text(['tratamientoIndicaciones', 'dosis'], 'dosis', 'Dosis', 100, 'tratamiento'),
  text(['tratamientoIndicaciones', 'viaAdministracion'], 'via_administracion', 'Vía de administración', 100, 'tratamiento'),
  text(['tratamientoIndicaciones', 'periodicidad'], 'periodicidad', 'Periodicidad', 50, 'tratamiento'),
  text(['tratamiento'], 'tratamiento', 'Tratamiento', 1000, 'tratamiento'), // 7.1.7

  // ===== Laboratorio =====
  // Objeto ResultadosEstudios (6.1.3), dos veces: previos y actuales
  text(['resultadosPreviosEstudios', 'laboratorio'], 'previos_laboratorio', 'Resultados previos: laboratorio', 1000, 'laboratorio'),
  text(['resultadosPreviosEstudios', 'gabinete'], 'previos_gabinete', 'Resultados previos: gabinete', 1000, 'laboratorio'),
  text(['resultadosPreviosEstudios', 'otros'], 'previos_otros', 'Resultados previos: otros', 1000, 'laboratorio'),
  text(['resultadosActualesEstudios', 'laboratorio'], 'actuales_laboratorio', 'Resultados actuales: laboratorio', 1000, 'laboratorio'),
  text(['resultadosActualesEstudios', 'gabinete'], 'actuales_gabinete', 'Resultados actuales: gabinete', 1000, 'laboratorio'),
  text(['resultadosActualesEstudios', 'otros'], 'actuales_otros', 'Resultados actuales: otros', 1000, 'laboratorio'),
  text(['resultadosEstudiosAuxiliares'], 'resultados_estudios_auxiliares', 'Resultados relevantes de estudios auxiliares', 1000, 'laboratorio'), // 6.2.3, 7.1.5
]);

// 7.1.1 Fecha y hora en que se otorga el servicio. No tienen panel: si no vienen, el servidor
// usa la fecha y hora actuales.
const SERVICIO_FIELDS = Object.freeze([
  { path: ['fechaServicio'], column: 'fecha_servicio', label: 'Fecha del servicio', type: 'date' },
  { path: ['horaServicio'], column: 'hora_servicio', label: 'Hora del servicio', type: 'time' },
]);

// MySQL limita una fila a 65,535 bytes y en utf8mb4 cada carácter de un VARCHAR reserva hasta 4
// bytes: 30+ columnas VARCHAR(500/1000) no caben. Los textos de más de 255 caracteres se guardan
// como TEXT (vive fuera de la fila); el tamaño del Excel lo sigue imponiendo validation.js.
const MAX_VARCHAR = 255;

/** Tipo SQL de la columna según el tipo del Excel. */
function sqlType(field) {
  switch (field.type) {
    case 'text': return field.max > MAX_VARCHAR ? 'TEXT' : `VARCHAR(${field.max})`;
    case 'decimal': return `DECIMAL(${field.precision},${field.scale})`;
    case 'integer': return 'INT UNSIGNED';
    case 'boolean': return 'BOOLEAN';
    case 'date': return 'DATE';
    case 'time': return 'TIME';
    default: throw new Error(`Tipo de campo no soportado: ${field.type}`);
  }
}

module.exports = { NOTA_SOAP_FIELDS, SERVICIO_FIELDS, sqlType };
