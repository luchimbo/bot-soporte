const { sendWhatsAppMessage } = require('./kapso-client');

/**
 * Escala una conversación a agente humano
 * @param {string} phoneNumber - Número del cliente
 * @param {string} reason - Razón de la escalación
 * @param {object} context - Contexto de la conversación
 */
async function escalateToHuman(phoneNumber, reason, context = {}) {
  console.log(`[Escalation] Escalando ${phoneNumber} por: ${reason}`);
  
  // 1. Enviar mensaje al cliente informando la escalación
  const escalationMessage = `Entiendo. Voy a derivarte con un agente de nuestro equipo de soporte técnico para que te ayude personalmente con ${context.productName || 'tu consulta'}.\n\nPor favor, aguardá unos minutos mientras te asignamos al mejor especialista. 🎧`;
  
  await sendWhatsAppMessage(phoneNumber, escalationMessage);
  
  // 2. Aquí podrías:
  // - Crear un ticket en Kommo (usando las credenciales que ya tenés en .env)
  // - Enviar notificación al equipo por email/Slack
  // - Llamar a un webhook de Kapso para marcar la conversación como "necesita humano"
  
  console.log(`[Escalation] Cliente ${phoneNumber} notificado`);
  
  return {
    success: true,
    escalated: true,
    reason: reason,
    timestamp: new Date().toISOString()
  };
}

/**
 * Crea un lead en Kommo para seguimiento humano
 * Requiere configurar KOMMO_SUBDOMAIN y KOMMO_LONG_LIVED_TOKEN en .env
 */
async function createKommoLead(phoneNumber, productName, issue, priority = 'normal') {
  const KOMMO_SUBDOMAIN = process.env.KOMMO_SUBDOMAIN;
  const KOMMO_TOKEN = process.env.KOMMO_LONG_LIVED_TOKEN;
  
  if (!KOMMO_SUBDOMAIN || !KOMMO_TOKEN) {
    console.log('[Kommo] Credenciales no configuradas, omitiendo creación de lead');
    return null;
  }
  
  try {
    // Aquí implementarías la llamada a la API de Kommo
    // para crear un lead/pipeline item
    console.log(`[Kommo] Creando lead para ${phoneNumber} - ${productName}`);
    
    // Ejemplo de payload para Kommo:
    const leadData = {
      name: `Soporte: ${productName || 'Consulta general'}`,
      status_id: process.env.KOMMO_STAGE_DIAGNOSIS_ID,
      pipeline_id: process.env.KOMMO_PIPELINE_ID,
      responsible_user_id: process.env.KOMMO_OWNER_ID,
      custom_fields_values: [
        {
          field_code: 'PHONE',
          values: [{ value: phoneNumber }]
        },
        {
          field_id: 'descripcion_problema',
          values: [{ value: issue }]
        }
      ]
    };
    
    // Llamada a API de Kommo (implementar según su documentación)
    // const response = await axios.post(...)
    
    return leadData;
  } catch (error) {
    console.error('[Kommo] Error creando lead:', error.message);
    return null;
  }
}

module.exports = {
  escalateToHuman,
  createKommoLead
};
