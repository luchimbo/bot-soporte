require("dotenv").config();

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const { buildAssistantReply, getLLMStatus } = require("./assistant");
const { getKnowledgeBaseInfo } = require("./knowledge-base");
const { getProductCatalogInfo } = require("./product-catalog");
const {
  startTurn,
  finishTurn,
  updateSessionMetadata,
  getSessionStoreInfo,
  resetSession,
} = require("./conversation-state");
const { syncKommoTurn, getKommoStatus, launchKommoSalesbot } = require("./kommo-client");
const { claimKommoIncomingMessage } = require("./kommo-webhook-dedupe");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const port = process.env.PORT || 3000;
const inlineKommoWidgetProcessing = shouldProcessKommoWidgetInline();
const mockSend = process.env.MOCK_WHATSAPP_SEND === "true";
const kommoSyncOnSimulate = String(process.env.KOMMO_SYNC_ON_SIMULATE || "false")
  .trim()
  .toLowerCase() === "true";
const kommoWidgetEndpointEnabled = String(process.env.KOMMO_WIDGET_ENDPOINT_ENABLED || "true")
  .trim()
  .toLowerCase() === "true";
const kommoIncomingWebhookEnabled = String(process.env.KOMMO_INCOMING_WEBHOOK_ENABLED || "false")
  .trim()
  .toLowerCase() === "true";
const kommoIncomingWebhookSecret = String(process.env.KOMMO_INCOMING_WEBHOOK_SECRET || "").trim();
const kommoWidgetVerifyToken = String(process.env.KOMMO_WIDGET_VERIFY_TOKEN || "false")
  .trim()
  .toLowerCase() === "true";
const kommoWidgetSecret = String(process.env.KOMMO_WIDGET_SECRET || "").trim();
const kommoWidgetContinueTimeoutMs = Number(process.env.KOMMO_WIDGET_CONTINUE_TIMEOUT_MS || 12000);
const kommoLongLivedToken = String(process.env.KOMMO_LONG_LIVED_TOKEN || "").trim();
const kommoWidgetShowTextLimit = 80;
const kommoWidgetMaxExecuteHandlers = 10;

const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

const runtime = {
  startedAt: new Date().toISOString(),
  webhookEvents: 0,
  lastWebhookAt: null,
  lastWebhookStatus: "idle",
  lastInboundFrom: null,
  lastInboundPreview: null,
  lastSendAt: null,
  lastSendStatus: "idle",
  lastSendTo: null,
  lastSendError: null,
  kommoWidgetEvents: 0,
  lastKommoWidgetAt: null,
  lastKommoWidgetStatus: "idle",
  lastKommoWidgetError: null,
  kommoIncomingWebhookEvents: 0,
  lastKommoIncomingWebhookAt: null,
  lastKommoIncomingWebhookStatus: "idle",
  lastKommoIncomingWebhookError: null,
};

app.get(
  "/health",
  asyncRoute(async (_, res) => {
    const kbInfo = getKnowledgeBaseInfo();
    const llm = getLLMStatus();
    const catalog = getProductCatalogInfo();
    const sessions = await getSessionStoreInfo();
    const whatsapp = {
      mockSend,
      verifyTokenConfigured: Boolean(verifyToken),
      accessTokenConfigured: Boolean(accessToken),
      phoneNumberIdConfigured: Boolean(phoneNumberId),
    };
    const kommo = getKommoStatus();

    res.status(200).json({
      ok: true,
      llmEnabled: llm.enabled,
      openAIEnabled: llm.enabled,
      llm,
      knowledgeBase: kbInfo,
      productCatalog: catalog,
      sessions,
      whatsapp,
      kommo,
      runtime,
    });
  })
);

