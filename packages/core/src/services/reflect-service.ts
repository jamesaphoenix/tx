import { Context, Effect, Layer } from "effect"
import { RunRepository } from "../repo/run-repo.js"
import { TaskRepository } from "../repo/task-repo.js"
import { AttemptRepository } from "../repo/attempt-repo.js"
import { GuardRepository } from "../repo/guard-repo.js"
import { DatabaseError } from "../errors.js"
import { LlmService } from "./llm-service.js"
import type { Run, TaskId } from "@jamesaphoenix/tx-types"

export type ReflectSignal = {
  readonly type: string
  readonly message: string
  readonly severity: "info" | "warning" | "critical"};

export type StuckTask = {
  readonly id: string
  readonly title: string
  readonly failedAttempts: number
  readonly lastError: string | null};

export type ReflectResult = {
  readonly sessions: {
    readonly total: number
    readonly completed: number
    readonly failed: number
    readonly timeout: number
    readonly avgDurationMinutes: number
  }
  readonly throughput: {
    readonly created: number
    readonly completed: number
    readonly net: number
    readonly completionRate: number
  }
  readonly proliferation: {
    readonly avgCreatedPerSession: number
    readonly maxCreatedPerSession: number
    readonly maxDepth: number
    readonly orphanChains: number
  }
  readonly stuckTasks: readonly StuckTask[]
  readonly signals: readonly ReflectSignal[]
  readonly analysis: string | null};

export class ReflectService extends Context.Tag("ReflectService")<
  ReflectService,
  {
    readonly reflect: (options?: {
      sessions?: number
      hours?: number
      analyze?: boolean
    }) => Effect.Effect<ReflectResult, DatabaseError>
  }
>() {}

// =============================================================================
// LLM Analysis
// =============================================================================

const REFLECT_ANALYSIS_PROMPT = `You are an AI agent session analyst. Analyze the following session retrospective data and provide actionable recommendations.

Session Metrics:
{metrics}

Your analysis should:
1. Identify root causes for any problems (stuck tasks, proliferation, low completion rate)
2. Recommend specific tx commands to fix issues (e.g., "tx guard set --max-pending 20 --enforce")
3. Suggest learning additions for recurring mistakes
4. Prioritize recommendations as "immediate", "next_session", or "monitor"

Be concise and actionable. Focus on the top 3-5 most impactful recommendations.`

const REFLECT_ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-3 sentence overview of session health" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          action: { type: "string", description: "Specific tx command or action to take" },
          reason: { type: "string", description: "Why this action is needed" },
          priority: { type: "string", enum: ["immediate", "next_session", "monitor"] },
        },
        required: ["action", "reason", "priority"],
      },
    },
  },
  required: ["summary", "recommendations"],
  additionalProperties: false,
} as const

