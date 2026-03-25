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
  const models = [
    'MD200ULTRA', 'MD200L', 'MD10L', 'MD10D', 'MD200', 'MD10',
    'ED9', 'ED9PRO', 'ED8', 'ED6', 'ED9 PRO',
    'MP200', 'DD315', 'XD8', 'XD8USB'
  ];
  
  for (const model of models) {
    if (upper.includes(model)) {
      // Normalizar nombres
      if (model === 'ED9PRO' || model === 'ED9 PRO') return 'ED9';
      if (model === 'MD200') return 'MD200ULTRA';
      if (model === 'MD10') return 'MD10L';
      return model;
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