app.post(
  "/kommo/incoming-message",
  asyncRoute(async (req, res) => {
    try {
      if (!kommoIncomingWebhookEnabled) {
        return res.sendStatus(404);
      }

      runtime.kommoIncomingWebhookEvents += 1;
      runtime.lastKommoIncomingWebhookAt = new Date().toISOString();
      runtime.lastKommoIncomingWebhookStatus = "received";

      if (!isKommoIncomingWebhookAuthorized(req)) {
        runtime.lastKommoIncomingWebhookStatus = "forbidden";
        runtime.lastKommoIncomingWebhookError = "invalid-webhook-secret";
        return res.sendStatus(403);
      }

      const messageEvent = extractKommoIncomingMessageEvent(req.body || {});
      if (!messageEvent) {
        runtime.lastKommoIncomingWebhookStatus = "ignored-no-message";
        runtime.lastKommoIncomingWebhookError = null;
        return res.sendStatus(200);
      }

      const claimed = await claimKommoIncomingMessage(messageEvent.messageId);
      if (!claimed) {
        runtime.lastKommoIncomingWebhookStatus = "duplicate";
        runtime.lastKommoIncomingWebhookError = null;
        return res.sendStatus(200);
      }

      await launchKommoSalesbot({
        entityId: messageEvent.entityId,
        entityType: messageEvent.entityType,
      });

      runtime.lastKommoIncomingWebhookStatus = "salesbot-launched";
      runtime.lastKommoIncomingWebhookError = null;
      return res.sendStatus(200);
    } catch (error) {
      runtime.lastKommoIncomingWebhookStatus = "error";
      runtime.lastKommoIncomingWebhookError = formatKommoError(error);
      throw error;
    }
  })
);

app.post(
  "/simulate",
  asyncRoute(async (req, res) => {
    const userText = req.body?.text || "";
    const sessionId = String(req.body?.sessionId || "simulate-default");
    if (req.body?.resetSession === true) {
      await resetSession(sessionId);
    }

    if (isSessionResetCommand(userText)) {
      await resetSession(sessionId);
      return res.status(200).json({
        reply: buildSessionResetReply(),
        mode: "session-reset",
        hits: 0,
        styleHits: 0,
        sessionId,
        activeProduct: null,
        pendingProductSwitch: null,
        escalate: false,
        kommo: null,
      });
    }

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
        hits: result.hits.length,
        styleHits: (result.styleExamples || []).length,
      }
    );

    const turnAnalysis = buildTurnAnalysis({
      userText,
      result,
      sessionSnapshot: updatedSession,
    });

    let kommo = null;
    if (kommoSyncOnSimulate) {
      try {
        const kommoResult = await syncKommoTurn({
          sessionContext: updatedSession,
          phone: sessionId,
          userText,
          assistantText: result.text,
          assistantMode: result.mode,
          activeProduct: result.activeProduct || updatedSession.currentProduct || null,
          intent: result.stateUpdate?.lastIntent || updatedSession.lastIntent,
          hits: result.hits.length,
          styleHits: (result.styleExamples || []).length,
          orderNumber: turnAnalysis.orderNumber,
          marketplaceUser: turnAnalysis.marketplaceUser,
          urgency: turnAnalysis.urgency,
          escalate: turnAnalysis.escalate,
          attempts: turnAnalysis.attempts,
          sourceLabel: "WhatsApp",
        });

        kommo = kommoResult;
        if (kommoResult?.ok) {
          await updateSessionMetadata(sessionId, {
            kommoContactId: kommoResult.contactId,
            kommoLeadId: kommoResult.leadId,
          });
        }
      } catch (error) {
        const message = formatKommoError(error);
        kommo = {
          ok: false,
          error: message,
        };
        console.error("Kommo sync error (simulate):", message);
      }
    }

    return res.status(200).json({
      reply: result.text,
      mode: result.mode,
      hits: result.hits.length,
      styleHits: (result.styleExamples || []).length,
      sessionId,
      activeProduct: result.activeProduct || updatedSession.currentProduct || null,
      pendingProductSwitch: updatedSession.pendingProductSwitch || null,
      escalate: turnAnalysis.escalate,
      kommo,
    });
  })
);

