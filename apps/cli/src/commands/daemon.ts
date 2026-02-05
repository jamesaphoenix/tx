/**
 * Daemon commands: start, stop, status, process, review, promote, reject, track, untrack, list
 */

import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"
import { Effect } from "effect"
import {
  CandidateRepository,
  CandidateExtractorService,
  DaemonService,
  DeduplicationService,
  PromotionService,
  TrackedProjectRepository,
  matchesGlob
} from "@jamesaphoenix/tx-core"
import { CANDIDATE_CONFIDENCES, SOURCE_TYPES, type CandidateConfidence, type SourceType, type TranscriptChunk } from "@jamesaphoenix/tx-types"
import { toJson } from "../output.js"
import { commandHelp } from "../help.js"
import { type Flags, flag, opt, parseIntOpt } from "../utils/parse.js"

/**
 * Format uptime in milliseconds to a human-readable string.
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

/**
 * Expand ~ to home directory in a path.
 */
function expandTilde(filePath: string): string {
  if (filePath.startsWith("~")) {
    return filePath.replace(/^~/, os.homedir())
  }
  return filePath
}

/**
 * Find all files matching a glob pattern.
 */
function findFilesMatchingPattern(pattern: string): string[] {
  const expanded = expandTilde(pattern)

  // Extract base directory (everything before first glob char)
  const firstGlobIndex = expanded.search(/[*?[\]{}]/)
  if (firstGlobIndex === -1) {
    // No glob chars - treat as literal path
    if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) {
      return [expanded]
    }
    return []
  }

  // Get base directory
  const beforeGlob = expanded.slice(0, firstGlobIndex)
  const lastSep = Math.max(beforeGlob.lastIndexOf("/"), beforeGlob.lastIndexOf(path.sep))
  const baseDir = lastSep > 0 ? expanded.slice(0, lastSep) : "."

  if (!fs.existsSync(baseDir)) {
    return []
  }

  // Recursively find all files and filter by pattern
  const allFiles = getAllFilesRecursive(baseDir)
  return allFiles.filter(f => matchesGlob(f, expanded))
}

/**
 * Recursively get all files in a directory.
 */
function getAllFilesRecursive(dir: string): string[] {
  const results: string[] = []

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        // Skip hidden directories and node_modules
        if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
          results.push(...getAllFilesRecursive(fullPath))
        }
      } else if (entry.isFile()) {
        results.push(fullPath)
      }
    }
  } catch {
    // Ignore permission errors etc
  }

  return results
}

/**
 * Find all JSONL files in a directory (recursively).
 */
function findJsonlFilesInDirectory(dir: string): string[] {
  const expanded = expandTilde(dir)
  if (!fs.existsSync(expanded)) {
    return []
  }

  const allFiles = getAllFilesRecursive(expanded)
  return allFiles.filter(f => f.endsWith(".jsonl"))
}

/**
 * Read a JSONL file and return each line as a string.
 * Skips empty lines.
 */
