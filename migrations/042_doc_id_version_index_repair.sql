-- Version: 042
-- Migration: Repair doc_id index semantics for versioned document lineages
--
-- Migration 041 briefly enforced UNIQUE(doc_id), which prevents multiple
-- versions of the same logical document from sharing a stable lineage id.
-- Canonical doc identity is doc_id + version at the row level, while doc_id
-- alone identifies the document lineage across versions.

DROP INDEX IF EXISTS idx_docs_doc_id;
DROP INDEX IF EXISTS idx_docs_doc_id_version;

CREATE INDEX IF NOT EXISTS idx_docs_doc_id
  ON docs(doc_id)
  WHERE doc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_doc_id_version
  ON docs(doc_id, version)
  WHERE doc_id IS NOT NULL;

-- Record this migration
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (42, datetime('now'));
