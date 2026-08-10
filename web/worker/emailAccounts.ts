import { decodeJwt, createRemoteJWKSet, jwtVerify } from "jose";
import { openJson, sealJson } from "./email-core/crypto";
import { AccountStore } from "./email-core/mail/account-store";
import { emailEncryptionKey } from "./email";
import { MailService } from "./email-core/mail/mail-service";
import type { AccountAuth, MailAccount } from "./email-core/mail/types";
import { assertValidOutlookOAuthCallback, createOutlookOAuthState, type OutlookOAuthState } from "./email-core/outlook-oauth";
import type { Env } from "./types";

const OUTLOOK_SCOPES = "openid profile email offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send";
const microsoftJwks = createRemoteJWKSet(new URL("https://login.microsoftonline.com/common/discovery/v2.0/keys"));

export function emailStore(env: Env): AccountStore {
  if (!env.EMAIL_KV) throw new Error("Email storage is not configured");
  return new AccountStore(env.EMAIL_KV, emailEncryptionKey(env));
}

export function emailService(env: Env): MailService {
  return new MailService(emailStore(env), { clientId: env.OUTLOOK_CLIENT_ID, clientSecret: env.OUTLOOK_CLIENT_SECRET });
}

export function outlookConfigured(env: Env): boolean {
  return Boolean(env.OUTLOOK_CLIENT_ID && env.OUTLOOK_CLIENT_SECRET && env.EMAIL_KV && (env.NUDGE_ENCRYPTION_KEY || env.CREDENTIAL_ENCRYPTION_KEY));
}

function outlookConfig(env: Env): { clientId: string; clientSecret: string; tenant: string } {
  if (!env.OUTLOOK_CLIENT_ID || !env.OUTLOOK_CLIENT_SECRET) throw new Error("Outlook OAuth is not configured");
  const tenant = env.OUTLOOK_TENANT || "consumers";
  if (!/^(?:common|organizations|consumers|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i.test(tenant)) throw new Error("Invalid OUTLOOK_TENANT");
  return { clientId: env.OUTLOOK_CLIENT_ID, clientSecret: env.OUTLOOK_CLIENT_SECRET, tenant };
}

export function outlookRedirectUri(request: Request): string {
  return `${new URL(request.url).origin}/api/email/oauth/outlook/callback`;
}

export function oauthCookie(value: string, secure: boolean): string {
  return `nudge_outlook_oauth=${value}; Path=/api/email/oauth/outlook/callback; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`;
}

export function clearOauthCookie(secure: boolean): string {
  return `nudge_outlook_oauth=; Path=/api/email/oauth/outlook/callback; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function cookieValue(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim() || undefined;
  }
  return undefined;
}

export async function startOutlookOAuth(env: Env, request: Request, displayName: string, accountId?: string): Promise<{ url: string; cookie: string }> {
  const config = outlookConfig(env);
  const safeAccountId = accountId?.trim().slice(0, 160) || undefined;
  if (safeAccountId) await emailStore(env).get(safeAccountId);
  const { oauthState, codeChallenge } = await createOutlookOAuthState(displayName.trim().slice(0, 160));
  if (safeAccountId) oauthState.accountId = safeAccountId;
  const authorize = new URL(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/authorize`);
  authorize.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: outlookRedirectUri(request),
    response_mode: "query",
    scope: OUTLOOK_SCOPES,
    state: oauthState.state,
    nonce: oauthState.nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: authorize.toString(), cookie: oauthCookie(await sealJson(oauthState, emailEncryptionKey(env)), request.url.startsWith("https://")) };
}

