const fs = require("fs");
const XLSX = require("xlsx");
const { resolveProjectPath } = require("./runtime-paths");

const defaultCatalogPath = resolveProjectPath(null, "archivos/Productos.xlsx");

const genericProductTokens = new Set([
  "producto",
  "productos",
  "controlador",
  "controladores",
  "teclado",
  "teclados",
  "organo",
  "musical",
  "midi",
  "audio",
  "studio",
  "usb",
  "black",
  "white",
  "edition",
  "mk",
  "para",
  "con",
  "sin",
  "por",
  "del",
  "de",
  "la",
  "el",
  "los",
  "las",
]);

const cosmeticTokens = new Set([
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

const highImpactVariantTokens = new Set([
  "essential",
  "pro",
  "mini",
  "plus",
  "max",
  "lite",
  "air",
  "go",
  "mk2",
  "mk3",
  "mk4",
  "mk5",
  "v2",
  "v3",
  "v4",
]);

const conversationNoiseTokens = new Set([
  "no",
  "hola",
  "buenas",
  "buen",
  "dia",
  "dias",
  "tarde",
  "tardes",
  "noche",
  "sigue",
  "igual",
  "mismo",
  "todavia",
  "aun",
  "anda",
  "funciona",
  "falla",
  "error",
  "ayuda",
  "quiero",
  "necesito",
]);

const confidenceRank = {
  low: 1,
  medium: 2,
  high: 3,
};

let cache = {
  filePath: null,
  mtimeMs: 0,
  warnedMissing: false,
  products: [],
  tokenCounts: {},
  productByKey: new Map(),
};

function detectProductMention(text, options = {}) {
  const catalog = loadCatalog();
  if (catalog.products.length === 0 || !text) {
    return null;
  }

  const normalizedText = normalize(text);
  if (!normalizedText) {
    return null;
  }

  const compactText = normalizedText.replace(/\s+/g, "");
  const tokens = tokenize(normalizedText);
  const tokenSet = new Set(tokens.filter((token) => isMeaningfulToken(token)));
  const specificTokens = tokens.filter((token) => isSpecificCatalogToken(token, catalog.tokenCounts));
  const queryVariantTokens = new Set(tokens.filter((token) => isVariantToken(token)));
  const queryNumberTokens = new Set(extractNumberTokens(normalizedText));

  if (tokenSet.size === 0 && specificTokens.length === 0 && !hasPotentialSku(normalizedText)) {
    return null;
  }

  const matches = [];
  for (const product of catalog.products) {
    const match = scoreProductMatch({
      product,
      normalizedText,
      compactText,
      tokenSet,
      specificTokens,
      queryVariantTokens,
      queryNumberTokens,
    });

    if (match) {
      matches.push(match);
    }
  }

  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) => b.score - a.score);

  const minScore = Number(options.minScore || 7);
  if (matches[0].score < minScore) {
    return null;
  }

  const top = matches[0];
  const second = matches[1];
  const gap = second ? top.score - second.score : top.score;
  const confidence = classifyConfidence(top.score, gap, top.specificHits);

  const requiredConfidence = options.minConfidence || "low";
  if ((confidenceRank[confidence] || 1) < (confidenceRank[requiredConfidence] || 1)) {
    return null;
  }

  return {
    product: toPublicProduct(top.product),
    confidence,
    score: Number(top.score.toFixed(3)),
    alternatives: matches.slice(1, 4).map((item) => ({
      product: toPublicProduct(item.product),
      score: Number(item.score.toFixed(3)),
    })),
  };
}

function buildProductSearchContext(productLike) {
  if (!productLike) {
    return null;
  }

  const catalog = loadCatalog();
  const canonical = resolveProduct(catalog, productLike);
  if (!canonical) {
    const normalizedName = normalize(productLike.name || productLike.normalizedName || "");
    const tokens = tokenize(normalizedName).filter((token) => isMeaningfulToken(token));
    const numberTokens = extractNumberTokens(normalizedName);
    const modelMarkers = extractModelMarkers(normalizedName);

    return {
      catalogKey: productLike.catalogKey || null,
      sku: productLike.sku || null,
      skuNorm: normalizeSku(productLike.sku || ""),
      name: productLike.name || normalizedName,
      normalizedName,
      tokens,
      rareTokens: tokens.filter((token) => token.length >= 4),
      aliases: tokens.length >= 2 ? [tokens.slice(0, 2).join(" ")] : [],
      numberTokens,
      modelMarkers,
    };
  }

  const numberTokens = extractNumberTokens(canonical.normalizedName);
  const modelMarkers = extractModelMarkers(canonical.normalizedName);

  return {
    catalogKey: canonical.catalogKey,
    sku: canonical.sku,
    skuNorm: canonical.skuNorm,
    name: canonical.name,
    normalizedName: canonical.normalizedName,
    tokens: canonical.matchTokens.slice(0, 12),
    rareTokens: canonical.rareTokens.slice(0, 10),
    aliases: canonical.aliases.slice(0, 12),
    numberTokens,
    modelMarkers,
  };
}

