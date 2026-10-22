/*
 * antecedentesCatalogs.js — catálogos de la pestaña Antecedentes. COPIA de
 * electronicHealthRecord/electronicHealthRecordApp/controller/antecedentesCatalogs.js (el backend
 * valida contra esa lista): si cambias algo allá, cámbialo aquí. Se guardan los CÓDIGOS (llaves),
 * no las etiquetas. Ninguna norma define estas listas: son propuestas a partir de MediSel.
 */

export const HEREDO_PADECIMIENTOS = Object.freeze({
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

export const PARENTESCOS = Object.freeze({
  PADRE: 'Padre',
  MADRE: 'Madre',
  HERMANOS: 'Hermanos',
  ABUELOS: 'Abuelos',
  OTROS: 'Otros familiares',
});

export const PATOLOGICOS = Object.freeze({
  QUIRURGICOS: 'Quirúrgicos',
  HOSPITALIZACIONES: 'Hospitalizaciones',
  TRAUMATICOS: 'Traumáticos',
  TRANSFUSIONALES: 'Transfusionales',
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
  HEPATITIS: 'Hepatitis',
  TUBERCULOSIS: 'Tuberculosis',
  ITS: 'Infecciones de transmisión sexual',
  EXANTEMATICAS: 'Exantemáticas de la infancia (varicela, sarampión, rubéola)',
});

// Grupos para dibujar la lista de patológicos como en MediSel.
export const PATOLOGICOS_GRUPOS = Object.freeze([
  { title: 'Generales', codes: ['QUIRURGICOS', 'HOSPITALIZACIONES', 'TRAUMATICOS', 'TRANSFUSIONALES'] },
  { title: 'Crónico-degenerativas', codes: ['DM', 'HAS', 'DISLIPIDEMIA', 'OBESIDAD', 'CANCER', 'CARDIOVASCULARES', 'RESPIRATORIAS', 'GASTROINTESTINALES', 'RENALES', 'ENDOCRINAS', 'NEUROLOGICAS', 'PSIQUIATRICAS', 'REUMATOLOGICAS'] },
  { title: 'Infectocontagiosas', codes: ['HEPATITIS', 'TUBERCULOSIS', 'ITS', 'EXANTEMATICAS'] },
]);

export const CONSUMO = Object.freeze({
  NO: 'No consume',
  USO: 'Uso',
  DEPENDENCIA: 'Dependencia',
  EX: 'Exconsumidor',
});

export const ALERGIA_AGENTES = Object.freeze({
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

export const TIPO_REACCION = Object.freeze({
  CUTANEA: 'Cutánea (ronchas, comezón)',
  RESPIRATORIA: 'Respiratoria',
  GASTROINTESTINAL: 'Gastrointestinal',
  ANAFILAXIA: 'Anafilaxia',
  ADVERSA: 'Reacción adversa (no alérgica)',
  OTRA: 'Otra',
});

export const METODO_ANTICONCEPTIVO = Object.freeze({
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

export const DISCAPACIDADES = Object.freeze({
  MOTRIZ: 'Motriz',
  VISUAL: 'Visual',
  AUDITIVA: 'Auditiva',
  HABLA: 'Del habla o comunicación',
  INTELECTUAL: 'Intelectual',
  PSICOSOCIAL: 'Psicosocial (mental)',
});

/** [{ code, label }] en el orden del catálogo, para dibujar selects y casillas. */
export const entries = (catalog) => Object.entries(catalog).map(([code, label]) => ({ code, label }));
