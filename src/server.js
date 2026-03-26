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
  getAllDrumKits 
} = require('./product-kb-integration');
const { startTurn, finishTurn, getSessionStoreInfo } = require('./conversation-state');
const { getSupportPlaybookInfo } = require('./support-playbook');
const { 
  sendWhatsAppMessage, 
  getKapsoStatus, 
  markForHumanAttention 
} = require('./kapso-api');
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

async function processAssistantTurn(sessionId, userText) {
  const sessionContext = await startTurn(sessionId, userText);
  const result = await buildAssistantReply(userText, {
    sessionContext,
    sessionId,
  });

  const updatedSession = await finishTurn(
    sessionId,
    result.text,
    result.stateUpdate,
    {
      mode: result.mode,
      hits: result.hits?.length || 0,
    }
  );

  return {
    result,
    updatedSession,
  };
}

async function buildKommoBotPayload(sessionId, userText) {
  const { result, updatedSession } = await processAssistantTurn(sessionId, userText);

  return {
    ok: true,
    reply: result.text,
    mode: result.mode,
    sessionId,
    activeProduct: result.activeProduct || updatedSession.currentProduct || null,
    reportedProblem: updatedSession.reportedProblem || null,
    invoiceNumber: updatedSession.invoiceNumber || null,
    supportFlow: updatedSession.supportFlow || null,
    humanActive: Boolean(updatedSession.humanActive),
  };
}

function isKapsoPlaceholder(value) {
  return /^\s*\{\{[^}]+\}\}\s*$/.test(String(value || ''));
}

function getKapsoEventType(body) {
  return body?.event || body?.type || body?.topic || body?.trigger || body?.data?.event || null;
}

