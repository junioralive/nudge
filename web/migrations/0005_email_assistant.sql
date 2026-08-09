CREATE TABLE IF NOT EXISTS email_task_links (
  task_id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  message_uid INTEGER NOT NULL,
  message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS email_task_links_message_idx
  ON email_task_links(account_id, folder, message_uid);

CREATE TABLE IF NOT EXISTS email_action_nonces (
  nonce TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS email_action_nonces_used_idx
  ON email_action_nonces(used_at);
