import { describe, expect, it } from "vitest"
import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { readFileSync } from "node:fs"
import { runMigration, EMBEDDED_MIGRATIONS, getSpecHealth, SqliteClient } from "@jamesaphoenix/tx"
import { getSharedTestLayer } from "@jamesaphoenix/tx/testing"

describe("lean upgrade", () => {
  it("preserves existing document links and historical rows when upgrading v48 [INV-LEAN-002] [INV-REQ-LEAN-002]", () => {
    const db = new Database(":memory:")
    try {
      for (const migration of EMBEDDED_MIGRATIONS.filter(m => m.version <= 48)) runMigration(db, migration.version, migration.sql)
      db.exec("INSERT INTO context_pins(id,content) VALUES('keep','Historical'); INSERT INTO task_guards(scope,max_pending,enforce) VALUES('global',0,1)")
      db.exec("INSERT INTO docs(hash,kind,name,title,file_path) VALUES('a','prd','existing-prd','Existing PRD','prd/existing-prd.md'),('b','design','existing-design','Existing design','design/existing-design.md')")
      db.exec("INSERT INTO doc_links(from_doc_id,to_doc_id,link_type) SELECT a.id,b.id,'prd_to_design' FROM docs a,docs b WHERE a.kind='prd' AND b.kind='design'")
      const before = db.prepare("SELECT * FROM doc_links").all()
      runMigration(db, 49, readFileSync("migrations/049_spec_plan_links.sql", "utf8"))
      expect(db.prepare("SELECT * FROM doc_links").all()).toEqual(before)
      expect(db.prepare("SELECT content FROM context_pins WHERE id='keep'").get()).toEqual({content:"Historical"})
      expect(db.prepare("SELECT enforce FROM task_guards").get()).toEqual({enforce:1})
      db.exec("INSERT INTO docs(hash,kind,name,title,file_path) VALUES('c','plan','existing-plan','Plan','plan/existing-plan.md')")
      db.exec("INSERT INTO doc_links(from_doc_id,to_doc_id,link_type) SELECT a.id,b.id,'spec_to_plan' FROM docs a,docs b WHERE a.kind='design' AND b.kind='plan'")
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([])
      expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({foreign_keys:1})
    } finally { db.close() }
  })
})

describe("Spec Health failures", () => {
  it("propagates database read failures instead of reporting healthy evidence [INV-LEAN-004] [INV-REQ-LEAN-004]", async () => {
    const shared = await getSharedTestLayer()
    await Effect.runPromise(Effect.gen(function* () {
      const db = yield* SqliteClient
      db.exec("BEGIN")
      try {
        // eslint-disable-next-line tx/no-inline-sql -- Temporary unavailable-table fault injection, rolled back below.
        db.exec("ALTER TABLE decisions RENAME TO decisions_unavailable")
        const result = yield* Effect.either(getSpecHealth())
        expect(result._tag).toBe("Left")
      } finally { db.exec("ROLLBACK") }
    }).pipe(Effect.provide(shared.layer)))
  })
})
