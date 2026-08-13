import { isValidEncryptionKey, openJson } from "./email-core/crypto";
import type { Env } from "./types";

export function integrationEncryptionKey(env: Env): string | undefined {
  return isValidEncryptionKey(env.NUDGE_ENCRYPTION_KEY) ? env.NUDGE_ENCRYPTION_KEY : env.CREDENTIAL_ENCRYPTION_KEY;
}

export async function loadIntegrationSecret(env: Env, provider: string): Promise<Record<string, string> | undefined> {
  const key = integrationEncryptionKey(env);
  if (!key) return undefined;
  try {
    const row = await env.DB.prepare("SELECT encrypted_payload FROM integration_secrets WHERE provider = ?")
      .bind(provider)
      .first<{ encrypted_payload: string }>();
    return row?.encrypted_payload ? await openJson<Record<string, string>>(row.encrypted_payload, key) : undefined;
  } catch {
    return undefined;
  }
}

export async function runtimeEnv(env: Env): Promise<Env> {
  const [gemini, microsoft, whatsapp] = await Promise.all([
    loadIntegrationSecret(env, "gemini"),
    loadIntegrationSecret(env, "microsoft"),
    loadIntegrationSecret(env, "whatsapp"),
  ]);
  return {
    ...env,
    GEMINI_API_KEY: gemini?.apiKey || env.GEMINI_API_KEY,
    OUTLOOK_CLIENT_ID: microsoft?.clientId || env.OUTLOOK_CLIENT_ID,
    OUTLOOK_CLIENT_SECRET: microsoft?.clientSecret || env.OUTLOOK_CLIENT_SECRET,
    OUTLOOK_TENANT: microsoft?.tenant || env.OUTLOOK_TENANT,
    WHATSAPP_BASE_URL: whatsapp?.baseUrl || env.WHATSAPP_BASE_URL,
    WHATSAPP_USERNAME: whatsapp?.username || env.WHATSAPP_USERNAME,
    WHATSAPP_PASSWORD: whatsapp?.password || env.WHATSAPP_PASSWORD,
    WHATSAPP_DEVICE_ID: whatsapp?.deviceId || env.WHATSAPP_DEVICE_ID,
    WHATSAPP_WEBHOOK_SECRET: whatsapp?.webhookSecret || env.WHATSAPP_WEBHOOK_SECRET,
    WHATSAPP_WEBHOOK_URL: whatsapp?.webhookUrl || env.WHATSAPP_WEBHOOK_URL,
  };
}
