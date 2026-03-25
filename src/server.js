/**
 * Servidor Express para bot de soporte WhatsApp
 * Versión simplificada sin Kommo
 */

require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const config = require('./config');
const { buildAssistantReply, getLLMStatus } = require('./assistant');
const { getKnowledgeBaseInfo } = require('./knowledge-base');
const { getProductCatalogInfo } = require('./product-catalog');
const { startTurn, finishTurn, getSessionStoreInfo } = require('./conversation-state');
const { getSupportPlaybookInfo } = require('./support-playbook');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = config.port;
const mockSend = config.whatsapp.mockSend;

const runtime = {
  startedAt: new Date().toISOString(),
  webhookEvents: 0,
  lastWebhookAt: null,
  lastWebhookStatus: 'idle',
  lastInboundFrom: null,
  lastInboundPreview: null,
  lastSendAt: null,
  lastSendStatus: 'idle',
  lastSendTo: null,
  lastSendError: null,
};

// Health check
app.get('/health', async (req, res) => {
  try {
    const kbInfo = getKnowledgeBaseInfo();
    const llm = getLLMStatus();
    const catalog = getProductCatalogInfo();
    const supportPlaybook = getSupportPlaybookInfo();
    const sessions = await getSessionStoreInfo();

    res.status(200).json({
      ok: true,
      llmEnabled: llm.enabled,
      llm,
      knowledgeBase: kbInfo,
      productCatalog: catalog,
      supportPlaybook,
      sessions,
      whatsapp: {
        mockSend,
        verifyTokenConfigured: Boolean(config.whatsapp.verifyToken),
        accessTokenConfigured: Boolean(config.whatsapp.accessToken),
        phoneNumberIdConfigured: Boolean(config.whatsapp.phoneNumberId),
      },
      runtime,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Webhook verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('[Webhook] Verificación exitosa');
    res.status(200).send(challenge);
  } else {
    console.error('[Webhook] Verificación fallida');
    res.sendStatus(403);
  }
});

// Webhook receiver (POST)
app.post('/webhook', async (req, res) => {
  try {
    // Verificar firma si está configurada
    if (config.whatsapp.appSecret) {
      const signature = req.headers['x-hub-signature-256'];
      const body = JSON.stringify(req.body);
      const expected = crypto
        .createHmac('sha256', config.whatsapp.appSecret)
        .update(body)
        .digest('hex');
      
      if (signature !== `sha256=${expected}`) {
        console.error('[Webhook] Firma inválida');
        return res.sendStatus(403);
      }
    }

    res.sendStatus(200); // Responder inmediatamente

    // Procesar mensaje
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value?.messages?.length) return;

    const message = value.messages[0];
    const from = message.from;
    const text = message.text?.body || '';

    runtime.webhookEvents += 1;
    runtime.lastWebhookAt = new Date().toISOString();
    runtime.lastWebhookStatus = 'received';
    runtime.lastInboundFrom = from;
    runtime.lastInboundPreview = text.substring(0, 50);

    console.log(`[Webhook] Mensaje de ${from}: ${text.substring(0, 50)}...`);

    // Generar respuesta
    const sessionId = from;
    const sessionContext = await startTurn(sessionId, text);
    
    const result = await buildAssistantReply(text, {
      sessionContext,
      sessionId,
    });

    await finishTurn(sessionId, result.text, result.stateUpdate, {
      mode: result.mode,
      hits: result.hits?.length || 0,
    });

    // Enviar respuesta
    await sendWhatsAppMessage(from, result.text);

  } catch (error) {
    console.error('[Webhook] Error:', error);
    runtime.lastWebhookStatus = 'error';
    runtime.lastSendError = error.message;
  }
});

// Endpoint de simulación para testing
app.post('/simulate', async (req, res) => {
  try {
    const userText = req.body?.text || '';
    const sessionId = String(req.body?.sessionId || 'simulate-default');

    const sessionContext = await startTurn(sessionId, userText);
    const result = await buildAssistantReply(userText, {
      sessionContext,
      sessionId,
    });
    
    const updatedSession = await finishTurn(
      sessionId,
      result.text,
      result.stateUpdate,
      { mode: result.mode }
    );

    res.status(200).json({
      reply: result.text,
      mode: result.mode,
      sessionId,
      activeProduct: result.activeProduct || updatedSession.currentProduct || null,
    });
  } catch (error) {
    console.error('[Simulate] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Enviar mensaje por WhatsApp API
async function sendWhatsAppMessage(to, text) {
  if (mockSend) {
    console.log(`[Mock] Mensaje a ${to}: ${text.substring(0, 50)}...`);
    runtime.lastSendAt = new Date().toISOString();
    runtime.lastSendStatus = 'mock';
    runtime.lastSendTo = to;
    return { ok: true, mock: true };
  }

  try {
    const axios = require('axios');
    const url = `https://graph.facebook.com/v18.0/${config.whatsapp.phoneNumberId}/messages`;
    
    await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          'Authorization': `Bearer ${config.whatsapp.accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    runtime.lastSendAt = new Date().toISOString();
    runtime.lastSendStatus = 'sent';
    runtime.lastSendTo = to;
    runtime.lastSendError = null;

    console.log(`[WhatsApp] Mensaje enviado a ${to}`);
    return { ok: true };
  } catch (error) {
    runtime.lastSendStatus = 'error';
    runtime.lastSendError = error.message;
    console.error('[WhatsApp] Error enviando:', error.message);
    throw error;
  }
}

// Iniciar servidor
const server = app.listen(port, () => {
  console.log(`🚀 Servidor listo en http://localhost:${port}`);
  console.log(`📱 WhatsApp Webhook: http://localhost:${port}/webhook`);
  console.log(`🏥 Health Check: http://localhost:${port}/health`);
  console.log(`🧪 Simulación: http://localhost:${port}/simulate`);
  console.log(`\n⚙️  Modo: ${mockSend ? 'MOCK (no envía mensajes reales)' : 'PRODUCCIÓN'}`);
});

module.exports = { app, runtime };
