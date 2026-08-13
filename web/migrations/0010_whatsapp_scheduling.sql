CREATE TABLE IF NOT EXISTS whatsapp_scheduled_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload_encrypted TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  next_retry_at TEXT,
  sent_at TEXT,
  message_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_scheduled_due
  ON whatsapp_scheduled_messages(status, scheduled_at, next_retry_at, claimed_at);
