-- Migration 029: Memory system tables
-- Filesystem-backed memory with BM25 + vector + graph search over .md files.

-- Indexed memory documents (derived from .md files, not source of truth)
CREATE TABLE IF NOT EXISTS memory_documents (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    root_dir TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    frontmatter TEXT,
    tags TEXT,
    file_hash TEXT NOT NULL,
    file_mtime TEXT NOT NULL,
    embedding BLOB,
    created_at TEXT NOT NULL,
    indexed_at TEXT NOT NULL,
    UNIQUE(file_path, root_dir)
);

-- FTS5 full-text search index
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    title, content, tags,
    content='memory_documents', content_rowid='rowid',
    tokenize='porter unicode61'
);

-- FTS5 sync triggers (keep FTS index in sync with memory_documents)
CREATE TRIGGER IF NOT EXISTS memory_fts_ai AFTER INSERT ON memory_documents BEGIN
    INSERT INTO memory_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_ad AFTER DELETE ON memory_documents BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, title, content, tags) VALUES ('delete', old.rowid, old.title, old.content, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_au AFTER UPDATE OF title, content, tags ON memory_documents BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, title, content, tags) VALUES ('delete', old.rowid, old.title, old.content, old.tags);
    INSERT INTO memory_fts(rowid, title, content, tags) VALUES (new.rowid, new.title, new.content, new.tags);
END;

-- Wikilinks and explicit edges between documents
CREATE TABLE IF NOT EXISTS memory_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_doc_id TEXT NOT NULL REFERENCES memory_documents(id) ON DELETE CASCADE,
    target_doc_id TEXT,
    target_ref TEXT NOT NULL,
    link_type TEXT NOT NULL CHECK (link_type IN ('wikilink', 'frontmatter', 'explicit')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source_doc_id, target_ref, link_type)
);

-- Configuration: which directories to index
CREATE TABLE IF NOT EXISTS memory_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    root_dir TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Structured key-value properties per document
CREATE TABLE IF NOT EXISTS memory_properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT NOT NULL REFERENCES memory_documents(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    UNIQUE(doc_id, key)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_memory_docs_path ON memory_documents(file_path);
CREATE INDEX IF NOT EXISTS idx_memory_docs_path_root ON memory_documents(file_path, root_dir);
CREATE INDEX IF NOT EXISTS idx_memory_docs_root ON memory_documents(root_dir);
CREATE INDEX IF NOT EXISTS idx_memory_docs_hash ON memory_documents(file_hash);
CREATE INDEX IF NOT EXISTS idx_memory_docs_indexed_at ON memory_documents(indexed_at);
CREATE INDEX IF NOT EXISTS idx_memory_links_source ON memory_links(source_doc_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_target ON memory_links(target_doc_id) WHERE target_doc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memory_links_ref ON memory_links(target_ref);
CREATE INDEX IF NOT EXISTS idx_memory_props_doc ON memory_properties(doc_id);
CREATE INDEX IF NOT EXISTS idx_memory_props_key_value ON memory_properties(key, value);

-- Track schema version (must be last — only inserted after all DDL succeeds)
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (29, datetime('now'));
