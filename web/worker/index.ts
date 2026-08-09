import { GoogleGenAI, Modality } from "@google/genai";
import { Hono } from "hono";
import {
  authenticate,
  clearSessionCookie,
  clientAddress,
  createSession,
  requestOriginIsValid,
  requireSecrets,
  secureEqual,
  setSessionCookie,
} from "./auth";
import { addTask, completeTask, deleteTask, getTask, listTasks, updateTask } from "./data";
import { processDueReminders, retryFailedDeliveries } from "./reminders";
import { captureMemory, forgetMemory, listRecentMemories, recallMemories, SecondBrainError } from "./secondBrain";
import { disableDevice, getActiveDevice, getPushStatus, registerSubscription, sendTestPush } from "./push";
import {
  callEmailTool,
  consumeEmailApproval,
  createEmailApproval,
  emailConfigured,
  EmailMcpError,
  readEmailReference,
  safeEmailAccounts,
  safeEmailError,
  safeEmailList,
  safeEmailMessage,
} from "./email";
import { runTool, toolDeclarations } from "./tools";
import type { AppBindings, Env } from "./types";
import { ASSISTANT_VOICE_NAMES } from "../src/voice/voiceCatalog.js";

const app = new Hono<AppBindings>();
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const GEMINI_LIVE_MODEL = "gemini-3.1-flash-live-preview";
const ASSISTANT_VOICES = new Set(ASSISTANT_VOICE_NAMES);
const WORKSPACE_COLORS = new Set(["#E787FF", "#FFC66D", "#6FD69A", "#7FB2FF", "#FF9BC2", "#A99AF2"]);

app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeDueAt(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("due_at must be an ISO 8601 datetime");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("due_at must be an ISO 8601 datetime");
  return date.toISOString();
}

async function jsonBody<T>(c: { req: { json<U>(): Promise<U> } }): Promise<T> {
  return c.req.json<T>().catch(() => ({} as T));
}

async function workspacePayload(env: Env) {
  const rows = await env.DB.prepare("SELECT name, color FROM workspaces ORDER BY sort_order, created_at").all<{ name: string; color: string }>();
  const results = rows.results || [];
  return {
    workspaces: results.map((row) => row.name),
    workspace_colors: Object.fromEntries(results.map((row) => [row.name, row.color])),
  };
}

app.post("/api/auth/login", async (c) => {
  const origin = c.req.header("Origin");
  if (origin && !requestOriginIsValid(c.req.raw)) return c.json({ error: "forbidden" }, 403);

  const address = clientAddress(c);
  if (c.env.LOGIN_RATE_LIMITER) {
    const limit = await c.env.LOGIN_RATE_LIMITER.limit({ key: address });
    if (!limit.success) return c.json({ error: "too many attempts" }, 429);
  }

  const body = await jsonBody<{ key?: string }>(c);
  if (!body.key || !c.env.NUDGE_AUTH_KEY || !c.env.SESSION_SECRET || !(await secureEqual(body.key, c.env.NUDGE_AUTH_KEY))) {
    return c.json({ error: "invalid key" }, 401);
  }

  setSessionCookie(c, await createSession(c.env.SESSION_SECRET));
  return c.json({ authenticated: true });
});

app.get("/api/auth/session", async (c) => {
  return c.json({ authenticated: Boolean(await authenticate(c)) });
});

app.use("/api/*", async (c, next) => {
  const mode = await authenticate(c);
  if (!mode) return c.json({ error: "unauthorized" }, 401);
  c.set("authMode", mode);

  if (mode === "cookie" && MUTATING_METHODS.has(c.req.method) && !requestOriginIsValid(c.req.raw)) {
    return c.json({ error: "invalid origin" }, 403);
  }
  await next();
});

app.post("/api/auth/logout", (c) => {
  clearSessionCookie(c);
  return c.json({ authenticated: false });
});

