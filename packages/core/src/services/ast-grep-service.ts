import { Context, Effect, Layer } from "effect"
import { spawn } from "child_process"
import { AstGrepError } from "../errors.js"
import type { SymbolInfo, ImportInfo, Match, SymbolKind } from "@jamesaphoenix/tx-types"
import {
  parseAstGrepMatches,
  parseImportMatches,
  parsePatternMatches,
  getLanguage,
  getPatterns,
} from "./ast-grep-service/patterns.js"
export { EXT_TO_LANGUAGE, DEFAULT_SYMBOL_PATTERNS } from "./ast-grep-service/patterns.js"

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

        const matches = parseAstGrepMatches(output)

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

        const matches = parseImportMatches(output)

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

      const matches = parsePatternMatches(output)

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
