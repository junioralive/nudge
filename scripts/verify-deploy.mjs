const baseUrl = (process.argv[2] || "https://nudge.junioralive.workers.dev").replace(/\/$/, "");
const assertion = process.env.CF_ACCESS_JWT_ASSERTION || "";
const headers = assertion ? { "Cf-Access-Jwt-Assertion": assertion } : {};

const session = await fetch(`${baseUrl}/api/auth/session`, { headers });
if (session.status === 401) {
  console.log(`${baseUrl} is protected by Cloudflare Access. Complete an email OTP login, then rerun with CF_ACCESS_JWT_ASSERTION for an authenticated smoke test.`);
  process.exit(0);
}
if (!session.ok) throw new Error(`${baseUrl} auth session returned ${session.status}`);
const [health, capabilities] = await Promise.all([
  fetch(`${baseUrl}/api/health`, { headers }),
  fetch(`${baseUrl}/api/capabilities`, { headers }),
]);
const healthBody = await health.json();
const capabilityBody = await capabilities.json();
if (!health.ok || !healthBody.database) throw new Error(`${baseUrl} dependency health failed`);
console.log(`Verified ${baseUrl}: Access session, D1, capabilities, and Worker health.`);
console.log(JSON.stringify({ capabilities: capabilityBody, health: { database: healthBody.database, memory: healthBody.memory } }, null, 2));
