import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const vars = readFileSync(path.join(projectRoot, "web", ".dev.vars"), "utf8");
const key = vars.match(/^NUDGE_AUTH_KEY=(.+)$/m)?.[1];
if (!key) throw new Error("NUDGE_AUTH_KEY is missing from web/.dev.vars");
const output = path.join(projectRoot, "NUDGE_LOGIN_KEY.txt");
writeFileSync(output, `${key}\n`, { mode: 0o600 });
chmodSync(output, 0o600);
console.log("Login key exported to NUDGE_LOGIN_KEY.txt with owner-only permissions.");
