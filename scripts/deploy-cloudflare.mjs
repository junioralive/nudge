import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const webRoot = path.join(projectRoot, "web");
const wranglerConfig = path.join(projectRoot, "wrangler.jsonc");
const viteDeployConfig = path.join(webRoot, ".wrangler", "deploy", "config.json");
const USER_SECRET_NAMES = [
  "NUDGE_AUTH_KEY",
  "GEMINI_API_KEY",
  "NUDGE_ENCRYPTION_KEY",
  "CREDENTIAL_ENCRYPTION_KEY",
  "NUDGE_ACTION_SIGNING_SECRET",
  "OUTLOOK_CLIENT_ID",
  "OUTLOOK_CLIENT_SECRET",
  "WHATSAPP_BASE_URL",
  "WHATSAPP_USERNAME",
  "WHATSAPP_PASSWORD",
  "WHATSAPP_DEVICE_ID",
];
const REQUIRED_KV_BINDINGS = ["EMAIL_KV", "MEMORY_CONFIG_KV"];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    encoding: "utf8",
    input: options.input,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(result.stderr || "");
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return result.stdout || "";
}

function readDevVars(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

function existingSecretNames() {
  const result = spawnSync("npx", ["wrangler", "secret", "list", "--format", "json", "--config", wranglerConfig], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) return new Set();
  try {
    const list = JSON.parse(result.stdout);
    return new Set(Array.isArray(list) ? list.map((item) => item.name) : []);
  } catch {
    return new Set();
  }
}

function generateVapidKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk = publicKey.export({ format: "jwk" });
  const privateJwk = privateKey.export({ format: "jwk" });
  const publicBytes = Buffer.concat([
    Buffer.from([4]),
    Buffer.from(publicJwk.x, "base64url"),
    Buffer.from(publicJwk.y, "base64url"),
  ]);
  return { publicKey: publicBytes.toString("base64url"), privateKey: privateJwk.d };
}

function suppliedUserSecrets() {
  const files = [path.join(projectRoot, ".dev.vars"), path.join(webRoot, ".dev.vars")];
  const values = Object.assign({}, ...files.map(readDevVars), process.env);
  return Object.fromEntries(USER_SECRET_NAMES.flatMap((name) => values[name] ? [[name, values[name]]] : []));
}

function generatedWranglerConfig() {
  if (!existsSync(viteDeployConfig)) throw new Error("Vite deploy configuration was not generated. Run the production build first.");
  const deploy = JSON.parse(readFileSync(viteDeployConfig, "utf8"));
  if (!deploy.configPath) throw new Error("Vite deploy configuration does not contain a Worker config path.");
  return path.resolve(path.dirname(viteDeployConfig), deploy.configPath);
}

function jsonFromOutput(value) {
  const starts = [value.indexOf("["), value.indexOf("{")].filter((index) => index >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    try { return JSON.parse(value.slice(start)); } catch { /* Wrangler notices may precede JSON. */ }
  }
  return null;
}

function unwrap(value) {
  if (value && typeof value === "object" && value.result) return unwrap(value.result);
  return value;
}

function itemId(item) {
  return item?.uuid || item?.id || item?.database_id || item?.namespace_id;
}

function expectedKvTitle(workerName, binding) {
  if (binding === "EMAIL_KV") return `${workerName}-email`;
  if (binding === "MEMORY_CONFIG_KV") return `${workerName}-memories-config`;
  return `${workerName}-${binding.toLowerCase().replaceAll("_", "-")}`;
}

