/**
 * Servidor Express para bot de soporte WhatsApp
 * Usando Kapso.ai como intermediario
 */

require('dotenv').config();

const express = require('express');
const config = require('./config');
const { buildAssistantReply } = require('./assistant');
const { getKnowledgeBaseInfo } = require('./knowledge-base');
const { getProductCatalogInfo } = require('./product-catalog');
const { startTurn, finishTurn, getSessionStoreInfo } = require('./conversation-state');
const { getSupportPlaybookInfo } = require('./support-playbook');
const { sendWhatsAppMessage, getKapsoStatus } = require('./kapso-client');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = config.port;
const mockSend = !config.whatsapp.accessToken && !process.env.KAPSO_API_KEY;

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
    const catalog = getProductCatalogInfo();
    const supportPlaybook = getSupportPlaybookInfo();
    const sessions = await getSessionStoreInfo();
    const kapso = await getKapsoStatus();

    res.status(200).json({
      ok: true,
      kapso,
      knowledgeBase: kbInfo,
      productCatalog: catalog,
      supportPlaybook,
      sessions,
      whatsapp: {
        mockSend,
        phoneNumberIdConfigured: Boolean(config.whatsapp.phoneNumberId),
      },
      runtime,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Webhook receiver de Kapso (POST)
app.post('/webhook', async (req, res) => {
  try {
    res.sendStatus(200); // Responder inmediatamente

    const body = req.body;
    
    // Kapso envía los mensajes en formato específico
    // Verificar si es un mensaje entrante
    const message = body.messages?.[0] || body.message;
    if (!message) return;

    const from = message.from || message.sender;
    const text = message.text?.body || message.text || message.content;

    if (!from || !text) return;

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
    if (mockSend) {
      console.log(`[Mock] Respuesta a ${from}: ${result.text.substring(0, 50)}...`);
      runtime.lastSendAt = new Date().toISOString();
      runtime.lastSendStatus = 'mock';
      runtime.lastSendTo = from;
    } else {
      await sendWhatsAppMessage(from, result.text);
      runtime.lastSendAt = new Date().toISOString();
      runtime.lastSendStatus = 'sent';
      runtime.lastSendTo = from;
      runtime.lastSendError = null;
    }

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

// Manejo de errores
process.on('uncaughtException', (err) => {
  console.error('[Fatal] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Fatal] Unhandled Rejection:', reason);
});

// Iniciar servidor
const server = app.listen(port, () => {
  console.log(`🚀 Servidor listo en http://localhost:${port}`);
  console.log(`📱 WhatsApp Webhook: http://localhost:${port}/webhook`);
  console.log(`🏥 Health Check: http://localhost:${port}/health`);
  console.log(`🧪 Simulación: http://localhost:${port}/simulate`);
  console.log(`\n⚙️  Modo: ${mockSend ? 'MOCK (no envía mensajes reales)' : 'KAPSO'}`);
  console.log(`📋 Usando: ${process.env.KAPSO_API_KEY ? 'Kapso.ai' : 'API de Meta directa'}`);
});

module.exports = { app, runtime };
