/**
 * Symbol extraction types for tx
 *
 * Type definitions for code intelligence and symbol extraction.
 * Used by ast-grep integration for structural code analysis.
 * Zero runtime dependencies - pure TypeScript types only.
 */

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
 * Symbol kind - one of the valid code construct types.
 */
export type SymbolKind = (typeof SYMBOL_KINDS)[number];

/**
 * Information about an extracted symbol.
 */
export interface SymbolInfo {
  /** Symbol name (e.g., function name, class name) */
  readonly name: string;
  /** Kind of symbol */
  readonly kind: SymbolKind;
  /** Line number where the symbol is defined (1-indexed) */
  readonly line: number;
  /** Whether the symbol is exported */
  readonly exported: boolean;
}

/**
 * Import kind - static (import/require) or dynamic (import()).
 */
export const IMPORT_KINDS = ["static", "dynamic"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/**
 * Information about an import statement.
 */
export interface ImportInfo {
  /** Source module path or package name */
  readonly source: string;
  /** Imported specifiers (names) */
  readonly specifiers: readonly string[];
  /** Kind of import */
  readonly kind: ImportKind;
}

/**
 * Pattern for matching symbols with ast-grep.
 */
export interface SymbolPattern {
  /** ast-grep pattern string */
  readonly pattern: string;
  /** Kind of symbol this pattern matches */
  readonly kind: SymbolKind;
  /** If specified, only match exported/non-exported symbols */
  readonly exported?: boolean;
}

/**
 * A match result from ast-grep pattern matching.
 */
export interface Match {
  /** File path where the match was found */
  readonly file: string;
  /** Line number (1-indexed) */
  readonly line: number;
  /** Column number (1-indexed) */
  readonly column: number;
  /** Matched text */
  readonly text: string;
  /** Named captures from the pattern (e.g., $NAME -> value) */
  readonly captures: Readonly<Record<string, string>>;
}
