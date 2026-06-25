/**
 * Effect test helpers unit tests.
 *
 * Tests the Effect runners and assertions for correct behavior.
 */

import { describe, it, expect } from "vitest"
import { Effect, Layer, Context, Data } from "effect"
import {
  runEffect,
  runEffectFail,
  runEffectEither,
  expectEffectSuccess,
  expectEffectFailure,
  mergeLayers,
  createTestContext
} from "./effect.js"
import { Either } from "effect"

// =============================================================================
// Test Error Types
// =============================================================================

class TestError extends Data.TaggedError("TestError")<{
  readonly message: string
}> {}

// =============================================================================
// Test Service
// =============================================================================

interface TestService {
  readonly getValue: () => Effect.Effect<number>
  readonly getValueOrFail: (shouldFail: boolean) => Effect.Effect<number, TestError>
}

class TestServiceTag extends Context.Tag("TestService")<
  TestServiceTag,
  TestService
>() {}

const TestServiceLive = Layer.succeed(
  TestServiceTag,
  {
    getValue: () => Effect.succeed(42),
    getValueOrFail: (shouldFail) =>
      shouldFail
        ? Effect.fail(new TestError({ message: "Test failure" }))
        : Effect.succeed(42)
  }
)

// =============================================================================
// runEffect Tests
// =============================================================================

describe("runEffect", () => {
  it("returns the value for a successful Effect", async () => {
    const result = await runEffect(Effect.succeed(42))
    expect(result).toBe(42)
  })

  it("works with complex values", async () => {
    const obj = { name: "test", value: 123 }
    const result = await runEffect(Effect.succeed(obj))
    expect(result).toEqual(obj)
  })

  it("throws an error for a failed Effect", async () => {
    const effect = Effect.fail(new TestError({ message: "oops" }))

    await expect(runEffect(effect)).rejects.toThrow("Effect failed:")
  })

  it("supports Layer injection", async () => {
    const effect = Effect.gen(function* () {
      const service = yield* TestServiceTag
      return yield* service.getValue()
    })

    const result = await runEffect(effect, TestServiceLive)
    expect(result).toBe(42)
  })

  it("throws when Effect times out", async () => {
    const slowEffect = Effect.gen(function* () {
      yield* Effect.sleep(1000)
      return 42
    })

    await expect(
      runEffect(slowEffect, undefined, { timeout: 50 })
    ).rejects.toThrow("Effect failed:")
  })
})

// =============================================================================
// runEffectFail Tests
// =============================================================================

describe("runEffectFail", () => {
  it("returns the cause for a failed Effect", async () => {
    const effect = Effect.fail(new TestError({ message: "expected failure" }))

    const cause = await runEffectFail(effect)
    expect(cause).toBeDefined()
  })

  it("throws when Effect succeeds unexpectedly", async () => {
    const effect = Effect.succeed(42)

    await expect(runEffectFail(effect)).rejects.toThrow(
      "Expected Effect to fail, but it succeeded"
    )
  })

  it("supports Layer injection for failure cases", async () => {
    const effect = Effect.gen(function* () {
      const service = yield* TestServiceTag
      return yield* service.getValueOrFail(true)
    })

    const cause = await runEffectFail(effect, TestServiceLive)
    expect(cause).toBeDefined()
  })
})

// =============================================================================
// runEffectEither Tests
// =============================================================================

describe("runEffectEither", () => {
  it("returns Right for successful Effect", async () => {
    const result = await runEffectEither(Effect.succeed(42))

    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right).toBe(42)
    }
  })

  it("returns Left for failed Effect", async () => {
    const effect = Effect.fail(new TestError({ message: "expected" }))
    const result = await runEffectEither(effect)

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("TestError")
    }
  })

  it("never throws for typed failures", async () => {
    const effect = Effect.fail(new TestError({ message: "test" }))

    // Should not throw
    const result = await runEffectEither(effect)
    expect(Either.isLeft(result)).toBe(true)
  })

  it("supports Layer injection", async () => {
    const effect = Effect.gen(function* () {
      const service = yield* TestServiceTag
      return yield* service.getValue()
    })

    const result = await runEffectEither(effect, TestServiceLive)
    expect(Either.isRight(result)).toBe(true)
    if (Either.isRight(result)) {
      expect(result.right).toBe(42)
    }
  })
})

// =============================================================================
// expectEffectSuccess Tests
// =============================================================================

describe("expectEffectSuccess", () => {
  it("returns the value for successful Effect", async () => {
    const result = await expectEffectSuccess(Effect.succeed(42))
    expect(result).toBe(42)
  })

  it("supports validation callback", async () => {
    let validated = false
    const result = await expectEffectSuccess(
      Effect.succeed({ id: 1, name: "test" }),
      undefined,
      (value) => {
        expect(value.id).toBe(1)
        expect(value.name).toBe("test")
        validated = true
      }
    )

    expect(result.id).toBe(1)
    expect(validated).toBe(true)
  })

  it("throws when Effect fails", async () => {
    const effect = Effect.fail(new TestError({ message: "fail" }))

    await expect(expectEffectSuccess(effect)).rejects.toThrow("Effect failed:")
  })

  it("supports async validation", async () => {
    let validated = false
    await expectEffectSuccess(
      Effect.succeed(42),
      undefined,
      async (value) => {
        await Promise.resolve()
        expect(value).toBe(42)
        validated = true
      }
    )

    expect(validated).toBe(true)
  })
})

