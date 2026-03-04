/**
 * @fileoverview Enforce documentation quality for primitive .mdx files.
 *
 * Checks:
 * 1. All 4 interface tabs present (CLI, TypeScript SDK, MCP, REST API)
 * 2. No placeholder text ("planned for future release", "not yet implemented")
 * 3. No createTx() usage (should use TxClient from @jamesaphoenix/tx-agent-sdk)
 * 4. No direct @jamesaphoenix/tx-core imports in SDK examples
 * 5. Each tab contains at least one fenced code block
 *
 * Skips primitives with a "> **Status**: Planned" marker.
 *
 * @author tx
 */

import fs from "fs"
import path from "path"

const DEFAULT_REQUIRED_TABS = [
  "CLI",
  "TypeScript SDK",
  "MCP",
  "REST API",
]

const DEFAULT_BANNED_PATTERNS = [
  "planned for future release",
  "not yet implemented",
  "coming soon",
]

const DEFAULT_BANNED_IMPORTS = [
  "@jamesaphoenix/tx-core",
]

const DEFAULT_BANNED_FUNCTIONS = [
  "createTx",
]

// Module-level deduplication set. Resets when ESLint restarts.
const _reported = new Set()

// Module-level cache for scanned docs. Shared across files in a single ESLint worker.
let _scannedDocs = null
let _cacheTimestamp = 0

// TTL for caches in milliseconds (30s). Ensures watch mode picks up changes.
const CACHE_TTL_MS = 30_000

/** Reset dedup set and caches (for testing). */
export function _resetReported() {
  _reported.clear()
  _scannedDocs = null
  _cacheTimestamp = 0
}

function refreshCacheIfExpired() {
  if (Date.now() - _cacheTimestamp > CACHE_TTL_MS) {
    _scannedDocs = null
    _cacheTimestamp = Date.now()
  }
}

/**
 * Extract tab sections from MDX content.
 * @param {string} content
 * @returns {Map<string, string[]>}
 */
function extractTabs(content) {
  const tabs = new Map()
  const tabRegex = /<Tab\s+value="([^"]+)">([\s\S]*?)<\/Tab>/g
  let match
  while ((match = tabRegex.exec(content)) !== null) {
    const tabValue = match[1]
    const tabContent = match[2]
    if (!tabs.has(tabValue)) {
      tabs.set(tabValue, [])
    }
    tabs.get(tabValue).push(tabContent)
  }
  return tabs
}

/**
 * Check if content contains a fenced code block.
 * @param {string} content
 * @returns {boolean}
 */
function hasCodeBlock(content) {
  return /```[\s\S]*?```/.test(content)
}

/**
 * Check if MDX content has a "planned" status marker.
 * @param {string} content
 * @returns {boolean}
 */
function isPlannedPrimitive(content) {
  return />\s*\*?\*?Status\*?\*?:\s*Planned/i.test(content)
}

