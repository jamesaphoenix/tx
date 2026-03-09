/**
 * @fileoverview Integration tests for primitive documentation coverage rules.
 *
 * These tests run against REAL project files — no mocks.
 * They verify that:
 * 1. Every .mdx primitive has a registry entry
 * 2. Every registry implementation file exists on disk
 * 3. Every MDX file has all 4 interface tabs with code blocks
 * 4. No MDX file contains banned patterns or imports
 * 5. MCP tool names in docs match actual registered tools
 * 6. llms.txt links every documented primitive page
 * 7. Port numbers are consistent (no localhost:3001)
 */

import { describe, it, expect } from "vitest"
import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, "../..")
const docsDir = path.join(projectRoot, "apps/docs/content/docs/primitives")
const registryPath = path.join(projectRoot, "primitives-registry.json")
const mcpToolsDir = path.join(projectRoot, "apps/mcp-server/src/tools")
const llmsPath = path.join(projectRoot, "apps/docs/public/llms.txt")

// Load real project data
const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"))
const { $comment: _comment, ...primitives } = registry

const mdxFiles = fs.readdirSync(docsDir)
  .filter((f) => f.endsWith(".mdx") && f !== "index.mdx")
const mdxNames = mdxFiles.map((f) => f.replace(/\.mdx$/, ""))
const llmsContent = fs.readFileSync(llmsPath, "utf-8")

// Banned patterns matching eslint.config.js
const BANNED_PATTERNS = [
  "planned for future release",
  "planned for a future release",
  "not yet implemented",
  "not yet available",
  "coming soon",
  "not yet exposed",
  "currently CLI-only",
  "currently available via CLI only",
  "localhost:3001",
]

const BANNED_IMPORTS = ["@jamesaphoenix/tx-core"]
const BANNED_FUNCTIONS = ["createTx"]
const REQUIRED_TABS = ["CLI", "TypeScript SDK", "MCP", "REST API"]

// Tab extraction regex (same as the rule)
const TAB_REGEX = /<Tab\s+value="([^"]+)">([\s\S]*?)<\/Tab>/g
const CODE_BLOCK_REGEX = /```[\s\S]*?```/

function extractTabs(content) {
  const tabs = new Map()
  let match
  const regex = new RegExp(TAB_REGEX.source, "g")
  while ((match = regex.exec(content)) !== null) {
    const tabValue = match[1]
    const tabContent = match[2]
    if (!tabs.has(tabValue)) tabs.set(tabValue, [])
    tabs.get(tabValue).push(tabContent)
  }
  return tabs
}

function isPlanned(content) {
  return />\s*\*?\*?Status\*?\*?:\s*Planned/i.test(content)
}

// =============================================================================
// Registry ↔ Docs Sync
// =============================================================================

describe("primitives-registry.json ↔ docs sync", () => {
  it("every .mdx file has a registry entry", () => {
    const missing = mdxNames.filter((name) => !primitives[name])
    expect(missing, `MDX files without registry entries: ${missing.join(", ")}`).toHaveLength(0)
  })

  it("every registry entry has a corresponding .mdx file", () => {
    const registryNames = Object.keys(primitives)
    const missing = registryNames.filter((name) => !mdxNames.includes(name))
    expect(missing, `Registry entries without MDX files: ${missing.join(", ")}`).toHaveLength(0)
  })
})

// =============================================================================
// Implementation Files Exist
// =============================================================================

describe("implementation files exist on disk", () => {
  for (const [primName, config] of Object.entries(primitives)) {
    if (config.planned) {
      it(`${primName}: planned primitive — skipped`, () => {
        expect(config.planned).toBe(true)
      })
      continue
    }

    for (const iface of config.required || []) {
      const paths = Array.isArray(config[iface]) ? config[iface] : [config[iface]]

      it(`${primName}: ${iface} implementation exists (${paths.join(" | ")})`, () => {
        const anyExists = paths.some((p) => {
          const fullPath = path.resolve(projectRoot, p)
          return fs.existsSync(fullPath)
        })
        expect(anyExists, `Missing ${iface} file for ${primName}: ${paths.join(", ")}`).toBe(true)
      })
    }
  }
})

