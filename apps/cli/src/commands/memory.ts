/**
 * Memory commands: tx memory <subcommand>
 *
 * Filesystem-backed memory with BM25 + vector + graph search over .md files.
 */

import { Effect } from "effect"
import { resolve } from "node:path"
import { homedir } from "node:os"
import { MemoryService, MemoryRetrieverService } from "@jamesaphoenix/tx-core"

/**
 * Expand tilde (~) to the user's home directory.
 * Node's path.resolve does NOT expand tilde — it treats ~ as a literal directory name.
 */
const expandTilde = (p: string): string =>
  p.startsWith("~") ? p.replace(/^~/, homedir()) : p
import { toJson, truncate } from "../output.js"
import { commandHelp } from "../help.js"
import { type Flags, flag, opt, parseIntOpt, parseFloatOpt } from "../utils/parse.js"
import { CliExitError } from "../cli-exit.js"

// =============================================================================
// Source management
// =============================================================================

const sourceAdd = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const dir = pos[0]
    if (!dir) {
      console.error("Usage: tx memory source add <dir> [--label name]")
      throw new CliExitError(1)
    }

    const svc = yield* MemoryService
    const source = yield* svc.addSource(expandTilde(dir), opt(flags, "label") ?? undefined)

    if (flag(flags, "json")) {
      console.log(toJson(source))
    } else {
      console.log(`Added memory source: ${source.rootDir}`)
      if (source.label) console.log(`  Label: ${source.label}`)
    }
  })

const sourceRm = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const dir = pos[0]
    if (!dir) {
      console.error("Usage: tx memory source rm <dir>")
      throw new CliExitError(1)
    }

    const svc = yield* MemoryService
    const absDir = resolve(expandTilde(dir))
    yield* svc.removeSource(absDir)

    if (flag(flags, "json")) {
      console.log(toJson({ removed: absDir }))
    } else {
      console.log(`Removed memory source: ${absDir}`)
    }
  })

const sourceList = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* MemoryService
    const sources = yield* svc.listSources()

    if (flag(flags, "json")) {
      console.log(toJson(sources))
    } else {
      if (sources.length === 0) {
        console.log("No memory sources registered. Add one with: tx memory source add <dir>")
      } else {
        console.log(`${sources.length} memory source(s):`)
        for (const s of sources) {
          const label = s.label ? ` (${s.label})` : ""
          console.log(`  ${s.rootDir}${label}`)
        }
      }
    }
  })

const source = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sub = pos[0]
    if (!sub || sub === "help") {
      console.log(commandHelp["memory source"] ?? "Usage: tx memory source <add|rm|list>")
      return
    }
    switch (sub) {
      case "add":
        return yield* sourceAdd(pos.slice(1), flags)
      case "rm":
      case "remove":
        return yield* sourceRm(pos.slice(1), flags)
      case "list":
      case "ls":
        return yield* sourceList(pos.slice(1), flags)
      default:
        console.error(`Unknown subcommand: memory source ${sub}`)
        console.error("Valid subcommands: add, rm, list")
        throw new CliExitError(1)
    }
  })

// =============================================================================
// File creation
// =============================================================================

const memoryAdd = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const title = pos.join(" ").trim()
    if (!title) {
      console.error("Usage: tx memory add <title> [--content text] [--tags t1,t2] [--dir path] [--json]")
      throw new CliExitError(1)
    }

    const svc = yield* MemoryService
    const tagsStr = opt(flags, "tags", "t")
    const tags = tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(t => t.length > 0) : undefined

    // Parse properties from --prop flags (key=value)
    const propsStr = opt(flags, "prop")
    let properties: Record<string, string> | undefined
    if (propsStr) {
      properties = {}
      // Split on comma only when followed by key= pattern (preserves commas inside values)
      for (const p of propsStr.split(/,(?=\w+=)/)) {
        const eqIdx = p.indexOf("=")
        if (eqIdx < 0) {
          console.error(`Invalid property format: "${p}". Use key=value`)
          throw new CliExitError(1)
        }
        properties[p.slice(0, eqIdx).trim()] = p.slice(eqIdx + 1).trim()
      }
    }

    const doc = yield* svc.createDocument({
      title,
      content: opt(flags, "content", "c") ?? undefined,
      tags,
      properties,
      dir: opt(flags, "dir", "d") ? expandTilde(opt(flags, "dir", "d")!) : undefined,
    })

    if (flag(flags, "json")) {
      console.log(toJson(doc))
    } else {
      console.log(`Created memory document: ${doc.id}`)
      console.log(`  Title: ${doc.title}`)
      console.log(`  File: ${doc.filePath}`)
      if (doc.tags.length > 0) console.log(`  Tags: ${doc.tags.join(", ")}`)
    }
  })