app.get("/api/health", async (c) => {
  const missing = requireSecrets(c.env);
  let database = false;
  let memory = false;
  try {
    database = (await c.env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>())?.ok === 1;
  } catch {
    database = false;
  }
  if (c.env.SECOND_BRAIN_TOKEN && c.env.SECOND_BRAIN_URL) {
    try {
      const response = await fetch(new URL("/health", `${c.env.SECOND_BRAIN_URL.replace(/\/$/, "")}/`), {
        headers: { Authorization: `Bearer ${c.env.SECOND_BRAIN_TOKEN}` },
        signal: AbortSignal.timeout(5_000),
      });
      memory = response.ok;
    } catch {
      memory = false;
    }
  }
  const ok = missing.length === 0 && database;
  return c.json({ ok, database, memory, memoryConfigured: Boolean(c.env.SECOND_BRAIN_TOKEN), geminiConfigured: Boolean(c.env.GEMINI_API_KEY), missing }, ok ? 200 : 503);
});

app.get("/api/capabilities", (c) => c.json({
  gemini: Boolean(c.env.GEMINI_API_KEY),
  secondBrain: Boolean(c.env.SECOND_BRAIN_TOKEN && c.env.SECOND_BRAIN_URL),
  push: Boolean(c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY),
  email: emailConfigured(c.env),
}));

function emailErrorResponse(c: any, error: unknown) {
  const status = error instanceof EmailMcpError ? error.status : 502;
  return c.json({ error: safeEmailError(error) }, status);
}

function accountIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.map((item) => cleanText(item, 160)).filter(Boolean).slice(0, 20);
  return result.length ? result : undefined;
}

app.get("/api/email/status", async (c) => {
  if (!emailConfigured(c.env)) return c.json({ configured: false, healthy: false, accountCount: 0 });
  try {
    const accounts = safeEmailAccounts(await callEmailTool(c.env, "email_list_accounts"));
    return c.json({ configured: true, healthy: true, accountCount: accounts.length });
  } catch (error) {
    return c.json({ configured: true, healthy: false, accountCount: 0, error: safeEmailError(error) });
  }
});

app.get("/api/email/accounts", async (c) => {
  try {
    return c.json({ accounts: safeEmailAccounts(await callEmailTool(c.env, "email_list_accounts")) });
  } catch (error) {
    return emailErrorResponse(c, error);
  }
});

app.get("/api/email/inbox", async (c) => {
  const selected = cleanText(c.req.query("accountId"), 160);
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 20, 1), 50);
  try {
    const result = await callEmailTool(c.env, "email_list_all_inbox_messages", {
      ...(selected ? { accountIds: [selected] } : {}),
      limit,
      sortOrder: "newest",
    });
    return c.json(await safeEmailList(c.env, result));
  } catch (error) {
    return emailErrorResponse(c, error);
  }
});

app.post("/api/email/search", async (c) => {
  const body = await jsonBody<{ query?: string; limit?: number; accountIds?: string[] }>(c);
  const query = cleanText(body.query, 300);
  if (!query) return c.json({ error: "query is required" }, 400);
  try {
    const result = await callEmailTool(c.env, "email_search_all_accounts", {
      text: query,
      folder: "INBOX",
      ...(accountIds(body.accountIds) ? { accountIds: accountIds(body.accountIds) } : {}),
      limit: Math.min(Math.max(Number(body.limit) || 10, 1), 25),
      sortOrder: "newest",
    });
    return c.json(await safeEmailList(c.env, result));
  } catch (error) {
    return emailErrorResponse(c, error);
  }
});

app.post("/api/email/message", async (c) => {
  const body = await jsonBody<{ ref?: string }>(c);
  if (!body.ref) return c.json({ error: "ref is required" }, 400);
  try {
    const ref = await readEmailReference(c.env, body.ref);
    const message = safeEmailMessage(await callEmailTool(c.env, "email_get_message", { ...ref }));
    return c.json({ ...message, ref: body.ref });
  } catch (error) {
    return emailErrorResponse(c, error);
  }
});

