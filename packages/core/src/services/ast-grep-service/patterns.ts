import { Schema } from "effect"
import type { SymbolPattern } from "@jamesaphoenix/tx-types"

/**
 * Schema for optional text holder { text?: string }
 */
const TextHolderSchema = Schema.Struct({
  text: Schema.optional(Schema.String)
})

/**
 * Schema for AstGrepMatch - the output from ast-grep --json for symbol extraction.
 */
const AstGrepMatchSchema = Schema.Struct({
  range: Schema.optional(Schema.Struct({
    start: Schema.optional(Schema.Struct({
      line: Schema.optional(Schema.Number)
    }))
  })),
  metaVariables: Schema.optional(Schema.Struct({
    NAME: Schema.optional(TextHolderSchema)
  })),
  file: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String)
})

/**
 * Schema for ImportMatch - the output from ast-grep --json for import extraction.
 */
const ImportMatchSchema = Schema.Struct({
  metaVariables: Schema.optional(Schema.Struct({
    SOURCE: Schema.optional(TextHolderSchema),
    SPECS: Schema.optional(TextHolderSchema),
    ALIAS: Schema.optional(TextHolderSchema),
    DEFAULT: Schema.optional(TextHolderSchema)
  }))
})

/**
 * Schema for PatternMatch - the output from ast-grep --json for pattern matching.
 */
const PatternMatchSchema = Schema.Struct({
  file: Schema.optional(Schema.String),
  range: Schema.optional(Schema.Struct({
    start: Schema.optional(Schema.Struct({
      line: Schema.optional(Schema.Number),
      column: Schema.optional(Schema.Number)
    }))
  })),
  text: Schema.optional(Schema.String),
  metaVariables: Schema.optional(Schema.Record({ key: Schema.String, value: TextHolderSchema }))
})

/**
 * Safely parse and validate ast-grep match array output.
 * Returns empty array if parsing fails or validation fails.
 */
export const parseAstGrepMatches = (
  output: string
): readonly (typeof AstGrepMatchSchema.Type)[] => {
  try {
    const parsed: unknown = JSON.parse(output)
    const result = Schema.decodeUnknownSync(Schema.Array(AstGrepMatchSchema))(parsed)
    return result
  } catch {
    return []
  }
}

/**
 * Safely parse and validate import match array output.
 * Returns empty array if parsing fails or validation fails.
 */
export const parseImportMatches = (
  output: string
): readonly (typeof ImportMatchSchema.Type)[] => {
  try {
    const parsed: unknown = JSON.parse(output)
    const result = Schema.decodeUnknownSync(Schema.Array(ImportMatchSchema))(parsed)
    return result
  } catch {
    return []
  }
}

/**
 * Safely parse and validate pattern match array output.
 * Returns empty array if parsing fails or validation fails.
 */
export const parsePatternMatches = (
  output: string
): readonly (typeof PatternMatchSchema.Type)[] => {
  try {
    const parsed: unknown = JSON.parse(output)
    const result = Schema.decodeUnknownSync(Schema.Array(PatternMatchSchema))(parsed)
    return result
  } catch {
    return []
  }
}

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
 * Get the language identifier for a file path based on extension.
 */
export const getLanguage = (filePath: string): string | null => {
  const lastDot = filePath.lastIndexOf(".")
  if (lastDot === -1) return null
  const ext = filePath.slice(lastDot)
  return EXT_TO_LANGUAGE[ext] ?? null
}

/**
 * Get symbol patterns for a language.
 */
export const getPatterns = (language: string): readonly SymbolPattern[] => {
  return DEFAULT_SYMBOL_PATTERNS[language] ?? []
}
