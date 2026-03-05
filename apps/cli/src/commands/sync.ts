/**
 * Sync commands: export, import, stream, hydrate, status, auto
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
      if (opt(flags, "path") || flag(flags, "tasks-only")) {
        console.error("legacy file options (--path, --tasks-only) are no longer supported; tx sync export uses stream events only")
        process.exit(1)
      }
      const result = yield* syncSvc.export()
      if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        console.log(`Events: ${result.eventCount} event(s) → ${result.path}`)
      }
    } else if (subcommand === "import") {
      if (opt(flags, "path") || flag(flags, "tasks-only")) {
        console.error("legacy file options (--path, --tasks-only) are no longer supported; tx sync import uses stream events only")
        process.exit(1)
      }
      const result = yield* syncSvc.import()
      if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        console.log(`Events: imported=${result.importedEvents}, applied=${result.appliedEvents}, streams=${result.streamCount}`)
      }
    } else if (subcommand === "stream") {
      const result = yield* syncSvc.stream()
      if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        console.log(`Stream: ${result.streamId}`)
        console.log(`  nextSeq: ${result.nextSeq}`)
        console.log(`  lastSeq: ${result.lastSeq}`)
        console.log(`  eventsDir: ${result.eventsDir}`)
      }
    } else if (subcommand === "hydrate") {
      const result = yield* syncSvc.hydrate()
      if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        console.log(`Hydrated from events: imported=${result.importedEvents}, applied=${result.appliedEvents}, streams=${result.streamCount}`)
      }
    } else if (subcommand === "status") {
      const status = yield* syncSvc.status()

      if (flag(flags, "json")) {
        console.log(toJson(status))
      } else {
        const eventCount = status.eventOpCount
        console.log(`Sync Status:`)
        console.log(`  Tasks in database: ${status.dbTaskCount}`)
        console.log(`  Events in stream logs: ${eventCount}`)
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
    } else {
      console.error(`Unknown sync subcommand: ${subcommand}`)
      console.error(`Run 'tx sync --help' for usage information`)
      process.exit(1)
    }
  })
