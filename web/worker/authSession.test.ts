import { describe, expect, it } from "vitest";
import { normalizeSessionResponse } from "../src/authSession.js";

describe("session response normalization", () => {
  it("turns an expired Cloudflare token into an Access reauthentication state", () => {
    expect(normalizeSessionResponse(401, { error: "invalid_token" })).toEqual({
      authenticated: false,
      authMode: "access",
      reauthRequired: true,
      error: "Your Cloudflare Access session expired.",
    });
  });

  it("recognizes the Cloudflare protected-resource challenge", () => {
    const result = normalizeSessionResponse(401, {}, 'Bearer realm="OAuth", resource_metadata="https://nudge.example.com/.well-known/cloudflare-access-protected-resource/"') as { authMode?: string; reauthRequired?: boolean };
    expect(result.authMode).toBe("access");
    expect(result.reauthRequired).toBe(true);
  });

  it("preserves ordinary Key-mode session responses", () => {
    const body = { authenticated: false, authMode: "key" };
    expect(normalizeSessionResponse(401, body)).toBe(body);
  });
});
