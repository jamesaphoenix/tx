import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Database } from "bun:sqlite"
import { TxClient } from "@jamesaphoenix/tx-agent-sdk"
import { fixtureId } from "../fixtures.js"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")

const runTx = (args: string[], cwd: string) =>
  spawnSync("bun", [CLI_SRC, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 20000,
  })

describe("TxClient direct mode integration", () => {
  let tmpProjectDir: string
  let dbPath: string
  let db: Database
  let originalCwd: string

  beforeAll(() => {
    originalCwd = process.cwd()
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-agent-sdk-direct-"))
    mkdirSync(join(tmpProjectDir, ".tx"), { recursive: true })
    dbPath = join(tmpProjectDir, ".tx", "tasks.db")

    const init = runTx(["init", "--db", dbPath], tmpProjectDir)
    if ((init.status ?? 1) !== 0) {
      throw new Error(init.stderr || init.stdout || "Failed to initialize direct-mode test database")
    }

    db = new Database(dbPath)
  })

  afterEach(() => {
    db.exec("DELETE FROM spec_signoffs")
    db.exec("DELETE FROM spec_test_runs")
    db.exec("DELETE FROM spec_tests")
    db.exec("DELETE FROM invariant_checks")
    db.exec("DELETE FROM invariants")
    db.exec("DELETE FROM doc_links")
    db.exec("DELETE FROM docs")
    db.exec("DELETE FROM events")
    db.exec("DELETE FROM run_heartbeat_state")
    db.exec("DELETE FROM runs")

    rmSync(join(tmpProjectDir, ".tx", "docs"), { recursive: true, force: true })
    rmSync(join(tmpProjectDir, ".tx", "runs"), { recursive: true, force: true })
  })

  afterAll(() => {
    process.chdir(originalCwd)
    db.close()
    if (existsSync(tmpProjectDir)) {
      rmSync(tmpProjectDir, { recursive: true, force: true })
    }
  })

  it("supports spec traceability flows in direct mode", async () => {
    process.chdir(tmpProjectDir)
    mkdirSync(join(tmpProjectDir, ".tx", "docs", "prd"), { recursive: true })
    mkdirSync(join(tmpProjectDir, ".tx", "docs", "design"), { recursive: true })
    writeFileSync(
      join(tmpProjectDir, ".tx", "config.toml"),
      ['[docs]', 'path = ".tx/docs"', "require_ears = false"].join("\n"),
      "utf8"
    )

    const tx = new TxClient({ dbPath })
    const docName = `PRD-${fixtureId("agent-sdk-direct:spec-doc").slice(3)}`
    const invariantId = `INV-${fixtureId("agent-sdk-direct:spec-invariant").slice(3).toUpperCase()}`

    await tx.docs.create({
      kind: "prd",
      name: docName,
      title: "Direct SDK Spec",
      yamlContent: [
        "kind: prd",
        `name: ${docName}`,
        "title: Direct SDK Spec",
        "status: changing",
        "",
        "invariants:",
        `  - id: ${invariantId}`,
        "    rule: direct sdk invariant",
        "    enforcement: integration_test",
      ].join("\n"),
    })

    const discover = await tx.spec.discover({ doc: docName, patterns: ["test/**/*.ts"] })
    expect(discover.discoveredLinks).toBe(0)

    const linked = await tx.spec.link(invariantId, "test/integration/direct-sdk.test.ts", "direct sdk case", "vitest")
    expect(linked.testId).toBe("test/integration/direct-sdk.test.ts::direct sdk case")

    const tests = await tx.spec.tests(invariantId)
    expect(tests).toHaveLength(1)

    const run = await tx.spec.run(linked.testId, true, { durationMs: 9, details: "passed" })
    expect(run.recorded).toBe(1)

    const status = await tx.spec.status({ doc: docName })
    expect(status.phase).toBe("HARDEN")
    expect(status.fci).toBe(100)
    expect(status.blockers).toEqual(["Human COMPLETE sign-off not recorded"])
    expect(status.signedOff).toBe(false)

    const matrix = await tx.spec.matrix({ doc: docName })
    expect(matrix).toHaveLength(1)
    expect(matrix[0]?.tests[0]?.latestRun.passed).toBe(true)

    const signoff = await tx.spec.complete({ doc: docName, signedOffBy: "direct-reviewer", notes: "approved" })
    expect(signoff.scopeType).toBe("doc")
    expect(signoff.scopeValue).toBe(docName)
    expect(signoff.signedOffBy).toBe("direct-reviewer")
  })

  it("supports traced run inspection in direct mode", async () => {
    process.chdir(tmpProjectDir)
    mkdirSync(join(tmpProjectDir, ".tx", "runs"), { recursive: true })

    const runId = `run-${fixtureId("agent-sdk-direct:run").slice(3)}`
    const now = new Date().toISOString()
    const transcriptPath = join(tmpProjectDir, ".tx", "runs", `${runId}.jsonl`)
    const stderrPath = join(tmpProjectDir, ".tx", "runs", `${runId}.stderr`)

    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({
          type: "user",
          message: { role: "user", content: "show errors" },
          timestamp: now,
          uuid: "direct-sdk-run-user",
        }),
        JSON.stringify({
          type: "assistant",
          message: { role: "assistant", content: [{ type: "tool_use", id: "tool-1", name: "Read", input: { file: "README.md" } }] },
          timestamp: now,
          uuid: "direct-sdk-run-tool",
        }),
        JSON.stringify({
          type: "user",
          message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1", content: "README loaded" }] },
          timestamp: now,
          uuid: "direct-sdk-run-tool-result",
        }),
      ].join("\n")
    )
    writeFileSync(stderrPath, "stderr line 1\nstderr line 2\n")

    db.prepare(
      `INSERT INTO runs (id, task_id, agent, started_at, ended_at, status, pid, transcript_path, stderr_path, error_message, metadata)
       VALUES (?, NULL, 'tx-implementer', ?, ?, 'failed', NULL, ?, ?, ?, '{}')`
    ).run(runId, now, now, transcriptPath, stderrPath, "direct run failed")

    db.prepare(
      `INSERT INTO events (timestamp, event_type, run_id, task_id, agent, content, metadata, duration_ms)
       VALUES (?, 'span', ?, NULL, 'tx-implementer', 'DirectTransport.getRun', ?, 17)`
    ).run(now, runId, JSON.stringify({ status: "error", error: "span exploded" }))

    const tx = new TxClient({ dbPath })

    const list = await tx.runs.list({ status: "failed", limit: 10 })
    expect(list.runs.some((run) => run.id === runId)).toBe(true)

    const detail = await tx.runs.get(runId)
    expect(detail.run.id).toBe(runId)
    expect(detail.messages.some((message) => message.type === "tool_use")).toBe(true)
    expect(detail.logs.stderr).toContain("stderr line 1")

    const transcript = await tx.runs.transcript(runId)
    expect(transcript.some((message) => message.type === "tool_result" && message.toolName === "Read")).toBe(true)

    const stderr = await tx.runs.stderr(runId, { tail: 1 })
    expect(stderr.content.trim()).toBe("stderr line 2")
    expect(stderr.truncated).toBe(true)

    const errors = await tx.runs.errors({ hours: 24, limit: 10 })
    expect(errors.some((entry) => entry.source === "run" && entry.runId === runId && entry.error === "direct run failed")).toBe(true)
    expect(errors.some((entry) => entry.source === "span" && entry.runId === runId && entry.error === "span exploded")).toBe(true)
  })
})
