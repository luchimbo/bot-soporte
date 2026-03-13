import { createRequire } from "node:module";

import { buildSessionId, buildContactLabel, describeInboundMessage, extractWhatsAppUserId } from "./thread-utils.mjs";

const require = createRequire(import.meta.url);

const { buildAssistantReply } = require("../assistant.js");
const {
  startTurn,
  finishTurn,
  resetSession,
} = require("../conversation-state.js");
const { syncKommoTurn } = require("../kommo-client.js");
const { buildTurnAnalysis } = require("../turn-analysis.js");

const SESSION_RESET_COMMANDS = new Set(["/nuevo", "/nueva", "/reset", "/reiniciar"]);
const SESSION_RESET_REPLY = "Listo. Borre el contexto anterior. Contame producto/modelo y el problema.";
const NON_TEXT_REPLY =
  "Por ahora necesito que me expliques el caso por texto. Contame producto/modelo y que problema tenes.";

export async function runSupportTurn({ thread, message }) {
  const sessionId = buildSessionId(thread);
  const userText = String(message?.text || "").trim();
  const userPreview = describeInboundMessage(message).slice(0, 160) || null;

  if (!userText) {
    return {
      sessionId,
      replyText: NON_TEXT_REPLY,
      mode: "non-text-message",
      userPreview,
      kommoSync: null,
      sessionSnapshot: null,
      resetApplied: false,
      activeProduct: null,
    };
  }

  if (isSessionResetCommand(userText)) {
    await resetSession(sessionId);
    return {
      sessionId,
      replyText: SESSION_RESET_REPLY,
      mode: "session-reset",
      userPreview,
      kommoSync: null,
      sessionSnapshot: null,
      resetApplied: true,
      activeProduct: null,
    };
  }

  const sessionContext = await startTurn(sessionId, userText);
  const result = await buildAssistantReply(userText, {
    sessionContext,
    sessionId,
  });

  const sessionSnapshot = await finishTurn(sessionId, result.text, result.stateUpdate, {
    mode: result.mode,
    hits: result.hits.length,
    styleHits: (result.styleExamples || []).length,
  });

  const turnAnalysis = buildTurnAnalysis({
    userText,
    result,
    sessionSnapshot,
  });

  const activeProduct = result.activeProduct || sessionSnapshot.currentProduct || null;
  const kommoSync = await syncTurnToKommo({
    thread,
    message,
    sessionSnapshot,
    userText,
    result,
    turnAnalysis,
    activeProduct,
  });

  return {
    sessionId,
    replyText: result.text,
    mode: result.mode,
    userPreview,
    kommoSync,
    sessionSnapshot,
    resetApplied: false,
    activeProduct,
  };
}

function isSessionResetCommand(text) {
  return SESSION_RESET_COMMANDS.has(String(text || "").trim().toLowerCase());
}

async function syncTurnToKommo({ thread, message, sessionSnapshot, userText, result, turnAnalysis, activeProduct }) {
  const phone = extractWhatsAppUserId(thread, message);
  if (!phone) {
    return {
      skipped: true,
      reason: "missing-whatsapp-user-id",
    };
  }

  try {
    return await syncKommoTurn({
      sessionContext: sessionSnapshot,
      phone,
      userText,
      assistantText: result.text,
      assistantMode: result.mode,
      activeProduct,
      intent: result.stateUpdate?.lastIntent || sessionSnapshot.lastIntent,
      hits: result.hits.length,
      styleHits: (result.styleExamples || []).length,
      orderNumber: turnAnalysis.orderNumber,
      marketplaceUser: turnAnalysis.marketplaceUser,
      urgency: turnAnalysis.urgency,
      escalate: turnAnalysis.escalate,
      attempts: turnAnalysis.attempts,
      sourceLabel: `WhatsApp Cloud API | ${buildContactLabel(message)}`,
      kommoLeadId: sessionSnapshot.kommoLeadId,
      kommoContactId: sessionSnapshot.kommoContactId,
    });
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "kommo-sync-error",
    };
  }
}
