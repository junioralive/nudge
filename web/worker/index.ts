import { GoogleGenAI, Modality } from "@google/genai";
import { Hono } from "hono";
import {
  accessLogoutUrl,
  authenticate,
  authConfigurationError,
  clientAddress,
  clearKeySessionCookie,
  constantTimeKeyMatches,
  createKeySession,
  keySessionCookie,
  requestOriginIsValid,
  requireSecrets,
  resolvedAuthModeForResponse,
} from "./auth";
import { authenticateMcpRequest, handleKeyOAuthRequest, mcpUnauthorized } from "./keyOAuth";
import { addTask, completeTask, deleteTask, getTask, listTasks, updateTask } from "./data";
import { processDueReminders, retryFailedDeliveries } from "./reminders";
import {
  appendMemory,
  askMemories,
  captureMemory,
  exportMemories,
  forgetMemory,
  getMemory,
  importMemories,
  linkMemories,
  listRecentMemories,
  memoriesConfigured,
  memoriesHealth,
  memoryConfig,
  memoryConnections,
  memoryGraph,
  memoryReindexStatus,
  memoryStats,
  recallMemories,
  reindexMemories,
  SecondBrainError,
  setMemoryStatus,
  unlinkMemories,
  updateMemory,
  updateMemoryConfig,
} from "./secondBrain";
import { runNightlyCompression } from "./memories-core/compression/nightly";
import { runGraphPass } from "./memories-core/graph/pass";
import { runStalenessPass } from "./memories-core/staleness/pass";
import { disableDevice, getActiveDevice, getPushStatus, registerSubscription, sendTestPush } from "./push";
import {
  callEmailTool,
  consumeEmailApproval,
  createEmailApproval,
  emailErrorCategory,
  emailConfigured,
  EmailMcpError,
  readEmailReference,
  safeEmailAccounts,
  safeEmailError,
  safeEmailList,
  safeEmailMessage,
} from "./email";
import { clearOauthCookie, emailService, emailStore, finishOutlookOAuth, outlookConfigured, parseAccountInput, startOutlookOAuth } from "./emailAccounts";
import { emailMcpHandler, MyMCP } from "./email-core/mcp";
import { memoriesMcpHandler, MemoriesMCP } from "./memoriesMcp";
import { runTool, toolDeclarations } from "./tools";
import { AutomationError, cancelAutomation, createAutomation, listAutomations, processDueAutomations, resolveEmailSchedule, retryAutomation } from "./automations";
import type { AppBindings, Env } from "./types";
import { ASSISTANT_VOICE_NAMES } from "../src/voice/voiceCatalog.js";
import { sealJson } from "./email-core/crypto";
import { integrationEncryptionKey, loadIntegrationSecret, runtimeEnv } from "./integrationSecrets";
import { accessRecoveryIsFresh, accessTeamLogoutUrl, buildRecoveryPayload, recoveryDownloadResponse } from "./recovery";
import { addCalendarSource, deleteCalendarSource, listCalendarEvents, listCalendarSources, syncCalendarSource } from "./calendar";
import { DelegationError, getDelegation, handleWhatsAppWebhook, listDelegations, pauseDelegation, prepareDelegation, processDelegations, resumeDelegation, startDelegation, stopDelegation } from "./delegations";
import {
  consumeWhatsAppApproval,
  consumeWhatsAppScheduleApproval,
  createWhatsAppApproval,
  createWhatsAppScheduleApproval,
  getWhatsAppMessages,
  getWhatsAppStatus,
  listWhatsAppChats,
  sendWhatsAppMessage,
  whatsappConfigured,
  WhatsAppError,
} from "./whatsapp";

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

app.get("/api/auth/session", async (c) => {
  const authMode = resolvedAuthModeForResponse(c.req.raw, c.env);
  const identity = await authenticate(c);
  if (!identity) return c.json({ authenticated: false, authMode, error: authMode ? undefined : authConfigurationError(c.env) }, authMode ? 401 : 503);
  return c.json({ authenticated: true, authMode, email: identity.email, expiresAt: identity.exp ? identity.exp * 1000 : null });
});

app.post("/api/auth/login", async (c) => {
  const authMode = resolvedAuthModeForResponse(c.req.raw, c.env);
  if (authMode !== "key") return c.json({ error: "Key login is not enabled", authMode }, 404);
  if (!requestOriginIsValid(c.req.raw)) return c.json({ error: "invalid origin" }, 403);
  if (!c.env.LOGIN_RATE_LIMITER) return c.json({ error: "Login rate limiter is not configured" }, 503);
  if (!(await c.env.LOGIN_RATE_LIMITER.limit({ key: clientAddress(c) })).success) return c.json({ error: "too many login attempts" }, 429);
  const body = await jsonBody<{ key?: string }>(c);
  if (typeof body.key !== "string" || !c.env.NUDGE_AUTH_KEY || !(await constantTimeKeyMatches(body.key, c.env.NUDGE_AUTH_KEY))) {
    return c.json({ error: "Invalid Nudge key" }, 401);
  }
  const session = await createKeySession(c.env);
  c.header("Set-Cookie", keySessionCookie(session.token));
  return c.json({ authenticated: true, authMode: "key", expiresAt: session.expiresAt * 1000 });
});

