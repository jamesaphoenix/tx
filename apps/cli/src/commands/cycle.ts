/**
 * Cycle commands: tx cycle
 *
 * Dispatches sub-agent swarms to scan for codebase issues, deduplicates
 * findings against known issues, and optionally fixes them.
 */

import { Effect } from "effect"
import { CycleScanService } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { flag, opt, parseIntOpt } from "../utils/parse.js"
import { CliExitError } from "../cli-exit.js"
import type { CycleProgressEvent } from "@jamesaphoenix/tx-types"

/** Dispatch cycle command. */
export const cycle = (
  _pos: string[],
  flags: Record<string, string | boolean>
): Effect.Effect<void, unknown, unknown> => {
  const taskPrompt = opt(flags, "task-prompt")

  if (!taskPrompt) {
    return Effect.sync(() => {
      console.error("Error: --task-prompt is required")
      console.error()
      console.error("Usage:")
      console.error('  tx cycle --task-prompt "Review core services" --scan-prompt "Find bugs"')
      console.error()
      console.error("Options:")
      console.error("  --task-prompt <text|file>   Area/work being reviewed (required)")
      console.error("  --scan-prompt <text|file>   What sub-agents look for (optional)")
      console.error("  --name <text>              Cycle name (shown in dashboard)")
      console.error("  --description <text>       Cycle description")
      console.error("  --cycles <N>               Number of cycles (default: 1)")
      console.error("  --max-rounds <N>           Max rounds per cycle (default: 10)")
      console.error("  --agents <N>               Parallel scan agents per round (default: 3)")
      console.error("  --model <model>            LLM model (default: claude-opus-4-6)")
      console.error("  --fix                      Enable fix agent between scan rounds")
      console.error("  --scan-only                Skip fix phase (explicit default)")
      console.error("  --dry-run                  Report only, no DB writes")
      console.error("  --score <N>                Base score for new tasks (default: 500)")
      console.error("  --json                     Output as JSON")
      throw new CliExitError(1)
    })
  }

  return Effect.gen(function* () {
    const svc = yield* CycleScanService

    const cycles = parseIntOpt(flags, "cycles", "cycles") ?? 1
    const maxRounds = parseIntOpt(flags, "max-rounds", "max-rounds") ?? 10
    const agents = parseIntOpt(flags, "agents", "agents") ?? 3
    const score = parseIntOpt(flags, "score", "score") ?? 500
    const scanPrompt =
      opt(flags, "scan-prompt") ??
      "Find bugs, anti-patterns, missing error handling, security vulnerabilities, and untested code paths."
    const name = opt(flags, "name")
    const description = opt(flags, "description")
    const model = opt(flags, "model") ?? "claude-opus-4-6"
    const doFix = flag(flags, "fix")
    const scanOnly = flag(flags, "scan-only")
    const dryRun = flag(flags, "dry-run")
    const jsonOutput = flag(flags, "json")

    const effectiveMaxRounds = scanOnly || (!doFix && !dryRun) ? 1 : maxRounds

    if (!jsonOutput) {
      console.log("Cycle Scan — Cycle-Based Issue Discovery")
      console.log(`  Task: ${taskPrompt.slice(0, 80)}${taskPrompt.length > 80 ? "..." : ""}`)
      if (scanPrompt) {
        console.log(`  Scan: ${scanPrompt.slice(0, 80)}${scanPrompt.length > 80 ? "..." : ""}`)
      }
      console.log(
        `  Cycles: ${cycles}, Max rounds: ${effectiveMaxRounds}${effectiveMaxRounds !== maxRounds ? ` (capped from ${maxRounds} — no fix agent)` : ""}, Agents: ${agents}`
      )
      console.log(`  Model: ${model}, Fix: ${doFix}, Scan-only: ${scanOnly}, Dry-run: ${dryRun}`)
      console.log()
    }

    const onProgress: ((event: CycleProgressEvent) => void) | undefined = jsonOutput
      ? undefined
      : (event) => {
          switch (event.type) {
            case "cycle_start":
              console.log(`=== Cycle ${event.cycle}/${event.totalCycles}: "${event.name}" ===`)
              break
            case "scan_complete":
              console.log(
                `  Round ${event.round}: Found ${event.findings} findings in ${(event.durationMs / 1000).toFixed(1)}s`
              )
              break
            case "dedup_complete":
              console.log(
                `  Round ${event.round}: Dedup: ${event.newIssues} new, ${event.duplicates} duplicates`
              )
              break
            case "round_loss":
              console.log(
                `  Round ${event.round}: Loss = ${event.loss} (${event.high}H x3 + ${event.medium}M x2 + ${event.low}L x1)`
              )
              break
            case "converged":
              console.log(`  Round ${event.round}: Converged!`)
              break
            case "cycle_complete": {
              const r = event.result
              console.log(
                `\n  Cycle ${r.cycle} complete: ${r.rounds} rounds, ${r.totalNewIssues} new issues, final loss ${r.finalLoss}${r.converged ? " -- CONVERGED" : ""}`
              )
              break
            }
          }
        }

    const results = yield* svc.runCycles(
      {
        taskPrompt,
        scanPrompt,
        name,
        description,
        cycles,
        maxRounds,
        agents,
        model,
        fix: doFix,
        scanOnly,
        dryRun,
        score,
      },
      onProgress
    )

    if (jsonOutput) {
      console.log(toJson(results))
    } else {
      console.log("\nDone.")
    }
  })
}
