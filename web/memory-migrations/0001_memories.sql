CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'api',
  created_at INTEGER NOT NULL,
  vector_ids TEXT NOT NULL DEFAULT '[]',
  recall_count INTEGER DEFAULT 0,
  importance_score INTEGER DEFAULT 0,
  contradiction_wins INTEGER DEFAULT 0,
  contradiction_losses INTEGER DEFAULT 0,
  updated_at INTEGER,
  staleness_checked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_source ON entries(source);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'relates_to',
  weight REAL NOT NULL DEFAULT 0.5,
  provenance TEXT NOT NULL DEFAULT 'inferred',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(source_id, target_id, type)
);

CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_weight ON edges(weight DESC);
