const OpenAI = require("openai");
const { buildSupportReply } = require("./bot");
const { searchKnowledgeBase, searchHistoricalResponses } = require("./knowledge-base");
const {
  detectProductMention,
  buildProductSearchContext,
  isSameProduct,
} = require("./product-catalog");

const topK = Number(process.env.KB_TOP_K || 4);
const styleTopK = Number(process.env.STYLE_TOP_K || 3);
const manualTopK = Number(process.env.KB_MANUAL_TOP_K || 2);
const openAITimeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 30000);
const productMinMatchScore = Number(process.env.PRODUCT_MATCH_MIN_SCORE || 7);

const productClarifyCosmeticTokens = new Set([
  "black",
  "white",
  "alpine",
  "aquamarine",
  "orange",
  "chroma",
  "rose",
  "quartz",
  "deep",
  "champagne",
  "edition",
]);

const productClarifyGenericTokens = new Set([
  "controlador",
  "midi",
  "teclado",
  "musical",
  "de",
  "del",
  "la",
  "el",
  "y",
]);

const productVariantHintTokens = new Set([
  "essential",
  "pro",
  "mini",
  "plus",
  "max",
  "lite",
  "air",
  "go",
]);

let llmClient = null;
let llmClientSignature = null;

function getLLMClient() {
  const config = resolveLLMConfig();
  if (!config.apiKey) {
    return null;
  }

  const signature = JSON.stringify({
    provider: config.provider,
    model: config.model,
    baseURL: config.baseURL || "",
    hasReferer: Boolean(config.defaultHeaders?.["HTTP-Referer"]),
    hasTitle: Boolean(config.defaultHeaders?.["X-Title"]),
    keyLength: config.apiKey.length,
  });

  if (!llmClient || llmClientSignature !== signature) {
    llmClient = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      defaultHeaders: config.defaultHeaders,
    });
    llmClientSignature = signature;
  }

  return {
    client: llmClient,
    config,
  };
}

