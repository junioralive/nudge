ALTER TABLE tasks ADD COLUMN details TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN follow_up_interval_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN follow_up_max_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN notification_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN last_notification_at TEXT;
ALTER TABLE tasks ADD COLUMN next_notification_at TEXT;

ALTER TABLE task_notification_deliveries RENAME TO task_notification_deliveries_old;
CREATE TABLE task_notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  device_id TEXT NOT NULL,
  sequence INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed', 'skipped')),
  claimed_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  delivered_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(task_id, endpoint, sequence)
);
INSERT INTO task_notification_deliveries
  (id, task_id, endpoint, device_id, sequence, status, claimed_at, attempts, next_retry_at, delivered_at, last_error, created_at)
SELECT id, task_id, endpoint, device_id, 0, status, claimed_at, attempts, next_retry_at, delivered_at, last_error, created_at
FROM task_notification_deliveries_old;
DROP TABLE task_notification_deliveries_old;
CREATE INDEX IF NOT EXISTS task_notification_delivery_due_idx
  ON task_notification_deliveries(status, next_retry_at, claimed_at);
