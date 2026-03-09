import type { Effect } from "effect"
import type { DatabaseError, ValidationError } from "../../errors.js"
import type {
  LegacySyncExportResult,
  SyncCompactResult,
  SyncExportResult,
  SyncStreamInfoResult,
} from "./types.js"

export type SyncEntityExportContract = {
  readonly export: {
    (): Effect.Effect<SyncExportResult, DatabaseError | ValidationError>
    (path: string): Effect.Effect<LegacySyncExportResult, DatabaseError | ValidationError>
  }
  readonly exportLearnings: (path?: string) => Effect.Effect<LegacySyncExportResult, DatabaseError>
  readonly exportFileLearnings: (path?: string) => Effect.Effect<LegacySyncExportResult, DatabaseError>
  readonly exportAttempts: (path?: string) => Effect.Effect<LegacySyncExportResult, DatabaseError>
  readonly exportPins: (path?: string) => Effect.Effect<LegacySyncExportResult, DatabaseError>
  readonly exportAnchors: (path?: string) => Effect.Effect<LegacySyncExportResult, DatabaseError>
  readonly exportEdges: (path?: string) => Effect.Effect<LegacySyncExportResult, DatabaseError>
  readonly exportDocs: (path?: string) => Effect.Effect<LegacySyncExportResult, DatabaseError>
  readonly exportLabels: (path?: string) => Effect.Effect<LegacySyncExportResult, DatabaseError>
  readonly exportDecisions: (path?: string) => Effect.Effect<LegacySyncExportResult, DatabaseError>
  readonly compact: (path?: string) => Effect.Effect<SyncCompactResult, DatabaseError | ValidationError>
  readonly stream: () => Effect.Effect<SyncStreamInfoResult, DatabaseError>
}

export const ENTITY_EXPORT_METHODS = [
  "export",
  "exportLearnings",
  "exportFileLearnings",
  "exportAttempts",
  "exportPins",
  "exportAnchors",
  "exportEdges",
  "exportDocs",
  "exportLabels",
  "exportDecisions",
  "compact",
  "stream",
] as const

export const applyEntityExportContract = <T extends SyncEntityExportContract>(handlers: T): T => handlers
