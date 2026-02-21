import { afterEach, describe, expect, it, vi } from "vitest"
import { Effect, Layer } from "effect"
import { CycleScanService } from "@jamesaphoenix/tx-core"
import type { CycleResult } from "@jamesaphoenix/tx-types"
import { cycle } from "../../apps/cli/src/commands/cycle.js"

const baseFlags = {
  "task-prompt": "cycle counter smoke",
  "scan-prompt": "no-op smoke",
  "max-rounds": "1",
  agents: "1",
  "scan-only": true,
  "dry-run": true,
} as const

function makeResult(cycleNumber: number): CycleResult {
  return {
    cycleRunId: `run-${cycleNumber}`,
    cycle: cycleNumber,
    name: "cycle counter smoke",
    description: "no-op smoke",
    rounds: 1,
    totalNewIssues: 0,
    existingIssues: 0,
    finalLoss: 0,
    converged: true,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("cycle command progress labels", () => {
  it("shows per-invocation cycle numbering for single-cycle runs", async () => {
    const logs: string[] = []
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "))
    })

    const result = makeResult(6)
    const mockLayer = Layer.succeed(CycleScanService, {
      computeLoss: () => 0,
      runCycles: (_config, onProgress) =>
        Effect.sync(() => {
          onProgress?.({ type: "cycle_start", cycle: 6, totalCycles: 1, name: result.name })
          onProgress?.({ type: "scan_complete", cycle: 6, round: 1, findings: 0, durationMs: 1000 })
          onProgress?.({ type: "converged", cycle: 6, round: 1 })
          onProgress?.({ type: "cycle_complete", result })
          return [result]
        }),
    })

    await Effect.runPromise(
      cycle([], { ...baseFlags, cycles: "1" }).pipe(Effect.provide(mockLayer))
    )

    const output = logs.join("\n")
    expect(output).toContain('=== Cycle 1/1: "cycle counter smoke" ===')
    expect(output).toContain("Cycle 1 complete: 1 rounds, 0 new issues, final loss 0 -- CONVERGED")
    expect(output).not.toContain("Cycle 6/1")
    expect(output).not.toContain("Cycle 6 complete")
  })

  it("keeps cycle headers and completion summaries aligned across multiple cycles", async () => {
    const logs: string[] = []
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "))
    })

    const first = makeResult(8)
    const second = makeResult(9)
    const mockLayer = Layer.succeed(CycleScanService, {
      computeLoss: () => 0,
      runCycles: (_config, onProgress) =>
        Effect.sync(() => {
          onProgress?.({ type: "cycle_start", cycle: 8, totalCycles: 2, name: first.name })
          onProgress?.({ type: "cycle_complete", result: first })
          onProgress?.({ type: "cycle_start", cycle: 9, totalCycles: 2, name: second.name })
          onProgress?.({ type: "cycle_complete", result: second })
          return [first, second]
        }),
    })

    await Effect.runPromise(
      cycle([], { ...baseFlags, cycles: "2" }).pipe(Effect.provide(mockLayer))
    )

    const output = logs.join("\n")
    expect(output).toContain('=== Cycle 1/2: "cycle counter smoke" ===')
    expect(output).toContain('=== Cycle 2/2: "cycle counter smoke" ===')
    expect(output).toContain("Cycle 1 complete: 1 rounds, 0 new issues, final loss 0 -- CONVERGED")
    expect(output).toContain("Cycle 2 complete: 1 rounds, 0 new issues, final loss 0 -- CONVERGED")
    expect(output).not.toContain("Cycle 8/2")
    expect(output).not.toContain("Cycle 9/2")
  })
})