app.use("/api/*", async (c, next) => {
  const identity = await authenticate(c);
  if (!identity) return c.json({ error: "unauthorized" }, 401);
  c.set("authMode", identity.kind);
  c.set("identity", identity);

  if (MUTATING_METHODS.has(c.req.method) && identity.source !== "bearer" && !requestOriginIsValid(c.req.raw)) {
    return c.json({ error: "invalid origin" }, 403);
  }
  await next();
});

app.post("/api/auth/logout", (c) => {
  if (c.get("authMode") === "key") {
    c.header("Set-Cookie", clearKeySessionCookie());
    return c.json({ authenticated: false, authMode: "key" });
  }
  return c.json({ authenticated: false, logoutUrl: accessLogoutUrl(c.req.raw) });
});

app.post("/api/recovery/export", async (c) => {
  if (c.req.header("X-Confirm-Recovery") !== "download") return c.json({ error: "Recovery download confirmation is required" }, 400);
  if (!c.env.LOGIN_RATE_LIMITER) return c.json({ error: "Recovery rate limiter is not configured" }, 503);
  if (!(await c.env.LOGIN_RATE_LIMITER.limit({ key: `recovery:${clientAddress(c)}` })).success) {
    return c.json({ error: "Too many recovery attempts. Try again shortly." }, 429);
  }

  const authMode = c.get("authMode");
  const identity = c.get("identity");
  if (authMode === "key") {
    const body = await jsonBody<{ key?: string }>(c);
    if (typeof body.key !== "string" || !c.env.NUDGE_AUTH_KEY || !(await constantTimeKeyMatches(body.key, c.env.NUDGE_AUTH_KEY))) {
      return c.json({ error: "Invalid Nudge key" }, 401);
    }
  } else if (authMode === "access") {
    if (!accessRecoveryIsFresh(identity)) {
      return c.json({
        error: "Reauthenticate with Cloudflare Access before downloading your recovery kit.",
        reauthUrl: accessTeamLogoutUrl(c.env),
      }, 403);
    }
  } else {
    return c.json({ error: "Recovery downloads are unavailable in local development mode" }, 403);
  }

  const [gemini, microsoft] = await Promise.all([
    loadIntegrationSecret(c.env, "gemini"),
    loadIntegrationSecret(c.env, "microsoft"),
  ]);
  const origin = new URL(c.req.url).origin;
  return recoveryDownloadResponse(buildRecoveryPayload(c.env, origin, authMode, { gemini, microsoft }));
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
  if (memoriesConfigured(c.env)) memory = (await memoriesHealth(c.env)).healthy;
  const gemini = await loadIntegrationSecret(c.env, "gemini");
  const ok = missing.length === 0 && database;
  return c.json({ ok, database, memory, memoryConfigured: memoriesConfigured(c.env), geminiConfigured: Boolean(gemini?.apiKey || c.env.GEMINI_API_KEY), missing }, ok ? 200 : 503);
});

app.get("/api/capabilities", async (c) => {
  const gemini = await loadIntegrationSecret(c.env, "gemini");
  const microsoft = await loadIntegrationSecret(c.env, "microsoft");
  const resolvedEnv = await runtimeEnv(c.env);
  return c.json({
  gemini: Boolean(gemini?.apiKey || c.env.GEMINI_API_KEY),
  secondBrain: memoriesConfigured(c.env),
  memories: memoriesConfigured(c.env),
  memoriesMcp: Boolean(c.env.NUDGE_ACCESS_AUD && c.env.MEMORY_MCP_OBJECT),
  push: Boolean(c.env.VAPID_PUBLIC_KEY && c.env.VAPID_PRIVATE_KEY),
  email: emailConfigured(c.env),
  calendar: Boolean(integrationEncryptionKey(c.env)),
  outlook: outlookConfigured(c.env) || Boolean(microsoft?.clientId && microsoft?.clientSecret),
  whatsapp: whatsappConfigured(resolvedEnv),
  });
});

function whatsappErrorResponse(c: any, error: unknown) {
  const status = error instanceof WhatsAppError ? error.status : 502;
  return c.json({ error: error instanceof WhatsAppError ? error.message : "WhatsApp service unavailable" }, status);
}

app.get("/api/whatsapp/status", async (c) => {
  const env = await runtimeEnv(c.env);
  if (!whatsappConfigured(env)) return c.json({ configured: false, connected: false, loggedIn: false });
  try { return c.json(await getWhatsAppStatus(env)); }
  catch (error) { return whatsappErrorResponse(c, error); }
});

app.get("/api/whatsapp/chats", async (c) => {
  try {
    const env = await runtimeEnv(c.env);
    return c.json(await listWhatsAppChats(env, {
      limit: Number(c.req.query("limit")), offset: Number(c.req.query("offset")), search: c.req.query("search"),
    }));
  } catch (error) { return whatsappErrorResponse(c, error); }
});

