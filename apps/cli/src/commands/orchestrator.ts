/**
 * Orchestrator commands: start, stop, status, reconcile
 *
 * CLI commands for managing the worker orchestration system (PRD-018).
 */

import { Effect } from "effect"
import { OrchestratorService, type OrchestratorConfig } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { commandHelp } from "../help.js"

type Flags = Record<string, string | boolean>

function flag(flags: Flags, ...names: string[]): boolean {
  return names.some(n => flags[n] === true)
}

function opt(flags: Flags, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = flags[n]
    if (typeof v === "string") return v
  }
  return undefined
}

export const orchestrator = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const subcommand = pos[0]

    if (!subcommand || subcommand === "help") {
      console.log(commandHelp["orchestrator"])
      return
    }

    // Check for --help on subcommand
    if (flag(flags, "help", "h")) {
      const helpKey = `orchestrator ${subcommand}`
      if (commandHelp[helpKey]) {
        console.log(commandHelp[helpKey])
        return
      }
    }

    const svc = yield* OrchestratorService

    if (subcommand === "start") {
      // Parse options
      const workersOpt = opt(flags, "workers", "w")
      const workers = workersOpt ? parseInt(workersOpt, 10) : undefined
      const isDaemon = flag(flags, "daemon", "d")

      // Build config
      const config: OrchestratorConfig = workers !== undefined
        ? { workerPoolSize: workers }
        : {}

      // Start orchestrator
      yield* svc.start(config)

      // Get updated status
      const state = yield* svc.status()

      if (flag(flags, "json")) {
        console.log(toJson({
          action: "started",
          status: state.status,
          pid: state.pid,
          workerPoolSize: state.workerPoolSize,
          daemon: isDaemon
        }))
      } else {
        console.log("Orchestrator started")
        console.log(`  Status: ${state.status}`)
        console.log(`  PID: ${state.pid}`)
        console.log(`  Worker pool size: ${state.workerPoolSize}`)
        if (isDaemon) {
          console.log("  Mode: daemon (background)")
        }
      }
    } else if (subcommand === "stop") {
      const graceful = flag(flags, "graceful", "g")

      yield* svc.stop(graceful)

      const state = yield* svc.status()

      if (flag(flags, "json")) {
        console.log(toJson({
          action: "stopped",
          status: state.status,
          graceful
        }))
      } else {
        console.log("Orchestrator stopped")
        if (graceful) {
          console.log("  Mode: graceful (waited for workers to finish)")
        }
      }
    } else if (subcommand === "status") {
      const state = yield* svc.status()

      if (flag(flags, "json")) {
        console.log(toJson(state))
      } else {
        console.log("Orchestrator Status:")
        console.log(`  Status: ${state.status}`)
        if (state.pid) {
          console.log(`  PID: ${state.pid}`)
        }
        if (state.startedAt) {
          console.log(`  Started: ${state.startedAt.toISOString()}`)
        }
        console.log(`  Worker pool size: ${state.workerPoolSize}`)
        console.log(`  Heartbeat interval: ${state.heartbeatIntervalSeconds}s`)
        console.log(`  Lease duration: ${state.leaseDurationMinutes}m`)
        console.log(`  Reconcile interval: ${state.reconcileIntervalSeconds}s`)
        if (state.lastReconcileAt) {
          console.log(`  Last reconcile: ${state.lastReconcileAt.toISOString()}`)
        }
      }
    } else if (subcommand === "reconcile") {
      const result = yield* svc.reconcile()

      if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        console.log("Reconciliation completed")
        console.log(`  Dead workers found: ${result.deadWorkersFound}`)
        console.log(`  Expired claims released: ${result.expiredClaimsReleased}`)
        console.log(`  Orphaned tasks recovered: ${result.orphanedTasksRecovered}`)
        console.log(`  Stale states fixed: ${result.staleStatesFixed}`)
        console.log(`  Time: ${result.reconcileTime}ms`)
      }
    } else {
      console.error(`Unknown orchestrator subcommand: ${subcommand}`)
      console.error(`Run 'tx orchestrator --help' for usage information`)
      process.exit(1)
    }
  })
