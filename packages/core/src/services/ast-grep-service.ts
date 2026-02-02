import { Context, Effect, Layer } from "effect"
import { spawn } from "child_process"
import { AstGrepError } from "../errors.js"
import type { SymbolInfo, ImportInfo, Match, SymbolKind, SymbolPattern } from "@tx/types"

/**
 * File extension to ast-grep language mapping.
 * Covers TypeScript, JavaScript, Python, Go, Rust, Java, C#, Ruby, PHP, Kotlin, Swift, C/C++.
 */
export const EXT_TO_LANGUAGE: Readonly<Record<string, string>> = {
  // TypeScript
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  // JavaScript
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  // Python
  ".py": "python",
  ".pyw": "python",
  // Go
  ".go": "go",
  // Rust
  ".rs": "rust",
  // Java
  ".java": "java",
  // C#
  ".cs": "csharp",
  // Ruby
  ".rb": "ruby",
  // PHP
  ".php": "php",
  // Kotlin
  ".kt": "kotlin",
  ".kts": "kotlin",
  // Swift
  ".swift": "swift",
  // C
  ".c": "c",
  ".h": "c",
  // C++
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
}

/**
 * Default symbol patterns for each supported language.
 * These patterns are used by ast-grep to extract symbols from source files.
 * Following DD-014 specification.
 */
export const DEFAULT_SYMBOL_PATTERNS: Readonly<Record<string, readonly SymbolPattern[]>> = {
  // TypeScript / JavaScript
  typescript: [
    { pattern: "export function $NAME($_) { $$$_ }", kind: "function", exported: true },
    { pattern: "export const $NAME = ($_) => $$$_", kind: "function", exported: true },
    { pattern: "export class $NAME { $$$_ }", kind: "class", exported: true },
    { pattern: "export interface $NAME { $$$_ }", kind: "interface", exported: true },
    { pattern: "export type $NAME = $_", kind: "type", exported: true },
    { pattern: "export const $NAME = $_", kind: "const", exported: true },
    { pattern: "function $NAME($_) { $$$_ }", kind: "function" },
    { pattern: "class $NAME { $$$_ }", kind: "class" },
  ],
  javascript: [
    { pattern: "export function $NAME($_) { $$$_ }", kind: "function", exported: true },
    { pattern: "export const $NAME = ($_) => $$$_", kind: "function", exported: true },
    { pattern: "export class $NAME { $$$_ }", kind: "class", exported: true },
    { pattern: "module.exports.$NAME = $_", kind: "function", exported: true },
    { pattern: "function $NAME($_) { $$$_ }", kind: "function" },
    { pattern: "class $NAME { $$$_ }", kind: "class" },
  ],

  // Python
  python: [
    { pattern: "def $NAME($_): $$$_", kind: "function" },
    { pattern: "async def $NAME($_): $$$_", kind: "function" },
    { pattern: "class $NAME: $$$_", kind: "class" },
    { pattern: "class $NAME($_): $$$_", kind: "class" },
  ],

  // Go
  go: [
    { pattern: "func $NAME($_) $_ { $$$_ }", kind: "function" },
    { pattern: "func ($_ $_) $NAME($_) $_ { $$$_ }", kind: "method" },
    { pattern: "type $NAME struct { $$$_ }", kind: "struct" },
    { pattern: "type $NAME interface { $$$_ }", kind: "interface" },
  ],

  // Rust
  rust: [
    { pattern: "pub fn $NAME($_) $$$_ { $$$_ }", kind: "function", exported: true },
    { pattern: "fn $NAME($_) $$$_ { $$$_ }", kind: "function" },
    { pattern: "pub struct $NAME { $$$_ }", kind: "struct", exported: true },
    { pattern: "struct $NAME { $$$_ }", kind: "struct" },
    { pattern: "pub enum $NAME { $$$_ }", kind: "enum", exported: true },
    { pattern: "pub trait $NAME { $$$_ }", kind: "trait", exported: true },
    { pattern: "impl $NAME { $$$_ }", kind: "class" },
  ],

  // Java
  java: [
    { pattern: "public class $NAME { $$$_ }", kind: "class", exported: true },
    { pattern: "public interface $NAME { $$$_ }", kind: "interface", exported: true },
    { pattern: "public enum $NAME { $$$_ }", kind: "enum", exported: true },
    { pattern: "public $_ $NAME($_) { $$$_ }", kind: "method", exported: true },
    { pattern: "private $_ $NAME($_) { $$$_ }", kind: "method" },
  ],

  // C#
  csharp: [
    { pattern: "public class $NAME { $$$_ }", kind: "class", exported: true },
    { pattern: "public interface $NAME { $$$_ }", kind: "interface", exported: true },
    { pattern: "public enum $NAME { $$$_ }", kind: "enum", exported: true },
    { pattern: "public $_ $NAME($_) { $$$_ }", kind: "method", exported: true },
    { pattern: "private $_ $NAME($_) { $$$_ }", kind: "method" },
    { pattern: "public struct $NAME { $$$_ }", kind: "struct", exported: true },
  ],

  // Ruby
  ruby: [
    { pattern: "def $NAME $$$_ end", kind: "method" },
    { pattern: "def self.$NAME $$$_ end", kind: "function" },
    { pattern: "class $NAME $$$_ end", kind: "class" },
    { pattern: "module $NAME $$$_ end", kind: "module" },
  ],

  // PHP
  php: [
    { pattern: "function $NAME($_) { $$$_ }", kind: "function" },
    { pattern: "public function $NAME($_) { $$$_ }", kind: "method", exported: true },
    { pattern: "class $NAME { $$$_ }", kind: "class" },
    { pattern: "interface $NAME { $$$_ }", kind: "interface" },
    { pattern: "trait $NAME { $$$_ }", kind: "trait" },
  ],

  // Kotlin
  kotlin: [
    { pattern: "fun $NAME($_): $_ { $$$_ }", kind: "function" },
    { pattern: "class $NAME { $$$_ }", kind: "class" },
    { pattern: "data class $NAME($_)", kind: "class" },
    { pattern: "interface $NAME { $$$_ }", kind: "interface" },
    { pattern: "object $NAME { $$$_ }", kind: "class" },
  ],

  // Swift
  swift: [
    { pattern: "func $NAME($_) $$$_ { $$$_ }", kind: "function" },
    { pattern: "class $NAME { $$$_ }", kind: "class" },
    { pattern: "struct $NAME { $$$_ }", kind: "struct" },
    { pattern: "protocol $NAME { $$$_ }", kind: "interface" },
    { pattern: "enum $NAME { $$$_ }", kind: "enum" },
  ],

  // C
  c: [
    { pattern: "$_ $NAME($_) { $$$_ }", kind: "function" },
    { pattern: "struct $NAME { $$$_ }", kind: "struct" },
    { pattern: "typedef struct { $$$_ } $NAME", kind: "struct" },
    { pattern: "enum $NAME { $$$_ }", kind: "enum" },
  ],

  // C++
  cpp: [
    { pattern: "$_ $NAME($_) { $$$_ }", kind: "function" },
    { pattern: "class $NAME { $$$_ }", kind: "class" },
    { pattern: "struct $NAME { $$$_ }", kind: "struct" },
    { pattern: "namespace $NAME { $$$_ }", kind: "module" },
    { pattern: "template<$_> class $NAME { $$$_ }", kind: "class" },
  ],
}

