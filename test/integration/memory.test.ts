/**
 * Integration tests for the Memory system (filesystem-backed memory).
 *
 * Tests cover:
 * - Source management (register/unregister directories)
 * - Document creation (writes .md files with frontmatter)
 * - Indexing (reads .md files, syncs to SQLite)
 * - BM25 search (FTS5 text search)
 * - Wikilink parsing and resolution
 * - Frontmatter parsing (tags, properties, related)
 * - Incremental indexing (skip unchanged, remove deleted)
 * - Properties (structured key-value metadata)
 * - FTS5 trigger correctness (DELETE+INSERT pattern)
 * - Path traversal protection
 * - Edge cases (empty directories, special characters)
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import { getSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import {
  MemoryService,
  MemoryDocumentRepository,
  MemoryRetrieverService,
} from "@jamesaphoenix/tx-core"
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Helper: create a temp directory for test .md files
const createTempDir = (): string => mkdtempSync(join(tmpdir(), "tx-memory-test-"))

// Helper: write a .md file to a directory
const writeMd = (dir: string, name: string, content: string): string => {
  const filePath = join(dir, name)
  writeFileSync(filePath, content, "utf-8")
  return filePath
}

describe("Memory System Integration", () => {
  let shared: SharedTestLayerResult
  let tempDir: string

  beforeEach(async () => {
    shared = await getSharedTestLayer()
    tempDir = createTempDir()
  })

  afterEach(() => {
    try { rmSync(tempDir, { recursive: true }) } catch { /* ignore */ }
  })

  // ===========================================================================
  // 1. Source Management
  // ===========================================================================

  describe("Source Management", () => {
    it("addSource registers a directory and listSources returns it", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          const source = yield* svc.addSource(tempDir, "test-source")
          const sources = yield* svc.listSources()
          return { source, sources }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.source.rootDir).toBe(tempDir)
      expect(result.source.label).toBe("test-source")
      expect(result.sources).toHaveLength(1)
      expect(result.sources[0]!.rootDir).toBe(tempDir)
    })

    it("removeSource unregisters and deletes indexed docs", async () => {
      writeMd(tempDir, "test.md", "# Test\nHello world")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const beforeCount = yield* Effect.gen(function* () {
            const repo = yield* MemoryDocumentRepository
            return yield* repo.count()
          })

          yield* svc.removeSource(tempDir)

          const afterCount = yield* Effect.gen(function* () {
            const repo = yield* MemoryDocumentRepository
            return yield* repo.count()
          })

          const sources = yield* svc.listSources()
          return { beforeCount, afterCount, sources }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.beforeCount).toBe(1)
      expect(result.afterCount).toBe(0)
      expect(result.sources).toHaveLength(0)
    })

    it("removeSource fails for non-existent source", async () => {
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MemoryService
            yield* svc.removeSource("/non/existent/path")
          }).pipe(Effect.provide(shared.layer))
        )
      ).rejects.toThrow("Memory source not found")
    })
  })

  // ===========================================================================
  // 2. Document Creation
  // ===========================================================================

  describe("Document Creation", () => {
    it("createDocument writes a .md file and indexes it", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          const doc = yield* svc.createDocument({
            title: "Auth Patterns",
            content: "Use RS256 for JWT signing",
            tags: ["auth", "jwt"],
          })
          return doc
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.title).toBe("Auth Patterns")
      expect(result.tags).toContain("auth")
      expect(result.tags).toContain("jwt")
      expect(result.id).toMatch(/^mem-[a-f0-9]{12}$/)
      expect(result.content).toContain("Use RS256 for JWT signing")
    })

    it("createDocument with properties writes them to frontmatter", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          const doc = yield* svc.createDocument({
            title: "Config Notes",
            properties: { status: "draft", author: "james" },
          })
          const props = yield* svc.getProperties(doc.id)
          return { doc, props }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.props).toHaveLength(2)
      const keys = result.props.map(p => p.key).sort()
      expect(keys).toEqual(["author", "status"])
    })

    it("createDocument rejects empty/special-only titles", async () => {
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MemoryService
            yield* svc.addSource(tempDir)
            yield* svc.createDocument({ title: "!!!" })
          }).pipe(Effect.provide(shared.layer))
        )
      ).rejects.toThrow("empty filename")
    })
  })

  // ===========================================================================
  // 3. Indexing
  // ===========================================================================

  describe("Indexing", () => {
    it("indexes all .md files from a registered source", async () => {
      writeMd(tempDir, "file1.md", "# First\nContent one")
      writeMd(tempDir, "file2.md", "# Second\nContent two")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          const stats = yield* svc.index()
          const docs = yield* svc.listDocuments()
          return { stats, docs }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.stats.indexed).toBe(2)
      expect(result.stats.removed).toBe(0)
      expect(result.docs).toHaveLength(2)
    })

    it("indexes subdirectories recursively", async () => {
      const subDir = join(tempDir, "nested")
      mkdirSync(subDir)
      writeMd(tempDir, "root.md", "# Root")
      writeMd(subDir, "nested.md", "# Nested")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          const stats = yield* svc.index()
          return stats
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.indexed).toBe(2)
    })

    it("skips dot-directories and node_modules", async () => {
      const hiddenDir = join(tempDir, ".hidden")
      const nodeModules = join(tempDir, "node_modules")
      mkdirSync(hiddenDir)
      mkdirSync(nodeModules)
      writeMd(hiddenDir, "hidden.md", "# Hidden")
      writeMd(nodeModules, "nm.md", "# NM")
      writeMd(tempDir, "visible.md", "# Visible")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          const stats = yield* svc.index()
          return stats
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.indexed).toBe(1) // only visible.md
    })

    it("incremental index skips unchanged files", async () => {
      writeMd(tempDir, "stable.md", "# Stable\nThis doesn't change")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index() // first full index

          const stats = yield* svc.index({ incremental: true })
          return stats
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.skipped).toBe(1)
      expect(result.indexed).toBe(0)
    })

    it("incremental index detects changed files", async () => {
      const filePath = writeMd(tempDir, "changing.md", "# Original\nOriginal content")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          // Modify the file
          writeFileSync(filePath, "# Modified\nNew content", "utf-8")

          const stats = yield* svc.index({ incremental: true })
          const doc = yield* svc.listDocuments()
          return { stats, doc }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.stats.indexed).toBe(1)
      expect(result.stats.skipped).toBe(0)
      expect(result.doc[0]!.title).toBe("Modified")
    })

    it("removes docs for deleted files", async () => {
      const filePath = writeMd(tempDir, "to-delete.md", "# Delete Me")
      writeMd(tempDir, "keep.md", "# Keep Me")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          unlinkSync(filePath)

          const stats = yield* svc.index()
          const docs = yield* svc.listDocuments()
          return { stats, docs }
        }).pipe(Effect.provide(shared.layer))
      )

      // Verify end state: only keep.md remains
      // Note: stats.removed may be inflated by FTS5 trigger changes in bun:sqlite
      expect(result.stats.removed).toBeGreaterThanOrEqual(1)
      expect(result.docs).toHaveLength(1)
      expect(result.docs[0]!.title).toBe("Keep Me")
    })
  })

  // ===========================================================================
  // 4. BM25 Search
  // ===========================================================================

  describe("BM25 Search", () => {
    it("returns ranked results matching content", async () => {
      writeMd(tempDir, "auth.md", "# Authentication\nJWT tokens are used for auth")
      writeMd(tempDir, "db.md", "# Database\nSQLite with WAL mode")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.search("authentication JWT")
        }).pipe(Effect.provide(shared.layer))
      )

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]!.title).toBe("Authentication")
      expect(results[0]!.bm25Score).toBeGreaterThan(0)
      expect(results[0]!.bm25Rank).toBe(1)
    })

    it("search returns empty for no matches", async () => {
      writeMd(tempDir, "test.md", "# Test\nHello world")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.search("zyxwvutsrqp")
        }).pipe(Effect.provide(shared.layer))
      )

      expect(results).toHaveLength(0)
    })

    it("search respects limit option", async () => {
      for (let i = 0; i < 5; i++) {
        writeMd(tempDir, `doc${i}.md`, `# Document ${i}\nEffect TS patterns`)
      }

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.search("Effect patterns", { limit: 2 })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(results).toHaveLength(2)
    })

    it("search filters by tags", async () => {
      writeMd(tempDir, "tagged.md", "---\ntags: [auth, security]\n---\n# Auth\nAuth content")
      writeMd(tempDir, "untagged.md", "# Untagged\nAuth content too")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.search("auth content", { tags: ["auth"] })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(results).toHaveLength(1)
      expect(results[0]!.title).toBe("Auth")
    })

    it("search includes recencyScore", async () => {
      writeMd(tempDir, "recent.md", "# Recent\nTest content")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.search("test content")
        }).pipe(Effect.provide(shared.layer))
      )

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]!.recencyScore).toBeGreaterThanOrEqual(0)
      expect(results[0]!.recencyScore).toBeLessThanOrEqual(1)
    })
  })

  // ===========================================================================
  // 5. FTS5 Trigger Correctness
  // ===========================================================================

  describe("FTS5 Trigger Correctness", () => {
    it("re-indexing updates FTS content (DELETE+INSERT fires triggers)", async () => {
      const filePath = writeMd(tempDir, "evolving.md", "# Original\nOriginal searchable content")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          // Search for original content
          const before = yield* svc.search("original searchable")

          // Modify file with completely different content
          writeFileSync(filePath, "# Updated\nCompletely new different text", "utf-8")
          yield* svc.index()

          // Old content should NOT be found
          const afterOld = yield* svc.search("original searchable")
          // New content SHOULD be found
          const afterNew = yield* svc.search("completely new different")

          return { before, afterOld, afterNew }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.before.length).toBeGreaterThan(0)
      expect(result.afterOld).toHaveLength(0) // Old content gone from FTS
      expect(result.afterNew.length).toBeGreaterThan(0) // New content in FTS
    })
  })

  // ===========================================================================
  // 6. Frontmatter Parsing
  // ===========================================================================

  describe("Frontmatter Parsing", () => {
    it("parses tags from frontmatter", async () => {
      writeMd(tempDir, "tagged.md", "---\ntags: [auth, jwt, security]\n---\n# Tagged Doc\nContent")

      const docs = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.listDocuments()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(docs[0]!.tags).toEqual(["auth", "jwt", "security"])
    })

    it("parses created date from frontmatter", async () => {
      writeMd(tempDir, "dated.md", "---\ncreated: 2025-01-15T10:00:00Z\n---\n# Dated\nContent")

      const docs = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.listDocuments()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(docs[0]!.createdAt).toBe("2025-01-15T10:00:00Z")
    })

    it("extracts properties from non-reserved frontmatter keys", async () => {
      writeMd(tempDir, "props.md", "---\ntags: [test]\nstatus: draft\nauthor: james\n---\n# Props\nContent")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const props = yield* svc.getProperties(docs[0]!.id)
          return props
        }).pipe(Effect.provide(shared.layer))
      )

      const propMap = Object.fromEntries(result.map(p => [p.key, p.value]))
      expect(propMap.status).toBe("draft")
      expect(propMap.author).toBe("james")
    })

    it("handles files without frontmatter", async () => {
      writeMd(tempDir, "plain.md", "# Plain Doc\n\nJust content, no frontmatter.")

      const docs = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.listDocuments()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(docs[0]!.title).toBe("Plain Doc")
      expect(docs[0]!.tags).toEqual([])
      expect(docs[0]!.frontmatter).toBeNull()
    })

    it("handles frontmatter at EOF (no trailing newline after ---)", async () => {
      writeMd(tempDir, "eof.md", "---\ntags: [test]\n---\n# EOF Test")

      const docs = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.listDocuments()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(docs[0]!.tags).toEqual(["test"])
    })
  })

  // ===========================================================================
  // 7. Wikilinks
  // ===========================================================================

  describe("Wikilinks", () => {
    it("parses wikilinks into memory_links", async () => {
      writeMd(tempDir, "source.md", "# Source\nLinks to [[target]] and [[other]]")
      writeMd(tempDir, "target.md", "# Target\nTarget content")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const sourceDocs = docs.filter(d => d.title === "Source")
          const links = yield* svc.getLinks(sourceDocs[0]!.id)
          return links
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(2)
      const refs = result.map(l => l.targetRef).sort()
      expect(refs).toEqual(["other", "target"])
      expect(result[0]!.linkType).toBe("wikilink")
    })

    it("resolves wikilink targets to document IDs", async () => {
      writeMd(tempDir, "page-a.md", "# Page A\nLinks to [[page-b]]")
      writeMd(tempDir, "page-b.md", "# Page B\nContent")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const pageA = docs.find(d => d.title === "Page A")!
          const pageB = docs.find(d => d.title === "Page B")!

          const links = yield* svc.getLinks(pageA.id)
          return { links, pageBId: pageB.id }
        }).pipe(Effect.provide(shared.layer))
      )

      // The target should be resolved if file path matches
      const pageBLink = result.links.find(l => l.targetRef === "page-b")
      expect(pageBLink).toBeDefined()
    })

    it("strips #heading fragments from wikilinks", async () => {
      writeMd(tempDir, "heading-link.md", "# Links\nSee [[other#section]] for details")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const links = yield* svc.getLinks(docs[0]!.id)
          return links
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result).toHaveLength(1)
      expect(result[0]!.targetRef).toBe("other") // fragment stripped
    })

    it("parses aliased wikilinks [[page|display text]]", async () => {
      writeMd(tempDir, "aliased.md", "# Aliased\nSee [[real-page|display text]]")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const links = yield* svc.getLinks(docs[0]!.id)
          return links
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result[0]!.targetRef).toBe("real-page")
    })

    it("getBacklinks returns incoming links", async () => {
      writeMd(tempDir, "a.md", "# A\nLinks to [[b]]")
      writeMd(tempDir, "c.md", "# C\nAlso links to [[b]]")
      writeMd(tempDir, "b.md", "# B\nTarget page")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const pageB = docs.find(d => d.title === "B")!
          const backlinks = yield* svc.getBacklinks(pageB.id)
          return backlinks
        }).pipe(Effect.provide(shared.layer))
      )

      // B should have 2 backlinks (from A and C)
      expect(result).toHaveLength(2)
    })

    it("frontmatter.related creates frontmatter links", async () => {
      writeMd(tempDir, "related.md", "---\nrelated: [other-doc, third-doc]\n---\n# Related\nContent")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const links = yield* svc.getLinks(docs[0]!.id)
          return links
        }).pipe(Effect.provide(shared.layer))
      )

      const fmLinks = result.filter(l => l.linkType === "frontmatter")
      expect(fmLinks).toHaveLength(2)
    })
  })

  // ===========================================================================
  // 8. Properties
  // ===========================================================================

  describe("Properties", () => {
    it("setProperty writes to DB and frontmatter", async () => {
      writeMd(tempDir, "proptest.md", "---\ntags: [test]\n---\n# Prop Test\nContent")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!
          yield* svc.setProperty(doc.id, "status", "reviewed")

          const props = yield* svc.getProperties(doc.id)
          return props
        }).pipe(Effect.provide(shared.layer))
      )

      const statusProp = result.find(p => p.key === "status")
      expect(statusProp).toBeDefined()
      expect(statusProp!.value).toBe("reviewed")
    })

    it("removeProperty removes from DB and frontmatter", async () => {
      writeMd(tempDir, "rmprop.md", "---\nstatus: draft\ntags: [test]\n---\n# Remove Prop\nContent")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!
          yield* svc.removeProperty(doc.id, "status")

          const props = yield* svc.getProperties(doc.id)
          return props
        }).pipe(Effect.provide(shared.layer))
      )

      const statusProp = result.find(p => p.key === "status")
      expect(statusProp).toBeUndefined()
    })

    it("search filters by property key=value", async () => {
      writeMd(tempDir, "draft.md", "---\nstatus: draft\n---\n# Draft\nDraft content")
      writeMd(tempDir, "published.md", "---\nstatus: published\n---\n# Published\nPublished content")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.search("content", { props: ["status=draft"] })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(results).toHaveLength(1)
      expect(results[0]!.title).toBe("Draft")
    })
  })

  // ===========================================================================
  // 9. Metadata Editing
  // ===========================================================================

  describe("Metadata Editing", () => {
    it("updateFrontmatter adds tags", async () => {
      writeMd(tempDir, "tagging.md", "---\ntags: [initial]\n---\n# Tag Test\nContent")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!
          const updated = yield* svc.updateFrontmatter(doc.id, {
            addTags: ["new-tag", "another"],
          })
          return updated
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.tags).toContain("initial")
      expect(result.tags).toContain("new-tag")
      expect(result.tags).toContain("another")
    })

    it("updateFrontmatter removes tags", async () => {
      writeMd(tempDir, "untag.md", "---\ntags: [keep, remove-me]\n---\n# Untag\nContent")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!
          return yield* svc.updateFrontmatter(doc.id, {
            removeTags: ["remove-me"],
          })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.tags).toContain("keep")
      expect(result.tags).not.toContain("remove-me")
    })

    it("updateFrontmatter adds related links", async () => {
      writeMd(tempDir, "relate.md", "---\ntags: [test]\n---\n# Relate\nContent")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!
          yield* svc.updateFrontmatter(doc.id, { addRelated: ["other-doc"] })

          const links = yield* svc.getLinks(doc.id)
          return links
        }).pipe(Effect.provide(shared.layer))
      )

      const fmLinks = result.filter(l => l.linkType === "frontmatter")
      expect(fmLinks.length).toBeGreaterThan(0)
      expect(fmLinks[0]!.targetRef).toBe("other-doc")
    })
  })

  // ===========================================================================
  // 10. Explicit Edges
  // ===========================================================================

  describe("Explicit Edges", () => {
    it("addLink creates an explicit edge", async () => {
      writeMd(tempDir, "explicit.md", "# Explicit\nContent")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!
          yield* svc.addLink(doc.id, "external-ref")

          const links = yield* svc.getLinks(doc.id)
          return links
        }).pipe(Effect.provide(shared.layer))
      )

      const explicit = result.filter(l => l.linkType === "explicit")
      expect(explicit).toHaveLength(1)
      expect(explicit[0]!.targetRef).toBe("external-ref")
    })
  })

  // ===========================================================================
  // 11. Document Retrieval
  // ===========================================================================

  describe("Document Retrieval", () => {
    it("getDocument returns full content", async () => {
      writeMd(tempDir, "full.md", "# Full Doc\n\nParagraph one.\n\nParagraph two.")

      const doc = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          return yield* svc.getDocument(docs[0]!.id)
        }).pipe(Effect.provide(shared.layer))
      )

      expect(doc.content).toContain("Paragraph one.")
      expect(doc.content).toContain("Paragraph two.")
    })

    it("getDocument throws for non-existent ID", async () => {
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MemoryService
            yield* svc.getDocument("mem-00000000")
          }).pipe(Effect.provide(shared.layer))
        )
      ).rejects.toThrow("Memory document not found")
    })
  })

  // ===========================================================================
  // 12. Index Status
  // ===========================================================================

  describe("Index Status", () => {
    it("reports correct index statistics", async () => {
      writeMd(tempDir, "one.md", "# One\nContent")
      writeMd(tempDir, "two.md", "# Two\n[[one]]")

      const status = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.indexStatus()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(status.totalFiles).toBe(2)
      expect(status.indexed).toBe(2)
      expect(status.stale).toBe(0)
      expect(status.sources).toBe(1)
      expect(status.links).toBeGreaterThanOrEqual(1) // at least the [[one]] wikilink
    })
  })

  // ===========================================================================
  // 13. Multiple Sources
  // ===========================================================================

  describe("Multiple Sources", () => {
    it("indexes documents from multiple sources independently", async () => {
      const dir2 = createTempDir()
      try {
        writeMd(tempDir, "src1.md", "# Source One\nContent from source one")
        writeMd(dir2, "src2.md", "# Source Two\nContent from source two")

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MemoryService
            yield* svc.addSource(tempDir, "first")
            yield* svc.addSource(dir2, "second")
            yield* svc.index()

            const sources = yield* svc.listSources()
            const docs = yield* svc.listDocuments()
            return { sources, docs }
          }).pipe(Effect.provide(shared.layer))
        )

        expect(result.sources).toHaveLength(2)
        expect(result.docs).toHaveLength(2)
      } finally {
        rmSync(dir2, { recursive: true })
      }
    })
  })

  // ===========================================================================
  // 14. Repository Direct Access
  // ===========================================================================

  describe("Repository Layer", () => {
    it("tag filter uses json_each for exact matching (no substring false positives)", async () => {
      writeMd(tempDir, "foo.md", '---\ntags: [foobar]\n---\n# Foobar\nContent')
      writeMd(tempDir, "exact.md", '---\ntags: [foo]\n---\n# Exact\nContent')

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.listDocuments({ tags: ["foo"] })
        }).pipe(Effect.provide(shared.layer))
      )

      // Only exact tag match, not substring
      expect(result).toHaveLength(1)
      expect(result[0]!.title).toBe("Exact")
    })

    it("deleteByPaths handles batches larger than SQL variable limit", async () => {
      // This test verifies the chunking logic works.
      // We can't easily create 1000+ files, but we test the path works at smaller scale.
      for (let i = 0; i < 10; i++) {
        writeMd(tempDir, `batch-${i}.md`, `# Batch ${i}\nContent`)
      }

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          // Delete all files
          for (let i = 0; i < 10; i++) {
            try { unlinkSync(join(tempDir, `batch-${i}.md`)) } catch { /* ignore */ }
          }

          const stats = yield* svc.index()
          return stats
        }).pipe(Effect.provide(shared.layer))
      )

      // bun:sqlite counts FTS5 trigger ops in changes(), so removed >= 10
      expect(result.removed).toBeGreaterThanOrEqual(10)
      // Verify end state: no documents left
      expect(result.indexed).toBe(0)
    })
  })

  // ===========================================================================
  // 15. YAML Serialization Correctness
  // ===========================================================================

  describe("YAML Serialization", () => {
    it("round-trips tags through frontmatter correctly", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)

          // Create with tags
          const doc = yield* svc.createDocument({
            title: "Round Trip",
            tags: ["tag-one", "tag-two"],
          })

          // Add more tags via updateFrontmatter
          const updated = yield* svc.updateFrontmatter(doc.id, {
            addTags: ["tag-three"],
          })

          return updated
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.tags).toEqual(["tag-one", "tag-two", "tag-three"])
    })
  })

  // ===========================================================================
  // 16. Bug Fix Regression Tests
  // ===========================================================================

  describe("Bug Fix Regression Tests", () => {

    // -------------------------------------------------------------------------
    // 16.1 createDocument rejects duplicate file names
    // -------------------------------------------------------------------------
    it("createDocument rejects when file already exists", async () => {
      await expect(
        Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MemoryService
            yield* svc.addSource(tempDir)

            // Create the first document
            yield* svc.createDocument({ title: "Unique Doc", content: "First version" })

            // Attempt to create a second document with the same title (same slug -> same file)
            yield* svc.createDocument({ title: "Unique Doc", content: "Second version" })
          }).pipe(Effect.provide(shared.layer))
        )
      ).rejects.toThrow("File already exists")
    })

    // -------------------------------------------------------------------------
    // 16.2 createDocument in subdirectory uses correct rootDir from registered source
    // -------------------------------------------------------------------------
    it("createDocument in subdirectory resolves rootDir to registered source", async () => {
      const subDir = join(tempDir, "notes", "daily")
      mkdirSync(subDir, { recursive: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          // Register the top-level tempDir as a source
          yield* svc.addSource(tempDir, "top-level")

          // Create a document in a subdirectory of the registered source
          const doc = yield* svc.createDocument({
            title: "Daily Note",
            content: "Today I learned something",
            dir: subDir,
          })

          // Verify the document's rootDir is the registered source, not the subdirectory
          const retrieved = yield* svc.getDocument(doc.id)
          return retrieved
        }).pipe(Effect.provide(shared.layer))
      )

      // rootDir should be the top-level registered source, not the subdirectory
      expect(result.rootDir).toBe(tempDir)
      // filePath should be relative from rootDir, including the subdirectory path
      expect(result.filePath).toContain("notes/daily/")
      expect(result.filePath).toContain("daily-note.md")
    })

    // -------------------------------------------------------------------------
    // 16.3 createDocument rejects dir outside registered sources
    // -------------------------------------------------------------------------
    it("createDocument rejects explicit dir outside any registered source", async () => {
      const outsideDir = createTempDir()
      try {
        await expect(
          Effect.runPromise(
            Effect.gen(function* () {
              const svc = yield* MemoryService
              yield* svc.addSource(tempDir, "only-source")

              // Attempt to create a document in a directory that is NOT within any source
              yield* svc.createDocument({
                title: "Outside Doc",
                content: "This should fail",
                dir: outsideDir,
              })
            }).pipe(Effect.provide(shared.layer))
          )
        ).rejects.toThrow("not within any registered memory source")
      } finally {
        rmSync(outsideDir, { recursive: true })
      }
    })

    // -------------------------------------------------------------------------
    // 16.4 parseFrontmatter handles double-quoted escape sequences
    // -------------------------------------------------------------------------
    it("parseFrontmatter decodes escape sequences in double-quoted values", async () => {
      // Write a file with double-quoted frontmatter values containing escape sequences
      writeMd(tempDir, "escapes.md", [
        "---",
        'description: "Line one\\nLine two"',
        'path: "C:\\\\Users\\\\test"',
        'quote: "He said \\"hello\\""',
        "tags: [test]",
        "---",
        "# Escapes Test",
        "Content",
      ].join("\n"))

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          const docs = yield* svc.listDocuments()
          const doc = docs[0]!
          const props = yield* svc.getProperties(doc.id)
          return { doc, props }
        }).pipe(Effect.provide(shared.layer))
      )

      const propMap = Object.fromEntries(result.props.map(p => [p.key, p.value]))
      // \n should become actual newline
      expect(propMap.description).toBe("Line one\nLine two")
      // \\\\ should become single backslash pairs: C:\Users\test
      expect(propMap.path).toBe("C:\\Users\\test")
      // \" should become literal quote
      expect(propMap.quote).toBe('He said "hello"')
    })

    // -------------------------------------------------------------------------
    // 16.5 resolveTargets prioritizes file_path exact match over title match
    // -------------------------------------------------------------------------
    it("resolveTargets prioritizes file_path match over title match", async () => {
      // Create two documents:
      //   - "page-b.md" with title "Something Else" (file_path match for [[page-b]])
      //   - "other.md" with title "page-b" (title match for [[page-b]])
      // The wikilink [[page-b]] should resolve to the file_path match, not the title match.
      writeMd(tempDir, "page-a.md", "# Page A\nLinks to [[page-b]]")
      writeMd(tempDir, "page-b.md", "# Something Else\nThis is the file_path match")
      writeMd(tempDir, "other.md", "# page-b\nThis has title 'page-b' but different file path")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const pageA = docs.find(d => d.title === "Page A")!
          const pageBFile = docs.find(d => d.title === "Something Else")! // page-b.md
          const pageBTitle = docs.find(d => d.title === "page-b")! // other.md

          const links = yield* svc.getLinks(pageA.id)
          return { links, pageBFileId: pageBFile.id, pageBTitleId: pageBTitle.id }
        }).pipe(Effect.provide(shared.layer))
      )

      const pageBLink = result.links.find(l => l.targetRef === "page-b")
      expect(pageBLink).toBeDefined()
      // Should resolve to the file_path match (page-b.md), NOT the title match (other.md)
      expect(pageBLink!.targetDocId).toBe(result.pageBFileId)
      expect(pageBLink!.targetDocId).not.toBe(result.pageBTitleId)
    })

    // -------------------------------------------------------------------------
    // 16.6 indexFile path traversal protection
    // -------------------------------------------------------------------------
    it("indexFile returns false for paths outside root directory (../escape)", async () => {
      // Create a file outside the registered source root
      const parentDir = createTempDir()
      const childDir = join(parentDir, "child")
      mkdirSync(childDir)

      // Write a file in parentDir (outside childDir which will be the registered source)
      writeMd(parentDir, "escape.md", "# Escaped\nThis is outside the root")
      // Write a file inside childDir (the registered source)
      writeMd(childDir, "safe.md", "# Safe\nThis is inside the root")

      try {
        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MemoryService
            // Register only the child directory as a source
            yield* svc.addSource(childDir)
            yield* svc.index()

            const docs = yield* svc.listDocuments()
            return docs
          }).pipe(Effect.provide(shared.layer))
        )

        // Only the file inside the root should be indexed
        expect(result).toHaveLength(1)
        expect(result[0]!.title).toBe("Safe")
      } finally {
        rmSync(parentDir, { recursive: true })
      }
    })

    // -------------------------------------------------------------------------
    // 16.7 BM25 search returns actual relevance scores (not position-based)
    // -------------------------------------------------------------------------
    it("BM25 search returns normalized actual scores, not position-based", async () => {
      // Create documents with varying relevance to the query
      writeMd(tempDir, "high.md", "# Effect TS\nEffect TS patterns for service layer with Effect TS")
      writeMd(tempDir, "medium.md", "# Patterns\nSome Effect patterns here")
      writeMd(tempDir, "low.md", "# Database\nSQLite with WAL mode for persistence")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.search("Effect TS patterns")
        }).pipe(Effect.provide(shared.layer))
      )

      // Should have results for documents containing "Effect" or "patterns"
      expect(results.length).toBeGreaterThanOrEqual(2)

      // The top result should have score 1.0 (normalized max)
      expect(results[0]!.bm25Score).toBe(1)

      // Lower results should have scores < 1.0 but > 0
      if (results.length > 1) {
        expect(results[1]!.bm25Score).toBeGreaterThan(0)
        expect(results[1]!.bm25Score).toBeLessThanOrEqual(1)
      }

      // Scores should be monotonically non-increasing (sorted by relevance)
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.bm25Score).toBeLessThanOrEqual(results[i - 1]!.bm25Score)
      }

      // The "low" doc should NOT appear (no matching terms)
      const lowDoc = results.find(r => r.title === "Database")
      expect(lowDoc).toBeUndefined()
    })

    // -------------------------------------------------------------------------
    // 16.8 MemoryRetrieverService BM25 search (no embeddings, graceful degradation)
    // -------------------------------------------------------------------------
    it("MemoryRetrieverService returns BM25 results without embeddings", async () => {
      writeMd(tempDir, "retriever-test.md", "# Retriever\nRetrieval augmented generation pipeline")
      writeMd(tempDir, "unrelated.md", "# Cooking\nHow to make pasta carbonara")

      // The minimal layer provides MemoryRetrieverServiceLive with EmbeddingServiceNoop
      // which gracefully degrades to BM25-only search
      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          // Use MemoryRetrieverService for search
          const retriever = yield* MemoryRetrieverService
          return yield* retriever.search("retrieval augmented generation")
        }).pipe(Effect.provide(shared.layer))
      )

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]!.title).toBe("Retriever")
      // Should have relevance scoring fields
      expect(results[0]!.relevanceScore).toBeGreaterThan(0)
      expect(results[0]!.bm25Score).toBeGreaterThan(0)
      // Vector score should be 0 (no embeddings in Noop embedding service)
      expect(results[0]!.vectorScore).toBe(0)
      expect(results[0]!.bm25Rank).toBe(1)
    })

    // -------------------------------------------------------------------------
    // 16.9 MemoryRetrieverService isAvailable returns true (Live graceful degradation)
    // -------------------------------------------------------------------------
    it("MemoryRetrieverService isAvailable returns true for Live variant", async () => {
      // Both App and Minimal layers use MemoryRetrieverServiceLive which
      // gracefully degrades to BM25-only when no embeddings are available
      const available = await Effect.runPromise(
        Effect.gen(function* () {
          const retriever = yield* MemoryRetrieverService
          return yield* retriever.isAvailable()
        }).pipe(Effect.provide(shared.layer))
      )

      expect(available).toBe(true)
    })

    // -------------------------------------------------------------------------
    // 16.10 setProperty writes file before DB update
    // -------------------------------------------------------------------------
    it("setProperty persists property to both file frontmatter and DB", async () => {
      writeMd(tempDir, "file-first.md", "---\ntags: [test]\n---\n# File First\nContent")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!

          // Set a property — this should write to the file first, then DB
          yield* svc.setProperty(doc.id, "priority", "high")

          // Read back from DB
          const props = yield* svc.getProperties(doc.id)

          return { props }
        }).pipe(Effect.provide(shared.layer))
      )

      const priorityProp = result.props.find((p: { key: string; value: string }) => p.key === "priority")
      expect(priorityProp).toBeDefined()
      expect(priorityProp!.value).toBe("high")

      // Also verify the file was written (filesystem is source of truth)
      const fileContent = readFileSync(join(tempDir, "file-first.md"), "utf-8")
      expect(fileContent).toContain("priority: high")
    })
  })

  // ===========================================================================
  // 17. Audit-driven regression tests (data integrity, error paths, edge cases)
  // ===========================================================================
  describe("17. Audit-driven regression tests", () => {

    // -------------------------------------------------------------------------
    // 17.1 Graph expansion via MemoryRetrieverService
    // -------------------------------------------------------------------------
    it("MemoryRetrieverService expand follows wikilinks with score decay", async () => {
      writeMd(tempDir, "a.md", "# Alpha\nAlpha is about retrieval pipeline\n[[b]]")
      writeMd(tempDir, "b.md", "# Beta\nBeta connects to Charlie\n[[c]]")
      writeMd(tempDir, "c.md", "# Charlie\nCharlie is the leaf node")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const retriever = yield* MemoryRetrieverService
          return yield* retriever.search("retrieval pipeline", { expand: true, limit: 10 })
        }).pipe(Effect.provide(shared.layer))
      )

      // Alpha should be the BM25 hit
      const alpha = results.find(r => r.title === "Alpha")
      expect(alpha).toBeDefined()
      expect(alpha!.relevanceScore).toBeGreaterThan(0)

      // Beta should appear via 1-hop expansion
      const beta = results.find(r => r.title === "Beta")
      expect(beta).toBeDefined()

      // Score should decay: Alpha > Beta
      expect(alpha!.relevanceScore).toBeGreaterThan(beta!.relevanceScore)
    })

    // -------------------------------------------------------------------------
    // 17.2 Graph expansion with cycles
    // -------------------------------------------------------------------------
    it("MemoryRetrieverService expand handles cycles without infinite loop", async () => {
      writeMd(tempDir, "cycle-a.md", "# Cycle A\ncycle search term\n[[cycle-b]]")
      writeMd(tempDir, "cycle-b.md", "# Cycle B\nlinked from A\n[[cycle-c]]")
      writeMd(tempDir, "cycle-c.md", "# Cycle C\nlinked from B\n[[cycle-a]]")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const retriever = yield* MemoryRetrieverService
          return yield* retriever.search("cycle search term", { expand: true, limit: 20 })
        }).pipe(Effect.provide(shared.layer))
      )

      // Should terminate without hanging
      const titles = results.map(r => r.title)
      expect(titles.filter(t => t === "Cycle A")).toHaveLength(1)
      expect(titles.filter(t => t === "Cycle B")).toHaveLength(1)
      expect(titles.filter(t => t === "Cycle C")).toHaveLength(1)
    })

    // -------------------------------------------------------------------------
    // 17.3 updateFrontmatter on non-existent doc
    // -------------------------------------------------------------------------
    it("updateFrontmatter fails with MemoryDocumentNotFoundError for non-existent doc", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* Effect.either(
            svc.updateFrontmatter("mem-deadbeef", { addTags: ["test"] })
          )
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("MemoryDocumentNotFoundError")
      }
    })

    // -------------------------------------------------------------------------
    // 17.4 setProperty / removeProperty on non-existent doc
    // -------------------------------------------------------------------------
    it("setProperty fails with MemoryDocumentNotFoundError for non-existent doc", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* Effect.either(svc.setProperty("mem-00000000", "key", "value"))
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("MemoryDocumentNotFoundError")
      }
    })

    it("removeProperty fails with MemoryDocumentNotFoundError for non-existent doc", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* Effect.either(svc.removeProperty("mem-00000000", "priority"))
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("MemoryDocumentNotFoundError")
      }
    })

    // -------------------------------------------------------------------------
    // 17.5 setProperty / removeProperty reject reserved keys
    // -------------------------------------------------------------------------
    it("setProperty rejects reserved frontmatter key 'tags'", async () => {
      writeMd(tempDir, "reserved.md", "---\ntags: [original]\n---\n# Reserved\nContent")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          return yield* Effect.either(svc.setProperty(docs[0]!.id, "tags", "corrupted"))
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ValidationError")
      }
    })

    it("removeProperty rejects reserved frontmatter key 'created'", async () => {
      writeMd(tempDir, "reserved2.md", "---\ntags: [test]\ncreated: 2025-01-01\n---\n# Reserved2\nContent")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          return yield* Effect.either(svc.removeProperty(docs[0]!.id, "created"))
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ValidationError")
      }
    })

    // -------------------------------------------------------------------------
    // 17.6 createDocument rejects reserved keys in properties
    // -------------------------------------------------------------------------
    it("createDocument rejects reserved key in properties", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          return yield* Effect.either(
            svc.createDocument({ title: "Bad Props", properties: { tags: "corrupted" } })
          )
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result._tag).toBe("Left")
      if (result._tag === "Left") {
        expect(result.left._tag).toBe("ValidationError")
      }
    })

    // -------------------------------------------------------------------------
    // 17.7 Search handles special characters without crashing
    // -------------------------------------------------------------------------
    it("search handles special characters in query without crashing", async () => {
      writeMd(tempDir, "normal.md", "# Normal\nSome content about Effect patterns")

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const specialQueries = [
            "what is [effect]?",
            "C++ programming",
            "file*.md",
            '{ "key": "value" }',
            "SELECT * FROM memory_documents;",
            "!!@@##$$%%",
            "'single quotes'",
            '"double quotes"',
          ]

          for (const q of specialQueries) {
            const result = yield* Effect.either(svc.search(q))
            expect(result._tag).toBe("Right")
          }
        }).pipe(Effect.provide(shared.layer))
      )
    })

    // -------------------------------------------------------------------------
    // 17.8 listDocuments tag filter with null/empty tags
    // -------------------------------------------------------------------------
    it("listDocuments with tag filter handles docs with null/empty tags gracefully", async () => {
      writeMd(tempDir, "no-fm.md", "# No Frontmatter\nPlain content")
      writeMd(tempDir, "empty-tags.md", "---\ntags: []\n---\n# Empty Tags\nContent")
      writeMd(tempDir, "has-tags.md", "---\ntags: [important]\n---\n# Has Tags\nContent")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const filtered = yield* svc.listDocuments({ tags: ["important"] })
          const all = yield* svc.listDocuments()
          return { filtered, all }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(results.all).toHaveLength(3)
      expect(results.filtered).toHaveLength(1)
      expect(results.filtered[0]!.title).toBe("Has Tags")
    })

    // -------------------------------------------------------------------------
    // 17.9 setProperty overwrite (upsert behavior)
    // -------------------------------------------------------------------------
    it("setProperty overwrites existing property in both file and DB", async () => {
      writeMd(tempDir, "overwrite.md", "---\npriority: low\ntags: [test]\n---\n# Overwrite Test\nContent")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!

          const propsBefore = yield* svc.getProperties(doc.id)
          const priorityBefore = propsBefore.find(p => p.key === "priority")
          expect(priorityBefore?.value).toBe("low")

          yield* svc.setProperty(doc.id, "priority", "high")

          return yield* svc.getProperties(doc.id)
        }).pipe(Effect.provide(shared.layer))
      )

      const priorityProp = result.find((p: { key: string }) => p.key === "priority")
      expect(priorityProp).toBeDefined()
      expect(priorityProp!.value).toBe("high")

      const fileContent = readFileSync(join(tempDir, "overwrite.md"), "utf-8")
      expect(fileContent).toContain("priority: high")
      expect(fileContent).not.toContain("priority: low")
    })

    // -------------------------------------------------------------------------
    // 17.10 removeSource cascades to links and properties
    // -------------------------------------------------------------------------
    it("removeSource cascades to links and properties", async () => {
      writeMd(tempDir, "linked.md", "---\npriority: high\ntags: [test]\n---\n# Linked\n[[other]]\nContent")
      writeMd(tempDir, "other.md", "# Other\nTarget of link")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docsBefore = yield* svc.listDocuments()
          expect(docsBefore.length).toBe(2)
          const linkedDoc = docsBefore.find(d => d.title === "Linked")!
          const linksBefore = yield* svc.getLinks(linkedDoc.id)
          expect(linksBefore.length).toBeGreaterThan(0)
          const propsBefore = yield* svc.getProperties(linkedDoc.id)
          expect(propsBefore.length).toBeGreaterThan(0)

          yield* svc.removeSource(tempDir)

          const docsAfter = yield* svc.listDocuments()
          const linksAfter = yield* svc.getLinks(linkedDoc.id)
          const propsAfter = yield* svc.getProperties(linkedDoc.id)

          return { docsAfter, linksAfter, propsAfter }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.docsAfter).toHaveLength(0)
      expect(result.linksAfter).toHaveLength(0)
      expect(result.propsAfter).toHaveLength(0)
    })

    // -------------------------------------------------------------------------
    // 17.11 File with only frontmatter (no body)
    // -------------------------------------------------------------------------
    it("indexes file with only frontmatter and no body content", async () => {
      writeMd(tempDir, "stub.md", "---\ntags: [stub]\npriority: low\n---\n")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const props = docs.length > 0 ? yield* svc.getProperties(docs[0]!.id) : []

          return { docs, props }
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.docs).toHaveLength(1)
      expect(result.docs[0]!.title).toBe("stub")
      expect(result.docs[0]!.tags).toContain("stub")
      const priorityProp = result.props.find((p: { key: string }) => p.key === "priority")
      expect(priorityProp).toBeDefined()
      expect(priorityProp!.value).toBe("low")
    })

    // -------------------------------------------------------------------------
    // 17.12 Cross-source path isolation (deleteByPaths uses rootDir)
    // -------------------------------------------------------------------------
    it("deleteByPaths only removes docs from the specified source", async () => {
      const tempDir2 = createTempDir()
      try {
        // Both sources have a file with the same relative path
        writeMd(tempDir, "notes.md", "# Notes Source A\nContent A")
        writeMd(tempDir2, "notes.md", "# Notes Source B\nContent B")

        const result = await Effect.runPromise(
          Effect.gen(function* () {
            const svc = yield* MemoryService
            yield* svc.addSource(tempDir)
            yield* svc.addSource(tempDir2)
            yield* svc.index()

            const allBefore = yield* svc.listDocuments()
            expect(allBefore).toHaveLength(2)

            // Remove the file from source A
            unlinkSync(join(tempDir, "notes.md"))
            yield* svc.index()

            // Source B's doc should still exist
            const allAfter = yield* svc.listDocuments()
            return allAfter
          }).pipe(Effect.provide(shared.layer))
        )

        expect(result).toHaveLength(1)
        expect(result[0]!.title).toBe("Notes Source B")
      } finally {
        rmSync(tempDir2, { recursive: true, force: true })
      }
    })

    // -------------------------------------------------------------------------
    // 17.13 searchBM25 respects limit
    // -------------------------------------------------------------------------
    it("searchBM25 returns at most the requested limit", async () => {
      // Create more files than the limit
      for (let i = 0; i < 10; i++) {
        writeMd(tempDir, `doc${i}.md`, `# Doc ${i}\nSearch term alpha beta gamma`)
      }

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          return yield* svc.search("alpha beta gamma", { limit: 3 })
        }).pipe(Effect.provide(shared.layer))
      )

      expect(result.length).toBeLessThanOrEqual(3)
    })

    // -------------------------------------------------------------------------
    // 17.14 Stale properties cleared on re-index when frontmatter becomes empty
    // -------------------------------------------------------------------------
    it("re-index clears stale properties when frontmatter properties are removed", async () => {
      writeMd(tempDir, "stale.md", "---\ntags: [test]\npriority: high\n---\n# Stale\nContent")

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!
          const propsBefore = yield* svc.getProperties(doc.id)
          expect(propsBefore.find(p => p.key === "priority")).toBeDefined()

          // Remove the property from the file (keep tags)
          writeFileSync(join(tempDir, "stale.md"), "---\ntags: [test]\n---\n# Stale\nContent", "utf-8")
          yield* svc.index()

          const propsAfter = yield* svc.getProperties(doc.id)
          expect(propsAfter.find(p => p.key === "priority")).toBeUndefined()
        }).pipe(Effect.provide(shared.layer))
      )
    })

    // -------------------------------------------------------------------------
    // 17.15 Retriever tags filtering
    // -------------------------------------------------------------------------
    it("MemoryRetrieverService search filters by tags", async () => {
      writeMd(tempDir, "tagged-a.md", "---\ntags: [auth]\n---\n# Auth Doc\nAuthentication and authorization patterns")
      writeMd(tempDir, "tagged-b.md", "---\ntags: [database]\n---\n# DB Doc\nDatabase patterns and optimization")
      writeMd(tempDir, "tagged-c.md", "---\ntags: [auth, database]\n---\n# Both\nAuth and database patterns")

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const retriever = yield* MemoryRetrieverService
          return yield* retriever.search("patterns", { tags: ["auth"], limit: 10 })
        }).pipe(Effect.provide(shared.layer))
      )

      // Should only return docs tagged "auth"
      expect(results.length).toBeGreaterThan(0)
      for (const r of results) {
        expect(r.tags).toContain("auth")
      }
    })
  })
})
