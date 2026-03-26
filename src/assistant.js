const { detectProductMention, isSameProduct } = require("./product-catalog");
const { searchSupportFaq, getSupportPolicyText } = require("./support-playbook");

const resolutionYesPattern = /^\s*(si|sí|perfecto|listo|resuelto|solucionado|ya funcion[oó]|ya pude|qued[oó]|anda|funciona)\s*[!.]*\s*$/i;
const resolutionNoPattern = /^\s*(no|nop|nope|n|sigue|sigue igual|no funcion[oó]|no pude|contin[uú]a|todavia no|aun no|persiste)\s*[!.]*\s*$/i;
const invoiceLabelPattern = /\b(?:factura|comprobante|ticket|pedido|orden)\s*(?:nro|numero|num|#|n°|:)?\s*([a-z0-9][a-z0-9\-\/]{3,})\b/i;
const issueSignalPattern = /\b(no funciona|no anda|falla|falla con|error|problema|inconveniente|no se escucha|no enciende|no conecta|no detecta|no reconoce|no responde|no suena|no sale sonido|se cuelga|se traba|se apaga|no prende|no carga|anda mal|distorsiona)\b/i;
const concreteIssuePattern = /\b(no funciona|no anda|falla|falla con|error|no se escucha|no enciende|no conecta|no detecta|no reconoce|no responde|no suena|no sale sonido|se cuelga|se traba|se apaga|no prende|no carga|anda mal|distorsiona)\b/i;
const greetingOnlyPattern = /^\s*(hola|buenas|buen dia|buen día|buenas tardes|buenas noches|consulta|ayuda)\s*[!.]*\s*$/i;
const sensitiveVariantTokens = new Set([
  "otg",
  "recording",
  "pack",
  "essential",
  "pro",
  "mini",
  "max",
  "mk2",
  "mk3",
  "mk4",
  "v2",
  "v3",
  "v4",
]);

const supportGreetingPrefix = buildSupportGreetingPrefix();

async function buildAssistantReply(userText, options = {}) {
  const text = String(userText || "").trim();
  const sessionContext = options.sessionContext || {};
  const normalizedText = normalize(text);
  const hasAssistantHistory = hasAssistantMessages(sessionContext.messages || []);
  const activeProductBeforeTurn = sessionContext.currentProduct || null;

  if (!text) {
    return buildReply({
      text: "Contame el producto, el problema y el numero de factura para que pueda ayudarte.",
      mode: "empty",
      stateUpdate: {},
      activeProduct: activeProductBeforeTurn,
      hasAssistantHistory,
    });
  }

  if (isResetCommand(normalizedText)) {
    return buildReply({
      text: "Perfecto. Empezamos de nuevo. Pasame el producto, el problema y el numero de factura.",
      mode: "reset",
      stateUpdate: {
        currentProduct: null,
        reportedProblem: null,
        invoiceNumber: null,
        supportFlow: null,
        humanActive: false,
      },
      activeProduct: null,
      hasAssistantHistory,
    });
  }

  const supportFlow = sessionContext.supportFlow || null;
  if (supportFlow?.stage === "awaiting_resolution_check") {
    return handleResolutionCheck({
      normalizedText,
      sessionContext,
      hasAssistantHistory,
    });
  }

  if (sessionContext.humanActive) {
    return buildReply({
      text: "Gracias. Ya deje tu caso derivado a un agente humano. Si queres, segui enviando video y detalles del problema para sumarlos a la revision.",
      mode: "human-handoff-followup",
      stateUpdate: {},
      activeProduct: activeProductBeforeTurn,
      hasAssistantHistory,
    });
  }

  const detectedProduct = extractProduct(text, sessionContext.currentProduct);
  const activeProduct = detectedProduct || sessionContext.currentProduct || null;
  const invoiceNumber = extractInvoiceNumber(text, sessionContext.invoiceNumber, supportFlow);
  const reportedProblem = extractProblem({
    text,
    normalizedText,
    activeProduct,
    existingProblem: sessionContext.reportedProblem,
    supportFlow,
  });

  const stateUpdate = {
    currentProduct: activeProduct,
    reportedProblem,
    invoiceNumber,
    humanActive: false,
  };

  if (!activeProduct) {
    return buildReply({
      text: "Para continuar necesito que me pases la marca y el modelo exacto del producto.",
      mode: "awaiting-product",
      stateUpdate: {
        ...stateUpdate,
        supportFlow: { stage: "awaiting_product" },
      },
      activeProduct,
      hasAssistantHistory,
    });
  }

  if (!reportedProblem) {
    return buildReply({
      text: `Perfecto, ya tengo el producto (${activeProduct.name}). Ahora contame cual es el problema exacto que estas teniendo.`,
      mode: "awaiting-problem",
      stateUpdate: {
        ...stateUpdate,
        supportFlow: { stage: "awaiting_problem" },
      },
      activeProduct,
      hasAssistantHistory,
    });
  }

  if (!invoiceNumber) {
    return buildReply({
      text: "Bien. Ahora pasame el numero de factura o comprobante para seguir con la consulta.",
      mode: "awaiting-invoice",
      stateUpdate: {
        ...stateUpdate,
        supportFlow: { stage: "awaiting_invoice" },
      },
      activeProduct,
      hasAssistantHistory,
    });
  }

  const faqHits = searchSupportFaq({
    userText: reportedProblem,
    activeProduct,
    topK: 1,
  });
  const faqMatch = faqHits[0] || null;

  if (!faqMatch) {
    return buildHumanHandoffReply({
      activeProduct,
      reportedProblem,
      invoiceNumber,
      hasAssistantHistory,
      stateUpdate,
      reason: "No encontre una resolucion en FAQ para este caso.",
    });
  }

  return buildReply({
    text: [
      faqMatch.approvedAnswer,
      "¿Con esto se resolvio el problema? Responde si o no.",
    ].join("\n\n"),
    mode: "faq-answer",
    stateUpdate: {
      ...stateUpdate,
      supportFlow: {
        stage: "awaiting_resolution_check",
        faqId: faqMatch.id,
      },
      humanActive: false,
    },
    activeProduct,
    hasAssistantHistory,
    hits: [faqMatch],
  });
}

function handleResolutionCheck({ normalizedText, sessionContext, hasAssistantHistory }) {
  const activeProduct = sessionContext.currentProduct || null;
  const stateUpdate = {
    currentProduct: activeProduct,
    reportedProblem: sessionContext.reportedProblem || null,
    invoiceNumber: sessionContext.invoiceNumber || null,
  };

  if (resolutionYesPattern.test(normalizedText)) {
    return buildReply({
      text: "Perfecto, me alegra que haya quedado resuelto. Si necesitas abrir un caso nuevo, escribime de nuevo con el producto, el problema y el numero de factura.",
      mode: "faq-resolved",
      stateUpdate: {
        ...stateUpdate,
        supportFlow: null,
        humanActive: false,
      },
      activeProduct,
      hasAssistantHistory,
    });
  }

  if (resolutionNoPattern.test(normalizedText)) {
    return buildHumanHandoffReply({
      activeProduct,
      reportedProblem: sessionContext.reportedProblem || null,
      invoiceNumber: sessionContext.invoiceNumber || null,
      hasAssistantHistory,
      stateUpdate,
      reason: "La solucion de FAQ no resolvio el problema.",
    });
  }

  return buildReply({
    text: "Necesito que me respondas si o no para saber si el problema se resolvio o si tengo que derivarlo a un humano.",
    mode: "faq-resolution-check",
    stateUpdate,
    activeProduct,
    hasAssistantHistory,
  });
}

function buildHumanHandoffReply({
  activeProduct,
  reportedProblem,
  invoiceNumber,
  hasAssistantHistory,
  stateUpdate,
  reason,
}) {
  const lines = [
    activeProduct?.name ? `Producto: ${activeProduct.name}.` : null,
    reportedProblem ? `Problema reportado: ${reportedProblem}.` : null,
    invoiceNumber ? `Factura: ${invoiceNumber}.` : null,
    "Voy a derivar tu caso a un agente humano.",
    "Por favor enviame un video donde se vea el problema y contame mas detalles de la falla, asi el equipo puede revisarlo mejor.",
    "Nuestro equipo humano responde de 9 a 14 hs.",
  ];

  return buildReply({
    text: lines.filter(Boolean).join("\n"),
    mode: "human-triage",
    stateUpdate: {
      ...stateUpdate,
      supportFlow: {
        stage: "handoff_human",
        reason,
      },
      humanActive: true,
    },
    activeProduct,
    hasAssistantHistory,
    handoffReason: reason,
    handoffMetadata: {
      product: activeProduct?.name || null,
      problem: reportedProblem || null,
      invoiceNumber: invoiceNumber || null,
    },
  });
}

function extractProduct(text, currentProduct) {
  const mention = detectBestProductMention(text, currentProduct);

  if (!mention?.product) {
    return currentProduct || null;
  }

  if (!isReliableProductMatch(text, mention.product)) {
    return currentProduct || null;
  }

  if (currentProduct && !isSameProduct(currentProduct, mention.product) && mention.confidence === "low") {
    return currentProduct;
  }

  return mention.product;
}

function detectBestProductMention(text, currentProduct) {
  const candidateTexts = [extractLikelyProductSegment(text), text].filter(Boolean);

  for (const candidateText of candidateTexts) {
    const mention = detectProductMention(candidateText, {
      minConfidence: currentProduct ? "medium" : "medium",
    });

    if (mention?.product) {
      return mention;
    }
  }

  return null;
}

function extractLikelyProductSegment(text) {
  const value = String(text || "");
  if (!value.trim()) {
    return "";
  }

  const withoutInvoice = value.replace(invoiceLabelPattern, " ");
  const issueMatch = withoutInvoice.match(issueSignalPattern);
  if (issueMatch?.index > 0) {
    return withoutInvoice.slice(0, issueMatch.index).trim(" ,.-");
  }

  return withoutInvoice.trim();
}

function isReliableProductMatch(text, product) {
  const normalizedText = normalize(String(text || "").replace(invoiceLabelPattern, " "));
  const normalizedProduct = normalize(product?.normalizedName || product?.name || "");
  if (!normalizedText || !normalizedProduct) {
    return false;
  }

  const textTokens = tokenize(normalizedText).filter((token) => token.length >= 2);
  const productTokens = tokenize(normalizedProduct).filter((token) => token.length >= 3);
  const overlap = productTokens.filter((token) => !isGenericProductToken(token) && textTokens.includes(token));

  if (overlap.length === 0) {
    return false;
  }

  const textNumbers = normalizedText.match(/\b\d+[a-z]*\b/g) || [];
  const productNumbers = normalizedProduct.match(/\b\d+[a-z]*\b/g) || [];
  if (textNumbers.length > 0 && !textNumbers.every((value) => productNumbers.includes(value))) {
    return false;
  }

  const missingSensitiveVariants = productTokens.filter(
    (token) => sensitiveVariantTokens.has(token) && !textTokens.includes(token)
  );
  if (missingSensitiveVariants.length > 0) {
    return false;
  }

  return true;
}

function extractInvoiceNumber(text, existingInvoice, supportFlow) {
  if (existingInvoice) {
    return existingInvoice;
  }

  const labeledMatch = String(text || "").match(invoiceLabelPattern);
  if (labeledMatch?.[1]) {
    return labeledMatch[1].trim();
  }

  if (supportFlow?.stage === "awaiting_invoice") {
    const genericMatch = String(text || "").match(/\b([a-z0-9][a-z0-9\-\/]{3,})\b/i);
    if (genericMatch?.[1]) {
      return genericMatch[1].trim();
    }
  }

  return null;
}

function extractProblem({ text, normalizedText, activeProduct, existingProblem, supportFlow }) {
  if (existingProblem) {
    return existingProblem;
  }

  if (!text || greetingOnlyPattern.test(text) || resolutionYesPattern.test(normalizedText) || resolutionNoPattern.test(normalizedText)) {
    return null;
  }

  if (supportFlow?.stage === "awaiting_problem") {
    return limitText(text, 500);
  }

  let candidate = String(text || "");
  candidate = candidate.replace(invoiceLabelPattern, " ");
  candidate = candidate.replace(/\b(?:factura|comprobante|ticket|pedido|orden)\b/gi, " ");

  if (activeProduct?.name) {
    const safeProductName = escapeRegExp(activeProduct.name);
    candidate = candidate.replace(new RegExp(safeProductName, "ig"), " ");
  }

  candidate = candidate.replace(/\b(?:arturia|midiplus|alctron|alesis|novation|akai|m-audio)\b/gi, " ");
  candidate = candidate.replace(/\s+/g, " ").trim();
  const normalizedCandidate = normalize(candidate);

  if (!candidate) {
    return null;
  }

  if (isVagueProblemStatement(normalizedCandidate)) {
    return null;
  }

  if (concreteIssuePattern.test(normalizedText)) {
    return limitText(candidate, 500);
  }

  const tokens = candidate.split(/\s+/).filter(Boolean);
  if (tokens.length >= 5 && !isGenericOnlyIssue(normalizedCandidate)) {
    return limitText(candidate, 500);
  }

  return null;
}

function buildReply({
  text,
  mode,
  stateUpdate,
  activeProduct,
  hasAssistantHistory,
  hits = [],
  handoffReason = null,
  handoffMetadata = null,
}) {
  return {
    text: maybePrependSupportIntro(text, hasAssistantHistory),
    mode,
    hits,
    styleExamples: [],
    stateUpdate,
    activeProduct,
    detectedProduct: activeProduct,
    handoffReason,
    handoffMetadata,
  };
}

function maybePrependSupportIntro(replyText, hasAssistantHistory) {
  if (hasAssistantHistory) {
    return replyText;
  }

  return [supportGreetingPrefix, replyText].filter(Boolean).join("\n\n");
}

function buildSupportGreetingPrefix() {
  const intro = getSupportPolicyText(
    "presentacion_bot",
    "Hola. Soy un asistente virtual de soporte de PC MIDI Center."
  );
  const humanHours = getSupportPolicyText(
    "horario_humano",
    "Si hace falta intervencion humana, el equipo responde de 9 a 14 hs."
  );

  return [intro, humanHours].filter(Boolean).join("\n");
}

function hasAssistantMessages(history) {
  return Array.isArray(history) && history.some((item) => item?.role === "assistant");
}

function isResetCommand(normalizedText) {
  return normalizedText === "/nuevo" || normalizedText === "nuevo";
}

function getLLMStatus() {
  return {
    available: false,
    provider: null,
    model: null,
    reason: "disabled_for_faq_only_flow",
  };
}

function limitText(text, max) {
  const value = String(text || "").trim();
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenize(text) {
  return normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
}

function isGenericProductToken(token) {
  return [
    "arturia",
    "midiplus",
    "alctron",
    "mini",
    "pack",
    "edition",
    "black",
    "white",
    "placa",
    "sonido",
    "audio",
    "interface",
    "interfaz",
  ].includes(token);
}

function isVagueProblemStatement(normalizedCandidate) {
  if (!normalizedCandidate) {
    return false;
  }

  const genericOnly = [
    /^tengo un problema(?: con)?$/,
    /^tengo un inconveniente(?: con)?$/,
    /^tengo un error(?: con)?$/,
    /^hay un problema(?: con)?$/,
    /^hay un inconveniente(?: con)?$/,
    /^problema$/,
    /^inconveniente$/,
    /^error$/,
  ];

  if (genericOnly.some((pattern) => pattern.test(normalizedCandidate))) {
    return true;
  }

  return /^(tengo|hay|es|tiene)?\s*(un|una)?\s*(problema|inconveniente|error)\s+con\s+(mi|un|una|el|la)?\s*[a-z0-9\s-]+$/.test(normalizedCandidate)
    && !concreteIssuePattern.test(normalizedCandidate);
}

function isGenericOnlyIssue(normalizedCandidate) {
  return /\b(problema|inconveniente|error)\b/.test(normalizedCandidate)
    && !concreteIssuePattern.test(normalizedCandidate);
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  buildAssistantReply,
  getLLMStatus,
};
