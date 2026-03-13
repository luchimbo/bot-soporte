import { Chat } from "chat";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { createRedisState } from "@chat-adapter/state-redis";

import { registerBotHandlers } from "./handlers.mjs";
import { chatRuntime, updateChatRuntime } from "./runtime.mjs";

export const bot = new Chat({
  userName: process.env.WHATSAPP_BOT_USERNAME || "whatsapp-bot",
  adapters: {
    whatsapp: createWhatsAppAdapter(),
  },
  state: createRedisState(),
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
