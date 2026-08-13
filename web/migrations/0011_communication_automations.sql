CREATE TABLE IF NOT EXISTS communication_automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('whatsapp_message', 'email_message')),
  payload_encrypted TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'delivery-unknown', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TEXT,
  next_retry_at TEXT,
  sent_at TEXT,
  external_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO communication_automations
  (id, type, payload_encrypted, scheduled_at, status, attempts, claimed_at, next_retry_at, sent_at, external_id, last_error, created_at)
SELECT id, 'whatsapp_message', payload_encrypted, scheduled_at, status, attempts, claimed_at, next_retry_at, sent_at, message_id, last_error, created_at
FROM whatsapp_scheduled_messages;

CREATE INDEX IF NOT EXISTS idx_communication_automations_due
  ON communication_automations(status, scheduled_at, next_retry_at, claimed_at);

CREATE INDEX IF NOT EXISTS idx_communication_automations_source
  ON communication_automations(type, status, scheduled_at);
