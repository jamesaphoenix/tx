/**
 * Doc-related MCP Tools
 *
 * Provides MCP tools for doc lifecycle (create/update/lock),
 * linking, rendering, and listing.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import { registerEffectTool, z } from "./effect-schema-tool.js"
import type { Doc, DocLink, DocKind, DocStatus, DocLinkType } from "@jamesaphoenix/tx/types"
import { DOC_KINDS, DOC_STATUSES, DOC_LINK_TYPES, assertDocKind, assertDocStatus, assertDocLinkType } from "@jamesaphoenix/tx/types"
import { DocService } from "@jamesaphoenix/tx"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"
import { normalizeLimit, MCP_MAX_LIMIT } from "./index.js"

// -----------------------------------------------------------------------------
// Serialization Helpers
// -----------------------------------------------------------------------------

interface SerializedDoc {
  id: number
  docId: string
  hash: string
  kind: DocKind
  name: string
  title: string
  version: number
  status: DocStatus
  filePath: string
  parentDocId: number | null
  createdAt: string
  lockedAt: string | null
  metadata: Record<string, unknown>
}

interface SerializedDocLink {
  id: number
  fromDocId: number
  toDocId: number
  linkType: DocLinkType
  createdAt: string
}

/**
 * Serialize a Doc for JSON-safe MCP responses (dates -> ISO strings).
 */
export const serializeDoc = (doc: Doc): SerializedDoc => ({
  id: doc.id,
  docId: doc.docId,
  hash: doc.hash,
  kind: doc.kind,
  name: doc.name,
  title: doc.title,
  version: doc.version,
  status: doc.status,
  filePath: doc.filePath,
  parentDocId: doc.parentDocId,
  createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : String(doc.createdAt),
  lockedAt: doc.lockedAt instanceof Date ? doc.lockedAt.toISOString() : doc.lockedAt != null ? String(doc.lockedAt) : null,
  metadata: doc.metadata,
})

/**
 * Serialize a DocLink for JSON-safe MCP responses (dates -> ISO strings).
 */
export const serializeDocLink = (link: DocLink): SerializedDocLink => ({
  id: link.id,
  fromDocId: link.fromDocId,
  toDocId: link.toDocId,
  linkType: link.linkType,
  createdAt: link.createdAt instanceof Date ? link.createdAt.toISOString() : String(link.createdAt),
})

// -----------------------------------------------------------------------------
// Tool Handlers (extracted to avoid deep type inference issues with MCP SDK)
// -----------------------------------------------------------------------------

