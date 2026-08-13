import type { Env } from "./types";
import { openJson, sealJson } from "./email-core/crypto";
import { integrationEncryptionKey } from "./integrationSecrets";
import { callEmailTool, safeEmailAccounts } from "./email";
import { sendWhatsAppMessage, WhatsAppError, whatsappConfigured } from "./whatsapp";

export type AutomationType = "whatsapp_message" | "email_message";
export type AutomationSource = "whatsapp" | "email";

export interface WhatsAppAutomationPayload {
  jid: string;
  message: string;
  recipient: string;
}

export interface EmailAutomationPayload {
  accountId: string;
  accountName: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  draft?: { folder: string; uid: number; messageId?: string };
}

type AutomationPayload = WhatsAppAutomationPayload | EmailAutomationPayload;

export class AutomationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "AutomationError";
  }
}

function encryptionKey(env: Env): string {
  const key = integrationEncryptionKey(env);
  if (!key) throw new AutomationError("Nudge encryption is not configured", 503);
  return key;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function recipients(value: unknown, required = false): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[;,]/) : [];
  const result = items.map((item) => clean(item, 320)).filter(Boolean).slice(0, 50);
  if (required && !result.length) throw new AutomationError("At least one recipient is required");
  return result;
}

export function futureIso(value: unknown): string {
  const raw = clean(value, 100);
  if (!raw || !/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) throw new AutomationError("Scheduled time must include an explicit timezone");
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new AutomationError("Scheduled time is invalid");
  if (date.getTime() <= Date.now()) throw new AutomationError("Scheduled time must be in the future");
  return date.toISOString();
}

export async function resolveEmailSchedule(env: Env, input: Record<string, unknown>): Promise<EmailAutomationPayload & { scheduledAt: string }> {
  const accounts = safeEmailAccounts(await callEmailTool(env, "email_list_accounts")).filter((account) => account.canSend);
  let accountId = clean(input.accountId, 160);
  if (!accountId && accounts.length === 1) accountId = accounts[0].id;
  if (!accountId && accounts.length > 1) throw new AutomationError("Choose which sending account to use");
  if (!accountId) throw new AutomationError("No send-capable email account is connected");
  const account = accounts.find((item) => item.id === accountId);
  if (!account) throw new AutomationError("The selected email account cannot send mail");
  const subject = clean(input.subject, 1_000);
  const body = clean(input.body ?? input.text, 50_000);
  if (!subject) throw new AutomationError("Email subject is required");
  if (!body) throw new AutomationError("Email body is required");
  return {
    accountId,
    accountName: account.name || account.email,
    to: recipients(input.to, true),
    cc: recipients(input.cc),
    bcc: recipients(input.bcc),
    subject,
    body,
    scheduledAt: futureIso(input.scheduledAt ?? input.scheduled_at),
  };
}

export async function createAutomation(env: Env, type: AutomationType, payload: AutomationPayload, scheduledAt: unknown) {
  const due = futureIso(scheduledAt);
  const result = await env.DB.prepare(
    "INSERT INTO communication_automations (type, payload_encrypted, scheduled_at) VALUES (?, ?, ?)",
  ).bind(type, await sealJson(payload, encryptionKey(env)), due).run();
  return { scheduled: true, id: Number(result.meta.last_row_id), type, scheduledAt: due };
}

function typeForSource(source?: string): AutomationType | undefined {
  if (source === "whatsapp") return "whatsapp_message";
  if (source === "email") return "email_message";
  return undefined;
}

export async function listAutomations(env: Env, options: { source?: string; status?: string; from?: string; to?: string; limit?: number } = {}) {
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  const type = typeForSource(options.source);
  if (type) { clauses.push("type = ?"); bindings.push(type); }
  if (options.status) { clauses.push("status = ?"); bindings.push(clean(options.status, 40)); }
  if (options.from) { clauses.push("scheduled_at >= ?"); bindings.push(new Date(options.from).toISOString()); }
  if (options.to) { clauses.push("scheduled_at <= ?"); bindings.push(new Date(options.to).toISOString()); }
  const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
  bindings.push(limit);
  const rows = await env.DB.prepare(
    `SELECT id, type, payload_encrypted, scheduled_at, status, attempts, sent_at, last_error, created_at
     FROM communication_automations ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
     ORDER BY CASE WHEN status IN ('pending', 'sending') THEN 0 ELSE 1 END,
       CASE WHEN status IN ('pending', 'sending') THEN scheduled_at END ASC, scheduled_at DESC LIMIT ?`,
  ).bind(...bindings).all<any>();
  const key = encryptionKey(env);
  const automations = await Promise.all((rows.results || []).map(async (row) => {
    const payload = await openJson<AutomationPayload>(row.payload_encrypted, key);
    const base = { id: row.id, type: row.type, source: row.type === "email_message" ? "email" : "whatsapp", scheduledAt: row.scheduled_at, status: row.status, attempts: row.attempts, sentAt: row.sent_at, error: row.last_error, createdAt: row.created_at };
    return row.type === "email_message"
      ? { ...base, accountId: (payload as EmailAutomationPayload).accountId, accountName: (payload as EmailAutomationPayload).accountName, recipients: (payload as EmailAutomationPayload).to, subject: (payload as EmailAutomationPayload).subject, preview: (payload as EmailAutomationPayload).body.slice(0, 240) }
      : { ...base, recipient: (payload as WhatsAppAutomationPayload).recipient || (payload as WhatsAppAutomationPayload).jid.split("@")[0], preview: (payload as WhatsAppAutomationPayload).message.slice(0, 240), message: (payload as WhatsAppAutomationPayload).message };
  }));
  return { automations };
}

