/**
 * createTx - Factory function to create a configured tx client
 *
 * This module provides the main entry point for SDK consumers who want
 * to customize tx behavior, such as providing a custom retriever.
 *
 * @example Basic usage
 * ```typescript
 * import { createTx } from "@jamesaphoenix/tx";
 *
 * const tx = createTx();
 * const ready = await tx.run(tasks.getReady({ limit: 5 }));
 * ```
 *
 * @example Custom retriever
 * ```typescript
 * import { createTx, RetrieverService } from "@jamesaphoenix/tx";
 * import { Effect, Layer } from "effect";
 *
 * const myRetriever = Layer.succeed(RetrieverService, {
 *   search: (query, options) => Effect.gen(function* () {
 *     return yield* pineconeQuery(query);
 *   }),
 *   isAvailable: () => Effect.succeed(true)
 * });
 *
 * const tx = createTx({ retriever: myRetriever });
 * ```
 */

import { Effect, Exit, Layer, ManagedRuntime } from "effect"
import {
  makeAppLayer,
  RetrieverService
} from "@tx/core"

/**
 * Options for configuring createTx().
 *
 * All options are optional - defaults provide a fully functional tx instance.
 */
export interface CreateTxOptions {
  /**
   * Path to SQLite database file.
   * @default ".tx/tasks.db"
   */
  readonly dbPath?: string

  /**
   * Custom retriever layer to use instead of the default BM25+vector hybrid.
   *
   * When provided, this layer replaces RetrieverServiceLive entirely.
   * The layer must satisfy the RetrieverService interface.
   *
   * @example Pinecone retriever
   * ```typescript
   * const myRetriever = Layer.succeed(RetrieverService, {
   *   search: (query, options) => Effect.gen(function* () {
   *     const results = yield* pineconeQuery(query);
   *     return results.map(toLearningWithScore);
   *   }),
   *   isAvailable: () => Effect.succeed(true)
   * });
   *
   * const tx = createTx({ retriever: myRetriever });
   * ```
   */
  readonly retriever?: Layer.Layer<RetrieverService>
}

/**
 * The tx client returned by createTx().
 *
 * Provides methods to run Effects against the configured layer
 * and access commonly-used services directly.
 */
export interface TxClient {
  /**
   * Run an Effect against the configured tx layer.
   *
   * @example
   * ```typescript
   * const ready = await tx.run(
   *   Effect.gen(function* () {
   *     const tasks = yield* TaskService;
   *     return yield* tasks.getReady({ limit: 5 });
   *   })
   * );
   * ```
   */
  readonly run: <A, E>(effect: Effect.Effect<A, E, never>) => Promise<A>

  /**
   * Run an Effect and return an Exit (success or failure).
   * Useful when you need to handle errors programmatically.
   */
  readonly runExit: <A, E>(effect: Effect.Effect<A, E, never>) => Promise<Exit.Exit<A, unknown>>

  /**
   * The composed Layer for advanced use cases.
   * Can be used with Effect.provide() directly.
   */
  readonly layer: Layer.Layer<any, any, any>

  /**
   * Clean up resources (close database, etc.).
   * Call this when done using the client.
   */
  readonly close: () => Promise<void>
}

/**
 * Create a tx client with optional configuration.
 *
 * This is the main entry point for SDK consumers who want to:
 * - Use a custom database path
 * - Provide a custom retriever (Pinecone, Weaviate, etc.)
 *
 * @param options - Configuration options (all optional)
 * @returns A TxClient for running Effects against the configured layer
 *
 * @example Basic usage (defaults)
 * ```typescript
 * const tx = createTx();
 *
 * const ready = await tx.run(
 *   Effect.gen(function* () {
 *     const tasks = yield* TaskService;
 *     return yield* tasks.getReady({ limit: 5 });
 *   })
 * );
 *
 * await tx.close();
 * ```
 *
 * @example Custom retriever
 * ```typescript
 * import { createTx, RetrieverService } from "@jamesaphoenix/tx";
 * import { Effect, Layer } from "effect";
 *
 * const pineconeRetriever = Layer.succeed(RetrieverService, {
 *   search: (query, options) => Effect.gen(function* () {
 *     // Your Pinecone/Weaviate/Chroma implementation
 *     const results = yield* queryExternalVectorDB(query, options);
 *     return results;
 *   }),
 *   isAvailable: () => Effect.succeed(true)
 * });
 *
 * const tx = createTx({
 *   dbPath: "./my-app/.tx/tasks.db",
 *   retriever: pineconeRetriever
 * });
 * ```
 */
export const createTx = (options: CreateTxOptions = {}): TxClient => {
  const {
    dbPath = ".tx/tasks.db",
    retriever
  } = options

  // Build the base app layer
  const baseLayer = makeAppLayer(dbPath)

  // If custom retriever provided, merge it on top to override the default
  // Layer.provideMerge gives priority to the first layer for overlapping services
  const appLayer = retriever
    ? Layer.provideMerge(retriever, baseLayer)
    : baseLayer

  // Create a managed runtime that handles resource lifecycle
  const managedRuntime = ManagedRuntime.make(appLayer)

  return {
    run: async <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> => {
      return managedRuntime.runPromise(effect)
    },

    runExit: async <A, E>(effect: Effect.Effect<A, E, never>): Promise<Exit.Exit<A, unknown>> => {
      return managedRuntime.runPromiseExit(effect)
    },

    layer: appLayer,

    close: async (): Promise<void> => {
      await managedRuntime.dispose()
    }
  }
}

// Re-export RetrieverService for custom retriever implementations
export { RetrieverService } from "@tx/core"
