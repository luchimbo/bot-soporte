const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { parse } = require("csv-parse");
const { detectProductMention } = require("../src/product-catalog");

const rootDir = path.resolve(__dirname, "..");
const archivosDir = path.join(rootDir, "archivos");

const whatsappFile =
  process.env.WHATSAPP_CSV_FILE ||
  path.join(archivosDir, "exported_message_db (1).csv");
const mailFile = process.env.MAIL_CSV_FILE || path.join(archivosDir, "Mail.csv");
const outputFile =
  process.env.KNOWLEDGE_BASE_FILE || path.join(rootDir, "data", "knowledge-base.json");

const maxWhatsAppDocs = Number(process.env.KB_MAX_WHATSAPP_DOCS || 4500);
const maxEmailDocs = Number(process.env.KB_MAX_EMAIL_DOCS || 1000);
const maxStyleExamples = Number(process.env.KB_MAX_STYLE_EXAMPLES || 2500);
const pairWindowMs = Number(process.env.KB_PAIR_WINDOW_HOURS || 72) * 60 * 60 * 1000;
const resolutionWindowMs = Number(process.env.KB_RESOLUTION_WINDOW_HOURS || 96) * 60 * 60 * 1000;
const minStyleQualityScore = Number(process.env.KB_MIN_STYLE_QUALITY || 3);
const requireResolvedStyle = String(process.env.KB_STYLE_REQUIRE_RESOLVED || "true")
  .trim()
  .toLowerCase() === "true";
const enableManualDocs = String(process.env.KB_ENABLE_MANUALS || "true")
  .trim()
  .toLowerCase() === "true";
const manualsBaseDir = process.env.KB_MANUALS_DIR
  ? path.resolve(rootDir, process.env.KB_MANUALS_DIR)
  : path.join(archivosDir, "Manuales");
const manualBrands = parseCsvList(process.env.KB_MANUAL_BRANDS || "Arturia");
const maxManualDocs = Number(process.env.KB_MAX_MANUAL_DOCS || 6500);
const manualChunkSize = Number(process.env.KB_MANUAL_CHUNK_SIZE || 950);
const manualChunkOverlap = Number(process.env.KB_MANUAL_CHUNK_OVERLAP || 160);
const manualMinChunkLength = Number(process.env.KB_MANUAL_MIN_CHUNK_LEN || 180);
const manualMaxFilesPerBrand = Number(process.env.KB_MANUAL_MAX_FILES_PER_BRAND || 80);
const manualParseTimeoutMs = Number(process.env.KB_MANUAL_PARSE_TIMEOUT_MS || 120000);
const manualTextMaxBufferBytes = Number(process.env.KB_MANUAL_MAX_BUFFER_BYTES || 55 * 1024 * 1024);

const spamPatterns = [
  /calvary greetings/i,
  /offshore bank/i,
  /us\$60m/i,
  /giveaway/i,
  /confidentiality notice/i,
  /unsubscribe/i,
];

const supportPatterns = [
  /no (anda|funciona|prende|enciende|conecta)/i,
  /falla|error|defecto|rota|roto|reclamo|garanti|servicio tecnico/i,
  /devol|devolver|reembolso|reintegro|cambio/i,
  /como (hago|configur|instal|uso)/i,
  /mercado libre|\bml\b/i,
];

const agentNoisePatterns = [
  /arrancamos con las promociones/i,
  /dia del padre/i,
  /instrumentos ideales para regalar/i,
  /suscribite|newsletter/i,
  /boicoteando/i,
  /oferta|promo|promocion/i,
];

const weakReplyPatterns = [
  /^si[!.]?$/i,
  /^ok[!.]?$/i,
  /^dale[!.]?$/i,
  /^hola[!.]?$/i,
  /^buenas( tardes| dias)?[,]? si[!.]?$/i,
  /gracias por comunicarte.+en breve estaremos respondiendo/i,
  /nuestros horarios de atencion/i,
  /hoy estara saliendo el envio/i,
];

const resolvedFollowupPatterns = [
  /gracias/i,
  /perfecto|buenisimo|genial|excelente/i,
  /listo|ok(ey)?|dale/i,
  /ya (pude|funciona|quedo|esta)/i,
  /solucionado|resuelto/i,
];

const unresolvedFollowupPatterns = [
  /no (funciona|anda|sirve|pude)/i,
  /sigue (igual|sin funcionar|fallando)/i,
  /todavia no|aun no/i,
  /continua (igual|fallando)/i,
  /no se resolvio|no me sirve/i,
];