function ensureCloudflareResources() {
  const config = JSON.parse(readFileSync(wranglerConfig, "utf8"));
  const workerName = config.name || "nudge";
  let databases = unwrap(jsonFromOutput(run("npx", ["wrangler", "d1", "list", "--json", "--config", wranglerConfig], { capture: true })));
  databases = Array.isArray(databases) ? databases : [];
  for (const database of config.d1_databases || []) {
    let found = databases.find((item) => itemId(item) === database.database_id);
    found ||= databases.find((item) => item.name === database.database_name);
    if (!found) {
      const created = unwrap(jsonFromOutput(run("npx", ["wrangler", "d1", "create", database.database_name, "--json", "--config", wranglerConfig], { capture: true })));
      found = created?.database_id ? { uuid: created.database_id, name: database.database_name } : created;
      databases.push(found);
    }
    const id = itemId(found);
    if (!id) throw new Error(`Could not provision D1 database ${database.database_name}. Run npm run setup:cloudflare once.`);
    database.database_id = id;
  }

  config.kv_namespaces ||= [];
  for (const binding of REQUIRED_KV_BINDINGS) {
    if (!config.kv_namespaces.some((item) => item.binding === binding)) config.kv_namespaces.push({ binding });
  }
  let namespaces = unwrap(jsonFromOutput(run("npx", ["wrangler", "kv", "namespace", "list", "--config", wranglerConfig], { capture: true })));
  namespaces = Array.isArray(namespaces) ? namespaces : [];
  for (const namespace of config.kv_namespaces || []) {
    const title = expectedKvTitle(workerName, namespace.binding);
    let found = namespaces.find((item) => itemId(item) === namespace.id);
    found ||= namespaces.find((item) => item.title === title || item.title === namespace.binding);
    if (!found) {
      found = unwrap(jsonFromOutput(run("npx", ["wrangler", "kv", "namespace", "create", title, "--config", wranglerConfig], { capture: true })));
      namespaces.push(found);
    }
    namespace.id = itemId(found);
    if (!namespace.id) throw new Error(`Could not provision KV namespace ${title}. Run npm run setup:cloudflare once.`);
  }

  let indexes = unwrap(jsonFromOutput(run("npx", ["wrangler", "vectorize", "list", "--json", "--config", wranglerConfig], { capture: true })));
  indexes = Array.isArray(indexes) ? indexes : [];
  for (const vector of config.vectorize || []) {
    if (!indexes.some((item) => item.name === vector.index_name)) {
      run("npx", ["wrangler", "vectorize", "create", vector.index_name, "--dimensions=384", "--metric=cosine", "--config", wranglerConfig]);
      indexes.push({ name: vector.index_name });
    }
  }
  writeFileSync(wranglerConfig, `${JSON.stringify(config, null, 2)}\n`);
}

async function main() {
  const publicTemplate = readFileSync(wranglerConfig, "utf8");
  let temporaryDirectory = "";
  try {
    // Resolve account resource IDs only for this deployment. The checked-in
    // template must remain portable for forks and Cloudflare Deploy buttons.
    ensureCloudflareResources();
    run("npm", ["run", "build", "-w", "web"]);

    const existing = existingSecretNames();
    const secrets = suppliedUserSecrets();
    if (!existing.has("NUDGE_ENCRYPTION_KEY") && !existing.has("CREDENTIAL_ENCRYPTION_KEY") && !secrets.NUDGE_ENCRYPTION_KEY && !secrets.CREDENTIAL_ENCRYPTION_KEY) {
      secrets.NUDGE_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    }
    if (!existing.has("NUDGE_ACTION_SIGNING_SECRET")) secrets.NUDGE_ACTION_SIGNING_SECRET ||= randomBytes(48).toString("base64url");
    const hasVapidPublic = existing.has("VAPID_PUBLIC_KEY");
    const hasVapidPrivate = existing.has("VAPID_PRIVATE_KEY");
    if (hasVapidPublic !== hasVapidPrivate) {
      throw new Error("Only one VAPID key exists. Restore the matching pair before deploying; Nudge will not rotate it automatically.");
    }
    if (!hasVapidPublic && !hasVapidPrivate) {
      const vapid = generateVapidKeys();
      secrets.VAPID_PUBLIC_KEY = vapid.publicKey;
      secrets.VAPID_PRIVATE_KEY = vapid.privateKey;
    }

    const deployArgs = ["wrangler", "deploy", "--config", generatedWranglerConfig()];
    if (Object.keys(secrets).length) {
      temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nudge-secrets-"));
      const secretsFile = path.join(temporaryDirectory, "secrets.json");
      writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
      deployArgs.push("--secrets-file", secretsFile);
    }
    run("npx", deployArgs, { cwd: webRoot });
    run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--remote", "--config", wranglerConfig], { cwd: projectRoot });
    run("npx", ["wrangler", "d1", "execute", "MEMORY_DB", "--remote", "--file", "web/memory-migrations/0001_memories.sql", "--config", wranglerConfig], { cwd: projectRoot });
  } finally {
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
    writeFileSync(wranglerConfig, publicTemplate);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
