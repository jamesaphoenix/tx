/**
 * Pin types for tx
 *
 * Type definitions for context pins — named content blocks that are
 * injected into agent context files (CLAUDE.md, AGENTS.md) as
 * <tx-pin id="...">...</tx-pin> XML-tagged sections.
 *
 * Core type definitions using Effect Schema (Doctrine Rule 10).
 */

import { Schema } from "effect"

// =============================================================================
// SCHEMAS & TYPES
// =============================================================================

/**
 * Pin ID — user-chosen kebab-case identifier.
 * Examples: "auth-patterns", "api-conventions", "coding.standards"
 */
export const PinIdSchema = Schema.String.pipe(
  Schema.pattern(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/),
  Schema.brand("PinId")
)
export type PinId = typeof PinIdSchema.Type

/** Core pin entity (stored in context_pins table). */
export const PinSchema = Schema.Struct({
  id: PinIdSchema,
  content: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type Pin = typeof PinSchema.Type

/** Row shape from SQLite (snake_case columns). */
export interface PinRow {
  id: string
  content: string
  created_at: string
  updated_at: string
}

/** Pin config row shape. */
export interface PinConfigRow {
  key: string
  value: string
}

// =============================================================================
// SERIALIZED SCHEMA (for API responses — plain strings, no brands)
// =============================================================================

/** Serialized pin for API/SDK responses. */
export const PinSerializedSchema = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type PinSerialized = typeof PinSerializedSchema.Type

/** Convert a Pin to its serialized API form. */
export const serializePin = (pin: Pin): PinSerialized => ({
  id: pin.id,
  content: pin.content,
  createdAt: pin.createdAt,
  updatedAt: pin.updatedAt,
})
