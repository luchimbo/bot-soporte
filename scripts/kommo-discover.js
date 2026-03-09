require("dotenv").config();

const {
  getKommoStatus,
  fetchKommoAccountSnapshot,
} = require("../src/kommo-client");

async function main() {
  const status = getKommoStatus();
  if (!status.enabled) {
    console.error(
      "Kommo no esta listo. Configura KOMMO_SUBDOMAIN + KOMMO_LONG_LIVED_TOKEN (y opcionalmente KOMMO_SYNC_ENABLED=true)."
    );
    process.exitCode = 1;
    return;
  }

  const snapshot = await fetchKommoAccountSnapshot();

  printAccount(snapshot.account);
  printUsers(snapshot.users);
  printPipelines(snapshot.pipelines);
  printCustomFields("LEADS", snapshot.leadFields);
  printCustomFields("CONTACTS", snapshot.contactFields);
  printEnvSuggestions(snapshot);
}

function printAccount(account) {
  console.log("\n=== ACCOUNT ===");
  console.log(`id: ${account?.id || "n/a"}`);
  console.log(`name: ${account?.name || "n/a"}`);
  console.log(`subdomain: ${account?.subdomain || process.env.KOMMO_SUBDOMAIN || "n/a"}`);
}

function printUsers(users) {
  console.log("\n=== USERS ===");
  if (!Array.isArray(users) || users.length === 0) {
    console.log("No se encontraron usuarios");
    return;
  }

  for (const user of users) {
    const state = user?.rights?.is_active === false ? "inactive" : "active";
    console.log(`- ${user?.id} | ${user?.name || "sin nombre"} | ${state}`);
  }
}

function printPipelines(pipelines) {
  console.log("\n=== PIPELINES ===");
  if (!Array.isArray(pipelines) || pipelines.length === 0) {
    console.log("No se encontraron pipelines");
    return;
  }

  for (const pipeline of pipelines) {
    console.log(`\n- Pipeline ${pipeline?.id}: ${pipeline?.name || "sin nombre"}`);
    const statuses = Array.isArray(pipeline?._embedded?.statuses)
      ? pipeline._embedded.statuses
      : [];
    for (const status of statuses) {
      console.log(`  - Stage ${status?.id}: ${status?.name || "sin nombre"}`);
    }
  }
}

function printCustomFields(scopeLabel, fields) {
  console.log(`\n=== ${scopeLabel} CUSTOM FIELDS ===`);
  if (!Array.isArray(fields) || fields.length === 0) {
    console.log("No se encontraron custom fields");
    return;
  }

  for (const field of fields) {
    const parts = [
      `- ${field?.id}`,
      field?.name || "sin nombre",
      field?.code ? `code=${field.code}` : null,
    ].filter(Boolean);
    console.log(parts.join(" | "));
  }
}

function printEnvSuggestions(snapshot) {
  const users = Array.isArray(snapshot.users) ? snapshot.users : [];
  const pipelines = Array.isArray(snapshot.pipelines) ? snapshot.pipelines : [];

  const suggestedOwner = users.find((user) => user?.rights?.is_active !== false) || users[0] || null;
  const supportPipeline =
    pipelines.find((pipeline) => /soporte/i.test(String(pipeline?.name || ""))) || pipelines[0] || null;
  const statuses = Array.isArray(supportPipeline?._embedded?.statuses)
    ? supportPipeline._embedded.statuses
    : [];

  const diagnosisStage =
    statuses.find((status) => /revisi|revision/i.test(String(status?.name || ""))) ||
    statuses.find((status) => /lead/i.test(String(status?.name || ""))) ||
    statuses[0] ||
    null;

  const escalationStage =
    statuses.find((status) => /soporte|trabajando/i.test(String(status?.name || ""))) ||
    statuses.find((status) => /espera/i.test(String(status?.name || ""))) ||
    statuses[1] ||
    diagnosisStage ||
    null;

  console.log("\n=== ENV SUGERIDO ===");
  console.log(`KOMMO_PIPELINE_ID=${supportPipeline?.id || ""}`);
  console.log(`KOMMO_STAGE_DIAGNOSIS_ID=${diagnosisStage?.id || ""}`);
  console.log(`KOMMO_STAGE_ESCALATION_ID=${escalationStage?.id || ""}`);
  console.log(`KOMMO_OWNER_ID=${suggestedOwner?.id || ""}`);
  console.log("KOMMO_FIELD_CHANNEL_ID=");
  console.log("KOMMO_FIELD_ORDER_TN_ID=");
  console.log("KOMMO_FIELD_USER_ML_ID=");
  console.log("KOMMO_FIELD_PRODUCT_ID=");
  console.log("KOMMO_FIELD_CATEGORY_ID=");
  console.log("KOMMO_FIELD_SUMMARY_ID=");
  console.log("KOMMO_FIELD_URGENCY_ID=");
  console.log("KOMMO_FIELD_ATTEMPTS_ID=");
}

main().catch((error) => {
  const status = error?.response?.status;
  const data = error?.response?.data;
  if (status) {
    console.error(`Error Kommo (${status}):`, JSON.stringify(data || {}, null, 2));
  } else {
    console.error("Error Kommo:", error.message);
  }
  process.exitCode = 1;
});
