/**
 * Doc-related MCP Tools
 *
 * Provides MCP tools for doc lifecycle (create/update/lock),
 * linking, rendering, and listing.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Effect } from "effect"
import z from "zod"
import type { Doc, DocLink, DocKind, DocStatus, DocLinkType } from "@jamesaphoenix/tx-types"
import { DOC_KINDS, DOC_STATUSES, DOC_LINK_TYPES, assertDocKind, assertDocStatus, assertDocLinkType } from "@jamesaphoenix/tx-types"
import { DocService } from "@jamesaphoenix/tx-core"
import { runEffect } from "../runtime.js"
import { handleToolError, type McpToolResult } from "../response.js"
import { normalizeLimit, MCP_MAX_LIMIT } from "./index.js"

// -----------------------------------------------------------------------------
// Serialization Helpers
// -----------------------------------------------------------------------------

interface SerializedDoc {
  id: number
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

const handleDocGet = async (args: { name: string; version?: number }): Promise<McpToolResult> => {
  try {
    const doc = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.get(args.name, args.version)
      })
    )
    const serialized = serializeDoc(doc)
    return {
      content: [
        { type: "text", text: `Doc: ${doc.name} (v${doc.version}, ${doc.status})` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_doc_get", args, error)
  }
}

const handleDocCreate = async (args: { kind: string; name: string; title: string; yamlContent: string }): Promise<McpToolResult> => {
  try {
    const doc = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.create({
          kind: assertDocKind(args.kind),
          name: args.name,
          title: args.title,
          yamlContent: args.yamlContent,
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

const handleDocUpdate = async (args: { name: string; yamlContent: string }): Promise<McpToolResult> => {
  try {
    const doc = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.update(args.name, args.yamlContent)
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

const handleDocLock = async (args: { name: string }): Promise<McpToolResult> => {
  try {
    const doc = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.lock(args.name)
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

const handleDocLink = async (args: { fromName: string; toName: string; linkType?: string }): Promise<McpToolResult> => {
  try {
    const link = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.linkDocs(
          args.fromName,
          args.toName,
          args.linkType ? assertDocLinkType(args.linkType) : undefined
        )
      })
    )
    const serialized = serializeDocLink(link)
    return {
      content: [
        { type: "text", text: `Linked: ${args.fromName} -> ${args.toName} (${link.linkType})` },
        { type: "text", text: JSON.stringify(serialized) }
      ],
      isError: false
    }
  } catch (error) {
    return handleToolError("tx_doc_link", args, error)
  }
}

const handleDocRender = async (args: { name?: string }): Promise<McpToolResult> => {
  try {
    const rendered = await runEffect(
      Effect.gen(function* () {
        const docService = yield* DocService
        return yield* docService.render(args.name)
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
  server.tool(
    "tx_doc_list",
    "List docs with optional filters for kind and status",
    {
      kind: z.enum(DOC_KINDS).optional().describe(`Filter by kind: ${DOC_KINDS.join(", ")}`),
      status: z.enum(DOC_STATUSES).optional().describe(`Filter by status: ${DOC_STATUSES.join(", ")}`),
      limit: z.number().int().positive().max(MCP_MAX_LIMIT).optional().describe(`Maximum number of docs to return (default: 100, max: ${MCP_MAX_LIMIT})`)
    },
    handleDocList
  )

  // tx_doc_get - Get a doc by name
  server.tool(
    "tx_doc_get",
    "Get detailed information about a doc by name, optionally at a specific version",
    {
      name: z.string().describe("Doc name (e.g. 'PRD-001-feature')"),
      version: z.number().int().positive().optional().describe("Specific version to retrieve (default: latest)")
    },
    handleDocGet
  )

  // tx_doc_create - Create a new doc
  server.tool(
    "tx_doc_create",
    "Create a new doc with YAML content. Writes YAML to .tx/docs/ and stores metadata in DB.",
    {
      kind: z.enum(DOC_KINDS).describe(`Doc kind: ${DOC_KINDS.join(", ")}`),
      name: z.string().max(200).describe("Unique doc name (alphanumeric with dashes/dots, e.g. 'PRD-001-feature')"),
      title: z.string().max(500).describe("Human-readable title"),
      yamlContent: z.string().max(100000).describe("Full YAML content for the doc")
    },
    handleDocCreate
  )

  // tx_doc_update - Update doc YAML content
  server.tool(
    "tx_doc_update",
    "Update a doc's YAML content. Fails if the doc is locked.",
    {
      name: z.string().describe("Doc name to update"),
      yamlContent: z.string().max(100000).describe("New YAML content for the doc")
    },
    handleDocUpdate
  )

  // tx_doc_lock - Lock a doc (make immutable)
  server.tool(
    "tx_doc_lock",
    "Lock a doc to make it immutable. Locked docs cannot be updated.",
    {
      name: z.string().describe("Doc name to lock")
    },
    handleDocLock
  )

  // tx_doc_link - Link two docs
  server.tool(
    "tx_doc_link",
    "Create a directed link between two docs. Link type is auto-inferred from doc kinds if not provided.",
    {
      fromName: z.string().describe("Source doc name"),
      toName: z.string().describe("Target doc name"),
      linkType: z.enum(DOC_LINK_TYPES).optional().describe(`Link type: ${DOC_LINK_TYPES.join(", ")} (auto-inferred if omitted)`)
    },
    handleDocLink
  )

  // tx_doc_render - Render doc(s) to markdown
  server.tool(
    "tx_doc_render",
    "Render doc YAML to markdown. Renders a single doc if name is provided, otherwise renders all docs.",
    {
      name: z.string().optional().describe("Doc name to render (omit to render all)")
    },
    handleDocRender
  )
}
