---
created: "2026-03-29T18:37:28.598Z"
---

# Migration SQL files follow strict convention: filename NNN_description.sql, header '-- Version: NNN' with '-- Migration: description' comment, and must end with 'INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (N, datetime("now"));'. All tables use CREATE TABLE IF NOT EXISTS. FK references use ON DELETE CASCADE or ON DELETE SET NULL depending on ownership semantics.


