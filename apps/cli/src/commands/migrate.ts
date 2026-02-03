/**
 * Migrate commands: status
 */

import { Effect } from "effect"
import { MigrationService } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { commandHelp } from "../help.js"

type Flags = Record<string, string | boolean>

function flag(flags: Flags, ...names: string[]): boolean {
  return names.some(n => flags[n] === true)
}

export const migrate = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const subcommand = pos[0]

    if (!subcommand || subcommand === "help") {
      console.log(commandHelp["migrate"])
      return
    }

    // Check for --help on subcommand
    if (flag(flags, "help", "h")) {
      const helpKey = `migrate ${subcommand}`
      if (commandHelp[helpKey]) {
        console.log(commandHelp[helpKey])
        return
      }
    }

    const migrationSvc = yield* MigrationService

    if (subcommand === "status") {
      const status = yield* migrationSvc.getStatus()

      if (flag(flags, "json")) {
        console.log(toJson(status))
      } else {
        console.log(`Migration Status:`)
        console.log(`  Current version: ${status.currentVersion}`)
        console.log(`  Latest version: ${status.latestVersion}`)
        console.log(`  Pending migrations: ${status.pendingCount}`)
        if (status.appliedMigrations.length > 0) {
          console.log(`\nApplied migrations:`)
          for (const m of status.appliedMigrations) {
            console.log(`  v${m.version} - applied ${m.appliedAt.toISOString()}`)
          }
        }
        if (status.pendingMigrations.length > 0) {
          console.log(`\nPending migrations:`)
          for (const m of status.pendingMigrations) {
            console.log(`  v${m.version} - ${m.description}`)
          }
        }
      }
    } else {
      console.error(`Unknown migrate subcommand: ${subcommand}`)
      console.error(`Run 'tx migrate --help' for usage information`)
      process.exit(1)
    }
  })
