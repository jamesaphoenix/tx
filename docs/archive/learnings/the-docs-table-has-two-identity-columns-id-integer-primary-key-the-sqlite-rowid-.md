---
created: "2026-03-29T18:38:01.745Z"
---

# The docs table has two identity columns: 'id' (INTEGER PRIMARY KEY, the SQLite rowid) and 'doc_id' (TEXT, the logical document lineage ID like doc-xxx). When creating FK references to docs, use 'REFERENCES docs(id)' pointing at the integer rowid, not the text doc_id. The doc_review_runs table stores both doc_row_id (FK to integer id) and doc_id + doc_version (text/integer copies for query convenience). This dual-identity exists because doc_id is not unique — multiple versions of the same logical doc share a doc_id.


