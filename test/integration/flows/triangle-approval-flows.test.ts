import { Database } from "bun:sqlite"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { computeDocHash } from "@jamesaphoenix/tx-core"

const CLI_SRC = resolve(__dirname, "../../../apps/cli/src/cli.ts")
const CLI_TIMEOUT = Number(process.env.CLI_TEST_TIMEOUT ?? (process.env.CI ? 120000 : 60000))
// Each flow test spawns 10-20+ CLI commands via spawnSync; the default 10s vitest timeout is insufficient in CI.
const FLOW_TEST_TIMEOUT = process.env.CI ? 120_000 : 60_000

type ExecResult = {
  readonly stdout: string
  readonly stderr: string
  readonly status: number
}

type InvariantInput = {
  readonly id: string
  readonly rule: string
}

type TriangleHealth = {
  readonly status: "synced" | "drifting" | "broken"
  readonly specTest: {
    readonly total: number
    readonly covered: number
    readonly uncovered: number
    readonly coveragePercent: number
    readonly passing: number
    readonly failing: number
    readonly untested: number
    readonly docsComplete: number
    readonly docsHarden: number
    readonly docsBuild: number
  }
  readonly decisions: {
    readonly pending: number
    readonly approvedUnsynced: number
    readonly total: number
  }
  readonly docDrift: {
    readonly driftedDocs: number
    readonly totalDocs: number
  }
}

const runTx = (cwd: string, dbPath: string, args: string[], input?: string): ExecResult => {
  const result = spawnSync("bun", [CLI_SRC, ...args, "--db", dbPath], {
    cwd,
    encoding: "utf-8",
    timeout: CLI_TIMEOUT,
    input,
  })

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status ?? 1,
  }
}

