/**
 * Stats command: Queue metrics and health overview
 */

import { Effect } from "effect"
import { SqliteClient } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { type Flags, flag } from "../utils/parse.js"

interface QueueStats {
  readonly total: number
  readonly byStatus: Record<string, number>
  readonly readyCount: number
  readonly byPriority: {
    readonly critical: number
    readonly high: number
    readonly medium: number
    readonly low: number
  }
  readonly activity: {
    readonly last24h: number
    readonly last7d: number
    readonly avgPerDay: number | null
  }
  readonly claims: {
    readonly active: number
    readonly expired: number
  }
}

export const stats = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const db = yield* SqliteClient

    // 1. Status counts via GROUP BY (single query)
    const statusRows = db.prepare<{ status: string; count: number }>(
      "SELECT status, COUNT(*) as count FROM tasks GROUP BY status"
    ).all()

    const byStatus: Record<string, number> = {}
    let total = 0
    for (const row of statusRows) {
      byStatus[row.status] = row.count
      total += row.count
    }

    // 2+3. Ready count + priority breakdown via SQL aggregation (single query)
    // A task is "ready" when status is workable AND all blockers are done
    const priorityRows = db.prepare<{ bucket: string; count: number }>(`
      SELECT
        CASE
          WHEN t.score >= 900 THEN 'critical'
          WHEN t.score >= 700 THEN 'high'
          WHEN t.score >= 500 THEN 'medium'
          ELSE 'low'
        END as bucket,
        COUNT(*) as count
      FROM tasks t
      WHERE t.status IN ('backlog', 'ready', 'planning')
        AND NOT EXISTS (
          SELECT 1 FROM task_dependencies d
          JOIN tasks blocker ON blocker.id = d.blocker_id
          WHERE d.blocked_id = t.id
            AND blocker.status != 'done'
        )
      GROUP BY bucket
    `).all()

    let readyCount = 0
    let critical = 0
    let high = 0
    let medium = 0
    let low = 0
    for (const row of priorityRows) {
      readyCount += row.count
      if (row.bucket === "critical") critical = row.count
      else if (row.bucket === "high") high = row.count
      else if (row.bucket === "medium") medium = row.count
      else low = row.count
    }

    // 4. Activity: completed tasks in time windows
    const last24hRow = db.prepare<{ count: number }>(
      "SELECT COUNT(*) as count FROM tasks WHERE status = 'done' AND completed_at > datetime('now', '-1 day')"
    ).get()
    const last7dRow = db.prepare<{ count: number }>(
      "SELECT COUNT(*) as count FROM tasks WHERE status = 'done' AND completed_at > datetime('now', '-7 days')"
    ).get()
    const last24h = last24hRow?.count ?? 0
    const last7d = last7dRow?.count ?? 0

    // Avg completion rate: tasks per day over the full history
    const dateRangeRow = db.prepare<{ earliest: string | null; total_done: number }>(
      "SELECT MIN(completed_at) as earliest, COUNT(*) as total_done FROM tasks WHERE status = 'done' AND completed_at IS NOT NULL"
    ).get()

    let avgPerDay: number | null = null
    if (dateRangeRow?.earliest && dateRangeRow.total_done > 0) {
      const earliest = new Date(dateRangeRow.earliest)
      const now = new Date()
      const daysDiff = (now.getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24)
      if (daysDiff >= 1) {
        avgPerDay = Math.round((dateRangeRow.total_done / daysDiff) * 10) / 10
      }
    }

    // 5. Claim stats
    const activeClaimsRow = db.prepare<{ count: number }>(
      "SELECT COUNT(*) as count FROM task_claims WHERE status = 'active' AND datetime(lease_expires_at) >= datetime('now')"
    ).get()
    const expiredClaimsRow = db.prepare<{ count: number }>(
      "SELECT COUNT(*) as count FROM task_claims WHERE status = 'active' AND datetime(lease_expires_at) < datetime('now')"
    ).get()

    const result: QueueStats = {
      total,
      byStatus,
      readyCount,
      byPriority: { critical, high, medium, low },
      activity: { last24h, last7d, avgPerDay },
      claims: {
        active: activeClaimsRow?.count ?? 0,
        expired: expiredClaimsRow?.count ?? 0,
      },
    }

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(formatStats(result))
    }
  })

function pct(n: number, total: number): string {
  if (total === 0) return "0%"
  return `${Math.round((n / total) * 100)}%`
}

function formatStats(s: QueueStats): string {
  const lines: string[] = []

  // Queue Status
  lines.push("Queue Status:")
  lines.push(`  Total:    ${s.total} tasks`)
  lines.push(`  Ready:    ${s.readyCount} (${pct(s.readyCount, s.total)})`)
  lines.push(`  Active:   ${s.byStatus.active ?? 0} (${pct(s.byStatus.active ?? 0, s.total)})`)
  lines.push(`  Blocked:  ${s.byStatus.blocked ?? 0} (${pct(s.byStatus.blocked ?? 0, s.total)})`)
  lines.push(`  Done:     ${s.byStatus.done ?? 0} (${pct(s.byStatus.done ?? 0, s.total)})`)

  // By Priority (ready tasks only)
  lines.push("")
  lines.push("By Priority:")
  lines.push(`  Critical (900+): ${s.byPriority.critical} ready`)
  lines.push(`  High (700-899):  ${s.byPriority.high} ready`)
  lines.push(`  Medium (500-699): ${s.byPriority.medium} ready`)
  lines.push(`  Low (<500):      ${s.byPriority.low} ready`)

  // Activity
  lines.push("")
  lines.push("Activity:")
  lines.push(`  Last 24h: ${s.activity.last24h} completed`)
  lines.push(`  Last 7d:  ${s.activity.last7d} completed`)
  if (s.activity.avgPerDay !== null) {
    lines.push(`  Avg completion: ${s.activity.avgPerDay} tasks/day`)
  }

  // Claims
  lines.push("")
  lines.push("Claims:")
  lines.push(`  Active:  ${s.claims.active}`)
  lines.push(`  Expired: ${s.claims.expired}`)

  return lines.join("\n")
}
