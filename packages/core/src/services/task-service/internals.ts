import { Context, Effect } from "effect"
import { TaskRepository } from "../../repo/task-repo.js"
import { DependencyRepository } from "../../repo/dep-repo.js"
import { GuardRepository } from "../../repo/guard-repo.js"
import { PinRepository } from "../../repo/pin-repo.js"
import { ClaimRepository } from "../../repo/claim-repo.js"
import { AttemptRepository } from "../../repo/attempt-repo.js"
import { GuardExceededError, DatabaseError, StaleDataError, TaskNotFoundError } from "../../errors.js"
import { readTxConfig } from "../../utils/toml-config.js"
import { isValidTaskId } from "@jamesaphoenix/tx-types"
import type { Task, TaskId, TaskWithDeps, OrchestrationStatus } from "@jamesaphoenix/tx-types"

type EffectiveGuardLimits = {
  readonly maxPending: number | null
  readonly maxChildren: number | null
  readonly maxDepth: number | null
  readonly enforce: boolean
}

type InternalDeps = {
  readonly taskRepo: Context.Tag.Service<typeof TaskRepository>
  readonly depRepo: Context.Tag.Service<typeof DependencyRepository>
  readonly claimRepo?: Context.Tag.Service<typeof ClaimRepository>
  readonly attemptRepo?: Context.Tag.Service<typeof AttemptRepository>
}

/**
 * Max recursion depth for destructive operations that must find ALL descendants.
 * Bounded to avoid unbounded CTE recursion in SQLite while being deep enough
 * for any realistic task hierarchy (display default is 10).
 */
export const CASCADE_MAX_DEPTH = 1000

const GATE_PIN_PREFIX = "gate."

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object"

const parseGateLinkedTaskId = (content: string): TaskId | null => {
  try {
    const parsed = JSON.parse(content)
    if (!isRecord(parsed)) return null
    const taskId = parsed.taskId
    if (typeof taskId !== "string" || !isValidTaskId(taskId)) return null
    return taskId
  } catch {
    return null
  }
}

export const listGateTaskLinks = (
  pinRepo: Context.Tag.Service<typeof PinRepository>
): Effect.Effect<ReadonlyMap<TaskId, readonly string[]>, DatabaseError> =>
  Effect.gen(function* () {
    const pins = yield* pinRepo.findAll()
    const taskLinks = new Map<TaskId, string[]>()

    for (const pin of pins) {
      if (!pin.id.startsWith(GATE_PIN_PREFIX)) continue

      const taskId = parseGateLinkedTaskId(pin.content)
      if (!taskId) continue

      const linkedPins = taskLinks.get(taskId) ?? []
      linkedPins.push(pin.id)
      taskLinks.set(taskId, linkedPins)
    }

    return taskLinks
  })

/**
 * Check guards before task creation. Returns advisory warnings (empty array if none).
 * Advisory mode logs warnings to stderr and returns them for metadata injection;
 * enforce mode fails with GuardExceededError.
 */
