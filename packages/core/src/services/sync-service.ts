import { Context, Effect, Exit, Layer, Schema } from "effect"
import { writeFile, rename, readFile, stat, mkdir, access } from "node:fs/promises"
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs"
import { createHash } from "node:crypto"
import { dirname, resolve, sep } from "node:path"
import { DatabaseError, TaskNotFoundError, ValidationError } from "../errors.js"
import { SqliteClient } from "../db.js"
import { TaskService } from "./task-service.js"
import { DependencyRepository } from "../repo/dep-repo.js"
import { LearningRepository } from "../repo/learning-repo.js"
import { FileLearningRepository } from "../repo/file-learning-repo.js"
import { AttemptRepository } from "../repo/attempt-repo.js"
import { PinRepository } from "../repo/pin-repo.js"
import { syncBlocks } from "../utils/pin-file.js"
import { AnchorRepository } from "../repo/anchor-repo.js"
import { EdgeRepository } from "../repo/edge-repo.js"
import { DocRepository } from "../repo/doc-repo.js"
import type { Task, TaskDependency, Learning, FileLearning, Attempt, Pin, Anchor, Edge, Doc, DocLink, TaskDocLink, Invariant } from "@jamesaphoenix/tx-types"
import {
  type TaskUpsertOp,
  type TaskDeleteOp,
  type DepAddOp,
  type DepRemoveOp,
  type LearningUpsertOp,
  type FileLearningUpsertOp,
  type AttemptUpsertOp,
  type PinUpsertOp,
  type AnchorUpsertOp,
  type EdgeUpsertOp,
  type DocUpsertOp,
  type DocLinkUpsertOp,
  type TaskDocLinkUpsertOp,
  type InvariantUpsertOp,
  type LabelUpsertOp,
  type LabelAssignmentUpsertOp,
  LearningUpsertOp as LearningUpsertOpSchema,
  FileLearningUpsertOp as FileLearningUpsertOpSchema,
  AttemptUpsertOp as AttemptUpsertOpSchema,
  PinUpsertOp as PinUpsertOpSchema,
  AnchorUpsertOp as AnchorUpsertOpSchema,
  EdgeUpsertOp as EdgeUpsertOpSchema,
  DocUpsertOp as DocUpsertOpSchema,
  DocLinkUpsertOp as DocLinkUpsertOpSchema,
  TaskDocLinkUpsertOp as TaskDocLinkUpsertOpSchema,
  InvariantUpsertOp as InvariantUpsertOpSchema,
  LabelUpsertOp as LabelUpsertOpSchema,
  LabelAssignmentUpsertOp as LabelAssignmentUpsertOpSchema,
  SyncOperation as SyncOperationSchema,
  type SyncOperation
} from "../schemas/sync.js"

/**
 * Result of an export operation.
 */
export interface ExportResult {
  readonly opCount: number
  readonly path: string
}

/**
 * Result of a dependency import operation.
 */
export interface DependencyImportResult {
  readonly added: number
  readonly removed: number
  readonly skipped: number
  readonly failures: ReadonlyArray<{ blockerId: string; blockedId: string; error: string }>
}

/**
 * Result of an import operation.
 */
export interface ImportResult {
  readonly imported: number
  readonly skipped: number
  readonly conflicts: number
  readonly dependencies: DependencyImportResult
}

/**
 * Status of the sync system.
 */
export interface SyncStatus {
  readonly dbTaskCount: number
  readonly jsonlOpCount: number
  readonly lastExport: Date | null
  readonly lastImport: Date | null
  readonly isDirty: boolean
  readonly autoSyncEnabled: boolean
}

/**
 * Result of a compact operation.
 */
export interface CompactResult {
  readonly before: number
  readonly after: number
}

/**
 * Options for export operations.
 */
export interface ExportOptions {
  readonly learnings?: boolean
  readonly fileLearnings?: boolean
  readonly attempts?: boolean
  readonly pins?: boolean
  readonly anchors?: boolean
  readonly edges?: boolean
  readonly docs?: boolean
  readonly labels?: boolean
}

/**
 * Result of an exportAll operation.
 */
export interface ExportAllResult {
  readonly tasks: ExportResult
  readonly learnings?: ExportResult
  readonly fileLearnings?: ExportResult
  readonly attempts?: ExportResult
  readonly pins?: ExportResult
  readonly anchors?: ExportResult
  readonly edges?: ExportResult
  readonly docs?: ExportResult
  readonly labels?: ExportResult
}

/**
 * Result of importing a simple entity (no dependency sub-results).
 */
export interface EntityImportResult {
  readonly imported: number
  readonly skipped: number
}

/**
 * Result of an importAll operation.
 */
export interface ImportAllResult {
  readonly tasks: ImportResult
  readonly learnings?: EntityImportResult
  readonly fileLearnings?: EntityImportResult
  readonly attempts?: EntityImportResult
  readonly pins?: EntityImportResult
  readonly anchors?: EntityImportResult
  readonly edges?: EntityImportResult
  readonly docs?: EntityImportResult
  readonly labels?: EntityImportResult
}

/**
 * SyncService provides JSONL-based export/import for git-tracked task syncing.
 * See DD-009 for full specification.
 */
export class SyncService extends Context.Tag("SyncService")<
  SyncService,
  {
    /**
     * Export all tasks and dependencies to JSONL file.
     * @param path Optional path (default: .tx/tasks.jsonl)
     */
    readonly export: (path?: string) => Effect.Effect<ExportResult, DatabaseError>

    /**
     * Import tasks and dependencies from JSONL file.
     * Uses timestamp-based conflict resolution (later wins).
     * @param path Optional path (default: .tx/tasks.jsonl)
     */
    readonly import: (path?: string) => Effect.Effect<ImportResult, ValidationError | DatabaseError | TaskNotFoundError>

    /**
     * Get current sync status.
     */
    readonly status: () => Effect.Effect<SyncStatus, DatabaseError>

    /**
     * Enable auto-sync mode.
     */
    readonly enableAutoSync: () => Effect.Effect<void, DatabaseError>

    /**
     * Disable auto-sync mode.
     */
    readonly disableAutoSync: () => Effect.Effect<void, DatabaseError>

    /**
     * Check if auto-sync is enabled.
     */
    readonly isAutoSyncEnabled: () => Effect.Effect<boolean, DatabaseError>

    /**
     * Compact the JSONL file by deduplicating operations.
     */
    readonly compact: (path?: string) => Effect.Effect<CompactResult, DatabaseError | ValidationError>

    /**
     * Set last export timestamp in config.
     */
    readonly setLastExport: (timestamp: Date) => Effect.Effect<void, DatabaseError>

    /**
     * Set last import timestamp in config.
     */
    readonly setLastImport: (timestamp: Date) => Effect.Effect<void, DatabaseError>

    /**
     * Export all entity types to separate JSONL files.
     * Tasks → .tx/tasks.jsonl, Learnings → .tx/learnings.jsonl, etc.
     */
    readonly exportAll: (options?: ExportOptions) => Effect.Effect<ExportAllResult, DatabaseError>

    /**
     * Import all entity types from their respective JSONL files.
     * Processes in dependency order: tasks → learnings → file-learnings → attempts.
     */
    readonly importAll: (options?: ExportOptions) => Effect.Effect<ImportAllResult, ValidationError | DatabaseError | TaskNotFoundError>

    /**
     * Export learnings to JSONL file.
     * @param path Optional path (default: .tx/learnings.jsonl)
     */
    readonly exportLearnings: (path?: string) => Effect.Effect<ExportResult, DatabaseError>

    /**
     * Import learnings from JSONL file using content-hash dedup.
     * @param path Optional path (default: .tx/learnings.jsonl)
     */
    readonly importLearnings: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>

    /**
     * Export file learnings to JSONL file.
     * @param path Optional path (default: .tx/file-learnings.jsonl)
     */
    readonly exportFileLearnings: (path?: string) => Effect.Effect<ExportResult, DatabaseError>

    /**
     * Import file learnings from JSONL file using content-hash dedup.
     * @param path Optional path (default: .tx/file-learnings.jsonl)
     */
    readonly importFileLearnings: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>

    /**
     * Export attempts to JSONL file.
     * @param path Optional path (default: .tx/attempts.jsonl)
     */
    readonly exportAttempts: (path?: string) => Effect.Effect<ExportResult, DatabaseError>

    /**
     * Import attempts from JSONL file using content-hash dedup.
     * @param path Optional path (default: .tx/attempts.jsonl)
     */
    readonly importAttempts: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>

    /**
     * Export pins to JSONL file.
     * @param path Optional path (default: .tx/pins.jsonl)
     */
    readonly exportPins: (path?: string) => Effect.Effect<ExportResult, DatabaseError>

    /**
     * Import pins from JSONL file using content-hash dedup.
     * @param path Optional path (default: .tx/pins.jsonl)
     */
    readonly importPins: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>

    /**
     * Export anchors to JSONL file (appended to learnings.jsonl).
     * @param path Optional path (default: .tx/anchors.jsonl)
     */
    readonly exportAnchors: (path?: string) => Effect.Effect<ExportResult, DatabaseError>

    /**
     * Import anchors from JSONL file using content-hash dedup.
     * @param path Optional path (default: .tx/anchors.jsonl)
     */
    readonly importAnchors: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>

    /**
     * Export edges to JSONL file.
     * @param path Optional path (default: .tx/edges.jsonl)
     */
    readonly exportEdges: (path?: string) => Effect.Effect<ExportResult, DatabaseError>

    /**
     * Import edges from JSONL file using content-hash dedup.
     * @param path Optional path (default: .tx/edges.jsonl)
     */
    readonly importEdges: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>

    /**
     * Export docs (+ doc_links + task_doc_links + invariants) to JSONL file.
     * @param path Optional path (default: .tx/docs.jsonl)
     */
    readonly exportDocs: (path?: string) => Effect.Effect<ExportResult, DatabaseError>

    /**
     * Import docs (+ doc_links + task_doc_links + invariants) from JSONL file using content-hash dedup.
     * @param path Optional path (default: .tx/docs.jsonl)
     */
    readonly importDocs: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>

    /**
     * Export labels (+ label assignments) to JSONL file.
     * @param path Optional path (default: .tx/labels.jsonl)
     */
    readonly exportLabels: (path?: string) => Effect.Effect<ExportResult, DatabaseError>

    /**
     * Import labels (+ label assignments) from JSONL file using content-hash dedup.
     * @param path Optional path (default: .tx/labels.jsonl)
     */
    readonly importLabels: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>
  }
