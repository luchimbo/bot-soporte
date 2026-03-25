const fs = require("fs");
const XLSX = require("xlsx");

const { resolveProjectPath } = require("./runtime-paths");

const defaultPlaybookPath = resolveDefaultPlaybookPath();

const headerAliases = {
  id: ["id"],
  active: ["activo", "active"],
  brand: ["marca", "brand"],
  product: ["producto", "product"],
  productAliases: ["producto_aliases", "aliases_producto", "product_aliases"],
  category: ["categoria", "category"],
  intent: ["intencion", "intent"],
  questionModel: ["pregunta_modelo", "pregunta", "q", "question", "pregunta modelo"],
  questionAliases: ["pregunta_aliases", "question_aliases", "aliases_pregunta"],
  keywords: ["palabras_clave", "keywords"],
  approvedAnswer: ["respuesta_aprobada", "respuesta", "a", "approved_answer"],
  supportLink: ["link_apoyo", "link", "support_link"],
  requiresProduct: ["requiere_producto", "requires_product"],
  askIfResolved: ["preguntar_si_resolvio", "ask_if_resolved", "preguntar_si_resolvio"],
  unresolvedAction: ["si_no_resolvio_accion", "unresolved_action"],
  minConfidence: ["confianza_minima", "min_confidence"],
  notes: ["observaciones", "notes"],
  triggers: ["disparadores", "triggers"],
  initialMessage: ["mensaje_inicial", "initial_message"],
  requiredFields: ["campos_obligatorios", "required_fields"],
  dataRequestMessage: ["mensaje_pedido_datos", "data_request_message"],
  humanCloseMessage: ["mensaje_cierre_humano", "human_close_message"],
  escalateToHuman: ["escalar_a_humano", "escalate_to_human"],
  rule: ["regla", "rule"],
  type: ["tipo", "type"],
  text: ["texto", "text"],
  familyKey: ["family_key", "familykey", "clave_familia"],
  variantPolicy: ["variant_policy", "politica_variante"],
  isPrimaryModel: ["is_primary_model", "modelo_principal"],
  connectsToPc: ["se_conecta_a_pc", "connects_to_pc"],
  midiController: ["es_controlador_midi", "is_midi_controller"],
  sendsMidiUsb: ["envia_midi_por_usb", "sends_midi_over_usb"],
  sendsAudioUsb: ["envia_audio_por_usb", "sends_audio_over_usb"],
  requiresDriver: ["requiere_driver", "requires_driver"],
  classCompliant: ["class_compliant", "es_class_compliant"],
  hasSpeakers: ["tiene_parlantes", "has_speakers"],
  audioOutput: ["salida_audio", "audio_output"],
  monoOutput: ["salida_mono", "mono_output"],
  technicalNotes: ["notas_tecnicas", "technical_notes"],
  replyPc: ["respuesta_pc", "reply_pc"],
  replyMidi: ["respuesta_midi", "reply_midi"],
  replyAudioUsb: ["respuesta_audio_usb", "reply_audio_usb"],
  replyDriver: ["respuesta_driver", "reply_driver"],
  replySpeakers: ["respuesta_parlantes", "reply_speakers"],
  replyAudioOutput: ["respuesta_salida_audio", "reply_audio_output"],
};

let cache = {
  filePath: null,
  mtimeMs: 0,
  warnedMissing: false,
  faqRows: [],
  triageRows: [],
  policyRows: [],
  productSpecsRows: [],
};

