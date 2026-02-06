import { describe, it, expect, beforeAll } from "vitest"
import { readFileSync, existsSync } from "fs"
import { join } from "path"
import { execSync } from "child_process"

const DOCS_DIR = join(process.cwd(), "apps/docs")
const NEXT_DIR = join(DOCS_DIR, ".next")

describe("Docs Site Build", () => {
  beforeAll(() => {
    // Ensure the docs site has been built
    if (!existsSync(NEXT_DIR)) {
      // Build the docs site if not already built
      execSync("bun run build", { cwd: DOCS_DIR, stdio: "inherit" })
    }
  })

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

    it("includes design docs", () => {
      const routes = Object.keys(prerenderManifest.routes)
      const designDocs = routes.filter(r => r.startsWith("/docs/design/"))
      expect(designDocs.length).toBeGreaterThan(10)
    })

    it("includes PRD docs", () => {
      const routes = Object.keys(prerenderManifest.routes)
      const prdDocs = routes.filter(r => r.startsWith("/docs/prd/"))
      expect(prdDocs.length).toBeGreaterThan(10)
    })

    it("includes primitives docs", () => {
      const routes = Object.keys(prerenderManifest.routes)
      const primitiveDocs = routes.filter(r => r.startsWith("/docs/primitives"))
      expect(primitiveDocs.length).toBeGreaterThan(5)
    })

    it("includes key primitives", () => {
      expect(prerenderManifest.routes).toHaveProperty("/docs/primitives/ready")
      expect(prerenderManifest.routes).toHaveProperty("/docs/primitives/done")
      expect(prerenderManifest.routes).toHaveProperty("/docs/primitives/block")
      expect(prerenderManifest.routes).toHaveProperty("/docs/primitives/claim")
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

    it("has design directory", () => {
      expect(existsSync(join(contentDir, "design"))).toBe(true)
    })

    it("has prd directory", () => {
      expect(existsSync(join(contentDir, "prd"))).toBe(true)
    })

    it("has primitives directory", () => {
      expect(existsSync(join(contentDir, "primitives"))).toBe(true)
    })
  })

  describe("Route count", () => {
    it("has generated at least 40 static pages", () => {
      const manifestPath = join(NEXT_DIR, "prerender-manifest.json")
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"))
      const routeCount = Object.keys(manifest.routes).length
      expect(routeCount).toBeGreaterThanOrEqual(40)
    })
  })
})