/**
 * AstGrepService provides code intelligence via ast-grep CLI.
 *
 * This service extracts symbols, imports, and matches patterns from source files
 * using structural code analysis. It gracefully degrades when ast-grep is not
 * installed by providing a Noop fallback.
 *
 * Design: Following DD-014 specification for symbol extraction.
 */
export class AstGrepService extends Context.Tag("AstGrepService")<
  AstGrepService,
  {
    /**
     * Find all symbols (functions, classes, interfaces, etc.) in a file.
     * Returns empty array for unsupported file types.
     */
    readonly findSymbols: (filePath: string) => Effect.Effect<readonly SymbolInfo[], AstGrepError>
    /**
     * Extract import statements from a file.
     * Returns empty array for unsupported file types.
     */
    readonly getImports: (filePath: string) => Effect.Effect<readonly ImportInfo[], AstGrepError>
    /**
     * Match a custom ast-grep pattern against a file or directory.
     */
    readonly matchPattern: (pattern: string, path: string) => Effect.Effect<readonly Match[], AstGrepError>
  }
>() {}

/**
 * Get the language identifier for a file path based on extension.
 */
const getLanguage = (filePath: string): string | null => {
  const lastDot = filePath.lastIndexOf(".")
  if (lastDot === -1) return null
  const ext = filePath.slice(lastDot)
  return EXT_TO_LANGUAGE[ext] ?? null
}

/**
 * Get symbol patterns for a language.
 */
const getPatterns = (language: string): readonly SymbolPattern[] => {
  return DEFAULT_SYMBOL_PATTERNS[language] ?? []
}

/**
 * Run ast-grep CLI with given arguments.
 * Returns the stdout as a string.
 */
const runAstGrep = (args: readonly string[]): Effect.Effect<string, AstGrepError> =>
  Effect.async((resume) => {
    const proc = spawn("ast-grep", [...args], { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString()
    })
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on("close", (code) => {
      if (code !== 0 && code !== null) {
        resume(
          Effect.fail(
            new AstGrepError({
              reason: `ast-grep exited with code ${code}`,
              cause: stderr,
            })
          )
        )
      } else {
        resume(Effect.succeed(stdout))
      }
    })

    proc.on("error", (err) => {
      resume(
        Effect.fail(
          new AstGrepError({
            reason: "Failed to spawn ast-grep",
            cause: err,
          })
        )
      )
    })
  })

/**
 * Parse ast-grep JSON output to extract symbols.
 */
interface AstGrepMatch {
  readonly range?: {
    readonly start?: { readonly line?: number }
  }
  readonly metaVariables?: {
    readonly NAME?: { readonly text?: string }
  }
  readonly file?: string
  readonly text?: string
}

