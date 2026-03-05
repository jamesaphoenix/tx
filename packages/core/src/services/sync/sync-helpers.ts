import { createHash } from "node:crypto"
import {
  type SyncEventEnvelope,
  type SyncEventType
} from "../../schemas/sync-events.js"
import { generateUlid } from "../../utils/ulid.js"

/**
 * Compute a content hash for cross-machine dedup.
 * Entities with auto-increment IDs use this to identify duplicates.
 */
export const contentHash = (...parts: string[]): string =>
  createHash("sha256").update(parts.join("|")).digest("hex")

/**
 * Convert SQLite datetime string ("YYYY-MM-DD HH:MM:SS") to ISO 8601 ("YYYY-MM-DDTHH:MM:SS").
 * Labels use raw SQL so timestamps come in SQLite format rather than Date objects.
 */
export const sqliteToIso = (s: string): string => {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s.replace(" ", "T") + ".000Z"
  return s
}

export const V1_TO_SYNC_TYPE: Record<string, SyncEventType> = {
  upsert: "task.upsert",
  delete: "task.delete",
  dep_add: "dep.add",
  dep_remove: "dep.remove",
  learning_upsert: "learning.upsert",
  learning_delete: "learning.delete",
  file_learning_upsert: "file_learning.upsert",
  file_learning_delete: "file_learning.delete",
  attempt_upsert: "attempt.upsert",
  pin_upsert: "pin.upsert",
  pin_delete: "pin.delete",
  anchor_upsert: "anchor.upsert",
  anchor_delete: "anchor.delete",
  edge_upsert: "edge.upsert",
  edge_delete: "edge.delete",
  doc_upsert: "doc.upsert",
  doc_delete: "doc.delete",
  doc_link_upsert: "doc_link.upsert",
  task_doc_link_upsert: "task_doc_link.upsert",
  invariant_upsert: "invariant.upsert",
  label_upsert: "label.upsert",
  label_assignment_upsert: "label_assignment.upsert",
}

export const entityIdFromV1Op = (op: Record<string, unknown>): string => {
  const kind = typeof op.op === "string" ? op.op : ""
  switch (kind) {
    case "dep_add":
    case "dep_remove":
      return `${String(op.blockerId)}:${String(op.blockedId)}`
    case "learning_upsert":
    case "learning_delete":
    case "file_learning_upsert":
    case "file_learning_delete":
    case "attempt_upsert":
    case "anchor_upsert":
    case "anchor_delete":
    case "edge_upsert":
    case "edge_delete":
    case "doc_upsert":
    case "doc_delete":
    case "label_upsert":
      return String(op.contentHash ?? op.id ?? "")
    case "doc_link_upsert":
      return String(op.contentHash ?? op.id ?? "")
    case "task_doc_link_upsert":
      return String(op.contentHash ?? op.id ?? "")
    case "label_assignment_upsert":
      return String(op.contentHash ?? "")
    default:
      return String(op.id ?? op.contentHash ?? "")
  }
}

export const opToSyncEventType = (op: Record<string, unknown>): SyncEventType | null => {
  const v1Op = typeof op.op === "string" ? op.op : ""
  return V1_TO_SYNC_TYPE[v1Op] ?? null
}

export const getTsFromOp = (op: Record<string, unknown>): string =>
  typeof op.ts === "string" ? op.ts : new Date().toISOString()

export const getEventIdFromOp = (op: Record<string, unknown>): string =>
  typeof op.eventId === "string" ? op.eventId : (typeof op.__event_id === "string" ? op.__event_id : "")

export const compareOpOrder = (a: Record<string, unknown>, b: Record<string, unknown>): number => {
  const t = getTsFromOp(a).localeCompare(getTsFromOp(b))
  if (t !== 0) return t
  const eventCmp = getEventIdFromOp(a).localeCompare(getEventIdFromOp(b))
  if (eventCmp !== 0) return eventCmp
  return 0
}

export const compareSyncOrder = (
  a: { ts: string; eventId?: string },
  b: { ts: string; eventId?: string }
): number => {
  const t = a.ts.localeCompare(b.ts)
  if (t !== 0) return t
  return (a.eventId ?? "").localeCompare(b.eventId ?? "")
}

export const toSyncEvent = (
  op: Record<string, unknown>,
  streamId: string,
  seq: number
): SyncEventEnvelope | null => {
  const type = opToSyncEventType(op)
  if (!type) return null
  return {
    event_id: generateUlid(),
    stream_id: streamId,
    seq,
    ts: getTsFromOp(op),
    type,
    entity_id: entityIdFromV1Op(op),
    v: 2,
    payload: op,
  }
}