app.post("/api/email/drafts", async (c) => {
  const body = await jsonBody<{
    accountId?: string;
    to?: string | string[];
    cc?: string | string[];
    subject?: string;
    text?: string;
    replyToRef?: string;
    replyAll?: boolean;
  }>(c);
  const text = cleanText(body.text, 50_000);
  if (!text) return c.json({ error: "message is required" }, 400);
  try {
    const reply = body.replyToRef ? await readEmailReference(c.env, body.replyToRef) : null;
    const selectedAccount = cleanText(body.accountId || reply?.accountId, 160);
    if (!selectedAccount) return c.json({ error: "accountId is required" }, 400);
    const args = {
      accountId: selectedAccount,
      ...(body.to ? { to: body.to } : {}),
      ...(body.cc ? { cc: body.cc } : {}),
      ...(body.subject !== undefined ? { subject: cleanText(body.subject, 1_000) } : {}),
      text,
      ...(reply ? { replyToMessage: { folder: reply.folder, uid: reply.uid, replyAll: Boolean(body.replyAll), quoteOriginal: true } } : {}),
    };
    const result = await callEmailTool(c.env, "email_create_message_draft", args);
    const draft = {
      accountId: cleanText(result.accountId, 160),
      folder: cleanText(result.folder, 500),
      uid: Number(result.uid),
      messageId: cleanText(result.messageId, 1_000),
    };
    if (!draft.accountId || !draft.folder || !Number.isInteger(draft.uid)) throw new EmailMcpError("Email service returned an invalid draft");
    return c.json({
      draft,
      sendApproval: await createEmailApproval(c.env, "send-draft", draft),
    }, 201);
  } catch (error) {
    return emailErrorResponse(c, error);
  }
});

app.post("/api/email/drafts/send", async (c) => {
  if (c.req.header("X-Confirm-Send") !== "true") return c.json({ error: "send confirmation required" }, 409);
  const body = await jsonBody<{ approval?: string }>(c);
  if (!body.approval) return c.json({ error: "approval is required" }, 400);
  try {
    const args = await consumeEmailApproval(c.env, body.approval, "send-draft");
    const result = await callEmailTool(c.env, "email_send_draft", {
      accountId: cleanText(args.accountId, 160),
      folder: cleanText(args.folder, 500),
      uid: Number(args.uid),
    });
    return c.json({ sent: Array.isArray(result.accepted) && result.accepted.length > 0, accepted: result.accepted || [], rejected: result.rejected || [] });
  } catch (error) {
    return emailErrorResponse(c, error);
  }
});

app.patch("/api/email/message-state", async (c) => {
  const body = await jsonBody<{ approval?: string; state?: "read" | "unread" }>(c);
  const action = body.state === "unread" ? "mark-unread" : body.state === "read" ? "mark-read" : null;
  if (!action || !body.approval) return c.json({ error: "state and approval are required" }, 400);
  try {
    const args = await consumeEmailApproval(c.env, body.approval, action);
    await callEmailTool(c.env, "email_update_message_flags", args);
    return c.json({ updated: true, seen: action === "mark-read" });
  } catch (error) {
    return emailErrorResponse(c, error);
  }
});

app.post("/api/email/archive", async (c) => {
  const body = await jsonBody<{ approval?: string }>(c);
  if (!body.approval) return c.json({ error: "approval is required" }, 400);
  try {
    const args = await consumeEmailApproval(c.env, body.approval, "archive");
    await callEmailTool(c.env, "email_archive_messages", args);
    return c.json({ archived: true });
  } catch (error) {
    return emailErrorResponse(c, error);
  }
});

app.post("/api/tasks/from-email", async (c) => {
  const body = await jsonBody<Record<string, unknown>>(c);
  const refToken = cleanText(body.ref, 8_000);
  const text = cleanText(body.text || body.title, 200);
  if (!refToken || !text) return c.json({ error: "ref and text are required" }, 400);
  try {
    const ref = await readEmailReference(c.env, refToken);
    const task = await addTask(c.env, {
      text,
      details: cleanText(body.details, 10_000),
      due_at: normalizeDueAt(body.due_at),
      workspace: cleanText(body.workspace, 80) || "Personal",
    });
    await c.env.DB.prepare(
      "INSERT INTO email_task_links (task_id, account_id, folder, message_uid, message_id) VALUES (?, ?, ?, ?, ?)",
    ).bind(task.id, ref.accountId, ref.folder, ref.uid, ref.messageId || null).run();
    return c.json(task, 201);
  } catch (error) {
    return emailErrorResponse(c, error);
  }
});

app.get("/api/tasks", async (c) => c.json(await listTasks(c.env)));

