import { describe, expect, it, vi } from "vitest";
import {
  consumeWhatsAppApproval, consumeWhatsAppForwardApproval, consumeWhatsAppScheduleApproval, createWhatsAppApproval,
  configureWhatsAppWebhook, createWhatsAppForwardApproval, createWhatsAppScheduleApproval, getWhatsAppBriefing, getWhatsAppMessages,
  listWhatsAppChats, updateWhatsAppChat, updateWhatsAppMessage,
  whatsappConfig,
} from "./whatsapp";
import { runTool } from "./tools";
import type { Env } from "./types";

function env(): Env {
  const used = new Set<string>();
  return {
    WHATSAPP_BASE_URL: "https://whatsapp.example.com",
    WHATSAPP_USERNAME: "nudge",
    WHATSAPP_PASSWORD: "private-password",
    WHATSAPP_DEVICE_ID: "device-1",
    NUDGE_ACTION_SIGNING_SECRET: "signing-secret-long-enough",
    DB: { prepare: vi.fn(() => ({ bind: (nonce: string) => ({ run: async () => { if (used.has(nonce)) throw new Error("unique"); used.add(nonce); } }) })) } as any,
  } as Env;
}

describe("WhatsApp adapter", () => {
  it("requires HTTPS configuration without embedded credentials", () => {
    expect(whatsappConfig(env())).toMatchObject({ baseUrl: "https://whatsapp.example.com", deviceId: "device-1" });
    expect(whatsappConfig({ ...env(), WHATSAPP_BASE_URL: "http://whatsapp.example.com" })).toBeUndefined();
    expect(whatsappConfig({ ...env(), WHATSAPP_BASE_URL: "https://user:pass@whatsapp.example.com" })).toBeUndefined();
  });

  it("registers the signed delegation webhook with GOWA", async () => {
    const requests: Array<{ url: string; method: string; body: any }> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      requests.push({ url: String(input), method: String(init?.method), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ results: {} }), { status: 200 });
    });
    await configureWhatsAppWebhook(env(), "https://nudge.example.com/webhooks/whatsapp/gowa", "a".repeat(32));
    expect(requests).toEqual([expect.objectContaining({
      url: "https://whatsapp.example.com/devices/device-1/webhook",
      method: "PATCH",
      body: expect.objectContaining({
        webhook_url: "https://nudge.example.com/webhooks/whatsapp/gowa",
        webhook_secret: "a".repeat(32),
        webhook_events: "message,message.ack",
      }),
    })]);
    fetchMock.mockRestore();
  });

  it("binds one-time approval to the exact message", async () => {
    const testEnv = env();
    const approval = await createWhatsAppApproval(testEnv, { jid: "919999999999@s.whatsapp.net", message: "Hello" });
    await expect(consumeWhatsAppApproval(testEnv, approval)).resolves.toMatchObject({ jid: "919999999999@s.whatsapp.net", message: "Hello" });
    await expect(consumeWhatsAppApproval(testEnv, approval)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects arbitrary JIDs", async () => {
    await expect(createWhatsAppApproval(env(), { jid: "../../send/message", message: "Hello" })).rejects.toMatchObject({ status: 400 });
  });

  it("uses saved contact names for chat rows and search", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/user/my/contacts")) {
        return new Response(JSON.stringify({ results: { data: [{ jid: "919999999999@s.whatsapp.net", name: "Mrs Junior" }] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: { data: [{ jid: "919999999999@s.whatsapp.net", name: "919999999999", last_message_time: "2026-08-12T10:00:00Z" }] } }), { status: 200 });
    });

    await expect(listWhatsAppChats(env(), { search: "Mrs Junior" })).resolves.toMatchObject({
      chats: [{ jid: "919999999999@s.whatsapp.net", name: "Mrs Junior" }],
      pagination: { total: 1 },
    });
    fetchMock.mockRestore();
  });

  it("keeps chat listing available when contact enrichment fails", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/user/my/contacts")) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ results: { data: [{ jid: "918888888888@s.whatsapp.net", name: "918888888888" }] } }), { status: 200 });
    });

    await expect(listWhatsAppChats(env())).resolves.toMatchObject({ chats: [{ name: "918888888888" }] });
    fetchMock.mockRestore();
  });

  it("finds a synced contact without a recent chat", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/user/my/contacts")) {
        return new Response(JSON.stringify({ results: { data: [{ jid: "919777777777@s.whatsapp.net", FullName: "Ayan Khan" }] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ results: { data: [] } }), { status: 200 });
    });

    await expect(listWhatsAppChats(env(), { search: "Ayan" })).resolves.toMatchObject({
      chats: [{ jid: "919777777777@s.whatsapp.net", name: "Ayan Khan", contactOnly: true }],
      pagination: { total: 1 },
    });
    fetchMock.mockRestore();
  });

  it("accepts synced Linked ID recipients", async () => {
    await expect(createWhatsAppApproval(env(), { jid: "123456789@lid", message: "Hello" })).resolves.toContain(".");
  });

  it("sends a prepared message after one explicit voice confirmation", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/user/my/contacts")) return new Response(JSON.stringify({ results: { data: [{ jid: "919777777777@s.whatsapp.net", name: "Ayan" }] } }), { status: 200 });
      if (url.includes("/chats?")) return new Response(JSON.stringify({ results: { data: [] } }), { status: 200 });
      if (url.endsWith("/send/message")) return new Response(JSON.stringify({ results: { message_id: "sent-1" } }), { status: 200 });
      return new Response("not found", { status: 404 });
    });
    const testEnv = env();
    const prepared = await runTool(testEnv, "prepare_whatsapp_message", { recipient: "Ayan", message: "Hello" });
    expect(prepared).toMatchObject({ ok: true, requires_confirmation: true, draft: { recipient: "Ayan", message: "Hello" } });
    const sent = await runTool(testEnv, "send_whatsapp_message", { approval: prepared.approval });
    expect(sent).toMatchObject({ ok: true, sent: true, messageId: "sent-1" });
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 45_000);
    timeoutSpy.mockRestore();
    fetchMock.mockRestore();
  });

  it("passes narrow message-search filters to GOWA", async () => {
    const requests: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/user/my/contacts")) return new Response(JSON.stringify({ results: { data: [] } }), { status: 200 });
      return new Response(JSON.stringify({ results: { data: [], chat_info: { name: "Ayan" } } }), { status: 200 });
    });
    await getWhatsAppMessages(env(), "919777777777@s.whatsapp.net", {
      search: "invoice", startTime: "2026-08-01T00:00:00Z", endTime: "2026-08-12T00:00:00Z", fromMe: false, mediaOnly: true,
    });
    expect(requests.some((url) => url.includes("search=invoice") && url.includes("is_from_me=false") && url.includes("media_only=true"))).toBe(true);
    fetchMock.mockRestore();
  });

  it("briefs new inbound WhatsApp updates without marking messages read", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    const requests: string[] = [];
    let savedCheckpoint = "";
    const testEnv = {
      ...env(),
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: (...values: string[]) => ({
            first: async () => sql.startsWith("SELECT") ? { value: "2026-08-13T10:00:00Z" } : null,
            run: async () => { savedCheckpoint = values[1] || ""; },
          }),
        })),
      } as any,
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/user/my/contacts")) return new Response(JSON.stringify({ results: { data: [{ jid: "919777777777@s.whatsapp.net", name: "Ayan" }] } }), { status: 200 });
      if (url.includes("/chats?")) return new Response(JSON.stringify({ results: { data: [{ jid: "919777777777@s.whatsapp.net", name: "Ayan", last_message_time: "2026-08-13T11:30:00Z" }] } }), { status: 200 });
      if (url.includes("/messages?")) return new Response(JSON.stringify({ results: {
        chat_info: { name: "Ayan" },
        data: [
          { id: "incoming-1", sender_display_name: "Ayan", content: "Can we talk?", timestamp: "2026-08-13T11:30:00Z", is_from_me: false },
          { id: "outgoing-1", sender_display_name: "Junior", content: "Later", timestamp: "2026-08-13T11:35:00Z", is_from_me: true },
        ],
      } }), { status: 200 });
      return new Response("not found", { status: 404 });
    });

    await expect(getWhatsAppBriefing(testEnv)).resolves.toMatchObject({
      ok: true,
      tracking: "since_last_nudge_briefing",
      messageCount: 1,
      chats: [{ name: "Ayan", messages: [{ content: "Can we talk?" }] }],
      note: "This does not mark WhatsApp messages as read.",
    });
    expect(savedCheckpoint).toBe("2026-08-13T12:00:00.000Z");
    expect(requests.some((url) => url.includes("is_from_me=false"))).toBe(true);
    expect(requests.some((url) => url.includes("mark-read") || url.includes("mark_read"))).toBe(false);
    fetchMock.mockRestore();
    vi.useRealTimers();
  });

  it("maps reversible message and chat actions to GOWA endpoints", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      requests.push({ url: String(input), body: String(init?.body || "") });
      return new Response(JSON.stringify({ results: {} }), { status: 200 });
    });
    await updateWhatsAppMessage(env(), { action: "react", jid: "919777777777@s.whatsapp.net", messageId: "MSG-1", emoji: "👍" });
    await updateWhatsAppMessage(env(), { action: "star", jid: "919777777777@s.whatsapp.net", messageId: "MSG-1" });
    await updateWhatsAppChat(env(), { action: "pin", jid: "919777777777@s.whatsapp.net" });
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ url: expect.stringContaining("/message/MSG-1/reaction"), body: expect.stringContaining("👍") }),
      expect.objectContaining({ url: expect.stringContaining("/message/MSG-1/star") }),
      expect.objectContaining({ url: expect.stringContaining("/chat/919777777777%40s.whatsapp.net/pin"), body: '{"pinned":true}' }),
    ]));
    fetchMock.mockRestore();
  });

  it("requires one-time confirmation before forwarding", async () => {
    const testEnv = env();
    const approval = await createWhatsAppForwardApproval(testEnv, { jid: "919999999999@s.whatsapp.net", messageId: "MSG-2", recipient: "Mrs Junior" });
    await expect(consumeWhatsAppForwardApproval(testEnv, approval)).resolves.toMatchObject({ jid: "919999999999@s.whatsapp.net", messageId: "MSG-2" });
    await expect(consumeWhatsAppForwardApproval(testEnv, approval)).rejects.toMatchObject({ status: 409 });
  });

  it("requires one-time confirmation for a future WhatsApp automation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    const testEnv = env();
    const approval = await createWhatsAppScheduleApproval(testEnv, {
      jid: "919999999999@s.whatsapp.net",
      recipient: "Ayan",
      message: "Happy birthday",
      scheduledAt: "2026-08-13T22:00:00+05:30",
    });
    await expect(consumeWhatsAppScheduleApproval(testEnv, approval)).resolves.toMatchObject({
      recipient: "Ayan",
      message: "Happy birthday",
      scheduledAt: "2026-08-13T16:30:00.000Z",
    });
    await expect(consumeWhatsAppScheduleApproval(testEnv, approval)).rejects.toMatchObject({ status: 409 });
    vi.useRealTimers();
  });

});
