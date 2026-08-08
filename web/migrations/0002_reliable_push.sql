ALTER TABLE push_subscriptions ADD COLUMN device_id TEXT;
ALTER TABLE push_subscriptions ADD COLUMN device_name TEXT;
ALTER TABLE push_subscriptions ADD COLUMN enabled_at TEXT;
ALTER TABLE push_subscriptions ADD COLUMN updated_at TEXT;
ALTER TABLE push_subscriptions ADD COLUMN last_seen_at TEXT;
ALTER TABLE push_subscriptions ADD COLUMN last_success_at TEXT;
ALTER TABLE push_subscriptions ADD COLUMN last_failure_at TEXT;
ALTER TABLE push_subscriptions ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE push_subscriptions ADD COLUMN disabled_at TEXT;
ALTER TABLE push_subscriptions ADD COLUMN last_test_at TEXT;

UPDATE push_subscriptions
SET enabled_at = COALESCE(enabled_at, created_at),
    updated_at = COALESCE(updated_at, created_at),
    last_seen_at = COALESCE(last_seen_at, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_device_idx
  ON push_subscriptions(device_id) WHERE device_id IS NOT NULL;

ALTER TABLE tasks ADD COLUMN notification_body TEXT;

CREATE TABLE IF NOT EXISTS task_notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  device_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'skipped')),
  claimed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  delivered_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(task_id, endpoint)
);

CREATE INDEX IF NOT EXISTS task_notification_delivery_due_idx
  ON task_notification_deliveries(status, next_retry_at, claimed_at);

