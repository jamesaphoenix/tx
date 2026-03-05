/**
 * @fileoverview Ensure every documented primitive appears in apps/docs/public/llms.txt.
 *
 * Source of truth: apps/docs/content/docs/primitives/meta.json
 * Checked artifact by default: apps/docs/public/llms.txt
 */

import fs from "fs"
import path from "path"

const CACHE_TTL_MS = 30_000

const _reported = new Set()
let _cacheTimestamp = 0
let _cachedMeta = null
let _cachedLlms = null

const DEFAULT_META_PATH = "apps/docs/content/docs/primitives/meta.json"
const DEFAULT_LLMS_PATH = "apps/docs/public/llms.txt"
const DEFAULT_URL_BASE = "https://tx-docs.vercel.app/docs/primitives/"

/** Reset caches for tests. */
export function _resetReported() {
  _reported.clear()
  _cacheTimestamp = 0
  _cachedMeta = null
  _cachedLlms = null
}

function refreshCacheIfExpired() {
  if (Date.now() - _cacheTimestamp > CACHE_TTL_MS) {
    _cacheTimestamp = Date.now()
    _cachedMeta = null
    _cachedLlms = null
  }
}

function isDividerOrIndexPage(page) {
  return page === "index" || /^---.*---$/.test(page)
}

function joinUrl(base, slug) {
  return `${base.replace(/\/+$/, "")}/${slug}`
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Ensure every documented primitive is linked from apps/docs/public/llms.txt",
      category: "Documentation Quality",
      recommended: false,
    },
    schema: [
      {
        type: "object",
        properties: {
          metaPath: { type: "string" },
          llmsPath: { type: "string" },
          urlBase: { type: "string" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      llmsReadError:
        "Unable to read '{{llmsPath}}'. llms primitive coverage cannot be verified.",
      missingPrimitiveInLlms:
        "Primitive '{{primitive}}' is documented but missing from '{{llmsPath}}' (expected URL: {{expectedUrl}}).",
    },
  },

  create(context) {
    const options = context.options[0] || {}
    const metaPath = options.metaPath || DEFAULT_META_PATH
    const llmsPath = options.llmsPath || DEFAULT_LLMS_PATH
    const urlBase = options.urlBase || DEFAULT_URL_BASE
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

    function readLlms() {
      if (_cachedLlms !== null) return _cachedLlms

      try {
        _cachedLlms = readFileWithFallback(llmsPath)
      } catch {
        _cachedLlms = null
      }

      return _cachedLlms
    }

    function report(node, messageId, data) {
      const key = `${messageId}:${data.llmsPath}:${data.primitive || ""}`
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
        const llmsContent = readLlms()

        if (llmsContent === null) {
          report(node, "llmsReadError", { llmsPath })
          return
        }

        for (const primitive of primitives) {
          const expectedUrl = joinUrl(urlBase, primitive)
          if (!llmsContent.includes(expectedUrl)) {
            report(node, "missingPrimitiveInLlms", {
              primitive,
              llmsPath,
              expectedUrl,
            })
          }
        }
      },
    }
  },
}