function readJsonlFile(filePath: string): string[] {
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    return content
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.length > 0)
  } catch {
    return []
  }
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
      const daemonService = yield* DaemonService
      const result = yield* Effect.either(daemonService.start())

      if (result._tag === "Left") {
        const error = result.left
        if (error.code === "ALREADY_RUNNING") {
          if (flag(flags, "json")) {
            console.log(toJson({ error: "already_running", pid: error.pid }))
          } else {
            console.error(`Daemon is already running with PID ${error.pid}`)
          }
        } else {
          if (flag(flags, "json")) {
            console.log(toJson({ error: error.code, message: error.message }))
          } else {
            console.error(`Failed to start daemon: ${error.message}`)
          }
        }
        process.exit(1)
      }

      if (flag(flags, "json")) {
        console.log(toJson({ started: true }))
      } else {
        console.log("Daemon started")
      }
    } else if (subcommand === "stop") {
      const daemonService = yield* DaemonService
      const result = yield* Effect.either(daemonService.stop())

      if (result._tag === "Left") {
        const error = result.left
        if (flag(flags, "json")) {
          console.log(toJson({ error: error.code, message: error.message }))
        } else {
          console.error(`Failed to stop daemon: ${error.message}`)
        }
        process.exit(1)
      }

      if (flag(flags, "json")) {
        console.log(toJson({ stopped: true }))
      } else {
        console.log("Daemon stopped")
      }
    } else if (subcommand === "status") {
      const daemonService = yield* DaemonService
      const trackedProjectRepo = yield* TrackedProjectRepository
      const candidateRepo = yield* CandidateRepository

      const statusResult = yield* Effect.either(daemonService.status())

      if (statusResult._tag === "Left") {
        const error = statusResult.left
        if (flag(flags, "json")) {
          console.log(toJson({ error: error.code, message: error.message }))
        } else {
          console.error(`Failed to get daemon status: ${error.message}`)
        }
        process.exit(1)
      }

      const status = statusResult.right

      // Get tracked projects count
      const projects = yield* trackedProjectRepo.findAll()
      const trackedProjects = projects.length
      const enabledProjects = projects.filter(p => p.enabled).length

      // Get pending candidates count
      const pendingCandidates = yield* candidateRepo.findByFilter({ status: "pending" })
      const pendingCount = pendingCandidates.length

      if (flag(flags, "json")) {
        console.log(toJson({
          running: status.running,
          pid: status.pid,
          uptime: status.uptime,
          startedAt: status.startedAt?.toISOString() ?? null,
          trackedProjects,
          enabledProjects,
          pendingCandidates: pendingCount
        }))
      } else {
        if (status.running) {
          console.log("Daemon: running")
          console.log(`  PID: ${status.pid}`)
          if (status.uptime !== null) {
            const uptimeStr = formatUptime(status.uptime)
            console.log(`  Uptime: ${uptimeStr}`)
          }
        } else {
          console.log("Daemon: stopped")
        }
        console.log(`  Tracked projects: ${enabledProjects}/${trackedProjects}`)
        console.log(`  Pending candidates: ${pendingCount}`)
      }
    } else if (subcommand === "process") {
      // Process JSONL files to extract learning candidates
      const candidateRepo = yield* CandidateRepository
      const extractorService = yield* CandidateExtractorService
      const dedupService = yield* DeduplicationService
      const trackedProjectRepo = yield* TrackedProjectRepository

      // Parse --path flag for glob pattern
      const pathPattern = opt(flags, "path", "p")

      // Find files to process
      let filesToProcess: string[] = []

      if (pathPattern) {
        // User specified a path pattern - expand it
        filesToProcess = findFilesMatchingPattern(pathPattern)
      } else {
        // Use tracked projects to find JSONL files
        const projects = yield* trackedProjectRepo.findAll()
        const enabledProjects = projects.filter(p => p.enabled)

        if (enabledProjects.length === 0) {
          if (flag(flags, "json")) {
            console.log(toJson({ error: "no_tracked_projects", message: "No tracked projects found. Use 'tx daemon track <path>' to add one." }))
          } else {
            console.error("No tracked projects found. Use 'tx daemon track <path>' to add one.")
            console.error("Or specify a path pattern with --path <glob>")
          }
          process.exit(1)
        }

        // Find JSONL files in tracked projects
        for (const project of enabledProjects) {
          const projectFiles = findJsonlFilesInDirectory(project.projectPath)
          filesToProcess.push(...projectFiles)
        }
      }

      if (filesToProcess.length === 0) {
        if (flag(flags, "json")) {
          console.log(toJson({ filesProcessed: 0, candidatesExtracted: 0, message: "No JSONL files found" }))
        } else {
          console.log("No JSONL files found to process")
        }
        return
      }

      // Process each file
      let totalFilesProcessed = 0
      let totalLinesProcessed = 0
      let totalNewLines = 0
      let totalCandidatesExtracted = 0
      const fileResults: Array<{
        file: string
        linesProcessed: number
        newLines: number
        candidatesExtracted: number
      }> = []

      // Check if extractor is available
      const extractorAvailable = yield* extractorService.isAvailable()
      if (!extractorAvailable && !flag(flags, "json")) {
        console.log("Note: LLM extraction not available (no API key configured)")
        console.log("Processing will track files but not extract candidates")
      }

      for (const filePath of filesToProcess) {
        // Read and parse the JSONL file
        const lines = readJsonlFile(filePath)
        if (lines.length === 0) {
          continue
        }

        // Prepare lines for deduplication
        const lineInputs = lines.map((content, idx) => ({
          content,
          lineNumber: idx + 1
        }))

        // Process lines through deduplication
        const dedupResult = yield* dedupService.processLines(lineInputs, filePath)

        // Get the new lines that weren't already processed
        const newLineContents = lineInputs
          .filter(l => l.lineNumber > dedupResult.endLine - dedupResult.newLines)
          .slice(-dedupResult.newLines)
          .map(l => l.content)

        let candidatesExtracted = 0

        // Extract candidates from new lines if extractor is available
        if (extractorAvailable && newLineContents.length > 0) {
          // Combine new lines into a transcript chunk for extraction
          const combinedContent = newLineContents.join("\n")
          const chunk: TranscriptChunk = {
            content: combinedContent,
            sourceFile: filePath,
            lineRange: {
              start: dedupResult.startLine,
              end: dedupResult.endLine
            }
          }

          const extractionResult = yield* Effect.either(extractorService.extract(chunk))

          if (extractionResult._tag === "Right" && extractionResult.right.wasExtracted) {
            // Store extracted candidates
            for (const candidate of extractionResult.right.candidates) {
              yield* candidateRepo.insert({
                content: candidate.content,
                confidence: candidate.confidence,
                category: candidate.category,
                sourceFile: filePath
              })
              candidatesExtracted++
            }
          }
        }

        totalFilesProcessed++
        totalLinesProcessed += lines.length
        totalNewLines += dedupResult.newLines
        totalCandidatesExtracted += candidatesExtracted

        fileResults.push({
          file: filePath,
          linesProcessed: lines.length,
          newLines: dedupResult.newLines,
          candidatesExtracted
        })
      }

      // Output results
      if (flag(flags, "json")) {
        console.log(toJson({
          filesProcessed: totalFilesProcessed,
          linesProcessed: totalLinesProcessed,
          newLines: totalNewLines,
          candidatesExtracted: totalCandidatesExtracted,
          files: fileResults
        }))
      } else {
        console.log(`Processed ${totalFilesProcessed} file(s)`)
        console.log(`  Lines processed: ${totalLinesProcessed}`)
        console.log(`  New lines: ${totalNewLines}`)
        console.log(`  Candidates extracted: ${totalCandidatesExtracted}`)

        if (fileResults.length > 0 && fileResults.some(f => f.newLines > 0)) {
          console.log("\nFiles with new content:")
          for (const f of fileResults.filter(f => f.newLines > 0)) {
            console.log(`  ${f.file}: ${f.newLines} new lines, ${f.candidatesExtracted} candidates`)
          }
        }
      }
    } else if (subcommand === "review") {
      // List pending learning candidates awaiting promotion
      const repo = yield* CandidateRepository

      // Parse --confidence flag (comma-separated list)
      const confidenceOpt = opt(flags, "confidence", "c")
      let confidences: CandidateConfidence[] | undefined
      if (confidenceOpt) {
        const parts = confidenceOpt.split(",").map(s => s.trim())
        const invalid = parts.filter(p => !CANDIDATE_CONFIDENCES.includes(p as CandidateConfidence))
        if (invalid.length > 0) {
          console.error(`Invalid confidence level(s): ${invalid.join(", ")}`)
          console.error(`Valid levels: ${CANDIDATE_CONFIDENCES.join(", ")}`)
          process.exit(1)
        }
        confidences = parts as CandidateConfidence[]
      }

      // Parse --limit flag
      const limit = parseIntOpt(flags, "limit", "limit", "l")
      if (limit !== undefined && limit <= 0) {
        console.error(`Invalid limit: ${limit}`)
        process.exit(1)
      }

      // Query pending candidates
      const candidates = yield* repo.findByFilter({
        status: "pending",
        confidence: confidences,
        limit
      })

      if (flag(flags, "json")) {
        console.log(toJson(candidates.map(c => ({
          id: c.id,
          confidence: c.confidence,
          category: c.category,
          content: c.content,
          sourceFile: c.sourceFile,
          extractedAt: c.extractedAt.toISOString()
        }))))
      } else {
        if (candidates.length === 0) {
          console.log("No pending candidates")
        } else {
          console.log(`Pending candidates (${candidates.length}):`)
          for (const c of candidates) {
            // Truncate content for preview (first 60 chars)
            const preview = c.content.length > 60
              ? c.content.slice(0, 60) + "..."
              : c.content
            console.log(`  [${c.id}] ${c.confidence} - ${preview}`)
            console.log(`       Source: ${c.sourceFile}`)
          }
        }
      }
    } else if (subcommand === "promote") {
      const candidateIdStr = pos[1]
      if (!candidateIdStr) {
        console.error("Usage: tx daemon promote <candidate-id>")
        process.exit(1)
      }

      const candidateId = parseInt(candidateIdStr, 10)
      if (isNaN(candidateId)) {
        console.error(`Invalid candidate ID: ${candidateIdStr}`)
        process.exit(1)
      }

      const promotionService = yield* PromotionService
      const result = yield* Effect.either(promotionService.promote(candidateId))

      if (result._tag === "Left") {
        const error = result.left
        if (error._tag === "CandidateNotFoundError") {
          if (flag(flags, "json")) {
            console.log(toJson({ error: "not_found", candidateId }))
          } else {
            console.error(`Candidate not found: ${candidateId}`)
          }
        } else {
          if (flag(flags, "json")) {
            console.log(toJson({ error: "database_error", message: error.message }))
          } else {
            console.error(`Database error: ${error.message}`)
          }
        }
        process.exit(1)
      }

      const { candidate, learning } = result.right
      if (flag(flags, "json")) {
        console.log(toJson({
          promoted: true,
          candidateId: candidate.id,
          learningId: learning.id
        }))
      } else {
        console.log(`Promoted candidate ${candidate.id} to learning ${learning.id}`)
      }
    } else if (subcommand === "reject") {
      const candidateIdStr = pos[1]
      if (!candidateIdStr) {
        console.error("Usage: tx daemon reject <candidate-id> --reason <reason>")
        process.exit(1)
      }

      const candidateId = parseInt(candidateIdStr, 10)
      if (isNaN(candidateId)) {
        console.error(`Invalid candidate ID: ${candidateIdStr}`)
        process.exit(1)
      }

      const reason = opt(flags, "reason", "r")
      if (!reason) {
        console.error("Usage: tx daemon reject <candidate-id> --reason <reason>")
        console.error("The --reason flag is required")
        process.exit(1)
      }

      const promotionService = yield* PromotionService
      const result = yield* Effect.either(promotionService.reject(candidateId, reason))

      if (result._tag === "Left") {
        const error = result.left
        if (error._tag === "CandidateNotFoundError") {
          if (flag(flags, "json")) {
            console.log(toJson({ error: "not_found", candidateId }))
          } else {
            console.error(`Candidate not found: ${candidateId}`)
          }
        } else if (error._tag === "ValidationError") {
          if (flag(flags, "json")) {
            console.log(toJson({ error: "validation_error", message: error.reason }))
          } else {
            console.error(`Validation error: ${error.reason}`)
          }
        } else {
          if (flag(flags, "json")) {
            console.log(toJson({ error: "database_error", message: error.message }))
          } else {
            console.error(`Database error: ${error.message}`)
          }
        }
        process.exit(1)
      }

      const candidate = result.right
      if (flag(flags, "json")) {
        console.log(toJson({
          rejected: true,
          candidateId: candidate.id,
          reason: candidate.rejectionReason
        }))
      } else {
        console.log(`Rejected candidate ${candidate.id}`)
        console.log(`  Reason: ${candidate.rejectionReason}`)
      }
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
