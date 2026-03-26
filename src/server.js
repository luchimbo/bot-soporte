/**
 * Servidor Express para bot de soporte WhatsApp
 * Usando Kapso.ai como intermediario - Modo Webhook Tradicional
 * El servidor envía respuestas directamente por WhatsApp
 */

require('dotenv').config();

const express = require('express');
const config = require('./config');
const { buildAssistantReply } = require('./assistant');
const { getKnowledgeBaseInfo } = require('./knowledge-base');
const { getProductCatalogInfo } = require('./product-catalog');
const { 
  lookupProductByModel, 
  detectDrumModel, 
  getConnectivityResponse,
  getAllDrumKits 
} = require('./product-kb-integration');
const { startTurn, finishTurn, getSessionStoreInfo } = require('./conversation-state');
const { getSupportPlaybookInfo } = require('./support-playbook');
const { sendWhatsAppMessage, getKapsoStatus } = require('./kapso-client');
const kbApiRouter = require('./routes/kb-api');
const externalApiRouter = require('./routes/external-api');
const { escalateToHuman } = require('./escalation');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api/kb', kbApiRouter);
app.use('/api/external', externalApiRouter);

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

// Webhook receiver de Kapso (POST) - Modo Tradicional
// Responde inmediatamente y envía la respuesta por WhatsApp directamente
app.post('/webhook', async (req, res) => {
  try {
    // Responder inmediatamente a Kapso
    res.sendStatus(200);

    const body = req.body;
    
    // Kapso envía los mensajes en formato específico
    const message = body.messages?.[0] || body.message;
    if (!message) {
      console.log('[Webhook] No se encontró mensaje en el body');
      return;
    }

    const from = message.from || message.sender;
    const text = message.text?.body || message.text || message.content;

    if (!from || !text) {
      console.log('[Webhook] Falta from o text');
      return;
    }

    runtime.webhookEvents += 1;
    runtime.lastWebhookAt = new Date().toISOString();
    runtime.lastWebhookStatus = 'received';
    runtime.lastInboundFrom = from;
    runtime.lastInboundPreview = text.substring(0, 50);

    console.log(`[Webhook] Mensaje de ${from}: ${text.substring(0, 50)}...`);

    // Detectar si el mensaje menciona un modelo de batería específico
    const detectedDrumModel = detectDrumModel(text);
    let kbProductInfo = null;
    
    if (detectedDrumModel) {
      console.log(`[KB] Modelo detectado: ${detectedDrumModel}`);
      kbProductInfo = lookupProductByModel(detectedDrumModel);
      if (kbProductInfo) {
        console.log(`[KB] Info encontrada para ${detectedDrumModel}`);
      }
    }

    // Generar respuesta
    const sessionId = from;
    const sessionContext = await startTurn(sessionId, text);
    
    // Si detectamos un modelo y tenemos info en KB, la agregamos al contexto
    const enhancedContext = {
      ...sessionContext,
      kbProductInfo: kbProductInfo,
      detectedDrumModel: detectedDrumModel
    };
    
    const result = await buildAssistantReply(text, {
      sessionContext: enhancedContext,
      sessionId,
    });

    await finishTurn(sessionId, result.text, result.stateUpdate, {
      mode: result.mode,
      hits: result.hits?.length || 0,
    });

    // Enviar respuesta por WhatsApp directamente
    if (mockSend) {
      console.log(`[Mock] Respuesta a ${from}: ${result.text.substring(0, 50)}...`);
      runtime.lastSendAt = new Date().toISOString();
      runtime.lastSendStatus = 'mock';
      runtime.lastSendTo = from;
    } else {
      try {
        await sendWhatsAppMessage(from, result.text);
        runtime.lastSendAt = new Date().toISOString();
        runtime.lastSendStatus = 'sent';
        runtime.lastSendTo = from;
        runtime.lastSendError = null;
        console.log(`[Webhook] Mensaje enviado a ${from}`);
      } catch (sendError) {
        console.error('[Webhook] Error enviando mensaje:', sendError);
        runtime.lastSendStatus = 'error';
        runtime.lastSendError = sendError.message;
      }
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

// API: Consultar producto por modelo
app.get('/api/product/:modelo', (req, res) => {
  try {
    const modelo = req.params.modelo;
    const info = lookupProductByModel(modelo);
    
    if (info) {
      res.json({
        success: true,
        producto: info
      });
    } else {
      res.status(404).json({
        success: false,
        error: `Producto ${modelo} no encontrado`
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: Listar todas las baterías
app.get('/api/baterias', (req, res) => {
  try {
    const baterias = getAllDrumKits();
    res.json({
      success: true,
      total: baterias.length,
      baterias: baterias
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API: Buscar productos
app.get('/api/search', (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({
        success: false,
        error: 'Parámetro q requerido'
      });
    }
    
    const { searchProducts } = require('./product-kb-integration');
    const resultados = searchProducts(q);
    
    res.json({
      success: true,
      query: q,
      total: resultados.length,
      productos: resultados.slice(0, 10)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
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
  console.log(`📦 API Productos: http://localhost:${port}/api/product/:modelo`);
  console.log(`🥁 API Baterías: http://localhost:${port}/api/baterias`);
  console.log(`🔍 API Búsqueda: http://localhost:${port}/api/search?q=termino`);
  console.log(`\n⚙️  Modo: ${mockSend ? 'MOCK (no envía mensajes reales)' : 'PRODUCCIÓN'}`);
  console.log(`📋 Usando: Webhook Tradicional (servidor envía mensajes directamente)`);
  console.log(`\n📚 Knowledge Base: 590 productos, 69 manuales, 278 FAQs`);
});

module.exports = { app, runtime };