>() {}

const DEFAULT_JSONL_PATH = ".tx/tasks.jsonl"
const DEFAULT_LEARNINGS_JSONL_PATH = ".tx/learnings.jsonl"
const DEFAULT_FILE_LEARNINGS_JSONL_PATH = ".tx/file-learnings.jsonl"
const DEFAULT_ATTEMPTS_JSONL_PATH = ".tx/attempts.jsonl"
const DEFAULT_PINS_JSONL_PATH = ".tx/pins.jsonl"
const DEFAULT_ANCHORS_JSONL_PATH = ".tx/anchors.jsonl"
const DEFAULT_EDGES_JSONL_PATH = ".tx/edges.jsonl"
const DEFAULT_DOCS_JSONL_PATH = ".tx/docs.jsonl"
const DEFAULT_LABELS_JSONL_PATH = ".tx/labels.jsonl"

/**
 * Compute a content hash for cross-machine dedup.
 * Entities with auto-increment IDs use this to identify duplicates.
 */
const contentHash = (...parts: string[]): string =>
  createHash("sha256").update(parts.join("|")).digest("hex")

/**
 * Convert SQLite datetime string ("YYYY-MM-DD HH:MM:SS") to ISO 8601 ("YYYY-MM-DDTHH:MM:SS").
 * Labels use raw SQL so timestamps come in SQLite format rather than Date objects.
 */
const sqliteToIso = (s: string): string => {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s.replace(" ", "T") + ".000Z"
  return s
}

/**
 * Empty entity import result for early returns.
 */
const EMPTY_ENTITY_IMPORT_RESULT: EntityImportResult = { imported: 0, skipped: 0 }

/**
 * Empty import result for early returns.
 */
const EMPTY_IMPORT_RESULT: ImportResult = {
  imported: 0,
  skipped: 0,
  conflicts: 0,
  dependencies: { added: 0, removed: 0, skipped: 0, failures: [] }
}

/**
 * Topologically sort task operations so parents are processed before children.
 * This ensures foreign key constraints are satisfied during import.
 *
 * Uses Kahn's algorithm:
 * 1. Find all tasks with no parent (or parent not in import set) - these have no deps
 * 2. Process them and mark as "done"
 * 3. For remaining tasks, if their parent is "done", add them to the queue
 * 4. Repeat until all tasks are processed
 *
 * @param entries Array of [taskId, { op, ts }] entries from taskStates Map
 * @returns Sorted array with parents before children
 */
function topologicalSortTasks<T extends { op: { op: string; data?: { parentId?: string | null } } }>(
  entries: Array<[string, T]>
): Array<[string, T]> {
  // Separate upserts from deletes - deletes don't have parent dependencies
  const upsertEntries = entries.filter(([, { op }]) => op.op === "upsert")
  const deleteEntries = entries.filter(([, { op }]) => op.op === "delete")

  // Build set of task IDs being imported
  const importingIds = new Set(upsertEntries.map(([id]) => id))

  // Build parent→children adjacency list
  const children = new Map<string, string[]>()
  for (const [id] of upsertEntries) {
    children.set(id, [])
  }
  for (const [id, { op }] of upsertEntries) {
    const parentId = (op as { data?: { parentId?: string | null } }).data?.parentId
    if (parentId && importingIds.has(parentId)) {
      const parentChildren = children.get(parentId)
      if (parentChildren) {
        parentChildren.push(id)
      }
    }
  }

  // Calculate in-degree (number of parents in import set)
  const inDegree = new Map<string, number>()
  for (const [id, { op }] of upsertEntries) {
    const parentId = (op as { data?: { parentId?: string | null } }).data?.parentId
    // Only count parent as dependency if it's in the import set
    const hasParentInSet = parentId && importingIds.has(parentId)
    inDegree.set(id, hasParentInSet ? 1 : 0)
  }

  // Queue starts with tasks that have no parent in import set (in-degree 0)
  const queue: string[] = []
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id)
    }
  }

  // Build sorted result
  const sorted: Array<[string, T]> = []
  const entryMap = new Map(upsertEntries)

  while (queue.length > 0) {
    const id = queue.shift()!
    const entry = entryMap.get(id)
    if (entry) {
      sorted.push([id, entry])
    }

    // Decrement in-degree of children and add to queue if now 0
    const childIds = children.get(id) ?? []
    for (const childId of childIds) {
      const currentDegree = inDegree.get(childId) ?? 0
      const newDegree = currentDegree - 1
      inDegree.set(childId, newDegree)
      if (newDegree === 0) {
        queue.push(childId)
      }
    }
  }

  // If we didn't process all tasks, there's a cycle - fall back to original order
  // (This shouldn't happen with valid data since parent-child can't be circular)
  if (sorted.length < upsertEntries.length) {
    // Return original upsert entries followed by deletes
    return [...upsertEntries, ...deleteEntries]
  }

  // Return sorted upserts followed by deletes
  return [...sorted, ...deleteEntries]
}

/**
 * Convert a Task to a TaskUpsertOp for JSONL export.
 */
const taskToUpsertOp = (task: Task): TaskUpsertOp => ({
  v: 1,
  op: "upsert",
  ts: task.updatedAt.toISOString(),
  id: task.id,
  data: {
    title: task.title,
    description: task.description,
    status: task.status,
    score: task.score,
    parentId: task.parentId,
    createdAt: task.createdAt.toISOString(),
    completedAt: task.completedAt?.toISOString() ?? null,
    assigneeType: task.assigneeType ?? null,
    assigneeId: task.assigneeId ?? null,
    assignedAt: task.assignedAt?.toISOString() ?? null,
    assignedBy: task.assignedBy ?? null,
    metadata: task.metadata
  }
})

/**
 * Convert a TaskDependency to a DepAddOp for JSONL export.
 */
const depToAddOp = (dep: TaskDependency): DepAddOp => ({
  v: 1,
  op: "dep_add",
  ts: dep.createdAt.toISOString(),
  blockerId: dep.blockerId,
  blockedId: dep.blockedId
})

/**
 * Convert a Learning to a LearningUpsertOp for JSONL export.
 */
const learningToUpsertOp = (learning: Learning): LearningUpsertOp => ({
  v: 1,
  op: "learning_upsert",
  ts: learning.createdAt.toISOString(),
  id: learning.id as number,
  contentHash: contentHash(learning.content, learning.sourceType),
  data: {
    content: learning.content,
    sourceType: learning.sourceType,
    sourceRef: learning.sourceRef,
    keywords: [...learning.keywords],
    category: learning.category
  }
})

/**
 * Convert a FileLearning to a FileLearningUpsertOp for JSONL export.
 */
const fileLearningToUpsertOp = (fl: FileLearning): FileLearningUpsertOp => ({
  v: 1,
  op: "file_learning_upsert",
  ts: fl.createdAt.toISOString(),
  id: fl.id as number,
  contentHash: contentHash(fl.filePattern, fl.note),
  data: {
    filePattern: fl.filePattern,
    note: fl.note,
    taskId: fl.taskId
  }
})

/**
 * Convert an Attempt to an AttemptUpsertOp for JSONL export.
 */
const attemptToUpsertOp = (attempt: Attempt): AttemptUpsertOp => ({
  v: 1,
  op: "attempt_upsert",
  ts: attempt.createdAt.toISOString(),
  id: attempt.id as number,
  contentHash: contentHash(attempt.taskId, attempt.approach),
  data: {
    taskId: attempt.taskId,
    approach: attempt.approach,
    outcome: attempt.outcome,
    reason: attempt.reason
  }
})

/**
 * Convert a Pin to a PinUpsertOp for JSONL export.
 */
const pinToUpsertOp = (pin: Pin): PinUpsertOp => ({
  v: 1,
  op: "pin_upsert",
  ts: new Date(pin.updatedAt).toISOString(),
  id: pin.id,
  contentHash: contentHash(pin.id, pin.content),
  data: {
    content: pin.content
  }
})

/**
 * Convert an Anchor to an AnchorUpsertOp for JSONL export.
 * Uses the learning's content hash (looked up from learningHashMap) as stable reference.
 */
const anchorToUpsertOp = (anchor: Anchor, learningHashMap: Map<number, string>): AnchorUpsertOp => {
  const learningContentHash = learningHashMap.get(anchor.learningId as number) ?? ""
  return {
    v: 1,
    op: "anchor_upsert",
    ts: anchor.createdAt.toISOString(),
    id: anchor.id as number,
    contentHash: contentHash(learningContentHash, anchor.filePath, anchor.anchorType, anchor.anchorValue),
    data: {
      learningContentHash,
      anchorType: anchor.anchorType,
      anchorValue: anchor.anchorValue,
      filePath: anchor.filePath,
      symbolFqname: anchor.symbolFqname,
      lineStart: anchor.lineStart,
      lineEnd: anchor.lineEnd,
      contentHash: anchor.contentHash,
      contentPreview: anchor.contentPreview,
      status: anchor.status,
      pinned: anchor.pinned
    }
  }
}

/**
 * Convert an Edge to an EdgeUpsertOp for JSONL export.
 */
const edgeToUpsertOp = (edge: Edge): EdgeUpsertOp => ({
  v: 1,
  op: "edge_upsert",
  ts: edge.createdAt.toISOString(),
  id: edge.id as number,
  contentHash: contentHash(edge.edgeType, edge.sourceType, edge.sourceId, edge.targetType, edge.targetId),
  data: {
    edgeType: edge.edgeType,
    sourceType: edge.sourceType,
    sourceId: edge.sourceId,
    targetType: edge.targetType,
    targetId: edge.targetId,
    weight: edge.weight,
    metadata: edge.metadata as Record<string, unknown>
  }
})

