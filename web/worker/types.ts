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
  VOICE_RATE_LIMITER?: RateLimiter;
  SECOND_BRAIN_URL?: string;
  SECOND_BRAIN_TOKEN?: string;
  GEMINI_API_KEY?: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT?: string;
  APP_TIMEZONE?: string;
  ACCESS_LOCAL_DEV?: string;
  TEAM_DOMAIN?: string;
  NUDGE_ACCESS_AUD?: string;
  EMAIL_MCP_ACCESS_AUD?: string;
  MEMORIES_MCP_ACCESS_AUD?: string;
  NUDGE_OWNER_EMAIL?: string;
  EMAIL_KV?: KVNamespace;
  MCP_OBJECT?: DurableObjectNamespace;
  CREDENTIAL_ENCRYPTION_KEY?: string;
  OUTLOOK_CLIENT_ID?: string;
  OUTLOOK_CLIENT_SECRET?: string;
  OUTLOOK_TENANT?: string;
  NUDGE_ACTION_SIGNING_SECRET?: string;
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

export type AuthMode = "access" | "local";

export interface AccessIdentity {
  kind: "access" | "local";
  sub: string;
  email: string;
  exp?: number;
}

export type AppBindings = {
  Bindings: Env;
  Variables: { authMode: AuthMode; identity: AccessIdentity };
};
