import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { parse as parseYaml } from "yaml"
import { globToRegExp } from "./glob.js"
import { normalizePathSeparators, toNormalizedRelativePath } from "./file-path.js"
import type { SpecDiscoveryMethod } from "../types/index.js"

export type { SpecDiscoveryMethod }

export type DiscoveredTest = {
  readonly invariantId: string
  readonly testId: string
  readonly testFile: string
  readonly testName: string | null
  readonly framework: string | null
  readonly discovery: SpecDiscoveryMethod
}

export type DiscoveryScanResult = {
  readonly scannedFiles: number
  readonly discovered: readonly DiscoveredTest[]
  readonly tagLinks: number
  readonly commentLinks: number
  readonly manifestLinks: number
}

const TAG_PATTERN = /\[(INV-[A-Z0-9-]+)\]/g
const UNDERSCORE_TAG_PATTERN = /_INV_([A-Z0-9_]+)/g
const COMMENT_SPEC_PATTERN = /(?:\/\/|#|--|\/\*|\*)\s*@spec\s+(INV-[A-Z0-9-]+(?:\s*,\s*INV-[A-Z0-9-]+)*)/g

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".turbo",
  "dist",
  "coverage",
  "test-results",
])

const MAX_WALK_DEPTH = 24

const normalizeInvariantFromUnderscore = (value: string): string => {
  return `INV-${value.replace(/_+/g, "-")}`
}

const sanitizeManifestTestFile = (value: string): string | null => {
  const normalized = normalizePathSeparators(value.trim())
  if (normalized.length === 0) return null
  if (normalized.startsWith("/")) return null
  if (/^[A-Za-z]:\//.test(normalized)) return null

  const noDotPrefix = normalized.replace(/^\.\//, "")
  const segments = noDotPrefix.split("/")
  if (segments.some((segment) => segment === ".." || segment.length === 0)) {
    return null
  }

  return noDotPrefix
}

const expandBracePatterns = (pattern: string): string[] => {
  const start = pattern.indexOf("{")
  if (start < 0) return [pattern]

  let depth = 0
  let end = -1
  for (let i = start; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === "{") depth += 1
    if (c === "}") {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }

  if (end < 0) return [pattern]

  const before = pattern.slice(0, start)
  const inner = pattern.slice(start + 1, end)
  const after = pattern.slice(end + 1)
  const options = inner.split(",").map((s) => s.trim()).filter((s) => s.length > 0)

  const out: string[] = []
  for (const option of options) {
    for (const expanded of expandBracePatterns(`${before}${option}${after}`)) {
      out.push(expanded)
    }
  }

  return out.length > 0 ? out : [pattern]
}

const collectFiles = async (dir: string, depth = 0): Promise<string[]> => {
  if (depth > MAX_WALK_DEPTH) return []
  const out: string[] = []

  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      if (entry.name !== ".tx") {
        continue
      }
    }

    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...await collectFiles(fullPath, depth + 1))
      continue
    }

    if (entry.isFile()) {
      out.push(fullPath)
    }
  }

  return out
}

const inferFramework = (testFile: string): string | null => {
  if (testFile.endsWith(".test.ts") || testFile.endsWith(".test.tsx") || testFile.endsWith(".spec.ts") || testFile.endsWith(".spec.tsx")) {
    return "vitest"
  }
  if (testFile.endsWith(".test.js") || testFile.endsWith(".test.jsx") || testFile.endsWith(".spec.js") || testFile.endsWith(".spec.jsx")) {
    return "jest"
  }
  if (testFile.endsWith(".py")) return "pytest"
  if (testFile.endsWith("_test.go")) return "go"
  if (testFile.endsWith("_test.rs")) return "rust"
  if (testFile.endsWith("_spec.rb")) return "rspec"
  return null
}