// =============================================================================
// Metadata editing
// =============================================================================

const memoryTag = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    const tags = pos.slice(1)
    if (!id || tags.length === 0) {
      console.error("Usage: tx memory tag <id> <tag1> [tag2...] [--json]")
      throw new CliExitError(1)
    }

    const svc = yield* MemoryService
    const doc = yield* svc.updateFrontmatter(id, { addTags: tags })

    if (flag(flags, "json")) {
      console.log(toJson(doc))
    } else {
      console.log(`Tagged ${id}: ${tags.join(", ")}`)
      console.log(`  All tags: ${doc.tags.join(", ")}`)
    }
  })

const memoryUntag = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    const tags = pos.slice(1)
    if (!id || tags.length === 0) {
      console.error("Usage: tx memory untag <id> <tag1> [tag2...] [--json]")
      throw new CliExitError(1)
    }

    const svc = yield* MemoryService
    const doc = yield* svc.updateFrontmatter(id, { removeTags: tags })

    if (flag(flags, "json")) {
      console.log(toJson(doc))
    } else {
      console.log(`Untagged ${id}: ${tags.join(", ")}`)
      console.log(`  Remaining tags: ${doc.tags.length > 0 ? doc.tags.join(", ") : "(none)"}`)
    }
  })

const memoryRelate = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    const target = pos[1]
    if (!id || !target) {
      console.error("Usage: tx memory relate <id> <target-ref> [--json]")
      throw new CliExitError(1)
    }

    const svc = yield* MemoryService
    const doc = yield* svc.updateFrontmatter(id, { addRelated: [target] })

    if (flag(flags, "json")) {
      console.log(toJson(doc))
    } else {
      console.log(`Related ${id} → ${target}`)
    }
  })

// =============================================================================
// Properties
// =============================================================================

const memorySet = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    const key = pos[1]
    const value = pos[2]
    if (!id || !key || value === undefined) {
      console.error("Usage: tx memory set <id> <key> <value>")
      throw new CliExitError(1)
    }

    const svc = yield* MemoryService
    yield* svc.setProperty(id, key, value)

    if (flag(flags, "json")) {
      console.log(toJson({ id, key, value }))
    } else {
      console.log(`Set ${id} ${key}=${value}`)
    }
  })

const memoryUnset = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    const key = pos[1]
    if (!id || !key) {
      console.error("Usage: tx memory unset <id> <key>")
      throw new CliExitError(1)
    }

    const svc = yield* MemoryService
    yield* svc.removeProperty(id, key)

    if (flag(flags, "json")) {
      console.log(toJson({ id, key, removed: true }))
    } else {
      console.log(`Removed property ${key} from ${id}`)
    }
  })

const memoryProps = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx memory props <id> [--json]")
      throw new CliExitError(1)
    }

    const svc = yield* MemoryService
    // Verify document exists first (otherwise we silently return empty for garbage IDs)
    yield* svc.getDocument(id)
    const properties = yield* svc.getProperties(id)

    if (flag(flags, "json")) {
      console.log(toJson(properties))
    } else {
      if (properties.length === 0) {
        console.log(`No properties on ${id}`)
      } else {
        console.log(`Properties for ${id}:`)
        for (const p of properties) {
          console.log(`  ${p.key}: ${p.value}`)
        }
      }
    }
  })

// =============================================================================
// Indexing
// =============================================================================

