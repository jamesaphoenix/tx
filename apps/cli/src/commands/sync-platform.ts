/**
 * Platform sync commands: claude, codex
 *
 * One-way push of tx tasks to external agent task systems.
 * Writes directly to the target platform's on-disk task format.
 */

import { Effect } from "effect"
import { join, resolve } from "node:path"
import { existsSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs"
import { homedir } from "node:os"
import { TaskService, buildClaudeTaskFiles } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { type Flags, flag, opt } from "../utils/parse.js"
import { movedCommandError, usageError, validationError } from "../cli-errors.js"

export const syncClaude = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const taskSvc = yield* TaskService

    // Resolve target directory
    const teamName = opt(flags, "team")
    const dirOverride = opt(flags, "dir")
    let targetDir: string

    if (teamName) {
      // Validate team name to prevent path traversal (e.g. --team ../../.ssh)
      if (!/^[a-zA-Z0-9_-]+$/.test(teamName)) {
        return yield* Effect.fail(validationError({
          code: "cli/invalid-team-name",
          command: "sync claude",
          message: "Invalid team name.",
          hint: "Team names may contain only letters, numbers, hyphens, and underscores.",
          usage: "tx sync claude --team <name> [--json]",
          examples: [
            "tx sync claude --team backend",
            "tx sync claude --dir ./.claude/tasks/backend",
          ],
          details: {
            received: teamName,
          },
        }))
      }
      targetDir = join(homedir(), ".claude", "tasks", teamName)
    } else if (dirOverride) {
      targetDir = resolve(dirOverride)
    } else {
      return yield* Effect.fail(usageError({
        code: "cli/missing-flag",
        command: "sync claude",
        message: "Missing required target for Claude sync.",
        hint: "Pass either --team <name> or --dir <path>.",
        usage: "tx sync claude (--team <name> | --dir <path>) [--json]",
        examples: [
          "tx sync claude --team backend",
          "tx sync claude --dir ./.claude/tasks/backend",
        ],
      }))
    }

    // Create directory if it doesn't exist
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true })
    }

    const allTasks = yield* taskSvc.listWithDeps()
    const { files, highwatermark } = buildClaudeTaskFiles(allTasks)

    // Remove stale task files from previous syncs
    const newIds = new Set(files.map(f => `${f.id}.json`))
    const existing = readdirSync(targetDir).filter(f => /^\d+\.json$/.test(f))
    for (const stale of existing) {
      if (!newIds.has(stale)) {
        unlinkSync(join(targetDir, stale))
      }
    }

    // Write individual task JSON files
    for (const file of files) {
      writeFileSync(join(targetDir, `${file.id}.json`), JSON.stringify(file, null, 2))
    }

    // Write highwatermark
    writeFileSync(join(targetDir, ".highwatermark"), String(highwatermark))

    // Ensure .lock file exists
    const lockPath = join(targetDir, ".lock")
    if (!existsSync(lockPath)) {
      writeFileSync(lockPath, "")
    }

    if (flag(flags, "json")) {
      console.log(toJson({ tasksWritten: files.length, dir: targetDir, highwatermark }))
    } else {
      console.log(`Wrote ${files.length} task(s) to ${targetDir}`)
      const readyCount = files.filter(f => f.blockedBy.length === 0 && f.status === "pending").length
      const inProgressCount = files.filter(f => f.status === "in_progress").length
      console.log(`  Ready: ${readyCount}, In-progress: ${inProgressCount}, Blocked: ${files.length - readyCount - inProgressCount}`)
    }
  })

export const syncCodex = (_pos: string[], _flags: Flags) =>
  Effect.fail(movedCommandError({
    command: "sync codex",
    message: "Codex sync is not yet implemented.",
    hint: "Use `tx sync claude` for Claude Code until the Codex sync target exists.",
  }))
