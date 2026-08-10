import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const config = JSON.parse(readFileSync(path.join(root, "wrangler.jsonc"), "utf8"));
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const failures = [];

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

function bindings(items, key = "binding") {
  return new Set((items || []).map((item) => item[key]));
}

const d1 = bindings(config.d1_databases);
const kv = bindings(config.kv_namespaces);
const vectorize = bindings(config.vectorize);
const durableObjects = bindings(config.durable_objects?.bindings, "name");
const workerFirst = new Set(config.assets?.run_worker_first || []);

requireValue(config.workers_dev === true, "workers.dev must remain enabled for fresh deployments");
requireValue(!config.routes, "public template must not contain a personal custom domain route");
requireValue(!JSON.stringify(config).includes("junioralive.in"), "public template contains a personal domain");
requireValue(d1.has("DB") && d1.has("MEMORY_DB"), "DB and MEMORY_DB bindings are required");
requireValue(kv.has("EMAIL_KV") && kv.has("MEMORY_CONFIG_KV"), "EMAIL_KV and MEMORY_CONFIG_KV bindings are required");
requireValue(vectorize.has("MEMORY_VECTORIZE"), "MEMORY_VECTORIZE binding is required");
requireValue(durableObjects.has("MCP_OBJECT") && durableObjects.has("MEMORY_MCP_OBJECT"), "both MCP Durable Objects are required");
requireValue(config.ai?.binding === "AI", "Workers AI binding is required");
requireValue(workerFirst.has("/api/*") && workerFirst.has("/email/mcp") && workerFirst.has("/memories/mcp"), "API and MCP routes must run through the Worker");
requireValue(pkg.scripts?.build && pkg.scripts?.deploy && pkg.scripts?.["setup:cloudflare"], "Cloudflare build, deploy, and guided setup scripts are required");
for (const binding of ["DB", "MEMORY_DB", "EMAIL_KV", "MEMORY_CONFIG_KV", "MEMORY_VECTORIZE"]) {
  requireValue(Boolean(pkg.cloudflare?.bindings?.[binding]?.description), `${binding} needs a Deploy-button description`);
}
requireValue(existsSync(path.join(root, "web", "migrations")), "task migrations directory is missing");
requireValue(existsSync(path.join(root, "web", "memory-migrations", "0001_memories.sql")), "Memories migration is missing");

if (failures.length) {
  console.error(`Deploy template validation failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log("Deploy template is account-safe and includes every required Cloudflare binding.");
