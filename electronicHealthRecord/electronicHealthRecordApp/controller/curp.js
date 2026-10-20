// curp.js — calcula los primeros 16 caracteres de una CURP a partir de los datos del acta.
//
// Por qué solo 16: la CURP tiene 18 caracteres y los dos últimos no salen de los datos personales.
// El 17 (homoclave) lo asigna RENAPO para distinguir homónimos y el 18 es un dígito verificador que
// depende del 17. ChainIDentity no guarda la CURP, así que lo que SÍ se puede hacer es:
//   · buscar el acta de una CURP comparando sus primeros 16 caracteres, y
//   · avisar si la CURP capturada no corresponde a los datos del acta.
//
// Estructura (Instructivo normativo para la asignación de la CURP, RENAPO):
//   1    primera letra del apellido paterno
//   2    primera vocal INTERNA del apellido paterno (la que no es la primera letra)
//   3    primera letra del apellido materno (X si no tiene)
//   4    primera letra del nombre (si es compuesto y empieza con MARÍA o JOSÉ, se usa el segundo)
//   5-10 fecha de nacimiento aammdd
//   11   sexo H/M
//   12-13 entidad de nacimiento (JC, DF, ... NE = extranjero)
//   14-16 primera consonante INTERNA de apellido paterno, apellido materno y nombre
// Si las 4 primeras letras forman una palabra "inconveniente" (lista oficial), la 2a se cambia por X.

// Preposiciones, artículos y conjunciones que se ignoran en apellidos y nombres compuestos
// ("DE LA FUENTE" -> "FUENTE", "MARÍA DE LOS ÁNGELES" -> "MARÍA ÁNGELES").
const PARTICLES = new Set(['DA', 'DAS', 'DE', 'DEL', 'DER', 'DI', 'DIE', 'DD', 'EL', 'LA', 'LOS', 'LAS', 'LE', 'LES', 'MAC', 'MC', 'VAN', 'VON', 'Y']);

// Primeros nombres que se saltan cuando hay un segundo nombre.
const SKIPPED_FIRST_NAMES = new Set(['MARIA', 'MA', 'JOSE', 'J']);

// Palabras inconvenientes del instructivo de RENAPO (Anexo 2).
const BAD_WORDS = new Set([
  'BACA', 'BAKA', 'BUEI', 'BUEY', 'CACA', 'CACO', 'CAGA', 'CAGO', 'CAKA', 'CAKO', 'COGE', 'COGI', 'COJA',
  'COJE', 'COJI', 'COJO', 'COLA', 'CULO', 'FALO', 'FETO', 'GETA', 'GUEI', 'GUEY', 'JETA', 'JOTO', 'KACA',
  'KACO', 'KAGA', 'KAGO', 'KAKA', 'KAKO', 'KOGE', 'KOGI', 'KOJA', 'KOJE', 'KOJI', 'KOJO', 'KOLA', 'KULO',
  'LILO', 'LOCA', 'LOCO', 'LOKA', 'LOKO', 'MAME', 'MAMO', 'MEAR', 'MEAS', 'MEON', 'MIAR', 'MION', 'MOCO',
  'MOKO', 'MULA', 'MULO', 'NACA', 'NACO', 'PEDA', 'PEDO', 'PENE', 'PIPI', 'PITO', 'POPO', 'PUTA', 'PUTO',
  'QULO', 'RATA', 'ROBA', 'ROBE', 'ROBO', 'RUIN', 'SENO', 'TETA', 'VACA', 'VAGA', 'VAGO', 'VAKA', 'VUEI',
  'VUEY', 'WUEI', 'WUEY',
]);

const VOWELS = 'AEIOU';

/**
 * "  José  de la Peña. " -> ["JOSE", "PEÑA"]: mayúsculas, sin acentos (la Ñ se conserva para poder
 * convertirla en X después), sin puntuación y sin partículas.
 */
function words(text) {
  const upper = String(text || '')
    .toUpperCase()
    .replace(/Ñ/g, '\u0000') // protege la Ñ: NFD la separaría en N + tilde y se perdería
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\u0000/g, 'Ñ')
    .replace(/[^A-ZÑ ]/g, ' ');
  const all = upper.split(/\s+/).filter(Boolean);
  const meaningful = all.filter((word) => !PARTICLES.has(word));
  // Si todo eran partículas (apellido "DE"), se usa tal cual en vez de quedarse sin letras.
  return meaningful.length > 0 ? meaningful : all;
}

/** Ñ -> X, como indica el instructivo para cualquier posición de la CURP. */
const curpChar = (char) => (char === 'Ñ' ? 'X' : char);

function firstInternal(word, predicate) {
  for (const char of word.slice(1)) {
    if (predicate(char)) return curpChar(char);
  }
  return 'X';
}

const isVowel = (char) => VOWELS.includes(char);
const isConsonant = (char) => /[A-ZÑ]/.test(char) && !isVowel(char);

/** Primer nombre que cuenta para la CURP (salta MARÍA/JOSÉ si hay otro). */
function curpGivenName(nombre) {
  const list = words(nombre);
  if (list.length > 1 && SKIPPED_FIRST_NAMES.has(list[0])) return list[1];
  return list[0] || '';
}

// Marca de "posición desconocida": si el estado del acta no se reconoce, las posiciones 12-13 van como
// "**" y se comparan los otros 14 caracteres (mejor que no poder revisar nada).
const UNKNOWN = '*';

/**
 * Calcula los 16 primeros caracteres de la CURP.
 * @param {{ nombre:string, apellidoP:string, apellidoM?:string, anio:number, mes:number, dia:number,
 *           sexo:'H'|'M', entidadCurp?:string }} datos  entidadCurp = 'JC', 'DF', ..., 'NE';
 *           si falta, las posiciones 12-13 quedan como "**"
 * @returns {string|null} null si falta algún dato indispensable
 */
function curpPrefix({ nombre, apellidoP, apellidoM, anio, mes, dia, sexo, entidadCurp }) {
  const paterno = words(apellidoP)[0] || '';
  const materno = words(apellidoM)[0] || '';
  const name = curpGivenName(nombre);
  if (!paterno || !name || !anio || !mes || !dia || !sexo) return null;
  const entidad = entidadCurp || UNKNOWN.repeat(2);

  let letters = curpChar(paterno[0])
    + firstInternal(paterno, isVowel)
    + (materno ? curpChar(materno[0]) : 'X')
    + curpChar(name[0]);
  if (BAD_WORDS.has(letters)) letters = `${letters[0]}X${letters.slice(2)}`;

  const pad2 = (number) => String(number).padStart(2, '0');
  const date = `${pad2(anio % 100)}${pad2(mes)}${pad2(dia)}`;

  const consonants = firstInternal(paterno, isConsonant)
    + (materno ? firstInternal(materno, isConsonant) : 'X')
    + firstInternal(name, isConsonant);

  return `${letters}${date}${sexo}${entidad}${consonants}`;
}

/** ¿La CURP empieza con `prefix`? Un "*" del prefijo acepta cualquier carácter. */
function curpMatches(prefix, curp) {
  if (!prefix || !curp || curp.length < prefix.length) return false;
  return [...prefix].every((char, i) => char === UNKNOWN || char === curp[i]);
}

module.exports = { curpPrefix, curpMatches };
