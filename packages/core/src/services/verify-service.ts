import { Context, Effect, Layer } from "effect"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { resolve as resolvePath, relative, isAbsolute } from "node:path"
import { TaskRepository } from "../repo/task-repo.js"
import { TaskNotFoundError, VerifyError, type DatabaseError } from "../errors.js"
import { readTxConfig } from "../utils/toml-config.js"
import type { TaskId } from "@jamesaphoenix/tx-types"

export interface VerifyResult {
  readonly taskId: string
  readonly exitCode: number
  readonly passed: boolean
  readonly stdout: string
  readonly stderr: string
  readonly durationMs: number
  readonly output?: Record<string, unknown>
  readonly schemaValid?: boolean
}

export class VerifyService extends Context.Tag("VerifyService")<
  VerifyService,
  {
    readonly set: (id: TaskId, cmd: string, schema?: string) => Effect.Effect<void, TaskNotFoundError | DatabaseError>
    readonly show: (id: TaskId) => Effect.Effect<{ cmd: string | null; schema: string | null }, TaskNotFoundError | DatabaseError>
    readonly run: (id: TaskId, options?: { timeout?: number }) => Effect.Effect<VerifyResult, TaskNotFoundError | VerifyError | DatabaseError>
    readonly clear: (id: TaskId) => Effect.Effect<void, TaskNotFoundError | DatabaseError>
  }
>() {}

export const VerifyServiceLive = Layer.effect(
  VerifyService,
  Effect.gen(function* () {
    const taskRepo = yield* TaskRepository
    const config = readTxConfig()
    // Capture project root at layer construction time, not at command execution time.
    // This prevents cwd drift if process.chdir() is called later (e.g. in tests or MCP server).
    const projectRoot = process.cwd()

    return {
      set: (id, cmd, schema) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          yield* taskRepo.updateVerifyCmd(id, cmd, schema ?? null)
        }),

      show: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          const result = yield* taskRepo.getVerifyCmd(id)
          return result
        }),

      run: (id, options) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          const verify = yield* taskRepo.getVerifyCmd(id)
          if (!verify.cmd) {
            return yield* Effect.fail(new VerifyError({
              taskId: id,
              reason: "No verify command set. Use `tx verify set <id> <cmd>` first.",
            }))
          }

          const timeout = (options?.timeout ?? config.verify.timeout) * 1000

          // Execute the command
          const result = yield* Effect.tryPromise({
            try: () => executeCommand(verify.cmd!, timeout, projectRoot),
            catch: (cause) => new VerifyError({
              taskId: id,
              reason: `Command execution failed: ${String(cause)}`,
              cause,
            }),
          })

          // If a schema is set, validate the output
          const schemaPath = verify.schema ?? config.verify.defaultSchema
          let output: Record<string, unknown> | undefined
          let schemaValid: boolean | undefined

          if (schemaPath) {
            // Guard against path traversal: schema must resolve within project root
            // Uses projectRoot captured at layer construction time to prevent cwd drift
            const resolvedSchema = resolvePath(projectRoot, schemaPath)
            const rel = relative(projectRoot, resolvedSchema)
            if (rel.startsWith("..") || isAbsolute(rel)) {
              return yield* Effect.fail(new VerifyError({
                taskId: id,
                reason: `Schema path "${schemaPath}" escapes project root`,
              }))
            }
            let schemaContent: string
            try {
              schemaContent = readFileSync(resolvedSchema, "utf8")
            } catch (err) {
              return yield* Effect.fail(new VerifyError({
                taskId: id,
                reason: `Schema file not found or unreadable: ${schemaPath}`,
                cause: err,
              }))
            }
            let schema: Record<string, unknown>
            try {
              schema = JSON.parse(schemaContent)
            } catch (err) {
              return yield* Effect.fail(new VerifyError({
                taskId: id,
                reason: `Schema file is not valid JSON: ${schemaPath}`,
                cause: err,
              }))
            }
            try {
              output = JSON.parse(result.stdout)
              schemaValid = validateJsonSchema(output, schema)
            } catch {
              schemaValid = false
            }
          } else {
            // Try to parse stdout as JSON for structured output
            try {
              output = JSON.parse(result.stdout)
            } catch {
              // Not JSON, that's fine
            }
          }

          const passed = result.exitCode === 0 && (schemaValid === undefined || schemaValid)

          return {
            taskId: id,
            exitCode: result.exitCode,
            passed,
            stdout: result.stdout,
            stderr: result.stderr,
            durationMs: result.durationMs,
            output,
            schemaValid,
          }
        }),

      clear: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          yield* taskRepo.updateVerifyCmd(id, null, null)
        }),
    }
  })
)

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024 // 10 MB cap per stream

