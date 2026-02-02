-- Version: 012
-- Migration: Invalidation tracking and pinned anchors for PRD-017

-- Add pinned column to learning_anchors
ALTER TABLE learning_anchors ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;

-- Invalidation audit log
CREATE TABLE IF NOT EXISTS invalidation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    anchor_id INTEGER NOT NULL,
    old_status TEXT NOT NULL,
    new_status TEXT NOT NULL,
    reason TEXT NOT NULL,
    detected_by TEXT NOT NULL CHECK (detected_by IN ('periodic', 'lazy', 'manual', 'agent', 'git_hook')),
    old_content_hash TEXT,
    new_content_hash TEXT,
    similarity_score REAL,
    invalidated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (anchor_id) REFERENCES learning_anchors(id) ON DELETE CASCADE
);

-- Indexes for invalidation_log
CREATE INDEX IF NOT EXISTS idx_invalidation_anchor ON invalidation_log(anchor_id);
CREATE INDEX IF NOT EXISTS idx_invalidation_time ON invalidation_log(invalidated_at);
CREATE INDEX IF NOT EXISTS idx_invalidation_status ON invalidation_log(new_status);
CREATE INDEX IF NOT EXISTS idx_invalidation_detected_by ON invalidation_log(detected_by);

-- Index for pinned anchors
CREATE INDEX IF NOT EXISTS idx_learning_anchors_pinned ON learning_anchors(pinned) WHERE pinned = 1;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (12, datetime('now'));
