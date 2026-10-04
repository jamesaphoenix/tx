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
  readonly importDocs: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>
  readonly importLabels: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>
  readonly importDecisions: (path?: string) => Effect.Effect<EntityImportResult, ValidationError | DatabaseError>
  readonly import: {
    (): Effect.Effect<SyncImportResult, ValidationError | DatabaseError | TaskNotFoundError>
    (path: string): Effect.Effect<ImportResult, ValidationError | DatabaseError | TaskNotFoundError>
  }
  readonly hydrate: () => Effect.Effect<SyncHydrateResult, ValidationError | DatabaseError | TaskNotFoundError>
}

export const ENTITY_IMPORT_METHODS = [
  "importTaskOps",
  "importDocs",
  "importLabels",
  "importDecisions",
  "import",
  "hydrate",
] as const

export const applyEntityImportContract = <T extends SyncEntityImportContract>(handlers: T): T => handlers
