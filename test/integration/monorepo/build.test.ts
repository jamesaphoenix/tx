/**
 * Build Verification Tests
 *
 * Verifies that the monorepo build process works correctly:
 * - All packages compile successfully
 * - Build outputs exist at expected paths
 * - No circular dependencies between packages
 * - Type definitions are generated correctly
 *
 * Note: These tests assume the build has been run before testing.
 * In CI, this should be: npm run build && npm test
 */

import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const ROOT = process.cwd()

// Package paths
const PACKAGES = {
  types: resolve(ROOT, "packages/types"),
  core: resolve(ROOT, "packages/core"),
}

const APPS = {
  cli: resolve(ROOT, "apps/cli"),
  mcpServer: resolve(ROOT, "apps/mcp-server"),
  apiServer: resolve(ROOT, "apps/api-server"),
  agentSdk: resolve(ROOT, "apps/agent-sdk"),
  dashboard: resolve(ROOT, "apps/dashboard"),
}

describe("Build Outputs: @tx/types", () => {
  const distPath = resolve(PACKAGES.types, "dist")

  it("has dist directory", () => {
    expect(existsSync(distPath)).toBe(true)
  })

  it("has index.js entry point", () => {
    expect(existsSync(resolve(distPath, "index.js"))).toBe(true)
  })

  it("has index.d.ts type definitions", () => {
    expect(existsSync(resolve(distPath, "index.d.ts"))).toBe(true)
  })

  it("exports are valid ES modules", () => {
    const indexPath = resolve(distPath, "index.js")
    const content = readFileSync(indexPath, "utf-8")
    expect(content).toContain("export")
  })

  it("has subpath exports built", () => {
    // Check that subpath exports from package.json exist
    expect(existsSync(resolve(distPath, "task.js"))).toBe(true)
    expect(existsSync(resolve(distPath, "task.d.ts"))).toBe(true)
    expect(existsSync(resolve(distPath, "learning.js"))).toBe(true)
    expect(existsSync(resolve(distPath, "learning.d.ts"))).toBe(true)
  })
})

describe("Build Outputs: @tx/core", () => {
  const distPath = resolve(PACKAGES.core, "dist")

  it("has dist directory", () => {
    expect(existsSync(distPath)).toBe(true)
  })

  it("has index.js entry point", () => {
    expect(existsSync(resolve(distPath, "index.js"))).toBe(true)
  })

  it("has index.d.ts type definitions", () => {
    expect(existsSync(resolve(distPath, "index.d.ts"))).toBe(true)
  })

  it("has layer.js for Effect layer composition", () => {
    expect(existsSync(resolve(distPath, "layer.js"))).toBe(true)
    expect(existsSync(resolve(distPath, "layer.d.ts"))).toBe(true)
  })

  it("has services directory built", () => {
    const servicesPath = resolve(distPath, "services")
    expect(existsSync(servicesPath)).toBe(true)
    expect(existsSync(resolve(servicesPath, "index.js"))).toBe(true)
  })

  it("has repo directory built", () => {
    const repoPath = resolve(distPath, "repo")
    expect(existsSync(repoPath)).toBe(true)
    expect(existsSync(resolve(repoPath, "index.js"))).toBe(true)
  })

  it("has schemas directory built", () => {
    const schemasPath = resolve(distPath, "schemas")
    expect(existsSync(schemasPath)).toBe(true)
    expect(existsSync(resolve(schemasPath, "index.js"))).toBe(true)
  })

  it("has mappers directory built", () => {
    const mappersPath = resolve(distPath, "mappers")
    expect(existsSync(mappersPath)).toBe(true)
    expect(existsSync(resolve(mappersPath, "task.js"))).toBe(true)
  })
})