export const checkGuards = (
  guardRepo: Context.Tag.Service<typeof GuardRepository>,
  config: ReturnType<typeof readTxConfig>,
  parentId: string | null
): Effect.Effect<string[], GuardExceededError | DatabaseError> =>
  Effect.gen(function* () {
    const warnings: string[] = []

    // Defensive: if config.guard is undefined (malformed config), skip guard checks
    if (!config?.guard) return warnings

    // Resolve effective guard: DB row takes precedence, fall back to config defaults
    const dbGuard = yield* guardRepo.findByScope("global")
    const globalGuard: EffectiveGuardLimits | null = dbGuard
      ? { maxPending: dbGuard.maxPending, maxChildren: dbGuard.maxChildren, maxDepth: dbGuard.maxDepth, enforce: dbGuard.enforce }
      : (config.guard.maxPending !== null || config.guard.maxChildren !== null || config.guard.maxDepth !== null)
        ? { maxPending: config.guard.maxPending, maxChildren: config.guard.maxChildren, maxDepth: config.guard.maxDepth, enforce: config.guard.mode === "enforce" }
        : null
    if (globalGuard) {
      // DB row's enforce setting takes precedence; config only applies when no DB row exists
      const enforce = globalGuard.enforce

      // Check max_pending
      if (globalGuard.maxPending !== null) {
        const pending = yield* guardRepo.countPending()
        if (pending >= globalGuard.maxPending) {
          const msg = `${pending}/${globalGuard.maxPending} pending tasks (global limit)`
          if (enforce) {
            return yield* Effect.fail(new GuardExceededError({
              scope: "global", metric: "max_pending", current: pending, limit: globalGuard.maxPending,
            }))
          }
          console.error(`\u26A0 Guard warning: ${msg}`)
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
              scope: "global", metric: "max_depth", current: newDepth, limit: globalGuard.maxDepth,
            }))
          }
          console.error(`\u26A0 Guard warning: ${msg}`)
          warnings.push(msg)
        }
      }

      // Check max_children (only relevant when creating under a parent)
      if (globalGuard.maxChildren !== null && parentId) {
        const children = yield* guardRepo.countChildrenOf(parentId)
        if (children >= globalGuard.maxChildren) {
          const msg = `${children}/${globalGuard.maxChildren} children of ${parentId} (global limit)`
          if (enforce) {
            return yield* Effect.fail(new GuardExceededError({
              scope: "global", metric: "max_children", current: children, limit: globalGuard.maxChildren,
            }))
          }
          console.error(`\u26A0 Guard warning: ${msg}`)
          warnings.push(msg)
        }
      }
    }

    // Check parent-specific guard (independent of global guard)
    if (parentId) {
      const parentGuard = yield* guardRepo.findByScope(`parent:${parentId}`)
      if (parentGuard?.maxChildren !== null && parentGuard?.maxChildren !== undefined) {
        const children = yield* guardRepo.countChildrenOf(parentId)
        const parentEnforce = parentGuard.enforce
        if (children >= parentGuard.maxChildren) {
          const msg = `${children}/${parentGuard.maxChildren} children of ${parentId} (parent scope)`
          if (parentEnforce) {
            return yield* Effect.fail(new GuardExceededError({
              scope: `parent:${parentId}`, metric: "max_children", current: children, limit: parentGuard.maxChildren,
            }))
          }
          console.error(`\u26A0 Guard warning: ${msg}`)
          warnings.push(msg)
        }
      }
    }

    return warnings
  })

/**
 * Derive orchestration status from claim state.
 * Pure function — no side effects or database access.
 */
export function deriveOrchestrationStatus(
  claim: { status: string; leaseExpiresAt: Date; workerId: string } | null,
  taskStatus: string,
  now: Date
): { orchestrationStatus: OrchestrationStatus | null; claimedBy: string | null; claimExpiresAt: Date | null } {
  // No claim found — "unclaimed" (claims system is available but no claim on this task)
  if (!claim) return { orchestrationStatus: "unclaimed", claimedBy: null, claimExpiresAt: null }
  // Explicitly released
  if (claim.status === "released") return { orchestrationStatus: "released", claimedBy: claim.workerId, claimExpiresAt: claim.leaseExpiresAt }
  // DB-side expired or lease past due
  if (claim.status === "expired" || claim.leaseExpiresAt < now) return { orchestrationStatus: "lease_expired", claimedBy: claim.workerId, claimExpiresAt: claim.leaseExpiresAt }
  // Completed claims → unclaimed (work is done)
  // Note: callers typically pre-filter completed claims (findLatestByTaskId excludes them),
  // so this branch is a safety net rather than the common path.
  if (claim.status === "completed") return { orchestrationStatus: "unclaimed", claimedBy: null, claimExpiresAt: null }
  // Active claim + task is active → running
  if (taskStatus === "active") return { orchestrationStatus: "running", claimedBy: claim.workerId, claimExpiresAt: claim.leaseExpiresAt }
  // Active claim + task not yet active → claimed
  return { orchestrationStatus: "claimed", claimedBy: claim.workerId, claimExpiresAt: claim.leaseExpiresAt }
}

const isWorkableStatus = (status: string): boolean =>
  ["backlog", "ready", "planning", "active"].includes(status)

