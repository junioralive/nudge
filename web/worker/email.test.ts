import { describe, expect, it, vi } from "vitest";
import {
  callEmailTool,
  consumeEmailApproval,
  createEmailApproval,
  createEmailReference,
  emailConfigured,
  EmailMcpError,
  readEmailReference,
  safeEmailList,
  safeEmailMessage,
} from "./email";
import type { Env } from "./types";

function testEnv() {
  const nonces = new Set<string>();
  const run = vi.fn(async (nonce: string) => {
    if (nonces.has(nonce)) throw new Error("unique");
    nonces.add(nonce);
    return { success: true };
  });
  return {
    NUDGE_ACTION_SIGNING_SECRET: "a-session-secret-long-enough-for-tests",
    DB: {
      prepare: vi.fn(() => ({ bind: (nonce: string) => ({ run: () => run(nonce) }) })),
    },
  } as unknown as Env;
}

describe("email privacy and action tokens", () => {
  it("treats a valid empty email store as configured and healthy", async () => {
    const env = {
      EMAIL_KV: { get: vi.fn(async () => null) },
      CREDENTIAL_ENCRYPTION_KEY: btoa("12345678901234567890123456789012"),
    } as unknown as Env;
    expect(emailConfigured(env)).toBe(true);
    await expect(callEmailTool(env, "email_list_accounts")).resolves.toEqual({ accounts: [] });
  });

  it("rejects malformed email encryption keys at the capability gate", () => {
    const env = { EMAIL_KV: { get: vi.fn() }, CREDENTIAL_ENCRYPTION_KEY: "not-a-key" } as unknown as Env;
    expect(emailConfigured(env)).toBe(false);
  });

  it("creates opaque message references and rejects tampering", async () => {
    const env = testEnv();
    const token = await createEmailReference(env, { accountId: "M1", folder: "INBOX", uid: 42, messageId: "message@example" });
    expect(token).not.toContain("INBOX");
    await expect(readEmailReference(env, token)).resolves.toEqual({ accountId: "M1", folder: "INBOX", uid: 42, messageId: "message@example" });
    await expect(readEmailReference(env, `${token}x`)).rejects.toBeInstanceOf(EmailMcpError);
  });

  it("binds approvals to one exact action and consumes them once", async () => {
    const env = testEnv();
    const approval = await createEmailApproval(env, "archive", { accountId: "M1", folder: "INBOX", uid: 42 });
    await expect(consumeEmailApproval(env, approval, "archive")).resolves.toMatchObject({ uid: 42 });
    await expect(consumeEmailApproval(env, approval, "archive")).rejects.toMatchObject({ status: 409 });
    await expect(consumeEmailApproval(testEnv(), approval, "mark-read")).rejects.toMatchObject({ status: 400 });
  });

  it("keeps body content and action approvals out of header-only model results", async () => {
    const env = testEnv();
    const result = await safeEmailList(env, {
      count: 1,
      total: 1,
      succeeded: 1,
      failed: 0,
      messages: [{
        accountId: "M1", accountName: "Work", accountEmail: "owner@example.com", folder: "INBOX", uid: 7,
        subject: "Quarterly plan", from: "Sam <sam@example.com>", to: "owner@example.com", date: "2026-08-09T10:00:00Z",
        flags: [], text: "This must never appear in a header result",
      }],
    }, true);
    expect(result.messages[0]).not.toHaveProperty("approvals");
    expect(JSON.stringify(result)).not.toContain("must never appear");
  });

  it("returns plain text only when a message is explicitly read", () => {
    const message = safeEmailMessage({ subject: "Hello", html: "<p>Hello <strong>Junior</strong></p><img src='https://tracker'>" });
    expect(message.text).toContain("Hello  Junior");
    expect(message).not.toHaveProperty("html");
    expect(JSON.stringify(message)).not.toContain("tracker");
  });
});