app.post(
  "/kommo/widget-request",
  asyncRoute(async (req, res) => {
    if (!kommoWidgetEndpointEnabled) {
      return res.sendStatus(404);
    }

    const payload = req.body || {};
    runtime.kommoWidgetEvents += 1;
    runtime.lastKommoWidgetAt = new Date().toISOString();
    runtime.lastKommoWidgetStatus = "received";

    if (inlineKommoWidgetProcessing) {
      await processKommoWidgetPayload(payload);
      return res.sendStatus(200);
    }

    res.sendStatus(200);

    setImmediate(() => {
      void processKommoWidgetPayload(payload);
    });
  })
);

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post(
  "/webhook",
  asyncRoute(async (req, res) => {
    try {
      runtime.webhookEvents += 1;
      runtime.lastWebhookAt = new Date().toISOString();
      runtime.lastWebhookStatus = "received";

      console.log("Evento webhook recibido");
      const message = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message) {
        console.log("Evento sin mensaje de usuario");
        runtime.lastWebhookStatus = "ignored-no-message";
        return res.sendStatus(200);
      }

      const from = message.from;
      const userText = message.text?.body || "";
      runtime.lastInboundFrom = from || null;
      runtime.lastInboundPreview = String(userText || "").slice(0, 140) || null;

      if (!userText) {
        console.log("Mensaje sin texto, no se responde automaticamente");
        runtime.lastWebhookStatus = "ignored-non-text";
        return res.sendStatus(200);
      }

      if (isSessionResetCommand(userText)) {
        await resetSession(from);
        await sendWhatsAppText({
          to: from,
          body: buildSessionResetReply(),
          runtime,
        });
        runtime.lastWebhookStatus = "session-reset";
        return res.sendStatus(200);
      }

      console.log(`Mensaje de ${from}: ${userText}`);
      const sessionContext = await startTurn(from, userText);
      const result = await buildAssistantReply(userText, {
        sessionContext,
        sessionId: from,
      });
      const replyText = result.text;

      await sendWhatsAppText({ to: from, body: replyText, runtime });
      const updatedSession = await finishTurn(from, replyText, result.stateUpdate, {
        mode: result.mode,
        hits: result.hits.length,
        styleHits: (result.styleExamples || []).length,
      });

      const turnAnalysis = buildTurnAnalysis({
        userText,
        result,
        sessionSnapshot: updatedSession,
      });

      try {
        const kommoResult = await syncKommoTurn({
          sessionContext: updatedSession,
          phone: from,
          userText,
          assistantText: replyText,
          assistantMode: result.mode,
          activeProduct: result.activeProduct || updatedSession.currentProduct || null,
          intent: result.stateUpdate?.lastIntent || updatedSession.lastIntent,
          hits: result.hits.length,
          styleHits: (result.styleExamples || []).length,
          orderNumber: turnAnalysis.orderNumber,
          marketplaceUser: turnAnalysis.marketplaceUser,
          urgency: turnAnalysis.urgency,
          escalate: turnAnalysis.escalate,
          attempts: turnAnalysis.attempts,
          sourceLabel: "WhatsApp",
        });

        if (kommoResult?.ok) {
          await updateSessionMetadata(from, {
            kommoContactId: kommoResult.contactId,
            kommoLeadId: kommoResult.leadId,
          });
        }

        if (!kommoResult?.skipped) {
          console.log(
            `Kommo sync | ok=${Boolean(kommoResult?.ok)} | lead=${kommoResult?.leadId || "n/a"} | contact=${kommoResult?.contactId || "n/a"}`
          );
        }
      } catch (kommoError) {
        console.error("Kommo sync error:", formatKommoError(kommoError));
      }

      runtime.lastWebhookStatus = "replied";

      console.log(
        `Respuesta enviada a ${from} | modo=${result.mode} | hits=${result.hits.length} | styleHits=${(result.styleExamples || []).length} | producto=${updatedSession.currentProduct?.name || "none"}`
      );
      return res.sendStatus(200);
    } catch (error) {
      const msg = formatWhatsAppError(error);
      console.error("Webhook error:", msg);
      runtime.lastWebhookStatus = "error";
      runtime.lastSendStatus = "error";
      runtime.lastSendError = typeof msg === "string" ? msg : JSON.stringify(msg);
      return res.sendStatus(200);
    }
  })
);

app.use((error, _req, res, next) => {
  console.error("App error:", formatKommoError(error));
  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({
    ok: false,
    error: "internal_error",
  });
});

async function processKommoWidgetPayload(payload) {
  try {
    await handleKommoWidgetRequest(payload);
    runtime.lastKommoWidgetStatus = "replied";
    runtime.lastKommoWidgetError = null;
  } catch (error) {
    runtime.lastKommoWidgetStatus = "error";
    runtime.lastKommoWidgetError = formatKommoError(error);
    console.error("Kommo widget error:", formatKommoError(error));
  }
}

