export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  MEMORY_DB?: D1Database;
  MEMORY_VECTORIZE?: VectorizeIndex;
  MEMORY_CONFIG_KV?: KVNamespace;
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  MEMORY_MCP_OBJECT?: DurableObjectNamespace;
  MEMORY_VECTORIZE_GRACE_MS?: string;
  LOGIN_RATE_LIMITER?: RateLimiter;
  VOICE_RATE_LIMITER?: RateLimiter;
  GEMINI_API_KEY?: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT?: string;
  APP_TIMEZONE?: string;
  ACCESS_LOCAL_DEV?: string;
  AUTH_MODE?: string;
  NUDGE_AUTH_KEY?: string;
  TEAM_DOMAIN?: string;
  NUDGE_ACCESS_AUD?: string;
  EMAIL_KV?: KVNamespace;
  MCP_OBJECT?: DurableObjectNamespace;
  NUDGE_ENCRYPTION_KEY?: string;
  CREDENTIAL_ENCRYPTION_KEY?: string;
  NUDGE_OWNER_EMAIL?: string;
  OUTLOOK_CLIENT_ID?: string;
  OUTLOOK_CLIENT_SECRET?: string;
  OUTLOOK_TENANT?: string;
  NUDGE_ACTION_SIGNING_SECRET?: string;
  WHATSAPP_BASE_URL?: string;
  WHATSAPP_USERNAME?: string;
  WHATSAPP_PASSWORD?: string;
  WHATSAPP_DEVICE_ID?: string;
  WHATSAPP_WEBHOOK_SECRET?: string;
  WHATSAPP_WEBHOOK_URL?: string;
}

export interface TaskRow {
  id: number;
  text: string;
  due_at: string | null;
  notified_at: string | null;
  done_at: string | null;
  workspace: string;
  created_at: string;
  notification_claimed_at?: string | null;
  notification_attempts?: number;
  next_retry_at?: string | null;
  notification_body?: string | null;
  details: string;
  follow_up_interval_minutes: number;
  follow_up_max_count: number;
  notification_count: number;
  last_notification_at: string | null;
  next_notification_at: string | null;
}

export interface PushSubscriptionRow {
  endpoint: string;
  subscription_json: string;
  device_id: string;
  device_name: string | null;
  enabled_at: string;
  updated_at: string | null;
  last_seen_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  failure_count: number;
  disabled_at: string | null;
  last_test_at: string | null;
}

export interface NotificationDeliveryRow {
  id: number;
  task_id: number;
  endpoint: string;
  device_id: string;
  status: "pending" | "delivered" | "failed" | "skipped";
  attempts: number;
  claimed_at: string | null;
  next_retry_at: string | null;
  delivered_at: string | null;
  last_error: string | null;
  sequence: number;
}

export type AuthMode = "access" | "key" | "local";

export interface AccessIdentity {
  kind: "access" | "key" | "local";
  sub: string;
  email: string;
  exp?: number;
  iat?: number;
  source?: "cookie" | "bearer" | "access" | "local";
}

export type AppBindings = {
  Bindings: Env;
  Variables: { authMode: AuthMode; identity: AccessIdentity };
};
