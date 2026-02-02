-- Version: 008
-- Migration: Learning anchors table for file-code associations

-- Learning anchors table (file/code associations for learnings)
CREATE TABLE IF NOT EXISTS learning_anchors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    learning_id INTEGER NOT NULL REFERENCES learnings(id) ON DELETE CASCADE,
    anchor_type TEXT NOT NULL CHECK (anchor_type IN ('glob', 'hash', 'symbol', 'line_range')),
    anchor_value TEXT NOT NULL,
    file_path TEXT NOT NULL,
    symbol_fqname TEXT,
    line_start INTEGER,
    line_end INTEGER,
    content_hash TEXT,
    status TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'invalid', 'drifted')),
    verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for graph traversal and common queries
CREATE INDEX IF NOT EXISTS idx_learning_anchors_learning_id ON learning_anchors(learning_id);
CREATE INDEX IF NOT EXISTS idx_learning_anchors_file_path ON learning_anchors(file_path);
CREATE INDEX IF NOT EXISTS idx_learning_anchors_status ON learning_anchors(status);
CREATE INDEX IF NOT EXISTS idx_learning_anchors_anchor_type ON learning_anchors(anchor_type);
CREATE INDEX IF NOT EXISTS idx_learning_anchors_symbol ON learning_anchors(symbol_fqname) WHERE symbol_fqname IS NOT NULL;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (8, datetime('now'));
