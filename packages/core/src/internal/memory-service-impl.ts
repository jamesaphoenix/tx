/**
 * MemoryService - Core service for filesystem-backed memory
 *
 * Manages indexing, searching, and CRUD operations on markdown files.
 * Filesystem is the source of truth; SQLite is a derived index.
 */

import { Context, Effect, Layer } from "effect"
import { createHash, randomBytes } from "node:crypto"
import { readFile, writeFile, readdir, stat, mkdir, rename, unlink } from "node:fs/promises"
import { join, relative, basename, extname, resolve } from "node:path"
import { MemoryDocumentRepository } from "../repo/memory-repo.js"
import { MemoryLinkRepository } from "../repo/memory-repo.js"
import { MemoryPropertyRepository } from "../repo/memory-repo.js"
import { MemorySourceRepository } from "../repo/memory-repo.js"
import { DatabaseError, MemoryDocumentNotFoundError, MemorySourceNotFoundError, ValidationError } from "../errors.js"
import type {
  MemoryDocument,
  MemoryDocumentWithScore,
  MemoryLink,
  MemorySource,
  MemoryProperty,
  MemoryIndexStatus,
  MemorySearchOptions,
  CreateMemoryDocumentInput,
} from "@jamesaphoenix/tx-types"

// Reserved frontmatter keys that are NOT synced as properties
const RESERVED_FRONTMATTER_KEYS = new Set(["tags", "related", "created"])

/** Max recursion depth for findMarkdownFiles to prevent symlink cycles / stack overflow. */
const MAX_DIRECTORY_DEPTH = 50

/**
 * Generate a deterministic memory document ID from the relative file path.
 * Uses 12 hex chars (48 bits) — birthday collision threshold at ~4M documents.
 * (Prior 8-char version had ~50% collision probability at only ~65K documents.)
 */
const generateDocId = (relativePath: string, rootDir: string): string => {
  const hash = createHash("sha256").update(`${rootDir}:${relativePath}`).digest("hex").slice(0, 12)
  return `mem-${hash}`
}

/**
 * Slugify a title for use as a filename.
 */
const slugify = (title: string): string => {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")  // Unicode-aware: keep letters, numbers, whitespace, hyphens
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
}

/**
 * Quote a YAML value if it contains characters that would break parsing.
 */
/** YAML reserved words that must be quoted to preserve string type */
const YAML_RESERVED_WORDS = new Set([
  "null", "Null", "NULL", "~",
  "true", "True", "TRUE", "false", "False", "FALSE",
  "yes", "Yes", "YES", "no", "No", "NO",
  "on", "On", "ON", "off", "Off", "OFF",
])

const yamlQuote = (value: string): string => {
  if (
    YAML_RESERVED_WORDS.has(value) ||
    /^[-+]?\d/.test(value) ||
    /[:#[\]{}|>&*!'"?%@`,\n\r\t\0]/.test(value) ||
    value.startsWith(" ") || value.endsWith(" ") || value === ""
  ) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/\0/g, "\\0")}"`
  }
  return value
}

/**
 * Quote a YAML array item if it contains commas or special characters.
 * Reuses YAML_RESERVED_WORDS from above for boolean/null interop safety.
 */
const yamlQuoteItem = (item: string): string => {
  if (
    item.includes(",") || item.includes('"') || item.includes("'") ||
    item.includes("[") || item.includes("]") ||
    item.includes("{") || item.includes("}") ||
    item.includes("|") || item.includes(">") ||
    item.includes("&") || item.includes("*") ||
    item.includes("!") || item.includes("?") ||
    item.includes("%") || item.includes("@") || item.includes("`") ||
    item.includes("\n") || item.includes("\r") || item.includes("\t") || item.includes("\0") ||
    item.includes("\\") || item === "" ||
    item.includes(":") || item.includes("#") ||
    item.startsWith(" ") || item.endsWith(" ") ||
    YAML_RESERVED_WORDS.has(item) ||
    /^[-+]?[0-9]/.test(item)
  ) {
    return `"${item.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t").replace(/\0/g, "\\0")}"`
  }
  return item
}

/**
 * Parse YAML frontmatter from markdown content.
 * Returns { frontmatter, body, parsed } where frontmatter is the raw YAML string,
 * body is the remaining content, and parsed is the structured object.
 */