describe("Build Outputs: @tx/cli", () => {
  const distPath = resolve(APPS.cli, "dist")

  it("has dist directory", () => {
    expect(existsSync(distPath)).toBe(true)
  })

  it("has cli.js entry point", () => {
    expect(existsSync(resolve(distPath, "cli.js"))).toBe(true)
  })

  it("cli.js has shebang for executable", () => {
    const content = readFileSync(resolve(distPath, "cli.js"), "utf-8")
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true)
  })

  it("has commands directory built", () => {
    const commandsPath = resolve(distPath, "commands")
    expect(existsSync(commandsPath)).toBe(true)
    expect(existsSync(resolve(commandsPath, "task.js"))).toBe(true)
    expect(existsSync(resolve(commandsPath, "dep.js"))).toBe(true)
    expect(existsSync(resolve(commandsPath, "sync.js"))).toBe(true)
  })

  it("imports @tx/core in built output", () => {
    const content = readFileSync(resolve(distPath, "cli.js"), "utf-8")
    expect(content).toContain("@jamesaphoenix/tx-core")
  })
})

describe("Build Outputs: @tx/mcp-server", () => {
  const distPath = resolve(APPS.mcpServer, "dist")

  it("has dist directory", () => {
    expect(existsSync(distPath)).toBe(true)
  })

  it("has server.js entry point", () => {
    expect(existsSync(resolve(distPath, "server.js"))).toBe(true)
  })

  it("server.js has shebang for executable", () => {
    const content = readFileSync(resolve(distPath, "server.js"), "utf-8")
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true)
  })

  it("has runtime.js for Effect runtime management", () => {
    expect(existsSync(resolve(distPath, "runtime.js"))).toBe(true)
    expect(existsSync(resolve(distPath, "runtime.d.ts"))).toBe(true)
  })

  it("has response.js for MCP response helpers", () => {
    expect(existsSync(resolve(distPath, "response.js"))).toBe(true)
  })

  it("has tools directory built", () => {
    const toolsPath = resolve(distPath, "tools")
    expect(existsSync(toolsPath)).toBe(true)
    expect(existsSync(resolve(toolsPath, "task.js"))).toBe(true)
    expect(existsSync(resolve(toolsPath, "learning.js"))).toBe(true)
    expect(existsSync(resolve(toolsPath, "sync.js"))).toBe(true)
  })
})

describe("Build Outputs: @tx/api-server", () => {
  const distPath = resolve(APPS.apiServer, "dist")

  it("has dist directory", () => {
    expect(existsSync(distPath)).toBe(true)
  })

  it("has server.js entry point", () => {
    expect(existsSync(resolve(distPath, "server.js"))).toBe(true)
  })

  it("server.js has shebang for executable", () => {
    const content = readFileSync(resolve(distPath, "server.js"), "utf-8")
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true)
  })

  it("has runtime.js for Effect runtime management", () => {
    expect(existsSync(resolve(distPath, "runtime.js"))).toBe(true)
  })

  it("has routes directory built", () => {
    const routesPath = resolve(distPath, "routes")
    expect(existsSync(routesPath)).toBe(true)
    expect(existsSync(resolve(routesPath, "tasks.js"))).toBe(true)
    expect(existsSync(resolve(routesPath, "runs.js"))).toBe(true)
    expect(existsSync(resolve(routesPath, "learnings.js"))).toBe(true)
    expect(existsSync(resolve(routesPath, "health.js"))).toBe(true)
    expect(existsSync(resolve(routesPath, "sync.js"))).toBe(true)
  })

  it("has middleware directory built", () => {
    const middlewarePath = resolve(distPath, "middleware")
    expect(existsSync(middlewarePath)).toBe(true)
    expect(existsSync(resolve(middlewarePath, "auth.js"))).toBe(true)
    expect(existsSync(resolve(middlewarePath, "cors.js"))).toBe(true)
    expect(existsSync(resolve(middlewarePath, "body-limit.js"))).toBe(true)
  })
})