async function buildAssistantReply(userText, options = {}) {
  const text = String(userText || "").trim();
  const sessionContext = options.sessionContext || {};

  if (!text) {
    return {
      text: buildSupportReply(text),
      mode: "fallback-empty",
      hits: [],
      styleExamples: [],
      stateUpdate: {},
      activeProduct: sessionContext.currentProduct || null,
      detectedProduct: null,
    };
  }

  const productResolution = resolveProductForTurn(text, sessionContext);
  const stateUpdate = {
    ...productResolution.stateUpdate,
  };

  if (productResolution.clarificationText) {
    return {
      text: productResolution.clarificationText,
      mode: "product-clarification",
      hits: [],
      styleExamples: [],
      stateUpdate,
      activeProduct: productResolution.activeProduct || sessionContext.currentProduct || null,
      detectedProduct: productResolution.detectedProduct,
    };
  }

  if (productResolution.askForProductText) {
    return {
      text: productResolution.askForProductText,
      mode: "needs-product",
      hits: [],
      styleExamples: [],
      stateUpdate,
      activeProduct: sessionContext.currentProduct || null,
      detectedProduct: productResolution.detectedProduct,
    };
  }

  const activeProduct = productResolution.activeProduct || sessionContext.currentProduct || null;
  const productContext = activeProduct ? buildProductSearchContext(activeProduct) : null;

  if (activeProduct && !stateUpdate.currentProduct) {
    stateUpdate.currentProduct = activeProduct;
  }

  const retrievalQuery = buildRetrievalQuery({
    userText: text,
    sessionContext,
    activeProduct,
  });

  const historicalHits = searchKnowledgeBase(retrievalQuery, topK, {
    productContext,
    allowedSources: ["whatsapp", "email"],
  });

  const manualHits = searchKnowledgeBase(retrievalQuery, manualTopK, {
    productContext,
    allowedSources: ["manual_arturia"],
  });

  const hits = mergeKnowledgeHits({
    historicalHits,
    manualHits,
    maxTotal: Math.max(topK + manualTopK, topK),
  });

  const preferredCategory =
    historicalHits[0]?.category || manualHits[0]?.category || detectIntentFromText(text);
  stateUpdate.lastIntent = preferredCategory;

  const styleExamples = searchHistoricalResponses(retrievalQuery, styleTopK, preferredCategory, {
    productContext,
  });

  if (activeProduct && isFollowupSignal(normalize(text))) {
    return {
      text: buildContinuationReply({
        activeProduct,
        hits,
      }),
      mode: "context-followup",
      hits,
      styleExamples,
      stateUpdate,
      activeProduct,
      detectedProduct: productResolution.detectedProduct,
    };
  }

  if (hits.length === 0) {
    return {
      text: buildKnowledgeFallbackReply(text, hits, activeProduct),
      mode: "fallback-no-kb-hits",
      hits,
      styleExamples,
      stateUpdate,
      activeProduct,
      detectedProduct: productResolution.detectedProduct,
    };
  }

  const llm = getLLMClient();
  if (!llm) {
    return {
      text: buildKnowledgeFallbackReply(text, hits, activeProduct),
      mode: "fallback-no-llm-key",
      hits,
      styleExamples,
      stateUpdate,
      activeProduct,
      detectedProduct: productResolution.detectedProduct,
    };
  }

  try {
    const aiReply = await generateAIReply({
      client: llm.client,
      model: llm.config.model,
      userText: text,
      sessionContext,
      activeProduct,
      hits,
      styleExamples,
    });

    if (aiReply) {
      const drift = detectProductDrift(aiReply, activeProduct);
      if (drift) {
        stateUpdate.productDriftPrevented = true;
        return {
          text: buildProductSafeReply({
            userText: text,
            activeProduct,
            hits,
          }),
          mode: "fallback-product-drift",
          hits,
          styleExamples,
          stateUpdate,
          activeProduct,
          detectedProduct: productResolution.detectedProduct,
        };
      }

      return {
        text: limitText(aiReply, 2200),
        mode: "ai-rag",
        hits,
        styleExamples,
        stateUpdate,
        activeProduct,
        detectedProduct: productResolution.detectedProduct,
      };
    }
  } catch (error) {
    const msg = error.response?.data || error.message;
    console.error("LLM error:", msg);
  }

  return {
    text: buildKnowledgeFallbackReply(text, hits, activeProduct),
    mode: "fallback-llm-error",
    hits,
    styleExamples,
    stateUpdate,
    activeProduct,
    detectedProduct: productResolution.detectedProduct,
  };
}

