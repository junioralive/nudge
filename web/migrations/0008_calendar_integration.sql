CREATE TABLE IF NOT EXISTS calendar_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL CHECK(provider IN ('google', 'outlook', 'icloud')),
  name TEXT NOT NULL,
  encrypted_url TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#7FB2FF',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  last_sync_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS calendar_events (
  source_id INTEGER NOT NULL,
  event_key TEXT NOT NULL,
  uid TEXT NOT NULL,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  location TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (source_id, event_key),
  FOREIGN KEY (source_id) REFERENCES calendar_sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_range ON calendar_events(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_calendar_events_source ON calendar_events(source_id, starts_at);
