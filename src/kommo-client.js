const axios = require("axios");

const kommoSyncEnabled = String(process.env.KOMMO_SYNC_ENABLED || "true")
  .trim()
  .toLowerCase() === "true";
const kommoSubdomain = String(process.env.KOMMO_SUBDOMAIN || "").trim();
const kommoLongLivedToken = String(process.env.KOMMO_LONG_LIVED_TOKEN || "").trim();
const kommoRequestTimeoutMs = Number(process.env.KOMMO_TIMEOUT_MS || 12000);

const kommoPipelineId = parseNumericId(process.env.KOMMO_PIPELINE_ID);
const kommoStageDiagnosisId = parseNumericId(process.env.KOMMO_STAGE_DIAGNOSIS_ID);
const kommoStageEscalationId = parseNumericId(process.env.KOMMO_STAGE_ESCALATION_ID);
const kommoOwnerId = parseNumericId(process.env.KOMMO_OWNER_ID);
const kommoSalesbotId = parseNumericId(process.env.KOMMO_SALESBOT_ID);
const kommoIncomingWebhookEnabled = String(process.env.KOMMO_INCOMING_WEBHOOK_ENABLED || "false")
  .trim()
  .toLowerCase() === "true";

const leadFieldMap = {
  channel: parseNumericId(process.env.KOMMO_FIELD_CHANNEL_ID),
  orderTn: parseNumericId(process.env.KOMMO_FIELD_ORDER_TN_ID),
  userMl: parseNumericId(process.env.KOMMO_FIELD_USER_ML_ID),
  product: parseNumericId(process.env.KOMMO_FIELD_PRODUCT_ID),
  category: parseNumericId(process.env.KOMMO_FIELD_CATEGORY_ID),
  summary: parseNumericId(process.env.KOMMO_FIELD_SUMMARY_ID),
  urgency: parseNumericId(process.env.KOMMO_FIELD_URGENCY_ID),
  attempts: parseNumericId(process.env.KOMMO_FIELD_ATTEMPTS_ID),
};

let kommoHttpClient = null;

function getKommoStatus() {
  const configured = Boolean(kommoSubdomain && kommoLongLivedToken);
  return {
    enabled: kommoSyncEnabled && configured,
    configured,
    syncEnabledFlag: kommoSyncEnabled,
    subdomainConfigured: Boolean(kommoSubdomain),
    tokenConfigured: Boolean(kommoLongLivedToken),
    pipelineConfigured: Boolean(kommoPipelineId),
    stageDiagnosisConfigured: Boolean(kommoStageDiagnosisId),
    stageEscalationConfigured: Boolean(kommoStageEscalationId),
    ownerConfigured: Boolean(kommoOwnerId),
    salesbotConfigured: Boolean(kommoSalesbotId),
    incomingWebhookEnabled,
  };
}

async function launchKommoSalesbot({ botId, entityId, entityType }) {
  ensureKommoConfigured();

  const resolvedBotId = parseNumericId(botId) || kommoSalesbotId;
  const resolvedEntityId = parseNumericId(entityId);
  const resolvedEntityType = normalizeSalesbotEntityType(entityType);

  if (!resolvedBotId) {
    throw new Error("Falta KOMMO_SALESBOT_ID para lanzar el Salesbot");
  }

  if (!resolvedEntityId || !resolvedEntityType) {
    throw new Error("No pude resolver entity_id/entity_type para lanzar el Salesbot");
  }

  await apiPost(`/api/v4/bots/${resolvedBotId}/run`, {
    entity_id: resolvedEntityId,
    entity_type: resolvedEntityType,
  });

  return {
    ok: true,
    botId: resolvedBotId,
    entityId: resolvedEntityId,
    entityType: resolvedEntityType,
  };
}

