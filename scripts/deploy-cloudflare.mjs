import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const webRoot = path.join(projectRoot, "web");
const wranglerConfig = path.join(projectRoot, "wrangler.jsonc");
const USER_SECRET_NAMES = ["NUDGE_AUTH_KEY", "NUDGE_PROFILE_NAME", "APP_TIMEZONE", "GEMINI_API_KEY", "SECOND_BRAIN_URL", "SECOND_BRAIN_TOKEN"];

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

async function main() {
  run("npm", ["run", "build", "-w", "web"]);

  const existing = existingSecretNames();
  const secrets = suppliedUserSecrets();
  if (!existing.has("NUDGE_AUTH_KEY") && !secrets.NUDGE_AUTH_KEY) {
    throw new Error("NUDGE_AUTH_KEY is required. Enter it in the Cloudflare setup form or web/.dev.vars.");
  }
  if (!existing.has("SESSION_SECRET")) secrets.SESSION_SECRET = randomBytes(48).toString("base64url");
  if (!existing.has("VAPID_PUBLIC_KEY") || !existing.has("VAPID_PRIVATE_KEY")) {
    const vapid = generateVapidKeys();
    secrets.VAPID_PUBLIC_KEY = vapid.publicKey;
    secrets.VAPID_PRIVATE_KEY = vapid.privateKey;
  }

  let temporaryDirectory = "";
  try {
    const deployArgs = ["wrangler", "deploy"];
    if (Object.keys(secrets).length) {
      temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nudge-secrets-"));
      const secretsFile = path.join(temporaryDirectory, "secrets.json");
      writeFileSync(secretsFile, JSON.stringify(secrets), { mode: 0o600 });
      deployArgs.push("--secrets-file", secretsFile);
    }
    run("npx", deployArgs, { cwd: webRoot });
    run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--remote", "--config", wranglerConfig], { cwd: projectRoot });
  } finally {
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
