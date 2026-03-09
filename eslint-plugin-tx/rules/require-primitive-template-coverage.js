/**
 * @fileoverview Enforce that documented primitives are listed in scaffold templates.
 *
 * Source of truth: apps/docs/content/docs/primitives/meta.json
 * Templates checked by default:
 * - apps/cli/src/templates/claude/CLAUDE.md
 * - apps/cli/src/templates/codex/AGENTS.md
 *
 * Planned primitives are skipped when primitives-registry.json marks them as:
 * { "primitive-name": { "planned": true } }
 */

import fs from "fs"
import path from "path"

const CACHE_TTL_MS = 30_000

const _reported = new Set()
let _cacheTimestamp = 0
let _cachedMeta = null
let _cachedRegistry = null
let _cachedTemplates = null

const DEFAULT_META_PATH = "apps/docs/content/docs/primitives/meta.json"
const DEFAULT_REGISTRY_PATH = "primitives-registry.json"
const DEFAULT_TEMPLATES = [
  "apps/cli/src/templates/claude/CLAUDE.md",
  "apps/cli/src/templates/codex/AGENTS.md",
]

/** Reset caches for tests. */
export function _resetReported() {
  _reported.clear()
  _cacheTimestamp = 0
  _cachedMeta = null
  _cachedRegistry = null
  _cachedTemplates = null
}

function refreshCacheIfExpired() {
  if (Date.now() - _cacheTimestamp > CACHE_TTL_MS) {
    _cacheTimestamp = Date.now()
    _cachedMeta = null
    _cachedRegistry = null
    _cachedTemplates = null
  }
}

function isDividerOrIndexPage(page) {
  return page === "index" || /^---.*---$/.test(page)
}

function primitiveRegex(primitive) {
  switch (primitive) {
    case "learning":
      return /\btx\s+learning\s/i
    case "docs":
      return /\btx\s+doc\b/i
    case "invariants":
      return /\btx\s+invariant\b/i
    case "spec-trace":
      return /\btx\s+spec\b/i
    case "traces":
      return /\btx\s+trace\b/i
    case "attempts":
      return /\btx\s+(attempts|try)\b/i
    default:
      return new RegExp(`\\btx\\s+${primitive.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "i")
  }
}

function expectedCommand(primitive) {
  switch (primitive) {
    case "docs":
      return "tx doc"
    case "invariants":
      return "tx invariant"
    case "spec-trace":
      return "tx spec"
    case "traces":
      return "tx trace"
    case "learning":
      return "tx learning *"
    case "attempts":
      return "tx attempts (or tx try)"
    default:
      return `tx ${primitive}`
  }
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ensure documented primitives are present in CLAUDE/Codex scaffold templates",
      category: "Documentation Quality",
      recommended: false,
    },
    schema: [
      {
        type: "object",
        properties: {
          metaPath: { type: "string" },
          registryPath: { type: "string" },
          templates: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      templateReadError:
        "Unable to read template '{{template}}'. Primitive template coverage cannot be verified.",
      missingPrimitiveInTemplate:
        "Primitive '{{primitive}}' is documented but missing from '{{template}}' (expected: {{expected}}).",
    },
  },

  create(context) {
    const options = context.options[0] || {}
    const metaPath = options.metaPath || DEFAULT_META_PATH
    const registryPath = options.registryPath || DEFAULT_REGISTRY_PATH
    const templates = options.templates || DEFAULT_TEMPLATES
    const lintFilename = context.filename || (context.getFilename && context.getFilename()) || ""

    function getCwd() {
      return context.cwd || (context.getCwd && context.getCwd()) || process.cwd()
    }

    function candidateBaseDirs() {
      const seen = new Set()
      const bases = []

      const addBase = (value) => {
        if (!value) return
        const resolved = path.resolve(value)
        if (seen.has(resolved)) return
        seen.add(resolved)
        bases.push(resolved)
      }

      addBase(getCwd())
      addBase(process.cwd())

      if (lintFilename && path.isAbsolute(lintFilename)) {
        let cursor = path.dirname(lintFilename)
        while (true) {
          addBase(cursor)
          const parent = path.dirname(cursor)
          if (parent === cursor) break
          cursor = parent
        }
      }

      return bases
    }

    function readFileWithFallback(filePath) {
      if (path.isAbsolute(filePath)) {
        return fs.readFileSync(filePath, "utf-8")
      }

      let lastError = null
      for (const baseDir of candidateBaseDirs()) {
        const resolved = path.resolve(baseDir, filePath)
        try {
          return fs.readFileSync(resolved, "utf-8")
        } catch (error) {
          lastError = error
        }
      }

      if (lastError) throw lastError
      throw new Error(`Unable to resolve path: ${filePath}`)
    }

    function readMetaPrimitives() {
      if (_cachedMeta) return _cachedMeta

      try {
        const raw = readFileWithFallback(metaPath)
        const parsed = JSON.parse(raw)
        const pages = Array.isArray(parsed?.pages) ? parsed.pages : []
        _cachedMeta = pages.filter((page) =>
          typeof page === "string" && !isDividerOrIndexPage(page)
        )
      } catch {
        _cachedMeta = []
      }
      return _cachedMeta
    }

    function readPlannedSet() {
      if (_cachedRegistry) return _cachedRegistry

      const planned = new Set()
      try {
        const raw = readFileWithFallback(registryPath)
        const parsed = JSON.parse(raw)
        for (const [primitive, config] of Object.entries(parsed || {})) {
          if (primitive === "$comment") continue
          if (config && typeof config === "object" && config.planned === true) {
            planned.add(primitive)
          }
        }
      } catch {
        // No registry or parse error: assume no planned primitives.
      }
      _cachedRegistry = planned
      return _cachedRegistry
    }

    function readTemplates() {
      if (_cachedTemplates) return _cachedTemplates

      const contents = new Map()
      for (const templatePath of templates) {
        try {
          contents.set(templatePath, readFileWithFallback(templatePath))
        } catch {
          contents.set(templatePath, null)
        }
      }
      _cachedTemplates = contents
      return _cachedTemplates
    }

    function report(node, messageId, data) {
      const key = `${messageId}:${data.template}:${data.primitive || ""}`
      if (_reported.has(key)) return
      _reported.add(key)
      context.report({ node, messageId, data })
    }

    return {
      Program(node) {
        refreshCacheIfExpired()

        const filename = context.filename || context.getFilename()
        if (!/\.(ts|js|tsx|jsx)$/.test(filename)) return
        if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(filename)) return
        if (filename.includes("__tests__") || filename.includes("/test/")) return
        if (!filename.includes("/apps/")) return

        const primitives = readMetaPrimitives()
        const planned = readPlannedSet()
        const templateContents = readTemplates()

        const requiredPrimitives = primitives.filter((primitive) => !planned.has(primitive))

        for (const [templatePath, content] of templateContents.entries()) {
          if (content === null) {
            report(node, "templateReadError", { template: templatePath })
            continue
          }

          for (const primitive of requiredPrimitives) {
            const re = primitiveRegex(primitive)
            if (!re.test(content)) {
              report(node, "missingPrimitiveInTemplate", {
                primitive,
                template: templatePath,
                expected: expectedCommand(primitive),
              })
            }
          }
        }
      },
    }
  },
}
