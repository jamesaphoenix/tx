/**
 * @fileoverview Prevent generic utility file names that lead to sprawl.
 *
 * Ban file names like `utils.ts` and `helpers.ts`.
 * Prefer domain-specific files such as `file-path/normalize.ts`.
 */

import path from "node:path"
import { existsSync } from "node:fs"

const DEFAULT_BANNED_FILE_NAMES = ["utils.ts", "helpers.ts"]
const REPO_ROOT_MARKERS = [".git", "turbo.json"]
const repoRootCache = new Map()

const normalizePath = (value) => value.replace(/\\/g, "/")

const findRepoRoot = (absoluteFile) => {
  const cached = repoRootCache.get(absoluteFile)
  if (cached) return cached

  let current = path.dirname(absoluteFile)
  while (true) {
    if (REPO_ROOT_MARKERS.some((marker) => existsSync(path.join(current, marker)))) {
      repoRootCache.set(absoluteFile, current)
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      const fallback = process.cwd()
      repoRootCache.set(absoluteFile, fallback)
      return fallback
    }
    current = parent
  }
}

const toRepoRelativePath = (absoluteFile) => {
  const repoRoot = normalizePath(findRepoRoot(absoluteFile))
  const normalizedFile = normalizePath(absoluteFile)

  if (normalizedFile === repoRoot) return ""
  if (!normalizedFile.startsWith(`${repoRoot}/`)) return normalizedFile

  return normalizedFile.slice(repoRoot.length + 1)
}

const normalizeConfiguredPath = (value) =>
  normalizePath(value.replace(/^\.\//, "")).toLowerCase()

const isAllowedFile = (repoRelativeFile, absoluteFile, allow) => {
  if (!Array.isArray(allow) || allow.length === 0) return false
  return allow.some((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0) return false
    const rawAllow = entry.trim()
    if (path.isAbsolute(rawAllow)) {
      return normalizePath(path.resolve(rawAllow)) === absoluteFile
    }

    return normalizeConfiguredPath(rawAllow) === repoRelativeFile.toLowerCase()
  })
}

const compilePatterns = (patterns) => {
  if (!Array.isArray(patterns)) return []

  return patterns
    .filter((pattern) => typeof pattern === "string" && pattern.trim().length > 0)
    .flatMap((pattern) => {
      try {
        return [new RegExp(pattern.trim())]
      } catch {
        return []
      }
    })
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow generic utility file names like utils.ts/helpers.ts",
      category: "Best Practices",
      recommended: false,
    },
    schema: [
      {
        type: "object",
        properties: {
          bannedFileNames: {
            type: "array",
            items: { type: "string" },
          },
          bannedPathPatterns: {
            type: "array",
            items: { type: "string" },
          },
          allow: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      noGenericUtilityFileName: "Rename '{{fileName}}' to a domain-specific file name (for example file-path/normalize-path.ts).",
    },
  },

  create(context) {
    const fileNameRaw = typeof context.getFilename === "function"
      ? context.getFilename()
      : context.filename
    if (!fileNameRaw || fileNameRaw === "<input>" || fileNameRaw === "<text>") {
      return {}
    }

    const options = context.options[0] ?? {}
    const bannedFileNames = Array.isArray(options.bannedFileNames) && options.bannedFileNames.length > 0
      ? options.bannedFileNames
      : DEFAULT_BANNED_FILE_NAMES
    const normalizedBannedFileNames = bannedFileNames
      .filter((name) => typeof name === "string")
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name.length > 0)
    const bannedPathPatterns = compilePatterns(options.bannedPathPatterns)

    const absoluteFile = normalizePath(path.resolve(fileNameRaw))
    const repoRelativeFile = toRepoRelativePath(absoluteFile)
    const repoRelativeFileLower = repoRelativeFile.toLowerCase()
    const baseName = path.posix.basename(absoluteFile)
    const baseNameLower = baseName.toLowerCase()

    const matchesBannedFileName = normalizedBannedFileNames.includes(baseNameLower)
    const matchesBannedPathPattern = bannedPathPatterns.some((pattern) => pattern.test(repoRelativeFileLower))

    if (!matchesBannedFileName && !matchesBannedPathPattern) {
      return {}
    }

    if (isAllowedFile(repoRelativeFile, absoluteFile, options.allow)) {
      return {}
    }

    return {
      Program(node) {
        context.report({
          node,
          messageId: "noGenericUtilityFileName",
          data: { fileName: baseName },
        })
      },
    }
  },
}