export const ReflectServiceLive = Layer.effect(
  ReflectService,
  Effect.gen(function* () {
    const runRepo = yield* RunRepository
    const taskRepo = yield* TaskRepository
    const attemptRepo = yield* AttemptRepository
    const guardRepo = yield* GuardRepository
    const llmService = yield* LlmService

    return {
      reflect: (options) =>
        Effect.gen(function* () {
          const sessionLimit = Math.max(1, options?.sessions ?? 10)
          const hoursLimit = options?.hours

          // Get recent runs
          let runs: readonly Run[]
          if (hoursLimit !== undefined) {
            const since = new Date(Date.now() - hoursLimit * 60 * 60 * 1000)
            runs = yield* runRepo.findRecentSince(since, sessionLimit)
          } else {
            runs = yield* runRepo.findRecent(sessionLimit)
          }

          // Compute session stats
          const completed = runs.filter(r => r.status === "completed").length
          const failed = runs.filter(r => r.status === "failed").length
          const timeout = runs.filter(r => r.status === "timeout").length

          const durations = runs
            .filter(r => r.endedAt && r.startedAt)
            .map(r => (r.endedAt!.getTime() - r.startedAt.getTime()) / 60000)
          const avgDurationMinutes = durations.length > 0
            ? durations.reduce((a, b) => a + b, 0) / durations.length
            : 0

          // Compute throughput — tasks created and completed in the time window
          // When hoursLimit is set, use the requested window; otherwise use run span
          const timeWindowStart = hoursLimit !== undefined
            ? new Date(Date.now() - hoursLimit * 60 * 60 * 1000)
            : runs.length > 0
              ? runs.reduce((min, r) => r.startedAt < min ? r.startedAt : min, runs[0].startedAt)
              : new Date()
          const timeWindowEnd = new Date()

          // Cap at 10k tasks to prevent OOM on large projects
          const allTasks = yield* taskRepo.findAll({ limit: 10000 })
          const createdInWindow = allTasks.filter(t => t.createdAt >= timeWindowStart && t.createdAt <= timeWindowEnd)

          const totalCreated = createdInWindow.length
          // Cohort-based: count tasks created in this window that are now done
          // This prevents completionRate > 1.0 (which happened when mixing populations)
          const totalCompleted = createdInWindow.filter(t => t.status === "done").length
          const completionRate = totalCreated > 0 ? totalCompleted / totalCreated : 0

          // Proliferation metrics
          const avgCreatedPerSession = runs.length > 0 ? totalCreated / runs.length : 0
          // Group tasks by approximate session (rough: within run time windows)
          let maxCreatedPerSession = 0
          for (const run of runs) {
            const end = run.endedAt ?? timeWindowEnd
            const created = createdInWindow.filter(
              t => t.createdAt >= run.startedAt && t.createdAt <= end
            ).length
            if (created > maxCreatedPerSession) maxCreatedPerSession = created
          }

          // Max depth: find deepest parent chain — true O(N) with iterative memoization
          let maxDepth = 0
          const taskById = new Map(allTasks.map(t => [t.id, t]))
          const depthCache = new Map<TaskId, number>()
          for (const task of allTasks) {
            if (depthCache.has(task.id)) continue
            // Walk up to find root or cached ancestor
            const chain: TaskId[] = []
            let cur: TaskId | null = task.id
            while (cur && !depthCache.has(cur)) {
              chain.push(cur)
              const t = taskById.get(cur)
              cur = t?.parentId ?? null
            }
            // Base: cached ancestor's depth + 1, or 0 for root
            let depth = cur ? depthCache.get(cur)! + 1 : 0
            // Fill cache from top of chain (nearest to root) down
            for (let i = chain.length - 1; i >= 0; i--) {
              depthCache.set(chain[i], depth)
              depth++
            }
          }
          for (const task of allTasks) {
            const d = depthCache.get(task.id) ?? 0
            if (d > maxDepth) maxDepth = d
          }

          // Orphan chains: root tasks that are done but have pending descendants (full subtree BFS)
          let orphanChains = 0
          const childrenMap = new Map<TaskId, TaskId[]>()
          for (const t of allTasks) {
            if (t.parentId) {
              const siblings = childrenMap.get(t.parentId) ?? []
              siblings.push(t.id)
              childrenMap.set(t.parentId, siblings)
            }
          }
          const hasPendingDescendant = (rootId: TaskId): boolean => {
            const queue: TaskId[] = [rootId]
            const visited = new Set<TaskId>()
            visited.add(rootId)
            while (queue.length > 0) {
              const current = queue.pop()!
              for (const childId of childrenMap.get(current) ?? []) {
                if (visited.has(childId)) continue
                visited.add(childId)
                const child = taskById.get(childId)
                if (!child) continue
                if (child.status !== "done") return true
                // Only enqueue done children that have their own children
                // (done leaves cannot have pending descendants — prune them)
                if (childrenMap.has(childId)) queue.push(childId)
              }
            }
            return false
          }
          // Count topmost done ancestors with pending descendants (not every level).
          // A "chain" is counted once at the highest done node whose own parent is
          // either absent, not done, or not in the dataset — preventing double-counts
          // in multi-level done chains like A(done)→B(done)→C(pending).
          const doneWithChildren = allTasks.filter(t => {
            if (t.status !== "done") return false
            if (!childrenMap.has(t.id)) return false
            // Only count if this done node is not a child of another done node
            if (!t.parentId) return true
            const parent = taskById.get(t.parentId)
            return !parent || parent.status !== "done"
          })
          for (const done of doneWithChildren) {
            if (hasPendingDescendant(done.id)) orphanChains++
          }

          // Stuck tasks: 3+ failed attempts, still not done (batch query, not N+1)
          const stuckTasks: StuckTask[] = []
          const pendingTasks = allTasks.filter(t => t.status !== "done")
          const pendingIds = pendingTasks.map(t => t.id)
          const failedCounts = yield* attemptRepo.getFailedCountsForTasks(pendingIds)

          // Only fetch details for the few tasks with 3+ failures
          for (const task of pendingTasks) {
            const failedCount = failedCounts.get(task.id) ?? 0
            if (failedCount >= 3) {
              const taskAttempts = yield* attemptRepo.findByTaskId(task.id)
              const failedAttempts = taskAttempts.filter(a => a.outcome === "failed")
              // Attempts are sorted DESC (newest first), so [0] is the most recent
              const lastFailed = failedAttempts[0]
              stuckTasks.push({
                id: task.id,
                title: task.title,
                failedAttempts: failedCount,
                lastError: lastFailed?.reason ?? null,
              })
            }
          }

          // Generate signals
          const signals: ReflectSignal[] = []

          // Require minimum 5 tasks created to avoid false positives on small datasets
          if (totalCreated >= 5 && completionRate < 0.4) {
            signals.push({
              type: "HIGH_PROLIFERATION",
              message: `${totalCreated} created / ${totalCompleted} completed (${Math.round(completionRate * 100)}% rate)`,
              severity: completionRate < 0.2 ? "critical" : "warning",
            })
          }

          if (stuckTasks.length > 0) {
            signals.push({
              type: "STUCK_TASKS",
              message: `${stuckTasks.length} task(s) with 3+ failed attempts`,
              severity: stuckTasks.length >= 3 ? "critical" : "warning",
            })
          }

          // Check guard limits
          const globalGuard = yield* guardRepo.findByScope("global")
          if (globalGuard?.maxDepth !== null && globalGuard?.maxDepth !== undefined && maxDepth >= globalGuard.maxDepth) {
            signals.push({
              type: "DEPTH_WARNING",
              message: `max depth ${maxDepth} (guard limit: ${globalGuard.maxDepth})`,
              severity: "warning",
            })
          }

          if (globalGuard?.maxPending !== null && globalGuard?.maxPending !== undefined) {
            const pendingCount = yield* guardRepo.countPending()
            if (pendingCount > globalGuard.maxPending * 0.8) {
              signals.push({
                type: "PENDING_HIGH",
                message: `${pendingCount}/${globalGuard.maxPending} pending tasks`,
                severity: pendingCount >= globalGuard.maxPending ? "critical" : "warning",
              })
            }
          }

          // LLM analysis tier (optional)
          let analysis: string | null = null
          if (options?.analyze) {
            const metricsPayload = JSON.stringify({
              sessions: { total: runs.length, completed, failed, timeout, avgDurationMinutes: Math.round(avgDurationMinutes * 10) / 10 },
              throughput: { created: totalCreated, completed: totalCompleted, net: totalCreated - totalCompleted, completionRate: Math.round(completionRate * 100) / 100 },
              proliferation: { avgCreatedPerSession: Math.round(avgCreatedPerSession * 10) / 10, maxCreatedPerSession, maxDepth, orphanChains },
              stuckTasks,
              signals,
            }, null, 2)

            const llmResult = yield* llmService.complete({
              prompt: REFLECT_ANALYSIS_PROMPT.replace("{metrics}", metricsPayload),
              model: "claude-haiku-4-20250514",
              maxTokens: 2048,
              jsonSchema: REFLECT_ANALYSIS_SCHEMA,
            }).pipe(
              Effect.map((r) => {
                const parsed = JSON.parse(r.text) as { summary: string; recommendations: Array<{ action: string; reason: string; priority: string }> }
                const lines = [parsed.summary]
                if (parsed.recommendations.length > 0) {
                  lines.push("")
                  lines.push("Recommendations:")
                  for (const rec of parsed.recommendations) {
                    lines.push(`  [${rec.priority}] ${rec.action}`)
                    lines.push(`    → ${rec.reason}`)
                  }
                }
                return lines.join("\n")
              }),
              Effect.catchAll(() => Effect.succeed(null as string | null))
            )
            analysis = llmResult
          }

          return {
            sessions: {
              total: runs.length,
              completed,
              failed,
              timeout,
              avgDurationMinutes: Math.round(avgDurationMinutes * 10) / 10,
            },
            throughput: {
              created: totalCreated,
              completed: totalCompleted,
              net: totalCreated - totalCompleted,
              completionRate: Math.round(completionRate * 100) / 100,
            },
            proliferation: {
              avgCreatedPerSession: Math.round(avgCreatedPerSession * 10) / 10,
              maxCreatedPerSession,
              maxDepth,
              orphanChains,
            },
            stuckTasks,
            signals,
            analysis,
          }
        }),
    }
  })
)
