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
  findProductSpecs,
  findProductFeature,
  getSupportPolicyText,
  getSupportPolicyTextsByType,
} = require("./support-playbook");
const {
  classifyIntent,
  isCapabilityQuery,
  isProblemQuery,
} = require("./intent-classifier");

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
  "teclas",
  "musical",
  "sintetizador",
  "secuenciador",
  "placa",
  "sonido",
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

const resolutionYesPattern = /^\s*(si|sí|perfecto|listo|resuelto|solucionado|ya funcion[oó]|ya pude|qued[oó]|qued[oó] bien|anda|funciona)[\s!. ]*$/i;
const resolutionNoPattern = /^\s*(no|nop|nope|n|sigue|sigue igual|no funcion[oó]|no pude|contin[uú]a|todavia no|aun no|persiste)[\s!. ]*$/i;

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

  // === CLASIFICACIÓN INTELIGENTE DE INTENCIONES ===
  // Usar LLM para clasificar el tipo de consulta antes de buscar fuentes
  let intentClassification = null;
  try {
    intentClassification = await classifyIntent(text, activeProduct);
    console.log(`[Intent] Consulta clasificada como: ${intentClassification.intent} (confianza: ${intentClassification.confidence})`);
  } catch (error) {
    console.error('[Intent] Error en clasificación:', error.message);
    // Fallback a detección simple
    if (isCapabilityQuery(text)) {
      intentClassification = { intent: 'capability_query', confidence: 0.7 };
    } else if (isProblemQuery(text)) {
      intentClassification = { intent: 'problem_diagnosis', confidence: 0.8 };
    } else {
      intentClassification = { intent: 'general_info', confidence: 0.6 };
    }
  }

  // Si es consulta de capacidad y hay producto activo, buscar en specs primero
  if (intentClassification.intent === 'capability_query' && activeProduct) {
    const featureMatch = findProductFeature({
      activeProduct,
      userText: text,
    });

    if (featureMatch) {
      const greeting = !hasAssistantHistory
        ? getSupportPolicyText("presentacion_bot", "Hola. Soy un asistente virtual de soporte de PC MIDI Center.")
        : "";
      const hours = getSupportPolicyText("horario_humano", "Si hace falta intervencion humana, el equipo responde de 9 a 14 hs.");
      const greetingText = greeting ? `${greeting}\n${hours}\n\n` : "";

      return {
        text: greetingText + featureMatch.answer,
        mode: "product-specs",
        hits: [],
        styleExamples: [],
        stateUpdate: {
          ...stateUpdate,
          lastIntent: "feature_query",
        },
        activeProduct,
        detectedProduct: productResolution.detectedProduct,
      };
    }

    // Intentar con capabilityIntent tradicional si featureMatch no encontró
    const capabilityIntent = detectCapabilityIntent(normalizedText);
    if (capabilityIntent) {
      const specsMatch = findProductSpecs({
        activeProduct,
        userText: text,
      });

      const capabilityReply = buildCapabilityResponse({
        activeProduct,
        specsMatch,
        capabilityIntent,
        hasAssistantHistory,
      });

      if (capabilityReply) {
        return {
          text: capabilityReply,
          mode: "product-specs",
          hits: [],
          styleExamples: [],
          stateUpdate: {
            ...stateUpdate,
            lastIntent: capabilityIntent.intent,
          },
          activeProduct,
          detectedProduct: productResolution.detectedProduct,
        };
      }
    }
  }

  // Si es problema técnico, buscar FAQs de troubleshooting primero
  if (intentClassification.intent === 'problem_diagnosis' && activeProduct) {
    const problemFaqHits = searchSupportFaq({
      userText: text,
      activeProduct,
      preferredCategory: 'faq_configuracion',
      topK: 2,
    });

    if (problemFaqHits.length > 0 && problemFaqHits[0].confidence > 0.75) {
      return buildFaqPlaybookResponse({
        faqMatch: problemFaqHits[0],
        activeProduct,
        stateUpdate: { ...stateUpdate, lastIntent: 'problem_diagnosis' },
        hasAssistantHistory,
        detectedProduct: productResolution.detectedProduct,
      });
    }

    // Si no hay FAQ específica, ir directo a triage para problemas técnicos
    const triageMatch = matchSupportTriage({
      normalizedText,
      preferredCategory: 'falla_producto',
    });

    if (triageMatch) {
      return buildHumanTriageResponse({
        route: triageMatch.category,
        activeProduct,
        stateUpdate: { ...stateUpdate, lastIntent: 'problem_diagnosis' },
        hasAssistantHistory,
        detectedProduct: productResolution.detectedProduct,
      });
    }
  }

  // Mensaje de solo producto sin problema específico
  if (activeProduct && looksLikeProductOnlyMessage(normalizedText, activeProduct)) {
    return {
      text: maybePrependSupportIntro(
        `¡Bárbaro! Sobre tu ${activeProduct.name}, contame cortito qué problema te está dando así le buscamos la vuelta.`,
        hasAssistantHistory
      ),
      mode: "needs-problem-detail",
      hits: [],
      styleExamples: [],
      stateUpdate,
      activeProduct,
      detectedProduct: productResolution.detectedProduct,
    };
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
    allowedSources: ["manual_arturia", "manual_midiplus", "manual_alctron"],
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

  // Eliminamos el fallback prematuro (hits.length === 0)
  // Ahora el LLM SIEMPRE recibe el turno, incluso si no hay manuales,
  // para que use su conocimiento tecnico general como primer nivel de resolucion.

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

  const finalContextText = contextText.trim() !== ""
    ? contextText
    : "No se encontraron casos ni manuales sobre esto. Usa estrictamente tu sentido común y conocimiento técnico general (hardware de audio, MIDI, PC/Mac) para dar al cliente un primer paso de diagnóstico corto y genérico. JAMÁS inventes políticas ni garantías de PC MIDI Center.";

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

  const policyRestrictions = getSupportPolicyTextsByType("restriccion");

  const systemPrompt = [
    // ── 1. IDENTIDAD ──
    "Eres el asistente virtual de soporte tecnico de PC MIDI Center, una tienda argentina especializada en equipamiento musical, audio profesional, instrumentos MIDI, interfaces, controladores, sintetizadores, monitores de estudio y accesorios.",
    "No te llamas 'Sos' ni tienes nombre propio personal. Tu rol es resolver la mayor cantidad posible de consultas tecnicas de forma autonoma por WhatsApp antes de derivar a un humano.",
    "",
    // ── 2. MARCAS Y PRODUCTOS ──
    "PC MIDI Center vende marcas como Arturia, Midiplus, PreSonus, M-Audio, Korg, Roland, Yamaha, Behringer, Focusrite, Mackie, Audio-Technica, AKG, Shure, Sennheiser, Native Instruments, Novation, Akai, entre otras.",
    "Los productos tipicos incluyen: teclados MIDI/controladores, interfaces de audio (USB/Thunderbolt), sintetizadores, monitores de estudio, auriculares, microfonos, mixers, baterias electronicas, pads, pedales, cables, soportes y accesorios.",
    "Los clientes compran por Tienda Nube (web propia) y Mercado Libre, y son mayormente musicos, productores, DJs, streamers y entusiastas de audio en Argentina.",
    "",
    // ── 3. FUENTES DE INFORMACION (RAG) ──
    "Vas a recibir informacion de varias fuentes para responder:",
    "- Casos historicos: conversaciones reales de WhatsApp y email entre clientes y soporte de PC MIDI Center. Contienen problemas reales ya resueltos.",
    "- Manuales tecnicos: fragmentos extraidos de manuales PDF oficiales de los fabricantes (por ejemplo Arturia). Pueden estar en ingles; tu trabajo es traducir esa informacion a pasos claros en espanol.",
    "- Ejemplos historicos de respuesta: pares de consulta-respuesta reales que muestran como respondio soporte en casos similares. Usalos como guia de tono y estructura, sin copiarlos textual.",
    "Usa la informacion de los manuales como LA VERDAD ABSOLUTA. Si no hay manuales o casos para la falla, usa tu conocimiento general global de Audio Pro, MIDI e interfaces para guiar al usuario. NO inventes especificaciones de un equipo si no lo tienes claro, y JAMAS inventes politicas de garantia o devolucion.",
    "",
    // ── 4. TONO Y ESTILO ──
    "- Usa espanol rioplatense natural (vos, decime, contame, fijate, probá). No uses usted ni un registro excesivamente formal.",
    "- Se empatico y paciente. Nunca invalides al cliente ni minimices su problema.",
    "- Si detectas frustracion o enojo, baja la intensidad, valida su experiencia y ofrece ayuda concreta.",
    "- Mantene un tono profesional pero cercano, como un tecnico amigable que sabe del tema.",
    "- Adapta el nivel tecnico al cliente: si el cliente parece principiante, simplifica; si parece avanzado, podes ser mas tecnico.",
    "",
    // ── 5. FORMATO DE RESPUESTA (WhatsApp) ──
    "- Las respuestas son para WhatsApp: maximo 2000 caracteres. Se breve y directo.",
    "- No uses formato Markdown complejo (sin headers ##, sin negritas **, sin listas con -). Usa texto plano.",
    "- Para instrucciones usa pasos numerados simples: 1) 2) 3).",
    "- Podes usar emojis con moderacion si aportan claridad (✅ ❌ ⚠️) pero no llenes de emojis.",
    "- Si necesitas dar muchos pasos, limitate a los 3-4 mas importantes primero y ofrece continuar despues.",
    "- No pongas titulos, encabezados ni separadores visuales.",
    "",
    // ── 6. REGLAS DURAS — PROHIBICIONES ABSOLUTAS ──
    "PROHIBICIONES que bajo ningun concepto debes violar:",
    "- NUNCA confirmes que un equipo esta en garantia. Solo soporte humano puede determinarlo.",
    "- NUNCA prometas envio, reemplazo, devolucion o reembolso. Esas decisiones son exclusivas del equipo humano.",
    "- NUNCA improvises politicas internas, plazos, condiciones de venta ni procedimientos de postventa que no esten en las fuentes.",
    "- NUNCA inventes especificaciones tecnicas, compatibilidades o datos que no esten en los casos o manuales recuperados.",
    "- NUNCA cambies de producto/modelo por tu cuenta. Si el cliente no nombro un producto distinto de forma explicita, segui con el producto actual.",
    "- NUNCA diagnostiques sin conocer el producto/modelo exacto. Si no lo sabes, pedilo primero.",
    "- Si el cliente insulta o maltrata, no respondas al insulto. Indica que el caso sera derivado a una persona del equipo.",
    "",
    // ── 7. PRODUCTO EN SEGUIMIENTO ──
    activeProduct
      ? [
        "PRODUCTO BLOQUEADO PARA ESTE CHAT: " + activeProduct.name + (activeProduct.sku ? " (SKU " + activeProduct.sku + ")" : "") + ".",
        "Toda tu respuesta debe referirse exclusivamente a este producto. No cambies a otro modelo aunque el caso recuperado mencione uno diferente.",
        "Si la informacion de los casos/manuales es de otro modelo, adaptala con cuidado al producto actual, o indica que no tenes evidencia especifica.",
      ].join("\n")
      : "No hay producto confirmado aun. Antes de diagnosticar cualquier falla, pedi al cliente el producto y modelo exacto (ejemplo: Arturia MiniFuse 2, Midiplus X6 Pro III, etc.).",
    "",
    // ── 8. METODOLOGIA DE DIAGNOSTICO ──
    "Cuando des soporte tecnico:",
    "- REGLA DE ORO: Da pasos cortos, concretos y accionables. NUNCA des mas de 1 o 2 instrucciones a la vez.",
    "- REGLA DE ORO: Termina SIEMPRE tu mensaje preguntando si el cliente pudo probarlo o que resultado le dio. (Ej: '¿Pudiste revisar el botón verde?', '¿Qué luz enciende ahora?').",
    "- Si falta informacion para diagnosticar, pedi maximo 2 datos concretos y especificos (no hagas 5 preguntas a la vez).",
    "- Si el manual esta en ingles, traduce los pasos a espanol claro sin jerga innecesaria.",
    "- Si hay multiples soluciones posibles, empeza por la mas simple y comun.",
    "- Si la evidencia de los casos sugiere un patron claro, segui esa linea primero.",
    "",
    // ── 9. CASOS SENSIBLES — CUANDO SUGERIR DERIVACION ──
    "Sugeri que el caso pase a revision humana cuando:",
    "- El problema parece una falla fisica/hardware (tecla rota, ruido electronico, puerto danado, equipo no enciende sin solucion por software).",
    "- El cliente menciona garantia, devolucion, reembolso o reemplazo.",
    "- El cliente recibio un producto equivocado o un envio incorrecto.",
    "- No hay evidencia suficiente en los casos ni manuales para dar una respuesta confiable.",
    "- Ya diste 2 soluciones y el problema persiste.",
    "En esos casos, indica los datos que el cliente debe preparar para que soporte humano los revise (factura, video de la falla, numero de serie, etc.) y aclara que el equipo humano responde de 9 a 14 hs.",
    "",
    // ── 10. DEVOLUCION Y GARANTIA — PROCEDIMIENTO ──
    "Si el caso involucra devolucion, garantia o reembolso:",
    "- NO confirmes si corresponde o no.",
    "- Pedile al cliente: 1) factura o comprobante de compra, 2) fecha y canal de compra (Tienda Nube, Mercado Libre, local), 3) descripcion breve del problema.",
    "- Para fallas fisicas agrega: video mostrando la falla y numero de serie si lo tiene.",
    "- Indica que el equipo de soporte revisara la informacion y le dara una respuesta.",
    "",
    // ── 11. EJEMPLOS HISTORICOS DE RESPUESTA ──
    "Si recibis ejemplos historicos de como respondio soporte antes:",
    "- Usalos como referencia de tono, largo y estructura.",
    "- No copies textualmente, adapta al caso actual.",
    "- Si el ejemplo historico contradice las reglas duras de arriba, priorizá las reglas duras.",
    "",
    // ── 12. RESTRICCIONES ADICIONALES DEL PLAYBOOK ──
    ...(policyRestrictions.length > 0
      ? ["Restricciones operativas adicionales:", ...policyRestrictions.map((text) => `- ${text}`)]
      : []),
  ].join("\n");

  const latestHistory = (sessionContext?.messageHistory || []).slice(-6);
  const conversationMessages = latestHistory.map(h => ({
    role: h.role,
    content: limitText(String(h.text || ""), 380)
  }));


  const userPrompt = [
    "Producto en seguimiento:",
    productLine,
    "",
    "Consulta actual del cliente:",
    userText,
    "",
    "Casos recuperados:",
    finalContextText,
    "",
    "Ejemplos historicos de soporte:",
    styleText || "No hay ejemplos historicos disponibles.",
    "",
    "Arma la mejor respuesta para WhatsApp.",
  ].join("\n");

  const isComplex = model !== client.config?.simpleModel && activeProduct;
  const maxTokensToUse = isComplex ? 700 : 450;

  const completion = await withTimeout(
    client.chat.completions.create({
      model,
      temperature: 0.15,
      max_tokens: maxTokensToUse,
      messages: [
        { role: "system", content: systemPrompt },
        ...conversationMessages,
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

      // Guardamos el producto en la sesion incluso si pedimos confirmacion
      // para que el bot no 'olvide' lo que el usuario ya dijo en el proximo turno.
      stateUpdate.currentProduct = detectedProduct;

      if (!explicitProductSelection) {
        return {
          activeProduct: null,
          detectedProduct,
          stateUpdate,
          askForProductText:
            "¡Hola! Para poder ayudarte bien, ¿me confirmás el modelo exacto del equipo que tenés? (ej: MiniFuse 2)",
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
        "Para poder ayudarte, ¿me indicás el modelo exacto del equipo que tenés? (ejemplo: Arturia KeyLab 61 MK3 o el SKU).",
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
    "Contame qué pasó en la última prueba y qué mensaje exacto ves.",
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
      "1) ¿Cuál es el producto/modelo exacto?",
      "2) ¿Qué falla hace y desde cuándo?",
      "3) Si aparece un mensaje de error, ¿me lo pasás textual?",
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
  // Desactivamos el handoff instantaneo de la planilla para falla_producto
  // asi el LLM puede intentar diagnosticar primero.
  if (playbookMatch?.category && playbookMatch.category !== "falla_producto") {
    return playbookMatch.category;
  }

  if (/equivoc|envio incorrecto|producto equivocado|me llego otro|llego otro|enviaste otro|pedido incorrecto/.test(normalizedText)) {
    return "equivocacion_envio";
  }

  if (/garanti|reembolso|reintegro|devolucion|devolver/.test(normalizedText)) {
    return preferredCategory === "devolucion" ? "devolucion" : "garantia_consulta";
  }

  if (preferredCategory === "garantia_consulta" && hits.length === 0) {
    return "garantia_consulta";
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

function hasProblemSignal(normalizedText) {
  return /\b(no funciona|no anda|falla|error|no enciende|no conecta|sigue igual|persiste|no suena|no sale sonido|no detecta|no reconoce|problema|inconveniente)\b/.test(
    String(normalizedText || "")
  );
}

function looksLikeProductOnlyMessage(normalizedText, activeProduct) {
  if (!activeProduct || hasProblemSignal(normalizedText)) {
    return false;
  }

  const text = String(normalizedText || "").trim();
  if (!text) {
    return false;
  }

  const activeName = normalize(activeProduct.normalizedName || activeProduct.name || "");
  if (activeName && text === activeName) {
    return true;
  }

  const compactTokens = tokenizeNormalizedText(text).filter((token) => token.length >= 3);
  return compactTokens.length <= 4 && hasExplicitProductOwnershipCue(text);
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

function buildCapabilityResponse({ activeProduct, specsMatch, capabilityIntent, hasAssistantHistory }) {
  if (!capabilityIntent) {
    return null;
  }

  if (!specsMatch) {
    return maybePrependSupportIntro(capabilityIntent.fallback, hasAssistantHistory);
  }

  const explicitReply = cleanCapabilityReply(specsMatch[capabilityIntent.replyField]);
  if (explicitReply) {
    return maybePrependSupportIntro(appendLinkIfNeeded(explicitReply, specsMatch.supportLink), hasAssistantHistory);
  }

  const value = specsMatch[capabilityIntent.valueField];
  const generated = capabilityIntent.formatter({
    value,
    activeProduct,
    specsMatch,
  });

  if (generated) {
    return maybePrependSupportIntro(appendLinkIfNeeded(generated, specsMatch.supportLink), hasAssistantHistory);
  }

  return maybePrependSupportIntro(capabilityIntent.fallback, hasAssistantHistory);
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

function detectCapabilityIntent(normalizedText) {
  const value = String(normalizedText || "");
  if (!value) {
    return null;
  }

  if (/\b(parlante|parlantes|speaker|speakers)\b/.test(value)) {
    return {
      intent: "spec_speakers",
      replyField: "replySpeakers",
      valueField: "hasSpeakers",
      formatter: formatSpeakersAnswer,
      fallback:
        "No tengo confirmacion tecnica suficiente sobre si ese equipo tiene parlantes integrados. Si queres, lo reviso con una persona del equipo.",
    };
  }

  if (/\b(mono|un solo parlante|sale de un lado|salida mono)\b/.test(value)) {
    return {
      intent: "spec_mono_output",
      replyField: "replyAudioOutput",
      valueField: "monoOutput",
      formatter: formatMonoOutputAnswer,
      fallback:
        "No tengo confirmacion tecnica suficiente sobre el tipo de salida de audio de ese equipo. Si queres, lo reviso con una persona del equipo.",
    };
  }

  if (/(controlador midi|manda midi|envia midi|envía midi|midi por usb)/.test(value)) {
    return {
      intent: "spec_midi_usb",
      replyField: "replyMidi",
      valueField: "sendsMidiUsb",
      formatter: formatMidiOverUsbAnswer,
      fallback:
        "No tengo confirmacion tecnica suficiente sobre el envio de MIDI por USB en ese equipo. Si queres, lo reviso con una persona del equipo.",
    };
  }

  if (/(audio por usb|sale audio por usb|manda audio por usb|interfaz de audio|placa de sonido)/.test(value)) {
    return {
      intent: "spec_audio_usb",
      replyField: "replyAudioUsb",
      valueField: "sendsAudioUsb",
      formatter: formatAudioOverUsbAnswer,
      fallback:
        "No tengo confirmacion tecnica suficiente sobre el envio de audio por USB en ese equipo. Si queres, lo reviso con una persona del equipo.",
    };
  }

  if (/(driver|drivers|requiere driver|instalar driver|controlador)/.test(value)) {
    return {
      intent: "spec_driver",
      replyField: "replyDriver",
      valueField: "requiresDriver",
      formatter: formatDriverAnswer,
      fallback:
        "No tengo confirmacion tecnica suficiente sobre si ese equipo requiere driver. Si queres, lo reviso con una persona del equipo.",
    };
  }

  if (/(pc|computadora|compu|notebook|laptop|mac|windows|conectar a la pc|conecta a la pc|usb a la pc)/.test(value)) {
    return {
      intent: "spec_connect_pc",
      replyField: "replyPc",
      valueField: "connectsToPc",
      formatter: formatConnectPcAnswer,
      fallback:
        "No tengo confirmacion tecnica suficiente sobre la conexion a computadora de ese equipo. Si queres, lo reviso con una persona del equipo.",
    };
  }

  return null;
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
    const successReplies = [
      "Perfecto. Me alegra que se haya resuelto. Si queres abrir un caso nuevo, escribime /nuevo.",
      "Excelente, me alegro que haya funcionado. Avisame con /nuevo si necesitas algo mas.",
      "Genial. Cualquier otra cosa que necesites, me avisas. Podes mandar /nuevo para otra consulta."
    ];
    return {
      text: successReplies[Math.floor(Math.random() * successReplies.length)],
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

  const confusedReplies = [
    "Responde si o no asi se si quedo resuelto o si lo paso a revision humana.",
    "Para entenderte mejor: ¿se soluciono el problema? Responde si o no.",
    "¿Pudiste resolverlo con eso? Decime si o no para saber como seguir."
  ];

  return {
    text: confusedReplies[Math.floor(Math.random() * confusedReplies.length)],
    mode: "faq-resolution-check",
    hits: [],
    styleExamples: [],
    stateUpdate: {},
    activeProduct,
    detectedProduct: null,
  };
}

function shouldAskResolutionCheck({ normalizedText, hits, preferredCategory }) {
  // Deshabilitado: Evita colisiones con las reglas del LLM, que ahora
  // debe formular interacciones cortas ("¿pudiste probar?") de forma natural,
  // en lugar de añadir preguntas robóticas al final de cada turno resolutivo.
  return false;
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
    return [
      activeProduct?.name ? `Producto en seguimiento: ${activeProduct.name}.` : null,
      playbookConfig.initialMessage || null,
      activeProduct
        ? cleanProductRequestFromMessage(playbookConfig.dataRequestMessage || null)
        : playbookConfig.dataRequestMessage || null,
      playbookConfig.humanCloseMessage || null,
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

  // Falla de producto o default
  const fallbackLines = [
    productLine,
    "Veo que vamos a necesitar que un técnico o especialista revise este caso a fondo.",
    "Para agilizar y que te respondan con la solución, por favor dejanos por escrito:",
    activeProduct ? null : "El modelo exacto de tu equipo.",
    "Una fotito o captura de la factura de compra.",
    "Un videito corto, audio o detalle explicando la falla.",
    "En breve un compañero humano tomará tu caso. (No puedo confirmar garantías ni reemplazos de forma automática).",
  ];

  return fallbackLines
    .filter(Boolean)
    .join("\n");
}

function cleanProductRequestFromMessage(message) {
  if (!message) {
    return null;
  }

  // Remove variations of "1) Producto/modelo exacto" or "1- Producto..."
  // It handles list items anywhere in the text
  return message
    .replace(/[1-9]\)?\s*producto[\/\s]*modelo\s*(exacto|confirmame)?\.?,?\s*/gi, "")
    .replace(/[1-9]\)?\s*(producto|modelo)\s*(exacto|confirmame)?\.?,?\s*/gi, "")
    .replace(/(enviame|pasa|contame|deci|decime):\s*,\s*/gi, "$1: ")
    .replace(/,\s*,/g, ",")
    .replace(/:\s*,/g, ": ")
    .replace(/:\s*2\)/g, ": 1)") // Renumber if we removed the first one
    .replace(/,\s*2\)/g, ", 1)")
    .replace(/3\)/g, "2)")
    .replace(/4\)/g, "3)")
    .replace(/5\)/g, "4)")
    .trim();
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

function cleanCapabilityReply(value) {
  const text = String(value || "").trim();
  return text || null;
}

function appendLinkIfNeeded(text, supportLink) {
  if (!supportLink) {
    return text;
  }

  if (String(text || "").includes(String(supportLink))) {
    return text;
  }

  return [text, `Link de apoyo: ${supportLink}`].filter(Boolean).join("\n");
}

function formatBooleanAnswer({ value, activeProduct, specsMatch, positiveLine, negativeLine, unknownLine }) {
  const productName = activeProduct?.name || specsMatch?.product || "ese equipo";
  if (value === "true") {
    return positiveLine(productName, specsMatch);
  }

  if (value === "false") {
    return negativeLine(productName, specsMatch);
  }

  return unknownLine(productName, specsMatch);
}

function formatConnectPcAnswer({ value, activeProduct, specsMatch }) {
  return formatBooleanAnswer({
    value,
    activeProduct,
    specsMatch,
    positiveLine: (productName, row) => {
      const midiDetail = row?.sendsMidiUsb === "true" ? " y puede intercambiar MIDI por USB" : "";
      const audioDetail = row?.sendsAudioUsb === "true" ? " Tambien puede enviar audio por USB." : "";
      return `Si, ${productName} se puede conectar a una computadora.${midiDetail}${audioDetail}`.trim();
    },
    negativeLine: (productName) => `No, ${productName} no esta pensado para conectarse a una computadora como dispositivo USB.`,
    unknownLine: (_productName) => null,
  });
}

function formatMidiOverUsbAnswer({ value, activeProduct, specsMatch }) {
  return formatBooleanAnswer({
    value,
    activeProduct,
    specsMatch,
    positiveLine: (productName) => `Si, ${productName} puede enviar MIDI por USB.`,
    negativeLine: (productName) => `No, ${productName} no envia MIDI por USB.`,
    unknownLine: (_productName) => null,
  });
}

function formatAudioOverUsbAnswer({ value, activeProduct, specsMatch }) {
  return formatBooleanAnswer({
    value,
    activeProduct,
    specsMatch,
    positiveLine: (productName) => `Si, ${productName} puede enviar audio por USB.`,
    negativeLine: (productName) => `No, ${productName} no envia audio por USB.`,
    unknownLine: (_productName) => null,
  });
}

function formatDriverAnswer({ value, activeProduct, specsMatch }) {
  return formatBooleanAnswer({
    value,
    activeProduct,
    specsMatch,
    positiveLine: (productName, row) => {
      const classCompliantLine = row?.classCompliant === "true" ? " Ademas figura como class compliant." : "";
      return `Si, ${productName} requiere driver.${classCompliantLine}`.trim();
    },
    negativeLine: (productName, row) => {
      const classCompliantLine = row?.classCompliant === "true" ? " Figura como class compliant." : "";
      return `No, ${productName} no requiere driver especifico.${classCompliantLine}`.trim();
    },
    unknownLine: (_productName) => null,
  });
}

function formatMonoOutputAnswer({ value, activeProduct, specsMatch }) {
  return formatBooleanAnswer({
    value,
    activeProduct,
    specsMatch,
    positiveLine: (productName) => `Si, ${productName} tiene salida mono.`,
    negativeLine: (productName, row) => {
      if (row?.audioOutput) {
        return `No, ${productName} no es mono. La salida indicada es: ${row.audioOutput}.`;
      }
      return `No, ${productName} no tiene salida mono.`;
    },
    unknownLine: (_productName) => null,
  });
}

function formatSpeakersAnswer({ value, activeProduct, specsMatch }) {
  return formatBooleanAnswer({
    value,
    activeProduct,
    specsMatch,
    positiveLine: (productName, row) => {
      const monoLine = row?.monoOutput === "true" ? " La salida es mono." : "";
      return `Si, ${productName} tiene parlantes integrados.${monoLine}`.trim();
    },
    negativeLine: (productName) => `No, ${productName} no tiene parlantes integrados.`,
    unknownLine: (_productName) => null,
  });
}

function isExplicitProductSelection(normalizedText, detectedMention) {
  if (!detectedMention) {
    return false;
  }

  // Si la confianza es alta o media y hay una pista fuerte del producto, lo tomamos como explicito.
  if ((detectedMention.confidence === "high" || detectedMention.confidence === "medium") && hasStrongProductCue(normalizedText)) {
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

  const topRoot = buildProductRootSignature(candidates[0].product);
  if (!topRoot) {
    return null;
  }

  const variantsByKey = new Map();
  for (const candidate of candidates) {
    const root = buildProductRootSignature(candidate.product);
    if (!root || root !== topRoot) {
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

  const queryVariantTokens = extractDisambiguationTokensFromText(normalizedUserText);
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

  return canonicalizeSignatureTokens(tokens);
}

function buildProductRootSignature(product) {
  const tokens = tokenizeProductName(product)
    .filter((token) => !productClarifyCosmeticTokens.has(token))
    .filter((token) => !productClarifyGenericTokens.has(token))
    .filter((token) => !isVariantHintToken(token))
    .filter((token) => !/^\d{1,3}$/.test(token));

  return canonicalizeSignatureTokens(tokens);
}

function buildProductVariantKey(product) {
  const variantTokens = extractDisambiguationTokensFromProduct(product);
  if (variantTokens.length === 0) {
    return "standard";
  }

  return variantTokens.sort().join("+");
}

function extractVariantTokensFromProduct(product) {
  return extractVariantTokensFromText(normalize(product?.normalizedName || product?.name || ""));
}

function extractDisambiguationTokensFromProduct(product) {
  return extractDisambiguationTokensFromText(normalize(product?.normalizedName || product?.name || ""));
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

function extractDisambiguationTokensFromText(normalizedText) {
  const variantTokens = extractVariantTokensFromText(normalizedText);
  const numberTokens = tokenizeNormalizedText(normalizedText).filter((token) => /^\d{1,3}$/.test(token));
  return [...new Set([...variantTokens, ...numberTokens])];
}

function isVariantChoiceDecisive(queryVariantTokens, variantCandidates) {
  if (!queryVariantTokens || queryVariantTokens.length === 0) {
    return false;
  }

  const querySet = new Set(queryVariantTokens);
  const scores = variantCandidates.map((item) => {
    const variantTokens = extractDisambiguationTokensFromProduct(item.product);
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

function canonicalizeSignatureTokens(tokens) {
  return [...new Set(tokens.filter(Boolean))].sort().join(" ");
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
