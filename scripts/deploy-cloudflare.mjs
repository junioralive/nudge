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
  "GEMINI_API_KEY",
  "CREDENTIAL_ENCRYPTION_KEY",
  "NUDGE_ACTION_SIGNING_SECRET",
  "OUTLOOK_CLIENT_ID",
  "OUTLOOK_CLIENT_SECRET",
];

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

function ensureCloudflareResources() {
  const config = JSON.parse(readFileSync(wranglerConfig, "utf8"));
  const database = config.d1_databases?.[0];
  if (database && !database.database_id) {
    const listed = unwrap(jsonFromOutput(run("npx", ["wrangler", "d1", "list", "--json", "--config", wranglerConfig], { capture: true })));
    let found = Array.isArray(listed) ? listed.find((item) => item.name === database.database_name) : null;
    if (!found) {
      const created = unwrap(jsonFromOutput(run("npx", ["wrangler", "d1", "create", database.database_name, "--json", "--config", wranglerConfig], { capture: true })));
      found = created?.database_id ? { uuid: created.database_id } : created;
    }
    if (!found?.uuid) throw new Error(`Could not provision D1 database ${database.database_name}. Run npm run setup:cloudflare once.`);
    database.database_id = found.uuid;
  }

  const namespace = config.kv_namespaces?.[0];
  if (namespace && (!namespace.id || namespace.id.startsWith("replace-with-"))) {
    const title = `${config.name || "nudge"}-email`;
    const listed = unwrap(jsonFromOutput(run("npx", ["wrangler", "kv", "namespace", "list", "--config", wranglerConfig], { capture: true })));
    let found = Array.isArray(listed) ? listed.find((item) => item.title === title || item.title === "EMAIL_KV") : null;
    if (!found) found = unwrap(jsonFromOutput(run("npx", ["wrangler", "kv", "namespace", "create", title, "--config", wranglerConfig], { capture: true })));
    namespace.id = found?.id || found?.namespace_id;
    if (!namespace.id) throw new Error("Could not provision Email KV. Run npm run setup:cloudflare once.");
  }
  writeFileSync(wranglerConfig, `${JSON.stringify(config, null, 2)}\n`);
}

async function main() {
  ensureCloudflareResources();
  run("npm", ["run", "build", "-w", "web"]);

  const existing = existingSecretNames();
  const secrets = suppliedUserSecrets();
  if (!existing.has("CREDENTIAL_ENCRYPTION_KEY") && !secrets.CREDENTIAL_ENCRYPTION_KEY) {
    secrets.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
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

  let temporaryDirectory = "";
  try {
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
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
