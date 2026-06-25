/**
 * Effect-TS test helpers for running and asserting on Effects.
 *
 * Provides convenient utilities for testing Effect-based code with
 * proper Layer injection support.
 *
 * @module @tx/test-utils/helpers/effect
 */

import { Effect, Exit, Cause, Layer, Either, pipe, Chunk, Option } from "effect"

// =============================================================================
// Types
// =============================================================================

/**
 * Options for running Effects in tests.
 */
export interface RunEffectOptions {
  /** Timeout in milliseconds (default: 5000) */
  timeout?: number
}

/**
 * Result of running an Effect with Either semantics.
 */
export type EffectResult<A, E> = Either.Either<A, E>

// =============================================================================
// Effect Runners
// =============================================================================

/**
 * Run an Effect and return the result.
 * Throws an error if the Effect fails.
 *
 * Supports Layer injection for dependency testing.
 *
 * @example
 * ```typescript
 * // Without layers
 * const result = await runEffect(Effect.succeed(42))
 * expect(result).toBe(42)
 *
 * // With single layer
 * const result = await runEffect(myService.getData(), TestServiceLayer)
 *
 * // With multiple layers (merged)
 * const result = await runEffect(
 *   myService.getData(),
 *   Layer.merge(TestDatabaseLayer, TestConfigLayer)
 * )
 * ```
 */
export const runEffect = async <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer?: Layer.Layer<R, E, never>,
  options: RunEffectOptions = {}
): Promise<A> => {
  const { timeout = 5000 } = options

  const runnable = layer
    ? pipe(effect, Effect.provide(layer))
    : (effect as Effect.Effect<A, E, never>)

  const withTimeout = pipe(
    runnable,
    Effect.timeoutFail({
      duration: timeout,
      onTimeout: () => new Error(`Effect timed out after ${timeout}ms`)
    })
  )

  const exit = await Effect.runPromiseExit(withTimeout)

  if (Exit.isFailure(exit)) {
    const cause = exit.cause
    const prettyError = Cause.pretty(cause)
    throw new Error(`Effect failed:\n${prettyError}`)
  }

  return exit.value
}

/**
 * Run an Effect and expect it to fail.
 * Throws if the Effect succeeds.
 * Returns the failure cause for inspection.
 *
 * @example
 * ```typescript
 * const cause = await runEffectFail(
 *   TaskService.get('nonexistent'),
 *   TestLayer
 * )
 *
 * expect(Cause.isFailType(cause)).toBe(true)
 * ```
 */
export const runEffectFail = async <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer?: Layer.Layer<R, E, never>,
  options: RunEffectOptions = {}
): Promise<Cause.Cause<E>> => {
  const { timeout = 5000 } = options

  const runnable = layer
    ? pipe(effect, Effect.provide(layer))
    : (effect as Effect.Effect<A, E, never>)

  const withTimeout = pipe(
    runnable,
    Effect.timeoutFail({
      duration: timeout,
      onTimeout: () => new Error(`Effect timed out after ${timeout}ms`)
    })
  )

  const exit = await Effect.runPromiseExit(withTimeout)

  if (Exit.isSuccess(exit)) {
    throw new Error(
      `Expected Effect to fail, but it succeeded with: ${JSON.stringify(exit.value)}`
    )
  }

  // Cast to remove the timeout error from the cause type since we handle it above
  return exit.cause as Cause.Cause<E>
}

/**
 * Run an Effect and return an Either (success or failure).
 * Never throws - always returns a result.
 *
 * @example
 * ```typescript
 * const result = await runEffectEither(myEffect, TestLayer)
 *
 * if (Either.isRight(result)) {
 *   console.log('Success:', result.right)
 * } else {
 *   console.log('Failed:', result.left)
 * }
 * ```
 */
export const runEffectEither = async <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer?: Layer.Layer<R, E, never>,
  options: RunEffectOptions = {}
): Promise<Either.Either<A, E>> => {
  const { timeout = 5000 } = options

  const runnable = layer
    ? pipe(effect, Effect.provide(layer))
    : (effect as Effect.Effect<A, E, never>)

  const withTimeout = pipe(
    runnable,
    Effect.timeoutFail({
      duration: timeout,
      onTimeout: () => new Error(`Effect timed out after ${timeout}ms`)
    })
  )

  const exit = await Effect.runPromiseExit(withTimeout)

  if (Exit.isFailure(exit)) {
    // Extract the first failure from the cause
    const failures = Cause.failures(exit.cause)
    const firstFailureOption = Chunk.head(failures)

    if (Option.isSome(firstFailureOption)) {
      return Either.left(firstFailureOption.value as E)
    }

    // If no typed failure, check for defects or interrupts
    const defects = Cause.defects(exit.cause)
    const defectsArray = Chunk.toArray(defects)
    if (defectsArray.length > 0) {
      throw defectsArray[0]
    }

    throw new Error(`Effect failed with unexpected cause: ${Cause.pretty(exit.cause)}`)
  }

  return Either.right(exit.value)
}

// =============================================================================
// Effect Assertions
// =============================================================================

/**
 * Assert that an Effect succeeds and optionally validate the result.
 * Returns the success value for further assertions.
 *
 * @example
 * ```typescript
 * // Basic success assertion
 * const result = await expectEffectSuccess(myEffect, TestLayer)
 *
 * // With value validation
 * const result = await expectEffectSuccess(
 *   myEffect,
 *   TestLayer,
 *   (value) => {
 *     expect(value.id).toBeDefined()
 *   }
 * )
 * ```
 */
export const expectEffectSuccess = async <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer?: Layer.Layer<R, E, never>,
  validate?: (value: A) => void | Promise<void>
): Promise<A> => {
  const result = await runEffect(effect, layer)

  if (validate) {
    await validate(result)
  }

  return result
}

