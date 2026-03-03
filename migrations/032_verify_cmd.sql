-- Version: 032
-- Migration: Verification commands — attach machine-checkable done criteria to tasks

ALTER TABLE tasks ADD COLUMN verify_cmd TEXT;
ALTER TABLE tasks ADD COLUMN verify_schema TEXT;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (32, datetime('now'));
