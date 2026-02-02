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

export class ExtractionUnavailableError extends Data.TaggedError("ExtractionUnavailableError")<{
  readonly reason: string
}> {
  get message() {
    return `Extraction unavailable: ${this.reason}`
  }
}

export type TaskError =
  | TaskNotFoundError
  | ValidationError
  | CircularDependencyError
  | DatabaseError
  | EmbeddingUnavailableError
  | ExtractionUnavailableError
