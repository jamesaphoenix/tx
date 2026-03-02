/**
 * Integration tests for MCP memory tools.
 *
 * Tests exercise the MemoryService and MemoryRetrieverService at the Effect
 * service level, covering the same operations that the MCP tool handlers
 * (apps/mcp-server/src/tools/memory.ts) delegate to.
 *
 * Categories:
 * 1.  Source management (addSource, removeSource, listSources)
 * 2.  Document creation via createDocument (tx_memory_add)
 * 3.  Document retrieval (getDocument / tx_memory_show)
 * 4.  Document listing with filters (listDocuments / tx_memory_list)
 * 5.  Indexing (index / tx_memory_index)
 * 6.  Index status (indexStatus / tx_memory_index_status)
 * 7.  Search (MemoryRetrieverService.search / tx_memory_search)
 * 8.  Tags (updateFrontmatter addTags / removeTags — tx_memory_tag / tx_memory_untag)
 * 9.  Properties (setProperty, getProperties, removeProperty — tx_memory_set / tx_memory_unset / tx_memory_props)
 * 10. Links (addLink, getLinks, getBacklinks — tx_memory_link / tx_memory_links / tx_memory_backlinks)
 * 11. Relations (updateFrontmatter addRelated — tx_memory_relate)
 * 12. Error paths (not-found handling for show, tag, untag, set, unset, relate)
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks. Temp directories with real .md files.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import { MemoryService, MemoryRetrieverService } from "@jamesaphoenix/tx-core"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

// =============================================================================
// Helpers
// =============================================================================

/** Create a temp directory WITHIN the project root (required for path containment). */
const createTempDir = (): string => {
  const base = join(process.cwd(), ".tx", "memory-test")
  mkdirSync(base, { recursive: true })
  return mkdtempSync(join(base, "run-"))
}

/** Write a markdown file with YAML frontmatter. */
const writeMdFile = (
  dir: string,
  filename: string,
  opts: {
    title: string
    tags?: string[]
    content?: string
    related?: string[]
    properties?: Record<string, string>
  }
): string => {
  const fmLines: string[] = []
  if (opts.tags && opts.tags.length > 0) {
    fmLines.push(`tags: [${opts.tags.join(", ")}]`)
  }
  if (opts.related && opts.related.length > 0) {
    fmLines.push(`related: [${opts.related.join(", ")}]`)
  }
  if (opts.properties) {
    for (const [key, value] of Object.entries(opts.properties)) {
      fmLines.push(`${key}: ${value}`)
    }
  }

  let fileContent = ""
  if (fmLines.length > 0) {
    fileContent += `---\n${fmLines.join("\n")}\n---\n\n`
  }
  fileContent += `# ${opts.title}\n\n${opts.content ?? ""}\n`

  const filePath = join(dir, filename)
  writeFileSync(filePath, fileContent, "utf-8")
  return filePath
}

// =============================================================================
// Test Suite
// =============================================================================

