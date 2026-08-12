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

export async function listWhatsAppChats(env: Env, options: { limit?: number; offset?: number; search?: string } = {}) {
  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(Number(options.limit) || 30, 1), 100)),
    offset: String(Math.max(Number(options.offset) || 0, 0)),
  });
  const search = clean(options.search, 200);
  if (search) params.set("search", search);
  const result = await request(env, `/chats?${params}`);
  const data = Array.isArray(result?.results?.data) ? result.results.data : [];
  return {
    chats: data.map((chat: any) => ({
      jid: clean(chat.jid, 240),
      name: clean(chat.name, 300) || clean(chat.jid, 240).split("@")[0],
      lastMessageAt: clean(chat.last_message_time, 80),
      archived: Boolean(chat.archived),
    })).filter((chat: any) => chat.jid),
    pagination: result?.results?.pagination || { limit: Number(params.get("limit")), offset: Number(params.get("offset")), total: data.length },
  };
}

function validJid(value: unknown): string {
  const jid = clean(value, 240);
  if (!/^[0-9A-Za-z._:-]+@(s\.whatsapp\.net|g\.us|broadcast)$/.test(jid)) throw new WhatsAppError("Invalid WhatsApp chat", 400);
  return jid;
}

export async function getWhatsAppMessages(env: Env, jidValue: unknown, options: { limit?: number; offset?: number } = {}) {
  const jid = validJid(jidValue);
  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(Number(options.limit) || 50, 1), 100)),
    offset: String(Math.max(Number(options.offset) || 0, 0)),
  });
  const result = await request(env, `/chat/${encodeURIComponent(jid)}/messages?${params}`);
  const data = Array.isArray(result?.results?.data) ? result.results.data : [];
  return {
    chat: result?.results?.chat_info ? {
      jid,
      name: clean(result.results.chat_info.name, 300) || jid.split("@")[0],
    } : { jid, name: jid.split("@")[0] },
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
