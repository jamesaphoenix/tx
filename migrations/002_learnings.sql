-- Version: 002
-- Migration: Learnings table with FTS5 for BM25 search

-- Learnings table (append-only event log)
CREATE TABLE IF NOT EXISTS learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('compaction', 'run', 'manual', 'claude_md')),
    source_ref TEXT,
    created_at TEXT NOT NULL,
    keywords TEXT,
    category TEXT,
    usage_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    outcome_score REAL,
    embedding BLOB
);

-- FTS5 for BM25 keyword search
CREATE VIRTUAL TABLE IF NOT EXISTS learnings_fts USING fts5(
    content, keywords, category,
    content='learnings', content_rowid='id',
    tokenize='porter unicode61'
);

-- Triggers to sync FTS on insert
CREATE TRIGGER IF NOT EXISTS learnings_ai AFTER INSERT ON learnings BEGIN
    INSERT INTO learnings_fts(rowid, content, keywords, category)
    VALUES (new.id, new.content, new.keywords, new.category);
END;

-- Triggers to sync FTS on delete
CREATE TRIGGER IF NOT EXISTS learnings_ad AFTER DELETE ON learnings BEGIN
    INSERT INTO learnings_fts(learnings_fts, rowid, content, keywords, category)
    VALUES ('delete', old.id, old.content, old.keywords, old.category);
END;

-- Triggers to sync FTS on update
CREATE TRIGGER IF NOT EXISTS learnings_au AFTER UPDATE ON learnings BEGIN
    INSERT INTO learnings_fts(learnings_fts, rowid, content, keywords, category)
    VALUES ('delete', old.id, old.content, old.keywords, old.category);
    INSERT INTO learnings_fts(rowid, content, keywords, category)
    VALUES (new.id, new.content, new.keywords, new.category);
END;

-- Config for retrieval weights
CREATE TABLE IF NOT EXISTS learnings_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR IGNORE INTO learnings_config (key, value) VALUES
    ('bm25_weight', '0.4'),
    ('vector_weight', '0.4'),
    ('recency_weight', '0.2');

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_learnings_created ON learnings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_source_type ON learnings(source_type);
CREATE INDEX IF NOT EXISTS idx_learnings_usage ON learnings(usage_count DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_outcome ON learnings(outcome_score DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (2, datetime('now'));