// =============================================================================
// MDX Doc Quality (Real Files)
// =============================================================================

describe("primitive docs quality (real files)", () => {
  for (const mdxFile of mdxFiles) {
    const primName = mdxFile.replace(/\.mdx$/, "")
    const fullPath = path.join(docsDir, mdxFile)
    const content = fs.readFileSync(fullPath, "utf-8")

    if (isPlanned(content)) {
      it(`${primName}: planned — skipped`, () => {
        expect(isPlanned(content)).toBe(true)
      })
      continue
    }

    describe(primName, () => {
      const tabs = extractTabs(content)
      const registryEntry = primitives[primName]
      const requiredInterfaces = registryEntry?.required ?? []
      // Map registry interface names to tab names
      const TAB_NAME_MAP = { cli: "CLI", mcp: "MCP", api: "REST API", sdk: "TypeScript SDK" }
      // If all 4 interfaces required, check all 4 tabs. Otherwise, only check tabs for required interfaces.
      const requiredTabsForPrim = requiredInterfaces.length === 4
        ? REQUIRED_TABS
        : requiredInterfaces.map((r) => TAB_NAME_MAP[r]).filter(Boolean)

      if (requiredTabsForPrim.length < 4 && tabs.size === 0) {
        // CLI-only primitives may use plain code blocks instead of tabs
        it("has code block", () => {
          expect(
            CODE_BLOCK_REGEX.test(content),
            `No code block in ${primName}.mdx`
          ).toBe(true)
        })
      } else {
        // Check required tabs present
        for (const tabName of requiredTabsForPrim) {
          it(`has "${tabName}" tab`, () => {
            expect(tabs.has(tabName), `Missing "${tabName}" tab in ${primName}.mdx`).toBe(true)
          })
        }

        // Check each present tab has a code block
        for (const tabName of requiredTabsForPrim) {
          it(`"${tabName}" tab has code block`, () => {
            if (!tabs.has(tabName)) return // covered by previous test
            const combined = tabs.get(tabName).join("\n")
            expect(
              CODE_BLOCK_REGEX.test(combined),
              `No code block in "${tabName}" tab of ${primName}.mdx`
            ).toBe(true)
          })
        }
      }

      // Check no banned patterns in any tab
      it("contains no banned placeholder text", () => {
        const violations = []
        for (const [tabName, tabContents] of tabs) {
          const combined = tabContents.join("\n")
          for (const pattern of BANNED_PATTERNS) {
            if (combined.toLowerCase().includes(pattern.toLowerCase())) {
              violations.push(`${tabName}: "${pattern}"`)
            }
          }
        }
        expect(violations, `Banned text found in ${primName}.mdx:\n${violations.join("\n")}`).toHaveLength(0)
      })

      // Check no banned imports in TypeScript SDK tab
      it("TypeScript SDK tab has no banned imports", () => {
        if (!tabs.has("TypeScript SDK")) return
        const combined = tabs.get("TypeScript SDK").join("\n")
        const violations = []
        for (const imp of BANNED_IMPORTS) {
          const regex = new RegExp(`from\\s+['"]${imp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i")
          if (regex.test(combined)) {
            violations.push(imp)
          }
        }
        expect(violations, `Banned imports in ${primName}.mdx SDK tab: ${violations.join(", ")}`).toHaveLength(0)
      })

      // Check no banned functions
      it("contains no banned function calls", () => {
        const violations = []
        for (const [tabName, tabContents] of tabs) {
          const combined = tabContents.join("\n")
          for (const fn of BANNED_FUNCTIONS) {
            const regex = new RegExp(`\\b${fn}\\s*\\(`, "i")
            if (regex.test(combined)) {
              violations.push(`${tabName}: ${fn}()`)
            }
          }
        }
        expect(violations, `Banned functions in ${primName}.mdx:\n${violations.join("\n")}`).toHaveLength(0)
      })
    })
  }
})

// =============================================================================
// Port Consistency
// =============================================================================

describe("port consistency across all primitive docs", () => {
  it("no docs use localhost:3001 (should be 3456)", () => {
    const violations = []
    for (const mdxFile of mdxFiles) {
      const fullPath = path.join(docsDir, mdxFile)
      const content = fs.readFileSync(fullPath, "utf-8")
      if (isPlanned(content)) continue

      if (content.includes("localhost:3001")) {
        violations.push(mdxFile)
      }
    }
    expect(violations, `Files with wrong port:\n${violations.join("\n")}`).toHaveLength(0)
  })
})

// =============================================================================
// llms.txt Coverage
// =============================================================================

describe("llms.txt primitive coverage", () => {
  it("includes every documented primitive URL", () => {
    const missing = mdxNames.filter(
      (primitive) => !llmsContent.includes(`https://tx-docs.vercel.app/docs/primitives/${primitive}`)
    )

    expect(
      missing,
      `Primitive pages missing from apps/docs/public/llms.txt:\n${missing.join("\n")}`
    ).toHaveLength(0)
  })
})

// =============================================================================
// MCP Tool Name Validation (Real Files)
// =============================================================================

describe("MCP tool names in docs match registered tools", () => {
  // Collect all registered tool names from MCP server
  const mcpToolFiles = fs.readdirSync(mcpToolsDir).filter((f) => f.endsWith(".ts"))
  const registeredTools = new Set()
  const toolRegistrationPatterns = [
    /server\.tool\(\s*"([^"]+)"/g,
    /registerEffectTool\(\s*server\s*,\s*"([^"]+)"/g,
    /\.registerTool\(\s*"([^"]+)"/g,
  ]

  for (const file of mcpToolFiles) {
    const content = fs.readFileSync(path.join(mcpToolsDir, file), "utf-8")
    for (const pattern of toolRegistrationPatterns) {
      let match
      while ((match = pattern.exec(content)) !== null) {
        registeredTools.add(match[1])
      }
    }
  }

  it("has registered MCP tools to validate against", () => {
    expect(registeredTools.size).toBeGreaterThan(30)
  })

  for (const mdxFile of mdxFiles) {
    const primName = mdxFile.replace(/\.mdx$/, "")
    const fullPath = path.join(docsDir, mdxFile)
    const content = fs.readFileSync(fullPath, "utf-8")
    if (isPlanned(content)) continue

    const tabs = extractTabs(content)
    if (!tabs.has("MCP")) continue

    it(`${primName}: MCP tool names exist in server`, () => {
      const mcpContent = tabs.get("MCP").join("\n")

      // Extract tool names from "Tool name:" patterns and JSON examples
      const toolNamePatterns = [
        /Tool name:\*?\*?\s*`(tx_[a-z_]+)`/gi,
        /"name":\s*"(tx_[a-z_]+)"/gi,
        /"tool":\s*"(tx_[a-z_]+)"/gi,
      ]

      const mentionedTools = new Set()
      for (const pattern of toolNamePatterns) {
        let match
        while ((match = pattern.exec(mcpContent)) !== null) {
          mentionedTools.add(match[1])
        }
      }

      const invalid = [...mentionedTools].filter((t) => !registeredTools.has(t))
      expect(
        invalid,
        `${primName}.mdx references non-existent MCP tools: ${invalid.join(", ")}\nRegistered tools include: ${[...registeredTools].filter(t => t.startsWith("tx_" + primName.slice(0, 4))).join(", ")}`
      ).toHaveLength(0)
    })
  }
})

// =============================================================================
// SDK Method Validation (Real Files)
// =============================================================================

describe("SDK method names in docs match TxClient implementation", () => {
  const sdkClientPath = path.join(projectRoot, "apps/agent-sdk/src/client.ts")
  const sdkSource = fs.readFileSync(sdkClientPath, "utf-8")

  // Extract namespace → method map from the real SDK source
  // Pattern: class FooNamespace { ... async methodName( ... }
  const namespaceMap = new Map()
  const classRegex = /class\s+(\w+)Namespace\s*\{([\s\S]*?)(?=\nclass\s|\n\/\/\s*=|$)/g
  let classMatch
  while ((classMatch = classRegex.exec(sdkSource)) !== null) {
    const className = classMatch[1].toLowerCase()
    const classBody = classMatch[2]
    const methods = new Set()
    const methodRegex = /async\s+(\w+)\s*\(/g
    let methodMatch
    while ((methodMatch = methodRegex.exec(classBody)) !== null) {
      methods.add(methodMatch[1])
    }
    namespaceMap.set(className, methods)
  }

  // Also extract namespace property names from TxClient class
  // Pattern: get tasks() { return this._tasks } or this._tasks = new TasksNamespace(...)
  const propertyMap = new Map()
  const propRegex = /get\s+(\w+)\(\)\s*(?::\s*\w+\s*)?\{[\s\S]*?return\s+this\._(\w+)/g
  let propMatch
  while ((propMatch = propRegex.exec(sdkSource)) !== null) {
    propertyMap.set(propMatch[1], propMatch[1])
  }

  it("has SDK namespaces to validate against", () => {
    expect(namespaceMap.size).toBeGreaterThan(10)
  })

  // Known namespace accessor mappings (SDK property name → namespace class name)
  const NAMESPACE_ALIASES = {
    tasks: "tasks",
    learnings: "learnings",
    fileLearnings: "filelearnings",
    context: "context",
    runs: "runs",
    messages: "messages",
    claims: "claims",
    pins: "pins",
    memory: "memory",
    sync: "sync",
    docs: "docs",
    invariants: "invariants",
    cycles: "cycles",
    guards: "guards",
    verify: "verify",
    reflect: "reflect",
    spec: "spec",
  }

  for (const mdxFile of mdxFiles) {
    const primName = mdxFile.replace(/\.mdx$/, "")
    const fullPath = path.join(docsDir, mdxFile)
    const content = fs.readFileSync(fullPath, "utf-8")
    if (isPlanned(content)) continue

    const tabs = extractTabs(content)
    if (!tabs.has("TypeScript SDK")) continue

    it(`${primName}: SDK method calls reference real TxClient methods`, () => {
      const sdkContent = tabs.get("TypeScript SDK").join("\n")

      // Extract tx.namespace.method( calls from SDK tab
      // Pattern: tx.tasks.ready(, tx.learnings.search(, etc.
      const callRegex = /tx\.(\w+)\.(\w+)\s*\(/g
      const referencedCalls = []
      let callMatch
      while ((callMatch = callRegex.exec(sdkContent)) !== null) {
        referencedCalls.push({ namespace: callMatch[1], method: callMatch[2] })
      }

      // Skip primitives that don't use TxClient (e.g., attempts uses execSync)
      if (referencedCalls.length === 0) return

      const invalid = []
      for (const { namespace, method } of referencedCalls) {
        const nsKey = NAMESPACE_ALIASES[namespace]
        if (!nsKey) {
          invalid.push(`tx.${namespace}.${method}() — unknown namespace '${namespace}'`)
          continue
        }
        const methods = namespaceMap.get(nsKey)
        if (!methods) {
          invalid.push(`tx.${namespace}.${method}() — namespace class not found for '${nsKey}'`)
          continue
        }
        if (!methods.has(method)) {
          invalid.push(`tx.${namespace}.${method}() — method '${method}' not found in ${nsKey}Namespace (available: ${[...methods].join(", ")})`)
        }
      }

      expect(
        invalid,
        `${primName}.mdx SDK tab references non-existent TxClient methods:\n${invalid.join("\n")}`
      ).toHaveLength(0)
    })
  }
})

// =============================================================================
// REST API Route Validation (Real Files)
// =============================================================================

describe("REST API routes in docs match server endpoints", () => {
  const apiFilePath = path.join(projectRoot, "apps/api-server/src/api.ts")
  const apiSource = fs.readFileSync(apiFilePath, "utf-8")

  // Extract all endpoint paths from HttpApiEndpoint definitions
  // Pattern: HttpApiEndpoint.get("name", "/api/path") or .post(...) etc.
  const registeredRoutes = new Set()
  const endpointRegex = /HttpApiEndpoint\.(get|post|patch|put|del|delete)\s*\(\s*"[^"]*"\s*(?:,\s*"[^"]*")?\s*\)/g
  let endpointMatch
  while ((endpointMatch = endpointRegex.exec(apiSource)) !== null) {
    const full = endpointMatch[0]
    // Extract the path - it's the second string argument
    const pathMatch = full.match(/,\s*"([^"]+)"/)
    if (pathMatch) {
      registeredRoutes.add(pathMatch[1])
    }
  }

  // Also extract paths from .prefix patterns
  const prefixRegex = /\.prefix\s*\(\s*"([^"]+)"\s*\)/g
  const prefixes = []
  let prefixMatch
  while ((prefixMatch = prefixRegex.exec(apiSource)) !== null) {
    prefixes.push(prefixMatch[1])
  }

  // Extract raw endpoint paths that start with /
  const rawPathRegex = /(?:get|post|patch|put|del)\s*\(\s*"[^"]*"\s*,\s*"(\/[^"]+)"/g
  let rawMatch
  while ((rawMatch = rawPathRegex.exec(apiSource)) !== null) {
    registeredRoutes.add(rawMatch[1])
  }

  it("has API routes to validate against", () => {
    expect(registeredRoutes.size).toBeGreaterThan(20)
  })

  for (const mdxFile of mdxFiles) {
    const primName = mdxFile.replace(/\.mdx$/, "")
    const fullPath = path.join(docsDir, mdxFile)
    const content = fs.readFileSync(fullPath, "utf-8")
    if (isPlanned(content)) continue

    const tabs = extractTabs(content)
    if (!tabs.has("REST API")) continue

    it(`${primName}: REST API routes use /api/ prefix`, () => {
      const restContent = tabs.get("REST API").join("\n")

      // Extract route patterns: GET /path, POST /path, etc.
      const routeRegex = /(?:GET|POST|PATCH|PUT|DELETE)\s+(\/\S+)/g
      const mentionedRoutes = []
      let routeMatch
      while ((routeMatch = routeRegex.exec(restContent)) !== null) {
        mentionedRoutes.push(routeMatch[1])
      }

      // Also check curl examples
      const curlRouteRegex = /localhost:\d+(\/\S+?)(?:["'\s?]|$)/g
      while ((routeMatch = curlRouteRegex.exec(restContent)) !== null) {
        mentionedRoutes.push(routeMatch[1])
      }

      // All routes should start with /api/
      const missingApiPrefix = mentionedRoutes.filter(
        (r) => !r.startsWith("/api/") && r !== "/health"
      )

      expect(
        missingApiPrefix,
        `${primName}.mdx REST API tab has routes missing /api/ prefix:\n${missingApiPrefix.join("\n")}`
      ).toHaveLength(0)
    })
  }
})

// =============================================================================
// Port Consistency Across ALL Docs (Not Just Primitives)
// =============================================================================

describe("port consistency across ALL documentation", () => {
  const allDocsDir = path.join(projectRoot, "apps/docs/content/docs")

  // Collect all MDX files recursively
  function collectMdxFiles(dir, prefix = "") {
    const results = []
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          results.push(...collectMdxFiles(path.join(dir, entry.name), relativePath))
        } else if (entry.name.endsWith(".mdx")) {
          results.push({ relativePath, fullPath: path.join(dir, entry.name) })
        }
      }
    } catch { /* directory not readable */ }
    return results
  }

  const allMdxFiles = collectMdxFiles(allDocsDir)

  it("no docs anywhere use localhost:3001", () => {
    const violations = []
    for (const { relativePath, fullPath } of allMdxFiles) {
      const content = fs.readFileSync(fullPath, "utf-8")
      if (content.includes("localhost:3001")) {
        violations.push(relativePath)
      }
    }
    expect(violations, `Files with wrong port (3001 instead of 3456):\n${violations.join("\n")}`).toHaveLength(0)
  })

  it("all localhost references use port 3456 (excluding known external services)", () => {
    // Ports used by external services that are NOT the tx API server
    const ALLOWED_PORTS = new Set([
      "3456",  // tx API server
      "3000",  // Next.js dev server
      "4317",  // OTEL gRPC collector
      "4318",  // OTEL HTTP collector
      "9090",  // Prometheus
      "16686", // Jaeger UI
    ])

    const violations = []
    const portRegex = /localhost:(\d+)/g
    for (const { relativePath, fullPath } of allMdxFiles) {
      const content = fs.readFileSync(fullPath, "utf-8")
      let match
      while ((match = portRegex.exec(content)) !== null) {
        const port = match[1]
        if (!ALLOWED_PORTS.has(port)) {
          violations.push(`${relativePath}: localhost:${port}`)
        }
      }
    }
    expect(violations, `Files with unexpected ports:\n${violations.join("\n")}`).toHaveLength(0)
  })
})

// =============================================================================
// SDK Import Correctness Across ALL Docs
// =============================================================================

describe("SDK import patterns across ALL documentation", () => {
  const allDocsDir = path.join(projectRoot, "apps/docs/content/docs")

  function collectMdxFiles(dir, prefix = "") {
    const results = []
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          results.push(...collectMdxFiles(path.join(dir, entry.name), relativePath))
        } else if (entry.name.endsWith(".mdx")) {
          results.push({ relativePath, fullPath: path.join(dir, entry.name) })
        }
      }
    } catch { /* directory not readable */ }
    return results
  }

  const allMdxFiles = collectMdxFiles(allDocsDir)

  it("no docs import from @jamesaphoenix/tx-core", () => {
    const violations = []
    for (const { relativePath, fullPath } of allMdxFiles) {
      const content = fs.readFileSync(fullPath, "utf-8")
      if (/from\s+['"]@jamesaphoenix\/tx-core/.test(content)) {
        violations.push(relativePath)
      }
    }
    expect(violations, `Files importing from @jamesaphoenix/tx-core:\n${violations.join("\n")}`).toHaveLength(0)
  })

  it("no user-facing docs use createTx() function", () => {
    // Only check user-facing docs, not internal design/prd docs which may reference historical APIs
    const USER_FACING_DIRS = ["primitives/", "getting-started", "agent-sdk", "index.mdx", "watchdog"]
    const violations = []
    for (const { relativePath, fullPath } of allMdxFiles) {
      // Skip internal docs (design/, prd/, requirements/)
      if (!USER_FACING_DIRS.some((d) => relativePath.includes(d))) continue

      const content = fs.readFileSync(fullPath, "utf-8")
      if (/\bcreate[Tt]x\s*\(/.test(content)) {
        violations.push(relativePath)
      }
    }
    expect(violations, `User-facing files using createTx():\n${violations.join("\n")}`).toHaveLength(0)
  })

  it("SDK examples import from @jamesaphoenix/tx-agent-sdk", () => {
    const violations = []
    for (const { relativePath, fullPath } of allMdxFiles) {
      const content = fs.readFileSync(fullPath, "utf-8")
      const tabs = extractTabs(content)
      if (!tabs.has("TypeScript SDK")) continue

      const sdkContent = tabs.get("TypeScript SDK").join("\n")
      // Check for TxClient usage without proper import
      if (/\bTxClient\b/.test(sdkContent)) {
        if (!/from\s+['"]@jamesaphoenix\/tx-agent-sdk['"]/.test(sdkContent)) {
          violations.push(`${relativePath}: uses TxClient but missing @jamesaphoenix/tx-agent-sdk import`)
        }
      }
    }
    expect(violations, `SDK tabs with wrong imports:\n${violations.join("\n")}`).toHaveLength(0)
  })
})

// =============================================================================
// ESLint Rule Cache Consistency
// =============================================================================

describe("ESLint rule configuration consistency", () => {
  const eslintConfigPath = path.join(projectRoot, "eslint.config.js")
  const eslintConfig = fs.readFileSync(eslintConfigPath, "utf-8")

  it("banned patterns in eslint.config.js match integration test patterns", () => {
    // Verify that the patterns used in eslint.config.js match what we test
    for (const pattern of BANNED_PATTERNS) {
      expect(
        eslintConfig.includes(pattern) || pattern === "localhost:3001",
        `Banned pattern "${pattern}" should be in eslint.config.js`
      ).toBe(true)
    }
  })

  it("require-primitive-docs rule is configured as error", () => {
    expect(eslintConfig).toContain("'tx/require-primitive-docs': ['error'")
  })

  it("require-primitive-implementations rule is configured as error", () => {
    expect(eslintConfig).toContain("'tx/require-primitive-implementations': ['error'")
  })

  it("require-llms-primitive-coverage rule is configured as error", () => {
    expect(eslintConfig).toContain("'tx/require-llms-primitive-coverage': ['error'")
  })
})
