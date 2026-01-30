/**
 * Learning commands: learning:add, learning:search, learning:recent, learning:helpful, context, learn, recall
 */

import { Effect } from "effect"
import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { LearningService, FileLearningService } from "@tx/core"
import type { LearningSourceType } from "@tx/types"
import { toJson, formatContextMarkdown } from "../output.js"
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

export const learningAdd = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const content = pos[0]
    if (!content) {
      console.error("Usage: tx learning:add <content> [-c category] [--source-ref ref] [--json]")
      process.exit(1)
    }

    const svc = yield* LearningService
    const learning = yield* svc.create({
      content,
      category: opt(flags, "category", "c") ?? undefined,
      sourceRef: opt(flags, "source-ref") ?? undefined,
      sourceType: (opt(flags, "source-type") as LearningSourceType) ?? "manual"
    })

    if (flag(flags, "json")) {
      console.log(toJson(learning))
    } else {
      console.log(`Created learning: #${learning.id}`)
      console.log(`  Content: ${learning.content.slice(0, 80)}${learning.content.length > 80 ? "..." : ""}`)
      if (learning.category) console.log(`  Category: ${learning.category}`)
      if (learning.sourceRef) console.log(`  Source: ${learning.sourceRef}`)
    }
  })

export const learningSearch = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const query = pos[0]
    if (!query) {
      console.error("Usage: tx learning:search <query> [-n limit] [--json]")
      process.exit(1)
    }

    const svc = yield* LearningService
    const limit = opt(flags, "limit", "n") ? parseInt(opt(flags, "limit", "n")!, 10) : 10
    const minScore = opt(flags, "min-score") ? parseFloat(opt(flags, "min-score")!) : 0.3

    const results = yield* svc.search({ query, limit, minScore })

    if (flag(flags, "json")) {
      console.log(toJson(results))
    } else {
      if (results.length === 0) {
        console.log("No learnings found")
      } else {
        console.log(`${results.length} learning(s) found:`)
        for (const r of results) {
          const score = (r.relevanceScore * 100).toFixed(0)
          const category = r.category ? ` [${r.category}]` : ""
          console.log(`  #${r.id} (${score}%)${category} ${r.content.slice(0, 60)}${r.content.length > 60 ? "..." : ""}`)
        }
      }
    }
  })

export const learningRecent = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* LearningService
    const limit = opt(flags, "limit", "n") ? parseInt(opt(flags, "limit", "n")!, 10) : 10

    const learnings = yield* svc.getRecent(limit)

    if (flag(flags, "json")) {
      console.log(toJson(learnings))
    } else {
      if (learnings.length === 0) {
        console.log("No learnings found")
      } else {
        console.log(`${learnings.length} recent learning(s):`)
        for (const l of learnings) {
          const category = l.category ? ` [${l.category}]` : ""
          const source = l.sourceType !== "manual" ? ` (${l.sourceType})` : ""
          console.log(`  #${l.id}${category}${source} ${l.content.slice(0, 60)}${l.content.length > 60 ? "..." : ""}`)
        }
      }
    }
  })

export const learningHelpful = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const idStr = pos[0]
    if (!idStr) {
      console.error("Usage: tx learning:helpful <id> [--score 0.8] [--json]")
      process.exit(1)
    }

    const id = parseInt(idStr, 10)
    if (isNaN(id)) {
      console.error("Error: Learning ID must be a number")
      process.exit(1)
    }

    const svc = yield* LearningService
    const score = opt(flags, "score") ? parseFloat(opt(flags, "score")!) : 1.0

    yield* svc.updateOutcome(id, score)
    const learning = yield* svc.get(id)

    if (flag(flags, "json")) {
      console.log(toJson({ success: true, learning }))
    } else {
      console.log(`Recorded helpfulness for learning #${id}`)
      console.log(`  Score: ${(score * 100).toFixed(0)}%`)
      console.log(`  Content: ${learning.content.slice(0, 60)}${learning.content.length > 60 ? "..." : ""}`)
    }
  })