async function handleKommoWidgetRequest(payload) {
  const token = String(payload?.token || "").trim();
  const data = payload?.data || {};
  const returnUrl = String(payload?.return_url || "").trim();
  const renderMode = String(data?.render_mode || payload?.render_mode || "").trim();

  if (kommoWidgetVerifyToken) {
    if (!kommoWidgetSecret) {
      throw new Error("KOMMO_WIDGET_VERIFY_TOKEN=true pero falta KOMMO_WIDGET_SECRET");
    }

    if (!token) {
      throw new Error("Widget request sin token JWT");
    }

    if (!verifyKommoJwt(token, kommoWidgetSecret)) {
      throw new Error("Token JWT de Kommo invalido");
    }
  }

  const userText = extractKommoIncomingText(data);
  const leadId = parseNumericId(data.lead_id || data.lead || data.entity_id);
  const contactId = parseNumericId(data.contact_id || data.contact);
  const phone = String(
    data.phone || data.contact_phone || data.from_phone || data.whatsapp || data.phone_number || ""
  ).trim();
  const sessionId = buildKommoSessionId({ leadId, contactId, data });

  if (isSessionResetCommand(userText)) {
    await resetSession(sessionId);
    await sendKommoWidgetContinue(returnUrl, {
      data: {
        status: "session-reset",
      },
      execute_handlers: [
        {
          handler: "show",
          params: {
            type: "text",
            value: buildSessionResetReply(),
          },
        },
        buildKommoFinishHandler(),
      ],
    });
    return;
  }

  if (leadId || contactId) {
    await updateSessionMetadata(sessionId, {
      kommoLeadId: leadId || null,
      kommoContactId: contactId || null,
    });
  }

  if (!userText) {
    await sendKommoWidgetContinue(returnUrl, {
      data: {
        status: "ignored-empty",
      },
      execute_handlers: [
        {
          handler: "show",
          params: {
            type: "text",
            value: "No recibi texto del cliente. Decime el problema y te ayudo.",
          },
        },
        buildKommoFinishHandler(),
      ],
    });
    return;
  }

  const sessionContext = await startTurn(sessionId, userText);
  const result = await buildAssistantReply(userText, {
    sessionContext,
    sessionId,
  });

  const updatedSession = await finishTurn(sessionId, result.text, result.stateUpdate, {
    mode: result.mode,
    hits: result.hits.length,
    styleHits: (result.styleExamples || []).length,
  });

  const turnAnalysis = buildTurnAnalysis({
    userText,
    result,
    sessionSnapshot: updatedSession,
  });

  try {
    const kommoSync = await syncKommoTurn({
      sessionContext: updatedSession,
      phone,
      userText,
      assistantText: result.text,
      assistantMode: result.mode,
      activeProduct: result.activeProduct || updatedSession.currentProduct || null,
      intent: result.stateUpdate?.lastIntent || updatedSession.lastIntent,
      hits: result.hits.length,
      styleHits: (result.styleExamples || []).length,
      orderNumber: turnAnalysis.orderNumber,
      marketplaceUser: turnAnalysis.marketplaceUser,
      urgency: turnAnalysis.urgency,
      escalate: turnAnalysis.escalate,
      attempts: turnAnalysis.attempts,
      sourceLabel: "Kommo",
      kommoLeadId: leadId,
      kommoContactId: contactId,
    });

    if (kommoSync?.ok) {
      await updateSessionMetadata(sessionId, {
        kommoContactId: kommoSync.contactId,
        kommoLeadId: kommoSync.leadId,
      });
    }
  } catch (kommoError) {
    console.error("Kommo sync error (widget):", formatKommoError(kommoError));
  }

  await sendKommoWidgetContinue(
    returnUrl,
    buildKommoWidgetReturnPayload({
      replyText: result.text,
      mode: result.mode,
      intent: result.stateUpdate?.lastIntent || updatedSession.lastIntent,
      activeProduct: result.activeProduct || updatedSession.currentProduct || null,
      escalate: turnAnalysis.escalate,
      attempts: turnAnalysis.attempts,
      renderMode,
    })
  );
}

