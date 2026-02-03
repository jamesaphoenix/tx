import { Context, Effect, Layer } from "effect"
import { TaskRepository } from "../repo/task-repo.js"
import { DependencyRepository } from "../repo/dep-repo.js"
import { TaskNotFoundError, DatabaseError } from "../errors.js"
import { HierarchyService } from "./hierarchy-service.js"
import type { Task, TaskId } from "@jamesaphoenix/tx-types"

/**
 * Score breakdown showing each adjustment factor (for CLI display)
 */
export interface ScoreBreakdown {
  readonly baseScore: number
  readonly blockingBonus: number
  readonly blockingCount: number
  readonly ageBonus: number
  readonly ageHours: number
  readonly depthPenalty: number
  readonly depth: number
  readonly blockedPenalty: number
  readonly finalScore: number
}

export class ScoreService extends Context.Tag("ScoreService")<
  ScoreService,
  {
    /**
     * Calculate the final score with dynamic adjustments
     */
    readonly calculate: (task: Task) => Effect.Effect<number, DatabaseError>

    /**
     * Calculate score for a task by ID
     */
    readonly calculateById: (id: TaskId) => Effect.Effect<number, TaskNotFoundError | DatabaseError>

    /**
     * Get detailed score breakdown for display
     */
    readonly getBreakdown: (task: Task) => Effect.Effect<ScoreBreakdown, DatabaseError>

    /**
     * Get score breakdown by task ID
     */
    readonly getBreakdownById: (id: TaskId) => Effect.Effect<ScoreBreakdown, TaskNotFoundError | DatabaseError>
  }
>() {}

export const ScoreServiceLive = Layer.effect(
  ScoreService,
  Effect.gen(function* () {
    const taskRepo = yield* TaskRepository
    const depRepo = yield* DependencyRepository
    const hierarchySvc = yield* HierarchyService

    const computeBreakdown = (
      task: Task,
      blockingCount: number,
      depth: number
    ): ScoreBreakdown => {
      // Base score from DB
      const baseScore = task.score

      // Blocking bonus: +25 per task this task blocks
      const blockingBonus = blockingCount * 25

      // Age bonus: old tasks shouldn't rot
      const ageMs = Date.now() - task.createdAt.getTime()
      const ageHours = ageMs / (1000 * 60 * 60)
      let ageBonus = 0
      if (ageHours > 48) {
        ageBonus = 100
      } else if (ageHours > 24) {
        ageBonus = 50
      }

      // Depth penalty: prefer root tasks over deep subtasks
      const depthPenalty = depth * 10

      // Blocked status penalty: blocked tasks should not be prioritized
      const blockedPenalty = task.status === "blocked" ? 1000 : 0

      // Final calculation
      const finalScore = baseScore + blockingBonus + ageBonus - depthPenalty - blockedPenalty

      return {
        baseScore,
        blockingBonus,
        blockingCount,
        ageBonus,
        ageHours: Math.floor(ageHours),
        depthPenalty,
        depth,
        blockedPenalty,
        finalScore
      }
    }

    const getTaskContext = (task: Task) =>
      Effect.gen(function* () {
        // Get how many tasks this task blocks
        const blockingIds = yield* depRepo.getBlockingIds(task.id)
        const blockingCount = blockingIds.length

        // Get depth in hierarchy
        const depth = yield* hierarchySvc.getDepth(task.id).pipe(
          Effect.catchTag("TaskNotFoundError", () => Effect.succeed(0))
        )

        return { blockingCount, depth }
      })

    return {
      calculate: (task) =>
        Effect.gen(function* () {
          const ctx = yield* getTaskContext(task)
          const breakdown = computeBreakdown(task, ctx.blockingCount, ctx.depth)
          return breakdown.finalScore
        }),

      calculateById: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          const ctx = yield* getTaskContext(task)
          const breakdown = computeBreakdown(task, ctx.blockingCount, ctx.depth)
          return breakdown.finalScore
        }),

      getBreakdown: (task) =>
        Effect.gen(function* () {
          const ctx = yield* getTaskContext(task)
          return computeBreakdown(task, ctx.blockingCount, ctx.depth)
        }),

      getBreakdownById: (id) =>
        Effect.gen(function* () {
          const task = yield* taskRepo.findById(id)
          if (!task) {
            return yield* Effect.fail(new TaskNotFoundError({ id }))
          }
          const ctx = yield* getTaskContext(task)
          return computeBreakdown(task, ctx.blockingCount, ctx.depth)
        })
    }
  })
)