const manualLowSignalLinePatterns = [
  /^arturia\s*-\s*user manual/i,
  /^table of contents$/i,
  /^software license agreement$/i,
  /^declaration of conformity$/i,
  /^special thanks$/i,
  /^quality assurance$/i,
  /^beta testing$/i,
  /^manual$/i,
  /^www\.arturia\.com$/i,
  /^all rights reserved\.?$/i,
  /^\d+$/,
];

const manualTroubleshootingPatterns = [
  /no (funciona|anda|enciende|conecta)|falla|error|ruido|latencia|distorsion/i,
  /troubleshoot|latency|dropouts|clicks|pops|no sound|not detected|setup|install/i,
  /driver|firmware|midi|usb|audio interface|input|output|gain|phantom|loopback/i,
];

const manualHowToPatterns = [
  /como|configur|instal|paso|setup|how to|configure|recording|record|connect/i,
  /ableton|fl studio|analog lab|daw|preferences|audio settings|midi settings/i,
  /front panel|rear panel|specifications|controls/i,
];

let pdftotextAvailable = null;

async function main() {
  assertExists(whatsappFile, "No encontre el CSV de WhatsApp");
  assertExists(mailFile, "No encontre el CSV de Mail");

  const dedupe = new Set();
  const styleDedupe = new Set();
  const docs = [];
  const responseExamples = [];
  const pendingByChat = new Map();
  const styleAwaitingByChat = new Map();
  const stats = {
    whatsappAccepted: 0,
    emailAccepted: 0,
    manualAccepted: 0,
    manualDuplicates: 0,
    manualFilesProcessed: 0,
    manualFilesFailed: 0,
    manualBrandsProcessed: [],
    styleAccepted: 0,
    duplicates: 0,
    styleDuplicates: 0,
    styleRejectedLowQuality: 0,
    styleRejectedUnresolved: 0,
    styleRejectedNoResolution: 0,
    styleResolvedAccepted: 0,
    styleUnknownAccepted: 0,
  };

  await parseWhatsAppRows((row) => {
    collectResponseStyleExample({
      row,
      responseExamples,
      pendingByChat,
      styleAwaitingByChat,
      styleDedupe,
      stats,
    });

    if (docs.length >= maxWhatsAppDocs + maxEmailDocs) {
      return;
    }

    if (stats.whatsappAccepted >= maxWhatsAppDocs) {
      return;
    }

    const doc = mapWhatsAppRow(row);
    if (!doc) {
      return;
    }

    const key = fingerprint(doc.text);
    if (dedupe.has(key)) {
      stats.duplicates += 1;
      return;
    }

    dedupe.add(key);
    docs.push(doc);
    stats.whatsappAccepted += 1;
  });

  await parseMailRows((row, index) => {
    if (stats.emailAccepted >= maxEmailDocs) {
      return;
    }

    const doc = mapMailRow(row, index);
    if (!doc) {
      return;
    }

    const key = fingerprint(doc.text);
    if (dedupe.has(key)) {
      stats.duplicates += 1;
      return;
    }

    dedupe.add(key);
    docs.push(doc);
    stats.emailAccepted += 1;
  });

  collectManualDocs({
    docs,
    dedupe,
    stats,
  });

  flushExpiredStyleCandidates({
    styleAwaitingByChat,
    responseExamples,
    styleDedupe,
    stats,
    currentTimestamp: null,
    force: true,
  });

  docs.sort((a, b) => {
    if (a.createdAt && b.createdAt) {
      return b.createdAt.localeCompare(a.createdAt);
    }
    if (a.createdAt) {
      return -1;
    }
    if (b.createdAt) {
      return 1;
    }
    return a.id.localeCompare(b.id);
  });

  responseExamples.sort((a, b) => {
    if (a.createdAt && b.createdAt) {
      return b.createdAt.localeCompare(a.createdAt);
    }
    if (a.createdAt) {
      return -1;
    }
    if (b.createdAt) {
      return 1;
    }
    return a.id.localeCompare(b.id);
  });

  const categoryCount = countByCategory(docs);
  const styleCategoryCount = countByCategory(responseExamples);
  const payload = {
    generatedAt: new Date().toISOString(),
    sourceFiles: {
      whatsappFile,
      mailFile,
      manualsBaseDir,
      manualBrands,
      manualBrandsProcessed: stats.manualBrandsProcessed,
    },
    totals: {
      documents: docs.length,
      whatsapp: stats.whatsappAccepted,
      email: stats.emailAccepted,
      manuals: stats.manualAccepted,
      manualDuplicatesSkipped: stats.manualDuplicates,
      manualFilesProcessed: stats.manualFilesProcessed,
      manualFilesFailed: stats.manualFilesFailed,
      duplicatesSkipped: stats.duplicates,
      responseExamples: stats.styleAccepted,
      responseExampleDuplicatesSkipped: stats.styleDuplicates,
      responseExampleRejectedLowQuality: stats.styleRejectedLowQuality,
      responseExampleRejectedUnresolved: stats.styleRejectedUnresolved,
      responseExampleRejectedNoResolution: stats.styleRejectedNoResolution,
      responseExampleResolvedAccepted: stats.styleResolvedAccepted,
      responseExampleUnknownAccepted: stats.styleUnknownAccepted,
    },
    byCategory: categoryCount,
    styleByCategory: styleCategoryCount,
    documents: docs,
    responseExamples,
  };

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2), "utf8");

  console.log(`Base generada: ${outputFile}`);
  console.log(`Total documentos: ${docs.length}`);
  console.log(`WhatsApp: ${stats.whatsappAccepted}`);
  console.log(`Mail: ${stats.emailAccepted}`);
  console.log(
    `Manuales: ${stats.manualAccepted} (archivos procesados=${stats.manualFilesProcessed}, fallidos=${stats.manualFilesFailed}, duplicados=${stats.manualDuplicates})`
  );
  console.log(`Ejemplos historicos de respuesta: ${stats.styleAccepted}`);
  console.log(
    `Estilo rechazado (calidad:${stats.styleRejectedLowQuality}, unresolved:${stats.styleRejectedUnresolved}, sin-resolucion:${stats.styleRejectedNoResolution})`
  );
  console.log("Categorias:", categoryCount);
  console.log("Categorias de estilo:", styleCategoryCount);
}