function buildKommoWidgetReturnPayload({
  replyText,
  mode,
  intent,
  activeProduct,
  escalate,
  attempts,
  renderMode,
}) {
  const trimmedReply = limitText(String(replyText || ""), 3900);

  if (renderMode === "salesbot_show") {
    return {
      data: {
        status: "ok",
        mode: String(mode || "unknown"),
        intent: String(intent || "consulta_general"),
        product: String(activeProduct?.name || ""),
        escalate: escalate ? "1" : "0",
        attempts: String(Number(attempts || 0)),
        message: trimmedReply,
        reply: trimmedReply,
      },
    };
  }

  const executeHandlers = buildKommoShowTextHandlers(
    trimmedReply,
    escalate ? kommoWidgetMaxExecuteHandlers - 1 : kommoWidgetMaxExecuteHandlers
  );

  if (escalate) {
    executeHandlers.push({
      handler: "show",
      params: {
        type: "text",
        value: "Te paso con una persona. Ya comparti el contexto del caso.",
      },
    });
  }

  executeHandlers.push(buildKommoFinishHandler());

  return {
    data: {
      status: "ok",
      mode: String(mode || "unknown"),
      intent: String(intent || "consulta_general"),
      product: String(activeProduct?.name || ""),
      escalate: escalate ? "1" : "0",
      attempts: String(Number(attempts || 0)),
      message: trimmedReply,
      reply: trimmedReply,
    },
    execute_handlers: executeHandlers,
  };
}

function buildKommoShowTextHandlers(text, maxHandlers) {
  return splitKommoReplyText(text, kommoWidgetShowTextLimit, maxHandlers).map((chunk) => ({
    handler: "show",
    params: {
      type: "text",
      value: chunk,
    },
  }));
}

function buildKommoFinishHandler() {
  return {
    handler: "goto",
    params: {
      type: "finish",
      step: 1,
    },
  };
}

function splitKommoReplyText(text, maxLength, maxChunks) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return ["No pude generar una respuesta."];
  }

  const chunks = [];
  let remaining = normalized;

  while (remaining && chunks.length < maxChunks) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      remaining = "";
      break;
    }

    let splitAt = remaining.lastIndexOf(" ", maxLength);
    if (splitAt < Math.floor(maxLength * 0.5)) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining && chunks.length > 0) {
    const suffix = "...";
    const lastIndex = chunks.length - 1;
    const allowedLength = Math.max(maxLength - suffix.length, 1);
    chunks[lastIndex] = `${chunks[lastIndex].slice(0, allowedLength).trimEnd()}${suffix}`;
  }

  return chunks.filter(Boolean);
}

