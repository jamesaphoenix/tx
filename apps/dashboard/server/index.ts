import { serve } from "@hono/node-server"
import { Hono, type Context } from "hono"
import { cors } from "hono/cors"
import { Database } from "bun:sqlite"
import { readFileSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { TASK_STATUSES, type TaskRow, type DependencyRow } from "@jamesaphoenix/tx-types"
import { parse as parseYaml } from "yaml"
import { escapeLikePattern, readTxConfig, renderDocToMarkdown } from "@jamesaphoenix/tx-core"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fallbackRoot = resolve(__dirname, "../../..")
// TX_DB_PATH is set by the dashboard command to scope to the caller's CWD
const dbPath = process.env.TX_DB_PATH ?? resolve(fallbackRoot, ".tx/tasks.db")
const dbDir = dirname(dbPath)
const ralphLogPath = resolve(dbDir, "ralph-output.log")
const ralphPidPath = resolve(dbDir, "ralph.pid")
const txDir = dbDir
const claudeDir = resolve(homedir(), ".claude")
const VALID_TASK_STATUSES = new Set<string>(TASK_STATUSES)
const DEFAULT_LABEL_COLORS = [
  "#2563eb", // blue
  "#0ea5e9", // sky
  "#14b8a6", // teal
  "#16a34a", // green
  "#ca8a04", // yellow
  "#ea580c", // orange
  "#dc2626", // red
  "#db2777", // pink
] as const
const DEFAULT_TASK_LABELS = [
  "Bug",
  "Feature",
  "DevOFps",
  "Performance",
  "Observability",
  "Infrastructure",
  "Refactor",
  "Security",
  "Testing",
  "Documentation",
] as const
const LEGACY_LABEL_RENAMES = [
  { from: "DevOps", to: "DevOFps" },
] as const
const LEGACY_LABELS_TO_REMOVE = [
  "AISEO",
] as const

/**
 * Validate that a file path is within an allowed directory.
 * Allows paths within:
 *   - .tx/ directory (locally stored transcripts)
 *   - ~/.claude/ directory (Claude Code native transcripts)
 * Prevents path traversal attacks (e.g., ../../etc/passwd).
 * Returns the resolved absolute path if valid, null if invalid.
 */
const validateTranscriptPath = (filePath: string): string | null => {
  const resolved = resolve(dirname(dbPath), filePath)
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
    db = new Database(dbPath)
    db.exec("PRAGMA foreign_keys = ON;")
    ensureLabelSchema(db)
  }
  return db
}

function ensureLabelSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_labels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_labels_name_ci ON task_labels(lower(name));
    CREATE TABLE IF NOT EXISTS task_label_assignments (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      label_id INTEGER NOT NULL REFERENCES task_labels(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (task_id, label_id)
    );
    CREATE INDEX IF NOT EXISTS idx_task_label_assignments_task ON task_label_assignments(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_label_assignments_label ON task_label_assignments(label_id);
  `)
  repairLegacyDefaultLabels(db)
  seedDefaultLabels(db)
}

function repairLegacyDefaultLabels(db: Database): void {
  const now = new Date().toISOString()

  for (const rename of LEGACY_LABEL_RENAMES) {
    const legacyRow = db.prepare(`
      SELECT id, name, color, created_at, updated_at
      FROM task_labels
      WHERE lower(name) = lower(?)
      LIMIT 1
    `).get(rename.from) as TaskLabelRow | undefined

    if (!legacyRow) continue

    const canonicalRow = db.prepare(`
      SELECT id, name, color, created_at, updated_at
      FROM task_labels
      WHERE lower(name) = lower(?)
      LIMIT 1
    `).get(rename.to) as TaskLabelRow | undefined

    // Safe in-place rename when only the legacy label exists.
    if (!canonicalRow) {
      db.prepare(`
        UPDATE task_labels
        SET name = ?, color = ?, updated_at = ?
        WHERE id = ?
      `).run(rename.to, defaultLabelColor(rename.to), now, legacyRow.id)
      continue
    }

    // Merge assignments into the canonical label and remove the legacy row.
    db.prepare(`
      INSERT OR IGNORE INTO task_label_assignments (task_id, label_id, created_at)
      SELECT task_id, ?, created_at
      FROM task_label_assignments
      WHERE label_id = ?
    `).run(canonicalRow.id, legacyRow.id)

    db.prepare(`
      DELETE FROM task_label_assignments
      WHERE label_id = ?
    `).run(legacyRow.id)

    db.prepare(`
      DELETE FROM task_labels
      WHERE id = ?
    `).run(legacyRow.id)

    db.prepare(`
      UPDATE task_labels
      SET updated_at = ?
      WHERE id = ?
    `).run(now, canonicalRow.id)
  }

  for (const legacyLabelName of LEGACY_LABELS_TO_REMOVE) {
    const legacyRows = db.prepare(`
      SELECT id, name, color, created_at, updated_at
      FROM task_labels
      WHERE lower(name) = lower(?)
    `).all(legacyLabelName) as TaskLabelRow[]

    for (const row of legacyRows) {
      db.prepare(`
        DELETE FROM task_labels
        WHERE id = ?
      `).run(row.id)
    }
  }
}

function seedDefaultLabels(db: Database): void {
  const now = new Date().toISOString()
  const insert = db.prepare(`
    INSERT OR IGNORE INTO task_labels (name, color, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `)

  for (const name of DEFAULT_TASK_LABELS) {
    insert.run(name, defaultLabelColor(name), now, now)
  }
}

interface TaskLabelRow {
  id: number
  name: string
  color: string
  created_at: string
  updated_at: string
}

interface TaskLabel {
  id: number
  name: string
  color: string
  createdAt: string
  updatedAt: string
}

interface TaskCreatePayload {
  title?: string
  description?: string
  parentId?: string | null
  status?: string
  score?: number
  metadata?: Record<string, unknown>
}

interface TaskUpdatePayload {
  title?: string
  description?: string
  status?: string
  parentId?: string | null
  score?: number
  metadata?: Record<string, unknown>
}

interface CreateLabelPayload {
  name?: string
  color?: string
}

interface AssignLabelPayload {
  labelId?: number
  name?: string
  color?: string
}

interface DocRow {
  id: number
  hash: string
  kind: "overview" | "prd" | "design"
  name: string
  title: string
  version: number
  status: "changing" | "locked"
  file_path: string
  parent_doc_id: number | null
  created_at: string
  locked_at: string | null
}

interface DocLinkRow {
  from_doc_id: number
  to_doc_id: number
  link_type: string
}

interface TaskDocLinkRow {
  task_id: string
  doc_id: number
  link_type: "implements" | "references"
}

interface DocResponse {
  id: number
  hash: string
  kind: "overview" | "prd" | "design"
  name: string
  title: string
  version: number
  status: "changing" | "locked"
  filePath: string
  parentDocId: number | null
  createdAt: string
  lockedAt: string | null
}

function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function defaultLabelColor(name: string): string {
  return DEFAULT_LABEL_COLORS[hashString(name) % DEFAULT_LABEL_COLORS.length]!
}

function normalizeLabelName(name: string): string {
  return name.trim().replace(/\s+/g, " ")
}

function isTaskStatus(value: string): value is (typeof TASK_STATUSES)[number] {
  return VALID_TASK_STATUSES.has(value)
}

function hasTable(db: Database, tableName: string): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).get(tableName) as { 1: number } | undefined
  return Boolean(row)
}

function hasDocsSchema(db: Database): boolean {
  return hasTable(db, "docs")
}

function hasDocLinksSchema(db: Database): boolean {
  return hasTable(db, "doc_links")
}

function hasTaskDocLinksSchema(db: Database): boolean {
  return hasTable(db, "task_doc_links")
}

function toTaskLabel(row: TaskLabelRow): TaskLabel {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function loadTaskLabelsMap(db: Database, taskIds: readonly string[]): Map<string, TaskLabel[]> {
  const labelsByTask = new Map<string, TaskLabel[]>()
  for (const taskId of taskIds) {
    labelsByTask.set(taskId, [])
  }

  if (taskIds.length === 0) {
    return labelsByTask
  }

  const placeholders = taskIds.map(() => "?").join(",")
  const rows = db.prepare(`
    SELECT tla.task_id, l.id, l.name, l.color, l.created_at, l.updated_at
    FROM task_label_assignments tla
    JOIN task_labels l ON l.id = tla.label_id
    WHERE tla.task_id IN (${placeholders})
    ORDER BY l.name COLLATE NOCASE ASC
  `).all(...taskIds) as Array<TaskLabelRow & { task_id: string }>

  for (const row of rows) {
    const existing = labelsByTask.get(row.task_id) ?? []
    existing.push(toTaskLabel(row))
    labelsByTask.set(row.task_id, existing)
  }

  return labelsByTask
}

function getTaskWithDeps(db: Database, id: string): TaskRowWithDeps | null {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined
  if (!task) return null
  const [enriched] = enrichTasksWithDeps(db, [task])
  return enriched ?? null
}

function generateTaskId(db: Database): string {
  for (let i = 0; i < 10; i++) {
    const candidate = `tx-${Math.random().toString(36).slice(2, 10)}`
    const exists = db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(candidate) as { 1: number } | undefined
    if (!exists) return candidate
  }
  throw new Error("Unable to generate unique task ID")
}

function upsertLabel(db: Database, input: { name: string; color?: string }): TaskLabel {
  const normalizedName = normalizeLabelName(input.name)
  if (!normalizedName) {
    throw new Error("Label name is required")
  }
  const existing = db.prepare(`
    SELECT id, name, color, created_at, updated_at
    FROM task_labels
    WHERE lower(name) = lower(?)
    LIMIT 1
  `).get(normalizedName) as TaskLabelRow | undefined

  if (existing) {
    return toTaskLabel(existing)
  }

  const now = new Date().toISOString()
  const color = input.color?.trim() || defaultLabelColor(normalizedName)
  const result = db.prepare(`
    INSERT INTO task_labels (name, color, created_at, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(normalizedName, color, now, now)

  const created = db.prepare(`
    SELECT id, name, color, created_at, updated_at
    FROM task_labels
    WHERE id = ?
    LIMIT 1
  `).get(result.lastInsertRowid) as TaskLabelRow | undefined

  if (!created) {
    throw new Error("Failed to create label")
  }
  return toTaskLabel(created)
}

interface TaskRowWithDeps extends TaskRow {
  blockedBy: string[]
  blocks: string[]
  children: string[]
  isReady: boolean
  labels: TaskLabel[]
}

interface TaskWithDepsResponse {
  id: string
  title: string
  description: string
  status: string
  parentId: string | null
  score: number
  createdAt: string
  updatedAt: string
  completedAt: string | null
  metadata: Record<string, unknown>
  blockedBy: string[]
  blocks: string[]
  children: string[]
  isReady: boolean
  labels: TaskLabel[]
}

function parseTaskMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function serializeTask(task: TaskRowWithDeps): TaskWithDepsResponse {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    parentId: task.parent_id,
    score: task.score,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    completedAt: task.completed_at,
    metadata: parseTaskMetadata(task.metadata),
    blockedBy: task.blockedBy,
    blocks: task.blocks,
    children: task.children,
    isReady: task.isReady,
    labels: task.labels,
  }
}

function serializeDoc(doc: DocRow): DocResponse {
  return {
    id: doc.id,
    hash: doc.hash,
    kind: doc.kind,
    name: doc.name,
    title: doc.title,
    version: doc.version,
    status: doc.status,
    filePath: doc.file_path,
    parentDocId: doc.parent_doc_id,
    createdAt: doc.created_at,
    lockedAt: doc.locked_at,
  }
}

function extractYamlScalar(yamlContent: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`^\\s*${escapedKey}:\\s*(.+)\\s*$`, "m")
  const match = yamlContent.match(regex)
  if (!match?.[1]) return null
  return match[1].trim().replace(/^["']|["']$/g, "")
}

function buildMarkdownFromYaml(yamlContent: string, filePath: string): string {
  const title = extractYamlScalar(yamlContent, "title")
  const kind = extractYamlScalar(yamlContent, "kind")
  const status = extractYamlScalar(yamlContent, "status")
  const version = extractYamlScalar(yamlContent, "version")
  const implementsRef = extractYamlScalar(yamlContent, "implements")

  const lines: string[] = []
  lines.push(`# ${title || filePath}`)
  if (kind) lines.push(`**Kind**: ${kind}`)
  if (status) lines.push(`**Status**: ${status}`)
  if (version) lines.push(`**Version**: ${version}`)
  if (implementsRef) lines.push(`**Implements**: ${implementsRef}`)
  lines.push("")
  lines.push("```yaml")
  lines.push(yamlContent.trim())
  lines.push("```")
  return lines.join("\n")
}

function renderMarkdownFromYaml(yamlContent: string, filePath: string): string {
  try {
    const parsed = parseYaml(yamlContent)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const parsedDoc = parsed as Record<string, unknown>
      const kindRaw = typeof parsedDoc.kind === "string" ? parsedDoc.kind.toLowerCase() : "overview"
      const kind = kindRaw === "prd" || kindRaw === "design" || kindRaw === "overview"
        ? kindRaw
        : "overview"
      return renderDocToMarkdown(parsedDoc, kind)
    }
  } catch {
    // Fall through to plain YAML wrapper.
  }
  return buildMarkdownFromYaml(yamlContent, filePath)
}

function getDocsRootPath(): string {
  try {
    const config = readTxConfig(process.cwd())
    return resolve(process.cwd(), config.docs.path)
  } catch {
    return resolve(dbDir, "docs")
  }
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
  const labelsByTask = loadTaskLabelsMap(db, tasks.map(t => t.id))

  const workableStatuses = ["backlog", "ready", "planning"]

  return tasks.map(task => {
    const blockedBy = blockedByMap.get(task.id) ?? []
    const blocks = blocksMap.get(task.id) ?? []
    const children = childrenMap.get(task.id) ?? []
    const allBlockersDone = blockedBy.every(id => statusMap.get(id) === "done")
    const isReady = workableStatuses.includes(task.status) && allBlockersDone
    const labels = labelsByTask.get(task.id) ?? []

    return { ...task, blockedBy, blocks, children, isReady, labels }
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
      tasks: enriched.map(serializeTask),
      nextCursor: hasMore && tasks.length ? buildTaskCursor(tasks[tasks.length - 1]!) : null,
      hasMore,
      total,
      summary: { total, byStatus },
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// POST /api/tasks - Create a new task
app.post("/api/tasks", async (c) => {
  try {
    const db = getDb()
    const payload = await c.req.json<TaskCreatePayload>()
    const title = payload.title?.trim()

    if (!title) {
      return c.json({ error: "Task title is required" }, 400)
    }

    if (payload.parentId) {
      const parentExists = db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(payload.parentId)
      if (!parentExists) {
        return c.json({ error: `Parent task not found: ${payload.parentId}` }, 400)
      }
    }

    if (payload.score !== undefined && (!Number.isFinite(payload.score) || !Number.isInteger(payload.score))) {
      return c.json({ error: "Score must be an integer" }, 400)
    }

    const now = new Date().toISOString()
    const id = generateTaskId(db)
    const description = payload.description ?? ""
    const score = payload.score ?? 0
    const status = payload.status?.trim() || "backlog"
    const metadata = payload.metadata ?? {}

    if (!isTaskStatus(status)) {
      return c.json({
        error: `Invalid status "${status}". Valid statuses: ${TASK_STATUSES.join(", ")}`,
      }, 400)
    }

    db.prepare(`
      INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      description,
      status,
      payload.parentId ?? null,
      score,
      now,
      now,
      null,
      JSON.stringify(metadata),
    )

    const task = getTaskWithDeps(db, id)
    if (!task) {
      return c.json({ error: "Failed to load created task" }, 500)
    }
    return c.json(serializeTask(task), 201)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// PATCH /api/tasks/:id - Update task fields
app.patch("/api/tasks/:id", async (c) => {
  try {
    const db = getDb()
    const id = c.req.param("id")
    const payload = await c.req.json<TaskUpdatePayload>()

    const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined
    if (!existing) {
      return c.json({ error: "Task not found" }, 404)
    }

    if (payload.status !== undefined && !isTaskStatus(payload.status)) {
      return c.json({
        error: `Invalid status "${payload.status}". Valid statuses: ${TASK_STATUSES.join(", ")}`,
      }, 400)
    }

    if (payload.parentId !== undefined) {
      if (payload.parentId === id) {
        return c.json({ error: "Task cannot be its own parent" }, 400)
      }
      if (payload.parentId) {
        const parentExists = db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(payload.parentId)
        if (!parentExists) {
          return c.json({ error: `Parent task not found: ${payload.parentId}` }, 400)
        }
      }
    }

    if (payload.score !== undefined && (!Number.isFinite(payload.score) || !Number.isInteger(payload.score))) {
      return c.json({ error: "Score must be an integer" }, 400)
    }

    let existingMetadata: Record<string, unknown> = {}
    try {
      existingMetadata = JSON.parse(existing.metadata || "{}") as Record<string, unknown>
    } catch {
      existingMetadata = {}
    }

    const nextStatus = payload.status ?? existing.status
    const now = new Date().toISOString()
    const mergedMetadata = payload.metadata
      ? { ...existingMetadata, ...payload.metadata }
      : existingMetadata

    const nextCompletedAt = nextStatus === "done"
      ? (existing.completed_at ?? now)
      : null

    db.prepare(`
      UPDATE tasks
      SET title = ?,
          description = ?,
          status = ?,
          parent_id = ?,
          score = ?,
          updated_at = ?,
          completed_at = ?,
          metadata = ?
      WHERE id = ?
    `).run(
      payload.title ?? existing.title,
      payload.description ?? existing.description,
      nextStatus,
      payload.parentId !== undefined ? payload.parentId : existing.parent_id,
      payload.score ?? existing.score,
      now,
      nextCompletedAt,
      JSON.stringify(mergedMetadata),
      id,
    )

    const task = getTaskWithDeps(db, id)
    if (!task) {
      return c.json({ error: "Failed to load updated task" }, 500)
    }
    return c.json(serializeTask(task))
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

const listLabelsHandler = (c: Context) => {
  try {
    const db = getDb()
    const rows = db.prepare(`
      SELECT id, name, color, created_at, updated_at
      FROM task_labels
      ORDER BY name COLLATE NOCASE ASC
    `).all() as TaskLabelRow[]

    return c.json({ labels: rows.map(toTaskLabel) })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
}

// GET /api/labels - list all task labels
app.get("/api/labels", listLabelsHandler)
// Backward-compatible alias for older clients.
app.get("/api/task-labels", listLabelsHandler)

const createLabelHandler = async (c: Context) => {
  try {
    const db = getDb()
    const payload = await c.req.json<CreateLabelPayload>()
    if (!payload.name || !payload.name.trim()) {
      return c.json({ error: "Label name is required" }, 400)
    }
    const label = upsertLabel(db, { name: payload.name, color: payload.color })
    return c.json(label, 201)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
}

// POST /api/labels - create (or return existing) label
app.post("/api/labels", createLabelHandler)
// Backward-compatible alias for older clients.
app.post("/api/task-labels", createLabelHandler)

const assignLabelHandler = async (c: Context) => {
  try {
    const db = getDb()
    const taskId = c.req.param("id")
    const taskExists = db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)
    if (!taskExists) {
      return c.json({ error: "Task not found" }, 404)
    }

    const payload = await c.req.json<AssignLabelPayload>()
    let label: TaskLabel | null = null

    if (payload.labelId !== undefined) {
      const row = db.prepare(`
        SELECT id, name, color, created_at, updated_at
        FROM task_labels
        WHERE id = ?
      `).get(payload.labelId) as TaskLabelRow | undefined
      if (!row) {
        return c.json({ error: `Label not found: ${payload.labelId}` }, 404)
      }
      label = toTaskLabel(row)
    } else if (payload.name && payload.name.trim()) {
      label = upsertLabel(db, { name: payload.name, color: payload.color })
    } else {
      return c.json({ error: "Either labelId or name is required" }, 400)
    }

    db.prepare(`
      INSERT OR IGNORE INTO task_label_assignments (task_id, label_id, created_at)
      VALUES (?, ?, ?)
    `).run(taskId, label.id, new Date().toISOString())

    const task = getTaskWithDeps(db, taskId)
    if (!task) {
      return c.json({ error: "Failed to load task after label assignment" }, 500)
    }
    return c.json({ success: true, task: serializeTask(task), label })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
}

// POST /api/tasks/:id/labels - assign an existing or new label to task
app.post("/api/tasks/:id/labels", assignLabelHandler)
// Backward-compatible alias for older clients.
app.post("/api/tasks/:id/task-labels", assignLabelHandler)

const unassignLabelHandler = (c: Context) => {
  try {
    const db = getDb()
    const taskId = c.req.param("id")
    const labelIdRaw = c.req.param("labelId")
    const labelId = parseInt(labelIdRaw, 10)
    if (isNaN(labelId)) {
      return c.json({ error: `Invalid label ID: ${labelIdRaw}` }, 400)
    }

    const taskExists = db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(taskId)
    if (!taskExists) {
      return c.json({ error: "Task not found" }, 404)
    }

    db.prepare("DELETE FROM task_label_assignments WHERE task_id = ? AND label_id = ?").run(taskId, labelId)

    const task = getTaskWithDeps(db, taskId)
    if (!task) {
      return c.json({ error: "Failed to load task after label removal" }, 500)
    }
    return c.json({ success: true, task: serializeTask(task) })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
}

// DELETE /api/tasks/:id/labels/:labelId - unassign a label from task
app.delete("/api/tasks/:id/labels/:labelId", unassignLabelHandler)
// Backward-compatible alias for older clients.
app.delete("/api/tasks/:id/task-labels/:labelId", unassignLabelHandler)

// DELETE /api/tasks/:id - delete task
app.delete("/api/tasks/:id", (c) => {
  try {
    const db = getDb()
    const id = c.req.param("id")
    const existing = db.prepare("SELECT 1 FROM tasks WHERE id = ?").get(id)
    if (!existing) {
      return c.json({ error: "Task not found" }, 404)
    }

    db.prepare("DELETE FROM tasks WHERE id = ?").run(id)
    return c.json({ success: true, id })
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

    return c.json({ tasks: enriched.map(serializeTask) })
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

// GET /api/docs - list docs (optional kind/status filters)
app.get("/api/docs", (c) => {
  try {
    const db = getDb()
    if (!hasDocsSchema(db)) {
      return c.json({ docs: [] })
    }

    const kind = c.req.query("kind")
    const status = c.req.query("status")
    const conditions: string[] = []
    const params: (string | number)[] = []

    if (kind) {
      conditions.push("kind = ?")
      params.push(kind)
    }
    if (status) {
      conditions.push("status = ?")
      params.push(status)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    const rows = db.prepare(`
      SELECT id, hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, locked_at
      FROM docs
      ${whereClause}
      ORDER BY kind, name, version
    `).all(...params) as DocRow[]

    return c.json({ docs: rows.map(serializeDoc) })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/docs/graph - doc link graph plus task attachments
app.get("/api/docs/graph", (c) => {
  try {
    const db = getDb()
    if (!hasDocsSchema(db)) {
      return c.json({ nodes: [], edges: [] })
    }

    const docs = db.prepare(`
      SELECT id, hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, locked_at
      FROM docs
      ORDER BY kind, name, version
    `).all() as DocRow[]

    const nodes: Array<{
      id: string
      label: string
      kind: "overview" | "prd" | "design" | "task"
      status?: "changing" | "locked"
    }> = docs.map((doc) => ({
      id: `doc:${doc.id}`,
      label: doc.name,
      kind: doc.kind,
      status: doc.status,
    }))

    const edges: Array<{ source: string; target: string; type: string }> = []

    const explicitDocTargets = new Map<number, number>()
    if (hasDocLinksSchema(db)) {
      const docLinks = db.prepare(`
        SELECT from_doc_id, to_doc_id, link_type
        FROM doc_links
        ORDER BY id ASC
      `).all() as DocLinkRow[]
      for (const link of docLinks) {
        explicitDocTargets.set(link.to_doc_id, (explicitDocTargets.get(link.to_doc_id) ?? 0) + 1)
        edges.push({
          source: `doc:${link.from_doc_id}`,
          target: `doc:${link.to_doc_id}`,
          type: link.link_type,
        })
      }
    }

    // Anchor unlinked docs under system-design overview (or first overview) for a single-root map.
    const rootOverview = docs.find((doc) => doc.kind === "overview" && doc.name === "system-design")
      ?? docs.find((doc) => doc.kind === "overview")
    if (rootOverview) {
      const existingPairs = new Set(edges.map((edge) => `${edge.source}->${edge.target}`))
      for (const doc of docs) {
        if (doc.id === rootOverview.id || doc.kind === "overview") continue
        if ((explicitDocTargets.get(doc.id) ?? 0) > 0) continue
        const source = `doc:${rootOverview.id}`
        const target = `doc:${doc.id}`
        const pair = `${source}->${target}`
        if (existingPairs.has(pair)) continue
        edges.push({
          source,
          target,
          type: doc.kind === "prd" ? "overview_to_prd" : "overview_to_design",
        })
      }
    }

    if (hasTaskDocLinksSchema(db)) {
      const taskLinks = db.prepare(`
        SELECT task_id, doc_id, link_type
        FROM task_doc_links
        ORDER BY id ASC
      `).all() as TaskDocLinkRow[]

      const taskNodeIds = new Set<string>()
      for (const link of taskLinks) {
        const taskNodeId = `task:${link.task_id}`
        if (!taskNodeIds.has(taskNodeId)) {
          taskNodeIds.add(taskNodeId)
          nodes.push({
            id: taskNodeId,
            label: link.task_id,
            kind: "task",
          })
        }
        edges.push({
          source: taskNodeId,
          target: `doc:${link.doc_id}`,
          type: link.link_type,
        })
      }
    }

    return c.json({ nodes, edges })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// POST /api/docs/render - compatibility endpoint for docs page actions
app.post("/api/docs/render", async (c) => {
  try {
    const db = getDb()
    if (!hasDocsSchema(db)) {
      return c.json({ rendered: [] })
    }

    const payload = await c.req.json<{ name?: string | null }>()
    const name = typeof payload?.name === "string" ? payload.name : undefined

    const rows = name
      ? db.prepare(`
          SELECT file_path
          FROM docs
          WHERE name = ?
          ORDER BY version DESC
          LIMIT 1
        `).all(name) as Array<{ file_path: string }>
      : db.prepare(`
          SELECT file_path
          FROM docs
          ORDER BY kind, name, version
        `).all() as Array<{ file_path: string }>

    const docsRoot = getDocsRootPath()
    const rendered = rows.flatMap((row) => {
      const yamlPath = resolve(docsRoot, row.file_path)
      const mdPath = resolve(docsRoot, row.file_path.replace(/\.yml$/i, ".md"))

      if (existsSync(yamlPath)) {
        try {
          const yamlContent = readFileSync(yamlPath, "utf-8")
          return [renderMarkdownFromYaml(yamlContent, row.file_path)]
        } catch {
          return []
        }
      }

      if (existsSync(mdPath)) {
        try {
          return [readFileSync(mdPath, "utf-8")]
        } catch {
          return []
        }
      }

      return []
    })

    return c.json({ rendered })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/docs/:name - fetch latest version of a doc by name
app.get("/api/docs/:name", (c) => {
  try {
    const db = getDb()
    if (!hasDocsSchema(db)) {
      return c.json({ error: "Docs are not initialized. Run 'tx migrate' first." }, 404)
    }

    const name = c.req.param("name")
    const row = db.prepare(`
      SELECT id, hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, locked_at
      FROM docs
      WHERE name = ?
      ORDER BY version DESC
      LIMIT 1
    `).get(name) as DocRow | undefined

    if (!row) {
      return c.json({ error: "Doc not found" }, 404)
    }
    return c.json(serializeDoc(row))
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/docs/:name/source - fetch source YAML and rendered markdown for a doc
app.get("/api/docs/:name/source", (c) => {
  try {
    const db = getDb()
    if (!hasDocsSchema(db)) {
      return c.json({ error: "Docs are not initialized. Run 'tx migrate' first." }, 404)
    }

    const name = c.req.param("name")
    const row = db.prepare(`
      SELECT file_path
      FROM docs
      WHERE name = ?
      ORDER BY version DESC
      LIMIT 1
    `).get(name) as { file_path: string } | undefined

    if (!row) {
      return c.json({ error: "Doc not found" }, 404)
    }

    const docsRoot = getDocsRootPath()
    const yamlPath = resolve(docsRoot, row.file_path)
    const mdPath = resolve(docsRoot, row.file_path.replace(/\.yml$/i, ".md"))

    const yamlContent = existsSync(yamlPath) ? readFileSync(yamlPath, "utf-8") : null
    const renderedContent = yamlContent
      ? renderMarkdownFromYaml(yamlContent, row.file_path)
      : existsSync(mdPath)
        ? readFileSync(mdPath, "utf-8")
        : null

    return c.json({
      name,
      yamlContent,
      renderedContent,
      filePath: row.file_path,
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// DELETE /api/docs/:name - delete latest mutable doc version
app.delete("/api/docs/:name", (c) => {
  try {
    const db = getDb()
    if (!hasDocsSchema(db)) {
      return c.json({ error: "Docs are not initialized. Run 'tx migrate' first." }, 404)
    }

    const name = c.req.param("name")
    const row = db.prepare(`
      SELECT id, status
      FROM docs
      WHERE name = ?
      ORDER BY version DESC
      LIMIT 1
    `).get(name) as { id: number; status: "changing" | "locked" } | undefined

    if (!row) {
      return c.json({ error: "Doc not found" }, 404)
    }
    if (row.status === "locked") {
      return c.json({ error: "Cannot delete a locked doc version" }, 409)
    }

    db.prepare("DELETE FROM docs WHERE id = ?").run(row.id)
    return c.json({ success: true, name })
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
      task: serializeTask(enrichedTask),
      blockedByTasks: blockedByTasks.map(serializeTask),
      blocksTasks: blocksTasks.map(serializeTask),
      childTasks: childTasks.map(serializeTask),
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

const port = Number(process.env.PORT ?? "3001")
console.log(`Dashboard API running on http://localhost:${port}`)

serve({ fetch: app.fetch, port })
