/**
 * AutoSyncService provides hooks for automatic JSONL export on data mutations.
 *
 * When auto-sync is enabled, any create/update/delete operation on tasks,
 * learnings, file-learnings, attempts, or dependencies triggers an export
 * to keep JSONL files in sync with SQLite.
 *
 * Design:
 * - Non-blocking: Exports run in background fiber to avoid latency impact
 * - Error-resilient: Export errors are logged but never propagate to caller
 * - Configurable: Controlled via sync_config "auto_sync" setting
 */

import { Context, Effect, Fiber, Layer, Ref } from "effect"
import { SqliteClient } from "../db.js"
import { SyncService } from "./sync-service.js"
import { DatabaseError } from "../errors.js"

/**
 * Entity types that can trigger auto-sync
 */
export type AutoSyncEntity = "tasks" | "learnings" | "file-learnings" | "attempts"

export class AutoSyncService extends Context.Tag("AutoSyncService")<
  AutoSyncService,
  {
    /**
     * Trigger auto-sync after a task or dependency mutation.
     * Non-blocking - runs export in background if auto-sync is enabled.
     */
    readonly afterTaskMutation: () => Effect.Effect<void, never>

    /**
     * Trigger auto-sync after a learning mutation.
     * Non-blocking - runs export in background if auto-sync is enabled.
     */
    readonly afterLearningMutation: () => Effect.Effect<void, never>

    /**
     * Trigger auto-sync after a file-learning mutation.
     * Non-blocking - runs export in background if auto-sync is enabled.
     */
    readonly afterFileLearningMutation: () => Effect.Effect<void, never>

    /**
     * Trigger auto-sync after an attempt mutation.
     * Non-blocking - runs export in background if auto-sync is enabled.
     */
    readonly afterAttemptMutation: () => Effect.Effect<void, never>

    /**
     * Trigger auto-sync for all entities.
     * Non-blocking - runs exportAll in background if auto-sync is enabled.
     */
    readonly afterAnyMutation: () => Effect.Effect<void, never>
  }
>() {}

export const AutoSyncServiceLive = Layer.effect(
  AutoSyncService,
  Effect.gen(function* () {
    const db = yield* SqliteClient
    const syncService = yield* SyncService

    // Track the current export fiber to prevent unbounded accumulation.
    // When a new mutation triggers an export, any in-flight export is interrupted
    // first — only the latest export needs to succeed since it captures all state.
    const currentFiber = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(null)

    // Check if auto-sync is enabled
    const isEnabled = (): Effect.Effect<boolean, DatabaseError> =>
      Effect.try({
        try: () => {
          const row = db.prepare("SELECT value FROM sync_config WHERE key = ?").get("auto_sync") as { value: string } | undefined
          return row?.value === "true"
        },
        catch: (cause) => new DatabaseError({ cause })
      })

    // Run export in background, interrupting any previous in-flight export
    const runInBackground = <E>(
      exportEffect: Effect.Effect<unknown, E>
    ): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const enabled = yield* isEnabled().pipe(
          Effect.catchAll(() => Effect.succeed(false))
        )

        if (!enabled) {
          return
        }

        // Interrupt previous export fiber if still running
        const prevFiber = yield* Ref.get(currentFiber)
        if (prevFiber !== null) {
          yield* Fiber.interrupt(prevFiber)
        }

        // Fork the new export and track it
        const clearRef = Ref.set(currentFiber, null)
        const fiber = yield* Effect.fork(
          exportEffect.pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                // Log error but don't propagate
                console.error("[auto-sync] Export failed:", error)
              })
            ),
            Effect.asVoid,
            // Clear the fiber ref when this export completes or is interrupted
            Effect.ensuring(clearRef)
          )
        )

        yield* Ref.set(currentFiber, fiber)
      })

    return {
      afterTaskMutation: () =>
        runInBackground(syncService.export()),

      afterLearningMutation: () =>
        runInBackground(syncService.export()),

      afterFileLearningMutation: () =>
        runInBackground(syncService.export()),

      afterAttemptMutation: () =>
        runInBackground(syncService.export()),

      afterAnyMutation: () =>
        runInBackground(syncService.export())
    }
  })
)

/**
 * Noop implementation for use when auto-sync is not needed.
 * All hooks do nothing.
 */
export const AutoSyncServiceNoop = Layer.succeed(
  AutoSyncService,
  AutoSyncService.of({
    afterTaskMutation: () => Effect.void,
    afterLearningMutation: () => Effect.void,
    afterFileLearningMutation: () => Effect.void,
    afterAttemptMutation: () => Effect.void,
    afterAnyMutation: () => Effect.void
  })
)
