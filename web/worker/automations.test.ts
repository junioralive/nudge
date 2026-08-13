import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callEmailTool: vi.fn(),
  sendWhatsAppMessage: vi.fn(),
}));

vi.mock("./email", () => ({
  callEmailTool: mocks.callEmailTool,
  safeEmailAccounts: (result: any) => (result.accounts || []).map((account: any) => ({
    id: account.id,
    name: account.name,
    email: account.email,
    canSend: Boolean(account.capabilities?.canSend),
  })),
}));

vi.mock("./whatsapp", () => ({
  sendWhatsAppMessage: mocks.sendWhatsAppMessage,
  whatsappConfigured: () => true,
  WhatsAppError: class WhatsAppError extends Error {},
}));

import { createAutomation, futureIso, processDueAutomations, resolveEmailSchedule } from "./automations";
import type { Env } from "./types";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

function automationEnv() {
  const state: { row?: any; updates: Array<{ sql: string; values: any[] }> } = { updates: [] };
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: (...values: any[]) => ({
        run: async () => {
          state.updates.push({ sql, values });
          if (sql.startsWith("INSERT INTO communication_automations")) {
            state.row = { id: 7, type: values[0], payload_encrypted: values[1], scheduled_at: values[2], status: "pending", attempts: 0 };
            return { meta: { last_row_id: 7, changes: 1 } };
          }
          if (sql.includes("SET payload_encrypted")) state.row.payload_encrypted = values[0];
          return { meta: { changes: 1 } };
        },
      }),
      all: async () => ({ results: state.row ? [state.row] : [] }),
    })),
  };
  return { env: { DB: db, NUDGE_ENCRYPTION_KEY: KEY } as unknown as Env, state };
}

describe("communication automations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-13T12:00:00Z"));
    mocks.callEmailTool.mockReset();
    mocks.sendWhatsAppMessage.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it("requires an explicit timezone and future time", () => {
    expect(() => futureIso("2026-08-14T10:00:00")).toThrow("explicit timezone");
    expect(() => futureIso("2026-08-12T10:00:00Z")).toThrow("future");
    expect(futureIso("2026-08-14T10:00:00+05:30")).toBe("2026-08-14T04:30:00.000Z");
  });

  it("selects the only send-capable account and preserves every approved field", async () => {
    mocks.callEmailTool.mockResolvedValueOnce({ accounts: [{ id: "mail-1", name: "Work", email: "me@example.com", capabilities: { canSend: true } }] });
    const { env, state } = automationEnv();
    const payload = await resolveEmailSchedule(env, {
      to: ["to@example.com"], cc: ["cc@example.com"], bcc: ["bcc@example.com"],
      subject: "Exact subject", body: "Exact body", scheduled_at: "2026-08-14T10:00:00+05:30",
    });
    const { scheduledAt, ...approved } = payload;
    await createAutomation(env, "email_message", approved, scheduledAt);
    expect(state.row.payload_encrypted).not.toContain("Exact subject");
    expect(payload).toMatchObject({ accountId: "mail-1", to: ["to@example.com"], cc: ["cc@example.com"], bcc: ["bcc@example.com"], subject: "Exact subject", body: "Exact body" });
  });

  it("creates a mailbox draft and sends the exact scheduled email once", async () => {
    const { env, state } = automationEnv();
    await createAutomation(env, "email_message", {
      accountId: "mail-1", accountName: "Work", to: ["to@example.com"], cc: [], bcc: [], subject: "Approved", body: "Unchanged",
    }, "2026-08-14T10:00:00Z");
    vi.setSystemTime(new Date("2026-08-14T10:01:00Z"));
    mocks.callEmailTool
      .mockResolvedValueOnce({ folder: "Drafts", uid: 42, messageId: "draft-42" })
      .mockResolvedValueOnce({ accepted: ["to@example.com"], messageId: "sent-42" });
    await expect(processDueAutomations(env)).resolves.toEqual({ claimed: 1, sent: 1, failed: 0, unknown: 0 });
    expect(mocks.callEmailTool).toHaveBeenNthCalledWith(1, env, "email_create_message_draft", expect.objectContaining({ subject: "Approved", text: "Unchanged" }));
    expect(mocks.callEmailTool).toHaveBeenNthCalledWith(2, env, "email_send_draft", { accountId: "mail-1", folder: "Drafts", uid: 42 });
    expect(state.updates.some(({ sql, values }) => sql.includes("status = 'sent'") && values.includes("sent-42"))).toBe(true);
  });

  it("marks an uncertain SMTP result delivery-unknown instead of retrying", async () => {
    const { env, state } = automationEnv();
    await createAutomation(env, "email_message", {
      accountId: "mail-1", accountName: "Work", to: ["to@example.com"], cc: [], bcc: [], subject: "Approved", body: "Unchanged",
    }, "2026-08-14T10:00:00Z");
    vi.setSystemTime(new Date("2026-08-14T10:01:00Z"));
    mocks.callEmailTool.mockResolvedValueOnce({ folder: "Drafts", uid: 42 }).mockRejectedValueOnce(new Error("connection closed"));
    await expect(processDueAutomations(env)).resolves.toEqual({ claimed: 1, sent: 0, failed: 0, unknown: 1 });
    expect(state.updates.some(({ sql, values }) => sql.includes("SET status = ?") && values[0] === "delivery-unknown" && values[2] === 1)).toBe(true);
  });
});
