import { Chat } from "chat";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { createRedisState } from "@chat-adapter/state-redis";

import { registerBotHandlers } from "./handlers.mjs";
import { chatRuntime, updateChatRuntime } from "./runtime.mjs";

const redisUrl = resolveRedisUrl();
const whatsappConfig = resolveWhatsAppConfig();

export const bot = new Chat({
  userName: whatsappConfig.userName,
  adapters: {
    whatsapp: createWhatsAppAdapter(whatsappConfig),
  },
  state: createRedisState({ url: redisUrl }),
  onLockConflict: "force",
  logger: "info",
}).registerSingleton();

registerBotHandlers(bot);

let initializePromise = null;

export async function initializeChatBot() {
  if (!initializePromise) {
    initializePromise = bot.initialize().then(() => {
      updateChatRuntime({
        initializedAt: new Date().toISOString(),
      });
      return bot;
    });
  }

  return initializePromise;
}

export function getWhatsAppAdapter() {
  return bot.getAdapter("whatsapp");
}

export { chatRuntime };

function resolveRedisUrl() {
  const directUrl = String(process.env.REDIS_URL || "").trim();
  if (isValidRedisUrl(directUrl)) {
    return directUrl;
  }

  const host = String(process.env.REDISHOST || process.env.REDIS_HOST || "").trim();
  const port = String(process.env.REDISPORT || process.env.REDIS_PORT || "").trim();
  const username = String(process.env.REDISUSER || process.env.REDIS_USERNAME || "").trim();
  const password = String(process.env.REDISPASSWORD || process.env.REDIS_PASSWORD || "").trim();

  if (!host || !port) {
    throw new Error(
      "Redis no configurado. Defini REDIS_URL valido o REDISHOST/REDISPORT en Railway."
    );
  }

  const credentials = buildRedisCredentials(username, password);
  return `redis://${credentials}${host}:${port}`;
}

function buildRedisCredentials(username, password) {
  if (!username && !password) {
    return "";
  }

  const encodedUser = encodeURIComponent(username || "default");
  const encodedPassword = encodeURIComponent(password || "");
  return `${encodedUser}:${encodedPassword}@`;
}

function isValidRedisUrl(value) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return Boolean(url.hostname && url.port);
  } catch {
    return false;
  }
}

function resolveWhatsAppConfig() {
  return {
    accessToken: getCleanEnv("WHATSAPP_ACCESS_TOKEN"),
    appSecret: getCleanEnv("WHATSAPP_APP_SECRET"),
    phoneNumberId: getCleanEnv("WHATSAPP_PHONE_NUMBER_ID"),
    verifyToken: getCleanEnv("WHATSAPP_VERIFY_TOKEN"),
    userName: getCleanEnv("WHATSAPP_BOT_USERNAME") || "whatsapp-bot",
  };
}

function getCleanEnv(name) {
  const rawValue = String(process.env[name] || "").trim();
  if (rawValue.length >= 2) {
    const quote = rawValue[0];
    if ((quote === '"' || quote === "'") && rawValue[rawValue.length - 1] === quote) {
      return rawValue.slice(1, -1).trim();
    }
  }

  return rawValue;
}
