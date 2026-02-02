-- Version: 013
-- Migration: Add content_preview for self-healing comparison (PRD-017)

-- Add content_preview column to store original content snippet for Jaccard similarity
-- Used by self-healing to compare old vs new content when anchors drift
ALTER TABLE learning_anchors ADD COLUMN content_preview TEXT;

-- Index for faster lookups when content_preview is present
CREATE INDEX IF NOT EXISTS idx_learning_anchors_has_preview
    ON learning_anchors(content_hash) WHERE content_preview IS NOT NULL;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (13, datetime('now'));
