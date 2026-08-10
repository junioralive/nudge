import type { Context } from "hono";
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from "jose";
import type { AccessIdentity, AppBindings, AuthMode, Env } from "./types";

const SESSION_COOKIE = "__Host-nudge_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
let cachedTeamDomain = "";
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function isLocalDevelopment(request: Request, env: Env): boolean {
  if (env.ACCESS_LOCAL_DEV !== "true") return false;
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

function accessConfigured(env: Env): boolean {
  return Boolean(
    String(env.TEAM_DOMAIN || "").startsWith("https://")
      && env.NUDGE_ACCESS_AUD
      && env.NUDGE_OWNER_EMAIL,
  );
}

function keyConfigured(env: Env): boolean {
  return typeof env.NUDGE_AUTH_KEY === "string" && env.NUDGE_AUTH_KEY.length >= 15 && Boolean(env.NUDGE_ENCRYPTION_KEY);
}

export function resolveAuthMode(env: Env): "access" | "key" | null {
  const configured = String(env.AUTH_MODE || "auto").trim().toLowerCase();
  if (configured === "access") return accessConfigured(env) ? "access" : null;
  if (configured === "key") return keyConfigured(env) ? "key" : null;
  if (configured !== "auto") return null;
  if (accessConfigured(env)) return "access";
  if (keyConfigured(env)) return "key";
  return null;
}

export function authConfigurationError(env: Env): string | null {
  const requested = String(env.AUTH_MODE || "auto").trim().toLowerCase();
  if (!new Set(["auto", "key", "access"]).has(requested)) return "AUTH_MODE must be auto, key, or access";
  if (requested === "access" && !accessConfigured(env)) return "Cloudflare Access configuration is incomplete";
  if (requested === "key") {
    if (!env.NUDGE_AUTH_KEY || env.NUDGE_AUTH_KEY.length < 15) return "NUDGE_AUTH_KEY must contain at least 15 characters";
    if (!env.NUDGE_ENCRYPTION_KEY) return "NUDGE_ENCRYPTION_KEY is required in Key mode";
  }
  if (requested === "auto" && !accessConfigured(env) && !keyConfigured(env)) return "No complete authentication configuration was found";
  return null;
}

export function expectedAccessAudience(_request: Request, env: Env): string | undefined {
  return env.NUDGE_ACCESS_AUD;
}

function hasAudience(payload: JWTPayload, audience: string): boolean {
  return Array.isArray(payload.aud) ? payload.aud.includes(audience) : payload.aud === audience;
}

export async function verifyAccessRequest(request: Request, env: Env): Promise<AccessIdentity | null> {
  if (isLocalDevelopment(request, env)) {
    return { kind: "local", source: "local", sub: "local-development", email: env.NUDGE_OWNER_EMAIL || "local@localhost" };
  }

  const teamDomain = String(env.TEAM_DOMAIN || "").replace(/\/$/, "");
  const audience = expectedAccessAudience(request, env);
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!teamDomain.startsWith("https://") || !audience || !token) return null;
  if (!cachedJwks || cachedTeamDomain !== teamDomain) {
    cachedTeamDomain = teamDomain;
    cachedJwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
  }

  try {
    const { payload } = await jwtVerify(token, cachedJwks, { issuer: teamDomain });
    if (!hasAudience(payload, audience) || typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (typeof payload.email !== "string") return null;
    const owner = String(env.NUDGE_OWNER_EMAIL || "").trim().toLowerCase();
    if (owner && payload.email.toLowerCase() !== owner) return null;
    return {
      kind: "access",
      source: "access",
      sub: payload.sub,
      email: payload.email,
      exp: payload.exp,
      iat: typeof payload.iat === "number" ? payload.iat : undefined,
    };
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string): string | null {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function constantTimeKeyMatches(candidate: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(candidate), sha256(expected)]);
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left[index] ^ right[index];
  return different === 0;
}

async function sessionSigningKey(env: Env): Promise<Uint8Array> {
  return sha256(`nudge-session-v1\0${env.NUDGE_ENCRYPTION_KEY || ""}\0${env.NUDGE_AUTH_KEY || ""}`);
}

export async function createKeySession(env: Env): Promise<{ token: string; expiresAt: number }> {
  if (!keyConfigured(env)) throw new Error("Key authentication is not configured");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_SECONDS;
  const token = await new SignJWT({ auth: "key" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("nudge:key")
    .setSubject("nudge-owner")
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(await sessionSigningKey(env));
  return { token, expiresAt };
}

export function keySessionCookie(token: string, maxAge = SESSION_SECONDS): string {
  return `${SESSION_COOKIE}=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

export function clearKeySessionCookie(): string {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

async function verifyKeySession(request: Request, env: Env): Promise<AccessIdentity | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await sessionSigningKey(env), { issuer: "nudge:key" });
    if (payload.auth !== "key" || typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    return {
      kind: "key",
      source: "cookie",
      sub: payload.sub,
      email: "Nudge owner",
      exp: payload.exp,
      iat: typeof payload.iat === "number" ? payload.iat : undefined,
    };
  } catch {
    return null;
  }
}

async function verifyKeyBearer(request: Request, env: Env): Promise<AccessIdentity | null> {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ") || !env.NUDGE_AUTH_KEY) return null;
  const candidate = authorization.slice(7);
  if (!(await constantTimeKeyMatches(candidate, env.NUDGE_AUTH_KEY))) return null;
  return { kind: "key", source: "bearer", sub: "nudge-api-client", email: "Nudge API client" };
}

export async function authenticateRequest(request: Request, env: Env): Promise<AccessIdentity | null> {
  if (isLocalDevelopment(request, env)) return verifyAccessRequest(request, env);
  const mode = resolveAuthMode(env);
  if (mode === "access") return verifyAccessRequest(request, env);
  if (mode === "key") return (await verifyKeyBearer(request, env)) || verifyKeySession(request, env);
  return null;
}

export async function authenticate(c: Context<AppBindings>): Promise<AccessIdentity | null> {
  return authenticateRequest(c.req.raw, c.env);
}

export function requestOriginIsValid(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function clientAddress(c: Context<AppBindings>): string {
  return c.req.header("CF-Connecting-IP") || "unknown";
}

export function accessLogoutUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.origin}/cdn-cgi/access/logout`;
}

export function requireSecrets(env: Env): string[] {
  const missing = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"].filter((name) => !env[name as keyof Env]);
  if (env.ACCESS_LOCAL_DEV !== "true") {
    const error = authConfigurationError(env);
    if (error) missing.push("AUTH_CONFIGURATION");
  }
  return missing;
}

export function resolvedAuthModeForResponse(request: Request, env: Env): AuthMode | null {
  if (isLocalDevelopment(request, env)) return "local";
  return resolveAuthMode(env);
}
