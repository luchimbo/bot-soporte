const { Redis } = require("@upstash/redis");

const { isSameProduct } = require("./product-catalog");

const sessionTTLHours = Number(process.env.SESSION_TTL_HOURS || 72);
const sessionTTLms = Math.max(sessionTTLHours, 1) * 60 * 60 * 1000;
const sessionTTLSeconds = Math.max(Math.round(sessionTTLms / 1000), 1);
const sessionHistoryLimit = Number(process.env.SESSION_HISTORY_LIMIT || 12);
const sessionStorePrefix = String(process.env.SESSION_STORE_PREFIX || "soporte:sessions:").trim();
const upstashRestUrl = String(process.env.UPSTASH_REDIS_REST_URL || "").trim();
const upstashRestToken = String(process.env.UPSTASH_REDIS_REST_TOKEN || "").trim();
const storeBackend = upstashRestUrl && upstashRestToken ? "upstash-redis" : "memory";

const sessions = new Map();
let redisClient = null;

async function startTurn(sessionId, userText) {
  if (storeBackend === "upstash-redis") {
    const session = await getOrCreateRemoteSession(sessionId);
    const nowIso = new Date().toISOString();

    if (userText && String(userText).trim()) {
      pushMessage(session, {
        role: "user",
        text: String(userText).trim(),
        timestamp: nowIso,
      });
    }

    session.updatedAt = nowIso;
    await saveRemoteSession(session);
    return toSnapshot(session);
  }

  cleanupExpiredSessions();

  const session = getOrCreateMemorySession(sessionId);
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

async function finishTurn(sessionId, assistantText, stateUpdate = {}, meta = {}) {
  if (storeBackend === "upstash-redis") {
    const session = await getOrCreateRemoteSession(sessionId);
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
    await saveRemoteSession(session);
    return toSnapshot(session);
  }

  cleanupExpiredSessions();

  const session = getOrCreateMemorySession(sessionId);
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

async function updateSessionMetadata(sessionId, metadata = {}) {
  if (storeBackend === "upstash-redis") {
    const session = await getOrCreateRemoteSession(sessionId);
    const allowedKeys = ["kommoContactId", "kommoLeadId", "humanActive"];
    for (const key of allowedKeys) {
      if (Object.prototype.hasOwnProperty.call(metadata, key)) {
        session[key] = metadata[key];
      }
    }

    session.updatedAt = new Date().toISOString();
    await saveRemoteSession(session);
    return toSnapshot(session);
  }

  cleanupExpiredSessions();

  const session = getOrCreateMemorySession(sessionId);
  const allowedKeys = ["kommoContactId", "kommoLeadId", "humanActive"];
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      session[key] = metadata[key];
    }
  }

  session.updatedAt = new Date().toISOString();
  return toSnapshot(session);
}

async function getSessionContext(sessionId) {
  if (storeBackend === "upstash-redis") {
    const session = await loadRemoteSession(sessionId);
    return session ? toSnapshot(session) : null;
  }

  cleanupExpiredSessions();
  const session = sessions.get(String(sessionId || "anonymous"));
  return session ? toSnapshot(session) : null;
}

async function resetSession(sessionId) {
  if (storeBackend === "upstash-redis") {
    await deleteRemoteSession(sessionId);
    return;
  }

  sessions.delete(String(sessionId || "anonymous"));
}

async function getSessionStoreInfo() {
  if (storeBackend === "upstash-redis") {
    return {
      backend: storeBackend,
      persistent: true,
      activeSessions: null,
      ttlHours: sessionTTLHours,
      historyLimit: sessionHistoryLimit,
      keyPrefix: sessionStorePrefix,
    };
  }

  cleanupExpiredSessions();
  return {
    backend: storeBackend,
    persistent: false,
    activeSessions: sessions.size,
    ttlHours: sessionTTLHours,
    historyLimit: sessionHistoryLimit,
    keyPrefix: sessionStorePrefix,
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

    if (previousProduct && nextProduct && !isSameProduct(previousProduct, nextProduct)) {
      session.metrics.productSwitches += 1;
    }

    session.currentProduct = nextProduct;
  }

  if (Object.prototype.hasOwnProperty.call(stateUpdate, "lastIntent")) {
    session.lastIntent = stateUpdate.lastIntent || null;
  }

  if (Object.prototype.hasOwnProperty.call(stateUpdate, "kommoContactId")) {
    session.kommoContactId = stateUpdate.kommoContactId || null;
  }

  if (Object.prototype.hasOwnProperty.call(stateUpdate, "kommoLeadId")) {
    session.kommoLeadId = stateUpdate.kommoLeadId || null;
  }

  if (Object.prototype.hasOwnProperty.call(stateUpdate, "humanActive")) {
    session.humanActive = Boolean(stateUpdate.humanActive);
  }

  if (stateUpdate.productDriftPrevented) {
    session.metrics.productDriftPrevented += 1;
  }
}

