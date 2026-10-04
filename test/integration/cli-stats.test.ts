import {describe, it, expect, beforeEach, afterEach} from "vitest"
import {mkdtempSync, rmSync} from "node:fs"
import {join, resolve} from "node:path"
import {tmpdir} from "node:os"
import {spawnSync} from "node:child_process"
import {createMigratedSqliteDatabase, fixtureId} from "@jamesaphoenix/tx/testing"
import type {Database} from "bun:sqlite"

const cli = resolve("apps/cli/src/cli.ts")
describe("CLI task statistics", () => {
  let root: string, dbPath: string, db: Database
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(),"tx-cli-stats-"))
    dbPath = join(root,"tasks.db")
    db = await createMigratedSqliteDatabase(dbPath)
  })
  afterEach(() => { db.close(); rmSync(root,{recursive:true,force:true}) })
  it("keeps retired claim metrics out of both output formats", () => {
    for (const args of [[], ["--json"]]) {
      const result = spawnSync("bun",[cli,"diag","stats",...args,"--db",dbPath],{cwd:root,encoding:"utf8"})
      expect(result.status,result.stderr).toBe(0)
      expect(result.stdout.toLowerCase()).not.toContain("claims")
    }
  })
  it("counts ISO completions by elapsed time rather than string ordering", () => {
    const now = Date.now()
    for (const hours of [1,25,169,192]) {
      const stamp = new Date(now - hours*3_600_000).toISOString()
      db.prepare("INSERT INTO tasks(id,title,status,created_at,updated_at,completed_at) VALUES(?,?,'done',?,?,?)").run(fixtureId(`stats-${hours}`),`Done ${hours} hours ago`,stamp,stamp,stamp)
    }
    const result = spawnSync("bun",[cli,"diag","stats","--json","--db",dbPath],{cwd:root,encoding:"utf8"})
    expect(result.status,result.stderr).toBe(0)
    const stats = JSON.parse(result.stdout)
    expect(stats.activity.last24h).toBe(1)
    expect(stats.activity.last7d).toBe(2)
    expect(stats.byStatus.done).toBe(4)
  })
})
