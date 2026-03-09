// @ts-nocheck
import { Context, Effect, Exit, Layer, Schema } from "effect";
import { writeFile, rename, readFile, mkdir, access, appendFile, readdir, rm, stat } from "node:fs/promises";
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, basename } from "node:path";
import { DatabaseError, ValidationError } from "../../errors.js";
import type { TaskNotFoundError } from "../../errors.js";
import { SqliteClient } from "../../db.js";
import { TaskService } from "../../services/task-service.js";
import { StreamService } from "../../services/stream-service.js";
import { DependencyRepository } from "../../repo/dep-repo.js";
import { LearningRepository } from "../../repo/learning-repo.js";
import { FileLearningRepository } from "../../repo/file-learning-repo.js";
import { AttemptRepository } from "../../repo/attempt-repo.js";
import { PinRepository } from "../../repo/pin-repo.js";
import { syncBlocks } from "../../utils/pin-file.js";
import { resolvePathWithin } from "../../utils/file-path.js";
import { AnchorRepository } from "../../repo/anchor-repo.js";
import { EdgeRepository } from "../../repo/edge-repo.js";
import { DocRepository } from "../../repo/doc-repo.js";
import { LearningUpsertOp as LearningUpsertOpSchema, FileLearningUpsertOp as FileLearningUpsertOpSchema, AttemptUpsertOp as AttemptUpsertOpSchema, PinUpsertOp as PinUpsertOpSchema, AnchorUpsertOp as AnchorUpsertOpSchema, EdgeUpsertOp as EdgeUpsertOpSchema, DocUpsertOp as DocUpsertOpSchema, DocLinkUpsertOp as DocLinkUpsertOpSchema, TaskDocLinkUpsertOp as TaskDocLinkUpsertOpSchema, InvariantUpsertOp as InvariantUpsertOpSchema, LabelUpsertOp as LabelUpsertOpSchema, LabelAssignmentUpsertOp as LabelAssignmentUpsertOpSchema, TaskSyncOperation as TaskSyncOperationSchema } from "../../schemas/sync.js";
import { SyncEventEnvelopeSchema } from "../../schemas/sync-events.js";
import { generateUlid } from "../../utils/ulid.js";
import type { EntityImportResult, ImportResult, LegacySyncExportResult, SyncCompactResult, SyncExportResult, SyncHydrateResult, SyncImportResult, SyncStatus, SyncStreamInfoResult } from "../../services/sync/types.js";
import { applyEntityImportContract } from "../../services/sync/entity-import.js";
import { applyEntityExportContract } from "../../services/sync/entity-export.js";
import { importEntityJsonl } from "../../services/sync/file-utils.js";
/**
 * SyncService provides stream-event export/import for git-tracked task syncing.
 * See DD-009 for full specification.
 */
export class SyncService extends Context.Tag("SyncService")<
    SyncService,
    {
        readonly status: () => Effect.Effect<SyncStatus, DatabaseError>;
        readonly enableAutoSync: () => Effect.Effect<void, DatabaseError>;
        readonly disableAutoSync: () => Effect.Effect<void, DatabaseError>;
        readonly isAutoSyncEnabled: () => Effect.Effect<boolean, DatabaseError>;
        readonly export: {
            (): Effect.Effect<SyncExportResult, DatabaseError | ValidationError>;
            (path: string): Effect.Effect<LegacySyncExportResult, DatabaseError | ValidationError>;
        };
        readonly import: {
            (): Effect.Effect<SyncImportResult, ValidationError | DatabaseError | TaskNotFoundError>;
            (path: string): Effect.Effect<ImportResult, ValidationError | DatabaseError | TaskNotFoundError>;
        };
        readonly hydrate: () => Effect.Effect<SyncHydrateResult, ValidationError | DatabaseError | TaskNotFoundError>;
        readonly importDecisions: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>;
        readonly exportDecisions: (path?: string) => Effect.Effect<LegacySyncExportResult, DatabaseError>;
        readonly compact: (path?: string) => Effect.Effect<SyncCompactResult, DatabaseError | ValidationError>;
        readonly stream: () => Effect.Effect<SyncStreamInfoResult, DatabaseError | ValidationError>;
    }
>() {
}
const DEFAULT_JSONL_PATH = ".tx/tasks.jsonl";
const DEFAULT_LEARNINGS_JSONL_PATH = ".tx/learnings.jsonl";
const DEFAULT_FILE_LEARNINGS_JSONL_PATH = ".tx/file-learnings.jsonl";
const DEFAULT_ATTEMPTS_JSONL_PATH = ".tx/attempts.jsonl";
const DEFAULT_PINS_JSONL_PATH = ".tx/pins.jsonl";
const DEFAULT_ANCHORS_JSONL_PATH = ".tx/anchors.jsonl";
const DEFAULT_EDGES_JSONL_PATH = ".tx/edges.jsonl";
const DEFAULT_DOCS_JSONL_PATH = ".tx/docs.jsonl";
const DEFAULT_LABELS_JSONL_PATH = ".tx/labels.jsonl";
const DEFAULT_STREAMS_DIR = ".tx/streams";
const DEFAULT_SYNC_WATERMARK_KEY = "last_import_at";
const FULL_EXPORT_LIMIT = 1_000_000_000;
const MAX_SYNC_JSONL_FILE_BYTES = 64 * 1024 * 1024;
const MAX_STREAM_IMPORT_EVENTS = 250_000;
/**
 * Compute a content hash for cross-machine dedup.
 * Entities with auto-increment IDs use this to identify duplicates.
 */
const contentHash = (...parts) => createHash("sha256").update(parts.join("|")).digest("hex");
/**
 * Convert SQLite datetime string ("YYYY-MM-DD HH:MM:SS") to ISO 8601 ("YYYY-MM-DDTHH:MM:SS").
 * Labels use raw SQL so timestamps come in SQLite format rather than Date objects.
 */
const sqliteToIso = (s) => {
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s))
        return s.replace(" ", "T") + ".000Z";
    return s;
};
const V1_TO_SYNC_TYPE = {
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
    decision_upsert: "decision.upsert",
    decision_delete: "decision.delete",
};
const entityIdFromV1Op = (op) => {
    const kind = typeof op.op === "string" ? op.op : "";
    switch (kind) {
        case "dep_add":
        case "dep_remove":
            return `${String(op.blockerId)}:${String(op.blockedId)}`;
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
            return String(op.contentHash ?? op.id ?? "");
        case "doc_link_upsert":
            return String(op.contentHash ?? op.id ?? "");
        case "task_doc_link_upsert":
            return String(op.contentHash ?? op.id ?? "");
        case "label_assignment_upsert":
            return String(op.contentHash ?? "");
        case "decision_upsert":
        case "decision_delete":
            return String(op.id ?? op.contentHash ?? "");
        default:
            return String(op.id ?? op.contentHash ?? "");
    }
};
const opToSyncEventType = (op) => {
    const v1Op = typeof op.op === "string" ? op.op : "";
    return V1_TO_SYNC_TYPE[v1Op] ?? null;
};
const getTsFromOp = (op) => typeof op.ts === "string" ? op.ts : new Date().toISOString();
const getEventIdFromOp = (op) => typeof op.eventId === "string" ? op.eventId : (typeof op.__event_id === "string" ? op.__event_id : "");
const compareOpOrder = (a, b) => {
    const t = getTsFromOp(a).localeCompare(getTsFromOp(b));
    if (t !== 0)
        return t;
    const eventCmp = getEventIdFromOp(a).localeCompare(getEventIdFromOp(b));
    if (eventCmp !== 0)
        return eventCmp;
    return 0;
};
const compareSyncOrder = (a, b) => {
    const t = a.ts.localeCompare(b.ts);
    if (t !== 0)
        return t;
    return (a.eventId ?? "").localeCompare(b.eventId ?? "");
};
const toSyncEvent = (op, streamId, seq) => {
    const type = opToSyncEventType(op);
    if (!type)
        return null;
    return {
        event_id: generateUlid(),
        stream_id: streamId,
        seq,
        ts: getTsFromOp(op),
        type,
        entity_id: entityIdFromV1Op(op),
        v: 2,
        payload: op,
    };
};
const syncEventToV1Op = (event) => {
    if (!event.payload || typeof event.payload !== "object")
        return null;
    const payload = event.payload;
    return typeof payload.op === "string" ? payload : null;
};
/**
 * Empty entity import result for early returns.
 */
const EMPTY_ENTITY_IMPORT_RESULT = { imported: 0, skipped: 0 };
/**
 * Empty import result for early returns.
 */
const EMPTY_IMPORT_RESULT = {
    imported: 0,
    skipped: 0,
    conflicts: 0,
    dependencies: { added: 0, removed: 0, skipped: 0, failures: [] }
};
const emptyV1Buckets = () => ({
    tasks: [],
    learnings: [],
    fileLearnings: [],
    attempts: [],
    pins: [],
    anchors: [],
    edges: [],
    docs: [],
    labels: [],
    decisions: [],
});
const bucketForOp = (opName) => {
    if (opName === "upsert" || opName === "delete" || opName === "dep_add" || opName === "dep_remove")
        return "tasks";
    if (opName === "learning_upsert" || opName === "learning_delete")
        return "learnings";
    if (opName === "file_learning_upsert" || opName === "file_learning_delete")
        return "fileLearnings";
    if (opName === "attempt_upsert")
        return "attempts";
    if (opName === "pin_upsert" || opName === "pin_delete")
        return "pins";
    if (opName === "anchor_upsert" || opName === "anchor_delete")
        return "anchors";
    if (opName === "edge_upsert" || opName === "edge_delete")
        return "edges";
    if (opName === "doc_upsert" || opName === "doc_delete" || opName === "doc_link_upsert" || opName === "task_doc_link_upsert" || opName === "invariant_upsert")
        return "docs";
    if (opName === "label_upsert" || opName === "label_assignment_upsert")
        return "labels";
    if (opName === "decision_upsert" || opName === "decision_delete")
        return "decisions";
    return null;
};
const stateCategoryForOp = (opName) => {
    if (opName === "upsert" || opName === "delete")
        return "task";
    if (opName === "dep_add" || opName === "dep_remove")
        return "dep";
    if (opName === "learning_upsert" || opName === "learning_delete")
        return "learning";
    if (opName === "file_learning_upsert" || opName === "file_learning_delete")
        return "file_learning";
    if (opName === "attempt_upsert")
        return "attempt";
    if (opName === "pin_upsert" || opName === "pin_delete")
        return "pin";
    if (opName === "anchor_upsert" || opName === "anchor_delete")
        return "anchor";
    if (opName === "edge_upsert" || opName === "edge_delete")
        return "edge";
    if (opName === "doc_upsert" || opName === "doc_delete")
        return "doc";
    if (opName === "doc_link_upsert")
        return "doc_link";
    if (opName === "task_doc_link_upsert")
        return "task_doc_link";
    if (opName === "invariant_upsert")
        return "invariant";
    if (opName === "label_upsert")
        return "label";
    if (opName === "label_assignment_upsert")
        return "label_assignment";
    if (opName === "decision_upsert")
        return "decision";
    if (opName === "decision_delete")
        return "decision";
    return null;
};
const stateCategoryForSyncType = (syncType) => {
    if (syncType === "task.upsert" || syncType === "task.delete")
        return "task";
    if (syncType === "dep.add" || syncType === "dep.remove")
        return "dep";
    if (syncType === "learning.upsert" || syncType === "learning.delete")
        return "learning";
    if (syncType === "file_learning.upsert" || syncType === "file_learning.delete")
        return "file_learning";
    if (syncType === "attempt.upsert")
        return "attempt";
    if (syncType === "pin.upsert" || syncType === "pin.delete")
        return "pin";
    if (syncType === "anchor.upsert" || syncType === "anchor.delete")
        return "anchor";
    if (syncType === "edge.upsert" || syncType === "edge.delete")
        return "edge";
    if (syncType === "doc.upsert" || syncType === "doc.delete")
        return "doc";
    if (syncType === "doc_link.upsert")
        return "doc_link";
    if (syncType === "task_doc_link.upsert")
        return "task_doc_link";
    if (syncType === "invariant.upsert")
        return "invariant";
    if (syncType === "label.upsert")
        return "label";
    if (syncType === "label_assignment.upsert")
        return "label_assignment";
    if (syncType === "decision.upsert" || syncType === "decision.delete")
        return "decision";
    return null;
};
const isRemovalSyncType = (syncType) => syncType === "task.delete" ||
    syncType === "dep.remove" ||
    syncType === "learning.delete" ||
    syncType === "file_learning.delete" ||
    syncType === "pin.delete" ||
    syncType === "anchor.delete" ||
    syncType === "edge.delete" ||
    syncType === "doc.delete" ||
    syncType === "decision.delete";
