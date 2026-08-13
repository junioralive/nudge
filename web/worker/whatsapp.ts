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

async function request(env: Env, path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<any> {
  const config = whatsappConfig(env);
  if (!config) throw new WhatsAppError("WhatsApp is not configured", 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    // GOWA normally mirrors failures through HTTP status codes, but some
    // deployments/proxies return a 2xx response with an error envelope. Do not
    // let callers record those operations as successfully delivered.
    const applicationStatus = Number(body?.status);
    const applicationCode = clean(body?.code, 100).toUpperCase();
    if ((Number.isFinite(applicationStatus) && applicationStatus >= 400) || (applicationCode && applicationCode !== "SUCCESS")) {
      throw new WhatsAppError("WhatsApp service rejected the request", applicationStatus >= 400 && applicationStatus < 500 ? applicationStatus : 502);
    }
    return body;
  } catch (error) {
    if (error instanceof WhatsAppError) throw error;
    throw new WhatsAppError(error instanceof DOMException && error.name === "AbortError" ? "WhatsApp service timed out" : "WhatsApp service unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export async function configureWhatsAppWebhook(env: Env, webhookUrl: string, webhookSecret: string) {
  const config = whatsappConfig(env);
  if (!config) throw new WhatsAppError("WhatsApp is not configured", 503);
  const url = clean(webhookUrl, 1_000);
  const secret = clean(webhookSecret, 500);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("invalid");
  } catch {
    throw new WhatsAppError("WhatsApp webhook URL is invalid", 400);
  }
  if (secret.length < 32) throw new WhatsAppError("WhatsApp webhook secret is invalid", 400);
  await request(env, `/devices/${encodeURIComponent(config.deviceId)}/webhook`, {
    method: "PATCH",
    body: JSON.stringify({
      webhook_url: url,
      webhook_secret: secret,
      webhook_events: "message,message.ack",
      webhook_insecure_skip_verify: false,
    }),
  });
  return { configured: true, webhookUrl: url };
}

export async function getWhatsAppStatus(env: Env) {
  const result = await request(env, "/app/status");
  const value = result?.results || result?.result || result;
  return {
    configured: true,
    connected: Boolean(value?.is_connected ?? value?.connected),
    loggedIn: Boolean(value?.is_logged_in ?? value?.logged_in),
    deviceId: clean(value?.device_id, 160),
  };
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

export async function searchWhatsAppContacts(env: Env, queryValue: unknown, limitValue = 25) {
  const query = normalizedLookup(queryValue);
  const limit = Math.min(Math.max(Number(limitValue) || 25, 1), 100);
  const contacts = await listWhatsAppContacts(env);
  return contacts
    .filter((contact) => !query || Number.isFinite(lookupScore(contact.name, contact.jid, query)))
    .sort((left, right) => query ? lookupScore(left.name, left.jid, query) - lookupScore(right.name, right.jid, query) : left.name.localeCompare(right.name))
    .slice(0, limit);
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

const WHATSAPP_BRIEFING_SETTING = "whatsapp_briefed_through";

function validBriefingCheckpoint(value: unknown, now: number): string | null {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed > now || parsed < now - 7 * 24 * 60 * 60 * 1_000) return null;
  return new Date(parsed).toISOString();
}

/**
 * GOWA does not expose WhatsApp's device unread counter. A Nudge briefing
 * therefore reports new inbound messages since the previous successful Nudge
 * briefing. It never calls the mark-read endpoint or changes WhatsApp state.
 */
export async function getWhatsAppBriefing(env: Env, options: { chatLimit?: number; messagesPerChat?: number } = {}) {
  const now = Date.now();
  const through = new Date(now).toISOString();
  const stored = await env.DB.prepare("SELECT value FROM settings WHERE key = ?")
    .bind(WHATSAPP_BRIEFING_SETTING).first<{ value: string }>();
  const since = validBriefingCheckpoint(stored?.value, now) || new Date(now - 24 * 60 * 60 * 1_000).toISOString();
  const chatLimit = Math.min(Math.max(Number(options.chatLimit) || 8, 1), 12);
  const messagesPerChat = Math.min(Math.max(Number(options.messagesPerChat) || 5, 1), 10);
  const listed = await listWhatsAppChats(env, { limit: Math.max(chatLimit * 2, 16) });
  const candidates = listed.chats
    .filter((chat: any) => !chat.contactOnly && (!chat.lastMessageAt || Date.parse(chat.lastMessageAt) >= Date.parse(since)))
    .slice(0, chatLimit);

  const results = await Promise.allSettled(candidates.map(async (chat: any) => {
    const result = await getWhatsAppMessages(env, chat.jid, {
      limit: messagesPerChat,
      startTime: since,
      endTime: through,
      fromMe: false,
    });
    const messages = result.messages
      .filter((message: any) => !message.fromMe && Date.parse(message.timestamp) > Date.parse(since) && Date.parse(message.timestamp) <= now)
      .map((message: any) => ({
        id: message.id,
        sender: message.sender,
        content: message.content,
        timestamp: message.timestamp,
        mediaType: message.mediaType,
      }));
    return messages.length ? { jid: chat.jid, name: result.chat.name || chat.name, messages } : null;
  }));

  const failedChats = results.filter((result) => result.status === "rejected").length;
  const chats = results.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []);
  const messageCount = chats.reduce((total, chat) => total + chat.messages.length, 0);
  if (failedChats === 0) {
    await env.DB.prepare(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ).bind(WHATSAPP_BRIEFING_SETTING, through, through).run();
  }
  return {
    ok: failedChats === 0,
    tracking: "since_last_nudge_briefing",
    since,
    through,
    messageCount,
    chats,
    partial: failedChats > 0,
    failedChats,
    note: "This does not mark WhatsApp messages as read.",
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

export async function getWhatsAppMessages(env: Env, jidValue: unknown, options: {
  limit?: number; offset?: number; search?: string; startTime?: string; endTime?: string;
  mediaOnly?: boolean; fromMe?: boolean;
} = {}) {
  const jid = validJid(jidValue);
  const params = new URLSearchParams({
    limit: String(Math.min(Math.max(Number(options.limit) || 50, 1), 100)),
    offset: String(Math.max(Number(options.offset) || 0, 0)),
  });
  if (clean(options.search, 500)) params.set("search", clean(options.search, 500));
  if (clean(options.startTime, 80)) params.set("start_time", clean(options.startTime, 80));
  if (clean(options.endTime, 80)) params.set("end_time", clean(options.endTime, 80));
  if (options.mediaOnly !== undefined) params.set("media_only", String(Boolean(options.mediaOnly)));
  if (options.fromMe !== undefined) params.set("is_from_me", String(Boolean(options.fromMe)));
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
      starred: Boolean(message.is_starred),
    })),
    pagination: result?.results?.pagination || { limit: Number(params.get("limit")), offset: Number(params.get("offset")), total: data.length },
  };
}