async function generateAIReply({
  client,
  model,
  userText,
  sessionContext,
  activeProduct,
  hits,
  styleExamples,
}) {
  const contextText = hits
    .map((hit, index) => {
      const source = hit.source || "desconocido";
      const category = hit.category || "consulta_general";
      const date = hit.createdAt || "sin_fecha";
      const snippet = limitText(hit.text || "", 420);
      const isManual = isManualSource(source);

      return [
        isManual ? `Referencia tecnica ${index + 1}` : `Caso ${index + 1}`,
        `Fuente: ${source}`,
        `Categoria: ${category}`,
        `Fecha: ${date}`,
        isManual ? `Manual: ${hit.metadata?.fileName || "sin_archivo"}` : null,
        isManual && hit.metadata?.page ? `Pagina: ${hit.metadata.page}` : null,
        isManual && hit.metadata?.manualModelLabel
          ? `Modelo manual: ${hit.metadata.manualModelLabel}`
          : null,
        `Contenido: ${snippet}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");

  const styleText = styleExamples
    .map((example, index) => {
      const userSnippet = limitText(example.userText || "", 200);
      const agentSnippet = limitText(example.agentReply || "", 240);

      return [
        `Ejemplo ${index + 1}`,
        `Categoria: ${example.category || "consulta_general"}`,
        `Consulta: ${userSnippet}`,
        `Respuesta historica: ${agentSnippet}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const conversationText = formatRecentConversation(sessionContext?.messageHistory || []);
  const productLine = activeProduct
    ? `${activeProduct.name}${activeProduct.sku ? ` (SKU ${activeProduct.sku})` : ""}`
    : "No confirmado";

  const systemPrompt = [
    "Sos un asistente de soporte tecnico por WhatsApp de una tienda de instrumentos.",
    "Reglas obligatorias:",
    "- Usa solo la informacion de los casos y manuales recuperados.",
    "- No inventes politicas ni datos faltantes.",
    "- Si falta informacion para resolver, pedi maximo 2 datos concretos.",
    "- Responde en espanol claro, con pasos cortos y accionables.",
    "- Segui el estilo historico (tono y estructura) sin copiar literal.",
    "- Si la evidencia tecnica esta en ingles, traducila a pasos claros en espanol.",
    "- Si detectas devolucion o garantia, indica requisitos y orden de pasos.",
    "- Si no hay evidencia suficiente, sugeri pasar con humano.",
    activeProduct
      ? "- Producto bloqueado para este chat: mantenete en ese producto y no cambies a otro modelo."
      : "- Si no hay producto confirmado, pedi producto/modelo antes de diagnosticar.",
  ].join("\n");

  const userPrompt = [
    "Producto en seguimiento:",
    productLine,
    "",
    "Conversacion reciente:",
    conversationText || "Sin contexto adicional.",
    "",
    "Consulta actual del cliente:",
    userText,
    "",
    "Casos recuperados:",
    contextText,
    "",
    "Ejemplos historicos de soporte:",
    styleText || "No hay ejemplos historicos disponibles.",
    "",
    "Arma la mejor respuesta para WhatsApp.",
  ].join("\n");

  const completion = await withTimeout(
    client.chat.completions.create({
      model,
      temperature: 0.15,
      max_tokens: 300,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
    openAITimeoutMs,
    "LLM tardo demasiado"
  );

  return completion.choices?.[0]?.message?.content?.trim() || null;
}

function resolveProductForTurn(text, sessionContext) {
  const normalizedText = normalize(text);
  const currentProduct = sessionContext?.currentProduct || null;
  const pendingProductSwitch = sessionContext?.pendingProductSwitch || null;

  const detectedMention = detectProductMention(text, {
    minScore: productMinMatchScore,
  });

  const stateUpdate = {};
  const detectedProduct = detectedMention?.product || null;

  if (pendingProductSwitch) {
    if (indicatesKeepCurrent(normalizedText) && currentProduct) {
      stateUpdate.clearPendingProductSwitch = true;
      return {
        activeProduct: currentProduct,
        detectedProduct,
        stateUpdate,
      };
    }

    if (detectedProduct && isSameOrCompatibleProduct(detectedProduct, pendingProductSwitch)) {
      stateUpdate.currentProduct = pendingProductSwitch;
      stateUpdate.clearPendingProductSwitch = true;
      return {
        activeProduct: pendingProductSwitch,
        detectedProduct,
        stateUpdate,
      };
    }

    if (detectedProduct && currentProduct && isSameOrCompatibleProduct(detectedProduct, currentProduct)) {
      stateUpdate.clearPendingProductSwitch = true;
      return {
        activeProduct: currentProduct,
        detectedProduct,
        stateUpdate,
      };
    }

    if (isAffirmative(normalizedText)) {
      stateUpdate.currentProduct = pendingProductSwitch;
      stateUpdate.clearPendingProductSwitch = true;
      return {
        activeProduct: pendingProductSwitch,
        detectedProduct,
        stateUpdate,
      };
    }

    return {
      activeProduct: currentProduct,
      detectedProduct,
      stateUpdate,
      clarificationText: buildPendingSwitchPrompt(currentProduct, pendingProductSwitch),
    };
  }

  if (detectedProduct) {
    if (!currentProduct) {
      const versionClarification = buildVersionClarificationPrompt(normalizedText, detectedMention);
      const shouldClarifyVersion =
        Boolean(versionClarification) && sessionContext?.lastMode !== "product-clarification";

      if (shouldClarifyVersion) {
        return {
          activeProduct: null,
          detectedProduct,
          stateUpdate,
          clarificationText: versionClarification,
        };
      }

      stateUpdate.currentProduct = detectedProduct;
      return {
        activeProduct: detectedProduct,
        detectedProduct,
        stateUpdate,
      };
    }

    if (isSameOrCompatibleProduct(detectedProduct, currentProduct)) {
      return {
        activeProduct: currentProduct,
        detectedProduct,
        stateUpdate,
      };
    }

    if (shouldSwitchProduct(normalizedText, detectedMention)) {
      stateUpdate.currentProduct = detectedProduct;
      stateUpdate.clearPendingProductSwitch = true;
      return {
        activeProduct: detectedProduct,
        detectedProduct,
        stateUpdate,
      };
    }

    stateUpdate.pendingProductSwitch = detectedProduct;
    return {
      activeProduct: currentProduct,
      detectedProduct,
      stateUpdate,
      clarificationText: buildProductSwitchPrompt(currentProduct, detectedProduct),
    };
  }

  if (currentProduct) {
    return {
      activeProduct: currentProduct,
      detectedProduct,
      stateUpdate,
    };
  }

  if (requiresProductBeforeDiagnosis(normalizedText)) {
    return {
      activeProduct: null,
      detectedProduct,
      stateUpdate,
      askForProductText:
        "Para ayudarte bien necesito el producto/modelo exacto (ejemplo: Arturia KeyLab 61 MK3 o el SKU). Asi evitamos confusiones con otros modelos.",
    };
  }

  return {
    activeProduct: null,
    detectedProduct,
    stateUpdate,
  };
}

function shouldSwitchProduct(normalizedText, detectedMention) {
  if (!detectedMention) {
    return false;
  }

  if (hasSwitchCue(normalizedText)) {
    return true;
  }

  if (isContinuationMessage(normalizedText)) {
    return false;
  }

  if (detectedMention.confidence === "high") {
    return true;
  }

  if (detectedMention.confidence === "medium" && /\b(compre|compre|tengo|mi|modelo|es un|es una)\b/.test(normalizedText)) {
    return true;
  }

  return false;
}

function buildRetrievalQuery({ userText, sessionContext, activeProduct }) {
  const parts = [userText];

  if (activeProduct) {
    parts.push(
      `Producto actual: ${activeProduct.name}${activeProduct.sku ? ` SKU ${activeProduct.sku}` : ""}`
    );
  }

  const previousUserMessages = extractPreviousUserMessages(
    sessionContext?.messageHistory || [],
    userText
  );

  if (previousUserMessages.length > 0) {
    parts.push(`Mensajes previos del cliente: ${previousUserMessages.join(" | ")}`);
  }

  return parts.join("\n");
}

function mergeKnowledgeHits({ historicalHits = [], manualHits = [], maxTotal = 6 }) {
  const seen = new Set();
  const merged = [];
  const ordered = [...historicalHits, ...manualHits];

  for (const hit of ordered) {
    if (!hit || !hit.id) {
      continue;
    }

    if (seen.has(hit.id)) {
      continue;
    }

    seen.add(hit.id);
    merged.push(hit);
    if (merged.length >= maxTotal) {
      break;
    }
  }

  return merged;
}

function isManualSource(source) {
  return String(source || "").startsWith("manual_");
}

function extractManualSnippet(text, max = 260) {
  const raw = String(text || "").trim();
  if (!raw) {
    return "";
  }

  const body = raw.includes("\n") ? raw.slice(raw.indexOf("\n") + 1) : raw;
  const compact = body.replace(/\s+/g, " ").trim();
  return limitText(compact, max);
}

function detectProductDrift(replyText, activeProduct) {
  if (!activeProduct || !replyText) {
    return null;
  }

  const mention = detectProductMention(replyText, {
    minScore: Math.max(productMinMatchScore + 6, 14),
    minConfidence: "high",
  });

  if (!mention) {
    return null;
  }

  if (!isSameOrCompatibleProduct(mention.product, activeProduct)) {
    return mention.product;
  }

  return null;
}

function buildProductSafeReply({ userText, activeProduct, hits }) {
  const intent = hits[0]?.category || detectIntentFromText(userText);
  const productLabel = activeProduct?.name || "tu producto";

  if (intent === "devolucion") {
    return [
      `Sigamos con ${productLabel}.`,
      "Para iniciar la devolucion necesito:",
      "1) Fecha y canal de compra (ML, web o local).",
      "2) Numero de compra o comprobante.",
      "3) Estado actual del producto y accesorios.",
    ].join("\n");
  }

  return [
    `Sigamos con ${productLabel}.`,
    "Contame que paso en la ultima prueba y que mensaje exacto ves.",
    "Si queres cambiar a otro producto, decimelo explicitamente.",
  ].join("\n");
}

function buildContinuationReply({ activeProduct, hits }) {
  const intent = hits[0]?.category || "falla_producto";
  const productLabel = activeProduct?.name || "tu producto";

  if (intent === "devolucion") {
    return [
      `Seguimos con ${productLabel}.`,
      "Para avanzar con la devolucion confirmame:",
      "1) Fecha de compra y canal (ML, web o local).",
      "2) Numero de compra o comprobante.",
      "3) Estado del producto y accesorios.",
    ].join("\n");
  }

  if (intent === "como_hacer") {
    return [
      `Seguimos con ${productLabel}.`,
      "Decime exactamente que paso te trabo y te doy el siguiente paso.",
      "Si aparece un error en pantalla, pasamelo textual.",
    ].join("\n");
  }

  return [
    `Seguimos con ${productLabel}.`,
    "Contame que prueba hiciste recien y que resultado te dio.",
    "Si aparece mensaje de error, pasamelo textual para darte el siguiente paso exacto.",
  ].join("\n");
}

function buildKnowledgeFallbackReply(userText, hits, activeProduct) {
  if (!hits || hits.length === 0) {
    if (activeProduct) {
      return [
        `Sigamos con ${activeProduct.name}.`,
        "Necesito que me indiques el problema exacto y desde cuando ocurre.",
      ].join("\n");
    }
    return buildSupportReply(userText);
  }

  const best = hits[0];
  const shortCase = limitText((best.text || "").replace(/\s+/g, " ").trim(), 220);
  const productLine = activeProduct ? `Producto en seguimiento: ${activeProduct.name}.` : "";

  if (isManualSource(best.source)) {
    const manualRef = [best.metadata?.fileName, best.metadata?.page ? `pag ${best.metadata.page}` : null]
      .filter(Boolean)
      .join(" - ");
    const snippet = extractManualSnippet(best.text, 260);

    return [
      productLine,
      "Encontre una referencia tecnica del manual para guiarte.",
      manualRef ? `Referencia interna: ${manualRef}` : null,
      snippet,
      "Si queres, te lo traduzco en pasos concretos para probar ahora.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (best.category === "devolucion") {
    return [
      productLine,
      "Te guio con devolucion segun casos similares.",
      "1) Confirmame producto/modelo.",
      "2) Fecha de compra y canal (ML, web o local).",
      "3) Si tenes comprobante o numero de compra.",
      `Referencia interna: ${shortCase}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (best.category === "falla_producto") {
    return [
      productLine,
      "Vamos a diagnosticarlo paso a paso con base en casos similares.",
      "1) Producto/modelo exacto.",
      "2) Que falla hace y desde cuando.",
      "3) Si aparece mensaje de error, pasamelo textual.",
      `Referencia interna: ${shortCase}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return buildSupportReply(userText);
}

function buildProductSwitchPrompt(currentProduct, detectedProduct) {
  if (!currentProduct || !detectedProduct) {
    return "Para no confundirme, confirmame producto y modelo exacto.";
  }

  return [
    `Para no confundirme: veniamos viendo ${currentProduct.name}.`,
    `Ahora queres que cambiemos a ${detectedProduct.name}?`,
    "Responde: 'seguimos con el mismo' o 'cambiamos'.",
  ].join("\n");
}

function buildPendingSwitchPrompt(currentProduct, pendingProduct) {
  if (!pendingProduct) {
    return "Confirmame con que producto seguimos.";
  }

  if (!currentProduct) {
    return [
      `Detecte este modelo: ${pendingProduct.name}.`,
      "Confirmame si seguimos con ese producto.",
    ].join("\n");
  }

  return [
    `Detecte dos productos: ${currentProduct.name} y ${pendingProduct.name}.`,
    "Decime cual queres tratar ahora para evitar confusiones.",
  ].join("\n");
}

function extractPreviousUserMessages(history, currentText) {
  if (!Array.isArray(history) || history.length === 0) {
    return [];
  }

  const users = history
    .filter((item) => item.role === "user" && item.text)
    .map((item) => String(item.text).trim());

  if (users.length === 0) {
    return [];
  }

  const currentNormalized = normalize(currentText);
  if (normalize(users[users.length - 1]) === currentNormalized) {
    users.pop();
  }

  return users.slice(-2);
}

function formatRecentConversation(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return "";
  }

  return history
    .slice(-6)
    .map((item) => {
      const role = item.role === "assistant" ? "Soporte" : "Cliente";
      const text = limitText(String(item.text || ""), 180);
      return `${role}: ${text}`;
    })
    .join("\n");
}

function requiresProductBeforeDiagnosis(normalizedText) {
  if (!normalizedText) {
    return false;
  }

  if (isGreeting(normalizedText)) {
    return false;
  }

  if (isContinuationMessage(normalizedText)) {
    return true;
  }

  return /falla|error|no funciona|no anda|devol|garanti|reembolso|como hago|configur|instal|reclamo|producto/i.test(
    normalizedText
  );
}

function isGreeting(normalizedText) {
  return /^(hola|buenas|buen dia|buenas tardes|buenas noches|hello)\b/.test(normalizedText);
}

function isContinuationMessage(normalizedText) {
  if (!normalizedText) {
    return false;
  }

  if (normalizedText.length <= 22) {
    return true;
  }

  return /\b(sigue|igual|no funciono|no anduvo|todavia|aun|continua|lo mismo|no cambio)\b/.test(
    normalizedText
  );
}

function isFollowupSignal(normalizedText) {
  return /\b(sigue|igual|no funciono|no anduvo|todavia|aun|continua|lo mismo|no cambio|persiste)\b/.test(
    normalizedText
  );
}

function hasSwitchCue(normalizedText) {
  return /\b(ahora|otro producto|otro modelo|tambien tengo|tambien|ademas|por otro lado|consulta de otro|cambiar de producto)\b/.test(
    normalizedText
  );
}

function indicatesKeepCurrent(normalizedText) {
  return /\b(mismo|seguimos con el mismo|ese mismo|el anterior|con ese)\b/.test(normalizedText);
}

function isAffirmative(normalizedText) {
  return /^(si|dale|ok|okay|de una|correcto|cambiamos|vamos con ese)\b/.test(normalizedText);
}

function detectIntentFromText(text) {
  const value = normalize(text);

  if (/devol|devolver|reembolso|reintegro|cambio/.test(value)) {
    return "devolucion";
  }

  if (/falla|error|defecto|no (anda|funciona|prende|enciende|conecta)|garanti|reclamo/.test(value)) {
    return "falla_producto";
  }

  if (/como (hago|configur|instal|uso)|ayuda|consulta/.test(value)) {
    return "como_hacer";
  }

  return "consulta_general";
}

function isSameOrCompatibleProduct(left, right) {
  if (!left || !right) {
    return false;
  }

  if (isSameProduct(left, right)) {
    return true;
  }

  const leftTokens = buildComparableProductTokens(left);
  const rightTokens = buildComparableProductTokens(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }

  const rightSet = new Set(rightTokens);
  let overlap = 0;
  let numericOverlap = 0;
  let longOverlap = 0;

  for (const token of leftTokens) {
    if (rightSet.has(token)) {
      overlap += 1;
      if (/\d/.test(token)) {
        numericOverlap += 1;
      }
      if (token.length >= 6) {
        longOverlap += 1;
      }
    }
  }

  if (overlap >= 4) {
    return true;
  }

  if (overlap >= 3 && numericOverlap >= 1) {
    return true;
  }

  if (overlap >= 2 && longOverlap >= 1) {
    return true;
  }

  return false;
}

function buildComparableProductTokens(product) {
  const value = normalize(product.normalizedName || product.name || "");
  if (!value) {
    return [];
  }

  const ignore = new Set([
    "controlador",
    "midi",
    "teclado",
    "musical",
    "black",
    "white",
    "edition",
    "alpine",
    "aquamarine",
    "orange",
    "chroma",
    "rose",
    "quartz",
    "deep",
    "champagne",
    "de",
    "del",
    "la",
    "el",
    "y",
  ]);

  return value
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !ignore.has(token));
}

function buildVersionClarificationPrompt(normalizedUserText, detectedMention) {
  if (!detectedMention || !detectedMention.product) {
    return null;
  }

  const candidates = [
    {
      product: detectedMention.product,
      score: Number(detectedMention.score || 0),
    },
    ...(detectedMention.alternatives || []).map((item) => ({
      product: item.product,
      score: Number(item.score || 0),
    })),
  ].filter((item) => item.product && item.product.name);

  if (candidates.length < 2) {
    return null;
  }

  const topFamily = buildProductFamilySignature(candidates[0].product);
  if (!topFamily) {
    return null;
  }

  const variantsByKey = new Map();
  for (const candidate of candidates) {
    const family = buildProductFamilySignature(candidate.product);
    if (!family || family !== topFamily) {
      continue;
    }

    const variantKey = buildProductVariantKey(candidate.product);
    const existing = variantsByKey.get(variantKey);
    if (!existing || candidate.score > existing.score) {
      variantsByKey.set(variantKey, candidate);
    }
  }

  if (variantsByKey.size < 2) {
    return null;
  }

  const variantCandidates = [...variantsByKey.values()].sort((a, b) => b.score - a.score);
  const top = variantCandidates[0];
  const second = variantCandidates[1];
  if (!top || !second) {
    return null;
  }

  if (top.score - second.score > 9.5) {
    return null;
  }

  const queryVariantTokens = extractVariantTokensFromText(normalizedUserText);
  if (isVariantChoiceDecisive(queryVariantTokens, variantCandidates)) {
    return null;
  }

  const options = variantCandidates.slice(0, 3).map((item, index) => {
    const label = formatProductForClarification(item.product);
    return `${index + 1}) ${label}`;
  });

  if (options.length < 2) {
    return null;
  }

  return [
    "Para evitar confundirme con versiones parecidas, confirmame cual tenes:",
    ...options,
    "Escribi el modelo tal cual (por ejemplo: 'keylab essential 61 mk3' o 'keylab 61 mk3').",
  ].join("\n");
}

function buildProductFamilySignature(product) {
  const tokens = tokenizeProductName(product)
    .filter((token) => !productClarifyCosmeticTokens.has(token))
    .filter((token) => !productClarifyGenericTokens.has(token))
    .filter((token) => !isVariantHintToken(token));

  return tokens.join(" ");
}

function buildProductVariantKey(product) {
  const variantTokens = extractVariantTokensFromProduct(product);
  if (variantTokens.length === 0) {
    return "standard";
  }

  return variantTokens.sort().join("+");
}

function extractVariantTokensFromProduct(product) {
  return extractVariantTokensFromText(normalize(product?.normalizedName || product?.name || ""));
}

function extractVariantTokensFromText(normalizedText) {
  const tokens = tokenizeNormalizedText(normalizedText);
  const out = [];

  for (const token of tokens) {
    if (isVariantHintToken(token)) {
      out.push(token);
    }
  }

  return [...new Set(out)];
}

function isVariantChoiceDecisive(queryVariantTokens, variantCandidates) {
  if (!queryVariantTokens || queryVariantTokens.length === 0) {
    return false;
  }

  const querySet = new Set(queryVariantTokens);
  const scores = variantCandidates.map((item) => {
    const variantTokens = extractVariantTokensFromProduct(item.product);
    let score = 0;

    for (const token of variantTokens) {
      if (querySet.has(token)) {
        score += 1;
      }
    }

    return {
      score,
      product: item.product,
    };
  });

  scores.sort((a, b) => b.score - a.score);
  const top = scores[0]?.score || 0;
  const second = scores[1]?.score || 0;

  if (top === 0) {
    return false;
  }

  const countTop = scores.filter((item) => item.score === top).length;
  return countTop === 1 && top - second >= 1;
}

function formatProductForClarification(product) {
  const tokens = tokenizeProductName(product).filter((token) => !productClarifyGenericTokens.has(token));
  const cleaned = tokens
    .filter((token) => !productClarifyCosmeticTokens.has(token))
    .join(" ")
    .trim();

  const fallback = normalize(product?.name || "");
  const label = cleaned || fallback;
  if (!label) {
    return product?.name || "modelo desconocido";
  }

  return toTitleCase(label);
}

function tokenizeProductName(product) {
  return tokenizeNormalizedText(normalize(product?.normalizedName || product?.name || ""));
}

function tokenizeNormalizedText(normalizedText) {
  return String(normalizedText || "")
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function isVariantHintToken(token) {
  if (!token) {
    return false;
  }

  if (productVariantHintTokens.has(token)) {
    return true;
  }

  if (/^mk\d+$/.test(token)) {
    return true;
  }

  if (/^v\d+$/.test(token)) {
    return true;
  }

  return false;
}

function toTitleCase(value) {
  return value
    .split(" ")
    .map((token) => {
      if (!token) {
        return token;
      }

      if (/^[a-z]{1,3}\d+$/.test(token) || /^\d+$/.test(token)) {
        return token.toUpperCase();
      }

      if (/^mk\d+$/.test(token)) {
        return token.toUpperCase();
      }

      return `${token.charAt(0).toUpperCase()}${token.slice(1)}`;
    })
    .join(" ");
}

function resolveLLMConfig() {
  const requestedProvider = String(process.env.LLM_PROVIDER || "")
    .trim()
    .toLowerCase();
  const genericModel = String(process.env.LLM_MODEL || "").trim();

  const provider =
    requestedProvider || (process.env.OPENROUTER_API_KEY ? "openrouter" : "openai");

  if (provider === "openrouter") {
    const defaultHeaders = {};
    if (process.env.OPENROUTER_HTTP_REFERER) {
      defaultHeaders["HTTP-Referer"] = process.env.OPENROUTER_HTTP_REFERER;
    }
    if (process.env.OPENROUTER_APP_TITLE) {
      defaultHeaders["X-Title"] = process.env.OPENROUTER_APP_TITLE;
    }

    return {
      provider,
      apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || "",
      model:
        genericModel || process.env.OPENROUTER_MODEL || process.env.OPENAI_MODEL || "moonshotai/kimi-k2",
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
    };
  }

  return {
    provider: "openai",
    apiKey: process.env.OPENAI_API_KEY || "",
    model: genericModel || process.env.OPENAI_MODEL || "gpt-4o-mini",
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    defaultHeaders: undefined,
  };
}

function getLLMStatus() {
  const config = resolveLLMConfig();
  const modelSource = process.env.LLM_MODEL ? "LLM_MODEL" : "provider-default";

  return {
    provider: config.provider,
    model: config.model,
    modelSource,
    enabled: Boolean(config.apiKey),
  };
}

function withTimeout(promise, timeoutMs, errorMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    }),
  ]);
}

function limitText(text, max) {
  const value = String(text || "");
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
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
