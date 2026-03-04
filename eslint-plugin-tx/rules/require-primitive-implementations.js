/**
 * @fileoverview Enforce that every documented primitive has implementation files
 * across all required interfaces (CLI, MCP, REST API, SDK).
 *
 * Source of truth for what primitives exist: .mdx files in the docs directory.
 * Source of truth for file mappings: primitives-registry.json.
 *
 * When a new primitive .mdx is added without a registry entry, this rule
 * flags it immediately — no manual config needed in eslint.config.js.
 *
 * @author tx
 */

import fs from "fs"
import path from "path"

// Module-level deduplication set. Resets when ESLint restarts.
const _reported = new Set()

// Module-level caches for registry and discovered primitives.
// Shared across all files in a single ESLint worker to avoid redundant fs reads.
let _registry = null
let _discoveredPrimitives = null
let _cacheTimestamp = 0

// Cache for fs.existsSync results to avoid redundant disk reads.
const _existsCache = new Map()

// TTL for caches in milliseconds (30s). Ensures watch mode picks up changes.
const CACHE_TTL_MS = 30_000

/** Reset dedup set and caches (for testing). */
export function _resetReported() {
  _reported.clear()
  _registry = null
  _discoveredPrimitives = null
  _cacheTimestamp = 0
  _existsCache.clear()
}

function isCacheExpired() {
  return Date.now() - _cacheTimestamp > CACHE_TTL_MS
}

function refreshCacheIfExpired() {
  if (isCacheExpired()) {
    _registry = null
    _discoveredPrimitives = null
    _existsCache.clear()
    _cacheTimestamp = Date.now()
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ensure every documented primitive has implementation files across all required interfaces (CLI, MCP, REST, SDK)",
      category: "Interface Coverage",
      recommended: false,
    },
    schema: [
      {
        type: "object",
        properties: {
          registryPath: {
            type: "string",
            description:
              "Path to primitives-registry.json relative to cwd",
          },
          docsDir: {
            type: "string",
            description:
              "Path to the primitives docs directory relative to cwd",
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      unconfiguredPrimitive:
        "Primitive '{{primitive}}' has a docs page ({{docFile}}) but no entry in primitives-registry.json. Add it to the registry.",
      missingImplementation:
        "Primitive '{{primitive}}' is missing {{interface}} implementation (expected: {{expectedPath}})",
      missingImplementations:
        "Primitive '{{primitive}}' is missing implementations: {{interfaces}}",
      plannedPrimitiveHasImpl:
        "Primitive '{{primitive}}' is marked as planned but has implementation files for: {{interfaces}}. Remove the 'planned' flag or delete the implementations.",
    },
  },

  create(context) {
    const options = context.options[0] || {}
    const registryPath = options.registryPath || "primitives-registry.json"
    const docsDir =
      options.docsDir || "apps/docs/content/docs/primitives"

    // Use module-level caches
    let registry = _registry
    let discoveredPrimitives = _discoveredPrimitives

    function getCwd() {
      return context.cwd || (context.getCwd && context.getCwd()) || process.cwd()
    }

    function loadRegistry() {
      if (registry !== null) return registry

      const absPath = path.resolve(getCwd(), registryPath)
      try {
        const raw = fs.readFileSync(absPath, "utf-8")
        const parsed = JSON.parse(raw)
        // Remove $comment key if present
        const { $comment, ...rest } = parsed
        registry = rest
      } catch {
        registry = {}
      }

      _registry = registry
      return registry
    }

    function discoverPrimitives() {
      if (discoveredPrimitives !== null) return discoveredPrimitives

      const absDocsDir = path.resolve(getCwd(), docsDir)
      discoveredPrimitives = []

      try {
        const files = fs.readdirSync(absDocsDir)
        for (const file of files) {
          if (file.endsWith(".mdx") && file !== "index.mdx") {
            discoveredPrimitives.push(file.replace(/\.mdx$/, ""))
          }
        }
      } catch {
        // docsDir does not exist or is not readable
      }

      _discoveredPrimitives = discoveredPrimitives

      return discoveredPrimitives
    }

    function toPaths(val) {
      if (!val) return []
      return Array.isArray(val) ? val : [val]
    }

    function anyPathExists(paths) {
      const cwd = getCwd()
      return paths.some((p) => {
        const fullPath = path.resolve(cwd, p)
        if (_existsCache.has(fullPath)) return _existsCache.get(fullPath)
        const exists = fs.existsSync(fullPath)
        _existsCache.set(fullPath, exists)
        return exists
      })
    }

    function report(node, messageId, data) {
      const key = `${messageId}:${data.primitive}:${data.interfaces || data.interface || data.docFile || ""}`
      if (_reported.has(key)) return
      _reported.add(key)
      context.report({ node, messageId, data })
    }

    return {
      Program(node) {
        refreshCacheIfExpired()

        const currentFile = context.filename || context.getFilename()

        // Skip non-TS/JS files
        if (!/\.(ts|js|tsx|jsx)$/.test(currentFile)) return

        // Skip test files
        if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(currentFile)) return
        if (
          currentFile.includes("__tests__") ||
          currentFile.includes("/test/")
        )
          return

        // Only trigger on files under apps/ to avoid noise
        if (!currentFile.includes("/apps/")) return

        const reg = loadRegistry()
        const primitives = discoverPrimitives()

        for (const primName of primitives) {
          const config = reg[primName]

          // Gap: primitive discovered in docs but not in registry
          if (!config) {
            report(node, "unconfiguredPrimitive", {
              primitive: primName,
              docFile: `${primName}.mdx`,
            })
            continue
          }

          // Planned primitives: check for unexpected implementations
          if (config.planned === true) {
            const IFACES = ["cli", "mcp", "api", "sdk"]
            const unexpectedImpls = []
            for (const iface of IFACES) {
              const paths = toPaths(config[iface])
              if (paths.length > 0 && anyPathExists(paths)) {
                unexpectedImpls.push(iface)
              }
            }
            if (unexpectedImpls.length > 0) {
              report(node, "plannedPrimitiveHasImpl", {
                primitive: primName,
                interfaces: unexpectedImpls.join(", "),
              })
            }
            continue
          }

          // Implemented primitives: check required interfaces
          const required = config.required || []
          if (required.length === 0) continue

          // Only check when current file is related to this primitive
          const IFACES = ["cli", "mcp", "api", "sdk"]
          const isRelatedFile = IFACES.some((iface) => {
            const paths = toPaths(config[iface])
            return paths.some(
              (p) =>
                currentFile.endsWith(p) || currentFile.includes(p)
            )
          })

          if (!isRelatedFile) continue

          const missing = []
          for (const iface of required) {
            const paths = toPaths(config[iface])
            if (paths.length === 0) {
              missing.push(iface)
              continue
            }
            if (!anyPathExists(paths)) {
              missing.push(iface)
            }
          }

          if (missing.length > 0) {
            report(node, "missingImplementations", {
              primitive: primName,
              interfaces: missing.join(", "),
            })
          }
        }
      },
    }
  },
}