const stateKeyForSyncEvent = (syncType, entityId) => {
    if (typeof entityId !== "string" || entityId.length === 0)
        return null;
    const category = stateCategoryForSyncType(syncType);
    if (!category)
        return null;
    return `${category}:${entityId}`;
};
const stateKeyForOp = (op) => {
    const opName = typeof op.op === "string" ? op.op : "";
    const category = stateCategoryForOp(opName);
    if (!category)
        return null;
    return `${category}:${entityIdFromV1Op(op)}`;
};
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
function topologicalSortTasks(entries) {
    // Separate upserts from deletes - deletes don't have parent dependencies
    const upsertEntries = entries.filter(([, { op }]) => op.op === "upsert");
    const deleteEntries = entries.filter(([, { op }]) => op.op === "delete");
    // Build set of task IDs being imported
    const importingIds = new Set(upsertEntries.map(([id]) => id));
    // Build parent→children adjacency list
    const children = new Map();
    for (const [id] of upsertEntries) {
        children.set(id, []);
    }
    for (const [id, { op }] of upsertEntries) {
        const parentId = op.data?.parentId;
        if (parentId && importingIds.has(parentId)) {
            const parentChildren = children.get(parentId);
            if (parentChildren) {
                parentChildren.push(id);
            }
        }
    }
    // Calculate in-degree (number of parents in import set)
    const inDegree = new Map();
    for (const [id, { op }] of upsertEntries) {
        const parentId = op.data?.parentId;
        // Only count parent as dependency if it's in the import set
        const hasParentInSet = parentId && importingIds.has(parentId);
        inDegree.set(id, hasParentInSet ? 1 : 0);
    }
    // Queue starts with tasks that have no parent in import set (in-degree 0)
    const queue = [];
    for (const [id, degree] of inDegree) {
        if (degree === 0) {
            queue.push(id);
        }
    }
    // Build sorted result
    const sorted = [];
    const entryMap = new Map(upsertEntries);
    while (queue.length > 0) {
        const id = queue.shift();
        const entry = entryMap.get(id);
        if (entry) {
            sorted.push([id, entry]);
        }
        // Decrement in-degree of children and add to queue if now 0
        const childIds = children.get(id) ?? [];
        for (const childId of childIds) {
            const currentDegree = inDegree.get(childId) ?? 0;
            const newDegree = currentDegree - 1;
            inDegree.set(childId, newDegree);
            if (newDegree === 0) {
                queue.push(childId);
            }
        }
    }
    // If we didn't process all tasks, there's a cycle - fall back to original order
    // (This shouldn't happen with valid data since parent-child can't be circular)
    if (sorted.length < upsertEntries.length) {
        // Return original upsert entries followed by deletes
        return [...upsertEntries, ...deleteEntries];
    }
    // Return sorted upserts followed by deletes
    return [...sorted, ...deleteEntries];
}
/**
 * Convert a Task to a TaskUpsertOp for JSONL export.
 */
const taskToUpsertOp = (task) => ({
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
});
/**
 * Convert a TaskDependency to a DepAddOp for JSONL export.
 */
const depToAddOp = (dep) => ({
    v: 1,
    op: "dep_add",
    ts: dep.createdAt.toISOString(),
    blockerId: dep.blockerId,
    blockedId: dep.blockedId
});
/**
 * Convert a Learning to a LearningUpsertOp for JSONL export.
 */
const learningToUpsertOp = (learning) => ({
    v: 1,
    op: "learning_upsert",
    ts: learning.createdAt.toISOString(),
    id: learning.id,
    contentHash: contentHash(learning.content, learning.sourceType),
    data: {
        content: learning.content,
        sourceType: learning.sourceType,
        sourceRef: learning.sourceRef,
        keywords: [...learning.keywords],
        category: learning.category
    }
});
/**
 * Convert a FileLearning to a FileLearningUpsertOp for JSONL export.
 */
const fileLearningToUpsertOp = (fl) => ({
    v: 1,
    op: "file_learning_upsert",
    ts: fl.createdAt.toISOString(),
    id: fl.id,
    contentHash: contentHash(fl.filePattern, fl.note),
    data: {
        filePattern: fl.filePattern,
        note: fl.note,
        taskId: fl.taskId
    }
});
/**
 * Convert an Attempt to an AttemptUpsertOp for JSONL export.
 */
const attemptToUpsertOp = (attempt) => ({
    v: 1,
    op: "attempt_upsert",
    ts: attempt.createdAt.toISOString(),
    id: attempt.id,
    contentHash: contentHash(attempt.taskId, attempt.approach),
    data: {
        taskId: attempt.taskId,
        approach: attempt.approach,
        outcome: attempt.outcome,
        reason: attempt.reason
    }
});
/**
 * Convert a Pin to a PinUpsertOp for JSONL export.
 */
const pinToUpsertOp = (pin) => ({
    v: 1,
    op: "pin_upsert",
    ts: new Date(pin.updatedAt).toISOString(),
    id: pin.id,
    contentHash: contentHash(pin.id, pin.content),
    data: {
        content: pin.content
    }
});
/**
 * Convert an Anchor to an AnchorUpsertOp for JSONL export.
 * Uses the learning's content hash (looked up from learningHashMap) as stable reference.
 */
const anchorToUpsertOp = (anchor, learningHashMap) => {
    const learningContentHash = learningHashMap.get(anchor.learningId) ?? "";
    return {
        v: 1,
        op: "anchor_upsert",
        ts: anchor.createdAt.toISOString(),
        id: anchor.id,
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
    };
};
/**
 * Convert an Edge to an EdgeUpsertOp for JSONL export.
 */
const edgeToUpsertOp = (edge) => ({
    v: 1,
    op: "edge_upsert",
    ts: edge.createdAt.toISOString(),
    id: edge.id,
    contentHash: contentHash(edge.edgeType, edge.sourceType, edge.sourceId, edge.targetType, edge.targetId),
    data: {
        edgeType: edge.edgeType,
        sourceType: edge.sourceType,
        sourceId: edge.sourceId,
        targetType: edge.targetType,
        targetId: edge.targetId,
        weight: edge.weight,
        metadata: edge.metadata
    }
});
/**
 * Convert a Doc to a DocUpsertOp for JSONL export.
 */
const docToUpsertOp = (doc, parentDocKeyMap) => ({
    v: 1,
    op: "doc_upsert",
    ts: doc.createdAt.toISOString(),
    id: doc.id,
    contentHash: contentHash(doc.kind, doc.name, String(doc.version)),
    data: {
        kind: doc.kind,
        name: doc.name,
        title: doc.title,
        version: doc.version,
        status: doc.status,
        filePath: doc.filePath,
        hash: doc.hash,
        parentDocKey: doc.parentDocId ? (parentDocKeyMap.get(doc.parentDocId) ?? null) : null,
        lockedAt: doc.lockedAt?.toISOString() ?? null,
        metadata: doc.metadata
    }
});
/**
 * Convert a DocLink to a DocLinkUpsertOp for JSONL export.
 * Uses docKeyMap to resolve integer IDs to stable name:version keys.
 */
const docLinkToUpsertOp = (link, docKeyMap) => {
    const fromDocKey = docKeyMap.get(link.fromDocId);
    const toDocKey = docKeyMap.get(link.toDocId);
    if (!fromDocKey || !toDocKey)
        return null;
    return {
        v: 1,
        op: "doc_link_upsert",
        ts: link.createdAt.toISOString(),
        id: link.id,
        contentHash: contentHash(fromDocKey, toDocKey, link.linkType),
        data: {
            fromDocKey,
            toDocKey,
            linkType: link.linkType
        }
    };
};
/**
 * Convert a TaskDocLink to a TaskDocLinkUpsertOp for JSONL export.
 * Uses docKeyMap to resolve integer doc IDs to stable name:version keys.
 */
const taskDocLinkToUpsertOp = (link, docKeyMap) => {
    const docKey = docKeyMap.get(link.docId);
    if (!docKey)
        return null;
    return {
        v: 1,
        op: "task_doc_link_upsert",
        ts: link.createdAt.toISOString(),
        id: link.id,
        contentHash: contentHash(link.taskId, docKey),
        data: {
            taskId: link.taskId,
            docKey,
            linkType: link.linkType
        }
    };
};
/**
 * Convert an Invariant to an InvariantUpsertOp for JSONL export.
 * Uses docKeyMap to resolve integer doc IDs to stable name:version keys.
 */
const invariantToUpsertOp = (inv, docKeyMap) => {
    const docKey = docKeyMap.get(inv.docId);
    if (!docKey)
        return null;
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
            metadata: inv.metadata
        }
    };
};
/**
 * Convert a label row to a LabelUpsertOp for JSONL export.
 */
const labelRowToUpsertOp = (row) => ({
    v: 1,
    op: "label_upsert",
    ts: sqliteToIso(row.updated_at),
    id: row.id,
    contentHash: contentHash(row.name.toLowerCase()),
    data: {
        name: row.name,
        color: row.color
    }
});
/**
 * Convert a label assignment row to a LabelAssignmentUpsertOp for JSONL export.
 * Uses labelNameMap to resolve integer label IDs to stable names.
 */
const labelAssignmentToUpsertOp = (row, labelNameMap) => {
    const labelName = labelNameMap.get(row.label_id);
    if (!labelName)
        return null;
    return {
        v: 1,
        op: "label_assignment_upsert",
        ts: sqliteToIso(row.created_at),
        contentHash: contentHash(row.task_id, labelName.toLowerCase()),
        data: {
            taskId: row.task_id,
            labelName
        }
    };
};
const decisionToUpsertOp = (d, docKeyMap) => ({
    v: 1,
    op: "decision_upsert",
    ts: d.updatedAt.toISOString(),
    id: d.id,
    contentHash: d.contentHash,
    data: {
        content: d.content,
        question: d.question,
        status: d.status,
        source: d.source,
        commitSha: d.commitSha,
        runId: d.runId,
        taskId: d.taskId,
        docKey: d.docId != null ? (docKeyMap.get(d.docId) ?? null) : null,
        invariantId: d.invariantId,
        reviewedBy: d.reviewedBy,
        reviewNote: d.reviewNote,
        editedContent: d.editedContent,
        reviewedAt: d.reviewedAt?.toISOString() ?? null,
        supersededBy: d.supersededBy,
        syncedToDoc: d.syncedToDoc,
        createdAt: d.createdAt.toISOString(),
    }
});
/**
 * Check if a file exists without blocking the event loop.
 */
