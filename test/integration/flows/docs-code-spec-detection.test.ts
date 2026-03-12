import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"

const CLI_SRC = resolve(__dirname, "../../../apps/cli/src/cli.ts")
const CLI_TIMEOUT = Number(process.env.CLI_TEST_TIMEOUT ?? (process.env.CI ? 120000 : 60000))

type ExecResult = {
  readonly stdout: string
  readonly stderr: string
  readonly status: number
}

type InvariantInput = {
  readonly id: string
  readonly rule: string
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

const writeRelative = (cwd: string, relativePath: string, content: string): void => {
  const absPath = join(cwd, relativePath)
  mkdirSync(dirname(absPath), { recursive: true })
  writeFileSync(absPath, content, "utf-8")
}

const writeDocsConfig = (cwd: string): void => {
  writeRelative(cwd, ".tx/config.toml", [
    "[docs]",
    'path = ".tx/docs"',
    "require_ears = false",
    "",
    "[spec]",
    'test_patterns = ["test/**/*.test.ts"]',
  ].join("\n"))
}

const overwritePrdYaml = (
  cwd: string,
  name: string,
  title: string,
  invariants: readonly InvariantInput[],
): void => {
  writeRelative(
    cwd,
    `.tx/docs/prd/${name}.yml`,
    [
      "kind: prd",
      `name: ${name}`,
      `title: "${title}"`,
      "status: changing",
      "",
      "problem: |",
      `  ${title} should remain aligned with the code and tests.`,
      "",
      "solution: |",
      `  Track ${title.toLowerCase()} behavior through invariants and detected tests.`,
      "",
      "invariants:",
      ...invariants.flatMap((invariant) => [
        `  - id: ${invariant.id}`,
        `    rule: ${invariant.rule}`,
        "    enforcement: integration_test",
      ]),
      "",
    ].join("\n"),
  )
}

const addPrd = (cwd: string, dbPath: string, name: string, title: string): void => {
  expectOk(
    runTx(cwd, dbPath, ["doc", "add", "prd", name, "--title", title]),
    `tx doc add prd ${name}`,
  )
}

const parseJson = <T>(result: ExecResult): T => JSON.parse(result.stdout) as T

describe("Docs -> code -> spec detection flow", () => {
  let cwd: string
  let dbPath: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "tx-flow-docs-code-spec-"))
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

  it("tracks multiple tiny programs across docs, discovery sources, and scoped completion", () => {
    addPrd(cwd, dbPath, "auth-flow", "Auth Flow")
    addPrd(cwd, dbPath, "billing-flow", "Billing Flow")

    overwritePrdYaml(cwd, "auth-flow", "Auth Flow", [
      { id: "INV-FLOW-AUTH-001", rule: "reject short passwords" },
      { id: "INV-FLOW-AUTH-002", rule: "issue a session token after login" },
    ])
    overwritePrdYaml(cwd, "billing-flow", "Billing Flow", [
      { id: "INV-FLOW-BILLING-001", rule: "apply annual discount" },
      { id: "INV-FLOW-BILLING-002", rule: "prevent negative invoice totals" },
    ])

    writeRelative(cwd, "src/programs/auth/password-policy.ts", [
      "export const acceptsPassword = (value: string): boolean => value.length >= 12",
      "",
    ].join("\n"))
    writeRelative(cwd, "src/programs/auth/session.ts", [
      "export const createSessionToken = (email: string): string => `session:${email}`",
      "",
    ].join("\n"))
    writeRelative(cwd, "src/programs/billing/annual-price.ts", [
      "export const annualPrice = (monthly: number): number => Math.round(monthly * 12 * 0.9)",
      "",
    ].join("\n"))

    writeRelative(cwd, "test/programs/auth/password-policy.test.ts", [
      'import { it, expect } from "vitest"',
      'import { acceptsPassword } from "../../../src/programs/auth/password-policy"',
      "",
      'it("[INV-FLOW-AUTH-001] rejects short passwords", () => {',
      '  expect(acceptsPassword("too-short")).toBe(false)',
      "})",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/auth/session.test.ts", [
      'import { it, expect } from "vitest"',
      'import { createSessionToken } from "../../../src/programs/auth/session"',
      "",
      "// @spec INV-FLOW-AUTH-002",
      'it("creates session token after login", () => {',
      '  expect(createSessionToken("james@example.com")).toContain("session:")',
      "})",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/billing/annual-price.test.ts", [
      'import { it, expect } from "vitest"',
      'import { annualPrice } from "../../../src/programs/billing/annual-price"',
      "",
      'it("applies annual discount", () => {',
      "  expect(annualPrice(10)).toBe(108)",
      "})",
      "",
    ].join("\n"))
    writeRelative(cwd, ".tx/spec-tests.yml", [
      "mappings:",
      "  - invariant: INV-FLOW-BILLING-001",
      "    tests:",
      "      - file: test/programs/billing/annual-price.test.ts",
      "        name: applies annual discount",
      "        framework: vitest",
      "",
    ].join("\n"))

    const discover = expectOk(
      runTx(cwd, dbPath, ["spec", "discover", "--patterns", "test/**/*.test.ts", "--json"]),
      "tx spec discover",
    )
    const discoverJson = parseJson<{
      scannedFiles: number
      discoveredLinks: number
      upserted: number
      tagLinks: number
      commentLinks: number
      manifestLinks: number
    }>(discover)

    expect(discoverJson.scannedFiles).toBe(3)
    expect(discoverJson.discoveredLinks).toBe(3)
    expect(discoverJson.upserted).toBe(3)
    expect(discoverJson.tagLinks).toBe(1)
    expect(discoverJson.commentLinks).toBe(1)
    expect(discoverJson.manifestLinks).toBe(1)

    const authMatrix = parseJson<Array<{ invariantId: string; tests: Array<{ discovery: string; testId: string }> }>>(
      expectOk(runTx(cwd, dbPath, ["spec", "matrix", "--doc", "auth-flow", "--json"]), "tx spec matrix auth-flow"),
    )
    expect(authMatrix).toHaveLength(2)
    expect(authMatrix.find((entry) => entry.invariantId === "INV-FLOW-AUTH-001")?.tests[0]?.discovery).toBe("tag")
    expect(authMatrix.find((entry) => entry.invariantId === "INV-FLOW-AUTH-002")?.tests[0]?.discovery).toBe("comment")

    const billingMatrix = parseJson<Array<{ invariantId: string; tests: Array<{ discovery: string; testId: string }> }>>(
      expectOk(runTx(cwd, dbPath, ["spec", "matrix", "--doc", "billing-flow", "--json"]), "tx spec matrix billing-flow"),
    )
    expect(billingMatrix).toHaveLength(2)
    expect(billingMatrix.find((entry) => entry.invariantId === "INV-FLOW-BILLING-001")?.tests[0]?.discovery).toBe("manifest")
    expect(billingMatrix.find((entry) => entry.invariantId === "INV-FLOW-BILLING-002")?.tests).toEqual([])

    const billingGaps = parseJson<Array<{ id: string }>>(
      expectOk(runTx(cwd, dbPath, ["spec", "gaps", "--doc", "billing-flow", "--json"]), "tx spec gaps billing-flow"),
    )
    expect(billingGaps.map((gap) => gap.id)).toEqual(["INV-FLOW-BILLING-002"])

    expectOk(
      runTx(
        cwd,
        dbPath,
        ["spec", "run", "test/programs/auth/password-policy.test.ts::[INV-FLOW-AUTH-001] rejects short passwords", "--passed", "--json"],
      ),
      "tx spec run auth password policy",
    )
    expectOk(
      runTx(
        cwd,
        dbPath,
        ["spec", "run", "test/programs/auth/session.test.ts::creates session token after login", "--passed", "--json"],
      ),
      "tx spec run auth session",
    )

    const authStatus = parseJson<{ phase: string; fci: number; gaps: number; total: number }>(
      expectOk(runTx(cwd, dbPath, ["spec", "status", "--doc", "auth-flow", "--json"]), "tx spec status auth-flow"),
    )
    expect(authStatus.phase).toBe("HARDEN")
    expect(authStatus.fci).toBe(100)
    expect(authStatus.gaps).toBe(0)
    expect(authStatus.total).toBe(2)

    const complete = parseJson<{ scopeType: string; scopeValue: string; signedOffBy: string }>(
      expectOk(
        runTx(cwd, dbPath, ["spec", "complete", "--doc", "auth-flow", "--by", "flow-test", "--json"]),
        "tx spec complete auth-flow",
      ),
    )
    expect(complete.scopeType).toBe("doc")
    expect(complete.scopeValue).toBe("auth-flow")
    expect(complete.signedOffBy).toBe("flow-test")

    const authComplete = parseJson<{ phase: string; fci: number }>(
      expectOk(runTx(cwd, dbPath, ["spec", "status", "--doc", "auth-flow", "--json"]), "tx spec status auth-flow after complete"),
    )
    expect(authComplete.phase).toBe("COMPLETE")
    expect(authComplete.fci).toBe(100)

    const globalStatus = parseJson<{ phase: string; fci: number; gaps: number; total: number }>(
      expectOk(runTx(cwd, dbPath, ["spec", "status", "--json"]), "tx spec status global"),
    )
    expect(globalStatus.phase).toBe("BUILD")
    expect(globalStatus.fci).toBe(50)
    expect(globalStatus.gaps).toBe(1)
    expect(globalStatus.total).toBe(4)
  })

  it("surfaces doc changes immediately and clears gaps when the code catches up", () => {
    addPrd(cwd, dbPath, "orders-flow", "Orders Flow")

    overwritePrdYaml(cwd, "orders-flow", "Orders Flow", [
      { id: "INV-FLOW-ORDERS-001", rule: "calculate the order subtotal" },
    ])

    writeRelative(cwd, "src/programs/orders/subtotal.ts", [
      "export const subtotal = (items: readonly number[]): number => items.reduce((sum, value) => sum + value, 0)",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/orders/subtotal.test.ts", [
      'import { it, expect } from "vitest"',
      'import { subtotal } from "../../../src/programs/orders/subtotal"',
      "",
      'it("[INV-FLOW-ORDERS-001] computes subtotal", () => {',
      "  expect(subtotal([4, 5, 6])).toBe(15)",
      "})",
      "",
    ].join("\n"))

    const firstDiscover = parseJson<{ discoveredLinks: number; upserted: number }>(
      expectOk(
        runTx(cwd, dbPath, ["spec", "discover", "--doc", "orders-flow", "--patterns", "test/**/*.test.ts", "--json"]),
        "tx spec discover orders-flow initial",
      ),
    )
    expect(firstDiscover.discoveredLinks).toBe(1)
    expect(firstDiscover.upserted).toBe(1)

    const firstGaps = parseJson<Array<{ id: string }>>(
      expectOk(runTx(cwd, dbPath, ["spec", "gaps", "--doc", "orders-flow", "--json"]), "tx spec gaps orders-flow initial"),
    )
    expect(firstGaps).toEqual([])

    overwritePrdYaml(cwd, "orders-flow", "Orders Flow", [
      { id: "INV-FLOW-ORDERS-001", rule: "calculate the order subtotal" },
      { id: "INV-FLOW-ORDERS-002", rule: "round totals to cents" },
    ])

    const docAdvanced = parseJson<{ discoveredLinks: number; upserted: number }>(
      expectOk(
        runTx(cwd, dbPath, ["spec", "discover", "--doc", "orders-flow", "--patterns", "test/**/*.test.ts", "--json"]),
        "tx spec discover after doc change",
      ),
    )
    expect(docAdvanced.discoveredLinks).toBe(1)
    expect(docAdvanced.upserted).toBe(1)

    const gapsAfterDocChange = parseJson<Array<{ id: string }>>(
      expectOk(runTx(cwd, dbPath, ["spec", "gaps", "--doc", "orders-flow", "--json"]), "tx spec gaps after doc change"),
    )
    expect(gapsAfterDocChange.map((gap) => gap.id)).toEqual(["INV-FLOW-ORDERS-002"])

    writeRelative(cwd, "test/programs/orders/subtotal.test.ts", [
      'import { it, expect } from "vitest"',
      'import { subtotal } from "../../../src/programs/orders/subtotal"',
      "",
      'it("[INV-FLOW-ORDERS-001] computes subtotal", () => {',
      "  expect(subtotal([4, 5, 6])).toBe(15)",
      "})",
      "",
      "// @spec INV-FLOW-ORDERS-002",
      'it("rounds totals to cents", () => {',
      "  expect(Math.round(10.235 * 100) / 100).toBe(10.24)",
      "})",
      "",
    ].join("\n"))

    const codeCaughtUp = parseJson<{ discoveredLinks: number; upserted: number; commentLinks: number }>(
      expectOk(
        runTx(cwd, dbPath, ["spec", "discover", "--doc", "orders-flow", "--patterns", "test/**/*.test.ts", "--json"]),
        "tx spec discover after code change",
      ),
    )
    expect(codeCaughtUp.discoveredLinks).toBe(2)
    expect(codeCaughtUp.upserted).toBe(2)
    expect(codeCaughtUp.commentLinks).toBe(1)

    const finalGaps = parseJson<Array<{ id: string }>>(
      expectOk(runTx(cwd, dbPath, ["spec", "gaps", "--doc", "orders-flow", "--json"]), "tx spec gaps after code catch-up"),
    )
    expect(finalGaps).toEqual([])

    const finalMatrix = parseJson<Array<{ invariantId: string; tests: Array<{ discovery: string }> }>>(
      expectOk(runTx(cwd, dbPath, ["spec", "matrix", "--doc", "orders-flow", "--json"]), "tx spec matrix orders-flow final"),
    )
    expect(finalMatrix).toHaveLength(2)
    expect(finalMatrix.find((entry) => entry.invariantId === "INV-FLOW-ORDERS-001")?.tests[0]?.discovery).toBe("tag")
    expect(finalMatrix.find((entry) => entry.invariantId === "INV-FLOW-ORDERS-002")?.tests[0]?.discovery).toBe("comment")
  })

  it("refreshes all docs when spec discover runs without --doc and picks up cross-doc changes", () => {
    addPrd(cwd, dbPath, "catalog-flow", "Catalog Flow")
    addPrd(cwd, dbPath, "checkout-flow", "Checkout Flow")

    overwritePrdYaml(cwd, "catalog-flow", "Catalog Flow", [
      { id: "INV-FLOW-CATALOG-001", rule: "normalize product slugs" },
    ])
    overwritePrdYaml(cwd, "checkout-flow", "Checkout Flow", [
      { id: "INV-FLOW-CHECKOUT-001", rule: "prevent zero-quantity purchases" },
    ])

    writeRelative(cwd, "src/programs/catalog/slug.ts", [
      'export const normalizeSlug = (value: string): string => value.trim().toLowerCase().replace(/\\s+/g, "-")',
      "",
    ].join("\n"))
    writeRelative(cwd, "src/programs/checkout/quantity.ts", [
      "export const canPurchaseQuantity = (quantity: number): boolean => quantity > 0",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/catalog/slug.test.ts", [
      'import { it, expect } from "vitest"',
      'import { normalizeSlug } from "../../../src/programs/catalog/slug"',
      "",
      'it("[INV-FLOW-CATALOG-001] normalizes product slugs", () => {',
      '  expect(normalizeSlug("  Summer Hat ")).toBe("summer-hat")',
      "})",
      "",
    ].join("\n"))
    writeRelative(cwd, "test/programs/checkout/quantity.test.ts", [
      'import { it, expect } from "vitest"',
      'import { canPurchaseQuantity } from "../../../src/programs/checkout/quantity"',
      "",
      'it("[INV-FLOW-CHECKOUT-001] prevents zero-quantity purchases", () => {',
      "  expect(canPurchaseQuantity(0)).toBe(false)",
      "})",
      "",
    ].join("\n"))

    const initialDiscover = parseJson<{ discoveredLinks: number; upserted: number }>(
      expectOk(
        runTx(cwd, dbPath, ["spec", "discover", "--patterns", "test/**/*.test.ts", "--json"]),
        "tx spec discover global initial",
      ),
    )
    expect(initialDiscover.discoveredLinks).toBe(2)
    expect(initialDiscover.upserted).toBe(2)

    overwritePrdYaml(cwd, "catalog-flow", "Catalog Flow", [
      { id: "INV-FLOW-CATALOG-001", rule: "normalize product slugs" },
      { id: "INV-FLOW-CATALOG-002", rule: "strip duplicate separators" },
    ])
    overwritePrdYaml(cwd, "checkout-flow", "Checkout Flow", [
      { id: "INV-FLOW-CHECKOUT-001", rule: "prevent zero-quantity purchases" },
      { id: "INV-FLOW-CHECKOUT-002", rule: "round totals to cents before charge" },
    ])

    writeRelative(cwd, "test/programs/checkout/rounding.test.ts", [
      'import { it, expect } from "vitest"',
      "",
      "// @spec INV-FLOW-CHECKOUT-002",
      'it("rounds totals to cents before charge", () => {',
      "  expect(Math.round(14.235 * 100) / 100).toBe(14.24)",
      "})",
      "",
    ].join("\n"))

    const rediscover = parseJson<{ discoveredLinks: number; upserted: number; commentLinks: number }>(
      expectOk(
        runTx(cwd, dbPath, ["spec", "discover", "--patterns", "test/**/*.test.ts", "--json"]),
        "tx spec discover global after doc changes",
      ),
    )
    expect(rediscover.discoveredLinks).toBe(3)
    expect(rediscover.upserted).toBe(3)
    expect(rediscover.commentLinks).toBe(1)

    const catalogGaps = parseJson<Array<{ id: string }>>(
      expectOk(runTx(cwd, dbPath, ["spec", "gaps", "--doc", "catalog-flow", "--json"]), "tx spec gaps catalog-flow"),
    )
    expect(catalogGaps.map((gap) => gap.id)).toEqual(["INV-FLOW-CATALOG-002"])

    const checkoutMatrix = parseJson<Array<{ invariantId: string; tests: Array<{ discovery: string }> }>>(
      expectOk(runTx(cwd, dbPath, ["spec", "matrix", "--doc", "checkout-flow", "--json"]), "tx spec matrix checkout-flow"),
    )
    expect(checkoutMatrix).toHaveLength(2)
    expect(checkoutMatrix.find((entry) => entry.invariantId === "INV-FLOW-CHECKOUT-002")?.tests[0]?.discovery).toBe("comment")

    const globalStatus = parseJson<{ phase: string; fci: number; gaps: number; total: number }>(
      expectOk(runTx(cwd, dbPath, ["spec", "status", "--json"]), "tx spec status global after doc changes"),
    )
    expect(globalStatus.phase).toBe("BUILD")
    expect(globalStatus.fci).toBe(0)
    expect(globalStatus.gaps).toBe(1)
    expect(globalStatus.total).toBe(4)
  })
})
