import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { Database } from "bun:sqlite"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import type { TaskRow, DependencyRow } from "@jamesaphoenix/tx-types"
import { escapeLikePattern } from "@jamesaphoenix/tx-core"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "../../..")
const dbPath = resolve(projectRoot, ".tx/tasks.db")
const ralphLogPath = resolve(projectRoot, ".tx/ralph-output.log")
const ralphPidPath = resolve(projectRoot, ".tx/ralph.pid")
const txDir = resolve(projectRoot, ".tx")
const claudeDir = resolve(homedir(), ".claude")

/**
 * Validate that a file path is within an allowed directory.
 * Allows paths within:
 *   - .tx/ directory (locally stored transcripts)
 *   - ~/.claude/ directory (Claude Code native transcripts)
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 * Returns the resolved absolute path if valid, null if invalid.
 */
const validateTranscriptPath = (filePath: string): string | null => {
  const resolved = resolve(projectRoot, filePath)
  // Allow paths within the .tx directory
  if (resolved.startsWith(txDir + "/") || resolved === txDir) {
    return resolved
  }
  // Allow paths within ~/.claude directory (Claude Code transcripts)
  if (resolved.startsWith(claudeDir + "/") || resolved === claudeDir) {
    return resolved
  }
  return null
}

const app = new Hono()

app.use("/*", cors())

// Lazy DB connection
let db: Database | null = null
const getDb = () => {
  if (!db) {
    if (!existsSync(dbPath)) {
      throw new Error(`Database not found at ${dbPath}. Run 'tx init' first.`)
    }
    db = new Database(dbPath, { readonly: true })
  }
  return db
}

/**
 * Task row with dependency information for API responses.
 * Extends TaskRow from @tx/types with computed dependency fields.
 * Note: We use snake_case TaskRow (not camelCase Task) since this
 * is a thin API layer that returns raw database rows.
 */
interface TaskRowWithDeps extends TaskRow {
  blockedBy: string[]
  blocks: string[]
  children: string[]
  isReady: boolean
}

// Pagination helpers
function parseTaskCursor(cursor: string): { score: number; id: string } {
  const colonIndex = cursor.lastIndexOf(':')
  return {
    score: parseInt(cursor.slice(0, colonIndex), 10),
    id: cursor.slice(colonIndex + 1),
  }
}

function parseRunCursor(cursor: string): { startedAt: string; id: string } {
  // Format: "2026-01-30T10:00:00Z:run-abc123"
  // Find the last colon that separates timestamp from id
  const match = cursor.match(/^(.+):(run-.+)$/)
  if (!match) {
    return { startedAt: cursor, id: '' }
  }
  return { startedAt: match[1]!, id: match[2]! }
}

function buildTaskCursor(task: TaskRow): string {
  return `${task.score}:${task.id}`
}

function buildRunCursor(run: { startedAt: string; id: string }): string {
  return `${run.startedAt}:${run.id}`
}


// Helper to enrich tasks with dependency info
function enrichTasksWithDeps(
  db: Database,
  tasks: TaskRow[],
  allTasks?: TaskRow[]
): TaskRowWithDeps[] {
  // Get all dependencies
  const deps = db.prepare("SELECT blocker_id, blocked_id FROM task_dependencies").all() as DependencyRow[]

  // Build maps
  const blockedByMap = new Map<string, string[]>()
  const blocksMap = new Map<string, string[]>()

  for (const dep of deps) {
    const existing = blockedByMap.get(dep.blocked_id) ?? []
    blockedByMap.set(dep.blocked_id, [...existing, dep.blocker_id])

    const existingBlocks = blocksMap.get(dep.blocker_id) ?? []
    blocksMap.set(dep.blocker_id, [...existingBlocks, dep.blocked_id])
  }

  // Build children map from all tasks if provided, otherwise query
  const tasksForChildren = allTasks ?? db.prepare("SELECT id, parent_id FROM tasks").all() as Array<{ id: string; parent_id: string | null }>
  const childrenMap = new Map<string, string[]>()
  for (const task of tasksForChildren) {
    if (task.parent_id) {
      const existing = childrenMap.get(task.parent_id) ?? []
      childrenMap.set(task.parent_id, [...existing, task.id])
    }
  }

  // Status of all tasks for ready check
  const allTasksForStatus = allTasks ?? db.prepare("SELECT id, status FROM tasks").all() as Array<{ id: string; status: string }>
  const statusMap = new Map(allTasksForStatus.map(t => [t.id, t.status]))

  const workableStatuses = ["backlog", "ready", "planning"]

  return tasks.map(task => {
    const blockedBy = blockedByMap.get(task.id) ?? []
    const blocks = blocksMap.get(task.id) ?? []
    const children = childrenMap.get(task.id) ?? []
    const allBlockersDone = blockedBy.every(id => statusMap.get(id) === "done")
    const isReady = workableStatuses.includes(task.status) && allBlockersDone

    return { ...task, blockedBy, blocks, children, isReady }
  })
}

