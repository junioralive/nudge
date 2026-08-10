import type { AccessIdentity, AuthMode, Env } from "./types";

const ACCESS_REAUTH_WINDOW_SECONDS = 5 * 60;

export type RecoveryIntegrations = {
  gemini?: Record<string, string>;
  microsoft?: Record<string, string>;
};

function compact(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])));
}

export function accessRecoveryIsFresh(identity: AccessIdentity, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return identity.kind === "access"
    && typeof identity.iat === "number"
    && identity.iat <= nowSeconds + 60
    && nowSeconds - identity.iat <= ACCESS_REAUTH_WINDOW_SECONDS;
}

export function accessTeamLogoutUrl(env: Env): string | undefined {
  const domain = String(env.TEAM_DOMAIN || "").replace(/\/$/, "");
  return domain.startsWith("https://") ? `${domain}/cdn-cgi/access/logout` : undefined;
}

export function buildRecoveryPayload(
  env: Env,
  origin: string,
  authMode: AuthMode,
  integrations: RecoveryIntegrations = {},
  generatedAt = new Date().toISOString(),
) {
  const integrationSecrets = compact({
    GEMINI_API_KEY: integrations.gemini?.apiKey,
    OUTLOOK_CLIENT_ID: integrations.microsoft?.clientId,
    OUTLOOK_CLIENT_SECRET: integrations.microsoft?.clientSecret,
    OUTLOOK_TENANT: integrations.microsoft?.tenant,
  });

  return {
    format: "nudge-recovery",
    version: 1,
    generatedAt,
    warning: "This file contains plaintext secrets. Store it securely and never commit or share it.",
    origin,
    authentication: {
      resolvedMode: authMode,
      configuredMode: String(env.AUTH_MODE || "auto"),
    },
    configuration: compact({
      AUTH_MODE: env.AUTH_MODE || "auto",
      TEAM_DOMAIN: env.TEAM_DOMAIN,
      NUDGE_ACCESS_AUD: env.NUDGE_ACCESS_AUD,
      NUDGE_OWNER_EMAIL: env.NUDGE_OWNER_EMAIL,
      VAPID_SUBJECT: env.VAPID_SUBJECT,
    }),
    secrets: {
      ...compact({
        NUDGE_AUTH_KEY: env.NUDGE_AUTH_KEY,
        NUDGE_ENCRYPTION_KEY: env.NUDGE_ENCRYPTION_KEY,
        CREDENTIAL_ENCRYPTION_KEY: env.CREDENTIAL_ENCRYPTION_KEY,
        NUDGE_ACTION_SIGNING_SECRET: env.NUDGE_ACTION_SIGNING_SECRET,
        VAPID_PUBLIC_KEY: env.VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: env.VAPID_PRIVATE_KEY,
        GEMINI_API_KEY: env.GEMINI_API_KEY,
        OUTLOOK_CLIENT_ID: env.OUTLOOK_CLIENT_ID,
        OUTLOOK_CLIENT_SECRET: env.OUTLOOK_CLIENT_SECRET,
        OUTLOOK_TENANT: env.OUTLOOK_TENANT,
      }),
      ...integrationSecrets,
    },
    excluded: ["tasks", "workspaces", "memories", "email messages", "email account data", "push subscriptions"],
  };
}

export function recoveryDownloadResponse(payload: ReturnType<typeof buildRecoveryPayload>): Response {
  const date = payload.generatedAt.slice(0, 10);
  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="nudge-recovery-${date}.json"`,
      "Cache-Control": "no-store, private, max-age=0",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
