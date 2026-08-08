import { recordDeviceResult, sendToSubscription } from "./push";
import type { Env, NotificationDeliveryRow, PushSubscriptionRow, TaskRow } from "./types";

const MAX_ATTEMPTS = 8;

interface ClaimedDelivery extends NotificationDeliveryRow {
  text: string;
  workspace: string;
  due_at: string;
  notification_body: string | null;
  subscription_json: string;
}

export function retryDelaySeconds(attempts: number): number {
  return Math.min(60 * 2 ** Math.min(Math.max(attempts - 1, 0), 6), 3_600);
}

async function createDueDeliveries(env: Env): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO task_notification_deliveries (task_id, endpoint, device_id, sequence)
     SELECT t.id, s.endpoint, s.device_id, t.notification_count
     FROM tasks t CROSS JOIN push_subscriptions s
     WHERE t.done_at IS NULL AND t.notified_at IS NULL AND t.due_at IS NOT NULL
       AND ((t.notified_at IS NULL AND t.due_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         OR (t.notified_at IS NOT NULL AND t.next_notification_at IS NOT NULL AND t.next_notification_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             AND t.notification_count < t.follow_up_max_count + 1))
       AND s.disabled_at IS NULL AND s.device_id IS NOT NULL
       AND t.due_at >= s.enabled_at`,
  ).run();
}

async function claimDeliveries(env: Env): Promise<ClaimedDelivery[]> {
  const claimed = await env.DB.prepare(
    `UPDATE task_notification_deliveries
     SET claimed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id IN (
       SELECT id FROM task_notification_deliveries
       WHERE status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         AND (claimed_at IS NULL OR claimed_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-10 minutes'))
       ORDER BY created_at LIMIT 50
     ) RETURNING id`,
  ).all<{ id: number }>();
  if (!claimed.results?.length) return [];
  const placeholders = claimed.results.map(() => "?").join(",");
  const rows = await env.DB.prepare(
    `SELECT d.*, t.text, t.workspace, t.due_at, t.notification_body, s.subscription_json
     FROM task_notification_deliveries d
     JOIN tasks t ON t.id = d.task_id
     JOIN push_subscriptions s ON s.endpoint = d.endpoint
     WHERE d.id IN (${placeholders}) AND t.done_at IS NULL AND s.disabled_at IS NULL`,
  ).bind(...claimed.results.map((row) => row.id)).all<ClaimedDelivery>();
  return rows.results || [];
}

async function messageFor(env: Env, delivery: ClaimedDelivery): Promise<string> {
  // Notification copy is prepared when the task is saved. Keep a title
  // fallback for tasks created before notification_body was introduced.
  return delivery.notification_body || delivery.text;
}

async function recordDeliveryFailure(env: Env, delivery: ClaimedDelivery, error: string): Promise<void> {
  const attempts = delivery.attempts + 1;
  const failed = attempts >= MAX_ATTEMPTS;
  await env.DB.prepare(
    `UPDATE task_notification_deliveries SET status = ?, claimed_at = NULL, attempts = ?, last_error = ?,
       next_retry_at = CASE WHEN ? THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?) END WHERE id = ?`,
  ).bind(failed ? "failed" : "pending", attempts, error, failed ? 1 : 0, `+${retryDelaySeconds(attempts)} seconds`, delivery.id).run();
}

async function finalizeTask(env: Env, taskId: number, sequence: number): Promise<void> {
  await env.DB.prepare(
    `UPDATE tasks SET notified_at = COALESCE(notified_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
       notification_count = notification_count + 1,
       last_notification_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       next_notification_at = CASE WHEN follow_up_max_count > notification_count AND follow_up_interval_minutes > 0
         THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+' || follow_up_interval_minutes || ' minutes') ELSE NULL END,
       notification_claimed_at = NULL, next_retry_at = NULL
     WHERE id = ?
       AND EXISTS (SELECT 1 FROM task_notification_deliveries WHERE task_id = ? AND sequence = ? AND status IN ('delivered', 'skipped'))
       AND NOT EXISTS (SELECT 1 FROM task_notification_deliveries WHERE task_id = ? AND sequence = ? AND status IN ('pending', 'failed'))
       AND notification_count <= ?`,
  ).bind(taskId, taskId, sequence, taskId, sequence, sequence).run();
}

async function finalizeReadyTasks(env: Env): Promise<void> {
  await env.DB.prepare(
    `UPDATE tasks SET notified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE done_at IS NULL AND notified_at IS NULL
       AND EXISTS (SELECT 1 FROM task_notification_deliveries d WHERE d.task_id = tasks.id AND d.status = 'delivered')
       AND NOT EXISTS (SELECT 1 FROM task_notification_deliveries d WHERE d.task_id = tasks.id AND d.status IN ('pending', 'failed'))`,
  ).run();
}

export async function retryFailedDeliveries(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE task_notification_deliveries SET status = 'pending', attempts = 0, claimed_at = NULL,
       next_retry_at = NULL, last_error = NULL WHERE status = 'failed'`,
  ).run();
  return result.meta.changes || 0;
}

export async function processDueReminders(env: Env): Promise<{ claimed: number; delivered: number; failed: number }> {
  await createDueDeliveries(env);
  const deliveries = await claimDeliveries(env);
  let delivered = 0;
  let failed = 0;
  const messages = new Map<number, string>();

  for (const delivery of deliveries) {
    let message = messages.get(delivery.task_id);
    if (!message) {
      message = await messageFor(env, delivery);
      messages.set(delivery.task_id, message);
    }
    const result = await sendToSubscription(env, delivery.subscription_json, {
      title: `Nudge · ${delivery.workspace}`,
      body: message,
      taskId: delivery.task_id,
      workspace: delivery.workspace,
      url: `/?task=${delivery.task_id}`,
    });
    await recordDeviceResult(env, delivery.endpoint, result);
    if (result.delivered) {
      await env.DB.prepare(
        `UPDATE task_notification_deliveries SET status = 'delivered', delivered_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         claimed_at = NULL, attempts = attempts + 1, next_retry_at = NULL, last_error = NULL WHERE id = ?`,
      ).bind(delivery.id).run();
      delivered += 1;
    } else if (result.permanent) {
      await env.DB.prepare(
        "UPDATE task_notification_deliveries SET status = 'skipped', claimed_at = NULL, attempts = attempts + 1, last_error = ? WHERE id = ?",
      ).bind(result.error, delivery.id).run();
    } else {
      await recordDeliveryFailure(env, delivery, result.error || "push_unavailable");
      failed += 1;
    }
    await finalizeTask(env, delivery.task_id, delivery.sequence);
    console.log("push_delivery", { taskId: delivery.task_id, deviceId: delivery.device_id, delivered: result.delivered, statusCode: result.statusCode });
  }
  await finalizeReadyTasks(env);
  console.log("reminder_run", { claimed: deliveries.length, delivered, failed });
  return { claimed: deliveries.length, delivered, failed };
}
