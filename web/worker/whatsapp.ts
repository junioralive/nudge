import type { Env } from "./types";

const encoder = new TextEncoder();
const APPROVAL_SECONDS = 10 * 60;

export class WhatsAppError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
    this.name = "WhatsAppError";
  }
}

export interface WhatsAppConfig {
  baseUrl: string;
  username: string;
  password: string;
  deviceId: string;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function whatsappConfig(env: Env): WhatsAppConfig | undefined {
  const baseUrl = clean(env.WHATSAPP_BASE_URL, 500).replace(/\/+$/, "");
  const username = clean(env.WHATSAPP_USERNAME, 160);
  const password = clean(env.WHATSAPP_PASSWORD, 500);
  const deviceId = clean(env.WHATSAPP_DEVICE_ID, 160);
  if (!baseUrl || !username || !password || !deviceId) return undefined;
  try {
    const parsed = new URL(baseUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || (parsed.pathname !== "" && parsed.pathname !== "/")) return undefined;
  } catch {
    return undefined;
  }
  return { baseUrl, username, password, deviceId };
}

export function whatsappConfigured(env: Env): boolean {
  return Boolean(whatsappConfig(env));
}

async function request(env: Env, path: string, init: RequestInit = {}): Promise<any> {
  const config = whatsappConfig(env);
  if (!config) throw new WhatsAppError("WhatsApp is not configured", 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${btoa(`${config.username}:${config.password}`)}`,
        "X-Device-Id": config.deviceId,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const body = await response.json().catch(() => null) as any;
    if (!response.ok) {
      const message = response.status === 401 || response.status === 403
        ? "WhatsApp service authentication failed"
        : response.status === 404 ? "WhatsApp resource was not found" : "WhatsApp service unavailable";
      throw new WhatsAppError(message, response.status >= 400 && response.status < 500 ? response.status : 502);
    }
    return body;
  } catch (error) {
    if (error instanceof WhatsAppError) throw error;
    throw new WhatsAppError(error instanceof DOMException && error.name === "AbortError" ? "WhatsApp service timed out" : "WhatsApp service unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export async function getWhatsAppStatus(env: Env) {
  const result = await request(env, "/app/status");
  const value = result?.results || result?.result || result;
  return { configured: true, connected: Boolean(value?.connected), loggedIn: Boolean(value?.logged_in), deviceId: clean(value?.device_id, 160) };
}

interface WhatsAppContact {
  jid: string;
  name: string;
}

function contactName(value: any): string {
  if (typeof value === "string") return clean(value, 300);
  if (!value || typeof value !== "object") return "";
  return clean(
    value.name || value.full_name || value.fullName || value.FullName ||
    value.push_name || value.pushName || value.PushName ||
    value.business_name || value.businessName || value.BusinessName,
    300,
  );
}

export async function listWhatsAppContacts(env: Env): Promise<WhatsAppContact[]> {
  try {
    const result = await request(env, "/user/my/contacts");
    const data = Array.isArray(result?.results?.data) ? result.results.data : [];
    return data.map((contact: any) => ({
      jid: clean(contact.jid, 240),
      name: contactName(contact),
    })).filter((contact: WhatsAppContact) => contact.jid && contact.name);
  } catch {
    // Contact enrichment is best effort. Chat access must keep working against
    // older GOWA releases that do not expose the contact endpoint.
    return [];
  }
}

function normalizedLookup(value: unknown): string {
  return clean(value, 500).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function lookupScore(name: string, jid: string, query: string): number {
  const normalizedName = normalizedLookup(name);
  const normalizedJid = normalizedLookup(jid.split("@")[0]);
  if (!query) return 0;
  if (normalizedName === query) return 0;
  if (normalizedName.startsWith(query)) return 1;
  if (normalizedName.split(" ").some((word) => word.startsWith(query))) return 2;
  if (normalizedName.includes(query)) return 3;
  if (normalizedJid.includes(query)) return 4;
  return Number.POSITIVE_INFINITY;
}

function resolvedContactName(jid: string, storedName: unknown, contacts: Map<string, string>): string {
  const saved = contacts.get(jid);
  if (saved) return saved;
  return contactName(storedName) || jid.split("@")[0];
}

export async function listWhatsAppChats(env: Env, options: { limit?: number; offset?: number; search?: string } = {}) {
  const requestedLimit = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
  const requestedOffset = Math.max(Number(options.offset) || 0, 0);
  const search = clean(options.search, 200);
  const params = new URLSearchParams({
    // When searching, fetch a full page and filter after contact enrichment so
    // saved address-book names can match chats whose stored name is a number.
    limit: String(search ? 100 : requestedLimit),
    offset: String(search ? 0 : requestedOffset),
  });
  const [result, contactRows] = await Promise.all([
    request(env, `/chats?${params}`),
    listWhatsAppContacts(env),
  ]);
  const data = Array.isArray(result?.results?.data) ? result.results.data : [];
  const contacts = new Map(contactRows.map((contact) => [contact.jid, contact.name]));
  const normalizedSearch = normalizedLookup(search);
  const chatRows = data.map((chat: any) => {
    const jid = clean(chat.jid, 240);
    return {
      jid,
      name: resolvedContactName(jid, chat.name, contacts),
      lastMessageAt: clean(chat.last_message_time, 80),
      archived: Boolean(chat.archived),
      contactOnly: false,
    };
  }).filter((chat: any) => chat.jid);
  const chatJids = new Set(chatRows.map((chat: any) => chat.jid));
  const contactMatches = normalizedSearch ? contactRows
    .filter((contact) => !chatJids.has(contact.jid) && Number.isFinite(lookupScore(contact.name, contact.jid, normalizedSearch)))
    .map((contact) => ({ jid: contact.jid, name: contact.name, lastMessageAt: "", archived: false, contactOnly: true })) : [];
  const chats = [...chatRows, ...contactMatches]
    .filter((chat: any) => !normalizedSearch || Number.isFinite(lookupScore(chat.name, chat.jid, normalizedSearch)))
    .sort((left: any, right: any) => normalizedSearch
      ? lookupScore(left.name, left.jid, normalizedSearch) - lookupScore(right.name, right.jid, normalizedSearch)
      : 0);
  return {
    chats: search ? chats.slice(requestedOffset, requestedOffset + requestedLimit) : chats,
    pagination: search
      ? { limit: requestedLimit, offset: requestedOffset, total: chats.length }
      : result?.results?.pagination || { limit: requestedLimit, offset: requestedOffset, total: chats.length },
  };
}

export async function resolveWhatsAppRecipient(env: Env, value: unknown) {
  const query = clean(value, 300);
  if (!query) return { match: null, candidates: [] as Array<{ jid: string; name: string }> };
  const result = await listWhatsAppChats(env, { search: query, limit: 25 });
  const candidates = result.chats.map(({ jid, name }) => ({ jid, name }));
  const normalized = normalizedLookup(query);
  const exact = candidates.filter((candidate) => normalizedLookup(candidate.name) === normalized || normalizedLookup(candidate.jid.split("@")[0]) === normalized);
  return { match: exact.length === 1 ? exact[0] : exact.length === 0 && candidates.length === 1 ? candidates[0] : null, candidates };
}

function validJid(value: unknown): string {
  const jid = clean(value, 240);
  if (!/^[0-9A-Za-z._:-]+@(s\.whatsapp\.net|lid|g\.us|broadcast)$/.test(jid)) throw new WhatsAppError("Invalid WhatsApp chat", 400);
  return jid;
}

export async function getWhatsAppMessages(env: Env, jidValue: unknown, options: { limit?: number; offset?: number } = {}) {
  const jid = validJid(jidValue);
  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(Number(options.limit) || 50, 1), 100)),
    offset: String(Math.max(Number(options.offset) || 0, 0)),
  });
  const [result, contactRows] = await Promise.all([
    request(env, `/chat/${encodeURIComponent(jid)}/messages?${params}`),
    listWhatsAppContacts(env),
  ]);
  const contacts = new Map(contactRows.map((contact) => [contact.jid, contact.name]));
  const data = Array.isArray(result?.results?.data) ? result.results.data : [];
  return {
    chat: result?.results?.chat_info ? {
      jid,
      name: resolvedContactName(jid, result.results.chat_info.name, contacts),
    } : { jid, name: resolvedContactName(jid, "", contacts) },
    messages: data.map((message: any) => ({
      id: clean(message.id, 300),
      sender: clean(message.sender_display_name, 300) || clean(message.sender_jid, 240).split("@")[0],
      content: clean(message.content, 20_000),
      timestamp: clean(message.timestamp, 80),
      fromMe: Boolean(message.is_from_me),
      mediaType: clean(message.media_type, 80) || null,
      filename: clean(message.filename, 500) || null,
    })),
    pagination: result?.results?.pagination || { limit: Number(params.get("limit")), offset: Number(params.get("offset")), total: data.length },
  };
}

export async function sendWhatsAppMessage(env: Env, args: { jid: unknown; message: unknown; replyMessageId?: unknown }) {
  const jid = validJid(args.jid);
  const message = clean(args.message, 10_000);
  if (!message) throw new WhatsAppError("Message is required", 400);
  const result = await request(env, "/send/message", {
    method: "POST",
    body: JSON.stringify({ phone: jid, message, ...(args.replyMessageId ? { reply_message_id: clean(args.replyMessageId, 300) } : {}) }),
  });
  return { sent: true, messageId: clean(result?.results?.message_id || result?.results?.id, 300) || null };
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signature(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function actionSecret(env: Env): string {
  if (!env.NUDGE_ACTION_SIGNING_SECRET) throw new WhatsAppError("WhatsApp actions are not configured", 503);
  return env.NUDGE_ACTION_SIGNING_SECRET;
}

export async function createWhatsAppApproval(env: Env, args: { jid: unknown; message: unknown; replyMessageId?: unknown }): Promise<string> {
  const payload = base64Url(encoder.encode(JSON.stringify({
    v: 1, kind: "whatsapp-send", jid: validJid(args.jid), message: clean(args.message, 10_000),
    replyMessageId: clean(args.replyMessageId, 300), nonce: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + APPROVAL_SECONDS,
  })));
  return `${payload}.${await signature(actionSecret(env), payload)}`;
}

export async function consumeWhatsAppApproval(env: Env, token: string) {
  const [encoded, supplied, extra] = token.split(".");
  if (!encoded || !supplied || extra) throw new WhatsAppError("Invalid WhatsApp approval", 400);
  const expected = await signature(actionSecret(env), encoded);
  if (expected.length !== supplied.length) throw new WhatsAppError("Invalid WhatsApp approval", 400);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  if (difference) throw new WhatsAppError("Invalid WhatsApp approval", 400);
  let payload: any;
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))));
  } catch { throw new WhatsAppError("Invalid WhatsApp approval", 400); }
  if (payload.kind !== "whatsapp-send" || payload.v !== 1 || !payload.nonce || Number(payload.exp) < Math.floor(Date.now() / 1000)) throw new WhatsAppError("WhatsApp approval expired", 409);
  try {
    await env.DB.prepare("INSERT INTO whatsapp_action_nonces (nonce, action) VALUES (?, 'send')").bind(String(payload.nonce)).run();
  } catch { throw new WhatsAppError("WhatsApp approval was already used", 409); }
  return { jid: validJid(payload.jid), message: clean(payload.message, 10_000), replyMessageId: clean(payload.replyMessageId, 300) || undefined };
}