function isSameProduct(left, right) {
  if (!left || !right) {
    return false;
  }

  if (left.catalogKey && right.catalogKey) {
    return left.catalogKey === right.catalogKey;
  }

  const leftSku = normalizeSku(left.sku || "");
  const rightSku = normalizeSku(right.sku || "");
  if (leftSku && rightSku) {
    return leftSku === rightSku;
  }

  const leftName = normalize(left.normalizedName || left.name || "");
  const rightName = normalize(right.normalizedName || right.name || "");
  return Boolean(leftName && rightName && leftName === rightName);
}

function getProductCatalogInfo() {
  const catalog = loadCatalog();
  return {
    filePath: catalog.filePath,
    totalProducts: catalog.products.length,
    loaded: catalog.products.length > 0,
  };
}

function loadCatalog() {
  const filePath = getCatalogPath();

  if (!fs.existsSync(filePath)) {
    if (!cache.warnedMissing) {
      console.warn(`No encontre el catalogo de productos en ${filePath}`);
      cache.warnedMissing = true;
    }

    cache.filePath = filePath;
    cache.mtimeMs = 0;
    cache.products = [];
    cache.tokenCounts = {};
    cache.productByKey = new Map();
    return cache;
  }

  const stat = fs.statSync(filePath);
  if (cache.filePath === filePath && cache.mtimeMs === stat.mtimeMs) {
    return cache;
  }

  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  const rawProducts = [];
  const tokenCounts = Object.create(null);

  for (const row of rows) {
    const name = cleanText(row.Nombre || row.nombre || "");
    if (!name) {
      continue;
    }

    const status = cleanText(row.Estado || row.estado || "").toLowerCase();
    if (status && status !== "activo" && status !== "active") {
      continue;
    }

    const sku = cleanText(row.SKU || row.sku || "");
    const normalizedName = normalize(name);
    if (/^no usar\b|\bprueba\b|^producto demo\b|\bdemo\b/.test(normalizedName)) {
      continue;
    }

    const tokens = tokenize(normalizedName);
    if (tokens.length === 0) {
      continue;
    }

    for (const token of new Set(tokens)) {
      tokenCounts[token] = (tokenCounts[token] || 0) + 1;
    }

    rawProducts.push({
      catalogKey: sku ? `sku:${normalizeSku(sku)}` : `name:${normalizedName}`,
      sku,
      skuNorm: normalizeSku(sku),
      name,
      normalizedName,
      tokens,
    });
  }

  const products = rawProducts.map((product) => {
    const matchTokens = product.tokens.filter((token) => isMeaningfulToken(token));
    const tokenSet = new Set(matchTokens);
    const variantTokens = matchTokens.filter((token) => isVariantToken(token));
    const numberTokens = extractNumberTokens(product.normalizedName);
    const rareTokens = matchTokens.filter((token) =>
      token.includes("0") ||
      token.includes("1") ||
      token.includes("2") ||
      token.includes("3") ||
      token.includes("4") ||
      token.includes("5") ||
      token.includes("6") ||
      token.includes("7") ||
      token.includes("8") ||
      token.includes("9") ||
      ((tokenCounts[token] || 0) > 0 && (tokenCounts[token] || 0) <= 55 && !genericProductTokens.has(token))
    );

    const aliases = buildAliases({ product, tokenCounts });
    const matchSignature = matchTokens.filter((token) => !cosmeticTokens.has(token)).join(" ");

    return {
      ...product,
      matchTokens,
      matchSignature,
      tokenSet,
      variantTokens,
      variantTokenSet: new Set(variantTokens),
      numberTokens,
      numberTokenSet: new Set(numberTokens),
      rareTokens,
      rareTokenSet: new Set(rareTokens),
      aliases,
    };
  });

  const productByKey = new Map();
  for (const product of products) {
    productByKey.set(product.catalogKey, product);
  }

  cache = {
    filePath,
    mtimeMs: stat.mtimeMs,
    warnedMissing: false,
    products,
    tokenCounts,
    productByKey,
  };

  return cache;
}

