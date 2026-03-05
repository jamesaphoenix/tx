import type { Effect } from "effect"
import type { DatabaseError, TaskNotFoundError, ValidationError } from "../../errors.js"
import type {
  EntityImportResult,
  ImportResult,
  SyncHydrateResult,
  SyncImportResult,
} from "./types.js"

export type SyncEntityImportContract = {
  readonly importTaskOps: (path?: string) => Effect.Effect<ImportResult, ValidationError | DatabaseError | TaskNotFoundError>
  readonly importLearnings: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>
  readonly importFileLearnings: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>
  readonly importAttempts: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>
  readonly importPins: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>
  readonly importAnchors: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>
  readonly importEdges: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>
  readonly importDocs: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>
  readonly importLabels: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>
  readonly import: {
    (): Effect.Effect<SyncImportResult, ValidationError | DatabaseError | TaskNotFoundError>
    (path: string): Effect.Effect<ImportResult, ValidationError | DatabaseError | TaskNotFoundError>
  }
  readonly hydrate: () => Effect.Effect<SyncHydrateResult, ValidationError | DatabaseError | TaskNotFoundError>
}

export const ENTITY_IMPORT_METHODS = [
  "importTaskOps",
  "importLearnings",
  "importFileLearnings",
  "importAttempts",
  "importPins",
  "importAnchors",
  "importEdges",
  "importDocs",
  "importLabels",
  "import",
  "hydrate",
] as const

export const applyEntityImportContract = <T extends SyncEntityImportContract>(handlers: T): T => handlers
