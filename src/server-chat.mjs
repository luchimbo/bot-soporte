import "dotenv/config";

import express from "express";
import { createRequire } from "node:module";

import { initializeChatBot, getWhatsAppAdapter, chatRuntime } from "./chat/bot.mjs";
import { forwardChatSdkWebhook } from "./chat/http-bridge.mjs";

const require = createRequire(import.meta.url);

const { app: legacyApp, runtime: legacyRuntime } = require("./server.js");
const { getLLMStatus } = require("./assistant.js");
const { getKnowledgeBaseInfo } = require("./knowledge-base.js");
const { getProductCatalogInfo } = require("./product-catalog.js");
const { getSessionStoreInfo } = require("./conversation-state.js");
const { getKommoStatus } = require("./kommo-client.js");
const { getSupportPlaybookInfo } = require("./support-playbook.js");

const port = Number(process.env.PORT || 3000);
const app = express();
const rawWebhookParser = express.raw({ type: "*/*", limit: "2mb" });

await initializeChatBot();

app.get("/api/webhooks/whatsapp", async (req, res) => {
  await forwardChatSdkWebhook({
    req,
    res,
    handler: (request, options) => getWhatsAppAdapter().handleWebhook(request, options),
  });
});

app.post("/api/webhooks/whatsapp", rawWebhookParser, async (req, res) => {
  await forwardChatSdkWebhook({
    req,
    res,
    handler: (request, options) => getWhatsAppAdapter().handleWebhook(request, options),
  });
});

app.get("/health", async (_req, res) => {
  const llm = getLLMStatus();
  const knowledgeBase = getKnowledgeBaseInfo();
  const productCatalog = getProductCatalogInfo();
  const supportPlaybook = getSupportPlaybookInfo();
  const sessions = await getSessionStoreInfo();
  const kommo = getKommoStatus();

  res.status(200).json({
    ok: true,
    llmEnabled: llm.enabled,
    openAIEnabled: llm.enabled,
    llm,
    knowledgeBase,
    productCatalog,
    supportPlaybook,
    sessions,
    whatsapp: {
      mockSend: String(process.env.MOCK_WHATSAPP_SEND || "false").trim().toLowerCase() === "true",
      verifyTokenConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      accessTokenConfigured: Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      phoneNumberIdConfigured: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
      appSecretConfigured: Boolean(process.env.WHATSAPP_APP_SECRET),
    },
    kommo,
    runtime: legacyRuntime,
    chatSdk: {
      enabled: true,
      redisConfigured: Boolean(process.env.REDIS_URL),
      whatsappConfigured: Boolean(
        process.env.WHATSAPP_ACCESS_TOKEN &&
          process.env.WHATSAPP_PHONE_NUMBER_ID &&
          process.env.WHATSAPP_VERIFY_TOKEN &&
          process.env.WHATSAPP_APP_SECRET
      ),
      ...chatRuntime,
    },
  });
});

app.use(legacyApp);

app.listen(port, () => {
  console.log(`Servidor Chat SDK listo en http://localhost:${port}`);
});
