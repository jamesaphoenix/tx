/**
 * CliExitError — Clean exit signaling for CLI commands.
 *
 * Instead of calling process.exit() which terminates immediately and skips
 * database cleanup (WAL checkpoint, transaction rollback, lock release),
 * commands throw CliExitError. This propagates through Effect's runtime
 * as a defect, gets caught by the central handler in cli.ts, and allows
 * the Effect scope finalizers (including db.close()) to run before exit.
 */
export class CliExitError extends Error {
  readonly _tag = "CliExitError" as const
  readonly code: number

  constructor(code: number) {
    super()
    this.code = code
  }
}
