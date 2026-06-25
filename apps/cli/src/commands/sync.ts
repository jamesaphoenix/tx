/**
 * Sync commands: export, import, stream, hydrate, status, auto, compact, history, migrate
 */

import { Effect } from "effect"
import { SyncService } from "@jamesaphoenix/tx"
import { toJson } from "../output.js"
import { commandHelp } from "../help.js"
import { type Flags, flag, opt } from "../utils/parse.js"
import { unknownSubcommandError, usageError } from "../cli-errors.js"
import { syncClaude, syncCodex } from "./sync-platform.js"
import { compact, history } from "./compact.js"
import { migrate } from "./migrate.js"

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

    // Absorbed commands: compact, history, migrate
    if (subcommand === "compact") {
      return yield* compact(pos.slice(1), flags)
    } else if (subcommand === "history") {
      return yield* history(pos.slice(1), flags)
    } else if (subcommand === "migrate") {
      return yield* migrate(pos.slice(1), flags)
    }

    const syncSvc = yield* SyncService

    if (subcommand === "export") {
      if (opt(flags, "path") || flag(flags, "tasks-only")) {
        return yield* Effect.fail(usageError({
          code: "cli/legacy-option",
          command: "sync export",
          message: "Legacy file options are no longer supported for `tx sync export`.",
          hint: "Run `tx sync export` without --path or --tasks-only. Export now writes stream events automatically.",
          usage: "tx sync export [--json]",
          examples: [
            "tx sync export",
            "tx sync export --json",
          ],
        }))
      }
      const result = yield* syncSvc.export()
      if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        console.log(`Events: ${result.eventCount} event(s) → ${result.path}`)
      }
    } else if (subcommand === "import") {
      if (opt(flags, "path") || flag(flags, "tasks-only")) {
        return yield* Effect.fail(usageError({
          code: "cli/legacy-option",
          command: "sync import",
          message: "Legacy file options are no longer supported for `tx sync import`.",
          hint: "Run `tx sync import` without --path or --tasks-only. Import now reads stream events automatically.",
          usage: "tx sync import [--json]",
          examples: [
            "tx sync import",
            "tx sync import --json",
          ],
        }))
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
        return yield* Effect.fail(usageError({
          code: "cli/conflicting-flags",
          command: "sync auto",
          message: "Cannot specify both --enable and --disable.",
          hint: "Choose one mode or omit both flags to inspect the current auto-sync state.",
          usage: "tx sync auto [--enable | --disable] [--json]",
          examples: [
            "tx sync auto --enable",
            "tx sync auto --disable --json",
          ],
        }))
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
      return yield* Effect.fail(unknownSubcommandError({
        command: "sync",
        subcommand,
        usage: "tx sync <export|import|stream|hydrate|status|auto|claude|codex|compact|history|migrate>",
        examples: [
          "tx sync export",
          "tx sync status --json",
        ],
      }))
    }
  })