const memoryIndex = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* MemoryService

    // Index status subcommand
    if (flag(flags, "status")) {
      const status = yield* svc.indexStatus()
      if (flag(flags, "json")) {
        console.log(toJson(status))
      } else {
        console.log("Memory Index Status:")
        console.log(`  Sources: ${status.sources}`)
        console.log(`  Total files: ${status.totalFiles}`)
        console.log(`  Indexed: ${status.indexed}`)
        console.log(`  Stale: ${status.stale}`)
        console.log(`  Embedded: ${status.embedded}`)
        console.log(`  Links: ${status.links}`)
      }
      return
    }

    const incremental = flag(flags, "incremental", "i")
    const result = yield* svc.index({ incremental })

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      const mode = incremental ? "Incremental index" : "Full index"
      console.log(`${mode} complete:`)
      console.log(`  Indexed: ${result.indexed}`)
      if (result.skipped > 0) console.log(`  Skipped (unchanged): ${result.skipped}`)
      if (result.removed > 0) console.log(`  Removed (deleted files): ${result.removed}`)
    }
  })

// =============================================================================
// Search
// =============================================================================

const memorySearch = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const query = pos.join(" ").trim()
    if (!query) {
      console.error("Usage: tx memory search <query> [--semantic] [--expand] [--tags t1,t2] [--prop k=v] [--limit N] [--json]")
      throw new CliExitError(1)
    }

    const useSemantic = flag(flags, "semantic", "s")
    const useExpand = flag(flags, "expand", "e")
    const limit = parseIntOpt(flags, "limit", "limit", "n") ?? 10
    const minScore = parseFloatOpt(flags, "min-score", "min-score") ?? 0

    const tagsStr = opt(flags, "tags", "t")
    const tags = tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(t => t.length > 0) : undefined

    // Parse property filters
    const propStr = opt(flags, "prop")
    // Split on comma only when followed by key= pattern (preserves commas inside values)
    const props = propStr ? propStr.split(/,(?=\w+=)/).map(p => p.trim()).filter(p => p.length > 0) : undefined

    // Use MemoryRetrieverService for semantic/expand, MemoryService.search for basic
    if (useSemantic || useExpand) {
      const retriever = yield* MemoryRetrieverService
      const results = yield* retriever.search(query, { limit, minScore, semantic: useSemantic, expand: useExpand, tags, props })

      if (flag(flags, "json")) {
        console.log(toJson(results))
      } else {
        if (results.length === 0) {
          console.log("No memory documents found")
        } else {
          const modeInfo = [
            useSemantic ? "semantic" : null,
            useExpand ? "expand" : null,
          ].filter(Boolean).join(" + ")
          console.log(`${results.length} result(s) (${modeInfo}):`)
          for (const r of results) {
            const score = (r.relevanceScore * 100).toFixed(0)
            const tagInfo = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : ""
            const hops = r.expansionHops !== undefined && r.expansionHops > 0 ? ` (+${r.expansionHops} hops)` : ""
            console.log(`  ${r.id} (${score}%)${tagInfo}${hops} ${truncate(r.title, 60)}`)
          }
        }
      }
    } else {
      const svc = yield* MemoryService
      const results = yield* svc.search(query, { limit, minScore, tags, props })

      if (flag(flags, "json")) {
        console.log(toJson(results))
      } else {
        if (results.length === 0) {
          console.log("No memory documents found")
        } else {
          console.log(`${results.length} result(s):`)
          for (const r of results) {
            const score = (r.relevanceScore * 100).toFixed(0)
            const tagInfo = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : ""
            console.log(`  ${r.id} (${score}%)${tagInfo} ${truncate(r.title, 60)}`)
          }
        }
      }
    }
  })

// =============================================================================
// Document inspection
// =============================================================================

const memoryShow = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx memory show <id> [--json]")
      throw new CliExitError(1)
    }

    const svc = yield* MemoryService
    const doc = yield* svc.getDocument(id)

    if (flag(flags, "json")) {
      console.log(toJson(doc))
    } else {
      console.log(`Memory Document: ${doc.id}`)
      console.log(`  Title: ${doc.title}`)
      console.log(`  File: ${doc.filePath}`)
      console.log(`  Source: ${doc.rootDir}`)
      console.log(`  Tags: ${doc.tags.length > 0 ? doc.tags.join(", ") : "(none)"}`)
      console.log(`  Hash: ${doc.fileHash.slice(0, 12)}...`)
      console.log(`  Modified: ${doc.fileMtime}`)
      console.log(`  Indexed: ${doc.indexedAt}`)
      console.log(`  Embedded: ${doc.embedding !== null ? "yes" : "no"}`)
      console.log("")
      console.log(doc.content)
    }
  })

