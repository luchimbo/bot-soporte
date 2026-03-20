const OpenAI = require("openai");
const { buildSupportReply } = require("./bot");
const { searchKnowledgeBase, searchHistoricalResponses } = require("./knowledge-base");
const {
  detectProductMention,
  buildProductSearchContext,
  isSameProduct,
} = require("./product-catalog");
const {
  searchSupportFaq,
  findSupportTriageConfig,
  matchSupportTriage,
  getSupportPolicyText,
  getSupportPolicyTextsByType,
} = require("./support-playbook");

const topK = Number(process.env.KB_TOP_K || 4);
const styleTopK = Number(process.env.STYLE_TOP_K || 3);
const manualTopK = Number(process.env.KB_MANUAL_TOP_K || 2);
const openAITimeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 30000);
const productMinMatchScore = Number(process.env.PRODUCT_MATCH_MIN_SCORE || 7);
const llmSimpleModelFallback = process.env.LLM_SIMPLE_MODEL || process.env.OPENROUTER_SIMPLE_MODEL || "google/gemini-2.5-flash-lite";
const llmComplexModelFallback = process.env.LLM_COMPLEX_MODEL || process.env.OPENROUTER_COMPLEX_MODEL || "deepseek/deepseek-v3.2";

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

const supportGreetingPrefix = buildSupportGreetingPrefix();

const resolutionYesPattern = /^(si|sí|perfecto|listo|resuelto|solucionado|ya funciono|ya funcionó|ya pude|quedo|qued[oó] bien|anda|funciona)([!. ]|$)/i;
const resolutionNoPattern = /^(no|sigue|sigue igual|no funciono|no funcionó|no pude|continua|continúa|todavia no|aun no|persiste)([!. ]|$)/i;

