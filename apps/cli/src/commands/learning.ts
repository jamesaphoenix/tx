/**
 * Learning commands: learning add, learning search, learning recent, learning helpful, context, learn, recall
 *
 * Learnings are thin wrappers around the Memory system. Each learning is a .md file
 * in docs/learnings/ tagged with "learning". File-associated learnings use a
 * file_pattern property in frontmatter.
 */

import { Effect } from "effect"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { randomBytes } from "node:crypto"
import { MemoryService, MemoryRetrieverService, TaskService, LearningService, FileLearningService } from "@jamesaphoenix/tx-core"
import { LEARNING_SOURCE_TYPES } from "@jamesaphoenix/tx-types"
import type { LearningSourceType } from "@jamesaphoenix/tx-types"
import { toJson } from "../output.js"
import { commandHelp } from "../help.js"
import { type Flags, flag, opt, parseIntOpt, parseFloatOpt, parseTaskId } from "../utils/parse.js"

/**
 * Extract the actual learning body from a memory document's content.
 * Strips frontmatter and the auto-generated title heading.
 */
const extractBody = (content: string): string => {
  // Strip frontmatter block
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n+/)
  const body = fmMatch ? content.slice(fmMatch[0].length) : content
  // Strip title heading (# ...)
  const titleMatch = body.match(/^#[^\n]*\n+/)
  return (titleMatch ? body.slice(titleMatch[0].length) : body).trim()
}

/** Relative path (from cwd) where learning .md files live */
const LEARNINGS_DIR = "docs/learnings"
/** Parent directory to register as a memory source */
const DOCS_DIR = "docs"

/**
 * Ensure docs/learnings/ exists and docs/ is registered as a memory source.
 * Called before any learning write operation.
 */
const ensureLearningsDir = () =>
  Effect.gen(function* () {
    const learningsDir = resolve(process.cwd(), LEARNINGS_DIR)
    const docsDir = resolve(process.cwd(), DOCS_DIR)

    // Ensure the directories exist on disk
    mkdirSync(learningsDir, { recursive: true })

    // Ensure docs/ is registered as a memory source
    const memSvc = yield* MemoryService
    const sources = yield* memSvc.listSources()
    const docsRegistered = sources.some(s => s.rootDir === docsDir)
    if (!docsRegistered) {
      yield* memSvc.addSource(docsDir, "docs")
    }
  })

/**
 * Generate a learning document title from content.
 * Produces a slug-friendly title like "always-use-effect-gen-a1b2c3".
 */
const learningTitle = (content: string): string => {
  const words = content
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(w => w.length > 0)
    .slice(0, 6)
    .join(" ")
  const suffix = randomBytes(3).toString("hex")
  return words.length > 0 ? `${words} ${suffix}` : `learning ${suffix}`
}

export const learningAdd = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const content = pos[0]
    if (!content) {
      console.error("Usage: tx learning add <content> [-c category] [--source-ref ref] [--json]")
      process.exit(1)
    }

    const sourceTypeArg = opt(flags, "source-type")
    let sourceType: LearningSourceType = "manual"
    if (sourceTypeArg) {
      if (!(LEARNING_SOURCE_TYPES as readonly string[]).includes(sourceTypeArg)) {
        console.error(`Error: Invalid --source-type "${sourceTypeArg}". Valid types: ${LEARNING_SOURCE_TYPES.join(", ")}`)
        process.exit(1)
      }
      sourceType = sourceTypeArg as LearningSourceType
    }

    yield* ensureLearningsDir()
    const memSvc = yield* MemoryService

    // Build properties from flags
    const properties: Record<string, string> = { source_type: sourceType }
    const category = opt(flags, "category", "c")
    if (category) properties.category = category
    const sourceRef = opt(flags, "source-ref")
    if (sourceRef) properties.source_ref = sourceRef

    const doc = yield* memSvc.createDocument({
      title: learningTitle(content),
      content,
      tags: ["learning"],
      dir: resolve(process.cwd(), LEARNINGS_DIR),
      properties
    })

    if (flag(flags, "json")) {
      console.log(toJson({
        id: doc.id,
        content,
        category: category ?? null,
        sourceRef: sourceRef ?? null,
        sourceType,
        filePath: doc.filePath,
      }))
    } else {
      console.log(`Created learning: ${doc.id}`)
      console.log(`  Content: ${content.slice(0, 80)}${content.length > 80 ? "..." : ""}`)
      if (category) console.log(`  Category: ${category}`)
      if (sourceRef) console.log(`  Source: ${sourceRef}`)
    }
  })