const fileExists = (filePath) => Effect.promise(() => access(filePath).then(() => true).catch(() => false));
const readUtf8FileWithLimit = (filePath, maxBytes = MAX_SYNC_JSONL_FILE_BYTES) => Effect.gen(function* () {
    const fileStats = yield* Effect.tryPromise({
        try: () => stat(filePath),
        catch: (cause) => new DatabaseError({ cause })
    });
    if (fileStats.size > maxBytes) {
        return yield* Effect.fail(new ValidationError({
            reason: `Sync import file exceeds ${maxBytes} bytes: ${filePath}`
        }));
    }
    const content = yield* Effect.tryPromise({
        try: () => readFile(filePath, "utf-8"),
        catch: (cause) => new DatabaseError({ cause })
    });
    if (Buffer.byteLength(content, "utf8") > maxBytes) {
        return yield* Effect.fail(new ValidationError({
            reason: `Sync import file exceeds ${maxBytes} bytes: ${filePath}`
        }));
    }
    return content;
});
/**
 * Write content to file atomically using temp file + rename.
 * Uses async fs operations to avoid blocking the event loop.
 */
const atomicWrite = (filePath, content) => Effect.tryPromise({
    try: async () => {
        const dir = dirname(filePath);
        await mkdir(dir, { recursive: true });
        const tempPath = `${filePath}.tmp.${Date.now()}.${process.pid}.${Math.random().toString(36).slice(2)}`;
        await writeFile(tempPath, content, "utf-8");
        await rename(tempPath, filePath);
    },
    catch: (cause) => new DatabaseError({ cause })
});
export const SyncServiceLive = Layer.effect(SyncService, Effect.gen(function* () {
    const taskService = yield* TaskService;
    const streamService = yield* StreamService;
    const depRepo = yield* DependencyRepository;
    const db = yield* SqliteClient;
    const learningRepo = yield* LearningRepository;
    const fileLearningRepo = yield* FileLearningRepository;
    const attemptRepo = yield* AttemptRepository;
    const pinRepo = yield* PinRepository;
    const anchorRepo = yield* AnchorRepository;
    const edgeRepo = yield* EdgeRepository;
    const docRepo = yield* DocRepository;
    // Helper: Get config value from sync_config table
    const getConfig = (key) => Effect.try({
        try: () => {
            const row = db.prepare("SELECT value FROM sync_config WHERE key = ?").get(key);
            return row?.value ?? null;
        },
        catch: (cause) => new DatabaseError({ cause })
    });
    // Helper: Set config value in sync_config table
    const setConfig = (key, value) => Effect.try({
        try: () => {
            db.prepare("INSERT OR REPLACE INTO sync_config (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, value);
        },
        catch: (cause) => new DatabaseError({ cause })
    });
    const setWatermark = (key, value) => Effect.try({
        try: () => {
            db.prepare("INSERT OR REPLACE INTO sync_watermark (key, value) VALUES (?, ?)").run(key, value);
        },
        catch: (cause) => new DatabaseError({ cause })
    });
    const touchStreamProgress = (streamId, lastSeq, lastEventAt) => {
        db.prepare(`INSERT INTO sync_streams (stream_id, created_at, last_seq, last_event_at)
         VALUES (?, datetime('now'), ?, ?)
         ON CONFLICT(stream_id) DO UPDATE SET
           last_seq = CASE
             WHEN excluded.last_seq > sync_streams.last_seq THEN excluded.last_seq
             ELSE sync_streams.last_seq
           END,
           last_event_at = CASE
             WHEN excluded.last_event_at IS NOT NULL THEN excluded.last_event_at
             ELSE sync_streams.last_event_at
           END`).run(streamId, lastSeq, lastEventAt ?? null);
    };
    const runWriteTransaction = db.transaction((body) => body());
    const withWriteTransaction = (body) => {
        if (db.inTransaction) {
            return runWriteTransaction(body);
        }
        return runWriteTransaction.immediate(body);
    };
    const readJsonlRecords = (filePath) => Effect.gen(function* () {
        const exists = yield* fileExists(filePath);
        if (!exists)
            return [];
        const content = yield* readUtf8FileWithLimit(filePath);
        const lines = content.trim().split("\n").filter(Boolean);
        const records = [];
        for (const line of lines) {
            const parsed = yield* Effect.try({
                try: () => JSON.parse(line),
                catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
            });
            if (!parsed || typeof parsed !== "object") {
                return yield* Effect.fail(new ValidationError({ reason: "JSONL line is not an object" }));
            }
            records.push(parsed);
        }
        return records;
    });
    const loadEventsFromStreams = (mode) => Effect.gen(function* () {
        const streamsRoot = resolve(DEFAULT_STREAMS_DIR);
        const rootExists = yield* fileExists(streamsRoot);
        if (!rootExists) {
            return { events: [], streamCount: 0, maxSeqByStream: new Map() };
        }
        const entries = yield* Effect.tryPromise({
            try: () => readdir(streamsRoot, { withFileTypes: true }),
            catch: (cause) => new DatabaseError({ cause })
        });
        const streamDirs = entries.filter(entry => entry.isDirectory());
        const events = [];
        const maxSeqByStream = new Map();
        for (const dir of streamDirs) {
            const streamId = dir.name;
            const knownLastSeq = mode === "incremental"
                ? (yield* Effect.try({
                    try: () => db.prepare("SELECT last_seq FROM sync_streams WHERE stream_id = ?").get(streamId)?.last_seq ?? 0,
                    catch: (cause) => new DatabaseError({ cause })
                }))
                : 0;
            const dirPath = resolve(streamsRoot, streamId);
            const files = yield* Effect.tryPromise({
                try: () => readdir(dirPath),
                catch: (cause) => new DatabaseError({ cause })
            });
            const eventFiles = files
                .filter(name => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
                .sort();
            for (const file of eventFiles) {
                const filePath = resolve(dirPath, file);
                const lines = (yield* readJsonlRecords(filePath));
                for (const line of lines) {
                    const event = yield* Effect.try({
                        try: () => Schema.decodeUnknownSync(SyncEventEnvelopeSchema)(line),
                        catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
                    });
                    if (event.stream_id !== streamId) {
                        return yield* Effect.fail(new ValidationError({
                            reason: `Event stream mismatch in ${basename(filePath)}: expected ${streamId}, got ${event.stream_id}`
                        }));
                    }
                    if (event.seq <= knownLastSeq)
                        continue;
                    if (events.length >= MAX_STREAM_IMPORT_EVENTS) {
                        return yield* Effect.fail(new ValidationError({
                            reason: `Stream import exceeds ${MAX_STREAM_IMPORT_EVENTS} events; split stream files or run incremental imports more frequently`
                        }));
                    }
                    events.push(event);
                    const currentMax = maxSeqByStream.get(streamId) ?? 0;
                    if (event.seq > currentMax)
                        maxSeqByStream.set(streamId, event.seq);
                }
            }
        }
        events.sort((a, b) => {
            const t = a.ts.localeCompare(b.ts);
            return t !== 0 ? t : a.event_id.localeCompare(b.event_id);
        });
        return {
            events,
            streamCount: streamDirs.length,
            maxSeqByStream
        };
    });
    const bucketEventsToV1Ops = (events) => {
        const buckets = emptyV1Buckets();
        for (const event of events) {
            const base = syncEventToV1Op(event);
            if (!base)
                continue;
            const op = { ...base, eventId: event.event_id };
            const name = typeof op.op === "string" ? op.op : "";
            const bucket = bucketForOp(name);
            if (!bucket)
                continue;
            buckets[bucket].push(op);
        }
        const sortByTs = (ops) => ops.sort(compareOpOrder);
        sortByTs(buckets.tasks);
        sortByTs(buckets.learnings);
        sortByTs(buckets.fileLearnings);
        sortByTs(buckets.attempts);
        sortByTs(buckets.pins);
        sortByTs(buckets.anchors);
        sortByTs(buckets.edges);
        sortByTs(buckets.docs);
        sortByTs(buckets.labels);
        sortByTs(buckets.decisions);
        return buckets;
    };
    const writeBucketsToTempFiles = (buckets) => Effect.gen(function* () {
        const dir = resolve(".tx", ".sync-temp", `${Date.now()}-${Math.random().toString(36).slice(2)}`);
        yield* Effect.tryPromise({
            try: () => mkdir(dir, { recursive: true }),
            catch: (cause) => new DatabaseError({ cause })
        });
        const writeBucket = (name, ops) => Effect.gen(function* () {
            const filePath = resolve(dir, name);
            if (ops.length === 0) {
                yield* atomicWrite(filePath, "");
            }
            else {
                const jsonl = ops.map(op => JSON.stringify(op)).join("\n");
                yield* atomicWrite(filePath, `${jsonl}\n`);
            }
            return filePath;
        });
        const tasksPath = yield* writeBucket("tasks.jsonl", buckets.tasks);
        const learningsPath = yield* writeBucket("learnings.jsonl", buckets.learnings);
        const fileLearningsPath = yield* writeBucket("file-learnings.jsonl", buckets.fileLearnings);
        const attemptsPath = yield* writeBucket("attempts.jsonl", buckets.attempts);
        const pinsPath = yield* writeBucket("pins.jsonl", buckets.pins);
        const anchorsPath = yield* writeBucket("anchors.jsonl", buckets.anchors);
        const edgesPath = yield* writeBucket("edges.jsonl", buckets.edges);
        const docsPath = yield* writeBucket("docs.jsonl", buckets.docs);
        const labelsPath = yield* writeBucket("labels.jsonl", buckets.labels);
        const decisionsPath = yield* writeBucket("decisions.jsonl", buckets.decisions);
        return {
            dir,
            tasksPath,
            learningsPath,
            fileLearningsPath,
            attemptsPath,
            pinsPath,
            anchorsPath,
            edgesPath,
            docsPath,
            labelsPath,
            decisionsPath,
        };
    });
    const clearMaterializedTables = () => Effect.try({
        try: () => {
            withWriteTransaction(() => {
                db.prepare("DELETE FROM decisions").run();
                db.prepare("DELETE FROM task_label_assignments").run();
                db.prepare("DELETE FROM task_labels").run();
                db.prepare("DELETE FROM invariant_checks").run();
                db.prepare("DELETE FROM invariants").run();
                db.prepare("DELETE FROM task_doc_links").run();
                db.prepare("DELETE FROM doc_links").run();
                db.prepare("DELETE FROM docs").run();
                db.prepare("DELETE FROM learning_edges").run();
                db.prepare("DELETE FROM learning_anchors").run();
                db.prepare("DELETE FROM context_pins").run();
                db.prepare("DELETE FROM attempts").run();
                db.prepare("DELETE FROM file_learnings").run();
                db.prepare("DELETE FROM learnings").run();
                db.prepare("DELETE FROM task_dependencies").run();
                db.prepare("DELETE FROM tasks").run();
            });
        },
        catch: (cause) => new DatabaseError({ cause })
    });
    const cleanupTempDir = (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true }).then(() => undefined).catch(() => undefined));
    const collectCurrentOpsForSync = () => Effect.gen(function* () {
        const tasks = yield* taskService.list();
        const deps = yield* depRepo.getAll(100_000);
        const taskOps = tasks.map(taskToUpsertOp);
        const depOps = deps.map(depToAddOp);
        const learnings = yield* learningRepo.findAll(FULL_EXPORT_LIMIT);
        const learningOps = learnings.map(learningToUpsertOp);
        const learningHashMap = new Map();
        for (const l of learnings) {
            learningHashMap.set(l.id, contentHash(l.content, l.sourceType));
        }
        const fileLearnings = yield* fileLearningRepo.findAll(FULL_EXPORT_LIMIT);
        const fileLearningOps = fileLearnings.map(fileLearningToUpsertOp);
        const attempts = yield* attemptRepo.findAll();
        const attemptOps = attempts.map(attemptToUpsertOp);
        const pins = yield* pinRepo.findAll();
        const pinOps = [...pins].map(pinToUpsertOp);
        const anchors = yield* anchorRepo.findAll(FULL_EXPORT_LIMIT);
        const anchorOps = anchors.map(anchor => anchorToUpsertOp(anchor, learningHashMap));
        const edges = yield* edgeRepo.findAll(FULL_EXPORT_LIMIT);
        const edgeOps = edges
            .filter(edge => edge.invalidatedAt === null)
            .map(edgeToUpsertOp);
        const docs = yield* docRepo.findAll();
        const docKeyMap = new Map();
        for (const d of docs) {
            docKeyMap.set(d.id, `${d.name}:${d.version}`);
        }
        const docOps = docs.map(d => docToUpsertOp(d, docKeyMap));
        const docLinks = yield* docRepo.getAllLinks();
        const docLinkOps = docLinks
            .map(link => docLinkToUpsertOp(link, docKeyMap))
            .filter((op) => op !== null);
        const taskDocLinkRows = yield* Effect.try({
            try: () => db.prepare("SELECT * FROM task_doc_links").all(),
            catch: (cause) => new DatabaseError({ cause })
        });
        const taskDocLinkOps = taskDocLinkRows
            .map(row => taskDocLinkToUpsertOp({ id: row.id, taskId: row.task_id, docId: row.doc_id, linkType: row.link_type, createdAt: new Date(row.created_at) }, docKeyMap))
            .filter((op) => op !== null);
        const invariants = yield* docRepo.findInvariants();
        const invariantOps = invariants
            .map(inv => invariantToUpsertOp(inv, docKeyMap))
            .filter((op) => op !== null);
        const labelRows = yield* Effect.try({
            try: () => db.prepare("SELECT * FROM task_labels").all(),
            catch: (cause) => new DatabaseError({ cause })
        });
        const labelNameMap = new Map();
        for (const l of labelRows) {
            labelNameMap.set(l.id, l.name);
        }
        const labelOps = labelRows.map(labelRowToUpsertOp);
        const assignmentRows = yield* Effect.try({
            try: () => db.prepare("SELECT * FROM task_label_assignments").all(),
            catch: (cause) => new DatabaseError({ cause })
        });
        const labelAssignmentOps = assignmentRows
            .map(a => labelAssignmentToUpsertOp(a, labelNameMap))
            .filter((op) => op !== null);
        const decisionRows = yield* Effect.try({
            try: () => db.prepare("SELECT * FROM decisions").all(),
            catch: (cause) => new DatabaseError({ cause })
        });
        const decisionOps = decisionRows.map(row => decisionToUpsertOp({
            id: row.id,
            content: row.content,
            question: row.question,
            status: row.status,
            source: row.source,
            commitSha: row.commit_sha,
            runId: row.run_id,
            taskId: row.task_id,
            docId: row.doc_id,
            invariantId: row.invariant_id,
            reviewedBy: row.reviewed_by,
            reviewNote: row.review_note,
            editedContent: row.edited_content,
            reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
            contentHash: row.content_hash,
            supersededBy: row.superseded_by,
            syncedToDoc: !!row.synced_to_doc,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        }, docKeyMap));
        const all = [
            ...taskOps,
            ...depOps,
            ...learningOps,
            ...fileLearningOps,
            ...attemptOps,
            ...pinOps,
            ...anchorOps,
            ...edgeOps,
            ...docOps,
            ...docLinkOps,
            ...taskDocLinkOps,
            ...invariantOps,
            ...labelOps,
            ...labelAssignmentOps,
            ...decisionOps,
        ];
        all.sort(compareOpOrder);
        return all;
    });
    const collectLegacyTaskOpsForSync = () => Effect.gen(function* () {
        const tasks = yield* taskService.list();
        const deps = yield* depRepo.getAll(100_000);
        const taskOps = tasks.map(taskToUpsertOp);
        const depOps = deps.map(depToAddOp);
        const all = [...taskOps, ...depOps];
        all.sort(compareOpOrder);
        return all;
    });
    const syncPinsToTargetFiles = () => Effect.gen(function* () {
        const allPins = yield* pinRepo.findAll();
        const targetFiles = yield* pinRepo.getTargetFiles();
        const pinMap = new Map();
        for (const pin of allPins) {
            pinMap.set(pin.id, pin.content);
        }
        yield* Effect.try({
            try: () => {
                for (const targetFile of targetFiles) {
                    const projectRoot = process.cwd();
                    const resolvedPath = resolvePathWithin(projectRoot, targetFile, {
                        useRealpath: true
                    });
                    if (!resolvedPath)
                        continue;
                    let fileContent = "";
                    try {
                        fileContent = readFileSync(resolvedPath, "utf-8");
                    }
                    catch { /* file doesn't exist yet */ }
                    const updated = syncBlocks(fileContent, pinMap);
                    if (updated !== fileContent) {
                        const dir = dirname(resolvedPath);
                        mkdirSync(dir, { recursive: true });
                        const tempPath = `${resolvedPath}.tmp.${Date.now()}.${process.pid}`;
                        writeFileSync(tempPath, updated, "utf-8");
                        try {
                            renameSync(tempPath, resolvedPath);
                        }
                        finally {
                            try {
                                unlinkSync(tempPath);
                            }
                            catch { /* ignore cleanup error */ }
                        }
                    }
                }
            },
            catch: (cause) => new DatabaseError({ cause })
        });
    });
    const syncService = applyEntityImportContract(applyEntityExportContract({
        importTaskOps: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_JSONL_PATH);
            // Check if file exists (outside transaction - no DB access)
            const importFileExists = yield* fileExists(filePath);
            if (!importFileExists) {
                return EMPTY_IMPORT_RESULT;
            }
            // Read and parse JSONL file (outside transaction - no DB access)
    const content = yield* readUtf8FileWithLimit(filePath);
            const lines = content.trim().split("\n").filter(Boolean);
            if (lines.length === 0) {
                return EMPTY_IMPORT_RESULT;
            }
            // Compute hash of file content for concurrent modification detection (TOCTOU protection)
            const fileHash = createHash("sha256").update(content).digest("hex");
            // Parse all operations with Schema validation (outside transaction - no DB access)
            const ops = [];
            for (const line of lines) {
                const parsed = yield* Effect.try({
                    try: () => JSON.parse(line),
                    catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
                });
                const op = yield* Effect.try({
                    try: () => Schema.decodeUnknownSync(TaskSyncOperationSchema)(parsed),
                    catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
                });
                ops.push(op);
            }
            // Group by entity and find latest state per entity (timestamp wins)
            const taskStates = new Map();
            const depStates = new Map();
            for (const op of ops) {
                if (op.op === "upsert" || op.op === "delete") {
                    const existing = taskStates.get(op.id);
                    if (!existing || compareSyncOrder(op, existing) > 0) {
                        taskStates.set(op.id, { op: op, ts: op.ts, eventId: op.eventId });
                    }
                }
                else if (op.op === "dep_add" || op.op === "dep_remove") {
                    const key = `${op.blockerId}:${op.blockedId}`;
                    const existing = depStates.get(key);
                    if (!existing || compareSyncOrder(op, existing) > 0) {
                        depStates.set(key, { op: op, ts: op.ts, eventId: op.eventId });
                    }
                }
            }
            // Apply task operations in topological order (parents before children)
            // This ensures foreign key constraints are satisfied when importing
            // tasks where child timestamp < parent timestamp
            const sortedTaskEntries = topologicalSortTasks([...taskStates.entries()]);
            // Prepare statements outside transaction to minimize write lock duration.
            // better-sqlite3 prepared statements are reusable across transactions.
            const findTaskStmt = db.prepare("SELECT * FROM tasks WHERE id = ?");
            const insertTaskStmt = db.prepare(`INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at,
                                assignee_type, assignee_id, assigned_at, assigned_by, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            const updateTaskStmt = db.prepare(`UPDATE tasks SET title = ?, description = ?, status = ?, parent_id = ?,
             score = ?, updated_at = ?, completed_at = ?,
             assignee_type = ?, assignee_id = ?, assigned_at = ?, assigned_by = ?,
             metadata = ? WHERE id = ?`);
            const deleteTaskStmt = db.prepare("DELETE FROM tasks WHERE id = ?");
            const insertDepStmt = db.prepare("INSERT INTO task_dependencies (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)");
            const checkDepExistsStmt = db.prepare("SELECT 1 FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?");
            // Cycle detection: check if adding blocker_id→blocked_id would create a cycle
            // by walking DOWNSTREAM from blocked_id to see if it can reach blocker_id
            const checkCycleStmt = db.prepare(`WITH RECURSIVE reachable(id) AS (
              SELECT blocked_id FROM task_dependencies WHERE blocker_id = ?
              UNION
              SELECT d.blocked_id FROM task_dependencies d JOIN reachable r ON d.blocker_id = r.id
            )
            SELECT 1 AS found FROM reachable WHERE id = ? LIMIT 1`);
            const deleteDepStmt = db.prepare("DELETE FROM task_dependencies WHERE blocker_id = ? AND blocked_id = ?");
            const setConfigStmt = db.prepare("INSERT OR REPLACE INTO sync_config (key, value, updated_at) VALUES (?, ?, datetime('now'))");
            const checkParentExistsStmt = db.prepare("SELECT 1 FROM tasks WHERE id = ?");
            // ALL database operations inside a single transaction for atomicity
            // If any operation fails, the entire import is rolled back
            return yield* Effect.try({
                try: () => withWriteTransaction(() => {
                    let imported = 0;
                    let skipped = 0;
                    let conflicts = 0;
                    // Dependency tracking
                    let depsAdded = 0;
                    let depsRemoved = 0;
                    let depsSkipped = 0;
                    const depFailures = [];
                    // Apply task operations
                    for (const [id, { op }] of sortedTaskEntries) {
                        if (op.op === "upsert") {
                            const existingRow = findTaskStmt.get(id);
                            // Validate parentId: if it references a task that doesn't exist
                            // in the DB, set to null to avoid FK constraint violation.
                            // Topological sort ensures parents in the import set are already
                            // inserted by this point, so a missing parent is truly orphaned.
                            const parentId = op.data.parentId;
                            const effectiveParentId = parentId && checkParentExistsStmt.get(parentId)
                                ? parentId
                                : null;
                            const assigneeType = op.data.assigneeType ?? null;
                            const assigneeId = assigneeType === null ? null : (op.data.assigneeId ?? null);
                            const assignedAt = assigneeType === null ? null : (op.data.assignedAt ?? null);
                            const assignedBy = assigneeType === null ? null : (op.data.assignedBy ?? null);
                            if (!existingRow) {
                                // Create new task with the specified ID
                                insertTaskStmt.run(id, op.data.title, op.data.description, op.data.status, effectiveParentId, op.data.score, op.data.createdAt ?? op.ts, op.ts, op.data.completedAt ?? null, assigneeType, assigneeId, assignedAt, assignedBy, JSON.stringify(op.data.metadata));
                                imported++;
                            }
                            else {
                                // Update if JSONL timestamp is newer than existing
                                const existingTs = existingRow.updated_at;
                                if (op.ts > existingTs) {
                                    updateTaskStmt.run(op.data.title, op.data.description, op.data.status, effectiveParentId, op.data.score, op.ts, op.data.completedAt !== undefined ? op.data.completedAt : (existingRow.completed_at ?? null), assigneeType, assigneeId, assignedAt, assignedBy, JSON.stringify(op.data.metadata), id);
                                    imported++;
                                }
                                else if (op.ts === existingTs) {
                                    // Same timestamp - skip
                                    skipped++;
                                }
                                else {
                                    // Local is newer - conflict
                                    conflicts++;
                                }
                            }
                        }
                        else if (op.op === "delete") {
                            const existingRow = findTaskStmt.get(id);
                            if (existingRow) {
                                // Check timestamp - only delete if delete operation is newer
                                // Per DD-009 Scenario 2: delete wins if its timestamp > local update timestamp
                                const existingTs = existingRow.updated_at;
                                if (op.ts > existingTs) {
                                    deleteTaskStmt.run(id);
                                    imported++;
                                }
                                else if (op.ts === existingTs) {
                                    // Same timestamp - skip (ambiguous state, but safe to keep local)
                                    skipped++;
                                }
                                else {
                                    // Local is newer - conflict (local update wins over older delete)
                                    conflicts++;
                                }
                            }
                        }
                    }
                    // Apply dependency operations with individual error tracking
                    for (const { op } of depStates.values()) {
                        if (op.op === "dep_add") {
                            // Check if dependency already exists
                            const exists = checkDepExistsStmt.get(op.blockerId, op.blockedId);
                            if (exists) {
                                depsSkipped++;
                                continue;
                            }
                            // Check for cycles before inserting (RULE 4: no circular deps)
                            const wouldCycle = checkCycleStmt.get(op.blockedId, op.blockerId);
                            if (wouldCycle) {
                                depFailures.push({
                                    blockerId: op.blockerId,
                                    blockedId: op.blockedId,
                                    error: "would create circular dependency"
                                });
                                continue;
                            }
                            // Try to add dependency, track failures individually
                            try {
                                insertDepStmt.run(op.blockerId, op.blockedId, op.ts);
                                depsAdded++;
                            }
                            catch (e) {
                                // Dependency insert failed (e.g., foreign key constraint)
                                depFailures.push({
                                    blockerId: op.blockerId,
                                    blockedId: op.blockedId,
                                    error: e instanceof Error ? e.message : String(e)
                                });
                            }
                        }
                        else if (op.op === "dep_remove") {
                            // Remove dependency - track if it actually existed
                            const result = deleteDepStmt.run(op.blockerId, op.blockedId);
                            if (result.changes > 0) {
                                depsRemoved++;
                            }
                            else {
                                depsSkipped++;
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
                            .join("; ");
                        throw new ValidationError({ reason: `Sync import rolled back: ${depFailures.length} dependency failure(s): ${details}` });
                    }
                    // Verify file hasn't been modified during import (TOCTOU protection).
                    // Re-read synchronously while holding the DB write lock.
                    const verifyContent = readFileSync(filePath, "utf-8");
                    const verifyHash = createHash("sha256").update(verifyContent).digest("hex");
                    if (verifyHash !== fileHash) {
                        throw new ValidationError({ reason: "Sync import rolled back: JSONL file was modified during import (concurrent export detected). Retry the import." });
                    }
                    // Record import time
                    setConfigStmt.run("last_import", new Date().toISOString());
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
                    };
                }),
                catch: (cause) => cause instanceof ValidationError ? cause : new DatabaseError({ cause })
            });
        }),
        status: () => Effect.gen(function* () {
            const dbTaskCount = yield* taskService.count();
            const eventOpCount = yield* Effect.try({
                try: () => {
                    const row = db.prepare("SELECT COUNT(*) as cnt FROM sync_events").get();
                    return row.cnt;
                },
                catch: (cause) => new DatabaseError({ cause })
            });
            // Get last export/import timestamps from config
            const lastExportConfig = yield* getConfig("last_export");
            const lastImportConfig = yield* getConfig("last_import");
            const lastExportDate = lastExportConfig && lastExportConfig !== "" ? new Date(lastExportConfig) : null;
            const lastImportDate = lastImportConfig && lastImportConfig !== "" ? new Date(lastImportConfig) : null;
            // Get auto-sync status
            const autoSyncConfig = yield* getConfig("auto_sync");
            const autoSyncEnabled = autoSyncConfig === "true";
            // Dirty detection includes timestamp drift and state-shape drift.
            // Uses sync_events table (not filesystem scans) for exported state.
            const currentOps = yield* collectCurrentOpsForSync();
            const currentStateKeys = new Set();
            for (const op of currentOps) {
                const key = stateKeyForOp(op);
                if (key)
                    currentStateKeys.add(key);
            }
            const latestExportedState = new Map();
            const exportedRows = yield* Effect.try({
                try: () => db.prepare("SELECT event_id, ts, type, entity_id FROM sync_events").all(),
                catch: (cause) => new DatabaseError({ cause })
            });
            for (const row of exportedRows) {
                const syncType = typeof row.type === "string" ? row.type : "";
                const key = stateKeyForSyncEvent(syncType, row.entity_id);
                if (!key)
                    continue;
                const next = { syncType, ts: row.ts, eventId: row.event_id };
                const existing = latestExportedState.get(key);
                if (!existing || compareSyncOrder(next, existing) > 0) {
                    latestExportedState.set(key, next);
                }
            }
            const exportedStateKeys = new Set();
            for (const [key, state] of latestExportedState.entries()) {
                if (!isRemovalSyncType(state.syncType)) {
                    exportedStateKeys.add(key);
                }
            }
            const stateMismatch = currentStateKeys.size !== exportedStateKeys.size ||
                [...currentStateKeys].some((key) => !exportedStateKeys.has(key)) ||
                [...exportedStateKeys].some((key) => !currentStateKeys.has(key));
            const hasLocalState = currentStateKeys.size > 0;
            const lastOpTs = currentOps.reduce((max, op) => {
                const ts = typeof op.ts === "string" ? op.ts : null;
                if (!ts)
                    return max;
                if (max === null)
                    return ts;
                return ts > max ? ts : max;
            }, null);
            const hasStateWithoutExport = lastExportDate === null && (hasLocalState || exportedStateKeys.size > 0);
            const hasNewerProjectedState = lastExportDate !== null && lastOpTs !== null && lastOpTs > lastExportDate.toISOString();
            const isDirty = hasStateWithoutExport || hasNewerProjectedState || stateMismatch;
            return {
                dbTaskCount,
                eventOpCount,
                lastExport: lastExportDate,
                lastImport: lastImportDate,
                isDirty,
                autoSyncEnabled
            };
        }),
        enableAutoSync: () => setConfig("auto_sync", "true"),
        disableAutoSync: () => setConfig("auto_sync", "false"),
        isAutoSyncEnabled: () => Effect.gen(function* () {
            const value = yield* getConfig("auto_sync");
            return value === "true";
        }),
        exportLearnings: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_LEARNINGS_JSONL_PATH);
            const learnings = yield* learningRepo.findAll();
            const ops = learnings.map(learningToUpsertOp);
            ops.sort((a, b) => a.ts.localeCompare(b.ts));
            const jsonl = ops.map(op => JSON.stringify(op)).join("\n");
            yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""));
            return { opCount: ops.length, path: filePath };
        }),
        importLearnings: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_LEARNINGS_JSONL_PATH);
            const existing = yield* learningRepo.findAll();
            const existingHashes = new Set(existing.map(l => contentHash(l.content, l.sourceType)));
            const insertStmt = db.prepare("INSERT INTO learnings (content, source_type, source_ref, created_at, keywords, category) VALUES (?, ?, ?, ?, ?, ?)");
            return yield* importEntityJsonl(filePath, LearningUpsertOpSchema, existingHashes, (ops) => {
                return withWriteTransaction(() => {
                    let count = 0;
                    for (const op of ops) {
                        insertStmt.run(op.data.content, op.data.sourceType, op.data.sourceRef, op.ts, JSON.stringify(op.data.keywords), op.data.category);
                        count++;
                    }
                    return count;
                });
            });
        }),
        exportFileLearnings: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_FILE_LEARNINGS_JSONL_PATH);
            const fileLearnings = yield* fileLearningRepo.findAll();
            const ops = fileLearnings.map(fileLearningToUpsertOp);
            ops.sort((a, b) => a.ts.localeCompare(b.ts));
            const jsonl = ops.map(op => JSON.stringify(op)).join("\n");
            yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""));
            return { opCount: ops.length, path: filePath };
        }),
        importFileLearnings: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_FILE_LEARNINGS_JSONL_PATH);
            const existing = yield* fileLearningRepo.findAll();
            const existingHashes = new Set(existing.map(fl => contentHash(fl.filePattern, fl.note)));
            const insertStmt = db.prepare("INSERT INTO file_learnings (file_pattern, note, task_id, created_at) VALUES (?, ?, ?, ?)");
            return yield* importEntityJsonl(filePath, FileLearningUpsertOpSchema, existingHashes, (ops) => {
                return withWriteTransaction(() => {
                    let count = 0;
                    for (const op of ops) {
                        insertStmt.run(op.data.filePattern, op.data.note, op.data.taskId, op.ts);
                        count++;
                    }
                    return count;
                });
            });
        }),
        exportAttempts: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_ATTEMPTS_JSONL_PATH);
            const attempts = yield* attemptRepo.findAll();
            const ops = attempts.map(attemptToUpsertOp);
            ops.sort((a, b) => a.ts.localeCompare(b.ts));
            const jsonl = ops.map(op => JSON.stringify(op)).join("\n");
            yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""));
            return { opCount: ops.length, path: filePath };
        }),
        importAttempts: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_ATTEMPTS_JSONL_PATH);
            const existing = yield* attemptRepo.findAll();
            const existingHashes = new Set(existing.map(a => contentHash(a.taskId, a.approach)));
            const insertStmt = db.prepare("INSERT INTO attempts (task_id, approach, outcome, reason, created_at) VALUES (?, ?, ?, ?, ?)");
            return yield* importEntityJsonl(filePath, AttemptUpsertOpSchema, existingHashes, (ops) => {
                return withWriteTransaction(() => {
                    let count = 0;
                    for (const op of ops) {
                        insertStmt.run(op.data.taskId, op.data.approach, op.data.outcome, op.data.reason, op.ts);
                        count++;
                    }
                    return count;
                });
            });
        }),
        exportPins: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_PINS_JSONL_PATH);
            const pins = yield* pinRepo.findAll();
            const ops = [...pins].map(pinToUpsertOp);
            ops.sort((a, b) => a.ts.localeCompare(b.ts));
            const jsonl = ops.map(op => JSON.stringify(op)).join("\n");
            yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""));
            return { opCount: ops.length, path: filePath };
        }),
        importPins: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_PINS_JSONL_PATH);
            const existing = yield* pinRepo.findAll();
            const existingHashes = new Set([...existing].map(p => contentHash(p.id, p.content)));
            const upsertStmt = db.prepare(`INSERT INTO context_pins (id, content, created_at, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               content = excluded.content,
               updated_at = excluded.updated_at`);
            const result = yield* importEntityJsonl(filePath, PinUpsertOpSchema, existingHashes, (ops) => {
                return withWriteTransaction(() => {
                    let count = 0;
                    for (const op of ops) {
                        upsertStmt.run(op.id, op.data.content, op.ts, op.ts);
                        count++;
                    }
                    return count;
                });
            });
            // Avoid blocking DB transactions with filesystem writes.
            if (result.imported > 0 && !db.inTransaction) {
                yield* syncPinsToTargetFiles();
            }
            return result;
        }),
        exportAnchors: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_ANCHORS_JSONL_PATH);
            const anchors = yield* anchorRepo.findAll();
            // Build learning ID → content hash map for stable references
            const learnings = yield* learningRepo.findAll();
            const learningHashMap = new Map();
            for (const l of learnings) {
                learningHashMap.set(l.id, contentHash(l.content, l.sourceType));
            }
            const ops = anchors.map(a => anchorToUpsertOp(a, learningHashMap));
            ops.sort((a, b) => a.ts.localeCompare(b.ts));
            const jsonl = ops.map(op => JSON.stringify(op)).join("\n");
            yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""));
            return { opCount: ops.length, path: filePath };
        }),
        importAnchors: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_ANCHORS_JSONL_PATH);
            // Build existing anchor content hashes
            const existingAnchors = yield* anchorRepo.findAll();
            const existingLearnings = yield* learningRepo.findAll();
            const learningHashMap = new Map();
            for (const l of existingLearnings) {
                learningHashMap.set(l.id, contentHash(l.content, l.sourceType));
            }
            const existingHashes = new Set(existingAnchors.map(a => {
                const lHash = learningHashMap.get(a.learningId) ?? "";
                return contentHash(lHash, a.filePath, a.anchorType, a.anchorValue);
            }));
            // Build reverse map: learning content hash → learning ID (for resolving references)
            const hashToLearningId = new Map();
            for (const l of existingLearnings) {
                hashToLearningId.set(contentHash(l.content, l.sourceType), l.id);
            }
            const insertStmt = db.prepare(`INSERT INTO learning_anchors
              (learning_id, anchor_type, anchor_value, file_path, symbol_fqname,
               line_start, line_end, content_hash, content_preview, status, pinned, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            let orphanedCount = 0;
            const result = yield* importEntityJsonl(filePath, AnchorUpsertOpSchema, existingHashes, (ops) => {
                return withWriteTransaction(() => {
                    let count = 0;
                    for (const op of ops) {
                        const learningId = hashToLearningId.get(op.data.learningContentHash);
                        if (learningId === undefined) {
                            orphanedCount++;
                            continue;
                        }
                        insertStmt.run(learningId, op.data.anchorType, op.data.anchorValue, op.data.filePath, op.data.symbolFqname, op.data.lineStart, op.data.lineEnd, op.data.contentHash, op.data.contentPreview, op.data.status, op.data.pinned ? 1 : 0, op.ts);
                        count++;
                    }
                    return count;
                });
            });
            return { imported: result.imported, skipped: result.skipped + orphanedCount };
        }),
        exportEdges: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_EDGES_JSONL_PATH);
            const edges = yield* edgeRepo.findAll();
            // Only export active (non-invalidated) edges
            const activeEdges = edges.filter(e => e.invalidatedAt === null);
            const ops = activeEdges.map(edgeToUpsertOp);
            ops.sort((a, b) => a.ts.localeCompare(b.ts));
            const jsonl = ops.map(op => JSON.stringify(op)).join("\n");
            yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""));
            return { opCount: ops.length, path: filePath };
        }),
        importEdges: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_EDGES_JSONL_PATH);
            const existingEdges = yield* edgeRepo.findAll();
            const existingHashes = new Set(existingEdges.map(e => contentHash(e.edgeType, e.sourceType, e.sourceId, e.targetType, e.targetId)));
            const insertStmt = db.prepare(`INSERT INTO learning_edges
              (edge_type, source_type, source_id, target_type, target_id, weight, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
            return yield* importEntityJsonl(filePath, EdgeUpsertOpSchema, existingHashes, (ops) => {
                return withWriteTransaction(() => {
                    let count = 0;
                    for (const op of ops) {
                        insertStmt.run(op.data.edgeType, op.data.sourceType, op.data.sourceId, op.data.targetType, op.data.targetId, op.data.weight, JSON.stringify(op.data.metadata), op.ts);
                        count++;
                    }
                    return count;
                });
            });
        }),
        exportDocs: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_DOCS_JSONL_PATH);
            const docs = yield* docRepo.findAll();
            // Build doc ID → "name:version" key map for stable cross-machine references
            const docKeyMap = new Map();
            for (const d of docs) {
                docKeyMap.set(d.id, `${d.name}:${d.version}`);
            }
            const docOps = docs.map(d => docToUpsertOp(d, docKeyMap));
            // Get doc links
            const docLinks = yield* docRepo.getAllLinks();
            const docLinkOps = docLinks
                .map(l => docLinkToUpsertOp(l, docKeyMap))
                .filter((op) => op !== null);
            // Get task-doc links via raw SQL (no getAllTaskLinks method)
            const taskDocLinkRows = yield* Effect.try({
                try: () => db.prepare("SELECT * FROM task_doc_links").all(),
                catch: (cause) => new DatabaseError({ cause })
            });
            const taskDocLinkOps = taskDocLinkRows
                .map(row => taskDocLinkToUpsertOp({ id: row.id, taskId: row.task_id, docId: row.doc_id, linkType: row.link_type, createdAt: new Date(row.created_at) }, docKeyMap))
                .filter((op) => op !== null);
            // Get invariants
            const invariants = yield* docRepo.findInvariants();
            const invariantOps = invariants
                .map(inv => invariantToUpsertOp(inv, docKeyMap))
                .filter((op) => op !== null);
            // Combine all ops, sort by timestamp
            const allOps = [...docOps, ...docLinkOps, ...taskDocLinkOps, ...invariantOps];
            allOps.sort((a, b) => a.ts.localeCompare(b.ts));
            const jsonl = allOps.map(op => JSON.stringify(op)).join("\n");
            yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""));
            return { opCount: allOps.length, path: filePath };
        }),
        importDocs: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_DOCS_JSONL_PATH);
            const importDocsFileExists = yield* fileExists(filePath);
            if (!importDocsFileExists)
                return EMPTY_ENTITY_IMPORT_RESULT;
            const content = yield* readUtf8FileWithLimit(filePath);
            const lines = content.trim().split("\n").filter(Boolean);
            if (lines.length === 0)
                return EMPTY_ENTITY_IMPORT_RESULT;
            // Parse all ops, group by type
            const docOps = [];
            const docLinkOps = [];
            const taskDocLinkOps = [];
            const invariantOps = [];
            for (const line of lines) {
                const parsed = yield* Effect.try({
                    try: () => JSON.parse(line),
                    catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
                });
                const opType = parsed.op;
                if (opType === "doc_upsert") {
                    docOps.push(yield* Effect.try({
                        try: () => Schema.decodeUnknownSync(DocUpsertOpSchema)(parsed),
                        catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
                    }));
                }
                else if (opType === "doc_link_upsert") {
                    docLinkOps.push(yield* Effect.try({
                        try: () => Schema.decodeUnknownSync(DocLinkUpsertOpSchema)(parsed),
                        catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
                    }));
                }
                else if (opType === "task_doc_link_upsert") {
                    taskDocLinkOps.push(yield* Effect.try({
                        try: () => Schema.decodeUnknownSync(TaskDocLinkUpsertOpSchema)(parsed),
                        catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
                    }));
                }
                else if (opType === "invariant_upsert") {
                    invariantOps.push(yield* Effect.try({
                        try: () => Schema.decodeUnknownSync(InvariantUpsertOpSchema)(parsed),
                        catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
                    }));
                }
            }
            // Pre-dedup sub-entity ops by contentHash (keep latest timestamp per hash)
            const dedupByHash = (ops) => {
                const map = new Map();
                for (const op of ops) {
                    const existing = map.get(op.contentHash);
                    if (!existing || op.ts > existing.ts)
                        map.set(op.contentHash, op);
                }
                return [...map.values()];
            };
            const dedupedDocLinkOps = dedupByHash(docLinkOps);
            const dedupedTaskDocLinkOps = dedupByHash(taskDocLinkOps);
            const dedupedInvariantOps = dedupByHash(invariantOps);
            // Build existing doc hashes for dedup
            const existingDocs = yield* docRepo.findAll();
            const existingDocHashes = new Set(existingDocs.map(d => contentHash(d.kind, d.name, String(d.version))));
            // Prepare statements
            const insertDocStmt = db.prepare(`INSERT OR IGNORE INTO docs (hash, kind, name, title, version, status, file_path, parent_doc_id, locked_at, created_at, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            const findDocByNameVersionStmt = db.prepare("SELECT id FROM docs WHERE name = ? AND version = ?");
            const checkDocLinkStmt = db.prepare("SELECT 1 FROM doc_links WHERE from_doc_id = ? AND to_doc_id = ? AND link_type = ?");
            const insertDocLinkStmt = db.prepare("INSERT INTO doc_links (from_doc_id, to_doc_id, link_type, created_at) VALUES (?, ?, ?, ?)");
            const checkTaskDocLinkStmt = db.prepare("SELECT 1 FROM task_doc_links WHERE task_id = ? AND doc_id = ? AND link_type = ?");
            const insertTaskDocLinkStmt = db.prepare("INSERT INTO task_doc_links (task_id, doc_id, link_type, created_at) VALUES (?, ?, ?, ?)");
            const findInvariantStmt = db.prepare("SELECT 1 FROM invariants WHERE id = ?");
            const insertInvariantStmt = db.prepare(`INSERT INTO invariants (id, rule, enforcement, doc_id, subsystem, test_ref, lint_rule, prompt_ref, status, created_at, metadata)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
            // Hoist parent resolution UPDATE statement outside the loop
            const updateParentDocStmt = db.prepare("UPDATE docs SET parent_doc_id = ? WHERE id = ?");
            return yield* Effect.try({
                try: () => {
                    return withWriteTransaction(() => {
                        let imported = 0;
                        let skipped = 0;
                        // 1. Import docs (dedup by content hash = kind:name:version)
                        // Track newly inserted doc keys for parent resolution
                        const newDocKeyToId = new Map();
                        const insertedDocKeys = new Set();
                        for (const op of docOps) {
                            if (existingDocHashes.has(op.contentHash)) {
                                // Still populate the key map for link resolution
                                const existing = findDocByNameVersionStmt.get(op.data.name, op.data.version);
                                if (existing)
                                    newDocKeyToId.set(`${op.data.name}:${op.data.version}`, existing.id);
                                skipped++;
                                continue;
                            }
                            // Check if doc already exists by name+version (handles kind mismatch with UNIQUE index)
                            const existing = findDocByNameVersionStmt.get(op.data.name, op.data.version);
                            if (existing) {
                                newDocKeyToId.set(`${op.data.name}:${op.data.version}`, existing.id);
                                skipped++;
                                continue;
                            }
                            // INSERT OR IGNORE handles race with UNIQUE(name, version)
                            const result = insertDocStmt.run(op.data.hash, op.data.kind, op.data.name, op.data.title, op.data.version, op.data.status, op.data.filePath, null, // parent_doc_id resolved after all docs inserted
                            op.data.lockedAt ?? null, op.ts, JSON.stringify(op.data.metadata));
                            if (result.changes > 0) {
                                const docKey = `${op.data.name}:${op.data.version}`;
                                newDocKeyToId.set(docKey, result.lastInsertRowid);
                                insertedDocKeys.add(docKey);
                                imported++;
                            }
                            else {
                                // INSERT OR IGNORE did nothing — row already exists
                                const row = findDocByNameVersionStmt.get(op.data.name, op.data.version);
                                if (row)
                                    newDocKeyToId.set(`${op.data.name}:${op.data.version}`, row.id);
                                skipped++;
                            }
                        }
                        // Helper: resolve docKey (name:version) to doc ID
                        const resolveDocKey = (docKey) => {
                            const newId = newDocKeyToId.get(docKey);
                            if (newId !== undefined)
                                return newId;
                            const parts = docKey.split(":");
                            if (parts.length < 2)
                                return undefined;
                            const name = parts.slice(0, -1).join(":");
                            const version = parseInt(parts[parts.length - 1], 10);
                            if (isNaN(version))
                                return undefined;
                            const row = findDocByNameVersionStmt.get(name, version);
                            return row?.id;
                        };
                        // Resolve parent doc references — only for newly inserted docs
                        for (const op of docOps) {
                            if (!op.data.parentDocKey)
                                continue;
                            const docKey = `${op.data.name}:${op.data.version}`;
                            if (!insertedDocKeys.has(docKey))
                                continue;
                            const docId = resolveDocKey(docKey);
                            const parentId = resolveDocKey(op.data.parentDocKey);
                            if (docId && parentId) {
                                updateParentDocStmt.run(parentId, docId);
                            }
                        }
                        // 2. Import doc links
                        for (const op of dedupedDocLinkOps) {
                            const fromId = resolveDocKey(op.data.fromDocKey);
                            const toId = resolveDocKey(op.data.toDocKey);
                            if (!fromId || !toId) {
                                skipped++;
                                continue;
                            }
                            if (checkDocLinkStmt.get(fromId, toId, op.data.linkType)) {
                                skipped++;
                                continue;
                            }
                            insertDocLinkStmt.run(fromId, toId, op.data.linkType, op.ts);
                            imported++;
                        }
                        // 3. Import task-doc links
                        for (const op of dedupedTaskDocLinkOps) {
                            const docId = resolveDocKey(op.data.docKey);
                            if (!docId) {
                                skipped++;
                                continue;
                            }
                            if (checkTaskDocLinkStmt.get(op.data.taskId, docId, op.data.linkType)) {
                                skipped++;
                                continue;
                            }
                            try {
                                insertTaskDocLinkStmt.run(op.data.taskId, docId, op.data.linkType, op.ts);
                                imported++;
                            }
                            catch {
                                // Skip FK failures (task may not exist)
                                skipped++;
                            }
                        }
                        // 4. Import invariants (use op.id as the canonical invariant ID)
                        for (const op of dedupedInvariantOps) {
                            if (findInvariantStmt.get(op.id)) {
                                skipped++;
                                continue;
                            }
                            const docId = resolveDocKey(op.data.docKey);
                            if (!docId) {
                                skipped++;
                                continue;
                            }
                            insertInvariantStmt.run(op.id, op.data.rule, op.data.enforcement, docId, op.data.subsystem, op.data.testRef, op.data.lintRule, op.data.promptRef, op.data.status, op.ts, JSON.stringify(op.data.metadata));
                            imported++;
                        }
                        return { imported, skipped };
                    });
                },
                catch: (cause) => new DatabaseError({ cause })
            });
        }),
        exportLabels: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_LABELS_JSONL_PATH);
            // Read labels via raw SQL (no repository layer exists)
            const labels = yield* Effect.try({
                try: () => db.prepare("SELECT * FROM task_labels").all(),
                catch: (cause) => new DatabaseError({ cause })
            });
            const labelNameMap = new Map();
            for (const l of labels) {
                labelNameMap.set(l.id, l.name);
            }
            const labelOps = labels.map(labelRowToUpsertOp);
            // Read label assignments
            const assignments = yield* Effect.try({
                try: () => db.prepare("SELECT * FROM task_label_assignments").all(),
                catch: (cause) => new DatabaseError({ cause })
            });
            const assignmentOps = assignments
                .map(a => labelAssignmentToUpsertOp(a, labelNameMap))
                .filter((op) => op !== null);
            const allOps = [...labelOps, ...assignmentOps];
            allOps.sort((a, b) => a.ts.localeCompare(b.ts));
            const jsonl = allOps.map(op => JSON.stringify(op)).join("\n");
            yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""));
            return { opCount: allOps.length, path: filePath };
        }),
        exportDecisions: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? ".tx/decisions.jsonl");
            const decisionRows = yield* Effect.try({
                try: () => db.prepare("SELECT * FROM decisions").all(),
                catch: (cause) => new DatabaseError({ cause })
            });
            // Build doc key map for resolving docId
            const docs = yield* docRepo.findAll();
            const docKeyMap = new Map();
            for (const d of docs) {
                docKeyMap.set(d.id, `${d.name}:${d.version}`);
            }
            const ops = decisionRows.map(row => decisionToUpsertOp({
                id: row.id,
                content: row.content,
                question: row.question,
                status: row.status,
                source: row.source,
                commitSha: row.commit_sha,
                runId: row.run_id,
                taskId: row.task_id,
                docId: row.doc_id,
                invariantId: row.invariant_id,
                reviewedBy: row.reviewed_by,
                reviewNote: row.review_note,
                editedContent: row.edited_content,
                reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
                contentHash: row.content_hash,
                supersededBy: row.superseded_by,
                syncedToDoc: !!row.synced_to_doc,
                createdAt: new Date(row.created_at),
                updatedAt: new Date(row.updated_at),
            }, docKeyMap));
            ops.sort((a, b) => a.ts.localeCompare(b.ts));
            const jsonl = ops.map(op => JSON.stringify(op)).join("\n");
            yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""));
            return { opCount: ops.length, path: filePath };
        }),
        importLabels: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_LABELS_JSONL_PATH);
            const importLabelsFileExists = yield* fileExists(filePath);
            if (!importLabelsFileExists)
                return EMPTY_ENTITY_IMPORT_RESULT;
            const content = yield* readUtf8FileWithLimit(filePath);
            const lines = content.trim().split("\n").filter(Boolean);
            if (lines.length === 0)
                return EMPTY_ENTITY_IMPORT_RESULT;
            const labelOps = [];
            const assignmentOps = [];
            for (const line of lines) {
                const parsed = yield* Effect.try({
                    try: () => JSON.parse(line),
                    catch: (cause) => new ValidationError({ reason: `Invalid JSON: ${cause}` })
                });
                const opType = parsed.op;
                if (opType === "label_upsert") {
                    labelOps.push(yield* Effect.try({
                        try: () => Schema.decodeUnknownSync(LabelUpsertOpSchema)(parsed),
                        catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
                    }));
                }
                else if (opType === "label_assignment_upsert") {
                    assignmentOps.push(yield* Effect.try({
                        try: () => Schema.decodeUnknownSync(LabelAssignmentUpsertOpSchema)(parsed),
                        catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
                    }));
                }
            }
            // Build existing label hashes
            const existingLabels = yield* Effect.try({
                try: () => db.prepare("SELECT * FROM task_labels").all(),
                catch: (cause) => new DatabaseError({ cause })
            });
            const existingLabelHashes = new Set(existingLabels.map(l => contentHash(l.name.toLowerCase())));
            const findLabelByNameStmt = db.prepare("SELECT id FROM task_labels WHERE lower(name) = lower(?)");
            const insertLabelStmt = db.prepare("INSERT INTO task_labels (name, color, created_at, updated_at) VALUES (?, ?, ?, ?)");
            const checkAssignmentStmt = db.prepare("SELECT 1 FROM task_label_assignments WHERE task_id = ? AND label_id = ?");
            const insertAssignmentStmt = db.prepare("INSERT INTO task_label_assignments (task_id, label_id, created_at) VALUES (?, ?, ?)");
            return yield* Effect.try({
                try: () => {
                    return withWriteTransaction(() => {
                        let imported = 0;
                        let skipped = 0;
                        const newLabelNameToId = new Map();
                        // 1. Import labels (dedup by lower(name))
                        for (const op of labelOps) {
                            if (existingLabelHashes.has(op.contentHash)) {
                                // Still populate the name map for assignment resolution
                                const existing = findLabelByNameStmt.get(op.data.name);
                                if (existing)
                                    newLabelNameToId.set(op.data.name.toLowerCase(), existing.id);
                                skipped++;
                                continue;
                            }
                            const existing = findLabelByNameStmt.get(op.data.name);
                            if (existing) {
                                newLabelNameToId.set(op.data.name.toLowerCase(), existing.id);
                                skipped++;
                                continue;
                            }
                            const result = insertLabelStmt.run(op.data.name, op.data.color, op.ts, op.ts);
                            newLabelNameToId.set(op.data.name.toLowerCase(), result.lastInsertRowid);
                            imported++;
                        }
                        // Helper: resolve label name to ID
                        const resolveLabelId = (name) => {
                            const newId = newLabelNameToId.get(name.toLowerCase());
                            if (newId !== undefined)
                                return newId;
                            const row = findLabelByNameStmt.get(name);
                            return row?.id;
                        };
                        // 2. Import label assignments
                        for (const op of assignmentOps) {
                            const labelId = resolveLabelId(op.data.labelName);
                            if (!labelId) {
                                skipped++;
                                continue;
                            }
                            if (checkAssignmentStmt.get(op.data.taskId, labelId)) {
                                skipped++;
                                continue;
                            }
                            try {
                                insertAssignmentStmt.run(op.data.taskId, labelId, op.ts);
                                imported++;
                            }
                            catch {
                                // Skip FK failures (task may not exist)
                                skipped++;
                            }
                        }
                        return { imported, skipped };
                    });
                },
                catch: (cause) => new DatabaseError({ cause })
            });
        }),
        importDecisions: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? ".tx/decisions.jsonl");
            const importDecisionsFileExists = yield* fileExists(filePath);
            if (!importDecisionsFileExists)
                return EMPTY_ENTITY_IMPORT_RESULT;
            const content = yield* readUtf8FileWithLimit(filePath);
            const lines = content.trim().split("\n").filter(Boolean);
            if (lines.length === 0)
                return EMPTY_ENTITY_IMPORT_RESULT;
            const upsertOps = [];
            const deleteOps = [];
            for (const line of lines) {
                const parsed = yield* Effect.try({
                    try: () => JSON.parse(line),
                    catch: (cause) => new ValidationError({ reason: `Invalid decision JSONL: ${cause}` })
                });
                if (parsed.op === "decision_upsert") {
                    upsertOps.push(parsed);
                } else if (parsed.op === "decision_delete") {
                    deleteOps.push(parsed);
                }
            }
            if (upsertOps.length === 0 && deleteOps.length === 0)
                return EMPTY_ENTITY_IMPORT_RESULT;
            // Dedup by content_hash
            const existingHashes = yield* Effect.try({
                try: () => {
                    const rows = db.prepare("SELECT content_hash FROM decisions").all();
                    return new Set(rows.map(r => r.content_hash));
                },
                catch: (cause) => new DatabaseError({ cause })
            });
            // Resolve doc keys to doc IDs
            const docKeyToId = yield* Effect.try({
                try: () => {
                    const rows = db.prepare("SELECT id, name, version FROM docs").all();
                    const map = new Map();
                    for (const r of rows) {
                        map.set(`${r.name}:${r.version}`, r.id);
                    }
                    return map;
                },
                catch: (cause) => new DatabaseError({ cause })
            });
            const insertStmt = db.prepare(
                `INSERT OR IGNORE INTO decisions
                 (id, content, question, status, source, commit_sha, run_id, task_id, doc_id, invariant_id,
                  reviewed_by, review_note, edited_content, reviewed_at, content_hash, superseded_by,
                  synced_to_doc, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            );
            const deleteStmt = db.prepare("DELETE FROM decisions WHERE id = ?");
            return yield* Effect.try({
                try: () => {
                    return withWriteTransaction(() => {
                        let imported = 0;
                        let skipped = 0;
                        // Handle deletes first (tombstones)
                        for (const op of deleteOps) {
                            deleteStmt.run(op.id);
                            imported++;
                        }
                        // Handle upserts
                        for (const op of upsertOps) {
                            if (existingHashes.has(op.contentHash)) {
                                skipped++;
                                continue;
                            }
                            const d = op.data;
                            const docId = d.docKey ? (docKeyToId.get(d.docKey) ?? null) : null;
                            insertStmt.run(
                                op.id,
                                d.content,
                                d.question,
                                d.status,
                                d.source,
                                d.commitSha,
                                d.runId,
                                d.taskId,
                                docId,
                                d.invariantId,
                                d.reviewedBy,
                                d.reviewNote,
                                d.editedContent,
                                d.reviewedAt,
                                op.contentHash,
                                d.supersededBy,
                                d.syncedToDoc ? 1 : 0,
                                d.createdAt ?? op.ts,
                                op.ts
                            );
                            imported++;
                        }
                        return { imported, skipped };
                    });
                },
                catch: (cause) => new DatabaseError({ cause })
            });
        }),
        export: (path) => Effect.gen(function* () {
            if (typeof path === "string") {
                const filePath = resolve(path ?? DEFAULT_JSONL_PATH);
                const ops = yield* collectLegacyTaskOpsForSync();
                const jsonl = ops.map(op => JSON.stringify(op)).join("\n");
                yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""));
                yield* setConfig("last_export", new Date().toISOString());
                return {
                    opCount: ops.length,
                    path: filePath,
                };
            }
            const ops = yield* collectCurrentOpsForSync();
            const stream = yield* streamService.getInfo();
            const day = new Date().toISOString().slice(0, 10);
            const eventPath = resolve(stream.eventsDir, `events-${day}.jsonl`);
            if (ops.length === 0) {
                yield* setConfig("last_export", new Date().toISOString());
                return { eventCount: 0, streamId: stream.streamId, path: eventPath };
            }
            const reservation = yield* streamService.reserveSeq(ops.length);
            const events = [];
            let seq = reservation.startSeq;
            for (const op of ops) {
                const event = toSyncEvent(op, stream.streamId, seq);
                if (!event)
                    continue;
                events.push(event);
                seq++;
            }
            if (events.length === 0) {
                yield* setConfig("last_export", new Date().toISOString());
                return { eventCount: 0, streamId: stream.streamId, path: eventPath };
            }
            yield* Effect.tryPromise({
                try: () => appendFile(eventPath, `${events.map(e => JSON.stringify(e)).join("\n")}\n`, "utf-8"),
                catch: (cause) => new DatabaseError({ cause })
            });
            yield* Effect.try({
                try: () => {
                    const insertStmt = db.prepare(`INSERT OR IGNORE INTO sync_events (event_id, stream_id, seq, ts, type, entity_id, v, payload)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
                    withWriteTransaction(() => {
                        for (const event of events) {
                            insertStmt.run(event.event_id, event.stream_id, event.seq, event.ts, event.type, event.entity_id, event.v, JSON.stringify(event.payload));
                        }
                    });
                },
                catch: (cause) => new DatabaseError({ cause })
            });
            const lastEvent = events[events.length - 1];
            yield* streamService.touchStream(stream.streamId, lastEvent.seq, lastEvent.ts);
            yield* setConfig("last_export", new Date().toISOString());
            return {
                eventCount: events.length,
                streamId: stream.streamId,
                path: eventPath,
            };
        }),
        import: (path) => Effect.gen(function* () {
            if (typeof path === "string") {
                return yield* syncService.importTaskOps(path);
            }
            const loaded = yield* loadEventsFromStreams("incremental");
            if (loaded.events.length === 0) {
                return { importedEvents: 0, appliedEvents: 0, streamCount: loaded.streamCount };
            }
            const buckets = bucketEventsToV1Ops(loaded.events);
            const tempFiles = yield* writeBucketsToTempFiles(buckets);
            let shouldSyncPinsToTargets = false;
            yield* Effect.acquireUseRelease(Effect.try({
                try: () => db.exec("BEGIN"),
                catch: (cause) => new DatabaseError({ cause })
            }), () => Effect.gen(function* () {
                if (buckets.tasks.length > 0)
                    yield* syncService.importTaskOps(tempFiles.tasksPath);
                if (buckets.learnings.length > 0)
                    yield* syncService.importLearnings(tempFiles.learningsPath);
                if (buckets.fileLearnings.length > 0)
                    yield* syncService.importFileLearnings(tempFiles.fileLearningsPath);
                if (buckets.attempts.length > 0)
                    yield* syncService.importAttempts(tempFiles.attemptsPath);
                if (buckets.pins.length > 0) {
                    const pinImportResult = yield* syncService.importPins(tempFiles.pinsPath);
                    shouldSyncPinsToTargets = shouldSyncPinsToTargets || pinImportResult.imported > 0;
                }
                if (buckets.anchors.length > 0)
                    yield* syncService.importAnchors(tempFiles.anchorsPath);
                if (buckets.edges.length > 0)
                    yield* syncService.importEdges(tempFiles.edgesPath);
                if (buckets.docs.length > 0)
                    yield* syncService.importDocs(tempFiles.docsPath);
                if (buckets.labels.length > 0)
                    yield* syncService.importLabels(tempFiles.labelsPath);
                if (buckets.decisions.length > 0)
                    yield* syncService.importDecisions(tempFiles.decisionsPath);
                const insertStmt = db.prepare(`INSERT OR IGNORE INTO sync_events (event_id, stream_id, seq, ts, type, entity_id, v, payload, imported_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
                yield* Effect.try({
                    try: () => {
                        for (const event of loaded.events) {
                            insertStmt.run(event.event_id, event.stream_id, event.seq, event.ts, event.type, event.entity_id, event.v, JSON.stringify(event.payload));
                        }
                    },
                    catch: (cause) => new DatabaseError({ cause })
                });
                yield* Effect.try({
                    try: () => {
                        const lastEventAtByStream = new Map();
                        for (const event of loaded.events) {
                            lastEventAtByStream.set(event.stream_id, event.ts);
                        }
                        for (const [streamId, maxSeq] of loaded.maxSeqByStream) {
                            touchStreamProgress(streamId, maxSeq, lastEventAtByStream.get(streamId) ?? null);
                        }
                    },
                    catch: (cause) => new DatabaseError({ cause })
                });
                yield* setWatermark(DEFAULT_SYNC_WATERMARK_KEY, new Date().toISOString());
                yield* setConfig("last_import", new Date().toISOString());
            }), (_acquire, exit) => Effect.sync(() => {
                if (Exit.isSuccess(exit)) {
                    try {
                        db.exec("COMMIT");
                    }
                    catch {
                        try {
                            db.exec("ROLLBACK");
                        }
                        catch { /* ignore */ }
                    }
                }
                else {
                    try {
                        db.exec("ROLLBACK");
                    }
                    catch { /* ignore */ }
                }
            })).pipe(Effect.ensuring(cleanupTempDir(tempFiles.dir)));
            if (shouldSyncPinsToTargets) {
                yield* syncPinsToTargetFiles();
            }
            return {
                importedEvents: loaded.events.length,
                appliedEvents: loaded.events.length,
                streamCount: loaded.streamCount,
            };
        }),
        hydrate: () => Effect.gen(function* () {
            const loaded = yield* loadEventsFromStreams("all");
            if (loaded.events.length === 0) {
                return { importedEvents: 0, appliedEvents: 0, streamCount: loaded.streamCount, rebuilt: true };
            }
            const buckets = bucketEventsToV1Ops(loaded.events);
            const tempFiles = yield* writeBucketsToTempFiles(buckets);
            let shouldSyncPinsToTargets = false;
            yield* Effect.acquireUseRelease(Effect.try({
                try: () => db.exec("BEGIN"),
                catch: (cause) => new DatabaseError({ cause })
            }), () => Effect.gen(function* () {
                const insertStmt = db.prepare(`INSERT OR IGNORE INTO sync_events (event_id, stream_id, seq, ts, type, entity_id, v, payload, imported_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`);
                yield* Effect.try({
                    try: () => {
                        for (const event of loaded.events) {
                            insertStmt.run(event.event_id, event.stream_id, event.seq, event.ts, event.type, event.entity_id, event.v, JSON.stringify(event.payload));
                        }
                    },
                    catch: (cause) => new DatabaseError({ cause })
                });
                yield* clearMaterializedTables();
                if (buckets.tasks.length > 0)
                    yield* syncService.importTaskOps(tempFiles.tasksPath);
                if (buckets.learnings.length > 0)
                    yield* syncService.importLearnings(tempFiles.learningsPath);
                if (buckets.fileLearnings.length > 0)
                    yield* syncService.importFileLearnings(tempFiles.fileLearningsPath);
                if (buckets.attempts.length > 0)
                    yield* syncService.importAttempts(tempFiles.attemptsPath);
                if (buckets.pins.length > 0) {
                    const pinImportResult = yield* syncService.importPins(tempFiles.pinsPath);
                    shouldSyncPinsToTargets = shouldSyncPinsToTargets || pinImportResult.imported > 0;
                }
                if (buckets.anchors.length > 0)
                    yield* syncService.importAnchors(tempFiles.anchorsPath);
                if (buckets.edges.length > 0)
                    yield* syncService.importEdges(tempFiles.edgesPath);
                if (buckets.docs.length > 0)
                    yield* syncService.importDocs(tempFiles.docsPath);
                if (buckets.labels.length > 0)
                    yield* syncService.importLabels(tempFiles.labelsPath);
                if (buckets.decisions.length > 0)
                    yield* syncService.importDecisions(tempFiles.decisionsPath);
                yield* Effect.try({
                    try: () => {
                        const lastEventAtByStream = new Map();
                        for (const event of loaded.events) {
                            lastEventAtByStream.set(event.stream_id, event.ts);
                        }
                        for (const [streamId, maxSeq] of loaded.maxSeqByStream) {
                            touchStreamProgress(streamId, maxSeq, lastEventAtByStream.get(streamId) ?? null);
                        }
                    },
                    catch: (cause) => new DatabaseError({ cause })
                });
                yield* setWatermark(DEFAULT_SYNC_WATERMARK_KEY, new Date().toISOString());
                yield* setConfig("last_import", new Date().toISOString());
            }), (_acquire, exit) => Effect.sync(() => {
                if (Exit.isSuccess(exit)) {
                    try {
                        db.exec("COMMIT");
                    }
                    catch {
                        try {
                            db.exec("ROLLBACK");
                        }
                        catch { /* ignore */ }
                    }
                }
                else {
                    try {
                        db.exec("ROLLBACK");
                    }
                    catch { /* ignore */ }
                }
            })).pipe(Effect.ensuring(cleanupTempDir(tempFiles.dir)));
            if (shouldSyncPinsToTargets) {
                yield* syncPinsToTargetFiles();
            }
            return {
                importedEvents: loaded.events.length,
                appliedEvents: loaded.events.length,
                streamCount: loaded.streamCount,
                rebuilt: true
            };
        }),
        compact: (path) => Effect.gen(function* () {
            const filePath = resolve(path ?? DEFAULT_JSONL_PATH);
            const records = yield* readJsonlRecords(filePath);
            if (records.length === 0) {
                return { before: 0, after: 0, path: filePath };
            }
            const before = records.length;
            const taskStates = new Map();
            const depStates = new Map();
            for (const record of records) {
                const op = yield* Effect.try({
                    try: () => Schema.decodeUnknownSync(TaskSyncOperationSchema)(record),
                    catch: (cause) => new ValidationError({ reason: `Schema validation failed: ${cause}` })
                });
                if (op.op === "upsert" || op.op === "delete") {
                    const existing = taskStates.get(op.id);
                    if (!existing || compareSyncOrder(op, existing) > 0) {
                        taskStates.set(op.id, { op: op, ts: op.ts, eventId: op.eventId });
                    }
                }
                else if (op.op === "dep_add" || op.op === "dep_remove") {
                    const key = `${op.blockerId}:${op.blockedId}`;
                    const existing = depStates.get(key);
                    if (!existing || compareSyncOrder(op, existing) > 0) {
                        depStates.set(key, { op: op, ts: op.ts, eventId: op.eventId });
                    }
                }
            }
            const compacted = [];
            for (const state of taskStates.values()) {
                if (state.op.op === "upsert") {
                    compacted.push(state.op);
                }
            }
            for (const state of depStates.values()) {
                if (state.op.op === "dep_add") {
                    compacted.push(state.op);
                }
            }
            compacted.sort(compareOpOrder);
            const jsonl = compacted.map(op => JSON.stringify(op)).join("\n");
            yield* atomicWrite(filePath, jsonl + (jsonl.length > 0 ? "\n" : ""));
            return { before, after: compacted.length, path: filePath };
        }),
        stream: () => Effect.gen(function* () {
            const info = yield* streamService.getInfo();
            const knownStreams = yield* streamService.listProgress();
            return {
                streamId: info.streamId,
                nextSeq: info.nextSeq,
                lastSeq: info.lastSeq,
                eventsDir: info.eventsDir,
                configPath: info.configPath,
                knownStreams
            };
        })
    }));
    return syncService;
}));