const productOwnershipCuePattern = /\b(tengo|mi|es un|es una|modelo|sku|arturia|midiplus|teclado|interfaz|bateria|bater[aí]a|controlador)\b/i;
const accessoryLikeProductPattern = /\b(fuente|cable|stand|soporte|adaptador|holder|pedal|music stand)\b/i;

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
    simpleModel: config.simpleModel,
    complexModel: config.complexModel,
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
  const normalizedText = normalize(text);
  const hasAssistantHistory = hasAssistantMessages(sessionContext?.messageHistory || []);

  if (!text) {
    return {
      text: maybePrependSupportIntro(buildSupportReply(text), hasAssistantHistory),
      mode: "fallback-empty",
      hits: [],
      styleExamples: [],
      stateUpdate: {},
      activeProduct: sessionContext.currentProduct || null,
      detectedProduct: null,
    };
  }

  const flowReply = resolveSupportFlowReply({
    text,
    normalizedText,
    sessionContext,
    hasAssistantHistory,
  });
  if (flowReply) {
    return flowReply;
  }

  if (isGreetingOnly(normalizedText)) {
    return {
      text: buildGreetingReply(),
      mode: "greeting",
      hits: [],
      styleExamples: [],
      stateUpdate: {
        lastIntent: "consulta_general",
      },
      activeProduct: sessionContext.currentProduct || null,
      detectedProduct: null,
    };
  }

  if (containsAbusiveLanguage(normalizedText)) {
    return buildHumanTriageResponse({
      route: "trato_abusivo",
      activeProduct: sessionContext.currentProduct || null,
      stateUpdate: {},
      hasAssistantHistory,
      detectedProduct: null,
    });
  }

  const productResolution = resolveProductForTurn(text, sessionContext);
  const stateUpdate = {
    ...productResolution.stateUpdate,
  };

  if (productResolution.clarificationText) {
    return {
      text: maybePrependSupportIntro(productResolution.clarificationText, hasAssistantHistory),
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
      text: maybePrependSupportIntro(productResolution.askForProductText, hasAssistantHistory),
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

  const faqHits = searchSupportFaq({
    userText: text,
    activeProduct,
    preferredCategory: detectIntentFromText(text),
    topK: 2,
  });

  if (faqHits.length > 0) {
    return buildFaqPlaybookResponse({
      faqMatch: faqHits[0],
      activeProduct,
      stateUpdate,
      hasAssistantHistory,
      detectedProduct: productResolution.detectedProduct,
    });
  }

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

  const immediateHumanRoute = detectImmediateHumanRoute({
    normalizedText,
    preferredCategory,
    hits,
  });
  if (immediateHumanRoute) {
    return buildHumanTriageResponse({
      route: immediateHumanRoute,
      activeProduct,
      stateUpdate,
      hasAssistantHistory,
      detectedProduct: productResolution.detectedProduct,
    });
  }

  if (activeProduct && isFollowupSignal(normalize(text))) {
    return finalizeSupportReply({
      replyText: buildContinuationReply({
        activeProduct,
        hits,
      }),
      mode: "context-followup",
      hits,
      styleExamples,
      stateUpdate,
      activeProduct,
      detectedProduct: productResolution.detectedProduct,
      hasAssistantHistory,
      preferredCategory,
      normalizedText,
      allowResolutionCheck: false,
    });
  }

  if (hits.length === 0) {
    return finalizeSupportReply({
      replyText: buildKnowledgeFallbackReply(text, hits, activeProduct),
      mode: "fallback-no-kb-hits",
      hits,
      styleExamples,
      stateUpdate,
      activeProduct,
      detectedProduct: productResolution.detectedProduct,
      hasAssistantHistory,
      preferredCategory,
      normalizedText,
      allowResolutionCheck: false,
    });
  }

  const llm = getLLMClient();
  if (!llm) {
    return finalizeSupportReply({
      replyText: buildKnowledgeFallbackReply(text, hits, activeProduct),
      mode: "fallback-no-llm-key",
      hits,
      styleExamples,
      stateUpdate,
      activeProduct,
      detectedProduct: productResolution.detectedProduct,
      hasAssistantHistory,
      preferredCategory,
      normalizedText,
    });
  }

  try {
    const selectedModel = selectModelForTurn({
      activeProduct,
      hits,
      styleExamples,
      preferredCategory,
      normalizedText,
      llmConfig: llm.config,
    });

    const aiReply = await generateAIReply({
      client: llm.client,
      model: selectedModel,
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
        return finalizeSupportReply({
          replyText: buildProductSafeReply({
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
          hasAssistantHistory,
          preferredCategory,
          normalizedText,
          allowResolutionCheck: false,
        });
      }

      return finalizeSupportReply({
        replyText: limitText(aiReply, 2200),
        mode: "ai-rag",
        hits,
        styleExamples,
        stateUpdate,
        activeProduct,
        detectedProduct: productResolution.detectedProduct,
        hasAssistantHistory,
        preferredCategory,
        normalizedText,
      });
    }
  } catch (error) {
    const msg = error.response?.data || error.message;
    console.error("LLM error:", msg);
  }

  return finalizeSupportReply({
    replyText: buildKnowledgeFallbackReply(text, hits, activeProduct),
    mode: "fallback-llm-error",
    hits,
    styleExamples,
    stateUpdate,
    activeProduct,
    detectedProduct: productResolution.detectedProduct,
    hasAssistantHistory,
    preferredCategory,
    normalizedText,
  });
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
    ...getSupportPolicyTextsByType("restriccion").map((text) => `- ${text}`),
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

  const shouldAttemptDetection = shouldAttemptProductDetection(normalizedText, currentProduct);
  const detectedMention = shouldAttemptDetection
    ? detectProductMention(text, {
        minScore: currentProduct ? Math.max(productMinMatchScore + 2, 9) : productMinMatchScore,
        minConfidence: currentProduct ? "medium" : "low",
      })
    : null;

  const stateUpdate = {};
  const detectedProduct = detectedMention?.product || null;

  if (pendingProductSwitch) {
    if (
      detectedProduct &&
      currentProduct &&
      isAccessoryLikeProduct(currentProduct) &&
      !isAccessoryLikeProduct(detectedProduct) &&
      isExplicitProductSelection(normalizedText, detectedMention)
    ) {
      stateUpdate.currentProduct = detectedProduct;
      stateUpdate.clearPendingProductSwitch = true;
      return {
        activeProduct: detectedProduct,
        detectedProduct,
        stateUpdate,
      };
    }

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
      const explicitProductSelection = isExplicitProductSelection(normalizedText, detectedMention);
      const versionClarification = buildVersionClarificationPrompt(normalizedText, detectedMention);
      const shouldClarifyVersion =
        Boolean(versionClarification) && sessionContext?.lastMode !== "product-clarification";

      if (!explicitProductSelection) {
        return {
          activeProduct: null,
          detectedProduct,
          stateUpdate,
          askForProductText:
            "Para evitar confusiones con modelos parecidos, confirmame producto/modelo exacto (ejemplo: Arturia MiniFuse 2 o MiniLab 3).",
        };
      }

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

    if (
      currentProduct &&
      isAccessoryLikeProduct(currentProduct) &&
      !isAccessoryLikeProduct(detectedProduct) &&
      isExplicitProductSelection(normalizedText, detectedMention)
    ) {
      stateUpdate.currentProduct = detectedProduct;
      stateUpdate.clearPendingProductSwitch = true;
      return {
        activeProduct: detectedProduct,
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

  if (isContinuationMessage(normalizedText)) {
    return false;
  }

  if (hasSwitchCue(normalizedText)) {
    return detectedMention.confidence !== "low";
  }

  if (detectedMention.confidence === "high" && hasExplicitProductOwnershipCue(normalizedText)) {
    return true;
  }

  if (detectedMention.confidence === "medium" && hasExplicitProductOwnershipCue(normalizedText) && hasStrongProductCue(normalizedText)) {
    return true;
  }

  return false;
}

function isAccessoryLikeProduct(product) {
  const normalizedName = normalize(product?.normalizedName || product?.name || "");
  if (!normalizedName) {
    return false;
  }

  return accessoryLikeProductPattern.test(normalizedName);
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
        `Seguimos con ${activeProduct.name}.`,
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

function finalizeSupportReply({
  replyText,
  mode,
  hits,
  styleExamples,
  stateUpdate,
  activeProduct,
  detectedProduct,
  hasAssistantHistory,
  preferredCategory,
  normalizedText,
  allowResolutionCheck = true,
}) {
  const nextStateUpdate = {
    ...stateUpdate,
  };

  let finalText = maybePrependSupportIntro(replyText, hasAssistantHistory);

  if (allowResolutionCheck && shouldAskResolutionCheck({ normalizedText, hits, preferredCategory })) {
    finalText = appendResolutionCheck(finalText);
    nextStateUpdate.supportFlow = {
      stage: "awaiting_resolution_check",
      intent: preferredCategory,
      handoffRoute: resolveHandoffRoute(preferredCategory, normalizedText),
    };
    nextStateUpdate.humanActive = false;
  }

  return {
    text: finalText,
    mode,
    hits,
    styleExamples,
    stateUpdate: nextStateUpdate,
    activeProduct,
    detectedProduct,
  };
}

function buildHumanTriageResponse({ route, activeProduct, stateUpdate, hasAssistantHistory, detectedProduct }) {
  return {
    text: maybePrependSupportIntro(
      buildHumanTriageReply({
        route,
        activeProduct,
      }),
      hasAssistantHistory
    ),
    mode: "human-triage",
    hits: [],
    styleExamples: [],
    stateUpdate: {
      ...stateUpdate,
      clearSupportFlow: true,
      humanActive: true,
      lastIntent: route,
    },
    activeProduct,
    detectedProduct,
  };
}

function detectImmediateHumanRoute({ normalizedText, preferredCategory, hits }) {
  if (containsAbusiveLanguage(normalizedText)) {
    return "trato_abusivo";
  }

  const playbookMatch = matchSupportTriage({
    normalizedText,
    preferredCategory,
  });
  if (playbookMatch?.category) {
    return playbookMatch.category;
  }

  if (/equivoc|envio incorrecto|producto equivocado|me llego otro|llego otro|enviaste otro|pedido incorrecto/.test(normalizedText)) {
    return "equivocacion_envio";
  }

  if (/garanti|reembolso|reintegro|devolucion|devolver/.test(normalizedText)) {
    return preferredCategory === "devolucion" ? "devolucion" : "garantia_consulta";
  }

  if (preferredCategory === "falla_producto" && !hasStrongAnswerCandidate(hits)) {
    return "falla_producto";
  }

  return null;
}

function selectModelForTurn({ activeProduct, hits, styleExamples, preferredCategory, normalizedText, llmConfig }) {
  if (!llmConfig) {
    return null;
  }

  if (!activeProduct) {
    return llmConfig.simpleModel || llmConfig.model;
  }

  if (isSensitiveHumanRoute(normalizedText, preferredCategory)) {
    return llmConfig.simpleModel || llmConfig.model;
  }

  const hasManualEvidence = Array.isArray(hits) && hits.some((hit) => String(hit?.source || "").startsWith("manual_"));
  const hasStrongFaqStyle = Array.isArray(styleExamples) && styleExamples.length > 0;
  const hitScore = Number(hits?.[0]?.score || 0);

  if (hasManualEvidence && hitScore >= 6) {
    return llmConfig.complexModel || llmConfig.model;
  }

  if ((preferredCategory === "falla_producto" || preferredCategory === "como_hacer") && hitScore >= 8 && hasStrongFaqStyle) {
    return llmConfig.complexModel || llmConfig.model;
  }

  return llmConfig.simpleModel || llmConfig.model;
}

function hasStrongAnswerCandidate(hits) {
  return Array.isArray(hits) && hits.length > 0 && Number(hits[0]?.score || 0) >= 9.5;
}

function buildFaqPlaybookResponse({ faqMatch, activeProduct, stateUpdate, hasAssistantHistory, detectedProduct }) {
  const nextStateUpdate = {
    ...stateUpdate,
    humanActive: false,
    lastIntent: faqMatch.intent || faqMatch.category,
  };

  if (faqMatch.askIfResolved) {
    nextStateUpdate.supportFlow = {
      stage: "awaiting_resolution_check",
      intent: faqMatch.intent || faqMatch.category,
      handoffRoute: faqMatch.unresolvedAction || "falla_producto",
      source: "playbook-faq",
      faqId: faqMatch.id,
    };
  }

  const parts = [faqMatch.approvedAnswer];
  if (faqMatch.supportLink) {
    parts.push(`Link de ayuda: ${faqMatch.supportLink}`);
  }

  let replyText = maybePrependSupportIntro(parts.join("\n"), hasAssistantHistory);
  if (faqMatch.askIfResolved) {
    replyText = appendResolutionCheck(replyText);
  }

  return {
    text: replyText,
    mode: "faq-playbook",
    hits: [],
    styleExamples: [],
    stateUpdate: nextStateUpdate,
    activeProduct,
    detectedProduct,
  };
}

function resolveHandoffRoute(preferredCategory, normalizedText) {
  if (/equivoc|envio incorrecto|producto equivocado|me llego otro|llego otro|enviaste otro|pedido incorrecto/.test(normalizedText)) {
    return "equivocacion_envio";
  }

  if (preferredCategory === "devolucion") {
    return "devolucion";
  }

  if (/garanti/.test(normalizedText)) {
    return "garantia_consulta";
  }

  return "falla_producto";
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

function isGreetingOnly(normalizedText) {
  return /^(hola+|holis|buenas|buen dia|buenas tardes|buenas noches|hello|hey|ey|buen dia equipo|buenas gente)[!.? ]*$/.test(
    normalizedText
  );
}

function buildGreetingReply(activeProduct) {
  return `${supportGreetingPrefix}\nDecime producto/modelo y que problema tenes.`;
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

function isNegativeResolution(normalizedText) {
  return resolutionNoPattern.test(String(normalizedText || "").trim());
}

function isAffirmativeResolution(normalizedText) {
  return resolutionYesPattern.test(String(normalizedText || "").trim());
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

function resolveSupportFlowReply({ text, normalizedText, sessionContext, hasAssistantHistory }) {
  const activeProduct = sessionContext.currentProduct || null;
  const supportFlow = sessionContext.supportFlow || null;

  if (sessionContext.humanActive) {
    return {
      text: "Gracias. Ya deje el caso listo para revision humana. Si queres iniciar un caso nuevo, escribi /nuevo.",
      mode: "human-handoff",
      hits: [],
      styleExamples: [],
      stateUpdate: {},
      activeProduct,
      detectedProduct: null,
    };
  }

  if (!supportFlow || supportFlow.stage !== "awaiting_resolution_check") {
    return null;
  }

  if (isAffirmativeResolution(normalizedText)) {
    return {
      text: "Perfecto. Me alegra que se haya resuelto. Si queres abrir un caso nuevo, escribime /nuevo.",
      mode: "faq-resolved",
      hits: [],
      styleExamples: [],
      stateUpdate: {
        clearSupportFlow: true,
        humanActive: false,
      },
      activeProduct,
      detectedProduct: null,
    };
  }

  if (isNegativeResolution(normalizedText)) {
    const triageRoute = supportFlow.handoffRoute || supportFlow.intent || "falla_producto";
    return {
      text: maybePrependSupportIntro(
        buildHumanTriageReply({
          route: triageRoute,
          activeProduct,
        }),
        hasAssistantHistory
      ),
      mode: "human-triage",
      hits: [],
      styleExamples: [],
      stateUpdate: {
        clearSupportFlow: true,
        humanActive: true,
        lastIntent: triageRoute,
      },
      activeProduct,
      detectedProduct: null,
    };
  }

  return {
    text: "Responde si o no asi se si quedo resuelto o si lo paso a revision humana.",
    mode: "faq-resolution-check",
    hits: [],
    styleExamples: [],
    stateUpdate: {},
    activeProduct,
    detectedProduct: null,
  };
}

function shouldAskResolutionCheck({ normalizedText, hits, preferredCategory }) {
  if (!hits || hits.length === 0) {
    return false;
  }

  if (isSensitiveHumanRoute(normalizedText, preferredCategory)) {
    return false;
  }

  return Number(hits[0]?.score || 0) >= 9.5;
}

function maybePrependSupportIntro(replyText, hasAssistantHistory) {
  if (hasAssistantHistory) {
    return replyText;
  }

  return [supportGreetingPrefix, replyText].filter(Boolean).join("\n\n");
}

function appendResolutionCheck(replyText) {
  const trimmed = String(replyText || "").trim();
  return [trimmed, "¿Con esto pudiste resolver el inconveniente? Responde si o no."].join("\n\n");
}

function buildHumanTriageReply({ route, activeProduct }) {
  const playbookConfig = findSupportTriageConfig(route);
  if (playbookConfig) {
    const restrictionRule =
      route === "equivocacion_envio"
        ? "no_confirmar_envio"
        : route === "devolucion" || route === "garantia_consulta" || route === "falla_producto"
          ? "no_confirmar_garantia"
          : null;

    return [
      activeProduct?.name ? `Producto en seguimiento: ${activeProduct.name}.` : null,
      playbookConfig.initialMessage || null,
      playbookConfig.dataRequestMessage || null,
      playbookConfig.humanCloseMessage || null,
      restrictionRule ? getSupportPolicyText(restrictionRule, null) : null,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const productLine = activeProduct?.name ? `Producto en seguimiento: ${activeProduct.name}.` : null;

  if (route === "trato_abusivo") {
    return [
      productLine,
      "Voy a derivar el caso a una persona del equipo para continuar la atencion.",
      "Nuestro equipo humano responde de 9 a 14 hs.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (route === "equivocacion_envio") {
    return [
      productLine,
      "Este caso necesita revision humana.",
      "Mientras tanto enviame:",
      "1) Factura de la compra.",
      "2) Producto esperado y producto recibido.",
      "3) Direccion completa con ciudad, calles y codigo postal.",
      "4) Departamento/piso si aplica.",
      "5) Nombre completo, DNI y telefono de quien recibe.",
      "No puedo confirmarte desde el bot si corresponde envio o reemplazo; eso lo revisa soporte.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (route === "devolucion" || route === "garantia_consulta") {
    return [
      productLine,
      "Este caso necesita revision humana.",
      "Enviame:",
      "1) Factura o comprobante de compra.",
      "2) Fecha y canal de compra.",
      "3) Descripcion breve del inconveniente.",
      "No puedo confirmarte desde el bot si el equipo esta en garantia o si corresponde devolucion/reembolso.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    productLine,
    "Este caso necesita revision humana.",
    "Para que soporte tecnico lo revise, enviame:",
    "1) Producto/modelo exacto.",
    "2) Factura de la compra.",
    "3) Video mostrando la falla.",
    "4) Desde cuando comenzo a ocurrir el problema.",
    "No puedo confirmarte desde el bot garantia ni reemplazo; primero lo revisa el equipo.",
  ]
    .filter(Boolean)
    .join("\n");
}

function hasAssistantMessages(history) {
  return Array.isArray(history) && history.some((item) => item?.role === "assistant");
}

function hasExplicitProductOwnershipCue(normalizedText) {
  return productOwnershipCuePattern.test(String(normalizedText || ""));
}

function hasStrongProductCue(normalizedText) {
  const tokens = tokenizeNormalizedText(normalizedText).filter(
    (token) => !productClarifyGenericTokens.has(token) && !productClarifyCosmeticTokens.has(token)
  );

  return tokens.some((token) => /\d/.test(token)) || tokens.length >= 2;
}

function containsAbusiveLanguage(normalizedText) {
  return /\b(pelotudo|pelotuda|boludo|boluda|idiota|imbecil|imbec[ií]l|forro|forra|tarado|tarada|mogolico|mogolica|hijo de puta|hdp|concha de tu madre|puta madre|chupame un huevo|loco de mierda)\b/.test(
    String(normalizedText || "")
  );
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

function isExplicitProductSelection(normalizedText, detectedMention) {
  if (!detectedMention) {
    return false;
  }

  if (detectedMention.confidence === "high" && hasStrongProductCue(normalizedText)) {
    return true;
  }

  if (hasExplicitProductOwnershipCue(normalizedText) && hasStrongProductCue(normalizedText)) {
    return detectedMention.confidence !== "low";
  }

  return false;
}

function shouldAttemptProductDetection(normalizedText, currentProduct) {
  if (!currentProduct) {
    return true;
  }

  if (isGreetingOnly(normalizedText) || isContinuationMessage(normalizedText)) {
    return false;
  }

  if (hasSwitchCue(normalizedText)) {
    return true;
  }

  return hasExplicitProductOwnershipCue(normalizedText) && hasStrongProductCue(normalizedText);
}

function isSensitiveHumanRoute(normalizedText, preferredCategory) {
  if (/equivoc|envio incorrecto|producto equivocado|me llego otro|llego otro|enviaste otro/.test(normalizedText)) {
    return true;
  }

  if (/garanti|reembolso|reintegro|devolucion|devolver/.test(normalizedText)) {
    return true;
  }

  return ["equivocacion_envio", "devolucion", "garantia_consulta"].includes(preferredCategory);
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
      simpleModel: llmSimpleModelFallback,
      complexModel: llmComplexModelFallback,
      baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
      defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
    };
  }

  return {
    provider: "openai",
    apiKey: process.env.OPENAI_API_KEY || "",
    model: genericModel || process.env.OPENAI_MODEL || "gpt-4o-mini",
    simpleModel: process.env.LLM_SIMPLE_MODEL || process.env.OPENAI_SIMPLE_MODEL || genericModel || process.env.OPENAI_MODEL || "gpt-4o-mini",
    complexModel: process.env.LLM_COMPLEX_MODEL || process.env.OPENAI_COMPLEX_MODEL || genericModel || process.env.OPENAI_MODEL || "gpt-4o-mini",
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
    simpleModel: config.simpleModel,
    complexModel: config.complexModel,
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
