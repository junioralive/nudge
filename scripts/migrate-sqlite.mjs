import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = path.resolve(import.meta.dirname, "..");
const databasePath = path.join(projectRoot, "nudge.db");
const webRoot = path.join(projectRoot, "web");
const dryRun = process.argv.includes("--dry-run");
const timezone = process.env.APP_TIMEZONE || "Asia/Kolkata";

function sql(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function localDateToUtc(value) {
  if (!value) return null;
  if (/[zZ]$|[+-]\d\d:\d\d$/.test(value)) return new Date(value).toISOString();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return new Date(value).toISOString();
  const [, year, month, day, hour, minute, second = "00"] = match;
  const desiredUtc = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(desiredUtc))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const representedUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return new Date(desiredUtc - (representedUtc - desiredUtc)).toISOString();
}

function sqliteUtc(value) {
  if (!value) return null;
  if (/[zZ]$|[+-]\d\d:\d\d$/.test(value)) return new Date(value).toISOString();
  return new Date(value.replace(" ", "T") + "Z").toISOString();
}

const database = new Database(databasePath, { readonly: true });
const tasks = database.prepare("SELECT id, text, due_at, notified_at, done_at, workspace, created_at FROM tasks ORDER BY id").all();
database.close();

const statements = [
  ...tasks.map(
    (task) =>
      `INSERT INTO tasks (id, text, due_at, notified_at, done_at, workspace, created_at)
VALUES (${Number(task.id)}, ${sql(task.text)}, ${sql(localDateToUtc(task.due_at))}, ${sql(sqliteUtc(task.notified_at))}, ${sql(sqliteUtc(task.done_at))}, ${sql(task.workspace || "Personal")}, ${sql(sqliteUtc(task.created_at))})
ON CONFLICT(id) DO NOTHING;`,
  ),
  "SELECT COUNT(*) AS task_count FROM tasks;",
].join("\n");

if (dryRun) {
  console.log(`Prepared ${tasks.length} task rows for D1 (${timezone}). No remote changes made.`);
  process.exit(0);
}

const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "nudge-migration-"));
const sqlPath = path.join(temporaryDirectory, "tasks.sql");
writeFileSync(sqlPath, statements, { mode: 0o600 });

try {
  const result = spawnSync("npx", ["wrangler", "d1", "execute", "DB", "--remote", "--file", sqlPath], {
    cwd: webRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status || 1);
  console.log(`Migration complete. ${tasks.length} local task rows were offered idempotently; nudge.db was unchanged.`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