export const learningSearch = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const query = pos[0]
    if (!query) {
      console.error("Usage: tx learning search <query> [-n limit] [--json]")
      process.exit(1)
    }

    const retriever = yield* MemoryRetrieverService
    const limit = parseIntOpt(flags, "limit", "limit", "n") ?? 10
    const minScore = parseFloatOpt(flags, "min-score", "min-score") ?? 0.3

    const results = yield* retriever.search(query, {
      limit,
      minScore,
      tags: ["learning"],
    })

    if (flag(flags, "json")) {
      console.log(toJson(results.map(r => ({
        id: r.id,
        content: extractBody(r.content),
        title: r.title,
        relevanceScore: r.relevanceScore,
        tags: r.tags,
        filePath: r.filePath,
      }))))
    } else {
      if (results.length === 0) {
        console.log("No learnings found")
      } else {
        console.log(`${results.length} learning(s) found:`)
        for (const r of results) {
          const score = (r.relevanceScore * 100).toFixed(0)
          const fm = r.frontmatter ? JSON.parse(r.frontmatter) : null
          const category = fm?.category ? ` [${fm.category}]` : ""
          const body = extractBody(r.content)
          console.log(`  ${r.id} (${score}%)${category} ${body.slice(0, 60)}${body.length > 60 ? "..." : ""}`)
        }
      }
    }
  })

export const learningRecent = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const memSvc = yield* MemoryService
    const limit = parseIntOpt(flags, "limit", "limit", "n") ?? 10

    const docs = yield* memSvc.listDocuments({ tags: ["learning"] })

    // Sort by mtime descending (most recent first), then limit
    const sorted = [...docs]
      .sort((a, b) => new Date(b.fileMtime).getTime() - new Date(a.fileMtime).getTime())
      .slice(0, limit)

    if (flag(flags, "json")) {
      console.log(toJson(sorted.map(d => ({
        id: d.id,
        content: extractBody(d.content),
        title: d.title,
        filePath: d.filePath,
        fileMtime: d.fileMtime,
        tags: d.tags,
      }))))
    } else {
      if (sorted.length === 0) {
        console.log("No learnings found")
      } else {
        console.log(`${sorted.length} recent learning(s):`)
        for (const d of sorted) {
          const fm = d.frontmatter ? JSON.parse(d.frontmatter) : null
          const category = fm?.category ? ` [${fm.category}]` : ""
          const sourceType = fm?.source_type && fm.source_type !== "manual" ? ` (${fm.source_type})` : ""
          const body = extractBody(d.content)
          console.log(`  ${d.id}${category}${sourceType} ${body.slice(0, 60)}${body.length > 60 ? "..." : ""}`)
        }
      }
    }
  })

export const learningHelpful = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx learning helpful <id> [--score 0.8] [--json]")
      process.exit(1)
    }

    const memSvc = yield* MemoryService
    const score = parseFloatOpt(flags, "score", "score") ?? 1.0

    if (score < 0 || score > 1) {
      console.error("Error: Score must be between 0 and 1")
      process.exit(1)
    }

    yield* memSvc.setProperty(id, "outcome_score", String(score))
    const doc = yield* memSvc.getDocument(id)

    if (flag(flags, "json")) {
      console.log(toJson({ success: true, id, score }))
    } else {
      const body = extractBody(doc.content)
      console.log(`Recorded helpfulness for learning ${id}`)
      console.log(`  Score: ${(score * 100).toFixed(0)}%`)
      console.log(`  Content: ${body.slice(0, 60)}${body.length > 60 ? "..." : ""}`)
    }
  })

