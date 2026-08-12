import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Database } from "bun:sqlite"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { resolveWorkspaceContext } from "@jamesaphoenix/tx"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const CLI_TIMEOUT = Number(process.env.CLI_TEST_TIMEOUT ?? (process.env.CI ? 120000 : 60000))
const INHERITED_GIT_KEYS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"] as const

type ExecResult = {
  readonly stdout: string
  readonly stderr: string
  readonly status: number
}

const isolatedGitEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  )

const runTx = (
  cwd: string,
  stateRoot: string,
  contentRoot: string,
  args: readonly string[],
): ExecResult => {
  const result = spawnSync("bun", [
    CLI_SRC,
    ...args,
    "--state-root",
    stateRoot,
    "--content-root",
    contentRoot,
  ], {
    cwd,
    env: isolatedGitEnv(),
    encoding: "utf-8",
    timeout: CLI_TIMEOUT,
  })
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status ?? 1,
  }
}

const runGit = (cwd: string, args: readonly string[]): string => {
  const result = spawnSync("git", args, {
    cwd,
    env: isolatedGitEnv(),
    encoding: "utf-8",
  })
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`)
  }
  return result.stdout.trim()
}

const writeConfig = (contentRoot: string): void => {
  mkdirSync(join(contentRoot, ".tx"), { recursive: true })
  writeFileSync(
    join(contentRoot, ".tx", "config.toml"),
    ["[docs]", 'path = "specs"', "require_ears = false"].join("\n"),
    "utf-8",
  )
}

const specDocument = (rule: string): string => [
  "---",
  "kind: spec",
  "spec_type: prd",
  "name: shared-projection",
  'title: "Shared Projection"',
  "status: draft",
  "version: 1",
  "owners: [test]",
  'summary: "Worktree projection test"',
  "domain: worktree-test",
  "tags: [worktree, projection]",
  "depends_on: []",
  "supersedes: []",
  "implements: null",
  "last_reviewed_at: 2026-08-12",
  "---",
  "",
  "# Summary",
  "Projection isolation test.",
  "",
  "# Problem",
  "Shared task state must not merge checkout-derived spec state.",
  "",
  "# Scope",
  "Included: projection isolation.",
  "",
  "# Requirements",
  "No additional requirements.",
  "",
  "# Acceptance Criteria",
  "- Projections remain independent.",
  "",
  "# Invariants",
  "```yaml",
  "invariants:",
  "  - id: INV-WORKTREE-PROJECTION-001",
  `    statement: "${rule}"`,
  "    severity: high",
  "    verified_by:",
  "      - test/projection.test.ts",
  "```",
  "",
].join("\n")

