import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppBindings, AuthMode, Env } from "./types";

const COOKIE_NAME = "nudge_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function secureEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(left), sha256(right)]);
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

async function signingKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function sign(payload: string, secret: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await signingKey(secret), encoder.encode(payload));
  return encodeBase64Url(new Uint8Array(signature));
}

export async function createSession(secret: string): Promise<string> {
  const payload = encodeBase64Url(
    encoder.encode(JSON.stringify({ version: 1, expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS })),
  );
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySession(value: string | undefined, secret: string): Promise<boolean> {
  if (!value || !secret) return false;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return false;

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(secret),
      decodeBase64Url(signature) as BufferSource,
      encoder.encode(payload),
    );
    if (!valid) return false;
    const data = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    return data.version === 1 && Number(data.expiresAt) > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function authenticate(c: Context<AppBindings>): Promise<AuthMode | null> {
  const authorization = c.req.header("Authorization");
  if (authorization?.startsWith("Bearer ")) {
    const key = authorization.slice(7);
    if (key && c.env.NUDGE_AUTH_KEY && (await secureEqual(key, c.env.NUDGE_AUTH_KEY))) return "bearer";
  }

  if (await verifySession(getCookie(c, COOKIE_NAME), c.env.SESSION_SECRET || "")) return "cookie";
  return null;
}

export function setSessionCookie(c: Context<AppBindings>, value: string): void {
  setCookie(c, COOKIE_NAME, value, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export function clearSessionCookie(c: Context<AppBindings>): void {
  deleteCookie(c, COOKIE_NAME, { path: "/", secure: true, sameSite: "Strict" });
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

export function requireSecrets(env: Env): string[] {
  const required: Array<keyof Env> = [
    "NUDGE_AUTH_KEY",
    "SESSION_SECRET",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
  ];
  return required.filter((name) => !env[name]).map(String);
}
