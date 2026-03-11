const fs = require("fs");
const { resolveProjectPath } = require("./runtime-paths");

let cache = {
  filePath: null,
  mtimeMs: 0,
  documents: [],
  responseExamples: [],
  sourceCounts: {},
  warnedMissing: false,
};

function searchKnowledgeBase(query, topK = 5, options = {}) {
  const kb = loadKnowledgeBase();
  if (!query || kb.documents.length === 0) {
    return [];
  }

  const allowedSourceSet = buildAllowedSourceSet(options.allowedSources);

  const normalizedQuery = normalize(query);
  const queryTokens = tokenize(normalizedQuery);
  if (queryTokens.length === 0) {
    return [];
  }

  const queryIntent = detectIntent(normalizedQuery);
  const scored = [];

  for (const doc of kb.documents) {
    if (allowedSourceSet && !allowedSourceSet.has(doc.source)) {
      continue;
    }

    const score = scoreDocument({
      doc,
      normalizedQuery,
      queryTokens,
      queryIntent,
      productContext: options.productContext || null,
    });

    if (score > 0) {
      scored.push({ doc, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((item) => ({
    id: item.doc.id,
    source: item.doc.source,
    category: item.doc.category,
    createdAt: item.doc.createdAt,
    text: item.doc.text,
    metadata: item.doc.metadata,
    score: Number(item.score.toFixed(3)),
  }));
}

function getKnowledgeBaseInfo() {
  const kb = loadKnowledgeBase();
  const sourceBreakdown = {
    ...kb.sourceCounts,
  };

  const manualDocuments = Object.entries(sourceBreakdown)
    .filter(([source]) => isManualSource(source))
    .reduce((acc, [, count]) => acc + Number(count || 0), 0);

  return {
    filePath: kb.filePath,
    totalDocuments: kb.documents.length,
    totalResponseExamples: kb.responseExamples.length,
    manualDocuments,
    sourceBreakdown,
  };
}

function searchHistoricalResponses(query, topK = 3, preferredCategory = null, options = {}) {
  const kb = loadKnowledgeBase();
  if (!query || kb.responseExamples.length === 0) {
    return [];
  }

  const normalizedQuery = normalize(query);
  const queryTokens = tokenize(normalizedQuery);
  if (queryTokens.length === 0) {
    return [];
  }

  const queryIntent = preferredCategory || detectIntent(normalizedQuery);
  const scored = [];

  for (const example of kb.responseExamples) {
    const score = scoreStyleExample({
      example,
      normalizedQuery,
      queryTokens,
      queryIntent,
      productContext: options.productContext || null,
    });

    if (score > 0) {
      scored.push({ example, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, topK).map((item) => ({
    id: item.example.id,
    source: item.example.source,
    category: item.example.category,
    createdAt: item.example.createdAt,
    userText: item.example.userText,
    agentReply: item.example.agentReply,
    metadata: item.example.metadata,
    score: Number(item.score.toFixed(3)),
  }));
}

function loadKnowledgeBase() {
  const filePath = getKnowledgeBasePath();

  if (!fs.existsSync(filePath)) {
    if (!cache.warnedMissing) {
      console.warn(
        `No encontre base de conocimiento en ${filePath}. Ejecuta: npm run build:kb`
      );
      cache.warnedMissing = true;
    }
    cache.filePath = filePath;
    cache.documents = [];
    cache.responseExamples = [];
    cache.sourceCounts = {};
    cache.mtimeMs = 0;
    return cache;
  }

  const stat = fs.statSync(filePath);
  if (cache.filePath === filePath && cache.mtimeMs === stat.mtimeMs) {
    return cache;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const docs = Array.isArray(parsed.documents) ? parsed.documents : [];
  const examples = Array.isArray(parsed.responseExamples) ? parsed.responseExamples : [];
  const validDocs = docs.filter((doc) => doc && typeof doc.text === "string" && doc.text.trim());
  const sourceCounts = countBySource(validDocs);

  cache = {
    filePath,
    mtimeMs: stat.mtimeMs,
    warnedMissing: false,
    sourceCounts,
    documents: validDocs
      .map((doc) => {
        const normalized = normalize(doc.text);
        return {
          ...doc,
          _normalizedText: normalized,
          _tokenSet: new Set(tokenize(normalized)),
        };
      }),
    responseExamples: examples
      .filter(
        (item) =>
          item &&
          typeof item.userText === "string" &&
          item.userText.trim() &&
          typeof item.agentReply === "string" &&
          item.agentReply.trim() &&
          item.metadata?.resolutionSignal !== "unresolved"
      )
      .map((item) => {
        const normalizedUser = normalize(item.userText);
        const normalizedReply = normalize(item.agentReply);
        const qualityScore = Number(item.metadata?.qualityScore || item.metadata?.baseQualityScore || 0);
        const resolutionSignal = item.metadata?.resolutionSignal || "unknown";

        return {
          ...item,
          _normalizedUser: normalizedUser,
          _normalizedReply: normalizedReply,
          _tokenSet: new Set(tokenize(`${normalizedUser} ${normalizedReply}`)),
          _qualityScore: Number.isFinite(qualityScore) ? qualityScore : 0,
          _resolutionSignal: resolutionSignal,
        };
      }),
  };

  return cache;
}

function getKnowledgeBasePath() {
  return resolveProjectPath(process.env.KNOWLEDGE_BASE_FILE, "data/knowledge-base.json");
}

function scoreDocument({ doc, normalizedQuery, queryTokens, queryIntent, productContext }) {
  let score = 0;

  if (doc._normalizedText.includes(normalizedQuery)) {
    score += 16;
  }

  let overlap = 0;
  for (const token of queryTokens) {
    if (token.length < 3) {
      continue;
    }

    if (doc._tokenSet.has(token)) {
      overlap += 1;
      score += 2;
    }
  }

  score += Math.min(overlap, 8) * 0.75;

  if (queryIntent !== "consulta_general" && doc.category === queryIntent) {
    score += 4;
  }

  if (queryIntent === "devolucion" && /devol|reembolso|cambio/.test(doc._normalizedText)) {
    score += 2;
  }

  if (queryIntent === "falla_producto" && /falla|error|garanti|defecto/.test(doc._normalizedText)) {
    score += 2;
  }

  if (isManualSource(doc.source)) {
    if (queryIntent === "falla_producto" || queryIntent === "como_hacer") {
      score += 2.6;
    }

    if (queryIntent === "devolucion") {
      score -= 3.1;
    }

    if (
      /manual|configur|instal|driver|firmware|midi|usb|latencia|setup|troubleshoot|input|output|conexion|conecta/.test(
        normalizedQuery
      ) &&
      /manual|configure|setup|recording|driver|firmware|midi|usb|latency|input|output|connect|troubleshoot/.test(
        doc._normalizedText
      )
    ) {
      score += 1.8;
    }
  }

  score += scoreProductContext(doc._normalizedText, productContext);

  return score;
}

function scoreStyleExample({ example, normalizedQuery, queryTokens, queryIntent, productContext }) {
  let score = 0;

  if (example._normalizedUser.includes(normalizedQuery)) {
    score += 14;
  }

  if (example._normalizedReply.includes(normalizedQuery)) {
    score += 3;
  }

  let overlap = 0;
  for (const token of queryTokens) {
    if (token.length < 3) {
      continue;
    }

    if (example._tokenSet.has(token)) {
      overlap += 1;
      score += 2;
    }
  }

  score += Math.min(overlap, 8) * 0.7;

  if (queryIntent !== "consulta_general" && example.category === queryIntent) {
    score += 4;
  }

  if (queryIntent === "devolucion" && /devol|reembolso|cambio/.test(example._normalizedReply)) {
    score += 2;
  }

  if (queryIntent === "falla_producto" && /falla|error|garanti|defecto/.test(example._normalizedReply)) {
    score += 2;
  }

  if (example._qualityScore > 0) {
    score += Math.min(example._qualityScore, 8) * 0.8;
  }

  if (example._resolutionSignal === "resolved") {
    score += 2;
  }

  score += scoreProductContext(
    `${example._normalizedUser} ${example._normalizedReply}`,
    productContext
  );

  return score;
}

function scoreProductContext(normalizedText, productContext) {
  if (!productContext) {
    return 0;
  }

  const padded = ` ${normalizedText} `;
  let score = 0;
  let matched = false;

  if (productContext.normalizedName && normalizedText.includes(productContext.normalizedName)) {
    score += 8;
    matched = true;
  }

  if (productContext.skuNorm && normalizedText.includes(productContext.skuNorm)) {
    score += 6;
    matched = true;
  }

  const rareHits = countWordHits(padded, productContext.rareTokens || []);
  if (rareHits > 0) {
    score += rareHits * 2.8;
    matched = true;
  }

  const modelMarkerHits = countAliasHits(normalizedText, productContext.modelMarkers || []);
  if (modelMarkerHits > 0) {
    score += Math.min(modelMarkerHits, 2) * 6.2;
    matched = true;
  }

  const baseHits = countWordHits(padded, productContext.tokens || []);
  if (baseHits > 0) {
    score += Math.min(baseHits, 4) * 1.2;
    matched = true;
  }

  const numberHits = countNumberMarkerHits(padded, productContext.numberTokens || []);
  if (numberHits > 0) {
    score += Math.min(numberHits, 3) * 2.2;
    matched = true;
  }

  const aliasHits = countAliasHits(normalizedText, productContext.aliases || []);
  if (aliasHits > 0) {
    score += Math.min(aliasHits, 2) * 3.5;
    matched = true;
  }

  if (!matched) {
    score -= 2.5;
  }

  return score;
}

function countWordHits(paddedText, tokens) {
  let hits = 0;
  for (const token of tokens) {
    if (!token || token.length < 3) {
      continue;
    }

    if (paddedText.includes(` ${token} `)) {
      hits += 1;
    }
  }
  return hits;
}

function countAliasHits(normalizedText, aliases) {
  let hits = 0;
  for (const alias of aliases) {
    if (!alias || alias.length < 4) {
      continue;
    }

    if (normalizedText.includes(alias)) {
      hits += 1;
    }
  }
  return hits;
}

function countNumberMarkerHits(paddedText, numberTokens) {
  let hits = 0;
  for (const token of numberTokens) {
    const value = String(token || "").trim();
    if (!value) {
      continue;
    }

    const pattern = new RegExp(`\\b${escapeRegExp(value)}\\b`);
    if (pattern.test(paddedText)) {
      hits += 1;
    }
  }

  return hits;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectIntent(text) {
  if (/devol|devolver|reembolso|reintegro|cambio/.test(text)) {
    return "devolucion";
  }

  if (/falla|error|defecto|no (anda|funciona|prende|enciende|conecta)|garanti|reclamo/.test(text)) {
    return "falla_producto";
  }

  if (/como (hago|configur|instal|uso)|ayuda|consulta/.test(text)) {
    return "como_hacer";
  }

  return "consulta_general";
}

function buildAllowedSourceSet(allowedSources) {
  if (!Array.isArray(allowedSources) || allowedSources.length === 0) {
    return null;
  }

  const normalized = allowedSources
    .map((item) => String(item || "").trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return null;
  }

  return new Set(normalized);
}

function isManualSource(source) {
  return String(source || "").startsWith("manual_");
}

function countBySource(docs) {
  const out = {};
  for (const doc of docs) {
    const source = doc?.source || "unknown";
    out[source] = (out[source] || 0) + 1;
  }
  return out;
}

function tokenize(text) {
  return text
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  searchKnowledgeBase,
  searchHistoricalResponses,
  getKnowledgeBaseInfo,
};
