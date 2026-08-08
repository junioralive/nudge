CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  due_at TEXT,
  notified_at TEXT,
  done_at TEXT,
  workspace TEXT NOT NULL DEFAULT 'Personal',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  notification_claimed_at TEXT,
  notification_attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT
);

CREATE INDEX IF NOT EXISTS tasks_due_idx
  ON tasks (notified_at, done_at, due_at, next_retry_at);

CREATE TABLE IF NOT EXISTS workspaces (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  subscription_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO workspaces (name, sort_order) VALUES
  ('Personal', 0),
  ('Work', 1),
  ('Startup', 2);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('timezone', 'Asia/Kolkata');
