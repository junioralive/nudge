/**
 * Read-only iCal calendar integration.
 * Parser adapted from rahilp/second-brain-cloudflare (MIT), pinned in
 * THIRD_PARTY_NOTICES.md. Calendar events remain operational data in Nudge.
 */
import ICAL from "ical.js";
import { openJson, sealJson } from "./email-core/crypto";
import { integrationEncryptionKey } from "./integrationSecrets";
import type { Env } from "./types";

const DAY_MS = 86_400_000;
const REFRESH_MS = 5 * 60_000;
const MAX_ICS_BYTES = 8 * 1024 * 1024;
const MAX_OCCURRENCES_PER_EVENT = 300;
const MAX_ITERATIONS = 100_000;
const MAX_DESCRIPTION_CHARS = 4_000;
const COLORS = new Set(["#E787FF", "#FFC66D", "#6FD69A", "#7FB2FF", "#FF9BC2", "#A99AF2"]);
export const CALENDAR_PROVIDERS = new Set(["google", "outlook", "icloud"]);

type Provider = "google" | "outlook" | "icloud";
type Occurrence = {
  key: string;
  uid: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  description: string;
  version: string;
};

type SourceRow = {
  id: number;
  provider: Provider;
  name: string;
  encrypted_url: string;
  color: string;
  enabled: number;
  last_synced_at: string | null;
  last_sync_error: string | null;
  created_at: string;
};

export type CalendarEvent = {
  source_id: number;
  id: string;
  uid: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string;
  description: string;
  calendar_name: string;
  color: string;
};

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "";
}

function allowedHost(provider: Provider, hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (provider === "google") return host === "calendar.google.com";
  if (provider === "outlook") return host === "outlook.live.com" || host.endsWith(".outlook.com") || host.endsWith(".office365.com");
  return host === "icloud.com" || host.endsWith(".icloud.com");
}