app.post("/api/tasks", async (c) => {
  const body = await jsonBody<Record<string, unknown>>(c);
  const text = cleanText(body.text || body.title, 200).slice(0, 200);
  if (!text) return c.json({ error: "text is required" }, 400);
  try {
    const task = await addTask(c.env, {
      text,
      details: cleanText(body.details, 10_000),
      due_at: normalizeDueAt(body.due_at),
      workspace: cleanText(body.workspace, 80) || "Personal",
      follow_up_interval_minutes: Number(body.follow_up_interval_minutes) || 0,
      follow_up_max_count: Number(body.follow_up_max_count) || 0,
    });
    return c.json(task, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "invalid task" }, 400);
  }
});

app.patch("/api/tasks/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) return c.json({ error: "invalid id" }, 400);
  const body = await jsonBody<Record<string, unknown>>(c);
  try {
    const task = await updateTask(c.env, id, {
      ...(body.text !== undefined || body.title !== undefined ? { text: cleanText(body.text || body.title, 200) } : {}),
      ...(body.details !== undefined ? { details: cleanText(body.details, 10_000) } : {}),
      ...(body.due_at !== undefined ? { due_at: normalizeDueAt(body.due_at) } : {}),
      ...(body.workspace !== undefined ? { workspace: cleanText(body.workspace, 80) } : {}),
      ...(body.follow_up_interval_minutes !== undefined ? { follow_up_interval_minutes: Number(body.follow_up_interval_minutes) || 0 } : {}),
      ...(body.follow_up_max_count !== undefined ? { follow_up_max_count: Number(body.follow_up_max_count) || 0 } : {}),
    });
    return task ? c.json(task) : c.json({ error: "not found" }, 404);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "invalid task" }, 400);
  }
});

app.post("/api/tasks/:id/done", async (c) => {
  const task = await completeTask(c.env, Number(c.req.param("id")));
  return task ? c.json(task) : c.json({ error: "not found" }, 404);
});

app.delete("/api/tasks/:id", async (c) => {
  const deleted = await deleteTask(c.env, Number(c.req.param("id")));
  return deleted ? c.body(null, 204) : c.json({ error: "not found" }, 404);
});

app.get("/api/bootstrap", async (c) => {
  const [settings, workspaces] = await Promise.all([
    c.env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('name', 'timezone', 'assistant_gender', 'assistant_voice')").all<{ key: string; value: string }>(),
    c.env.DB.prepare("SELECT name, color FROM workspaces ORDER BY sort_order, created_at").all<{ name: string; color: string }>(),
  ]);
  const profile = Object.fromEntries((settings.results || []).map((row) => [row.key, row.value]));
  return c.json({
    initialized: Boolean(profile.name),
    name: profile.name || "Junior",
    timezone: profile.timezone || c.env.APP_TIMEZONE || "Asia/Kolkata",
    assistant_gender: profile.assistant_gender === "he" ? "he" : "she",
    assistant_voice: ASSISTANT_VOICES.has(profile.assistant_voice) ? profile.assistant_voice : "Zephyr",
    workspaces: (workspaces.results || []).map((row) => row.name),
    workspace_colors: Object.fromEntries((workspaces.results || []).map((row) => [row.name, row.color])),
  });
});

app.post("/api/bootstrap", async (c) => {
  const existing = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'name'").first();
  if (existing) return c.json({ initialized: true, imported: false });
  const body = await jsonBody<{ name?: string; workspaces?: string[] }>(c);
  const name = cleanText(body.name, 80) || "Junior";
  const workspaces = Array.isArray(body.workspaces)
    ? body.workspaces.map((value) => cleanText(value, 80)).filter(Boolean).slice(0, 50)
    : [];
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO settings (key, value) VALUES ('name', ?)
       ON CONFLICT(key) DO NOTHING`,
    ).bind(name),
    ...workspaces.map((workspace, index) =>
      c.env.DB.prepare("INSERT OR IGNORE INTO workspaces (name, sort_order) VALUES (?, ?)").bind(workspace, index),
    ),
  ];
  await c.env.DB.batch(statements);
  return c.json({ initialized: true, imported: true });
});

app.put("/api/profile", async (c) => {
  const body = await jsonBody<{ name?: string; timezone?: string; assistant_gender?: string; assistant_voice?: string }>(c);
  const entries: Array<[string, string]> = [];
  if (body.name !== undefined) entries.push(["name", cleanText(body.name, 80)]);
  if (body.timezone !== undefined) entries.push(["timezone", cleanText(body.timezone, 80)]);
  if (body.assistant_gender !== undefined) {
    if (body.assistant_gender !== "she" && body.assistant_gender !== "he") return c.json({ error: "assistant gender must be she or he" }, 400);
    entries.push(["assistant_gender", body.assistant_gender]);
  }
  if (body.assistant_voice !== undefined) {
    if (!ASSISTANT_VOICES.has(body.assistant_voice)) return c.json({ error: "unsupported assistant voice" }, 400);
    entries.push(["assistant_voice", body.assistant_voice]);
  }
  const validEntries = entries.filter((entry) => Boolean(entry[1]));
  if (!validEntries.length) return c.json({ error: "at least one profile setting is required" }, 400);
  await c.env.DB.batch(
    validEntries.map(([key, value]) =>
      c.env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(key, value),
    ),
  );
  return c.json({ ok: true });
});

app.post("/api/workspaces", async (c) => {
  const body = await jsonBody<{ name?: string }>(c);
  const name = cleanText(body.name, 80);
  if (!name || name.toLowerCase() === "all") return c.json({ error: "invalid workspace" }, 400);
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO workspaces (name, sort_order)
     VALUES (?, COALESCE((SELECT MAX(sort_order) + 1 FROM workspaces), 0))`,
  )
    .bind(name)
    .run();
  return c.json(await workspacePayload(c.env), 201);
});