export const syncEventToV1Op = (event: SyncEventEnvelope): Record<string, unknown> | null => {
  if (!event.payload || typeof event.payload !== "object") return null
  const payload = event.payload as Record<string, unknown>
  return typeof payload.op === "string" ? payload : null
}

export type V1OpBuckets = {
  tasks: Record<string, unknown>[]
  learnings: Record<string, unknown>[]
  fileLearnings: Record<string, unknown>[]
  attempts: Record<string, unknown>[]
  pins: Record<string, unknown>[]
  anchors: Record<string, unknown>[]
  edges: Record<string, unknown>[]
  docs: Record<string, unknown>[]
  labels: Record<string, unknown>[]
}

export const emptyV1Buckets = (): V1OpBuckets => ({
  tasks: [],
  learnings: [],
  fileLearnings: [],
  attempts: [],
  pins: [],
  anchors: [],
  edges: [],
  docs: [],
  labels: [],
})

export const bucketForOp = (opName: string): keyof V1OpBuckets | null => {
  if (opName === "upsert" || opName === "delete" || opName === "dep_add" || opName === "dep_remove") return "tasks"
  if (opName === "learning_upsert" || opName === "learning_delete") return "learnings"
  if (opName === "file_learning_upsert" || opName === "file_learning_delete") return "fileLearnings"
  if (opName === "attempt_upsert") return "attempts"
  if (opName === "pin_upsert" || opName === "pin_delete") return "pins"
  if (opName === "anchor_upsert" || opName === "anchor_delete") return "anchors"
  if (opName === "edge_upsert" || opName === "edge_delete") return "edges"
  if (opName === "doc_upsert" || opName === "doc_delete" || opName === "doc_link_upsert" || opName === "task_doc_link_upsert" || opName === "invariant_upsert") return "docs"
  if (opName === "label_upsert" || opName === "label_assignment_upsert") return "labels"
  return null
}

export const stateCategoryForOp = (opName: string): string | null => {
  if (opName === "upsert" || opName === "delete") return "task"
  if (opName === "dep_add" || opName === "dep_remove") return "dep"
  if (opName === "learning_upsert" || opName === "learning_delete") return "learning"
  if (opName === "file_learning_upsert" || opName === "file_learning_delete") return "file_learning"
  if (opName === "attempt_upsert") return "attempt"
  if (opName === "pin_upsert" || opName === "pin_delete") return "pin"
  if (opName === "anchor_upsert" || opName === "anchor_delete") return "anchor"
  if (opName === "edge_upsert" || opName === "edge_delete") return "edge"
  if (opName === "doc_upsert" || opName === "doc_delete") return "doc"
  if (opName === "doc_link_upsert") return "doc_link"
  if (opName === "task_doc_link_upsert") return "task_doc_link"
  if (opName === "invariant_upsert") return "invariant"
  if (opName === "label_upsert") return "label"
  if (opName === "label_assignment_upsert") return "label_assignment"
  return null
}

export const isRemovalOp = (opName: string): boolean =>
  opName === "delete" ||
  opName === "dep_remove" ||
  opName === "learning_delete" ||
  opName === "file_learning_delete" ||
  opName === "pin_delete" ||
  opName === "anchor_delete" ||
  opName === "edge_delete" ||
  opName === "doc_delete"

export const stateKeyForOp = (op: Record<string, unknown>): string | null => {
  const opName = typeof op.op === "string" ? op.op : ""
  const category = stateCategoryForOp(opName)
  if (!category) return null
  return `${category}:${entityIdFromV1Op(op)}`
}

/**
 * Topologically sort task operations so parents are processed before children.
 */
export function topologicalSortTasks<T extends { op: { op: string; data?: { parentId?: string | null } } }>(
  entries: Array<[string, T]>
): Array<[string, T]> {
  const upsertEntries = entries.filter(([, { op }]) => op.op === "upsert")
  const deleteEntries = entries.filter(([, { op }]) => op.op === "delete")

  const importingIds = new Set(upsertEntries.map(([id]) => id))

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

  const inDegree = new Map<string, number>()
  for (const [id, { op }] of upsertEntries) {
    const parentId = (op as { data?: { parentId?: string | null } }).data?.parentId
    const hasParentInSet = parentId && importingIds.has(parentId)
    inDegree.set(id, hasParentInSet ? 1 : 0)
  }

  const queue: string[] = []
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id)
    }
  }

  const sorted: Array<[string, T]> = []
  const entryMap = new Map(upsertEntries)

  while (queue.length > 0) {
    const id = queue.shift()!
    const entry = entryMap.get(id)
    if (entry) {
      sorted.push([id, entry])
    }

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

  if (sorted.length < upsertEntries.length) {
    return [...upsertEntries, ...deleteEntries]
  }

  return [...sorted, ...deleteEntries]
}