function isInboundMessageEvent(eventType, body) {
  const normalized = String(eventType || '').toLowerCase();
  if (!normalized) {
    return Boolean(body?.messages?.length || body?.message);
  }

  return normalized === 'whatsapp.message.received'
    || normalized === 'message.received'
    || normalized === 'message_received'
    || normalized === 'received';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function extractKommoSessionId(body = {}) {
  return String(
    firstNonEmpty(
      body.sessionId,
      body.contactPhone,
      body.phone,
      body.from,
      body.contact?.phone,
      body.contact?.id && `contact:${body.contact.id}`,
      body.lead?.id && `lead:${body.lead.id}`,
      body.chat_id && `chat:${body.chat_id}`
    ) || 'kommo-default'
  );
}

function extractKommoUserText(body = {}) {
  return firstNonEmpty(
    body.text,
    body.message,
    body.userText,
    body.content,
    body.messageText,
    body.lastMessage,
    body.message?.text,
    body.message?.body,
    body.payload?.text,
    body.data?.text
  );
}

function extractKommoWidgetPayload(body = {}) {
  const data = body?.data || {};
  const userText = firstNonEmpty(
    data.message,
    data.text,
    data.userText,
    data.messageText,
    body.message,
    body.text
  );

  const sessionId = String(
    firstNonEmpty(
      data.sessionId,
      data.contactPhone,
      data.phone,
      data.from,
      data.leadId && `lead:${data.leadId}`,
      data.contactId && `contact:${data.contactId}`,
      body.sessionId,
      body.contactPhone
    ) || 'kommo-widget-default'
  );

  return {
    userText,
    sessionId,
    returnUrl: String(body.return_url || '').trim(),
  };
}

function buildKommoContinuePayload(botResponse) {
  return {
    data: {
      reply: botResponse.reply,
      mode: botResponse.mode,
      sessionId: botResponse.sessionId,
      reportedProblem: botResponse.reportedProblem,
      invoiceNumber: botResponse.invoiceNumber,
      humanActive: botResponse.humanActive,
    },
    execute_handlers: [
      {
        handler: 'show',
        params: {
          type: 'text',
          value: '{{json.reply}}',
        },
      },
    ],
  };
}

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
    const eventType = getKapsoEventType(body);

    if (!isInboundMessageEvent(eventType, body)) {
      console.log(`[Webhook] Ignorando evento no entrante: ${eventType || 'unknown'}`);
      runtime.lastWebhookStatus = 'ignored_non_inbound';
      return;
    }
    
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

    if (isKapsoPlaceholder(from) || isKapsoPlaceholder(text)) {
      console.log('[Webhook] Llegaron placeholders literales desde Kapso. Revisar el mapeo del workflow/webhook payload.');
      console.log('[Webhook] from=', from, 'text=', text);
      runtime.lastWebhookStatus = 'placeholder_payload';
      runtime.lastInboundFrom = String(from);
      runtime.lastInboundPreview = String(text).slice(0, 50);
      return;
    }

    runtime.webhookEvents += 1;
    runtime.lastWebhookAt = new Date().toISOString();
    runtime.lastWebhookStatus = 'received';
    runtime.lastInboundFrom = from;
    runtime.lastInboundPreview = text.substring(0, 50);

    console.log(`[Webhook] Mensaje de ${from}: ${text.substring(0, 50)}...`);

    // Generar respuesta
    const sessionId = from;
    const { result } = await processAssistantTurn(sessionId, text);

    // Enviar respuesta por WhatsApp directamente
    if (mockSend) {
      console.log(`[Mock] Respuesta a ${from}: ${result.text.substring(0, 50)}...`);
      runtime.lastSendAt = new Date().toISOString();
      runtime.lastSendStatus = 'mock';
      runtime.lastSendTo = from;
    } else {
      try {
        if (result.mode === 'human-triage') {
          await markForHumanAttention(
            from,
            result.handoffReason || 'Escalacion automatica desde bot',
            {
              source: 'bot_flow',
              ...result.handoffMetadata,
            },
            undefined,
            result.text
          );
        } else {
          await sendWhatsAppMessage(from, result.text);
        }
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

    const payload = await buildKommoBotPayload(sessionId, userText);

    res.status(200).json(payload);
  } catch (error) {
    console.error('[Simulate] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/kommo/support', async (req, res) => {
  try {
    const body = req.body || {};
    const userText = extractKommoUserText(body);
    const sessionId = extractKommoSessionId(body);

    if (!userText) {
      return res.status(400).json({
        ok: false,
        error: 'No se encontro texto del usuario en el payload de Kommo',
      });
    }

    const payload = await buildKommoBotPayload(sessionId, userText);

    return res.status(200).json(payload);
  } catch (error) {
    console.error('[Kommo] Error procesando mensaje:', error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post('/kommo/widget-request', async (req, res) => {
  try {
    const { userText, sessionId, returnUrl } = extractKommoWidgetPayload(req.body || {});

    if (!userText) {
      return res.status(400).json({
        ok: false,
        error: 'No se encontro message/text en data para el widget de Kommo',
      });
    }

    const payload = await buildKommoBotPayload(sessionId, userText);

    if (returnUrl) {
      await require('axios').post(returnUrl, buildKommoContinuePayload(payload), {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 12000,
      });
    }

    return res.status(200).json({
      ok: true,
      delivered: Boolean(returnUrl),
      reply: payload.reply,
      mode: payload.mode,
      sessionId: payload.sessionId,
    });
  } catch (error) {
    console.error('[Kommo widget] Error procesando mensaje:', error.response?.data || error.message || error);
    return res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

// API: Escalar a humano manualmente
app.post('/api/escalate', async (req, res) => {
  try {
    const { phoneNumber, reason } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'phoneNumber es requerido'
      });
    }
    
    const result = await markForHumanAttention(
      phoneNumber, 
      reason || 'Escalación manual desde API',
      { source: 'api_manual' }
    );
    
    res.json({
      success: true,
      message: 'Conversación escalada a agente humano',
      data: result
    });
  } catch (error) {
    console.error('[API] Error escalando:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
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