// GET /api/tasks - with cursor-based pagination
app.get("/api/tasks", (c) => {
  try {
    const db = getDb()
    const cursor = c.req.query("cursor")
    const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100)
    const statusFilter = c.req.query("status")?.split(",").filter(Boolean)
    const search = c.req.query("search")

    // Build WHERE clauses
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (statusFilter?.length) {
      conditions.push(`status IN (${statusFilter.map(() => "?").join(",")})`)
      params.push(...statusFilter)
    }

    if (search) {
      const searchPattern = `%${escapeLikePattern(search)}%`
      conditions.push("(title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')")
      params.push(searchPattern, searchPattern)
    }

    if (cursor) {
      const { score, id } = parseTaskCursor(cursor)
      conditions.push("(score < ? OR (score = ? AND id > ?))")
      params.push(score, score, id)
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

    // Fetch limit + 1 to check hasMore
    const sql = `
      SELECT * FROM tasks
      ${whereClause}
      ORDER BY score DESC, id ASC
      LIMIT ?
    `
    params.push(limit + 1)

    const rows = db.prepare(sql).all(...params) as TaskRow[]
    const hasMore = rows.length > limit
    const tasks = hasMore ? rows.slice(0, limit) : rows

    // Get total count for display (without cursor condition)
    const countConditions = conditions.filter((_, i) => {
      // Remove cursor condition (last 3 params if cursor exists)
      return !cursor || i < conditions.length - 1
    })
    const countParams = cursor ? params.slice(0, -4) : params.slice(0, -1) // Remove limit and cursor params
    const countWhereClause = countConditions.length ? `WHERE ${countConditions.join(" AND ")}` : ""
    const total = (db.prepare(`SELECT COUNT(*) as count FROM tasks ${countWhereClause}`).get(...countParams) as { count: number }).count

    // Enrich with deps
    const enriched = enrichTasksWithDeps(db, tasks)

    // Summary (from all tasks matching filter, not just current page)
    const summaryRows = db.prepare(`SELECT status, COUNT(*) as count FROM tasks ${countWhereClause} GROUP BY status`).all(...countParams) as Array<{ status: string; count: number }>
    const byStatus = summaryRows.reduce((acc, r) => {
      acc[r.status] = r.count
      return acc
    }, {} as Record<string, number>)

    return c.json({
      tasks: enriched,
      nextCursor: hasMore && tasks.length ? buildTaskCursor(tasks[tasks.length - 1]!) : null,
      hasMore,
      total,
      summary: { total, byStatus },
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/tasks/ready - Returns ALL ready tasks (not paginated)
app.get("/api/tasks/ready", (c) => {
  try {
    const db = getDb()

    // Get all tasks to compute ready status and children
    const allTasks = db.prepare("SELECT * FROM tasks ORDER BY score DESC").all() as TaskRow[]
    const deps = db.prepare("SELECT blocker_id, blocked_id FROM task_dependencies").all() as DependencyRow[]

    const blockedByMap = new Map<string, string[]>()
    for (const dep of deps) {
      const existing = blockedByMap.get(dep.blocked_id) ?? []
      blockedByMap.set(dep.blocked_id, [...existing, dep.blocker_id])
    }

    const statusMap = new Map(allTasks.map(t => [t.id, t.status]))
    const workableStatuses = ["backlog", "ready", "planning"]

    // Filter to ready tasks
    const readyTasks = allTasks.filter(task => {
      const blockedBy = blockedByMap.get(task.id) ?? []
      const allBlockersDone = blockedBy.every(id => statusMap.get(id) === "done")
      return workableStatuses.includes(task.status) && allBlockersDone
    })

    // Enrich with full dependency info (Rule 1: every API response MUST include TaskWithDeps)
    const enriched = enrichTasksWithDeps(db, readyTasks, allTasks)

    return c.json({ tasks: enriched })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/ralph
app.get("/api/ralph", (c) => {
  try {
    // Check if ralph is running
    let running = false
    let pid: number | null = null

    if (existsSync(ralphPidPath)) {
      const pidStr = readFileSync(ralphPidPath, "utf-8").trim()
      pid = parseInt(pidStr, 10)
      try {
        process.kill(pid, 0) // Check if process exists
        running = true
      } catch {
        running = false
      }
    }

    // Parse ralph log for recent activity
    const recentActivity: Array<{
      timestamp: string
      iteration: number
      task: string
      taskTitle: string
      agent: string
      status: "started" | "completed" | "failed"
    }> = []

    let currentIteration = 0
    let currentTask: string | null = null

    if (existsSync(ralphLogPath)) {
      const log = readFileSync(ralphLogPath, "utf-8")
      const lines = log.split("\n")

      for (const line of lines) {
        // Match iteration start
        const iterMatch = line.match(/\[([^\]]+)\] --- Iteration (\d+) ---/)
        if (iterMatch) {
          currentIteration = parseInt(iterMatch[2]!, 10)
        }

        // Match task assignment
        const taskMatch = line.match(/\[([^\]]+)\] Task: (tx-[a-z0-9]+) — (.+)/)
        if (taskMatch) {
          currentTask = taskMatch[2]!
          recentActivity.push({
            timestamp: taskMatch[1]!,
            iteration: currentIteration,
            task: taskMatch[2]!,
            taskTitle: taskMatch[3]!,
            agent: "",
            status: "started",
          })
        }

        // Match agent
        const agentMatch = line.match(/\[([^\]]+)\] Agent: (.+)/)
        if (agentMatch && recentActivity.length > 0) {
          recentActivity[recentActivity.length - 1]!.agent = agentMatch[2]!
        }

        // Match completion
        const completeMatch = line.match(/\[([^\]]+)\] Agent completed successfully/)
        if (completeMatch && recentActivity.length > 0) {
          recentActivity.push({
            ...recentActivity[recentActivity.length - 1]!,
            timestamp: completeMatch[1]!,
            status: "completed",
          })
        }

        // Match failure
        const failMatch = line.match(/\[([^\]]+)\] Agent failed/)
        if (failMatch && recentActivity.length > 0) {
          recentActivity.push({
            ...recentActivity[recentActivity.length - 1]!,
            timestamp: failMatch[1]!,
            status: "failed",
          })
        }
      }
    }

    return c.json({
      running,
      pid,
      currentIteration,
      currentTask,
      recentActivity: recentActivity.slice(-20).reverse(), // Last 20, newest first
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/stats
app.get("/api/stats", (c) => {
  try {
    const db = getDb()

    const taskCount = (db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number }).count
    const doneCount = (db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'done'").get() as { count: number }).count
    const readyCount = (db.prepare(`
      SELECT COUNT(*) as count FROM tasks t
      WHERE t.status IN ('backlog', 'ready', 'planning')
      AND NOT EXISTS (
        SELECT 1 FROM task_dependencies d
        JOIN tasks blocker ON d.blocker_id = blocker.id
        WHERE d.blocked_id = t.id AND blocker.status != 'done'
      )
    `).get() as { count: number }).count

    // Learnings count (if table exists)
    let learningsCount = 0
    try {
      learningsCount = (db.prepare("SELECT COUNT(*) as count FROM learnings").get() as { count: number }).count
    } catch {
      // Table doesn't exist yet
    }

    // Runs count (if table exists)
    let runsRunning = 0
    let runsTotal = 0
    try {
      runsRunning = (db.prepare("SELECT COUNT(*) as count FROM runs WHERE status = 'running'").get() as { count: number }).count
      runsTotal = (db.prepare("SELECT COUNT(*) as count FROM runs").get() as { count: number }).count
    } catch {
      // Table doesn't exist yet
    }

    return c.json({
      tasks: taskCount,
      done: doneCount,
      ready: readyCount,
      learnings: learningsCount,
      runsRunning,
      runsTotal,
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/runs - List runs with cursor-based pagination
app.get("/api/runs", (c) => {
  try {
    const db = getDb()
    const cursor = c.req.query("cursor")
    const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100)
    const agentFilter = c.req.query("agent")
    const statusFilter = c.req.query("status")?.split(",").filter(Boolean)

    // Build WHERE clauses
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (agentFilter) {
      conditions.push("agent = ?")
      params.push(agentFilter)
    }

    if (statusFilter?.length) {
      conditions.push(`status IN (${statusFilter.map(() => "?").join(",")})`)
      params.push(...statusFilter)
    }

    if (cursor) {
      const { startedAt, id } = parseRunCursor(cursor)
      conditions.push("(started_at < ? OR (started_at = ? AND id > ?))")
      params.push(startedAt, startedAt, id)
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""

    let runs: Array<{
      id: string
      taskId: string | null
      agent: string
      startedAt: string
      endedAt: string | null
      status: string
      exitCode: number | null
      transcriptPath: string | null
      summary: string | null
      errorMessage: string | null
    }> = []

    try {
      const sql = `
        SELECT id, task_id AS taskId, agent,
               started_at AS startedAt, ended_at AS endedAt,
               status, exit_code AS exitCode,
               transcript_path AS transcriptPath,
               summary, error_message AS errorMessage
        FROM runs
        ${whereClause}
        ORDER BY started_at DESC, id ASC
        LIMIT ?
      `
      params.push(limit + 1)
      runs = db.prepare(sql).all(...params) as typeof runs
    } catch {
      // Table doesn't exist yet
      return c.json({ runs: [], nextCursor: null, hasMore: false })
    }

    const hasMore = runs.length > limit
    const pagedRuns = hasMore ? runs.slice(0, limit) : runs

    // Batch fetch task titles to avoid N+1 queries
    const taskIds = [...new Set(pagedRuns.map(r => r.taskId).filter((id): id is string => id !== null))]
    const taskTitleMap = new Map<string, string>()
    if (taskIds.length > 0) {
      const placeholders = taskIds.map(() => "?").join(",")
      const rows = db.prepare(`SELECT id, title FROM tasks WHERE id IN (${placeholders})`).all(...taskIds) as Array<{ id: string; title: string }>
      for (const row of rows) {
        taskTitleMap.set(row.id, row.title)
      }
    }

    const enriched = pagedRuns.map(run => ({
      ...run,
      taskTitle: run.taskId ? (taskTitleMap.get(run.taskId) ?? null) : null,
    }))

    return c.json({
      runs: enriched,
      nextCursor: hasMore && pagedRuns.length ? buildRunCursor(pagedRuns[pagedRuns.length - 1]!) : null,
      hasMore,
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/tasks/:id - Get task detail with related tasks
app.get("/api/tasks/:id", (c) => {
  try {
    const db = getDb()
    const id = c.req.param("id")

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined
    if (!task) {
      return c.json({ error: "Task not found" }, 404)
    }

    // Get dependency info
    const blockedByIds = db.prepare(
      "SELECT blocker_id FROM task_dependencies WHERE blocked_id = ?"
    ).all(id) as Array<{ blocker_id: string }>

    const blocksIds = db.prepare(
      "SELECT blocked_id FROM task_dependencies WHERE blocker_id = ?"
    ).all(id) as Array<{ blocked_id: string }>

    const childIds = db.prepare(
      "SELECT id FROM tasks WHERE parent_id = ?"
    ).all(id) as Array<{ id: string }>

    // Fetch full task data for related tasks
    const fetchTasksByIds = (ids: string[]): TaskRowWithDeps[] => {
      if (ids.length === 0) return []
      const placeholders = ids.map(() => "?").join(",")
      const tasks = db.prepare(`SELECT * FROM tasks WHERE id IN (${placeholders})`).all(...ids) as TaskRow[]
      return enrichTasksWithDeps(db, tasks)
    }

    const blockedByTasks = fetchTasksByIds(blockedByIds.map(r => r.blocker_id))
    const blocksTasks = fetchTasksByIds(blocksIds.map(r => r.blocked_id))
    const childTasks = fetchTasksByIds(childIds.map(r => r.id))

    // Enrich the main task
    const [enrichedTask] = enrichTasksWithDeps(db, [task])

    return c.json({
      task: enrichedTask,
      blockedByTasks,
      blocksTasks,
      childTasks,
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/runs/:id - Get run details with transcript
app.get("/api/runs/:id", (c) => {
  try {
    const db = getDb()
    const id = c.req.param("id")

    const run = db.prepare(`
      SELECT id, task_id AS taskId, agent,
             started_at AS startedAt, ended_at AS endedAt,
             status, exit_code AS exitCode, pid,
             transcript_path AS transcriptPath,
             context_injected AS contextInjected,
             summary, error_message AS errorMessage,
             metadata
      FROM runs WHERE id = ?
    `).get(id) as {
      id: string
      taskId: string | null
      agent: string
      startedAt: string
      endedAt: string | null
      status: string
      exitCode: number | null
      pid: number | null
      transcriptPath: string | null
      contextInjected: string | null
      summary: string | null
      errorMessage: string | null
      metadata: string
    } | undefined

    if (!run) {
      return c.json({ error: "Run not found" }, 404)
    }

    // Try to read and parse transcript if it exists and path is valid
    let messages: Array<{ role: string; content: unknown; type?: string; tool_name?: string; timestamp?: string }> = []
    if (run.transcriptPath) {
      const validatedPath = validateTranscriptPath(run.transcriptPath)
      if (validatedPath && existsSync(validatedPath)) {
        try {
          const raw = readFileSync(validatedPath, "utf-8")
          const lines = raw.split("\n").filter(Boolean)
          for (const line of lines) {
            try {
              const entry = JSON.parse(line)
              if (entry.type === "user" || entry.type === "assistant") {
                const msg = entry.message
                if (!msg) continue
                const content = msg.content
                // Flatten content blocks into individual messages
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block.type === "text") {
                      messages.push({ role: msg.role, content: block.text, type: "text", timestamp: entry.timestamp })
                    } else if (block.type === "tool_use") {
                      messages.push({ role: msg.role, content: JSON.stringify(block.input), type: "tool_use", tool_name: block.name, timestamp: entry.timestamp })
                    } else if (block.type === "tool_result") {
                      const text = typeof block.content === "string" ? block.content
                        : Array.isArray(block.content) ? block.content.map((c: { text?: string }) => c.text ?? "").join("\n")
                        : JSON.stringify(block.content)
                      messages.push({ role: msg.role, content: text, type: "tool_result", tool_name: block.tool_use_id, timestamp: entry.timestamp })
                    }
                  }
                } else if (typeof content === "string") {
                  messages.push({ role: msg.role, content, type: "text", timestamp: entry.timestamp })
                }
              }
            } catch {
              // Skip malformed lines
            }
          }
        } catch {
          // Failed to read file
        }
      }
    }

    return c.json({ run, messages })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

const port = 3001
console.log(`Dashboard API running on http://localhost:${port}`)

serve({ fetch: app.fetch, port })
