# DD-014: Graph Schema and Edge Types - Implementation

## Overview

This design document describes how to implement the graph schema, edge storage, anchor verification, and symbol extraction defined in PRD-014.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      GraphService                            │
│  addEdge | getEdges | traverse | invalidateEdge             │
├─────────────────────────────────────────────────────────────┤
│                      EdgeRepository                          │
│  insert | findBySource | findByTarget | invalidate          │
├─────────────────────────────────────────────────────────────┤
│                      AnchorService                           │
│  createAnchor | verifyAnchor | findForFile | updateStatus   │
├─────────────────────────────────────────────────────────────┤
│                   AstGrepService (optional)                  │
│  parseFile | findSymbols | getImports | matchPattern        │
├─────────────────────────────────────────────────────────────┤
│                   GitAnalysisService                         │
│  getCoChanges | getFileHistory | computeCorrelation         │
└─────────────────────────────────────────────────────────────┘
```

## TypeScript Types

### Core Types

```typescript
// src/schemas/graph.ts

import { Schema } from "@effect/schema"

// Node types in the graph
export type NodeType = 'learning' | 'file' | 'task' | 'run'

// Edge types - Strong ENUMs (fixed ontology, not pluggable)
export const EdgeType = {
  ANCHORED_TO: 'ANCHORED_TO',
  DERIVED_FROM: 'DERIVED_FROM',
  IMPORTS: 'IMPORTS',
  CO_CHANGES_WITH: 'CO_CHANGES_WITH',
  SIMILAR_TO: 'SIMILAR_TO',
  LINKS_TO: 'LINKS_TO',
  USED_IN_RUN: 'USED_IN_RUN',
  INVALIDATED_BY: 'INVALIDATED_BY',
} as const

export type EdgeType = typeof EdgeType[keyof typeof EdgeType]

// Anchor types for file associations
export type AnchorType = 'glob' | 'hash' | 'symbol'
export type AnchorStatus = 'valid' | 'drifted' | 'invalid'

// Graph edge record
export interface GraphEdge {
  id: number
  edgeType: EdgeType
  sourceType: NodeType
  sourceId: string
  targetType: NodeType
  targetId: string
  weight: number  // 0-1
  metadata: Record<string, unknown>
  createdAt: Date
  invalidatedAt: Date | null
}

// File anchor record
export interface FileAnchor {
  id: number
  learningId: number
  filePath: string
  anchorType: AnchorType
  anchorValue: string  // glob pattern, hash, or symbol FQName
  contentHash: string | null
  lineStart: number | null
  lineEnd: number | null
  symbolFqname: string | null
  lastVerifiedAt: Date | null
  status: AnchorStatus
  createdAt: Date
}

// Input types
export interface CreateEdgeInput {
  edgeType: EdgeType
  sourceType: NodeType
  sourceId: string
  targetType: NodeType
  targetId: string
  weight?: number
  metadata?: Record<string, unknown>
}

export interface CreateAnchorInput {
  learningId: number
  filePath: string
  anchorType: AnchorType
  anchorValue: string
  lineStart?: number
  lineEnd?: number
}

// Traversal options
export interface TraverseOptions {
  depth: number  // Max hops (default: 2)
  edgeTypes?: EdgeType[]  // Filter by edge type
  maxNodes?: number  // Limit total nodes (default: 100)
  decayFactor?: number  // Score decay per hop (default: 0.7)
  direction?: 'outgoing' | 'incoming' | 'both'  // Default: 'both' (bidirectional)
}

// Traversal result
export interface TraversalNode {
  nodeType: NodeType
  nodeId: string
  score: number  // Decayed score from traversal
  hops: number   // Distance from start
  path: string[] // Node IDs in path
}
```

## Service Implementations

### GraphService

```typescript
// src/services/graph-service.ts

import { Context, Effect, Layer } from "effect"
import { EdgeRepository } from "../repo/edge-repo.js"
import { DatabaseError } from "../errors.js"

export class GraphService extends Context.Tag("GraphService")<
  GraphService,
  {
    readonly addEdge: (input: CreateEdgeInput) => Effect.Effect<GraphEdge, DatabaseError>
    readonly getEdges: (nodeId: string, nodeType: NodeType, direction?: 'outgoing' | 'incoming' | 'both') => Effect.Effect<readonly GraphEdge[], DatabaseError>
    readonly traverse: (startId: string, startType: NodeType, opts: TraverseOptions) => Effect.Effect<readonly TraversalNode[], DatabaseError>
    readonly invalidateEdge: (edgeId: number) => Effect.Effect<void, EdgeNotFoundError | DatabaseError>
    readonly findPath: (fromId: string, toId: string, maxDepth?: number) => Effect.Effect<string[] | null, DatabaseError>
  }
>() {}