function executeCommand(cmd: string, timeoutMs: number, cwd: string): Promise<{
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}> {
  return new Promise((resolvePromise, reject) => {
    const start = Date.now()
    let settled = false

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      fn()
    }

    const child = spawn("sh", ["-c", cmd], {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      cwd,
      env: { ...process.env },
    })

    let stdout = ""
    let stderr = ""
    let killed = false
    let killTimer: ReturnType<typeof setTimeout> | null = null

    child.stdout.on("data", (data: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - stdout.length
        stdout += data.toString().slice(0, remaining)
      }
    })
    child.stderr.on("data", (data: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        const remaining = MAX_OUTPUT_BYTES - stderr.length
        stderr += data.toString().slice(0, remaining)
      }
    })

    const killProcessGroup = () => {
      if (child.pid) {
        try { process.kill(-child.pid, "SIGKILL") } catch { /* already dead */ }
      }
    }

    const timer = setTimeout(() => {
      killed = true
      if (child.pid) {
        try { process.kill(-child.pid, "SIGTERM") } catch { /* already dead */ }
      }
      killTimer = setTimeout(() => {
        killProcessGroup()
        // Hard deadline: if close never fires, settle the Promise anyway
        settle(() => reject(new Error(`Command timed out after ${timeoutMs}ms`)))
      }, 5000)
      // Do NOT call killTimer.unref() — this timer must fire unconditionally
      // to guarantee SIGKILL delivery even when the event loop is otherwise idle
    }, timeoutMs)
    timer.unref()

    const cleanup = () => {
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
    }

    const SIGNAL_NUMBERS: Record<string, number> = {
      SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5,
      SIGABRT: 6, SIGFPE: 8, SIGKILL: 9, SIGSEGV: 11, SIGPIPE: 13,
      SIGALRM: 14, SIGTERM: 15,
    }

    child.on("close", (code, signal) => {
      cleanup()
      const durationMs = Date.now() - start
      if (killed) {
        settle(() => reject(new Error(`Command timed out after ${timeoutMs}ms`)))
        return
      }
      // Derive exit code: numeric code if set, else 128 + signal number, else 1
      const exitCode = code ?? (signal ? 128 + (SIGNAL_NUMBERS[signal] ?? 15) : 1)
      settle(() => resolvePromise({ exitCode, stdout, stderr, durationMs }))
    })

    child.on("error", (err) => {
      cleanup()
      settle(() => reject(err))
    })
  })
}

/**
 * Minimal JSON Schema validation for required fields and types.
 * Only validates top-level required + type checks — not a full JSON Schema validator.
 * Validates: top-level type (object vs array), required fields, property type checks.
 */
function validateJsonSchema(data: unknown, schema: Record<string, unknown>): boolean {
  if (typeof data !== "object" || data === null) return false

  // Validate top-level type if specified
  if (typeof schema.type === "string") {
    if (schema.type === "object" && Array.isArray(data)) return false
    if (schema.type === "array" && !Array.isArray(data)) return false
  }

  const obj = data as Record<string, unknown>

  // Check required fields
  const required = schema.required
  if (Array.isArray(required)) {
    for (const field of required) {
      if (typeof field === "string" && !(field in obj)) {
        return false
      }
    }
  }

  // Check property types
  const properties = schema.properties
  if (properties && typeof properties === "object") {
    const props = properties as Record<string, Record<string, unknown>>
    for (const [key, propSchema] of Object.entries(props)) {
      if (key in obj && propSchema.type) {
        const value = obj[key]
        const expectedType = propSchema.type
        if (expectedType === "number" && typeof value !== "number") return false
        if (expectedType === "string" && typeof value !== "string") return false
        if (expectedType === "boolean" && typeof value !== "boolean") return false
        if (expectedType === "object" && (typeof value !== "object" || value === null || Array.isArray(value))) return false
        if (expectedType === "array" && !Array.isArray(value)) return false
      }
    }
  }

  return true
}
