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

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API routes
app.use('/api/kb', kbApiRouter);

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

// Webhook receiver de Kapso (POST) - Modo Flujo Explícito
// Devuelve la respuesta en el body para que Kapso la muestre en el flujo
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;
    
    // LOG para diagnóstico
    console.log('[Webhook] Body recibido:', JSON.stringify(body, null, 2));
    
    // Intentar extraer el mensaje de diferentes formatos posibles
    let from = null;
    let text = null;
    
    // Formato 1: body.message.from (formato que enviamos desde Kapso)
    if (body.message?.from) {
      from = body.message.from;
      text = body.message.text?.body || body.message.text;
    }
    // Formato 2: body.messages[0] (formato de webhook tradicional)
    else if (body.messages?.[0]) {
      from = body.messages[0].from;
      text = body.messages[0].text?.body;
    }
    // Formato 3: body.from y body.text directo (por si acaso)
    else if (body.from && (body.text || body.content)) {
      from = body.from;
      text = body.text || body.content;
    }
    // Formato 4: body.user_response (variable de Kapso)
    else if (body.user_response) {
      from = body.phone_number_id || 'unknown';
      text = body.user_response;
    }

    if (!from || !text) {
      console.error('[Webhook] No se pudo extraer from o text del body:', body);
      return res.status(400).json({ 
        error: 'Missing from or text',
        received: body 
      });
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

    // Log de la respuesta
    console.log(`[Webhook] Respuesta generada: ${result.text.substring(0, 50)}...`);
    runtime.lastSendAt = new Date().toISOString();
    runtime.lastSendStatus = 'flow-response';
    runtime.lastSendTo = from;

    // Devolver la respuesta en el body para el flujo de Kapso
    res.status(200).json({
      reply: result.text,
      mode: result.mode,
      activeProduct: result.activeProduct || null,
      detectedProduct: result.detectedProduct || null,
      kbProductInfo: kbProductInfo,
      detectedDrumModel: detectedDrumModel,
      sessionId: sessionId
    });

  } catch (error) {
    console.error('[Webhook] Error:', error);
    runtime.lastWebhookStatus = 'error';
    runtime.lastSendError = error.message;
    
    // Devolver error en formato JSON para que el flujo lo maneje
    res.status(500).json({
      reply: 'Lo siento, hubo un error procesando tu mensaje. Por favor, intentá de nuevo en unos momentos.',
      mode: 'error',
      error: error.message
    });
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
  console.log(`\n⚙️  Modo: ${mockSend ? 'MOCK (no envía mensajes reales)' : 'KAPSO'}`);
  console.log(`📋 Usando: ${process.env.KAPSO_API_KEY ? 'Kapso.ai' : 'API de Meta directa'}`);
  console.log(`\n📚 Knowledge Base: 590 productos, 69 manuales, 278 FAQs`);
});

module.exports = { app, runtime };
