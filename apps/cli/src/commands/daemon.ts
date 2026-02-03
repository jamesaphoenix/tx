/**
 * Daemon commands: start, stop, status, process, review, promote, reject, track, untrack, list
 */

import * as path from "node:path"
import { Effect } from "effect"
import { TrackedProjectRepository } from "@tx/core"
import { SOURCE_TYPES, type SourceType } from "@tx/types"
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

export const daemon = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const subcommand = pos[0]

    if (!subcommand || subcommand === "help") {
      console.log(commandHelp["daemon"])
      return
    }

    // Check for --help on subcommand
    if (flag(flags, "help", "h")) {
      const helpKey = `daemon ${subcommand}`
      if (commandHelp[helpKey]) {
        console.log(commandHelp[helpKey])
        return
      }
    }

    if (subcommand === "start") {
      // TODO: Implement daemon start (tx-5afa592c)
      console.error("daemon start: not implemented yet")
      process.exit(1)
    } else if (subcommand === "stop") {
      // TODO: Implement daemon stop (tx-5afa592c)
      console.error("daemon stop: not implemented yet")
      process.exit(1)
    } else if (subcommand === "status") {
      // TODO: Implement daemon status (tx-5afa592c)
      console.error("daemon status: not implemented yet")
      process.exit(1)
    } else if (subcommand === "process") {
      // TODO: Implement daemon process (tx-b9c33ac5)
      console.error("daemon process: not implemented yet")
      process.exit(1)
    } else if (subcommand === "review") {
      // TODO: Implement daemon review (tx-bcd789d8)
      const candidateId = pos[1]
      if (!candidateId) {
        console.error("Usage: tx daemon review <candidate-id>")
        process.exit(1)
      }
      console.error("daemon review: not implemented yet")
      process.exit(1)
    } else if (subcommand === "promote") {
      // TODO: Implement daemon promote (tx-ea4469d5)
      const candidateId = pos[1]
      if (!candidateId) {
        console.error("Usage: tx daemon promote <candidate-id>")
        process.exit(1)
      }
      console.error("daemon promote: not implemented yet")
      process.exit(1)
    } else if (subcommand === "reject") {
      // TODO: Implement daemon reject (tx-ea4469d5)
      const candidateId = pos[1]
      if (!candidateId) {
        console.error("Usage: tx daemon reject <candidate-id> --reason <reason>")
        process.exit(1)
      }
      console.error("daemon reject: not implemented yet")
      process.exit(1)
    } else if (subcommand === "track") {
      const projectPath = pos[1]
      if (!projectPath) {
        console.error("Usage: tx daemon track <project-path> [--source claude|cursor|windsurf|other]")
        process.exit(1)
      }

      const repo = yield* TrackedProjectRepository
      const absolutePath = path.resolve(projectPath)

      // Validate source type if provided
      const sourceOpt = opt(flags, "source", "s")
      let sourceType: SourceType = "claude"
      if (sourceOpt) {
        if (!SOURCE_TYPES.includes(sourceOpt as SourceType)) {
          console.error(`Invalid source type: ${sourceOpt}`)
          console.error(`Valid types: ${SOURCE_TYPES.join(", ")}`)
          process.exit(1)
        }
        sourceType = sourceOpt as SourceType
      }

      // Check if already tracked
      const existing = yield* repo.findByPath(absolutePath)
      if (existing) {
        if (flag(flags, "json")) {
          console.log(toJson({ error: "already_tracked", path: absolutePath }))
        } else {
          console.error(`Project already tracked: ${absolutePath}`)
        }
        process.exit(1)
      }

      const tracked = yield* repo.insert({
        projectPath: absolutePath,
        sourceType
      })

      if (flag(flags, "json")) {
        console.log(toJson(tracked))
      } else {
        console.log(`Tracking project: ${tracked.projectPath}`)
        console.log(`  Source: ${tracked.sourceType}`)
        console.log(`  Enabled: ${tracked.enabled ? "yes" : "no"}`)
      }
    } else if (subcommand === "untrack") {
      const projectPath = pos[1]
      if (!projectPath) {
        console.error("Usage: tx daemon untrack <project-path>")
        process.exit(1)
      }

      const repo = yield* TrackedProjectRepository
      const absolutePath = path.resolve(projectPath)

      // Find the tracked project
      const existing = yield* repo.findByPath(absolutePath)
      if (!existing) {
        if (flag(flags, "json")) {
          console.log(toJson({ error: "not_tracked", path: absolutePath }))
        } else {
          console.error(`Project not tracked: ${absolutePath}`)
        }
        process.exit(1)
      }

      const deleted = yield* repo.delete(existing.id)
      if (deleted) {
        if (flag(flags, "json")) {
          console.log(toJson({ untracked: absolutePath }))
        } else {
          console.log(`Untracked project: ${absolutePath}`)
        }
      } else {
        if (flag(flags, "json")) {
          console.log(toJson({ error: "delete_failed", path: absolutePath }))
        } else {
          console.error(`Failed to untrack project: ${absolutePath}`)
        }
        process.exit(1)
      }
    } else if (subcommand === "list") {
      const repo = yield* TrackedProjectRepository
      const projects = yield* repo.findAll()

      if (flag(flags, "json")) {
        console.log(toJson(projects))
      } else {
        if (projects.length === 0) {
          console.log("No tracked projects")
        } else {
          console.log("Tracked projects:")
          for (const p of projects) {
            const status = p.enabled ? "enabled" : "disabled"
            console.log(`  ${p.projectPath}`)
            console.log(`    Source: ${p.sourceType}, Status: ${status}`)
          }
        }
      }
    } else {
      console.error(`Unknown daemon subcommand: ${subcommand}`)
      console.error(`Run 'tx daemon --help' for usage information`)
      process.exit(1)
    }
  })