function scoreProductMatch({
  product,
  normalizedText,
  compactText,
  tokenSet,
  specificTokens,
  queryVariantTokens,
  queryNumberTokens,
}) {
  let score = 0;
  let specificHits = 0;
  let matched = false;

  if (product.skuNorm && product.skuNorm.length >= 3 && compactText.includes(product.skuNorm)) {
    score += 34;
    matched = true;
    specificHits += 1;
  }

  if (normalizedText.includes(product.normalizedName)) {
    score += 24;
    matched = true;
    specificHits += 2;
  }

  let overlap = 0;
  for (const token of tokenSet) {
    if (product.tokenSet.has(token)) {
      overlap += 1;
    }
  }

  if (overlap > 0) {
    score += overlap * 1.7;
    matched = true;
  }

  for (const token of specificTokens) {
    if (product.rareTokenSet.has(token)) {
      score += 4.5;
      specificHits += 1;
      matched = true;
    }
  }

  let aliasHits = 0;
  for (const alias of product.aliases) {
    if (alias.length < 3) {
      continue;
    }
    if (normalizedText.includes(alias)) {
      aliasHits += 1;
      score += alias.length >= 10 ? 7 : 5;
      matched = true;
      if (aliasHits >= 3) {
        break;
      }
    }
  }

  if (!matched) {
    return null;
  }

  const signature = product.matchSignature || product.normalizedName;
  score += diceCoefficient(normalizedText, signature) * 5.2;

  if (specificHits === 0 && aliasHits === 0 && overlap <= 1 && !product.skuNorm) {
    score -= 3;
  }

  score += scoreVariantAlignment(product, queryVariantTokens);
  score += scoreNumberAlignment(product, queryNumberTokens);

  if (queryVariantTokens.size > 0 && product.variantTokens.length === 0) {
    score -= 3;
  }

  if (score <= 0) {
    return null;
  }

  return {
    product,
    score,
    specificHits,
  };
}

function classifyConfidence(score, gap, specificHits) {
  if (score >= 16 && gap >= 3 && specificHits >= 1) {
    return "high";
  }

  if (score >= 10 && (gap >= 1.4 || specificHits >= 1)) {
    return "medium";
  }

  return "low";
}

function scoreVariantAlignment(product, queryVariantTokens) {
  if (!queryVariantTokens || queryVariantTokens.size === 0) {
    return 0;
  }

  let score = 0;

  for (const token of product.variantTokens) {
    if (!highImpactVariantTokens.has(token) && !/^mk\d+$/.test(token)) {
      continue;
    }

    if (queryVariantTokens.has(token)) {
      score += 2.5;
    } else {
      score -= getVariantPenalty(token);
    }
  }

  for (const token of queryVariantTokens) {
    if (!highImpactVariantTokens.has(token) && !/^mk\d+$/.test(token)) {
      continue;
    }

    if (!product.variantTokenSet.has(token)) {
      score -= getVariantPenalty(token) * 0.85;
    }
  }

  return score;
}

function scoreNumberAlignment(product, queryNumberTokens) {
  if (!queryNumberTokens || queryNumberTokens.size === 0) {
    return 0;
  }

  let score = 0;
  let hits = 0;

  for (const token of queryNumberTokens) {
    if (product.numberTokenSet.has(token)) {
      hits += 1;
      score += 2.2;
    } else {
      score -= 2.2;
    }
  }

  if (hits === 0 && product.numberTokens.length > 0) {
    score -= 2;
  }

  return score;
}

function getVariantPenalty(token) {
  if (token === "essential") {
    return 6.5;
  }

  if (token === "pro") {
    return 5.2;
  }

  if (/^mk\d+$/.test(token)) {
    return 5;
  }

  return 3.8;
}

