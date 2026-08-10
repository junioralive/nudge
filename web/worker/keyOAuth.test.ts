import { describe, expect, it } from "vitest";
import { authenticateMcpRequest, handleKeyOAuthRequest } from "./keyOAuth";

class OAuthDatabase {
  clients = new Map<string, any>();
  codes = new Map<string, any>();
  refresh = new Map<string, any>();
  prepare(sql: string) {
    return {
      bind: (...values: any[]) => ({
        first: async () => {
          if (sql.includes("FROM oauth_clients")) return this.clients.get(values[0]) || null;
          if (sql.includes("FROM oauth_authorization_codes")) return this.codes.get(values[0]) || null;
          if (sql.includes("SELECT family_id FROM oauth_refresh_tokens")) {
            const row = this.refresh.get(values[0]);
            return row ? { family_id: row.family_id } : null;
          }
          if (sql.includes("FROM oauth_refresh_tokens")) return this.refresh.get(values[0]) || null;
          return null;
        },
        run: async () => {
          if (sql.includes("INSERT INTO oauth_clients")) this.clients.set(values[0], { client_id: values[0], client_name: values[1], redirect_uris_json: values[2] });
          else if (sql.includes("INSERT INTO oauth_authorization_codes")) this.codes.set(values[0], { code_hash: values[0], client_id: values[1], redirect_uri: values[2], scope: values[3], code_challenge: values[4], expires_at: values[5], used_at: null });
          else if (sql.includes("INSERT INTO oauth_refresh_tokens")) this.refresh.set(values[0], { token_hash: values[0], family_id: values[1], client_id: values[2], scope: values[3], expires_at: values[4], created_at: values[5], revoked_at: null, replaced_by_hash: null });
          else if (sql.includes("UPDATE oauth_authorization_codes")) {
            const row = this.codes.get(values[1]);
            if (!row || row.used_at) return { meta: { changes: 0 } };
            row.used_at = values[0];
          } else if (sql.includes("replaced_by_hash = ? WHERE token_hash")) {
            const row = this.refresh.get(values[2]);
            if (!row || row.revoked_at || row.replaced_by_hash) return { meta: { changes: 0 } };
            row.revoked_at = values[0];
            row.replaced_by_hash = values[1];
          } else if (sql.includes("WHERE family_id")) {
            for (const row of this.refresh.values()) if (row.family_id === values[1]) row.revoked_at ||= values[0];
          }
          return { meta: { changes: 1 } };
        },
      }),
    };
  }
}

const env = {
  AUTH_MODE: "key",
  NUDGE_AUTH_KEY: "correct-horse-battery-staple",
  NUDGE_ENCRYPTION_KEY: "test-encryption-key",
  LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
} as any;

async function pkceChallenge(verifier: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("Key-mode MCP OAuth", () => {
  it("publishes OAuth and protected-resource metadata only in Key mode", async () => {
    const authorization = await handleKeyOAuthRequest(new Request("https://nudge.example.com/.well-known/oauth-authorization-server"), env);
    expect(authorization?.status).toBe(200);
    await expect(authorization?.json()).resolves.toMatchObject({
      issuer: "https://nudge.example.com/oauth",
      code_challenge_methods_supported: ["S256"],
    });
    const emailResource = await handleKeyOAuthRequest(new Request("https://nudge.example.com/.well-known/oauth-protected-resource/email/mcp"), env);
    await expect(emailResource?.json()).resolves.toMatchObject({
      resource: "https://nudge.example.com/email/mcp",
      scopes_supported: ["email:mcp"],
    });
    const disabled = await handleKeyOAuthRequest(new Request("https://nudge.example.com/.well-known/oauth-authorization-server"), {
      ...env,
      AUTH_MODE: "access",
      TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      NUDGE_ACCESS_AUD: "audience",
      NUDGE_OWNER_EMAIL: "owner@example.com",
    });
    expect(disabled).toBeNull();
  });

  it("rejects insecure and unknown dynamic redirect origins before database access", async () => {
    const response = await handleKeyOAuthRequest(new Request("https://nudge.example.com/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://localhost/callback"], token_endpoint_auth_method: "none" }),
    }), env);
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({ error: "invalid_redirect_uri" });
  });

  it("completes PKCE authorization and isolates Email from Memories scope", async () => {
    const database = new OAuthDatabase();
    const testEnv = { ...env, DB: database };
    const redirectUri = "https://chatgpt.com/connector_platform_oauth_redirect";
    const registration = await handleKeyOAuthRequest(new Request("https://nudge.example.com/oauth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.10" },
      body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: [redirectUri], token_endpoint_auth_method: "none" }),
    }), testEnv);
    if (!registration) throw new Error("registration route was not handled");
    const registered = await registration.json() as { client_id: string };
    const verifier = "this-is-a-long-pkce-verifier-with-enough-entropy-123456789";
    const challenge = await pkceChallenge(verifier);
    const authorization = new URLSearchParams({
      client_id: registered.client_id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "email:mcp",
      state: "client-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
      key: env.NUDGE_AUTH_KEY,
    });
    const approved = await handleKeyOAuthRequest(new Request("https://nudge.example.com/oauth/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "203.0.113.10" },
      body: authorization,
    }), testEnv);
    if (!approved) throw new Error("authorization route was not handled");
    expect(approved.status).toBe(303);
    const callback = new URL(approved.headers.get("Location") || "https://invalid.example");
    const code = callback.searchParams.get("code") || "";
    expect(callback.searchParams.get("state")).toBe("client-state");
    const token = await handleKeyOAuthRequest(new Request("https://nudge.example.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: registered.client_id,
        redirect_uri: redirectUri,
        code,
        code_verifier: verifier,
      }),
    }), testEnv);
    if (!token) throw new Error("token route was not handled");
    expect(token.status).toBe(200);
    const tokens = await token.json() as { access_token: string };
    const bearer = new Request("https://nudge.example.com/email/mcp", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    await expect(authenticateMcpRequest(bearer, testEnv, "email:mcp")).resolves.toMatchObject({ kind: "key" });
    await expect(authenticateMcpRequest(bearer, testEnv, "memories:mcp")).resolves.toBeNull();

    const replay = await handleKeyOAuthRequest(new Request("https://nudge.example.com/oauth/token", {
      method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: registered.client_id, redirect_uri: redirectUri, code, code_verifier: verifier }),
    }), testEnv);
    if (!replay) throw new Error("token replay route was not handled");
    expect(replay.status).toBe(400);
  });
});