const handleDocList = async (args: { kind?: string; status?: string; limit?: number }): Promise<McpToolResult> => {
  try {
    const effectiveLimit = normalizeLimit(args.limit)
    const docs = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.list({
          kind: args.kind ? assertDocKind(args.kind) : undefined,
          status: args.status ? assertDocStatus(args.status) : undefined,
        })
      })
    )
    const limited = docs.slice(0, effectiveLimit)
    const serialized = limited.map(serializeDoc)
    return {
      content: [
        { type: "text", text: `Found ${limited.length} doc(s)${docs.length > effectiveLimit ? ` (showing first ${effectiveLimit} of ${docs.length})` : ""}` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_doc_list", args, error)
  }
}

const handleDocGet = async (args: { ref: string; version?: number }): Promise<McpToolResult> => {
  try {
    const doc = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.get(args.ref, args.version)
      })
    )
    const serialized = serializeDoc(doc)
    return {
      content: [
        { type: "text", text: `Doc: ${doc.name} [${doc.docId}] (v${doc.version}, ${doc.status})` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_doc_get", args, error)
  }
}

const handleDocCreate = async (args: { kind: string; name: string; title: string; content: string }): Promise<McpToolResult> => {
  try {
    const doc = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.create({
          kind: assertDocKind(args.kind),
          name: args.name,
          title: args.title,
          content: args.content,
        })
      })
    )
    const serialized = serializeDoc(doc)
    return {
      content: [
        { type: "text", text: `Created doc: ${doc.name} (v${doc.version})` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_doc_create", args, error)
  }
}

const handleDocUpdate = async (args: { ref: string; content: string }): Promise<McpToolResult> => {
  try {
    const doc = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.update(args.ref, args.content)
      })
    )
    const serialized = serializeDoc(doc)
    return {
      content: [
        { type: "text", text: `Updated doc: ${doc.name} (v${doc.version})` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_doc_update", args, error)
  }
}

const handleDocLock = async (args: { ref: string }): Promise<McpToolResult> => {
  try {
    const doc = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.lock(args.ref)
      })
    )
    const serialized = serializeDoc(doc)
    return {
      content: [
        { type: "text", text: `Locked doc: ${doc.name} (v${doc.version})` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_doc_lock", args, error)
  }
}

const handleDocLink = async (args: { fromRef: string; toRef: string; linkType?: string }): Promise<McpToolResult> => {
  try {
    const link = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.linkDocs(
          args.fromRef,
          args.toRef,
          args.linkType ? assertDocLinkType(args.linkType) : undefined
        )
      })
    )
    const serialized = serializeDocLink(link)
    return {
      content: [
        { type: "text", text: `Linked: ${args.fromRef} -> ${args.toRef} (${link.linkType})` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_doc_link", args, error)
  }
}

const handleDocRender = async (args: { ref?: string }): Promise<McpToolResult> => {
  try {
    const rendered = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.render(args.ref)
      })
    )
    return {
      content: [
        { type: "text", text: `Rendered ${rendered.length} doc(s)` },
        { type: "text", text: JSON.stringify({ rendered }) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_doc_render", args, error)
  }
}

// -----------------------------------------------------------------------------
// Tool Registration
// -----------------------------------------------------------------------------

/**
 * Register all doc-related MCP tools on the server.
 */
export const registerDocTools = (server: McpServer): void => {
  // tx_doc_list - List docs with optional kind/status filter
  registerEffectTool(server,
    "tx_doc_list",
    "List docs with optional filters for kind and status",
    {
      kind: z.enum(DOC_KINDS).optional().describe(`Filter by kind: ${DOC_KINDS.join(", ")}`),
      status: z.enum(DOC_STATUSES).optional().describe(`Filter by status: ${DOC_STATUSES.join(", ")}`),
      limit: z.number().int().positive().max(MCP_MAX_LIMIT).optional().describe(`Maximum number of docs to return (default: 100, max: ${MCP_MAX_LIMIT})`)
    },
    handleDocList
  )

  // tx_doc_get - Get a doc by ref
  registerEffectTool(server,
    "tx_doc_get",
    "Get detailed information about a doc by ref (doc_id, kind/name, or legacy bare name when unambiguous), optionally at a specific version",
    {
      ref: z.string().describe("Doc ref (preferred: doc_id, e.g. 'doc-1a2b3c4d5e6f'; also accepts 'prd/feature' or an unambiguous legacy bare name)"),
      version: z.number().int().positive().optional().describe("Specific version to retrieve (default: latest)")
    },
    handleDocGet
  )

  // tx_doc_create - Create a new doc
  registerEffectTool(server,
    "tx_doc_create",
    "Create a new doc with markdown content (YAML frontmatter + prose sections). Writes .md to specs/ and stores metadata in DB.",
    {
      kind: z.enum(DOC_KINDS).describe(`Doc kind: ${DOC_KINDS.join(", ")}`),
      name: z.string().max(200).describe("Human slug / filename component (unique only within its kind)"),
      title: z.string().max(500).describe("Human-readable title"),
      content: z.string().max(100000).describe("Full markdown content for the doc (YAML frontmatter + prose sections + embedded YAML blocks)")
    },
    handleDocCreate
  )

  // tx_doc_update - Update doc markdown content
  registerEffectTool(server,
    "tx_doc_update",
    "Update a doc's markdown content. Fails if the doc is locked.",
    {
      ref: z.string().describe("Doc ref to update (preferred: doc_id)"),
      content: z.string().max(100000).describe("New markdown content for the doc (YAML frontmatter + prose sections + embedded YAML blocks)")
    },
    handleDocUpdate
  )

  // tx_doc_lock - Lock a doc (make immutable)
  registerEffectTool(server,
    "tx_doc_lock",
    "Lock a doc to make it immutable. Locked docs cannot be updated.",
    {
      ref: z.string().describe("Doc ref to lock (preferred: doc_id)")
    },
    handleDocLock
  )

  // tx_doc_link - Link two docs
  registerEffectTool(server,
    "tx_doc_link",
    "Create a directed link between two docs. Link type is auto-inferred from doc kinds if not provided.",
    {
      fromRef: z.string().describe("Source doc ref (preferred: doc_id)"),
      toRef: z.string().describe("Target doc ref (preferred: doc_id)"),
      linkType: z.enum(DOC_LINK_TYPES).optional().describe(`Link type: ${DOC_LINK_TYPES.join(", ")} (auto-inferred if omitted)`)
    },
    handleDocLink
  )

  // tx_doc_render - Validate doc(s) and regenerate index
  registerEffectTool(server,
    "tx_doc_render",
    "Validate doc markdown files and regenerate the index. Validates a single doc if name is provided, otherwise validates all docs.",
    {
      ref: z.string().optional().describe("Doc ref to validate (omit to validate all)")
    },
    handleDocRender
  )
}