export const learningEmbed = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const memSvc = yield* MemoryService

    if (flag(flags, "status")) {
      const status = yield* memSvc.indexStatus()
      if (flag(flags, "json")) {
        console.log(toJson(status))
      } else {
        console.log("Embedding Status:")
        console.log(`  Total documents: ${status.totalFiles}`)
        console.log(`  Indexed: ${status.indexed}`)
        console.log(`  With embeddings: ${status.embedded}`)
        console.log(`  Sources: ${status.sources}`)
      }
      return
    }

    // Run incremental index (will compute embeddings if EmbeddingService is available)
    const result = yield* memSvc.index({ incremental: true })

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log("Index/embedding complete:")
      console.log(`  Indexed: ${result.indexed}`)
      console.log(`  Skipped: ${result.skipped}`)
      console.log(`  Removed: ${result.removed}`)
    }
  })

export const context = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const rawTaskId = pos[0]
    if (!rawTaskId) {
      console.error("Usage: tx context <task-id> [--json] [--inject] [--expand] [--semantic]")
      process.exit(1)
    }
    const taskId = parseTaskId(rawTaskId)

    const taskSvc = yield* TaskService
    const retriever = yield* MemoryRetrieverService
    const startTime = Date.now()

    // Get task to build search query
    const task = yield* taskSvc.get(taskId)
    const searchQuery = `${task.title} ${task.description}`.trim()

    const limit = parseIntOpt(flags, "limit", "limit", "n") ?? 10
    const useSemantic = flag(flags, "semantic")
    const useExpand = flag(flags, "expand")

    // Search all memory (not just learnings) — learning-tagged docs appear naturally
    const results = yield* retriever.search(searchQuery, {
      limit,
      minScore: 0.05,
      semantic: useSemantic,
      expand: useExpand,
    })

    const searchDuration = Date.now() - startTime

    if (flag(flags, "inject")) {
      // Write context to .tx/context.md for injection
      const contextPath = resolve(process.cwd(), ".tx", "context.md")
      mkdirSync(resolve(process.cwd(), ".tx"), { recursive: true })
      const lines = [
        `# Context for ${taskId} — ${task.title}`,
        "",
        `Search: ${searchQuery.slice(0, 100)}`,
        `Duration: ${searchDuration}ms`,
        "",
      ]
      for (const r of results) {
        const score = (r.relevanceScore * 100).toFixed(0)
        const tagInfo = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : ""
        lines.push(`## ${r.id} (${score}%)${tagInfo}`)
        lines.push("")
        lines.push(r.content)
        lines.push("")
      }
      writeFileSync(contextPath, lines.join("\n"))
      const expandInfo = useExpand ? " (with graph expansion)" : ""
      console.log(`Wrote ${results.length} result(s) to ${contextPath}${expandInfo}`)
    } else if (flag(flags, "json")) {
      console.log(toJson({
        taskId,
        taskTitle: task.title,
        results: results.map(r => ({
          id: r.id,
          title: r.title,
          content: r.content,
          relevanceScore: r.relevanceScore,
          tags: r.tags,
          filePath: r.filePath,
          expansionHops: r.expansionHops,
        })),
        searchQuery,
        searchDuration,
      }))
    } else {
      const expandInfo = useExpand ? " (with graph expansion)" : ""
      console.log(`Context for: ${taskId} - ${task.title}${expandInfo}`)
      console.log(`  Search query: ${searchQuery.slice(0, 50)}${searchQuery.length > 50 ? "..." : ""}`)
      console.log(`  Search duration: ${searchDuration}ms`)
      console.log(`  ${results.length} relevant result(s):`)
      for (const r of results) {
        const score = (r.relevanceScore * 100).toFixed(0)
        const hops = r.expansionHops !== undefined && r.expansionHops > 0 ? ` [+${r.expansionHops} hops]` : ""
        const isLearning = r.tags.includes("learning") ? " [learning]" : ""
        const body = extractBody(r.content)
        console.log(`    ${r.id} (${score}%)${isLearning}${hops} ${body.slice(0, 60)}${body.length > 60 ? "..." : ""}`)
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

    yield* ensureLearningsDir()
    const memSvc = yield* MemoryService

    // Build properties
    const properties: Record<string, string> = {
      file_pattern: pattern,
      source_type: "manual",
    }
    const taskId = opt(flags, "task")
    if (taskId) properties.task_id = taskId

    const doc = yield* memSvc.createDocument({
      title: learningTitle(note),
      content: note,
      tags: ["learning"],
      dir: resolve(process.cwd(), LEARNINGS_DIR),
      properties,
    })

    if (flag(flags, "json")) {
      console.log(toJson({
        id: doc.id,
        filePattern: pattern,
        note,
        taskId: taskId ?? null,
        filePath: doc.filePath,
      }))
    } else {
      console.log(`Created file learning: ${doc.id}`)
      console.log(`  Pattern: ${pattern}`)
      console.log(`  Note: ${note.slice(0, 80)}${note.length > 80 ? "..." : ""}`)
      if (taskId) console.log(`  Task: ${taskId}`)
    }
  })