export async function listWhatsAppGroups(env: Env) {
  const result = await request(env, "/user/my/groups");
  const data = Array.isArray(result?.results?.data) ? result.results.data : Array.isArray(result?.results) ? result.results : [];
  return data.map((group: any) => ({
    jid: clean(group.jid || group.JID || group.id || group.group_id, 240),
    name: clean(group.name || group.Name || group.subject || group.group_name, 300),
    topic: clean(group.topic || group.Topic || group.description, 2_000) || null,
    participantCount: Number(group.participant_count || group.ParticipantCount || group.participants?.length || group.Participants?.length) || 0,
  })).filter((group: any) => group.jid);
}

export async function getWhatsAppGroup(env: Env, groupIdValue: unknown) {
  const groupId = validJid(groupIdValue);
  if (!groupId.endsWith("@g.us")) throw new WhatsAppError("Invalid WhatsApp group", 400);
  const result = await request(env, `/group/info?${new URLSearchParams({ group_id: groupId })}`);
  const value = result?.results || result;
  return {
    jid: groupId,
    name: clean(value?.name || value?.Name || value?.subject, 300),
    topic: clean(value?.topic || value?.Topic || value?.description, 2_000) || null,
    participants: (Array.isArray(value?.participants) ? value.participants : Array.isArray(value?.Participants) ? value.Participants : []).map((participant: any) => ({
      jid: clean(participant.phone_number || participant.PhoneNumber || participant.jid || participant.JID || participant.id, 240),
      name: contactName(participant),
      admin: Boolean(participant.admin || participant.is_admin || participant.isAdmin || participant.IsAdmin || participant.IsSuperAdmin),
    })).filter((participant: any) => participant.jid),
  };
}

function validMessageId(value: unknown): string {
  const id = clean(value, 300);
  if (!id || !/^[0-9A-Za-z._:-]+$/.test(id)) throw new WhatsAppError("Invalid WhatsApp message", 400);
  return id;
}

export async function updateWhatsAppMessage(env: Env, args: {
  action: "react" | "mark_read" | "star" | "unstar"; jid: unknown; messageId: unknown; emoji?: unknown;
}) {
  const jid = validJid(args.jid);
  const messageId = validMessageId(args.messageId);
  const endpoint = args.action === "react" ? "reaction" : args.action === "mark_read" ? "read" : args.action;
  const body = { phone: jid, ...(args.action === "react" ? { emoji: clean(args.emoji, 32) } : {}) };
  await request(env, `/message/${encodeURIComponent(messageId)}/${endpoint}`, { method: "POST", body: JSON.stringify(body) });
  return { ok: true, action: args.action, jid, messageId };
}

export async function updateWhatsAppChat(env: Env, args: { action: "archive" | "unarchive" | "pin" | "unpin"; jid: unknown }) {
  const jid = validJid(args.jid);
  const archive = args.action === "archive" || args.action === "unarchive";
  await request(env, `/chat/${encodeURIComponent(jid)}/${archive ? "archive" : "pin"}`, {
    method: "POST",
    body: JSON.stringify(archive ? { archived: args.action === "archive" } : { pinned: args.action === "pin" }),
  });
  return { ok: true, action: args.action, jid };
}