describe("worktree-scoped spec projections", () => {
  let root: string
  let stateRoot: string
  let checkoutA: string
  let checkoutB: string
  let dbPath: string
  let inheritedGitEnv: Partial<Record<(typeof INHERITED_GIT_KEYS)[number], string>>

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tx-worktree-projection-"))
    inheritedGitEnv = Object.fromEntries(
      INHERITED_GIT_KEYS.flatMap((key) => {
        const value = process.env[key]
        return value === undefined ? [] : [[key, value]]
      }),
    )
    process.env.GIT_DIR = join(root, "inherited.git")
    process.env.GIT_WORK_TREE = join(root, "inherited-worktree")
    process.env.GIT_INDEX_FILE = join(root, "inherited.index")
    stateRoot = join(root, "state")
    checkoutA = join(root, "checkout-a")
    checkoutB = join(root, "checkout-b")
    mkdirSync(stateRoot, { recursive: true })
    mkdirSync(checkoutA, { recursive: true })
    mkdirSync(checkoutB, { recursive: true })

    const init = runTx(checkoutA, stateRoot, checkoutA, ["init", "--codex"])
    expect(init.status).toBe(0)
    writeConfig(checkoutA)
    writeConfig(checkoutB)
    mkdirSync(join(checkoutB, "specs", "prd"), { recursive: true })

    runGit(checkoutA, ["init", "-b", "branch-a"])
    runGit(checkoutA, ["config", "user.email", "tx-tests@example.com"])
    runGit(checkoutA, ["config", "user.name", "tx tests"])
    runGit(checkoutA, ["add", "."])
    runGit(checkoutA, ["-c", "commit.gpgsign=false", "commit", "-m", "initial checkout"])

    stateRoot = realpathSync(stateRoot)
    checkoutA = realpathSync(checkoutA)
    checkoutB = realpathSync(checkoutB)
    dbPath = join(stateRoot, ".tx", "tasks.db")
  })

  afterEach(() => {
    for (const key of INHERITED_GIT_KEYS) {
      const value = inheritedGitEnv[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    if (existsSync(root)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("shares task storage while isolating derived rows and reports worktree hazards", { timeout: 120_000 }, () => {
    const contextA = resolveWorkspaceContext({ stateRoot, contentRoot: checkoutA })
    const contextAAgain = resolveWorkspaceContext({ stateRoot, contentRoot: checkoutA })
    const contextB = resolveWorkspaceContext({ stateRoot, contentRoot: checkoutB })
    expect(contextA.dbPath).toBe(dbPath)
    expect(contextA.projectionKey).toBe(contextAAgain.projectionKey)
    expect(contextA.projectionKey).not.toBe(contextB.projectionKey)

    expect(runTx(checkoutA, stateRoot, checkoutA, [
      "doc", "add", "prd", "shared-projection", "--title", "Shared Projection",
    ]).status).toBe(0)

    const docA = join(checkoutA, "specs", "prd", "shared-projection.md")
    const docB = join(checkoutB, "specs", "prd", "shared-projection.md")
    writeFileSync(docA, specDocument("checkout A rule"), "utf-8")
    writeFileSync(docB, specDocument("checkout B rule"), "utf-8")

    expect(runTx(checkoutA, stateRoot, checkoutA, [
      "doc", "sync", "shared-projection",
    ]).status).toBe(0)
    expect(runTx(checkoutB, stateRoot, checkoutB, [
      "doc", "sync", "shared-projection",
    ]).status).toBe(0)

    const db = new Database(dbPath)
    try {
      const invariantRows = db.prepare(
        `SELECT projection_key, rule
         FROM invariants
         WHERE id = 'INV-WORKTREE-PROJECTION-001'
         ORDER BY projection_key`,
      ).all() as Array<{ projection_key: string; rule: string }>
      expect(invariantRows).toHaveLength(2)
      expect(new Set(invariantRows.map((row) => row.projection_key))).toEqual(
        new Set([contextA.projectionKey, contextB.projectionKey]),
      )
      expect(new Set(invariantRows.map((row) => row.rule))).toEqual(
        new Set(["checkout A rule", "checkout B rule"]),
      )
    } finally {
      db.close()
    }

    const invariantA = JSON.parse(runTx(checkoutA, stateRoot, checkoutA, [
      "invariant", "show", "INV-WORKTREE-PROJECTION-001", "--json",
    ]).stdout) as { rule: string }
    const invariantB = JSON.parse(runTx(checkoutB, stateRoot, checkoutB, [
      "invariant", "show", "INV-WORKTREE-PROJECTION-001", "--json",
    ]).stdout) as { rule: string }
    expect(invariantA.rule).toBe("checkout A rule")
    expect(invariantB.rule).toBe("checkout B rule")

    const driftA = runTx(checkoutA, stateRoot, checkoutA, [
      "doc", "drift", "shared-projection",
    ])
    expect(driftA.status).toBe(0)
    expect(driftA.stdout).not.toContain("Content hash mismatch")

    const testA = join(checkoutA, "test", "projection.test.ts")
    const testB = join(checkoutB, "test", "projection.test.ts")
    mkdirSync(join(checkoutA, "test"), { recursive: true })
    mkdirSync(join(checkoutB, "test"), { recursive: true })
    const taggedTest = 'it("[INV-WORKTREE-PROJECTION-001] isolated mapping", () => {})\n'
    writeFileSync(testA, taggedTest, "utf-8")
    writeFileSync(testB, taggedTest, "utf-8")

    for (const checkout of [checkoutA, checkoutB]) {
      const discover = runTx(checkout, stateRoot, checkout, [
        "spec", "discover", "--doc", "shared-projection",
        "--patterns", "test/**/*.test.ts", "--json",
      ])
      expect(discover.status).toBe(0)
      expect(JSON.parse(discover.stdout)).toMatchObject({ upserted: 1, pruned: 0 })
    }

    writeFileSync(testB, 'it("annotation removed in B", () => {})\n', "utf-8")
    const pruneB = runTx(checkoutB, stateRoot, checkoutB, [
      "spec", "discover", "--doc", "shared-projection",
      "--patterns", "test/**/*.test.ts", "--prune", "--json",
    ])
    expect(pruneB.status).toBe(0)
    expect(JSON.parse(pruneB.stdout)).toMatchObject({
      prospectivePruneCount: 1,
      pruned: 1,
    })

    const afterPrune = new Database(dbPath)
    try {
      const mappings = afterPrune.prepare(
        `SELECT projection_key
         FROM spec_tests
         WHERE invariant_id = 'INV-WORKTREE-PROJECTION-001'`,
      ).all() as Array<{ projection_key: string }>
      expect(mappings).toEqual([{ projection_key: contextA.projectionKey }])
    } finally {
      afterPrune.close()
    }

    writeFileSync(testA, 'it("annotation removed in A", () => {})\n', "utf-8")
    rmSync(docA)

    const doctor = runTx(checkoutA, stateRoot, checkoutA, ["doctor", "--json"])
    expect(doctor.status).toBe(0)
    const doctorJson = JSON.parse(doctor.stdout) as {
      workspace: {
        databasePath: string
        stateRoot: string
        contentRoot: string
        projectionKey: string
        branch: string | null
        commit: string | null
        missingRegisteredFiles: Array<{ docId: string; filePath: string }>
        prospectivePruneCount: number | null
        prospectivePrunes: Array<{ invariantId: string; testId: string }>
      }
    }
    expect(doctorJson.workspace).toMatchObject({
      databasePath: dbPath,
      stateRoot,
      contentRoot: checkoutA,
      projectionKey: contextA.projectionKey,
      branch: "branch-a",
      commit: runGit(checkoutA, ["rev-parse", "HEAD"]),
      prospectivePruneCount: 1,
    })
    expect(doctorJson.workspace.missingRegisteredFiles).toEqual([
      expect.objectContaining({ filePath: "prd/shared-projection.md" }),
    ])
    expect(doctorJson.workspace.prospectivePrunes).toEqual([
      expect.objectContaining({
        invariantId: "INV-WORKTREE-PROJECTION-001",
        testId: "test/projection.test.ts::[INV-WORKTREE-PROJECTION-001] isolated mapping",
      }),
    ])

    const finalDb = new Database(dbPath)
    try {
      expect((finalDb.prepare(
        `SELECT COUNT(*) AS count
         FROM spec_tests
         WHERE projection_key = ? AND invariant_id = 'INV-WORKTREE-PROJECTION-001'`,
      ).get(contextA.projectionKey) as { count: number }).count).toBe(1)
    } finally {
      finalDb.close()
    }
  })
})
