/**
 * Doc mappers - convert database rows to domain objects
 */
import {
  DOC_KINDS,
  DOC_STATUSES,
  DOC_LINK_TYPES,
  TASK_DOC_LINK_TYPES,
  INVARIANT_ENFORCEMENT_TYPES,
  INVARIANT_STATUSES,
  type DocKind,
  type DocStatus,
  type DocLinkType,
  type TaskDocLinkType,
  type InvariantEnforcement,
  type InvariantStatus,
  type Doc,
  type DocLink,
  type TaskDocLink,
  type Invariant,
  type InvariantCheck,
  type DocId,
  type InvariantId,
  type DocRow,
  type DocLinkRow,
  type TaskDocLinkRow,
  type InvariantRow,
  type InvariantCheckRow,
} from "@jamesaphoenix/tx-types"
import { InvalidStatusError } from "../errors.js"
import { parseDate } from "./parse-date.js"

export {
  DOC_KINDS,
  DOC_STATUSES,
  DOC_LINK_TYPES,
  TASK_DOC_LINK_TYPES,
  INVARIANT_ENFORCEMENT_TYPES,
  INVARIANT_STATUSES,
}

// Local string arrays for .includes() (avoids 'as readonly string[]' casts)
const docKindStrings: readonly string[] = DOC_KINDS
const docStatusStrings: readonly string[] = DOC_STATUSES
const docLinkTypeStrings: readonly string[] = DOC_LINK_TYPES
const taskDocLinkTypeStrings: readonly string[] = TASK_DOC_LINK_TYPES
const invariantEnforcementStrings: readonly string[] = INVARIANT_ENFORCEMENT_TYPES
const invariantStatusStrings: readonly string[] = INVARIANT_STATUSES

// =============================================================================
// TYPE GUARDS
// =============================================================================

export const isValidDocKind = (s: string): s is DocKind =>
  docKindStrings.includes(s)
export const isValidDocStatus = (s: string): s is DocStatus =>
  docStatusStrings.includes(s)
export const isValidDocLinkType = (s: string): s is DocLinkType =>
  docLinkTypeStrings.includes(s)
export const isValidTaskDocLinkType = (s: string): s is TaskDocLinkType =>
  taskDocLinkTypeStrings.includes(s)
export const isValidInvariantEnforcement = (s: string): s is InvariantEnforcement =>
  invariantEnforcementStrings.includes(s)
export const isValidInvariantStatus = (s: string): s is InvariantStatus =>
  invariantStatusStrings.includes(s)

// =============================================================================
// METADATA PARSING
// =============================================================================

const parseMetadata = (
  metadataJson: string | null
): Record<string, unknown> => {
  if (!metadataJson) return {}
  try {
    const parsed = JSON.parse(metadataJson)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(parsed)) {
        result[key] = value
      }
      return result
    }
    return {}
  } catch {
    return {}
  }
}

// =============================================================================
// ROW MAPPERS
// =============================================================================

/**
 * Convert a database row to a Doc domain object.
 * Validates kind and status at runtime.
 * Branded integer ID uses 'as' cast (SQLite guarantees integer type).
 */
export const rowToDoc = (row: DocRow): Doc => {
  if (!isValidDocKind(row.kind)) {
    throw new InvalidStatusError({
      entity: "doc",
      status: row.kind,
      validStatuses: [...DOC_KINDS],
      rowId: row.id,
    })
  }
  if (!isValidDocStatus(row.status)) {
    throw new InvalidStatusError({
      entity: "doc",
      status: row.status,
      validStatuses: [...DOC_STATUSES],
      rowId: row.id,
    })
  }
  return {
    id: row.id as DocId,
    hash: row.hash,
    kind: row.kind,
    name: row.name,
    title: row.title,
    version: row.version,
    status: row.status,
    filePath: row.file_path,
    parentDocId:
      row.parent_doc_id !== null ? (row.parent_doc_id as DocId) : null,
    createdAt: parseDate(row.created_at, "created_at", row.id),
    lockedAt: row.locked_at
      ? parseDate(row.locked_at, "locked_at", row.id)
      : null,
    metadata: parseMetadata(row.metadata),
  }
}

export const rowToDocLink = (row: DocLinkRow): DocLink => {
  if (!isValidDocLinkType(row.link_type)) {
    throw new InvalidStatusError({
      entity: "doc_link",
      status: row.link_type,
      validStatuses: [...DOC_LINK_TYPES],
      rowId: row.id,
    })
  }
  return {
    id: row.id,
    fromDocId: row.from_doc_id as DocId,
    toDocId: row.to_doc_id as DocId,
    linkType: row.link_type,
    createdAt: parseDate(row.created_at, "created_at", row.id),
  }
}

export const rowToTaskDocLink = (row: TaskDocLinkRow): TaskDocLink => {
  if (!isValidTaskDocLinkType(row.link_type)) {
    throw new InvalidStatusError({
      entity: "task_doc_link",
      status: row.link_type,
      validStatuses: [...TASK_DOC_LINK_TYPES],
      rowId: row.id,
    })
  }
  return {
    id: row.id,
    taskId: row.task_id,
    docId: row.doc_id as DocId,
    linkType: row.link_type,
    createdAt: parseDate(row.created_at, "created_at", row.id),
  }
}

export const rowToInvariant = (row: InvariantRow): Invariant => {
  if (!isValidInvariantEnforcement(row.enforcement)) {
    throw new InvalidStatusError({
      entity: "invariant",
      status: row.enforcement,
      validStatuses: [...INVARIANT_ENFORCEMENT_TYPES],
      rowId: row.id,
    })
  }
  if (!isValidInvariantStatus(row.status)) {
    throw new InvalidStatusError({
      entity: "invariant",
      status: row.status,
      validStatuses: [...INVARIANT_STATUSES],
      rowId: row.id,
    })
  }
  return {
    id: row.id as InvariantId,
    rule: row.rule,
    enforcement: row.enforcement,
    docId: row.doc_id as DocId,
    subsystem: row.subsystem,
    testRef: row.test_ref,
    lintRule: row.lint_rule,
    promptRef: row.prompt_ref,
    status: row.status,
    createdAt: parseDate(row.created_at, "created_at", row.id),
    metadata: parseMetadata(row.metadata),
  }
}

export const rowToInvariantCheck = (row: InvariantCheckRow): InvariantCheck => {
  return {
    id: row.id,
    invariantId: row.invariant_id as InvariantId,
    passed: row.passed === 1,
    details: row.details,
    checkedAt: parseDate(row.checked_at, "checked_at", row.id),
    durationMs: row.duration_ms,
  }
}