async function syncKommoTurn({
  sessionContext,
  phone,
  userText,
  assistantText,
  assistantMode,
  activeProduct,
  intent,
  hits,
  styleHits,
  orderNumber,
  marketplaceUser,
  urgency,
  escalate,
  attempts,
  sourceLabel,
  kommoLeadId,
  kommoContactId,
}) {
  const status = getKommoStatus();
  if (!status.enabled) {
    return {
      skipped: true,
      reason: "kommo-not-configured",
    };
  }

  const phoneDigits = normalizePhoneDigits(phone);
  const preferredContactId = parseNumericId(kommoContactId) || parseNumericId(sessionContext?.kommoContactId);
  const preferredLeadId = parseNumericId(kommoLeadId) || parseNumericId(sessionContext?.kommoLeadId);

  if (!phoneDigits && !preferredContactId && !preferredLeadId) {
    return {
      skipped: true,
      reason: "missing-contact-context",
    };
  }

  let upsertContact = null;
  if (preferredContactId) {
    upsertContact = {
      id: preferredContactId,
      created: false,
    };
  } else if (phoneDigits) {
    const contactName = `Cliente WhatsApp ${phoneDigits}`;
    upsertContact = await findOrCreateContact({
      phone: phoneDigits,
      name: contactName,
      preferredId: sessionContext?.kommoContactId,
    });
  }

  if (!upsertContact?.id && !preferredLeadId) {
    return {
      skipped: true,
      reason: "missing-contact-for-lead",
    };
  }

  const upsertLead = await findOrCreateLead({
    preferredLeadId,
    contactId: upsertContact?.id || null,
    phone: phoneDigits || phone,
    activeProduct,
    intent,
    userText,
    orderNumber,
    marketplaceUser,
    urgency,
    escalate,
    attempts,
    sourceLabel,
  });

  const noteText = buildTurnNote({
    userText,
    assistantText,
    assistantMode,
    activeProduct,
    intent,
    hits,
    styleHits,
    orderNumber,
    marketplaceUser,
    urgency,
    escalate,
    attempts,
    sourceLabel,
  });

  await addLeadNote(upsertLead.id, noteText);

  return {
    ok: true,
    contactId: upsertContact?.id || preferredContactId || null,
    leadId: upsertLead.id,
    contactCreated: Boolean(upsertContact?.created),
    leadCreated: upsertLead.created,
    leadUpdated: upsertLead.updated,
  };
}

async function fetchKommoAccountSnapshot() {
  ensureKommoConfigured();

  const [account, users, pipelines, leadFields, contactFields] = await Promise.all([
    apiGet("/api/v4/account"),
    fetchAllPages("/api/v4/users"),
    fetchAllPages("/api/v4/leads/pipelines"),
    fetchAllPages("/api/v4/leads/custom_fields"),
    fetchAllPages("/api/v4/contacts/custom_fields"),
  ]);

  return {
    account,
    users,
    pipelines,
    leadFields,
    contactFields,
  };
}