export const GraphServiceLive = Layer.effect(
  GraphService,
  Effect.gen(function* () {
    const edgeRepo = yield* EdgeRepository

    return {
      addEdge: (input) =>
        Effect.gen(function* () {
          // Validate no self-loops
          if (input.sourceId === input.targetId && input.sourceType === input.targetType) {
            return yield* Effect.fail(new ValidationError({ reason: "Self-loops not allowed" }))
          }

          return yield* edgeRepo.insert({
            ...input,
            weight: input.weight ?? 1.0,
            metadata: input.metadata ?? {}
          })
        }),

      getEdges: (nodeId, nodeType, direction = 'both') =>
        Effect.gen(function* () {
          const outgoing = direction !== 'incoming'
            ? yield* edgeRepo.findBySource(nodeType, nodeId)
            : []
          const incoming = direction !== 'outgoing'
            ? yield* edgeRepo.findByTarget(nodeType, nodeId)
            : []

          return [...outgoing, ...incoming]
        }),

      traverse: (startId, startType, opts) =>
        Effect.gen(function* () {
          const { depth, edgeTypes, maxNodes = 100, decayFactor = 0.7 } = opts

          const visited = new Set<string>()
          const results: TraversalNode[] = []

          // BFS with score decay
          let frontier: TraversalNode[] = [{
            nodeType: startType,
            nodeId: startId,
            score: 1.0,
            hops: 0,
            path: [startId]
          }]

          visited.add(`${startType}:${startId}`)

          for (let hop = 0; hop < depth && results.length < maxNodes; hop++) {
            const nextFrontier: TraversalNode[] = []

            for (const node of frontier) {
              if (results.length >= maxNodes) break

              // Get outgoing edges
              let edges = yield* edgeRepo.findBySource(node.nodeType, node.nodeId)

              // Filter by edge type if specified
              if (edgeTypes) {
                edges = edges.filter(e => edgeTypes.includes(e.edgeType))
              }

              for (const edge of edges) {
                const key = `${edge.targetType}:${edge.targetId}`
                if (visited.has(key)) continue

                visited.add(key)
                const newNode: TraversalNode = {
                  nodeType: edge.targetType,
                  nodeId: edge.targetId,
                  score: node.score * edge.weight * decayFactor,
                  hops: hop + 1,
                  path: [...node.path, edge.targetId]
                }

                results.push(newNode)
                nextFrontier.push(newNode)
              }
            }

            frontier = nextFrontier
          }

          // Sort by score descending
          return results.sort((a, b) => b.score - a.score)
        }),

      invalidateEdge: (edgeId) => edgeRepo.invalidate(edgeId),

      findPath: (fromId, toId, maxDepth = 5) =>
        Effect.gen(function* () {
          // BFS for shortest path
          const visited = new Set<string>([fromId])
          let frontier = [{ id: fromId, path: [fromId] }]

          for (let depth = 0; depth < maxDepth; depth++) {
            const nextFrontier: typeof frontier = []

            for (const { id, path } of frontier) {
              const edges = yield* edgeRepo.findBySourceId(id)

              for (const edge of edges) {
                if (edge.targetId === toId) {
                  return [...path, toId]
                }

                if (!visited.has(edge.targetId)) {
                  visited.add(edge.targetId)
                  nextFrontier.push({
                    id: edge.targetId,
                    path: [...path, edge.targetId]
                  })
                }
              }
            }

            frontier = nextFrontier
          }

          return null  // No path found
        })
    }
  })
)
```

### AnchorService

```typescript
// src/services/anchor-service.ts

import { Context, Effect, Layer } from "effect"
import { AnchorRepository } from "../repo/anchor-repo.js"
import { AstGrepService } from "./ast-grep-service.js"
import * as fs from "fs/promises"
import * as crypto from "crypto"

export class AnchorService extends Context.Tag("AnchorService")<
  AnchorService,
  {
    readonly createAnchor: (input: CreateAnchorInput) => Effect.Effect<FileAnchor, DatabaseError>
    readonly verifyAnchor: (anchorId: number) => Effect.Effect<VerificationResult, AnchorNotFoundError | DatabaseError>
    readonly findForFile: (filePath: string) => Effect.Effect<readonly FileAnchor[], DatabaseError>
    readonly findForLearning: (learningId: number) => Effect.Effect<readonly FileAnchor[], DatabaseError>
    readonly computeContentHash: (filePath: string, lineStart?: number, lineEnd?: number) => Effect.Effect<string, FileNotFoundError>
  }
>() {}

interface VerificationResult {
  status: AnchorStatus
  reason?: string
  newHash?: string  // For self-healing
}

export const AnchorServiceLive = Layer.effect(
  AnchorService,
  Effect.gen(function* () {
    const anchorRepo = yield* AnchorRepository
    const astGrep = yield* Effect.serviceOption(AstGrepService)

    const computeHash = (content: string): string => {
      return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
    }

    return {
      createAnchor: (input) =>
        Effect.gen(function* () {
          let contentHash: string | null = null
          let symbolFqname: string | null = null

          // Compute content hash if hash anchor
          if (input.anchorType === 'hash' && input.lineStart && input.lineEnd) {
            const content = yield* Effect.tryPromise({
              try: async () => {
                const file = await fs.readFile(input.filePath, 'utf-8')
                const lines = file.split('\n')
                return lines.slice(input.lineStart! - 1, input.lineEnd!).join('\n')
              },
              catch: (e) => new FileNotFoundError({ path: input.filePath, cause: e })
            })
            contentHash = computeHash(content)
          }

          // Resolve symbol FQName if symbol anchor
          if (input.anchorType === 'symbol' && astGrep._tag === 'Some') {
            const symbols = yield* astGrep.value.findSymbols(input.filePath)
            const match = symbols.find(s => s.name === input.anchorValue)
            if (match) {
              symbolFqname = `${input.filePath}::${match.name}`
            }
          }

          return yield* anchorRepo.insert({
            ...input,
            contentHash,
            symbolFqname,
            status: 'valid'
          })
        }),

      verifyAnchor: (anchorId) =>
        Effect.gen(function* () {
          const anchor = yield* anchorRepo.findById(anchorId)
          if (!anchor) {
            return yield* Effect.fail(new AnchorNotFoundError({ id: anchorId }))
          }

          // Check file exists
          const exists = yield* Effect.tryPromise({
            try: () => fs.access(anchor.filePath).then(() => true).catch(() => false),
            catch: () => new DatabaseError({ cause: "fs access error" })
          })

          if (!exists) {
            yield* anchorRepo.updateStatus(anchorId, 'invalid')
            return { status: 'invalid' as const, reason: 'file_deleted' }
          }

          switch (anchor.anchorType) {
            case 'hash': {
              if (!anchor.lineStart || !anchor.lineEnd) {
                return { status: 'valid' as const }
              }

              const content = yield* Effect.tryPromise({
                try: async () => {
                  const file = await fs.readFile(anchor.filePath, 'utf-8')
                  const lines = file.split('\n')
                  return lines.slice(anchor.lineStart! - 1, anchor.lineEnd!).join('\n')
                },
                catch: () => new FileNotFoundError({ path: anchor.filePath })
              })

              const currentHash = computeHash(content)

              if (currentHash !== anchor.contentHash) {
                yield* anchorRepo.updateStatus(anchorId, 'drifted')
                return {
                  status: 'drifted' as const,
                  reason: 'hash_mismatch',
                  newHash: currentHash
                }
              }

              return { status: 'valid' as const }
            }

            case 'symbol': {
              if (astGrep._tag === 'None' || !anchor.symbolFqname) {
                return { status: 'valid' as const }  // Can't verify without ast-grep
              }

              const symbols = yield* astGrep.value.findSymbols(anchor.filePath)
              const symbolName = anchor.symbolFqname.split('::').pop()
              const found = symbols.some(s => s.name === symbolName)

              if (!found) {
                // Symbol not in original file. Check if it moved to another file.
                const searchResult = yield* searchForRelocatedSymbol(symbolName!, anchor.filePath)

                if (searchResult.found) {
                  // Symbol relocated. Update anchor with new file path.
                  yield* anchorRepo.update(anchorId, {
                    filePath: searchResult.newPath,
                    symbolFqname: `${searchResult.newPath}::${symbolName}`
                  })
                  yield* logRelocation(anchorId, anchor.filePath, searchResult.newPath)
                  return { status: 'valid' as const, reason: 'symbol_relocated' }
                }

                // Symbol not found anywhere. Mark invalid.
                yield* anchorRepo.updateStatus(anchorId, 'invalid')
                return { status: 'invalid' as const, reason: 'symbol_missing' }
              }

              return { status: 'valid' as const }
            }

            case 'glob': {
              // Glob anchors are always valid if file exists
              return { status: 'valid' as const }
            }
          }
        }),

      findForFile: (filePath) => anchorRepo.findByFilePath(filePath),

      findForLearning: (learningId) => anchorRepo.findByLearningId(learningId),

      computeContentHash: (filePath, lineStart, lineEnd) =>
        Effect.tryPromise({
          try: async () => {
            const file = await fs.readFile(filePath, 'utf-8')
            const lines = file.split('\n')
            const content = lineStart && lineEnd
              ? lines.slice(lineStart - 1, lineEnd).join('\n')
              : file
            return computeHash(content)
          },
          catch: (e) => new FileNotFoundError({ path: filePath, cause: e })
        })
    }
  })
)
```

### AstGrepService

```typescript
// src/services/ast-grep-service.ts