app.get("/api/whatsapp/chats/:jid/messages", async (c) => {
  try {
    const env = await runtimeEnv(c.env);
    return c.json(await getWhatsAppMessages(env, c.req.param("jid"), {
      limit: Number(c.req.query("limit")), offset: Number(c.req.query("offset")),
    }));
  } catch (error) { return whatsappErrorResponse(c, error); }
});

app.post("/api/whatsapp/messages/prepare", async (c) => {
  const body = await jsonBody<{ jid?: string; message?: string; replyMessageId?: string }>(c);
  if (!body.jid || !cleanText(body.message, 10_000)) return c.json({ error: "chat and message are required" }, 400);
  try {
    return c.json({ requiresConfirmation: true, approval: await createWhatsAppApproval(c.env, { jid: body.jid, message: body.message, replyMessageId: body.replyMessageId }), preview: { jid: body.jid, message: cleanText(body.message, 10_000) } });
  } catch (error) { return whatsappErrorResponse(c, error); }
});

app.post("/api/whatsapp/messages/send", async (c) => {
  if (c.req.header("X-Confirm-Send") !== "true") return c.json({ error: "send confirmation required" }, 409);
  const body = await jsonBody<{ approval?: string }>(c);
  if (!body.approval) return c.json({ error: "approval is required" }, 400);
  try {
    const env = await runtimeEnv(c.env);
    return c.json(await sendWhatsAppMessage(env, await consumeWhatsAppApproval(c.env, body.approval)));
  } catch (error) { return whatsappErrorResponse(c, error); }
});

app.get("/api/automations", async (c) => {
  try {
    return c.json(await listAutomations(c.env, {
      source: c.req.query("source"), status: c.req.query("status"), from: c.req.query("from"), to: c.req.query("to"), limit: Number(c.req.query("limit")) || 50,
    }));
  } catch (error) { return automationErrorResponse(c, error); }
});

app.post("/api/whatsapp/schedules/prepare", async (c) => {
  const body = await jsonBody<{ jid?: string; recipient?: string; message?: string; scheduledAt?: string }>(c);
  if (!body.jid || !cleanText(body.message, 10_000) || !body.scheduledAt) return c.json({ error: "chat, message, and scheduled time are required" }, 400);
  try {
    const approval = await createWhatsAppScheduleApproval(c.env, {
      jid: body.jid, recipient: body.recipient, message: body.message, scheduledAt: body.scheduledAt,
    });
    return c.json({ requiresConfirmation: true, approval, preview: { jid: body.jid, recipient: cleanText(body.recipient, 300), message: cleanText(body.message, 10_000), scheduledAt: new Date(body.scheduledAt).toISOString() } });
  } catch (error) { return whatsappErrorResponse(c, error); }
});

app.post("/api/whatsapp/schedules", async (c) => {
  if (c.req.header("X-Confirm-Schedule") !== "true") return c.json({ error: "schedule confirmation required" }, 409);
  const body = await jsonBody<{ approval?: string }>(c);
  if (!body.approval) return c.json({ error: "approval is required" }, 400);
  try {
    const approved = await consumeWhatsAppScheduleApproval(c.env, body.approval);
    return c.json(await createAutomation(c.env, "whatsapp_message", { jid: approved.jid, message: approved.message, recipient: approved.recipient }, approved.scheduledAt));
  } catch (error) { return automationErrorResponse(c, error); }
});

app.delete("/api/automations/:id", async (c) => {
  if (c.req.header("X-Confirm-Cancel") !== "true") return c.json({ error: "cancellation confirmation required" }, 409);
  try { return c.json(await cancelAutomation(c.env, c.req.param("id"), c.req.query("source"))); }
  catch (error) { return automationErrorResponse(c, error); }
});

app.post("/api/automations/:id/retry", async (c) => {
  if (c.req.header("X-Confirm-Retry") !== "true") return c.json({ error: "retry confirmation required" }, 409);
  try { return c.json(await retryAutomation(c.env, c.req.param("id"), c.req.query("source"))); }
  catch (error) { return automationErrorResponse(c, error); }
});

function automationErrorResponse(c: any, error: unknown) {
  const status = error instanceof AutomationError ? error.status : error instanceof EmailMcpError ? error.status : error instanceof WhatsAppError ? error.status : 502;
  return c.json({ error: error instanceof Error ? error.message : "Automation service unavailable" }, status);
}

function emailErrorResponse(c: any, error: unknown) {
  const status = error instanceof EmailMcpError ? error.status : 502;
  return c.json({ error: safeEmailError(error) }, status);
}

function accountIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = value.map((item) => cleanText(item, 160)).filter(Boolean).slice(0, 20);
  return result.length ? result : undefined;
}

