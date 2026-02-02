-- Version: 011
-- Migration: Processed hashes table for JSONL line deduplication

-- Track processed JSONL line hashes for deduplication
-- Each unique line (by content hash) is recorded once to avoid re-processing
CREATE TABLE IF NOT EXISTS processed_hashes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_hash TEXT NOT NULL UNIQUE,      -- SHA256 of the JSONL line content
    source_file TEXT NOT NULL,              -- First file where this line was seen
    source_line INTEGER NOT NULL,           -- Line number in source file (1-indexed)
    processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for fast hash lookups (most common operation)
CREATE INDEX IF NOT EXISTS idx_processed_hashes_hash ON processed_hashes(content_hash);
-- Index for querying by source file
CREATE INDEX IF NOT EXISTS idx_processed_hashes_file ON processed_hashes(source_file);

-- Track file processing progress for incremental processing
-- Allows resuming from last position when a file changes
CREATE TABLE IF NOT EXISTS file_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,         -- Absolute path to the JSONL file
    last_line_processed INTEGER DEFAULT 0,  -- Last line number processed (1-indexed)
    last_byte_offset INTEGER DEFAULT 0,     -- Byte offset for streaming resume
    file_size INTEGER,                      -- Size at last processing time
    file_checksum TEXT,                     -- SHA256 of file content at last processing
    last_processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Index for file path lookups
CREATE INDEX IF NOT EXISTS idx_file_progress_path ON file_progress(file_path);

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (11, datetime('now'));
