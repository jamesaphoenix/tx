/**
 * API Definition Tests
 *
 * Tests error types, mapCoreError mapping, and API structure.
 */

import { describe, it, expect } from "vitest"
import { Schema } from "effect"
import {
  NotFound,
  BadRequest,
  InternalError,
  Unauthorized,
  Forbidden,
  ServiceUnavailable,
  mapCoreError,
  SafePathString,
  TxApi,
  HealthGroup,
  TasksGroup,
  LearningsGroup,
  RunsGroup,
  SyncGroup,
} from "../api.js"

// =============================================================================
// Error Type Tests
// =============================================================================

describe("Error types", () => {
  it("should create NotFound with message", () => {
    const error = new NotFound({ message: "Task not found" })
    expect(error._tag).toBe("NotFound")
    expect(error.message).toBe("Task not found")
  })

  it("should create BadRequest with message", () => {
    const error = new BadRequest({ message: "Invalid input" })
    expect(error._tag).toBe("BadRequest")
    expect(error.message).toBe("Invalid input")
  })

  it("should create InternalError with message", () => {
    const error = new InternalError({ message: "Something went wrong" })
    expect(error._tag).toBe("InternalError")
    expect(error.message).toBe("Something went wrong")
  })

  it("should create Unauthorized with message", () => {
    const error = new Unauthorized({ message: "Missing credentials" })
    expect(error._tag).toBe("Unauthorized")
    expect(error.message).toBe("Missing credentials")
  })

  it("should create Forbidden with message", () => {
    const error = new Forbidden({ message: "Access denied" })
    expect(error._tag).toBe("Forbidden")
    expect(error.message).toBe("Access denied")
  })

  it("should create ServiceUnavailable with message", () => {
    const error = new ServiceUnavailable({ message: "Service down" })
    expect(error._tag).toBe("ServiceUnavailable")
    expect(error.message).toBe("Service down")
  })
})

// =============================================================================
// mapCoreError Tests
// =============================================================================

describe("mapCoreError", () => {
  describe("preserves API-tagged errors", () => {
    it("should preserve BadRequest", () => {
      const result = mapCoreError(new BadRequest({ message: "Invalid checkAt timestamp" }))
      expect(result._tag).toBe("BadRequest")
      expect(result.message).toBe("Invalid checkAt timestamp")
    })

    it("should preserve NotFound", () => {
      const result = mapCoreError(new NotFound({ message: "Run not found" }))
      expect(result._tag).toBe("NotFound")
      expect(result.message).toBe("Run not found")
    })
  })

  describe("maps not-found errors to NotFound", () => {
    it("should map TaskNotFoundError", () => {
      const result = mapCoreError({ _tag: "TaskNotFoundError", message: "Task tx-abc123 not found" })
      expect(result._tag).toBe("NotFound")
      expect(result.message).toBe("Task tx-abc123 not found")
    })

    it("should map LearningNotFoundError", () => {
      const result = mapCoreError({ _tag: "LearningNotFoundError", message: "Learning 42 not found" })
      expect(result._tag).toBe("NotFound")
      expect(result.message).toBe("Learning 42 not found")
    })

    it("should map FileLearningNotFoundError", () => {
      const result = mapCoreError({ _tag: "FileLearningNotFoundError", message: "Not found" })
      expect(result._tag).toBe("NotFound")
    })

    it("should map AttemptNotFoundError", () => {
      const result = mapCoreError({ _tag: "AttemptNotFoundError", message: "Not found" })
      expect(result._tag).toBe("NotFound")
    })

    it("should map RunNotFoundError", () => {
      const result = mapCoreError({ _tag: "RunNotFoundError", message: "Run missing" })
      expect(result._tag).toBe("NotFound")
      expect(result.message).toBe("Run missing")
    })
  })

  describe("maps validation errors to BadRequest", () => {
    it("should map ValidationError", () => {
      const result = mapCoreError({ _tag: "ValidationError", message: "Title is required" })
      expect(result._tag).toBe("BadRequest")
      expect(result.message).toBe("Title is required")
    })

    it("should map CircularDependencyError", () => {
      const result = mapCoreError({ _tag: "CircularDependencyError", message: "Cycle detected" })
      expect(result._tag).toBe("BadRequest")
      expect(result.message).toBe("Cycle detected")
    })
  })

  describe("maps service errors to ServiceUnavailable", () => {
    it("should map EmbeddingUnavailableError", () => {
      const result = mapCoreError({ _tag: "EmbeddingUnavailableError", message: "No embedding model" })
      expect(result._tag).toBe("ServiceUnavailable")
      expect(result.message).toBe("No embedding model")
    })
  })

  describe("maps database and unknown tagged errors to InternalError", () => {
    it("should map DatabaseError", () => {
      const result = mapCoreError({ _tag: "DatabaseError", message: "Connection failed" })
      expect(result._tag).toBe("InternalError")
      expect(result.message).toBe("Internal server error")
    })

    it("should map unknown tagged errors to InternalError", () => {
      const result = mapCoreError({ _tag: "SomeNewError", message: "Unknown issue" })
      expect(result._tag).toBe("InternalError")
      expect(result.message).toBe("Internal server error")
    })
  })

  describe("handles non-tagged errors", () => {
    it("should map string errors to InternalError", () => {
      const result = mapCoreError("Something broke")
      expect(result._tag).toBe("InternalError")
      expect(result.message).toBe("Internal server error")
    })

    it("should map Error objects to InternalError", () => {
      const result = mapCoreError(new Error("Unexpected"))
      expect(result._tag).toBe("InternalError")
    })

    it("should map null to InternalError", () => {
      const result = mapCoreError(null)
      expect(result._tag).toBe("InternalError")
      expect(result.message).toBe("Internal server error")
    })

    it("should map undefined to InternalError", () => {
      const result = mapCoreError(undefined)
      expect(result._tag).toBe("InternalError")
      expect(result.message).toBe("Internal server error")
    })

    it("should use _tag as message when no message field present", () => {
      const result = mapCoreError({ _tag: "TaskNotFoundError" })
      expect(result._tag).toBe("NotFound")
      expect(result.message).toBe("TaskNotFoundError")
    })
  })
})

