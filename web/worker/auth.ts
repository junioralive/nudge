import type { Context } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { AccessIdentity, AppBindings, Env } from "./types";

let cachedTeamDomain = "";
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function isLocalDevelopment(request: Request, env: Env): boolean {
  if (env.ACCESS_LOCAL_DEV !== "true") return false;
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

export function expectedAccessAudience(request: Request, env: Env): string | undefined {
  return env.NUDGE_ACCESS_AUD;
}

function hasAudience(payload: JWTPayload, audience: string): boolean {
  return Array.isArray(payload.aud) ? payload.aud.includes(audience) : payload.aud === audience;
}

export async function verifyAccessRequest(request: Request, env: Env): Promise<AccessIdentity | null> {
  if (isLocalDevelopment(request, env)) {
    return { kind: "local", sub: "local-development", email: env.NUDGE_OWNER_EMAIL || "local@localhost" };
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
    // Cloudflare Access assertions are short-lived identity tokens. Require an
    // explicit expiry instead of accepting a structurally valid token forever.
    if (!hasAudience(payload, audience) || typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (typeof payload.email !== "string") return null;
    const owner = String(env.NUDGE_OWNER_EMAIL || "").trim().toLowerCase();
    if (owner && payload.email.toLowerCase() !== owner) return null;
    return { kind: "access", sub: payload.sub, email: payload.email, exp: payload.exp };
  } catch {
    return null;
  }
}

export async function authenticate(c: Context<AppBindings>): Promise<AccessIdentity | null> {
  return verifyAccessRequest(c.req.raw, c.env);
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
  const required: Array<keyof Env> = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"];
  if (env.ACCESS_LOCAL_DEV !== "true") required.push("TEAM_DOMAIN", "NUDGE_ACCESS_AUD", "NUDGE_OWNER_EMAIL");
  return required.filter((name) => !env[name]).map(String);
}
