import type {
  Task,
  TaskDependency,
  Learning,
  FileLearning,
  Attempt,
  Pin,
  Anchor,
  Edge,
  Doc,
  DocLink,
  TaskDocLink,
  Invariant
} from "@jamesaphoenix/tx-types"
import type {
  TaskUpsertOp,
  DepAddOp,
  LearningUpsertOp,
  FileLearningUpsertOp,
  AttemptUpsertOp,
  PinUpsertOp,
  AnchorUpsertOp,
  EdgeUpsertOp,
  DocUpsertOp,
  DocLinkUpsertOp,
  TaskDocLinkUpsertOp,
  InvariantUpsertOp,
  LabelUpsertOp,
  LabelAssignmentUpsertOp,
} from "../../schemas/sync.js"
import { contentHash, sqliteToIso } from "./sync-helpers.js"

/** Convert a Task to a TaskUpsertOp for JSONL export. */
export const taskToUpsertOp = (task: Task): TaskUpsertOp => ({
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

/** Convert a TaskDependency to a DepAddOp for JSONL export. */
export const depToAddOp = (dep: TaskDependency): DepAddOp => ({
  v: 1,
  op: "dep_add",
  ts: dep.createdAt.toISOString(),
  blockerId: dep.blockerId,
  blockedId: dep.blockedId
})

/** Convert a Learning to a LearningUpsertOp for JSONL export. */
export const learningToUpsertOp = (learning: Learning): LearningUpsertOp => ({
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

/** Convert a FileLearning to a FileLearningUpsertOp for JSONL export. */
export const fileLearningToUpsertOp = (fl: FileLearning): FileLearningUpsertOp => ({
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

/** Convert an Attempt to an AttemptUpsertOp for JSONL export. */
export const attemptToUpsertOp = (attempt: Attempt): AttemptUpsertOp => ({
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

/** Convert a Pin to a PinUpsertOp for JSONL export. */
export const pinToUpsertOp = (pin: Pin): PinUpsertOp => ({
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
export const anchorToUpsertOp = (anchor: Anchor, learningHashMap: Map<number, string>): AnchorUpsertOp => {
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
      pinned: anchor.pinned,
    }
  }
}

/** Convert an Edge to an EdgeUpsertOp for JSONL export. */
export const edgeToUpsertOp = (edge: Edge): EdgeUpsertOp => ({
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
    metadata: edge.metadata,
  }
})

/**
 * Convert a Doc to a DocUpsertOp for JSONL export.
 * Uses parentDocKeyMap to resolve integer parent_doc_id to stable name:version key.
 */
export const docToUpsertOp = (doc: Doc, parentDocKeyMap: Map<number, string>): DocUpsertOp => ({
  v: 1,
  op: "doc_upsert",
  ts: doc.createdAt.toISOString(),
  id: doc.id as number,
  contentHash: contentHash(doc.kind, doc.name, String(doc.version)),
  data: {
    hash: doc.hash,
    kind: doc.kind,
    name: doc.name,
    title: doc.title,
    version: doc.version,
    status: doc.status,
    filePath: doc.filePath,
    parentDocKey: doc.parentDocId ? (parentDocKeyMap.get(doc.parentDocId as number) ?? null) : null,
    lockedAt: doc.lockedAt?.toISOString() ?? null,
    metadata: doc.metadata,
  }
})

/**
 * Convert a DocLink to a DocLinkUpsertOp for JSONL export.
 * Uses docKeyMap to resolve integer doc IDs to stable name:version keys.
 */
export const docLinkToUpsertOp = (link: DocLink, docKeyMap: Map<number, string>): DocLinkUpsertOp | null => {
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
      linkType: link.linkType,
    }
  }
}

/**
 * Convert a TaskDocLink to a TaskDocLinkUpsertOp for JSONL export.
 * Uses docKeyMap to resolve integer doc IDs to stable name:version keys.
 */
export const taskDocLinkToUpsertOp = (link: TaskDocLink, docKeyMap: Map<number, string>): TaskDocLinkUpsertOp | null => {
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
export const invariantToUpsertOp = (inv: Invariant, docKeyMap: Map<number, string>): InvariantUpsertOp | null => {
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

/** Row type for label query results. */
export interface LabelRow {
  id: number
  name: string
  color: string
  created_at: string
  updated_at: string
}

/** Row type for label assignment query results. */
export interface LabelAssignmentRow {
  task_id: string
  label_id: number
  created_at: string
}

/** Convert a label row to a LabelUpsertOp for JSONL export. */
export const labelRowToUpsertOp = (row: LabelRow): LabelUpsertOp => ({
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
export const labelAssignmentToUpsertOp = (row: LabelAssignmentRow, labelNameMap: Map<number, string>): LabelAssignmentUpsertOp | null => {
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