async function sendKommoWidgetContinue(returnUrl, payload) {
  if (!returnUrl) {
    throw new Error("Widget request sin return_url");
  }

  if (!kommoLongLivedToken) {
    throw new Error("Widget request sin KOMMO_LONG_LIVED_TOKEN para confirmar el bloque");
  }

  await axios.post(returnUrl, payload, {
    headers: {
      Authorization: `Bearer ${kommoLongLivedToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: kommoWidgetContinueTimeoutMs,
  });
}

async function sendWhatsAppText({ to, body, runtime }) {
  if (mockSend) {
    console.log(`[MOCK] Mensaje a ${to}: ${body}`);
    if (runtime) {
      runtime.lastSendAt = new Date().toISOString();
      runtime.lastSendStatus = "mock";
      runtime.lastSendTo = to;
      runtime.lastSendError = null;
    }
    return;
  }

  if (!accessToken || !phoneNumberId) {
    throw new Error("Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID");
  }

  const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;

  const recipients = buildRecipientCandidates(to);
  let lastError;

  for (const recipient of recipients) {
    try {
      await axios.post(
        url,
        {
          messaging_product: "whatsapp",
          to: recipient,
          type: "text",
          text: { body },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          timeout: 15000,
        }
      );

      if (recipient !== to) {
        console.log(`Envio con formato alternativo: ${recipient}`);
      }

      if (runtime) {
        runtime.lastSendAt = new Date().toISOString();
        runtime.lastSendStatus = "ok";
        runtime.lastSendTo = recipient;
        runtime.lastSendError = null;
      }
      return;
    } catch (error) {
      lastError = error;
      const code = error.response?.data?.error?.code;
      const hasMoreCandidates = recipient !== recipients[recipients.length - 1];

      if (code === 131030 && hasMoreCandidates) {
        continue;
      }

      if (runtime) {
        runtime.lastSendAt = new Date().toISOString();
        runtime.lastSendStatus = "error";
        runtime.lastSendTo = recipient;
        runtime.lastSendError = formatWhatsAppError(error);
      }

      throw error;
    }
  }

  throw lastError;
}

function buildRecipientCandidates(rawTo) {
  const to = String(rawTo || "").replace(/\D/g, "");
  const candidates = [to];

  if (/^549\d+$/.test(to)) {
    candidates.push(`54${to.slice(3)}`);
  }

  return [...new Set(candidates)];
}

function buildTurnAnalysis({ userText, result, sessionSnapshot }) {
  const intent = result?.stateUpdate?.lastIntent || sessionSnapshot?.lastIntent || "consulta_general";
  const normalizedText = normalizeText(userText);
  const greetingOnly = isGreetingOnlyText(normalizedText);
  const orderNumber =
    extractOrderNumber(userText) || extractLastUserMatch(sessionSnapshot, extractOrderNumber) || null;
  const marketplaceUser =
    extractMarketplaceUser(userText) ||
    extractLastUserMatch(sessionSnapshot, extractMarketplaceUser) ||
    null;
  const attempts = countDiagnosticAttempts(sessionSnapshot);

  const explicitHumanRequest =
    /(hablar|pasame|pasar|quiero|prefiero).*(representante|asesor|humano|persona|ivan)/.test(
      normalizedText
    ) || /representante|asesor|humano|persona|ivan/.test(normalizedText);
  const warrantySignal =
    !greetingOnly &&
    (/garanti|rma|reemplazo|devolucion|reembolso|falla fisica|defecto/.test(normalizedText) ||
      intent === "devolucion");
  const unresolvedSignal =
    /sigue igual|no funcion|no sirve|continua igual|todavia no|aun no|no se solucion/.test(
      normalizedText
    );

  const escalate =
    !greetingOnly && (explicitHumanRequest || warrantySignal || (unresolvedSignal && attempts >= 2));
  const urgency = detectUrgency(normalizedText, escalate);

  return {
    intent,
    orderNumber,
    marketplaceUser,
    attempts,
    escalate,
    urgency,
  };
}

function countDiagnosticAttempts(sessionSnapshot) {
  const history = Array.isArray(sessionSnapshot?.messageHistory) ? sessionSnapshot.messageHistory : [];
  let attempts = 0;
  for (const message of history) {
    if (message?.role !== "assistant") {
      continue;
    }

    if (isDiagnosticMode(message?.meta?.mode)) {
      attempts += 1;
    }
  }

  return attempts;
}

function isDiagnosticMode(mode) {
  return [
    "ai-rag",
    "context-followup",
    "fallback-product-drift",
    "fallback-no-kb-hits",
    "fallback-no-llm-key",
    "fallback-llm-error",
  ].includes(String(mode || ""));
}

function extractOrderNumber(text) {
  const value = String(text || "");
  const explicitMatch = value.match(/(?:orden|pedido|order|compra)\s*(?:n(?:ro)?\.?|numero|#|:|-)?\s*([a-z0-9-]{4,})/i);
  if (explicitMatch?.[1]) {
    return explicitMatch[1].trim();
  }

  return null;
}

function extractMarketplaceUser(text) {
  const value = String(text || "");
  const match = value.match(
    /(?:usuario\s*(?:ml|mercado\s*libre)?|ml|mercado\s*libre)\s*(?:es|:|#|-)?\s*([a-z0-9._-]{3,})/i
  );
  if (!match?.[1]) {
    return null;
  }

  const candidate = match[1].trim();
  if (/^(si|no|hola|gracias)$/i.test(candidate)) {
    return null;
  }

  return candidate;
}

function detectUrgency(normalizedText, escalate) {
  if (/urgente|urgencia|hoy|ya|cuanto antes|enojad|molest|reclamo/.test(normalizedText)) {
    return "alta";
  }

  if (escalate) {
    return "media";
  }

  return "normal";
}

function extractLastUserMatch(sessionSnapshot, extractor) {
  const history = Array.isArray(sessionSnapshot?.messageHistory) ? sessionSnapshot.messageHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== "user") {
      continue;
    }

    const value = extractor(message?.text || "");
    if (value) {
      return value;
    }
  }

  return null;
}

function extractKommoIncomingText(data) {
  const candidates = [
    data?.message,
    data?.message_text,
    data?.text,
    data?.body,
    data?.incoming_text,
    data?.msg,
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value) {
      return value;
    }
  }

  return "";
}

function buildKommoSessionId({ leadId, contactId, data }) {
  const talkId = data?.talk_id || data?.talkId || data?.chat_id || data?.chatId || null;
  if (leadId) {
    return `kommo-lead-${leadId}`;
  }

  if (contactId) {
    return `kommo-contact-${contactId}`;
  }

  if (talkId) {
    return `kommo-talk-${talkId}`;
  }

  const hash = crypto
    .createHash("sha1")
    .update(JSON.stringify(data || {}))
    .digest("hex")
    .slice(0, 12);

  return `kommo-anon-${hash}`;
}

function parseNumericId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const numericMatch = raw.match(/\d+/);
  if (!numericMatch) {
    return null;
  }

  const parsed = Number(numericMatch[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function verifyKommoJwt(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    return false;
  }

  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) {
    return false;
  }

  const data = `${headerPart}.${payloadPart}`;
  const expectedSignature = base64UrlEncode(
    crypto.createHmac("sha256", secret).update(data).digest()
  );

  return safeEqual(expectedSignature, signaturePart);
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isSessionResetCommand(text) {
  const normalized = String(text || "").trim().toLowerCase();
  return ["/nuevo", "/nueva", "/reset", "/reiniciar"].includes(normalized);
}

function buildSessionResetReply() {
  return "Listo. Borre el contexto anterior. Contame producto/modelo y el problema.";
}

function isKommoIncomingWebhookAuthorized(req) {
  if (!kommoIncomingWebhookSecret) {
    return true;
  }

  const tokenCandidates = [
    req.query?.token,
    req.query?.secret,
    req.headers?.["x-webhook-token"],
    req.headers?.["x-kommo-webhook-token"],
  ];

  return tokenCandidates.some((value) => safeEqual(String(value || "").trim(), kommoIncomingWebhookSecret));
}

function extractKommoIncomingMessageEvent(payload) {
  const messageGroups = [payload?.message?.add, payload?.messages?.add, payload?.message?.update];
  for (const group of messageGroups) {
    for (const item of toArray(group)) {
      const messageId = String(item?.id || "").trim();
      const messageType = String(item?.type || "incoming").trim().toLowerCase();
      if (!messageId || (messageType && messageType !== "incoming")) {
        continue;
      }

      const entityId = parseNumericId(item?.entity_id || item?.element_id);
      const entityType = normalizeKommoWebhookEntityType(item?.entity_type || item?.element_type);
      if (!entityId || !entityType) {
        continue;
      }

      return {
        messageId,
        entityId,
        entityType,
        talkId: String(item?.talk_id || "").trim() || null,
        contactId: parseNumericId(item?.contact_id),
        text: String(item?.text || "").trim() || null,
        origin: String(item?.origin || "").trim() || null,
      };
    }
  }

  return null;
}

function normalizeKommoWebhookEntityType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (["lead", "leads", "2"].includes(normalized)) {
    return "leads";
  }

  if (["contact", "contacts", "1"].includes(normalized)) {
    return "contacts";
  }

  return null;
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.keys(value)
    .sort((left, right) => Number(left) - Number(right))
    .map((key) => value[key]);
}

function isGreetingOnlyText(normalizedText) {
  return /^(hola+|holis|buenas|buen dia|buenas tardes|buenas noches|hello|hey|ey)[!.? ]*$/.test(
    String(normalizedText || "").trim()
  );
}

function limitText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

function formatWhatsAppError(error) {
  const data = error?.response?.data;
  const code = data?.error?.code;
  const subcode = data?.error?.error_subcode;
  const message = data?.error?.message || error?.message || "error desconocido";

  if (code === 190) {
    return `Token de WhatsApp invalido/vencido (code=190, subcode=${subcode || "n/a"}). Renovar WHATSAPP_ACCESS_TOKEN. Detalle: ${message}`;
  }

  if (code === 131030) {
    return `No se pudo enviar al numero destino (code=131030). Revisar formato y estado del numero. Detalle: ${message}`;
  }

  return data || message;
}

function formatKommoError(error) {
  const status = error?.response?.status;
  const data = error?.response?.data;
  if (status) {
    return `status=${status} data=${JSON.stringify(data || {})}`;
  }

  return error?.message || "error desconocido";
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function shouldProcessKommoWidgetInline() {
  if (String(process.env.KOMMO_WIDGET_INLINE_PROCESSING || "").trim().toLowerCase() === "true") {
    return true;
  }

  return ["NETLIFY", "AWS_LAMBDA_FUNCTION_NAME", "LAMBDA_TASK_ROOT"].some(
    (key) => String(process.env[key] || "").trim() !== ""
  );
}

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Servidor listo en http://localhost:${port}`);
  });
}

module.exports = {
  app,
  handleKommoWidgetRequest,
  extractKommoIncomingMessageEvent,
  runtime,
};
