const axios = require('axios');

const KAPSO_API_KEY = process.env.KAPSO_API_KEY;
const KAPSO_BASE_URL = 'https://api.kapso.ai/platform/v1';

/**
 * Dispara un flujo de Kapso programáticamente
 * Útil para: escalación a humano, envío de templates, etc.
 */
async function triggerKapsoWorkflow(phoneNumberId, workflowId, variables = {}) {
  try {
    const response = await axios.post(
      `${KAPSO_BASE_URL}/phone_numbers/${phoneNumberId}/workflows/${workflowId}/trigger`,
      {
        variables: variables
      },
      {
        headers: {
          'X-API-Key': KAPSO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`[Kapso] Workflow ${workflowId} disparado para ${phoneNumberId}`);
    return response.data;
  } catch (error) {
    console.error('[Kapso] Error disparando workflow:', error.message);
    throw error;
  }
}

/**
 * Envía un mensaje usando un template de Kapso
 * Útil para mensajes fuera de la ventana de 24h
 */
async function sendTemplateMessage(phoneNumberId, to, templateName, language = 'es', components = []) {
  try {
    const response = await axios.post(
      `${KAPSO_BASE_URL}/phone_numbers/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: language
          },
          components: components
        }
      },
      {
        headers: {
          'X-API-Key': KAPSO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('[Kapso] Error enviando template:', error.message);
    throw error;
  }
}

/**
 * Marca una conversación para atención humana
 * Asigna la conversación a un agente específico
 */
async function assignToAgent(phoneNumberId, conversationId, agentId) {
  try {
    const response = await axios.post(
      `${KAPSO_BASE_URL}/conversations/${conversationId}/assign`,
      {
        assignee_id: agentId,
        reason: 'Escalación desde bot automático'
      },
      {
        headers: {
          'X-API-Key': KAPSO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`[Kapso] Conversación ${conversationId} asignada a agente ${agentId}`);
    return response.data;
  } catch (error) {
    console.error('[Kapso] Error asignando conversación:', error.message);
    throw error;
  }
}

module.exports = {
  triggerKapsoWorkflow,
  sendTemplateMessage,
  assignToAgent
};
