-- Version: 035
-- Migration: Repair missing anchor/invalidation tables for drifted databases
--
-- Some long-lived local databases can report schema_version at head while missing
-- anchor tables (for example after manual table drops or partial file restores).
-- This migration is idempotent and safely recreates those tables/indexes when absent.

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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    pinned INTEGER NOT NULL DEFAULT 0,
    content_preview TEXT
);

CREATE INDEX IF NOT EXISTS idx_learning_anchors_learning_id ON learning_anchors(learning_id);
CREATE INDEX IF NOT EXISTS idx_learning_anchors_file_path ON learning_anchors(file_path);
CREATE INDEX IF NOT EXISTS idx_learning_anchors_status ON learning_anchors(status);
CREATE INDEX IF NOT EXISTS idx_learning_anchors_anchor_type ON learning_anchors(anchor_type);
CREATE INDEX IF NOT EXISTS idx_learning_anchors_symbol ON learning_anchors(symbol_fqname) WHERE symbol_fqname IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_learning_anchors_pinned ON learning_anchors(pinned) WHERE pinned = 1;
CREATE INDEX IF NOT EXISTS idx_learning_anchors_has_preview
  ON learning_anchors(content_hash) WHERE content_preview IS NOT NULL;

CREATE TABLE IF NOT EXISTS learning_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    edge_type TEXT NOT NULL CHECK (edge_type IN (
        'ANCHORED_TO',
        'DERIVED_FROM',
        'IMPORTS',
        'CO_CHANGES_WITH',
        'SIMILAR_TO',
        'LINKS_TO',
        'USED_IN_RUN',
        'INVALIDATED_BY'
    )),
    source_type TEXT NOT NULL CHECK (source_type IN ('learning', 'file', 'task', 'run')),
    source_id TEXT NOT NULL,
    target_type TEXT NOT NULL CHECK (target_type IN ('learning', 'file', 'task', 'run')),
    target_id TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0.0 AND weight <= 1.0),
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    invalidated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_learning_edges_source ON learning_edges(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_learning_edges_target ON learning_edges(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_learning_edges_type ON learning_edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_learning_edges_active ON learning_edges(source_type, source_id) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_learning_edges_source_type ON learning_edges(source_type, source_id, edge_type) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_learning_edges_target_type ON learning_edges(target_type, target_id, edge_type) WHERE invalidated_at IS NULL;

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

CREATE INDEX IF NOT EXISTS idx_invalidation_anchor ON invalidation_log(anchor_id);
CREATE INDEX IF NOT EXISTS idx_invalidation_time ON invalidation_log(invalidated_at);
CREATE INDEX IF NOT EXISTS idx_invalidation_status ON invalidation_log(new_status);
CREATE INDEX IF NOT EXISTS idx_invalidation_detected_by ON invalidation_log(detected_by);

INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (35, datetime('now'));
