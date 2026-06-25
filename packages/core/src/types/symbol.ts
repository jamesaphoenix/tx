/**
 * Symbol extraction types for tx
 *
 * Type definitions for code intelligence and symbol extraction.
 * Used by ast-grep integration for structural code analysis.
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 * Schema definitions provide both compile-time types and runtime validation.
 */

import { Schema } from "effect"

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * All valid symbol kinds for code extraction.
 * Covers common constructs across TypeScript, Rust, Go, Python, etc.
 */
export const SYMBOL_KINDS = [
  "function",
  "class",
  "interface",
  "type",
  "const",
  "variable",
  "method",
  "struct",
  "enum",
  "trait",
  "module",
] as const;

/**
 * Import kind - static (import/require) or dynamic (import()).
 */
export const IMPORT_KINDS = ["static", "dynamic"] as const;

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/** Symbol kind - one of the valid code construct types. */
export const SymbolKindSchema = Schema.Literal(...SYMBOL_KINDS)
export type SymbolKind = typeof SymbolKindSchema.Type

/** Import kind schema. */
export const ImportKindSchema = Schema.Literal(...IMPORT_KINDS)
export type ImportKind = typeof ImportKindSchema.Type

/** Information about an extracted symbol. */
export const SymbolInfoSchema = Schema.Struct({
  /** Symbol name (e.g., function name, class name) */
  name: Schema.String,
  /** Kind of symbol */
  kind: SymbolKindSchema,
  /** Line number where the symbol is defined (1-indexed) */
  line: Schema.Number.pipe(Schema.int()),
  /** Whether the symbol is exported */
  exported: Schema.Boolean,
})
export type SymbolInfo = typeof SymbolInfoSchema.Type

/** Information about an import statement. */
export const ImportInfoSchema = Schema.Struct({
  /** Source module path or package name */
  source: Schema.String,
  /** Imported specifiers (names) */
  specifiers: Schema.Array(Schema.String),
  /** Kind of import */
  kind: ImportKindSchema,
})
export type ImportInfo = typeof ImportInfoSchema.Type

/** Pattern for matching symbols with ast-grep. */
export const SymbolPatternSchema = Schema.Struct({
  /** ast-grep pattern string */
  pattern: Schema.String,
  /** Kind of symbol this pattern matches */
  kind: SymbolKindSchema,
  /** If specified, only match exported/non-exported symbols */
  exported: Schema.optional(Schema.Boolean),
})
export type SymbolPattern = typeof SymbolPatternSchema.Type

/** A match result from ast-grep pattern matching. */
export const MatchSchema = Schema.Struct({
  /** File path where the match was found */
  file: Schema.String,
  /** Line number (1-indexed) */
  line: Schema.Number.pipe(Schema.int()),
  /** Column number (1-indexed) */
  column: Schema.Number.pipe(Schema.int()),
  /** Matched text */
  text: Schema.String,
  /** Named captures from the pattern (e.g., $NAME -> value) */
  captures: Schema.Record({ key: Schema.String, value: Schema.String }),
})
export type Match = typeof MatchSchema.Type