function resolveDefaultPlaybookPath() {
  const preferredPaths = [
    resolveProjectPath(null, "archivos/SoporteBot.xlsx"),
    resolveProjectPath(null, "archivos/SoporteBot_completar.xlsx"),
  ].filter(Boolean);

  for (const filePath of preferredPaths) {
    if (filePath && fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return preferredPaths[0] || resolveProjectPath(null, "archivos/SoporteBot.xlsx");
}

function searchSupportFaq({ userText, activeProduct, preferredCategory = null, topK = 3 }) {
  const playbook = loadSupportPlaybook();
  if (!userText || playbook.faqRows.length === 0) {
    return [];
  }

  const normalizedText = normalize(userText);
  const queryTokens = tokenize(normalizedText);
  if (queryTokens.length === 0) {
    return [];
  }

  const scored = [];
  for (const row of playbook.faqRows) {
    const match = scoreFaqRow({
      row,
      normalizedText,
      queryTokens,
      activeProduct,
      preferredCategory,
    });

    if (match) {
      scored.push(match);
    }
  }

  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, topK);
}

function findSupportTriageConfig(route) {
  const playbook = loadSupportPlaybook();
  if (!route) {
    return null;
  }

  const normalizedRoute = normalize(route);
  return playbook.triageRows.find((row) => normalize(row.category) === normalizedRoute) || null;
}

function matchSupportTriage({ normalizedText, preferredCategory = null }) {
  const playbook = loadSupportPlaybook();
  if (!normalizedText || playbook.triageRows.length === 0) {
    return null;
  }

  let best = null;
  for (const row of playbook.triageRows) {
    const score = scoreTriageRow({ row, normalizedText, preferredCategory });
    if (score <= 0) {
      continue;
    }

    if (!best || score > best.score) {
      best = { ...row, score };
    }
  }

  return best;
}

function getSupportPolicyText(ruleName, fallback = null) {
  const playbook = loadSupportPlaybook();
  const normalizedRule = normalize(ruleName);
  const match = playbook.policyRows.find((row) => normalize(row.rule) === normalizedRule);
  return match?.text || fallback;
}

function getSupportPolicyTextsByType(type) {
  const playbook = loadSupportPlaybook();
  const normalizedType = normalize(type);
  return playbook.policyRows
    .filter((row) => normalize(row.type) === normalizedType)
    .map((row) => row.text)
    .filter(Boolean);
}

function getSupportPlaybookInfo() {
  const playbook = loadSupportPlaybook();
  return {
    filePath: playbook.filePath,
    faqRows: playbook.faqRows.length,
    triageRows: playbook.triageRows.length,
    policyRows: playbook.policyRows.length,
    productSpecsRows: playbook.productSpecsRows.length,
  };
}

function loadSupportPlaybook() {
  const filePath = getSupportPlaybookPath();

  if (!fs.existsSync(filePath)) {
    if (!cache.warnedMissing) {
      console.warn(`No encontre playbook de soporte en ${filePath}. Sigo con reglas internas.`);
      cache.warnedMissing = true;
    }

    cache = {
      filePath,
      mtimeMs: 0,
      warnedMissing: true,
      faqRows: [],
      triageRows: [],
      policyRows: [],
      productSpecsRows: [],
    };
    return cache;
  }

  const stat = fs.statSync(filePath);
  if (cache.filePath === filePath && cache.mtimeMs === stat.mtimeMs) {
    return cache;
  }

  const workbook = XLSX.readFile(filePath, { cellDates: false });

  cache = {
    filePath,
    mtimeMs: stat.mtimeMs,
    warnedMissing: false,
    faqRows: parseFaqSheet(readSheet(workbook, "faq_respuestas")),
    triageRows: parseTriageSheet(readSheet(workbook, "triage_humano")),
    policyRows: parsePolicySheet(readSheet(workbook, "politicas_bot")),
    productSpecsRows: parseProductSpecsSheet(readSheet(workbook, "product_specs")),
  };

  return cache;
}

function parseFaqSheet(rows) {
  return rows
    .map((row, index) => {
      const id = readField(row, "id") || `faq_${index + 1}`;
      if (!isRowActive(readField(row, "active"))) {
        return null;
      }

      const approvedAnswer = cleanText(readField(row, "approvedAnswer"));
      if (!approvedAnswer) {
        return null;
      }

      const normalizedQuestion = normalize(readField(row, "questionModel"));
      const questionAliases = splitMulti(readField(row, "questionAliases")).map(normalize);
      const keywordTokens = splitMulti(readField(row, "keywords")).map(normalize);
      const product = cleanText(readField(row, "product"));
      const productAliases = splitMulti(readField(row, "productAliases")).map(normalize);
      const category = cleanText(readField(row, "category")) || "consulta_general";
      const unresolvedAction = cleanText(readField(row, "unresolvedAction")) || "falla_producto";

      return {
        id,
        brand: cleanText(readField(row, "brand")) || null,
        product,
        productNormalized: normalize(product),
        productFamilyKey: buildFamilyKey(normalize(product)),
        productAliases,
        category,
        intent: cleanText(readField(row, "intent")) || category,
        questionModel: cleanText(readField(row, "questionModel")) || null,
        normalizedQuestion,
        questionAliases,
        keywordTokens,
        approvedAnswer,
        supportLink: cleanText(readField(row, "supportLink")) || null,
        requiresProduct: parseBoolean(readField(row, "requiresProduct")),
        askIfResolved: parseBoolean(readField(row, "askIfResolved"), true),
        unresolvedAction,
        minConfidence: parseConfidence(readField(row, "minConfidence"), 0.72),
        notes: cleanText(readField(row, "notes")) || null,
      };
    })
    .filter(Boolean);
}

function parseTriageSheet(rows) {
  return rows
    .map((row, index) => {
      if (!isRowActive(readField(row, "active"))) {
        return null;
      }

      const category = cleanText(readField(row, "category"));
      if (!category) {
        return null;
      }

      return {
        id: readField(row, "id") || `triage_${index + 1}`,
        category,
        triggers: splitMulti(readField(row, "triggers")).map(normalize),
        initialMessage: cleanText(readField(row, "initialMessage")) || null,
        requiredFields: splitMulti(readField(row, "requiredFields")).map(cleanText).filter(Boolean),
        dataRequestMessage: cleanText(readField(row, "dataRequestMessage")) || null,
        humanCloseMessage: cleanText(readField(row, "humanCloseMessage")) || null,
        escalateToHuman: parseBoolean(readField(row, "escalateToHuman"), true),
      };
    })
    .filter(Boolean);
}

function parsePolicySheet(rows) {
  return rows
    .map((row, index) => {
      if (!isRowActive(readField(row, "active"))) {
        return null;
      }

      const rule = cleanText(readField(row, "rule"));
      const text = cleanText(readField(row, "text"));
      if (!rule || !text) {
        return null;
      }

      return {
        id: readField(row, "id") || `policy_${index + 1}`,
        rule,
        type: cleanText(readField(row, "type")) || "mensaje",
        text,
      };
    })
    .filter(Boolean);
}

function parseProductSpecsSheet(rows) {
  return rows
    .map((row, index) => {
      if (!isRowActive(readField(row, "active"))) {
        return null;
      }

      const product = cleanText(readField(row, "product"));
      const familyKey = cleanText(readField(row, "familyKey")) || buildFamilyKey(normalize(product));
      if (!product && !familyKey) {
        return null;
      }

      return {
        id: readField(row, "id") || `product_specs_${index + 1}`,
        brand: cleanText(readField(row, "brand")) || null,
        product,
        productNormalized: normalize(product),
        productAliases: splitMulti(readField(row, "productAliases")).map(normalize),
        familyKey: normalize(familyKey),
        variantPolicy: cleanText(readField(row, "variantPolicy")) || "cosmetic",
        isPrimaryModel: parseBoolean(readField(row, "isPrimaryModel"), false),
        connectsToPc: parseTriState(readField(row, "connectsToPc")),
        midiController: parseTriState(readField(row, "midiController")),
        sendsMidiUsb: parseTriState(readField(row, "sendsMidiUsb")),
        sendsAudioUsb: parseTriState(readField(row, "sendsAudioUsb")),
        requiresDriver: parseTriState(readField(row, "requiresDriver")),
        classCompliant: parseTriState(readField(row, "classCompliant")),
        hasSpeakers: parseTriState(readField(row, "hasSpeakers")),
        audioOutput: cleanText(readField(row, "audioOutput")) || null,
        monoOutput: parseTriState(readField(row, "monoOutput")),
        technicalNotes: cleanText(readField(row, "technicalNotes")) || null,
        replyPc: cleanText(readField(row, "replyPc")) || null,
        replyMidi: cleanText(readField(row, "replyMidi")) || null,
        replyAudioUsb: cleanText(readField(row, "replyAudioUsb")) || null,
        replyDriver: cleanText(readField(row, "replyDriver")) || null,
        replySpeakers: cleanText(readField(row, "replySpeakers")) || null,
        replyAudioOutput: cleanText(readField(row, "replyAudioOutput")) || null,
        supportLink: cleanText(readField(row, "supportLink")) || null,
        notes: cleanText(readField(row, "notes")) || null,
      };
    })
    .filter(Boolean);
}

function findProductSpecs({ activeProduct = null, userText = "" } = {}) {
  const playbook = loadSupportPlaybook();
  if (playbook.productSpecsRows.length === 0) {
    return null;
  }

  const normalizedText = normalize(userText);
  const normalizedActiveName = normalize(activeProduct?.normalizedName || activeProduct?.name || "");
  const activeFamilyKey = normalize(activeProduct?.familyKey || buildFamilyKey(normalizedActiveName));

  let exactMatch = null;
  let familyPrimary = null;
  let familyAny = null;

  for (const row of playbook.productSpecsRows) {
    if (normalizedActiveName && row.productNormalized && row.productNormalized === normalizedActiveName) {
      exactMatch = row;
      break;
    }

    if (normalizedText) {
      const aliases = [row.productNormalized, ...row.productAliases].filter(Boolean);
      if (aliases.some((alias) => alias && normalizedText.includes(alias))) {
        exactMatch = exactMatch || row;
      }
    }

    if (activeFamilyKey && row.familyKey && row.familyKey === activeFamilyKey) {
      if (row.isPrimaryModel) {
        familyPrimary = familyPrimary || row;
      }
      familyAny = familyAny || row;
    }
  }

  return exactMatch || familyPrimary || familyAny || null;
}

function findProductFeature({ activeProduct = null, userText = "" } = {}) {
  const spec = findProductSpecs({ activeProduct, userText });
  if (!spec || !spec.technicalNotes) {
    return null;
  }

  const normalizedText = normalize(userText);
  const notes = spec.technicalNotes.toLowerCase();
  
  // Mapeo de características con palabras clave y templates de respuesta
  const featureMap = {
    // Conectividad
    'bluetooth': {
      keywords: ['bluetooth', 'inalambrico', 'wireless'],
      positiveTemplate: 'Sí, el ${product} cuenta con conectividad Bluetooth para comunicación inalámbrica.',
      negativeTemplate: 'No, el ${product} no tiene Bluetooth, se conecta mediante cables.'
    },
    'usb-c': {
      keywords: ['usb-c', 'usb c', 'type-c'],
      positiveTemplate: 'Sí, el ${product} utiliza conexión USB-C.',
      negativeTemplate: 'No, el ${product} no usa USB-C.'
    },
    'midi': {
      keywords: ['midi'],
      positiveTemplate: 'Sí, el ${product} es compatible con MIDI para control de instrumentos.',
      negativeTemplate: 'No, el ${product} no tiene capacidad MIDI.'
    },
    'cv': {
      keywords: ['cv', 'cv/gate', 'gate'],
      positiveTemplate: 'Sí, el ${product} incluye salidas CV/Gate para controlar sintetizadores analógicos.',
      negativeTemplate: 'No, el ${product} no tiene salidas CV/Gate.'
    },
    
    // Características de controladores
    'aftertouch': {
      keywords: ['aftertouch', 'after touch'],
      positiveTemplate: 'Sí, el ${product} tiene aftertouch (sensibilidad a la presión después de pulsar la tecla).',
      negativeTemplate: 'No, el ${product} no incluye aftertouch.'
    },
    'velocity': {
      keywords: ['velocity', 'sensible', 'sensibles'],
      positiveTemplate: 'Sí, el ${product} tiene teclas sensibles a la velocidad (velocity sensitive).',
      negativeTemplate: 'No, el ${product} no tiene sensibilidad a la velocidad.'
    },
    'secuenciador': {
      keywords: ['secuenciador', 'sequencer'],
      positiveTemplate: 'Sí, el ${product} incluye un secuenciador integrado para crear patrones musicales.',
      negativeTemplate: 'No, el ${product} no tiene secuenciador incorporado.'
    },
    'arpegiador': {
      keywords: ['arpegiador', 'arpeggiator'],
      positiveTemplate: 'Sí, el ${product} cuenta con arpegiador para generar secuencias automáticas de notas.',
      negativeTemplate: 'No, el ${product} no incluye arpegiador.'
    },
    
    // Interfaces
    'phantom': {
      keywords: ['phantom power', 'phantom', '48v', '48 v'],
      positiveTemplate: 'Sí, el ${product} incluye alimentación phantom de 48V para micrófonos condensador.',
      negativeTemplate: 'No, el ${product} no tiene alimentación phantom.'
    },
    'phantom power': {
      keywords: ['phantom power', 'phantom', '48v', '48 v'],
      positiveTemplate: 'Sí, el ${product} incluye alimentación phantom de 48V para micrófonos condensador.',
      negativeTemplate: 'No, el ${product} no tiene alimentación phantom.'
    },
    'loopback': {
      keywords: ['loopback'],
      positiveTemplate: 'Sí, el ${product} tiene función loopback para grabar el audio del sistema.',
      negativeTemplate: 'No, el ${product} no incluye loopback.'
    },
    'dsp': {
      keywords: ['dsp'],
      positiveTemplate: 'Sí, el ${product} incluye procesamiento DSP (Digital Signal Processing) integrado.',
      negativeTemplate: 'No, el ${product} no tiene DSP integrado.'
    },
    
    // Sintetizadores
    'vocoder': {
      keywords: ['vocoder'],
      positiveTemplate: 'Sí, el ${product} incluye un vocoder para efectos de voz sintetizada.',
      negativeTemplate: 'No, el ${product} no tiene vocoder.'
    },
    'parlantes': {
      keywords: ['parlantes', 'altavoces', 'speakers'],
      positiveTemplate: 'Sí, el ${product} tiene parlantes integrados para monitoreo.',
      negativeTemplate: 'No, el ${product} no incluye parlantes integrados.'
    },
    
    // Micrófonos
    'condensador': {
      keywords: ['condensador', 'condenser'],
      positiveTemplate: 'Sí, el ${product} es un micrófono de condensador con diafragma sensible.',
      negativeTemplate: 'No, el ${product} no es de condensador.'
    },
    'dinamico': {
      keywords: ['dinamico', 'dynamic'],
      positiveTemplate: 'Sí, el ${product} es un micrófono dinámico, ideal para uso en vivo.',
      negativeTemplate: 'No, el ${product} no es dinámico.'
    },
    'cardioide': {
      keywords: ['cardioide', 'cardioid'],
      positiveTemplate: 'Sí, el ${product} tiene patrón polar cardioide que captura sonido frontal.',
      negativeTemplate: 'No, el ${product} no tiene patrón cardioide.'
    },
    'diafragma': {
      keywords: ['diafragma'],
      positiveTemplate: 'Sí, el ${product} cuenta con diafragma grande para mejor captación de frecuencias.',
      negativeTemplate: 'No, el ${product} no especifica diafragma.'
    },
    
    // Baterías
    'mesh': {
      keywords: ['mesh'],
      positiveTemplate: 'Sí, los pads del ${product} son de malla (mesh) para sensación más realista.',
      negativeTemplate: 'No, el ${product} no tiene pads mesh.'
    },
    
    // Auriculares
    'drivers': {
      keywords: ['drivers'],
      positiveTemplate: 'Sí, el ${product} especifica el tamaño de sus drivers en las características técnicas.',
      negativeTemplate: 'No tengo información específica sobre los drivers del ${product}.'
    },
    'cerrado': {
      keywords: ['cerrado', 'closed'],
      positiveTemplate: 'Sí, el ${product} tiene diseño cerrado (closed-back) para aislamiento sonoro.',
      negativeTemplate: 'No, el ${product} no es de diseño cerrado.'
    },
    'abierto': {
      keywords: ['abierto', 'open'],
      positiveTemplate: 'Sí, el ${product} tiene diseño abierto (open-back) para campo sonoro más natural.',
      negativeTemplate: 'No, el ${product} no es de diseño abierto.'
    },
  };
  
  // Buscar qué característica se está preguntando
  for (const [feature, config] of Object.entries(featureMap)) {
    if (normalizedText.includes(feature)) {
      const hasFeature = config.keywords.some(kw => notes.includes(kw));
      const productName = formatProductName(spec.product);
      
      if (hasFeature) {
        // Generar respuesta positiva con contexto adicional
        let answer = config.positiveTemplate.replace('${product}', productName);
        
        // Agregar información adicional de las notas técnicas si es relevante
        const additionalInfo = extractAdditionalContext(notes, feature);
        if (additionalInfo) {
          answer += ' ' + additionalInfo;
        }
        
        return {
          spec,
          feature,
          hasFeature: true,
          answer: answer,
          details: [feature]
        };
      } else {
        return {
          spec,
          feature,
          hasFeature: false,
          answer: config.negativeTemplate.replace('${product}', productName),
          details: []
        };
      }
    }
  }
  
  return null;
}

function formatProductName(product) {
  // Convertir nombre de producto a formato más legible
  return product
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function extractAdditionalContext(notes, feature) {
  // Extraer información adicional relevante de las notas técnicas
  const notesLower = notes.toLowerCase();
  
  // Contextos específicos por característica
  const contexts = {
    'secuenciador': () => {
      const stepsMatch = notesLower.match(/(\d+)\s*(pasos?|steps?|paso)/);
      if (stepsMatch) return `Tiene ${stepsMatch[1]} pasos.`;
      return '';
    },
    'arpegiador': () => {
      if (notesLower.includes('modos') || notesLower.includes('patterns')) {
        return 'Incluye múltiples modos y patrones.';
      }
      return '';
    },
    'phantom': () => {
      if (notesLower.includes('48v')) return 'Proporciona 48V estándar.';
      return '';
    },
    'condensador': () => {
      if (notesLower.includes('diafragma')) return 'Cuenta con diafragma de gran tamaño.';
      return '';
    },
    'mesh': () => {
      return 'La malla proporciona mejor respuesta y durabilidad.';
    }
  };
  
  if (contexts[feature]) {
    return contexts[feature]();
  }
  
  return '';
}

function readSheet(workbook, targetName) {
  const sheetName = workbook.SheetNames.find((name) => normalize(name) === normalize(targetName));
  if (!sheetName) {
    return [];
  }

  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
  return rawRows.map(normalizeRowKeys);
}

function normalizeRowKeys(row) {
  const normalized = {};
  for (const [rawKey, value] of Object.entries(row || {})) {
    normalized[normalizeHeader(rawKey)] = value;
  }
  return normalized;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function readField(row, fieldName) {
  const aliases = headerAliases[fieldName] || [fieldName];
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return row[key];
    }
  }

  return "";
}

function scoreFaqRow({ row, normalizedText, queryTokens, activeProduct, preferredCategory }) {
  let score = 0;

  const corpus = [
    row.normalizedQuestion,
    ...row.questionAliases,
    ...row.keywordTokens,
  ]
    .filter(Boolean)
    .join(" ");

  if (!corpus) {
    return null;
  }

  const corpusTokens = tokenize(corpus);
  const overlap = countOverlap(queryTokens, corpusTokens);
  if (overlap === 0) {
    return null;
  }

  score += overlap * 1.8;
  score += diceCoefficient(normalizedText, corpus) * 6;

  if (preferredCategory && normalize(row.category) === normalize(preferredCategory)) {
    score += 2.6;
  }

  if (row.productNormalized) {
    const productScore = scoreFaqProductMatch({ row, activeProduct, normalizedText });
    if (productScore < 0) {
      return null;
    }
    score += productScore;
  } else if (row.requiresProduct && !activeProduct) {
    score -= 4;
  }

  const confidence = Math.max(0, Math.min(score / 18, 1));
  if (confidence < row.minConfidence) {
    return null;
  }

  return {
    ...row,
    score: Number(score.toFixed(3)),
    confidence: Number(confidence.toFixed(3)),
  };
}

function scoreFaqProductMatch({ row, activeProduct, normalizedText }) {
  const rowFamily = row.productFamilyKey || buildFamilyKey(row.productNormalized);
  if (activeProduct) {
    const activeFamily = activeProduct.familyKey || buildFamilyKey(normalize(activeProduct.normalizedName || activeProduct.name || ""));
    if (rowFamily && activeFamily && isSameFamilyKey(rowFamily, activeFamily)) {
      return 7;
    }

    if (row.productNormalized && normalize(activeProduct.normalizedName || activeProduct.name || "") === row.productNormalized) {
      return 8;
    }

    return -10;
  }

  const aliases = [row.productNormalized, ...row.productAliases].filter(Boolean);
  for (const alias of aliases) {
    if (alias && normalizedText.includes(alias)) {
      return 6;
    }
  }

  return row.requiresProduct ? -4 : 0;
}

function scoreTriageRow({ row, normalizedText, preferredCategory }) {
  let score = 0;

  if (preferredCategory && normalize(row.category) === normalize(preferredCategory)) {
    score += 4;
  }

  for (const trigger of row.triggers) {
    if (!trigger) {
      continue;
    }

    if (normalizedText.includes(trigger)) {
      score += trigger.length >= 10 ? 3 : 1.8;
    }
  }

  return score;
}

function countOverlap(left, right) {
  const rightSet = new Set(right);
  let count = 0;
  for (const token of left) {
    if (rightSet.has(token)) {
      count += 1;
    }
  }
  return count;
}

function splitMulti(value) {
  return String(value || "")
    .split(/[\n|;,]+/)
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function parseBoolean(value, fallback = false) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  return ["true", "1", "si", "sí", "yes", "x"].includes(raw);
}

function parseTriState(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return "unknown";
  }

  if (["true", "1", "si", "sí", "yes", "x"].includes(raw)) {
    return "true";
  }

  if (["false", "0", "no", "n"].includes(raw)) {
    return "false";
  }

  return "unknown";
}

