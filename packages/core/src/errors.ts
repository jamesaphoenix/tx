import { Data } from "effect"

export class TaskNotFoundError extends Data.TaggedError("TaskNotFoundError")<{
  readonly id: string
}> {
  get message() {
    return `Task not found: ${this.id}`
  }
}

export class LearningNotFoundError extends Data.TaggedError("LearningNotFoundError")<{
  readonly id: number
}> {
  get message() {
    return `Learning not found: ${this.id}`
  }
}

export class FileLearningNotFoundError extends Data.TaggedError("FileLearningNotFoundError")<{
  readonly id: number
}> {
  get message() {
    return `File learning not found: ${this.id}`
  }
}

export class AttemptNotFoundError extends Data.TaggedError("AttemptNotFoundError")<{
  readonly id: number
}> {
  get message() {
    return `Attempt not found: ${this.id}`
  }
}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly reason: string
}> {
  get message() {
    return `Validation error: ${this.reason}`
  }
}

export class CircularDependencyError extends Data.TaggedError("CircularDependencyError")<{
  readonly taskId: string
  readonly blockerId: string
}> {
  get message() {
    return `Circular dependency: ${this.taskId} and ${this.blockerId} would create a cycle`
  }
}

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: unknown
}> {
  get message() {
    return `Database error: ${String(this.cause)}`
  }
}

export class EmbeddingUnavailableError extends Data.TaggedError("EmbeddingUnavailableError")<{
  readonly reason: string
}> {
  get message() {
    return `Embedding unavailable: ${this.reason}`
  }
}

export class RerankerUnavailableError extends Data.TaggedError("RerankerUnavailableError")<{
  readonly reason: string
}> {
  get message() {
    return `Reranker unavailable: ${this.reason}`
  }
}

export class EdgeNotFoundError extends Data.TaggedError("EdgeNotFoundError")<{
  readonly id: number
}> {
  get message() {
    return `Edge not found: ${this.id}`
  }
}

export class AnchorNotFoundError extends Data.TaggedError("AnchorNotFoundError")<{
  readonly id: number
}> {
  get message() {
    return `Anchor not found: ${this.id}`
  }
}

export class CandidateNotFoundError extends Data.TaggedError("CandidateNotFoundError")<{
  readonly id: number
}> {
  get message() {
    return `Candidate not found: ${this.id}`
  }
}

export class ExtractionUnavailableError extends Data.TaggedError("ExtractionUnavailableError")<{
  readonly reason: string
}> {
  get message() {
    return `Extraction unavailable: ${this.reason}`
  }
}

export class RetrievalError extends Data.TaggedError("RetrievalError")<{
  readonly reason: string
}> {
  get message() {
    return `Retrieval error: ${this.reason}`
  }
}

export class AstGrepError extends Data.TaggedError("AstGrepError")<{
  readonly reason: string
  readonly cause?: unknown
}> {
  get message() {
    return `AST grep error: ${this.reason}`
  }
}

export class DaemonError extends Data.TaggedError("DaemonError")<{
  readonly code: string
  readonly message: string
  readonly pid: number | null
}> {}

export class FileWatcherError extends Data.TaggedError("FileWatcherError")<{
  readonly reason: string
  readonly cause?: unknown
}> {
  get message() {
    return `File watcher error: ${this.reason}`
  }
}

export class WatcherAlreadyRunningError extends Data.TaggedError("WatcherAlreadyRunningError")<{
  readonly path: string
}> {
  get message() {
    return `Watcher already running for path: ${this.path}`
  }
}

export class WatcherNotRunningError extends Data.TaggedError("WatcherNotRunningError")<{
  readonly path: string
}> {
  get message() {
    return `Watcher not running for path: ${this.path}`
  }
}

// Orchestration error types (PRD-018)

export class RegistrationError extends Data.TaggedError("RegistrationError")<{
  readonly reason: string
  readonly workerId?: string
}> {
  get message() {
    return this.workerId
      ? `Worker registration failed for ${this.workerId}: ${this.reason}`
      : `Worker registration failed: ${this.reason}`
  }
}

export class WorkerNotFoundError extends Data.TaggedError("WorkerNotFoundError")<{
  readonly workerId: string
}> {
  get message() {
    return `Worker not found: ${this.workerId}`
  }
}

export class AlreadyClaimedError extends Data.TaggedError("AlreadyClaimedError")<{
  readonly taskId: string
  readonly claimedByWorkerId: string
}> {
  get message() {
    return `Task ${this.taskId} is already claimed by worker ${this.claimedByWorkerId}`
  }
}

export class ClaimNotFoundError extends Data.TaggedError("ClaimNotFoundError")<{
  readonly taskId: string
  readonly workerId?: string
}> {
  get message() {
    return this.workerId
      ? `No active claim found for task ${this.taskId} by worker ${this.workerId}`
      : `No active claim found for task ${this.taskId}`
  }
}

export class LeaseExpiredError extends Data.TaggedError("LeaseExpiredError")<{
  readonly taskId: string
  readonly expiredAt: string
}> {
  get message() {
    return `Lease for task ${this.taskId} expired at ${this.expiredAt}`
  }
}

export class MaxRenewalsExceededError extends Data.TaggedError("MaxRenewalsExceededError")<{
  readonly taskId: string
  readonly renewalCount: number
  readonly maxRenewals: number
}> {
  get message() {
    return `Task ${this.taskId} has reached maximum renewals (${this.renewalCount}/${this.maxRenewals})`
  }
}

export class OrchestratorError extends Data.TaggedError("OrchestratorError")<{
  readonly code: string
  readonly reason: string
  readonly cause?: unknown
}> {
  get message() {
    return `Orchestrator error [${this.code}]: ${this.reason}`
  }
}

export type TaskError =
  | TaskNotFoundError
  | ValidationError
  | CircularDependencyError
  | DatabaseError
  | EmbeddingUnavailableError
  | RerankerUnavailableError
  | ExtractionUnavailableError
  | RetrievalError
  | AstGrepError
  | DaemonError
  | FileWatcherError
  | WatcherAlreadyRunningError
  | WatcherNotRunningError
  | CandidateNotFoundError
  | RegistrationError
  | WorkerNotFoundError
  | AlreadyClaimedError
  | ClaimNotFoundError
  | LeaseExpiredError
  | MaxRenewalsExceededError
  | OrchestratorError