export const recall = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const path = pos[0]
    const memSvc = yield* MemoryService

    // List all learning docs
    const docs = yield* memSvc.listDocuments({ tags: ["learning"] })

    if (path) {
      // Filter by file_pattern property — check frontmatter for file_pattern match
      const matching = docs.filter(d => {
        if (!d.frontmatter) return false
        try {
          const fm = JSON.parse(d.frontmatter)
          if (!fm.file_pattern) return false
          // Simple glob matching: check if path matches or contains the pattern
          const fp: string = fm.file_pattern
          if (fp === path) return true
          // Check if the pattern is a prefix/suffix match
          if (fp.includes("*")) {
            // Convert simple glob to regex: *.ts → .*\.ts, src/**/*.ts → src/.*\.ts
            const regex = new RegExp("^" + fp.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\./g, "\\.") + "$")
            return regex.test(path)
          }
          // Check if path contains the pattern
          return path.includes(fp) || fp.includes(path)
        } catch {
          return false
        }
      })

      if (flag(flags, "json")) {
        console.log(toJson(matching.map(d => {
          const fm = d.frontmatter ? JSON.parse(d.frontmatter) : {}
          return {
            id: d.id,
            filePattern: fm.file_pattern,
            note: extractBody(d.content),
            taskId: fm.task_id ?? null,
            filePath: d.filePath,
          }
        })))
      } else {
        if (matching.length === 0) {
          console.log(`No learnings found for: ${path}`)
        } else {
          console.log(`${matching.length} learning(s) for ${path}:`)
          for (const d of matching) {
            const fm = d.frontmatter ? JSON.parse(d.frontmatter) : {}
            const taskInfo = fm.task_id ? ` [${fm.task_id}]` : ""
            console.log(`  ${d.id}${taskInfo} (${fm.file_pattern})`)
            console.log(`    ${extractBody(d.content)}`)
          }
        }
      }
    } else {
      // List all file learnings (those with file_pattern property)
      const fileLearnings = docs.filter(d => {
        if (!d.frontmatter) return false
        try {
          const fm = JSON.parse(d.frontmatter)
          return !!fm.file_pattern
        } catch {
          return false
        }
      })

      if (flag(flags, "json")) {
        console.log(toJson(fileLearnings.map(d => {
          const fm = d.frontmatter ? JSON.parse(d.frontmatter) : {}
          return {
            id: d.id,
            filePattern: fm.file_pattern,
            note: extractBody(d.content),
            taskId: fm.task_id ?? null,
            filePath: d.filePath,
          }
        })))
      } else {
        if (fileLearnings.length === 0) {
          console.log("No file learnings found")
        } else {
          console.log(`${fileLearnings.length} file learning(s):`)
          for (const d of fileLearnings) {
            const fm = d.frontmatter ? JSON.parse(d.frontmatter) : {}
            const taskInfo = fm.task_id ? ` [${fm.task_id}]` : ""
            const body = extractBody(d.content)
            console.log(`  ${d.id}${taskInfo} ${fm.file_pattern}`)
            console.log(`    ${body.slice(0, 60)}${body.length > 60 ? "..." : ""}`)
          }
        }
      }
    }
  })

/**
 * Learning dispatcher: routes `tx learning <subcommand>` to the appropriate handler.
 */
export const learning = (pos: string[], flags: Flags) => {
  const sub = pos[0]
  switch (sub) {
    case "add": return learningAdd(pos.slice(1), flags)
    case "search": return learningSearch(pos.slice(1), flags)
    case "recent": return learningRecent(pos.slice(1), flags)
    case "helpful": return learningHelpful(pos.slice(1), flags)
    case "embed": return learningEmbed(pos.slice(1), flags)
    case "migrate": return learningMigrate(pos.slice(1), flags)
    default: return learningHelp(sub ?? "")
  }
}