import { Context, Effect, Layer } from "effect"
import { spawn } from "child_process"

export interface SymbolInfo {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'variable'
  line: number
  exported: boolean
}

export interface ImportInfo {
  source: string
  specifiers: string[]
  kind: 'static' | 'dynamic'
}

export class AstGrepService extends Context.Tag("AstGrepService")<
  AstGrepService,
  {
    readonly findSymbols: (filePath: string) => Effect.Effect<readonly SymbolInfo[], AstGrepError>
    readonly getImports: (filePath: string) => Effect.Effect<readonly ImportInfo[], AstGrepError>
    readonly matchPattern: (pattern: string, path: string) => Effect.Effect<readonly Match[], AstGrepError>
  }
>() {}

interface Match {
  file: string
  line: number
  column: number
  text: string
  captures: Record<string, string>
}

export class AstGrepError extends Data.TaggedError("AstGrepError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

// Language-specific symbol patterns (config-driven with sensible defaults)
export interface SymbolPattern {
  pattern: string
  kind: SymbolKind
  exported?: boolean
}

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'const' | 'variable' | 'method' | 'struct' | 'enum' | 'trait' | 'module'

// Default patterns for major languages
export const DEFAULT_SYMBOL_PATTERNS: Record<string, SymbolPattern[]> = {
  // TypeScript / JavaScript
  typescript: [
    { pattern: 'export function $NAME($_) { $$$_ }', kind: 'function', exported: true },
    { pattern: 'export const $NAME = ($_) => $$$_', kind: 'function', exported: true },
    { pattern: 'export class $NAME { $$$_ }', kind: 'class', exported: true },
    { pattern: 'export interface $NAME { $$$_ }', kind: 'interface', exported: true },
    { pattern: 'export type $NAME = $_', kind: 'type', exported: true },
    { pattern: 'export const $NAME = $_', kind: 'const', exported: true },
    { pattern: 'function $NAME($_) { $$$_ }', kind: 'function' },
    { pattern: 'class $NAME { $$$_ }', kind: 'class' },
  ],
  javascript: [
    { pattern: 'export function $NAME($_) { $$$_ }', kind: 'function', exported: true },
    { pattern: 'export const $NAME = ($_) => $$$_', kind: 'function', exported: true },
    { pattern: 'export class $NAME { $$$_ }', kind: 'class', exported: true },
    { pattern: 'module.exports.$NAME = $_', kind: 'function', exported: true },
    { pattern: 'function $NAME($_) { $$$_ }', kind: 'function' },
    { pattern: 'class $NAME { $$$_ }', kind: 'class' },
  ],

  // Python
  python: [
    { pattern: 'def $NAME($_): $$$_', kind: 'function' },
    { pattern: 'async def $NAME($_): $$$_', kind: 'function' },
    { pattern: 'class $NAME: $$$_', kind: 'class' },
    { pattern: 'class $NAME($_): $$$_', kind: 'class' },
  ],

  // Go
  go: [
    { pattern: 'func $NAME($_) $_ { $$$_ }', kind: 'function' },
    { pattern: 'func ($_ $_) $NAME($_) $_ { $$$_ }', kind: 'method' },
    { pattern: 'type $NAME struct { $$$_ }', kind: 'struct' },
    { pattern: 'type $NAME interface { $$$_ }', kind: 'interface' },
  ],

  // Rust
  rust: [
    { pattern: 'pub fn $NAME($_) $$$_ { $$$_ }', kind: 'function', exported: true },
    { pattern: 'fn $NAME($_) $$$_ { $$$_ }', kind: 'function' },
    { pattern: 'pub struct $NAME { $$$_ }', kind: 'struct', exported: true },
    { pattern: 'struct $NAME { $$$_ }', kind: 'struct' },
    { pattern: 'pub enum $NAME { $$$_ }', kind: 'enum', exported: true },
    { pattern: 'pub trait $NAME { $$$_ }', kind: 'trait', exported: true },
    { pattern: 'impl $NAME { $$$_ }', kind: 'class' },
  ],

  // Java
  java: [
    { pattern: 'public class $NAME { $$$_ }', kind: 'class', exported: true },
    { pattern: 'public interface $NAME { $$$_ }', kind: 'interface', exported: true },
    { pattern: 'public enum $NAME { $$$_ }', kind: 'enum', exported: true },
    { pattern: 'public $_ $NAME($_) { $$$_ }', kind: 'method', exported: true },
    { pattern: 'private $_ $NAME($_) { $$$_ }', kind: 'method' },
  ],

  // C#
  csharp: [
    { pattern: 'public class $NAME { $$$_ }', kind: 'class', exported: true },
    { pattern: 'public interface $NAME { $$$_ }', kind: 'interface', exported: true },
    { pattern: 'public enum $NAME { $$$_ }', kind: 'enum', exported: true },
    { pattern: 'public $_ $NAME($_) { $$$_ }', kind: 'method', exported: true },
    { pattern: 'private $_ $NAME($_) { $$$_ }', kind: 'method' },
    { pattern: 'public struct $NAME { $$$_ }', kind: 'struct', exported: true },
  ],

  // Ruby
  ruby: [
    { pattern: 'def $NAME $$$_ end', kind: 'method' },
    { pattern: 'def self.$NAME $$$_ end', kind: 'function' },
    { pattern: 'class $NAME $$$_ end', kind: 'class' },
    { pattern: 'module $NAME $$$_ end', kind: 'module' },
  ],

  // PHP
  php: [
    { pattern: 'function $NAME($_) { $$$_ }', kind: 'function' },
    { pattern: 'public function $NAME($_) { $$$_ }', kind: 'method', exported: true },
    { pattern: 'class $NAME { $$$_ }', kind: 'class' },
    { pattern: 'interface $NAME { $$$_ }', kind: 'interface' },
    { pattern: 'trait $NAME { $$$_ }', kind: 'trait' },
  ],

  // Kotlin
  kotlin: [
    { pattern: 'fun $NAME($_): $_ { $$$_ }', kind: 'function' },
    { pattern: 'class $NAME { $$$_ }', kind: 'class' },
    { pattern: 'data class $NAME($_)', kind: 'class' },
    { pattern: 'interface $NAME { $$$_ }', kind: 'interface' },
    { pattern: 'object $NAME { $$$_ }', kind: 'class' },
  ],

  // Swift
  swift: [
    { pattern: 'func $NAME($_) $$$_ { $$$_ }', kind: 'function' },
    { pattern: 'class $NAME { $$$_ }', kind: 'class' },
    { pattern: 'struct $NAME { $$$_ }', kind: 'struct' },
    { pattern: 'protocol $NAME { $$$_ }', kind: 'interface' },
    { pattern: 'enum $NAME { $$$_ }', kind: 'enum' },
  ],

  // C / C++
  c: [
    { pattern: '$_ $NAME($_) { $$$_ }', kind: 'function' },
    { pattern: 'struct $NAME { $$$_ }', kind: 'struct' },
    { pattern: 'typedef struct { $$$_ } $NAME', kind: 'struct' },
    { pattern: 'enum $NAME { $$$_ }', kind: 'enum' },
  ],
  cpp: [
    { pattern: '$_ $NAME($_) { $$$_ }', kind: 'function' },
    { pattern: 'class $NAME { $$$_ }', kind: 'class' },
    { pattern: 'struct $NAME { $$$_ }', kind: 'struct' },
    { pattern: 'namespace $NAME { $$$_ }', kind: 'module' },
    { pattern: 'template<$_> class $NAME { $$$_ }', kind: 'class' },
  ],
}

// File extension to language mapping
const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript',
  '.py': 'python', '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.kt': 'kotlin', '.kts': 'kotlin',
  '.swift': 'swift',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp',
}

