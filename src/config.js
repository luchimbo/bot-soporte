/**
 * Configuración centralizada del bot de soporte
 * Todas las variables de entorno en un solo lugar
 */

require('dotenv').config();

function getEnv(key, defaultValue = null, required = false) {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(`Variable de entorno requerida no definida: ${key}`);
  }
  return value || defaultValue;
}

function getBool(key, defaultValue = false) {
  const value = process.env[key];
  if (!value) return defaultValue;
  return ['true', '1', 'yes', 'si'].includes(value.toLowerCase().trim());
}

function getNumber(key, defaultValue = 0) {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

module.exports = {
  // Servidor
  port: getNumber('PORT', 3000),
  nodeEnv: getEnv('NODE_ENV', 'development'),
  
  // WhatsApp Business API
  whatsapp: {
    verifyToken: getEnv('WHATSAPP_VERIFY_TOKEN', ''),
    accessToken: getEnv('WHATSAPP_ACCESS_TOKEN', ''),
    phoneNumberId: getEnv('WHATSAPP_PHONE_NUMBER_ID', ''),
    appSecret: getEnv('WHATSAPP_APP_SECRET', ''),
    mockSend: getBool('MOCK_WHATSAPP_SEND', false),
  },
  
  // OpenRouter / LLM
  llm: {
    apiKey: getEnv('OPENROUTER_API_KEY') || getEnv('OPENAI_API_KEY', ''),
    baseURL: getEnv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
    model: getEnv('LLM_MODEL', 'google/gemini-2.5-flash-lite'),
    simpleModel: getEnv('LLM_SIMPLE_MODEL', 'google/gemini-2.5-flash-lite'),
    complexModel: getEnv('LLM_COMPLEX_MODEL', 'deepseek/deepseek-v3.2'),
    timeoutMs: getNumber('OPENAI_TIMEOUT_MS', 30000),
  },
  
  // Redis
  redis: {
    url: getEnv('REDIS_URL', 'redis://localhost:6379'),
  },
  
  // Knowledge Base
  kb: {
    topK: getNumber('KB_TOP_K', 4),
    styleTopK: getNumber('STYLE_TOP_K', 3),
    manualTopK: getNumber('KB_MANUAL_TOP_K', 2),
  },
  
  // Catálogo de productos
  catalog: {
    filePath: getEnv('PRODUCT_CATALOG_FILE', './archivos/Productos.xlsx'),
    minMatchScore: getNumber('PRODUCT_MATCH_MIN_SCORE', 7),
  },
  
  // Playbook de soporte
  playbook: {
    filePath: getEnv('SUPPORT_PLAYBOOK_FILE', './archivos/SoporteBot.xlsx'),
  },
  
  // Rutas de archivos
  paths: {
    knowledgeBase: getEnv('KB_PATH', './data/knowledge-base.json'),
    whatsappExport: getEnv('WHATSAPP_EXPORT_PATH', './data/whatsapp-messages.csv'),
    emailExport: getEnv('EMAIL_EXPORT_PATH', './data/emails.csv'),
  },
};
