-- Earlier voice retries could create more than one untouched prepared draft for
-- the same conversation. Keep only the newest draft before enforcing uniqueness.
DELETE FROM delegated_conversations
WHERE status = 'prepared'
  AND id NOT IN (
    SELECT MAX(id)
    FROM delegated_conversations
    WHERE status = 'prepared'
    GROUP BY source, locator_hash
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_delegated_conversations_one_prepared
  ON delegated_conversations(source, locator_hash)
  WHERE status = 'prepared';
