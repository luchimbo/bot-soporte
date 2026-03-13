export const chatRuntime = {
  enabled: true,
  initializedAt: null,
  handlersRegistered: false,
  lastWebhookAt: null,
  lastWebhookStatus: "idle",
  lastThreadId: null,
  lastMessagePreview: null,
  lastReplyAt: null,
  lastReplyPreview: null,
  lastKommoSyncAt: null,
  lastKommoSyncStatus: "idle",
  lastKommoSyncError: null,
  lastError: null,
};

export function updateChatRuntime(patch) {
  Object.assign(chatRuntime, patch);
}