const expectOk = (result: ExecResult, context: string): ExecResult => {
  expect(result.status, `${context}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
  return result
}

const parseJson = <T>(result: ExecResult): T => JSON.parse(result.stdout) as T

const writeRelative = (cwd: string, relativePath: string, content: string): void => {
  const absPath = join(cwd, relativePath)
  mkdirSync(dirname(absPath), { recursive: true })
  writeFileSync(absPath, content, "utf-8")
}

const writeDocsConfig = (cwd: string): void => {
  writeRelative(cwd, ".tx/config.toml", [
    "[docs]",
    'path = "specs"',
    "require_ears = false",
    "",
    "[spec]",
    'test_patterns = ["test/**/*.test.ts"]',
  ].join("\n"))
}

const renderPrdYaml = (
  name: string,
  title: string,
  invariants: readonly InvariantInput[],
): string => [
  "kind: prd",
  `name: ${name}`,
  `title: "${title}"`,
  "status: changing",
  "",
  "problem: |",
  `  ${title} should keep docs, code, tests, and approvals aligned.`,
  "",
  "solution: |",
  `  Track ${title.toLowerCase()} with explicit invariants and flow-level checks.`,
  "",
  "invariants:",
  ...invariants.flatMap((invariant) => [
    `  - id: ${invariant.id}`,
    `    rule: ${invariant.rule}`,
    "    enforcement: integration_test",
  ]),
  "",
].join("\n")

const syncPrdYaml = (
  cwd: string,
  dbPath: string,
  name: string,
  title: string,
  invariants: readonly InvariantInput[],
): void => {
  const yaml = renderPrdYaml(name, title, invariants)
  writeRelative(cwd, `specs/prd/${name}.yml`, yaml)

  const db = new Database(dbPath)
  try {
    db.prepare("UPDATE docs SET hash = ?, title = ? WHERE name = ?").run(
      computeDocHash(yaml),
      title,
      name,
    )
  } finally {
    db.close()
  }
}

const addPrd = (cwd: string, dbPath: string, name: string, title: string): void => {
  expectOk(
    runTx(cwd, dbPath, ["doc", "add", "prd", name, "--title", title]),
    `tx doc add prd ${name}`,
  )
}

const createApprovedDecision = (cwd: string, dbPath: string, taskTitle: string, content: string): string => {
  const task = parseJson<{ id: string }>(
    expectOk(runTx(cwd, dbPath, ["add", taskTitle, "--json"]), `tx add ${taskTitle}`),
  )
  const decision = parseJson<{ id: string }>(
    expectOk(
      runTx(cwd, dbPath, ["decision", "add", content, "--task", task.id, "--json"]),
      `tx decision add ${content}`,
    ),
  )

  expectOk(
    runTx(cwd, dbPath, ["decision", "approve", decision.id, "--reviewer", "architect", "--note", "approved", "--json"]),
    `tx decision approve ${decision.id}`,
  )

  return decision.id
}

const createPendingDecision = (cwd: string, dbPath: string, taskTitle: string, content: string): string => {
  const task = parseJson<{ id: string }>(
    expectOk(runTx(cwd, dbPath, ["add", taskTitle, "--json"]), `tx add ${taskTitle}`),
  )
  const decision = parseJson<{ id: string }>(
    expectOk(
      runTx(cwd, dbPath, ["decision", "add", content, "--task", task.id, "--json"]),
      `tx decision add ${content}`,
    ),
  )

  return decision.id
}

const specDiscover = (cwd: string, dbPath: string, doc: string) =>
  expectOk(
    runTx(cwd, dbPath, ["spec", "discover", "--doc", doc, "--patterns", "test/**/*.test.ts", "--json"]),
    `tx spec discover --doc ${doc}`,
  )

const specRunPassed = (cwd: string, dbPath: string, testId: string): void => {
  expectOk(
    runTx(cwd, dbPath, ["spec", "run", testId, "--passed", "--json"]),
    `tx spec run ${testId}`,
  )
}

const specRunFailed = (cwd: string, dbPath: string, testId: string): void => {
  expectOk(
    runTx(cwd, dbPath, ["spec", "run", testId, "--failed", "--json"]),
    `tx spec run ${testId} --failed`,
  )
}

const specStatus = (cwd: string, dbPath: string, doc: string) =>
  parseJson<{ phase: string; fci: number; gaps: number; total: number }>(
    expectOk(runTx(cwd, dbPath, ["spec", "status", "--doc", doc, "--json"]), `tx spec status --doc ${doc}`),
  )

const specHealth = (cwd: string, dbPath: string) =>
  parseJson<TriangleHealth>(
    expectOk(runTx(cwd, dbPath, ["spec", "health", "--json"]), "tx spec health --json"),
  )

describe("Triangle approval flow fixtures", { timeout: FLOW_TEST_TIMEOUT }, () => {
  let cwd: string
  let dbPath: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "tx-flow-triangle-"))
    mkdirSync(join(cwd, ".tx"), { recursive: true })
    dbPath = join(cwd, ".tx", "tasks.db")

    expectOk(runTx(cwd, dbPath, ["init", "--codex"]), "tx init --codex")
    writeDocsConfig(cwd)
  })

  afterEach(() => {
    if (existsSync(cwd)) {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it("marks triangle health synced when spec coverage closes and COMPLETE sign-off is recorded", () => {
    addPrd(cwd, dbPath, "payments-triangle", "Payments Triangle")
    syncPrdYaml(cwd, dbPath, "payments-triangle", "Payments Triangle", [
      { id: "INV-TRI-PAYMENTS-001", rule: "compute subtotal deterministically" },
      { id: "INV-TRI-PAYMENTS-002", rule: "apply tax with two decimals" },
    ])

    writeRelative(cwd, "src/programs/payments/subtotal.ts", [
      "export const subtotal = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0)",
      "",
    ].join("\n"))
    writeRelative(cwd, "src/programs/payments/tax.ts", [
      "export const applyTax = (amount: number, rate: number): number => Math.round(amount * (1 + rate) * 100) / 100",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/payments/subtotal.test.ts", [
      'import { it, expect } from "vitest"',
      'import { subtotal } from "../../../src/programs/payments/subtotal"',
      "",
      'it("[INV-TRI-PAYMENTS-001] computes subtotal deterministically", () => {',
      "  expect(subtotal([10, 15, 20])).toBe(45)",
      "})",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/payments/tax.test.ts", [
      'import { it, expect } from "vitest"',
      'import { applyTax } from "../../../src/programs/payments/tax"',
      "",
      "// @spec INV-TRI-PAYMENTS-002",
      'it("applies tax with two decimals", () => {',
      "  expect(applyTax(12.5, 0.2)).toBe(15)",
      "})",
      "",
    ].join("\n"))

    const discover = parseJson<{ discoveredLinks: number }>(specDiscover(cwd, dbPath, "payments-triangle"))
    expect(discover.discoveredLinks).toBe(2)

    specRunPassed(cwd, dbPath, "test/programs/payments/subtotal.test.ts::[INV-TRI-PAYMENTS-001] computes subtotal deterministically")
    specRunPassed(cwd, dbPath, "test/programs/payments/tax.test.ts::applies tax with two decimals")

    const complete = parseJson<{ signedOffBy: string }>(
      expectOk(
        runTx(cwd, dbPath, ["spec", "complete", "--doc", "payments-triangle", "--by", "release-manager", "--json"]),
        "tx spec complete payments-triangle",
      ),
    )
    expect(complete.signedOffBy).toBe("release-manager")

    const status = specStatus(cwd, dbPath, "payments-triangle")
    expect(status.phase).toBe("COMPLETE")
    expect(status.fci).toBe(100)

    const health = specHealth(cwd, dbPath)
    expect(health.status).toBe("synced")
    expect(health.specTest).toEqual({
      total: 2,
      covered: 2,
      uncovered: 0,
      coveragePercent: 100,
      passing: 2,
      failing: 0,
      untested: 0,
      docsComplete: 1,
      docsHarden: 0,
      docsBuild: 0,
    })
    expect(health.decisions.total).toBe(0)
    expect(health.docDrift.driftedDocs).toBe(0)
  })

  it("keeps triangle health drifting when global discover leaves one doc COMPLETE and another doc at HARDEN", () => {
    addPrd(cwd, dbPath, "accounts-global-loop", "Accounts Global Loop")
    addPrd(cwd, dbPath, "ledger-global-loop", "Ledger Global Loop")

    syncPrdYaml(cwd, dbPath, "accounts-global-loop", "Accounts Global Loop", [
      { id: "INV-TRI-ACCOUNTS-001", rule: "normalize account ids" },
    ])
    syncPrdYaml(cwd, dbPath, "ledger-global-loop", "Ledger Global Loop", [
      { id: "INV-TRI-LEDGER-001", rule: "keep ledger entries balanced" },
    ])

    writeRelative(cwd, "src/programs/accounts/normalize-id.ts", [
      'export const normalizeAccountId = (value: string): string => value.trim().toUpperCase()',
      "",
    ].join("\n"))
    writeRelative(cwd, "src/programs/ledger/is-balanced.ts", [
      "export const isBalanced = (debits: number, credits: number): boolean => debits === credits",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/accounts/normalize-id.test.ts", [
      'import { it, expect } from "vitest"',
      'import { normalizeAccountId } from "../../../src/programs/accounts/normalize-id"',
      "",
      'it("[INV-TRI-ACCOUNTS-001] normalizes account ids", () => {',
      '  expect(normalizeAccountId(" acct-7 ")).toBe("ACCT-7")',
      "})",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/ledger/is-balanced.test.ts", [
      'import { it, expect } from "vitest"',
      'import { isBalanced } from "../../../src/programs/ledger/is-balanced"',
      "",
      'it("[INV-TRI-LEDGER-001] keeps ledger entries balanced", () => {',
      "  expect(isBalanced(25, 25)).toBe(true)",
      "})",
      "",
    ].join("\n"))

    const discover = parseJson<{ discoveredLinks: number }>(
      expectOk(
        runTx(cwd, dbPath, ["spec", "discover", "--patterns", "test/**/*.test.ts", "--json"]),
        "tx spec discover global mixed closure",
      ),
    )
    expect(discover.discoveredLinks).toBe(2)

    specRunPassed(
      cwd,
      dbPath,
      "test/programs/accounts/normalize-id.test.ts::[INV-TRI-ACCOUNTS-001] normalizes account ids",
    )
    specRunPassed(
      cwd,
      dbPath,
      "test/programs/ledger/is-balanced.test.ts::[INV-TRI-LEDGER-001] keeps ledger entries balanced",
    )

    expectOk(
      runTx(cwd, dbPath, ["spec", "complete", "--doc", "accounts-global-loop", "--by", "accounts-qa", "--json"]),
      "tx spec complete accounts-global-loop",
    )

    const accountsStatus = specStatus(cwd, dbPath, "accounts-global-loop")
    const ledgerStatus = specStatus(cwd, dbPath, "ledger-global-loop")
    expect(accountsStatus.phase).toBe("COMPLETE")
    expect(ledgerStatus.phase).toBe("HARDEN")

    const health = specHealth(cwd, dbPath)
    expect(health.status).toBe("drifting")
    expect(health.specTest).toEqual({
      total: 2,
      covered: 2,
      uncovered: 0,
      coveragePercent: 100,
      passing: 2,
      failing: 0,
      untested: 0,
      docsComplete: 1,
      docsHarden: 1,
      docsBuild: 0,
    })
    expect(health.decisions.total).toBe(0)
    expect(health.docDrift.driftedDocs).toBe(0)
  })

  it("keeps triangle health drifting when a decision is approved before the spec loop is closed", () => {
    addPrd(cwd, dbPath, "auth-approval-gap", "Auth Approval Gap")
    syncPrdYaml(cwd, dbPath, "auth-approval-gap", "Auth Approval Gap", [
      { id: "INV-TRI-AUTH-001", rule: "issue session tokens" },
      { id: "INV-TRI-AUTH-002", rule: "reject expired sessions" },
    ])

    writeRelative(cwd, "src/programs/auth/session-token.ts", [
      "export const createToken = (userId: string): string => `session:${userId}`",
      "",
    ].join("\n"))
    writeRelative(cwd, "src/programs/auth/session-validity.ts", [
      "export const isExpired = (expiresAt: number, now: number): boolean => expiresAt <= now",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/auth/session-token.test.ts", [
      'import { it, expect } from "vitest"',
      'import { createToken } from "../../../src/programs/auth/session-token"',
      "",
      'it("[INV-TRI-AUTH-001] issues session tokens", () => {',
      '  expect(createToken("u-1")).toBe("session:u-1")',
      "})",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/auth/session-validity.test.ts", [
      'import { it, expect } from "vitest"',
      'import { isExpired } from "../../../src/programs/auth/session-validity"',
      "",
      "// @spec INV-TRI-AUTH-002",
      'it("rejects expired sessions", () => {',
      "  expect(isExpired(10, 11)).toBe(true)",
      "})",
      "",
    ].join("\n"))

    const discover = parseJson<{ discoveredLinks: number }>(specDiscover(cwd, dbPath, "auth-approval-gap"))
    expect(discover.discoveredLinks).toBe(2)

    createApprovedDecision(cwd, dbPath, "Auth approval review", "Keep token format stable")

    const status = specStatus(cwd, dbPath, "auth-approval-gap")
    expect(status.phase).toBe("BUILD")
    expect(status.fci).toBe(0)

    const health = specHealth(cwd, dbPath)
    expect(health.status).toBe("drifting")
    expect(health.specTest).toEqual({
      total: 2,
      covered: 2,
      uncovered: 0,
      coveragePercent: 100,
      passing: 0,
      failing: 0,
      untested: 2,
      docsComplete: 0,
      docsHarden: 0,
      docsBuild: 1,
    })
    expect(health.decisions.approvedUnsynced).toBe(1)
    expect(health.decisions.total).toBe(1)
    expect(health.docDrift.driftedDocs).toBe(0)
  })

  it("keeps triangle health drifting at HARDEN until human spec approval is recorded", () => {
    addPrd(cwd, dbPath, "shipping-harden", "Shipping Harden")
    syncPrdYaml(cwd, dbPath, "shipping-harden", "Shipping Harden", [
      { id: "INV-TRI-SHIPPING-001", rule: "normalize postal codes" },
      { id: "INV-TRI-SHIPPING-002", rule: "format labels consistently" },
    ])

    writeRelative(cwd, "src/programs/shipping/postal-code.ts", [
      "export const normalizePostalCode = (value: string): string => value.trim().toUpperCase()",
      "",
    ].join("\n"))
    writeRelative(cwd, "src/programs/shipping/label.ts", [
      "export const formatLabel = (name: string, postalCode: string): string => `${name}::${postalCode}`",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/shipping/postal-code.test.ts", [
      'import { it, expect } from "vitest"',
      'import { normalizePostalCode } from "../../../src/programs/shipping/postal-code"',
      "",
      'it("[INV-TRI-SHIPPING-001] normalizes postal codes", () => {',
      '  expect(normalizePostalCode(" sw1a 1aa ")).toBe("SW1A 1AA")',
      "})",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/shipping/label.test.ts", [
      'import { it, expect } from "vitest"',
      'import { formatLabel } from "../../../src/programs/shipping/label"',
      "",
      "// @spec INV-TRI-SHIPPING-002",
      'it("formats labels consistently", () => {',
      '  expect(formatLabel("James", "SW1A 1AA")).toBe("James::SW1A 1AA")',
      "})",
      "",
    ].join("\n"))

    specDiscover(cwd, dbPath, "shipping-harden")
    specRunPassed(cwd, dbPath, "test/programs/shipping/postal-code.test.ts::[INV-TRI-SHIPPING-001] normalizes postal codes")
    specRunPassed(cwd, dbPath, "test/programs/shipping/label.test.ts::formats labels consistently")

    const status = specStatus(cwd, dbPath, "shipping-harden")
    expect(status.phase).toBe("HARDEN")
    expect(status.fci).toBe(100)

    const health = specHealth(cwd, dbPath)
    expect(health.status).toBe("drifting")
    expect(health.specTest.docsHarden).toBe(1)
    expect(health.specTest.docsComplete).toBe(0)
    expect(health.specTest.docsBuild).toBe(0)
  })

  it("keeps triangle health drifting after COMPLETE when an approved decision remains unsynced", () => {
    addPrd(cwd, dbPath, "queue-approval-loop", "Queue Approval Loop")
    syncPrdYaml(cwd, dbPath, "queue-approval-loop", "Queue Approval Loop", [
      { id: "INV-TRI-QUEUE-001", rule: "enqueue in FIFO order" },
      { id: "INV-TRI-QUEUE-002", rule: "dequeue the oldest item" },
    ])

    writeRelative(cwd, "src/programs/queue/enqueue.ts", [
      "export const enqueue = <T>(items: readonly T[], item: T): readonly T[] => [...items, item]",
      "",
    ].join("\n"))
    writeRelative(cwd, "src/programs/queue/dequeue.ts", [
      "export const dequeue = <T>(items: readonly T[]): readonly [T | null, readonly T[]] => items.length === 0 ? [null, []] : [items[0] ?? null, items.slice(1)]",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/queue/enqueue.test.ts", [
      'import { it, expect } from "vitest"',
      'import { enqueue } from "../../../src/programs/queue/enqueue"',
      "",
      'it("[INV-TRI-QUEUE-001] enqueues in FIFO order", () => {',
      "  expect(enqueue([\"a\"], \"b\")).toEqual([\"a\", \"b\"])",
      "})",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/queue/dequeue.test.ts", [
      'import { it, expect } from "vitest"',
      'import { dequeue } from "../../../src/programs/queue/dequeue"',
      "",
      "// @spec INV-TRI-QUEUE-002",
      'it("dequeues the oldest item", () => {',
      "  expect(dequeue([\"a\", \"b\"])).toEqual([\"a\", [\"b\"]])",
      "})",
      "",
    ].join("\n"))

    specDiscover(cwd, dbPath, "queue-approval-loop")
    specRunPassed(cwd, dbPath, "test/programs/queue/enqueue.test.ts::[INV-TRI-QUEUE-001] enqueues in FIFO order")
    specRunPassed(cwd, dbPath, "test/programs/queue/dequeue.test.ts::dequeues the oldest item")

    expectOk(
      runTx(cwd, dbPath, ["spec", "complete", "--doc", "queue-approval-loop", "--by", "queue-qa", "--json"]),
      "tx spec complete queue-approval-loop",
    )
    createApprovedDecision(cwd, dbPath, "Queue approval review", "Preserve FIFO ordering decision")

    const status = specStatus(cwd, dbPath, "queue-approval-loop")
    expect(status.phase).toBe("COMPLETE")
    expect(status.fci).toBe(100)

    const health = specHealth(cwd, dbPath)
    expect(health.status).toBe("drifting")
    expect(health.specTest.coveragePercent).toBe(100)
    expect(health.specTest.docsComplete).toBe(1)
    expect(health.decisions.approvedUnsynced).toBe(1)
    expect(health.docDrift.driftedDocs).toBe(0)
  })

  it("reopens triangle coverage when docs move ahead of code and closes it again after catch-up", () => {
    addPrd(cwd, dbPath, "orders-triangle-catchup", "Orders Triangle Catchup")
    syncPrdYaml(cwd, dbPath, "orders-triangle-catchup", "Orders Triangle Catchup", [
      { id: "INV-TRI-ORDERS-001", rule: "sum line items into a subtotal" },
    ])

    writeRelative(cwd, "src/programs/orders/subtotal.ts", [
      "export const subtotal = (items: readonly number[]): number => items.reduce((sum, value) => sum + value, 0)",
      "",
    ].join("\n"))
    writeRelative(cwd, "src/programs/orders/cents.ts", [
      "export const toCents = (value: number): number => Math.round(value * 100)",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/orders/subtotal.test.ts", [
      'import { it, expect } from "vitest"',
      'import { subtotal } from "../../../src/programs/orders/subtotal"',
      "",
      'it("[INV-TRI-ORDERS-001] sums line items into a subtotal", () => {',
      "  expect(subtotal([5, 7, 9])).toBe(21)",
      "})",
      "",
    ].join("\n"))

    specDiscover(cwd, dbPath, "orders-triangle-catchup")
    specRunPassed(cwd, dbPath, "test/programs/orders/subtotal.test.ts::[INV-TRI-ORDERS-001] sums line items into a subtotal")
    expectOk(
      runTx(cwd, dbPath, ["spec", "complete", "--doc", "orders-triangle-catchup", "--by", "orders-qa", "--json"]),
      "tx spec complete orders-triangle-catchup initial",
    )

    const initialHealth = specHealth(cwd, dbPath)
    expect(initialHealth.status).toBe("synced")
    expect(initialHealth.specTest.coveragePercent).toBe(100)
    expect(initialHealth.specTest.docsComplete).toBe(1)

    syncPrdYaml(cwd, dbPath, "orders-triangle-catchup", "Orders Triangle Catchup", [
      { id: "INV-TRI-ORDERS-001", rule: "sum line items into a subtotal" },
      { id: "INV-TRI-ORDERS-002", rule: "round order totals to cents" },
    ])

    specDiscover(cwd, dbPath, "orders-triangle-catchup")

    const afterDocChange = specHealth(cwd, dbPath)
    expect(afterDocChange.status).toBe("drifting")
    expect(afterDocChange.specTest).toEqual({
      total: 2,
      covered: 1,
      uncovered: 1,
      coveragePercent: 50,
      passing: 1,
      failing: 0,
      untested: 0,
      docsComplete: 0,
      docsHarden: 0,
      docsBuild: 1,
    })

    writeRelative(cwd, "test/programs/orders/cents.test.ts", [
      'import { it, expect } from "vitest"',
      'import { toCents } from "../../../src/programs/orders/cents"',
      "",
      "// @spec INV-TRI-ORDERS-002",
      'it("rounds order totals to cents", () => {',
      "  expect(toCents(10.235)).toBe(1024)",
      "})",
      "",
    ].join("\n"))

    specDiscover(cwd, dbPath, "orders-triangle-catchup")
    specRunPassed(cwd, dbPath, "test/programs/orders/cents.test.ts::rounds order totals to cents")

    const afterCodeCatchUp = specHealth(cwd, dbPath)
    expect(afterCodeCatchUp.status).toBe("synced")
    expect(afterCodeCatchUp.specTest).toEqual({
      total: 2,
      covered: 2,
      uncovered: 0,
      coveragePercent: 100,
      passing: 2,
      failing: 0,
      untested: 0,
      docsComplete: 1,
      docsHarden: 0,
      docsBuild: 0,
    })
    expect(afterCodeCatchUp.docDrift.driftedDocs).toBe(0)
  })

  it("marks triangle health broken when a latest recorded spec run fails", () => {
    addPrd(cwd, dbPath, "pricing-failure", "Pricing Failure")
    syncPrdYaml(cwd, dbPath, "pricing-failure", "Pricing Failure", [
      { id: "INV-TRI-PRICING-001", rule: "round discounts to cents" },
    ])

    writeRelative(cwd, "src/programs/pricing/discount.ts", [
      "export const applyDiscount = (amount: number, percent: number): number => Math.round(amount * (1 - percent) * 100) / 100",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/pricing/discount.test.ts", [
      'import { it, expect } from "vitest"',
      'import { applyDiscount } from "../../../src/programs/pricing/discount"',
      "",
      'it("[INV-TRI-PRICING-001] rounds discounts to cents", () => {',
      "  expect(applyDiscount(10.5, 0.1)).toBe(9.45)",
      "})",
      "",
    ].join("\n"))

    specDiscover(cwd, dbPath, "pricing-failure")
    specRunPassed(cwd, dbPath, "test/programs/pricing/discount.test.ts::[INV-TRI-PRICING-001] rounds discounts to cents")
    expectOk(
      runTx(cwd, dbPath, ["spec", "complete", "--doc", "pricing-failure", "--by", "pricing-qa", "--json"]),
      "tx spec complete pricing-failure",
    )

    specRunFailed(cwd, dbPath, "test/programs/pricing/discount.test.ts::[INV-TRI-PRICING-001] rounds discounts to cents")

    const status = specStatus(cwd, dbPath, "pricing-failure")
    expect(status.phase).toBe("BUILD")
    expect(status.fci).toBe(0)

    const health = specHealth(cwd, dbPath)
    expect(health.status).toBe("broken")
    expect(health.specTest.failing).toBe(1)
    expect(health.specTest.docsBuild).toBe(1)
  })

  it("marks triangle health broken when most docs are drifting on disk", () => {
    addPrd(cwd, dbPath, "drift-a", "Drift A")
    addPrd(cwd, dbPath, "drift-b", "Drift B")
    addPrd(cwd, dbPath, "drift-c", "Drift C")

    syncPrdYaml(cwd, dbPath, "drift-a", "Drift A", [
      { id: "INV-TRI-DRIFT-A-001", rule: "doc a remains consistent" },
    ])
    syncPrdYaml(cwd, dbPath, "drift-b", "Drift B", [
      { id: "INV-TRI-DRIFT-B-001", rule: "doc b remains consistent" },
    ])
    syncPrdYaml(cwd, dbPath, "drift-c", "Drift C", [
      { id: "INV-TRI-DRIFT-C-001", rule: "doc c remains consistent" },
    ])

    writeRelative(cwd, "specs/prd/drift-a.yml", `${renderPrdYaml("drift-a", "Drift A", [
      { id: "INV-TRI-DRIFT-A-001", rule: "doc a remains consistent" },
    ])}\n# manual drift\n`)
    writeRelative(cwd, "specs/prd/drift-b.yml", `${renderPrdYaml("drift-b", "Drift B", [
      { id: "INV-TRI-DRIFT-B-001", rule: "doc b remains consistent" },
    ])}\n# manual drift\n`)

    const health = specHealth(cwd, dbPath)
    expect(health.status).toBe("broken")
    expect(health.docDrift.driftedDocs).toBe(2)
    expect(health.docDrift.totalDocs).toBe(3)
  })

  it("keeps triangle health drifting when a decision is still pending even after doc COMPLETE", () => {
    addPrd(cwd, dbPath, "ledger-pending-review", "Ledger Pending Review")
    syncPrdYaml(cwd, dbPath, "ledger-pending-review", "Ledger Pending Review", [
      { id: "INV-TRI-LEDGER-001", rule: "sum ledger balances" },
    ])

    writeRelative(cwd, "src/programs/ledger/balance.ts", [
      "export const sumBalances = (entries: readonly number[]): number => entries.reduce((sum, entry) => sum + entry, 0)",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/ledger/balance.test.ts", [
      'import { it, expect } from "vitest"',
      'import { sumBalances } from "../../../src/programs/ledger/balance"',
      "",
      'it("[INV-TRI-LEDGER-001] sums ledger balances", () => {',
      "  expect(sumBalances([10, -3, 5])).toBe(12)",
      "})",
      "",
    ].join("\n"))

    specDiscover(cwd, dbPath, "ledger-pending-review")
    specRunPassed(cwd, dbPath, "test/programs/ledger/balance.test.ts::[INV-TRI-LEDGER-001] sums ledger balances")
    expectOk(
      runTx(cwd, dbPath, ["spec", "complete", "--doc", "ledger-pending-review", "--by", "ledger-qa", "--json"]),
      "tx spec complete ledger-pending-review",
    )

    createPendingDecision(cwd, dbPath, "Ledger follow-up review", "Review ledger rounding narrative")

    const health = specHealth(cwd, dbPath)
    expect(health.status).toBe("drifting")
    expect(health.decisions.pending).toBe(1)
    expect(health.specTest.docsComplete).toBe(1)
  })
})
