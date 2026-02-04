/**
 * Learning commands: learning:add, learning:search, learning:recent, learning:helpful, context, learn, recall
 */

import { Effect, Layer } from "effect"
import { writeFileSync, existsSync, mkdirSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { pathToFileURL } from "node:url"
import { LearningService, FileLearningService, RetrieverService, TaskService, RetrievalError } from "@jamesaphoenix/tx-core"
import type { LearningSourceType, TaskId, EdgeType } from "@jamesaphoenix/tx-types"
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

function parseFloatOpt(flags: Flags, flagName: string, defaultValue: number, ...names: string[]): number {
  const val = opt(flags, ...names)
  if (val === undefined) return defaultValue
  const parsed = parseFloat(val)
  if (Number.isNaN(parsed)) {
    console.error(`Invalid value for --${flagName}: "${val}" is not a valid number`)
    process.exit(1)
  }
  return parsed
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

/**
 * Parse edge types from comma-separated string.
 */
const parseEdgeTypes = (edgeTypesStr: string | undefined): EdgeType[] | undefined => {
  if (!edgeTypesStr) return undefined
  return edgeTypesStr.split(",").map(s => s.trim()).filter(s => s.length > 0) as EdgeType[]
}

export const learningSearch = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const query = pos[0]
    if (!query) {
      console.error("Usage: tx learning:search <query> [-n limit] [--expand] [--depth N] [--edge-types TYPES] [--json]")
      process.exit(1)
    }

    const svc = yield* LearningService
    const limit = opt(flags, "limit", "n") ? parseInt(opt(flags, "limit", "n")!, 10) : 10
    const minScore = parseFloatOpt(flags, "min-score", 0.3, "min-score")

    // Graph expansion options
    const expand = flag(flags, "expand")
    const depth = opt(flags, "depth") ? parseInt(opt(flags, "depth")!, 10) : 2
    const edgeTypes = parseEdgeTypes(opt(flags, "edge-types"))

    const graphExpansion = expand
      ? { enabled: true, depth, edgeTypes }
      : undefined

    const results = yield* svc.search({ query, limit, minScore, graphExpansion })

    if (flag(flags, "json")) {
      console.log(toJson(results))
    } else {
      if (results.length === 0) {
        console.log("No learnings found")
      } else {
        const expandInfo = expand ? " (with graph expansion)" : ""
        console.log(`${results.length} learning(s) found${expandInfo}:`)
        for (const r of results) {
          const score = (r.relevanceScore * 100).toFixed(0)
          const category = r.category ? ` [${r.category}]` : ""
          const hops = r.expansionHops !== undefined && r.expansionHops > 0 ? ` [+${r.expansionHops} hops]` : ""
          console.log(`  #${r.id} (${score}%)${category}${hops} ${r.content.slice(0, 60)}${r.content.length > 60 ? "..." : ""}`)
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
    const score = parseFloatOpt(flags, "score", 1.0, "score")

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

/**
 * Load a custom retriever module from a file path.
 * The module should export a default Layer that provides RetrieverService.
 */
const loadCustomRetriever = (retrieverPath: string) =>
  Effect.gen(function* () {
    const absolutePath = resolve(process.cwd(), retrieverPath)

    if (!existsSync(absolutePath)) {
      console.error(`Error: Retriever module not found: ${absolutePath}`)
      process.exit(1)
    }

    // Dynamic import of the custom retriever module
    const moduleUrl = pathToFileURL(absolutePath).href
    const retrieverModule = yield* Effect.tryPromise({
      try: async () => {
        const mod = await import(moduleUrl)
        return mod.default as Layer.Layer<RetrieverService>
      },
      catch: (e) => new RetrievalError({ reason: `Failed to load retriever module: ${String(e)}` })
    })

    return retrieverModule
  })

export const context = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const taskId = pos[0]
    if (!taskId) {
      console.error("Usage: tx context <task-id> [--json] [--inject] [--expand] [--depth N] [--edge-types TYPES] [--retriever <path>]")
      process.exit(1)
    }

    const retrieverPath = opt(flags, "retriever")

    // Graph expansion options
    const expand = flag(flags, "expand")
    const depth = opt(flags, "depth") ? parseInt(opt(flags, "depth")!, 10) : 2
    const edgeTypes = parseEdgeTypes(opt(flags, "edge-types"))

    // If custom retriever is specified, load it and use it for direct search
    if (retrieverPath) {
      const customRetrieverLayer = yield* loadCustomRetriever(retrieverPath)
      const taskSvc = yield* TaskService
      const startTime = Date.now()

      // Get task to build search query
      const task = yield* taskSvc.get(taskId as TaskId)

      // Build search query from task content
      const searchQuery = `${task.title} ${task.description}`.trim()

      // Build retrieval options with optional graph expansion
      const retrievalOptions = {
        limit: 10,
        minScore: 0.05,
        graphExpansion: expand
          ? { enabled: true, depth, edgeTypes }
          : undefined
      }

      // Use custom retriever for search
      const searchEffect = Effect.gen(function* () {
        const retriever = yield* RetrieverService
        return yield* retriever.search(searchQuery, retrievalOptions)
      })

      const learnings = yield* Effect.provide(searchEffect, customRetrieverLayer)

      const result = {
        taskId,
        taskTitle: task.title,
        learnings,
        searchQuery,
        searchDuration: Date.now() - startTime
      }

      if (flag(flags, "inject")) {
        const contextMd = formatContextMarkdown(result)
        const contextPath = resolve(process.cwd(), ".tx", "context.md")
        mkdirSync(dirname(contextPath), { recursive: true })
        writeFileSync(contextPath, contextMd)
        console.log(`Wrote ${result.learnings.length} learning(s) to ${contextPath} (custom retriever)`)
      } else if (flag(flags, "json")) {
        console.log(toJson(result))
      } else {
        const expandInfo = expand ? " (with graph expansion)" : ""
        console.log(`Context for: ${result.taskId} - ${result.taskTitle} (custom retriever)${expandInfo}`)
        console.log(`  Search query: ${result.searchQuery.slice(0, 50)}...`)
        console.log(`  Search duration: ${result.searchDuration}ms`)
        console.log(`  ${result.learnings.length} relevant learning(s):`)
        for (const l of result.learnings) {
          const score = (l.relevanceScore * 100).toFixed(0)
          const hops = l.expansionHops !== undefined && l.expansionHops > 0 ? ` [+${l.expansionHops} hops]` : ""
          console.log(`    #${l.id} (${score}%)${hops} ${l.content.slice(0, 50)}${l.content.length > 50 ? "..." : ""}`)
        }
      }
      return
    }

    // Default path: use LearningService with built-in retriever
    const svc = yield* LearningService

    // Build context options with graph expansion if enabled
    const contextOptions = expand
      ? { useGraph: true, expansionDepth: depth, edgeTypes }
      : undefined

    const result = yield* svc.getContextForTask(taskId, contextOptions)

    if (flag(flags, "inject")) {
      // Write to .tx/context.md for injection
      const contextMd = formatContextMarkdown(result)
      const contextPath = resolve(process.cwd(), ".tx", "context.md")
      mkdirSync(dirname(contextPath), { recursive: true })
      writeFileSync(contextPath, contextMd)
      const expandInfo = expand ? " (with graph expansion)" : ""
      console.log(`Wrote ${result.learnings.length} learning(s) to ${contextPath}${expandInfo}`)
    } else if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      const expandInfo = expand ? " (with graph expansion)" : ""
      console.log(`Context for: ${result.taskId} - ${result.taskTitle}${expandInfo}`)
      console.log(`  Search query: ${result.searchQuery.slice(0, 50)}...`)
      console.log(`  Search duration: ${result.searchDuration}ms`)
      if (result.graphExpansion) {
        console.log(`  Graph expansion: ${result.graphExpansion.seedCount} seeds, ${result.graphExpansion.expandedCount} expanded, max depth ${result.graphExpansion.maxDepthReached}`)
      }
      console.log(`  ${result.learnings.length} relevant learning(s):`)
      for (const l of result.learnings) {
        const score = (l.relevanceScore * 100).toFixed(0)
        const hops = l.expansionHops !== undefined && l.expansionHops > 0 ? ` [+${l.expansionHops} hops]` : ""
        console.log(`    #${l.id} (${score}%)${hops} ${l.content.slice(0, 50)}${l.content.length > 50 ? "..." : ""}`)
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

const VALID_EMBEDDERS = ["auto", "openai", "local", "noop"] as const
type EmbedderType = typeof VALID_EMBEDDERS[number]

export const learningEmbed = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    // Parse --embedder flag (overrides TX_EMBEDDER env var)
    const embedderArg = opt(flags, "embedder")
    let selectedEmbedder: EmbedderType = "auto"

    if (embedderArg) {
      const normalized = embedderArg.toLowerCase().trim()
      if (!VALID_EMBEDDERS.includes(normalized as EmbedderType)) {
        console.error(`Error: Invalid --embedder value "${embedderArg}"`)
        console.error(`Valid values: ${VALID_EMBEDDERS.join(", ")}`)
        process.exit(1)
      }
      selectedEmbedder = normalized as EmbedderType
      // Set environment variable for EmbeddingServiceAuto to pick up
      if (selectedEmbedder !== "auto") {
        process.env.TX_EMBEDDER = selectedEmbedder
      }
    }

    const svc = yield* LearningService

    // Status check doesn't require embeddings to be enabled
    if (flag(flags, "status")) {
      const status = yield* svc.embeddingStatus()

      if (flag(flags, "json")) {
        console.log(toJson({ ...status, embedder: selectedEmbedder }))
      } else {
        console.log("Embedding Status:")
        console.log(`  Embedder: ${selectedEmbedder}`)
        console.log(`  Total learnings: ${status.total}`)
        console.log(`  With embeddings: ${status.withEmbeddings}`)
        console.log(`  Without embeddings: ${status.withoutEmbeddings}`)
        console.log(`  Coverage: ${status.coveragePercent.toFixed(1)}%`)
      }
      return
    }

    // Check if embeddings are enabled
    if (process.env.TX_EMBEDDINGS !== "1") {
      console.error("Error: Embeddings not enabled. Set TX_EMBEDDINGS=1 to enable.")
      console.error("Example: TX_EMBEDDINGS=1 tx learning:embed")
      process.exit(1)
    }

    const forceAll = flag(flags, "all")
    const result = yield* svc.embedAll(forceAll)

    if (flag(flags, "json")) {
      console.log(toJson({ ...result, embedder: selectedEmbedder }))
    } else {
      console.log("Embedding complete:")
      console.log(`  Embedder: ${selectedEmbedder}`)
      console.log(`  Processed: ${result.processed}`)
      console.log(`  Skipped: ${result.skipped}`)
      console.log(`  Failed: ${result.failed}`)
      console.log(`  Total: ${result.total}`)
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
      console.log("  tx learning:embed             Compute embeddings for learnings")
      console.log("")
      console.log("Run 'tx learning:<command> --help' for command-specific help.")
    }
  })
