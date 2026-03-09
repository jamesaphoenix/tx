import type { Effect } from "effect"
import type { DatabaseError } from "../errors.js"
import type {
  Doc,
  DocLink,
  TaskDocLink,
  Invariant,
  InvariantCheck,
  DocId,
  DocKind,
  DocStatus,
  DocLinkType,
  TaskDocLinkType,
} from "@jamesaphoenix/tx-types"

export type DocInsertInput = {
  hash: string
  kind: DocKind
  name: string
  title: string
  version: number
  filePath: string
  parentDocId: DocId | null
  metadata?: string
}

export type DocUpdateInput = {
  hash?: string
  title?: string
  status?: DocStatus
  lockedAt?: string
  metadata?: string
}

export type DocFilter = {
  kind?: string
  status?: string
}

export type InvariantFilter = {
  docId?: number
  subsystem?: string
  enforcement?: string
}

export type InvariantUpsertInput = {
  id: string
  rule: string
  enforcement: string
  docId: DocId
  subsystem?: string | null
  testRef?: string | null
  lintRule?: string | null
  promptRef?: string | null
  // Provenance
  source?: string | null
  sourceRef?: string | null
  // EARS fields
  pattern?: string | null
  triggerText?: string | null
  stateText?: string | null
  conditionText?: string | null
  feature?: string | null
  systemName?: string | null
  response?: string | null
  rationale?: string | null
  testHint?: string | null
}

export type DocRepositoryService = {
  insert: (input: DocInsertInput) => Effect.Effect<Doc, DatabaseError>
  findById: (id: DocId) => Effect.Effect<Doc | null, DatabaseError>
  findByName: (name: string, version?: number) => Effect.Effect<Doc | null, DatabaseError>
  findAll: (filter?: DocFilter) => Effect.Effect<Doc[], DatabaseError>
  update: (id: DocId, input: DocUpdateInput) => Effect.Effect<void, DatabaseError>
  lock: (id: DocId, lockedAt: string) => Effect.Effect<void, DatabaseError>
  remove: (id: DocId) => Effect.Effect<void, DatabaseError>
  createLink: (fromDocId: DocId, toDocId: DocId, linkType: DocLinkType) => Effect.Effect<DocLink, DatabaseError>
  getLinksFrom: (docId: DocId) => Effect.Effect<DocLink[], DatabaseError>
  getLinksTo: (docId: DocId) => Effect.Effect<DocLink[], DatabaseError>
  getAllLinks: () => Effect.Effect<DocLink[], DatabaseError>
  createTaskLink: (taskId: string, docId: DocId, linkType: TaskDocLinkType) => Effect.Effect<TaskDocLink, DatabaseError>
  getTaskLinksForDoc: (docId: DocId) => Effect.Effect<TaskDocLink[], DatabaseError>
  getDocForTask: (taskId: string) => Effect.Effect<Doc | null, DatabaseError>
  getUnlinkedTaskIds: () => Effect.Effect<string[], DatabaseError>
  upsertInvariant: (input: InvariantUpsertInput) => Effect.Effect<Invariant, DatabaseError>
  findInvariantById: (id: string) => Effect.Effect<Invariant | null, DatabaseError>
  findInvariants: (filter?: InvariantFilter) => Effect.Effect<Invariant[], DatabaseError>
  deprecateInvariantsNotIn: (docId: DocId, activeIds: string[]) => Effect.Effect<void, DatabaseError>
  insertInvariantCheck: (invariantId: string, passed: boolean, details: string | null, durationMs: number | null) => Effect.Effect<InvariantCheck, DatabaseError>
  getInvariantChecks: (invariantId: string, limit?: number) => Effect.Effect<InvariantCheck[], DatabaseError>
  countInvariantsByDoc: (docId: DocId) => Effect.Effect<number, DatabaseError>
}
