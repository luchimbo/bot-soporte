require("dotenv").config();

const express = require("express");
const axios = require("axios");
const { buildAssistantReply, getLLMStatus } = require("./assistant");
const { getKnowledgeBaseInfo } = require("./knowledge-base");
const { getProductCatalogInfo } = require("./product-catalog");
const {
  startTurn,
  finishTurn,
  getSessionStoreInfo,
  resetSession,
} = require("./conversation-state");

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const mockSend = process.env.MOCK_WHATSAPP_SEND === "true";

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
};

app.get("/health", (_, res) => {
  const kbInfo = getKnowledgeBaseInfo();
  const llm = getLLMStatus();
  const catalog = getProductCatalogInfo();
  const sessions = getSessionStoreInfo();
  const whatsapp = {
    mockSend,
    verifyTokenConfigured: Boolean(verifyToken),
    accessTokenConfigured: Boolean(accessToken),
    phoneNumberIdConfigured: Boolean(phoneNumberId),
  };

  res.status(200).json({
    ok: true,
    llmEnabled: llm.enabled,
    openAIEnabled: llm.enabled,
    llm,
    knowledgeBase: kbInfo,
    productCatalog: catalog,
    sessions,
    whatsapp,
    runtime,
  });
});

app.post("/simulate", async (req, res) => {
  const userText = req.body?.text || "";
  const sessionId = String(req.body?.sessionId || "simulate-default");
  if (req.body?.resetSession === true) {
    resetSession(sessionId);
  }

  const sessionContext = startTurn(sessionId, userText);
  const result = await buildAssistantReply(userText, {
    sessionContext,
    sessionId,
  });
  const updatedSession = finishTurn(
    sessionId,
    result.text,
    result.stateUpdate,
    {
      mode: result.mode,
      hits: result.hits.length,
      styleHits: (result.styleExamples || []).length,
    }
  );

  return res.status(200).json({
    reply: result.text,
    mode: result.mode,
    hits: result.hits.length,
    styleHits: (result.styleExamples || []).length,
    sessionId,
    activeProduct: result.activeProduct || updatedSession.currentProduct || null,
    pendingProductSwitch: updatedSession.pendingProductSwitch || null,
  });
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === verifyToken) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
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

    console.log(`Mensaje de ${from}: ${userText}`);
    const sessionContext = startTurn(from, userText);
    const result = await buildAssistantReply(userText, {
      sessionContext,
      sessionId: from,
    });
    const replyText = result.text;

    await sendWhatsAppText({ to: from, body: replyText, runtime });
    const updatedSession = finishTurn(from, replyText, result.stateUpdate, {
      mode: result.mode,
      hits: result.hits.length,
      styleHits: (result.styleExamples || []).length,
    });

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
});

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

app.listen(port, () => {
  console.log(`Servidor listo en http://localhost:${port}`);
});