/**
 * Escape a string for safe use in a RegExp.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce that primitive docs have all 4 interface tabs, no placeholders, correct imports, and code blocks",
      category: "Documentation Quality",
      recommended: false,
    },
    schema: [
      {
        type: "object",
        properties: {
          docsDir: { type: "string" },
          requiredTabs: {
            type: "array",
            items: { type: "string" },
          },
          bannedPatterns: {
            type: "array",
            items: { type: "string" },
          },
          bannedImports: {
            type: "array",
            items: { type: "string" },
          },
          bannedFunctions: {
            type: "array",
            items: { type: "string" },
          },
          skipPlanned: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingTab:
        "Primitive '{{primitive}}' docs are missing the '{{tab}}' tab section",
      placeholderContent:
        "Primitive '{{primitive}}' has placeholder text in {{tab}} tab: '{{match}}'",
      bannedImport:
        "Primitive '{{primitive}}' uses banned import '{{import}}' in {{tab}} tab. Use @jamesaphoenix/tx-agent-sdk instead.",
      bannedFunction:
        "Primitive '{{primitive}}' uses banned function '{{function}}' in {{tab}} tab. Use TxClient from @jamesaphoenix/tx-agent-sdk instead.",
      missingCodeBlock:
        "Primitive '{{primitive}}' has no code block in the '{{tab}}' tab",
    },
  },

  create(context) {
    const options = context.options[0] || {}
    const docsDir =
      options.docsDir || "apps/docs/content/docs/primitives"
    const requiredTabs = options.requiredTabs || DEFAULT_REQUIRED_TABS
    const bannedPatterns =
      options.bannedPatterns || DEFAULT_BANNED_PATTERNS
    const bannedImports =
      options.bannedImports || DEFAULT_BANNED_IMPORTS
    const bannedFunctions =
      options.bannedFunctions || DEFAULT_BANNED_FUNCTIONS
    const skipPlanned = options.skipPlanned !== false

    // Compile regexes once
    const bannedPatternRegexes = bannedPatterns.map(
      (p) => ({ pattern: p, regex: new RegExp(escapeRegex(p), "i") })
    )
    const bannedImportRegexes = bannedImports.map(
      (p) => ({
        pattern: p,
        regex: new RegExp(`from\\s+['"]${escapeRegex(p)}`, "i"),
      })
    )
    const bannedFunctionRegexes = bannedFunctions.map(
      (p) => ({
        pattern: p,
        regex: new RegExp(`\\b${escapeRegex(p)}\\s*\\(`, "i"),
      })
    )

    // Use module-level cache
    let scannedDocs = _scannedDocs

    function getCwd() {
      return context.cwd || (context.getCwd && context.getCwd()) || process.cwd()
    }

    function scanDocs() {
      if (scannedDocs !== null) return scannedDocs

      const absDocsDir = path.resolve(getCwd(), docsDir)
      scannedDocs = []

      try {
        const files = fs.readdirSync(absDocsDir)
        for (const file of files) {
          if (file.endsWith(".mdx") && file !== "index.mdx") {
            const primName = file.replace(/\.mdx$/, "")
            const fullPath = path.join(absDocsDir, file)
            try {
              const content = fs.readFileSync(fullPath, "utf-8")
              scannedDocs.push({ name: primName, file, content })
            } catch {
              // File unreadable, skip
            }
          }
        }
      } catch {
        // Directory unreadable
      }

      _scannedDocs = scannedDocs
      return scannedDocs
    }

    function report(node, messageId, data) {
      const key = `${messageId}:${data.primitive}:${data.tab || ""}:${data.match || data.import || data.function || ""}`
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

        // Only trigger on files under apps/
        if (!currentFile.includes("/apps/")) return

        const docs = scanDocs()

        for (const { name: primName, content } of docs) {
          // Skip planned primitives
          if (skipPlanned && isPlannedPrimitive(content)) continue

          const tabs = extractTabs(content)

          // Check 1: All required tabs present
          for (const tabName of requiredTabs) {
            if (!tabs.has(tabName)) {
              report(node, "missingTab", {
                primitive: primName,
                tab: tabName,
              })
            }
          }

          // Check tab content
          for (const [tabName, tabContents] of tabs) {
            const combinedContent = tabContents.join("\n")

            // Check 2: No banned placeholder patterns
            for (const { pattern, regex } of bannedPatternRegexes) {
              if (regex.test(combinedContent)) {
                report(node, "placeholderContent", {
                  primitive: primName,
                  tab: tabName,
                  match: pattern,
                })
              }
            }

            // Check 3: No banned imports (scoped to TypeScript SDK tab)
            if (tabName === "TypeScript SDK") {
              for (const { pattern, regex } of bannedImportRegexes) {
                if (regex.test(combinedContent)) {
                  report(node, "bannedImport", {
                    primitive: primName,
                    import: pattern,
                    tab: tabName,
                  })
                }
              }
            }

            // Check 4: No banned functions in any tab
            for (const { pattern, regex } of bannedFunctionRegexes) {
              if (regex.test(combinedContent)) {
                report(node, "bannedFunction", {
                  primitive: primName,
                  function: pattern,
                  tab: tabName,
                })
              }
            }

            // Check 5: At least one code block per tab
            if (!hasCodeBlock(combinedContent)) {
              report(node, "missingCodeBlock", {
                primitive: primName,
                tab: tabName,
              })
            }
          }
        }
      },
    }
  },
}
