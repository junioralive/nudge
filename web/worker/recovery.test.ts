import { describe, expect, it } from "vitest";
import { accessRecoveryIsFresh, buildRecoveryPayload, recoveryDownloadResponse } from "./recovery";

describe("recovery export", () => {
  it("requires a recently issued Access identity", () => {
    expect(accessRecoveryIsFresh({ kind: "access", source: "access", sub: "1", email: "owner@example.com", iat: 950 }, 1000)).toBe(true);
    expect(accessRecoveryIsFresh({ kind: "access", source: "access", sub: "1", email: "owner@example.com", iat: 600 }, 1000)).toBe(false);
    expect(accessRecoveryIsFresh({ kind: "key", source: "cookie", sub: "1", email: "owner" }, 1000)).toBe(false);
  });

  it("includes configured deployment and encrypted integration secrets without empty values", () => {
    const payload = buildRecoveryPayload({
      DB: {} as D1Database,
      AUTH_MODE: "key",
      NUDGE_AUTH_KEY: "a-long-private-key",
      NUDGE_ENCRYPTION_KEY: "encryption-key",
      NUDGE_ACTION_SIGNING_SECRET: "signing-key",
      VAPID_PUBLIC_KEY: "public",
      VAPID_PRIVATE_KEY: "private",
      VAPID_SUBJECT: "https://example.com",
    }, "https://nudge.example.com", "key", { gemini: { apiKey: "gemini" } }, "2026-08-10T12:00:00.000Z");

    expect(payload.secrets).toMatchObject({ NUDGE_AUTH_KEY: "a-long-private-key", GEMINI_API_KEY: "gemini" });
    expect(payload.secrets).not.toHaveProperty("OUTLOOK_CLIENT_SECRET");
    expect(payload.excluded).toContain("memories");
  });

  it("returns a no-store attachment", async () => {
    const payload = buildRecoveryPayload({ DB: {} as D1Database, VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "s" }, "https://nudge.example.com", "key", {}, "2026-08-10T12:00:00.000Z");
    const response = recoveryDownloadResponse(payload);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Disposition")).toContain("nudge-recovery-2026-08-10.json");
    expect(((await response.json()) as { format: string }).format).toBe("nudge-recovery");
  });
});