describe("MCP Memory Tools Integration", () => {
  let shared: SharedTestLayerResult
  let tempDir: string

  beforeEach(async () => {
    shared = await getSharedTestLayer()
    tempDir = createTempDir()
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true })
    } catch {
      /* ignore */
    }
  })

  // ===========================================================================
  // 1. tx_memory_source_add — Source Management
  // ===========================================================================

  describe("tx_memory_source_add", () => {
    it("registers a directory and it appears in source list", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          const source = yield* svc.addSource(tempDir)
          const sources = yield* svc.listSources()
          return { source, sources }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.source.rootDir).toBe(tempDir)
      expect(result.sources).toHaveLength(1)
      expect(result.sources[0]!.rootDir).toBe(tempDir)
    })

    it("registers a source with an optional label", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          const source = yield* svc.addSource(tempDir, "my-notes")
          return source
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.rootDir).toBe(tempDir)
      expect(result.label).toBe("my-notes")
    })

    it("registers multiple sources independently", async () => {
      const dir2 = createTempDir()
      try {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MemoryService
            yield* svc.addSource(tempDir, "source-a")
            yield* svc.addSource(dir2, "source-b")
            return yield* svc.listSources()
          }).pipe(Effect.provide(shared.layer))
        )

        expect(result).toHaveLength(2)
        const labels = result.map((s) => s.label).sort()
        expect(labels).toEqual(["source-a", "source-b"])
      } finally {
        try { rmSync(dir2, { recursive: true }) } catch { /* ignore */ }
      }
    })
  })

  // ===========================================================================
  // 2. tx_memory_source_list — List Sources
  // ===========================================================================

  describe("tx_memory_source_list", () => {
    it("returns empty array when no sources registered", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* svc.listSources()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(0)
    })

    it("returns all registered sources", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          return yield* svc.listSources()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(1)
      expect(result[0]!.rootDir).toBe(tempDir)
    })
  })

  // ===========================================================================
  // 3. tx_memory_source_rm — Remove Source
  // ===========================================================================

  describe("tx_memory_source_rm", () => {
    it("removes a registered source", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          const beforeRemove = yield* svc.listSources()
          yield* svc.removeSource(tempDir)
          const afterRemove = yield* svc.listSources()
          return { beforeRemove, afterRemove }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.beforeRemove).toHaveLength(1)
      expect(result.afterRemove).toHaveLength(0)
    })

    it("fails with MemorySourceNotFoundError for unregistered directory", async () => {
      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* svc.removeSource("/nonexistent/path/never/added").pipe(Effect.flip)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(error._tag).toBe("MemorySourceNotFoundError")
    })
  })

  // ===========================================================================
  // 4. tx_memory_add — Create Document
  // ===========================================================================

  describe("tx_memory_add", () => {
    it("creates a document via createDocument and returns it with ID", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          const doc = yield* svc.createDocument({
            title: "Test Document",
            content: "Some test content here.",
            dir: tempDir,
          })
          return doc
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.id).toMatch(/^mem-[a-f0-9]{12}$/)
      expect(result.title).toBe("Test Document")
      expect(result.content).toContain("Some test content here.")
    })

    it("creates a document with tags and properties", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          const doc = yield* svc.createDocument({
            title: "Tagged Document",
            content: "Content with metadata.",
            tags: ["important", "review"],
            properties: { status: "draft", author: "test" },
            dir: tempDir,
          })
          return doc
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.title).toBe("Tagged Document")
      expect(result.tags).toContain("important")
      expect(result.tags).toContain("review")
    })

    it("created document is findable via listDocuments", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.createDocument({
            title: "Findable Document",
            content: "Should appear in list.",
            dir: tempDir,
          })
          const docs = yield* svc.listDocuments()
          return docs
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(1)
      expect(result[0]!.title).toBe("Findable Document")
    })
  })

  // ===========================================================================
  // 5. tx_memory_show — Show Document
  // ===========================================================================

  describe("tx_memory_show", () => {
    it("returns a document by ID after indexing", async () => {
      writeMdFile(tempDir, "getting-started.md", {
        title: "Getting Started",
        content: "This is the getting started guide.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const doc = yield* svc.getDocument(docs[0]!.id)
          return doc
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.title).toBe("Getting Started")
      expect(result.content).toContain("getting started guide")
      expect(result.id).toMatch(/^mem-[a-f0-9]{12}$/)
    })

    it("returns a document created via createDocument", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          const created = yield* svc.createDocument({
            title: "Direct Create",
            content: "Created directly not via indexing.",
            dir: tempDir,
          })
          const fetched = yield* svc.getDocument(created.id)
          return { created, fetched }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.fetched.id).toBe(result.created.id)
      expect(result.fetched.title).toBe("Direct Create")
    })

    it("returns isError-style response for non-existent ID (MCP error path)", async () => {
      // This tests the error path that the MCP handler uses:
      // getDocument -> MemoryDocumentNotFoundError -> { isError: true }
      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* svc.getDocument("mem-000000000000").pipe(Effect.flip)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(error._tag).toBe("MemoryDocumentNotFoundError")
    })
  })

  // ===========================================================================
  // 6. tx_memory_index — Indexing
  // ===========================================================================

  describe("tx_memory_index", () => {
    it("indexes .md files from a registered source", async () => {
      writeMdFile(tempDir, "hello.md", {
        title: "Hello World",
        tags: ["greeting"],
        content: "This is a test document about greetings.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          const indexResult = yield* svc.index()
          const docs = yield* svc.listDocuments()
          return { indexResult, docs }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.indexResult.indexed).toBe(1)
      expect(result.docs).toHaveLength(1)
      expect(result.docs[0]!.title).toBe("Hello World")
    })

    it("indexes multiple files from a source", async () => {
      writeMdFile(tempDir, "doc-a.md", { title: "Doc A", content: "First document." })
      writeMdFile(tempDir, "doc-b.md", { title: "Doc B", content: "Second document." })
      writeMdFile(tempDir, "doc-c.md", { title: "Doc C", content: "Third document." })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          const indexResult = yield* svc.index()
          const docs = yield* svc.listDocuments()
          return { indexResult, docs }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.indexResult.indexed).toBe(3)
      expect(result.docs).toHaveLength(3)
    })

    it("returns zeros when no sources are registered", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* svc.index()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.indexed).toBe(0)
    })

    it("incremental indexing skips unchanged files", async () => {
      writeMdFile(tempDir, "stable.md", {
        title: "Stable Doc",
        content: "This content does not change.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)

          // Full index
          const first = yield* svc.index()

          // Incremental index (nothing changed)
          const second = yield* svc.index({ incremental: true })

          return { first, second }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.first.indexed).toBe(1)
      expect(result.second.skipped).toBeGreaterThanOrEqual(1)
    })
  })

  // ===========================================================================
  // 7. tx_memory_index_status — Index Status
  // ===========================================================================

  describe("tx_memory_index_status", () => {
    it("returns zeros for fresh database", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* svc.indexStatus()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.indexed).toBe(0)
      expect(result.totalFiles).toBe(0)
      expect(result.stale).toBe(0)
      expect(result.embedded).toBe(0)
      expect(result.links).toBe(0)
      expect(result.sources).toBe(0)
    })

    it("reflects indexed state after indexing", async () => {
      writeMdFile(tempDir, "status-doc.md", {
        title: "Status Doc",
        content: "Content for status check.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.indexStatus()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.sources).toBe(1)
      expect(result.indexed).toBeGreaterThanOrEqual(1)
    })
  })

  // ===========================================================================
  // 8. tx_memory_search — Search Documents
  // ===========================================================================

  describe("tx_memory_search", () => {
    it("finds documents by content via MemoryRetrieverService", async () => {
      writeMdFile(tempDir, "typescript-guide.md", {
        title: "TypeScript Guide",
        content:
          "TypeScript is a strongly typed programming language that builds on JavaScript.",
      })
      writeMdFile(tempDir, "cooking-recipes.md", {
        title: "Cooking Recipes",
        content:
          "A collection of delicious pasta and pizza recipes from Italy.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          const retriever = yield* MemoryRetrieverService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const tsResults = yield* retriever.search("TypeScript programming language")
          const cookingResults = yield* retriever.search("pasta pizza recipes")
          return { tsResults, cookingResults }
        }).pipe(Effect.provide(shared.layer))
      )

      // TypeScript search should find the TypeScript guide
      expect(result.tsResults.length).toBeGreaterThanOrEqual(1)
      expect(result.tsResults[0]!.title).toBe("TypeScript Guide")

      // Cooking search should find the cooking recipes
      expect(result.cookingResults.length).toBeGreaterThanOrEqual(1)
      expect(result.cookingResults[0]!.title).toBe("Cooking Recipes")
    })

    it("returns empty array for completely unrelated query", async () => {
      writeMdFile(tempDir, "actual-content.md", {
        title: "Actual Content",
        content: "This document has real content about software engineering.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          const retriever = yield* MemoryRetrieverService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* retriever.search("zzz_completely_unrelated_query_xyz")
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toEqual([])
    })

    it("respects limit parameter", async () => {
      // Create many documents
      for (let i = 0; i < 5; i++) {
        writeMdFile(tempDir, `search-doc-${i}.md`, {
          title: `Search Document ${i}`,
          content: `This document talks about testing search functionality number ${i}.`,
        })
      }

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          const retriever = yield* MemoryRetrieverService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* retriever.search("search testing functionality", { limit: 2 })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.length).toBeLessThanOrEqual(2)
    })

    it("filters by tags when provided", async () => {
      writeMdFile(tempDir, "tagged-a.md", {
        title: "Tagged A",
        tags: ["typescript"],
        content: "A document about TypeScript development.",
      })
      writeMdFile(tempDir, "tagged-b.md", {
        title: "Tagged B",
        tags: ["python"],
        content: "A document about Python development.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          const retriever = yield* MemoryRetrieverService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* retriever.search("development", { tags: ["typescript"] })
        }).pipe(Effect.provide(shared.layer))
      )

      // Should only find the typescript-tagged document
      expect(result.length).toBeGreaterThan(0)
      const titles = result.map((d) => d.title)
      expect(titles).toContain("Tagged A")
      expect(titles).not.toContain("Tagged B")
    })
  })

  // ===========================================================================
  // 9. tx_memory_tag / tx_memory_untag — Tag Management
  // ===========================================================================

  describe("tx_memory_tag / tx_memory_untag", () => {
    it("addTags adds tags to a document via updateFrontmatter", async () => {
      writeMdFile(tempDir, "taggable.md", {
        title: "Taggable Doc",
        tags: ["initial"],
        content: "A document to test tagging.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const docId = docs[0]!.id
          const updated = yield* svc.updateFrontmatter(docId, {
            addTags: ["extra", "new-tag"],
          })
          return updated
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.tags).toContain("initial")
      expect(result.tags).toContain("extra")
      expect(result.tags).toContain("new-tag")
      expect(result.tags).toHaveLength(3)
    })

    it("removeTags removes tags from a document via updateFrontmatter", async () => {
      writeMdFile(tempDir, "untaggable.md", {
        title: "Untaggable Doc",
        tags: ["keep", "remove-me", "also-keep"],
        content: "A document to test tag removal.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const docId = docs[0]!.id
          const updated = yield* svc.updateFrontmatter(docId, {
            removeTags: ["remove-me"],
          })
          return updated
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.tags).toContain("keep")
      expect(result.tags).toContain("also-keep")
      expect(result.tags).not.toContain("remove-me")
      expect(result.tags).toHaveLength(2)
    })

    it("add then remove tags round-trips correctly", async () => {
      writeMdFile(tempDir, "roundtrip.md", {
        title: "Roundtrip Doc",
        content: "Testing add-then-remove cycle.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const docId = docs[0]!.id

          // Add tags
          const afterAdd = yield* svc.updateFrontmatter(docId, {
            addTags: ["temp-tag", "permanent-tag"],
          })

          // Remove one tag
          const afterRemove = yield* svc.updateFrontmatter(docId, {
            removeTags: ["temp-tag"],
          })

          return { afterAdd, afterRemove }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.afterAdd.tags).toContain("temp-tag")
      expect(result.afterAdd.tags).toContain("permanent-tag")
      expect(result.afterRemove.tags).not.toContain("temp-tag")
      expect(result.afterRemove.tags).toContain("permanent-tag")
    })

    it("tag on non-existent document fails with MemoryDocumentNotFoundError", async () => {
      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* svc
            .updateFrontmatter("mem-000000000000", { addTags: ["x"] })
            .pipe(Effect.flip)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(error._tag).toBe("MemoryDocumentNotFoundError")
    })

    it("untag on non-existent document fails with MemoryDocumentNotFoundError", async () => {
      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* svc
            .updateFrontmatter("mem-000000000000", { removeTags: ["x"] })
            .pipe(Effect.flip)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(error._tag).toBe("MemoryDocumentNotFoundError")
    })
  })

  // ===========================================================================
  // 10. tx_memory_set / tx_memory_unset / tx_memory_props — Properties
  // ===========================================================================

  describe("tx_memory_set / tx_memory_unset / tx_memory_props", () => {
    it("setProperty sets a property on a document", async () => {
      writeMdFile(tempDir, "prop-test.md", {
        title: "Property Test",
        content: "A document to test properties.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const docId = docs[0]!.id
          yield* svc.setProperty(docId, "status", "active")
          yield* svc.setProperty(docId, "priority", "high")
          const properties = yield* svc.getProperties(docId)
          return properties
        }).pipe(Effect.provide(shared.layer))
      )

      const propMap = new Map(result.map((p) => [p.key, p.value]))
      expect(propMap.get("status")).toBe("active")
      expect(propMap.get("priority")).toBe("high")
    })

    it("removeProperty removes a property from a document", async () => {
      writeMdFile(tempDir, "removable-prop.md", {
        title: "Removable Prop",
        tags: ["test"],
        content: "A document to test property removal.",
        properties: { status: "draft", category: "notes" },
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const docId = docs[0]!.id

          const beforeProps = yield* svc.getProperties(docId)
          yield* svc.removeProperty(docId, "status")
          const afterProps = yield* svc.getProperties(docId)
          return { beforeProps, afterProps }
        }).pipe(Effect.provide(shared.layer))
      )

      const beforeKeys = result.beforeProps.map((p) => p.key)
      expect(beforeKeys).toContain("status")
      expect(beforeKeys).toContain("category")

      const afterKeys = result.afterProps.map((p) => p.key)
      expect(afterKeys).not.toContain("status")
      expect(afterKeys).toContain("category")
    })

    it("getProperties returns empty array for document with no properties", async () => {
      writeMdFile(tempDir, "no-props.md", {
        title: "No Props",
        content: "This document has no custom properties.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const docId = docs[0]!.id
          return yield* svc.getProperties(docId)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(0)
    })

    it("setProperty on non-existent document fails with MemoryDocumentNotFoundError", async () => {
      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* svc
            .setProperty("mem-000000000000", "key", "value")
            .pipe(Effect.flip)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(error._tag).toBe("MemoryDocumentNotFoundError")
    })

    it("removeProperty on non-existent document fails with MemoryDocumentNotFoundError", async () => {
      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* svc
            .removeProperty("mem-000000000000", "key")
            .pipe(Effect.flip)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(error._tag).toBe("MemoryDocumentNotFoundError")
    })

    it("setProperty overwrites existing value", async () => {
      writeMdFile(tempDir, "overwrite-prop.md", {
        title: "Overwrite Prop",
        content: "Test overwriting a property value.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const docId = docs[0]!.id

          yield* svc.setProperty(docId, "version", "1.0")
          const before = yield* svc.getProperties(docId)

          yield* svc.setProperty(docId, "version", "2.0")
          const after = yield* svc.getProperties(docId)

          return { before, after }
        }).pipe(Effect.provide(shared.layer))
      )

      const beforeMap = new Map(result.before.map((p) => [p.key, p.value]))
      expect(beforeMap.get("version")).toBe("1.0")

      const afterMap = new Map(result.after.map((p) => [p.key, p.value]))
      expect(afterMap.get("version")).toBe("2.0")
    })
  })

  // ===========================================================================
  // 11. tx_memory_relate — Relations
  // ===========================================================================

  describe("tx_memory_relate", () => {
    it("adds a related reference to a document via updateFrontmatter", async () => {
      writeMdFile(tempDir, "relatable.md", {
        title: "Relatable Doc",
        content: "A document to test relations.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const docId = docs[0]!.id
          const updated = yield* svc.updateFrontmatter(docId, {
            addRelated: ["some-other-doc"],
          })
          // Related items are stored in frontmatter JSON, not a top-level field.
          // Parse the frontmatter to verify the related field was written.
          const fm = updated.frontmatter ? JSON.parse(updated.frontmatter) : {}
          // After updateFrontmatter, re-index to propagate links, then check outgoing links
          yield* svc.index()
          const links = yield* svc.getLinks(docId)
          return { fm, links }
        }).pipe(Effect.provide(shared.layer))
      )

      // Verify frontmatter contains the related entry
      expect(result.fm.related).toBeDefined()
      expect(result.fm.related).toContain("some-other-doc")

      // After re-indexing, the related entry should appear as a frontmatter link
      const fmLink = result.links.find(
        (l) => l.linkType === "frontmatter" && l.targetRef === "some-other-doc"
      )
      expect(fmLink).toBeDefined()
    })

    it("relate on non-existent document fails with MemoryDocumentNotFoundError", async () => {
      const error = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* svc
            .updateFrontmatter("mem-000000000000", {
              addRelated: ["target"],
            })
            .pipe(Effect.flip)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(error._tag).toBe("MemoryDocumentNotFoundError")
    })
  })

  // ===========================================================================
  // 12. tx_memory_link / tx_memory_links / tx_memory_backlinks — Links
  // ===========================================================================

  describe("tx_memory_link / tx_memory_links / tx_memory_backlinks", () => {
    it("addLink creates an explicit link between documents", async () => {
      writeMdFile(tempDir, "source-doc.md", {
        title: "Source Document",
        content: "This document links to another.",
      })
      writeMdFile(tempDir, "target-doc.md", {
        title: "Target Document",
        content: "This document is linked to.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()

          const sourceDoc = docs.find((d) => d.title === "Source Document")!
          const targetDoc = docs.find((d) => d.title === "Target Document")!

          yield* svc.addLink(sourceDoc.id, targetDoc.filePath)
          const links = yield* svc.getLinks(sourceDoc.id)
          return { links, targetFilePath: targetDoc.filePath }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.links.length).toBeGreaterThanOrEqual(1)
      const explicitLink = result.links.find((l) => l.linkType === "explicit")
      expect(explicitLink).toBeDefined()
      expect(explicitLink!.targetRef).toBe(result.targetFilePath)
    })

    it("getLinks returns outgoing wikilinks from content", async () => {
      writeMdFile(tempDir, "linker.md", {
        title: "Linker",
        content: "Check out [[other-doc]] for details.",
      })
      writeMdFile(tempDir, "other-doc.md", {
        title: "Other Doc",
        content: "Referenced by linker.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()

          const linkerDoc = docs.find((d) => d.title === "Linker")!
          const links = yield* svc.getLinks(linkerDoc.id)
          return links
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.length).toBeGreaterThanOrEqual(1)
      const wikilinkOut = result.find((l) => l.linkType === "wikilink")
      expect(wikilinkOut).toBeDefined()
      expect(wikilinkOut!.targetRef).toBe("other-doc")
    })

    it("getBacklinks returns incoming links after explicit link creation", async () => {
      writeMdFile(tempDir, "linker-a.md", {
        title: "Linker A",
        content: "See [[linker-b]] for details.",
      })
      writeMdFile(tempDir, "linker-b.md", {
        title: "Linker B",
        content: "This document is referenced by linker-a.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()

          const docA = docs.find((d) => d.title === "Linker A")!
          const docB = docs.find((d) => d.title === "Linker B")!

          // The wikilink [[linker-b]] in docA should create an outgoing link from A
          const outgoingFromA = yield* svc.getLinks(docA.id)

          // Add an explicit link from A to B
          yield* svc.addLink(docA.id, docB.filePath)
          const backlinksAfterExplicit = yield* svc.getBacklinks(docB.id)

          return {
            outgoingFromA,
            backlinksAfterExplicit,
            docAId: docA.id,
          }
        }).pipe(Effect.provide(shared.layer))
      )

      // DocA has a wikilink [[linker-b]], so it should have outgoing links
      expect(result.outgoingFromA.length).toBeGreaterThanOrEqual(1)
      const wikilinkOut = result.outgoingFromA.find(
        (l) => l.linkType === "wikilink"
      )
      expect(wikilinkOut).toBeDefined()
      expect(wikilinkOut!.targetRef).toBe("linker-b")

      // After adding explicit link, backlinks to B should include docA
      const explicitBacklink = result.backlinksAfterExplicit.find(
        (l) => l.sourceDocId === result.docAId && l.linkType === "explicit"
      )
      expect(explicitBacklink).toBeDefined()
    })

    it("getLinks returns empty array for document with no links", async () => {
      writeMdFile(tempDir, "isolated.md", {
        title: "Isolated Doc",
        content: "No links here at all.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          return yield* svc.getLinks(docs[0]!.id)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(0)
    })

    it("getBacklinks returns empty array for unreferenced document", async () => {
      writeMdFile(tempDir, "unreferenced.md", {
        title: "Unreferenced Doc",
        content: "Nobody links to me.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          return yield* svc.getBacklinks(docs[0]!.id)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(0)
    })
  })

  // ===========================================================================
  // 13. tx_memory_list — List Documents with Filters
  // ===========================================================================

  describe("tx_memory_list", () => {
    it("lists all documents when no filters specified", async () => {
      writeMdFile(tempDir, "list-a.md", { title: "List A", content: "A" })
      writeMdFile(tempDir, "list-b.md", { title: "List B", content: "B" })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.listDocuments()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(2)
    })

    it("filters documents by tags", async () => {
      writeMdFile(tempDir, "alpha.md", {
        title: "Alpha Doc",
        tags: ["important", "review"],
        content: "Alpha content.",
      })
      writeMdFile(tempDir, "beta.md", {
        title: "Beta Doc",
        tags: ["draft"],
        content: "Beta content.",
      })
      writeMdFile(tempDir, "gamma.md", {
        title: "Gamma Doc",
        tags: ["important", "final"],
        content: "Gamma content.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const allDocs = yield* svc.listDocuments()
          const importantDocs = yield* svc.listDocuments({
            tags: ["important"],
          })
          const draftDocs = yield* svc.listDocuments({ tags: ["draft"] })
          return { allDocs, importantDocs, draftDocs }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.allDocs).toHaveLength(3)
      expect(result.importantDocs).toHaveLength(2)
      const importantTitles = result.importantDocs
        .map((d) => d.title)
        .sort()
      expect(importantTitles).toEqual(["Alpha Doc", "Gamma Doc"])
      expect(result.draftDocs).toHaveLength(1)
      expect(result.draftDocs[0]!.title).toBe("Beta Doc")
    })

    it("returns empty array when no documents match filter", async () => {
      writeMdFile(tempDir, "only-one.md", {
        title: "Only One",
        tags: ["unique"],
        content: "Unique content.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.listDocuments({ tags: ["nonexistent-tag"] })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(0)
    })
  })

  // ===========================================================================
  // 14. End-to-End: Combined Workflow
  // ===========================================================================

  describe("End-to-End Combined Workflow", () => {
    it("full lifecycle: add source, index, search, tag, set property, link, verify", async () => {
      writeMdFile(tempDir, "project-plan.md", {
        title: "Project Plan",
        content: "This is the main project plan document with goals and milestones.",
      })
      writeMdFile(tempDir, "meeting-notes.md", {
        title: "Meeting Notes",
        content: "Notes from the team meeting about project planning and deadlines.",
      })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          const retriever = yield* MemoryRetrieverService

          // Step 1: Add source
          const source = yield* svc.addSource(tempDir, "project-docs")
          const sources = yield* svc.listSources()

          // Step 2: Index
          const indexResult = yield* svc.index()

          // Step 3: List all documents
          const allDocs = yield* svc.listDocuments()

          // Step 4: Search
          const searchResults = yield* retriever.search("project plan milestones")

          // Step 5: Tag a document
          const planDoc = allDocs.find((d) => d.title === "Project Plan")!
          const taggedDoc = yield* svc.updateFrontmatter(planDoc.id, {
            addTags: ["active", "q1"],
          })

          // Step 6: Set property
          yield* svc.setProperty(planDoc.id, "owner", "team-alpha")
          const props = yield* svc.getProperties(planDoc.id)

          // Step 7: Link documents
          const meetingDoc = allDocs.find(
            (d) => d.title === "Meeting Notes"
          )!
          yield* svc.addLink(planDoc.id, meetingDoc.filePath)
          const links = yield* svc.getLinks(planDoc.id)
          const backlinks = yield* svc.getBacklinks(meetingDoc.id)

          // Step 8: Index status
          const status = yield* svc.indexStatus()

          return {
            source,
            sources,
            indexResult,
            allDocs,
            searchResults,
            taggedDoc,
            props,
            links,
            backlinks,
            status,
          }
        }).pipe(Effect.provide(shared.layer))
      )

      // Verify source
      expect(result.sources).toHaveLength(1)
      expect(result.source.label).toBe("project-docs")

      // Verify indexing
      expect(result.indexResult.indexed).toBe(2)
      expect(result.allDocs).toHaveLength(2)

      // Verify search
      expect(result.searchResults.length).toBeGreaterThanOrEqual(1)

      // Verify tagging
      expect(result.taggedDoc.tags).toContain("active")
      expect(result.taggedDoc.tags).toContain("q1")

      // Verify property
      const ownerProp = result.props.find((p) => p.key === "owner")
      expect(ownerProp).toBeDefined()
      expect(ownerProp!.value).toBe("team-alpha")

      // Verify links
      const explicitLink = result.links.find(
        (l) => l.linkType === "explicit"
      )
      expect(explicitLink).toBeDefined()

      // Verify backlinks
      expect(result.backlinks.length).toBeGreaterThanOrEqual(1)

      // Verify status
      expect(result.status.sources).toBe(1)
      expect(result.status.indexed).toBeGreaterThanOrEqual(2)
    })
  })
})
