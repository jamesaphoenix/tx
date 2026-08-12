import type { SqliteDatabase } from "../db.js"
import type { SpecProjectionContext } from "../workspace-context.js"

export const ensureSpecProjection = (
  db: SqliteDatabase,
  projection: SpecProjectionContext
): void => {
  db.prepare(
    `INSERT INTO spec_projections (
       projection_key, content_root, git_common_dir, branch, head_sha, dirty
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(projection_key) DO UPDATE SET
       content_root = excluded.content_root,
       git_common_dir = excluded.git_common_dir,
       branch = excluded.branch,
       head_sha = excluded.head_sha,
       dirty = excluded.dirty,
       updated_at = datetime('now')`
  ).run(
    projection.projectionKey,
    projection.contentRoot,
    projection.gitCommonDir,
    projection.branch,
    projection.commit,
    projection.dirty === null ? null : projection.dirty ? 1 : 0
  )
}