export const enrichWithDeps = (
  deps: InternalDeps,
  task: Task
): Effect.Effect<TaskWithDeps, DatabaseError> =>
  Effect.gen(function* () {
    const blockerIds = yield* deps.depRepo.getBlockerIds(task.id)
    const blockingIds = yield* deps.depRepo.getBlockingIds(task.id)
    const childIds = yield* deps.taskRepo.getChildIds(task.id)
    const directContextMap = yield* deps.taskRepo.getGroupContextForMany([task.id])
    const effectiveContextMap = yield* deps.taskRepo.resolveEffectiveGroupContextForMany([task.id])

    let isReady = isWorkableStatus(task.status)
    if (isReady && blockerIds.length > 0) {
      const blockers = yield* deps.taskRepo.findByIds(blockerIds)
      isReady = blockers.every(b => b.status === "done")
    }

    const effective = effectiveContextMap.get(task.id)

    // Orchestration status from claims (optional — graceful when not available)
    const now = new Date()
    let orch: { orchestrationStatus: OrchestrationStatus | null; claimedBy: string | null; claimExpiresAt: Date | null } = { orchestrationStatus: null, claimedBy: null, claimExpiresAt: null }
    if (deps.claimRepo) {
      const claim = yield* deps.claimRepo.findLatestByTaskId(task.id)
      orch = deriveOrchestrationStatus(claim, task.status, now)
    }

    // Failed attempts count (optional)
    let failedAttempts = 0
    if (deps.attemptRepo) {
      const counts = yield* deps.attemptRepo.getFailedCountsForTasks([task.id])
      failedAttempts = counts.get(task.id) ?? 0
    }

    return {
      ...task,
      blockedBy: blockerIds as TaskId[],
      blocks: blockingIds as TaskId[],
      children: childIds as TaskId[],
      isReady,
      groupContext: directContextMap.get(task.id) ?? null,
      effectiveGroupContext: effective?.context ?? null,
      effectiveGroupContextSourceTaskId: effective?.sourceTaskId ?? null,
      orchestrationStatus: orch.orchestrationStatus,
      claimedBy: orch.claimedBy,
      claimExpiresAt: orch.claimExpiresAt,
      failedAttempts,
    }
  })

export const enrichWithDepsBatch = (
  deps: InternalDeps,
  tasks: readonly Task[]
): Effect.Effect<readonly TaskWithDeps[], DatabaseError> =>
  Effect.gen(function* () {
    if (tasks.length === 0) return []

    const taskIds = tasks.map(t => t.id)

    // Batch fetch all dependency info (3 queries total instead of 3N)
    const blockerIdsMap = yield* deps.depRepo.getBlockerIdsForMany(taskIds)
    const blockingIdsMap = yield* deps.depRepo.getBlockingIdsForMany(taskIds)
    const childIdsMap = yield* deps.taskRepo.getChildIdsForMany(taskIds)
    const directContextMap = yield* deps.taskRepo.getGroupContextForMany(taskIds)
    const effectiveContextMap = yield* deps.taskRepo.resolveEffectiveGroupContextForMany(taskIds)

    // Collect all unique blocker IDs to fetch their status
    const allBlockerIds = new Set<TaskId>()
    for (const blockerIds of blockerIdsMap.values()) {
      for (const id of blockerIds) {
        allBlockerIds.add(id)
      }
    }

    // Fetch all blocker tasks to check their status (1 query instead of N)
    const blockerTasks = allBlockerIds.size > 0
      ? yield* deps.taskRepo.findByIds([...allBlockerIds])
      : []
    const blockerStatusMap = new Map<string, string>()
    for (const t of blockerTasks) {
      blockerStatusMap.set(t.id, t.status)
    }

    // Batch fetch orchestration data (claims + failed attempts)
    const now = new Date()
    const claimsMap = deps.claimRepo
      ? yield* deps.claimRepo.findLatestByTaskIds(taskIds)
      : new Map<string, { status: string; leaseExpiresAt: Date; workerId: string }>()
    const failedCountsMap = deps.attemptRepo
      ? yield* deps.attemptRepo.getFailedCountsForTasks(taskIds)
      : new Map<string, number>()

    // Build TaskWithDeps for each task
    const results: TaskWithDeps[] = []
    for (const task of tasks) {
      const blockerIds = blockerIdsMap.get(task.id) ?? []
      const blockingIds = blockingIdsMap.get(task.id) ?? []
      const childIds = childIdsMap.get(task.id) ?? []

      // Compute isReady
      let isReady = isWorkableStatus(task.status)
      if (isReady && blockerIds.length > 0) {
        isReady = blockerIds.every(bid => blockerStatusMap.get(bid) === "done")
      }

      const effective = effectiveContextMap.get(task.id)
      const claim = claimsMap.get(task.id) ?? null
      // When claims system is unavailable, return null (not "unclaimed") to match enrichWithDeps behavior
      const orch = deps.claimRepo
        ? deriveOrchestrationStatus(claim, task.status, now)
        : { orchestrationStatus: null as OrchestrationStatus | null, claimedBy: null, claimExpiresAt: null }

      results.push({
        ...task,
        blockedBy: blockerIds as TaskId[],
        blocks: blockingIds as TaskId[],
        children: childIds as TaskId[],
        isReady,
        groupContext: directContextMap.get(task.id) ?? null,
        effectiveGroupContext: effective?.context ?? null,
        effectiveGroupContextSourceTaskId: effective?.sourceTaskId ?? null,
        orchestrationStatus: orch.orchestrationStatus,
        claimedBy: orch.claimedBy,
        claimExpiresAt: orch.claimExpiresAt,
        failedAttempts: failedCountsMap.get(task.id) ?? 0,
      })
    }

    return results
  })

