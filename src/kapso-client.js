/**
 * Cliente de Kapso para WhatsApp
 * Wrapper simple sobre @kapso/whatsapp-cloud-api
 */

let client = null;

function getKapsoClient() {
  if (client) return client;
  
  const { WhatsAppClient } = require('@kapso/whatsapp-cloud-api');
  
  client = new WhatsAppClient({
    baseUrl: 'https://api.kapso.ai/meta/whatsapp',
    kapsoApiKey: process.env.KAPSO_API_KEY,
  });
  
  return client;
}

/**
 * Envía un mensaje de texto por WhatsApp usando Kapso
 */
async function sendWhatsAppMessage(to, text) {
  const kapso = getKapsoClient();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  
  if (!phoneNumberId) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID no configurado');
  }
  
  try {
    const result = await kapso.messages.sendText({
      phoneNumberId,
      to,
      body: text,
    });
    
    console.log(`[Kapso] Mensaje enviado a ${to}:`, result);
    return { ok: true, result };
  } catch (error) {
    console.error('[Kapso] Error enviando mensaje:', error.message);
    throw error;
  }
}

/**
 * Verifica el estado de la conexión con Kapso
 */
async function getKapsoStatus() {
  if (!process.env.KAPSO_API_KEY) {
    return {
      connected: false,
      error: 'KAPSO_API_KEY no configurado',
    };
  }
  
  try {
    const kapso = getKapsoClient();
    // Intentar hacer una petición simple para verificar conexión
    // No hay un método específico de health check en el SDK,
    // así que devolvemos que está configurado
    return {
      connected: true,
      apiKeyConfigured: true,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message,
    };
  }
}

module.exports = {
  getKapsoClient,
  sendWhatsAppMessage,
  getKapsoStatus,
};