function buildAliases({ product, tokenCounts }) {
  const aliases = new Set();

  if (product.skuNorm) {
    aliases.add(product.skuNorm);
  }

  const cleanedTokens = product.tokens.filter(
    (token) => isMeaningfulToken(token) && !genericProductTokens.has(token)
  );

  if (cleanedTokens.length >= 2) {
    aliases.add(cleanedTokens.slice(0, 2).join(" "));
  }

  if (cleanedTokens.length >= 3) {
    aliases.add(cleanedTokens.slice(0, 3).join(" "));
  }

  for (let i = 0; i < cleanedTokens.length; i += 1) {
    const token = cleanedTokens[i];
    if (!token) {
      continue;
    }

    if (/\d/.test(token) && token.length >= 2) {
      aliases.add(token);
      if (i > 0) {
        aliases.add(`${cleanedTokens[i - 1]} ${token}`);
      }
    }

    if ((tokenCounts[token] || 0) <= 45 && token.length >= 5) {
      aliases.add(token);
    }
  }

  aliases.add(product.normalizedName);

  return [...aliases]
    .map((alias) => alias.trim())
    .filter((alias) => alias.length >= 3)
    .slice(0, 16);
}

function resolveProduct(catalog, productLike) {
  if (!productLike) {
    return null;
  }

  if (productLike.catalogKey && catalog.productByKey.has(productLike.catalogKey)) {
    return catalog.productByKey.get(productLike.catalogKey);
  }

  const skuNorm = normalizeSku(productLike.sku || "");
  if (skuNorm) {
    const bySku = catalog.products.find((item) => item.skuNorm === skuNorm);
    if (bySku) {
      return bySku;
    }
  }

  const normalizedName = normalize(productLike.normalizedName || productLike.name || "");
  if (!normalizedName) {
    return null;
  }

  return catalog.products.find((item) => item.normalizedName === normalizedName) || null;
}

function toPublicProduct(product) {
  return {
    catalogKey: product.catalogKey,
    sku: product.sku || null,
    name: product.name,
    normalizedName: product.normalizedName,
  };
}

function isSpecificCatalogToken(token, tokenCounts) {
  if (!token) {
    return false;
  }

  if (/\d/.test(token)) {
    return true;
  }

  if (conversationNoiseTokens.has(token) || genericProductTokens.has(token)) {
    return false;
  }

  const count = tokenCounts[token] || 0;
  return count > 0 && count <= 120;
}

function isVariantToken(token) {
  if (!token) {
    return false;
  }

  if (highImpactVariantTokens.has(token)) {
    return true;
  }

  if (/^mk\d+$/.test(token)) {
    return true;
  }

  if (/^[a-z]{1,3}\d{2,3}$/.test(token)) {
    return true;
  }

  return false;
}

function isMeaningfulToken(token) {
  if (!token) {
    return false;
  }

  if (/\d/.test(token)) {
    return true;
  }

  if (token.length < 3) {
    return false;
  }

  if (conversationNoiseTokens.has(token) || genericProductTokens.has(token)) {
    return false;
  }

  return true;
}

function hasPotentialSku(text) {
  return /\b[a-z]{2,}[0-9]{2,}\b/.test(text);
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
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length < 2) {
    return [];
  }

  const out = [];
  for (let index = 0; index < compact.length - 1; index += 1) {
    out.push(compact.slice(index, index + 2));
  }
  return out;
}

function getCatalogPath() {
  return resolveProjectPath(process.env.PRODUCT_CATALOG_FILE, defaultCatalogPath);
}

function normalizeSku(value) {
  return normalize(value).replace(/\s+/g, "");
}

function extractModelMarkers(value) {
  const tokens = normalize(value)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const markers = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const left = tokens[index];
    const right = tokens[index + 1];

    if (!left || !right) {
      continue;
    }

    if (left.length < 3 || left === "arturia") {
      continue;
    }

    if (/^\d{1,3}$/.test(right) || /^mk\d+$/.test(right) || /^v\d+$/.test(right)) {
      markers.push(`${left} ${right}`);
    }
  }

  return [...new Set(markers)];
}

function extractNumberTokens(value) {
  const normalizedValue = normalize(value);
  const raw = [
    ...(normalizedValue.match(/\b\d{1,3}\b/g) || []),
    ...(normalizedValue.match(/\bmk\d+\b/g) || []),
    ...(normalizedValue.match(/\bv\d+\b/g) || []),
  ];

  return [...new Set(raw)];
}

function tokenize(value) {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFamilyKey(normalizedName) {
  return tokenize(normalizedName)
    .filter((token) => !genericProductTokens.has(token))
    .filter((token) => !cosmeticTokens.has(token))
    .join(" ");
}

function extractCosmeticVariant(normalizedName) {
  const tokens = tokenize(normalizedName).filter((token) => cosmeticTokens.has(token));
  if (tokens.length === 0) {
    return null;
  }

  return tokens.join(" ");
}

module.exports = {
  detectProductMention,
  buildProductSearchContext,
  isSameProduct,
  getProductCatalogInfo,
};
