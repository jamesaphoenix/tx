/**
 * Sync commands: export, import, status, compact, auto
 */

import { Effect } from "effect"
import { SyncService } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { commandHelp } from "../help.js"
import { type Flags, flag, opt } from "../utils/parse.js"
import { syncClaude, syncCodex } from "./sync-platform.js"

export const sync = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const subcommand = pos[0]

    if (!subcommand || subcommand === "help") {
      console.log(commandHelp["sync"])
      return
    }

    // Check for --help on subcommand
    if (flag(flags, "help", "h")) {
      const helpKey = `sync ${subcommand}`
      if (commandHelp[helpKey]) {
        console.log(commandHelp[helpKey])
        return
      }
    }

    // Platform sync subcommands (don't need SyncService)
    if (subcommand === "claude") {
      return yield* syncClaude(pos.slice(1), flags)
    } else if (subcommand === "codex") {
      return yield* syncCodex(pos.slice(1), flags)
    }

    const syncSvc = yield* SyncService

    if (subcommand === "export") {
      const path = opt(flags, "path")
      const tasksOnly = flag(flags, "tasks-only")

      if (tasksOnly) {
        // Export tasks only (backward compat)
        const result = yield* syncSvc.export(path)
        if (flag(flags, "json")) {
          console.log(toJson(result))
        } else {
          console.log(`Exported ${result.opCount} operation(s) to ${result.path}`)
        }
      } else {
        // Export all entity types
        const result = yield* syncSvc.exportAll()
        if (flag(flags, "json")) {
          console.log(toJson(result))
        } else {
          console.log(`Tasks: ${result.tasks.opCount} op(s) → ${result.tasks.path}`)
          if (result.learnings) console.log(`Learnings: ${result.learnings.opCount} op(s) → ${result.learnings.path}`)
          if (result.fileLearnings) console.log(`File learnings: ${result.fileLearnings.opCount} op(s) → ${result.fileLearnings.path}`)
          if (result.attempts) console.log(`Attempts: ${result.attempts.opCount} op(s) → ${result.attempts.path}`)
          if (result.pins) console.log(`Pins: ${result.pins.opCount} op(s) → ${result.pins.path}`)
          if (result.anchors) console.log(`Anchors: ${result.anchors.opCount} op(s) → ${result.anchors.path}`)
          if (result.edges) console.log(`Edges: ${result.edges.opCount} op(s) → ${result.edges.path}`)
          if (result.docs) console.log(`Docs: ${result.docs.opCount} op(s) → ${result.docs.path}`)
          if (result.labels) console.log(`Labels: ${result.labels.opCount} op(s) → ${result.labels.path}`)
        }
      }
    } else if (subcommand === "import") {
      const path = opt(flags, "path")
      const tasksOnly = flag(flags, "tasks-only")

      if (tasksOnly) {
        // Import tasks only (backward compat)
        const result = yield* syncSvc.import(path)
        if (flag(flags, "json")) {
          console.log(toJson(result))
        } else {
          console.log(`Tasks: imported=${result.imported}, skipped=${result.skipped}, conflicts=${result.conflicts}`)
          const deps = result.dependencies
          console.log(`Dependencies: added=${deps.added}, removed=${deps.removed}, skipped=${deps.skipped}, failures=${deps.failures.length}`)
          if (deps.failures.length > 0) {
            console.log(`\nDependency failures:`)
            for (const f of deps.failures) {
              console.log(`  ${f.blockerId} -> ${f.blockedId}: ${f.error}`)
            }
          }
        }
      } else {
        // Import all entity types
        const result = yield* syncSvc.importAll()
        if (flag(flags, "json")) {
          console.log(toJson(result))
        } else {
          console.log(`Tasks: imported=${result.tasks.imported}, skipped=${result.tasks.skipped}, conflicts=${result.tasks.conflicts}`)
          const deps = result.tasks.dependencies
          console.log(`Dependencies: added=${deps.added}, removed=${deps.removed}, skipped=${deps.skipped}, failures=${deps.failures.length}`)
          if (result.learnings) console.log(`Learnings: imported=${result.learnings.imported}, skipped=${result.learnings.skipped}`)
          if (result.fileLearnings) console.log(`File learnings: imported=${result.fileLearnings.imported}, skipped=${result.fileLearnings.skipped}`)
          if (result.attempts) console.log(`Attempts: imported=${result.attempts.imported}, skipped=${result.attempts.skipped}`)
          if (result.pins) console.log(`Pins: imported=${result.pins.imported}, skipped=${result.pins.skipped}`)
          if (result.anchors) console.log(`Anchors: imported=${result.anchors.imported}, skipped=${result.anchors.skipped}`)
          if (result.edges) console.log(`Edges: imported=${result.edges.imported}, skipped=${result.edges.skipped}`)
          if (result.docs) console.log(`Docs: imported=${result.docs.imported}, skipped=${result.docs.skipped}`)
          if (result.labels) console.log(`Labels: imported=${result.labels.imported}, skipped=${result.labels.skipped}`)
        }
      }
    } else if (subcommand === "status") {
      const status = yield* syncSvc.status()

      if (flag(flags, "json")) {
        console.log(toJson(status))
      } else {
        console.log(`Sync Status:`)
        console.log(`  Tasks in database: ${status.dbTaskCount}`)
        console.log(`  Operations in JSONL: ${status.jsonlOpCount}`)
        console.log(`  Last export: ${status.lastExport ? status.lastExport.toISOString() : "(never)"}`)
        console.log(`  Last import: ${status.lastImport ? status.lastImport.toISOString() : "(never)"}`)
        console.log(`  Dirty (unexported changes): ${status.isDirty ? "yes" : "no"}`)
        console.log(`  Auto-sync: ${status.autoSyncEnabled ? "enabled" : "disabled"}`)
      }
    } else if (subcommand === "auto") {
      const enableFlag = flag(flags, "enable")
      const disableFlag = flag(flags, "disable")

      if (enableFlag && disableFlag) {
        console.error("Cannot specify both --enable and --disable")
        process.exit(1)
      }

      if (enableFlag) {
        yield* syncSvc.enableAutoSync()
        if (flag(flags, "json")) {
          console.log(toJson({ autoSync: true }))
        } else {
          console.log("Auto-sync enabled")
        }
      } else if (disableFlag) {
        yield* syncSvc.disableAutoSync()
        if (flag(flags, "json")) {
          console.log(toJson({ autoSync: false }))
        } else {
          console.log("Auto-sync disabled")
        }
      } else {
        const enabled = yield* syncSvc.isAutoSyncEnabled()
        if (flag(flags, "json")) {
          console.log(toJson({ autoSync: enabled }))
        } else {
          console.log(`Auto-sync: ${enabled ? "enabled" : "disabled"}`)
        }
      }
    } else if (subcommand === "compact") {
      const path = opt(flags, "path")
      const result = yield* syncSvc.compact(path)

      if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        console.log(`Compacted: ${result.before} → ${result.after} operations`)
      }
    } else {
      console.error(`Unknown sync subcommand: ${subcommand}`)
      console.error(`Run 'tx sync --help' for usage information`)
      process.exit(1)
    }
  })