app.patch("/api/workspaces/:name", async (c) => {
  const currentName = cleanText(decodeURIComponent(c.req.param("name")), 80);
  const body = await jsonBody<{ name?: string; color?: string }>(c);
  const existing = await c.env.DB.prepare("SELECT name, color FROM workspaces WHERE lower(name) = lower(?)").bind(currentName).first<{ name: string; color: string }>();
  if (!existing) return c.json({ error: "workspace not found" }, 404);

  const nextName = body.name === undefined ? existing.name : cleanText(body.name, 80);
  const nextColor = body.color === undefined ? existing.color : cleanText(body.color, 16).toUpperCase();
  if (!nextName || nextName.toLowerCase() === "all") return c.json({ error: "invalid workspace" }, 400);
  if (!WORKSPACE_COLORS.has(nextColor)) return c.json({ error: "unsupported workspace color" }, 400);
  if (existing.name.toLowerCase() === "personal" && nextName.toLowerCase() !== "personal") return c.json({ error: "Personal workspace cannot be renamed" }, 400);
  if (nextName.toLowerCase() !== existing.name.toLowerCase()) {
    const duplicate = await c.env.DB.prepare("SELECT 1 FROM workspaces WHERE lower(name) = lower(?)").bind(nextName).first();
    if (duplicate) return c.json({ error: "workspace already exists" }, 409);
  }

  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE tasks SET workspace = ? WHERE lower(workspace) = lower(?)").bind(nextName, existing.name),
    c.env.DB.prepare("UPDATE workspaces SET name = ?, color = ? WHERE lower(name) = lower(?)").bind(nextName, nextColor, existing.name),
  ]);
  return c.json({ ok: true, ...(await workspacePayload(c.env)) });
});

app.delete("/api/workspaces/:name", async (c) => {
  const name = cleanText(decodeURIComponent(c.req.param("name")), 80);
  if (!name || name.toLowerCase() === "all" || name.toLowerCase() === "personal") {
    return c.json({ error: "Personal workspace cannot be deleted" }, 400);
  }
  const existing = await c.env.DB.prepare("SELECT name FROM workspaces WHERE lower(name) = lower(?)").bind(name).first<{ name: string }>();
  if (!existing) return c.json({ error: "workspace not found" }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO workspaces (name, sort_order) VALUES ('Personal', 0)"),
    c.env.DB.prepare("UPDATE tasks SET workspace = 'Personal' WHERE lower(workspace) = lower(?)").bind(existing.name),
    c.env.DB.prepare("DELETE FROM workspaces WHERE lower(name) = lower(?)").bind(existing.name),
  ]);
  return c.json({ ok: true, ...(await workspacePayload(c.env)) });
});

app.get("/api/vapid-public-key", (c) => c.json({ key: c.env.VAPID_PUBLIC_KEY }));

app.get("/api/push/status", async (c) => {
  const deviceId = cleanText(c.req.query("device_id"), 120);
  return c.json(await getPushStatus(c.env, deviceId));
});

