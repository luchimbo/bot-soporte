// Integración de Knowledge Base de Productos para el bot
const {
  obtenerInfoProducto,
  buscarProductoPorNombre,
  listarBaterias,
  formatearRespuestaProducto
} = require('./knowledge-base');

/**
 * Busca información de un producto por modelo
 * @param {string} modelo - Modelo del producto (ej: MD200ULTRA, ED9)
 * @returns {object|null} - Información del producto o null
 */
function lookupProductByModel(modelo) {
  if (!modelo) return null;
  return obtenerInfoProducto(modelo);
}

/**
 * Busca productos por término (búsqueda flexible)
 * @param {string} termino - Término de búsqueda
 * @returns {Array} - Lista de productos encontrados
 */
function searchProducts(termino) {
  if (!termino) return [];
  return buscarProductoPorNombre(termino);
}

/**
 * Obtiene información formateada para responder al cliente
 * @param {string} modelo - Modelo del producto
 * @returns {string|null} - Texto formateado o null
 */
function getFormattedProductInfo(modelo) {
  return formatearRespuestaProducto(modelo);
}

/**
 * Lista todas las baterías electrónicas disponibles
 * @returns {Array} - Lista de baterías
 */
function getAllDrumKits() {
  return listarBaterias();
}

/**
 * Detecta si el texto menciona un modelo específico de batería
 * @param {string} text - Texto del usuario
 * @returns {string|null} - Modelo detectado o null
 */
function detectDrumModel(text) {
  if (!text) return null;
  
  const upper = text.toUpperCase();
  
  // Eliminar espacios para detectar "MD200 Ultra" como "MD200ULTRA"
  const upperNoSpaces = upper.replace(/\s+/g, '');
  
  // Primero buscar con espacios eliminados (para MD200 Ultra, ED9 Pro, etc.)
  const modelsNoSpaces = [
    { pattern: 'MD200ULTRA', key: 'MD200ULTRA' },
    { pattern: 'MD200L', key: 'MD200L' },
    { pattern: 'MD10L', key: 'MD10L' },
    { pattern: 'MD10D', key: 'MD10D' },
    { pattern: 'ED9PRO', key: 'ED9' },
    { pattern: 'ED9', key: 'ED9' },
    { pattern: 'ED8', key: 'ED8' },
    { pattern: 'ED6', key: 'ED6' },
    { pattern: 'MP200', key: null }, // No tiene modelo específico
    { pattern: 'DD315', key: null },
    { pattern: 'XD8USB', key: null },
    { pattern: 'XD8', key: null }
  ];
  
  for (const { pattern, key } of modelsNoSpaces) {
    if (upperNoSpaces.includes(pattern)) {
      return key || pattern;
    }
  }
  
  // Si no encontró, buscar con expresiones regulares más flexibles
  // Esto captura "MD 200", "MD-200", etc.
  const flexiblePatterns = [
    { regex: /\bMD[\s-]?200[\s-]?ULTRA\b/i, key: 'MD200ULTRA' },
    { regex: /\bMD[\s-]?200[\s-]?L\b/i, key: 'MD200L' },
    { regex: /\bMD[\s-]?10[\s-]?L\b/i, key: 'MD10L' },
    { regex: /\bMD[\s-]?10[\s-]?D\b/i, key: 'MD10D' },
    { regex: /\bED[\s-]?9[\s-]?PRO\b/i, key: 'ED9' },
    { regex: /\bED[\s-]?9\b/i, key: 'ED9' },
    { regex: /\bED[\s-]?8\b/i, key: 'ED8' },
    { regex: /\bED[\s-]?6\b/i, key: 'ED6' }
  ];
  
  for (const { regex, key } of flexiblePatterns) {
    if (regex.test(text)) {
      return key;
    }
  }
  
  return null;
}

/**
 * Genera una respuesta sobre conectividad de un producto
 * @param {string} modelo - Modelo del producto
 * @returns {string|null} - Respuesta formateada
 */
function getConnectivityResponse(modelo) {
  const info = lookupProductByModel(modelo);
  if (!info) return null;
  
  return `📦 ${info.nombre}\n\n` +
         `🔌 **Conectividad:** ${info.conectividad}\n` +
         `💿 **Drivers:** ${info.requiere_drivers}\n\n` +
         (info.tiene_manuales ? `📚 Tiene ${info.manuales.length} manual(es) disponible(s).` : '');
}

/**
 * Verifica si hay manual disponible para un modelo
 * @param {string} modelo - Modelo del producto
 * @returns {boolean} - True si tiene manual
 */
function hasManualAvailable(modelo) {
  const info = lookupProductByModel(modelo);
  return info && info.tiene_manuales;
}

module.exports = {
  lookupProductByModel,
  searchProducts,
  getFormattedProductInfo,
  getAllDrumKits,
  detectDrumModel,
  getConnectivityResponse,
  hasManualAvailable
};
