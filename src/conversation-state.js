const { createClient } = require("@libsql/client");

const { isSameProduct } = require("./product-catalog");

const sessionTTLHours = Number(process.env.SESSION_TTL_HOURS || 72);
const sessionTTLms = Math.max(sessionTTLHours, 1) * 60 * 60 * 1000;
const sessionHistoryLimit = Number(process.env.SESSION_HISTORY_LIMIT || 12);
const sessionStorePrefix = String(process.env.SESSION_STORE_PREFIX || "soporte:sessions:").trim();
const tursoDatabaseUrl = String(process.env.TURSO_DATABASE_URL || "").trim();
const tursoAuthToken = String(process.env.TURSO_AUTH_TOKEN || "").trim();
const tursoSessionTable = normalizeIdentifier(process.env.TURSO_SESSION_TABLE, "conversation_sessions");
const preferredStoreBackend = tursoDatabaseUrl ? "turso" : "memory";
const tursoRequiresAuth = preferredStoreBackend === "turso" && !/^file:/i.test(tursoDatabaseUrl);

const sessions = new Map();

let tursoClient = null;
let tursoInitPromise = null;
let tursoFallbackReason = tursoRequiresAuth && !tursoAuthToken ? "TURSO_AUTH_TOKEN faltante" : null;
let lastTursoCleanupAt = 0;
let storeWarningLogged = false;

async function startTurn(sessionId, userText) {
  if (shouldUseTurso()) {
    try {
      const session = await getOrCreateTursoSession(sessionId);
      const nowIso = new Date().toISOString();

      if (userText && String(userText).trim()) {
        pushMessage(session, {
          role: "user",
          text: String(userText).trim(),
          timestamp: nowIso,
        });
      }

      session.updatedAt = nowIso;
      await saveTursoSession(session);
      return toSnapshot(session);
    } catch (error) {
      disableTurso(error);
    }
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
  if (shouldUseTurso()) {
    try {
      const session = await getOrCreateTursoSession(sessionId);
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
      await saveTursoSession(session);
      return toSnapshot(session);
    } catch (error) {
      disableTurso(error);
    }
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
  if (shouldUseTurso()) {
    try {
      const session = await getOrCreateTursoSession(sessionId);
      applyAllowedMetadata(session, metadata);
      session.updatedAt = new Date().toISOString();
      await saveTursoSession(session);
      return toSnapshot(session);
    } catch (error) {
      disableTurso(error);
    }
  }

  cleanupExpiredSessions();

  const session = getOrCreateMemorySession(sessionId);
  applyAllowedMetadata(session, metadata);
  session.updatedAt = new Date().toISOString();
  return toSnapshot(session);
}

async function getSessionContext(sessionId) {
  if (shouldUseTurso()) {
    try {
      const session = await loadTursoSession(sessionId);
      return session ? toSnapshot(session) : null;
    } catch (error) {
      disableTurso(error);
    }
  }

  cleanupExpiredSessions();
  const session = sessions.get(String(sessionId || "anonymous"));
  return session ? toSnapshot(session) : null;
}

async function resetSession(sessionId) {
  if (shouldUseTurso()) {
    try {
      await deleteTursoSession(sessionId);
      return;
    } catch (error) {
      disableTurso(error);
    }
  }

  sessions.delete(String(sessionId || "anonymous"));
}

async function getSessionStoreInfo() {
  const usingTurso = shouldUseTurso();
  if (!usingTurso) {
    cleanupExpiredSessions();
  }

  return {
    backend: usingTurso ? "turso" : "memory",
    configuredBackend: preferredStoreBackend,
    persistent: usingTurso,
    activeSessions: usingTurso ? null : sessions.size,
    ttlHours: sessionTTLHours,
    historyLimit: sessionHistoryLimit,
    keyPrefix: sessionStorePrefix,
    tableName: preferredStoreBackend === "turso" ? tursoSessionTable : null,
    fallbackReason: tursoFallbackReason,
  };
}

function shouldUseTurso() {
  return preferredStoreBackend === "turso" && !tursoFallbackReason;
}

function disableTurso(error) {
  tursoFallbackReason = error?.message || "No pude usar Turso";
  if (!storeWarningLogged) {
    console.warn(`Session store fallback a memory: ${tursoFallbackReason}`);
    storeWarningLogged = true;
  }
}

function applyAllowedMetadata(session, metadata) {
  const allowedKeys = ["kommoContactId", "kommoLeadId", "humanActive"];
  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      session[key] = metadata[key];
    }
  }
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

async function getOrCreateTursoSession(sessionId) {
  const existing = await loadTursoSession(sessionId);
  return existing || createEmptySession(String(sessionId || "anonymous"));
}

async function loadTursoSession(sessionId) {
  const client = await ensureTursoReady();
  await cleanupExpiredTursoSessionsIfNeeded(client);

  const result = await client.execute({
    sql: `SELECT payload, expires_at FROM ${tursoSessionTable} WHERE session_id = ? LIMIT 1`,
    args: [buildSessionKey(sessionId)],
  });

  const row = Array.isArray(result.rows) && result.rows.length > 0 ? result.rows[0] : null;
  if (!row) {
    return null;
  }

  const expiresAt = parseStoredNumber(row.expires_at);
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    await deleteTursoSession(sessionId);
    return null;
  }

  const rawPayload = row.payload == null ? "" : String(row.payload);
  if (!rawPayload.trim()) {
    return null;
  }

  try {
    return normalizeSession(sessionId, JSON.parse(rawPayload));
  } catch (error) {
    console.warn(`No pude parsear sesion remota ${sessionId}: ${error.message}`);
    return null;
  }
}