app.post("/api/push/subscriptions", async (c) => {
  const body = await jsonBody<{ device_id?: string; device_name?: string; subscription?: PushSubscriptionJSON }>(c);
  const deviceId = cleanText(body.device_id, 120);
  const deviceName = cleanText(body.device_name, 120) || "Browser";
  if (!deviceId || !body.subscription?.endpoint) return c.json({ error: "invalid subscription" }, 400);
  try {
    await registerSubscription(c.env, deviceId, deviceName, body.subscription);
  } catch {
    return c.json({ error: "invalid subscription" }, 400);
  }
  return c.json({ ok: true }, 201);
});

app.delete("/api/push/subscriptions/:deviceId", async (c) => {
  const deviceId = cleanText(c.req.param("deviceId"), 120);
  if (!deviceId) return c.json({ error: "invalid device" }, 400);
  return c.json({ disabled: await disableDevice(c.env, deviceId) });
});

app.post("/api/push/test", async (c) => {
  const body = await jsonBody<{ device_id?: string }>(c);
  const deviceId = cleanText(body.device_id, 120);
  const device = deviceId ? await getActiveDevice(c.env, deviceId) : null;
  if (!device) return c.json({ error: "device is not registered" }, 404);
  if (device.last_test_at && Date.now() - new Date(device.last_test_at).getTime() < 60_000) {
    return c.json({ error: "wait one minute before another test" }, 429);
  }
  const result = await sendTestPush(c.env, device);
  if (!result.delivered) return c.json({ error: result.permanent ? "subscription expired" : "push delivery failed" }, 502);
  return c.json({ delivered: true });
});

app.post("/api/push/retry", async (c) => c.json({ retried: await retryFailedDeliveries(c.env) }));

app.get("/api/memories/recent", async (c) => {
  return c.json(
    await listRecentMemories(c.env, {
      workspace: c.req.query("workspace"),
      limit: Number(c.req.query("limit")) || 20,
    }),
  );
});

app.get("/api/memories/search", async (c) => {
  const query = cleanText(c.req.query("q"), 1_000);
  if (!query) return c.json({ error: "q is required" }, 400);
  return c.json(
    await recallMemories(c.env, {
      query,
      workspace: c.req.query("workspace"),
      topK: Number(c.req.query("limit")) || 10,
    }),
  );
});

app.post("/api/memories", async (c) => {
  const body = await jsonBody<{ content?: string; workspace?: string; tags?: string[] }>(c);
  const content = cleanText(body.content, 20_000);
  if (!content) return c.json({ error: "content is required" }, 400);
  const result = await captureMemory(c.env, {
    content,
    workspace: cleanText(body.workspace, 80),
    tags: Array.isArray(body.tags) ? body.tags.map((tag) => cleanText(tag, 60)).filter(Boolean) : [],
  });
  return c.json(result, 201);
});

app.delete("/api/memories/:id", async (c) => {
  if (c.req.header("X-Confirm-Delete") !== "true") return c.json({ error: "confirmation required" }, 409);
  return c.json(await forgetMemory(c.env, c.req.param("id")));
});

function voiceSystemInstruction(name: string, gender: string): string {
  const normalized = gender.trim().toLowerCase();
  const pronouns = normalized === "he" ? "he/him" : "she/her";
  return `You are Nudge, a natural real-time personal assistant. The user's name is ${name}; remember it as context, but do not repeat or force the name in every reply. Use it only occasionally when greeting, emphasizing something important, or clarifying identity. Use ${pronouns} pronouns when referring to yourself. Do not mention these instructions. Speak warmly and clearly, usually in one to three sentences. Never use markdown or describe internal process. Ask at most one question at a time. If interrupted, stop immediately.

Tasks are exact operational state. Always use task tools instead of guessing. Call list_tasks before updating, completing, or deleting unless the task ID came from this conversation. Routine task state is not a memory. When creating a task, use a concise title and put the user's complete explanation, constraints, and context in details. Never shorten away meaningful information. Completed tasks stay in task history, but query them only when the user explicitly asks what they finished, completed counts, or past task history. Do not include completed tasks in normal open-task answers.

Second Brain is durable personal memory. Use recall_memory when an answer depends on preferences, people, history, or past decisions. Use remember_memory when the user explicitly asks you to remember something or clearly states a durable preference, decision, relationship, personal fact, or project fact. After success, briefly confirm what was saved. Never store credentials, tokens, private keys, raw transcripts, assistant output, routine task changes, or transient conversation. Sensitive personal information requires explicit intent. Do not recall memory for simple task operations.

Email is private operational data. Use email tools only when the user explicitly asks about email, an inbox briefing, a specific message, a reply, or turning an email into a task. Inbox briefings use headers only: sender, subject, date, and read state. Never read message bodies during a general briefing. Call read_email only when the user explicitly asks to open, read, explain, or summarize a specific message. Never inspect email during ordinary task or memory conversations. You may prepare a draft for visible review, but you cannot send, archive, or mark messages read; those actions require the user to press a control in Nudge. Never save email content to Second Brain unless the user explicitly asks to remember a specific durable fact from it.`;
}