/**
 * Assert that an Effect fails with a specific error type.
 * Returns the error for further assertions.
 *
 * @example
 * ```typescript
 * // Basic failure assertion
 * const error = await expectEffectFailure(
 *   TaskService.get('nonexistent'),
 *   TestLayer
 * )
 *
 * // With error type checking (using _tag for TaggedError)
 * const error = await expectEffectFailure(
 *   TaskService.get('nonexistent'),
 *   TestLayer,
 *   (err) => {
 *     expect(err._tag).toBe('TaskNotFoundError')
 *   }
 * )
 *
 * // Type-safe error extraction
 * const error = await expectEffectFailure<TaskNotFoundError>(
 *   TaskService.get('nonexistent'),
 *   TestLayer,
 *   (err) => {
 *     expect(err.id).toBe('nonexistent')
 *   }
 * )
 * ```
 */
export const expectEffectFailure = async <E, A = unknown, R = never>(
  effect: Effect.Effect<A, E, R>,
  layer?: Layer.Layer<R, E, never>,
  validate?: (error: E) => void | Promise<void>
): Promise<E> => {
  const cause = await runEffectFail(effect, layer)

  // Extract the first typed failure
  const failures = Cause.failures(cause)
  const firstFailureOption = Chunk.head(failures)

  if (Option.isNone(firstFailureOption)) {
    throw new Error(
      `Expected a typed failure but got: ${Cause.pretty(cause)}`
    )
  }

  const firstFailure = firstFailureOption.value as E

  if (validate) {
    await validate(firstFailure)
  }

  return firstFailure
}

// =============================================================================
// Layer Utilities
// =============================================================================

/**
 * Merge multiple layers into a single layer.
 * Convenience wrapper around Layer.mergeAll for test setup.
 *
 * @example
 * ```typescript
 * const testLayer = mergeLayers(
 *   TestDatabaseLayer,
 *   MockServiceLayer,
 *   TestConfigLayer
 * )
 *
 * const result = await runEffect(myEffect, testLayer)
 * ```
 */
export const mergeLayers = <
  Layers extends readonly Layer.Layer<any, any, any>[]
>(
  ...layers: Layers
): Layer.Layer<
  Layer.Layer.Success<Layers[number]>,
  Layer.Layer.Error<Layers[number]>,
  Layer.Layer.Context<Layers[number]>
> => {
  if (layers.length === 0) {
    return Layer.empty as unknown as Layer.Layer<
      Layer.Layer.Success<Layers[number]>,
      Layer.Layer.Error<Layers[number]>,
      Layer.Layer.Context<Layers[number]>
    >
  }
  if (layers.length === 1) {
    return layers[0] as Layer.Layer<
      Layer.Layer.Success<Layers[number]>,
      Layer.Layer.Error<Layers[number]>,
      Layer.Layer.Context<Layers[number]>
    >
  }
  // Use explicit type to handle the reduce properly
  let result: Layer.Layer<any, any, any> = layers[0]
  for (let i = 1; i < layers.length; i++) {
    result = Layer.merge(result, layers[i])
  }
  return result as Layer.Layer<
    Layer.Layer.Success<Layers[number]>,
    Layer.Layer.Error<Layers[number]>,
    Layer.Layer.Context<Layers[number]>
  >
}

/**
 * Create a test context that automatically cleans up after each test.
 * Useful for setting up database and services that need cleanup.
 *
 * @example
 * ```typescript
 * import { createTestContext } from '@tx/test-utils'
 *
 * describe('MyService', () => {
 *   const ctx = createTestContext(() =>
 *     mergeLayers(TestDatabaseLayer, MockServiceLayer)
 *   )
 *
 *   it('should do something', async () => {
 *     const result = await ctx.runEffect(myService.getData())
 *     expect(result).toBeDefined()
 *   })
 * })
 * ```
 */
export const createTestContext = <R, E>(
  createLayer: () => Layer.Layer<R, E, never>
) => {
  let currentLayer: Layer.Layer<R, E, never> | null = null

  return {
    /**
     * Get the current layer, creating it if needed.
     */
    getLayer: (): Layer.Layer<R, E, never> => {
      if (!currentLayer) {
        currentLayer = createLayer()
      }
      return currentLayer
    },

    /**
     * Run an Effect with the test layer.
     */
    runEffect: <A, EE extends E>(
      effect: Effect.Effect<A, EE, R>,
      options?: RunEffectOptions
    ): Promise<A> => {
      if (!currentLayer) {
        currentLayer = createLayer()
      }
      return runEffect(effect, currentLayer as Layer.Layer<R, EE, never>, options)
    },

    /**
     * Run an Effect and expect failure.
     */
    runEffectFail: <A, EE extends E>(
      effect: Effect.Effect<A, EE, R>,
      options?: RunEffectOptions
    ): Promise<Cause.Cause<EE>> => {
      if (!currentLayer) {
        currentLayer = createLayer()
      }
      return runEffectFail(effect, currentLayer as Layer.Layer<R, EE, never>, options)
    },

    /**
     * Run an Effect and return Either.
     */
    runEffectEither: <A, EE extends E>(
      effect: Effect.Effect<A, EE, R>,
      options?: RunEffectOptions
    ): Promise<Either.Either<A, EE>> => {
      if (!currentLayer) {
        currentLayer = createLayer()
      }
      return runEffectEither(effect, currentLayer as Layer.Layer<R, EE, never>, options)
    },

    /**
     * Reset the layer (forces recreation on next use).
     */
    reset: (): void => {
      currentLayer = null
    }
  }
}
