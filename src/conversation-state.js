/**
 * Gestión de estado de conversaciones
 * Usa Redis si está disponible, sino memoria local
 */

const config = require('./config');
const { isSameProduct } = require('./product-catalog');

const sessionTTLHours = config.redis?.ttlHours || 72;
const sessionTTLms = Math.max(sessionTTLHours, 1) * 60 * 60 * 1000;
const sessionHistoryLimit = Number(process.env.SESSION_HISTORY_LIMIT || 12);
const sessionStorePrefix = String(process.env.SESSION_STORE_PREFIX || 'soporte:sessions:');

// Cache en memoria
const memorySessions = new Map();

// Redis client (lazy initialization)
let redisClient = null;
let redisAvailable = false;

function getRedisClient() {
  if (redisClient) return redisClient;
  if (!config.redis?.url) return null;
  
  try {
    const { createClient } = require('redis');
    redisClient = createClient({ 
      url: config.redis.url,
      socket: {
        connectTimeout: 5000, // 5 segundos timeout
        reconnectStrategy: false // No reintentar
      }
    });
    
    redisClient.on('error', () => {
      redisAvailable = false;
    });
    
    redisClient.on('connect', () => {
      redisAvailable = true;
    });
    
    // Conectar de forma no bloqueante
    redisClient.connect().catch(() => {
      redisAvailable = false;
    });
    
    return redisClient;
  } catch (error) {
    return null;
  }
}

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
  
  // Intentar Redis solo si está disponible
  if (redisAvailable) {
    try {
      const redis = getRedisClient();
      const data = await redis.get(`${sessionStorePrefix}${sessionId}`);
      if (data) {
        return JSON.parse(data);
      }
    } catch (error) {
      // Ignorar errores de Redis
    }
  }
  
  // Fallback a memoria
  return memorySessions.get(sessionId) || null;
}

async function getOrCreateSession(sessionId) {
  const existing = await getSession(sessionId);
  if (existing) return existing;
  
  return {
    id: sessionId,
    messages: [],
    currentProduct: null,
    supportFlow: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function saveSession(session) {
  if (!session?.id) return;
  
  // Guardar en Redis si está disponible
  if (redisAvailable) {
    try {
      const redis = getRedisClient();
      await redis.setEx(
        `${sessionStorePrefix}${session.id}`,
        Math.floor(sessionTTLms / 1000),
        JSON.stringify(session)
      );
    } catch (error) {
      // Ignorar errores
    }
  }
  
  // Siempre guardar en memoria como backup
  memorySessions.set(session.id, session);
  cleanupExpiredMemorySessions();
}

function pushMessage(session, message) {
  if (!session.messages) {
    session.messages = [];
  }
  
  session.messages.push(message);
  
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

async function getSessionStoreInfo() {
  return {
    backend: redisAvailable ? 'redis' : 'memory',
    connected: redisAvailable,
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
