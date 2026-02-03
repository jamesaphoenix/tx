/**
 * Worker commands: start, stop, status, list
 *
 * CLI commands for managing worker processes (PRD-018).
 */

import { Effect } from "effect"
import { WorkerService, runWorkerProcess, type WorkerProcessConfig, type WorkerType } from "@jamesaphoenix/tx-core"
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

/**
 * Format a worker for display.
 */
function formatWorker(w: WorkerType): string {
  const lines = [
    `Worker: ${w.id}`,
    `  Name: ${w.name}`,
    `  Status: ${w.status}`,
    `  Hostname: ${w.hostname}`,
    `  PID: ${w.pid}`,
    `  Capabilities: ${w.capabilities.join(", ") || "(none)"}`,
  ]
  if (w.currentTaskId) {
    lines.push(`  Current Task: ${w.currentTaskId}`)
  }
  lines.push(`  Registered: ${w.registeredAt.toISOString()}`)
  lines.push(`  Last Heartbeat: ${w.lastHeartbeatAt.toISOString()}`)
  return lines.join("\n")
}

/**
 * Format a worker as a single line for list display.
 */
function formatWorkerLine(w: WorkerType): string {
  const taskInfo = w.currentTaskId ? ` → ${w.currentTaskId}` : ""
  return `  ${w.id} [${w.status}] ${w.name}${taskInfo}`
}

export const worker = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const subcommand = pos[0]

    if (!subcommand || subcommand === "help") {
      console.log(commandHelp["worker"])
      return
    }

    // Check for --help on subcommand
    if (flag(flags, "help", "h")) {
      const helpKey = `worker ${subcommand}`
      if (commandHelp[helpKey]) {
        console.log(commandHelp[helpKey])
        return
      }
    }

    const svc = yield* WorkerService

    if (subcommand === "start") {
      // Parse options
      const name = opt(flags, "name", "n")
      const capabilitiesOpt = opt(flags, "capabilities", "c")
      const capabilities = capabilitiesOpt
        ? capabilitiesOpt.split(",").map(c => c.trim())
        : ["tx-implementer"]

      const heartbeatOpt = opt(flags, "heartbeat")
      const heartbeatIntervalSeconds = heartbeatOpt ? parseInt(heartbeatOpt, 10) : 30

      // Build config
      const config: WorkerProcessConfig = {
        name,
        capabilities,
        heartbeatIntervalSeconds
      }

      if (flag(flags, "json")) {
        console.log(toJson({
          action: "starting",
          name: name ?? "worker-<auto>",
          capabilities,
          heartbeatIntervalSeconds
        }))
      } else {
        console.log("Starting worker...")
        console.log(`  Name: ${name ?? "worker-<auto>"}`)
        console.log(`  Capabilities: ${capabilities.join(", ")}`)
        console.log(`  Heartbeat interval: ${heartbeatIntervalSeconds}s`)
        console.log("")
        console.log("Worker will run until SIGTERM or SIGINT is received.")
      }

      // Run the worker process - this blocks until shutdown
      yield* runWorkerProcess(config)

      if (flag(flags, "json")) {
        console.log(toJson({ action: "stopped" }))
      } else {
        console.log("Worker stopped.")
      }
    } else if (subcommand === "stop") {
      // Worker stop is typically handled by sending SIGTERM to the worker process.
      // Since each worker is a separate process, this command shows guidance.
      // In a more advanced setup, we'd store worker PIDs and send signals.

      const graceful = flag(flags, "graceful", "g")

      if (flag(flags, "json")) {
        console.log(toJson({
          message: "Worker stop is signal-based",
          instruction: "Send SIGTERM to the worker process for graceful shutdown",
          graceful
        }))
      } else {
        console.log("Worker stop:")
        console.log("")
        console.log("  Workers are stopped by sending SIGTERM to the worker process.")
        console.log("  The worker will finish its current task before exiting.")
        console.log("")
        console.log("  To stop a worker:")
        console.log("    kill -SIGTERM <worker-pid>")
        console.log("")
        console.log("  To find worker PIDs, run:")
        console.log("    tx worker list --json")
      }
    } else if (subcommand === "status") {
      // Show status of a specific worker or all workers
      const workerId = pos[1]

      if (workerId) {
        // Show status of a specific worker
        const workers = yield* svc.list()
        const worker = workers.find(w => w.id === workerId)

        if (!worker) {
          console.error(`Worker not found: ${workerId}`)
          process.exit(1)
        }

        if (flag(flags, "json")) {
          console.log(toJson(worker))
        } else {
          console.log(formatWorker(worker))
        }
      } else {
        // Show summary of all workers
        const workers = yield* svc.list()

        const byStatus = {
          starting: workers.filter(w => w.status === "starting").length,
          idle: workers.filter(w => w.status === "idle").length,
          busy: workers.filter(w => w.status === "busy").length,
          stopping: workers.filter(w => w.status === "stopping").length,
          dead: workers.filter(w => w.status === "dead").length
        }

        if (flag(flags, "json")) {
          console.log(toJson({
            totalWorkers: workers.length,
            byStatus
          }))
        } else {
          console.log("Worker Status Summary:")
          console.log(`  Total workers: ${workers.length}`)
          console.log("")
          console.log("  By status:")
          console.log(`    Starting: ${byStatus.starting}`)
          console.log(`    Idle: ${byStatus.idle}`)
          console.log(`    Busy: ${byStatus.busy}`)
          console.log(`    Stopping: ${byStatus.stopping}`)
          console.log(`    Dead: ${byStatus.dead}`)
        }
      }
    } else if (subcommand === "list") {
      // List all workers with optional status filter
      const statusOpt = opt(flags, "status", "s")
      const statusFilter = statusOpt
        ? statusOpt.split(",").map(s => s.trim()) as ("starting" | "idle" | "busy" | "stopping" | "dead")[]
        : undefined

      const allWorkers = yield* svc.list()
      const workers = statusFilter
        ? allWorkers.filter(w => statusFilter.includes(w.status))
        : allWorkers

      if (flag(flags, "json")) {
        console.log(toJson(workers))
      } else {
        if (workers.length === 0) {
          console.log("No workers found.")
        } else {
          console.log("Workers:")
          for (const w of workers) {
            console.log(formatWorkerLine(w))
          }
          console.log("")
          console.log(`Total: ${workers.length} worker(s)`)
        }
      }
    } else {
      console.error(`Unknown worker subcommand: ${subcommand}`)
      console.error(`Run 'tx worker --help' for usage information`)
      process.exit(1)
    }
  })