async function verifyMicrosoftIdentity(idToken: string, clientId: string, nonce: string): Promise<{ email: string }> {
  const unverified = decodeJwt(idToken);
  if (typeof unverified.tid !== "string" || !/^[0-9a-f-]{36}$/i.test(unverified.tid)) throw new Error("Microsoft identity token has no valid tenant");
  const { payload } = await jwtVerify(idToken, microsoftJwks, { issuer: `https://login.microsoftonline.com/${unverified.tid}/v2.0`, audience: clientId });
  if (payload.nonce !== nonce) throw new Error("Microsoft identity token nonce is invalid");
  const email = typeof payload.preferred_username === "string" ? payload.preferred_username : typeof payload.email === "string" ? payload.email : "";
  if (!email || !email.includes("@")) throw new Error("Microsoft identity did not return an email address");
  return { email: email.trim().toLowerCase() };
}

export async function finishOutlookOAuth(env: Env, request: Request): Promise<{ account: MailAccount; clearCookie: string }> {
  const config = outlookConfig(env);
  const code = new URL(request.url).searchParams.get("code");
  const returnedState = new URL(request.url).searchParams.get("state");
  const sealedState = cookieValue(request, "nudge_outlook_oauth");
  if (!code || !returnedState || !sealedState) throw new Error("Outlook authorization expired");
  const oauthState = await openJson<OutlookOAuthState>(sealedState, emailEncryptionKey(env));
  assertValidOutlookOAuthCallback(oauthState, returnedState);
  const body = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code", code, redirect_uri: outlookRedirectUri(request), code_verifier: oauthState.codeVerifier, scope: OUTLOOK_SCOPES });
  const response = await fetch(`https://login.microsoftonline.com/${config.tenant}/oauth2/v2.0/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  if (!response.ok) throw new Error(`Microsoft token exchange failed (${response.status})`);
  const token = await response.json<{ access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string }>();
  if (!token.access_token || !token.refresh_token || !token.id_token) throw new Error("Microsoft did not return the required OAuth tokens");
  const identity = await verifyMicrosoftIdentity(token.id_token, config.clientId, oauthState.nonce);
  const existing = oauthState.accountId ? await emailStore(env).get(oauthState.accountId) : undefined;
  const account: MailAccount = {
    id: existing?.id || crypto.randomUUID(),
    name: existing?.name || oauthState.displayName,
    email: identity.email,
    imap: { host: "outlook.office365.com", port: 993, secure: true },
    smtp: { host: "smtp.office365.com", port: 587, secure: false },
    auth: { type: "oauth2", accessToken: token.access_token, refreshToken: token.refresh_token, clientId: config.clientId, tenant: config.tenant, expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000 },
  };
  if (existing) await emailStore(env).update(account);
  else await emailStore(env).add(account);
  return { account, clearCookie: clearOauthCookie(request.url.startsWith("https://")) };
}

export function parseAccountInput(input: Record<string, unknown>, existingAuth?: AccountAuth): Omit<MailAccount, "id"> {
  const name = String(input.name || "").trim().slice(0, 160);
  const email = String(input.email || "").trim().toLowerCase();
  const imapHost = String(input.imapHost || "").trim().slice(0, 255);
  const smtpHost = input.smtpHost ? String(input.smtpHost).trim().slice(0, 255) : "";
  if (!name || !email.includes("@") || !imapHost) throw new Error("name, email, and imapHost are required");
  const auth = input.password
    ? { type: "password" as const, password: String(input.password) }
    : input.accessToken
      ? { type: "oauth2" as const, accessToken: String(input.accessToken), refreshToken: input.refreshToken ? String(input.refreshToken) : undefined, clientId: input.oauthClientId ? String(input.oauthClientId) : undefined, tenant: input.oauthTenant ? String(input.oauthTenant) : "consumers" }
      : existingAuth;
  if (!auth) throw new Error("password or accessToken is required");
  return { name, email, imap: { host: imapHost, port: Number(input.imapPort) || 993, secure: input.imapSecure !== false }, smtp: smtpHost ? { host: smtpHost, port: Number(input.smtpPort) || 465, secure: input.smtpSecure !== false } : undefined, auth };
}
