export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  DB: D1Database;
  LOGIN_RATE_LIMITER: RateLimiter;
  VOICE_RATE_LIMITER?: RateLimiter;
  NUDGE_AUTH_KEY: string;
  SESSION_SECRET: string;
  SECOND_BRAIN_URL: string;
  SECOND_BRAIN_TOKEN?: string;
  GEMINI_API_KEY?: string;
  GEMINI_LIVE_MODEL?: string;
  NUDGE_ASSISTANT_GENDER?: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT?: string;
  APP_TIMEZONE?: string;
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

export type AuthMode = "cookie" | "bearer";

export type AppBindings = {
  Bindings: Env;
  Variables: { authMode: AuthMode };
};
