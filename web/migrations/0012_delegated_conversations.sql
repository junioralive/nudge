CREATE TABLE IF NOT EXISTS delegated_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL CHECK (source IN ('whatsapp', 'email')),
  locator_hash TEXT NOT NULL,
  locator_encrypted TEXT NOT NULL,
  label_encrypted TEXT NOT NULL,
  objective_encrypted TEXT NOT NULL,
  context_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'active', 'paused', 'needs-you', 'completed', 'expired', 'stopped', 'failed')),
  duration_minutes INTEGER NOT NULL,
  max_replies INTEGER NOT NULL,
  reply_count INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  expires_at TEXT,
  next_check_at TEXT,
  claimed_at TEXT,
  last_external_at TEXT,
  last_activity_at TEXT,
  summary_encrypted TEXT,
  outcome_encrypted TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_delegated_conversations_processing
  ON delegated_conversations(status, source, next_check_at, claimed_at);
CREATE INDEX IF NOT EXISTS idx_delegated_conversations_locator
  ON delegated_conversations(source, locator_hash, status);

CREATE TABLE IF NOT EXISTS delegated_conversation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delegation_id INTEGER NOT NULL REFERENCES delegated_conversations(id) ON DELETE CASCADE,
  external_event_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'system', 'ack')),
  event_type TEXT NOT NULL DEFAULT 'text',
  content_encrypted TEXT NOT NULL,
  metadata_encrypted TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  available_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'processed', 'ignored', 'failed')),
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(delegation_id, external_event_id, direction)
);

CREATE INDEX IF NOT EXISTS idx_delegated_events_processing
  ON delegated_conversation_events(status, available_at, delegation_id);

CREATE TABLE IF NOT EXISTS delegation_action_nonces (
  nonce TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS delegation_webhook_replays (
  digest TEXT PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
