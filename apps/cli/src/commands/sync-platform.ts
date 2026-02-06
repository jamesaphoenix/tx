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
        console.error("Invalid team name: must contain only alphanumeric characters, hyphens, and underscores")
        process.exit(1)
      }
      targetDir = join(homedir(), ".claude", "tasks", teamName)
    } else if (dirOverride) {
      targetDir = resolve(dirOverride)
    } else {
      console.error("Either --team <name> or --dir <path> is required")
      process.exit(1)
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
  Effect.sync(() => {
    console.error("Codex sync is not yet implemented. Use 'tx sync claude' for Claude Code.")
    process.exit(1)
  })
