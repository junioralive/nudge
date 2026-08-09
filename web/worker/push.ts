import webpush from "web-push";
import type { Env, PushSubscriptionRow } from "./types";

export interface PushPayload {
  title: string;
  body: string;
  taskId?: number;
  workspace?: string;
  url?: string;
}

export interface PushResult {
  delivered: boolean;
  permanent: boolean;
  statusCode: number;
  error: string | null;
}

function configure(env: Env) {
  webpush.setVapidDetails(
    env.VAPID_SUBJECT || "https://github.com/junioralive/nudge",
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
}

export function isPermanentPushFailure(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}

export async function registerSubscription(
  env: Env,
  deviceId: string,
  deviceName: string,
  subscription: PushSubscriptionJSON,
): Promise<void> {
  if (!subscription.endpoint || !subscription.keys?.auth || !subscription.keys?.p256dh) {
    throw new Error("Invalid push subscription");
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE push_subscriptions SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE device_id = ? AND endpoint <> ? AND disabled_at IS NULL`,
    ).bind(deviceId, subscription.endpoint),
    env.DB.prepare(
      `INSERT INTO push_subscriptions
         (endpoint, subscription_json, device_id, device_name, enabled_at, updated_at, last_seen_at, disabled_at)
       VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL)
       ON CONFLICT(endpoint) DO UPDATE SET
         subscription_json = excluded.subscription_json,
         device_id = excluded.device_id,
         device_name = excluded.device_name,
         updated_at = excluded.updated_at,
         last_seen_at = excluded.last_seen_at,
         disabled_at = NULL`,
    ).bind(subscription.endpoint, JSON.stringify(subscription), deviceId, deviceName),
  ]);
}

export async function getPushStatus(env: Env, deviceId: string) {
  const current = deviceId
    ? await env.DB.prepare(
      `SELECT device_id, device_name, enabled_at, last_seen_at, last_success_at, last_failure_at,
              failure_count, disabled_at, last_test_at
       FROM push_subscriptions WHERE device_id = ? ORDER BY updated_at DESC LIMIT 1`,
    ).bind(deviceId).first<Record<string, unknown>>()
    : null;
  const devices = await env.DB.prepare(
    `SELECT device_id, device_name, enabled_at, last_seen_at, last_success_at, last_failure_at, failure_count
     FROM push_subscriptions WHERE disabled_at IS NULL ORDER BY last_seen_at DESC`,
  ).all<Record<string, unknown>>();
  const failures = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM task_notification_deliveries WHERE status = 'failed'",
  ).first<{ count: number }>();
  return { current, devices: devices.results || [], failedDeliveries: failures?.count || 0 };
}

export async function disableDevice(env: Env, deviceId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE push_subscriptions
     SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE device_id = ? AND disabled_at IS NULL`,
  ).bind(deviceId).run();
  return (result.meta.changes || 0) > 0;
}

export async function getActiveDevice(env: Env, deviceId: string): Promise<PushSubscriptionRow | null> {
  return env.DB.prepare(
    "SELECT * FROM push_subscriptions WHERE device_id = ? AND disabled_at IS NULL LIMIT 1",
  ).bind(deviceId).first<PushSubscriptionRow>();
}

export async function sendToSubscription(
  env: Env,
  subscriptionJson: string,
  payload: PushPayload,
): Promise<PushResult> {
  configure(env);
  try {
    await webpush.sendNotification(JSON.parse(subscriptionJson), JSON.stringify(payload), { TTL: 3600 });
    return { delivered: true, permanent: false, statusCode: 201, error: null };
  } catch (error: any) {
    const statusCode = Number(error?.statusCode) || 0;
    return {
      delivered: false,
      permanent: isPermanentPushFailure(statusCode),
      statusCode,
      error: statusCode ? `push_${statusCode}` : "push_unavailable",
    };
  }
}

export async function sendTestPush(env: Env, device: PushSubscriptionRow): Promise<PushResult> {
  const result = await sendToSubscription(env, device.subscription_json, {
    title: "Nudge is ready",
    body: "Test received. Future reminders will reach this device.",
    url: "/?notification=test",
  });
  await recordDeviceResult(env, device.endpoint, result, true);
  return result;
}

export async function recordDeviceResult(
  env: Env,
  endpoint: string,
  result: PushResult,
  test = false,
): Promise<void> {
  const testUpdate = test ? ", last_test_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')" : "";
  if (result.delivered) {
    await env.DB.prepare(
      `UPDATE push_subscriptions SET last_success_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), failure_count = 0${testUpdate} WHERE endpoint = ?`,
    ).bind(endpoint).run();
    return;
  }
  await env.DB.prepare(
    `UPDATE push_subscriptions SET last_failure_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
     failure_count = failure_count + 1,
     disabled_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE disabled_at END${testUpdate}
     WHERE endpoint = ?`,
  ).bind(result.permanent ? 1 : 0, endpoint).run();
  if (result.permanent) {
    await env.DB.prepare(
      `UPDATE task_notification_deliveries SET status = 'skipped', claimed_at = NULL, next_retry_at = NULL,
       last_error = ? WHERE endpoint = ? AND status = 'pending'`,
    ).bind(result.error, endpoint).run();
  }
}
