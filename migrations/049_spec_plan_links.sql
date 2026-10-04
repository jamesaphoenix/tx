-- Version: 049
-- Add spec-to-plan links without deleting existing docs, evidence or historical records.
PRAGMA foreign_keys = OFF;
CREATE TABLE doc_links_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  to_doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN (
    'overview_to_prd', 'overview_to_design', 'prd_to_design', 'design_patch',
    'requirement_to_prd', 'requirement_to_design', 'system_design_to_design',
    'system_design_to_prd', 'spec_to_plan'
  )),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_doc_id, to_doc_id),
  CHECK(from_doc_id != to_doc_id)
);
INSERT INTO doc_links_new SELECT * FROM doc_links;
DROP TABLE doc_links;
ALTER TABLE doc_links_new RENAME TO doc_links;
CREATE INDEX idx_doc_links_from ON doc_links(from_doc_id);
CREATE INDEX idx_doc_links_to ON doc_links(to_doc_id);
PRAGMA foreign_keys = ON;
INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (49, datetime('now'));
