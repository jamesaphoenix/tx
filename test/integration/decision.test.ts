import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")
const BUN_BIN = process.execPath.includes("bun") ? process.execPath : "bun"
const HAS_BUN =
  process.execPath.includes("bun") ||
  spawnSync("bun", ["--version"], { encoding: "utf-8" }).status === 0

interface ExecResult {
  status: number
  stdout: string
  stderr: string
}

function runTx(args: string[], cwd: string): ExecResult {
  const runner = HAS_BUN ? BUN_BIN : process.execPath
  const runnerArgs = HAS_BUN
    ? [CLI_SRC, ...args]
    : ["--loader", "tsx", CLI_SRC, ...args]

  const res = spawnSync(runner, runnerArgs, {
    cwd,
    encoding: "utf-8",
    timeout: 60000,
  })
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  }
}

describe("Decision commands (Phase 2)", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "tx-decision-"))
    const init = runTx(["init", "--codex"], tmpDir)
    expect(init.status).toBe(0)
  })

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it("creates a decision and shows it in the list", () => {
    const add = runTx(
      ["decision", "add", "Use WAL mode for SQLite"],
      tmpDir,
    )
    expect(add.status).toBe(0)
    expect(add.stdout).toContain("Created decision:")

    const list = runTx(["decision", "list"], tmpDir)
    expect(list.status).toBe(0)
    expect(list.stdout).toContain("Use WAL mode for SQLite")
    expect(list.stdout).toContain("1 decision(s)")
  })

  it("creates a decision with --json output", () => {
    const add = runTx(
      ["decision", "add", "Enable foreign keys", "--json"],
      tmpDir,
    )
    expect(add.status).toBe(0)
    const json = JSON.parse(add.stdout)
    expect(json.content).toBe("Enable foreign keys")
    expect(json.status).toBe("pending")
    expect(json.source).toBe("manual")
    expect(json.id).toMatch(/^dec-[a-f0-9]{12}$/)
  })

  it("shows a decision by id", () => {
    const add = runTx(
      ["decision", "add", "Use Effect-TS", "--json"],
      tmpDir,
    )
    const id = JSON.parse(add.stdout).id

    const show = runTx(["decision", "show", id], tmpDir)
    expect(show.status).toBe(0)
    expect(show.stdout).toContain(`Decision: ${id}`)
    expect(show.stdout).toContain("Status: pending")
    expect(show.stdout).toContain("Content: Use Effect-TS")
  })

  it("approves a pending decision", () => {
    const add = runTx(
      ["decision", "add", "Use SQLite WAL", "--json"],
      tmpDir,
    )
    const id = JSON.parse(add.stdout).id

    const approve = runTx(
      ["decision", "approve", id, "--reviewer", "james", "--note", "LGTM"],
      tmpDir,
    )
    expect(approve.status).toBe(0)
    expect(approve.stdout).toContain(`Approved: ${id}`)
    expect(approve.stdout).toContain("Reviewer: james")
    expect(approve.stdout).toContain("Note: LGTM")

    // Verify status changed
    const show = runTx(["decision", "show", id, "--json"], tmpDir)
    const dec = JSON.parse(show.stdout)
    expect(dec.status).toBe("approved")
    expect(dec.reviewedBy).toBe("james")
  })

  it("rejects a pending decision with reason", () => {
    const add = runTx(
      ["decision", "add", "Use Postgres instead", "--json"],
      tmpDir,
    )
    const id = JSON.parse(add.stdout).id

    const reject = runTx(
      ["decision", "reject", id, "--reason", "Not local-first"],
      tmpDir,
    )
    expect(reject.status).toBe(0)
    expect(reject.stdout).toContain(`Rejected: ${id}`)
    expect(reject.stdout).toContain("Reason: Not local-first")

    const show = runTx(["decision", "show", id, "--json"], tmpDir)
    expect(JSON.parse(show.stdout).status).toBe("rejected")
  })

  it("rejects without --reason fails", () => {
    const add = runTx(
      ["decision", "add", "Use MongoDB", "--json"],
      tmpDir,
    )
    const id = JSON.parse(add.stdout).id

    const reject = runTx(["decision", "reject", id], tmpDir)
    expect(reject.status).not.toBe(0)
    expect(reject.stderr).toContain("--reason is required")
  })

  it("edits a pending decision", () => {
    const add = runTx(
      ["decision", "add", "Use JSON files", "--json"],
      tmpDir,
    )
    const id = JSON.parse(add.stdout).id

    const edit = runTx(
      ["decision", "edit", id, "Use JSONL files instead", "--reviewer", "bot"],
      tmpDir,
    )
    expect(edit.status).toBe(0)
    expect(edit.stdout).toContain(`Edited: ${id}`)
    expect(edit.stdout).toContain("New content: Use JSONL files instead")

    const show = runTx(["decision", "show", id, "--json"], tmpDir)
    const dec = JSON.parse(show.stdout)
    expect(dec.status).toBe("edited")
    expect(dec.editedContent).toBe("Use JSONL files instead")
  })

  it("content-hash dedup returns existing decision", () => {
    const add1 = runTx(
      ["decision", "add", "Exact same content", "--json"],
      tmpDir,
    )
    const id1 = JSON.parse(add1.stdout).id

    const add2 = runTx(
      ["decision", "add", "Exact same content", "--json"],
      tmpDir,
    )
    const id2 = JSON.parse(add2.stdout).id

    // Same content → same decision (dedup)
    expect(id1).toBe(id2)

    // Only one decision exists
    const list = runTx(["decision", "list", "--json"], tmpDir)
    expect(JSON.parse(list.stdout)).toHaveLength(1)
  })

  it("pending shortcut filters to pending only", () => {
    const add1 = runTx(
      ["decision", "add", "Decision A", "--json"],
      tmpDir,
    )
    const id1 = JSON.parse(add1.stdout).id

    runTx(["decision", "add", "Decision B"], tmpDir)

    // Approve first one
    runTx(["decision", "approve", id1], tmpDir)

    // Pending should only show Decision B
    const pending = runTx(["decision", "pending"], tmpDir)
    expect(pending.status).toBe(0)
    expect(pending.stdout).toContain("1 pending decision(s)")
    expect(pending.stdout).toContain("Decision B")
    expect(pending.stdout).not.toContain("Decision A")
  })

  it("list filters by --status and --source", () => {
    runTx(["decision", "add", "Manual decision"], tmpDir)

    const listPending = runTx(
      ["decision", "list", "--status", "pending", "--json"],
      tmpDir,
    )
    expect(JSON.parse(listPending.stdout)).toHaveLength(1)

    const listApproved = runTx(
      ["decision", "list", "--status", "approved", "--json"],
      tmpDir,
    )
    expect(JSON.parse(listApproved.stdout)).toHaveLength(0)

    const listManual = runTx(
      ["decision", "list", "--source", "manual", "--json"],
      tmpDir,
    )
    expect(JSON.parse(listManual.stdout)).toHaveLength(1)
  })

  it("cannot approve already-reviewed decision", () => {
    const add = runTx(
      ["decision", "add", "Already reviewed", "--json"],
      tmpDir,
    )
    const id = JSON.parse(add.stdout).id

    // Approve it first
    runTx(["decision", "approve", id], tmpDir)

    // Try to approve again
    const approve2 = runTx(["decision", "approve", id], tmpDir)
    expect(approve2.status).not.toBe(0)
  })

  it("creates decision with --task and --doc flags", () => {
    // Create a doc first
    runTx(
      ["doc", "add", "design", "my-design", "--title", "My Design"],
      tmpDir,
    )

    const add = runTx(
      [
        "decision", "add", "Use WAL mode",
        "--task", "tx-abc123",
        "--doc", "1",
        "--commit", "abc123def456",
        "--json",
      ],
      tmpDir,
    )
    expect(add.status).toBe(0)
    const dec = JSON.parse(add.stdout)
    expect(dec.taskId).toBe("tx-abc123")
    expect(dec.docId).toBe(1)
    expect(dec.commitSha).toBe("abc123def456")
  })

  it("default subcommand lists decisions", () => {
    runTx(["decision", "add", "Some decision"], tmpDir)

    const result = runTx(["decision"], tmpDir)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("1 decision(s)")
  })

  it("creates decision with --source flag", () => {
    const add = runTx(
      ["decision", "add", "Auto-extracted from diff", "--source", "diff", "--json"],
      tmpDir,
    )
    expect(add.status).toBe(0)
    const dec = JSON.parse(add.stdout)
    expect(dec.source).toBe("diff")

    // Verify invalid source is rejected
    const bad = runTx(
      ["decision", "add", "Bad source", "--source", "invalid"],
      tmpDir,
    )
    expect(bad.status).not.toBe(0)
    expect(bad.stderr).toContain("Invalid --source")
  })

  it("spec health command runs and returns health", () => {
    // Add a decision so spec health has something to report
    runTx(["decision", "add", "Spec health test decision"], tmpDir)

    const tri = runTx(["spec", "health"], tmpDir)
    expect(tri.status).toBe(0)
    expect(tri.stdout).toContain("Spec Health:")
    expect(tri.stdout).toContain("Decisions:")
    expect(tri.stdout).toContain("Doc Drift:")
  })

  it("spec health command supports --json output", () => {
    const tri = runTx(["spec", "health", "--json"], tmpDir)
    expect(tri.status).toBe(0)
    const health = JSON.parse(tri.stdout)
    expect(health.status).toBeDefined()
    expect(health.specTest).toBeDefined()
    expect(health.decisions).toBeDefined()
    expect(health.docDrift).toBeDefined()
    expect(health.specTest.passing).toBeDefined()
    expect(health.specTest.failing).toBeDefined()
    expect(health.specTest.untested).toBeDefined()
    expect(health.specTest.docsComplete).toBeDefined()
    expect(health.specTest.docsHarden).toBeDefined()
    expect(health.specTest.docsBuild).toBeDefined()
    expect(["synced", "drifting", "broken"]).toContain(health.status)
  })

  it("triangle alias still works (backwards compat)", () => {
    const tri = runTx(["triangle", "--json"], tmpDir)
    expect(tri.status).toBe(0)
    const health = JSON.parse(tri.stdout)
    expect(health.status).toBeDefined()
  })

  it("unknown decision subcommand fails gracefully", () => {
    const result = runTx(["decision", "nonexistent"], tmpDir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Unknown decision subcommand")
  })

  it("decision show with missing id fails", () => {
    const result = runTx(["decision", "show"], tmpDir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Usage:")
  })

  it("decision add without content fails", () => {
    const result = runTx(["decision", "add"], tmpDir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Usage:")
  })

  it("decision show with nonexistent id returns error", () => {
    const result = runTx(["decision", "show", "dec-000000000000"], tmpDir)
    expect(result.status).not.toBe(0)
  })

  it("cannot reject already-approved decision", () => {
    const add = runTx(
      ["decision", "add", "Reject after approve", "--json"],
      tmpDir,
    )
    const id = JSON.parse(add.stdout).id

    runTx(["decision", "approve", id], tmpDir)

    const reject = runTx(
      ["decision", "reject", id, "--reason", "Too late"],
      tmpDir,
    )
    expect(reject.status).not.toBe(0)
  })

  it("cannot edit already-approved decision", () => {
    const add = runTx(
      ["decision", "add", "Edit after approve", "--json"],
      tmpDir,
    )
    const id = JSON.parse(add.stdout).id

    runTx(["decision", "approve", id], tmpDir)

    const edit = runTx(
      ["decision", "edit", id, "New content"],
      tmpDir,
    )
    expect(edit.status).not.toBe(0)
  })

  it("cannot reject already-rejected decision", () => {
    const add = runTx(
      ["decision", "add", "Double reject", "--json"],
      tmpDir,
    )
    const id = JSON.parse(add.stdout).id

    runTx(["decision", "reject", id, "--reason", "Nope"], tmpDir)

    const reject2 = runTx(
      ["decision", "reject", id, "--reason", "Still nope"],
      tmpDir,
    )
    expect(reject2.status).not.toBe(0)
  })
})