export async function forwardWhatsAppMessage(env: Env, args: { jid: unknown; messageId: unknown }) {
  const jid = validJid(args.jid);
  const messageId = validMessageId(args.messageId);
  const result = await request(env, `/message/${encodeURIComponent(messageId)}/forward`, {
    method: "POST", body: JSON.stringify({ phone: jid }),
  });
  return { sent: true, messageId: clean(result?.results?.message_id || result?.results?.id, 300) || null };
}

export async function sendWhatsAppMessage(env: Env, args: { jid: unknown; message: unknown; replyMessageId?: unknown }) {
  const jid = validJid(args.jid);
  const message = clean(args.message, 10_000);
  if (!message) throw new WhatsAppError("Message is required", 400);
  const result = await request(env, "/send/message", {
    method: "POST",
    body: JSON.stringify({ phone: jid, message, ...(args.replyMessageId ? { reply_message_id: clean(args.replyMessageId, 300) } : {}) }),
  }, 45_000);
  const messageId = clean(result?.results?.message_id || result?.results?.messageId || result?.results?.id, 300);
  if (!messageId) throw new WhatsAppError("WhatsApp did not confirm message delivery");
  return { sent: true, messageId };
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

export async function createWhatsAppForwardApproval(env: Env, args: { jid: unknown; messageId: unknown; recipient?: unknown }): Promise<string> {
  const payload = base64Url(encoder.encode(JSON.stringify({
    v: 1, kind: "whatsapp-forward", jid: validJid(args.jid), messageId: validMessageId(args.messageId),
    recipient: clean(args.recipient, 300), nonce: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + APPROVAL_SECONDS,
  })));
  return `${payload}.${await signature(actionSecret(env), payload)}`;
}

function scheduledAt(value: unknown): string {
  const date = new Date(clean(value, 100));
  if (Number.isNaN(date.getTime())) throw new WhatsAppError("Scheduled time must be a valid ISO 8601 datetime with timezone", 400);
  if (date.getTime() <= Date.now()) throw new WhatsAppError("Scheduled time must be in the future", 400);
  return date.toISOString();
}

export async function createWhatsAppScheduleApproval(env: Env, args: {
  jid: unknown; message: unknown; recipient?: unknown; scheduledAt: unknown;
}): Promise<string> {
  const message = clean(args.message, 10_000);
  if (!message) throw new WhatsAppError("Message is required", 400);
  const payload = base64Url(encoder.encode(JSON.stringify({
    v: 1,
    kind: "whatsapp-schedule",
    jid: validJid(args.jid),
    message,
    recipient: clean(args.recipient, 300),
    scheduledAt: scheduledAt(args.scheduledAt),
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + APPROVAL_SECONDS,
  })));
  return `${payload}.${await signature(actionSecret(env), payload)}`;
}

async function verifiedApproval(env: Env, token: string, kind: string): Promise<any> {
  const [encoded, supplied, extra] = token.split(".");
  if (!encoded || !supplied || extra) throw new WhatsAppError("Invalid WhatsApp approval", 400);
  const expected = await signature(actionSecret(env), encoded);
  if (expected.length !== supplied.length) throw new WhatsAppError("Invalid WhatsApp approval", 400);
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
  if (difference) throw new WhatsAppError("Invalid WhatsApp approval", 400);
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))));
    if (payload.kind !== kind || payload.v !== 1 || !payload.nonce || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
      throw new Error("expired");
    }
    return payload;
  } catch {
    throw new WhatsAppError("WhatsApp approval expired", 409);
  }
}

export async function consumeWhatsAppScheduleApproval(env: Env, token: string) {
  const payload = await verifiedApproval(env, token, "whatsapp-schedule");
  try {
    await env.DB.prepare("INSERT INTO whatsapp_action_nonces (nonce, action) VALUES (?, 'schedule')").bind(String(payload.nonce)).run();
  } catch { throw new WhatsAppError("WhatsApp approval was already used", 409); }
  return {
    jid: validJid(payload.jid),
    message: clean(payload.message, 10_000),
    recipient: clean(payload.recipient, 300),
    scheduledAt: scheduledAt(payload.scheduledAt),
  };
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

export async function consumeWhatsAppForwardApproval(env: Env, token: string) {
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
  if (payload.kind !== "whatsapp-forward" || payload.v !== 1 || !payload.nonce || Number(payload.exp) < Math.floor(Date.now() / 1000)) throw new WhatsAppError("WhatsApp approval expired", 409);
  try {
    await env.DB.prepare("INSERT INTO whatsapp_action_nonces (nonce, action) VALUES (?, 'forward')").bind(String(payload.nonce)).run();
  } catch { throw new WhatsAppError("WhatsApp approval was already used", 409); }
  return { jid: validJid(payload.jid), messageId: validMessageId(payload.messageId), recipient: clean(payload.recipient, 300) };
}
