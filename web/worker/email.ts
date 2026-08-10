import type { Env } from "./types";
import { isValidEncryptionKey } from "./email-core/crypto";
import { AccountStore, EmailStoreError } from "./email-core/mail/account-store";
import { MailService } from "./email-core/mail/mail-service";

export class EmailMcpError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
    this.name = "EmailMcpError";
  }
}

export interface EmailReference {
  accountId: string;
  folder: string;
  uid: number;
  messageId?: string;
}

type ApprovalAction = "mark-read" | "mark-unread" | "archive" | "send-draft";

const encoder = new TextEncoder();
const MESSAGE_REFERENCE_SECONDS = 60 * 60;
const APPROVAL_SECONDS = 10 * 60;

export function emailConfigured(env: Env): boolean {
  return Boolean(env.EMAIL_KV && isValidEncryptionKey(env.NUDGE_ENCRYPTION_KEY || env.CREDENTIAL_ENCRYPTION_KEY));
}

export function emailEncryptionKey(env: Env): string {
  const key = env.NUDGE_ENCRYPTION_KEY || env.CREDENTIAL_ENCRYPTION_KEY;
  if (!isValidEncryptionKey(key)) throw new EmailMcpError("Email encryption is not configured", 503);
  return key!;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return encodeBase64Url(new Uint8Array(signature));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return encodeBase64Url(new Uint8Array(digest));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function signedToken(secret: string, payload: Record<string, unknown>): Promise<string> {
  const encoded = encodeBase64Url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${await hmac(secret, encoded)}`;
}

async function verifiedToken(secret: string, token: string): Promise<Record<string, any>> {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) throw new EmailMcpError("Invalid email action", 400);
  const expected = await hmac(secret, encoded);
  if (expected.length !== signature.length) throw new EmailMcpError("Invalid email action", 400);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  if (difference !== 0) throw new EmailMcpError("Invalid email action", 400);
  try {
    const value = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded)));
    if (!value.exp || Number(value.exp) < Math.floor(Date.now() / 1000)) throw new EmailMcpError("Email action expired", 409);
    return value;
  } catch (error) {
    if (error instanceof EmailMcpError) throw error;
    throw new EmailMcpError("Invalid email action", 400);
  }
}

function cleanReference(input: Record<string, any>): EmailReference {
  const accountId = String(input.accountId || "").trim().slice(0, 160);
  const folder = String(input.folder || "INBOX").trim().slice(0, 500);
  const uid = Number(input.uid);
  const messageId = input.messageId ? String(input.messageId).trim().slice(0, 1_000) : undefined;
  if (!accountId || !folder || !Number.isInteger(uid) || uid <= 0) throw new EmailMcpError("Invalid email reference", 400);
  return { accountId, folder, uid, ...(messageId ? { messageId } : {}) };
}

export async function createEmailReference(env: Env, input: Record<string, any>): Promise<string> {
  const ref = cleanReference(input);
  return signedToken(actionSecret(env), {
    v: 1,
    kind: "email-message",
    ...ref,
    exp: Math.floor(Date.now() / 1000) + MESSAGE_REFERENCE_SECONDS,
  });
}

export async function readEmailReference(env: Env, token: string): Promise<EmailReference> {
  const payload = await verifiedToken(actionSecret(env), token);
  if (payload.kind !== "email-message" || payload.v !== 1) throw new EmailMcpError("Invalid email reference", 400);
  return cleanReference(payload);
}

export async function createEmailApproval(env: Env, action: ApprovalAction, args: Record<string, unknown>): Promise<string> {
  return signedToken(actionSecret(env), {
    v: 1,
    kind: "email-approval",
    action,
    args,
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + APPROVAL_SECONDS,
  });
}

export async function consumeEmailApproval(env: Env, token: string, action: ApprovalAction): Promise<Record<string, any>> {
  const payload = await verifiedToken(actionSecret(env), token);
  if (payload.kind !== "email-approval" || payload.v !== 1 || payload.action !== action || !payload.nonce || !payload.args) {
    throw new EmailMcpError("Invalid email approval", 400);
  }
  try {
    await env.DB.prepare("INSERT INTO email_action_nonces (nonce, action) VALUES (?, ?)").bind(String(payload.nonce), action).run();
  } catch {
    throw new EmailMcpError("Email action was already used", 409);
  }
  return payload.args;
}

export async function callEmailTool(env: Env, name: string, args: Record<string, unknown> = {}): Promise<any> {
  if (!emailConfigured(env)) throw new EmailMcpError("Email integration is not configured", 503);
  const store = new AccountStore(env.EMAIL_KV!, emailEncryptionKey(env));
  const mail = new MailService(store, { clientId: env.OUTLOOK_CLIENT_ID, clientSecret: env.OUTLOOK_CLIENT_SECRET });
  switch (name) {
    case "email_list_accounts": {
      const accounts = await store.list();
      return { accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        email: account.email,
        capabilities: { imap: true, smtp: Boolean(account.smtp), canSend: Boolean(account.smtp) },
      })) };
    }
    case "email_search_all_accounts": return mail.searchAll(args as any);
    case "email_list_all_inbox_messages": return mail.listAllInboxes(args as any);
    case "email_get_message": return mail.getMessage(args.accountId as string | undefined, String(args.folder || "INBOX"), Number(args.uid));
    case "email_update_message_flags": return mail.mark(args.accountId as string | undefined, String(args.folder || "INBOX"), args.uid as number | number[], { seen: args.seen as boolean | undefined, flagged: args.flagged as boolean | undefined });
    case "email_archive_messages": return mail.archive(args.accountId as string | undefined, String(args.folder || "INBOX"), args.uid as number | number[]);
    case "email_create_message_draft": return mail.createDraft(args as any);
    case "email_send_draft": return mail.sendDraft(args.accountId as string | undefined, String(args.folder), Number(args.uid));
    default: throw new EmailMcpError(`Email tool is not available to Nudge: ${name}`, 403);
  }
}

function actionSecret(env: Env): string {
  if (!env.NUDGE_ACTION_SIGNING_SECRET) throw new EmailMcpError("Email actions are not configured", 503);
  return env.NUDGE_ACTION_SIGNING_SECRET;
}

function stringValue(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function flags(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).slice(0, 30) : [];
}

function plainTextFromHtml(value: string): string {
  return value
    .replace(/<(script|style|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export async function safeEmailSummary(env: Env, message: Record<string, any>, forModel = false) {
  const ref = cleanReference(message);
  const messageRef = await createEmailReference(env, ref);
  const messageFlags = flags(message.flags);
  const seen = messageFlags.some((flag) => flag.toLowerCase() === "\\seen");
  return {
    ref: messageRef,
    accountId: ref.accountId,
    accountName: stringValue(message.accountName, 160),
    accountEmail: stringValue(message.accountEmail, 320),
    subject: stringValue(message.subject, 1_000) || "(no subject)",
    from: stringValue(message.from, 1_000),
    to: stringValue(message.to, 1_000),
    date: stringValue(message.date, 100),
    seen,
    flagged: messageFlags.some((flag) => flag.toLowerCase() === "\\flagged"),
    ...(!forModel ? { approvals: {
      markRead: await createEmailApproval(env, "mark-read", { accountId: ref.accountId, folder: ref.folder, uid: ref.uid, seen: true }),
      markUnread: await createEmailApproval(env, "mark-unread", { accountId: ref.accountId, folder: ref.folder, uid: ref.uid, seen: false }),
      archive: await createEmailApproval(env, "archive", { accountId: ref.accountId, folder: ref.folder, uid: ref.uid }),
    } } : {}),
  };
}

export async function safeEmailList(env: Env, result: Record<string, any>, forModel = false) {
  return {
    count: Number(result.count) || 0,
    total: Number(result.total) || 0,
    succeeded: Number(result.succeeded) || 0,
    failed: Number(result.failed) || 0,
    accounts: Array.isArray(result.accounts) ? result.accounts.map((account: Record<string, any>) => ({
      accountId: stringValue(account.accountId, 160),
      accountName: stringValue(account.accountName, 160),
      accountEmail: stringValue(account.accountEmail, 320),
      ok: Boolean(account.ok),
      count: Number(account.count) || 0,
      total: Number(account.total) || 0,
      nextCursor: stringValue(account.nextCursor, 2_000) || undefined,
      error: account.error ? "Mailbox unavailable" : undefined,
    })) : [],
    messages: await Promise.all((Array.isArray(result.messages) ? result.messages : []).map((message: Record<string, any>) => safeEmailSummary(env, message, forModel))),
  };
}

export function safeEmailAccounts(result: Record<string, any>) {
  return (Array.isArray(result.accounts) ? result.accounts : []).map((account: Record<string, any>) => ({
    id: stringValue(account.id, 160),
    name: stringValue(account.name, 160),
    email: stringValue(account.email, 320),
    canSend: Boolean(account.capabilities?.canSend),
  }));
}

export function safeEmailMessage(result: Record<string, any>, forModel = false) {
  const rawText = stringValue(result.text, forModel ? 12_000 : 100_000) || plainTextFromHtml(stringValue(result.html, forModel ? 30_000 : 250_000)).slice(0, forModel ? 12_000 : 100_000);
  return {
    subject: stringValue(result.subject, 1_000) || "(no subject)",
    from: stringValue(result.from, 1_000),
    to: stringValue(result.to, 1_000),
    cc: stringValue(result.cc, 1_000),
    date: stringValue(result.date, 100),
    text: rawText,
    truncated: rawText.length >= (forModel ? 12_000 : 100_000),
  };
}

export function safeEmailError(error: unknown): string {
  if (error instanceof EmailMcpError) return error.message;
  if (error instanceof EmailStoreError) {
    return error.code === "invalid_key" ? "Email encryption is not configured correctly" : "Email storage unavailable";
  }
  return "Email service unavailable";
}

export function emailErrorCategory(error: unknown): string {
  if (error instanceof EmailStoreError) return error.code;
  if (error instanceof EmailMcpError) return "email_request";
  return "unknown";
}