function parseConfidence(value, fallback = 0.72) {
  const parsed = Number(String(value || "").replace(",", "."));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed > 1) {
    return Math.max(0, Math.min(parsed / 100, 1));
  }

  return Math.max(0, Math.min(parsed, 1));
}

function isRowActive(value) {
  return parseBoolean(value, true);
}

function cleanText(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFamilyKey(normalizedName) {
  return tokenize(normalizedName)
    .filter((token) => !cosmeticTokenSet.has(token))
    .join(" ");
}

function isSameFamilyKey(left, right) {
  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  if (left.includes(right) || right.includes(left)) {
    return true;
  }

  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  const overlap = countOverlap(leftTokens, rightTokens);
  return overlap >= Math.min(leftTokens.length, rightTokens.length, 2);
}

function getSupportPlaybookPath() {
  return resolveProjectPath(process.env.SUPPORT_PLAYBOOK_FILE, defaultPlaybookPath);
}

function diceCoefficient(left, right) {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  if (leftBigrams.length === 0 || rightBigrams.length === 0) {
    return 0;
  }

  const rightCount = new Map();
  for (const item of rightBigrams) {
    rightCount.set(item, (rightCount.get(item) || 0) + 1);
  }

  let overlap = 0;
  for (const item of leftBigrams) {
    const count = rightCount.get(item) || 0;
    if (count > 0) {
      overlap += 1;
      rightCount.set(item, count - 1);
    }
  }

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
}

function bigrams(text) {
  const compact = normalize(text);
  if (compact.length < 2) {
    return [];
  }

  const out = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    out.push(compact.slice(index, index + 2));
  }

  return out;
}

const cosmeticTokenSet = new Set([
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

module.exports = {
  searchSupportFaq,
  findSupportTriageConfig,
  matchSupportTriage,
  findProductSpecs,
  findProductFeature,
  getSupportPolicyText,
  getSupportPolicyTextsByType,
  getSupportPlaybookInfo,
};