const parseFrontmatter = (content: string): { frontmatter: string | null; body: string; parsed: Record<string, unknown> | null } => {
  // Strip UTF-8 BOM if present (editors like VS Code can add this)
  const cleaned = content.startsWith("\uFEFF") ? content.slice(1) : content

  // Must start with --- on the first line
  if (!cleaned.startsWith("---\n") && !cleaned.startsWith("---\r\n")) {
    return { frontmatter: null, body: content, parsed: null }
  }

  // Find the closing --- delimiter: must be on its own line immediately after the opening.
  // Uses a line-by-line scan instead of a lazy regex to avoid truncating body content
  // at in-body horizontal rules (---).
  const openLen = cleaned.startsWith("---\r\n") ? 5 : 4
  const rest = cleaned.slice(openLen)
  const restLines = rest.split(/\r?\n/)
  let closingIdx = -1
  let charsConsumed = 0
  for (let i = 0; i < restLines.length; i++) {
    if (restLines[i]!.trimEnd() === "---") {
      closingIdx = i
      break
    }
    charsConsumed += restLines[i]!.length + (rest[charsConsumed + restLines[i]!.length] === "\r" ? 2 : 1)
  }
  if (closingIdx === -1) return { frontmatter: null, body: content, parsed: null }

  const yamlStr = restLines.slice(0, closingIdx).join("\n")
  // Body starts after the closing --- and its line ending
  const closingLineLen = restLines[closingIdx]!.length
  const closingEnd = charsConsumed + closingLineLen
  // Skip the newline after closing --- (if present)
  let bodyStart = openLen + closingEnd
  if (cleaned[bodyStart] === "\r") bodyStart++
  if (cleaned[bodyStart] === "\n") bodyStart++
  const body = cleaned.slice(bodyStart)

  // Simple YAML parser for flat key-value + arrays + block scalars
  const parsed: Record<string, unknown> = {}
  const lines = yamlStr.split(/\r?\n/)
  let currentKey: string | null = null
  // Block scalar tracking (|, >, |-, >-, |+, >+)
  let currentBlockKey: string | null = null
  let currentBlockIndent = -1

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!
    // Block scalar continuation: collect indented or empty lines
    if (currentBlockKey !== null) {
      const indentMatch = line.match(/^(\s+)/)
      if (indentMatch || line.trim() === "") {
        const indent = indentMatch ? indentMatch[1]!.length : 0
        if (currentBlockIndent < 0 && indent > 0) currentBlockIndent = indent
        const stripped = currentBlockIndent > 0 ? line.slice(currentBlockIndent) : line
        const existing = parsed[currentBlockKey] as string
        parsed[currentBlockKey] = existing ? existing + "\n" + stripped : stripped
        continue
      } else {
        // Non-indented line ends the block scalar — fall through to normal parsing
        currentBlockKey = null
        currentBlockIndent = -1
      }
    }
    const kvMatch = line.match(/^(\w[\w.-]*)\s*:\s*(.*)$/)
    if (kvMatch) {
      const key = kvMatch[1]!
      let value: unknown = kvMatch[2]!.trim()

      // Strip inline YAML comments from unquoted values (e.g., "active # was draft" → "active")
      if (typeof value === "string" && !value.startsWith('"') && !value.startsWith("'") && !value.startsWith("[")) {
        value = value.replace(/\s+#.*$/, "")
      }

      // Handle inline array: [a, b, c]
      if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        const inner = value.slice(1, -1)
        if (inner.trim() === "") {
          value = []
        } else {
          // Parse items, respecting quoted strings and escape sequences
          const items: { text: string; quoted: boolean }[] = []
          let current = ""
          let inQuotes = false
          let quoteChar = ""
          let wasQuoted = false
          for (let i = 0; i < inner.length; i++) {
            const ch = inner[i]!
            // Handle escape sequences inside double-quoted strings
            if (inQuotes && quoteChar === '"' && ch === "\\" && i + 1 < inner.length) {
              const next = inner[i + 1]!
              switch (next) {
                case "n": current += "\n"; break
                case "r": current += "\r"; break
                case "t": current += "\t"; break
                case "0": current += "\0"; break
                case '"': current += '"'; break
                case "\\": current += "\\"; break
                default: current += ch + next; break
              }
              i++ // skip next character
            } else if (!inQuotes && (ch === '"' || ch === "'")) {
              inQuotes = true
              quoteChar = ch
              wasQuoted = true
              // Discard inter-item whitespace before the opening quote
              // e.g., in `[a, "b"]` the space before `"b"` is separator, not value content
              // Only clear if current is pure whitespace (no real content accumulated)
              if (current.trim() === "") current = ""
            } else if (inQuotes && ch === quoteChar) {
              // Handle '' escape inside single-quoted strings (YAML spec: '' → ')
              if (quoteChar === "'" && i + 1 < inner.length && inner[i + 1] === "'") {
                current += "'"
                i++ // skip the second quote
                continue
              }
              inQuotes = false
            } else if (!inQuotes && ch === ",") {
              // Push item: preserve empty strings that were explicitly quoted (e.g. "")
              // When quoted, preserve exact content (don't trim spaces inside quotes)
              if (wasQuoted) {
                items.push({ text: current, quoted: true })
              } else if (current.trim()) {
                items.push({ text: current.trim(), quoted: false })
              }
              current = ""
              wasQuoted = false
            } else {
              // Don't accumulate post-quote whitespace (separator, not content)
              // e.g., ["hello" , "world"] — the space after closing quote is not part of the value
              if (wasQuoted && !inQuotes && (ch === " " || ch === "\t")) {
                continue
              }
              // Reset wasQuoted if non-whitespace appears after closing quote (malformed input)
              // This prevents corrupting the quoted/unquoted type metadata for coercion
              if (wasQuoted && !inQuotes) {
                wasQuoted = false
              }
              current += ch
            }
          }
          // Push final item: preserve empty strings that were explicitly quoted
          if (wasQuoted) {
            items.push({ text: current, quoted: true })
          } else if (current.trim()) {
            items.push({ text: current.trim(), quoted: false })
          }
          // Coerce ONLY unquoted array items to native types (same rules as scalar values).
          // Quoted items (e.g., "42", "true") are kept as strings — quoting is intentional.
          value = items.map((item): unknown => {
            if (item.quoted) return item.text
            const t = item.text
            if (/^(null|Null|NULL|~)$/.test(t)) return null
            if (/^(true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/.test(t)) {
              const lower = t.toLowerCase()
              return (lower === "true" || lower === "yes" || lower === "on")
            }
            if (/^-?\d+$/.test(t)) return parseInt(t, 10)
            if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t)
            return t
          })
        }
      }
      // Handle quoted string value (decode escape sequences for double-quoted strings)
      // Order matters: protect literal backslashes first to avoid double-decode
      // e.g. "\\n" (literal backslash + n) must not become a newline
      else if (typeof value === "string" && value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        // Single-pass decode: match all escape sequences at once
        value = value.slice(1, -1).replace(/\\([\\"nrt0])/g, (_match, ch: string) => {
          switch (ch) {
            case "n": return "\n"
            case "r": return "\r"
            case "t": return "\t"
            case "0": return "\0"
            case '"': return '"'
            case "\\": return "\\"
            default: return ch
          }
        })
      }
      // Handle single-quoted string value (no escape processing per YAML spec, but '' → ' unescape)
      else if (typeof value === "string" && value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1).replace(/''/g, "'")
      }
      // Handle bare YAML null — preserve native type so round-trip doesn't quote as "null"
      else if (typeof value === "string" && /^(null|Null|NULL|~)$/.test(value)) {
        value = null
      }
      // Handle bare YAML booleans — preserve native type so round-trip doesn't quote them
      else if (typeof value === "string" && /^(true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/.test(value)) {
        const lower = (value as string).toLowerCase()
        value = (lower === "true" || lower === "yes" || lower === "on")
      }
      // Handle bare integers — preserve native type so round-trip doesn't quote them
      else if (typeof value === "string" && /^-?\d+$/.test(value)) {
        value = parseInt(value, 10)
      }
      // Handle bare floats — preserve native type
      else if (typeof value === "string" && /^-?\d+\.\d+$/.test(value)) {
        value = parseFloat(value)
      }
      // Handle YAML block scalar indicators (|, >, |-, >-, |+, >+)
      else if (typeof value === "string" && /^[|>][+-]?$/.test(value.trim())) {
        currentBlockKey = key
        currentBlockIndent = -1
        parsed[key] = ""
        currentKey = null
        continue
      }
      // Handle empty value: could be a block array (items follow) or bare null.
      // Peek at the next non-blank line to decide: if it starts with "- ", treat as array.
      // Otherwise treat as null (YAML spec: bare `key:` with no value is null).
      else if (value === "") {
        // Peek ahead: find next non-blank, non-comment line
        let nextLine: string | undefined
        for (let j = lineIdx + 1; j < lines.length; j++) {
          const trimmed = lines[j]!.trim()
          if (trimmed !== "" && !trimmed.startsWith("#")) { nextLine = lines[j]; break }
        }
        if (nextLine && /^\s*-(\s|$)/.test(nextLine)) {
          // Next content line is a block array item → treat as array
          value = []
          currentKey = key
          parsed[key] = value
          continue
        }
        // No array items follow → bare null value
        value = null
        parsed[key] = value
        currentKey = null
        continue
      }

      parsed[key] = value
      currentKey = null
    } else if (currentKey && line.match(/^\s*-\s+(.+)$/)) {
      // Array item
      const itemMatch = line.match(/^\s*-\s+(.+)$/)
      if (itemMatch && Array.isArray(parsed[currentKey])) {
        let itemVal: unknown = itemMatch[1]!.trim()
        // Only strip MATCHED quote pairs (not unmatched leading/trailing quotes)
        if (typeof itemVal === "string" && itemVal.length >= 2) {
          if ((itemVal.startsWith('"') && itemVal.endsWith('"')) ||
              (itemVal.startsWith("'") && itemVal.endsWith("'"))) {
            const wasDoubleQuoted = itemVal.startsWith('"')
            itemVal = itemVal.slice(1, -1)
            // Decode escape sequences for double-quoted items
            if (wasDoubleQuoted) {
              itemVal = (itemVal as string).replace(/\\([\\"nrt0])/g, (_m, ch: string) => {
                switch (ch) {
                  case "n": return "\n"
                  case "r": return "\r"
                  case "t": return "\t"
                  case "0": return "\0"
                  case '"': return '"'
                  case "\\": return "\\"
                  default: return ch
                }
              })
            } else {
              // Single-quoted: '' → ' unescape
              itemVal = (itemVal as string).replace(/''/g, "'")
            }
          }
        }
        // Type-coerce unquoted block array items (consistent with inline arrays)
        if (typeof itemVal === "string") {
          const t = itemVal as string
          const isQuoted = itemMatch[1]!.trim().startsWith('"') || itemMatch[1]!.trim().startsWith("'")
          if (!isQuoted) {
            if (/^(null|Null|NULL|~)$/.test(t)) itemVal = null
            else if (/^(true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/.test(t)) {
              const lower = t.toLowerCase()
              itemVal = (lower === "true" || lower === "yes" || lower === "on")
            }
            else if (/^-?\d+$/.test(t)) itemVal = parseInt(t, 10)
            else if (/^-?\d+\.\d+$/.test(t)) itemVal = parseFloat(t)
          }
        }
        ;(parsed[currentKey] as unknown[]).push(itemVal)
      }
    } else if (currentKey && line.match(/^\s*-\s*$/)) {
      // Empty array item (bare "- " or "-") → null (YAML spec: empty sequence entry is null)
      if (Array.isArray(parsed[currentKey])) {
        ;(parsed[currentKey] as unknown[]).push(null)
      }
    }
  }

  return { frontmatter: yamlStr, body, parsed }
}

/**
 * Extract the title from markdown content: first H1 heading or filename.
 */
const extractTitle = (content: string, filename: string): string => {
  const match = content.match(/^#\s+(.+)$/m)
  if (match) {
    return match[1]!.trim()
      // Strip wikilinks: [[page|alias]] → alias, [[page]] → page
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      // Strip markdown links: [text](url) → text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Strip inline formatting: **bold**, *italic*, `code`, __underline__, _italic_, ~~strike~~
      .replace(/(\*{1,2}|_{1,2}|`|~~)(.+?)\1/g, "$2")
      .trim()
  }
  return basename(filename, extname(filename))
}

/**
 * Parse wikilinks from markdown body: [[page]] or [[page|alias]]
 * Strips #heading fragments so link resolution works against file paths.
 * Strips fenced code blocks and inline code first to avoid phantom links.
 */
const parseWikilinks = (body: string): string[] => {
  // Strip fenced code blocks (```...```, ````...````, etc.) and inline code (`...`) to avoid phantom links
  const stripped = body
    .replace(/`{3,}[\s\S]*?`{3,}/g, "")
    .replace(/`[^`\n]+`/g, "")

  const links: string[] = []
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
  let match
  while ((match = regex.exec(stripped)) !== null) {
    // Strip #heading fragment for link resolution
    const ref = match[1]!.trim().replace(/#.*$/, "").trim()
    if (ref.length > 0) {
      links.push(ref)
    }
  }
  return links
}

/**
 * Recursively find all .md files in a directory.
 * Includes depth limit and symlink guard to prevent infinite recursion.
 */
const findMarkdownFiles = async (dir: string, depth = 0): Promise<string[]> => {
  if (depth > MAX_DIRECTORY_DEPTH) return []
  const files: string[] = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    // Skip symlinks entirely to prevent cycles
    if (entry.isSymbolicLink()) continue
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
      files.push(...await findMarkdownFiles(fullPath, depth + 1))
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath)
    }
  }
  return files
}

/**
 * Serialize frontmatter to YAML string with proper quoting.
 */
const serializeFrontmatter = (data: Record<string, unknown>): string => {
  const lines: string[] = []
  for (const [key, value] of Object.entries(data)) {
    // Skip undefined values (prevents serializing as literal "undefined")
    if (value === undefined) continue
    if (Array.isArray(value)) {
      // Filter only undefined; preserve null items as bare `null` keyword
      const safe = value.filter(v => v !== undefined)
      if (safe.length === 0) {
        lines.push(`${key}: []`)
      } else {
        lines.push(`${key}: [${safe.map(v =>
          v === null ? "null" :
          (typeof v === "boolean" || typeof v === "number") ? String(v) : yamlQuoteItem(String(v))
        ).join(", ")}]`)
      }
    } else if (value === null) {
      // Emit bare null to preserve YAML semantics on round-trip (not quoted "null")
      lines.push(`${key}: null`)
    } else if (typeof value === "boolean" || typeof value === "number") {
      // Emit native booleans/numbers bare (no quoting) to preserve YAML semantics on round-trip
      lines.push(`${key}: ${String(value)}`)
    } else if (typeof value === "object") {
      // Serialize nested objects as JSON to prevent "[object Object]" corruption
      lines.push(`${key}: ${yamlQuote(JSON.stringify(value))}`)
    } else {
      lines.push(`${key}: ${yamlQuote(String(value))}`)
    }
  }
  return lines.join("\n")
}

/**
 * Validate that a resolved path is contained within the given root directory.
 * Prevents path traversal attacks.
 */
const assertPathContainment = (filePath: string, rootDir: string): boolean => {
  const resolvedFile = resolve(filePath)
  const resolvedRoot = resolve(rootDir)
  return resolvedFile.startsWith(resolvedRoot + "/") || resolvedFile === resolvedRoot
}

/**
 * Atomically write a file by writing to a temp file then renaming.
 * POSIX rename() is atomic on the same filesystem, preventing partial writes
 * from corrupting the file on crash.
 */
const atomicWriteFile = async (filePath: string, content: string): Promise<void> => {
  const tmpPath = `${filePath}.${randomBytes(6).toString("hex")}.tmp`
  await writeFile(tmpPath, content, "utf-8")
  try {
    await rename(tmpPath, filePath)
  } catch (err) {
    // Clean up orphaned temp file on rename failure
    await unlink(tmpPath).catch(() => {})
    return Promise.reject(err)
  }
}

// =============================================================================
// MemoryService
// =============================================================================

export class MemoryService extends Context.Tag("MemoryService")<
  MemoryService,
  {
    // Source management
    readonly addSource: (dir: string, label?: string) => Effect.Effect<MemorySource, DatabaseError | ValidationError>
    readonly removeSource: (dir: string) => Effect.Effect<void, DatabaseError | MemorySourceNotFoundError>
    readonly listSources: () => Effect.Effect<readonly MemorySource[], DatabaseError>

    // File creation
    readonly createDocument: (input: CreateMemoryDocumentInput) => Effect.Effect<MemoryDocument, DatabaseError | ValidationError>

    // Metadata editing
    readonly updateFrontmatter: (id: string, updates: { addTags?: readonly string[]; removeTags?: readonly string[]; addRelated?: readonly string[] }) => Effect.Effect<MemoryDocument, DatabaseError | MemoryDocumentNotFoundError | ValidationError>

    // Properties
    readonly setProperty: (id: string, key: string, value: string) => Effect.Effect<void, DatabaseError | MemoryDocumentNotFoundError | ValidationError>
    readonly getProperties: (id: string) => Effect.Effect<readonly MemoryProperty[], DatabaseError>
    readonly removeProperty: (id: string, key: string) => Effect.Effect<void, DatabaseError | MemoryDocumentNotFoundError | ValidationError>

    // Indexing
    readonly index: (options?: { incremental?: boolean }) => Effect.Effect<{ indexed: number; skipped: number; removed: number }, DatabaseError>
    readonly indexStatus: () => Effect.Effect<MemoryIndexStatus, DatabaseError>

    // Search
    readonly search: (query: string, options?: MemorySearchOptions) => Effect.Effect<readonly MemoryDocumentWithScore[], DatabaseError>
    readonly getDocument: (id: string) => Effect.Effect<MemoryDocument, DatabaseError | MemoryDocumentNotFoundError>
    readonly getLinks: (id: string) => Effect.Effect<readonly MemoryLink[], DatabaseError>
    readonly getBacklinks: (id: string) => Effect.Effect<readonly MemoryLink[], DatabaseError>
    readonly addLink: (sourceId: string, targetRef: string) => Effect.Effect<void, DatabaseError | MemoryDocumentNotFoundError>
    readonly listDocuments: (filter?: { source?: string; tags?: readonly string[] }) => Effect.Effect<readonly MemoryDocument[], DatabaseError>
  }
>() {}

export const MemoryServiceLive = Layer.effect(
  MemoryService,
  Effect.gen(function* () {
    const docRepo = yield* MemoryDocumentRepository
    const linkRepo = yield* MemoryLinkRepository
    const propRepo = yield* MemoryPropertyRepository
    const sourceRepo = yield* MemorySourceRepository

    /**
     * Validate that a file path is safely within its root directory.
     */
    const validateFilePath = (filePath: string, rootDir: string) =>
      Effect.gen(function* () {
        if (!assertPathContainment(filePath, rootDir)) {
          yield* Effect.fail(new ValidationError({ reason: `Path "${filePath}" escapes root directory "${rootDir}"` }))
        }
      })

    /**
     * Index a single markdown file. Accepts optional cached content to avoid double reads.
     *
     * CRASH SAFETY: Uses a two-phase hash write pattern. The document is initially upserted
     * with fileHash="" (sentinel). Links and properties are written next. Only after all
     * three steps complete is the real hash set via updateFileHash(). If a crash occurs
     * between steps, incremental mode sees hash="" ≠ real hash → re-indexes the file.
     * This prevents the stale-hash bug where a partially-indexed file is permanently
     * skipped by incremental indexing.
     */
    /** Maximum file size to index (10MB). Larger files are skipped to prevent OOM. */
    const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

    const indexFile = (filePath: string, rootDir: string, cachedContent?: string): Effect.Effect<boolean, DatabaseError> =>
      Effect.gen(function* () {
        // Path containment check: skip files that escape the root directory
        if (!assertPathContainment(filePath, rootDir)) {
          return false
        }

        // Check file size BEFORE reading to prevent OOM on very large files
        const fileStat = yield* Effect.tryPromise({
          try: () => stat(filePath),
          catch: (cause) => new DatabaseError({ cause })
        })
        if (fileStat.size > MAX_FILE_SIZE_BYTES) {
          return false // Skip oversized files
        }

        const content = cachedContent ?? (yield* Effect.tryPromise({
          try: () => readFile(filePath, "utf-8"),
          catch: (cause) => new DatabaseError({ cause })
        }))

        // Guard: skip binary files (null byte in first 8KB is a definitive signal)
        if (content.slice(0, 8192).includes("\0")) {
          return false
        }

        const relativePath = relative(rootDir, filePath)
        const fileHash = createHash("sha256").update(content).digest("hex")
        const docId = generateDocId(relativePath, rootDir)

        const { body, parsed: parsedFm } = parseFrontmatter(content)
        const title = extractTitle(body || content, basename(filePath))
        // Coerce tag/related items to strings: block array coercion may produce booleans/numbers/null
        const tags = parsedFm && Array.isArray(parsedFm.tags)
          ? (parsedFm.tags as unknown[]).filter(t => t != null).map(t => String(t))
          : []
        const related = parsedFm && Array.isArray(parsedFm.related)
          ? (parsedFm.related as unknown[]).filter(t => t != null).map(t => String(t))
          : []

        const now = new Date().toISOString()
        const createdAt = (parsedFm && typeof parsedFm.created === "string") ? parsedFm.created : fileStat.mtime.toISOString()

        // Phase 1: Upsert with empty hash sentinel (marks "indexing in progress")
        yield* docRepo.upsertDocument({
          id: docId,
          filePath: relativePath,
          rootDir,
          title,
          content,
          frontmatter: parsedFm ? JSON.stringify(parsedFm) : null,
          tags: tags.length > 0 ? JSON.stringify(tags) : null,
          fileHash: "",
          fileMtime: fileStat.mtime.toISOString(),
          createdAt,
          indexedAt: now,
        })

        // Phase 2: Parse and store links (use body, not full content, to avoid wikilinks inside frontmatter/code blocks)
        yield* linkRepo.deleteBySource(docId)
        const wikilinks = parseWikilinks(body || content)
        const allLinks: { sourceDocId: string; targetRef: string; linkType: string }[] = [
          ...wikilinks.map(ref => ({ sourceDocId: docId, targetRef: ref, linkType: "wikilink" as const })),
          ...related.map(ref => ({ sourceDocId: docId, targetRef: ref, linkType: "frontmatter" as const })),
        ]
        if (allLinks.length > 0) {
          yield* linkRepo.insertLinks(allLinks)
        }

        // Sync properties from frontmatter (non-reserved keys).
        // Always call syncFromFrontmatter even when parsedFm is null to clear stale properties.
        // Stringify non-string primitives (booleans, numbers) so they're queryable via --prop.
        const properties: Record<string, string> = {}
        if (parsedFm) {
          for (const [key, value] of Object.entries(parsedFm)) {
            if (RESERVED_FRONTMATTER_KEYS.has(key)) continue
            if (value === null || value === undefined) continue
            if (Array.isArray(value) || typeof value === "object") continue
            properties[key] = String(value)
          }
        }
        yield* propRepo.syncFromFrontmatter(docId, properties)

        // Phase 3: Set real hash — only after links + properties are fully written.
        // Incremental mode checks this hash; empty sentinel ≠ real hash → re-index.
        yield* docRepo.updateFileHash(docId, fileHash)

        return true
      })

    return {
      addSource: (dir, label) =>
        Effect.gen(function* () {
          const absDir = resolve(dir)
          // Verify directory exists before registering
          const dirStat = yield* Effect.tryPromise({
            try: () => stat(absDir),
            catch: () => new ValidationError({ reason: `Directory does not exist: ${absDir}` })
          })
          if (!dirStat.isDirectory()) {
            return yield* Effect.fail(new ValidationError({ reason: `Not a directory: ${absDir}` }))
          }
          return yield* sourceRepo.addSource(absDir, label)
        }),

      removeSource: (dir) =>
        Effect.gen(function* () {
          const absDir = resolve(dir)
          const source = yield* sourceRepo.findSource(absDir)
          if (!source) {
            yield* Effect.fail(new MemorySourceNotFoundError({ rootDir: absDir }))
          }
          // Atomic: nulls incoming links → deletes docs → deletes source in one transaction
          yield* sourceRepo.removeSource(absDir)
        }),

      listSources: () => sourceRepo.listSources(),

      createDocument: (input) =>
        Effect.gen(function* () {
          // Validate title produces a non-empty slug
          const slug = slugify(input.title)
          if (slug.length === 0) {
            return yield* Effect.fail(new ValidationError({
              reason: `Title "${input.title}" produces an empty filename after slugification`
            }))
          }

          // Determine target directory
          const sources = yield* sourceRepo.listSources()
          const targetDir = input.dir ? resolve(input.dir) : (sources[0]?.rootDir ?? resolve(".tx", "memory"))

          // Resolve rootDir: find the registered source that contains targetDir
          // (important when targetDir is a subdirectory of a source)
          let matchingSource = sources.find(s =>
            targetDir.startsWith(s.rootDir + "/") || targetDir === s.rootDir
          )

          // Validate target directory is within a registered source (if dir was explicitly provided)
          if (input.dir && !matchingSource) {
            return yield* Effect.fail(new ValidationError({
              reason: `Directory "${targetDir}" is not within any registered memory source`
            }))
          }

          // Auto-register fallback directory as a source so documents survive future index() runs
          // (without this, docs created in an unregistered dir become ghosts)
          if (!matchingSource) {
            matchingSource = yield* sourceRepo.addSource(targetDir, "auto")
          }

          // Use the matching source's rootDir for proper relative path calculation
          const rootDir = matchingSource.rootDir

          // Ensure directory exists
          yield* Effect.tryPromise({
            try: () => mkdir(targetDir, { recursive: true }),
            catch: (cause) => new DatabaseError({ cause })
          })

          // Generate filename
          const filename = `${slug}.md`
          const filePath = join(targetDir, filename)

          // Check if file already exists to prevent silent overwrite
          const fileExists = yield* Effect.tryPromise({
            try: async () => {
              try {
                await stat(filePath)
                return true
              } catch {
                return false
              }
            },
            catch: (cause) => new DatabaseError({ cause })
          })
          if (fileExists) {
            return yield* Effect.fail(new ValidationError({
              reason: `File already exists: ${filePath}`
            }))
          }

          // Build content with frontmatter
          const fmData: Record<string, unknown> = {}
          if (input.tags && input.tags.length > 0) fmData.tags = [...input.tags]
          fmData.created = new Date().toISOString()
          if (input.properties) {
            for (const [key, value] of Object.entries(input.properties)) {
              if (RESERVED_FRONTMATTER_KEYS.has(key)) {
                return yield* Effect.fail(new ValidationError({
                  reason: `Property key "${key}" is reserved; use the tags/content fields instead`
                }))
              }
              fmData[key] = value
            }
          }

          let fileContent = ""
          if (Object.keys(fmData).length > 0) {
            fileContent += `---\n${serializeFrontmatter(fmData)}\n---\n\n`
          }
          fileContent += `# ${input.title}\n\n${input.content ?? ""}\n`

          // Write file atomically (temp + rename prevents partial writes on crash)
          yield* Effect.tryPromise({
            try: () => atomicWriteFile(filePath, fileContent),
            catch: (cause) => new DatabaseError({ cause })
          })

          // Index the new file using the resolved rootDir
          yield* indexFile(filePath, rootDir, fileContent)

          // Return the indexed document
          const relativePath = relative(rootDir, filePath)
          const docId = generateDocId(relativePath, rootDir)
          const doc = yield* docRepo.findById(docId)
          if (!doc) {
            return yield* Effect.fail(new DatabaseError({ cause: new Error("Document not found after indexing") }))
          }
          return doc
        }),

      updateFrontmatter: (id, updates) =>
        Effect.gen(function* () {
          const doc = yield* docRepo.findById(id)
          if (!doc) {
            return yield* Effect.fail(new MemoryDocumentNotFoundError({ id }))
          }

          const filePath = join(doc.rootDir, doc.filePath)
          yield* validateFilePath(filePath, doc.rootDir)

          const content = yield* Effect.tryPromise({
            try: () => readFile(filePath, "utf-8"),
            catch: (cause) => new DatabaseError({ cause })
          })

          const { parsed: parsedFm, body } = parseFrontmatter(content)
          const fm = parsedFm ?? {}

          // Update tags: coerce to strings (block array coercion may produce booleans/numbers)
          // and filter empty/whitespace-only tags to prevent "" entries in frontmatter
          let tags = Array.isArray(fm.tags)
            ? (fm.tags as unknown[]).filter(t => t != null).map(t => String(t))
            : []
          if (updates.addTags) {
            for (const tag of updates.addTags) {
              if (tag.trim().length === 0) continue
              if (!tags.includes(tag)) tags.push(tag)
            }
          }
          if (updates.removeTags) {
            tags = tags.filter((t: string) => !updates.removeTags!.includes(t))
          }
          fm.tags = tags

          // Update related
          if (updates.addRelated) {
            const related = Array.isArray(fm.related) ? [...fm.related as string[]] : []
            for (const ref of updates.addRelated) {
              if (!related.includes(ref)) related.push(ref)
            }
            fm.related = related
          }

          // Rewrite file atomically
          const newContent = `---\n${serializeFrontmatter(fm)}\n---\n${body}`
          yield* Effect.tryPromise({
            try: () => atomicWriteFile(filePath, newContent),
            catch: (cause) => new DatabaseError({ cause })
          })

          // Re-index
          yield* indexFile(filePath, doc.rootDir, newContent)
          const updated = yield* docRepo.findById(id)
          if (!updated) {
            return yield* Effect.fail(new MemoryDocumentNotFoundError({ id }))
          }
          return updated
        }),

      setProperty: (id, key, value) =>
        Effect.gen(function* () {
          // Guard reserved frontmatter keys
          if (RESERVED_FRONTMATTER_KEYS.has(key)) {
            return yield* Effect.fail(new ValidationError({
              reason: `Key "${key}" is reserved; use updateFrontmatter to modify tags/related/created`
            }))
          }
          // Validate key format: must be a valid YAML bare key (letters, digits, dots, hyphens)
          // Keys with colons, slashes, newlines etc. corrupt frontmatter on round-trip
          if (!/^\w[\w.-]*$/.test(key)) {
            return yield* Effect.fail(new ValidationError({
              reason: `Property key "${key}" contains invalid characters. Keys must match [a-zA-Z0-9_][a-zA-Z0-9_.-]*`
            }))
          }

          const doc = yield* docRepo.findById(id)
          if (!doc) {
            return yield* Effect.fail(new MemoryDocumentNotFoundError({ id }))
          }

          // Write file first (filesystem is source of truth — if this fails, DB stays consistent)
          const filePath = join(doc.rootDir, doc.filePath)
          yield* validateFilePath(filePath, doc.rootDir)

          const content = yield* Effect.tryPromise({
            try: () => readFile(filePath, "utf-8"),
            catch: (cause) => new DatabaseError({ cause })
          })

          const { parsed: parsedFm, body } = parseFrontmatter(content)
          const hadFrontmatter = parsedFm !== null
          const fm = parsedFm ?? {}
          fm[key] = value

          // When adding frontmatter to a file that had none, ensure blank line separator
          const separator = hadFrontmatter ? "" : "\n"
          const newContent = `---\n${serializeFrontmatter(fm)}\n---\n${separator}${body}`
          yield* Effect.tryPromise({
            try: () => atomicWriteFile(filePath, newContent),
            catch: (cause) => new DatabaseError({ cause })
          })

          // Re-index to keep DB hash/frontmatter/content in sync (same pattern as updateFrontmatter)
          yield* indexFile(filePath, doc.rootDir, newContent)
        }),

      getProperties: (id) => propRepo.getProperties(id),

      removeProperty: (id, key) =>
        Effect.gen(function* () {
          // Guard reserved frontmatter keys
          if (RESERVED_FRONTMATTER_KEYS.has(key)) {
            return yield* Effect.fail(new ValidationError({
              reason: `Key "${key}" is reserved; use updateFrontmatter to modify tags/related/created`
            }))
          }

          const doc = yield* docRepo.findById(id)
          if (!doc) {
            return yield* Effect.fail(new MemoryDocumentNotFoundError({ id }))
          }

          // Write file first (filesystem is source of truth — if this fails, DB stays consistent)
          const filePath = join(doc.rootDir, doc.filePath)
          yield* validateFilePath(filePath, doc.rootDir)

          const content = yield* Effect.tryPromise({
            try: () => readFile(filePath, "utf-8"),
            catch: (cause) => new DatabaseError({ cause })
          })

          const { parsed: parsedFm, body } = parseFrontmatter(content)
          if (parsedFm && key in parsedFm) {
            delete parsedFm[key]
            // Only write frontmatter block if there are remaining keys; otherwise write body only
            const newContent = Object.keys(parsedFm).length > 0
              ? `---\n${serializeFrontmatter(parsedFm)}\n---\n${body}`
              : body
            yield* Effect.tryPromise({
              try: () => atomicWriteFile(filePath, newContent),
              catch: (cause) => new DatabaseError({ cause })
            })

            // Re-index to keep DB hash/frontmatter/content in sync
            yield* indexFile(filePath, doc.rootDir, newContent)
          } else {
            // Key not in frontmatter — just delete from DB if it exists
            yield* propRepo.deleteProperty(id, key)
          }
        }),

      index: (options) =>
        Effect.gen(function* () {
          const sources = yield* sourceRepo.listSources()
          let indexed = 0
          let skipped = 0
          let removed = 0

          for (const source of sources) {
            const existingPaths = new Set(yield* docRepo.listPathsByRootDir(source.rootDir))

            // Find all .md files (gracefully handle deleted source directories)
            const files = yield* Effect.tryPromise({
              try: () => findMarkdownFiles(source.rootDir),
              catch: (cause) => new DatabaseError({ cause })
            }).pipe(Effect.catchAll(() => Effect.succeed([] as string[])))

            for (const filePath of files) {
              const relativePath = relative(source.rootDir, filePath)

              // Wrap each file in catchAll so a single unreadable file
              // (permission denied, encoding error, etc.) doesn't abort the entire run.
              const fileResult = yield* Effect.gen(function* () {
                if (options?.incremental) {
                  // Check file size BEFORE reading to prevent OOM on large files
                  const fileStat = yield* Effect.tryPromise({
                    try: () => stat(filePath),
                    catch: (cause) => new DatabaseError({ cause })
                  })
                  if (fileStat.size > 10 * 1024 * 1024) {
                    return "skipped" as const // Skip oversized files (>10MB)
                  }
                  // Read file once for hash check; pass cached content to indexFile to avoid double read
                  const content = yield* Effect.tryPromise({
                    try: () => readFile(filePath, "utf-8"),
                    catch: (cause) => new DatabaseError({ cause })
                  })
                  const fileHash = createHash("sha256").update(content).digest("hex")
                  const existing = yield* docRepo.findByPath(relativePath, source.rootDir)
                  if (existing && existing.fileHash === fileHash) {
                    return "skipped" as const
                  }
                  // File changed — index with cached content (no double read)
                  yield* indexFile(filePath, source.rootDir, content)
                } else {
                  yield* indexFile(filePath, source.rootDir)
                }
                return "indexed" as const
              }).pipe(Effect.catchAll(() => Effect.succeed("error" as const)))

              // Only remove from "needs cleanup" set on success — if file read failed
              // (TOCTOU: deleted between listing and reading), keep the path in the set
              // so its stale DB entry is cleaned up in the deletion pass below.
              if (fileResult !== "error") {
                existingPaths.delete(relativePath)
              }

              if (fileResult === "indexed") indexed++
              else if (fileResult === "skipped") skipped++
              // "error" — silently skip; stale DB entry will be cleaned up below
            }

            // Remove docs for deleted files
            const deletedPaths = [...existingPaths]
            if (deletedPaths.length > 0) {
              const count = yield* docRepo.deleteByPaths(source.rootDir, deletedPaths)
              removed += count
            }
          }

          // Resolve link targets
          yield* linkRepo.resolveTargets()

          return { indexed, skipped, removed }
        }),

      indexStatus: () =>
        Effect.gen(function* () {
          const sources = yield* sourceRepo.listSources()
          const totalDocs = yield* docRepo.count()
          const embedded = yield* docRepo.countWithEmbeddings()
          const links = yield* linkRepo.count()

          // Count total .md files across all sources (skip sources whose dirs were deleted)
          // Also count files not yet in DB (new) and DB entries with no file on disk (orphaned)
          let totalFiles = 0
          let notIndexed = 0
          for (const source of sources) {
            const files = yield* Effect.tryPromise({
              try: () => findMarkdownFiles(source.rootDir),
              catch: (cause) => new DatabaseError({ cause })
            }).pipe(Effect.catchAll(() => Effect.succeed([] as string[])))
            totalFiles += files.length
            // Count files not yet in DB
            const indexedPaths = new Set(yield* docRepo.listPathsByRootDir(source.rootDir))
            for (const filePath of files) {
              const rel = relative(source.rootDir, filePath)
              if (!indexedPaths.has(rel)) notIndexed++
            }
          }

          return {
            totalFiles,
            indexed: totalDocs,
            stale: notIndexed,
            embedded,
            links,
            sources: sources.length,
          }
        }),

      search: (query, options) =>
        Effect.gen(function* () {
          const limit = Math.max(1, options?.limit ?? 10)
          const minScore = options?.minScore ?? 0

          // Fetch extra rows when minScore filtering is active to avoid undercounting
          const fetchLimit = minScore > 0 ? limit * 3 : limit

          // BM25 search
          let bm25Results = yield* docRepo.searchBM25(query, fetchLimit)

          // Filter by tags if specified (case-insensitive)
          if (options?.tags && options.tags.length > 0) {
            const tagFilterLower = options.tags.map((t: string) => t.toLowerCase())
            bm25Results = bm25Results.filter(r =>
              tagFilterLower.every((t: string) => r.document.tags.some((rt: string) => rt.toLowerCase() === t))
            )
          }

          // Filter by properties if specified
          if (options?.props && options.props.length > 0) {
            for (const propFilter of options.props) {
              const eqIdx = propFilter.indexOf("=")
              const key = eqIdx >= 0 ? propFilter.slice(0, eqIdx) : propFilter
              const value = eqIdx >= 0 ? propFilter.slice(eqIdx + 1) : undefined
              if (!key || key.trim().length === 0) continue
              const matchingDocIds = new Set(yield* propRepo.findByProperty(key.trim(), value))
              bm25Results = bm25Results.filter(r => matchingDocIds.has(r.document.id))
            }
          }

          // Recency scoring: 30-day decay (same weight as retriever for consistent scores)
          const RECENCY_WEIGHT = 0.1
          const now = Date.now()
          const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

          // Convert to scored results with recency blend matching retriever formula
          const results: MemoryDocumentWithScore[] = bm25Results
            .map((r, rank) => {
              const mtimeMs = new Date(r.document.fileMtime).getTime()
              // Clamp future-dated files to now (prevents negative age / score > 1)
              const safeMs = isNaN(mtimeMs) ? now : mtimeMs
              const ageMs = Math.max(0, now - Math.min(safeMs, now))
              const recencyScore = Math.max(0, 1.0 - (ageMs / THIRTY_DAYS_MS))

              // Blend BM25 + recency using same formula as retriever for consistent scores
              const relevanceScore = (1 - RECENCY_WEIGHT) * r.score + RECENCY_WEIGHT * recencyScore

              return {
                ...r.document,
                relevanceScore,
                bm25Score: r.score,
                vectorScore: 0,
                rrfScore: 0, // No RRF fusion in BM25-only path; 0 indicates single-list mode
                recencyScore,
                bm25Rank: rank + 1,
                vectorRank: 0,
              }
            })
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .filter(r => r.relevanceScore >= minScore)
            .slice(0, limit)

          return results
        }),

      getDocument: (id) =>
        Effect.gen(function* () {
          const doc = yield* docRepo.findById(id)
          if (!doc) {
            return yield* Effect.fail(new MemoryDocumentNotFoundError({ id }))
          }
          return doc
        }),

      getLinks: (id) => linkRepo.findOutgoing(id),

      getBacklinks: (id) => linkRepo.findIncoming(id),

      addLink: (sourceId, targetRef) =>
        Effect.gen(function* () {
          // Validate source document exists to prevent phantom links
          const doc = yield* docRepo.findById(sourceId)
          if (!doc) {
            return yield* Effect.fail(new MemoryDocumentNotFoundError({ id: sourceId }))
          }
          yield* linkRepo.insertExplicit(sourceId, targetRef)
        }),

      listDocuments: (filter) =>
        docRepo.listAll(filter ? { rootDir: filter.source, tags: filter.tags ? [...filter.tags] : undefined } : undefined),
    }
  })
)