/**
 * Live implementation that spawns ast-grep CLI.
 * Requires ast-grep to be installed and available in PATH.
 */
export const AstGrepServiceLive = Layer.succeed(AstGrepService, {
  findSymbols: (filePath) =>
    Effect.gen(function* () {
      const language = getLanguage(filePath)
      if (!language) {
        return []
      }

      const patterns = getPatterns(language)
      const symbols: SymbolInfo[] = []

      for (const { pattern, kind, exported } of patterns) {
        const output = yield* runAstGrep(["--pattern", pattern, "--json", filePath]).pipe(
          Effect.catchAll(() => Effect.succeed("[]"))
        )

        let matches: AstGrepMatch[]
        try {
          matches = JSON.parse(output) as AstGrepMatch[]
        } catch {
          matches = []
        }

        for (const m of matches) {
          const name = m.metaVariables?.NAME?.text
          if (name) {
            symbols.push({
              name,
              kind: kind as SymbolKind,
              line: (m.range?.start?.line ?? 0) + 1, // Convert 0-indexed to 1-indexed
              exported: exported ?? false,
            })
          }
        }
      }

      return symbols
    }),

  getImports: (filePath) =>
    Effect.gen(function* () {
      const language = getLanguage(filePath)
      if (!language) {
        return []
      }

      // TypeScript/JavaScript import patterns
      const importPatterns: readonly string[] =
        language === "typescript" || language === "javascript"
          ? [
              'import { $$$SPECS } from "$SOURCE"',
              'import * as $ALIAS from "$SOURCE"',
              'import $DEFAULT from "$SOURCE"',
            ]
          : []

      const imports: ImportInfo[] = []

      for (const pattern of importPatterns) {
        const output = yield* runAstGrep(["--pattern", pattern, "--json", filePath]).pipe(
          Effect.catchAll(() => Effect.succeed("[]"))
        )

        interface ImportMatch {
          readonly metaVariables?: {
            readonly SOURCE?: { readonly text?: string }
            readonly SPECS?: { readonly text?: string }
            readonly ALIAS?: { readonly text?: string }
            readonly DEFAULT?: { readonly text?: string }
          }
        }

        let matches: ImportMatch[]
        try {
          matches = JSON.parse(output) as ImportMatch[]
        } catch {
          matches = []
        }

        for (const m of matches) {
          const source = m.metaVariables?.SOURCE?.text ?? ""
          if (!source) continue

          // Extract specifiers from different patterns
          const specsText = m.metaVariables?.SPECS?.text ?? ""
          const aliasText = m.metaVariables?.ALIAS?.text ?? ""
          const defaultText = m.metaVariables?.DEFAULT?.text ?? ""

          let specifiers: string[]
          if (specsText) {
            specifiers = specsText
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          } else if (aliasText) {
            specifiers = [`* as ${aliasText}`]
          } else if (defaultText) {
            specifiers = [defaultText]
          } else {
            specifiers = []
          }

          imports.push({
            source,
            specifiers,
            kind: "static",
          })
        }
      }

      return imports
    }),

  matchPattern: (pattern, path) =>
    Effect.gen(function* () {
      const output = yield* runAstGrep(["--pattern", pattern, "--json", path])

      interface PatternMatch {
        readonly file?: string
        readonly range?: {
          readonly start?: {
            readonly line?: number
            readonly column?: number
          }
        }
        readonly text?: string
        readonly metaVariables?: Record<string, { readonly text?: string }>
      }

      let matches: PatternMatch[]
      try {
        matches = JSON.parse(output) as PatternMatch[]
      } catch {
        return []
      }

      return matches.map((m) => ({
        file: m.file ?? path,
        line: (m.range?.start?.line ?? 0) + 1, // Convert 0-indexed to 1-indexed
        column: (m.range?.start?.column ?? 0) + 1,
        text: m.text ?? "",
        captures: Object.fromEntries(
          Object.entries(m.metaVariables ?? {}).map(([k, v]) => [k, v?.text ?? ""])
        ),
      }))
    }),
})

/**
 * Noop implementation that returns empty arrays.
 * Used when ast-grep is not installed or not available.
 */
export const AstGrepServiceNoop = Layer.succeed(AstGrepService, {
  findSymbols: () => Effect.succeed([]),
  getImports: () => Effect.succeed([]),
  matchPattern: () => Effect.succeed([]),
})

/**
 * Auto-detecting layer that uses Live if ast-grep is available, Noop otherwise.
 * This allows graceful degradation when ast-grep is not installed.
 */
export const AstGrepServiceAuto = Layer.unwrapEffect(
  Effect.gen(function* () {
    // Check if ast-grep is available by trying to run it
    const available = yield* Effect.async<boolean>((resume) => {
      const proc = spawn("ast-grep", ["--version"], { stdio: ["ignore", "pipe", "pipe"] })

      proc.on("close", (code) => {
        resume(Effect.succeed(code === 0))
      })

      proc.on("error", () => {
        resume(Effect.succeed(false))
      })
    })

    if (available) {
      return AstGrepServiceLive
    }
    return AstGrepServiceNoop
  })
)