function publicAccount(account: { id: string; name: string; email: string; imap?: { host: string; port: number; secure: boolean }; smtp?: { host: string; port: number; secure: boolean }; auth?: { type: string } }) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    imapHost: account.imap?.host,
    imapPort: account.imap?.port,
    imapSecure: account.imap?.secure,
    smtpHost: account.smtp?.host,
    smtpPort: account.smtp?.port,
    smtpSecure: account.smtp?.secure,
    authType: account.auth?.type,
    canSend: Boolean(account.smtp),
  };
}

app.post("/api/email/oauth/outlook/start", async (c) => {
  if (!outlookConfigured(c.env)) return c.json({ error: "Outlook OAuth is not configured" }, 503);
  const body = await jsonBody<{ displayName?: string; accountId?: string }>(c);
  const displayName = cleanText(body.displayName, 160) || "Outlook";
  try {
    const result = await startOutlookOAuth(c.env, c.req.raw, displayName, cleanText(body.accountId, 160) || undefined);
    c.header("Set-Cookie", result.cookie);
    return c.json({ url: result.url });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not start Outlook OAuth" }, 400);
  }
});

app.get("/api/email/oauth/outlook/callback", async (c) => {
  try {
    const result = await finishOutlookOAuth(c.env, c.req.raw);
    c.header("Set-Cookie", result.clearCookie);
    return c.redirect("/email?status=outlook_connected", 303);
  } catch (error) {
    c.header("Set-Cookie", clearOauthCookie(c.req.url.startsWith("https://")));
    return c.redirect(`/email?email_error=${encodeURIComponent(error instanceof Error ? error.message : "Outlook authorization failed")}`, 303);
  }
});

app.post("/api/email/accounts", async (c) => {
  try {
    const body = await jsonBody<Record<string, unknown>>(c);
    const account = parseAccountInput(body);
    const created = { id: crypto.randomUUID(), ...account };
    await emailService(c.env).testAccount(created);
    const saved = await emailStore(c.env).add(account);
    return c.json({ account: publicAccount(saved) }, 201);
  } catch (error) {
    return emailErrorResponse(c, error);
  }
});

app.patch("/api/email/accounts/:id", async (c) => {
  try {
    const store = emailStore(c.env);
    const existing = await store.get(c.req.param("id"));
    const body = await jsonBody<Record<string, unknown>>(c);
    const updated = { id: existing.id, ...parseAccountInput(body, existing.auth) };
    await emailService(c.env).testAccount(updated);
    await store.update(updated);
    return c.json({ account: publicAccount(updated) });
  } catch (error) {
    return emailErrorResponse(c, error);
  }
});

app.delete("/api/email/accounts/:id", async (c) => {
  try {
    await emailStore(c.env).remove(c.req.param("id"));
    return c.json({ removed: true });
  } catch (error) {
    return emailErrorResponse(c, error);
  }
});

app.post("/api/email/accounts/:id/test", async (c) => {
  try {
    return c.json(await emailService(c.env).testConnection(c.req.param("id")));
  } catch (error) {
    return emailErrorResponse(c, error);
  }
});

app.get("/api/email/status", async (c) => {
  if (!emailConfigured(c.env)) return c.json({ configured: false, healthy: false, accountCount: 0 });
  try {
    const accounts = safeEmailAccounts(await callEmailTool(c.env, "email_list_accounts"));
    return c.json({ configured: true, healthy: true, accountCount: accounts.length });
  } catch (error) {
    const errorCode = emailErrorCategory(error);
    console.error("email_status_failed", { errorCode });
    return c.json({ configured: true, healthy: false, accountCount: 0, error: safeEmailError(error), errorCode });
  }
});

