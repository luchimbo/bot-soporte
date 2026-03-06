const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");

const command = process.argv[2] || "show";

if (!fs.existsSync(envPath)) {
  console.error(`No encontre ${envPath}`);
  process.exit(1);
}

if (command === "show") {
  showCurrentConfig();
  process.exit(0);
}

if (command === "set") {
  setModel();
  process.exit(0);
}

printUsage();
process.exit(1);

function showCurrentConfig() {
  const env = readEnvMap();
  const provider = env.LLM_PROVIDER || "openrouter";
  const model =
    env.LLM_MODEL ||
    (provider === "openrouter"
      ? env.OPENROUTER_MODEL || env.OPENAI_MODEL || "moonshotai/kimi-k2"
      : env.OPENAI_MODEL || "gpt-4o-mini");

  console.log("Configuracion LLM actual:");
  console.log(`- Proveedor: ${provider}`);
  console.log(`- Modelo: ${model}`);
  console.log(`- Fuente del modelo: ${env.LLM_MODEL ? "LLM_MODEL" : "por proveedor"}`);
}

function setModel() {
  const model = process.argv[3];
  if (!model) {
    console.error("Falta el modelo. Ejemplo: npm run model:set -- moonshotai/kimi-k2-thinking");
    process.exit(1);
  }

  const providerArg = process.argv.find((arg) => arg.startsWith("--provider="));
  const provider = providerArg ? providerArg.replace("--provider=", "").trim() : "";

  let content = fs.readFileSync(envPath, "utf8");
  content = upsertEnvLine(content, "LLM_MODEL", model);

  if (provider) {
    content = upsertEnvLine(content, "LLM_PROVIDER", provider);
  }

  fs.writeFileSync(envPath, content, "utf8");

  console.log(`Modelo actualizado a: ${model}`);
  if (provider) {
    console.log(`Proveedor actualizado a: ${provider}`);
  }
  console.log("Reinicia el bot con: npm start");
}

function readEnvMap() {
  const content = fs.readFileSync(envPath, "utf8");
  const lines = content.split(/\r?\n/);
  const env = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      continue;
    }

    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    env[key] = value;
  }

  return env;
}

function upsertEnvLine(content, key, value) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const keyRegex = new RegExp(`^${escapedKey}=.*$`, "m");
  const line = `${key}=${value}`;

  if (keyRegex.test(content)) {
    return content.replace(keyRegex, line);
  }

  const separator = content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${line}\n`;
}

function printUsage() {
  console.log("Uso:");
  console.log("- npm run model:show");
  console.log("- npm run model:set -- moonshotai/kimi-k2-thinking");
  console.log("- npm run model:set -- moonshotai/kimi-k2 --provider=openrouter");
}
