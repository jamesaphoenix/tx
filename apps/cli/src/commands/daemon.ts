/**
 * Daemon commands: start, stop, status, process, review, promote, reject, track, untrack, list
 */

import * as path from "node:path"
import { Effect } from "effect"
import { CandidateRepository, PromotionService, TrackedProjectRepository } from "@tx/core"
import { CANDIDATE_CONFIDENCES, SOURCE_TYPES, type CandidateConfidence, type SourceType } from "@tx/types"
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
      const limitOpt = opt(flags, "limit", "l")
      let limit: number | undefined
      if (limitOpt) {
        limit = parseInt(limitOpt, 10)
        if (isNaN(limit) || limit <= 0) {
          console.error(`Invalid limit: ${limitOpt}`)
          process.exit(1)
        }
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
