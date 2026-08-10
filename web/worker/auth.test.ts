import { describe, expect, it } from "vitest";
import { verifyAccessRequest } from "./auth";

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
});
