/**
 * Kapso API Integration - Complete Module
 * Handles messaging, conversations, and human handoff
 */

const axios = require('axios');

const KAPSO_API_KEY = process.env.KAPSO_API_KEY;
// Para mensajes usar el Meta proxy endpoint
const KAPSO_BASE_URL = process.env.KAPSO_API_BASE_URL || 'https://api.kapso.ai';
const PHONE_NUMBER_ID = process.env.KAPSO_PHONE_NUMBER_ID || '1062277090297627';

function isTemplatePlaceholder(value) {
  const text = String(value || '').trim();
  return /^\{\{[^}]+\}\}$/.test(text);
}

/**
 * Send WhatsApp message via Kapso API (Meta proxy)
 */
async function sendWhatsAppMessage(to, text, phoneNumberId = PHONE_NUMBER_ID) {
  try {
    if (isTemplatePlaceholder(to) || isTemplatePlaceholder(text)) {
      console.log('[Kapso] Se omitio un envio con placeholders literales.', { to, text });
      return {
        skipped: true,
        reason: 'template_placeholder',
      };
    }

    // Usar el endpoint correcto de Kapso para mensajes
    const response = await axios.post(
      `${KAPSO_BASE_URL}/meta/whatsapp/v24.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: {
          body: text
        }
      },
      {
        headers: {
          'X-API-Key': KAPSO_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`[Kapso] Mensaje enviado a ${to}:`, response.data.messages?.[0]?.id);
    return response.data;
  } catch (error) {
    console.error('[Kapso] Error enviando mensaje:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get conversation information
 */
async function getConversation(conversationId, phoneNumberId = PHONE_NUMBER_ID) {
  try {
    const response = await axios.get(
      `${KAPSO_BASE_URL}/platform/v1/phone_numbers/${phoneNumberId}/conversations/${conversationId}`,
      {
        headers: {
          'X-API-Key': KAPSO_API_KEY
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('[Kapso] Error obteniendo conversación:', error.message);
    throw error;
  }
}

/**
 * List recent conversations
 */
async function listConversations(limit = 50, phoneNumberId = PHONE_NUMBER_ID) {
  try {
    const response = await axios.get(
      `${KAPSO_BASE_URL}/platform/v1/phone_numbers/${phoneNumberId}/conversations?limit=${limit}`,
      {
        headers: {
          'X-API-Key': KAPSO_API_KEY
        }
      }
    );
    
    return response.data;
  } catch (error) {
    console.error('[Kapso] Error listando conversaciones:', error.message);
    throw error;
  }
}

/**
 * Find conversation by phone number (wa_id)
 */
async function findConversationByPhone(phoneNumber, phoneNumberId = PHONE_NUMBER_ID) {
  try {
    const conversations = await listConversations(100, phoneNumberId);
    
    // Buscar la conversación activa más reciente con ese número
    const conversation = conversations.data?.find(conv => 
      conv.contact?.wa_id === phoneNumber && 
      conv.status !== 'ended'
    );
    
    return conversation || null;
  } catch (error) {
    console.error('[Kapso] Error buscando conversación:', error.message);
    return null;
  }
}

/**
 * Mark conversation for human attention
 * Updates conversation with note/tag indicating escalation
 */
async function markForHumanAttention(phoneNumber, reason, metadata = {}, phoneNumberId = PHONE_NUMBER_ID, customMessage = null) {
  try {
    // 1. Enviar mensaje al cliente
    const handoffMessage = customMessage || (`⏸️ *Derivación a agente humano*\n\n` +
      `Voy a derivarte con uno de nuestros especialistas en soporte técnico para que te ayude personalmente.\n\n` +
      `📝 *Motivo:* ${reason}\n\n` +
      `Por favor, aguardá unos minutos mientras te asignamos al mejor agente disponible. Te responderán a la brevedad.\n\n` +
      `_Horario de atención: Lunes a Viernes de 9:00 a 14:00 hs_`);
    
    await sendWhatsAppMessage(phoneNumber, handoffMessage, phoneNumberId);
    
    // 2. Buscar la conversación activa
    const conversation = await findConversationByPhone(phoneNumber, phoneNumberId);
    
    if (conversation) {
      console.log(`[Kapso] Conversación encontrada: ${conversation.id}`);
      
      // 3. Aquí podrías actualizar la conversación con metadata
      // Nota: La API específica de update puede variar, esto es un ejemplo
      try {
        await axios.patch(
          `${KAPSO_BASE_URL}/platform/v1/phone_numbers/${phoneNumberId}/conversations/${conversation.id}`,
          {
            metadata: {
              ...conversation.metadata,
              needs_human: true,
              handoff_reason: reason,
              handoff_timestamp: new Date().toISOString(),
              ...metadata
            }
          },
          {
            headers: {
              'X-API-Key': KAPSO_API_KEY,
              'Content-Type': 'application/json'
            }
          }
        );
        console.log(`[Kapso] Conversación ${conversation.id} marcada para atención humana`);
      } catch (updateError) {
        console.log('[Kapso] No se pudo actualizar metadata (puede no ser soportado por esta versión de API)');
      }
      
      return {
        success: true,
        conversationId: conversation.id,
        phoneNumber: phoneNumber,
        reason: reason,
        escalated: true
      };
    } else {
      console.log('[Kapso] No se encontró conversación activa, pero el mensaje fue enviado');
      return {
        success: true,
        conversationId: null,
        phoneNumber: phoneNumber,
        reason: reason,
        escalated: true,
        note: 'Mensaje enviado pero no se encontró conversación para marcar'
      };
    }
  } catch (error) {
    console.error('[Kapso] Error en escalación:', error.message);
    throw error;
  }
}

/**
 * Send message from human agent (para cuando un humano toma la conversación)
 */
async function sendHumanAgentMessage(to, agentName, message, phoneNumberId = PHONE_NUMBER_ID) {
  const formattedMessage = `👤 *${agentName}* - Soporte PC MIDI\n\n${message}`;
  return sendWhatsAppMessage(to, formattedMessage, phoneNumberId);
}

/**
 * Get Kapso status
 */
async function getKapsoStatus() {
  try {
    // Para status usar el platform API
    const response = await axios.get(
      `${KAPSO_BASE_URL}/platform/v1/phone_numbers/${PHONE_NUMBER_ID}`,
      {
        headers: {
          'X-API-Key': KAPSO_API_KEY
        }
      }
    );
    
    return {
      connected: response.data?.status === 'CONNECTED',
      phoneNumber: response.data?.display_phone_number,
      status: response.data?.status
    };
  } catch (error) {
    return {
      connected: false,
      error: error.message
    };
  }
}

module.exports = {
  sendWhatsAppMessage,
  getConversation,
  listConversations,
  findConversationByPhone,
  markForHumanAttention,
  sendHumanAgentMessage,
  getKapsoStatus,
  PHONE_NUMBER_ID
};
