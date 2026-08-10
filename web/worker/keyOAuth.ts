import { jwtVerify, SignJWT } from "jose";
import { authenticateRequest, constantTimeKeyMatches, resolveAuthMode } from "./auth";
import type { AccessIdentity, Env } from "./types";

const ACCESS_TOKEN_SECONDS = 15 * 60;
const REFRESH_TOKEN_SECONDS = 24 * 60 * 60;
const CODE_SECONDS = 5 * 60;
const ALLOWED_SCOPES = new Set(["email:mcp", "memories:mcp"]);

type OAuthClientRow = { client_id: string; client_name: string; redirect_uris_json: string };
type CodeRow = {
  code_hash: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  expires_at: number;
  used_at: number | null;
};
type RefreshRow = {
  token_hash: string;
  family_id: string;
  client_id: string;
  scope: string;
  expires_at: number;
  revoked_at: number | null;
  replaced_by_hash: string | null;
};

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64url(value);
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function tokenHash(value: string): Promise<string> {
  return base64url(await digest(value));
}

async function oauthSigningKey(env: Env): Promise<Uint8Array> {
  return digest(`nudge-oauth-v1\0${env.NUDGE_ENCRYPTION_KEY || ""}\0${env.NUDGE_AUTH_KEY || ""}`);
}

function origin(request: Request): string {
  return new URL(request.url).origin;
}

function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

function allowedRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    const host = url.hostname.toLowerCase();
    return host === "chatgpt.com"
      || host.endsWith(".chatgpt.com")
      || host === "chat.openai.com"
      || host.endsWith(".chat.openai.com")
      || host === "claude.ai"
      || host.endsWith(".claude.ai");
  } catch {
    return false;
  }
}

function normalizeScope(value: string): string | null {
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))];
  if (scopes.length !== 1 || scopes.some((scope) => !ALLOWED_SCOPES.has(scope))) return null;
  return scopes.sort().join(" ");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
}

async function client(env: Env, clientId: string): Promise<OAuthClientRow | null> {
  return env.DB.prepare("SELECT client_id, client_name, redirect_uris_json FROM oauth_clients WHERE client_id = ?")
    .bind(clientId).first<OAuthClientRow>();
}

function clientAllowsRedirect(row: OAuthClientRow, redirectUri: string): boolean {
  try {
    return (JSON.parse(row.redirect_uris_json) as string[]).includes(redirectUri);
  } catch {
    return false;
  }
}