// =============================================================================
// API Structure Tests
// =============================================================================

describe("API structure", () => {
  it("should export TxApi class", () => {
    expect(TxApi).toBeDefined()
  })

  it("should export all groups", () => {
    expect(HealthGroup).toBeDefined()
    expect(TasksGroup).toBeDefined()
    expect(LearningsGroup).toBeDefined()
    expect(RunsGroup).toBeDefined()
    expect(SyncGroup).toBeDefined()
  })
})

// =============================================================================
// SafePathString Tests
// =============================================================================

describe("SafePathString", () => {
  const decode = Schema.decodeUnknownSync(SafePathString)

  describe("accepts valid paths", () => {
    it("should accept absolute paths", () => {
      expect(decode("/home/user/.claude/projects/session.jsonl")).toBe(
        "/home/user/.claude/projects/session.jsonl"
      )
    })

    it("should accept paths with .tx/runs/", () => {
      expect(decode("/project/.tx/runs/run-abc12345/stdout.log")).toBe(
        "/project/.tx/runs/run-abc12345/stdout.log"
      )
    })

    it("should accept tilde paths", () => {
      expect(decode("~/.claude/projects/abc/session.jsonl")).toBe(
        "~/.claude/projects/abc/session.jsonl"
      )
    })

    it("should accept single dots in paths", () => {
      expect(decode("/home/user/./file.txt")).toBe("/home/user/./file.txt")
    })

    it("should accept files named with double dots in name (not as segment)", () => {
      expect(decode("/home/user/file..txt")).toBe("/home/user/file..txt")
    })
  })

  describe("rejects traversal attacks", () => {
    it("should reject paths with .. traversal", () => {
      expect(() => decode("/home/user/../etc/passwd")).toThrow()
    })

    it("should reject paths starting with ..", () => {
      expect(() => decode("../etc/passwd")).toThrow()
    })

    it("should reject paths ending with ..", () => {
      expect(() => decode("/home/user/..")).toThrow()
    })

    it("should reject bare ..", () => {
      expect(() => decode("..")).toThrow()
    })

    it("should reject paths with null bytes", () => {
      expect(() => decode("/home/user/\0/file.txt")).toThrow()
    })

    it("should reject paths with embedded null byte before extension", () => {
      expect(() => decode("/home/user/file.txt\0.jpg")).toThrow()
    })
  })
})