export const context = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const taskId = pos[0]
    if (!taskId) {
      console.error("Usage: tx context <task-id> [--json] [--inject]")
      process.exit(1)
    }

    const svc = yield* LearningService
    const result = yield* svc.getContextForTask(taskId)

    if (flag(flags, "inject")) {
      // Write to .tx/context.md for injection
      const contextMd = formatContextMarkdown(result)
      const contextPath = resolve(process.cwd(), ".tx", "context.md")
      writeFileSync(contextPath, contextMd)
      console.log(`Wrote ${result.learnings.length} learning(s) to ${contextPath}`)
    } else if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(`Context for: ${result.taskId} - ${result.taskTitle}`)
      console.log(`  Search query: ${result.searchQuery.slice(0, 50)}...`)
      console.log(`  Search duration: ${result.searchDuration}ms`)
      console.log(`  ${result.learnings.length} relevant learning(s):`)
      for (const l of result.learnings) {
        const score = (l.relevanceScore * 100).toFixed(0)
        console.log(`    #${l.id} (${score}%) ${l.content.slice(0, 50)}${l.content.length > 50 ? "..." : ""}`)
      }
    }
  })

export const learn = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const pattern = pos[0]
    const note = pos[1]
    if (!pattern || !note) {
      console.error("Usage: tx learn <path> <note> [--task <id>] [--json]")
      process.exit(1)
    }

    const svc = yield* FileLearningService
    const learning = yield* svc.create({
      filePattern: pattern,
      note,
      taskId: opt(flags, "task") ?? undefined
    })

    if (flag(flags, "json")) {
      console.log(toJson(learning))
    } else {
      console.log(`Created file learning: #${learning.id}`)
      console.log(`  Pattern: ${learning.filePattern}`)
      console.log(`  Note: ${learning.note.slice(0, 80)}${learning.note.length > 80 ? "..." : ""}`)
      if (learning.taskId) console.log(`  Task: ${learning.taskId}`)
    }
  })

export const recall = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const path = pos[0]
    const svc = yield* FileLearningService

    if (path) {
      // Recall learnings for specific path
      const learnings = yield* svc.recall(path)

      if (flag(flags, "json")) {
        console.log(toJson(learnings))
      } else {
        if (learnings.length === 0) {
          console.log(`No learnings found for: ${path}`)
        } else {
          console.log(`${learnings.length} learning(s) for ${path}:`)
          for (const l of learnings) {
            const taskInfo = l.taskId ? ` [${l.taskId}]` : ""
            console.log(`  #${l.id}${taskInfo} (${l.filePattern})`)
            console.log(`    ${l.note}`)
          }
        }
      }
    } else {
      // List all learnings
      const learnings = yield* svc.getAll()

      if (flag(flags, "json")) {
        console.log(toJson(learnings))
      } else {
        if (learnings.length === 0) {
          console.log("No file learnings found")
        } else {
          console.log(`${learnings.length} file learning(s):`)
          for (const l of learnings) {
            const taskInfo = l.taskId ? ` [${l.taskId}]` : ""
            console.log(`  #${l.id}${taskInfo} ${l.filePattern}`)
            console.log(`    ${l.note.slice(0, 60)}${l.note.length > 60 ? "..." : ""}`)
          }
        }
      }
    }
  })

// Help command handler for learning subcommands
export const learningHelp = (subcommand: string) =>
  Effect.sync(() => {
    const helpKey = `learning:${subcommand}`
    if (commandHelp[helpKey]) {
      console.log(commandHelp[helpKey])
    } else {
      console.log("Learning commands:")
      console.log("  tx learning:add <content>     Add a learning")
      console.log("  tx learning:search <query>    Search learnings")
      console.log("  tx learning:recent            List recent learnings")
      console.log("  tx learning:helpful <id>      Record helpfulness")
      console.log("")
      console.log("Run 'tx learning:<command> --help' for command-specific help.")
    }
  })
