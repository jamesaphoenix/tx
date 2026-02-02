-- Version: 009
-- Migration: Learning edges table for graph relationships

-- Learning edges table (graph relationships between nodes)
-- Supports edge types: ANCHORED_TO, DERIVED_FROM, IMPORTS, CO_CHANGES_WITH, SIMILAR_TO, LINKS_TO, USED_IN_RUN, INVALIDATED_BY
-- Node types: learning, file, task, run
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

-- Indexes for graph traversal
-- Source-based lookups (outgoing edges)
CREATE INDEX IF NOT EXISTS idx_learning_edges_source ON learning_edges(source_type, source_id);
-- Target-based lookups (incoming edges)
CREATE INDEX IF NOT EXISTS idx_learning_edges_target ON learning_edges(target_type, target_id);
-- Edge type filtering
CREATE INDEX IF NOT EXISTS idx_learning_edges_type ON learning_edges(edge_type);
-- Active edges only (not invalidated) - partial index for efficient traversal
CREATE INDEX IF NOT EXISTS idx_learning_edges_active ON learning_edges(source_type, source_id) WHERE invalidated_at IS NULL;
-- Composite index for bidirectional traversal with edge type filtering
CREATE INDEX IF NOT EXISTS idx_learning_edges_source_type ON learning_edges(source_type, source_id, edge_type) WHERE invalidated_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_learning_edges_target_type ON learning_edges(target_type, target_id, edge_type) WHERE invalidated_at IS NULL;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (9, datetime('now'));
