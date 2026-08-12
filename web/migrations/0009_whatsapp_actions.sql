CREATE TABLE IF NOT EXISTS whatsapp_action_nonces (
  nonce TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
