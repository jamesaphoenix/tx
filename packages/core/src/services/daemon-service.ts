import { Context, Effect } from "effect"
import { DaemonError } from "../errors.js"

/**
 * Status information for the daemon process.
 */
export interface DaemonStatus {
  readonly running: boolean
  readonly pid: number | null
  readonly uptime: number | null
  readonly startedAt: Date | null
}

/**
 * DaemonService manages the lifecycle of the tx daemon process.
 * The daemon runs in the background and provides:
 * - File watching for auto-sync
 * - JSONL promotion on git operations
 * - Background task processing
 *
 * See DD-015 and PRD-015 for full specification.
 */
export class DaemonService extends Context.Tag("DaemonService")<
  DaemonService,
  {
    /**
     * Start the daemon process.
     * Creates PID file at .tx/daemon.pid on success.
     */
    readonly start: () => Effect.Effect<void, DaemonError>

    /**
     * Stop the daemon process.
     * Removes PID file on success.
     */
    readonly stop: () => Effect.Effect<void, DaemonError>

    /**
     * Get the current status of the daemon.
     */
    readonly status: () => Effect.Effect<DaemonStatus, DaemonError>

    /**
     * Restart the daemon process (stop then start).
     */
    readonly restart: () => Effect.Effect<void, DaemonError>
  }
>() {}
