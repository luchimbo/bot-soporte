/**
 * Utilidades de texto compartidas
 * Centraliza funciones de normalización y procesamiento de texto
 */

/**
 * Normaliza texto para comparación
 * Convierte a minúsculas, elimina acentos y espacios extra
 */
function normalize(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Limpia texto de espacios y caracteres especiales
 */
function cleanText(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokeniza texto en palabras significativas
 * Ignora palabras de 1 carácter y comunes
 */
function tokenize(text) {
  const normalized = normalize(text);
  return normalized
    .split(/[^a-z0-9]+/)
    .map(token => token.trim())
    .filter(token => token.length >= 2 && !isCommonWord(token));
}

/**
 * Verifica si una palabra es común (stop word)
 */
function isCommonWord(word) {
  const commonWords = new Set([
    'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
    'de', 'del', 'al', 'y', 'o', 'con', 'por', 'para',
    'en', 'a', 'ante', 'bajo', 'desde', 'hasta', 'hacia',
    'entre', 'durante', 'mediante', 'segun', 'sobre', 'tras',
    'the', 'and', 'or', 'of', 'to', 'in', 'for', 'with',
    'que', 'cual', 'quien', 'cuando', 'donde', 'como',
    'este', 'esta', 'esto', 'ese', 'esa', 'eso', 'aquel',
    'mi', 'tu', 'su', 'nuestro', 'vuestro', 'sus',
    'es', 'son', 'fue', 'era', 'sera', 'esta', 'estan',
    'tengo', 'tiene', 'tenemos', 'tienen', 'hay',
    'muy', 'mas', 'mucho', 'poco', 'bastante', 'demasiado',
  ]);
  return commonWords.has(word.toLowerCase());
}

/**
 * Verifica si el texto es solo un saludo
 */
function isGreetingOnly(text) {
  const greetingPattern = /^(hola|buenos dias|buenas tardes|buenas noches|hey|hi|hello)(\s*[!?.]*)?$/i;
  return greetingPattern.test(text.trim());
}

/**
 * Verifica si el texto contiene un insulto o lenguaje abusivo
 */
function containsAbusiveLanguage(text) {
  const abusivePatterns = [
    /\b(estupido|idiota|inutil|mierda|mierda de|estafa|chorros|ladrones|hdp|puto|puta|concha|mierda|pelotudo|boludo|forro|garca)\b/i,
    /\b(stupid|idiot|useless|shit|scam|thieves|asshole|fucking|damn)\b/i,
  ];
  return abusivePatterns.some(pattern => pattern.test(text));
}

/**
 * Calcula coeficiente de similitud de Dice entre dos textos
 */
function diceCoefficient(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  
  const leftBigrams = getBigrams(normalize(left));
  const rightBigrams = getBigrams(normalize(right));
  
  if (leftBigrams.length === 0 || rightBigrams.length === 0) return 0;
  
  const intersection = leftBigrams.filter(bigram => 
    rightBigrams.includes(bigram)
  );
  
  return (2 * intersection.length) / (leftBigrams.length + rightBigrams.length);
}

/**
 * Genera bigramas de un texto
 */
function getBigrams(text) {
  const bigrams = [];
  for (let i = 0; i < text.length - 1; i++) {
    bigrams.push(text.substring(i, i + 2));
  }
  return bigrams;
}

/**
 * Divide texto en fragmentos por delimitadores
 */
function splitMulti(value, delimiters = /[\n|;,]+/) {
  return String(value || '')
    .split(delimiters)
    .map(item => cleanText(item))
    .filter(Boolean);
}

/**
 * Cuenta overlap entre dos arrays
 */
function countOverlap(left, right) {
  const rightSet = new Set(right);
  return left.filter(item => rightSet.has(item)).length;
}

/**
 * Extrae números de un texto
 */
function extractNumbers(text) {
  const matches = text.match(/\d+/g);
  return matches ? matches.map(Number) : [];
}

/**
 * Trunca texto a longitud máxima con ellipsis
 */
function truncate(text, maxLength = 100) {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Capitaliza primera letra de cada palabra
 */
function toTitleCase(text) {
  return text
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

module.exports = {
  normalize,
  cleanText,
  tokenize,
  isCommonWord,
  isGreetingOnly,
  containsAbusiveLanguage,
  diceCoefficient,
  getBigrams,
  splitMulti,
  countOverlap,
  extractNumbers,
  truncate,
  toTitleCase,
};
