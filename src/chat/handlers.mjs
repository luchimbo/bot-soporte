import { chatRuntime, updateChatRuntime } from "./runtime.mjs";
import { runSupportTurn } from "./run-support-turn.mjs";

export function registerBotHandlers(bot) {
  if (chatRuntime.handlersRegistered) {
    return;
  }

  bot.onDirectMessage(async (thread, message) => {
    await thread.subscribe();
    await processInboundTurn(thread, message, "direct-message");
  });

  bot.onSubscribedMessage(async (thread, message) => {
    await processInboundTurn(thread, message, "subscribed-message");
  });

  updateChatRuntime({
    handlersRegistered: true,
  });
}

async function processInboundTurn(thread, message, source) {
  updateChatRuntime({
    lastWebhookStatus: source,
    lastThreadId: thread.id,
    lastMessagePreview: String(message?.text || "").slice(0, 160) || null,
    lastError: null,
  });

  try {
    const turn = await runSupportTurn({ thread, message });
    await thread.post(turn.replyText);

    updateChatRuntime({
      lastWebhookStatus: "replied",
      lastThreadId: thread.id,
      lastMessagePreview: turn.userPreview,
      lastReplyAt: new Date().toISOString(),
      lastReplyPreview: String(turn.replyText || "").slice(0, 160) || null,
      lastKommoSyncAt: new Date().toISOString(),
      lastKommoSyncStatus: turn.kommoSync?.ok
        ? "ok"
        : turn.kommoSync?.skipped
          ? `skipped:${turn.kommoSync.reason}`
          : turn.kommoSync?.error
            ? "error"
            : "idle",
      lastKommoSyncError: turn.kommoSync?.ok || turn.kommoSync?.skipped ? null : turn.kommoSync?.error || null,
    });
  } catch (error) {
    updateChatRuntime({
      lastWebhookStatus: "error",
      lastError: error?.message || "chat-turn-error",
      lastKommoSyncStatus: "idle",
      lastKommoSyncError: null,
    });

    try {
      await thread.post(
        "Se corto el procesamiento del mensaje. Reenviamelo o escribi /nuevo para reiniciar la conversacion."
      );
    } catch (postError) {
      updateChatRuntime({
        lastError: `${error?.message || "chat-turn-error"} | fallback-post: ${postError?.message || "unknown"}`,
      });
    }
  }
}
