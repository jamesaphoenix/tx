/**
 * Integration tests for Memory system createDocument and indexing flows.
 *
 * Covers:
 * 1. createDocument — basic creation with title, content, tags
 * 2. createDocument with properties — custom properties in frontmatter
 * 3. createDocument without content — minimal creation with just title
 * 4. index incremental mode — skip already-indexed unchanged files
 * 5. indexStatus — verify totalFiles, indexed, stale, embedded counts
 * 6. updateFrontmatter with addRelated — file content round-trip
 * 7. setProperty / removeProperty lifecycle — full add/verify/remove/verify
 * 8. getProperties — retrieve all properties, including empty result
 *
 * Uses singleton test database pattern (Doctrine Rule 8).
 * Real in-memory SQLite, no mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { Effect } from "effect"
import {
  getSharedTestLayer,
  type SharedTestLayerResult,
} from "@jamesaphoenix/tx-test-utils"
import { MemoryService } from "@jamesaphoenix/tx-core"
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Helper: create a temp directory for test .md files
const createTempDir = (): string =>
  mkdtempSync(join(tmpdir(), "tx-memory-creation-"))

// Helper: write a .md file to a directory
const writeMd = (dir: string, name: string, content: string): string => {
  const filePath = join(dir, name)
  writeFileSync(filePath, content, "utf-8")
  return filePath
}

describe("Memory Creation & Indexing Flows", () => {
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
  // 1. createDocument — basic creation with title, content, tags
  // ===========================================================================
  describe("createDocument basics", () => {
    it("creates a document with title, content, and tags and returns a proper MemoryDocument", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)

          const doc = yield* svc.createDocument({
            title: "Deployment Guide",
            content: "Use blue-green deployments for zero-downtime releases.",
            tags: ["devops", "deployment", "infrastructure"],
          })

          // Verify the returned document has all expected fields
          return doc
        }).pipe(Effect.provide(shared.layer)),
      )

      // ID format: mem-<12 hex chars>
      expect(result.id).toMatch(/^mem-[a-f0-9]{12}$/)
      expect(result.title).toBe("Deployment Guide")
      expect(result.content).toContain(
        "Use blue-green deployments for zero-downtime releases.",
      )
      expect(result.tags).toEqual(
        expect.arrayContaining(["devops", "deployment", "infrastructure"]),
      )
      expect(result.tags).toHaveLength(3)
      // filePath should be the slugified filename
      expect(result.filePath).toBe("deployment-guide.md")
      // rootDir should match the temp directory
      expect(result.rootDir).toBe(tempDir)
      // Timestamps should be ISO strings
      expect(result.createdAt).toBeTruthy()
      expect(result.indexedAt).toBeTruthy()
      // File hash should be a non-empty hex string (SHA256)
      expect(result.fileHash).toMatch(/^[a-f0-9]{64}$/)

      // Verify the actual file on disk has correct frontmatter
      const fileContent = readFileSync(
        join(tempDir, "deployment-guide.md"),
        "utf-8",
      )
      expect(fileContent).toContain("---")
      expect(fileContent).toContain("tags:")
      expect(fileContent).toContain("devops")
      expect(fileContent).toContain("deployment")
      expect(fileContent).toContain("infrastructure")
      expect(fileContent).toContain("# Deployment Guide")
      expect(fileContent).toContain(
        "Use blue-green deployments for zero-downtime releases.",
      )
    })
  })

  // ===========================================================================
  // 2. createDocument with properties — custom frontmatter properties
  // ===========================================================================
  describe("createDocument with properties", () => {
    it("writes custom properties to frontmatter and persists them in DB", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)

          const doc = yield* svc.createDocument({
            title: "API Design Notes",
            content: "REST vs GraphQL comparison.",
            tags: ["api"],
            properties: { status: "draft", author: "james", priority: "high" },
          })

          const props = yield* svc.getProperties(doc.id)
          return { doc, props }
        }).pipe(Effect.provide(shared.layer)),
      )

      // DB properties should include all 3 custom properties
      expect(result.props).toHaveLength(3)
      const propMap = Object.fromEntries(
        result.props.map((p) => [p.key, p.value]),
      )
      expect(propMap.status).toBe("draft")
      expect(propMap.author).toBe("james")
      expect(propMap.priority).toBe("high")

      // Verify the file on disk contains the properties in frontmatter
      const fileContent = readFileSync(
        join(tempDir, "api-design-notes.md"),
        "utf-8",
      )
      expect(fileContent).toContain("status: draft")
      expect(fileContent).toContain("author: james")
      expect(fileContent).toContain("priority: high")
      // Tags should also be present
      expect(fileContent).toContain("tags:")
      expect(fileContent).toContain("api")
    })
  })

  // ===========================================================================
  // 3. createDocument without content — minimal creation
  // ===========================================================================
  describe("createDocument without content", () => {
    it("creates a document with just a title and no content/tags/properties", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)

          const doc = yield* svc.createDocument({
            title: "Empty Note",
          })

          const props = yield* svc.getProperties(doc.id)
          return { doc, props }
        }).pipe(Effect.provide(shared.layer)),
      )

      expect(result.doc.id).toMatch(/^mem-[a-f0-9]{12}$/)
      expect(result.doc.title).toBe("Empty Note")
      // Content should just be the heading with empty body
      expect(result.doc.content).toContain("# Empty Note")
      // No tags
      expect(result.doc.tags).toHaveLength(0)
      // No properties
      expect(result.props).toHaveLength(0)
      // File should exist on disk
      const fileContent = readFileSync(
        join(tempDir, "empty-note.md"),
        "utf-8",
      )
      expect(fileContent).toContain("# Empty Note")
      // Still has frontmatter (at least the created date)
      expect(fileContent).toContain("---")
      expect(fileContent).toContain("created:")
    })

    it("creates a document without content but with tags", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)

          const doc = yield* svc.createDocument({
            title: "Tagged Note",
            tags: ["memo", "quick"],
          })
          return doc
        }).pipe(Effect.provide(shared.layer)),
      )

      expect(result.title).toBe("Tagged Note")
      expect(result.tags).toEqual(expect.arrayContaining(["memo", "quick"]))
      // Body should be minimal — heading with empty body
      const fileContent = readFileSync(
        join(tempDir, "tagged-note.md"),
        "utf-8",
      )
      expect(fileContent).toContain("# Tagged Note")
      expect(fileContent).toContain("tags:")
    })
  })

  // ===========================================================================
  // 4. index incremental mode — skip already-indexed unchanged files
  // ===========================================================================
  describe("index incremental mode", () => {
    it("skips unchanged files and indexes new files in incremental mode", async () => {
      // Pre-create two files
      writeMd(tempDir, "existing.md", "# Existing\nOriginal content here")
      writeMd(tempDir, "stable.md", "# Stable\nThis does not change")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)

          // Full index first
          const firstRun = yield* svc.index()

          // Add a new file after initial index
          writeMd(tempDir, "newcomer.md", "# Newcomer\nBrand new document")

          // Incremental index — should skip the 2 existing unchanged files, index 1 new
          const secondRun = yield* svc.index({ incremental: true })

          // Verify all 3 docs exist
          const allDocs = yield* svc.listDocuments()

          return { firstRun, secondRun, docCount: allDocs.length }
        }).pipe(Effect.provide(shared.layer)),
      )

      // First run indexed both files
      expect(result.firstRun.indexed).toBe(2)
      expect(result.firstRun.skipped).toBe(0)

      // Second run: 2 skipped (unchanged), 1 indexed (new)
      expect(result.secondRun.skipped).toBe(2)
      expect(result.secondRun.indexed).toBe(1)
      expect(result.secondRun.removed).toBe(0)

      // All 3 docs should be present
      expect(result.docCount).toBe(3)
    })

    it("re-indexes files that changed between incremental runs", async () => {
      const filePath = writeMd(
        tempDir,
        "evolving.md",
        "# Evolving\nVersion one",
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          // Modify the file content (changes the hash)
          writeFileSync(filePath, "# Evolving\nVersion two — updated", "utf-8")

          const stats = yield* svc.index({ incremental: true })
          const docs = yield* svc.listDocuments()
          return { stats, doc: docs[0]! }
        }).pipe(Effect.provide(shared.layer)),
      )

      expect(result.stats.indexed).toBe(1)
      expect(result.stats.skipped).toBe(0)
      expect(result.doc.content).toContain("Version two")
    })

    it("removes documents for files deleted between incremental runs", async () => {
      writeMd(tempDir, "keeper.md", "# Keeper\nStays around")
      const toDelete = writeMd(
        tempDir,
        "doomed.md",
        "# Doomed\nWill be deleted",
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          // Delete one file
          rmSync(toDelete)

          const stats = yield* svc.index({ incremental: true })
          const docs = yield* svc.listDocuments()
          return { stats, docs }
        }).pipe(Effect.provide(shared.layer)),
      )

      // Note: stats.removed may be inflated by FTS5 trigger changes in bun:sqlite
      // (same pattern as existing memory.test.ts). Check end state instead.
      expect(result.stats.removed).toBeGreaterThanOrEqual(1)
      expect(result.docs).toHaveLength(1)
      expect(result.docs[0]!.title).toBe("Keeper")
    })
  })

  // ===========================================================================
  // 5. indexStatus — verify totalFiles, indexed, stale, embedded counts
  // ===========================================================================
  describe("indexStatus", () => {
    it("reports correct counts after full indexing", async () => {
      writeMd(tempDir, "alpha.md", "# Alpha\nFirst document")
      writeMd(tempDir, "beta.md", "# Beta\nSecond document with [[alpha]]")
      writeMd(tempDir, "gamma.md", "# Gamma\nThird document")

      const status = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()
          return yield* svc.indexStatus()
        }).pipe(Effect.provide(shared.layer)),
      )

      expect(status.totalFiles).toBe(3)
      expect(status.indexed).toBe(3)
      expect(status.stale).toBe(0)
      expect(status.embedded).toBe(0) // no embeddings computed
      expect(status.sources).toBe(1)
      expect(status.links).toBeGreaterThanOrEqual(1) // at least [[alpha]]
    })

    it("reports stale count for files added after last index", async () => {
      writeMd(tempDir, "indexed.md", "# Indexed\nAlready indexed")

      const status = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          // Add two new files AFTER indexing
          writeMd(tempDir, "stale-one.md", "# Stale One\nNot yet indexed")
          writeMd(tempDir, "stale-two.md", "# Stale Two\nAlso not indexed")

          return yield* svc.indexStatus()
        }).pipe(Effect.provide(shared.layer)),
      )

      expect(status.totalFiles).toBe(3) // 3 files on disk
      expect(status.indexed).toBe(1) // only the first one in DB
      expect(status.stale).toBe(2) // 2 files not in DB
    })

    it("reports zero everything when no sources registered", async () => {
      const status = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          return yield* svc.indexStatus()
        }).pipe(Effect.provide(shared.layer)),
      )

      expect(status.totalFiles).toBe(0)
      expect(status.indexed).toBe(0)
      expect(status.stale).toBe(0)
      expect(status.embedded).toBe(0)
      expect(status.sources).toBe(0)
      expect(status.links).toBe(0)
    })
  })

  // ===========================================================================
  // 6. updateFrontmatter with addRelated — file content round-trip
  // ===========================================================================
  describe("updateFrontmatter with addRelated", () => {
    it("adds related references to frontmatter and verifies file round-trip", async () => {
      writeMd(
        tempDir,
        "main-doc.md",
        "---\ntags: [architecture]\n---\n# Main Doc\nCore architecture document",
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!

          // Add two related references
          const updated = yield* svc.updateFrontmatter(doc.id, {
            addRelated: ["design-decisions", "api-guide"],
          })

          // Get links to verify
          const links = yield* svc.getLinks(doc.id)
          return { updated, links }
        }).pipe(Effect.provide(shared.layer)),
      )

      // Verify the returned document still has its tags
      expect(result.updated.tags).toContain("architecture")

      // Verify links include frontmatter type links
      const fmLinks = result.links.filter((l) => l.linkType === "frontmatter")
      expect(fmLinks).toHaveLength(2)
      const refs = fmLinks.map((l) => l.targetRef).sort()
      expect(refs).toEqual(["api-guide", "design-decisions"])

      // Verify the file on disk has the related field in frontmatter
      const fileContent = readFileSync(
        join(tempDir, "main-doc.md"),
        "utf-8",
      )
      expect(fileContent).toContain("related:")
      expect(fileContent).toContain("design-decisions")
      expect(fileContent).toContain("api-guide")
      // Original tags should still be present
      expect(fileContent).toContain("architecture")
    })

    it("addRelated is idempotent — does not duplicate existing references", async () => {
      writeMd(
        tempDir,
        "idempotent.md",
        "---\ntags: [test]\nrelated: [existing-ref]\n---\n# Idempotent Test\nContent",
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!

          // Add existing-ref again plus a new one
          yield* svc.updateFrontmatter(doc.id, {
            addRelated: ["existing-ref", "new-ref"],
          })

          const links = yield* svc.getLinks(doc.id)
          return links
        }).pipe(Effect.provide(shared.layer)),
      )

      // Should have exactly 2 frontmatter links, not 3
      const fmLinks = result.filter((l) => l.linkType === "frontmatter")
      expect(fmLinks).toHaveLength(2)
      const refs = fmLinks.map((l) => l.targetRef).sort()
      expect(refs).toEqual(["existing-ref", "new-ref"])
    })
  })

  // ===========================================================================
  // 7. setProperty / removeProperty lifecycle
  // ===========================================================================
  describe("setProperty and removeProperty lifecycle", () => {
    it("sets a property, verifies it, removes it, and confirms removal", async () => {
      writeMd(
        tempDir,
        "lifecycle.md",
        "---\ntags: [test]\n---\n# Lifecycle\nProperty lifecycle test",
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!

          // Step 1: Set a property
          yield* svc.setProperty(doc.id, "status", "active")
          const propsAfterSet = yield* svc.getProperties(doc.id)

          // Step 2: Verify file has property
          const fileAfterSet = readFileSync(
            join(tempDir, "lifecycle.md"),
            "utf-8",
          )

          // Step 3: Remove the property
          yield* svc.removeProperty(doc.id, "status")
          const propsAfterRemove = yield* svc.getProperties(doc.id)

          // Step 4: Verify file no longer has property
          const fileAfterRemove = readFileSync(
            join(tempDir, "lifecycle.md"),
            "utf-8",
          )

          return {
            propsAfterSet,
            fileAfterSet,
            propsAfterRemove,
            fileAfterRemove,
          }
        }).pipe(Effect.provide(shared.layer)),
      )

      // After set: property exists in DB and file
      const statusProp = result.propsAfterSet.find((p) => p.key === "status")
      expect(statusProp).toBeDefined()
      expect(statusProp!.value).toBe("active")
      expect(result.fileAfterSet).toContain("status: active")

      // After remove: property gone from DB and file
      const removedProp = result.propsAfterRemove.find(
        (p) => p.key === "status",
      )
      expect(removedProp).toBeUndefined()
      expect(result.fileAfterRemove).not.toContain("status:")
    })

    it("sets multiple properties and removes one, leaving others intact", async () => {
      writeMd(
        tempDir,
        "multi-props.md",
        "---\ntags: [test]\n---\n# Multi Props\nMultiple property test",
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!

          // Set three properties
          yield* svc.setProperty(doc.id, "category", "architecture")
          yield* svc.setProperty(doc.id, "reviewer", "alice")
          yield* svc.setProperty(doc.id, "priority", "medium")

          const propsAll = yield* svc.getProperties(doc.id)

          // Remove one
          yield* svc.removeProperty(doc.id, "reviewer")
          const propsAfter = yield* svc.getProperties(doc.id)

          return { propsAll, propsAfter }
        }).pipe(Effect.provide(shared.layer)),
      )

      // All three initially
      expect(result.propsAll).toHaveLength(3)
      const allKeys = result.propsAll.map((p) => p.key).sort()
      expect(allKeys).toEqual(["category", "priority", "reviewer"])

      // After removal: only two remain
      expect(result.propsAfter).toHaveLength(2)
      const remainingKeys = result.propsAfter.map((p) => p.key).sort()
      expect(remainingKeys).toEqual(["category", "priority"])

      // File should reflect the remaining properties
      const fileContent = readFileSync(
        join(tempDir, "multi-props.md"),
        "utf-8",
      )
      expect(fileContent).toContain("category: architecture")
      expect(fileContent).toContain("priority: medium")
      expect(fileContent).not.toContain("reviewer:")
    })

    it("setProperty rejects reserved keys (tags, related, created)", async () => {
      writeMd(
        tempDir,
        "reserved.md",
        "---\ntags: [test]\n---\n# Reserved Key Test\nContent",
      )

      await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!

          // Attempting to set "tags" should fail with ValidationError
          const tagError = yield* svc
            .setProperty(doc.id, "tags", "invalid")
            .pipe(Effect.flip)
          expect(tagError._tag).toBe("ValidationError")

          // Attempting to set "related" should fail with ValidationError
          const relatedError = yield* svc
            .setProperty(doc.id, "related", "invalid")
            .pipe(Effect.flip)
          expect(relatedError._tag).toBe("ValidationError")

          // Attempting to set "created" should fail with ValidationError
          const createdError = yield* svc
            .setProperty(doc.id, "created", "invalid")
            .pipe(Effect.flip)
          expect(createdError._tag).toBe("ValidationError")
        }).pipe(Effect.provide(shared.layer)),
      )
    })
  })

  // ===========================================================================
  // 8. getProperties — retrieve all properties, including empty result
  // ===========================================================================
  describe("getProperties", () => {
    it("returns empty array for document with no custom properties", async () => {
      writeMd(
        tempDir,
        "no-props.md",
        "---\ntags: [test]\n---\n# No Props\nJust content, no custom properties",
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!
          return yield* svc.getProperties(doc.id)
        }).pipe(Effect.provide(shared.layer)),
      )

      // tags is reserved — should not appear as a property
      expect(result).toEqual([])
    })

    it("returns all custom properties from a document with mixed frontmatter", async () => {
      writeMd(
        tempDir,
        "mixed-fm.md",
        [
          "---",
          "tags: [architecture, review]",
          "status: draft",
          "author: james",
          "version: v2",
          "created: 2026-01-15T00:00:00Z",
          "---",
          "# Mixed Frontmatter",
          "Document with reserved and custom keys in frontmatter",
        ].join("\n"),
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!
          return yield* svc.getProperties(doc.id)
        }).pipe(Effect.provide(shared.layer)),
      )

      // Only non-reserved keys should appear as properties
      // Reserved: tags, related, created — should NOT be in properties
      const keys = result.map((p) => p.key).sort()
      expect(keys).toEqual(["author", "status", "version"])
      expect(keys).not.toContain("tags")
      expect(keys).not.toContain("created")

      // Verify values
      const propMap = Object.fromEntries(result.map((p) => [p.key, p.value]))
      expect(propMap.status).toBe("draft")
      expect(propMap.author).toBe("james")
      expect(propMap.version).toBe("v2")
    })

    it("getProperties reflects changes after setProperty updates a value", async () => {
      writeMd(
        tempDir,
        "evolving-props.md",
        "---\nstatus: draft\ntags: [test]\n---\n# Evolving Props\nContent",
      )

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)
          yield* svc.index()

          const docs = yield* svc.listDocuments()
          const doc = docs[0]!

          // Initial properties
          const propsBefore = yield* svc.getProperties(doc.id)

          // Update the status property
          yield* svc.setProperty(doc.id, "status", "published")

          // Properties after update
          const propsAfter = yield* svc.getProperties(doc.id)

          return { propsBefore, propsAfter }
        }).pipe(Effect.provide(shared.layer)),
      )

      // Before: status = draft
      const beforeStatus = result.propsBefore.find(
        (p) => p.key === "status",
      )
      expect(beforeStatus?.value).toBe("draft")

      // After: status = published
      const afterStatus = result.propsAfter.find((p) => p.key === "status")
      expect(afterStatus?.value).toBe("published")

      // Count should not change (update, not add)
      expect(result.propsBefore).toHaveLength(1)
      expect(result.propsAfter).toHaveLength(1)
    })
  })

  // ===========================================================================
  // Additional edge case: createDocument with explicit dir
  // ===========================================================================
  describe("createDocument with explicit dir", () => {
    it("creates a document in a specific subdirectory of a registered source", async () => {
      const subDir = join(tempDir, "notes", "daily")
      mkdirSync(subDir, { recursive: true })

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const svc = yield* MemoryService
          yield* svc.addSource(tempDir)

          // Create document in a subdirectory of the registered source
          const doc = yield* svc.createDocument({
            title: "Daily Standup",
            content: "Discussed blockers and priorities.",
            dir: subDir,
          })

          const allDocs = yield* svc.listDocuments()
          return { doc, allDocs }
        }).pipe(Effect.provide(shared.layer)),
      )

      expect(result.doc.title).toBe("Daily Standup")
      expect(result.doc.id).toMatch(/^mem-[a-f0-9]{12}$/)
      // The file should be in the subdirectory
      expect(result.doc.filePath).toBe(
        join("notes", "daily", "daily-standup.md"),
      )
      // rootDir should be the registered source (tempDir), not the subdirectory
      expect(result.doc.rootDir).toBe(tempDir)
      // File should exist on disk in the subdirectory
      const fileContent = readFileSync(
        join(subDir, "daily-standup.md"),
        "utf-8",
      )
      expect(fileContent).toContain("# Daily Standup")
      expect(fileContent).toContain("Discussed blockers and priorities.")
      // Should be indexed and findable
      expect(result.allDocs).toHaveLength(1)
    })

    it("rejects explicit dir outside any registered source", async () => {
      const outsideDir = createTempDir()
      try {
        await expect(
          Effect.runPromise(
            Effect.gen(function* () {
              const svc = yield* MemoryService
              yield* svc.addSource(tempDir)
              // outsideDir is NOT within tempDir
              yield* svc.createDocument({
                title: "Outside Doc",
                content: "Should fail.",
                dir: outsideDir,
              })
            }).pipe(Effect.provide(shared.layer)),
          ),
        ).rejects.toThrow("not within any registered memory source")
      } finally {
        try {
          rmSync(outsideDir, { recursive: true })
        } catch {
          /* ignore */
        }
      }
    })
  })
})
