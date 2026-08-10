ALTER TABLE settings ADD COLUMN onboarding_completed_at TEXT;

CREATE TABLE IF NOT EXISTS integration_secrets (
  provider TEXT PRIMARY KEY,
  encrypted_payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Existing installations already have a profile. Mark them complete so the
-- onboarding screen is only shown to new users.
UPDATE settings
SET onboarding_completed_at = COALESCE(onboarding_completed_at, updated_at)
WHERE key = 'name' AND value <> '';
