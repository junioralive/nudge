import { describe, expect, it } from "vitest";
import { delegationLimits, escalationReason, normalizeGowaWebhook, verifyWebhookSignature } from "./delegations";

async function signature(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `sha256=${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

describe("delegation safety", () => {
  it("enforces source-specific duration and reply limits", () => {
    expect(delegationLimits("whatsapp", 60, 20)).toMatchObject({ durationMinutes: 60, maxReplies: 20 });
    expect(() => delegationLimits("whatsapp", 61, 1)).toThrow("60 minutes");
    expect(delegationLimits("email", 10080, 10)).toMatchObject({ durationMinutes: 10080, maxReplies: 10 });
    expect(() => delegationLimits("email", 10081, 1)).toThrow("7 days");
  });

  it("normalizes direct text and ack webhook events", () => {
    expect(normalizeGowaWebhook({ event: "message", data: { id: "m1", chat_id: "9199@s.whatsapp.net", body: "hello", timestamp: 1_786_600_000 } })).toMatchObject({ kind: "message", id: "m1", jid: "9199@s.whatsapp.net", text: "hello" });
    expect(normalizeGowaWebhook({ event: "message.ack", data: { message_id: "m1", jid: "9199@s.whatsapp.net" } })).toMatchObject({ kind: "ack", id: "m1" });
    expect(normalizeGowaWebhook({ event: "other", data: {} })).toBeNull();
  });

  it("validates raw-body HMAC signatures", async () => {
    const body = JSON.stringify({ event: "message", data: { id: "1" } });
    expect(await verifyWebhookSignature("secret", body, await signature("secret", body))).toBe(true);
    expect(await verifyWebhookSignature("secret", `${body} `, await signature("secret", body))).toBe(false);
  });

  it.each([
    ["Can you refund ₹500?", "financial"], ["Send me the OTP", "Credentials"], ["Please sign this contract", "legal"], ["Delete it permanently", "irreversible"],
  ])("escalates consequential inbound content", (message, reason) => expect(escalationReason(message)).toContain(reason));
});