async function findOrCreateContact({ phone, name, preferredId }) {
  if (preferredId) {
    try {
      const existing = await apiGet(`/api/v4/contacts/${preferredId}`);
      if (existing?.id) {
        return {
          id: Number(existing.id),
          created: false,
        };
      }
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  const matched = await findContactByPhone(phone);
  if (matched?.id) {
    return {
      id: Number(matched.id),
      created: false,
    };
  }

  const payload = [
    {
      name,
      custom_fields_values: [
        {
          field_code: "PHONE",
          values: [
            {
              value: formatPhoneForKommo(phone),
            },
          ],
        },
      ],
    },
  ];

  const response = await apiPost("/api/v4/contacts", payload);
  const createdContact = response?._embedded?.contacts?.[0];
  if (!createdContact?.id) {
    throw new Error("No pude crear contacto en Kommo");
  }

  return {
    id: Number(createdContact.id),
    created: true,
  };
}

async function findContactByPhone(phone) {
  const variants = buildPhoneCandidates(phone);

  for (const query of variants) {
    const response = await apiGet("/api/v4/contacts", {
      query,
      limit: 50,
    });

    const contacts = response?._embedded?.contacts || [];
    for (const contact of contacts) {
      if (contactMatchesPhone(contact, phone)) {
        return contact;
      }
    }
  }

  return null;
}

async function findOrCreateLead({
  preferredLeadId,
  contactId,
  phone,
  activeProduct,
  intent,
  userText,
  orderNumber,
  marketplaceUser,
  urgency,
  escalate,
  attempts,
  sourceLabel,
}) {
  if (preferredLeadId) {
    try {
      const existingLead = await apiGet(`/api/v4/leads/${preferredLeadId}`);
      if (existingLead?.id) {
        const updatePayload = buildLeadUpdatePayload({
          activeProduct,
          intent,
          userText,
          orderNumber,
          marketplaceUser,
          urgency,
          escalate,
          attempts,
          sourceLabel,
        });

        if (Object.keys(updatePayload).length > 0) {
          await apiPatch(`/api/v4/leads/${preferredLeadId}`, updatePayload);
          return {
            id: Number(existingLead.id),
            created: false,
            updated: true,
          };
        }

        return {
          id: Number(existingLead.id),
          created: false,
          updated: false,
        };
      }
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  const leadName = buildLeadName(activeProduct, phone || "sin_telefono");
  const leadPayload = {
    name: leadName,
  };

  if (contactId) {
    leadPayload._embedded = {
      contacts: [{ id: contactId }],
    };
  }

  if (kommoPipelineId) {
    leadPayload.pipeline_id = kommoPipelineId;
  }

  const stageId = resolveLeadStageId({ escalate });
  if (stageId) {
    leadPayload.status_id = stageId;
  }

  if (kommoOwnerId) {
    leadPayload.responsible_user_id = kommoOwnerId;
  }

  const customFields = buildLeadCustomFields({
    activeProduct,
    intent,
    userText,
    orderNumber,
    marketplaceUser,
    urgency,
    attempts,
    sourceLabel,
  });

  if (customFields.length > 0) {
    leadPayload.custom_fields_values = customFields;
  }

  const response = await apiPost("/api/v4/leads", [leadPayload]);
  const createdLead = response?._embedded?.leads?.[0];
  if (!createdLead?.id) {
    throw new Error("No pude crear lead en Kommo");
  }

  return {
    id: Number(createdLead.id),
    created: true,
    updated: false,
  };
}

function buildLeadUpdatePayload({
  activeProduct,
  intent,
  userText,
  orderNumber,
  marketplaceUser,
  urgency,
  escalate,
  attempts,
  sourceLabel,
}) {
  const payload = {};

  const stageId = resolveLeadStageId({ escalate });
  if (stageId) {
    payload.status_id = stageId;
  }

  const customFields = buildLeadCustomFields({
    activeProduct,
    intent,
    userText,
    orderNumber,
    marketplaceUser,
    urgency,
    attempts,
    sourceLabel,
  });

  if (customFields.length > 0) {
    payload.custom_fields_values = customFields;
  }

  if (Object.keys(payload).length === 0) {
    return {};
  }

  return payload;
}

function buildLeadCustomFields({
  activeProduct,
  intent,
  userText,
  orderNumber,
  marketplaceUser,
  urgency,
  attempts,
  sourceLabel,
}) {
  const fields = [];

  pushCustomFieldValue(fields, leadFieldMap.channel, sourceLabel || "WhatsApp");
  pushCustomFieldValue(fields, leadFieldMap.orderTn, orderNumber);
  pushCustomFieldValue(fields, leadFieldMap.userMl, marketplaceUser);
  pushCustomFieldValue(fields, leadFieldMap.product, activeProduct?.name || null);
  pushCustomFieldValue(fields, leadFieldMap.category, intent || null);
  pushCustomFieldValue(fields, leadFieldMap.summary, limitText(cleanOneLine(userText), 240));
  pushCustomFieldValue(fields, leadFieldMap.urgency, urgency || null);
  pushCustomFieldValue(fields, leadFieldMap.attempts, asOptionalString(attempts));

  return fields;
}

async function addLeadNote(leadId, text) {
  const payload = [
    {
      note_type: "common",
      params: {
        text: limitText(String(text || ""), 3900),
      },
    },
  ];

  await apiPost(`/api/v4/leads/${leadId}/notes`, payload);
}

function buildTurnNote({
  userText,
  assistantText,
  assistantMode,
  activeProduct,
  intent,
  hits,
  styleHits,
  orderNumber,
  marketplaceUser,
  urgency,
  escalate,
  attempts,
  sourceLabel,
}) {
  const lines = [
    `Canal: ${sourceLabel || "WhatsApp"}`,
    `Modo bot: ${assistantMode || "desconocido"}`,
    `Producto detectado: ${activeProduct?.name || "no detectado"}`,
    `Categoria: ${intent || "sin clasificar"}`,
    `Escalado: ${escalate ? "si" : "no"} | Intentos: ${Number(attempts || 0)}`,
    `Hits RAG: ${Number(hits || 0)} | Hits estilo: ${Number(styleHits || 0)}`,
    `Orden TN: ${orderNumber || "n/a"} | Usuario ML: ${marketplaceUser || "n/a"}`,
    `Urgencia: ${urgency || "normal"}`,
    `Cliente: ${limitText(cleanOneLine(userText), 900)}`,
    `Bot: ${limitText(cleanOneLine(assistantText), 1300)}`,
  ];

  return lines.join("\n");
}

function resolveLeadStageId({ escalate }) {
  if (escalate && kommoStageEscalationId) {
    return kommoStageEscalationId;
  }

  if (kommoStageDiagnosisId) {
    return kommoStageDiagnosisId;
  }

  return null;
}

function buildLeadName(activeProduct, phone) {
  const productName = activeProduct?.name ? String(activeProduct.name).trim() : "Sin producto";
  return `Soporte WA - ${productName} - ${phone}`;
}

function contactMatchesPhone(contact, phone) {
  const inputDigits = normalizePhoneDigits(phone);
  if (!inputDigits) {
    return false;
  }

  const contactPhones = extractContactPhones(contact);
  if (contactPhones.length === 0) {
    return false;
  }

  return contactPhones.some((item) => phonesProbablyMatch(inputDigits, item));
}

function extractContactPhones(contact) {
  const fields = Array.isArray(contact?.custom_fields_values)
    ? contact.custom_fields_values
    : [];

  const out = [];
  for (const field of fields) {
    const fieldCode = String(field?.field_code || "").toUpperCase();
    const fieldName = String(field?.field_name || "").toLowerCase();
    const isPhoneField =
      fieldCode === "PHONE" || fieldName.includes("telefono") || fieldName.includes("phone");
    if (!isPhoneField) {
      continue;
    }

    const values = Array.isArray(field?.values) ? field.values : [];
    for (const value of values) {
      const digits = normalizePhoneDigits(value?.value || "");
      if (digits) {
        out.push(digits);
      }
    }
  }

  return out;
}

function phonesProbablyMatch(left, right) {
  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  const minTail = 8;
  if (left.length >= minTail && right.length >= minTail) {
    return left.slice(-minTail) === right.slice(-minTail);
  }

  return false;
}

function buildPhoneCandidates(phone) {
  const digits = normalizePhoneDigits(phone);
  if (!digits) {
    return [];
  }

  const out = new Set([digits, `+${digits}`]);

  if (/^549\d+/.test(digits)) {
    const withoutNine = `54${digits.slice(3)}`;
    out.add(withoutNine);
    out.add(`+${withoutNine}`);
  }

  if (/^54\d+/.test(digits) && !/^549\d+/.test(digits)) {
    const withNine = `549${digits.slice(2)}`;
    out.add(withNine);
    out.add(`+${withNine}`);
  }

  return [...out];
}

function formatPhoneForKommo(phone) {
  const digits = normalizePhoneDigits(phone);
  if (!digits) {
    return String(phone || "").trim();
  }

  return `+${digits}`;
}

function normalizePhoneDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits || "";
}

async function fetchAllPages(path, params = {}) {
  let page = 1;
  const items = [];
  while (true) {
    const response = await apiGet(path, {
      ...params,
      page,
      limit: 250,
    });

    const embedded = response?._embedded || {};
    const firstCollection = Object.values(embedded).find((value) => Array.isArray(value));
    if (!Array.isArray(firstCollection) || firstCollection.length === 0) {
      break;
    }

    items.push(...firstCollection);
    if (firstCollection.length < 250) {
      break;
    }

    page += 1;
  }

  return items;
}

function pushCustomFieldValue(target, fieldId, value) {
  if (!fieldId) {
    return;
  }

  const cleanedValue = String(value || "").trim();
  if (!cleanedValue) {
    return;
  }

  target.push({
    field_id: fieldId,
    values: [{ value: cleanedValue }],
  });
}

function cleanOneLine(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function limitText(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

function asOptionalString(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  const text = String(value).trim();
  return text || null;
}

function ensureKommoConfigured() {
  const status = getKommoStatus();
  if (!status.enabled) {
    throw new Error("Kommo no esta configurado. Revisar KOMMO_SUBDOMAIN y KOMMO_LONG_LIVED_TOKEN.");
  }
}

function getKommoClient() {
  ensureKommoConfigured();

  if (!kommoHttpClient) {
    kommoHttpClient = axios.create({
      baseURL: `https://${kommoSubdomain}.kommo.com`,
      timeout: kommoRequestTimeoutMs,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${kommoLongLivedToken}`,
        "Content-Type": "application/json",
      },
    });
  }

  return kommoHttpClient;
}

async function apiGet(path, params) {
  const client = getKommoClient();
  const response = await client.get(path, { params });
  return response.data;
}

async function apiPost(path, payload) {
  const client = getKommoClient();
  const response = await client.post(path, payload);
  return response.data;
}

async function apiPatch(path, payload) {
  const client = getKommoClient();
  const response = await client.patch(path, payload);
  return response.data;
}

function isNotFoundError(error) {
  return Number(error?.response?.status) === 404;
}

function parseNumericId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeSalesbotEntityType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (["lead", "leads", "2"].includes(normalized)) {
    return "leads";
  }

  if (["contact", "contacts", "1"].includes(normalized)) {
    return "contacts";
  }

  return null;
}

module.exports = {
  getKommoStatus,
  syncKommoTurn,
  launchKommoSalesbot,
  fetchKommoAccountSnapshot,
};
