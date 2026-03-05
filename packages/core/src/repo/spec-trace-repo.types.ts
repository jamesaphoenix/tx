import type { Effect } from "effect"
import type { DatabaseError } from "../errors.js"
import type {
  SpecDiscoveryMethod,
  SpecScopeType,
  SpecTest,
  SpecTestRun,
  SpecSignoff,
} from "@jamesaphoenix/tx-types"

export type InvariantSummary = {
  readonly id: string
  readonly rule: string
  readonly subsystem: string | null
  readonly docName: string
}

export type SpecTraceFilter = {
  readonly doc?: string
  readonly subsystem?: string
}

export type UpsertSpecTestInput = {
  invariantId: string
  testId: string
  testFile: string
  testName: string | null
  framework: string | null
  discovery: SpecDiscoveryMethod
}

export type SyncDiscoveredSpecTestInput = {
  invariantId: string
  testId: string
  testFile: string
  testName: string | null
  framework: string | null
  discovery: SpecDiscoveryMethod
}

export type InsertSpecTestRunInput = {
  specTestId: number
  passed: boolean
  durationMs?: number | null
  details?: string | null
  runAt?: string
}

export type SpecTraceRepositoryService = {
  readonly upsertSpecTest: (input: UpsertSpecTestInput) => Effect.Effect<SpecTest, DatabaseError>
  readonly deleteSpecTest: (invariantId: string, testId: string) => Effect.Effect<boolean, DatabaseError>
  readonly findSpecTestsByInvariant: (invariantId: string) => Effect.Effect<readonly SpecTest[], DatabaseError>
  readonly findSpecTestsByInvariantIds: (invariantIds: readonly string[]) => Effect.Effect<readonly SpecTest[], DatabaseError>
  readonly findSpecTestsByTestId: (testId: string) => Effect.Effect<readonly SpecTest[], DatabaseError>
  readonly findSpecTestsByTestIds: (testIds: readonly string[]) => Effect.Effect<ReadonlyMap<string, readonly SpecTest[]>, DatabaseError>
  readonly findSpecTestsByTestName: (testName: string) => Effect.Effect<readonly SpecTest[], DatabaseError>
  readonly syncDiscoveredSpecTests: (params: {
    rows: readonly SyncDiscoveredSpecTestInput[]
    invariantIds: readonly string[]
  }) => Effect.Effect<{ upserted: number; pruned: number }, DatabaseError>
  readonly insertRun: (input: InsertSpecTestRunInput) => Effect.Effect<SpecTestRun, DatabaseError>
  readonly insertRunsBatch: (inputs: readonly InsertSpecTestRunInput[]) => Effect.Effect<readonly SpecTestRun[], DatabaseError>
  readonly findLatestRunsBySpecTestIds: (specTestIds: readonly number[]) => Effect.Effect<ReadonlyMap<number, SpecTestRun>, DatabaseError>
  readonly listActiveInvariants: (filter?: SpecTraceFilter) => Effect.Effect<readonly InvariantSummary[], DatabaseError>
  readonly listUncoveredInvariants: (filter?: SpecTraceFilter) => Effect.Effect<readonly InvariantSummary[], DatabaseError>
  readonly upsertSignoff: (scopeType: SpecScopeType, scopeValue: string | null, signedOffBy: string, notes: string | null) => Effect.Effect<SpecSignoff, DatabaseError>
  readonly findSignoff: (scopeType: SpecScopeType, scopeValue: string | null) => Effect.Effect<SpecSignoff | null, DatabaseError>
}