describe("Build Outputs: @tx/agent-sdk", () => {
  const distPath = resolve(APPS.agentSdk, "dist")

  it("has dist directory", () => {
    expect(existsSync(distPath)).toBe(true)
  })

  it("has index.js entry point", () => {
    expect(existsSync(resolve(distPath, "index.js"))).toBe(true)
  })

  it("has index.d.ts type definitions", () => {
    expect(existsSync(resolve(distPath, "index.d.ts"))).toBe(true)
  })

  it("has client.js for TxClient", () => {
    expect(existsSync(resolve(distPath, "client.js"))).toBe(true)
    expect(existsSync(resolve(distPath, "client.d.ts"))).toBe(true)
  })

  it("has types.js for type definitions", () => {
    expect(existsSync(resolve(distPath, "types.js"))).toBe(true)
    expect(existsSync(resolve(distPath, "types.d.ts"))).toBe(true)
  })

  it("has utils.js for utility functions", () => {
    expect(existsSync(resolve(distPath, "utils.js"))).toBe(true)
    expect(existsSync(resolve(distPath, "utils.d.ts"))).toBe(true)
  })
})

describe("Package.json Configuration", () => {
  function readPackageJson(pkgPath: string) {
    return JSON.parse(readFileSync(resolve(pkgPath, "package.json"), "utf-8"))
  }

  it("all packages use ES modules", () => {
    for (const [_name, path] of Object.entries({ ...PACKAGES, ...APPS })) {
      const pkg = readPackageJson(path)
      expect(pkg.type).toBe("module")
    }
  })

  it("all packages have build script", () => {
    for (const [_name, path] of Object.entries({ ...PACKAGES, ...APPS })) {
      const pkg = readPackageJson(path)
      expect(pkg.scripts?.build).toBeDefined()
    }
  })

  it("@tx/core depends on @tx/types", () => {
    const pkg = readPackageJson(PACKAGES.core)
    // Published packages use semver, workspace packages use "*"
    expect(pkg.dependencies["@jamesaphoenix/tx-types"]).toMatch(/^(\*|\^[\d.]+)$/)
  })

  it("apps depend on @tx/core (except agent-sdk)", () => {
    const cliPkg = readPackageJson(APPS.cli)
    expect(cliPkg.dependencies["@jamesaphoenix/tx-core"]).toMatch(/^(\*|\^[\d.]+)$/)

    const mcpPkg = readPackageJson(APPS.mcpServer)
    expect(mcpPkg.dependencies["@jamesaphoenix/tx-core"]).toMatch(/^(\*|\^[\d.]+)$/)

    const apiPkg = readPackageJson(APPS.apiServer)
    expect(apiPkg.dependencies["@jamesaphoenix/tx-core"]).toMatch(/^(\*|\^[\d.]+)$/)

    // agent-sdk has @tx/core as optional
    const sdkPkg = readPackageJson(APPS.agentSdk)
    expect(sdkPkg.optionalDependencies?.["@jamesaphoenix/tx-core"]).toMatch(/^(\*|\^[\d.]+)$/)
  })

  it("packages use workspace protocol or semver for internal deps", () => {
    const corePkg = readPackageJson(PACKAGES.core)
    expect(corePkg.dependencies["@jamesaphoenix/tx-types"]).toMatch(/^(\*|\^[\d.]+)$/)

    const cliPkg = readPackageJson(APPS.cli)
    expect(cliPkg.dependencies["@jamesaphoenix/tx-types"]).toMatch(/^(\*|\^[\d.]+)$/)
    expect(cliPkg.dependencies["@jamesaphoenix/tx-core"]).toMatch(/^(\*|\^[\d.]+)$/)
  })

  it("executable packages have bin field", () => {
    const cliPkg = readPackageJson(APPS.cli)
    expect(cliPkg.bin).toBeDefined()
    expect(cliPkg.bin.tx).toBe("./dist/cli.js")

    const mcpPkg = readPackageJson(APPS.mcpServer)
    expect(mcpPkg.bin).toBeDefined()
    expect(mcpPkg.bin["tx-mcp"]).toBe("./dist/server.js")

    const apiPkg = readPackageJson(APPS.apiServer)
    expect(apiPkg.bin).toBeDefined()
    expect(apiPkg.bin["tx-api"]).toBe("./dist/server.js")
  })
})

