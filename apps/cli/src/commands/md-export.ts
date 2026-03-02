/**
 * md-export command: Materialize tasks to a markdown file for file-based agent loops
 */

import { Effect, Duration } from "effect"
import { writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { createHash } from "node:crypto"
import { TaskService, ReadyService, LearningService } from "@jamesaphoenix/tx-core"
import type { TaskWithDeps, ContextResult, TaskStatus } from "@jamesaphoenix/tx-types"
import { isValidTaskStatus } from "@jamesaphoenix/tx-types"
import { toJson, formatTasksMarkdown } from "../output.js"
import type { TasksMarkdownCounts } from "../output.js"
import { type Flags, flag, opt, parseIntOpt } from "../utils/parse.js"

export const mdExport = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const outputPath = opt(flags, "path", "p") ?? resolve(process.cwd(), ".tx", "tasks.md")
    const filter = opt(flags, "filter", "f") ?? "ready"
    const includeContext = flag(flags, "include-context")
    const includeDone = parseIntOpt(flags, "include-done", "include-done") ?? 5
    const watch = flag(flags, "watch", "w")
    const interval = parseIntOpt(flags, "interval", "interval") ?? 5
    const jsonOutput = flag(flags, "json")

    // Validate filter
    if (filter !== "ready" && filter !== "all" && !isValidTaskStatus(filter)) {
      console.error(`Invalid --filter value: "${filter}". Must be "ready", "all", or a valid task status.`)
      process.exit(1)
    }

    // Validate interval
    if (watch && interval < 1) {
      console.error(`Invalid --interval value: ${interval}. Must be >= 1.`)
      process.exit(1)
    }

    const readySvc = yield* ReadyService
    const taskSvc = yield* TaskService

    // Dynamic section title based on filter
    const sectionTitle = filter === "ready"
      ? "Ready Tasks"
      : filter === "all"
        ? "All Tasks"
        : `Tasks — ${filter}`

    // Label for console output messages
    const filterLabel = filter === "ready" ? "ready" : filter === "all" ? "total" : filter

    // Build counts for summary using efficient count() queries.
    // When filter !== "ready", compute real ready count separately.
    const getCounts = (filteredCount: number) =>
      Effect.gen(function* () {
        if (filter === "ready") {
          // filteredCount IS the ready count
          const [active, blocked, done] = yield* Effect.all([
            taskSvc.count({ status: "active" }),
            taskSvc.count({ status: "blocked" }),
            taskSvc.count({ status: "done" }),
          ])
          return { ready: filteredCount, active, blocked, done } as TasksMarkdownCounts
        }
        // For non-ready filters, compute the real ready count via ReadyService
        const readyTasks = yield* readySvc.getReady(1000)
        const [active, blocked, done] = yield* Effect.all([
          taskSvc.count({ status: "active" }),
          taskSvc.count({ status: "blocked" }),
          taskSvc.count({ status: "done" }),
        ])
        return { ready: readyTasks.length, active, blocked, done } as TasksMarkdownCounts
      })

    // Get filtered tasks
    const getFilteredTasks = (limit: number) =>
      Effect.gen(function* () {
        if (filter === "ready") {
          return yield* readySvc.getReady(limit)
        }
        // For "all" or specific status, use listWithDeps
        const statusFilter: TaskStatus[] | undefined = filter === "all" ? undefined : [filter as TaskStatus]
        const tasks = yield* taskSvc.listWithDeps({ status: statusFilter, limit })
        return tasks
      })

    // Get completed tasks for context
    const getCompletedTasks = (limit: number) =>
      Effect.gen(function* () {
        if (limit <= 0) return [] as readonly TaskWithDeps[]
        const doneStatus: TaskStatus = "done"
        const tasks = yield* taskSvc.listWithDeps({ status: [doneStatus], limit })
        return tasks
      })

    // Get context for tasks if requested
    const getContextMap = (tasks: readonly TaskWithDeps[]) =>
      Effect.gen(function* () {
        if (!includeContext || tasks.length === 0) return undefined
        const learningSvc = yield* LearningService
        const contextMap = new Map<string, ContextResult>()
        for (const t of tasks) {
          const ctx = yield* Effect.catchAll(
            learningSvc.getContextForTask(t.id),
            () => Effect.succeed(null)
          )
          if (ctx) contextMap.set(t.id, ctx)
        }
        return contextMap
      })

    // Atomic write: write to temp file then rename (prevents corruption on SIGINT)
    const writeMarkdown = (markdown: string) =>
      Effect.try({
        try: () => {
          const dir = dirname(outputPath)
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true })
          }
          const tmp = `${outputPath}.tmp`
          writeFileSync(tmp, markdown, "utf-8")
          renameSync(tmp, outputPath)
        },
        catch: (e) => new Error(`Failed to write ${outputPath}: ${e}`),
      })

    // Single export pass
    const doExport = () =>
      Effect.gen(function* () {
        const filteredTasks = yield* getFilteredTasks(100)
        const completedTasks = yield* getCompletedTasks(includeDone)
        const counts = yield* getCounts(filteredTasks.length)
        const contextMap = yield* getContextMap(filteredTasks)

        const markdown = formatTasksMarkdown(filteredTasks, completedTasks, counts, {
          includeContext: contextMap,
          sectionTitle,
        })

        yield* writeMarkdown(markdown)

        return { path: outputPath, readyCount: filteredTasks.length, completedCount: completedTasks.length, counts }
      })

    if (!watch) {
      // One-shot export
      const result = yield* doExport()
      if (jsonOutput) {
        console.log(toJson(result))
      } else {
        console.log(`Exported ${result.readyCount} ${filterLabel} tasks to ${result.path}`)
        console.log(`  Ready: ${result.counts.ready} | Active: ${result.counts.active} | Blocked: ${result.counts.blocked} | Done: ${result.counts.done}`)
      }
    } else {
      // Watch mode: poll and re-export on changes
      let previousHash = ""

      const exportAndHash = () =>
        Effect.gen(function* () {
          const filteredTasks = yield* getFilteredTasks(100)

          // Hash task IDs + statuses to detect changes
          const hashInput = filteredTasks.map(t => `${t.id}:${t.status}:${t.score}`).join("|")
          const currentHash = createHash("sha256").update(hashInput).digest("hex")

          if (currentHash !== previousHash) {
            previousHash = currentHash
            const completedTasks = yield* getCompletedTasks(includeDone)
            const counts = yield* getCounts(filteredTasks.length)
            const contextMap = yield* getContextMap(filteredTasks)

            const markdown = formatTasksMarkdown(filteredTasks, completedTasks, counts, {
              includeContext: contextMap,
              sectionTitle,
            })

            yield* writeMarkdown(markdown)
            const now = new Date().toISOString().split("T")[1]?.split(".")[0] ?? ""
            console.log(`[${now}] Updated ${outputPath} (${filteredTasks.length} ${filterLabel} tasks)`)
            return true
          }
          return false
        })

      console.log(`Watching for changes every ${interval}s. Press Ctrl+C to stop.`)
      yield* exportAndHash()

      // Poll loop — SIGINT/SIGTERM exit immediately via process.exit
      const cleanup = () => {
        console.log("\nStopped watching.")
        process.exit(0)
      }
      process.on("SIGINT", cleanup)
      process.on("SIGTERM", cleanup)

      // eslint-disable-next-line no-constant-condition
      while (true) {
        yield* Effect.sleep(Duration.seconds(interval))
        yield* exportAndHash()
      }
    }
  })
