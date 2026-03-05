import { Context, Effect, Layer } from "effect"
import { GuardRepository, type Guard } from "../repo/guard-repo.js"
import { DatabaseError, GuardExceededError } from "../errors.js"
import { readTxConfig } from "../utils/toml-config.js"

export type GuardCheckResult = {
  readonly passed: boolean
  readonly warnings: readonly string[]};

export class GuardService extends Context.Tag("GuardService")<
  GuardService,
  {
    readonly set: (options: {
      scope?: string
      maxPending?: number
      maxChildren?: number
      maxDepth?: number
      enforce?: boolean
    }) => Effect.Effect<Guard, DatabaseError>
    readonly show: () => Effect.Effect<readonly Guard[], DatabaseError>
    readonly clear: (scope?: string) => Effect.Effect<boolean, DatabaseError>
    readonly check: (parentId?: string | null) => Effect.Effect<
      GuardCheckResult,
      DatabaseError | GuardExceededError
    >
  }
>() {}

export const GuardServiceLive = Layer.effect(
  GuardService,
  Effect.gen(function* () {
    const guardRepo = yield* GuardRepository
    const config = readTxConfig()

    return {
      set: (options) =>
        Effect.gen(function* () {
          const scope = options.scope ?? "global"
          // Preserve existing enforce mode when not explicitly specified
          let enforce: boolean
          if (options.enforce !== undefined) {
            enforce = options.enforce
          } else {
            const existing = yield* guardRepo.findByScope(scope)
            enforce = existing ? existing.enforce : (config?.guard?.mode === "enforce")
          }
          return yield* guardRepo.upsert(scope, {
            maxPending: options.maxPending,
            maxChildren: options.maxChildren,
            maxDepth: options.maxDepth,
            enforce,
          })
        }),

      show: () => guardRepo.findAll(),

      clear: (scope) =>
        Effect.gen(function* () {
          if (scope) {
            return yield* guardRepo.remove(scope)
          }
          // Clear all guards
          const guards = yield* guardRepo.findAll()
          for (const g of guards) {
            yield* guardRepo.remove(g.scope)
          }
          return guards.length > 0
        }),

      check: (parentId) =>
        Effect.gen(function* () {
          const warnings: string[] = []
          const configEnforce = config?.guard?.mode === "enforce"

          // Resolve effective guard: DB row takes precedence, fall back to config defaults
          const dbGuard = yield* guardRepo.findByScope("global")
          // Early exit if no DB guard and no config guard section
          if (!config?.guard && !dbGuard) return { passed: true, warnings: [] as string[] }
          const globalGuard: { maxPending: number | null; maxChildren: number | null; maxDepth: number | null; enforce: boolean } | null = dbGuard
            ? { maxPending: dbGuard.maxPending, maxChildren: dbGuard.maxChildren, maxDepth: dbGuard.maxDepth, enforce: dbGuard.enforce }
            : (config.guard.maxPending !== null || config.guard.maxChildren !== null || config.guard.maxDepth !== null)
              ? { maxPending: config.guard.maxPending, maxChildren: config.guard.maxChildren, maxDepth: config.guard.maxDepth, enforce: configEnforce }
              : null
          if (globalGuard) {
            // DB row's enforce setting takes precedence; config only applies when no DB row exists
            const enforce = globalGuard.enforce

            // Check max_pending
            if (globalGuard.maxPending !== null) {
              const pendingCount = yield* guardRepo.countPending()
              if (pendingCount >= globalGuard.maxPending) {
                const msg = `${pendingCount}/${globalGuard.maxPending} pending tasks (global limit)`
                if (enforce) {
                  return yield* Effect.fail(new GuardExceededError({
                    scope: "global",
                    metric: "max_pending",
                    current: pendingCount,
                    limit: globalGuard.maxPending,
                  }))
                }
                warnings.push(msg)
              }
            }

            // Check max_depth (only relevant when creating under a parent)
            if (globalGuard.maxDepth !== null && parentId) {
              const depth = yield* guardRepo.getMaxDepth(parentId)
              const newDepth = depth + 1
              if (newDepth > globalGuard.maxDepth) {
                const msg = `depth ${newDepth}/${globalGuard.maxDepth} (global limit)`
                if (enforce) {
                  return yield* Effect.fail(new GuardExceededError({
                    scope: "global",
                    metric: "max_depth",
                    current: newDepth,
                    limit: globalGuard.maxDepth,
                  }))
                }
                warnings.push(msg)
              }
            }

            // Check max_children (only relevant when creating under a parent)
            if (globalGuard.maxChildren !== null && parentId) {
              const childCount = yield* guardRepo.countChildrenOf(parentId)
              if (childCount >= globalGuard.maxChildren) {
                const msg = `${childCount}/${globalGuard.maxChildren} children of ${parentId} (global limit)`
                if (enforce) {
                  return yield* Effect.fail(new GuardExceededError({
                    scope: "global",
                    metric: "max_children",
                    current: childCount,
                    limit: globalGuard.maxChildren,
                  }))
                }
                warnings.push(msg)
              }
            }
          }

          // Check parent-specific guard
          if (parentId) {
            const parentGuard = yield* guardRepo.findByScope(`parent:${parentId}`)
            if (parentGuard) {
              if (parentGuard.maxChildren !== null) {
                const childCount = yield* guardRepo.countChildrenOf(parentId)
                if (childCount >= parentGuard.maxChildren) {
                  const msg = `${childCount}/${parentGuard.maxChildren} children of ${parentId} (parent scope)`
                  if (parentGuard.enforce) {
                    return yield* Effect.fail(new GuardExceededError({
                      scope: `parent:${parentId}`,
                      metric: "max_children",
                      current: childCount,
                      limit: parentGuard.maxChildren,
                    }))
                  }
                  warnings.push(msg)
                }
              }
            }
          }

          return { passed: warnings.length === 0, warnings }
        }),
    }
  })
)
