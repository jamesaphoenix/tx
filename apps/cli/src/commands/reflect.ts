/**
 * Reflect command — macro-level session retrospective
 *
 * Aggregates session data, throughput, proliferation, stuck tasks, and signals.
 */

import { Effect } from "effect"
import { ReflectService } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { type Flags, flag, parseIntOpt, parseFloatOpt } from "../utils/parse.js"

export const reflect = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* ReflectService

    const sessions = parseIntOpt(flags, "sessions", "sessions")
    const hours = parseFloatOpt(flags, "hours", "hours")
    const analyze = flag(flags, "analyze")

    const result = yield* svc.reflect({ sessions, hours, analyze })

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      // Pretty print the retrospective
      const s = result.sessions
      const t = result.throughput
      const p = result.proliferation

      console.log(`Session Retrospective (last ${s.total} sessions):`)
      console.log()
      console.log(`  Sessions:    ${s.total} total, ${s.completed} completed, ${s.failed} failed, ${s.timeout} timeout`)
      console.log(`  Avg duration: ${s.avgDurationMinutes} min`)
      console.log()
      console.log(`  Throughput:  ${t.completed} completed, ${t.created} created (net ${t.net > 0 ? "+" : ""}${t.net})`)
      console.log(`  Efficiency:  ${Math.round(t.completionRate * 100)}% completion rate`)
      console.log()
      console.log(`  Proliferation:`)
      console.log(`    Tasks/session: avg ${p.avgCreatedPerSession}, max ${p.maxCreatedPerSession}`)
      console.log(`    Max depth:     ${p.maxDepth}`)
      console.log(`    Orphan chains: ${p.orphanChains}`)

      if (result.stuckTasks.length > 0) {
        console.log()
        console.log(`  Stuck tasks (3+ failed attempts):`)
        for (const st of result.stuckTasks) {
          console.log(`    ${st.id}: "${st.title}" (${st.failedAttempts} failed attempts)`)
          if (st.lastError) console.log(`      Last error: ${st.lastError}`)
        }
      }

      if (result.signals.length > 0) {
        console.log()
        console.log(`  Signals:`)
        for (const sig of result.signals) {
          const icon = sig.severity === "critical" ? "\u26D4" : sig.severity === "warning" ? "\u26A0" : "\u2139"
          console.log(`    ${icon} ${sig.type}: ${sig.message}`)
        }
      }

      if (result.analysis) {
        console.log()
        console.log(`  Analysis:`)
        for (const line of result.analysis.split("\n")) {
          console.log(`    ${line}`)
        }
      } else if (analyze) {
        console.log()
        console.log(`  Analysis: LLM unavailable (set ANTHROPIC_API_KEY or use Claude Agent SDK)`)
      }
    }
  })
