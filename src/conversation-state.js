/**
 * Gestión de estado de conversaciones usando Redis
 * Versión simplificada sin LibSQL/Turso
 */

const config = require('./config');
const { isSameProduct } = require('./product-catalog');

const sessionTTLHours = config.redis.ttlHours || 72;
const sessionTTLms = Math.max(sessionTTLHours, 1) * 60 * 60 * 1000;
const sessionHistoryLimit = Number(process.env.SESSION_HISTORY_LIMIT || 12);
const sessionStorePrefix = String(process.env.SESSION_STORE_PREFIX || 'soporte:sessions:');

// Cache en memoria para fallback si Redis no está disponible
const memorySessions = new Map();

async function startTurn(sessionId, userText) {
  const session = await getOrCreateSession(sessionId);
  const nowIso = new Date().toISOString();

  if (userText?.trim()) {
    pushMessage(session, {
      role: 'user',
      text: userText.trim(),
      timestamp: nowIso,
    });
  }

  session.updatedAt = nowIso;
  await saveSession(session);
  return toSnapshot(session);
}

async function finishTurn(sessionId, assistantText, stateUpdate = {}, meta = {}) {
  const session = await getOrCreateSession(sessionId);
  const nowIso = new Date().toISOString();

  applyStateUpdate(session, stateUpdate);

  if (assistantText?.trim()) {
    pushMessage(session, {
      role: 'assistant',
      text: assistantText.trim(),
      timestamp: nowIso,
      meta,
    });
  }

  session.lastMode = meta.mode || session.lastMode;
  session.updatedAt = nowIso;
  await saveSession(session);
  return toSnapshot(session);
}

async function getSession(sessionId) {
  if (!sessionId) return null;
  
  try {
    // Intentar obtener de Redis primero
    const redis = getRedisClient();
    if (redis) {
      const data = await redis.get(`${sessionStorePrefix}${sessionId}`);
      if (data) {
        return JSON.parse(data);
      }
    }
  } catch (error) {
    console.warn('[Session] Error leyendo de Redis:', error.message);
  }
  
  // Fallback a memoria
  return memorySessions.get(sessionId) || null;
}

async function getOrCreateSession(sessionId) {
  const existing = await getSession(sessionId);
  if (existing) return existing;
  
  const newSession = {
    id: sessionId,
    messages: [],
    currentProduct: null,
    supportFlow: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  return newSession;
}

async function saveSession(session) {
  if (!session?.id) return;
  
  try {
    const redis = getRedisClient();
    if (redis) {
      await redis.setEx(
        `${sessionStorePrefix}${session.id}`,
        Math.floor(sessionTTLms / 1000),
        JSON.stringify(session)
      );
      return;
    }
  } catch (error) {
    console.warn('[Session] Error guardando en Redis:', error.message);
  }
  
  // Fallback a memoria
  memorySessions.set(session.id, session);
  
  // Limpiar sesiones expiradas en memoria
  cleanupExpiredMemorySessions();
}

function pushMessage(session, message) {
  if (!session.messages) {
    session.messages = [];
  }
  
  session.messages.push(message);
  
  // Mantener solo los últimos N mensajes
  if (session.messages.length > sessionHistoryLimit) {
    session.messages = session.messages.slice(-sessionHistoryLimit);
  }
}

function applyStateUpdate(session, update) {
  if (!update || typeof update !== 'object') return;
  
  Object.entries(update).forEach(([key, value]) => {
    if (value === undefined) return;
    
    if (key === 'currentProduct' && value && session.currentProduct) {
      if (isSameProduct(value, session.currentProduct)) {
        session.currentProduct = { ...session.currentProduct, ...value };
      } else {
        session.currentProduct = value;
      }
    } else if (key === 'clearSupportFlow') {
      session.supportFlow = null;
    } else if (key === 'clearPendingProductSwitch') {
      session.pendingProductSwitch = null;
    } else {
      session[key] = value;
    }
  });
}

function toSnapshot(session) {
  return {
    messages: session.messages || [],
    currentProduct: session.currentProduct || null,
    supportFlow: session.supportFlow || null,
    pendingProductSwitch: session.pendingProductSwitch || null,
    lastMode: session.lastMode || null,
  };
}

function cleanupExpiredMemorySessions() {
  const now = Date.now();
  for (const [id, session] of memorySessions.entries()) {
    const updated = new Date(session.updatedAt).getTime();
    if (now - updated > sessionTTLms) {
      memorySessions.delete(id);
    }
  }
}

let redisClient = null;

function getRedisClient() {
  if (redisClient) return redisClient;
  
  try {
    const { createClient } = require('redis');
    redisClient = createClient({ url: config.redis.url });
    redisClient.on('error', (err) => {
      console.error('[Redis] Error:', err.message);
      redisClient = null;
    });
    redisClient.connect();
    return redisClient;
  } catch (error) {
    console.warn('[Redis] No disponible, usando memoria:', error.message);
    return null;
  }
}

async function getSessionStoreInfo() {
  const redis = getRedisClient();
  
  if (redis) {
    try {
      const keys = await redis.keys(`${sessionStorePrefix}*`);
      return {
        backend: 'redis',
        connected: redis.isReady,
        sessionCount: keys.length,
        ttl: sessionTTLHours + ' horas',
      };
    } catch (error) {
      return {
        backend: 'redis',
        connected: false,
        error: error.message,
        fallback: 'memory',
      };
    }
  }
  
  return {
    backend: 'memory',
    connected: true,
    sessionCount: memorySessions.size,
    ttl: sessionTTLHours + ' horas',
  };
}

module.exports = {
  startTurn,
  finishTurn,
  getSession,
  getOrCreateSession,
  getSessionStoreInfo,
};
