/**
 * Body Size Limit Middleware Tests
 *
 * Tests for getMaxBytes routing logic and bodyLimitMiddleware export.
 */

import { describe, it, expect } from "vitest"
import {
  getMaxBytes,
  DEFAULT_MAX_BYTES,
  SPEC_BATCH_MAX_BYTES,
  SYNC_MAX_BYTES,
  bodyLimitMiddleware,
} from "../middleware/body-limit.js"

// =============================================================================
// Constants Tests
// =============================================================================

describe("body limit constants", () => {
  it("should define DEFAULT_MAX_BYTES as 1MB", () => {
    expect(DEFAULT_MAX_BYTES).toBe(1 * 1024 * 1024)
  })

  it("should define SYNC_MAX_BYTES as 10MB", () => {
    expect(SYNC_MAX_BYTES).toBe(10 * 1024 * 1024)
  })

  it("should define SPEC_BATCH_MAX_BYTES as 5MB", () => {
    expect(SPEC_BATCH_MAX_BYTES).toBe(5 * 1024 * 1024)
  })
})

// =============================================================================
// getMaxBytes Tests
// =============================================================================

describe("getMaxBytes", () => {
  it("should return SYNC_MAX_BYTES for /api/sync/export", () => {
    expect(getMaxBytes("/api/sync/export")).toBe(SYNC_MAX_BYTES)
  })

  it("should return SYNC_MAX_BYTES for /api/sync/import", () => {
    expect(getMaxBytes("/api/sync/import")).toBe(SYNC_MAX_BYTES)
  })

  it("should return SYNC_MAX_BYTES for /api/sync/stream", () => {
    expect(getMaxBytes("/api/sync/stream")).toBe(SYNC_MAX_BYTES)
  })

  it("should return SYNC_MAX_BYTES for /api/sync/hydrate", () => {
    expect(getMaxBytes("/api/sync/hydrate")).toBe(SYNC_MAX_BYTES)
  })

  it("should return SYNC_MAX_BYTES for /api/sync/status", () => {
    expect(getMaxBytes("/api/sync/status")).toBe(SYNC_MAX_BYTES)
  })

  it("should return SPEC_BATCH_MAX_BYTES for /api/spec/batch", () => {
    expect(getMaxBytes("/api/spec/batch")).toBe(SPEC_BATCH_MAX_BYTES)
  })

  it("should return DEFAULT_MAX_BYTES for /api/tasks", () => {
    expect(getMaxBytes("/api/tasks")).toBe(DEFAULT_MAX_BYTES)
  })

  it("should return DEFAULT_MAX_BYTES for /api/learnings", () => {
    expect(getMaxBytes("/api/learnings")).toBe(DEFAULT_MAX_BYTES)
  })

  it("should return DEFAULT_MAX_BYTES for /api/runs", () => {
    expect(getMaxBytes("/api/runs")).toBe(DEFAULT_MAX_BYTES)
  })

  it("should return DEFAULT_MAX_BYTES for /health", () => {
    expect(getMaxBytes("/health")).toBe(DEFAULT_MAX_BYTES)
  })

  it("should return DEFAULT_MAX_BYTES for root path", () => {
    expect(getMaxBytes("/")).toBe(DEFAULT_MAX_BYTES)
  })
})

// =============================================================================
// bodyLimitMiddleware Export Tests
// =============================================================================

describe("bodyLimitMiddleware", () => {
  it("should export bodyLimitMiddleware as a function", () => {
    expect(bodyLimitMiddleware).toBeDefined()
    expect(typeof bodyLimitMiddleware).toBe("function")
  })
})