export const AstGrepServiceLive = Layer.effect(
  AstGrepService,
  Effect.gen(function* () {
    const configRepo = yield* Effect.serviceOption(ConfigRepository)

    // Load custom patterns from config (user can extend/override)
    const customPatterns = configRepo._tag === 'Some'
      ? yield* configRepo.value.getJson<Record<string, SymbolPattern[]>>('ast_grep_patterns', {})
      : {}

    const getPatterns = (language: string): SymbolPattern[] => {
      const defaults = DEFAULT_SYMBOL_PATTERNS[language] || []
      const custom = customPatterns[language] || []
      return [...defaults, ...custom]
    }

    const getLanguage = (filePath: string): string | null => {
      const ext = filePath.slice(filePath.lastIndexOf('.'))
      return EXT_TO_LANGUAGE[ext] || null
    }

    const runAstGrep = (args: string[]): Effect.Effect<string, AstGrepError> =>
      Effect.async((resume) => {
        const proc = spawn('ast-grep', args, { stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (data) => { stdout += data })
        proc.stderr.on('data', (data) => { stderr += data })

        proc.on('close', (code) => {
          if (code !== 0) {
            resume(Effect.fail(new AstGrepError({
              message: `ast-grep exited with code ${code}`,
              cause: stderr
            })))
          } else {
            resume(Effect.succeed(stdout))
          }
        })

        proc.on('error', (err) => {
          resume(Effect.fail(new AstGrepError({
            message: 'Failed to spawn ast-grep',
            cause: err
          })))
        })
      })

    return {
      findSymbols: (filePath) =>
        Effect.gen(function* () {
          const language = getLanguage(filePath)
          if (!language) return []

          const patterns = getPatterns(language)
          const symbols: SymbolInfo[] = []

          for (const { pattern, kind, exported } of patterns) {
            const output = yield* runAstGrep([
              '--pattern', pattern,
              '--json',
              filePath
            ]).pipe(Effect.catchAll(() => Effect.succeed('[]')))

            const matches = JSON.parse(output) as any[]

            for (const m of matches) {
              symbols.push({
                name: m.metaVariables?.NAME?.text || 'unknown',
                kind,
                line: m.range?.start?.line || 0,
                exported: exported ?? false
              })
            }
          }

          return symbols
        }),

      getImports: (filePath) =>
        Effect.gen(function* () {
          const pattern = 'import { $$$SPECS } from "$SOURCE"'

          const output = yield* runAstGrep([
            '--pattern', pattern,
            '--json',
            filePath
          ]).pipe(Effect.catchAll(() => Effect.succeed('[]')))

          const matches = JSON.parse(output) as any[]

          return matches.map(m => ({
            source: m.metaVariables?.SOURCE?.text || '',
            specifiers: (m.metaVariables?.SPECS?.text || '').split(',').map((s: string) => s.trim()),
            kind: 'static' as const
          }))
        }),

      matchPattern: (pattern, path) =>
        Effect.gen(function* () {
          const output = yield* runAstGrep([
            '--pattern', pattern,
            '--json',
            path
          ])

          return JSON.parse(output) as Match[]
        })
    }
  })
)

// Noop version for when ast-grep is not installed
export const AstGrepServiceNoop = Layer.succeed(
  AstGrepService,
  {
    findSymbols: () => Effect.succeed([]),
    getImports: () => Effect.succeed([]),
    matchPattern: () => Effect.succeed([])
  }
)
```

## Database Operations

### EdgeRepository

```typescript
// src/repo/edge-repo.ts

import { Context, Effect, Layer } from "effect"
import { SqliteClient } from "../db.js"

export class EdgeRepository extends Context.Tag("EdgeRepository")<
  EdgeRepository,
  {
    readonly insert: (input: CreateEdgeInput) => Effect.Effect<GraphEdge, DatabaseError>
    readonly findBySource: (sourceType: NodeType, sourceId: string) => Effect.Effect<readonly GraphEdge[], DatabaseError>
    readonly findByTarget: (targetType: NodeType, targetId: string) => Effect.Effect<readonly GraphEdge[], DatabaseError>
    readonly findBySourceId: (sourceId: string) => Effect.Effect<readonly GraphEdge[], DatabaseError>
    readonly invalidate: (edgeId: number) => Effect.Effect<void, EdgeNotFoundError | DatabaseError>
  }
>() {}

export const EdgeRepositoryLive = Layer.effect(
  EdgeRepository,
  Effect.gen(function* () {
    const sql = yield* SqliteClient

    const rowToEdge = (row: any): GraphEdge => ({
      id: row.id,
      edgeType: row.edge_type,
      sourceType: row.source_type,
      sourceId: row.source_id,
      targetType: row.target_type,
      targetId: row.target_id,
      weight: row.weight,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: new Date(row.created_at),
      invalidatedAt: row.invalidated_at ? new Date(row.invalidated_at) : null
    })

    return {
      insert: (input) =>
        Effect.try({
          try: () => {
            const result = sql.db.prepare(`
              INSERT INTO learning_edges
              (edge_type, source_type, source_id, target_type, target_id, weight, metadata)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              RETURNING *
            `).get(
              input.edgeType,
              input.sourceType,
              input.sourceId,
              input.targetType,
              input.targetId,
              input.weight ?? 1.0,
              JSON.stringify(input.metadata ?? {})
            )
            return rowToEdge(result)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findBySource: (sourceType, sourceId) =>
        Effect.try({
          try: () => {
            const rows = sql.db.prepare(`
              SELECT * FROM learning_edges
              WHERE source_type = ? AND source_id = ? AND invalidated_at IS NULL
            `).all(sourceType, sourceId)
            return rows.map(rowToEdge)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findByTarget: (targetType, targetId) =>
        Effect.try({
          try: () => {
            const rows = sql.db.prepare(`
              SELECT * FROM learning_edges
              WHERE target_type = ? AND target_id = ? AND invalidated_at IS NULL
            `).all(targetType, targetId)
            return rows.map(rowToEdge)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      findBySourceId: (sourceId) =>
        Effect.try({
          try: () => {
            const rows = sql.db.prepare(`
              SELECT * FROM learning_edges
              WHERE source_id = ? AND invalidated_at IS NULL
            `).all(sourceId)
            return rows.map(rowToEdge)
          },
          catch: (cause) => new DatabaseError({ cause })
        }),

      invalidate: (edgeId) =>
        Effect.try({
          try: () => {
            const result = sql.db.prepare(`
              UPDATE learning_edges
              SET invalidated_at = datetime('now')
              WHERE id = ?
            `).run(edgeId)

            if (result.changes === 0) {
              throw new EdgeNotFoundError({ id: edgeId })
            }
          },
          catch: (cause) => {
            if (cause instanceof EdgeNotFoundError) throw cause
            throw new DatabaseError({ cause })
          }
        })
    }
  })
)
```

## Git Co-Change Analysis

```typescript
// src/services/git-analysis-service.ts

import { Context, Effect, Layer } from "effect"
import { execSync } from "child_process"

export class GitAnalysisService extends Context.Tag("GitAnalysisService")<
  GitAnalysisService,
  {
    readonly getCoChanges: (since?: string) => Effect.Effect<FileCoChange[], GitError>
    readonly analyzeAndStore: (since?: string) => Effect.Effect<number, DatabaseError | GitError>
  }
>() {}

interface FileCoChange {
  fileA: string
  fileB: string
  correlationScore: number
  commitCount: number
}

export const GitAnalysisServiceLive = Layer.effect(
  GitAnalysisService,
  Effect.gen(function* () {
    const sql = yield* SqliteClient

    return {
      getCoChanges: (since = '3 months ago') =>
        Effect.try({
          try: () => {
            // Get all commits in range
            const logOutput = execSync(
              `git log --since="${since}" --name-only --pretty=format:"%H"`,
              { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 }
            )

            // Parse commits and their files
            const commits: Map<string, string[]> = new Map()
            let currentCommit = ''

            for (const line of logOutput.split('\n')) {
              if (line.match(/^[a-f0-9]{40}$/)) {
                currentCommit = line
                commits.set(currentCommit, [])
              } else if (line && currentCommit) {
                commits.get(currentCommit)!.push(line)
              }
            }

            // Build co-change matrix
            const coChanges: Map<string, { count: number }> = new Map()

            for (const files of commits.values()) {
              // For each pair of files in the commit
              for (let i = 0; i < files.length; i++) {
                for (let j = i + 1; j < files.length; j++) {
                  const key = [files[i], files[j]].sort().join('|')
                  const existing = coChanges.get(key) || { count: 0 }
                  existing.count++
                  coChanges.set(key, existing)
                }
              }
            }

            // Convert to result format with correlation score
            const totalCommits = commits.size
            const results: FileCoChange[] = []

            for (const [key, { count }] of coChanges) {
              const [fileA, fileB] = key.split('|')
              results.push({
                fileA: fileA!,
                fileB: fileB!,
                correlationScore: Math.min(1, count / Math.sqrt(totalCommits)),
                commitCount: count
              })
            }

            return results.filter(r => r.commitCount >= 2)  // At least 2 co-changes
          },
          catch: (cause) => new GitError({ message: 'Failed to analyze git history', cause })
        }),

      analyzeAndStore: (since) =>
        Effect.gen(function* () {
          const coChanges = yield* this.getCoChanges(since)

          // Upsert into database
          const stmt = sql.db.prepare(`
            INSERT INTO file_cochanges (file_a, file_b, correlation_score, commit_count, last_updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(file_a, file_b) DO UPDATE SET
              correlation_score = excluded.correlation_score,
              commit_count = excluded.commit_count,
              last_updated_at = datetime('now')
          `)

          for (const cc of coChanges) {
            stmt.run(cc.fileA, cc.fileB, cc.correlationScore, cc.commitCount)
          }

          return coChanges.length
        })
    }
  })
)
```

## CLI Integration

```typescript
// In apps/cli/src/commands/graph.ts

export const graph = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const subcommand = pos[0]

    if (subcommand === 'link') {
      const learningId = parseInt(pos[1] || '', 10)
      const filePath = pos[2]
      const anchorType = opt(flags, 'anchor-type') || 'glob'

      if (!learningId || !filePath) {
        console.error('Usage: tx graph:link <learning-id> <file-path>')
        process.exit(1)
      }

      const anchorService = yield* AnchorService
      const anchor = yield* anchorService.createAnchor({
        learningId,
        filePath,
        anchorType: anchorType as AnchorType,
        anchorValue: anchorType === 'glob' ? filePath : filePath
      })

      console.log(`Created anchor #${anchor.id} (${anchor.anchorType}) for learning #${learningId}`)
    }

    else if (subcommand === 'show') {
      const learningId = parseInt(pos[1] || '', 10)

      const graphService = yield* GraphService
      const anchorService = yield* AnchorService

      const edges = yield* graphService.getEdges(String(learningId), 'learning')
      const anchors = yield* anchorService.findForLearning(learningId)

      console.log(`\nGraph for Learning #${learningId}:`)
      console.log(`\nAnchors (${anchors.length}):`)
      for (const a of anchors) {
        console.log(`  - ${a.anchorType}: ${a.filePath} [${a.status}]`)
      }

      console.log(`\nEdges (${edges.length}):`)
      for (const e of edges) {
        console.log(`  - ${e.edgeType} → ${e.targetType}:${e.targetId} (weight: ${e.weight})`)
      }
    }

    else if (subcommand === 'neighbors') {
      const id = pos[1]
      const depth = parseInt(opt(flags, 'depth') || '2', 10)

      const graphService = yield* GraphService
      const nodes = yield* graphService.traverse(id, 'learning', { depth })

      console.log(`\nNeighbors (depth=${depth}):`)
      for (const n of nodes) {
        console.log(`  ${n.nodeType}:${n.nodeId} (score: ${n.score.toFixed(3)}, hops: ${n.hops})`)
      }
    }

    else if (subcommand === 'analyze-imports') {
      const path = opt(flags, 'path') || 'src/'
      console.log(`Analyzing imports in ${path}...`)
      // Implementation would use AstGrepService
    }

    else if (subcommand === 'analyze-cochanges') {
      const since = opt(flags, 'since') || '3 months ago'
      const gitService = yield* GitAnalysisService
      const count = yield* gitService.analyzeAndStore(since)
      console.log(`Stored ${count} file co-change relationships`)
    }
  })
```

## Testing Strategy

### Unit Tests

```typescript
// test/unit/graph-service.test.ts

describe('GraphService', () => {
  it('should add edge and retrieve it', async () => {
    const edge = await runEffect(graphService.addEdge({
      edgeType: 'ANCHORED_TO',
      sourceType: 'learning',
      sourceId: '1',
      targetType: 'file',
      targetId: 'src/foo.ts'
    }))

    expect(edge.edgeType).toBe('ANCHORED_TO')
    expect(edge.weight).toBe(1.0)
  })

  it('should reject self-loops', async () => {
    const result = await runEffect(
      graphService.addEdge({
        edgeType: 'SIMILAR_TO',
        sourceType: 'learning',
        sourceId: '1',
        targetType: 'learning',
        targetId: '1'
      }).pipe(Effect.either)
    )

    expect(result._tag).toBe('Left')
  })

  it('should traverse graph with depth limit', async () => {
    // Setup: A -> B -> C -> D
    await setupLinearGraph(['A', 'B', 'C', 'D'])

    const nodes = await runEffect(
      graphService.traverse('A', 'learning', { depth: 2, maxNodes: 100 })
    )

    expect(nodes.map(n => n.nodeId)).toEqual(['B', 'C'])
    expect(nodes[0].hops).toBe(1)
    expect(nodes[1].hops).toBe(2)
  })
})
```

### Integration Tests

```typescript
// test/integration/graph.test.ts

import {
  createTestDatabase,
  createTestLearning,
  createTestEdge,
  createEdgeBetweenLearnings,
  runEffect,
  createTempDir,
  writeTestTypeScriptFile,
  fixtureId
} from '@tx/test-utils'

describe('Graph Integration', () => {
  let db: TestDatabase

  beforeEach(async () => {
    db = await createTestDatabase()
  })

  afterEach(async () => {
    await db.close()
  })

  describe('Edge CRUD', () => {
    it('should create and retrieve edges', async () => {
      const learning = await createTestLearning(db, 'Use transactions')

      const edge = await runEffect(
        graphService.addEdge({
          edgeType: 'ANCHORED_TO',
          sourceType: 'learning',
          sourceId: String(learning.id),
          targetType: 'file',
          targetId: 'src/repo/task-repo.ts',
          weight: 0.9
        }),
        db
      )

      expect(edge.id).toBeDefined()
      expect(edge.weight).toBe(0.9)

      const edges = await runEffect(
        graphService.getEdges(String(learning.id), 'learning'),
        db
      )
      expect(edges).toHaveLength(1)
      expect(edges[0].targetId).toBe('src/repo/task-repo.ts')
    })

    it('should enforce edge type enum', async () => {
      const result = await runEffect(
        graphService.addEdge({
          edgeType: 'INVALID_TYPE' as any,
          sourceType: 'learning',
          sourceId: '1',
          targetType: 'file',
          targetId: 'foo.ts'
        }).pipe(Effect.either),
        db
      )

      expect(result._tag).toBe('Left')
    })

    it('should soft-delete edges via invalidation', async () => {
      const edge = await createTestEdge(db)

      await runEffect(graphService.invalidateEdge(edge.id), db)

      const edges = await runEffect(
        graphService.getEdges(edge.sourceId, 'learning'),
        db
      )
      expect(edges).toHaveLength(0) // Invalidated edges not returned
    })
  })

  describe('Anchor Management', () => {
    it('should create glob anchor and verify', async () => {
      const learning = await createTestLearning(db, 'Use transactions')

      const anchor = await runEffect(
        anchorService.createAnchor({
          learningId: learning.id,
          filePath: 'src/repo/task-repo.ts',
          anchorType: 'glob',
          anchorValue: 'src/repo/*.ts'
        }),
        db
      )

      expect(anchor.status).toBe('valid')

      const result = await runEffect(anchorService.verifyAnchor(anchor.id), db)
      expect(result.status).toBe('valid')
    })

    it('should create hash anchor with content hash', async () => {
      // Create test file
      await writeTestFile('src/auth.ts', 'export function validate() { return true }')

      const learning = await createTestLearning(db, 'Validate tokens')
      const anchor = await runEffect(
        anchorService.createAnchor({
          learningId: learning.id,
          filePath: 'src/auth.ts',
          anchorType: 'hash',
          anchorValue: 'src/auth.ts',
          lineStart: 1,
          lineEnd: 1
        }),
        db
      )

      expect(anchor.contentHash).toBeDefined()
      expect(anchor.contentHash).toHaveLength(16) // SHA256 truncated
    })

    it('should detect hash drift when file changes', async () => {
      await writeTestFile('src/auth.ts', 'function original() {}')

      const learning = await createTestLearning(db, 'Original function')
      const anchor = await runEffect(
        anchorService.createAnchor({
          learningId: learning.id,
          filePath: 'src/auth.ts',
          anchorType: 'hash',
          anchorValue: 'src/auth.ts',
          lineStart: 1,
          lineEnd: 1
        }),
        db
      )

      // Modify file
      await writeTestFile('src/auth.ts', 'function completelyDifferent() { /* new */ }')

      const result = await runEffect(anchorService.verifyAnchor(anchor.id), db)
      expect(result.status).toBe('drifted')
    })

    it('should find all anchors for a file path', async () => {
      const learning1 = await createTestLearning(db, 'Learning 1')
      const learning2 = await createTestLearning(db, 'Learning 2')

      await runEffect(
        anchorService.createAnchor({
          learningId: learning1.id,
          filePath: 'src/shared.ts',
          anchorType: 'glob',
          anchorValue: 'src/shared.ts'
        }),
        db
      )

      await runEffect(
        anchorService.createAnchor({
          learningId: learning2.id,
          filePath: 'src/shared.ts',
          anchorType: 'glob',
          anchorValue: 'src/shared.ts'
        }),
        db
      )

      const anchors = await runEffect(
        anchorService.findForFile('src/shared.ts'),
        db
      )
      expect(anchors).toHaveLength(2)
    })
  })

  describe('Graph Traversal', () => {
    it('should traverse with depth limit', async () => {
      // Create chain: L1 -> L2 -> L3 -> L4
      const l1 = await createTestLearning(db, 'Learning 1')
      const l2 = await createTestLearning(db, 'Learning 2')
      const l3 = await createTestLearning(db, 'Learning 3')
      const l4 = await createTestLearning(db, 'Learning 4')

      await createEdge(db, 'SIMILAR_TO', l1.id, l2.id)
      await createEdge(db, 'SIMILAR_TO', l2.id, l3.id)
      await createEdge(db, 'SIMILAR_TO', l3.id, l4.id)

      const nodes = await runEffect(
        graphService.traverse(String(l1.id), 'learning', { depth: 2, maxNodes: 100 }),
        db
      )

      expect(nodes.map(n => n.nodeId)).toEqual([String(l2.id), String(l3.id)])
      expect(nodes).not.toContainEqual(expect.objectContaining({ nodeId: String(l4.id) }))
    })

    it('should apply score decay per hop', async () => {
      const l1 = await createTestLearning(db, 'Learning 1')
      const l2 = await createTestLearning(db, 'Learning 2')
      const l3 = await createTestLearning(db, 'Learning 3')

      await createEdge(db, 'SIMILAR_TO', l1.id, l2.id, 1.0)
      await createEdge(db, 'SIMILAR_TO', l2.id, l3.id, 1.0)

      const nodes = await runEffect(
        graphService.traverse(String(l1.id), 'learning', { depth: 2, decayFactor: 0.7 }),
        db
      )

      expect(nodes[0].score).toBeCloseTo(0.7)  // 1.0 * 1.0 * 0.7
      expect(nodes[1].score).toBeCloseTo(0.49) // 0.7 * 1.0 * 0.7
    })

    it('should filter by edge type', async () => {
      const l1 = await createTestLearning(db, 'Learning 1')
      const l2 = await createTestLearning(db, 'Learning 2')
      const l3 = await createTestLearning(db, 'Learning 3')

      await createEdge(db, 'SIMILAR_TO', l1.id, l2.id)
      await createEdge(db, 'LINKS_TO', l1.id, l3.id)

      const nodes = await runEffect(
        graphService.traverse(String(l1.id), 'learning', {
          depth: 1,
          edgeTypes: ['SIMILAR_TO']
        }),
        db
      )

      expect(nodes).toHaveLength(1)
      expect(nodes[0].nodeId).toBe(String(l2.id))
    })

    it('should handle cycles without infinite loop', async () => {
      const l1 = await createTestLearning(db, 'Learning 1')
      const l2 = await createTestLearning(db, 'Learning 2')

      // Create cycle: L1 -> L2 -> L1
      await createEdge(db, 'SIMILAR_TO', l1.id, l2.id)
      await createEdge(db, 'SIMILAR_TO', l2.id, l1.id)

      const nodes = await runEffect(
        graphService.traverse(String(l1.id), 'learning', { depth: 5 }),
        db
      )

      // Should visit L2 once, not loop infinitely
      expect(nodes).toHaveLength(1)
      expect(nodes[0].nodeId).toBe(String(l2.id))
    })

    it('should traverse bidirectionally', async () => {
      const l1 = await createTestLearning(db, 'Learning 1')
      const l2 = await createTestLearning(db, 'Learning 2')
      const l3 = await createTestLearning(db, 'Learning 3')

      // L1 -> L2, L3 -> L2 (L2 has incoming from both)
      await createEdge(db, 'SIMILAR_TO', l1.id, l2.id)
      await createEdge(db, 'SIMILAR_TO', l3.id, l2.id)

      // Starting from L2, should find both L1 and L3 via bidirectional traversal
      const nodes = await runEffect(
        graphService.traverse(String(l2.id), 'learning', { depth: 1, direction: 'both' }),
        db
      )

      const nodeIds = nodes.map(n => n.nodeId)
      expect(nodeIds).toContain(String(l1.id))
      expect(nodeIds).toContain(String(l3.id))
    })
  })

  describe('Symbol Extraction', () => {
    it('should extract TypeScript symbols', async () => {
      await writeTestFile('src/service.ts', `
        export function validateToken(token: string): boolean {
          return true
        }

        export class AuthService {
          validate() {}
        }

        export const helper = () => {}
      `)

      const symbols = await runEffect(astGrepService.findSymbols('src/service.ts'))

      expect(symbols).toContainEqual(expect.objectContaining({
        name: 'validateToken',
        kind: 'function',
        exported: true
      }))
      expect(symbols).toContainEqual(expect.objectContaining({
        name: 'AuthService',
        kind: 'class',
        exported: true
      }))
    })

    it('should extract Python symbols', async () => {
      await writeTestFile('src/service.py', `
def validate_token(token):
    return True

class AuthService:
    def validate(self):
        pass
      `)

      const symbols = await runEffect(astGrepService.findSymbols('src/service.py'))

      expect(symbols).toContainEqual(expect.objectContaining({
        name: 'validate_token',
        kind: 'function'
      }))
      expect(symbols).toContainEqual(expect.objectContaining({
        name: 'AuthService',
        kind: 'class'
      }))
    })

    it('should extract Go symbols', async () => {
      await writeTestFile('src/service.go', `
package auth

func ValidateToken(token string) bool {
    return true
}

type AuthService struct {
    token string
}

func (a *AuthService) Validate() bool {
    return true
}
      `)

      const symbols = await runEffect(astGrepService.findSymbols('src/service.go'))

      expect(symbols).toContainEqual(expect.objectContaining({
        name: 'ValidateToken',
        kind: 'function'
      }))
      expect(symbols).toContainEqual(expect.objectContaining({
        name: 'AuthService',
        kind: 'struct'
      }))
    })

    it('should extract Rust symbols', async () => {
      await writeTestFile('src/service.rs', `
pub fn validate_token(token: &str) -> bool {
    true
}

pub struct AuthService {
    token: String,
}

impl AuthService {
    pub fn validate(&self) -> bool {
        true
    }
}
      `)

      const symbols = await runEffect(astGrepService.findSymbols('src/service.rs'))

      expect(symbols).toContainEqual(expect.objectContaining({
        name: 'validate_token',
        kind: 'function',
        exported: true
      }))
      expect(symbols).toContainEqual(expect.objectContaining({
        name: 'AuthService',
        kind: 'struct',
        exported: true
      }))
    })

    it('should use custom patterns from config', async () => {
      // Configure custom pattern
      await runEffect(
        configRepo.setJson('ast_grep_patterns', {
          typescript: [
            { pattern: 'export enum $NAME { $$$_ }', kind: 'enum', exported: true }
          ]
        }),
        db
      )

      await writeTestFile('src/types.ts', `
        export enum Status {
          Active,
          Inactive
        }
      `)

      const symbols = await runEffect(astGrepService.findSymbols('src/types.ts'))

      expect(symbols).toContainEqual(expect.objectContaining({
        name: 'Status',
        kind: 'enum',
        exported: true
      }))
    })
  })

  describe('Git Co-Change Analysis', () => {
    it('should compute file correlations from git history', async () => {
      // This test requires a git repo with history
      // Setup: files that are frequently committed together

      const coChanges = await runEffect(
        gitAnalysisService.getCoChanges('1 month ago')
      )

      // Verify structure
      for (const cc of coChanges) {
        expect(cc.fileA).toBeDefined()
        expect(cc.fileB).toBeDefined()
        expect(cc.correlationScore).toBeGreaterThanOrEqual(0)
        expect(cc.correlationScore).toBeLessThanOrEqual(1)
        expect(cc.commitCount).toBeGreaterThanOrEqual(2)
      }
    })

    it('should store and update co-change data', async () => {
      const count = await runEffect(
        gitAnalysisService.analyzeAndStore('3 months ago'),
        db
      )

      expect(count).toBeGreaterThanOrEqual(0)

      // Verify data is stored
      const stored = await db.query('SELECT * FROM file_cochanges LIMIT 5')
      for (const row of stored) {
        expect(row.correlation_score).toBeGreaterThanOrEqual(0)
      }
    })
  })

  describe('Symbol Relocation', () => {
    it('should update anchor when symbol moves to new file', async () => {
      // Create original file with symbol
      await writeTestFile('src/auth.ts', 'export function validateToken() {}')

      const learning = await createTestLearning(db, 'Token validation')
      const anchor = await runEffect(
        anchorService.createAnchor({
          learningId: learning.id,
          filePath: 'src/auth.ts',
          anchorType: 'symbol',
          anchorValue: 'validateToken'
        }),
        db
      )

      // Move symbol to new file
      await writeTestFile('src/auth.ts', '// empty now')
      await writeTestFile('src/token-validator.ts', 'export function validateToken() {}')

      // Verify should detect relocation and update
      const result = await runEffect(anchorService.verifyAnchor(anchor.id), db)

      expect(result.reason).toBe('symbol_relocated')

      // Check anchor was updated
      const updatedAnchor = await runEffect(anchorRepo.findById(anchor.id), db)
      expect(updatedAnchor?.filePath).toBe('src/token-validator.ts')
    })
  })
})
```

## Co-Change Analysis Scheduling

Co-change correlation is expensive to compute. Run weekly, not on every git pull.

```typescript
// Scheduled recompute (weekly cron or on-demand)
const scheduleCoChangeAnalysis = () =>
  Effect.gen(function* () {
    const gitService = yield* GitAnalysisService
    const configRepo = yield* ConfigRepository

    // Check if stale (> 7 days old)
    const lastUpdated = yield* configRepo.get('cochange_last_updated')
    const staleDays = 7

    if (lastUpdated) {
      const daysSinceUpdate = (Date.now() - new Date(lastUpdated).getTime()) / (1000 * 60 * 60 * 24)
      if (daysSinceUpdate < staleDays) {
        yield* Effect.log(`Co-change data is fresh (${daysSinceUpdate.toFixed(1)} days old)`)
        return { skipped: true, reason: 'not_stale' }
      }
    }

    yield* Effect.log('Recomputing co-change correlations...')
    const count = yield* gitService.analyzeAndStore('3 months ago')
    yield* configRepo.set('cochange_last_updated', new Date().toISOString())

    return { skipped: false, correlationsUpdated: count }
  })
```

CLI shows staleness warning:
```bash
tx graph:status
# Output: Co-change data: 8 days old (stale, run tx graph:analyze-cochanges)
```

## Performance Considerations

1. **Batch edge insertion**: Use prepared statements with transactions
2. **Index coverage**: Composite indexes on (source_type, source_id) and (target_type, target_id)
3. **Traversal limits**: Always enforce maxNodes to prevent runaway queries
4. **Lazy symbol extraction**: Only run ast-grep when explicitly requested
5. **Cached co-change data**: Store in SQLite, refresh weekly (not on every pull)

## References

- PRD-014: Graph Schema and Edge Types
- DD-010: Learnings Search and Retrieval
- DD-013: Test Utilities Package
- [BFS Graph Traversal](https://en.wikipedia.org/wiki/Breadth-first_search)
- [ast-grep Patterns](https://ast-grep.github.io/guide/pattern-syntax.html)