export async function cancelAutomation(env: Env, idValue: unknown, source?: string) {
  const id = Number(idValue);
  if (!Number.isInteger(id) || id <= 0) throw new AutomationError("Invalid automation");
  const type = typeForSource(source);
  const result = await env.DB.prepare(
    `UPDATE communication_automations SET status = 'cancelled', claimed_at = NULL, next_retry_at = NULL
     WHERE id = ? AND status IN ('pending', 'failed') ${type ? "AND type = ?" : ""}`,
  ).bind(...(type ? [id, type] : [id])).run();
  if (!result.meta.changes) throw new AutomationError("Automation could not be cancelled", 409);
  return { cancelled: true, id };
}

export async function retryAutomation(env: Env, idValue: unknown, source?: string) {
  const id = Number(idValue);
  if (!Number.isInteger(id) || id <= 0) throw new AutomationError("Invalid automation");
  const type = typeForSource(source);
  const result = await env.DB.prepare(
    `UPDATE communication_automations SET status = 'pending', claimed_at = NULL, next_retry_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_error = NULL
     WHERE id = ? AND status IN ('failed', 'delivery-unknown') ${type ? "AND type = ?" : ""}`,
  ).bind(...(type ? [id, type] : [id])).run();
  if (!result.meta.changes) throw new AutomationError("Automation is not available for retry", 409);
  return { retried: true, id };
}

function retryDelay(attempt: number) { return [60, 300, 900, 3600][Math.min(Math.max(attempt - 1, 0), 3)]; }

async function deliverEmail(env: Env, id: number, encrypted: string, payload: EmailAutomationPayload) {
  if (!payload.draft) {
    const draft = await callEmailTool(env, "email_create_message_draft", {
      accountId: payload.accountId, to: payload.to, ...(payload.cc.length ? { cc: payload.cc } : {}), ...(payload.bcc.length ? { bcc: payload.bcc } : {}), subject: payload.subject, text: payload.body,
    });
    payload.draft = { folder: String(draft.folder), uid: Number(draft.uid), messageId: draft.messageId ? String(draft.messageId) : undefined };
    encrypted = await sealJson(payload, encryptionKey(env));
    await env.DB.prepare("UPDATE communication_automations SET payload_encrypted = ? WHERE id = ?").bind(encrypted, id).run();
  }
  try {
    const result = await callEmailTool(env, "email_send_draft", { accountId: payload.accountId, folder: payload.draft.folder, uid: payload.draft.uid });
    if (!Array.isArray(result.accepted) || !result.accepted.length) throw new AutomationError("Mailbox rejected every recipient", 422);
    return { externalId: result.messageId || payload.draft.messageId || null };
  } catch (error) {
    if (error instanceof AutomationError) throw error;
    const uncertain = new AutomationError("Email delivery outcome is unknown; check Sent before retrying", 520) as AutomationError & { deliveryUnknown?: boolean };
    uncertain.deliveryUnknown = true;
    throw uncertain;
  }
}

export async function processDueAutomations(env: Env): Promise<{ claimed: number; sent: number; failed: number; unknown: number }> {
  const due = await env.DB.prepare(
    `SELECT id, type, payload_encrypted, attempts FROM communication_automations
     WHERE (status = 'pending' AND scheduled_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AND (next_retry_at IS NULL OR next_retry_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
       OR (status = 'sending' AND claimed_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'))
     ORDER BY scheduled_at LIMIT 10`,
  ).all<any>();
  const key = encryptionKey(env);
  let claimed = 0, sent = 0, failed = 0, unknown = 0;
  for (const row of due.results || []) {
    const claim = await env.DB.prepare(
      `UPDATE communication_automations SET status = 'sending', claimed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND (status = 'pending' OR (status = 'sending' AND claimed_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')))`,
    ).bind(row.id).run();
    if (!claim.meta.changes) continue;
    claimed += 1;
    const attempt = Number(row.attempts || 0) + 1;
    try {
      const payload = await openJson<AutomationPayload>(row.payload_encrypted, key);
      let externalId: string | null = null;
      if (row.type === "whatsapp_message") {
        if (!whatsappConfigured(env)) throw new WhatsAppError("WhatsApp is not configured", 503);
        externalId = (await sendWhatsAppMessage(env, payload as WhatsAppAutomationPayload)).messageId;
      } else {
        externalId = (await deliverEmail(env, row.id, row.payload_encrypted, payload as EmailAutomationPayload)).externalId;
      }
      await env.DB.prepare(`UPDATE communication_automations SET status = 'sent', attempts = ?, sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), external_id = ?, claimed_at = NULL, next_retry_at = NULL, last_error = NULL WHERE id = ?`).bind(attempt, externalId, row.id).run();
      sent += 1;
      console.log("automation_delivery", { automationId: row.id, type: row.type, status: "sent", attempt });
    } catch (error) {
      const deliveryUnknown = Boolean((error as any)?.deliveryUnknown);
      const terminal = deliveryUnknown || attempt >= 5;
      const status = deliveryUnknown ? "delivery-unknown" : terminal ? "failed" : "pending";
      const message = error instanceof Error ? error.message : "Delivery failed";
      await env.DB.prepare(`UPDATE communication_automations SET status = ?, attempts = ?, claimed_at = NULL, next_retry_at = CASE WHEN ? THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || ? || ' seconds') END, last_error = ? WHERE id = ?`).bind(status, attempt, terminal ? 1 : 0, retryDelay(attempt), message, row.id).run();
      deliveryUnknown ? unknown += 1 : failed += 1;
      console.log("automation_delivery", { automationId: row.id, type: row.type, status, attempt });
    }
  }
  return { claimed, sent, failed, unknown };
}