describe("TypeScript Configuration", () => {
  function readTsConfig(pkgPath: string) {
    return JSON.parse(readFileSync(resolve(pkgPath, "tsconfig.json"), "utf-8"))
  }

  // Exclude dashboard (uses noEmit for Vite/React bundling)
  const COMPILED_PACKAGES = { ...PACKAGES, cli: APPS.cli, mcpServer: APPS.mcpServer, apiServer: APPS.apiServer, agentSdk: APPS.agentSdk }

  it("all packages have tsconfig.json", () => {
    for (const [_name, path] of Object.entries({ ...PACKAGES, ...APPS })) {
      expect(existsSync(resolve(path, "tsconfig.json"))).toBe(true)
    }
  })

  it("compiled packages output to dist directory", () => {
    for (const [_name, path] of Object.entries(COMPILED_PACKAGES)) {
      const tsconfig = readTsConfig(path)
      expect(tsconfig.compilerOptions?.outDir).toBe("./dist")
    }
  })

  it("compiled packages generate declaration files", () => {
    // Verify the main .d.ts entry point exists in each package
    const entryPoints: Record<string, string> = {
      types: "index.d.ts",
      core: "index.d.ts",
      cli: "cli.d.ts",
      mcpServer: "server.d.ts",
      apiServer: "server.d.ts",
      agentSdk: "index.d.ts"
    }
    for (const [name, path] of Object.entries(COMPILED_PACKAGES)) {
      const distPath = resolve(path, "dist")
      const entryPoint = entryPoints[name] ?? "index.d.ts"
      expect(existsSync(resolve(distPath, entryPoint))).toBe(true)
    }
  })
})

describe("No Circular Dependencies", () => {
  // Helper to filter internal tx dependencies (both @tx/* and @jamesaphoenix/tx-*)
  const filterTxDeps = (deps: Record<string, string>) =>
    Object.keys(deps).filter((d) => d.startsWith("@tx/") || d.startsWith("@jamesaphoenix/tx-"))

  // Check that there are no circular imports by verifying the dependency graph
  it("@tx/types has no dependencies on other @tx/* packages", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(PACKAGES.types, "package.json"), "utf-8")
    )

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    }

    const txDeps = filterTxDeps(allDeps)
    expect(txDeps).toHaveLength(0)
  })

  it("@tx/core only depends on @tx/types", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(PACKAGES.core, "package.json"), "utf-8")
    )

    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    }

    const txDeps = filterTxDeps(allDeps)
    expect(txDeps).toEqual(["@jamesaphoenix/tx-types"])
  })

  it("apps do not depend on each other", () => {
    for (const [_name, path] of Object.entries(APPS)) {
      const pkg = JSON.parse(readFileSync(resolve(path, "package.json"), "utf-8"))

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.optionalDependencies,
        ...pkg.peerDependencies,
      }

      const txDeps = filterTxDeps(allDeps)

      // Apps should only depend on packages, not other apps
      for (const dep of txDeps) {
        expect(dep).toMatch(/^(@tx\/(types|core|test-utils)|@jamesaphoenix\/tx-(types|core|test-utils))$/)
      }
    }
  })
})

describe("Turbo Configuration", () => {
  it("turbo.json exists at root", () => {
    expect(existsSync(resolve(ROOT, "turbo.json"))).toBe(true)
  })

  it("turbo.json has build pipeline", () => {
    const turbo = JSON.parse(readFileSync(resolve(ROOT, "turbo.json"), "utf-8"))

    expect(turbo.tasks?.build).toBeDefined()
    expect(turbo.tasks.build.dependsOn).toContain("^build")
    expect(turbo.tasks.build.outputs).toContain("dist/**")
  })

  it("turbo.json has test pipeline", () => {
    const turbo = JSON.parse(readFileSync(resolve(ROOT, "turbo.json"), "utf-8"))

    expect(turbo.tasks?.test).toBeDefined()
    expect(turbo.tasks.test.dependsOn).toContain("build")
  })

  it("turbo.json has typecheck pipeline", () => {
    const turbo = JSON.parse(readFileSync(resolve(ROOT, "turbo.json"), "utf-8"))

    expect(turbo.tasks?.typecheck).toBeDefined()
    expect(turbo.tasks.typecheck.dependsOn).toContain("^build")
  })
})