/**
 * Migrate old learnings from SQLite tables to memory .md files.
 */
export const learningMigrate = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const dryRun = flag(flags, "dry-run")

    // Read from old SQLite-backed services (may fail if tables already dropped)
    const oldLearningSvc = yield* LearningService
    const oldFileSvc = yield* FileLearningService

    const oldLearningResult = yield* Effect.either(oldLearningSvc.getRecent(1000))
    const oldFileLearningResult = yield* Effect.either(oldFileSvc.getAll())

    const oldLearnings = oldLearningResult._tag === "Right" ? [...oldLearningResult.right] : []
    const oldFileLearnings = oldFileLearningResult._tag === "Right" ? [...oldFileLearningResult.right] : []

    if (oldLearnings.length === 0 && oldFileLearnings.length === 0) {
      console.log("No old learnings to migrate.")
      return
    }

    console.log(`Found ${oldLearnings.length} learnings and ${oldFileLearnings.length} file learnings to migrate.`)

    if (dryRun) {
      console.log("\n[dry-run] Would migrate:")
      for (const l of oldLearnings) {
        console.log(`  Learning #${l.id}: ${l.content.slice(0, 60)}...`)
      }
      for (const fl of oldFileLearnings) {
        console.log(`  File learning #${fl.id}: ${fl.filePattern} — ${fl.note.slice(0, 40)}...`)
      }
      return
    }

    yield* ensureLearningsDir()
    const memSvc = yield* MemoryService

    let migrated = 0
    let skipped = 0

    // Migrate regular learnings
    for (const l of oldLearnings) {
      const properties: Record<string, string> = {
        source_type: l.sourceType ?? "manual",
        migrated_from: `learning:${l.id}`,
      }
      if (l.category) properties.category = l.category
      if (l.sourceRef) properties.source_ref = l.sourceRef
      if (l.outcomeScore !== null) properties.outcome_score = String(l.outcomeScore)

      const result = yield* Effect.either(memSvc.createDocument({
        title: learningTitle(l.content),
        content: l.content,
        tags: ["learning"],
        dir: resolve(process.cwd(), LEARNINGS_DIR),
        properties,
      }))

      if (result._tag === "Right") {
        migrated++
      } else {
        skipped++
      }
    }

    // Migrate file learnings
    for (const fl of oldFileLearnings) {
      const properties: Record<string, string> = {
        file_pattern: fl.filePattern,
        source_type: "manual",
        migrated_from: `file_learning:${fl.id}`,
      }
      if (fl.taskId) properties.task_id = fl.taskId

      const result = yield* Effect.either(memSvc.createDocument({
        title: learningTitle(fl.note),
        content: fl.note,
        tags: ["learning"],
        dir: resolve(process.cwd(), LEARNINGS_DIR),
        properties,
      }))

      if (result._tag === "Right") {
        migrated++
      } else {
        skipped++
      }
    }

    // Re-index to pick up the new files
    yield* memSvc.index({ incremental: true })

    console.log(`Migration complete:`)
    console.log(`  Migrated: ${migrated}`)
    console.log(`  Skipped: ${skipped} (likely already exists)`)
    console.log(`  Total: ${oldLearnings.length + oldFileLearnings.length}`)
    console.log(`\nLearnings are now in ${LEARNINGS_DIR}/`)
  })

// Help command handler for learning subcommands
export const learningHelp = (subcommand: string) =>
  Effect.sync(() => {
    const helpKey = `learning ${subcommand}`
    if (commandHelp[helpKey]) {
      console.log(commandHelp[helpKey])
    } else {
      console.log("Learning commands:")
      console.log("  tx learning add <content>     Add a learning")
      console.log("  tx learning search <query>    Search learnings")
      console.log("  tx learning recent            List recent learnings")
      console.log("  tx learning helpful <id>      Record helpfulness")
      console.log("  tx learning embed             Index and embed learnings")
      console.log("  tx learning migrate           Migrate old learnings to memory system")
      console.log("")
      console.log("Run 'tx learning <command> --help' for command-specific help.")
    }
  })