// =============================================================================
// expectEffectFailure Tests
// =============================================================================

describe("expectEffectFailure", () => {
  it("returns the error for failed Effect", async () => {
    const effect = Effect.fail(new TestError({ message: "expected" }))

    const error = await expectEffectFailure<TestError>(effect)
    expect(error._tag).toBe("TestError")
    expect(error.message).toBe("expected")
  })

  it("supports validation callback", async () => {
    const effect = Effect.fail(new TestError({ message: "check me" }))

    const error = await expectEffectFailure<TestError>(
      effect,
      undefined,
      (err) => {
        expect(err._tag).toBe("TestError")
        expect(err.message).toBe("check me")
      }
    )

    expect(error.message).toBe("check me")
  })

  it("throws when Effect succeeds", async () => {
    const effect = Effect.succeed(42)

    await expect(expectEffectFailure(effect)).rejects.toThrow(
      "Expected Effect to fail, but it succeeded"
    )
  })

  it("supports Layer injection", async () => {
    const effect = Effect.gen(function* () {
      const service = yield* TestServiceTag
      return yield* service.getValueOrFail(true)
    })

    const error = await expectEffectFailure<TestError>(
      effect as any,
      TestServiceLive as any,
      (err) => {
        expect(err._tag).toBe("TestError")
      }
    )

    expect(error._tag).toBe("TestError")
  })
})

// =============================================================================
// mergeLayers Tests
// =============================================================================

describe("mergeLayers", () => {
  interface ServiceA {
    readonly a: number
  }
  interface ServiceB {
    readonly b: string
  }

  class ServiceATag extends Context.Tag("ServiceA")<ServiceATag, ServiceA>() {}
  class ServiceBTag extends Context.Tag("ServiceB")<ServiceBTag, ServiceB>() {}

  const ServiceALive = Layer.succeed(ServiceATag, { a: 1 })
  const ServiceBLive = Layer.succeed(ServiceBTag, { b: "hello" })

  it("returns empty layer when no layers provided", () => {
    const merged = mergeLayers()
    expect(merged).toBeDefined()
  })

  it("returns the layer when single layer provided", () => {
    const merged = mergeLayers(ServiceALive)
    expect(merged).toBeDefined()
  })

  it("merges multiple layers", async () => {
    const merged = mergeLayers(ServiceALive, ServiceBLive)

    const effect = Effect.gen(function* () {
      const a = yield* ServiceATag
      const b = yield* ServiceBTag
      return { a: a.a, b: b.b }
    })

    const result = await runEffect(effect, merged as any)
    expect(result).toEqual({ a: 1, b: "hello" })
  })
})

// =============================================================================
// createTestContext Tests
// =============================================================================

describe("createTestContext", () => {
  it("creates a context with runEffect method", async () => {
    const ctx = createTestContext(() => TestServiceLive)

    const effect = Effect.gen(function* () {
      const service = yield* TestServiceTag
      return yield* service.getValue()
    })

    const result = await ctx.runEffect(effect)
    expect(result).toBe(42)
  })

  it("reuses the layer across multiple calls", async () => {
    let layerCreationCount = 0

    const ctx = createTestContext(() => {
      layerCreationCount++
      return TestServiceLive
    })

    const effect = Effect.gen(function* () {
      const service = yield* TestServiceTag
      return yield* service.getValue()
    })

    await ctx.runEffect(effect)
    await ctx.runEffect(effect)
    await ctx.runEffect(effect)

    expect(layerCreationCount).toBe(1)
  })

  it("supports runEffectFail", async () => {
    const ctx = createTestContext(() => TestServiceLive as any)

    const effect = Effect.gen(function* () {
      const service = yield* TestServiceTag
      return yield* service.getValueOrFail(true)
    })

    const cause = await ctx.runEffectFail(effect as any)
    expect(cause).toBeDefined()
  })

  it("supports runEffectEither", async () => {
    const ctx = createTestContext(() => TestServiceLive)

    const effect = Effect.gen(function* () {
      const service = yield* TestServiceTag
      return yield* service.getValue()
    })

    const result = await ctx.runEffectEither(effect)
    expect(Either.isRight(result)).toBe(true)
  })

  it("reset forces layer recreation", async () => {
    let layerCreationCount = 0

    const ctx = createTestContext(() => {
      layerCreationCount++
      return TestServiceLive
    })

    const effect = Effect.gen(function* () {
      const service = yield* TestServiceTag
      return yield* service.getValue()
    })

    await ctx.runEffect(effect)
    ctx.reset()
    await ctx.runEffect(effect)

    expect(layerCreationCount).toBe(2)
  })
})
