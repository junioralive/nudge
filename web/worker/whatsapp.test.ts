import { describe, expect, it, vi } from "vitest";
import { consumeWhatsAppApproval, createWhatsAppApproval, whatsappConfig } from "./whatsapp";
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

  it("binds one-time approval to the exact message", async () => {
    const testEnv = env();
    const approval = await createWhatsAppApproval(testEnv, { jid: "919999999999@s.whatsapp.net", message: "Hello" });
    await expect(consumeWhatsAppApproval(testEnv, approval)).resolves.toMatchObject({ jid: "919999999999@s.whatsapp.net", message: "Hello" });
    await expect(consumeWhatsAppApproval(testEnv, approval)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects arbitrary JIDs", async () => {
    await expect(createWhatsAppApproval(env(), { jid: "../../send/message", message: "Hello" })).rejects.toMatchObject({ status: 400 });
  });
});