app.get("/api/email/accounts", async (c) => {
  try {
    if (!emailConfigured(c.env)) return c.json({ accounts: [] });
    return c.json({ accounts: (await emailStore(c.env).list()).map(publicAccount) });
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

app.post("/api/email/automations/prepare", async (c) => {
  const body = await jsonBody<Record<string, unknown>>(c);
  try {
    const preview = await resolveEmailSchedule(await runtimeEnv(c.env), body);
    const approval = await createEmailApproval(c.env, "schedule-send", preview);
    return c.json({ requiresConfirmation: true, approval, preview });
  } catch (error) { return automationErrorResponse(c, error); }
});

app.post("/api/email/automations", async (c) => {
  if (c.req.header("X-Confirm-Schedule") !== "true") return c.json({ error: "schedule confirmation required" }, 409);
  const body = await jsonBody<{ approval?: string }>(c);
  if (!body.approval) return c.json({ error: "approval is required" }, 400);
  try {
    const approved = await consumeEmailApproval(c.env, body.approval, "schedule-send");
    const payload = await resolveEmailSchedule(await runtimeEnv(c.env), approved);
    return c.json(await createAutomation(c.env, "email_message", {
      accountId: payload.accountId, accountName: payload.accountName, to: payload.to, cc: payload.cc, bcc: payload.bcc, subject: payload.subject, body: payload.body,
    }, payload.scheduledAt));
  } catch (error) { return automationErrorResponse(c, error); }
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

app.get("/api/calendar/sources", async (c) => c.json({ sources: await listCalendarSources(c.env) }));

app.post("/api/calendar/sources", async (c) => {
  const body = await jsonBody<{ provider?: string; url?: string; name?: string; color?: string }>(c);
  if (!body.provider || !body.url) return c.json({ error: "provider and calendar URL are required" }, 400);
  try {
    return c.json(await addCalendarSource(c.env, { provider: body.provider, url: body.url, name: body.name, color: body.color }), 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not connect calendar" }, 400);
  }
});

app.post("/api/calendar/sources/:id/sync", async (c) => {
  try {
    return c.json(await syncCalendarSource(c.env, Number(c.req.param("id"))));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Calendar sync failed" }, 502);
  }
});

app.delete("/api/calendar/sources/:id", async (c) => {
  return await deleteCalendarSource(c.env, Number(c.req.param("id"))) ? c.body(null, 204) : c.json({ error: "not found" }, 404);
});

app.get("/api/calendar/events", async (c) => {
  try {
    return c.json({ events: await listCalendarEvents(c.env, {
      from: c.req.query("from") || "",
      to: c.req.query("to") || "",
      refresh: c.req.query("refresh") !== "0",
    }) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Could not load calendar" }, 400);
  }
});

app.get("/api/bootstrap", async (c) => {
  const [settings, workspaces] = await Promise.all([
    c.env.DB.prepare("SELECT key, value, onboarding_completed_at FROM settings WHERE key IN ('name', 'timezone', 'assistant_gender', 'assistant_voice')").all<{ key: string; value: string; onboarding_completed_at?: string | null }>(),
    c.env.DB.prepare("SELECT name, color FROM workspaces ORDER BY sort_order, created_at").all<{ name: string; color: string }>(),
  ]);
  const profile = Object.fromEntries((settings.results || []).map((row) => [row.key, row.value]));
  const onboardingCompleted = Boolean((settings.results || []).find((row) => row.key === "name")?.onboarding_completed_at);
  return c.json({
    initialized: Boolean(profile.name),
    onboarding_required: !onboardingCompleted,
    onboarding_completed_at: (settings.results || []).find((row) => row.key === "name")?.onboarding_completed_at || null,
    name: profile.name || "Junior",
    timezone: profile.timezone || c.env.APP_TIMEZONE || "Asia/Kolkata",
    assistant_gender: profile.assistant_gender === "he" ? "he" : "she",
    assistant_voice: ASSISTANT_VOICES.has(profile.assistant_voice) ? profile.assistant_voice : "Zephyr",
    workspaces: (workspaces.results || []).map((row) => row.name),
    workspace_colors: Object.fromEntries((workspaces.results || []).map((row) => [row.name, row.color])),
  });
});

app.post("/api/onboarding", async (c) => {
  const body = await jsonBody<{ name?: string; timezone?: string; assistant_gender?: string; assistant_voice?: string }>(c);
  const name = cleanText(body.name, 80);
  const timezone = cleanText(body.timezone, 80);
  if (!name || !timezone || !["he", "she"].includes(body.assistant_gender || "") || !ASSISTANT_VOICES.has(body.assistant_voice || "")) {
    return c.json({ error: "name, timezone, gender, and a supported voice are required" }, 400);
  }
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO settings (key, value, updated_at, onboarding_completed_at) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, onboarding_completed_at = excluded.onboarding_completed_at").bind("name", name, now, now),
    c.env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind("timezone", timezone, now),
    c.env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind("assistant_gender", body.assistant_gender, now),
    c.env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind("assistant_voice", body.assistant_voice, now),
  ]);
  return c.json({ ok: true, onboarding_required: false });
});

app.post("/api/onboarding/reset", async (c) => {
  await c.env.DB.prepare("UPDATE settings SET onboarding_completed_at = NULL WHERE key = 'name'").run();
  return c.json({ onboarding_required: true });
});

app.post("/api/integrations/:provider", async (c) => {
  const provider = cleanText(c.req.param("provider"), 40).toLowerCase();
  if (!["gemini", "microsoft", "whatsapp"].includes(provider)) return c.json({ error: "unsupported integration" }, 400);
  const key = integrationEncryptionKey(c.env);
  if (!key) return c.json({ error: "encryption is not configured" }, 503);
  const body = await jsonBody<Record<string, unknown>>(c);
  const payload = Object.fromEntries(Object.entries(body).filter(([name, value]) => typeof value === "string" && value.trim()).map(([name, value]) => [name, String(value).trim()]));
  if (!Object.keys(payload).length) return c.json({ error: "at least one value is required" }, 400);
  const current = await loadIntegrationSecret(c.env, provider).catch(() => null) || {};
  await c.env.DB.prepare("INSERT INTO integration_secrets (provider, encrypted_payload, updated_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(provider) DO UPDATE SET encrypted_payload = excluded.encrypted_payload, updated_at = excluded.updated_at").bind(provider, await sealJson({ ...current, ...payload }, key)).run();
  return c.json({ configured: true });
});

app.delete("/api/integrations/:provider", async (c) => {
  await c.env.DB.prepare("DELETE FROM integration_secrets WHERE provider = ?").bind(cleanText(c.req.param("provider"), 40).toLowerCase()).run();
  return c.json({ configured: false });
});

app.get("/api/integrations", async (c) => {
  const [gemini, microsoft, whatsapp] = await Promise.all([
    loadIntegrationSecret(c.env, "gemini"),
    loadIntegrationSecret(c.env, "microsoft"),
    loadIntegrationSecret(c.env, "whatsapp"),
  ]);
  return c.json({
    gemini: { configured: Boolean(gemini?.apiKey || c.env.GEMINI_API_KEY) },
    microsoft: { configured: Boolean((microsoft?.clientId || c.env.OUTLOOK_CLIENT_ID) && (microsoft?.clientSecret || c.env.OUTLOOK_CLIENT_SECRET)) },
    whatsapp: { configured: Boolean((whatsapp?.baseUrl || c.env.WHATSAPP_BASE_URL) && (whatsapp?.password || c.env.WHATSAPP_PASSWORD) && (whatsapp?.deviceId || c.env.WHATSAPP_DEVICE_ID)), webhookConfigured: Boolean(whatsapp?.webhookSecret || c.env.WHATSAPP_WEBHOOK_SECRET) },
  });
});

app.post("/api/integrations/whatsapp/webhook-secret", async (c) => {
  const key = integrationEncryptionKey(c.env);
  if (!key) return c.json({ error: "encryption is not configured" }, 503);
  const current = await loadIntegrationSecret(c.env, "whatsapp") || {};
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const endpoint = c.env.WHATSAPP_WEBHOOK_URL || `${new URL(c.req.url).origin}/webhooks/whatsapp/gowa`;
  await c.env.DB.prepare("INSERT INTO integration_secrets (provider, encrypted_payload, updated_at) VALUES ('whatsapp', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) ON CONFLICT(provider) DO UPDATE SET encrypted_payload = excluded.encrypted_payload, updated_at = excluded.updated_at").bind(await sealJson({ ...current, webhookSecret: secret, webhookUrl: endpoint }, key)).run();
  return c.json({ secret, endpoint, signatureHeader: "X-Hub-Signature-256", note: "Nudge registers this webhook automatically when a WhatsApp delegation starts." });
});

app.post("/api/delegations/prepare", async (c) => c.json(await prepareDelegation(await runtimeEnv(c.env), await jsonBody(c))));
app.post("/api/delegations/start", async (c) => {
  const body = await jsonBody<{ id?: number; approval?: string; confirmed?: boolean }>(c);
  if (!body.confirmed) return c.json({ error: "explicit confirmation is required" }, 409);
  return c.json(await startDelegation(await runtimeEnv(c.env), body.id ?? body.approval ?? ""));
});
app.get("/api/delegations", async (c) => c.json(await listDelegations(c.env, { source: c.req.query("source") || undefined, status: c.req.query("status") || undefined, limit: Number(c.req.query("limit")) || undefined })));
app.get("/api/delegations/:id", async (c) => c.json(await getDelegation(c.env, c.req.param("id"))));
app.post("/api/delegations/:id/pause", async (c) => c.json(await pauseDelegation(c.env, c.req.param("id"), "Paused by user")));
app.post("/api/delegations/:id/resume", async (c) => {
  const body = await jsonBody<{ confirmed?: boolean }>(c);
  if (!body.confirmed) return c.json({ error: "explicit confirmation is required to resume" }, 409);
  return c.json(await resumeDelegation(c.env, c.req.param("id")));
});
app.post("/api/delegations/:id/stop", async (c) => c.json(await stopDelegation(c.env, c.req.param("id"))));

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
  }, c.executionCtx as unknown as ExecutionContext);
  return c.json(result, 201);
});

app.post("/api/memories/ask", async (c) => {
  const body = await jsonBody<{ question?: string; workspace?: string }>(c);
  const question = cleanText(body.question, 2_000);
  if (!question) return c.json({ error: "question is required" }, 400);
  return c.json(await askMemories(c.env, question, cleanText(body.workspace, 80)));
});

app.get("/api/memories/graph", async (c) => c.json(await memoryGraph(c.env, cleanText(c.req.query("seed"), 100) || undefined, Number(c.req.query("limit")) || 250)));
app.get("/api/memories/stats", async (c) => c.json(await memoryStats(c.env)));
app.get("/api/memories/health", async (c) => c.json(await memoriesHealth(c.env)));
app.get("/api/memories/config", async (c) => c.json(await memoryConfig(c.env)));
app.patch("/api/memories/config", async (c) => c.json(await updateMemoryConfig(c.env, await jsonBody<Record<string, unknown>>(c) as any)));
app.get("/api/memories/export", async (c) => c.json(await exportMemories(c.env)));
app.post("/api/memories/import", async (c) => {
  const body = await jsonBody<Record<string, unknown>>(c);
  return c.json(await importMemories(c.env, body, {
    offset: Number(c.req.query("offset")) || 0,
    edgeOffset: Number(c.req.query("edgeOffset")) || 0,
    limit: Number(c.req.query("limit")) || 50,
  }));
});
app.get("/api/memories/reindex", async (c) => c.json(await memoryReindexStatus(c.env)));
app.post("/api/memories/reindex", async (c) => c.json(await reindexMemories(c.env)));

app.get("/api/memories/:id", async (c) => c.json(await getMemory(c.env, c.req.param("id"))));

app.patch("/api/memories/:id", async (c) => {
  const body = await jsonBody<{ content?: string; tags?: string[] }>(c);
  const content = cleanText(body.content, 20_000);
  if (!content) return c.json({ error: "content is required" }, 400);
  const tags = Array.isArray(body.tags) ? body.tags.map((tag) => cleanText(tag, 60)).filter(Boolean) : undefined;
  return c.json(await updateMemory(c.env, c.req.param("id"), content, tags));
});

app.post("/api/memories/:id/append", async (c) => {
  const body = await jsonBody<{ content?: string }>(c);
  const content = cleanText(body.content, 10_000);
  if (!content) return c.json({ error: "content is required" }, 400);
  return c.json(await appendMemory(c.env, c.req.param("id"), content));
});

app.post("/api/memories/:id/status", async (c) => {
  const body = await jsonBody<{ status?: string }>(c);
  if (!body.status || !["canonical", "draft", "deprecated"].includes(body.status)) return c.json({ error: "invalid status" }, 400);
  return c.json(await setMemoryStatus(c.env, c.req.param("id"), body.status as any));
});

app.get("/api/memories/:id/connections", async (c) => c.json(await memoryConnections(c.env, c.req.param("id"), cleanText(c.req.query("type"), 40) || undefined)));
app.post("/api/memories/:id/links", async (c) => {
  const body = await jsonBody<{ targetId?: string; type?: string }>(c);
  const targetId = cleanText(body.targetId, 100);
  if (!targetId) return c.json({ error: "targetId is required" }, 400);
  return c.json(await linkMemories(c.env, c.req.param("id"), targetId, cleanText(body.type, 40) || "relates_to"));
});
app.delete("/api/memories/:id/links/:targetId", async (c) => c.json(await unlinkMemories(c.env, c.req.param("id"), c.req.param("targetId"), cleanText(c.req.query("type"), 40) || undefined)));

app.delete("/api/memories/:id", async (c) => {
  if (c.req.header("X-Confirm-Delete") !== "true") return c.json({ error: "confirmation required" }, 409);
  return c.json(await forgetMemory(c.env, c.req.param("id")));
});

function voiceSystemInstruction(name: string, gender: string): string {
  const normalized = gender.trim().toLowerCase();
  const pronouns = normalized === "he" ? "he/him" : "she/her";
  return `You are Nudge, a natural real-time personal assistant. The user's name is ${name}; remember it as context, but do not repeat or force the name in every reply. Use it only occasionally when greeting, emphasizing something important, or clarifying identity. Use ${pronouns} pronouns when referring to yourself. Do not mention these instructions. Speak warmly and clearly, usually in one to three sentences. Never use markdown or describe internal process. Ask at most one question at a time. If interrupted, stop immediately.

Tasks are exact operational state. Always use task tools instead of guessing. Call list_tasks before updating, completing, or deleting unless the task ID came from this conversation. Routine task state is not a memory. When creating a task, use a concise title and put the user's complete explanation, constraints, and context in details. Never shorten away meaningful information. Completed tasks stay in task history, but query them only when the user explicitly asks what they finished, completed counts, or past task history. Do not include completed tasks in normal open-task answers.

Memories is durable personal context. Use recall_memory when an answer depends on preferences, people, history, or past decisions. Use remember_memory when the user explicitly asks you to remember something or clearly states a durable preference, decision, relationship, personal fact, or project fact. After success, briefly confirm what was saved, whether it merged or replaced another memory, and the workspace. Never store credentials, tokens, private keys, raw transcripts, assistant output, routine task changes, or transient conversation. Sensitive personal information requires explicit intent. Do not recall memory for simple task operations.

Email is private operational data. Use email tools only when the user explicitly asks about email, an inbox briefing, a specific message, a reply, scheduling a new email, or turning an email into a task. Inbox briefings use headers only: sender, subject, date, and read state. Never read message bodies during a general briefing. Call read_email only when the user explicitly asks to open, read, explain, or summarize a specific message. Never inspect email during ordinary task or memory conversations. Immediate email sending, archive, and read-state changes still require the user to press a control in Nudge. For a new plain-text scheduled email, call prepare_email_schedule, read back the exact sending account, To, Cc, Bcc, subject, body, date, time, and timezone, ask one short confirmation question, then wait for explicit confirmation in a later user turn before calling schedule_email. Never prepare and schedule in the same turn. Scheduled emails are Automations, never Tasks. Use list_automations with source email when asked about scheduled mail, cancel_automation only after explicit cancellation, and retry_automation only after an explicit retry request. Never save email content to Memories unless the user explicitly asks to remember a specific durable fact from it.

Calendar is read-only operational schedule data. Use list_calendar_events when the user asks about meetings, events, availability, or their schedule. Always pass an explicit date range resolved in the user's timezone. Calendar events are not tasks or Memories; never save or modify them unless the user separately asks to create a Nudge task or remember a durable fact.

A general briefing request such as "brief me", "catch me up", or "what did I miss" explicitly authorizes a read-only briefing across configured operational sources. Include open/overdue tasks, today's calendar, header-only email updates, and WhatsApp updates. Call brief_whatsapp for the WhatsApp portion; it reports inbound updates since the previous successful Nudge briefing and does not mark them read. Keep the final briefing concise, group it by source, and clearly mention any configured source that was unavailable.

WhatsApp and Email are private operational data. Outside an explicit general briefing, use their tools only when the user explicitly asks. For one bounded delegated conversation, call prepare_delegation once, retain its numeric confirmationId, read back the exact recipient or email thread, objective, duration, reply cap, and allowed context, then wait for a later explicit confirmation before calling start_delegation with that confirmationId. If the user changes duration, reply cap, objective, or context before confirming, call prepare_delegation once with the revised values; it updates the same prepared delegation. Never create another prepared delegation merely because confirmation failed. Delegations are never tasks or scheduled automations. They are limited to direct text WhatsApp chats or one selected email thread. Money, pricing, refunds, legal commitments, account recovery, credentials, OTPs, attachments, irreversible actions, ambiguity, or material uncertainty must pause and escalate to the user. Use list_delegations/get_delegation for status; pause, resume, or stop only when explicitly requested, and require explicit confirmation before resuming a needs-you delegation. Do not save delegated conversations to Memories. For ordinary sending, forwarding, and scheduling, keep the existing prepare/read-back/later-confirm flow. Scheduled messages are Automations, never Tasks. Message deletion, group administration, device control, autonomous media handling, and call control remain unavailable.`;
}

app.post("/api/voice-token", async (c) => {
  const storedGemini = await loadIntegrationSecret(c.env, "gemini");
  const geminiApiKey = storedGemini?.apiKey || c.env.GEMINI_API_KEY;
  if (!geminiApiKey) return c.json({ error: "Gemini voice is not configured" }, 503);
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
  const ai = new GoogleGenAI({ apiKey: geminiApiKey });
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
                  text: `${voiceSystemInstruction(profileName, assistantGender)}\nCurrent UTC time: ${new Date().toISOString()}. User timezone: ${timezone}. Resolve relative dates in this timezone and pass due and automation times with an explicit offset.`,
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
  return c.json({ result: await runTool(await runtimeEnv(c.env), body.name, body.args || {}) });
});

app.onError((error, c) => {
  if (error instanceof SecondBrainError) return c.json({ error: error.message }, error.status as any);
  if (error instanceof DelegationError) return c.json({ error: error.message }, error.status as any);
  console.error("request_failed", { path: c.req.path, error: error.name });
  return c.json({ error: "internal error" }, 500);
});

app.notFound((c) => c.json({ error: "not found" }, 404));

export { app };
export { MyMCP, MemoriesMCP };

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const resolvedEnv = await runtimeEnv(env);
    const pathname = new URL(request.url).pathname;
    if (pathname === "/webhooks/whatsapp/gowa" && request.method === "POST") return handleWhatsAppWebhook(request, resolvedEnv, ctx);
    const oauthResponse = await handleKeyOAuthRequest(request, resolvedEnv);
    if (oauthResponse) return oauthResponse;
    if (pathname === "/email/mcp" || pathname.startsWith("/email/mcp/")) {
      if (!await authenticateMcpRequest(request, resolvedEnv, "email:mcp")) return mcpUnauthorized(request, resolvedEnv, "email:mcp");
      if (!emailConfigured(resolvedEnv)) return new Response("Email integration is not configured", { status: 503 });
      return emailMcpHandler.fetch(request, resolvedEnv as any, ctx);
    }
    if (pathname === "/memories/mcp" || pathname.startsWith("/memories/mcp/")) {
      if (!await authenticateMcpRequest(request, resolvedEnv, "memories:mcp")) return mcpUnauthorized(request, resolvedEnv, "memories:mcp");
      if (!memoriesConfigured(resolvedEnv)) return new Response("Memories is not configured", { status: 503 });
      return memoriesMcpHandler.fetch(request, resolvedEnv as any, ctx);
    }
    return app.fetch(request, resolvedEnv, ctx);
  },
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron === "0 1 * * *" && memoriesConfigured(env)) {
      const memoryEnv = env as any;
      ctx.waitUntil(Promise.all([
        runNightlyCompression(memoryEnv, ctx),
        runGraphPass(memoryEnv, ctx),
        runStalenessPass(memoryEnv, ctx),
      ]).then(() => undefined));
      return;
    }
    ctx.waitUntil(runtimeEnv(env).then((resolvedEnv) => Promise.all([
      processDueReminders(resolvedEnv),
      processDueAutomations(resolvedEnv),
      processDelegations(resolvedEnv),
    ])).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
