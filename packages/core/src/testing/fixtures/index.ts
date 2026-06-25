/**
 * Fixture ID generation utilities for deterministic test data.
 *
 * @module @tx/test-utils/fixtures
 */

import * as crypto from "crypto"

/**
 * Generate deterministic fixture ID from name.
 * Same name always produces same ID across test runs.
 *
 * @example
 * fixtureId('auth-task') // -> 'tx-a1b2c3d4'
 * fixtureId('auth-task') // -> 'tx-a1b2c3d4' (same)
 */
export const fixtureId = (name: string): string => {
  const hash = crypto.createHash("sha256").update(name).digest("hex")
  return `tx-${hash.slice(0, 8)}`
}

/**
 * Generate fixture ID with namespace to avoid collisions.
 *
 * @example
 * namespacedFixtureId('task-service.test', 'task-1') // -> 'tx-c3d4e5f6'
 */
export const namespacedFixtureId = (namespace: string, name: string): string => {
  return fixtureId(`${namespace}::${name}`)
}

/**
 * Generate sequential IDs within a namespace.
 * Useful for creating multiple related fixtures.
 *
 * @example
 * const ids = sequentialFixtureIds('tasks', 5)
 * // -> ['tx-a1...', 'tx-b2...', 'tx-c3...', 'tx-d4...', 'tx-e5...']
 */
export const sequentialFixtureIds = (namespace: string, count: number): string[] => {
  return Array.from({ length: count }, (_, i) =>
    namespacedFixtureId(namespace, `${i + 1}`)
  )
}

/**
 * Generate fixture ID from object content.
 * Useful for content-addressed fixtures.
 */
export const contentFixtureId = (content: object): string => {
  const json = JSON.stringify(content, Object.keys(content).sort())
  return fixtureId(json)
}
