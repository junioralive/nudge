import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const webRoot = path.join(projectRoot, "web");
const wranglerPath = path.join(webRoot, "wrangler.jsonc");
const rl = createInterface({ input, output });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    stdio: options.input !== undefined ? ["pipe", "inherit", "inherit"] : "inherit",
    input: options.input,
    encoding: "utf8",
  });
  if (result.status !== 0) process.exit(result.status || 1);
  return result.stdout || "";
}

function capture(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
    process.exit(result.status || 1);
  }
  return result.stdout || "";
}

async function ask(label, fallback = "") {
  const answer = await rl.question(`${label}${fallback ? ` [${fallback}]` : ""}: `);
  return answer.trim() || fallback;
}

async function askRequired(label) {
  while (true) {
    const value = await ask(label);
    if (value) return value;
    console.log("This value is required.");
  }
}

async function confirm(label, fallback = true) {
  const answer = (await ask(`${label} ${fallback ? "Y/n" : "y/N"}`, "")).toLowerCase();
  if (!answer) return fallback;
  return answer === "y" || answer === "yes";
}

function safeWorkerName(value) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "nudge";
}

function jsonFromOutput(output) {
  const starts = [output.indexOf("["), output.indexOf("{")].filter((value) => value >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    try { return JSON.parse(output.slice(start)); } catch { /* Wrangler may print notices before JSON. */ }
  }
  return null;
}