const memoryLinks = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx memory links <id> [--json]")
      throw new CliExitError(1)
    }

    const svc = yield* MemoryService
    const links = yield* svc.getLinks(id)

    if (flag(flags, "json")) {
      console.log(toJson(links))
    } else {
      if (links.length === 0) {
        console.log(`No outgoing links from ${id}`)
      } else {
        console.log(`${links.length} outgoing link(s) from ${id}:`)
        for (const l of links) {
          const resolved = l.targetDocId ? `→ ${l.targetDocId}` : "(unresolved)"
          console.log(`  ${l.targetRef} ${resolved} [${l.linkType}]`)
        }
      }
    }
  })

const memoryBacklinks = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx memory backlinks <id> [--json]")
      throw new CliExitError(1)
    }

    const svc = yield* MemoryService
    const links = yield* svc.getBacklinks(id)

    if (flag(flags, "json")) {
      console.log(toJson(links))
    } else {
      if (links.length === 0) {
        console.log(`No incoming links to ${id}`)
      } else {
        console.log(`${links.length} incoming link(s) to ${id}:`)
        for (const l of links) {
          console.log(`  ${l.sourceDocId} → ${l.targetRef} [${l.linkType}]`)
        }
      }
    }
  })

const memoryList = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* MemoryService

    const rawSource = opt(flags, "source")
    // Expand tilde + resolve to absolute path so it matches the DB's absolute root_dir values
    const sourceDir = rawSource ? resolve(expandTilde(rawSource)) : undefined
    const tagsStr = opt(flags, "tags", "t")
    const tags = tagsStr ? tagsStr.split(",").map(t => t.trim()).filter(t => t.length > 0) : undefined

    const docs = yield* svc.listDocuments({ source: sourceDir, tags })

    if (flag(flags, "json")) {
      console.log(toJson(docs))
    } else {
      if (docs.length === 0) {
        console.log("No memory documents found")
      } else {
        console.log(`${docs.length} document(s):`)
        for (const d of docs) {
          const tagInfo = d.tags.length > 0 ? ` [${d.tags.join(", ")}]` : ""
          console.log(`  ${d.id}${tagInfo} ${truncate(d.title, 60)}`)
        }
      }
    }
  })

// =============================================================================
// Explicit edges
// =============================================================================

const memoryLink = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sourceId = pos[0]
    const targetRef = pos[1]
    if (!sourceId || !targetRef) {
      console.error("Usage: tx memory link <source-id> <target-ref>")
      throw new CliExitError(1)
    }

    const svc = yield* MemoryService
    yield* svc.addLink(sourceId, targetRef)

    if (flag(flags, "json")) {
      console.log(toJson({ sourceId, targetRef, created: true }))
    } else {
      console.log(`Created link: ${sourceId} → ${targetRef}`)
    }
  })

// =============================================================================
// Top-level dispatcher
// =============================================================================

export const memory = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sub = pos[0]

    if (!sub || sub === "help") {
      console.log(commandHelp["memory"] ?? "Usage: tx memory <subcommand>")
      return
    }

    switch (sub) {
      case "source":
        return yield* source(pos.slice(1), flags)
      case "add":
        return yield* memoryAdd(pos.slice(1), flags)
      case "tag":
        return yield* memoryTag(pos.slice(1), flags)
      case "untag":
        return yield* memoryUntag(pos.slice(1), flags)
      case "relate":
        return yield* memoryRelate(pos.slice(1), flags)
      case "set":
        return yield* memorySet(pos.slice(1), flags)
      case "unset":
        return yield* memoryUnset(pos.slice(1), flags)
      case "props":
        return yield* memoryProps(pos.slice(1), flags)
      case "index":
        return yield* memoryIndex(pos.slice(1), flags)
      case "search":
        return yield* memorySearch(pos.slice(1), flags)
      case "show":
        return yield* memoryShow(pos.slice(1), flags)
      case "links":
        return yield* memoryLinks(pos.slice(1), flags)
      case "backlinks":
        return yield* memoryBacklinks(pos.slice(1), flags)
      case "list":
      case "ls":
        return yield* memoryList(pos.slice(1), flags)
      case "link":
        return yield* memoryLink(pos.slice(1), flags)
      default:
        console.error(`Unknown subcommand: memory ${sub}`)
        console.error("Run 'tx memory help' for usage.")
        throw new CliExitError(1)
    }
  })
