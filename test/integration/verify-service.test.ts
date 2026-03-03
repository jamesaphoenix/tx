/**
 * Integration tests for Verify service — machine-checkable done criteria.
 *
 * Tests verify set/show/clear, run with exit codes, schema validation,
 * timeout, and TaskNotFoundError paths.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest"
import { Effect } from "effect"
import { createSharedTestLayer, type SharedTestLayerResult } from "@jamesaphoenix/tx-test-utils"
import {
  TaskService,
  VerifyService,
} from "@jamesaphoenix/tx-core"
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"

describe("Verify service integration", () => {
  let shared: SharedTestLayerResult

  beforeAll(async () => {
    shared = await createSharedTestLayer()
  })

  afterEach(async () => {
    await shared.reset()
  })

  afterAll(async () => {
    await shared.close()
  })

  // ===== Set / Show / Clear =====

  it("set and show a verify command", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "Verifiable task", metadata: {} })
        yield* verifySvc.set(task.id, "echo hello")

        const result = yield* verifySvc.show(task.id)
        expect(result.cmd).toBe("echo hello")
        expect(result.schema).toBeNull()
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("set with schema stores both cmd and schema", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "Schema task", metadata: {} })
        yield* verifySvc.set(task.id, "echo '{}'", "verify-schema.json")

        const result = yield* verifySvc.show(task.id)
        expect(result.cmd).toBe("echo '{}'")
        expect(result.schema).toBe("verify-schema.json")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("clear removes the verify command", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "Clear task", metadata: {} })
        yield* verifySvc.set(task.id, "echo test")
        yield* verifySvc.clear(task.id)

        const result = yield* verifySvc.show(task.id)
        expect(result.cmd).toBeNull()
        expect(result.schema).toBeNull()
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== TaskNotFoundError paths =====

  it("set fails with TaskNotFoundError for nonexistent task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const verifySvc = yield* VerifyService
        return yield* verifySvc.set("tx-nonexist" as any, "echo test").pipe(
          Effect.map(() => "ok" as const),
          Effect.catchTag("TaskNotFoundError", () => Effect.succeed("not_found" as const))
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("not_found")
  })

  it("show fails with TaskNotFoundError for nonexistent task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const verifySvc = yield* VerifyService
        return yield* verifySvc.show("tx-nonexist" as any).pipe(
          Effect.map(() => "ok" as const),
          Effect.catchTag("TaskNotFoundError", () => Effect.succeed("not_found" as const))
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("not_found")
  })

  it("clear fails with TaskNotFoundError for nonexistent task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const verifySvc = yield* VerifyService
        return yield* verifySvc.clear("tx-nonexist" as any).pipe(
          Effect.map(() => "ok" as const),
          Effect.catchTag("TaskNotFoundError", () => Effect.succeed("not_found" as const))
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("not_found")
  })

  it("run fails with TaskNotFoundError for nonexistent task", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const verifySvc = yield* VerifyService
        return yield* verifySvc.run("tx-nonexist" as any).pipe(
          Effect.map(() => "ok" as const),
          Effect.catchTag("TaskNotFoundError", () => Effect.succeed("not_found" as const))
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("not_found")
  })

  // ===== Run: exit code =====

  it("run with passing command returns passed=true, exitCode=0", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "Pass task", metadata: {} })
        yield* verifySvc.set(task.id, "echo PASS")

        const result = yield* verifySvc.run(task.id)
        expect(result.passed).toBe(true)
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe("PASS")
        expect(result.durationMs).toBeGreaterThanOrEqual(0)
        // No schema set → schemaValid must be undefined (not false)
        expect(result.schemaValid).toBeUndefined()
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("run executes multi-word command correctly", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "Multi-word cmd", metadata: {} })
        // Command with multiple words — verifies sh -c receives the full string
        yield* verifySvc.set(task.id, "echo multi word output")
        const result = yield* verifySvc.run(task.id)
        expect(result.passed).toBe(true)
        expect(result.stdout.trim()).toBe("multi word output")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("run with failing command returns passed=false, exitCode=1", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "Fail task", metadata: {} })
        yield* verifySvc.set(task.id, "exit 1")

        const result = yield* verifySvc.run(task.id)
        expect(result.passed).toBe(false)
        expect(result.exitCode).toBe(1)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("run captures stderr output", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "Stderr task", metadata: {} })
        yield* verifySvc.set(task.id, "echo ERROR >&2")

        const result = yield* verifySvc.run(task.id)
        expect(result.stderr.trim()).toBe("ERROR")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Run: no command set =====

  it("run fails with VerifyError when no command is set", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "No cmd", metadata: {} })

        return yield* verifySvc.run(task.id).pipe(
          Effect.map(() => "ok" as const),
          Effect.catchTag("VerifyError", () => Effect.succeed("no_cmd" as const))
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("no_cmd")
  })

  // ===== Run: JSON output parsing =====

  it("run parses JSON stdout as structured output", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "JSON task", metadata: {} })
        yield* verifySvc.set(task.id, `echo '{"tests_passed": 42, "tests_failed": 0}'`)

        const result = yield* verifySvc.run(task.id)
        expect(result.passed).toBe(true)
        expect(result.output).toBeDefined()
        expect(result.output!.tests_passed).toBe(42)
        expect(result.output!.tests_failed).toBe(0)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  it("run with non-JSON stdout does not set output field", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "Non-JSON task", metadata: {} })
        yield* verifySvc.set(task.id, "echo 'plain text output'")

        const result = yield* verifySvc.run(task.id)
        expect(result.passed).toBe(true)
        expect(result.output).toBeUndefined()
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Run: timeout =====

  it("run times out and throws VerifyError", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "Timeout task", metadata: {} })
        yield* verifySvc.set(task.id, "sleep 60")

        return yield* verifySvc.run(task.id, { timeout: 1 }).pipe(
          Effect.map(() => "ok" as const),
          Effect.catchTag("VerifyError", (e) =>
            Effect.succeed(`timeout:${e.reason.includes("timed out")}` as const)
          )
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("timeout:true")
  }, 15000)

  // ===== Run: custom exit codes =====

  it("run returns exact exit code from command", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "Exit 42", metadata: {} })
        yield* verifySvc.set(task.id, "exit 42")

        const result = yield* verifySvc.run(task.id)
        expect(result.passed).toBe(false)
        expect(result.exitCode).toBe(42)
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Lifecycle: set → run → clear → run =====

  it("set → run → clear → run lifecycle: cleared command fails with VerifyError", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "Lifecycle task", metadata: {} })

        // 1. Set a command and run it (should pass)
        yield* verifySvc.set(task.id, "echo PASS")
        const firstRun = yield* verifySvc.run(task.id)
        expect(firstRun.passed).toBe(true)
        expect(firstRun.exitCode).toBe(0)

        // 2. Clear the command
        yield* verifySvc.clear(task.id)
        const cleared = yield* verifySvc.show(task.id)
        expect(cleared.cmd).toBeNull()

        // 3. Run again — should fail with VerifyError (no command set)
        return yield* verifySvc.run(task.id).pipe(
          Effect.map(() => "ok" as const),
          Effect.catchTag("VerifyError", () => Effect.succeed("no_cmd" as const))
        )
      }).pipe(Effect.provide(shared.layer))
    )
    expect(result).toBe("no_cmd")
  })

  // ===== Overwrite verify command =====

  it("set overwrites existing verify command", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const taskSvc = yield* TaskService
        const verifySvc = yield* VerifyService

        const task = yield* taskSvc.create({ title: "Overwrite", metadata: {} })
        yield* verifySvc.set(task.id, "echo first")
        yield* verifySvc.set(task.id, "echo second")

        const result = yield* verifySvc.show(task.id)
        expect(result.cmd).toBe("echo second")
      }).pipe(Effect.provide(shared.layer))
    )
  })

  // ===== Schema Validation =====

  describe("schema validation", () => {
    const schemaDir = join(process.cwd(), ".tx", "test-schemas")

    beforeAll(() => {
      mkdirSync(schemaDir, { recursive: true })
    })

    afterAll(() => {
      rmSync(schemaDir, { recursive: true, force: true })
    })

    it("run with valid schema and matching output returns schemaValid=true, passed=true", async () => {
      const schemaPath = join(schemaDir, "valid.json")
      writeFileSync(schemaPath, JSON.stringify({
        type: "object",
        required: ["tests_passed", "tests_failed"],
        properties: {
          tests_passed: { type: "number" },
          tests_failed: { type: "number" },
        },
      }))

      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Schema match", metadata: {} })
          yield* verifySvc.set(
            task.id,
            `echo '{"tests_passed": 10, "tests_failed": 0}'`,
            ".tx/test-schemas/valid.json"
          )

          const result = yield* verifySvc.run(task.id)
          expect(result.passed).toBe(true)
          expect(result.schemaValid).toBe(true)
          expect(result.output).toBeDefined()
          expect(result.output!.tests_passed).toBe(10)
          expect(result.output!.tests_failed).toBe(0)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("run with schema and missing required fields returns schemaValid=false, passed=false", async () => {
      const schemaPath = join(schemaDir, "required.json")
      writeFileSync(schemaPath, JSON.stringify({
        type: "object",
        required: ["tests_passed", "tests_failed"],
        properties: {
          tests_passed: { type: "number" },
          tests_failed: { type: "number" },
        },
      }))

      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Schema missing field", metadata: {} })
          // Output is missing "tests_failed" required field
          yield* verifySvc.set(
            task.id,
            `echo '{"tests_passed": 10}'`,
            ".tx/test-schemas/required.json"
          )

          const result = yield* verifySvc.run(task.id)
          // Exit code 0 but schema validation fails → passed=false
          expect(result.exitCode).toBe(0)
          expect(result.schemaValid).toBe(false)
          expect(result.passed).toBe(false)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("run with schema and non-JSON stdout returns schemaValid=false, passed=false", async () => {
      const schemaPath = join(schemaDir, "nonjson.json")
      writeFileSync(schemaPath, JSON.stringify({
        type: "object",
        required: ["ok"],
        properties: { ok: { type: "boolean" } },
      }))

      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Schema non-JSON", metadata: {} })
          yield* verifySvc.set(
            task.id,
            "echo 'not json at all'",
            ".tx/test-schemas/nonjson.json"
          )

          const result = yield* verifySvc.run(task.id)
          expect(result.exitCode).toBe(0)
          expect(result.schemaValid).toBe(false)
          expect(result.passed).toBe(false)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("run with non-existent schema file returns VerifyError", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Schema not found", metadata: {} })
          yield* verifySvc.set(
            task.id,
            "echo ok",
            ".tx/test-schemas/nonexistent.json"
          )

          return yield* verifySvc.run(task.id).pipe(
            Effect.map(() => "ok" as const),
            Effect.catchTag("VerifyError", (e) =>
              Effect.succeed(`error:${e.reason.includes("not found")}` as const)
            )
          )
        }).pipe(Effect.provide(shared.layer))
      )
      expect(result).toBe("error:true")
    })

    it("run with invalid JSON in schema file returns VerifyError", async () => {
      const schemaPath = join(schemaDir, "invalid.json")
      writeFileSync(schemaPath, "{ this is not valid json !!!")

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Schema bad JSON", metadata: {} })
          yield* verifySvc.set(
            task.id,
            "echo ok",
            ".tx/test-schemas/invalid.json"
          )

          return yield* verifySvc.run(task.id).pipe(
            Effect.map(() => "ok" as const),
            Effect.catchTag("VerifyError", (e) =>
              Effect.succeed(`error:${e.reason.includes("not valid JSON")}` as const)
            )
          )
        }).pipe(Effect.provide(shared.layer))
      )
      expect(result).toBe("error:true")
    })

    it("run with path traversal in schema rejects with VerifyError", async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Schema traversal", metadata: {} })
          yield* verifySvc.set(
            task.id,
            "echo ok",
            "../../../etc/passwd"
          )

          return yield* verifySvc.run(task.id).pipe(
            Effect.map(() => "ok" as const),
            Effect.catchTag("VerifyError", (e) =>
              Effect.succeed(`error:${e.reason.includes("escapes project root")}` as const)
            )
          )
        }).pipe(Effect.provide(shared.layer))
      )
      expect(result).toBe("error:true")
    })

    it("run with schema and failing exit code: schemaValid is false (not undefined)", async () => {
      const schemaPath = join(schemaDir, "fail-exit.json")
      writeFileSync(schemaPath, JSON.stringify({
        type: "object",
        required: ["ok"],
        properties: { ok: { type: "boolean" } },
      }))

      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Exit fail with schema", metadata: {} })
          yield* verifySvc.set(task.id, "exit 1", ".tx/test-schemas/fail-exit.json")

          const result = yield* verifySvc.run(task.id)
          expect(result.passed).toBe(false)
          expect(result.exitCode).toBe(1)
          // schemaValid should be false (no stdout to validate against schema),
          // not undefined (which would indicate "no schema was set")
          expect(result.schemaValid).toBe(false)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("run with schema type:object rejects JSON array output", async () => {
      const schemaPath = join(schemaDir, "object-only.json")
      writeFileSync(schemaPath, JSON.stringify({
        type: "object",
        required: ["id"],
        properties: { id: { type: "number" } },
      }))

      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Array vs object", metadata: {} })
          // Output is a JSON array but schema expects an object
          yield* verifySvc.set(
            task.id,
            `echo '[{"id": 1}, {"id": 2}]'`,
            ".tx/test-schemas/object-only.json"
          )

          const result = yield* verifySvc.run(task.id)
          expect(result.exitCode).toBe(0)
          expect(result.schemaValid).toBe(false)
          expect(result.passed).toBe(false)
          // The array was parsed as output even though schema validation failed
          expect(Array.isArray(result.output)).toBe(true)
        }).pipe(Effect.provide(shared.layer))
      )
    })

    it("run with schema and wrong property types returns schemaValid=false", async () => {
      const schemaPath = join(schemaDir, "types.json")
      writeFileSync(schemaPath, JSON.stringify({
        type: "object",
        required: ["count"],
        properties: {
          count: { type: "number" },
        },
      }))

      await Effect.runPromise(
        Effect.gen(function* () {
          const taskSvc = yield* TaskService
          const verifySvc = yield* VerifyService

          const task = yield* taskSvc.create({ title: "Schema type mismatch", metadata: {} })
          // count should be number but we provide a string
          yield* verifySvc.set(
            task.id,
            `echo '{"count": "not-a-number"}'`,
            ".tx/test-schemas/types.json"
          )

          const result = yield* verifySvc.run(task.id)
          expect(result.exitCode).toBe(0)
          expect(result.schemaValid).toBe(false)
          expect(result.passed).toBe(false)
        }).pipe(Effect.provide(shared.layer))
      )
    })
  })
})
