// antecedentesCatalogs.js — catálogos de la sección Antecedentes (NOM-004 6.1.1 y NOM-024).
//
// Se guardan CÓDIGOS cortos, no textos: ocupan poco (importa para el gas cuando esto vaya a
// blockchain) y no cambian si se corrige una etiqueta. El frontend tiene una copia con las mismas
// claves en public/js/data/antecedentesCatalogs.js: si cambias algo aquí, cámbialo allá.
//
// PROPUESTOS: ninguna de las dos normas define estas listas. Salen de MediSel, reducidas a lo
// que aplica a una población universitaria. Están marcados los que pide una norma.

// Padecimientos heredo-familiares (filas de la matriz "Ant. Familiares" de MediSel).
const HEREDO_PADECIMIENTOS = Object.freeze({
  DM: 'Diabetes mellitus',
  HAS: 'Hipertensión arterial sistémica',
  DISLIPIDEMIA: 'Dislipidemias',
  CANCER: 'Neoplasias (cáncer)',
  MALFORMACIONES: 'Malformaciones hereditarias / congénitas',
  ALERGIAS: 'Alergias',
  PSIQUIATRICAS: 'Enfermedades psiquiátricas',
  NEUROLOGICAS: 'Enfermedades neurológicas',
  CARDIOVASCULARES: 'Enfermedades cardiovasculares',
  BRONCOPULMONARES: 'Enfermedades broncopulmonares',
  TIROIDEAS: 'Enfermedades tiroideas',
  RENALES: 'Enfermedades renales',
  OSTEOARTICULARES: 'Enfermedades osteoarticulares',
  INFECTOCONTAGIOSAS: 'Enfermedades infectocontagiosas',
});

// Parentesco (columnas de la matriz). NOM-024 2.1.4 pide identificar la consanguinidad.
const PARENTESCOS = Object.freeze({
  PADRE: 'Padre',
  MADRE: 'Madre',
  HERMANOS: 'Hermanos',
  ABUELOS: 'Abuelos',
  OTROS: 'Otros familiares',
});

// Antecedentes personales patológicos (resumen de las ~45 casillas de MediSel).
const PATOLOGICOS = Object.freeze({
  // Generales
  QUIRURGICOS: 'Quirúrgicos',
  HOSPITALIZACIONES: 'Hospitalizaciones',
  TRAUMATICOS: 'Traumáticos',
  TRANSFUSIONALES: 'Transfusionales',
  // Crónico-degenerativas
  DM: 'Diabetes mellitus',
  HAS: 'Hipertensión arterial sistémica',
  DISLIPIDEMIA: 'Dislipidemias',
  OBESIDAD: 'Obesidad',
  CANCER: 'Neoplasias (cáncer)',
  CARDIOVASCULARES: 'Enfermedades cardiovasculares',
  RESPIRATORIAS: 'Enfermedades respiratorias (por ejemplo, asma)',
  GASTROINTESTINALES: 'Enfermedades gastrointestinales',
  RENALES: 'Enfermedades renales / urinarias',
  ENDOCRINAS: 'Enfermedades endocrinológicas (por ejemplo, tiroideas)',
  NEUROLOGICAS: 'Enfermedades neurológicas (por ejemplo, epilepsia)',
  PSIQUIATRICAS: 'Enfermedades psiquiátricas',
  REUMATOLOGICAS: 'Enfermedades reumatológicas / inmunológicas',
  // Infectocontagiosas
  HEPATITIS: 'Hepatitis',
  TUBERCULOSIS: 'Tuberculosis',
  ITS: 'Infecciones de transmisión sexual',
  EXANTEMATICAS: 'Exantemáticas de la infancia (varicela, sarampión, rubéola)',
});

// Uso y dependencia de sustancias (NOM-004 6.1.1 pide "uso y dependencia", no solo "uso").
const CONSUMO = Object.freeze({
  NO: 'No consume',
  USO: 'Uso',
  DEPENDENCIA: 'Dependencia',
  EX: 'Exconsumidor',
});

// Agente que causa la alergia (lista "Alergias más comunes" de MediSel + medicamento/otro).
const ALERGIA_AGENTES = Object.freeze({
  MEDICAMENTO: 'Medicamento',
  ALIMENTOS: 'Alimentos',
  MARISCOS: 'Mariscos',
  FRUTOS_SECOS: 'Frutos secos',
  CHOCOLATE: 'Chocolate',
  LATEX: 'Látex',
  NIQUEL: 'Níquel',
  PICADURA_INSECTOS: 'Picadura de insectos',
  POLEN: 'Polen',
  POLVO: 'Polvo',
  ACAROS: 'Ácaros',
  HONGOS_MOHO: 'Hongos / moho',
  HUMEDAD: 'Humedad',
  MASCOTAS: 'Mascotas',
  SOL: 'Sol',
  OTRO: 'Otro',
});

