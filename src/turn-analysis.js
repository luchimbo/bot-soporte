function buildTurnAnalysis({ userText, result, sessionSnapshot }) {
  const intent = result?.stateUpdate?.lastIntent || sessionSnapshot?.lastIntent || "consulta_general";
  const normalizedText = normalizeText(userText);
  const greetingOnly = isGreetingOnlyText(normalizedText);
  const orderNumber =
    extractOrderNumber(userText) || extractLastUserMatch(sessionSnapshot, extractOrderNumber) || null;
  const marketplaceUser =
    extractMarketplaceUser(userText) ||
    extractLastUserMatch(sessionSnapshot, extractMarketplaceUser) ||
    null;
  const attempts = countDiagnosticAttempts(sessionSnapshot);

  const explicitHumanRequest =
    /(hablar|pasame|pasar|quiero|prefiero).*(representante|asesor|humano|persona|ivan)/.test(
      normalizedText
    ) || /representante|asesor|humano|persona|ivan/.test(normalizedText);
  const warrantySignal =
    !greetingOnly &&
    (/garanti|rma|reemplazo|devolucion|reembolso|falla fisica|defecto/.test(normalizedText) ||
      intent === "devolucion");
  const unresolvedSignal =
    /sigue igual|no funcion|no sirve|continua igual|todavia no|aun no|no se solucion/.test(
      normalizedText
    );

  const escalate =
    !greetingOnly && (explicitHumanRequest || warrantySignal || (unresolvedSignal && attempts >= 2));
  const urgency = detectUrgency(normalizedText, escalate);

  return {
    intent,
    orderNumber,
    marketplaceUser,
    attempts,
    escalate,
    urgency,
  };
}

function countDiagnosticAttempts(sessionSnapshot) {
  const history = Array.isArray(sessionSnapshot?.messageHistory) ? sessionSnapshot.messageHistory : [];
  let attempts = 0;
  for (const message of history) {
    if (message?.role !== "assistant") {
      continue;
    }

    if (isDiagnosticMode(message?.meta?.mode)) {
      attempts += 1;
    }
  }

  return attempts;
}

function isDiagnosticMode(mode) {
  return [
    "ai-rag",
    "context-followup",
    "fallback-product-drift",
    "fallback-no-kb-hits",
    "fallback-no-llm-key",
    "fallback-llm-error",
  ].includes(String(mode || ""));
}

function extractOrderNumber(text) {
  const value = String(text || "");
  const explicitMatch = value.match(
    /(?:orden|pedido|order|compra)\s*(?:n(?:ro)?\.?|numero|#|:|-)?\s*([a-z0-9-]{4,})/i
  );
  if (explicitMatch?.[1]) {
    return explicitMatch[1].trim();
  }

  return null;
}

function extractMarketplaceUser(text) {
  const value = String(text || "");
  const match = value.match(
    /(?:usuario\s*(?:ml|mercado\s*libre)?|ml|mercado\s*libre)\s*(?:es|:|#|-)?\s*([a-z0-9._-]{3,})/i
  );
  if (!match?.[1]) {
    return null;
  }

  const candidate = match[1].trim();
  if (/^(si|no|hola|gracias)$/i.test(candidate)) {
    return null;
  }

  return candidate;
}

function detectUrgency(normalizedText, escalate) {
  if (/urgente|urgencia|hoy|ya|cuanto antes|enojad|molest|reclamo/.test(normalizedText)) {
    return "alta";
  }

  if (escalate) {
    return "media";
  }

  return "normal";
}

function extractLastUserMatch(sessionSnapshot, extractor) {
  const history = Array.isArray(sessionSnapshot?.messageHistory) ? sessionSnapshot.messageHistory : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== "user") {
      continue;
    }

    const value = extractor(message?.text || "");
    if (value) {
      return value;
    }
  }

  return null;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isGreetingOnlyText(normalizedText) {
  return /^(hola+|holis|buenas|buen dia|buenas tardes|buenas noches|hello|hey|ey)[!.? ]*$/.test(
    String(normalizedText || "").trim()
  );
}

module.exports = {
  buildTurnAnalysis,
};
