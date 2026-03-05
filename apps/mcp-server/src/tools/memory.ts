/**
 * Memory-related MCP Tools
 *
 * Provides MCP tools for filesystem-backed memory management:
 * sources, documents, indexing, search, tags, properties, links.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { registerEffectTool, z } from "./effect-schema-tool.js"
import { MemoryService, MemoryRetrieverService } from "@jamesaphoenix/tx-core"
import { serializeMemoryDocument, serializeMemoryDocumentWithScore } from "@jamesaphoenix/tx-types"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"
import { normalizeLimit, MCP_MAX_LIMIT } from "./index.js"

// -----------------------------------------------------------------------------
// Source Management Handlers
// -----------------------------------------------------------------------------

const handleSourceAdd = async (args: {
  dir: string
  label?: string
}): Promise<McpToolResult> => {
  try {
    const source = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.addSource(args.dir, args.label)
      })
    )
    return {
      content: [
        { type: "text", text: `Added memory source: ${args.dir}${args.label ? ` (${args.label})` : ""}` },
        { type: "text", text: JSON.stringify(source) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_source_add", args, error)
  }
}

const handleSourceRm = async (args: {
  dir: string
}): Promise<McpToolResult> => {
  try {
    await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.removeSource(args.dir)
      })
    )
    return {
      content: [
        { type: "text", text: `Removed memory source: ${args.dir}` }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_source_rm", args, error)
  }
}

const handleSourceList = async (): Promise<McpToolResult> => {
  try {
    const sources = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.listSources()
      })
    )
    return {
      content: [
        { type: "text", text: `${sources.length} memory source(s)` },
        { type: "text", text: JSON.stringify(sources) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_source_list", {}, error)
  }
}

// -----------------------------------------------------------------------------
// Document CRUD Handlers
// -----------------------------------------------------------------------------

const handleMemoryAdd = async (args: {
  title: string
  content?: string
  tags?: string[]
  properties?: Record<string, string>
  dir?: string
}): Promise<McpToolResult> => {
  try {
    const doc = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.createDocument({
          title: args.title,
          content: args.content,
          tags: args.tags,
          properties: args.properties,
          dir: args.dir
        })
      })
    )
    return {
      content: [
        { type: "text", text: `Created memory document: ${doc.id} (${doc.title})` },
        { type: "text", text: JSON.stringify(serializeMemoryDocument(doc)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_add", args, error)
  }
}

const handleMemoryShow = async (args: {
  id: string
}): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.getDocument(args.id).pipe(
          Effect.map((doc) => ({ found: true as const, doc })),
          Effect.catchTag("MemoryDocumentNotFoundError", () =>
            Effect.succeed({ found: false as const, doc: null as never })
          )
        )
      })
    )
    if (!result.found) {
      return {
        content: [{ type: "text", text: `Document not found: ${args.id}` }],
        isError: true,
      }
    }
    return {
      content: [
        { type: "text", text: `Document: ${result.doc.title}` },
        { type: "text", text: JSON.stringify(serializeMemoryDocument(result.doc)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_show", args, error)
  }
}

const handleMemoryList = async (args: {
  source?: string
  tags?: string[]
}): Promise<McpToolResult> => {
  try {
    const docs = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.listDocuments({
          source: args.source,
          tags: args.tags
        })
      })
    )
    return {
      content: [
        { type: "text", text: `${docs.length} document(s)` },
        { type: "text", text: JSON.stringify(docs.map(serializeMemoryDocument)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_list", args, error)
  }
}

// -----------------------------------------------------------------------------
// Search Handler
// -----------------------------------------------------------------------------

const handleMemorySearch = async (args: {
  query: string
  limit?: number
  minScore?: number
  semantic?: boolean
  expand?: boolean
  tags?: string[]
  props?: string[]
}): Promise<McpToolResult> => {
  try {
    const effectiveLimit = normalizeLimit(args.limit)
    const results = await runEffect(
      Effect.gen(function* () {
        const retriever = yield* MemoryRetrieverService
        return yield* retriever.search(args.query, {
          limit: effectiveLimit,
          minScore: args.minScore,
          semantic: args.semantic,
          expand: args.expand,
          tags: args.tags,
          props: args.props
        })
      })
    )
    return {
      content: [
        { type: "text", text: `Found ${results.length} result(s) for "${args.query}"` },
        { type: "text", text: JSON.stringify(results.map(serializeMemoryDocumentWithScore)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_search", args, error)
  }
}

// -----------------------------------------------------------------------------
// Indexing Handlers
// -----------------------------------------------------------------------------

const handleMemoryIndex = async (args: {
  incremental?: boolean
}): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.index({ incremental: args.incremental })
      })
    )
    return {
      content: [
        { type: "text", text: `Indexed ${result.indexed} file(s), skipped ${result.skipped}, removed ${result.removed}` },
        { type: "text", text: JSON.stringify(result) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_index", args, error)
  }
}

const handleMemoryIndexStatus = async (): Promise<McpToolResult> => {
  try {
    const status = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.indexStatus()
      })
    )
    return {
      content: [
        { type: "text", text: `Index status: ${status.indexed}/${status.totalFiles} indexed, ${status.stale} stale, ${status.embedded} embedded, ${status.links} links, ${status.sources} sources` },
        { type: "text", text: JSON.stringify(status) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_index_status", {}, error)
  }
}

// -----------------------------------------------------------------------------
// Tag Handlers
// -----------------------------------------------------------------------------

const handleMemoryTag = async (args: {
  id: string
  tags: string[]
}): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.updateFrontmatter(args.id, { addTags: args.tags }).pipe(
          Effect.map((doc) => ({ found: true as const, doc })),
          Effect.catchTag("MemoryDocumentNotFoundError", () =>
            Effect.succeed({ found: false as const, doc: null as never })
          )
        )
      })
    )
    if (!result.found) {
      return { content: [{ type: "text", text: `Document not found: ${args.id}` }], isError: true }
    }
    return {
      content: [
        { type: "text", text: `Added ${args.tags.length} tag(s) to ${args.id}` },
        { type: "text", text: JSON.stringify(serializeMemoryDocument(result.doc)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_tag", args, error)
  }
}

const handleMemoryUntag = async (args: {
  id: string
  tags: string[]
}): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.updateFrontmatter(args.id, { removeTags: args.tags }).pipe(
          Effect.map((doc) => ({ found: true as const, doc })),
          Effect.catchTag("MemoryDocumentNotFoundError", () =>
            Effect.succeed({ found: false as const, doc: null as never })
          )
        )
      })
    )
    if (!result.found) {
      return { content: [{ type: "text", text: `Document not found: ${args.id}` }], isError: true }
    }
    return {
      content: [
        { type: "text", text: `Removed ${args.tags.length} tag(s) from ${args.id}` },
        { type: "text", text: JSON.stringify(serializeMemoryDocument(result.doc)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_untag", args, error)
  }
}

// -----------------------------------------------------------------------------
// Relation Handler
// -----------------------------------------------------------------------------

const handleMemoryRelate = async (args: {
  id: string
  target: string
}): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.updateFrontmatter(args.id, { addRelated: [args.target] }).pipe(
          Effect.map((doc) => ({ found: true as const, doc })),
          Effect.catchTag("MemoryDocumentNotFoundError", () =>
            Effect.succeed({ found: false as const, doc: null as never })
          )
        )
      })
    )
    if (!result.found) {
      return { content: [{ type: "text", text: `Document not found: ${args.id}` }], isError: true }
    }
    return {
      content: [
        { type: "text", text: `Added relation from ${args.id} to "${args.target}"` },
        { type: "text", text: JSON.stringify(serializeMemoryDocument(result.doc)) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_relate", args, error)
  }
}

// -----------------------------------------------------------------------------
// Property Handlers
// -----------------------------------------------------------------------------

const handleMemorySet = async (args: {
  id: string
  key: string
  value: string
}): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.setProperty(args.id, args.key, args.value).pipe(
          Effect.map(() => ({ found: true as const })),
          Effect.catchTag("MemoryDocumentNotFoundError", () =>
            Effect.succeed({ found: false as const })
          )
        )
      })
    )
    if (!result.found) {
      return { content: [{ type: "text", text: `Document not found: ${args.id}` }], isError: true }
    }
    return {
      content: [
        { type: "text", text: `Set property "${args.key}" = "${args.value}" on ${args.id}` }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_set", args, error)
  }
}

const handleMemoryUnset = async (args: {
  id: string
  key: string
}): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.removeProperty(args.id, args.key).pipe(
          Effect.map(() => ({ found: true as const })),
          Effect.catchTag("MemoryDocumentNotFoundError", () =>
            Effect.succeed({ found: false as const })
          )
        )
      })
    )
    if (!result.found) {
      return { content: [{ type: "text", text: `Document not found: ${args.id}` }], isError: true }
    }
    return {
      content: [
        { type: "text", text: `Removed property "${args.key}" from ${args.id}` }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_unset", args, error)
  }
}

const handleMemoryProps = async (args: {
  id: string
}): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        const doc = yield* svc.getDocument(args.id).pipe(
          Effect.map(() => ({ found: true as const })),
          Effect.catchTag("MemoryDocumentNotFoundError", () =>
            Effect.succeed({ found: false as const })
          )
        )
        if (!doc.found) return { found: false as const, properties: [] as never }
        const properties = yield* svc.getProperties(args.id)
        return { found: true as const, properties }
      })
    )
    if (!result.found) {
      return {
        content: [{ type: "text", text: `Document not found: ${args.id}` }],
        isError: true
      }
    }
    return {
      content: [
        { type: "text", text: `${result.properties.length} property(ies) on ${args.id}` },
        { type: "text", text: JSON.stringify(result.properties) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_props", args, error)
  }
}

// -----------------------------------------------------------------------------
// Link Handlers
// -----------------------------------------------------------------------------

const handleMemoryLinks = async (args: {
  id: string
}): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        const doc = yield* svc.getDocument(args.id).pipe(
          Effect.map(() => ({ found: true as const })),
          Effect.catchTag("MemoryDocumentNotFoundError", () =>
            Effect.succeed({ found: false as const })
          )
        )
        if (!doc.found) return { found: false as const, links: [] as never }
        const links = yield* svc.getLinks(args.id)
        return { found: true as const, links }
      })
    )
    if (!result.found) {
      return {
        content: [{ type: "text", text: `Document not found: ${args.id}` }],
        isError: true
      }
    }
    return {
      content: [
        { type: "text", text: `${result.links.length} outgoing link(s) from ${args.id}` },
        { type: "text", text: JSON.stringify(result.links) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_links", args, error)
  }
}

const handleMemoryBacklinks = async (args: {
  id: string
}): Promise<McpToolResult> => {
  try {
    const result = await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        const doc = yield* svc.getDocument(args.id).pipe(
          Effect.map(() => ({ found: true as const })),
          Effect.catchTag("MemoryDocumentNotFoundError", () =>
            Effect.succeed({ found: false as const })
          )
        )
        if (!doc.found) return { found: false as const, links: [] as never }
        const links = yield* svc.getBacklinks(args.id)
        return { found: true as const, links }
      })
    )
    if (!result.found) {
      return {
        content: [{ type: "text", text: `Document not found: ${args.id}` }],
        isError: true
      }
    }
    return {
      content: [
        { type: "text", text: `${result.links.length} incoming link(s) to ${args.id}` },
        { type: "text", text: JSON.stringify(result.links) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_backlinks", args, error)
  }
}

const handleMemoryLink = async (args: {
  sourceId: string
  targetRef: string
}): Promise<McpToolResult> => {
  try {
    await runEffect(
      Effect.gen(function* () {
        const svc = yield* MemoryService
        return yield* svc.addLink(args.sourceId, args.targetRef)
      })
    )
    return {
      content: [
        { type: "text", text: `Created link from ${args.sourceId} to "${args.targetRef}"` }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_memory_link", args, error)
  }
}

// -----------------------------------------------------------------------------
// Registration
// -----------------------------------------------------------------------------

export const registerMemoryTools = (server: McpServer): void => {
  // Source management
  registerEffectTool(server,
    "tx_memory_source_add",
    "Register a directory as a memory source for indexing. Files in this directory will be searchable.",
    {
      dir: z.string().describe("Absolute path to directory to register as a memory source"),
      label: z.string().optional().describe("Optional human-readable label for this source")
    },
    async (args) => handleSourceAdd(args as { dir: string; label?: string })
  )

  registerEffectTool(server,
    "tx_memory_source_rm",
    "Unregister a directory as a memory source. Removes the source and its indexed documents from the index.",
    {
      dir: z.string().describe("Directory path to unregister")
    },
    async (args) => handleSourceRm(args as { dir: string })
  )

  registerEffectTool(server,
    "tx_memory_source_list",
    "List all registered memory sources.",
    {},
    async () => handleSourceList()
  )

  // Document CRUD
  registerEffectTool(server,
    "tx_memory_add",
    "Create a new markdown memory document with optional tags and properties.",
    {
      title: z.string().min(1).describe("Document title (used to generate filename)"),
      content: z.string().optional().describe("Initial body content"),
      tags: z.array(z.string()).optional().describe("Frontmatter tags"),
      properties: z.record(z.string(), z.string()).optional().describe("Key-value properties to set in frontmatter"),
      dir: z.string().optional().describe("Target directory (default: first registered source)")
    },
    async (args) => handleMemoryAdd(args as { title: string; content?: string; tags?: string[]; properties?: Record<string, string>; dir?: string })
  )

  registerEffectTool(server,
    "tx_memory_show",
    "Display a memory document by ID, including its full content and metadata.",
    {
      id: z.string().describe("Memory document ID (e.g., mem-abc123def456)")
    },
    async (args) => handleMemoryShow(args as { id: string })
  )

  registerEffectTool(server,
    "tx_memory_list",
    "List memory documents with optional source and tag filters.",
    {
      source: z.string().optional().describe("Filter by source directory path"),
      tags: z.array(z.string()).optional().describe("Filter by tags (documents must have all specified tags)")
    },
    async (args) => handleMemoryList(args as { source?: string; tags?: string[] })
  )

  // Search
  registerEffectTool(server,
    "tx_memory_search",
    "Search memory documents using BM25 full-text search with optional semantic similarity and graph expansion.",
    {
      query: z.string().describe("Search query text"),
      limit: z.number().int().positive().max(MCP_MAX_LIMIT).optional().describe(`Maximum results (default: 100, max: ${MCP_MAX_LIMIT})`),
      minScore: z.number().min(0).max(1).optional().describe("Minimum relevance score 0-1 (default: 0)"),
      semantic: z.boolean().optional().describe("Enable vector similarity search (requires embeddings)"),
      expand: z.boolean().optional().describe("Enable graph expansion via wikilinks"),
      tags: z.array(z.string()).optional().describe("Filter results by tags"),
      props: z.array(z.string()).optional().describe("Filter by properties (format: 'key=value' for exact match, 'key' for existence)")
    },
    async (args) => handleMemorySearch(args as { query: string; limit?: number; minScore?: number; semantic?: boolean; expand?: boolean; tags?: string[]; props?: string[] })
  )

  // Indexing
  registerEffectTool(server,
    "tx_memory_index",
    "Index all registered memory sources. Scans directories for markdown files and updates the search index.",
    {
      incremental: z.boolean().optional().describe("If true, only re-index changed files (default: full re-index)")
    },
    async (args) => handleMemoryIndex(args as { incremental?: boolean })
  )

  registerEffectTool(server,
    "tx_memory_index_status",
    "Show the status of the memory index including file counts, staleness, and embedding coverage.",
    {},
    async () => handleMemoryIndexStatus()
  )

  // Tags
  registerEffectTool(server,
    "tx_memory_tag",
    "Add tags to a memory document's frontmatter.",
    {
      id: z.string().describe("Memory document ID"),
      tags: z.array(z.string()).min(1).describe("Tags to add")
    },
    async (args) => handleMemoryTag(args as { id: string; tags: string[] })
  )

  registerEffectTool(server,
    "tx_memory_untag",
    "Remove tags from a memory document's frontmatter.",
    {
      id: z.string().describe("Memory document ID"),
      tags: z.array(z.string()).min(1).describe("Tags to remove")
    },
    async (args) => handleMemoryUntag(args as { id: string; tags: string[] })
  )

  // Relations
  registerEffectTool(server,
    "tx_memory_relate",
    "Add a relation to a memory document's frontmatter 'related' field.",
    {
      id: z.string().describe("Source memory document ID"),
      target: z.string().describe("Target reference (document title, filename, or wikilink target)")
    },
    async (args) => handleMemoryRelate(args as { id: string; target: string })
  )

  // Properties
  registerEffectTool(server,
    "tx_memory_set",
    "Set a key-value property on a memory document (writes to frontmatter and DB index).",
    {
      id: z.string().describe("Memory document ID"),
      key: z.string().describe("Property key"),
      value: z.string().describe("Property value")
    },
    async (args) => handleMemorySet(args as { id: string; key: string; value: string })
  )

  registerEffectTool(server,
    "tx_memory_unset",
    "Remove a property from a memory document (removes from frontmatter and DB index).",
    {
      id: z.string().describe("Memory document ID"),
      key: z.string().describe("Property key to remove")
    },
    async (args) => handleMemoryUnset(args as { id: string; key: string })
  )

  registerEffectTool(server,
    "tx_memory_props",
    "Show all properties of a memory document.",
    {
      id: z.string().describe("Memory document ID")
    },
    async (args) => handleMemoryProps(args as { id: string })
  )

  // Links
  registerEffectTool(server,
    "tx_memory_links",
    "Show outgoing links (wikilinks and frontmatter relations) from a memory document.",
    {
      id: z.string().describe("Memory document ID")
    },
    async (args) => handleMemoryLinks(args as { id: string })
  )

  registerEffectTool(server,
    "tx_memory_backlinks",
    "Show incoming links (backlinks) to a memory document.",
    {
      id: z.string().describe("Memory document ID")
    },
    async (args) => handleMemoryBacklinks(args as { id: string })
  )

  registerEffectTool(server,
    "tx_memory_link",
    "Create an explicit link (edge) between two memory documents.",
    {
      sourceId: z.string().describe("Source memory document ID"),
      targetRef: z.string().describe("Target reference (document title, filename, or wikilink target)")
    },
    async (args) => handleMemoryLink(args as { sourceId: string; targetRef: string })
  )
}
