ALTER TABLE workspaces ADD COLUMN color TEXT NOT NULL DEFAULT '#E787FF';

UPDATE workspaces SET color = '#E787FF' WHERE lower(name) = 'personal';
UPDATE workspaces SET color = '#FFC66D' WHERE lower(name) = 'work';
UPDATE workspaces SET color = '#6FD69A' WHERE lower(name) = 'startup';