function unwrapResult(value) {
  if (value && typeof value === "object" && value.result) return unwrapResult(value.result);
  return value;
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

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function updateWrangler(config) {
  writeFileSync(wranglerPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function ensureDatabase(workerName, config) {
  const databaseName = `${workerName}-db`;
  const listed = unwrapResult(jsonFromOutput(capture("npx", ["wrangler", "d1", "list", "--json"], webRoot)));
  let database = Array.isArray(listed) ? listed.find((item) => item.name === databaseName) : null;
  if (!database) {
    console.log(`Creating D1 database ${databaseName}…`);
    const created = unwrapResult(jsonFromOutput(capture("npx", ["wrangler", "d1", "create", databaseName, "--json"], webRoot)));
    database = created?.database_id ? { uuid: created.database_id, name: databaseName } : created;
  }
  if (!database?.uuid) throw new Error("Could not determine the D1 database ID from Wrangler.");
  config.d1_databases = [{ binding: "DB", database_name: database.name || databaseName, database_id: database.uuid, migrations_dir: "migrations" }];
  return database;
}

async function main() {
  console.log("\nNudge Cloudflare setup\n");
  run("npx", ["wrangler", "whoami"], { cwd: webRoot });

  const config = JSON.parse(readFileSync(wranglerPath, "utf8"));
  const workerName = safeWorkerName(await ask("Worker name", config.name || "nudge"));
  const profileName = await ask("Your name", "Junior");
  const timezone = await ask("Timezone", "Asia/Kolkata");
  const assistantGender = (await ask("Assistant voice (she or he)", "she")).toLowerCase() === "he" ? "he" : "she";
  const customDomain = await ask("Custom domain (optional; leave blank for workers.dev)");
  const workspaces = (await ask("Workspaces (comma-separated)", "Personal, Work, Startup"))
    .split(",").map((value) => value.trim()).filter(Boolean).slice(0, 50);
  const enableGemini = await confirm("Enable Gemini voice assistant?", false);
  const enableSecondBrain = await confirm("Enable Second Brain memories?", false);
  const enableEmail = await confirm("Connect a private Email MCP server?", false);
  const emailMcpUrl = enableEmail ? await askRequired("Email MCP URL") : "";
  const emailAccessClientId = enableEmail ? await askRequired("Cloudflare Access service token Client ID") : "";
  const emailMcpWorker = enableEmail ? await ask("Email MCP Worker name", "email-mcp-server") : "";

  config.name = workerName;
  config.workers_dev = true;
  config.routes = customDomain ? [{ pattern: customDomain, custom_domain: true }] : [];
  config.vars = {
    APP_TIMEZONE: timezone,
    VAPID_SUBJECT: customDomain ? `https://${customDomain}` : `https://${workerName}.workers.dev`,
    NUDGE_ASSISTANT_GENDER: assistantGender,
    GEMINI_LIVE_MODEL: config.vars?.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview",
    ...(enableGemini ? {} : {}),
    ...(enableSecondBrain ? { SECOND_BRAIN_URL: await askRequired("Second Brain URL") } : {}),
    ...(enableEmail ? { EMAIL_MCP_URL: emailMcpUrl } : {}),
  };
  await ensureDatabase(workerName, config);
  updateWrangler(config);

  const loginKey = `nudge_${randomBytes(32).toString("base64url")}`;
  const loginPath = path.join(projectRoot, "NUDGE_LOGIN_KEY.txt");
  writeFileSync(loginPath, `${loginKey}\n`, { mode: 0o600 });
  const vapid = generateVapidKeys();

  console.log("\nInstalling required secrets…");
  run("npx", ["wrangler", "secret", "put", "NUDGE_AUTH_KEY"], { cwd: webRoot, input: `${loginKey}\n` });
  run("npx", ["wrangler", "secret", "put", "SESSION_SECRET"], { cwd: webRoot, input: `${randomBytes(48).toString("base64url")}\n` });
  run("npx", ["wrangler", "secret", "put", "VAPID_PUBLIC_KEY"], { cwd: webRoot, input: `${vapid.publicKey}\n` });
  run("npx", ["wrangler", "secret", "put", "VAPID_PRIVATE_KEY"], { cwd: webRoot, input: `${vapid.privateKey}\n` });
  if (enableGemini) run("npx", ["wrangler", "secret", "put", "GEMINI_API_KEY"], { cwd: webRoot });
  if (enableSecondBrain) run("npx", ["wrangler", "secret", "put", "SECOND_BRAIN_TOKEN"], { cwd: webRoot });
  if (enableEmail) {
    const actionSecret = randomBytes(48).toString("base64url");
    run("npx", ["wrangler", "secret", "put", "EMAIL_ACCESS_CLIENT_ID"], { cwd: webRoot, input: `${emailAccessClientId}\n` });
    run("npx", ["wrangler", "secret", "put", "EMAIL_ACCESS_CLIENT_SECRET"], { cwd: webRoot });
    run("npx", ["wrangler", "secret", "put", "EMAIL_ACTION_SIGNING_SECRET"], { cwd: webRoot, input: `${actionSecret}\n` });
    run("npx", ["wrangler", "secret", "put", "NUDGE_ACCESS_CLIENT_ID", "--name", emailMcpWorker], { cwd: webRoot, input: `${emailAccessClientId}\n` });
    run("npx", ["wrangler", "secret", "put", "NUDGE_ACTION_SIGNING_SECRET", "--name", emailMcpWorker], { cwd: webRoot, input: `${actionSecret}\n` });
  }

  console.log("Applying D1 migrations…");
  run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--remote"], { cwd: webRoot });
  const seed = [
    `INSERT INTO settings (key, value) VALUES ('name', ${sqlString(profileName)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    `INSERT INTO settings (key, value) VALUES ('timezone', ${sqlString(timezone)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ...workspaces.map((name, index) => `INSERT OR IGNORE INTO workspaces (name, sort_order) VALUES (${sqlString(name)}, ${index})`),
  ].join("; ");
  run("npx", ["wrangler", "d1", "execute", "DB", "--remote", "--command", seed], { cwd: webRoot });
  run("npm", ["run", "deploy", "-w", "web"]);

  const url = customDomain ? `https://${customDomain}` : `https://${workerName}.workers.dev`;
  console.log(`\nNudge is deployed: ${url}`);
  console.log(`Login key saved to ${loginPath}`);
  console.log("Open the URL, enter the generated key, then enable notifications from the Notifications screen.");
  rl.close();
}

main().catch((error) => {
  rl.close();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
