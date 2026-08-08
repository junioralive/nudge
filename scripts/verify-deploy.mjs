import { readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const values = Object.fromEntries(
  readFileSync(path.join(projectRoot, "web", ".dev.vars"), "utf8")
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

async function verify(baseUrl) {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ key: values.NUDGE_AUTH_KEY }),
  });
  if (!login.ok) throw new Error(`${baseUrl} login returned ${login.status}`);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] || "";
  const [health, tasks] = await Promise.all([
    fetch(`${baseUrl}/api/health`, { headers: { Cookie: cookie } }),
    fetch(`${baseUrl}/api/tasks`, { headers: { Cookie: cookie } }),
  ]);
  const healthBody = await health.json();
  const taskBody = await tasks.json();
  if (!health.ok || !healthBody.ok || !healthBody.database || !healthBody.memory) {
    throw new Error(`${baseUrl} dependency health failed`);
  }
  if (!tasks.ok || !Array.isArray(taskBody) || taskBody.length < 14) {
    throw new Error(`${baseUrl} task migration verification failed`);
  }
  console.log(`Verified ${baseUrl}: authentication, D1, Second Brain, and ${taskBody.length} tasks healthy.`);
}

const url = process.argv[2] || "https://nudge.junioralive.workers.dev";
await verify(url);
