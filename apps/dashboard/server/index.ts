import { serve } from "@hono/node-server"
import { Hono } from "hono"
import { cors } from "hono/cors"
import Database from "better-sqlite3"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, "../../..")
const dbPath = resolve(projectRoot, ".tx/tasks.db")
const ralphLogPath = resolve(projectRoot, ".tx/ralph-output.log")
const ralphPidPath = resolve(projectRoot, ".tx/ralph.pid")

const app = new Hono()

app.use("/*", cors())

// Lazy DB connection
let db: Database.Database | null = null
const getDb = () => {
  if (!db) {
    if (!existsSync(dbPath)) {
      throw new Error(`Database not found at ${dbPath}. Run 'tx init' first.`)
    }
    db = new Database(dbPath, { readonly: true })
  }
  return db
}

// Types
interface TaskRow {
  id: string
  title: string
  description: string
  status: string
  parent_id: string | null
  score: number
  created_at: string
  updated_at: string
  completed_at: string | null
  metadata: string
}

interface TaskWithDeps extends TaskRow {
  blockedBy: string[]
  blocks: string[]
  children: string[]
  isReady: boolean
}

// GET /api/tasks
app.get("/api/tasks", (c) => {
  try {
    const db = getDb()
    const tasks = db.prepare("SELECT * FROM tasks ORDER BY score DESC").all() as TaskRow[]

    // Get all dependencies
    const deps = db.prepare("SELECT blocker_id, blocked_id FROM task_dependencies").all() as Array<{
      blocker_id: string
      blocked_id: string
    }>

    // Build maps
    const blockedByMap = new Map<string, string[]>()
    const blocksMap = new Map<string, string[]>()

    for (const dep of deps) {
      // blocked_id is blocked BY blocker_id
      const existing = blockedByMap.get(dep.blocked_id) ?? []
      blockedByMap.set(dep.blocked_id, [...existing, dep.blocker_id])

      // blocker_id BLOCKS blocked_id
      const existingBlocks = blocksMap.get(dep.blocker_id) ?? []
      blocksMap.set(dep.blocker_id, [...existingBlocks, dep.blocked_id])
    }

    // Build children map
    const childrenMap = new Map<string, string[]>()
    for (const task of tasks) {
      if (task.parent_id) {
        const existing = childrenMap.get(task.parent_id) ?? []
        childrenMap.set(task.parent_id, [...existing, task.id])
      }
    }

    // Status of all tasks for ready check
    const statusMap = new Map(tasks.map(t => [t.id, t.status]))

    // Enrich tasks
    const enriched: TaskWithDeps[] = tasks.map(task => {
      const blockedBy = blockedByMap.get(task.id) ?? []
      const blocks = blocksMap.get(task.id) ?? []
      const children = childrenMap.get(task.id) ?? []

      // Ready if workable status and all blockers are done
      const workableStatuses = ["backlog", "ready", "planning"]
      const allBlockersDone = blockedBy.every(id => statusMap.get(id) === "done")
      const isReady = workableStatuses.includes(task.status) && allBlockersDone

      return { ...task, blockedBy, blocks, children, isReady }
    })

    // Summary
    const summary = {
      total: tasks.length,
      byStatus: tasks.reduce((acc, t) => {
        acc[t.status] = (acc[t.status] ?? 0) + 1
        return acc
      }, {} as Record<string, number>),
    }

    return c.json({ tasks: enriched, summary })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/tasks/ready
app.get("/api/tasks/ready", (c) => {
  try {
    const db = getDb()

    // Get all tasks and deps to compute ready
    const tasks = db.prepare("SELECT * FROM tasks ORDER BY score DESC").all() as TaskRow[]
    const deps = db.prepare("SELECT blocker_id, blocked_id FROM task_dependencies").all() as Array<{
      blocker_id: string
      blocked_id: string
    }>

    const blockedByMap = new Map<string, string[]>()
    for (const dep of deps) {
      const existing = blockedByMap.get(dep.blocked_id) ?? []
      blockedByMap.set(dep.blocked_id, [...existing, dep.blocker_id])
    }

    const statusMap = new Map(tasks.map(t => [t.id, t.status]))
    const workableStatuses = ["backlog", "ready", "planning"]

    const ready = tasks.filter(task => {
      const blockedBy = blockedByMap.get(task.id) ?? []
      const allBlockersDone = blockedBy.every(id => statusMap.get(id) === "done")
      return workableStatuses.includes(task.status) && allBlockersDone
    })

    return c.json({ tasks: ready })
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

    return c.json({
      tasks: taskCount,
      done: doneCount,
      ready: readyCount,
      learnings: learningsCount,
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

const port = 3001
console.log(`Dashboard API running on http://localhost:${port}`)

serve({ fetch: app.fetch, port })