function mapWhatsAppRow(row) {
  if (row.from_me !== "0") {
    return null;
  }

  if (row.message_type !== "0") {
    return null;
  }

  const text = cleanText(row.text_data);
  if (!text || text.length < 8) {
    return null;
  }

  if (!isSupportText(text)) {
    return null;
  }

  const category = detectCategory(text);
  const createdAt = parseEpochMillis(row.timestamp);

  return {
    id: `wa-${row._id || row.sort_id || row.key_id || Date.now()}`,
    source: "whatsapp",
    category,
    createdAt,
    text: limitText(text, 1400),
    metadata: {
      chatId: row.chat_row_id,
      messageId: row.key_id,
    },
  };
}

function mapMailRow(row, index) {
  const subject = cleanText(row[0]);
  const from = cleanText(row[1]);
  const to = cleanText(row[2]);
  const dateRaw = cleanText(row[3]);
  const body = cleanText(row[6]);

  const mergedText = [subject, body].filter(Boolean).join("\n\n");
  if (!mergedText || mergedText.length < 12) {
    return null;
  }

  if (!isSupportText(mergedText)) {
    return null;
  }

  if (isLikelySpam(mergedText)) {
    return null;
  }

  const category = detectCategory(mergedText);
  const createdAt = parseDateLoose(dateRaw);

  return {
    id: `mail-${index + 1}`,
    source: "email",
    category,
    createdAt,
    text: limitText(mergedText, 1800),
    metadata: {
      subject,
      from,
      to,
      dateRaw,
    },
  };
}

