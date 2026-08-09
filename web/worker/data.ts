import type { Env, TaskRow } from "./types";

export function publicTask(task: TaskRow): TaskRow {
  const { notification_claimed_at: _claim, notification_attempts: _attempts, next_retry_at: _retry,
    notification_body: _body, ...result } =
    task;
  return result as TaskRow;
}

export async function listTasks(env: Env): Promise<TaskRow[]> {
  const result = await env.DB.prepare(
    "SELECT * FROM tasks ORDER BY due_at IS NULL, due_at ASC, created_at DESC",
  ).all<TaskRow>();
  return (result.results || []).map(publicTask);
}

export async function getTask(env: Env, id: number): Promise<TaskRow | null> {
  return env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<TaskRow>();
}

export async function addTask(
  env: Env,
  input: { text: string; details?: string; due_at?: string | null; workspace?: string | null; follow_up_interval_minutes?: number; follow_up_max_count?: number },
): Promise<TaskRow> {
  const workspace = input.workspace?.trim() || "Personal";
  await env.DB.prepare("INSERT OR IGNORE INTO workspaces (name, sort_order) VALUES (?, 999)").bind(workspace).run();
  const result = await env.DB.prepare(
    `INSERT INTO tasks (text, details, due_at, workspace, follow_up_interval_minutes, follow_up_max_count, notification_body)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(input.text.trim().slice(0, 200), input.details?.trim().slice(0, 10_000) || "", input.due_at || null, workspace,
      Math.max(0, Number(input.follow_up_interval_minutes) || 0), Math.max(0, Math.min(5, Number(input.follow_up_max_count) || 0)), input.text.trim().slice(0, 200))
    .first<TaskRow>();
  if (!result) throw new Error("Task insert failed");
  return publicTask(result);
}

export async function updateTask(
  env: Env,
  id: number,
  input: { text?: string; details?: string; due_at?: string | null; workspace?: string; follow_up_interval_minutes?: number; follow_up_max_count?: number },
): Promise<TaskRow | null> {
  const existing = await getTask(env, id);
  if (!existing) return null;
  const workspace = input.workspace?.trim() || existing.workspace;
  const text = input.text?.trim().slice(0, 200) || existing.text;
  const details = input.details !== undefined ? input.details.trim().slice(0, 10_000) : existing.details;
  const dueAt = input.due_at !== undefined ? input.due_at : existing.due_at;
  const followInterval = input.follow_up_interval_minutes !== undefined ? Math.max(0, Number(input.follow_up_interval_minutes) || 0) : existing.follow_up_interval_minutes;
  const followMax = input.follow_up_max_count !== undefined ? Math.max(0, Math.min(5, Number(input.follow_up_max_count) || 0)) : existing.follow_up_max_count;
  const resetNotification = text !== existing.text || details !== existing.details || dueAt !== existing.due_at
    || followInterval !== existing.follow_up_interval_minutes || followMax !== existing.follow_up_max_count;
  await env.DB.prepare("INSERT OR IGNORE INTO workspaces (name, sort_order) VALUES (?, 999)").bind(workspace).run();
  await env.DB.batch([
    env.DB.prepare(
    `UPDATE tasks
     SET text = ?, details = ?, due_at = ?, workspace = ?, follow_up_interval_minutes = ?, follow_up_max_count = ?,
         notified_at = CASE WHEN ? THEN NULL ELSE notified_at END,
         notification_body = CASE WHEN ? THEN ? ELSE notification_body END,
         notification_claimed_at = NULL, notification_attempts = CASE WHEN ? THEN 0 ELSE notification_attempts END,
         next_retry_at = NULL, next_notification_at = CASE WHEN ? THEN NULL ELSE next_notification_at END WHERE id = ?`,
    ).bind(
      text,
      details,
      dueAt,
      workspace,
      followInterval,
      followMax,
      resetNotification ? 1 : 0,
      resetNotification ? 1 : 0,
      text,
      resetNotification ? 1 : 0,
      resetNotification ? 1 : 0,
      id,
    ),
    ...(resetNotification ? [env.DB.prepare("DELETE FROM task_notification_deliveries WHERE task_id = ?").bind(id)] : []),
  ]);
  const task = await getTask(env, id);
  return task ? publicTask(task) : null;
}

export async function completeTask(env: Env, id: number): Promise<TaskRow | null> {
  await env.DB.batch([
    env.DB.prepare("UPDATE tasks SET done_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), next_notification_at = NULL WHERE id = ?").bind(id),
    env.DB.prepare("DELETE FROM task_notification_deliveries WHERE task_id = ? AND status IN ('pending', 'failed')").bind(id),
  ]);
  const task = await getTask(env, id);
  return task ? publicTask(task) : null;
}

export async function deleteTask(env: Env, id: number): Promise<boolean> {
  const statements = [
    env.DB.prepare("DELETE FROM task_notification_deliveries WHERE task_id = ?").bind(id),
    env.DB.prepare("DELETE FROM email_task_links WHERE task_id = ?").bind(id),
    env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(id),
  ];
  const results = await env.DB.batch(statements);
  const result = results.at(-1)!;
  return Boolean(result.meta.changes);
}

export function isTodayInTimezone(value: string, timezone: string): boolean {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return format.format(new Date(value)) === format.format(new Date());
}