const extractInlineTestName = (line: string): string | null => {
  const jsStyle = line.match(/(?:it|test|describe)\s*\(\s*["'`](.+?)["'`]/)
  if (jsStyle?.[1]) return jsStyle[1].trim()

  const pyStyle = line.match(/def\s+(test_[A-Za-z0-9_]+)\s*\(/)
  if (pyStyle?.[1]) return pyStyle[1].trim()

  const goStyle = line.match(/func\s+(Test[A-Za-z0-9_]+)\s*\(/)
  if (goStyle?.[1]) return goStyle[1].trim()

  const javaStyle = line.match(/(?:public\s+)?void\s+(test[A-Za-z0-9_]+)\s*\(/)
  if (javaStyle?.[1]) return javaStyle[1].trim()

  return null
}

const findNearestTestName = (lines: readonly string[], lineIndex: number): string | null => {
  const candidates: number[] = []
  for (let i = lineIndex; i <= Math.min(lines.length - 1, lineIndex + 6); i++) {
    candidates.push(i)
  }
  for (let i = Math.max(0, lineIndex - 2); i < lineIndex; i++) {
    candidates.push(i)
  }

  for (const idx of candidates) {
    const name = extractInlineTestName(lines[idx] ?? "")
    if (name) return name
  }

  return null
}

const buildTestId = (testFile: string, testName: string | null, line: number): string => {
  const normalizedName = (testName && testName.trim().length > 0)
    ? testName.trim()
    : `spec@line-${line}`
  return `${testFile}::${normalizedName}`
}

const parseFileAnnotations = (testFile: string, content: string): {
  tagMatches: DiscoveredTest[]
  commentMatches: DiscoveredTest[]
} => {
  const lines = content.split(/\r?\n/)
  const tagMatches: DiscoveredTest[] = []
  const commentMatches: DiscoveredTest[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ""

    TAG_PATTERN.lastIndex = 0
    let tagMatch: RegExpExecArray | null
    while ((tagMatch = TAG_PATTERN.exec(line)) !== null) {
      const invariantId = tagMatch[1]
      const testName = findNearestTestName(lines, i)
      tagMatches.push({
        invariantId,
        testFile,
        testName,
        testId: buildTestId(testFile, testName, i + 1),
        framework: inferFramework(testFile),
        discovery: "tag",
      })
    }

    const declaredName = extractInlineTestName(line)
    if (declaredName) {
      UNDERSCORE_TAG_PATTERN.lastIndex = 0
      let underscoreMatch: RegExpExecArray | null
      while ((underscoreMatch = UNDERSCORE_TAG_PATTERN.exec(declaredName)) !== null) {
        const invariantId = normalizeInvariantFromUnderscore(underscoreMatch[1] ?? "")
        const testName = findNearestTestName(lines, i)
        tagMatches.push({
          invariantId,
          testFile,
          testName,
          testId: buildTestId(testFile, testName, i + 1),
          framework: inferFramework(testFile),
          discovery: "tag",
        })
      }
    }

    COMMENT_SPEC_PATTERN.lastIndex = 0
    let commentMatch: RegExpExecArray | null
    while ((commentMatch = COMMENT_SPEC_PATTERN.exec(line)) !== null) {
      const chunk = commentMatch[1] ?? ""
      const invariants = chunk
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      const testName = findNearestTestName(lines, i)

      for (const invariantId of invariants) {
        commentMatches.push({
          invariantId,
          testFile,
          testName,
          testId: buildTestId(testFile, testName, i + 1),
          framework: inferFramework(testFile),
          discovery: "comment",
        })
      }
    }
  }

  return { tagMatches, commentMatches }
}

const parseManifest = async (rootDir: string): Promise<DiscoveredTest[]> => {
  const manifestPath = resolve(rootDir, ".tx", "spec-tests.yml")
  if (!existsSync(manifestPath)) return []

  const raw = await readFile(manifestPath, "utf8")
  let parsed: unknown
  try {
    parsed = parseYaml(raw) as unknown
  } catch {
    return []
  }
  if (typeof parsed !== "object" || parsed === null) return []
  const manifest = parsed as { mappings?: unknown }
  if (!Array.isArray(manifest.mappings)) return []

  const out: DiscoveredTest[] = []

  for (const entry of manifest.mappings) {
    if (typeof entry !== "object" || entry === null) continue
    const mapping = entry as {
      invariant?: unknown
      tests?: unknown
    }

    const invariant = typeof mapping.invariant === "string" ? mapping.invariant.trim() : ""
    if (!/^INV-[A-Z0-9-]+$/.test(invariant)) continue
    if (!Array.isArray(mapping.tests)) continue

    for (const rawTest of mapping.tests) {
      if (typeof rawTest !== "object" || rawTest === null) continue
      const t = rawTest as { file?: unknown; name?: unknown; framework?: unknown }
      const file = typeof t.file === "string" ? sanitizeManifestTestFile(t.file) : null
      if (!file) continue
      const testName = typeof t.name === "string" && t.name.trim().length > 0
        ? t.name.trim()
        : null
      const framework = typeof t.framework === "string" && t.framework.trim().length > 0
        ? t.framework.trim()
        : inferFramework(file)

      out.push({
        invariantId: invariant,
        testFile: file,
        testName,
        testId: buildTestId(file, testName, 1),
        framework,
        discovery: "manifest",
      })
    }
  }

  return out
}

const dedupeDiscovered = (rows: readonly DiscoveredTest[]): DiscoveredTest[] => {
  const seen = new Set<string>()
  const out: DiscoveredTest[] = []
  for (const row of rows) {
    const key = `${row.invariantId}::${row.testId}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/**
 * Discover spec-test mappings from source annotations + manifest.
 *
 * Two-pass scan:
 * 1. Test files (matched by `patterns`) — scanned for both [INV-*] tags and @spec comments
 * 2. Source files (matched by `sourcePatterns`) — scanned ONLY for @spec comments (structural annotations)
 *    Source files that already matched test patterns are skipped to avoid duplicates.
 */
export const discoverSpecTests = async (
  rootDir: string,
  patterns: readonly string[],
  sourcePatterns?: readonly string[]
): Promise<DiscoveryScanResult> => {
  const absoluteRoot = resolve(rootDir)
  const expandedPatterns = patterns
    .flatMap((pattern) => expandBracePatterns(pattern))
    .map((pattern) => normalizePathSeparators(pattern))
  const compiledPatterns = expandedPatterns.map((pattern) => globToRegExp(pattern))

  const files = await collectFiles(absoluteRoot)
  const matchingFiles = files.filter((absPath) => {
    const rel = toNormalizedRelativePath(absoluteRoot, absPath)
    return compiledPatterns.some((regex) => regex.test(rel))
  })

  const discovered: DiscoveredTest[] = []
  let tagLinks = 0
  let commentLinks = 0

  const scannedPaths = new Set<string>()

  for (const absPath of matchingFiles) {
    const relPath = toNormalizedRelativePath(absoluteRoot, absPath)
    scannedPaths.add(absPath)
    let content: string
    try {
      content = await readFile(absPath, "utf8")
    } catch {
      continue
    }
    const { tagMatches, commentMatches } = parseFileAnnotations(relPath, content)
    tagLinks += tagMatches.length
    commentLinks += commentMatches.length
    discovered.push(...tagMatches)
    discovered.push(...commentMatches)
  }

  // Pass 2: scan source files for @spec comments (structural annotations)
  const resolvedSourcePatterns = sourcePatterns ?? defaultSourcePatterns()
  const expandedSourcePatterns = resolvedSourcePatterns
    .flatMap((pattern) => expandBracePatterns(pattern))
    .map((pattern) => normalizePathSeparators(pattern))
  const compiledSourcePatterns = expandedSourcePatterns.map((pattern) => globToRegExp(pattern))

  const sourceFiles = files.filter((absPath) => {
    if (scannedPaths.has(absPath)) return false
    const rel = toNormalizedRelativePath(absoluteRoot, absPath)
    return compiledSourcePatterns.some((regex) => regex.test(rel))
  })

  let sourceFilesScanned = 0
  for (const absPath of sourceFiles) {
    const relPath = toNormalizedRelativePath(absoluteRoot, absPath)
    let content: string
    try {
      content = await readFile(absPath, "utf8")
    } catch {
      continue
    }
    // Only scan for @spec comments in source files (not [INV-*] tags)
    COMMENT_SPEC_PATTERN.lastIndex = 0
    const hasSpecComment = COMMENT_SPEC_PATTERN.test(content)
    if (!hasSpecComment) continue

    sourceFilesScanned += 1
    const { commentMatches } = parseFileAnnotations(relPath, content)
    commentLinks += commentMatches.length
    discovered.push(...commentMatches)
  }

  const manifestDiscovered = await parseManifest(absoluteRoot)
  const manifestLinks = manifestDiscovered.length
  discovered.push(...manifestDiscovered)

  const deduped = dedupeDiscovered(discovered)

  return {
    scannedFiles: matchingFiles.length + sourceFilesScanned,
    discovered: deduped,
    tagLinks,
    commentLinks,
    manifestLinks,
  }
}

/**
 * Read-only helper for one-off manifest parsing tests.
 */
export const readSpecManifest = async (rootDir: string): Promise<readonly DiscoveredTest[]> => {
  return parseManifest(resolve(rootDir))
}

/**
 * Convenience helper used by CLI and services for defaults.
 */
export const defaultSpecTestPatterns = (): readonly string[] => [
  "**/*.test.{ts,js,tsx,jsx}",
  "**/*.integration.test.{ts,js,tsx,jsx}",
  "**/*.spec.{ts,js,tsx,jsx}",
  "test/**/*.test.{ts,js,tsx,jsx}",
  "tests/**/*.py",
  "**/test_*.py",
  "**/*_test.go",
  "**/*_test.rs",
  "**/Test*.java",
  "**/*Test.java",
  "**/*_spec.rb",
  "**/*.test.{c,cpp,cc}",
  "**/*_test.{c,cpp,cc}",
  "**/*.pgtap.sql",
]

/**
 * Source file patterns scanned for @spec comments (structural annotations).
 * These are scanned separately from test patterns to find invariant
 * enforcement in source code (schema files, domain code, etc.).
 */
export const defaultSourcePatterns = (): readonly string[] => [
  "**/*.{ts,js,tsx,jsx,mts,mjs,cts,cjs}",
  "**/*.py",
  "**/*.go",
  "**/*.rs",
  "**/*.java",
  "**/*.{kt,kts}",
  "**/*.scala",
  "**/*.rb",
  "**/*.sql",
  "**/*.{c,cpp,cc,h,hpp}",
  "**/*.cs",
  "**/*.swift",
  "**/*.{ex,exs}",
  "**/*.{clj,cljs,cljc}",
  "**/*.{hs,lhs}",
  "**/*.lua",
  "**/*.php",
  "**/*.{r,R}",
  "**/*.zig",
  "**/*.nim",
  "**/*.ml",
  "**/*.dart",
]

/**
 * Utility for mapping absolute paths to stable relative file IDs.
 */
export const toRelativeTestFile = (rootDir: string, filePath: string): string => {
  const absoluteRoot = resolve(rootDir)
  const absolutePath = resolve(absoluteRoot, filePath)
  return toNormalizedRelativePath(absoluteRoot, absolutePath)
}
