import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const wranglerPath = path.join(projectRoot, "wrangler.jsonc");
const rl = createInterface({ input, output });
let managedOauthRedirectUris = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || projectRoot,
    stdio: options.input !== undefined ? ["pipe", "inherit", "inherit"] : "inherit",
    input: options.input,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed`);
  return result.stdout || "";
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
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
  const answer = (await ask(`${label} ${fallback ? "Y/n" : "y/N"}`)).toLowerCase();
  return answer ? answer === "y" || answer === "yes" : fallback;
}

function safeWorkerName(value) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "nudge";
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

function generateVapidKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const publicJwk = publicKey.export({ format: "jwk" });
  const privateJwk = privateKey.export({ format: "jwk" });
  const publicBytes = Buffer.concat([Buffer.from([4]), Buffer.from(publicJwk.x, "base64url"), Buffer.from(publicJwk.y, "base64url")]);
  return { publicKey: publicBytes.toString("base64url"), privateKey: privateJwk.d };
}

function updateWrangler(config) {
  writeFileSync(wranglerPath, `${JSON.stringify(config, null, 2)}\n`);
}

function existingSecretNames() {
  const result = spawnSync("npx", ["wrangler", "secret", "list", "--format", "json", "--config", wranglerPath], { cwd: projectRoot, encoding: "utf8" });
  if (result.status !== 0) return new Set();
  try {
    const values = JSON.parse(result.stdout);
    return new Set(Array.isArray(values) ? values.map((item) => item.name) : []);
  } catch { return new Set(); }
}

function installSecret(name, value) {
  run("npx", ["wrangler", "secret", "put", name, "--config", wranglerPath], { input: `${value}\n` });
}

async function ensureDatabase(workerName, config) {
  const databaseName = `${workerName}-db`;
  const listed = unwrap(jsonFromOutput(capture("npx", ["wrangler", "d1", "list", "--json", "--config", wranglerPath])));
  let database = Array.isArray(listed) ? listed.find((item) => item.name === databaseName) : null;
  if (!database) {
    console.log(`Creating D1 database ${databaseName}…`);
    const created = unwrap(jsonFromOutput(capture("npx", ["wrangler", "d1", "create", databaseName, "--json", "--config", wranglerPath])));
    database = created?.database_id ? { uuid: created.database_id, name: databaseName } : created;
  }
  if (!database?.uuid) throw new Error("Could not determine the D1 database ID from Wrangler.");
  config.d1_databases = [
    { binding: "DB", database_name: database.name || databaseName, database_id: database.uuid, migrations_dir: "web/migrations" },
    ...(config.d1_databases || []).filter((item) => item.binding !== "DB"),
  ];
}

async function ensureEmailKv(workerName, config, requestedId) {
  if (requestedId) {
    config.kv_namespaces = [{ binding: "EMAIL_KV", id: requestedId }, ...(config.kv_namespaces || []).filter((item) => item.binding !== "EMAIL_KV")];
    return requestedId;
  }
  const listed = unwrap(jsonFromOutput(capture("npx", ["wrangler", "kv", "namespace", "list", "--config", wranglerPath])));
  const existing = Array.isArray(listed) ? listed.find((item) => item.title === `${workerName}-email` || item.title === "EMAIL_KV") : null;
  let namespace = existing;
  if (!namespace) {
    console.log("Creating an Email KV namespace…");
    namespace = unwrap(jsonFromOutput(capture("npx", ["wrangler", "kv", "namespace", "create", `${workerName}-email`, "--config", wranglerPath])));
  }
  const id = namespace?.id || namespace?.namespace_id;
  if (!id) throw new Error("Could not determine the Email KV namespace ID from Wrangler.");
  config.kv_namespaces = [{ binding: "EMAIL_KV", id }, ...(config.kv_namespaces || []).filter((item) => item.binding !== "EMAIL_KV")];
  return id;
}

async function ensureMemories(workerName, config) {
  const databaseName = `${workerName}-memories`;
  const databases = unwrap(jsonFromOutput(capture("npx", ["wrangler", "d1", "list", "--json", "--config", wranglerPath])));
  let database = Array.isArray(databases) ? databases.find((item) => item.name === databaseName) : null;
  if (!database) {
    console.log(`Creating Memories D1 database ${databaseName}…`);
    capture("npx", ["wrangler", "d1", "create", databaseName, "--config", wranglerPath]);
    const refreshed = unwrap(jsonFromOutput(capture("npx", ["wrangler", "d1", "list", "--json", "--config", wranglerPath])));
    database = Array.isArray(refreshed) ? refreshed.find((item) => item.name === databaseName) : null;
  }
  if (!database?.uuid) throw new Error("Could not determine the Memories D1 database ID.");
  config.d1_databases = [
    ...(config.d1_databases || []).filter((item) => item.binding !== "MEMORY_DB"),
    { binding: "MEMORY_DB", database_name: databaseName, database_id: database.uuid },
  ];

  const kvTitle = `${workerName}-memories-config`;
  const namespaces = unwrap(jsonFromOutput(capture("npx", ["wrangler", "kv", "namespace", "list", "--config", wranglerPath])));
  let namespace = Array.isArray(namespaces) ? namespaces.find((item) => item.title === kvTitle) : null;
  if (!namespace) {
    console.log(`Creating Memories configuration KV ${kvTitle}…`);
    namespace = unwrap(jsonFromOutput(capture("npx", ["wrangler", "kv", "namespace", "create", kvTitle, "--config", wranglerPath])));
  }
  const kvId = namespace?.id || namespace?.namespace_id;
  if (!kvId) throw new Error("Could not determine the Memories configuration KV ID.");
  config.kv_namespaces = [
    ...(config.kv_namespaces || []).filter((item) => item.binding !== "MEMORY_CONFIG_KV"),
    { binding: "MEMORY_CONFIG_KV", id: kvId },
  ];

  const indexName = `${workerName}-memories-vectors`;
  const indexOutput = capture("npx", ["wrangler", "vectorize", "list", "--json", "--config", wranglerPath]);
  const indexes = unwrap(jsonFromOutput(indexOutput));
  if (!Array.isArray(indexes) || !indexes.some((item) => item.name === indexName)) {
    console.log(`Creating 384-dimensional Memories Vectorize index ${indexName}…`);
    run("npx", ["wrangler", "vectorize", "create", indexName, "--dimensions=384", "--metric=cosine", "--config", wranglerPath]);
  }
  config.vectorize = [{ binding: "MEMORY_VECTORIZE", index_name: indexName }];
  config.ai = { binding: "AI" };
  config.durable_objects = config.durable_objects || { bindings: [] };
  config.durable_objects.bindings = [
    ...(config.durable_objects.bindings || []).filter((item) => item.name !== "MEMORY_MCP_OBJECT"),
    { name: "MEMORY_MCP_OBJECT", class_name: "MemoriesMCP" },
  ];
  config.migrations = config.migrations || [];
  if (!config.migrations.some((migration) => migration.tag === "memories-mcp-v1")) config.migrations.push({ tag: "memories-mcp-v1", new_sqlite_classes: ["MemoriesMCP"] });
  config.triggers = config.triggers || { crons: [] };
  config.triggers.crons = [...new Set([...(config.triggers.crons || []), "* * * * *", "0 1 * * *"] )];
  config.assets.run_worker_first = [...new Set([...(config.assets?.run_worker_first || ["/api/*"]), "/memories/mcp", "/memories/mcp/*"] )];
  return { databaseName, kvId, indexName };
}

async function accessApi(token, accountId, method, endpoint, body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${endpoint}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.success === false) throw new Error(json.errors?.[0]?.message || `Cloudflare Access API failed (${response.status})`);
  return json.result;
}

async function oneTimePinProvider(token, accountId) {
  try {
    const providers = await accessApi(token, accountId, "GET", "/access/identity_providers");
    const provider = (Array.isArray(providers) ? providers : []).find((candidate) => candidate.type === "onetimepin");
    return provider?.id || undefined;
  } catch {
    // The requested setup token may not include Identity Provider read access.
    // Access still supports OTP through the account's configured providers;
    // leave the app selectable in that case and report the manual check.
    return undefined;
  }
}

function appAudience(app) {
  const value = Array.isArray(app?.aud) ? app.aud[0] : app?.aud;
  return String(value || app?.uid || app?.id || "");
}

async function ensureAccessApplication(token, accountId, hostname, domain, type, ownerEmail, oauth = false, label = "Nudge") {
  const apps = await accessApi(token, accountId, "GET", "/access/apps");
  const otpProviderId = await oneTimePinProvider(token, accountId);
  const accessDefaults = {
    session_duration: "24h",
    allow_authenticate_via_warp: false,
    ...(otpProviderId ? { allowed_idps: [otpProviderId], auto_redirect_to_identity: true } : { auto_redirect_to_identity: false }),
  };
  let app = (Array.isArray(apps) ? apps : []).find((candidate) => candidate.domain === domain);
  if (!app) {
    app = await accessApi(token, accountId, "POST", "/access/apps", {
      name: label,
      domain,
      type,
      ...accessDefaults,
    });
  } else {
    app = await accessApi(token, accountId, "PUT", `/access/apps/${app.id}`, { domain, type, ...accessDefaults });
  }

  const policies = await accessApi(token, accountId, "GET", `/access/apps/${app.id}/policies`);
  const policyBody = { name: `${label} Owner`, decision: "allow", include: [{ email: { email: ownerEmail } }], session_duration: "24h" };
  const existingPolicy = (Array.isArray(policies) ? policies : []).find((policy) => policy.name === policyBody.name);
  if (existingPolicy) await accessApi(token, accountId, "PUT", `/access/apps/${app.id}/policies/${existingPolicy.id}`, policyBody);
  else await accessApi(token, accountId, "POST", `/access/apps/${app.id}/policies`, policyBody);

  if (oauth) {
    await accessApi(token, accountId, "PUT", `/access/apps/${app.id}`, {
      ...accessDefaults,
      domain,
      type,
      oauth_configuration: {
        enabled: true,
        dynamic_client_registration: {
          enabled: true,
          allow_any_on_localhost: false,
          allow_any_on_loopback: false,
          allowed_uris: managedOauthRedirectUris,
        },
        grant: { access_token_lifetime: "15m", session_duration: "24h" },
      },
    });
  }
  const aud = appAudience(app);
  if (!aud) throw new Error(`Access application ${domain} did not return an audience value.`);
  return aud;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function main() {
  console.log("\nNudge Cloudflare setup\n");
  run("npx", ["wrangler", "whoami", "--config", wranglerPath]);
  const config = JSON.parse(readFileSync(wranglerPath, "utf8"));
  const secrets = existingSecretNames();
  const workerName = safeWorkerName(await ask("Worker name", config.name || "nudge"));
  const ownerEmail = (await askRequired("Owner email for Cloudflare Access OTP")).toLowerCase();
  const teamDomain = (await askRequired("Cloudflare Access team domain (https://...)")).replace(/\/$/, "");
  const accountId = await askRequired("Cloudflare account ID");
  const apiToken = await askRequired("Temporary API token (Access: Apps and Policies Write; used only in memory)");
  const customDomain = (await ask("Custom domain (optional; leave blank for workers.dev)")).replace(/^https?:\/\//, "").replace(/\/$/, "");
  const hostname = customDomain || `${workerName}.workers.dev`;
  const profileName = await ask("Display name", "Junior");
  const timezone = await ask("Timezone", "Asia/Kolkata");
  const assistantGender = (await ask("Assistant voice (she or he)", "she")).toLowerCase() === "he" ? "he" : "she";
  const workspaces = (await ask("Workspaces (comma-separated)", "Personal, Work, Startup")).split(",").map((value) => value.trim()).filter(Boolean).slice(0, 50);
  const enableGemini = await confirm("Enable Gemini voice assistant?", false);
  const geminiKey = enableGemini ? await askRequired("Gemini API key") : "";
  const enableOutlook = await confirm("Enable Microsoft Outlook account connection?", true);
  const outlookClientId = enableOutlook ? await askRequired("Microsoft Entra client ID") : "";
  const outlookClientSecret = enableOutlook ? await askRequired("Microsoft Entra client secret") : "";
  const outlookTenant = enableOutlook ? await ask("Microsoft tenant", "consumers") : "";
  const existingKvId = await ask("Existing Email KV namespace ID (leave blank to create one)");
  managedOauthRedirectUris = (await askRequired("MCP client redirect URIs (comma-separated; copy the exact HTTPS callbacks shown by ChatGPT/Claude)"))
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("https://"));
  if (!managedOauthRedirectUris.length) throw new Error("At least one HTTPS MCP client redirect URI is required.");

  config.name = workerName;
  config.workers_dev = true;
  config.routes = customDomain ? [{ pattern: hostname, custom_domain: true }] : [];
  config.vars = {
    ...(config.vars || {}),
    APP_TIMEZONE: timezone,
    VAPID_SUBJECT: `https://${hostname}`,
    NUDGE_ASSISTANT_GENDER: assistantGender,
    GEMINI_LIVE_MODEL: config.vars?.GEMINI_LIVE_MODEL || "gemini-3.1-flash-live-preview",
    TEAM_DOMAIN: teamDomain,
    NUDGE_ACCESS_AUD: "pending-access-setup",
    NUDGE_OWNER_EMAIL: ownerEmail,
  };
  delete config.vars.SECOND_BRAIN_URL;
  if (!enableOutlook) delete config.vars.OUTLOOK_TENANT;
  await ensureDatabase(workerName, config);
  const kvId = await ensureEmailKv(workerName, config, existingKvId);
  const memories = await ensureMemories(workerName, config);
  updateWrangler(config);

  console.log("Configuring Cloudflare Access applications…");
  const nudgeAud = await ensureAccessApplication(apiToken, accountId, hostname, `${hostname}/*`, "self_hosted", ownerEmail, false, "Nudge");
  const emailMcpAud = await ensureAccessApplication(apiToken, accountId, hostname, `${hostname}/email/mcp*`, "self_hosted", ownerEmail, true, "Nudge Email MCP");
  const memoriesMcpAud = await ensureAccessApplication(apiToken, accountId, hostname, `${hostname}/memories/mcp*`, "self_hosted", ownerEmail, true, "Nudge Memories MCP");
  config.vars.NUDGE_ACCESS_AUD = nudgeAud;
  config.vars.EMAIL_MCP_ACCESS_AUD = emailMcpAud;
  config.vars.MEMORIES_MCP_ACCESS_AUD = memoriesMcpAud;
  updateWrangler(config);

  console.log("Installing generated and optional secrets…");
  const hasVapidPublic = secrets.has("VAPID_PUBLIC_KEY");
  const hasVapidPrivate = secrets.has("VAPID_PRIVATE_KEY");
  if (hasVapidPublic !== hasVapidPrivate) throw new Error("Only one VAPID key exists. Restore the matching pair before deploying; setup will not rotate it automatically.");
  if (!hasVapidPublic && !hasVapidPrivate) {
    const vapid = generateVapidKeys();
    installSecret("VAPID_PUBLIC_KEY", vapid.publicKey);
    installSecret("VAPID_PRIVATE_KEY", vapid.privateKey);
  }
  if (!secrets.has("NUDGE_ACTION_SIGNING_SECRET")) installSecret("NUDGE_ACTION_SIGNING_SECRET", randomBytes(48).toString("base64url"));
  if (!secrets.has("CREDENTIAL_ENCRYPTION_KEY")) {
    if (existingKvId) installSecret("CREDENTIAL_ENCRYPTION_KEY", await askRequired("Existing CREDENTIAL_ENCRYPTION_KEY (required; it will not be rotated)"));
    else installSecret("CREDENTIAL_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
  }
  if (enableGemini) installSecret("GEMINI_API_KEY", geminiKey);
  if (enableOutlook) {
    installSecret("OUTLOOK_CLIENT_ID", outlookClientId);
    installSecret("OUTLOOK_CLIENT_SECRET", outlookClientSecret);
    config.vars.OUTLOOK_TENANT = outlookTenant;
    updateWrangler(config);
  }

  console.log("Applying D1 migrations…");
  run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--remote", "--config", wranglerPath]);
  run("npx", ["wrangler", "d1", "execute", "MEMORY_DB", "--remote", "--file", "web/memory-migrations/0001_memories.sql", "--config", wranglerPath]);
  const seed = [
    `INSERT INTO settings (key, value) VALUES ('name', ${sqlString(profileName)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    `INSERT INTO settings (key, value) VALUES ('timezone', ${sqlString(timezone)}) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ...workspaces.map((name, index) => `INSERT OR IGNORE INTO workspaces (name, sort_order) VALUES (${sqlString(name)}, ${index})`),
  ].join("; ");
  run("npx", ["wrangler", "d1", "execute", "DB", "--remote", "--command", seed, "--config", wranglerPath]);
  run("npm", ["run", "deploy"]);
  console.log(`\nNudge is deployed: https://${hostname}`);
  console.log(`Email MCP endpoint: https://${hostname}/email/mcp`);
  console.log(`Memories MCP endpoint: https://${hostname}/memories/mcp`);
  if (enableOutlook) console.log(`Microsoft redirect URI: https://${hostname}/api/email/oauth/outlook/callback`);
  console.log(`Email KV namespace: ${kvId}`);
  console.log(`Memories D1: ${memories.databaseName}`);
  console.log(`Memories Vectorize: ${memories.indexName}`);
  console.log(`Managed OAuth redirect URIs: ${managedOauthRedirectUris.join(", ")}`);
  console.log("Access application and MCP sessions are set to 24 hours; Managed OAuth uses 15-minute access tokens.");
  rl.close();
}

main().catch((error) => {
  rl.close();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