/**
 * Convert a Doc to a DocUpsertOp for JSONL export.
 */
const docToUpsertOp = (doc: Doc, parentDocKeyMap: Map<number, string>): DocUpsertOp => ({
  v: 1,
  op: "doc_upsert",
  ts: doc.createdAt.toISOString(),
  id: doc.id as number,
  contentHash: contentHash(doc.kind, doc.name, String(doc.version)),
  data: {
    kind: doc.kind,
    name: doc.name,
    title: doc.title,
    version: doc.version,
    status: doc.status,
    filePath: doc.filePath,
    hash: doc.hash,
    parentDocKey: doc.parentDocId ? (parentDocKeyMap.get(doc.parentDocId as number) ?? null) : null,
    lockedAt: doc.lockedAt?.toISOString() ?? null,
    metadata: doc.metadata as Record<string, unknown>
  }
})

/**
 * Convert a DocLink to a DocLinkUpsertOp for JSONL export.
 * Uses docKeyMap to resolve integer IDs to stable name:version keys.
 */
const docLinkToUpsertOp = (link: DocLink, docKeyMap: Map<number, string>): DocLinkUpsertOp | null => {
  const fromDocKey = docKeyMap.get(link.fromDocId as number)
  const toDocKey = docKeyMap.get(link.toDocId as number)
  if (!fromDocKey || !toDocKey) return null
  return {
    v: 1,
    op: "doc_link_upsert",
    ts: link.createdAt.toISOString(),
    id: link.id as number,
    contentHash: contentHash(fromDocKey, toDocKey, link.linkType),
    data: {
      fromDocKey,
      toDocKey,
      linkType: link.linkType
    }
  }
}

/**
 * Convert a TaskDocLink to a TaskDocLinkUpsertOp for JSONL export.
 * Uses docKeyMap to resolve integer doc IDs to stable name:version keys.
 */
const taskDocLinkToUpsertOp = (link: TaskDocLink, docKeyMap: Map<number, string>): TaskDocLinkUpsertOp | null => {
  const docKey = docKeyMap.get(link.docId as number)
  if (!docKey) return null
  return {
    v: 1,
    op: "task_doc_link_upsert",
    ts: link.createdAt.toISOString(),
    id: link.id as number,
    contentHash: contentHash(link.taskId, docKey),
    data: {
      taskId: link.taskId,
      docKey,
      linkType: link.linkType
    }
  }
}

/**
 * Convert an Invariant to an InvariantUpsertOp for JSONL export.
 * Uses docKeyMap to resolve integer doc IDs to stable name:version keys.
 */
const invariantToUpsertOp = (inv: Invariant, docKeyMap: Map<number, string>): InvariantUpsertOp | null => {
  const docKey = docKeyMap.get(inv.docId as number)
  if (!docKey) return null
  return {
    v: 1,
    op: "invariant_upsert",
    ts: inv.createdAt.toISOString(),
    id: inv.id,
    contentHash: contentHash(inv.id),
    data: {
      id: inv.id,
      rule: inv.rule,
      enforcement: inv.enforcement,
      docKey,
      subsystem: inv.subsystem,
      testRef: inv.testRef,
      lintRule: inv.lintRule,
      promptRef: inv.promptRef,
      status: inv.status,
      metadata: inv.metadata as Record<string, unknown>
    }
  }
}

/**
 * Row type for label query results.
 */
interface LabelRow {
  id: number
  name: string
  color: string
  created_at: string
  updated_at: string
}

/**
 * Row type for label assignment query results.
 */
interface LabelAssignmentRow {
  task_id: string
  label_id: number
  created_at: string
}

/**
 * Convert a label row to a LabelUpsertOp for JSONL export.
 */
const labelRowToUpsertOp = (row: LabelRow): LabelUpsertOp => ({
  v: 1,
  op: "label_upsert",
  ts: sqliteToIso(row.updated_at),
  id: row.id,
  contentHash: contentHash(row.name.toLowerCase()),
  data: {
    name: row.name,
    color: row.color
  }
})

/**
 * Convert a label assignment row to a LabelAssignmentUpsertOp for JSONL export.
 * Uses labelNameMap to resolve integer label IDs to stable names.
 */
const labelAssignmentToUpsertOp = (row: LabelAssignmentRow, labelNameMap: Map<number, string>): LabelAssignmentUpsertOp | null => {
  const labelName = labelNameMap.get(row.label_id)
  if (!labelName) return null
  return {
    v: 1,
    op: "label_assignment_upsert",
    ts: sqliteToIso(row.created_at),
    contentHash: contentHash(row.task_id, labelName.toLowerCase()),
    data: {
      taskId: row.task_id,
      labelName
    }
  }
}

/**
 * Generic helper: parse a JSONL file, validate with schema, dedup by contentHash,
 * filter against existing entities, and insert new ones via caller-provided batch function.
 * Returns EntityImportResult with imported/skipped counts.
 */
const importEntityJsonl = <Op extends { contentHash: string; ts: string }>(
  filePath: string,
  schema: Schema.Schema<Op>,
  existingHashes: Set<string>,
  insertBatch: (newOps: ReadonlyArray<Op>) => number
): Effect.Effect<EntityImportResult, ValidationError | DatabaseError> =>
  Effect.gen(function* () {
    const importFileExists = yield* fileExists(filePath)
    if (!importFileExists) {
      return EMPTY_ENTITY_IMPORT_RESULT
    }

    const content = yield* Effect.tryPromise({
      try: () => readFile(filePath, "utf-8"),
      catch: (cause) => new DatabaseError({ cause })
    })

    const lines = content.trim().split("\n").filter(Boolean)
    if (lines.length === 0) {
      return EMPTY_ENTITY_IMPORT_RESULT
    }

    // Parse and dedup by contentHash (keep latest by timestamp)
    const states = new Map<string, Op>()
    for (const line of lines) {
      const parsed = yield* Effect.try({
        try: () => JSON.parse(line),
        catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
      })
      const op: Op = yield* Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(parsed),
        catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
      })
      const existing = states.get(op.contentHash)
      if (!existing || op.ts > existing.ts) {
        states.set(op.contentHash, op)
      }
    }

    // Filter to new entities only (not already in DB)
    const newOps: Op[] = []
    let skipped = 0
    for (const op of states.values()) {
      if (existingHashes.has(op.contentHash)) {
        skipped++
      } else {
        newOps.push(op)
      }
    }

    if (newOps.length === 0) {
      return { imported: 0, skipped }
    }

    // Insert via caller-provided batch function (handles transaction)
    const imported = yield* Effect.try({
      try: () => insertBatch(newOps),
      catch: (cause) => new DatabaseError({ cause })
    })

    return { imported, skipped }
  })

/**
 * Check if a file exists without blocking the event loop.
 */
const fileExists = (filePath: string): Effect.Effect<boolean> =>
  Effect.promise(() => access(filePath).then(() => true).catch(() => false))

/**
 * Write content to file atomically using temp file + rename.
 * Uses async fs operations to avoid blocking the event loop.
 */
const atomicWrite = (filePath: string, content: string): Effect.Effect<void, DatabaseError> =>
  Effect.tryPromise({
    try: async () => {
      const dir = dirname(filePath)
      await mkdir(dir, { recursive: true })
      const tempPath = `${filePath}.tmp.${Date.now()}.${process.pid}.${Math.random().toString(36).slice(2)}`
      await writeFile(tempPath, content, "utf-8")
      await rename(tempPath, filePath)
    },
    catch: (cause) => new DatabaseError({ cause })
  })

