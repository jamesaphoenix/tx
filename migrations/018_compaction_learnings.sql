-- Version: 018
-- Migration: Add learnings column to compaction_log for data loss prevention
--
-- Fixes CRITICAL bug: learnings were only exported to file, not stored in DB.
-- If file export failed (disk full, permissions, etc.), learnings were lost
-- forever because the original tasks were already deleted.
--
-- Now learnings are stored in the database as the primary source of truth,
-- ensuring they're never lost even if file export fails.

-- Add learnings column to store actual learning content
ALTER TABLE compaction_log ADD COLUMN learnings TEXT;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (18, datetime('now'));