async function saveTursoSession(session) {
  const client = await ensureTursoReady();
  const nowMs = Date.now();
  const expiresAt = nowMs + sessionTTLms;

  await client.execute({
    sql: `
      INSERT INTO ${tursoSessionTable} (session_id, payload, updated_at, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `,
    args: [
      buildSessionKey(session.id),
      JSON.stringify(normalizeSession(session.id, session)),
      nowMs,
      expiresAt,
    ],
  });
}

async function deleteTursoSession(sessionId) {
  const client = await ensureTursoReady();
  await client.execute({
    sql: `DELETE FROM ${tursoSessionTable} WHERE session_id = ?`,
    args: [buildSessionKey(sessionId)],
  });
}

async function ensureTursoReady() {
  if (!shouldUseTurso()) {
    throw new Error("El store Turso no esta habilitado");
  }

  if (!tursoClient) {
    tursoClient = createClient({
      url: tursoDatabaseUrl,
      ...(tursoAuthToken ? { authToken: tursoAuthToken } : {}),
    });
  }

  if (!tursoInitPromise) {
    tursoInitPromise = (async () => {
      await tursoClient.execute(`
        CREATE TABLE IF NOT EXISTS ${tursoSessionTable} (
          session_id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )
      `);
      await tursoClient.execute(`
        CREATE INDEX IF NOT EXISTS ${tursoSessionTable}_expires_at_idx
        ON ${tursoSessionTable} (expires_at)
      `);
    })();
  }

  await tursoInitPromise;
  return tursoClient;
}

async function cleanupExpiredTursoSessionsIfNeeded(client) {
  const now = Date.now();
  if (now - lastTursoCleanupAt < 10 * 60 * 1000) {
    return;
  }

  lastTursoCleanupAt = now;
  await client.execute({
    sql: `DELETE FROM ${tursoSessionTable} WHERE expires_at <= ?`,
    args: [now],
  });
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

function parseStoredNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeIdentifier(value, fallback) {
  const normalized = String(value || fallback || "")
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+/, "")
    .replace(/_+$/, "");

  return normalized || fallback;
}

module.exports = {
  startTurn,
  finishTurn,
  updateSessionMetadata,
  getSessionContext,
  resetSession,
  getSessionStoreInfo,
};
