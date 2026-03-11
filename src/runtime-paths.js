const fs = require("fs");
const path = require("path");

function resolveProjectPath(configuredPath, fallbackPath) {
  const targetPath = String(configuredPath || fallbackPath || "").trim();
  if (!targetPath) {
    return null;
  }

  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  const normalizedTarget = targetPath.replace(/^[./\\]+/, "");
  const rootCandidates = getRootCandidates();

  for (const root of rootCandidates) {
    const candidate = path.resolve(root, normalizedTarget);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const preferredRoot = rootCandidates[0] || process.cwd();
  return path.resolve(preferredRoot, normalizedTarget);
}

function getRootCandidates() {
  const rawCandidates = [
    process.env.APP_BASE_DIR,
    process.env.LAMBDA_TASK_ROOT,
    process.cwd(),
    path.resolve(__dirname, ".."),
    path.resolve(__dirname, "..", ".."),
    path.resolve(__dirname, "..", "..", ".."),
  ];

  const seen = new Set();
  const uniqueCandidates = [];
  for (const candidate of rawCandidates) {
    const resolved = String(candidate || "").trim();
    if (!resolved || seen.has(resolved)) {
      continue;
    }

    seen.add(resolved);
    uniqueCandidates.push(resolved);
  }

  return uniqueCandidates;
}

module.exports = {
  resolveProjectPath,
};