export function normalizeCalendarUrl(provider: Provider, raw: string): string {
  const swapped = raw.trim().replace(/^webcal:\/\//i, "https://");
  const url = new URL(swapped);
  if (url.protocol !== "https:") throw new Error("Calendar link must use https:// or webcal://");
  if (url.username || url.password || !allowedHost(provider, url.hostname)) throw new Error(`That is not a supported ${provider} calendar link`);
  url.hash = "";
  return url.toString();
}

async function fetchCalendar(provider: Provider, initialUrl: string): Promise<string> {
  let url = initialUrl;
  let response: Response | undefined;
  for (let redirects = 0; redirects < 4; redirects += 1) {
    response = await fetch(url, { headers: { Accept: "text/calendar" }, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location) throw new Error("Calendar provider returned an invalid redirect");
    url = normalizeCalendarUrl(provider, new URL(location, url).toString());
  }
  if (!response) throw new Error("Calendar provider did not respond");
  if (!response.ok) throw new Error(`Calendar provider returned HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_ICS_BYTES) throw new Error("Calendar feed is too large");
  const body = await response.text();
  if (body.length > MAX_ICS_BYTES) throw new Error("Calendar feed is too large");
  return body;
}

function version(event: any): string {
  const component = event.component;
  return String(component.getFirstPropertyValue("last-modified") || component.getFirstPropertyValue("dtstamp") || component.getFirstPropertyValue("sequence") || "0");
}

function cancelled(event: any): boolean {
  return String(event.component.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED";
}

function pushOccurrence(event: any, start: any, end: any, key: string, out: Occurrence[]) {
  if (!event.uid || cancelled(event)) return;
  const startMs = start.toJSDate().getTime();
  const endMs = (end || start).toJSDate().getTime();
  out.push({
    key,
    uid: event.uid,
    title: clean(event.summary, 300) || "(No title)",
    start: startMs,
    end: endMs,
    allDay: start.isDate === true,
    location: clean(event.location, 500),
    description: clean(event.description, MAX_DESCRIPTION_CHARS),
    version: `${version(event)}::${new Date(startMs).toISOString()}`,
  });
}

export function parseCalendar(ics: string, fromMs: number, toMs: number): { name: string; events: Occurrence[] } {
  const root = new ICAL.Component(ICAL.parse(ics));
  if (root.name !== "vcalendar") throw new Error("The link did not return an iCal calendar");
  for (const timezone of root.getAllSubcomponents("vtimezone")) {
    try {
      const zone = new ICAL.Timezone(timezone);
      if (zone.tzid && !ICAL.TimezoneService.has(zone.tzid)) ICAL.TimezoneService.register(timezone);
    } catch { /* Ignore one malformed embedded timezone. */ }
  }

  const groups = new Map<string, { master: any; exceptions: any[] }>();
  for (const component of root.getAllSubcomponents("vevent")) {
    const uid = component.getFirstPropertyValue("uid");
    if (typeof uid !== "string" || !uid) continue;
    const group = groups.get(uid) || { master: null, exceptions: [] };
    if (component.hasProperty("recurrence-id")) group.exceptions.push(component);
    else group.master = component;
    groups.set(uid, group);
  }

  const events: Occurrence[] = [];
  for (const group of groups.values()) {
    try {
      if (!group.master) {
        for (const exception of group.exceptions) {
          const event = new ICAL.Event(exception);
          const start = event.startDate.toJSDate().getTime();
          const end = (event.endDate || event.startDate).toJSDate().getTime();
          if (end >= fromMs && start <= toMs) pushOccurrence(event, event.startDate, event.endDate, event.uid, events);
        }
        continue;
      }
      const event = new ICAL.Event(group.master, { exceptions: group.exceptions });
      if (!event.isRecurring()) {
        const start = event.startDate.toJSDate().getTime();
        const end = (event.endDate || event.startDate).toJSDate().getTime();
        if (end >= fromMs && start <= toMs) pushOccurrence(event, event.startDate, event.endDate, event.uid, events);
        continue;
      }
      const iterator = event.iterator();
      let next: any;
      let iterations = 0;
      let emitted = 0;
      while ((next = iterator.next()) && ++iterations <= MAX_ITERATIONS) {
        const nominal = next.toJSDate().getTime();
        if (nominal > toMs + DAY_MS) break;
        if (nominal < fromMs - 2 * DAY_MS) continue;
        const detail = event.getOccurrenceDetails(next);
        const start = detail.startDate.toJSDate().getTime();
        const end = detail.endDate.toJSDate().getTime();
        if (cancelled(detail.item) || end < fromMs || start > toMs) continue;
        pushOccurrence(detail.item, detail.startDate, detail.endDate, `${event.uid}::${new Date(start).toISOString()}`, events);
        if (++emitted >= MAX_OCCURRENCES_PER_EVENT) break;
      }
    } catch { /* Skip one malformed event group without losing the feed. */ }
  }
  return { name: clean(root.getFirstPropertyValue("x-wr-calname"), 120), events };
}

async function decryptedUrl(env: Env, row: SourceRow): Promise<string> {
  const key = integrationEncryptionKey(env);
  if (!key) throw new Error("Nudge encryption is not configured");
  const payload = await openJson<{ url: string }>(row.encrypted_url, key);
  return normalizeCalendarUrl(row.provider, payload.url);
}

export async function listCalendarSources(env: Env) {
  const rows = await env.DB.prepare("SELECT id, provider, name, color, enabled, last_synced_at, last_sync_error, created_at FROM calendar_sources ORDER BY created_at").all<Omit<SourceRow, "encrypted_url">>();
  return (rows.results || []).map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
}

export async function addCalendarSource(env: Env, input: { provider: string; url: string; name?: string; color?: string }) {
  if (!CALENDAR_PROVIDERS.has(input.provider)) throw new Error("Unsupported calendar provider");
  const provider = input.provider as Provider;
  const url = normalizeCalendarUrl(provider, input.url);
  const key = integrationEncryptionKey(env);
  if (!key) throw new Error("Nudge encryption is not configured");
  const fetched = await fetchCalendar(provider, url);
  const parsed = parseCalendar(fetched, Date.now() - 7 * DAY_MS, Date.now() + 90 * DAY_MS);
  const name = clean(input.name, 120) || parsed.name || `${provider[0].toUpperCase()}${provider.slice(1)} Calendar`;
  const color = COLORS.has(input.color || "") ? input.color! : "#7FB2FF";
  const result = await env.DB.prepare("INSERT INTO calendar_sources (provider, name, encrypted_url, color) VALUES (?, ?, ?, ?)")
    .bind(provider, name, await sealJson({ url }, key), color).run();
  const id = Number(result.meta.last_row_id);
  await storeEvents(env, id, parsed.events, new Date().toISOString());
  return { id, provider, name, color, enabled: true, last_synced_at: new Date().toISOString(), last_sync_error: null };
}

async function storeEvents(env: Env, sourceId: number, events: Occurrence[], syncedAt: string) {
  await env.DB.prepare("DELETE FROM calendar_events WHERE source_id = ? AND starts_at >= ?")
    .bind(sourceId, new Date(Date.now() - 7 * DAY_MS).toISOString()).run();
  // Eight rows keep each statement below D1's 100-parameter limit and let a
  // 300-occurrence calendar sync stay below the free-plan query ceiling.
  for (let index = 0; index < events.length; index += 8) {
    const slice = events.slice(index, index + 8);
    const values = slice.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(",");
    const bindings = slice.flatMap((event) => [sourceId, event.key, event.uid, event.title, new Date(event.start).toISOString(), new Date(event.end).toISOString(), event.allDay ? 1 : 0, event.location, event.description, event.version, syncedAt]);
    await env.DB.prepare(`INSERT INTO calendar_events
      (source_id, event_key, uid, title, starts_at, ends_at, all_day, location, description, version, updated_at)
      VALUES ${values}
      ON CONFLICT(source_id, event_key) DO UPDATE SET uid=excluded.uid, title=excluded.title, starts_at=excluded.starts_at,
        ends_at=excluded.ends_at, all_day=excluded.all_day, location=excluded.location, description=excluded.description,
        version=excluded.version, updated_at=excluded.updated_at`).bind(...bindings).run();
  }
  await env.DB.prepare("UPDATE calendar_sources SET last_synced_at = ?, last_sync_error = NULL, updated_at = ? WHERE id = ?").bind(syncedAt, syncedAt, sourceId).run();
}

export async function syncCalendarSource(env: Env, sourceId: number) {
  const row = await env.DB.prepare("SELECT * FROM calendar_sources WHERE id = ? AND enabled = 1").bind(sourceId).first<SourceRow>();
  if (!row) throw new Error("Calendar source not found");
  try {
    const parsed = parseCalendar(await fetchCalendar(row.provider, await decryptedUrl(env, row)), Date.now() - 7 * DAY_MS, Date.now() + 90 * DAY_MS);
    const now = new Date().toISOString();
    await storeEvents(env, sourceId, parsed.events, now);
    return { ok: true, count: parsed.events.length, synced_at: now };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : "Calendar sync failed";
    await env.DB.prepare("UPDATE calendar_sources SET last_sync_error = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").bind(message, sourceId).run();
    throw new Error(message);
  }
}

async function refreshStaleSources(env: Env) {
  const stale = await env.DB.prepare("SELECT id FROM calendar_sources WHERE enabled = 1 AND (last_synced_at IS NULL OR last_synced_at < ?)")
    .bind(new Date(Date.now() - REFRESH_MS).toISOString()).all<{ id: number }>();
  // One source per request keeps a worst-case recurring feed below D1's
  // per-invocation query budget. Other stale sources refresh on the next view.
  const next = stale.results?.[0];
  if (next) await syncCalendarSource(env, next.id).catch(() => undefined);
}

export async function listCalendarEvents(env: Env, input: { from: string; to: string; refresh?: boolean }): Promise<CalendarEvent[]> {
  const from = new Date(input.from);
  const to = new Date(input.to);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new Error("A valid calendar date range is required");
  if (to.getTime() - from.getTime() > 370 * DAY_MS) throw new Error("Calendar range is too large");
  if (input.refresh !== false) await refreshStaleSources(env);
  const rows = await env.DB.prepare(`SELECT e.source_id, e.event_key AS id, e.uid, e.title, e.starts_at, e.ends_at, e.all_day,
    e.location, e.description, s.name AS calendar_name, s.color
    FROM calendar_events e JOIN calendar_sources s ON s.id = e.source_id
    WHERE s.enabled = 1 AND e.ends_at >= ? AND e.starts_at <= ? ORDER BY e.starts_at`)
    .bind(from.toISOString(), to.toISOString()).all<Omit<CalendarEvent, "all_day"> & { all_day: number }>();
  return (rows.results || []).map((row) => ({ ...row, all_day: Boolean(row.all_day) }));
}

export async function deleteCalendarSource(env: Env, sourceId: number) {
  const result = await env.DB.prepare("DELETE FROM calendar_sources WHERE id = ?").bind(sourceId).run();
  return Number(result.meta.changes || 0) > 0;
}
