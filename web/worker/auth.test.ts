import { describe, expect, it } from "vitest";
import { expectedAccessAudience, verifyAccessRequest } from "./auth";

describe("Cloudflare Access authentication", () => {
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

  it("fails closed when an MCP-specific audience is absent", async () => {
    expect(expectedAccessAudience(new Request("https://nudge.example.com/email/mcp"), {
      NUDGE_ACCESS_AUD: "nudge-audience",
    } as any)).toBeUndefined();
  });

  it("prefers a dedicated MCP audience when configured", () => {
    expect(expectedAccessAudience(new Request("https://nudge.example.com/email/mcp"), {
      NUDGE_ACCESS_AUD: "nudge-audience",
      EMAIL_MCP_ACCESS_AUD: "mcp-audience",
    } as any)).toBe("mcp-audience");
  });

  it("isolates Memories MCP from app and Email audiences", () => {
    expect(expectedAccessAudience(new Request("https://nudge.example.com/memories/mcp"), {
      NUDGE_ACCESS_AUD: "nudge-audience",
      EMAIL_MCP_ACCESS_AUD: "email-audience",
      MEMORIES_MCP_ACCESS_AUD: "memories-audience",
    } as any)).toBe("memories-audience");
  });
});