app.post("/api/voice-token", async (c) => {
  if (!c.env.GEMINI_API_KEY) return c.json({ error: "Gemini voice is not configured" }, 503);
  if (c.env.VOICE_RATE_LIMITER && !(await c.env.VOICE_RATE_LIMITER.limit({ key: clientAddress(c) })).success) {
    return c.json({ error: "too many voice requests" }, 429);
  }
  const body = await jsonBody<{ vad?: Record<string, any> }>(c);
  const vad = body.vad || {};
  const model = GEMINI_LIVE_MODEL;
  const settings = await c.env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('name', 'timezone', 'assistant_gender', 'assistant_voice')").all<{ key: string; value: string }>();
  const profile = Object.fromEntries((settings.results || []).map((row) => [row.key, row.value]));
  const profileName = profile.name?.trim() || "Junior";
  const assistantGender = profile.assistant_gender === "he" ? "he" : "she";
  const assistantVoice = ASSISTANT_VOICES.has(profile.assistant_voice) ? profile.assistant_voice : "Zephyr";
  const timezone = profile.timezone || c.env.APP_TIMEZONE || "Asia/Kolkata";
  const ai = new GoogleGenAI({ apiKey: c.env.GEMINI_API_KEY });
  const expireTime = new Date(Date.now() + 30 * 60 * 1_000).toISOString();

  try {
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime: new Date(Date.now() + 60 * 1_000).toISOString(),
        liveConnectConstraints: {
          model,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: {
              parts: [
                {
                  text: `${voiceSystemInstruction(profileName, assistantGender)}\nUser timezone: ${timezone}. Resolve relative dates in this timezone and pass due times with an explicit offset.`,
                },
              ],
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: assistantVoice } } },
            thinkingConfig: { thinkingBudget: 0 },
            realtimeInputConfig: {
              automaticActivityDetection: {
                startOfSpeechSensitivity: vad.startSensitivity || "START_SENSITIVITY_HIGH",
                endOfSpeechSensitivity: vad.endSensitivity || "END_SENSITIVITY_HIGH",
                prefixPaddingMs: vad.prefixPaddingMs ?? 200,
                silenceDurationMs: vad.silenceDurationMs ?? 600,
              },
            },
            sessionResumption: {},
            tools: [{ functionDeclarations: toolDeclarations }],
          },
        },
      },
    });
    return c.json({ token: token.name, expireTime, model });
  } catch (error) {
    console.error("voice_token_failed", { error: error instanceof Error ? error.name : "error" });
    return c.json({ error: "Could not start voice session" }, 502);
  }
});

app.post("/api/voice/tool", async (c) => {
  if (c.env.VOICE_RATE_LIMITER && !(await c.env.VOICE_RATE_LIMITER.limit({ key: clientAddress(c) })).success) {
    return c.json({ error: "too many voice requests" }, 429);
  }
  const body = await jsonBody<{ name?: string; args?: Record<string, unknown> }>(c);
  if (!body.name) return c.json({ error: "name is required" }, 400);
  return c.json({ result: await runTool(c.env, body.name, body.args || {}) });
});

app.onError((error, c) => {
  if (error instanceof SecondBrainError) return c.json({ error: error.message }, error.status as any);
  console.error("request_failed", { path: c.req.path, error: error.name });
  return c.json({ error: "internal error" }, 500);
});

app.notFound((c) => c.json({ error: "not found" }, 404));

export { app };

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(processDueReminders(env));
  },
} satisfies ExportedHandler<Env>;