function getOrCreateMemorySession(sessionId) {
  const id = String(sessionId || "anonymous");
  const existing = sessions.get(id);
  if (existing) {
    return existing;
  }

  const session = createEmptySession(id);
  sessions.set(id, session);
  return session;
}

async function getOrCreateRemoteSession(sessionId) {
  const existing = await loadRemoteSession(sessionId);
  return existing || createEmptySession(String(sessionId || "anonymous"));
}

async function loadRemoteSession(sessionId) {
  const redis = getRedisClient();
  const raw = await redis.get(buildSessionKey(sessionId));
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);
    return normalizeSession(sessionId, parsed);
  } catch (error) {
    console.warn(`No pude parsear sesion remota ${sessionId}: ${error.message}`);
    return null;
  }
}

async function saveRemoteSession(session) {
  const redis = getRedisClient();
  await redis.set(buildSessionKey(session.id), JSON.stringify(normalizeSession(session.id, session)), {
    ex: sessionTTLSeconds,
  });
}

async function deleteRemoteSession(sessionId) {
  const redis = getRedisClient();
  await redis.del(buildSessionKey(sessionId));
}

function getRedisClient() {
  if (storeBackend !== "upstash-redis") {
    throw new Error("El store Redis no esta habilitado");
  }

  if (!redisClient) {
    redisClient = new Redis({
      url: upstashRestUrl,
      token: upstashRestToken,
    });
  }

  return redisClient;
}

function buildSessionKey(sessionId) {
  return `${sessionStorePrefix}${String(sessionId || "anonymous")}`;
}

function createEmptySession(sessionId, nowIso = new Date().toISOString()) {
  return {
    id: String(sessionId || "anonymous"),
    createdAt: nowIso,
    updatedAt: nowIso,
    currentProduct: null,
    pendingProductSwitch: null,
    lastIntent: null,
    lastMode: null,
    kommoContactId: null,
    kommoLeadId: null,
    humanActive: false,
    messageHistory: [],
    metrics: {
      productSwitches: 0,
      productDriftPrevented: 0,
    },
  };
}

function normalizeSession(sessionId, candidate) {
  const fallback = createEmptySession(sessionId);
  if (!candidate || typeof candidate !== "object") {
    return fallback;
  }

  const history = Array.isArray(candidate.messageHistory)
    ? candidate.messageHistory
        .filter((message) => message && typeof message.text === "string" && message.text.trim())
        .slice(-sessionHistoryLimit)
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          text: String(message.text || "").trim(),
          timestamp: String(message.timestamp || candidate.updatedAt || fallback.updatedAt),
          ...(message.meta && typeof message.meta === "object" ? { meta: message.meta } : {}),
        }))
    : [];

  return {
    id: String(candidate.id || sessionId || fallback.id),
    createdAt: String(candidate.createdAt || fallback.createdAt),
    updatedAt: String(candidate.updatedAt || fallback.updatedAt),
    currentProduct: candidate.currentProduct || null,
    pendingProductSwitch: candidate.pendingProductSwitch || null,
    lastIntent: candidate.lastIntent || null,
    lastMode: candidate.lastMode || null,
    kommoContactId: candidate.kommoContactId || null,
    kommoLeadId: candidate.kommoLeadId || null,
    humanActive: Boolean(candidate.humanActive),
    messageHistory: history,
    metrics: {
      productSwitches: Number(candidate.metrics?.productSwitches || 0),
      productDriftPrevented: Number(candidate.metrics?.productDriftPrevented || 0),
    },
  };
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
    kommoContactId: session.kommoContactId,
    kommoLeadId: session.kommoLeadId,
    humanActive: session.humanActive,
    messageHistory: session.messageHistory.slice(),
    metrics: {
      ...session.metrics,
    },
  };
}

module.exports = {
  startTurn,
  finishTurn,
  updateSessionMetadata,
  getSessionContext,
  resetSession,
  getSessionStoreInfo,
};
