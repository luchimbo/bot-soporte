const { createClient } = require("@libsql/client");

const webhookEventTTLHours = Number(process.env.KOMMO_INCOMING_MESSAGE_TTL_HOURS || 168);
const webhookEventTTLms = Math.max(webhookEventTTLHours, 1) * 60 * 60 * 1000;
const tursoDatabaseUrl = String(process.env.TURSO_DATABASE_URL || "").trim();
const tursoAuthToken = String(process.env.TURSO_AUTH_TOKEN || "").trim();
const dedupeTable = normalizeIdentifier(process.env.KOMMO_INCOMING_MESSAGE_TABLE, "kommo_incoming_messages");
const canUseTurso = Boolean(tursoDatabaseUrl && (!requiresRemoteAuth(tursoDatabaseUrl) || tursoAuthToken));

const memoryKeys = new Map();
let tursoClient = null;
let tursoInitPromise = null;
let lastCleanupAt = 0;

async function claimKommoIncomingMessage(messageId) {
  const key = String(messageId || "").trim();
  if (!key) {
    return true;
  }

  if (canUseTurso) {
    try {
      return await claimWithTurso(key);
    } catch (error) {
      console.warn(`No pude deduplicar con Turso, sigo en memoria: ${error.message}`);
    }
  }

  cleanupMemory();
  if (memoryKeys.has(key)) {
    return false;
  }

  memoryKeys.set(key, Date.now() + webhookEventTTLms);
  return true;
}

async function claimWithTurso(messageId) {
  const client = await ensureTursoReady();
  await cleanupTursoIfNeeded(client);

  const now = Date.now();
  const expiresAt = now + webhookEventTTLms;
  const result = await client.execute({
    sql: `INSERT OR IGNORE INTO ${dedupeTable} (message_id, processed_at, expires_at) VALUES (?, ?, ?)`,
    args: [messageId, now, expiresAt],
  });

  return Number(result.rowsAffected || 0) > 0;
}

async function ensureTursoReady() {
  if (!canUseTurso) {
    throw new Error("Turso no esta disponible para deduplicacion de webhooks");
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
        CREATE TABLE IF NOT EXISTS ${dedupeTable} (
          message_id TEXT PRIMARY KEY,
          processed_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        )
      `);
      await tursoClient.execute(`
        CREATE INDEX IF NOT EXISTS ${dedupeTable}_expires_at_idx
        ON ${dedupeTable} (expires_at)
      `);
    })();
  }

  await tursoInitPromise;
  return tursoClient;
}

async function cleanupTursoIfNeeded(client) {
  const now = Date.now();
  if (now - lastCleanupAt < 10 * 60 * 1000) {
    return;
  }

  lastCleanupAt = now;
  await client.execute({
    sql: `DELETE FROM ${dedupeTable} WHERE expires_at <= ?`,
    args: [now],
  });
}

function cleanupMemory() {
  const now = Date.now();
  for (const [key, expiresAt] of memoryKeys.entries()) {
    if (expiresAt <= now) {
      memoryKeys.delete(key);
    }
  }
}

function requiresRemoteAuth(url) {
  return !/^file:/i.test(String(url || ""));
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
  claimKommoIncomingMessage,
};