async function issueTokens(env: Env, request: Request, clientId: string, scope: string, familyId: string = crypto.randomUUID()) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await new SignJWT({ scope, client_id: clientId, token_use: "mcp" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(`${origin(request)}/oauth`)
    .setAudience("nudge-mcp")
    .setSubject("nudge-owner")
    .setJti(crypto.randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_SECONDS)
    .sign(await oauthSigningKey(env));
  const refreshToken = randomToken(48);
  const refreshHash = await tokenHash(refreshToken);
  await env.DB.prepare(`INSERT INTO oauth_refresh_tokens
    (token_hash, family_id, client_id, scope, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(refreshHash, familyId, clientId, scope, now + REFRESH_TOKEN_SECONDS, now).run();
  return { accessToken, refreshToken, refreshHash, familyId };
}

function authorizationMetadata(request: Request) {
  const base = origin(request);
  return {
    issuer: `${base}/oauth`,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [...ALLOWED_SCOPES],
  };
}

function resourceForScope(request: Request, scope?: "email:mcp" | "memories:mcp") {
  const base = origin(request);
  const pathname = new URL(request.url).pathname;
  const selectedScope = scope
    || (pathname.includes("/email/mcp") ? "email:mcp" : pathname.includes("/memories/mcp") ? "memories:mcp" : undefined);
  const resourcePath = selectedScope === "email:mcp" ? "/email/mcp" : selectedScope === "memories:mcp" ? "/memories/mcp" : "";
  return { resource: `${base}${resourcePath}`, scopes: selectedScope ? [selectedScope] : [...ALLOWED_SCOPES] };
}

function protectedResourceMetadata(request: Request) {
  const base = origin(request);
  const target = resourceForScope(request);
  return {
    resource: target.resource,
    authorization_servers: [`${base}/oauth`],
    bearer_methods_supported: ["header"],
    scopes_supported: target.scopes,
  };
}

async function registerClient(request: Request, env: Env): Promise<Response> {
  if (!env.LOGIN_RATE_LIMITER) return oauthError("temporarily_unavailable", "OAuth registration rate limiter is not configured", 503);
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await env.LOGIN_RATE_LIMITER.limit({ key: `oauth-register:${address}` })).success) return oauthError("slow_down", "Too many registration attempts", 429);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const redirects = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((value): value is string => typeof value === "string") : [];
  if (!redirects.length || redirects.some((value) => !allowedRedirect(value))) {
    return oauthError("invalid_redirect_uri", "Only HTTPS ChatGPT and Claude redirect URIs are allowed");
  }
  if (body.token_endpoint_auth_method && body.token_endpoint_auth_method !== "none") {
    return oauthError("invalid_client_metadata", "Only public PKCE clients are supported");
  }
  const clientId = crypto.randomUUID();
  const clientName = String(body.client_name || "MCP client").trim().slice(0, 120) || "MCP client";
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("INSERT INTO oauth_clients (client_id, client_name, redirect_uris_json, created_at) VALUES (?, ?, ?, ?)")
    .bind(clientId, clientName, JSON.stringify(redirects), now).run();
  return json({
    client_id: clientId,
    client_id_issued_at: now,
    client_name: clientName,
    redirect_uris: redirects,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }, 201);
}

function authorizeHtml(params: URLSearchParams, clientName: string, error = ""): Response {
  const hidden = ["client_id", "redirect_uri", "response_type", "scope", "state", "code_challenge", "code_challenge_method"]
    .map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(params.get(name) || "")}">`).join("");
  const scopes = escapeHtml(params.get("scope") || "");
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Authorize Nudge</title><style>body{margin:0;background:#f5f5f5;font:16px system-ui;color:#18171b;display:grid;min-height:100vh;place-items:center}.card{width:min(420px,calc(100% - 40px));background:#fff;border:1px solid #ddd;border-radius:28px;padding:32px;box-shadow:0 20px 60px #0001}h1{margin:0 0 8px;font-size:28px}p{color:#6f6d74;line-height:1.5}label{display:block;font-weight:700;margin:24px 0 8px}input[type=password]{box-sizing:border-box;width:100%;padding:15px;border:1px solid #ccc;border-radius:14px;font:inherit}button{width:100%;margin-top:18px;padding:15px;border:0;border-radius:14px;background:#18171b;color:#fff;font-weight:700;font-size:16px}.error{color:#b42318}</style></head><body><form class="card" method="post" action="/oauth/authorize"><h1>Connect to Nudge</h1><p><strong>${escapeHtml(clientName)}</strong> is requesting <strong>${scopes}</strong> access. Your Nudge key is verified here and is never sent to the client.</p>${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}${hidden}<label for="key">Nudge key</label><input id="key" name="key" type="password" minlength="15" required autocomplete="current-password"><button type="submit">Approve connection</button></form></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'" } });
}

async function validateAuthorization(env: Env, params: URLSearchParams): Promise<{ client: OAuthClientRow; scope: string } | Response> {
  if (params.get("response_type") !== "code") return oauthError("unsupported_response_type", "Only authorization code is supported");
  if (params.get("code_challenge_method") !== "S256" || !params.get("code_challenge")) return oauthError("invalid_request", "PKCE S256 is required");
  const row = await client(env, params.get("client_id") || "");
  if (!row) return oauthError("invalid_client", "Unknown client", 401);
  const redirectUri = params.get("redirect_uri") || "";
  if (!clientAllowsRedirect(row, redirectUri)) return oauthError("invalid_request", "redirect_uri does not match registration");
  const scope = normalizeScope(params.get("scope") || "");
  if (!scope) return oauthError("invalid_scope", "Request Email or Memories MCP scope");
  return { client: row, scope };
}

async function authorize(request: Request, env: Env): Promise<Response> {
  const params = request.method === "POST" ? new URLSearchParams(await request.text()) : new URL(request.url).searchParams;
  const validated = await validateAuthorization(env, params);
  if (validated instanceof Response) return validated;
  if (request.method === "GET") return authorizeHtml(params, validated.client.client_name);
  if (!env.LOGIN_RATE_LIMITER) return oauthError("temporarily_unavailable", "OAuth authorization rate limiter is not configured", 503);
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await env.LOGIN_RATE_LIMITER.limit({ key: `oauth-authorize:${address}` })).success) return oauthError("slow_down", "Too many authorization attempts", 429);
  const key = params.get("key") || "";
  if (!env.NUDGE_AUTH_KEY || !(await constantTimeKeyMatches(key, env.NUDGE_AUTH_KEY))) {
    return authorizeHtml(params, validated.client.client_name, "That Nudge key is incorrect.");
  }
  const code = randomToken(32);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(`INSERT INTO oauth_authorization_codes
    (code_hash, client_id, redirect_uri, scope, code_challenge, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
    await tokenHash(code), validated.client.client_id, params.get("redirect_uri"), validated.scope,
    params.get("code_challenge"), now + CODE_SECONDS, now,
  ).run();
  const destination = new URL(params.get("redirect_uri") || "");
  destination.searchParams.set("code", code);
  const state = params.get("state");
  if (state) destination.searchParams.set("state", state);
  return Response.redirect(destination.toString(), 303);
}

async function exchangeCode(request: Request, env: Env, params: URLSearchParams): Promise<Response> {
  const code = params.get("code") || "";
  const hash = await tokenHash(code);
  const row = await env.DB.prepare(`SELECT code_hash, client_id, redirect_uri, scope, code_challenge, expires_at, used_at
    FROM oauth_authorization_codes WHERE code_hash = ?`).bind(hash).first<CodeRow>();
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.used_at || row.expires_at < now) return oauthError("invalid_grant", "Authorization code is invalid or expired");
  if (row.client_id !== params.get("client_id") || row.redirect_uri !== params.get("redirect_uri")) return oauthError("invalid_grant", "Authorization code does not match client");
  const verifier = params.get("code_verifier") || "";
  if (!verifier || base64url(await digest(verifier)) !== row.code_challenge) return oauthError("invalid_grant", "PKCE verification failed");
  const consumed = await env.DB.prepare("UPDATE oauth_authorization_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL")
    .bind(now, hash).run();
  if (!consumed.meta.changes) return oauthError("invalid_grant", "Authorization code was already used");
  const tokens = await issueTokens(env, request, row.client_id, row.scope);
  return json({ token_type: "Bearer", access_token: tokens.accessToken, expires_in: ACCESS_TOKEN_SECONDS, refresh_token: tokens.refreshToken, scope: row.scope });
}

async function exchangeRefresh(request: Request, env: Env, params: URLSearchParams): Promise<Response> {
  const refreshToken = params.get("refresh_token") || "";
  const hash = await tokenHash(refreshToken);
  const row = await env.DB.prepare(`SELECT token_hash, family_id, client_id, scope, expires_at, revoked_at, replaced_by_hash
    FROM oauth_refresh_tokens WHERE token_hash = ?`).bind(hash).first<RefreshRow>();
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.client_id !== params.get("client_id") || row.expires_at < now) return oauthError("invalid_grant", "Refresh token is invalid or expired");
  if (row.revoked_at || row.replaced_by_hash) {
    await env.DB.prepare("UPDATE oauth_refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?").bind(now, row.family_id).run();
    return oauthError("invalid_grant", "Refresh token reuse detected");
  }
  const requestedScope = params.get("scope") ? normalizeScope(params.get("scope") || "") : row.scope;
  if (!requestedScope || requestedScope.split(" ").some((scope) => !row.scope.split(" ").includes(scope))) return oauthError("invalid_scope", "Scope escalation is not allowed");
  const tokens = await issueTokens(env, request, row.client_id, requestedScope, row.family_id);
  const rotated = await env.DB.prepare("UPDATE oauth_refresh_tokens SET revoked_at = ?, replaced_by_hash = ? WHERE token_hash = ? AND revoked_at IS NULL AND replaced_by_hash IS NULL")
    .bind(now, tokens.refreshHash, hash).run();
  if (!rotated.meta.changes) {
    await env.DB.prepare("UPDATE oauth_refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?").bind(now, row.family_id).run();
    return oauthError("invalid_grant", "Refresh token was already rotated");
  }
  return json({ token_type: "Bearer", access_token: tokens.accessToken, expires_in: ACCESS_TOKEN_SECONDS, refresh_token: tokens.refreshToken, scope: requestedScope });
}

async function tokenEndpoint(request: Request, env: Env): Promise<Response> {
  const params = new URLSearchParams(await request.text());
  const grant = params.get("grant_type");
  if (grant === "authorization_code") return exchangeCode(request, env, params);
  if (grant === "refresh_token") return exchangeRefresh(request, env, params);
  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
}

async function revoke(request: Request, env: Env): Promise<Response> {
  const params = new URLSearchParams(await request.text());
  const token = params.get("token") || "";
  if (token) {
    const now = Math.floor(Date.now() / 1000);
    const hash = await tokenHash(token);
    const row = await env.DB.prepare("SELECT family_id FROM oauth_refresh_tokens WHERE token_hash = ?").bind(hash).first<{ family_id: string }>();
    if (row) await env.DB.prepare("UPDATE oauth_refresh_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE family_id = ?").bind(now, row.family_id).run();
  }
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}

export async function handleKeyOAuthRequest(request: Request, env: Env): Promise<Response | null> {
  if (resolveAuthMode(env) !== "key") return null;
  const pathname = new URL(request.url).pathname.replace(/\/$/, "") || "/";
  if (request.method === "GET" && (pathname === "/.well-known/oauth-authorization-server" || pathname === "/oauth/.well-known/oauth-authorization-server")) return json(authorizationMetadata(request));
  if (request.method === "GET" && pathname.startsWith("/.well-known/oauth-protected-resource")) return json(protectedResourceMetadata(request));
  if (pathname === "/oauth/register" && request.method === "POST") return registerClient(request, env);
  if (pathname === "/oauth/authorize" && (request.method === "GET" || request.method === "POST")) return authorize(request, env);
  if (pathname === "/oauth/token" && request.method === "POST") return tokenEndpoint(request, env);
  if (pathname === "/oauth/revoke" && request.method === "POST") return revoke(request, env);
  return null;
}

export async function authenticateMcpRequest(request: Request, env: Env, requiredScope: "email:mcp" | "memories:mcp"): Promise<AccessIdentity | null> {
  const mode = resolveAuthMode(env);
  if (mode === "access") return authenticateRequest(request, env);
  if (mode !== "key") return null;
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(authorization.slice(7), await oauthSigningKey(env), {
      issuer: `${origin(request)}/oauth`,
      audience: "nudge-mcp",
    });
    if (payload.token_use !== "mcp" || typeof payload.scope !== "string" || !payload.scope.split(" ").includes(requiredScope)) return null;
    return { kind: "key", source: "bearer", sub: String(payload.sub || "nudge-owner"), email: "Nudge MCP client", exp: payload.exp };
  } catch {
    return null;
  }
}

export function mcpUnauthorized(request: Request, env: Env, scope: "email:mcp" | "memories:mcp"): Response {
  if (resolveAuthMode(env) !== "key") return json({ error: "unauthorized" }, 401);
  const suffix = scope === "email:mcp" ? "/email/mcp" : "/memories/mcp";
  const metadata = `${origin(request)}/.well-known/oauth-protected-resource${suffix}`;
  return json({ error: "unauthorized" }, 401, {
    "WWW-Authenticate": `Bearer resource_metadata=\"${metadata}\", scope=\"${scope}\"`,
  });
}