function collectManualDocs({ docs, dedupe, stats }) {
  if (!enableManualDocs || maxManualDocs <= 0) {
    return;
  }

  if (!isPdfToTextAvailable()) {
    console.warn("No encontre 'pdftotext'. Omitiendo manuales PDF en esta corrida.");
    return;
  }

  if (!fs.existsSync(manualsBaseDir)) {
    console.warn(`No encontre carpeta de manuales: ${manualsBaseDir}`);
    return;
  }

  const selectedBrands = manualBrands.length > 0 ? manualBrands : ["Arturia"];
  const safeOverlap = clamp(manualChunkOverlap, 0, Math.floor(manualChunkSize * 0.65));

  for (const brand of selectedBrands) {
    const brandDir = path.join(manualsBaseDir, brand);
    if (!fs.existsSync(brandDir) || !fs.statSync(brandDir).isDirectory()) {
      continue;
    }

    stats.manualBrandsProcessed.push(brand);
    const files = fs
      .readdirSync(brandDir)
      .filter((fileName) => fileName.toLowerCase().endsWith(".pdf"))
      .sort((a, b) => a.localeCompare(b));

    const selectedFiles = manualMaxFilesPerBrand > 0 ? files.slice(0, manualMaxFilesPerBrand) : files;

    for (const fileName of selectedFiles) {
      if (stats.manualAccepted >= maxManualDocs) {
        return;
      }

      const filePath = path.join(brandDir, fileName);
      let parsedPages;
      try {
        parsedPages = extractPdfPages(filePath);
      } catch (error) {
        stats.manualFilesFailed += 1;
        console.warn(`No pude leer manual ${fileName}: ${error.message}`);
        continue;
      }

      if (!parsedPages || parsedPages.length === 0) {
        stats.manualFilesFailed += 1;
        continue;
      }

      stats.manualFilesProcessed += 1;

      const manualModelLabel = buildManualModelLabel(fileName);
      const manualLanguage = detectManualLanguage(fileName);
      const catalogProduct = detectManualCatalogProduct({
        brand,
        manualModelLabel,
      });
      const fileStat = fs.statSync(filePath);
      const createdAt = Number.isFinite(fileStat.mtimeMs)
        ? new Date(fileStat.mtimeMs).toISOString()
        : null;

      for (const page of parsedPages) {
        if (stats.manualAccepted >= maxManualDocs) {
          return;
        }

        const cleanedPageText = cleanManualPageText(page.text);
        if (!cleanedPageText) {
          continue;
        }

        const chunks = splitManualChunks(cleanedPageText, {
          chunkSize: manualChunkSize,
          overlap: safeOverlap,
          minLength: manualMinChunkLength,
        });

        for (let index = 0; index < chunks.length; index += 1) {
          if (stats.manualAccepted >= maxManualDocs) {
            return;
          }

          const chunk = chunks[index];
          const contextHeader = buildManualContextHeader({
            brand,
            manualModelLabel,
            fileName,
            language: manualLanguage,
            pageNumber: page.number,
            catalogProduct,
          });

          const text = `${contextHeader}\n${chunk}`;
          const key = fingerprint(text);
          if (dedupe.has(key)) {
            stats.manualDuplicates += 1;
            continue;
          }

          dedupe.add(key);
          docs.push({
            id: `manual-${normalize(brand).replace(/\s+/g, "-")}-${fingerprint(`${fileName}-${page.number}-${index}`)}`,
            source: `manual_${normalize(brand).replace(/\s+/g, "_")}`,
            category: detectManualCategory(chunk),
            createdAt,
            text: limitText(text, 1800),
            metadata: {
              brand,
              fileName,
              filePath,
              language: manualLanguage,
              page: page.number,
              chunkIndex: index,
              manualModelLabel,
              catalogProductKey: catalogProduct?.catalogKey || null,
              catalogProductName: catalogProduct?.name || null,
            },
          });

          stats.manualAccepted += 1;
        }
      }
    }
  }
}

function isPdfToTextAvailable() {
  if (pdftotextAvailable !== null) {
    return pdftotextAvailable;
  }

  const probe = spawnSync("pdftotext", ["-v"], {
    encoding: "utf8",
    timeout: 10000,
  });

  pdftotextAvailable = !probe.error;
  return pdftotextAvailable;
}

function extractPdfPages(filePath) {
  const parseResult = spawnSync("pdftotext", ["-enc", "UTF-8", "-layout", filePath, "-"], {
    encoding: "utf8",
    timeout: manualParseTimeoutMs,
    maxBuffer: manualTextMaxBufferBytes,
  });

  if (parseResult.error) {
    throw parseResult.error;
  }

  if (parseResult.status !== 0) {
    const errorOutput = cleanText(parseResult.stderr || "") || `codigo=${parseResult.status}`;
    throw new Error(errorOutput);
  }

  const rawText = String(parseResult.stdout || "");
  if (!rawText.trim()) {
    return [];
  }

  return rawText.split("\f").map((text, index) => ({
    number: index + 1,
    text,
  }));
}

