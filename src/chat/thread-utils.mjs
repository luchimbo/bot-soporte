export function buildSessionId(thread) {
  return String(thread?.id || "whatsapp:unknown");
}

export function extractWhatsAppUserId(thread, message) {
  const directUserId = String(message?.author?.userId || "").trim();
  if (directUserId) {
    return directUserId;
  }

  const decoded = decodeWhatsAppThreadId(thread?.id);
  return decoded?.userWaId || null;
}

export function extractWhatsAppPhoneNumberId(thread) {
  const decoded = decodeWhatsAppThreadId(thread?.id);
  return decoded?.phoneNumberId || null;
}

export function decodeWhatsAppThreadId(threadId) {
  const parts = String(threadId || "").split(":");
  if (parts.length < 3 || parts[0] !== "whatsapp") {
    return null;
  }

  return {
    adapter: parts[0],
    phoneNumberId: parts[1],
    userWaId: parts.slice(2).join(":"),
  };
}

export function buildContactLabel(message) {
  const fullName = String(message?.author?.fullName || "").trim();
  if (fullName) {
    return fullName;
  }

  const userName = String(message?.author?.userName || "").trim();
  if (userName) {
    return userName;
  }

  return extractWhatsAppUserId(null, message) || "Cliente WhatsApp";
}

export function describeInboundMessage(message) {
  const text = String(message?.text || "").trim();
  if (text) {
    return text;
  }

  const rawType = String(message?.raw?.message?.type || "").trim();
  if (rawType) {
    return `[${rawType}]`;
  }

  return "";
}