export const SyncServiceLive = Layer.effect(
  SyncService,
  Effect.gen(function* () {
    const taskService = yield* TaskService
    const depRepo = yield* DependencyRepository
    const db = yield* SqliteClient
    const learningRepo = yield* LearningRepository
    const fileLearningRepo = yield* FileLearningRepository
    const attemptRepo = yield* AttemptRepository
    const pinRepo = yield* PinRepository
    const anchorRepo = yield* AnchorRepository
    const edgeRepo = yield* EdgeRepository
    const docRepo = yield* DocRepository

    // Helper: Get config value from sync_config table
    const getConfig = (key: string): Effect.Effect<string | null, DatabaseError> =>
      Effect.try({
        try: () => {
          const row = db.prepare("SELECT value FROM sync_config WHERE key = ?").get(key) as { value: string } | undefined
          return row?.value ?? null
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    // Helper: Set config value in sync_config table
    const setConfig = (key: string, value: string): Effect.Effect<void, DatabaseError> =>
      Effect.try({
        try: () => {
          db.prepare(
            "INSERT OR REPLACE INTO sync_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
          ).run(key, value)
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    const syncService = {
      export: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_JSONL_PATH)

          // Get all tasks and dependencies (explicit high limit for full export)
          const tasks = yield* taskService.list()
          const deps = yield* depRepo.getAll(100_000)

          // Convert to sync operations
          const taskOps: SyncOperation[] = tasks.map(taskToUpsertOp)
          const depOps: SyncOperation[] = deps.map(depToAddOp)

          // Combine and sort by timestamp
          const allOps = [...taskOps, ...depOps].sort((a, b) =>
            a.ts.localeCompare(b.ts)
          )

          // Convert to JSONL format (one JSON object per line)
          const jsonl = allOps.map(op => JSON.stringify(op)).join("\n")

          // Write atomically
          yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""))

          // Record export time
          yield* setConfig("last_export", new Date().toISOString())

          return {
            opCount: allOps.length,
            path: filePath
          }
        }),

      import: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_JSONL_PATH)

          // Check if file exists (outside transaction - no DB access)
          const importFileExists = yield* fileExists(filePath)
          if (!importFileExists) {
            return EMPTY_IMPORT_RESULT
          }

          // Read and parse JSONL file (outside transaction - no DB access)
          const content = yield* Effect.tryPromise({
            try: () => readFile(filePath, "utf-8"),
            catch: (cause) => new DatabaseError({ cause })
          })

          const lines = content.trim().split("\n").filter(Boolean)
          if (lines.length === 0) {
            return EMPTY_IMPORT_RESULT
          }

          // Compute hash of file content for concurrent modification detection (TOCTOU protection)
          const fileHash = createHash("sha256").update(content).digest("hex")

          // Parse all operations with Schema validation (outside transaction - no DB access)
          const ops: SyncOperation[] = []
          for (const line of lines) {
            const parsed = yield* Effect.try({
              try: () => JSON.parse(line),
              catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
            })

            const op: SyncOperation = yield* Effect.try({
              try: () => Schema.decodeUnknownSync(SyncOperationSchema)(parsed),
              catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
            })
            ops.push(op)
          }

          // Group by entity and find latest state per entity (timestamp wins)
          const taskStates = new Map<string, { op: TaskUpsertOp | TaskDeleteOp; ts: string }>()
          const depStates = new Map<string, { op: DepAddOp | DepRemoveOp; ts: string }>()

          for (const op of ops) {
            if (op.op === "upsert" || op.op === "delete") {
              const existing = taskStates.get(op.id)
              if (!existing || op.ts > existing.ts) {
                taskStates.set(op.id, { op: op as TaskUpsertOp | TaskDeleteOp, ts: op.ts })
              }
            } else if (op.op === "dep_add" || op.op === "dep_remove") {
              const key = `${op.blockerId}:${op.blockedId}`
              const existing = depStates.get(key)
              if (!existing || op.ts > existing.ts) {
                depStates.set(key, { op: op as DepAddOp | DepRemoveOp, ts: op.ts })
              }
            }
          }

          // Apply task operations in topological order (parents before children)
          // This ensures foreign key constraints are satisfied when importing
          // tasks where child timestamp < parent timestamp
          const sortedTaskEntries = topologicalSortTasks([...taskStates.entries()])

          // Prepare statements outside transaction to minimize write lock duration.
          // better-sqlite3 prepared statements are reusable across transactions.
          const findTaskStmt = db.prepare("SELECT * FROM tasks WHERE id = ?")
          const insertTaskStmt = db.prepare(
            `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at,
                                assignee_type, assignee_id, assigned_at, assigned_by, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          const updateTaskStmt = db.prepare(
            `UPDATE tasks SET title = ?, description = ?, status = ?, parent_id = ?,
             score = ?, updated_at = ?, completed_at = ?,
             assignee_type = ?, assignee_id = ?, assigned_at = ?, assigned_by = ?,
             metadata = ? WHERE id = ?`
          )
          const deleteTaskStmt = db.prepare("DELETE FROM tasks WHERE id = ?")
          const insertDepStmt = db.prepare(
            "INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)"
          )
          const checkDepExistsStmt = db.prepare(
            "SELECT 1 FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?"
          )
          // Cycle detection: check if adding blocker_id→blocked_id would create a cycle
          // by walking DOWNSTREAM from blocked_id to see if it can reach blocker_id
          const checkCycleStmt = db.prepare(
            `WITH RECURSIVE reachable(id) AS (
              SELECT blocked_id FROM task_dependencies WHERE blocker_id = ?
              UNION
              SELECT d.blocked_id FROM task_dependencies d JOIN reachable r ON d.blocker_id = r.id
            )
            SELECT 1 AS found FROM reachable WHERE id = ? LIMIT 1`
          )
          const deleteDepStmt = db.prepare(
            "DELETE FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?"
          )
          const setConfigStmt = db.prepare(
            "INSERT OR REPLACE INTO sync_config (key, value, updated_at) VALUES (?, ?, datetime('now'))"
          )
          const checkParentExistsStmt = db.prepare("SELECT 1 FROM tasks WHERE id = ?")

          // ALL database operations inside a single transaction for atomicity
          // If any operation fails, the entire import is rolled back
          return yield* Effect.acquireUseRelease(
            // Acquire: Begin transaction
            Effect.try({
              try: () => db.exec("BEGIN IMMEDIATE"),
              catch: (cause) => new DatabaseError({ cause })
            }),
            // Use: Run all database operations
            () => Effect.try({
              try: () => {
                let imported = 0
                let skipped = 0
                let conflicts = 0

                // Dependency tracking
                let depsAdded = 0
                let depsRemoved = 0
                let depsSkipped = 0
                const depFailures: Array<{ blockerId: string; blockedId: string; error: string }> = []

                // Apply task operations
                for (const [id, { op }] of sortedTaskEntries) {
                  if (op.op === "upsert") {
                    const existingRow = findTaskStmt.get(id) as { updated_at: string; completed_at: string | null } | undefined

                    // Validate parentId: if it references a task that doesn't exist
                    // in the DB, set to null to avoid FK constraint violation.
                    // Topological sort ensures parents in the import set are already
                    // inserted by this point, so a missing parent is truly orphaned.
                    const parentId = op.data.parentId
                    const effectiveParentId = parentId && checkParentExistsStmt.get(parentId)
                      ? parentId
                      : null
                    const assigneeType = op.data.assigneeType ?? null
                    const assigneeId = assigneeType === null ? null : (op.data.assigneeId ?? null)
                    const assignedAt = assigneeType === null ? null : (op.data.assignedAt ?? null)
                    const assignedBy = assigneeType === null ? null : (op.data.assignedBy ?? null)

                    if (!existingRow) {
                      // Create new task with the specified ID
                      insertTaskStmt.run(
                        id,
                        op.data.title,
                        op.data.description,
                        op.data.status,
                        effectiveParentId,
                        op.data.score,
                        op.data.createdAt ?? op.ts,
                        op.ts,
                        op.data.completedAt ?? null,
                        assigneeType,
                        assigneeId,
                        assignedAt,
                        assignedBy,
                        JSON.stringify(op.data.metadata)
                      )
                      imported++
                    } else {
                      // Update if JSONL timestamp is newer than existing
                      const existingTs = existingRow.updated_at
                      if (op.ts > existingTs) {
                        updateTaskStmt.run(
                          op.data.title,
                          op.data.description,
                          op.data.status,
                          effectiveParentId,
                          op.data.score,
                          op.ts,
                          op.data.completedAt !== undefined ? op.data.completedAt : (existingRow.completed_at ?? null),
                          assigneeType,
                          assigneeId,
                          assignedAt,
                          assignedBy,
                          JSON.stringify(op.data.metadata),
                          id
                        )
                        imported++
                      } else if (op.ts === existingTs) {
                        // Same timestamp - skip
                        skipped++
                      } else {
                        // Local is newer - conflict
                        conflicts++
                      }
                    }
                  } else if (op.op === "delete") {
                    const existingRow = findTaskStmt.get(id) as { updated_at: string } | undefined
                    if (existingRow) {
                      // Check timestamp - only delete if delete operation is newer
                      // Per DD-009 Scenario 2: delete wins if its timestamp > local update timestamp
                      const existingTs = existingRow.updated_at
                      if (op.ts > existingTs) {
                        deleteTaskStmt.run(id)
                        imported++
                      } else if (op.ts === existingTs) {
                        // Same timestamp - skip (ambiguous state, but safe to keep local)
                        skipped++
                      } else {
                        // Local is newer - conflict (local update wins over older delete)
                        conflicts++
                      }
                    }
                  }
                }

                // Apply dependency operations with individual error tracking
                for (const { op } of depStates.values()) {
                  if (op.op === "dep_add") {
                    // Check if dependency already exists
                    const exists = checkDepExistsStmt.get(op.blockerId, op.blockedId)
                    if (exists) {
                      depsSkipped++
                      continue
                    }

                    // Check for cycles before inserting (RULE 4: no circular deps)
                    const wouldCycle = checkCycleStmt.get(op.blockedId, op.blockerId) as { found: number } | undefined
                    if (wouldCycle) {
                      depFailures.push({
                        blockerId: op.blockerId,
                        blockedId: op.blockedId,
                        error: "would create circular dependency"
                      })
                      continue
                    }

                    // Try to add dependency, track failures individually
                    try {
                      insertDepStmt.run(op.blockerId, op.blockedId, op.ts)
                      depsAdded++
                    } catch (e) {
                      // Dependency insert failed (e.g., foreign key constraint)
                      depFailures.push({
                        blockerId: op.blockerId,
                        blockedId: op.blockedId,
                        error: e instanceof Error ? e.message : String(e)
                      })
                    }
                  } else if (op.op === "dep_remove") {
                    // Remove dependency - track if it actually existed
                    const result = deleteDepStmt.run(op.blockerId, op.blockedId)
                    if (result.changes > 0) {
                      depsRemoved++
                    } else {
                      depsSkipped++
                    }
                  }
                }

                // If any dependency inserts failed, abort the entire transaction.
                // This ensures atomicity: tasks and their dependencies are imported
                // together or not at all. A partial import (tasks without deps) would
                // leave the dependency graph incomplete.
                if (depFailures.length > 0) {
                  const details = depFailures
                    .map(f => `${f.blockerId} -> ${f.blockedId}: ${f.error}`)
                    .join("; ")
                  throw new Error(
                    `Sync import rolled back: ${depFailures.length} dependency failure(s): ${details}`
                  )
                }

                // Verify file hasn't been modified during import (TOCTOU protection).
                // Re-read synchronously while holding the DB write lock (BEGIN IMMEDIATE).
                // If another process exported between our initial read and now, the hash
                // will differ and we roll back to avoid committing stale data.
                const verifyContent = readFileSync(filePath, "utf-8")
                const verifyHash = createHash("sha256").update(verifyContent).digest("hex")
                if (verifyHash !== fileHash) {
                  throw new Error(
                    "Sync import rolled back: JSONL file was modified during import (concurrent export detected). Retry the import."
                  )
                }

                // Record import time
                setConfigStmt.run("last_import", new Date().toISOString())

                return {
                  imported,
                  skipped,
                  conflicts,
                  dependencies: {
                    added: depsAdded,
                    removed: depsRemoved,
                    skipped: depsSkipped,
                    failures: depFailures
                  }
                }
              },
              catch: (cause) => new DatabaseError({ cause })
            }),
            // Release: Commit on success, rollback on failure
            (_, exit) =>
              Effect.sync(() => {
                if (Exit.isSuccess(exit)) {
                  try {
                    db.exec("COMMIT")
                  } catch {
                    // COMMIT failed — roll back to prevent a stuck open transaction
                    try { db.exec("ROLLBACK") } catch { /* already rolled back */ }
                  }
                } else {
                  try { db.exec("ROLLBACK") } catch { /* no active transaction */ }
                }
              })
          )
        }),

      status: () =>
        Effect.gen(function* () {
          const filePath = resolve(DEFAULT_JSONL_PATH)

          // Count tasks in database (SQL COUNT instead of loading all rows)
          const dbTaskCount = yield* taskService.count()

          // Count dependencies in database (SQL COUNT instead of loading all rows)
          const dbDepCount = yield* Effect.try({
            try: () => {
              const row = db.prepare("SELECT COUNT(*) as cnt FROM task_dependencies").get() as { cnt: number }
              return row.cnt
            },
            catch: (cause) => new DatabaseError({ cause })
          })

          // Count operations in JSONL file and get file info
          let jsonlOpCount = 0
          let jsonlTaskCount = 0
          let jsonlDepCount = 0
          let lastExport: Date | null = null

          const jsonlFileExists = yield* fileExists(filePath)
          if (jsonlFileExists) {
            // Get file modification time as lastExport
            const stats = yield* Effect.tryPromise({
              try: () => stat(filePath),
              catch: (cause) => new DatabaseError({ cause })
            })
            lastExport = stats.mtime

            // Count non-empty lines (each line is one operation)
            const content = yield* Effect.tryPromise({
              try: () => readFile(filePath, "utf-8"),
              catch: (cause) => new DatabaseError({ cause })
            })
            const lines = content.trim().split("\n").filter(Boolean)
            jsonlOpCount = lines.length

            // Parse JSONL to count EFFECTIVE task and dependency states
            // After git merges, the file may have multiple operations for the same entity
            // We need to deduplicate by ID and track the latest operation (timestamp wins)
            // to get accurate counts that match what the DB state should be after import
            const taskStates = new Map<string, { op: string; ts: string }>()
            const depStates = new Map<string, { op: string; ts: string }>()

            for (const line of lines) {
              try {
                const op = JSON.parse(line) as { op: string; id?: string; ts: string; blockerId?: string; blockedId?: string }
                if (op.op === "upsert" || op.op === "delete") {
                  const existing = taskStates.get(op.id!)
                  if (!existing || op.ts > existing.ts) {
                    taskStates.set(op.id!, { op: op.op, ts: op.ts })
                  }
                } else if (op.op === "dep_add" || op.op === "dep_remove") {
                  const key = `${op.blockerId}:${op.blockedId}`
                  const existing = depStates.get(key)
                  if (!existing || op.ts > existing.ts) {
                    depStates.set(key, { op: op.op, ts: op.ts })
                  }
                }
              } catch {
                // Skip malformed lines for counting purposes
              }
            }

            // Count only entities whose latest operation is an "add" operation
            // (upsert for tasks, dep_add for dependencies)
            for (const state of taskStates.values()) {
              if (state.op === "upsert") {
                jsonlTaskCount++
              }
            }
            for (const state of depStates.values()) {
              if (state.op === "dep_add") {
                jsonlDepCount++
              }
            }
          }

          // Get last export/import timestamps from config
          const lastExportConfig = yield* getConfig("last_export")
          const lastImportConfig = yield* getConfig("last_import")
          const lastExportDate = lastExportConfig && lastExportConfig !== "" ? new Date(lastExportConfig) : lastExport
          const lastImportDate = lastImportConfig && lastImportConfig !== "" ? new Date(lastImportConfig) : null

          // Get auto-sync status
          const autoSyncConfig = yield* getConfig("auto_sync")
          const autoSyncEnabled = autoSyncConfig === "true"

          // Determine if dirty: DB has changes not in JSONL
          // Per DD-009: dirty if tasks exist AND (no lastExport OR any task/dep updated after lastExport)
          // Additionally: dirty if counts differ (indicates deletions/removals)
          let isDirty = false
          if (dbTaskCount > 0 && !jsonlFileExists) {
            // No JSONL file but tasks exist → dirty
            isDirty = true
          } else if (dbTaskCount > 0 || dbDepCount > 0) {
            if (lastExportDate === null) {
              // Tasks/deps exist but never exported → dirty
              isDirty = true
            } else {
              // Check if any task was updated after the last export (uses idx_tasks_updated index)
              const lastExportIso = lastExportDate.toISOString()
              const tasksDirty = yield* Effect.try({
                try: () => {
                  const row = db.prepare(
                    "SELECT COUNT(*) as cnt FROM tasks WHERE updated_at > ?"
                  ).get(lastExportIso) as { cnt: number }
                  return row.cnt > 0
                },
                catch: (cause) => new DatabaseError({ cause })
              })
              // Check if any dependency was created after the last export
              const depsDirty = yield* Effect.try({
                try: () => {
                  const row = db.prepare(
                    "SELECT COUNT(*) as cnt FROM task_dependencies WHERE created_at > ?"
                  ).get(lastExportIso) as { cnt: number }
                  return row.cnt > 0
                },
                catch: (cause) => new DatabaseError({ cause })
              })
              // Check if counts differ (indicates deletions occurred since export)
              // DB count < JSONL count means tasks/deps were deleted
              // DB count > JSONL count means tasks/deps were added (also caught by timestamp check)
              const taskCountMismatch = dbTaskCount !== jsonlTaskCount
              const depCountMismatch = dbDepCount !== jsonlDepCount
              isDirty = tasksDirty || depsDirty || taskCountMismatch || depCountMismatch
            }
          }

          return {
            dbTaskCount,
            jsonlOpCount,
            lastExport: lastExportDate,
            lastImport: lastImportDate,
            isDirty,
            autoSyncEnabled
          }
        }),

      enableAutoSync: () => setConfig("auto_sync", "true"),

      disableAutoSync: () => setConfig("auto_sync", "false"),

      isAutoSyncEnabled: () =>
        Effect.gen(function* () {
          const value = yield* getConfig("auto_sync")
          return value === "true"
        }),

      compact: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_JSONL_PATH)

          // Check if file exists
          const compactFileExists = yield* fileExists(filePath)
          if (!compactFileExists) {
            return { before: 0, after: 0 }
          }

          // Read and parse JSONL file
          const content = yield* Effect.tryPromise({
            try: () => readFile(filePath, "utf-8"),
            catch: (cause) => new DatabaseError({ cause })
          })

          const lines = content.trim().split("\n").filter(Boolean)
          if (lines.length === 0) {
            return { before: 0, after: 0 }
          }

          const before = lines.length

          // Parse and deduplicate - keep only latest state per entity
          const taskStates = new Map<string, SyncOperation>()
          const depStates = new Map<string, SyncOperation>()

          for (const line of lines) {
            const parsed = yield* Effect.try({
              try: () => JSON.parse(line),
              catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
            })

            const op: SyncOperation = yield* Effect.try({
              try: () => Schema.decodeUnknownSync(SyncOperationSchema)(parsed),
              catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
            })

            if (op.op === "upsert" || op.op === "delete") {
              const taskOp = op as TaskUpsertOp | TaskDeleteOp
              const existing = taskStates.get(taskOp.id)
              if (!existing || taskOp.ts > (existing as { ts: string }).ts) {
                taskStates.set(taskOp.id, op)
              }
            } else if (op.op === "dep_add" || op.op === "dep_remove") {
              const depOp = op as DepAddOp | DepRemoveOp
              const key = `${depOp.blockerId}:${depOp.blockedId}`
              const existing = depStates.get(key)
              if (!existing || depOp.ts > (existing as { ts: string }).ts) {
                depStates.set(key, op)
              }
            }
          }

          // Rebuild compacted JSONL, excluding deleted tasks and removed deps
          const compacted: SyncOperation[] = []

          for (const op of taskStates.values()) {
            // Only keep upserts, skip deletes (tombstones)
            if (op.op === "upsert") {
              compacted.push(op)
            }
          }

          for (const op of depStates.values()) {
            // Only keep dep_adds, skip dep_removes
            if (op.op === "dep_add") {
              compacted.push(op)
            }
          }

          // Sort by timestamp for deterministic output
          compacted.sort((a, b) => a.ts.localeCompare(b.ts))

          // Write compacted JSONL atomically
          const newContent = compacted.map(op => JSON.stringify(op)).join("\n")
          yield* atomicWrite(filePath, newContent + (newContent.length > 0 ? "\n" : ""))

          return { before, after: compacted.length }
        }),

      setLastExport: (timestamp: Date) => setConfig("last_export", timestamp.toISOString()),

      setLastImport: (timestamp: Date) => setConfig("last_import", timestamp.toISOString()),

      exportLearnings: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_LEARNINGS_JSONL_PATH)
          const learnings = yield* learningRepo.findAll()
          const ops = learnings.map(learningToUpsertOp)
          ops.sort((a, b) => a.ts.localeCompare(b.ts))
          const jsonl = ops.map(op => JSON.stringify(op)).join("\n")
          yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""))
          return { opCount: ops.length, path: filePath }
        }),

      importLearnings: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_LEARNINGS_JSONL_PATH)
          const existing = yield* learningRepo.findAll()
          const existingHashes = new Set(existing.map(l => contentHash(l.content, l.sourceType)))
          const insertStmt = db.prepare(
            "INSERT INTO learnings (content, source_type, source_ref, created_at, keywords, category) VALUES (?, ?, ?, ?, ?, ?)"
          )
          return yield* importEntityJsonl(
            filePath,
            LearningUpsertOpSchema,
            existingHashes,
            (ops) => {
              db.exec("BEGIN IMMEDIATE")
              try {
                let count = 0
                for (const op of ops) {
                  insertStmt.run(
                    op.data.content,
                    op.data.sourceType,
                    op.data.sourceRef,
                    op.ts,
                    JSON.stringify(op.data.keywords),
                    op.data.category
                  )
                  count++
                }
                db.exec("COMMIT")
                return count
              } catch (e) {
                try { db.exec("ROLLBACK") } catch { /* no active transaction */ }
                throw e
              }
            }
          )
        }),

      exportFileLearnings: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_FILE_LEARNINGS_JSONL_PATH)
          const fileLearnings = yield* fileLearningRepo.findAll()
          const ops = fileLearnings.map(fileLearningToUpsertOp)
          ops.sort((a, b) => a.ts.localeCompare(b.ts))
          const jsonl = ops.map(op => JSON.stringify(op)).join("\n")
          yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""))
          return { opCount: ops.length, path: filePath }
        }),

      importFileLearnings: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_FILE_LEARNINGS_JSONL_PATH)
          const existing = yield* fileLearningRepo.findAll()
          const existingHashes = new Set(existing.map(fl => contentHash(fl.filePattern, fl.note)))
          const insertStmt = db.prepare(
            "INSERT INTO file_learnings (file_pattern, note, task_id, created_at) VALUES (?, ?, ?, ?)"
          )
          return yield* importEntityJsonl(
            filePath,
            FileLearningUpsertOpSchema,
            existingHashes,
            (ops) => {
              db.exec("BEGIN IMMEDIATE")
              try {
                let count = 0
                for (const op of ops) {
                  insertStmt.run(
                    op.data.filePattern,
                    op.data.note,
                    op.data.taskId,
                    op.ts
                  )
                  count++
                }
                db.exec("COMMIT")
                return count
              } catch (e) {
                try { db.exec("ROLLBACK") } catch { /* no active transaction */ }
                throw e
              }
            }
          )
        }),

      exportAttempts: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_ATTEMPTS_JSONL_PATH)
          const attempts = yield* attemptRepo.findAll()
          const ops = attempts.map(attemptToUpsertOp)
          ops.sort((a, b) => a.ts.localeCompare(b.ts))
          const jsonl = ops.map(op => JSON.stringify(op)).join("\n")
          yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""))
          return { opCount: ops.length, path: filePath }
        }),

      importAttempts: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_ATTEMPTS_JSONL_PATH)
          const existing = yield* attemptRepo.findAll()
          const existingHashes = new Set(existing.map(a => contentHash(a.taskId, a.approach)))
          const insertStmt = db.prepare(
            "INSERT INTO attempts (task_id, approach, outcome, reason, created_at) VALUES (?, ?, ?, ?, ?)"
          )
          return yield* importEntityJsonl(
            filePath,
            AttemptUpsertOpSchema,
            existingHashes,
            (ops) => {
              db.exec("BEGIN IMMEDIATE")
              try {
                let count = 0
                for (const op of ops) {
                  insertStmt.run(
                    op.data.taskId,
                    op.data.approach,
                    op.data.outcome,
                    op.data.reason,
                    op.ts
                  )
                  count++
                }
                db.exec("COMMIT")
                return count
              } catch (e) {
                try { db.exec("ROLLBACK") } catch { /* no active transaction */ }
                throw e
              }
            }
          )
        }),

      exportPins: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_PINS_JSONL_PATH)
          const pins = yield* pinRepo.findAll()
          const ops = [...pins].map(pinToUpsertOp)
          ops.sort((a, b) => a.ts.localeCompare(b.ts))
          const jsonl = ops.map(op => JSON.stringify(op)).join("\n")
          yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""))
          return { opCount: ops.length, path: filePath }
        }),

      importPins: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_PINS_JSONL_PATH)
          const existing = yield* pinRepo.findAll()
          const existingHashes = new Set([...existing].map(p => contentHash(p.id, p.content)))
          const upsertStmt = db.prepare(
            `INSERT INTO context_pins (id, content, created_at, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               content = excluded.content,
               updated_at = excluded.updated_at`
          )
          const result = yield* importEntityJsonl(
            filePath,
            PinUpsertOpSchema,
            existingHashes,
            (ops) => {
              db.exec("BEGIN IMMEDIATE")
              try {
                let count = 0
                for (const op of ops) {
                  upsertStmt.run(
                    op.id,
                    op.data.content,
                    op.ts,
                    op.ts
                  )
                  count++
                }
                db.exec("COMMIT")
                return count
              } catch (e) {
                try { db.exec("ROLLBACK") } catch { /* no active transaction */ }
                throw e
              }
            }
          )

          // Sync imported pins to target files (pins exist to be written to context files)
          if (result.imported > 0) {
            const allPins = yield* pinRepo.findAll()
            const targetFiles = yield* pinRepo.getTargetFiles()
            const pinMap = new Map<string, string>()
            for (const pin of allPins) {
              pinMap.set(pin.id, pin.content)
            }
            yield* Effect.try({
              try: () => {
                for (const targetFile of targetFiles) {
                  const projectRoot = process.cwd()
                  const resolvedPath = resolve(projectRoot, targetFile)
                  if (!resolvedPath.startsWith(projectRoot + sep)) continue
                  let fileContent = ""
                  try { fileContent = readFileSync(resolvedPath, "utf-8") } catch { /* file doesn't exist yet */ }
                  const updated = syncBlocks(fileContent, pinMap)
                  if (updated !== fileContent) {
                    const dir = dirname(resolvedPath)
                    mkdirSync(dir, { recursive: true })
                    const tempPath = `${resolvedPath}.tmp.${Date.now()}.${process.pid}`
                    try {
                      writeFileSync(tempPath, updated, "utf-8")
                      renameSync(tempPath, resolvedPath)
                    } catch (e) {
                      try { unlinkSync(tempPath) } catch { /* ignore cleanup error */ }
                      throw e
                    }
                  }
                }
              },
              catch: (cause) => new DatabaseError({ cause })
            })
          }

          return result
        }),

      exportAnchors: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_ANCHORS_JSONL_PATH)
          const anchors = yield* anchorRepo.findAll()
          // Build learning ID → content hash map for stable references
          const learnings = yield* learningRepo.findAll()
          const learningHashMap = new Map<number, string>()
          for (const l of learnings) {
            learningHashMap.set(l.id as number, contentHash(l.content, l.sourceType))
          }
          const ops = anchors.map(a => anchorToUpsertOp(a, learningHashMap))
          ops.sort((a, b) => a.ts.localeCompare(b.ts))
          const jsonl = ops.map(op => JSON.stringify(op)).join("\n")
          yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""))
          return { opCount: ops.length, path: filePath }
        }),

      importAnchors: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_ANCHORS_JSONL_PATH)
          // Build existing anchor content hashes
          const existingAnchors = yield* anchorRepo.findAll()
          const existingLearnings = yield* learningRepo.findAll()
          const learningHashMap = new Map<number, string>()
          for (const l of existingLearnings) {
            learningHashMap.set(l.id as number, contentHash(l.content, l.sourceType))
          }
          const existingHashes = new Set(
            existingAnchors.map(a => {
              const lHash = learningHashMap.get(a.learningId as number) ?? ""
              return contentHash(lHash, a.filePath, a.anchorType, a.anchorValue)
            })
          )
          // Build reverse map: learning content hash → learning ID (for resolving references)
          const hashToLearningId = new Map<string, number>()
          for (const l of existingLearnings) {
            hashToLearningId.set(contentHash(l.content, l.sourceType), l.id as number)
          }
          const insertStmt = db.prepare(
            `INSERT INTO learning_anchors
              (learning_id, anchor_type, anchor_value, file_path, symbol_fqname,
               line_start, line_end, content_hash, content_preview, status, pinned, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          let orphanedCount = 0
          const result = yield* importEntityJsonl(
            filePath,
            AnchorUpsertOpSchema,
            existingHashes,
            (ops) => {
              db.exec("BEGIN IMMEDIATE")
              try {
                let count = 0
                for (const op of ops) {
                  const learningId = hashToLearningId.get(op.data.learningContentHash)
                  if (learningId === undefined) {
                    orphanedCount++
                    continue
                  }
                  insertStmt.run(
                    learningId,
                    op.data.anchorType,
                    op.data.anchorValue,
                    op.data.filePath,
                    op.data.symbolFqname,
                    op.data.lineStart,
                    op.data.lineEnd,
                    op.data.contentHash,
                    op.data.contentPreview,
                    op.data.status,
                    op.data.pinned ? 1 : 0,
                    op.ts
                  )
                  count++
                }
                db.exec("COMMIT")
                return count
              } catch (e) {
                try { db.exec("ROLLBACK") } catch { /* no active transaction */ }
                throw e
              }
            }
          )
          return { imported: result.imported, skipped: result.skipped + orphanedCount }
        }),

      exportEdges: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_EDGES_JSONL_PATH)
          const edges = yield* edgeRepo.findAll()
          // Only export active (non-invalidated) edges
          const activeEdges = edges.filter(e => e.invalidatedAt === null)
          const ops = activeEdges.map(edgeToUpsertOp)
          ops.sort((a, b) => a.ts.localeCompare(b.ts))
          const jsonl = ops.map(op => JSON.stringify(op)).join("\n")
          yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""))
          return { opCount: ops.length, path: filePath }
        }),

      importEdges: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_EDGES_JSONL_PATH)
          const existingEdges = yield* edgeRepo.findAll()
          const existingHashes = new Set(
            existingEdges.map(e =>
              contentHash(e.edgeType, e.sourceType, e.sourceId, e.targetType, e.targetId)
            )
          )
          const insertStmt = db.prepare(
            `INSERT INTO learning_edges
              (edge_type, source_type, source_id, target_type, target_id, weight, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          return yield* importEntityJsonl(
            filePath,
            EdgeUpsertOpSchema,
            existingHashes,
            (ops) => {
              db.exec("BEGIN IMMEDIATE")
              try {
                let count = 0
                for (const op of ops) {
                  insertStmt.run(
                    op.data.edgeType,
                    op.data.sourceType,
                    op.data.sourceId,
                    op.data.targetType,
                    op.data.targetId,
                    op.data.weight,
                    JSON.stringify(op.data.metadata),
                    op.ts
                  )
                  count++
                }
                db.exec("COMMIT")
                return count
              } catch (e) {
                try { db.exec("ROLLBACK") } catch { /* no active transaction */ }
                throw e
              }
            }
          )
        }),

      exportDocs: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_DOCS_JSONL_PATH)
          const docs = yield* docRepo.findAll()
          // Build doc ID → "name:version" key map for stable cross-machine references
          const docKeyMap = new Map<number, string>()
          for (const d of docs) {
            docKeyMap.set(d.id as number, `${d.name}:${d.version}`)
          }
          const docOps = docs.map(d => docToUpsertOp(d, docKeyMap))
          // Get doc links
          const docLinks = yield* docRepo.getAllLinks()
          const docLinkOps = docLinks
            .map(l => docLinkToUpsertOp(l, docKeyMap))
            .filter((op): op is DocLinkUpsertOp => op !== null)
          // Get task-doc links via raw SQL (no getAllTaskLinks method)
          const taskDocLinkRows = yield* Effect.try({
            try: () => db.prepare("SELECT * FROM task_doc_links").all() as Array<{ id: number; task_id: string; doc_id: number; link_type: string; created_at: string }>,
            catch: (cause) => new DatabaseError({ cause })
          })
          const taskDocLinkOps = taskDocLinkRows
            .map(row => taskDocLinkToUpsertOp(
              { id: row.id, taskId: row.task_id, docId: row.doc_id, linkType: row.link_type, createdAt: new Date(row.created_at) } as TaskDocLink,
              docKeyMap
            ))
            .filter((op): op is TaskDocLinkUpsertOp => op !== null)
          // Get invariants
          const invariants = yield* docRepo.findInvariants()
          const invariantOps = invariants
            .map(inv => invariantToUpsertOp(inv, docKeyMap))
            .filter((op): op is InvariantUpsertOp => op !== null)
          // Combine all ops, sort by timestamp
          const allOps = [...docOps, ...docLinkOps, ...taskDocLinkOps, ...invariantOps]
          allOps.sort((a, b) => a.ts.localeCompare(b.ts))
          const jsonl = allOps.map(op => JSON.stringify(op)).join("\n")
          yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""))
          return { opCount: allOps.length, path: filePath }
        }),

      importDocs: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_DOCS_JSONL_PATH)
          const importDocsFileExists = yield* fileExists(filePath)
          if (!importDocsFileExists) return EMPTY_ENTITY_IMPORT_RESULT

          const content = yield* Effect.tryPromise({
            try: () => readFile(filePath, "utf-8"),
            catch: (cause) => new DatabaseError({ cause })
          })
          const lines = content.trim().split("\n").filter(Boolean)
          if (lines.length === 0) return EMPTY_ENTITY_IMPORT_RESULT

          // Parse all ops, group by type
          const docOps: DocUpsertOp[] = []
          const docLinkOps: DocLinkUpsertOp[] = []
          const taskDocLinkOps: TaskDocLinkUpsertOp[] = []
          const invariantOps: InvariantUpsertOp[] = []

          for (const line of lines) {
            const parsed = yield* Effect.try({
              try: () => JSON.parse(line),
              catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
            })
            const opType = parsed.op as string
            if (opType === "doc_upsert") {
              docOps.push(yield* Effect.try({
                try: () => Schema.decodeUnknownSync(DocUpsertOpSchema)(parsed),
                catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
              }))
            } else if (opType === "doc_link_upsert") {
              docLinkOps.push(yield* Effect.try({
                try: () => Schema.decodeUnknownSync(DocLinkUpsertOpSchema)(parsed),
                catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
              }))
            } else if (opType === "task_doc_link_upsert") {
              taskDocLinkOps.push(yield* Effect.try({
                try: () => Schema.decodeUnknownSync(TaskDocLinkUpsertOpSchema)(parsed),
                catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
              }))
            } else if (opType === "invariant_upsert") {
              invariantOps.push(yield* Effect.try({
                try: () => Schema.decodeUnknownSync(InvariantUpsertOpSchema)(parsed),
                catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
              }))
            }
          }

          // Pre-dedup sub-entity ops by contentHash (keep latest timestamp per hash)
          const dedupByHash = <T extends { contentHash: string; ts: string }>(ops: T[]): T[] => {
            const map = new Map<string, T>()
            for (const op of ops) {
              const existing = map.get(op.contentHash)
              if (!existing || op.ts > existing.ts) map.set(op.contentHash, op)
            }
            return [...map.values()]
          }
          const dedupedDocLinkOps = dedupByHash(docLinkOps)
          const dedupedTaskDocLinkOps = dedupByHash(taskDocLinkOps)
          const dedupedInvariantOps = dedupByHash(invariantOps)

          // Build existing doc hashes for dedup
          const existingDocs = yield* docRepo.findAll()
          const existingDocHashes = new Set(existingDocs.map(d => contentHash(d.kind, d.name, String(d.version))))

          // Prepare statements
          const insertDocStmt = db.prepare(
            `INSERT OR IGNORE INTO docs (hash, kind, name, title, version, status, file_path, parent_doc_id, locked_at, created_at, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          const findDocByNameVersionStmt = db.prepare(
            "SELECT id FROM docs WHERE name = ? AND version = ?"
          )
          const checkDocLinkStmt = db.prepare(
            "SELECT 1 FROM doc_links WHERE from_doc_id = ? AND to_doc_id = ? AND link_type = ?"
          )
          const insertDocLinkStmt = db.prepare(
            "INSERT INTO doc_links (from_doc_id, to_doc_id, link_type, created_at) VALUES (?, ?, ?, ?)"
          )
          const checkTaskDocLinkStmt = db.prepare(
            "SELECT 1 FROM task_doc_links WHERE task_id = ? AND doc_id = ? AND link_type = ?"
          )
          const insertTaskDocLinkStmt = db.prepare(
            "INSERT INTO task_doc_links (task_id, doc_id, link_type, created_at) VALUES (?, ?, ?, ?)"
          )
          const findInvariantStmt = db.prepare(
            "SELECT 1 FROM invariants WHERE id = ?"
          )
          const insertInvariantStmt = db.prepare(
            `INSERT INTO invariants (id, rule, enforcement, doc_id, subsystem, test_ref, lint_rule, prompt_ref, status, created_at, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )

          // Hoist parent resolution UPDATE statement outside the loop
          const updateParentDocStmt = db.prepare(
            "UPDATE docs SET parent_doc_id = ? WHERE id = ?"
          )

          return yield* Effect.try({
            try: () => {
              db.exec("BEGIN IMMEDIATE")
              try {
                let imported = 0
                let skipped = 0

                // 1. Import docs (dedup by content hash = kind:name:version)
                // Track newly inserted doc keys for parent resolution
                const newDocKeyToId = new Map<string, number>()
                const insertedDocKeys = new Set<string>()
                for (const op of docOps) {
                  if (existingDocHashes.has(op.contentHash)) {
                    // Still populate the key map for link resolution
                    const existing = findDocByNameVersionStmt.get(op.data.name, op.data.version) as { id: number } | undefined
                    if (existing) newDocKeyToId.set(`${op.data.name}:${op.data.version}`, existing.id)
                    skipped++
                    continue
                  }
                  // Check if doc already exists by name+version (handles kind mismatch with UNIQUE index)
                  const existing = findDocByNameVersionStmt.get(op.data.name, op.data.version) as { id: number } | undefined
                  if (existing) {
                    newDocKeyToId.set(`${op.data.name}:${op.data.version}`, existing.id)
                    skipped++
                    continue
                  }
                  // INSERT OR IGNORE handles race with UNIQUE(name, version)
                  const result = insertDocStmt.run(
                    op.data.hash,
                    op.data.kind,
                    op.data.name,
                    op.data.title,
                    op.data.version,
                    op.data.status,
                    op.data.filePath,
                    null, // parent_doc_id resolved after all docs inserted
                    op.data.lockedAt ?? null,
                    op.ts,
                    JSON.stringify(op.data.metadata)
                  )
                  if (result.changes > 0) {
                    const docKey = `${op.data.name}:${op.data.version}`
                    newDocKeyToId.set(docKey, result.lastInsertRowid as number)
                    insertedDocKeys.add(docKey)
                    imported++
                  } else {
                    // INSERT OR IGNORE did nothing — row already exists
                    const row = findDocByNameVersionStmt.get(op.data.name, op.data.version) as { id: number } | undefined
                    if (row) newDocKeyToId.set(`${op.data.name}:${op.data.version}`, row.id)
                    skipped++
                  }
                }

                // Helper: resolve docKey (name:version) to doc ID
                const resolveDocKey = (docKey: string): number | undefined => {
                  const newId = newDocKeyToId.get(docKey)
                  if (newId !== undefined) return newId
                  const parts = docKey.split(":")
                  if (parts.length < 2) return undefined
                  const name = parts.slice(0, -1).join(":")
                  const version = parseInt(parts[parts.length - 1], 10)
                  if (isNaN(version)) return undefined
                  const row = findDocByNameVersionStmt.get(name, version) as { id: number } | undefined
                  return row?.id
                }

                // Resolve parent doc references — only for newly inserted docs
                for (const op of docOps) {
                  if (!op.data.parentDocKey) continue
                  const docKey = `${op.data.name}:${op.data.version}`
                  if (!insertedDocKeys.has(docKey)) continue
                  const docId = resolveDocKey(docKey)
                  const parentId = resolveDocKey(op.data.parentDocKey)
                  if (docId && parentId) {
                    updateParentDocStmt.run(parentId, docId)
                  }
                }

                // 2. Import doc links
                for (const op of dedupedDocLinkOps) {
                  const fromId = resolveDocKey(op.data.fromDocKey)
                  const toId = resolveDocKey(op.data.toDocKey)
                  if (!fromId || !toId) {
                    skipped++
                    continue
                  }
                  if (checkDocLinkStmt.get(fromId, toId, op.data.linkType)) {
                    skipped++
                    continue
                  }
                  insertDocLinkStmt.run(fromId, toId, op.data.linkType, op.ts)
                  imported++
                }

                // 3. Import task-doc links
                for (const op of dedupedTaskDocLinkOps) {
                  const docId = resolveDocKey(op.data.docKey)
                  if (!docId) {
                    skipped++
                    continue
                  }
                  if (checkTaskDocLinkStmt.get(op.data.taskId, docId, op.data.linkType)) {
                    skipped++
                    continue
                  }
                  try {
                    insertTaskDocLinkStmt.run(op.data.taskId, docId, op.data.linkType, op.ts)
                    imported++
                  } catch {
                    // Skip FK failures (task may not exist)
                    skipped++
                  }
                }

                // 4. Import invariants (use op.id as the canonical invariant ID)
                for (const op of dedupedInvariantOps) {
                  if (findInvariantStmt.get(op.id)) {
                    skipped++
                    continue
                  }
                  const docId = resolveDocKey(op.data.docKey)
                  if (!docId) {
                    skipped++
                    continue
                  }
                  insertInvariantStmt.run(
                    op.id,
                    op.data.rule,
                    op.data.enforcement,
                    docId,
                    op.data.subsystem,
                    op.data.testRef,
                    op.data.lintRule,
                    op.data.promptRef,
                    op.data.status,
                    op.ts,
                    JSON.stringify(op.data.metadata)
                  )
                  imported++
                }

                db.exec("COMMIT")
                return { imported, skipped }
              } catch (e) {
                try { db.exec("ROLLBACK") } catch { /* no active transaction */ }
                throw e
              }
            },
            catch: (cause) => new DatabaseError({ cause })
          })
        }),

      exportLabels: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_LABELS_JSONL_PATH)
          // Read labels via raw SQL (no repository layer exists)
          const labels = yield* Effect.try({
            try: () => db.prepare("SELECT * FROM task_labels").all() as LabelRow[],
            catch: (cause) => new DatabaseError({ cause })
          })
          const labelNameMap = new Map<number, string>()
          for (const l of labels) {
            labelNameMap.set(l.id, l.name)
          }
          const labelOps = labels.map(labelRowToUpsertOp)
          // Read label assignments
          const assignments = yield* Effect.try({
            try: () => db.prepare("SELECT * FROM task_label_assignments").all() as LabelAssignmentRow[],
            catch: (cause) => new DatabaseError({ cause })
          })
          const assignmentOps = assignments
            .map(a => labelAssignmentToUpsertOp(a, labelNameMap))
            .filter((op): op is LabelAssignmentUpsertOp => op !== null)
          const allOps = [...labelOps, ...assignmentOps]
          allOps.sort((a, b) => a.ts.localeCompare(b.ts))
          const jsonl = allOps.map(op => JSON.stringify(op)).join("\n")
          yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""))
          return { opCount: allOps.length, path: filePath }
        }),

      importLabels: (path?: string) =>
        Effect.gen(function* () {
          const filePath = resolve(path ?? DEFAULT_LABELS_JSONL_PATH)
          const importLabelsFileExists = yield* fileExists(filePath)
          if (!importLabelsFileExists) return EMPTY_ENTITY_IMPORT_RESULT

          const content = yield* Effect.tryPromise({
            try: () => readFile(filePath, "utf-8"),
            catch: (cause) => new DatabaseError({ cause })
          })
          const lines = content.trim().split("\n").filter(Boolean)
          if (lines.length === 0) return EMPTY_ENTITY_IMPORT_RESULT

          const labelOps: LabelUpsertOp[] = []
          const assignmentOps: LabelAssignmentUpsertOp[] = []

          for (const line of lines) {
            const parsed = yield* Effect.try({
              try: () => JSON.parse(line),
              catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
            })
            const opType = parsed.op as string
            if (opType === "label_upsert") {
              labelOps.push(yield* Effect.try({
                try: () => Schema.decodeUnknownSync(LabelUpsertOpSchema)(parsed),
                catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
              }))
            } else if (opType === "label_assignment_upsert") {
              assignmentOps.push(yield* Effect.try({
                try: () => Schema.decodeUnknownSync(LabelAssignmentUpsertOpSchema)(parsed),
                catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
              }))
            }
          }

          // Build existing label hashes
          const existingLabels = yield* Effect.try({
            try: () => db.prepare("SELECT * FROM task_labels").all() as LabelRow[],
            catch: (cause) => new DatabaseError({ cause })
          })
          const existingLabelHashes = new Set(existingLabels.map(l => contentHash(l.name.toLowerCase())))

          const findLabelByNameStmt = db.prepare(
            "SELECT id FROM task_labels WHERE lower(name) = lower(?)"
          )
          const insertLabelStmt = db.prepare(
            "INSERT INTO task_labels (name, color, created_at, updated_at) VALUES (?, ?, ?, ?)"
          )
          const checkAssignmentStmt = db.prepare(
            "SELECT 1 FROM task_label_assignments WHERE task_id = ? AND label_id = ?"
          )
          const insertAssignmentStmt = db.prepare(
            "INSERT INTO task_label_assignments (task_id, label_id, created_at) VALUES (?, ?, ?)"
          )

          return yield* Effect.try({
            try: () => {
              db.exec("BEGIN IMMEDIATE")
              try {
                let imported = 0
                let skipped = 0
                const newLabelNameToId = new Map<string, number>()

                // 1. Import labels (dedup by lower(name))
                for (const op of labelOps) {
                  if (existingLabelHashes.has(op.contentHash)) {
                    // Still populate the name map for assignment resolution
                    const existing = findLabelByNameStmt.get(op.data.name) as { id: number } | undefined
                    if (existing) newLabelNameToId.set(op.data.name.toLowerCase(), existing.id)
                    skipped++
                    continue
                  }
                  const existing = findLabelByNameStmt.get(op.data.name) as { id: number } | undefined
                  if (existing) {
                    newLabelNameToId.set(op.data.name.toLowerCase(), existing.id)
                    skipped++
                    continue
                  }
                  const result = insertLabelStmt.run(op.data.name, op.data.color, op.ts, op.ts)
                  newLabelNameToId.set(op.data.name.toLowerCase(), result.lastInsertRowid as number)
                  imported++
                }

                // Helper: resolve label name to ID
                const resolveLabelId = (name: string): number | undefined => {
                  const newId = newLabelNameToId.get(name.toLowerCase())
                  if (newId !== undefined) return newId
                  const row = findLabelByNameStmt.get(name) as { id: number } | undefined
                  return row?.id
                }

                // 2. Import label assignments
                for (const op of assignmentOps) {
                  const labelId = resolveLabelId(op.data.labelName)
                  if (!labelId) {
                    skipped++
                    continue
                  }
                  if (checkAssignmentStmt.get(op.data.taskId, labelId)) {
                    skipped++
                    continue
                  }
                  try {
                    insertAssignmentStmt.run(op.data.taskId, labelId, op.ts)
                    imported++
                  } catch {
                    // Skip FK failures (task may not exist)
                    skipped++
                  }
                }

                db.exec("COMMIT")
                return { imported, skipped }
              } catch (e) {
                try { db.exec("ROLLBACK") } catch { /* no active transaction */ }
                throw e
              }
            },
            catch: (cause) => new DatabaseError({ cause })
          })
        }),

      exportAll: (options?: ExportOptions) =>
        Effect.gen(function* () {
          const tasks = yield* syncService.export()
          const learnings = options?.learnings !== false
            ? yield* syncService.exportLearnings()
            : undefined
          const fileLearnings = options?.fileLearnings !== false
            ? yield* syncService.exportFileLearnings()
            : undefined
          const attempts = options?.attempts !== false
            ? yield* syncService.exportAttempts()
            : undefined
          const pins = options?.pins !== false
            ? yield* syncService.exportPins()
            : undefined
          const anchors = options?.anchors !== false
            ? yield* syncService.exportAnchors()
            : undefined
          const edges = options?.edges !== false
            ? yield* syncService.exportEdges()
            : undefined
          const docs = options?.docs !== false
            ? yield* syncService.exportDocs()
            : undefined
          const labels = options?.labels !== false
            ? yield* syncService.exportLabels()
            : undefined
          return { tasks, learnings, fileLearnings, attempts, pins, anchors, edges, docs, labels }
        }),

      importAll: (options?: ExportOptions) =>
        Effect.gen(function* () {
          // Import in dependency order: tasks → learnings → anchors → edges → file-learnings → attempts → pins → docs → labels
          const tasks = yield* syncService.import()
          const learnings = options?.learnings !== false
            ? yield* syncService.importLearnings()
            : undefined
          // Anchors depend on learnings (FK reference) — skip if learnings are disabled
          const anchors = options?.anchors !== false && options?.learnings !== false
            ? yield* syncService.importAnchors()
            : undefined
          // Edges are a generic graph layer with no FK dependency on learnings
          const edges = options?.edges !== false
            ? yield* syncService.importEdges()
            : undefined
          const fileLearnings = options?.fileLearnings !== false
            ? yield* syncService.importFileLearnings()
            : undefined
          const attempts = options?.attempts !== false
            ? yield* syncService.importAttempts()
            : undefined
          const pins = options?.pins !== false
            ? yield* syncService.importPins()
            : undefined
          const docs = options?.docs !== false
            ? yield* syncService.importDocs()
            : undefined
          const labels = options?.labels !== false
            ? yield* syncService.importLabels()
            : undefined
          return { tasks, learnings, fileLearnings, attempts, pins, anchors, edges, docs, labels }
        })
    }

    return syncService
  })
)
