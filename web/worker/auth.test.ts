import { describe, expect, it } from "vitest";
import {
  authenticateRequest,
  constantTimeKeyMatches,
  createKeySession,
  expectedAccessAudience,
  keySessionCookie,
  resolveAuthMode,
  verifyAccessRequest,
} from "./auth";

const keyEnv = {
  AUTH_MODE: "key",
  NUDGE_AUTH_KEY: "correct-horse-battery-staple",
  NUDGE_ENCRYPTION_KEY: "test-encryption-key",
} as any;

describe("dual authentication", () => {
  it("supports the explicit localhost development bypass", async () => {
    const identity = await verifyAccessRequest(new Request("http://localhost/api/auth/session"), {
      ACCESS_LOCAL_DEV: "true",
      NUDGE_OWNER_EMAIL: "owner@example.com",
    } as any);
    expect(identity).toMatchObject({ kind: "local", email: "owner@example.com" });
  });

  it("fails closed when the Access assertion is missing", async () => {
    await expect(verifyAccessRequest(new Request("https://nudge.example.com/api/tasks"), {
      TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      NUDGE_ACCESS_AUD: "nudge-audience",
      NUDGE_OWNER_EMAIL: "owner@example.com",
    } as any)).resolves.toBeNull();
  });

  it("keeps Access precedence in auto mode even when a key exists", () => {
    expect(resolveAuthMode({
      ...keyEnv,
      AUTH_MODE: "auto",
      TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      NUDGE_ACCESS_AUD: "audience",
      NUDGE_OWNER_EMAIL: "owner@example.com",
    })).toBe("access");
  });

  it("selects Key in auto mode only when Access is incomplete", () => {
    expect(resolveAuthMode({ ...keyEnv, AUTH_MODE: "auto" })).toBe("key");
    expect(resolveAuthMode({ ...keyEnv, AUTH_MODE: "access" })).toBeNull();
  });

  it("requires a 15-character key", () => {
    expect(resolveAuthMode({ AUTH_MODE: "key", NUDGE_AUTH_KEY: "too-short", NUDGE_ENCRYPTION_KEY: "secret" } as any)).toBeNull();
  });

  it("compares keys without comparing their raw values", async () => {
    await expect(constantTimeKeyMatches("same-value", "same-value")).resolves.toBe(true);
    await expect(constantTimeKeyMatches("wrong-value", "same-value")).resolves.toBe(false);
  });

  it("accepts a signed cookie and invalidates it after key rotation", async () => {
    const session = await createKeySession(keyEnv);
    const request = new Request("https://nudge.example.com/api/tasks", { headers: { Cookie: keySessionCookie(session.token) } });
    await expect(authenticateRequest(request, keyEnv)).resolves.toMatchObject({ kind: "key", source: "cookie" });
    await expect(authenticateRequest(request, { ...keyEnv, NUDGE_AUTH_KEY: "another-correct-long-key" })).resolves.toBeNull();
  });

  it("accepts the master bearer only in Key mode", async () => {
    const request = new Request("https://nudge.example.com/api/tasks", { headers: { Authorization: `Bearer ${keyEnv.NUDGE_AUTH_KEY}` } });
    await expect(authenticateRequest(request, keyEnv)).resolves.toMatchObject({ kind: "key", source: "bearer" });
    await expect(authenticateRequest(request, {
      ...keyEnv,
      AUTH_MODE: "access",
      TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      NUDGE_ACCESS_AUD: "audience",
      NUDGE_OWNER_EMAIL: "owner@example.com",
    })).resolves.toBeNull();
  });

  it("uses the single Access audience for both MCP endpoints", () => {
    const env = { NUDGE_ACCESS_AUD: "nudge-audience" } as any;
    expect(expectedAccessAudience(new Request("https://nudge.example.com/email/mcp"), env)).toBe("nudge-audience");
    expect(expectedAccessAudience(new Request("https://nudge.example.com/memories/mcp"), env)).toBe("nudge-audience");
  });
});
