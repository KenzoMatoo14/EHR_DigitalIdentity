// entidades.js — las 32 entidades federativas con sus tres "nombres":
//   · id     = código INEGI como número (es el id del catálogo `entidad` del frontend, catalogs.js)
//   · curp   = las 2 letras que usa la CURP en las posiciones 12-13 (JC = Jalisco)
//   · nombre + alias = cómo puede venir escrito el estado en texto libre
//
// Por qué hace falta: el acta de ChainIDentity (BirthCertificate.sol) guarda el estado como TEXTO
// libre (`state`, un <input type="text"> en frontendBirthCertificate), no como código. Para llenar
// `entidadNacimiento` (Catálogo del Excel) y calcular la CURP hay que reconocer ese texto.

const ENTIDADES = [
  { id: 1, curp: 'AS', nombre: 'Aguascalientes', alias: ['ags'] },
  { id: 2, curp: 'BC', nombre: 'Baja California', alias: ['bc', 'baja california norte'] },
  { id: 3, curp: 'BS', nombre: 'Baja California Sur', alias: ['bcs'] },
  { id: 4, curp: 'CC', nombre: 'Campeche', alias: ['camp'] },
  { id: 5, curp: 'CL', nombre: 'Coahuila', alias: ['coahuila de zaragoza', 'coah'] },
  { id: 6, curp: 'CM', nombre: 'Colima', alias: ['col'] },
  { id: 7, curp: 'CS', nombre: 'Chiapas', alias: ['chis'] },
  { id: 8, curp: 'CH', nombre: 'Chihuahua', alias: ['chih'] },
  { id: 9, curp: 'DF', nombre: 'Ciudad de México', alias: ['cdmx', 'distrito federal', 'df', 'mexico df', 'ciudad de mexico'] },
  { id: 10, curp: 'DG', nombre: 'Durango', alias: ['dgo'] },
  { id: 11, curp: 'GT', nombre: 'Guanajuato', alias: ['gto'] },
  { id: 12, curp: 'GR', nombre: 'Guerrero', alias: ['gro'] },
  { id: 13, curp: 'HG', nombre: 'Hidalgo', alias: ['hgo'] },
  { id: 14, curp: 'JC', nombre: 'Jalisco', alias: ['jal'] },
  { id: 15, curp: 'MC', nombre: 'México', alias: ['estado de mexico', 'edo de mexico', 'edo mex', 'edomex', 'mex'] },
  { id: 16, curp: 'MN', nombre: 'Michoacán', alias: ['michoacan de ocampo', 'mich'] },
  { id: 17, curp: 'MS', nombre: 'Morelos', alias: ['mor'] },
  { id: 18, curp: 'NT', nombre: 'Nayarit', alias: ['nay'] },
  { id: 19, curp: 'NL', nombre: 'Nuevo León', alias: ['nl'] },
  { id: 20, curp: 'OC', nombre: 'Oaxaca', alias: ['oax'] },
  { id: 21, curp: 'PL', nombre: 'Puebla', alias: ['pue'] },
  { id: 22, curp: 'QT', nombre: 'Querétaro', alias: ['queretaro de arteaga', 'qro'] },
  { id: 23, curp: 'QR', nombre: 'Quintana Roo', alias: ['q roo', 'qroo'] },
  { id: 24, curp: 'SP', nombre: 'San Luis Potosí', alias: ['slp'] },
  { id: 25, curp: 'SL', nombre: 'Sinaloa', alias: ['sin'] },
  { id: 26, curp: 'SR', nombre: 'Sonora', alias: ['son'] },
  { id: 27, curp: 'TC', nombre: 'Tabasco', alias: ['tab'] },
  { id: 28, curp: 'TS', nombre: 'Tamaulipas', alias: ['tamps'] },
  { id: 29, curp: 'TL', nombre: 'Tlaxcala', alias: ['tlax'] },
  { id: 30, curp: 'VZ', nombre: 'Veracruz', alias: ['veracruz de ignacio de la llave', 'ver'] },
  { id: 31, curp: 'YN', nombre: 'Yucatán', alias: ['yuc'] },
  { id: 32, curp: 'ZS', nombre: 'Zacatecas', alias: ['zac'] },
];

// id 33 = "Extranjero" en catalogs.js; en la CURP los nacidos fuera son "NE".
const EXTRANJERO = { id: 33, curp: 'NE', nombre: 'Extranjero', alias: ['extranjero', 'nacido en el extranjero'] };

/** "  Nuevo León. " -> "nuevo leon": minúsculas, sin acentos ni puntuación, espacios simples. */
function normalizeKey(text) {
  return String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Índice texto normalizado -> entidad. Se arma una vez al cargar el módulo.
const BY_KEY = new Map();
for (const entidad of [...ENTIDADES, EXTRANJERO]) {
  for (const key of [entidad.nombre, entidad.curp, String(entidad.id), ...entidad.alias]) {
    BY_KEY.set(normalizeKey(key), entidad);
  }
}

/**
 * Reconoce el estado escrito en el acta ("Jalisco", "JAL", "CDMX", "14", "JC").
 * @returns {{id:number, curp:string, nombre:string}|null} null si no se reconoce
 */
function findEntidad(text) {
  const key = normalizeKey(text);
  if (key === '') return null;
  return BY_KEY.get(key) || BY_KEY.get(key.replace(/^estado de /, '')) || null;
}

module.exports = { findEntidad, normalizeKey };