/**
 * Auto-complete parent task when all children are done.
 * Optimized to use batch queries instead of N+1 recursive queries.
 */
export const autoCompleteParent = (
  taskRepo: Context.Tag.Service<typeof TaskRepository>,
  parentId: TaskId,
  now: Date,
  options?: { readonly blockedTaskIds?: ReadonlySet<TaskId> }
): Effect.Effect<void, DatabaseError | TaskNotFoundError | StaleDataError> =>
  Effect.gen(function* () {
    // 1. Get all ancestors in one query (recursive CTE)
    const ancestors = yield* taskRepo.getAncestorChain(parentId)
    if (ancestors.length === 0) return

    // Filter out already-done ancestors (nothing to auto-complete)
    const pendingAncestors = ancestors.filter(a => a.status !== "done")
    if (pendingAncestors.length === 0) return

    // 2. Batch get all children for all pending ancestors (1 query)
    const ancestorIds = pendingAncestors.map(a => a.id)
    const childIdsMap = yield* taskRepo.getChildIdsForMany(ancestorIds)

    // 3. Collect all unique child IDs and batch fetch them (1 query)
    const allChildIds = new Set<string>()
    for (const childIds of childIdsMap.values()) {
      for (const id of childIds) {
        allChildIds.add(id)
      }
    }

    const childTasks = allChildIds.size > 0
      ? yield* taskRepo.findByIds([...allChildIds])
      : []

    // Build status map for quick lookups
    const childStatusMap = new Map<string, string>()
    for (const child of childTasks) {
      childStatusMap.set(child.id, child.status)
    }

    // 4. Process ancestors in order (parent -> grandparent -> ...)
    // Track which ones should be auto-completed
    const toComplete: Task[] = []
    const nowCompletedIds = new Set<string>()
    const blockedTaskIds = options?.blockedTaskIds

    for (const ancestor of pendingAncestors) {
      if (blockedTaskIds?.has(ancestor.id)) {
        break
      }

      const childIds = childIdsMap.get(ancestor.id) ?? []
      if (childIds.length === 0) continue

      // Check if all children are done
      // Include children we're about to mark as done in this pass
      const allChildrenDone = childIds.every(childId => {
        if (nowCompletedIds.has(childId)) return true
        return childStatusMap.get(childId) === "done"
      })

      if (allChildrenDone) {
        // Mark for completion
        toComplete.push({
          ...ancestor,
          status: "done",
          updatedAt: now,
          completedAt: now
        })
        // Track so parent levels can see this ancestor is now done
        nowCompletedIds.add(ancestor.id)
      } else {
        // If this ancestor can't be completed, neither can its ancestors
        break
      }
    }

    // 5. Batch update all auto-completed ancestors (1 transaction)
    if (toComplete.length > 0) {
      yield* taskRepo.updateMany(toComplete)
    }
  })
