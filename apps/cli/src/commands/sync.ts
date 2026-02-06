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

      // Export tasks
      const result = yield* syncSvc.export(path)

      if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        console.log(`Exported ${result.opCount} operation(s) to ${result.path}`)
      }
    } else if (subcommand === "import") {
      const path = opt(flags, "path")

      // Import tasks
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