// NOM-024 (Apéndice B) pide "Tipo de reacción" de un catálogo CAT_REACCIONES_ALERGICAS que la
// norma no publica. Este es PROPUESTO.
const TIPO_REACCION = Object.freeze({
  CUTANEA: 'Cutánea (ronchas, comezón)',
  RESPIRATORIA: 'Respiratoria',
  GASTROINTESTINAL: 'Gastrointestinal',
  ANAFILAXIA: 'Anafilaxia',
  ADVERSA: 'Reacción adversa (no alérgica)',
  OTRA: 'Otra',
});

// Opcional (no lo exige la NOM-004 6.1): solo para pacientes mujeres.
const METODO_ANTICONCEPTIVO = Object.freeze({
  NINGUNO: 'Ninguno',
  PRESERVATIVO: 'Preservativo',
  HORMONAL_ORAL: 'Hormonal oral',
  INYECTABLE: 'Inyectable',
  IMPLANTE: 'Implante subdérmico',
  DIU: 'Dispositivo intrauterino',
  PARCHE: 'Parche',
  DEFINITIVO: 'Definitivo (oclusión tubaria bilateral o vasectomía de la pareja)',
  OTRO: 'Otro',
});

// Opcional: DISCAPACIDAD está en el objeto Paciente de NOM-024. Grupos de discapacidad de INEGI.
const DISCAPACIDADES = Object.freeze({
  MOTRIZ: 'Motriz',
  VISUAL: 'Visual',
  AUDITIVA: 'Auditiva',
  HABLA: 'Del habla o comunicación',
  INTELECTUAL: 'Intelectual',
  PSICOSOCIAL: 'Psicosocial (mental)',
});

// ---------------------------------------------------------------------------
// Tabla de equivalencias código local -> estándar (NOM-024 3.1.3: si se usa terminología local
// debe mapearse a la estándar; 3.2.1 d y f: CIE-10 para diagnósticos y CIF para discapacidad).
// No se guarda en cada versión (no gasta bytes ni gas): se usa al intercambiar o reportar.
// PROPUESTA a validar con el médico. null = es un evento, no un diagnóstico (no tiene código CIE-10).
// Regla de mantenimiento (NOM-024 3.1.2): un código local NUNCA se borra ni se reutiliza, aunque
// deje de ofrecerse, para que las versiones viejas sigan significando lo mismo.
// ---------------------------------------------------------------------------
const EQUIVALENCIAS = Object.freeze({
  // CIE-10 (categoría o bloque)
  HEREDO_PADECIMIENTOS: Object.freeze({
    DM: 'E10-E14', HAS: 'I10-I15', DISLIPIDEMIA: 'E78', CANCER: 'C00-D48', MALFORMACIONES: 'Q00-Q99',
    ALERGIAS: 'T78.4', PSIQUIATRICAS: 'F00-F99', NEUROLOGICAS: 'G00-G99', CARDIOVASCULARES: 'I00-I99',
    BRONCOPULMONARES: 'J00-J99', TIROIDEAS: 'E00-E07', RENALES: 'N00-N29', OSTEOARTICULARES: 'M00-M99',
    INFECTOCONTAGIOSAS: 'A00-B99',
  }),
  PATOLOGICOS: Object.freeze({
    QUIRURGICOS: 'Z98.8', HOSPITALIZACIONES: null, TRAUMATICOS: 'S00-T14', TRANSFUSIONALES: null,
    DM: 'E10-E14', HAS: 'I10-I15', DISLIPIDEMIA: 'E78', OBESIDAD: 'E66', CANCER: 'C00-D48',
    CARDIOVASCULARES: 'I00-I99', RESPIRATORIAS: 'J00-J99', GASTROINTESTINALES: 'K00-K93',
    RENALES: 'N00-N39', ENDOCRINAS: 'E00-E90', NEUROLOGICAS: 'G00-G99', PSIQUIATRICAS: 'F00-F99',
    REUMATOLOGICAS: 'M00-M99, D80-D89', HEPATITIS: 'B15-B19', TUBERCULOSIS: 'A15-A19', ITS: 'A50-A64',
    EXANTEMATICAS: 'B01-B09',
  }),
  // CIF (capítulo o categoría de funciones corporales "b" / actividades "d")
  DISCAPACIDADES: Object.freeze({
    MOTRIZ: 'b7, d4', VISUAL: 'b210', AUDITIVA: 'b230', HABLA: 'b3, d3', INTELECTUAL: 'b117', PSICOSOCIAL: 'b1',
  }),
});

module.exports = {
  EQUIVALENCIAS,
  HEREDO_PADECIMIENTOS,
  PARENTESCOS,
  PATOLOGICOS,
  CONSUMO,
  ALERGIA_AGENTES,
  TIPO_REACCION,
  METODO_ANTICONCEPTIVO,
  DISCAPACIDADES,
};
