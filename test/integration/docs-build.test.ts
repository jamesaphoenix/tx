import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { execSync } from "child_process"

const DOCS_DIR = join(process.cwd(), "apps/docs")
const NEXT_DIR = join(DOCS_DIR, ".next")

describe("Docs Site Build", { timeout: 180_000 }, () => {
  const hasExpectedBuildArtifacts = (): boolean =>
    existsSync(join(NEXT_DIR, "build-manifest.json")) &&
    existsSync(join(NEXT_DIR, "prerender-manifest.json"))

  beforeAll(() => {
    // Ensure the docs site has been built. A prior interrupted Next build can
    // leave a partial .next directory; rebuild when expected manifests are missing.
    if (!existsSync(NEXT_DIR) || !hasExpectedBuildArtifacts()) {
      if (existsSync(NEXT_DIR)) {
        rmSync(NEXT_DIR, { recursive: true, force: true })
      }
      execSync("bun run build", { cwd: DOCS_DIR, stdio: "inherit" })
    }
  }, 180_000)

  describe("Build output exists", () => {
    it("has .next directory", () => {
      expect(existsSync(NEXT_DIR)).toBe(true)
    })

    it("has build-manifest.json", () => {
      expect(existsSync(join(NEXT_DIR, "build-manifest.json"))).toBe(true)
    })

    it("has prerender-manifest.json", () => {
      expect(existsSync(join(NEXT_DIR, "prerender-manifest.json"))).toBe(true)
    })

    it("has server directory", () => {
      expect(existsSync(join(NEXT_DIR, "server"))).toBe(true)
    })

    it("has static directory", () => {
      expect(existsSync(join(NEXT_DIR, "static"))).toBe(true)
    })
  })

  describe("Prerendered routes", () => {
    let prerenderManifest: { routes: Record<string, object> }

    beforeAll(() => {
      const manifestPath = join(NEXT_DIR, "prerender-manifest.json")
      prerenderManifest = JSON.parse(readFileSync(manifestPath, "utf-8"))
    })

    it("includes docs index page", () => {
      expect(prerenderManifest.routes).toHaveProperty("/docs")
    })

    it("includes getting started page", () => {
      expect(prerenderManifest.routes).toHaveProperty("/docs/getting-started")
    })

    it("includes primitives docs", () => {
      const routes = Object.keys(prerenderManifest.routes)
      const primitiveDocs = routes.filter(r => r.startsWith("/docs/primitives"))
      expect(primitiveDocs.length).toBeGreaterThan(5)
    })

    it("includes every retained workflow page and excludes retired pages", () => {
      for (const page of ["tasks", "docs", "plans", "invariants", "spec-trace", "spec-health", "label", "sync", "skills"]) {
        expect(prerenderManifest.routes).toHaveProperty(`/docs/primitives/${page}`)
      }
      for (const page of ["claim", "memory", "decision", "ralph-loop", "watchdog", "decompose"]) {
        expect(prerenderManifest.routes).not.toHaveProperty(`/docs/primitives/${page}`)
      }
      expect(prerenderManifest.routes).toHaveProperty("/docs/interfaces")
      expect(prerenderManifest.routes).toHaveProperty("/docs/migration")
    })
  })

  describe("Content files exist", () => {
    const contentDir = join(DOCS_DIR, "content/docs")

    it("has index.mdx", () => {
      expect(existsSync(join(contentDir, "index.mdx"))).toBe(true)
    })

    it("has getting-started.mdx", () => {
      expect(existsSync(join(contentDir, "getting-started.mdx"))).toBe(true)
    })

    it("has meta.json for navigation", () => {
      expect(existsSync(join(contentDir, "meta.json"))).toBe(true)
    })

    it("has primitives directory", () => {
      expect(existsSync(join(contentDir, "primitives"))).toBe(true)
    })
  })

  it("keeps every workflow page in the same concise guide format", () => {
    const directory = join(DOCS_DIR, "content/docs/primitives")
    for (const page of ["tasks", "docs", "plans", "invariants", "spec-trace", "spec-health", "label", "sync", "skills"]) {
      const guide = readFileSync(join(directory, `${page}.mdx`), "utf8")
      expect(guide).toContain("## Purpose")
      expect(guide).toContain("## Commands")
      expect(guide).toContain("## Workflow")
      expect(guide).toMatch(/title: tx (task|doc|spec|sync|skills)/)
    }
  })
})