function cleanManualPageText(value) {
  if (!value) {
    return "";
  }

  const lines = String(value)
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !manualLowSignalLinePatterns.some((pattern) => pattern.test(line)));

  if (lines.length === 0) {
    return "";
  }

  const filteredLines = lines.filter((line) => !/^\d+\s*\/\s*\d+$/.test(line));
  const joined = filteredLines.join("\n");
  const cleaned = cleanText(joined);
  if (!cleaned || cleaned.length < manualMinChunkLength) {
    return "";
  }

  if (isMostlyCreditsOrNames(filteredLines)) {
    return "";
  }

  return cleaned;
}

function isMostlyCreditsOrNames(lines) {
  if (!Array.isArray(lines) || lines.length < 8) {
    return false;
  }

  const nameLikeCount = lines.filter((line) => /^[A-Z][A-Za-z'`.-]+(?:\s+[A-Z][A-Za-z'`.-]+){1,3}$/.test(line)).length;
  if (nameLikeCount / lines.length >= 0.55) {
    return true;
  }

  const combined = lines.join(" ").toLowerCase();
  if (
    /special thanks|all rights reserved|software license agreement|declaration of conformity/.test(
      combined
    )
  ) {
    return true;
  }

  return false;
}

function splitManualChunks(text, options = {}) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const chunkSize = Math.max(Number(options.chunkSize || manualChunkSize), 200);
  const overlap = clamp(Number(options.overlap || manualChunkOverlap), 0, Math.floor(chunkSize * 0.65));
  const minLength = Math.max(Number(options.minLength || manualMinChunkLength), 80);

  if (normalized.length <= chunkSize) {
    return normalized.length >= minLength ? [normalized] : [];
  }

  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    if (end < normalized.length) {
      const splitCandidate = Math.max(
        normalized.lastIndexOf(". ", end),
        normalized.lastIndexOf("; ", end),
        normalized.lastIndexOf(": ", end),
        normalized.lastIndexOf(", ", end)
      );

      if (splitCandidate > start + Math.floor(chunkSize * 0.55)) {
        end = splitCandidate + 1;
      }
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk.length >= minLength) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function detectManualCategory(text) {
  const value = normalize(text);
  if (manualTroubleshootingPatterns.some((pattern) => pattern.test(value))) {
    return "falla_producto";
  }

  if (manualHowToPatterns.some((pattern) => pattern.test(value))) {
    return "como_hacer";
  }

  return "consulta_general";
}

function buildManualContextHeader({
  brand,
  manualModelLabel,
  fileName,
  language,
  pageNumber,
  catalogProduct,
}) {
  const parts = [
    `Manual ${brand}`,
    `Modelo: ${manualModelLabel || "desconocido"}`,
    `Archivo: ${fileName}`,
    `Pagina: ${pageNumber}`,
    `Idioma: ${language}`,
  ];

  if (catalogProduct?.name) {
    parts.push(`Producto catalogo: ${catalogProduct.name}`);
  }

  return parts.join(" | ");
}

function buildManualModelLabel(fileName) {
  const raw = String(fileName || "")
    .replace(/\.pdf$/i, "")
    .replace(/_Manual.*$/i, "")
    .replace(/Owners?_manual.*$/i, "")
    .replace(/Users?_Manual.*$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return raw || "manual";
}

function detectManualLanguage(fileName) {
  if (/_ES\.pdf$/i.test(fileName)) {
    return "es";
  }

  if (/_EN\.pdf$/i.test(fileName)) {
    return "en";
  }

  if (/_CN\.pdf$/i.test(fileName)) {
    return "cn";
  }

  return "unknown";
}

function detectManualCatalogProduct({ brand, manualModelLabel }) {
  const mention = detectProductMention(`${brand} ${manualModelLabel}`, {
    minScore: Math.max(Number(process.env.PRODUCT_MATCH_MIN_SCORE || 7), 8),
  });

  if (!mention || !mention.product) {
    return null;
  }

  if (!isManualCatalogMatchPlausible(manualModelLabel, mention.product)) {
    return null;
  }

  return mention.product;
}

function isManualCatalogMatchPlausible(manualModelLabel, catalogProduct) {
  const manualTokens = tokenizeManualLabel(manualModelLabel);
  const productTokens = tokenizeManualLabel(catalogProduct?.name || catalogProduct?.normalizedName || "");

  const stopWords = new Set([
    "arturia",
    "manual",
    "owner",
    "owners",
    "user",
    "users",
    "guide",
    "en",
    "es",
    "cn",
  ]);

  const manualStrong = new Set(
    manualTokens.filter((token) => token.length >= 4 && !stopWords.has(token) && !/^mk\d+$/.test(token))
  );
  const productStrong = new Set(
    productTokens.filter((token) => token.length >= 4 && !stopWords.has(token) && !/^mk\d+$/.test(token))
  );

  let strongOverlap = 0;
  for (const token of manualStrong) {
    if (productStrong.has(token)) {
      strongOverlap += 1;
    }
  }

  if (manualStrong.size > 0 && strongOverlap === 0) {
    return false;
  }

  const manualNumbers = new Set(manualTokens.filter((token) => /\d/.test(token)));
  const productNumbers = new Set(productTokens.filter((token) => /\d/.test(token)));

  if (manualNumbers.size > 0 && productNumbers.size > 0) {
    let numberOverlap = 0;
    for (const token of manualNumbers) {
      if (productNumbers.has(token)) {
        numberOverlap += 1;
      }
    }

    if (numberOverlap === 0) {
      return false;
    }
  }

  return true;
}

function tokenizeManualLabel(value) {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function collectResponseStyleExample({
  row,
  responseExamples,
  pendingByChat,
  styleAwaitingByChat,
  styleDedupe,
  stats,
}) {
  if (row.message_type !== "0") {
    return;
  }

  const text = cleanText(row.text_data);
  if (!text || text.length < 8) {
    return;
  }

  const chatId = row.chat_row_id || "unknown";
  const timestamp = parseEpochMillisNumber(row.timestamp);

  flushExpiredStyleCandidates({
    styleAwaitingByChat,
    responseExamples,
    styleDedupe,
    stats,
    currentTimestamp: timestamp,
    force: false,
  });

  if (row.from_me === "0") {
    resolveAwaitingStyleCandidateWithFollowup({
      chatId,
      followupText: text,
      styleAwaitingByChat,
      responseExamples,
      styleDedupe,
      stats,
    });

    if (!isSupportText(text)) {
      return;
    }

    const pending = pendingByChat.get(chatId) || [];
    pending.push({
      text: limitText(text, 700),
      category: detectCategory(text),
      timestamp,
      messageId: row.key_id,
    });

    if (pending.length > 5) {
      pending.shift();
    }

    pendingByChat.set(chatId, pending);
    return;
  }

  if (row.from_me !== "1") {
    return;
  }

  if (!isUsefulAgentReply(text)) {
    return;
  }

  const pending = pendingByChat.get(chatId);
  if (!pending || pending.length === 0) {
    return;
  }

  const question = pending.shift();
  if (pending.length === 0) {
    pendingByChat.delete(chatId);
  } else {
    pendingByChat.set(chatId, pending);
  }

  if (question?.timestamp && timestamp) {
    const delta = Math.abs(timestamp - question.timestamp);
    if (delta > pairWindowMs) {
      return;
    }
  }

  const category = question.category || detectCategory(question.text);
  const agentReply = limitText(text, 900);
  const baseQualityScore = scoreStyleCandidate({
    userText: question.text,
    agentReply,
    category,
  });

  if (baseQualityScore < minStyleQualityScore) {
    stats.styleRejectedLowQuality += 1;
    return;
  }

  const styleCandidate = {
    example: {
      id: `style-${row._id || row.sort_id || row.key_id || Date.now()}`,
      source: "whatsapp",
      category,
      createdAt: parseEpochMillis(row.timestamp),
      userText: question.text,
      agentReply,
      metadata: {
        chatId,
        userMessageId: question.messageId,
        agentMessageId: row.key_id,
      },
    },
    baseQualityScore,
    awaitUntil: timestamp ? timestamp + resolutionWindowMs : null,
  };

  const queue = styleAwaitingByChat.get(chatId) || [];
  queue.push(styleCandidate);

  if (queue.length > 4) {
    const overflow = queue.shift();
    finalizeStyleCandidate({
      styleCandidate: overflow,
      resolutionSignal: "unknown",
      responseExamples,
      styleDedupe,
      stats,
    });
  }

  styleAwaitingByChat.set(chatId, queue);
}

function isUsefulAgentReply(text) {
  const value = normalize(text);

  if (value.length < 10) {
    return false;
  }

  if (/^https?:\/\//.test(value)) {
    return false;
  }

  if (agentNoisePatterns.some((pattern) => pattern.test(value))) {
    return false;
  }

  if (weakReplyPatterns.some((pattern) => pattern.test(value))) {
    return false;
  }

  return true;
}

function scoreStyleCandidate({ userText, agentReply, category }) {
  const user = normalize(userText);
  const reply = normalize(agentReply);
  let score = 0;

  if (reply.length >= 30) {
    score += 1;
  }
  if (reply.length >= 80) {
    score += 1;
  }
  if (reply.length >= 160) {
    score += 1;
  }
  if (reply.length < 30) {
    score -= 2;
  }

  if (/\b(1[\).]|2[\).]|paso|primero|segundo|tercero)\b/i.test(agentReply)) {
    score += 2;
  }

  if (/te pido|confirmame|necesito|pasame|comparti|envia|adjunta|indica|aclara/i.test(reply)) {
    score += 2;
  }

  if (/por favor|gracias/i.test(reply)) {
    score += 1;
  }

  if (/mercado libre|\bml\b|reclamo|garantia|devolucion|reintegro|pedido|numero de compra|factura|dni|direccion/i.test(reply)) {
    score += 1;
  }

  if (category === "devolucion" && /devol|reembolso|reintegro|cancel|reclamo/i.test(reply)) {
    score += 2;
  }

  if (category === "falla_producto" && /proba|verifica|revisa|conecta|configura|error|video|test/i.test(reply)) {
    score += 2;
  }

  if (category === "como_hacer" && /paso|configura|instala|usa|ingresa/i.test(reply)) {
    score += 1;
  }

  if (weakReplyPatterns.some((pattern) => pattern.test(reply))) {
    score -= 4;
  }

  if (agentNoisePatterns.some((pattern) => pattern.test(reply))) {
    score -= 5;
  }

  if (user.length < 10) {
    score -= 1;
  }

  return score;
}

function resolveAwaitingStyleCandidateWithFollowup({
  chatId,
  followupText,
  styleAwaitingByChat,
  responseExamples,
  styleDedupe,
  stats,
}) {
  const queue = styleAwaitingByChat.get(chatId);
  if (!queue || queue.length === 0) {
    return;
  }

  const styleCandidate = queue.shift();
  if (queue.length === 0) {
    styleAwaitingByChat.delete(chatId);
  } else {
    styleAwaitingByChat.set(chatId, queue);
  }

  const resolutionSignal = classifyResolutionSignal(followupText);
  finalizeStyleCandidate({
    styleCandidate,
    resolutionSignal,
    responseExamples,
    styleDedupe,
    stats,
  });
}

function flushExpiredStyleCandidates({
  styleAwaitingByChat,
  responseExamples,
  styleDedupe,
  stats,
  currentTimestamp,
  force,
}) {
  for (const [chatId, queue] of styleAwaitingByChat.entries()) {
    const remaining = [];

    for (const styleCandidate of queue) {
      const expired =
        force ||
        (styleCandidate.awaitUntil && currentTimestamp && styleCandidate.awaitUntil <= currentTimestamp);

      if (expired) {
        finalizeStyleCandidate({
          styleCandidate,
          resolutionSignal: "unknown",
          responseExamples,
          styleDedupe,
          stats,
        });
      } else {
        remaining.push(styleCandidate);
      }
    }

    if (remaining.length === 0) {
      styleAwaitingByChat.delete(chatId);
    } else {
      styleAwaitingByChat.set(chatId, remaining);
    }
  }
}

function finalizeStyleCandidate({
  styleCandidate,
  resolutionSignal,
  responseExamples,
  styleDedupe,
  stats,
}) {
  if (!styleCandidate || !styleCandidate.example) {
    return;
  }

  if (stats.styleAccepted >= maxStyleExamples) {
    return;
  }

  if (resolutionSignal === "unresolved") {
    stats.styleRejectedUnresolved += 1;
    return;
  }

  if (requireResolvedStyle && resolutionSignal !== "resolved") {
    stats.styleRejectedNoResolution += 1;
    return;
  }

  const finalQualityScore = styleCandidate.baseQualityScore + resolutionBonus(resolutionSignal);
  if (finalQualityScore < minStyleQualityScore) {
    stats.styleRejectedLowQuality += 1;
    return;
  }

  const example = {
    ...styleCandidate.example,
    metadata: {
      ...styleCandidate.example.metadata,
      baseQualityScore: styleCandidate.baseQualityScore,
      qualityScore: finalQualityScore,
      resolutionSignal,
    },
  };

  const dedupeKey = fingerprint(`${example.userText} || ${example.agentReply}`);
  if (styleDedupe.has(dedupeKey)) {
    stats.styleDuplicates += 1;
    return;
  }

  styleDedupe.add(dedupeKey);
  responseExamples.push(example);
  stats.styleAccepted += 1;

  if (resolutionSignal === "resolved") {
    stats.styleResolvedAccepted += 1;
  } else {
    stats.styleUnknownAccepted += 1;
  }
}

function classifyResolutionSignal(text) {
  const value = normalize(text);
  if (!value) {
    return "unknown";
  }

  if (unresolvedFollowupPatterns.some((pattern) => pattern.test(value))) {
    return "unresolved";
  }

  if (resolvedFollowupPatterns.some((pattern) => pattern.test(value))) {
    return "resolved";
  }

  return "unknown";
}

function resolutionBonus(signal) {
  if (signal === "resolved") {
    return 2;
  }
  if (signal === "unresolved") {
    return -3;
  }
  return 0;
}

function isSupportText(text) {
  const value = normalize(text);

  if (value.length < 8) {
    return false;
  }

  if (/^https?:\/\//.test(value)) {
    return false;
  }

  return supportPatterns.some((pattern) => pattern.test(value));
}

function detectCategory(text) {
  const value = normalize(text);

  if (/devol|devolver|reembolso|reintegro|cambio/.test(value)) {
    return "devolucion";
  }

  if (/falla|error|defecto|no (anda|funciona|prende|enciende|conecta)|rota|roto|garanti|reclamo/.test(value)) {
    return "falla_producto";
  }

  if (/como (hago|configur|instal|uso)|ayuda|consulta/.test(value)) {
    return "como_hacer";
  }

  return "consulta_general";
}

function isLikelySpam(text) {
  return spamPatterns.some((pattern) => pattern.test(text));
}

function limitText(value, max) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

function cleanText(value) {
  if (!value || value === "null") {
    return "";
  }

  return fixEncodingArtifacts(String(value))
    .replace(/\r/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fixEncodingArtifacts(value) {
  if (!/[ÃÂâ]/.test(value)) {
    return value;
  }

  const repaired = Buffer.from(value, "latin1").toString("utf8");
  const originalPenalty = encodingPenalty(value);
  const repairedPenalty = encodingPenalty(repaired);

  if (repairedPenalty <= originalPenalty) {
    return repaired;
  }

  return value;
}

function encodingPenalty(value) {
  const replacement = (value.match(/�/g) || []).length;
  const mojibake = (value.match(/[ÃÂ][a-zA-Z]/g) || []).length;
  return replacement * 3 + mojibake;
}

function normalize(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function parseEpochMillis(value) {
  const ts = parseEpochMillisNumber(value);
  if (!ts) {
    return null;
  }

  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function parseEpochMillisNumber(value) {
  if (!value || value === "null") {
    return null;
  }

  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) {
    return null;
  }

  return ts;
}

function parseDateLoose(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function fingerprint(text) {
  return crypto.createHash("sha1").update(normalize(text)).digest("hex");
}

function countByCategory(docs) {
  const out = {};
  for (const doc of docs) {
    out[doc.category] = (out[doc.category] || 0) + 1;
  }
  return out;
}

function assertExists(filePath, errorMessage) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${errorMessage}: ${filePath}`);
  }
}

async function parseWhatsAppRows(onRow) {
  await parseCsvStream({
    filePath: whatsappFile,
    encoding: "latin1",
    parserOptions: {
      columns: true,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      bom: true,
    },
    onRow,
  });
}

async function parseMailRows(onRow) {
  let rowIndex = 0;
  await parseCsvStream({
    filePath: mailFile,
    encoding: "utf8",
    parserOptions: {
      columns: false,
      skip_empty_lines: true,
      relax_quotes: true,
      relax_column_count: true,
      bom: true,
    },
    onRow: (row) => {
      onRow(row, rowIndex);
      rowIndex += 1;
    },
  });
}

function parseCsvStream({ filePath, encoding, parserOptions, onRow }) {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding });
    const parser = parse(parserOptions);

    parser.on("readable", () => {
      try {
        let record;
        while ((record = parser.read()) !== null) {
          onRow(record);
        }
      } catch (error) {
        reject(error);
      }
    });

    parser.on("error", reject);
    parser.on("end", resolve);

    stream.pipe(parser);
  });
}

main().catch((error) => {
  console.error("No se pudo generar la base:", error.message);
  process.exitCode = 1;
});
