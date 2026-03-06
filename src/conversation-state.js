const { isSameProduct } = require("./product-catalog");

const sessionTTLHours = Number(process.env.SESSION_TTL_HOURS || 72);
const sessionTTLms = Math.max(sessionTTLHours, 1) * 60 * 60 * 1000;
const sessionHistoryLimit = Number(process.env.SESSION_HISTORY_LIMIT || 12);

const sessions = new Map();

function startTurn(sessionId, userText) {
  cleanupExpiredSessions();

  const session = getOrCreateSession(sessionId);
  const nowIso = new Date().toISOString();

  if (userText && String(userText).trim()) {
    pushMessage(session, {
      role: "user",
      text: String(userText).trim(),
      timestamp: nowIso,
    });
  }

  session.updatedAt = nowIso;
  return toSnapshot(session);
}

function finishTurn(sessionId, assistantText, stateUpdate = {}, meta = {}) {
  cleanupExpiredSessions();

  const session = getOrCreateSession(sessionId);
  const nowIso = new Date().toISOString();

  applyStateUpdate(session, stateUpdate);

  if (assistantText && String(assistantText).trim()) {
    pushMessage(session, {
      role: "assistant",
      text: String(assistantText).trim(),
      timestamp: nowIso,
      meta,
    });
  }

  session.lastMode = meta.mode || session.lastMode;
  session.updatedAt = nowIso;

  return toSnapshot(session);
}

function getSessionContext(sessionId) {
  cleanupExpiredSessions();
  const session = sessions.get(sessionId);
  return session ? toSnapshot(session) : null;
}

function resetSession(sessionId) {
  sessions.delete(sessionId);
}

function getSessionStoreInfo() {
  cleanupExpiredSessions();
  return {
    activeSessions: sessions.size,
    ttlHours: sessionTTLHours,
    historyLimit: sessionHistoryLimit,
  };
}

function applyStateUpdate(session, stateUpdate) {
  if (!stateUpdate || typeof stateUpdate !== "object") {
    return;
  }

  if (stateUpdate.clearPendingProductSwitch) {
    session.pendingProductSwitch = null;
  }

  if (Object.prototype.hasOwnProperty.call(stateUpdate, "pendingProductSwitch")) {
    session.pendingProductSwitch = stateUpdate.pendingProductSwitch || null;
  }

  if (Object.prototype.hasOwnProperty.call(stateUpdate, "currentProduct")) {
    const previousProduct = session.currentProduct;
    const nextProduct = stateUpdate.currentProduct || null;

    if (
      previousProduct &&
      nextProduct &&
      !isSameProduct(previousProduct, nextProduct)
    ) {
      session.metrics.productSwitches += 1;
    }

    session.currentProduct = nextProduct;
  }

  if (Object.prototype.hasOwnProperty.call(stateUpdate, "lastIntent")) {
    session.lastIntent = stateUpdate.lastIntent || null;
  }

  if (stateUpdate.productDriftPrevented) {
    session.metrics.productDriftPrevented += 1;
  }
}

function getOrCreateSession(sessionId) {
  const id = String(sessionId || "anonymous");
  const existing = sessions.get(id);
  if (existing) {
    return existing;
  }

  const nowIso = new Date().toISOString();
  const session = {
    id,
    createdAt: nowIso,
    updatedAt: nowIso,
    currentProduct: null,
    pendingProductSwitch: null,
    lastIntent: null,
    lastMode: null,
    messageHistory: [],
    metrics: {
      productSwitches: 0,
      productDriftPrevented: 0,
    },
  };

  sessions.set(id, session);
  return session;
}

function pushMessage(session, message) {
  session.messageHistory.push(message);
  if (session.messageHistory.length > sessionHistoryLimit) {
    session.messageHistory.splice(0, session.messageHistory.length - sessionHistoryLimit);
  }
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    const updatedAtMs = Date.parse(session.updatedAt || "");
    if (!Number.isFinite(updatedAtMs)) {
      continue;
    }

    if (now - updatedAtMs > sessionTTLms) {
      sessions.delete(sessionId);
    }
  }
}

function toSnapshot(session) {
  return {
    id: session.id,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    currentProduct: session.currentProduct,
    pendingProductSwitch: session.pendingProductSwitch,
    lastIntent: session.lastIntent,
    lastMode: session.lastMode,
    messageHistory: session.messageHistory.slice(),
    metrics: {
      ...session.metrics,
    },
  };
}

module.exports = {
  startTurn,
  finishTurn,
  getSessionContext,
  resetSession,
  getSessionStoreInfo,
};
