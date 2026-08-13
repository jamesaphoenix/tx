import { Database } from "bun:sqlite"
import { randomUUID } from "node:crypto"
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { resolve, dirname } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { spawn, execSync, type ChildProcess } from "node:child_process"
import { TASK_STATUSES, type TaskRow, type DependencyRow } from "@jamesaphoenix/tx/types"
import type { ActorRef } from "@jamesaphoenix/tx/types"
import { parse as parseYaml } from "yaml"
import { Effect } from "effect"
import {
  applyMigrations,
  asDocKind,
  computeDocHash,
  deriveDocStableId,
  escapeLikePattern,
  isPathWithin,
  isValidDocKind,
  makeMinimalLayer,
  MdDocParseError,
  parseMdDocSync,
  readTxConfig,
  renderDocToMarkdown,
  resolvePathWithin,
  SupervisionService,
} from "@jamesaphoenix/tx"

const __dirname = dirname(fileURLToPath(import.meta.url))
const fallbackRoot = resolve(__dirname, "../../..")
// TX_DB_PATH is set by the dashboard command to scope to the caller's CWD
const configuredDbPath = process.env.TX_DB_PATH ?? resolve(fallbackRoot, ".tx/tasks.db")
const dbPath = resolve(configuredDbPath)
const dbDir = dirname(dbPath)
const ralphLogPath = resolve(dbDir, "ralph-output.log")
const ralphPidPath = resolve(dbDir, "ralph.pid")
const txDir = resolve(dbDir)
const claudeDir = resolve(homedir(), ".claude")
const VALID_TASK_STATUSES = new Set<string>(TASK_STATUSES)
type DashboardDefaultTaskAssigmentType = "human" | "agent"
type DashboardDefaultTaskView = "list" | "kanban"
type CycleStatus = "current" | "upcoming" | "completed"
type DashboardCycleStartDay =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
type DashboardCycleSettings = {
  cycleLengthDays: number
  cycleStartDay: DashboardCycleStartDay
  carryStatuses: string[]
}
const VALID_ASSIGNEE_TYPES = new Set<DashboardDefaultTaskAssigmentType>(["human", "agent"])
const VALID_TASK_VIEWS = new Set<DashboardDefaultTaskView>(["list", "kanban"])
const VALID_CYCLE_START_DAYS = new Set<DashboardCycleStartDay>([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
])
const DASHBOARD_CONFIG_SECTION = "dashboard"
const DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY = "default_task_assigment_type"
const DASHBOARD_DEFAULT_TASK_VIEW_KEY = "default_task_view"
const DASHBOARD_CYCLES_SECTION = "dashboard.cycles"
const DASHBOARD_CYCLE_LENGTH_DAYS_KEY = "cycle_length_days"
const DASHBOARD_CYCLE_START_DAY_KEY = "cycle_start_day"
const DASHBOARD_CARRY_STATUSES_KEY = "carry_statuses"
const DEFAULT_DASHBOARD_CYCLE_SETTINGS: DashboardCycleSettings = {
  cycleLengthDays: 7,
  cycleStartDay: "monday",
  carryStatuses: ["planning", "active", "blocked", "review", "needs_review"],
}
const IN_PROGRESS_TASK_STATUSES = new Set<string>(["planning", "active", "blocked", "review", "needs_review"])
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
const DOC_STABLE_ID_PATTERN = /^doc-[a-f0-9]{12}$/
const LEGACY_LABEL_RENAMES = [
  { from: "DevOFps", to: "DevOps" },
] as const
const LEGACY_LABELS_TO_REMOVE = [
  "AISEO",
] as const

type JsonResponse = {
  readonly status: number
  readonly body: string
  readonly headers: Record<string, string>
}

type Context = {
  readonly req: {
    query: (name: string) => string | undefined
    param: (name: string) => string
    json: <T>() => Promise<T>
  }
  json: (body: unknown, status?: number) => JsonResponse
}

type Route = {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE"
  readonly path: string
  readonly regex: RegExp
  readonly paramNames: readonly string[]
  readonly handler: (context: Context) => JsonResponse | Promise<JsonResponse>
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

const applyCorsHeaders = (res: ServerResponse): void => {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value)
  }
}

const writeJsonResponse = (res: ServerResponse, response: JsonResponse): void => {
  applyCorsHeaders(res)
  for (const [key, value] of Object.entries(response.headers)) {
    res.setHeader(key, value)
  }
  res.statusCode = response.status
  res.end(response.body)
}

const compilePathPattern = (path: string): { regex: RegExp; paramNames: string[] } => {
  const paramNames: string[] = []
  const escapedSegments = path.split("/").map((segment) => {
    if (segment.startsWith(":")) {
      paramNames.push(segment.slice(1))
      return "([^/]+)"
    }
    return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  })
  return {
    regex: new RegExp(`^${escapedSegments.join("/")}$`),
    paramNames,
  }
}

class DashboardRouter {
  private readonly routes: Route[] = []

  get(path: string, handler: (context: Context) => JsonResponse | Promise<JsonResponse>): void {
    this.register("GET", path, handler)
  }

  post(path: string, handler: (context: Context) => JsonResponse | Promise<JsonResponse>): void {
    this.register("POST", path, handler)
  }

  patch(path: string, handler: (context: Context) => JsonResponse | Promise<JsonResponse>): void {
    this.register("PATCH", path, handler)
  }

  delete(path: string, handler: (context: Context) => JsonResponse | Promise<JsonResponse>): void {
    this.register("DELETE", path, handler)
  }

  private register(
    method: Route["method"],
    path: string,
    handler: (context: Context) => JsonResponse | Promise<JsonResponse>
  ): void {
    const compiled = compilePathPattern(path)
    this.routes.push({
      method,
      path,
      regex: compiled.regex,
      paramNames: compiled.paramNames,
      handler,
    })
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === "OPTIONS") {
      applyCorsHeaders(res)
      res.statusCode = 204
      res.end()
      return
    }

    const method = req.method as Route["method"] | undefined
    if (!method || (method !== "GET" && method !== "POST" && method !== "PATCH" && method !== "DELETE")) {
      writeJsonResponse(res, {
        status: 405,
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "Method not allowed" }),
      })
      return
    }

    const url = new URL(req.url ?? "/", "http://localhost")
    const pathname = url.pathname

    for (const route of this.routes) {
      if (route.method !== method) continue
      const match = route.regex.exec(pathname)
      if (!match) continue

      const params = new Map<string, string>()
      for (let i = 0; i < route.paramNames.length; i++) {
        const rawValue = match[i + 1] ?? ""
        try {
          params.set(route.paramNames[i]!, decodeURIComponent(rawValue))
        } catch {
          params.set(route.paramNames[i]!, rawValue)
        }
      }

      // Cap request bodies so a single connection cannot exhaust server memory
      // by streaming an unbounded payload before "end" fires.
      const MAX_BODY_BYTES = 1_048_576 // 1 MB
      let bodyTextPromise: Promise<string> | null = null
      const readBodyText = (): Promise<string> => {
        if (bodyTextPromise) return bodyTextPromise
        bodyTextPromise = new Promise((resolveBody, rejectBody) => {
          const chunks: Buffer[] = []
          let total = 0
          req.on("data", (chunk) => {
            const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk
            total += buf.length
            if (total > MAX_BODY_BYTES) {
              // Stop buffering; the route's catch maps this to a 413.
              rejectBody(new Error("Request body too large"))
              return
            }
            chunks.push(buf)
          })
          req.on("end", () => {
            resolveBody(Buffer.concat(chunks).toString("utf8"))
          })
          req.on("error", rejectBody)
        })
        return bodyTextPromise
      }

      const context: Context = {
        req: {
          query: (name: string): string | undefined => url.searchParams.get(name) ?? undefined,
          param: (name: string): string => params.get(name) ?? "",
          json: async <T>(): Promise<T> => {
            const raw = await readBodyText()
            return JSON.parse(raw) as T
          },
        },
        json: (body: unknown, status = 200): JsonResponse => ({
          status,
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(body),
        }),
      }

      try {
        const response = await route.handler(context)
        writeJsonResponse(res, response)
      } catch (error) {
        // Log the real error server-side; never leak internals (SQL text,
        // column names, absolute file paths, stack traces) to the HTTP client.
        console.error("[dashboard] Unhandled route error:", error)
        const tooLarge = error instanceof Error && error.message === "Request body too large"
        writeJsonResponse(res, {
          status: tooLarge ? 413 : 500,
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({ error: tooLarge ? "Request body too large" : "Internal server error" }),
        })
      }
      return
    }

    writeJsonResponse(res, {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Not found" }),
    })
  }
}

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
  if (isPathWithin(txDir, resolved, { useRealpath: true })) {
    return resolved
  }
  // Allow paths within ~/.claude directory (Claude Code transcripts)
  if (isPathWithin(claudeDir, resolved, { useRealpath: true })) {
    return resolved
  }
  return null
}

const app = new DashboardRouter()

// Lazy DB connection
let db: Database | null = null
const getDb = () => {
  if (!db) {
    if (!existsSync(dbPath)) {
      throw new Error(`Database not found at ${dbPath}. Run 'tx init' first.`)
    }
    db = new Database(dbPath)
    db.exec("PRAGMA foreign_keys = ON;")
    applyMigrations(db)
    ensureLabelDefaults(db)
  }
  return db
}

function ensureLabelDefaults(db: Database): void {
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

interface TaskRowWithAssignment extends TaskRow {
  assignee_type?: string | null
  assignee_id?: string | null
  assigned_at?: string | null
  assigned_by?: string | null
}

interface TaskCreatePayload {
  title?: string
  description?: string
  parentId?: string | null
  status?: string
  score?: number
  assigneeType?: DashboardDefaultTaskAssigmentType | null
  assigneeId?: string | null
  assignedAt?: string | null
  assignedBy?: string | null
  metadata?: Record<string, unknown>
}

interface TaskUpdatePayload {
  title?: string
  description?: string
  status?: string
  parentId?: string | null
  score?: number
  assigneeType?: DashboardDefaultTaskAssigmentType | null
  assigneeId?: string | null
  assignedAt?: string | null
  assignedBy?: string | null
  metadata?: Record<string, unknown>
}

interface SettingsResponse {
  dashboard: {
    defaultTaskAssigmentType: DashboardDefaultTaskAssigmentType
    defaultTaskView: DashboardDefaultTaskView
    cycles: DashboardCycleSettings
  }
}

interface SettingsPatchPayload {
  dashboard?: {
    defaultTaskAssigmentType?: DashboardDefaultTaskAssigmentType
    defaultTaskView?: DashboardDefaultTaskView
    cycles?: {
      cycleLengthDays?: number
      cycleStartDay?: string
      carryStatuses?: string[]
    }
  }
}

interface CycleRow {
  id: string
  name: string
  start_date: string
  end_date: string
  status: CycleStatus
  created_at: string
  updated_at: string
}

interface CycleListRow extends CycleRow {
  task_count: number | null
  completed_count: number | null
  in_progress_count: number | null
}

interface CycleSummaryResponse {
  id: string
  name: string
  startDate: string
  endDate: string
  status: CycleStatus
  createdAt: string
  updatedAt: string
  taskCount: number
  completedCount: number
  inProgressCount: number
}

interface CycleDetailResponse extends CycleSummaryResponse {
  tasks: TaskWithDepsResponse[]
  stats: {
    total: number
    completed: number
    inProgress: number
  }
}

interface CycleUpdatePayload {
  name?: string
  startDate?: string
  endDate?: string
}

interface AddCycleTasksPayload {
  taskIds?: string[]
}

interface CreateLabelPayload {
  name?: string
  color?: string
}

interface UpdateLabelPayload {
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
  doc_id: string | null
  hash: string
  kind: "overview" | "prd" | "design" | "requirement" | "system_design" | "runbook" | "decision"
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
  docId: string
  hash: string
  kind: "overview" | "prd" | "design" | "requirement" | "system_design" | "runbook" | "decision"
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

function isAssigneeType(
  value: string | null | undefined
): value is DashboardDefaultTaskAssigmentType | null {
  return value === undefined || value === null || VALID_ASSIGNEE_TYPES.has(value as DashboardDefaultTaskAssigmentType)
}

function isDashboardDefaultTaskView(
  value: string | null | undefined
): value is DashboardDefaultTaskView {
  return value !== undefined && value !== null && VALID_TASK_VIEWS.has(value as DashboardDefaultTaskView)
}

function isDashboardCycleStartDay(
  value: string | null | undefined
): value is DashboardCycleStartDay {
  return value !== undefined && value !== null && VALID_CYCLE_START_DAYS.has(value as DashboardCycleStartDay)
}

function normalizeAssigneeType(
  value: string | null | undefined
): DashboardDefaultTaskAssigmentType | null {
  return value === "human" || value === "agent" ? value : null
}

function toSettingsResponse(): SettingsResponse {
  return {
    dashboard: {
      defaultTaskAssigmentType: readDashboardDefaultTaskAssigmentType(process.cwd()),
      defaultTaskView: readDashboardDefaultTaskView(process.cwd()),
      cycles: readDashboardCycleSettings(process.cwd()),
    },
  }
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

function readDashboardDefaultTaskAssigmentType(
  cwd: string
): DashboardDefaultTaskAssigmentType {
  const configPath = resolve(cwd, ".tx", "config.toml")
  if (!existsSync(configPath)) {
    return "human"
  }
  try {
    const raw = readFileSync(configPath, "utf8")
    const configuredValue = extractTomlValue(
      raw,
      DASHBOARD_CONFIG_SECTION,
      DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY
    )
    if (configuredValue === "human" || configuredValue === "agent") {
      return configuredValue
    }
    return "human"
  } catch {
    return "human"
  }
}

function readDashboardDefaultTaskView(cwd: string): DashboardDefaultTaskView {
  const configPath = resolve(cwd, ".tx", "config.toml")
  if (!existsSync(configPath)) {
    return "list"
  }
  try {
    const raw = readFileSync(configPath, "utf8")
    const configuredValue = extractTomlValue(
      raw,
      DASHBOARD_CONFIG_SECTION,
      DASHBOARD_DEFAULT_TASK_VIEW_KEY
    )
    if (configuredValue === "list" || configuredValue === "kanban") {
      return configuredValue
    }
    return "list"
  } catch {
    return "list"
  }
}

function readDashboardCycleSettings(cwd: string): DashboardCycleSettings {
  const configPath = resolve(cwd, ".tx", "config.toml")
  if (!existsSync(configPath)) {
    return {
      ...DEFAULT_DASHBOARD_CYCLE_SETTINGS,
      carryStatuses: [...DEFAULT_DASHBOARD_CYCLE_SETTINGS.carryStatuses],
    }
  }
  try {
    const raw = readFileSync(configPath, "utf8")
    const cycleLengthRaw = extractTomlValue(
      raw,
      DASHBOARD_CYCLES_SECTION,
      DASHBOARD_CYCLE_LENGTH_DAYS_KEY
    )
    const cycleStartDayRaw = extractTomlValue(
      raw,
      DASHBOARD_CYCLES_SECTION,
      DASHBOARD_CYCLE_START_DAY_KEY
    )
    const carryStatusesRaw = extractTomlArray(
      raw,
      DASHBOARD_CYCLES_SECTION,
      DASHBOARD_CARRY_STATUSES_KEY
    )

    const cycleLengthParsed = cycleLengthRaw ? parseInt(cycleLengthRaw, 10) : NaN
    const cycleLengthDays = Number.isFinite(cycleLengthParsed) && cycleLengthParsed > 0
      ? cycleLengthParsed
      : DEFAULT_DASHBOARD_CYCLE_SETTINGS.cycleLengthDays
    const cycleStartDay = isDashboardCycleStartDay(cycleStartDayRaw)
      ? cycleStartDayRaw
      : DEFAULT_DASHBOARD_CYCLE_SETTINGS.cycleStartDay
    const carryStatuses = carryStatusesRaw
      .map((status) => status.trim())
      .filter((status) => status.length > 0)

    return {
      cycleLengthDays,
      cycleStartDay,
      carryStatuses: carryStatuses.length > 0
        ? carryStatuses
        : [...DEFAULT_DASHBOARD_CYCLE_SETTINGS.carryStatuses],
    }
  } catch {
    return {
      ...DEFAULT_DASHBOARD_CYCLE_SETTINGS,
      carryStatuses: [...DEFAULT_DASHBOARD_CYCLE_SETTINGS.carryStatuses],
    }
  }
}

function writeDashboardDefaultTaskAssigmentType(
  value: DashboardDefaultTaskAssigmentType,
  cwd: string
): void {
  const configPath = resolve(cwd, ".tx", "config.toml")
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const patched = patchTomlKey(
    existingRaw,
    DASHBOARD_CONFIG_SECTION,
    DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY,
    `"${value}"`
  )
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, patched.endsWith("\n") ? patched : `${patched}\n`, "utf8")
}

function writeDashboardDefaultTaskView(
  value: DashboardDefaultTaskView,
  cwd: string
): void {
  const configPath = resolve(cwd, ".tx", "config.toml")
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const patched = patchTomlKey(
    existingRaw,
    DASHBOARD_CONFIG_SECTION,
    DASHBOARD_DEFAULT_TASK_VIEW_KEY,
    `"${value}"`
  )
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, patched.endsWith("\n") ? patched : `${patched}\n`, "utf8")
}

function writeDashboardCycleLengthDays(value: number, cwd: string): void {
  const configPath = resolve(cwd, ".tx", "config.toml")
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const patched = patchTomlKey(
    existingRaw,
    DASHBOARD_CYCLES_SECTION,
    DASHBOARD_CYCLE_LENGTH_DAYS_KEY,
    `${value}`
  )
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, patched.endsWith("\n") ? patched : `${patched}\n`, "utf8")
}

function writeDashboardCycleStartDay(value: DashboardCycleStartDay, cwd: string): void {
  const configPath = resolve(cwd, ".tx", "config.toml")
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const patched = patchTomlKey(
    existingRaw,
    DASHBOARD_CYCLES_SECTION,
    DASHBOARD_CYCLE_START_DAY_KEY,
    `"${value}"`
  )
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, patched.endsWith("\n") ? patched : `${patched}\n`, "utf8")
}

function writeDashboardCarryStatuses(value: readonly string[], cwd: string): void {
  const configPath = resolve(cwd, ".tx", "config.toml")
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const renderedStatuses = `[${value.map((status) => JSON.stringify(status)).join(", ")}]`
  const patched = patchTomlKey(
    existingRaw,
    DASHBOARD_CYCLES_SECTION,
    DASHBOARD_CARRY_STATUSES_KEY,
    renderedStatuses
  )
  mkdirSync(dirname(configPath), { recursive: true })
  writeFileSync(configPath, patched.endsWith("\n") ? patched : `${patched}\n`, "utf8")
}

function extractTomlValue(toml: string, section: string, key: string): string | null {
  const lines = toml.split("\n")
  let inSection = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === `[${section}]`) {
      inSection = true
      continue
    }
    if (trimmed.startsWith("[") && inSection) {
      break
    }
    if (!inSection) continue
    const quoted = trimmed.match(new RegExp(`^${key}\\s*=\\s*["'](.+?)["']$`))
    if (quoted) {
      return quoted[1]
    }
    const unquoted = trimmed.match(new RegExp(`^${key}\\s*=\\s*([^#\\s]+)`))
    if (unquoted) {
      return unquoted[1]
    }
  }
  return null
}

function extractTomlArray(toml: string, section: string, key: string): string[] {
  const lines = toml.split("\n")
  let inSection = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === `[${section}]`) {
      inSection = true
      continue
    }
    if (trimmed.startsWith("[") && inSection) {
      break
    }
    if (!inSection) continue

    const arrayStart = new RegExp(`^${key}\\s*=\\s*\\[`).exec(trimmed)
    if (!arrayStart) continue

    let collected = trimmed
    while (!collected.includes("]") && i + 1 < lines.length) {
      i += 1
      collected += lines[i]!.trim()
    }

    const out: string[] = []
    const quoted = /["']([^"']+)["']/g
    let match: RegExpExecArray | null
    while ((match = quoted.exec(collected)) !== null) {
      if (match[1].trim().length > 0) {
        out.push(match[1].trim())
      }
    }
    return out
  }

  const fallback = extractTomlValue(toml, section, key)
  if (!fallback) return []
  return fallback.split(",").map((value) => value.trim()).filter(Boolean)
}

function patchTomlKey(
  toml: string,
  section: string,
  key: string,
  renderedValue: string
): string {
  const lines = toml.length > 0 ? toml.split("\n") : []
  const sectionHeader = `[${section}]`
  const sectionRegex = /^\s*\[[^\]]+\]\s*$/
  const keyRegex = new RegExp(`^(\\s*)${escapeRegex(key)}\\s*=`)

  let sectionStart = -1
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? "").trim() === sectionHeader) {
      sectionStart = i
      break
    }
  }

  const renderedLine = `${key} = ${renderedValue}`

  if (sectionStart === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("")
    }
    lines.push(sectionHeader, renderedLine)
    return lines.join("\n")
  }

  let sectionEnd = lines.length
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (sectionRegex.test(lines[i] ?? "")) {
      sectionEnd = i
      break
    }
  }

  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const line = lines[i] ?? ""
    const match = line.match(keyRegex)
    if (!match) continue
    const indent = match[1] ?? ""
    lines[i] = `${indent}${key} = ${renderedValue}`
    return lines.join("\n")
  }

  lines.splice(sectionEnd, 0, renderedLine)
  return lines.join("\n")
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRowWithAssignment | undefined
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

interface TaskRowWithDeps extends TaskRowWithAssignment {
  blockedBy: string[]
  blocks: string[]
  children: string[]
  isReady: boolean
  labels: TaskLabel[]
}

interface TaskDependencySnapshot {
  blockedByMap: Map<string, string[]>
  blocksMap: Map<string, string[]>
  childrenMap: Map<string, string[]>
  statusMap: Map<string, string>
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
  assigneeType: DashboardDefaultTaskAssigmentType | null
  assigneeId: string | null
  assignedAt: string | null
  assignedBy: string | null
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
    assigneeType: normalizeAssigneeType(task.assignee_type),
    assigneeId: task.assignee_id ?? null,
    assignedAt: task.assigned_at ?? null,
    assignedBy: task.assigned_by ?? null,
    metadata: parseTaskMetadata(task.metadata),
    blockedBy: task.blockedBy,
    blocks: task.blocks,
    children: task.children,
    isReady: task.isReady,
    labels: task.labels,
  }
}

const WEEKDAY_TO_INDEX: Record<DashboardCycleStartDay, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null

  const year = Number.parseInt(match[1]!, 10)
  const month = Number.parseInt(match[2]!, 10) - 1
  const day = Number.parseInt(match[3]!, 10)
  const parsed = new Date(Date.UTC(year, month, day))

  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month
    || parsed.getUTCDate() !== day
  ) {
    return null
  }

  return parsed
}

function addUtcDays(date: Date, days: number): Date {
  const next = startOfUtcDay(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function mostRecentStartDay(baseDate: Date, startDay: DashboardCycleStartDay): Date {
  const day = startOfUtcDay(baseDate)
  const target = WEEKDAY_TO_INDEX[startDay]
  const current = day.getUTCDay()
  const offset = (7 + current - target) % 7
  return addUtcDays(day, -offset)
}

function nextStartDay(baseDate: Date, startDay: DashboardCycleStartDay): Date {
  const day = startOfUtcDay(baseDate)
  const target = WEEKDAY_TO_INDEX[startDay]
  const current = day.getUTCDay()
  let offset = (7 + target - current) % 7
  if (offset === 0) offset = 7
  return addUtcDays(day, offset)
}

function serializeCycleSummary(row: CycleListRow): CycleSummaryResponse {
  return {
    id: row.id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    taskCount: Number(row.task_count ?? 0),
    completedCount: Number(row.completed_count ?? 0),
    inProgressCount: Number(row.in_progress_count ?? 0),
  }
}

function listCyclesWithStats(db: Database): CycleSummaryResponse[] {
  const inProgressStatuses = [...IN_PROGRESS_TASK_STATUSES]
  const inProgressPlaceholders = inProgressStatuses.map(() => "?").join(",")
  const rows = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.start_date,
      c.end_date,
      c.status,
      c.created_at,
      c.updated_at,
      COUNT(ct.task_id) as task_count,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as completed_count,
      SUM(CASE WHEN t.status IN (${inProgressPlaceholders}) THEN 1 ELSE 0 END) as in_progress_count
    FROM cycles c
    LEFT JOIN cycle_tasks ct ON ct.cycle_id = c.id
    LEFT JOIN tasks t ON t.id = ct.task_id
    GROUP BY c.id
    ORDER BY c.start_date DESC, c.created_at DESC
  `).all(...inProgressStatuses) as CycleListRow[]

  return rows.map(serializeCycleSummary)
}

function getCycleWithStats(db: Database, cycleId: string): CycleSummaryResponse | null {
  const inProgressStatuses = [...IN_PROGRESS_TASK_STATUSES]
  const inProgressPlaceholders = inProgressStatuses.map(() => "?").join(",")
  const row = db.prepare(`
    SELECT
      c.id,
      c.name,
      c.start_date,
      c.end_date,
      c.status,
      c.created_at,
      c.updated_at,
      COUNT(ct.task_id) as task_count,
      SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as completed_count,
      SUM(CASE WHEN t.status IN (${inProgressPlaceholders}) THEN 1 ELSE 0 END) as in_progress_count
    FROM cycles c
    LEFT JOIN cycle_tasks ct ON ct.cycle_id = c.id
    LEFT JOIN tasks t ON t.id = ct.task_id
    WHERE c.id = ?
    GROUP BY c.id
  `).get(...inProgressStatuses, cycleId) as CycleListRow | undefined

  return row ? serializeCycleSummary(row) : null
}

function getCycleRow(db: Database, cycleId: string): CycleRow | null {
  const row = db.prepare(`
    SELECT id, name, start_date, end_date, status, created_at, updated_at
    FROM cycles
    WHERE id = ?
    LIMIT 1
  `).get(cycleId) as CycleRow | undefined

  return row ?? null
}

function hasCurrentCycle(db: Database): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM cycles
    WHERE status = 'current'
    LIMIT 1
  `).get() as { 1: number } | undefined

  return Boolean(row)
}

function getNextUpcomingCycle(db: Database): CycleRow | null {
  const row = db.prepare(`
    SELECT id, name, start_date, end_date, status, created_at, updated_at
    FROM cycles
    WHERE status = 'upcoming'
    ORDER BY start_date ASC, created_at ASC
    LIMIT 1
  `).get() as CycleRow | undefined

  return row ?? null
}

function getLatestCycleWindow(db: Database): { end_date: string } | null {
  const row = db.prepare(`
    SELECT end_date
    FROM cycles
    ORDER BY start_date DESC, created_at DESC
    LIMIT 1
  `).get() as { end_date: string } | undefined

  return row ?? null
}

function computeCycleWindowAfter(endDate: string, config: DashboardCycleSettings): { startDate: string; endDate: string } {
  const parsed = parseDateOnly(endDate)
  if (!parsed) {
    return computeDefaultCycleWindow(config)
  }

  const startDate = formatDateOnly(startOfUtcDay(parsed))
  const nextEndDate = formatDateOnly(addUtcDays(parsed, config.cycleLengthDays))
  return { startDate, endDate: nextEndDate }
}

function getOrCreateNextCycle(db: Database, config: DashboardCycleSettings): CycleRow {
  const existingUpcoming = getNextUpcomingCycle(db)
  if (existingUpcoming) {
    return existingUpcoming
  }

  const latestCycle = getLatestCycleWindow(db)
  const window = latestCycle?.end_date
    ? computeCycleWindowAfter(latestCycle.end_date, config)
    : computeDefaultCycleWindow(config)
  const status: CycleStatus = hasCurrentCycle(db) ? "upcoming" : "current"

  return insertCycle(db, {
    startDate: window.startDate,
    endDate: window.endDate,
    status,
  })
}

function hasActiveCycleAssignment(db: Database, taskId: string): boolean {
  const row = db.prepare(`
    SELECT 1
    FROM cycle_tasks ct
    JOIN cycles c ON c.id = ct.cycle_id
    WHERE ct.task_id = ?
      AND c.status IN ('current', 'upcoming')
    LIMIT 1
  `).get(taskId) as { 1: number } | undefined

  return Boolean(row)
}

function maybeAddTaskToNextCycle(db: Database, taskId: string, taskStatus: string): void {
  if (taskStatus === "backlog" || hasActiveCycleAssignment(db, taskId)) {
    return
  }

  const config = readDashboardCycleSettings(process.cwd())
  const cycle = getOrCreateNextCycle(db, config)
  db.prepare(`
    INSERT OR IGNORE INTO cycle_tasks (cycle_id, task_id)
    VALUES (?, ?)
  `).run(cycle.id, taskId)
}

function nextCycleName(db: Database): string {
  const row = db.prepare("SELECT COUNT(*) as count FROM cycles").get() as { count: number }
  return `Cycle ${row.count + 1}`
}

function insertCycle(
  db: Database,
  input: {
    name?: string
    startDate: string
    endDate: string
    status: CycleStatus
  }
): CycleRow {
  const id = randomUUID()
  const name = input.name?.trim() || nextCycleName(db)
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO cycles (id, name, start_date, end_date, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, input.startDate, input.endDate, input.status, now, now)

  const created = getCycleRow(db, id)
  if (!created) {
    throw new Error("Failed to create cycle")
  }
  return created
}

function computeDefaultCycleWindow(config: DashboardCycleSettings): { startDate: string; endDate: string } {
  const now = new Date()
  const start = nextStartDay(now, config.cycleStartDay)
  const end = addUtcDays(start, config.cycleLengthDays)
  return {
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
  }
}

function computeCurrentCycleWindow(config: DashboardCycleSettings): { startDate: string; endDate: string } {
  const now = new Date()
  const start = mostRecentStartDay(now, config.cycleStartDay)
  const end = addUtcDays(start, config.cycleLengthDays)
  return {
    startDate: formatDateOnly(start),
    endDate: formatDateOnly(end),
  }
}

function shouldAutoCreateCurrentCycle(autoCreateQueryValue: string | undefined): boolean {
  if (!autoCreateQueryValue) return true
  return autoCreateQueryValue !== "false" && autoCreateQueryValue !== "0"
}

function serializeDoc(doc: DocRow): DocResponse {
  return {
    id: doc.id,
    docId: doc.doc_id ?? deriveDocStableId(`${doc.name}:${doc.version}`),
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

function materializeDocId(doc: Pick<DocRow, "doc_id" | "name" | "version">): string {
  return doc.doc_id ?? deriveDocStableId(`${doc.name}:${doc.version}`)
}

function parseDocVersionQuery(c: Context): number | undefined {
  const raw = c.req.query("version")
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function parseKindScopedDocRef(ref: string): { kind: string; name: string } | null {
  const normalized = ref.replace(/^specs\//, "").replace(/\.md$/i, "")
  const slashIndex = normalized.indexOf("/")
  if (slashIndex <= 0) return null
  const kind = normalized.slice(0, slashIndex)
  const name = normalized.slice(slashIndex + 1)
  if (!kind || !name || !isValidDocKind(kind)) return null
  return { kind, name }
}

function resolveDocRowByRef(db: Database, ref: string, version?: number): { row?: DocRow; error?: JsonResponse } {
  const selectBase = `
    SELECT id, doc_id, hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, locked_at
    FROM docs
  `

  if (DOC_STABLE_ID_PATTERN.test(ref)) {
    const query = version
      ? `${selectBase} WHERE doc_id = ? AND version = ? LIMIT 1`
      : `${selectBase} WHERE doc_id = ? ORDER BY version DESC LIMIT 1`
    const row = (version
      ? db.prepare(query).get(ref, version)
      : db.prepare(query).get(ref)) as DocRow | undefined
    if (row) return { row }

    const legacyCandidates = (version
      ? db.prepare(`${selectBase} WHERE version = ?`).all(version)
      : db.prepare(`${selectBase} ORDER BY version DESC`).all()) as DocRow[]
    const fallback = legacyCandidates.find((candidate) => materializeDocId(candidate) === ref)
    return fallback ? { row: fallback } : {}
  }

  const scoped = parseKindScopedDocRef(ref)
  if (scoped) {
    const query = version
      ? `${selectBase} WHERE kind = ? AND name = ? AND version = ? LIMIT 1`
      : `${selectBase} WHERE kind = ? AND name = ? ORDER BY version DESC LIMIT 1`
    const row = (version
      ? db.prepare(query).get(scoped.kind, scoped.name, version)
      : db.prepare(query).get(scoped.kind, scoped.name)) as DocRow | undefined
    return row ? { row } : {}
  }

  const rows = (version
    ? db.prepare(`${selectBase} WHERE name = ? AND version = ? ORDER BY kind ASC LIMIT 10`).all(ref, version)
    : db.prepare(`${selectBase} WHERE name = ? ORDER BY version DESC, kind ASC LIMIT 10`).all(ref)) as DocRow[]
  if (rows.length === 0) return {}

  const distinctKinds = [...new Set(rows.map((row) => row.kind))]
  if (distinctKinds.length > 1) {
    return {
      error: {
        status: 409,
        body: JSON.stringify({
          error: `Doc reference '${ref}' is ambiguous across kinds (${distinctKinds.join(", ")}). Use docId instead.`,
        }),
        headers: { "Content-Type": "application/json" },
      },
    }
  }

  return { row: rows[0] }
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
      const kind = isValidDocKind(kindRaw) ? kindRaw : asDocKind("overview")
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

/**
 * Normalize a doc file_path from the DB to match the actual filesystem layout.
 * Handles legacy paths where kind was used directly as subdirectory name
 * (e.g. "requirement/" instead of "requirements/", "system_design/" instead of "system-design/").
 */
function normalizeDocFilePath(filePath: string): string {
  return filePath
    .replace(/^requirement\//, "requirements/")
    .replace(/^system_design\//, "system-design/")
}

const PLACEHOLDER_TEXT_BY_KIND: Record<string, readonly string[]> = {
  overview: [
    "Describe the system overview.",
    "What problem this system solves.",
    "Included: ...",
    "Excluded: ...",
  ],
  prd: [
    "Describe the purpose of this PRD.",
    "Describe the problem this feature solves.",
    "the system shall do X",
    "criterion description",
  ],
  design: [
    "Describe the design approach.",
    "No data model changes.",
    "Unresolved design decisions",
  ],
  requirement: [
    "One-sentence behavioral description.",
    "The system shall do something",
  ],
  system_design: [
    "What cross-cutting concern this describes.",
    "Which features/subsystems this applies to.",
    "Architecture, patterns, data flow, service boundaries.",
  ],
  runbook: [
    "Describe when to use this runbook.",
    "Describe observable symptoms.",
    "How to confirm root cause.",
    "Step-by-step mitigation actions.",
    "When and how to escalate.",
  ],
  decision: [
    "One-line decision summary.",
    "Describe the context and constraints.",
    "List alternatives considered.",
    "Record the chosen option.",
    "Document expected trade-offs and impacts.",
  ],
}

function kindSubdir(kind: string): string {
  if (kind === "overview") return ""
  if (kind === "requirement") return "requirements"
  if (kind === "system_design") return "system-design"
  return kind
}

function resolveDocMdRelativePath(kind: string, name: string): string {
  const sub = kindSubdir(kind)
  return sub ? `${sub}/${name}.md` : `${name}.md`
}

/** Strip YAML frontmatter (--- delimited) from markdown content. */
function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) return content
  // Find closing --- delimiter — must occupy an entire line (not a partial match like -----)
  let search = 3
  while (true) {
    const idx = content.indexOf("\n---", search)
    if (idx === -1) return content // no closing delimiter — return as-is
    const afterDashes = idx + 4
    const next = content[afterDashes]
    // Valid closing: end of string, newline, or carriage return
    if (next === undefined || next === "\n" || next === "\r") {
      let end = afterDashes
      if (content[end] === "\r") end++
      if (content[end] === "\n") end++
      return content.slice(end)
    }
    search = idx + 1
  }
}

function formatMarkdownParseProblem(error: unknown): string {
  if (error instanceof MdDocParseError) {
    return `Markdown parse error: ${error.reason}`
  }
  return "Markdown parse error: unable to parse document content."
}

function findPlaceholderProblems(
  kind: string,
  parsed: {
    frontmatter: { title?: unknown; summary?: unknown }
    sections: ReadonlyArray<{ heading: string; body: string }>
  }
): string[] {
  const placeholders = PLACEHOLDER_TEXT_BY_KIND[kind] ?? []
  const problems: string[] = []
  const seen = new Set<string>()

  const checkValue = (field: string, value: unknown): void => {
    if (value === undefined || value === null) return
    const haystack = (typeof value === "string" ? value : JSON.stringify(value)).toLowerCase()
    for (const placeholder of placeholders) {
      const marker = placeholder.toLowerCase()
      if (!haystack.includes(marker)) continue

      const problem = `Placeholder text in '${field}': "${placeholder}"`
      if (!seen.has(problem)) {
        seen.add(problem)
        problems.push(problem)
      }
    }
  }

  checkValue("frontmatter.title", parsed.frontmatter.title)
  checkValue("frontmatter.summary", parsed.frontmatter.summary)

  for (const section of parsed.sections) {
    checkValue(`section.${section.heading}`, section.body)
  }

  return problems
}

const WORKABLE_TASK_STATUSES = new Set<string>(["backlog", "ready", "planning"])

function pushToMapList(map: Map<string, string[]>, key: string, value: string): void {
  const existing = map.get(key)
  if (existing) {
    existing.push(value)
    return
  }
  map.set(key, [value])
}

function buildDependencySnapshot(
  db: Database,
  allTasks?: ReadonlyArray<Pick<TaskRowWithAssignment, "id" | "parent_id" | "status">>
): TaskDependencySnapshot {
  const deps = db.prepare("SELECT blocker_id, blocked_id FROM task_dependencies").all() as DependencyRow[]
  const blockedByMap = new Map<string, string[]>()
  const blocksMap = new Map<string, string[]>()

  for (const dep of deps) {
    pushToMapList(blockedByMap, dep.blocked_id, dep.blocker_id)
    pushToMapList(blocksMap, dep.blocker_id, dep.blocked_id)
  }

  const tasksForSnapshot = allTasks
    ?? (db.prepare("SELECT id, parent_id, status FROM tasks").all() as Array<{
      id: string
      parent_id: string | null
      status: string
    }>)

  const childrenMap = new Map<string, string[]>()
  const statusMap = new Map<string, string>()
  for (const task of tasksForSnapshot) {
    statusMap.set(task.id, task.status)
    if (task.parent_id) {
      pushToMapList(childrenMap, task.parent_id, task.id)
    }
  }

  return { blockedByMap, blocksMap, childrenMap, statusMap }
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

function buildTaskCursor(task: TaskRowWithAssignment): string {
  return `${task.score}:${task.id}`
}

function buildRunCursor(run: { startedAt: string; id: string }): string {
  return `${run.startedAt}:${run.id}`
}


// Helper to enrich tasks with dependency info
function enrichTasksWithDeps(
  db: Database,
  tasks: TaskRowWithAssignment[],
  snapshot?: TaskDependencySnapshot
): TaskRowWithDeps[] {
  const dependencySnapshot = snapshot ?? buildDependencySnapshot(db)
  const labelsByTask = loadTaskLabelsMap(db, tasks.map(t => t.id))

  return tasks.map(task => {
    const blockedBy = dependencySnapshot.blockedByMap.get(task.id) ?? []
    const blocks = dependencySnapshot.blocksMap.get(task.id) ?? []
    const children = dependencySnapshot.childrenMap.get(task.id) ?? []
    const allBlockersDone = blockedBy.every(id => dependencySnapshot.statusMap.get(id) === "done")
    const isReady = WORKABLE_TASK_STATUSES.has(task.status) && allBlockersDone
    const labels = labelsByTask.get(task.id) ?? []

    return { ...task, blockedBy, blocks, children, isReady, labels }
  })
}

app.get("/api/settings", (c) => {
  try {
    return c.json(toSettingsResponse())
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

app.patch("/api/settings", async (c) => {
  try {
    const payload = await c.req.json<SettingsPatchPayload>()
    const nextType = payload?.dashboard?.defaultTaskAssigmentType
    const nextTaskView = payload?.dashboard?.defaultTaskView
    const nextCycleLengthDays = payload?.dashboard?.cycles?.cycleLengthDays
    const nextCycleStartDay = payload?.dashboard?.cycles?.cycleStartDay
    const nextCarryStatuses = payload?.dashboard?.cycles?.carryStatuses

    if (
      nextType === undefined
      && nextTaskView === undefined
      && nextCycleLengthDays === undefined
      && nextCycleStartDay === undefined
      && nextCarryStatuses === undefined
    ) {
      return c.json({ error: "At least one dashboard setting must be provided" }, 400)
    }

    if (nextType !== undefined && (!isAssigneeType(nextType) || nextType === null)) {
      return c.json({ error: "dashboard.defaultTaskAssigmentType must be \"human\" or \"agent\"" }, 400)
    }

    if (nextTaskView !== undefined && !isDashboardDefaultTaskView(nextTaskView)) {
      return c.json({ error: "dashboard.defaultTaskView must be \"list\" or \"kanban\"" }, 400)
    }

    if (
      nextCycleLengthDays !== undefined
      && (!Number.isFinite(nextCycleLengthDays) || !Number.isInteger(nextCycleLengthDays) || nextCycleLengthDays <= 0)
    ) {
      return c.json({ error: "dashboard.cycles.cycleLengthDays must be a positive integer" }, 400)
    }

    if (nextCycleStartDay !== undefined && !isDashboardCycleStartDay(nextCycleStartDay)) {
      return c.json({
        error: "dashboard.cycles.cycleStartDay must be one of: sunday, monday, tuesday, wednesday, thursday, friday, saturday",
      }, 400)
    }

    const normalizedCarryStatuses = nextCarryStatuses
      ?.map((status) => status.trim())
      .filter((status) => status.length > 0)

    if (nextCarryStatuses !== undefined && (!normalizedCarryStatuses || normalizedCarryStatuses.length === 0)) {
      return c.json({ error: "dashboard.cycles.carryStatuses must contain at least one status" }, 400)
    }

    if (nextType !== undefined) {
      writeDashboardDefaultTaskAssigmentType(nextType, process.cwd())
    }
    if (nextTaskView !== undefined) {
      writeDashboardDefaultTaskView(nextTaskView, process.cwd())
    }
    if (nextCycleLengthDays !== undefined) {
      writeDashboardCycleLengthDays(nextCycleLengthDays, process.cwd())
    }
    if (nextCycleStartDay !== undefined) {
      writeDashboardCycleStartDay(nextCycleStartDay, process.cwd())
    }
    if (normalizedCarryStatuses !== undefined) {
      writeDashboardCarryStatuses(normalizedCarryStatuses, process.cwd())
    }
    return c.json(toSettingsResponse())
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/cycles - list cycles (newest first), auto-create current cycle when missing
app.get("/api/cycles", (c) => {
  try {
    const db = getDb()
    const config = readDashboardCycleSettings(process.cwd())
    const shouldAutoCreate = shouldAutoCreateCurrentCycle(c.req.query("autoCreate"))

    if (shouldAutoCreate && !hasCurrentCycle(db)) {
      const nextUpcoming = getNextUpcomingCycle(db)
      if (nextUpcoming) {
        db.prepare(`
          UPDATE cycles
          SET status = 'current', updated_at = ?
          WHERE id = ?
        `).run(new Date().toISOString(), nextUpcoming.id)
      } else {
        const { startDate, endDate } = computeCurrentCycleWindow(config)
        try {
          insertCycle(db, { startDate, endDate, status: "current" })
        } catch (error) {
          // Another concurrent request may have created the current cycle first.
          if (!String(error).includes("idx_cycles_single_current")) {
            throw error
          }
        }
      }
    }

    return c.json({ cycles: listCyclesWithStats(db) })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// POST /api/cycles - create next cycle
app.post("/api/cycles", (c) => {
  try {
    const db = getDb()
    const config = readDashboardCycleSettings(process.cwd())
    const latestCycle = db.prepare(`
      SELECT end_date
      FROM cycles
      ORDER BY start_date DESC, created_at DESC
      LIMIT 1
    `).get() as { end_date: string } | undefined

    const window = latestCycle?.end_date
      ? (() => {
        const parsed = parseDateOnly(latestCycle.end_date)
        if (!parsed) return computeDefaultCycleWindow(config)
        const startDate = formatDateOnly(startOfUtcDay(parsed))
        const endDate = formatDateOnly(addUtcDays(parsed, config.cycleLengthDays))
        return { startDate, endDate }
      })()
      : computeDefaultCycleWindow(config)

    const status: CycleStatus = hasCurrentCycle(db) ? "upcoming" : "current"
    const created = insertCycle(db, {
      startDate: window.startDate,
      endDate: window.endDate,
      status,
    })
    const createdWithStats = getCycleWithStats(db, created.id)
    if (!createdWithStats) {
      return c.json({ error: "Failed to load created cycle" }, 500)
    }
    return c.json(createdWithStats, 201)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/cycles/:id - cycle detail with tasks and stats
app.get("/api/cycles/:id", (c) => {
  try {
    const db = getDb()
    const cycleId = c.req.param("id")
    const cycle = getCycleWithStats(db, cycleId)
    if (!cycle) {
      return c.json({ error: "Cycle not found" }, 404)
    }

    const taskIdRows = db.prepare(`
      SELECT task_id
      FROM cycle_tasks
      WHERE cycle_id = ?
      ORDER BY added_at ASC
    `).all(cycleId) as Array<{ task_id: string }>

    const tasks: TaskWithDepsResponse[] = []
    for (const row of taskIdRows) {
      const task = getTaskWithDeps(db, row.task_id)
      if (task) {
        tasks.push(serializeTask(task))
      }
    }

    const detail: CycleDetailResponse = {
      ...cycle,
      tasks,
      stats: {
        total: tasks.length,
        completed: tasks.filter((task) => task.status === "done").length,
        inProgress: tasks.filter((task) => IN_PROGRESS_TASK_STATUSES.has(task.status)).length,
      },
    }

    return c.json(detail)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// PATCH /api/cycles/:id - update cycle metadata
app.patch("/api/cycles/:id", async (c) => {
  try {
    const db = getDb()
    const cycleId = c.req.param("id")
    const existing = getCycleRow(db, cycleId)
    if (!existing) {
      return c.json({ error: "Cycle not found" }, 404)
    }

    const payload = await c.req.json<CycleUpdatePayload>()
    const hasNameUpdate = payload.name !== undefined
    const hasStartDateUpdate = payload.startDate !== undefined
    const hasEndDateUpdate = payload.endDate !== undefined

    if (!hasNameUpdate && !hasStartDateUpdate && !hasEndDateUpdate) {
      return c.json({ error: "At least one cycle field must be provided" }, 400)
    }

    const nextName = hasNameUpdate ? payload.name?.trim() : existing.name
    if (!nextName) {
      return c.json({ error: "Cycle name cannot be empty" }, 400)
    }

    const nextStartDate = hasStartDateUpdate ? payload.startDate : existing.start_date
    const nextEndDate = hasEndDateUpdate ? payload.endDate : existing.end_date
    const parsedStartDate = nextStartDate ? parseDateOnly(nextStartDate) : null
    const parsedEndDate = nextEndDate ? parseDateOnly(nextEndDate) : null

    if (!parsedStartDate || !parsedEndDate) {
      return c.json({ error: "startDate and endDate must be valid YYYY-MM-DD values" }, 400)
    }
    if (parsedStartDate.getTime() > parsedEndDate.getTime()) {
      return c.json({ error: "startDate must be on or before endDate" }, 400)
    }

    const normalizedStartDate = formatDateOnly(parsedStartDate)
    const normalizedEndDate = formatDateOnly(parsedEndDate)

    db.prepare(`
      UPDATE cycles
      SET name = ?, start_date = ?, end_date = ?, updated_at = ?
      WHERE id = ?
    `).run(nextName, normalizedStartDate, normalizedEndDate, new Date().toISOString(), cycleId)

    const updated = getCycleWithStats(db, cycleId)
    if (!updated) {
      return c.json({ error: "Failed to load updated cycle" }, 500)
    }
    return c.json(updated)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// POST /api/cycles/:id/tasks - add tasks to cycle (duplicate-safe)
app.post("/api/cycles/:id/tasks", async (c) => {
  try {
    const db = getDb()
    const cycleId = c.req.param("id")
    const cycle = getCycleRow(db, cycleId)
    if (!cycle) {
      return c.json({ error: "Cycle not found" }, 404)
    }

    const payload = await c.req.json<AddCycleTasksPayload>()
    const taskIds = (payload.taskIds ?? []).map((taskId) => taskId.trim()).filter((taskId) => taskId.length > 0)
    const uniqueTaskIds = [...new Set(taskIds)]

    if (uniqueTaskIds.length === 0) {
      return c.json({ success: true, cycleId, addedCount: 0 })
    }

    const placeholders = uniqueTaskIds.map(() => "?").join(",")
    const existingTasks = db.prepare(`
      SELECT id
      FROM tasks
      WHERE id IN (${placeholders})
    `).all(...uniqueTaskIds) as Array<{ id: string }>
    const existingTaskIds = new Set(existingTasks.map((task) => task.id))
    const missingTaskIds = uniqueTaskIds.filter((taskId) => !existingTaskIds.has(taskId))
    if (missingTaskIds.length > 0) {
      return c.json({ error: `Task not found: ${missingTaskIds.join(", ")}` }, 400)
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO cycle_tasks (cycle_id, task_id)
      VALUES (?, ?)
    `)

    let addedCount = 0
    for (const taskId of uniqueTaskIds) {
      const result = insert.run(cycleId, taskId)
      addedCount += Number(result.changes ?? 0)
    }

    return c.json({ success: true, cycleId, addedCount })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// DELETE /api/cycles/:id/tasks/:taskId - remove task from cycle
app.delete("/api/cycles/:id/tasks/:taskId", (c) => {
  try {
    const db = getDb()
    const cycleId = c.req.param("id")
    const taskId = c.req.param("taskId")
    const cycle = getCycleRow(db, cycleId)
    if (!cycle) {
      return c.json({ error: "Cycle not found" }, 404)
    }

    const result = db.prepare(`
      DELETE FROM cycle_tasks
      WHERE cycle_id = ? AND task_id = ?
    `).run(cycleId, taskId)

    return c.json({
      success: true,
      cycleId,
      taskId,
      removed: Number(result.changes ?? 0) > 0,
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// POST /api/cycles/:id/complete - complete cycle and carry tasks to next cycle
app.post("/api/cycles/:id/complete", (c) => {
  try {
    const db = getDb()
    const cycleId = c.req.param("id")
    const cycle = getCycleRow(db, cycleId)
    if (!cycle) {
      return c.json({ error: "Cycle not found" }, 404)
    }
    if (cycle.status === "completed") {
      return c.json({ error: "Cycle is already completed" }, 400)
    }
    if (cycle.status !== "current") {
      return c.json({ error: "Only current cycles can be completed" }, 400)
    }

    const config = readDashboardCycleSettings(process.cwd())
    const carryStatuses = config.carryStatuses.map((status) => status.trim()).filter((status) => status.length > 0)
    const now = new Date().toISOString()
    let nextCycleId = ""
    let carriedTaskIds: string[] = []

    db.exec("BEGIN IMMEDIATE")
    try {
      db.prepare(`
        UPDATE cycles
        SET status = 'completed', updated_at = ?
        WHERE id = ?
      `).run(now, cycleId)

      if (carryStatuses.length > 0) {
        const carryStatusPlaceholders = carryStatuses.map(() => "?").join(",")
        const rows = db.prepare(`
          SELECT t.id
          FROM cycle_tasks ct
          JOIN tasks t ON t.id = ct.task_id
          WHERE ct.cycle_id = ?
            AND t.status != 'done'
            AND t.status IN (${carryStatusPlaceholders})
          ORDER BY t.updated_at DESC, t.id ASC
        `).all(cycleId, ...carryStatuses) as Array<{ id: string }>
        carriedTaskIds = rows.map((row) => row.id)
      }

      let nextCycle = getNextUpcomingCycle(db)
      if (nextCycle) {
        db.prepare(`
          UPDATE cycles
          SET status = 'current', updated_at = ?
          WHERE id = ?
        `).run(now, nextCycle.id)
        nextCycle = getCycleRow(db, nextCycle.id)
      } else {
        const startFrom = parseDateOnly(cycle.end_date) ?? nextStartDay(new Date(), config.cycleStartDay)
        const startDate = formatDateOnly(startOfUtcDay(startFrom))
        const endDate = formatDateOnly(addUtcDays(startFrom, config.cycleLengthDays))
        nextCycle = insertCycle(db, { startDate, endDate, status: "current" })
      }

      if (!nextCycle) {
        throw new Error("Failed to resolve next cycle")
      }

      nextCycleId = nextCycle.id
      if (carriedTaskIds.length > 0) {
        const insert = db.prepare(`
          INSERT OR IGNORE INTO cycle_tasks (cycle_id, task_id)
          VALUES (?, ?)
        `)
        for (const taskId of carriedTaskIds) {
          insert.run(nextCycle.id, taskId)
        }
      }

      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }

    const completedCycle = getCycleWithStats(db, cycleId)
    const newCycle = getCycleWithStats(db, nextCycleId)
    if (!completedCycle || !newCycle) {
      return c.json({ error: "Failed to load cycle completion result" }, 500)
    }

    return c.json({ completedCycle, newCycle, carriedTaskIds })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/tasks - with cursor-based pagination
app.get("/api/tasks", (c) => {
  try {
    const db = getDb()
    const cursor = c.req.query("cursor")
    const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100)
    const statusFilter = c.req.query("status")?.split(",").filter(Boolean)
    const search = c.req.query("search")
    const labelIdRaw = c.req.query("labelId")
    const parentId = c.req.query("parentId")?.trim()
    let labelId: number | null = null

    if (labelIdRaw !== undefined) {
      const parsedLabelId = parseInt(labelIdRaw, 10)
      if (Number.isNaN(parsedLabelId)) {
        return c.json({ error: `Invalid label ID: ${labelIdRaw}` }, 400)
      }
      labelId = parsedLabelId
    }

    // Build WHERE clauses
    const conditions: string[] = []
    const params: (string | number)[] = []
    const joins: string[] = []

    if (labelId !== null) {
      joins.push("JOIN task_label_assignments tla ON tla.task_id = tasks.id")
      conditions.push("tla.label_id = ?")
      params.push(labelId)
    }

    if (statusFilter?.length) {
      conditions.push(`tasks.status IN (${statusFilter.map(() => "?").join(",")})`)
      params.push(...statusFilter)
    }

    if (search) {
      const searchPattern = `%${escapeLikePattern(search)}%`
      conditions.push("(tasks.title LIKE ? ESCAPE '\\' OR tasks.description LIKE ? ESCAPE '\\')")
      params.push(searchPattern, searchPattern)
    }

    if (parentId) {
      conditions.push("tasks.parent_id = ?")
      params.push(parentId)
    }

    if (cursor) {
      const { score, id } = parseTaskCursor(cursor)
      conditions.push("(tasks.score < ? OR (tasks.score = ? AND tasks.id > ?))")
      params.push(score, score, id)
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""
    const joinClause = joins.length ? joins.join(" ") : ""

    // Fetch limit + 1 to check hasMore
    const sql = `
      SELECT tasks.* FROM tasks
      ${joinClause}
      ${whereClause}
      ORDER BY tasks.score DESC, tasks.id ASC
      LIMIT ?
    `
    params.push(limit + 1)

    const rows = db.prepare(sql).all(...params) as TaskRowWithAssignment[]
    const hasMore = rows.length > limit
    const tasks = hasMore ? rows.slice(0, limit) : rows

    // Get total count for display (without cursor condition)
    const countConditions = conditions.filter((_, i) => {
      // Remove cursor condition (last 3 params if cursor exists)
      return !cursor || i < conditions.length - 1
    })
    const countParams = cursor ? params.slice(0, -4) : params.slice(0, -1) // Remove limit and cursor params
    const countWhereClause = countConditions.length ? `WHERE ${countConditions.join(" AND ")}` : ""
    const total = (
      db.prepare(`SELECT COUNT(*) as count FROM tasks ${joinClause} ${countWhereClause}`).get(...countParams) as { count: number }
    ).count

    const dependencySnapshot = buildDependencySnapshot(db)

    // Enrich with deps
    const enriched = enrichTasksWithDeps(db, tasks, dependencySnapshot)

    // Summary (from all tasks matching filter, not just current page)
    const summaryRows = db.prepare(`
      SELECT tasks.status as status, COUNT(*) as count
      FROM tasks
      ${joinClause}
      ${countWhereClause}
      GROUP BY tasks.status
    `).all(...countParams) as Array<{ status: string; count: number }>
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
    const defaultAssigneeType = readDashboardDefaultTaskAssigmentType(process.cwd())
    const requestedAssigneeType = payload.assigneeType === undefined
      ? defaultAssigneeType
      : payload.assigneeType
    const metadata = payload.metadata ?? {}

    if (!isTaskStatus(status)) {
      return c.json({
        error: `Invalid status "${status}". Valid statuses: ${TASK_STATUSES.join(", ")}`,
      }, 400)
    }

    if (!isAssigneeType(requestedAssigneeType)) {
      return c.json({
        error: `Invalid assigneeType "${String(payload.assigneeType)}". Valid values: human, agent, null`,
      }, 400)
    }

    const assigneeType = requestedAssigneeType ?? null
    const assigneeId = assigneeType === null ? null : (payload.assigneeId ?? null)
    const assignedAt = assigneeType === null ? null : (payload.assignedAt ?? now)
    const assignedBy = assigneeType === null ? null : (payload.assignedBy ?? "dashboard:create")

    db.prepare(`
      INSERT INTO tasks (
        id, title, description, status, parent_id, score, created_at, updated_at, completed_at,
        assignee_type, assignee_id, assigned_at, assigned_by, metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      assigneeType,
      assigneeId,
      assignedAt,
      assignedBy,
      JSON.stringify(metadata),
    )

    if (assignedBy !== "dashboard:cycle-composer") {
      maybeAddTaskToNextCycle(db, id, status)
    }

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

    const existing = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRowWithAssignment | undefined
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

    if (!isAssigneeType(payload.assigneeType)) {
      return c.json({
        error: `Invalid assigneeType "${String(payload.assigneeType)}". Valid values: human, agent, null`,
      }, 400)
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

    const existingAssigneeType = isAssigneeType(existing.assignee_type)
      ? existing.assignee_type
      : null
    const assigneeTypeChanged = payload.assigneeType !== undefined
      && payload.assigneeType !== existingAssigneeType
    const assigneeIdChanged = payload.assigneeId !== undefined
      && payload.assigneeId !== (existing.assignee_id ?? null)

    let nextAssigneeType = payload.assigneeType !== undefined
      ? payload.assigneeType
      : existingAssigneeType
    let nextAssigneeId = payload.assigneeId !== undefined
      ? payload.assigneeId
      : (existing.assignee_id ?? null)
    let nextAssignedAt = payload.assignedAt !== undefined
      ? payload.assignedAt
      : (existing.assigned_at ?? null)
    let nextAssignedBy = payload.assignedBy !== undefined
      ? payload.assignedBy
      : (existing.assigned_by ?? null)

    if (nextAssigneeType === null) {
      nextAssigneeId = null
      nextAssignedAt = null
      nextAssignedBy = null
    } else if ((assigneeTypeChanged || assigneeIdChanged) && payload.assignedAt === undefined) {
      nextAssignedAt = now
      if (payload.assignedBy === undefined) {
        nextAssignedBy = "dashboard:update"
      }
    }

    db.prepare(`
      UPDATE tasks
      SET title = ?,
          description = ?,
          status = ?,
          parent_id = ?,
          score = ?,
          updated_at = ?,
          completed_at = ?,
          assignee_type = ?,
          assignee_id = ?,
          assigned_at = ?,
          assigned_by = ?,
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
      nextAssigneeType,
      nextAssigneeId,
      nextAssignedAt,
      nextAssignedBy,
      JSON.stringify(mergedMetadata),
      id,
    )

    maybeAddTaskToNextCycle(db, id, nextStatus)

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

const updateLabelHandler = async (c: Context) => {
  try {
    const db = getDb()
    const labelIdRaw = c.req.param("labelId")
    const labelId = parseInt(labelIdRaw, 10)
    if (isNaN(labelId)) {
      return c.json({ error: `Invalid label ID: ${labelIdRaw}` }, 400)
    }

    const existing = db.prepare(`
      SELECT id, name, color, created_at, updated_at
      FROM task_labels
      WHERE id = ?
      LIMIT 1
    `).get(labelId) as TaskLabelRow | undefined
    if (!existing) {
      return c.json({ error: "Label not found" }, 404)
    }

    const payload = await c.req.json<UpdateLabelPayload>()
    const nextName = payload.name !== undefined ? normalizeLabelName(payload.name) : existing.name
    if (!nextName) {
      return c.json({ error: "Label name is required" }, 400)
    }
    const nextColor = payload.color?.trim() || existing.color
    if (!nextColor) {
      return c.json({ error: "Label color is required" }, 400)
    }

    const duplicate = db.prepare(`
      SELECT id
      FROM task_labels
      WHERE lower(name) = lower(?)
        AND id != ?
      LIMIT 1
    `).get(nextName, labelId) as { id: number } | undefined
    if (duplicate) {
      return c.json({ error: `Label already exists: ${nextName}` }, 409)
    }

    const now = new Date().toISOString()
    db.prepare(`
      UPDATE task_labels
      SET name = ?, color = ?, updated_at = ?
      WHERE id = ?
    `).run(nextName, nextColor, now, labelId)

    const updated = db.prepare(`
      SELECT id, name, color, created_at, updated_at
      FROM task_labels
      WHERE id = ?
      LIMIT 1
    `).get(labelId) as TaskLabelRow | undefined
    if (!updated) {
      return c.json({ error: "Failed to load updated label" }, 500)
    }

    return c.json(toTaskLabel(updated))
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
}

// PATCH /api/labels/:labelId - update label metadata
app.patch("/api/labels/:labelId", updateLabelHandler)
// Backward-compatible alias for older clients.
app.patch("/api/task-labels/:labelId", updateLabelHandler)

const deleteLabelHandler = (c: Context) => {
  try {
    const db = getDb()
    const labelIdRaw = c.req.param("labelId")
    const labelId = parseInt(labelIdRaw, 10)
    if (isNaN(labelId)) {
      return c.json({ error: `Invalid label ID: ${labelIdRaw}` }, 400)
    }

    const existing = db.prepare("SELECT 1 FROM task_labels WHERE id = ?").get(labelId)
    if (!existing) {
      return c.json({ error: "Label not found" }, 404)
    }

    db.prepare("DELETE FROM task_labels WHERE id = ?").run(labelId)
    return c.json({ success: true, id: labelId })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
}

// DELETE /api/labels/:labelId - delete label globally
app.delete("/api/labels/:labelId", deleteLabelHandler)
// Backward-compatible alias for older clients.
app.delete("/api/task-labels/:labelId", deleteLabelHandler)

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
    const allTasks = db.prepare("SELECT * FROM tasks ORDER BY score DESC").all() as TaskRowWithAssignment[]
    const dependencySnapshot = buildDependencySnapshot(db, allTasks)

    // Filter to ready tasks
    const readyTasks = allTasks.filter(task => {
      const blockedBy = dependencySnapshot.blockedByMap.get(task.id) ?? []
      const allBlockersDone = blockedBy.every(id => dependencySnapshot.statusMap.get(id) === "done")
      return WORKABLE_TASK_STATUSES.has(task.status) && allBlockersDone
    })

    // Enrich with full dependency info (Rule 1: every API response MUST include TaskWithDeps)
    const enriched = enrichTasksWithDeps(db, readyTasks, dependencySnapshot)

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
      SELECT id, doc_id, hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, locked_at
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
      SELECT id, doc_id, hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, locked_at
      FROM docs
      ORDER BY kind, name, version
    `).all() as DocRow[]
    const nameCounts = new Map<string, number>()
    for (const doc of docs) {
      nameCounts.set(doc.name, (nameCounts.get(doc.name) ?? 0) + 1)
    }

    const nodes: Array<{
      id: string
      label: string
      kind: "overview" | "prd" | "design" | "requirement" | "system_design" | "runbook" | "decision" | "task"
      status?: "changing" | "locked"
    }> = docs.map((doc) => ({
      id: `doc:${doc.id}`,
      label: (nameCounts.get(doc.name) ?? 0) > 1 ? `${doc.kind}/${doc.name}` : doc.name,
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

// GET /api/docs/health - validate docs health (hash drift, parsing, links)
app.get("/api/docs/health", (c) => {
  try {
    const db = getDb()
    if (!hasDocsSchema(db)) {
      return c.json({ total: 0, healthy: 0, issues: [] })
    }

    const docs = db.prepare(`
      SELECT id, doc_id, hash, kind, name, title, version, status, file_path, parent_doc_id, created_at, locked_at
      FROM docs
      ORDER BY kind, name, version
    `).all() as DocRow[]

    const issues: Array<{ docId: string; docName: string; kind: string; problems: string[] }> = []
    const unhealthyDocs = new Set<string>()
    const docsRoot = getDocsRootPath()

    const docNodeById = new Map<number, { docId: string; name: string; kind: string }>()
    for (const doc of docs) {
      docNodeById.set(doc.id, { docId: materializeDocId(doc), name: doc.name, kind: doc.kind })
    }

    const incomingDocLinkCount = new Map<string, number>()
    const prdsLinkedToDesign = new Set<string>()
    for (const doc of docs) {
      incomingDocLinkCount.set(materializeDocId(doc), 0)
    }

    const hasDocLinks = hasDocLinksSchema(db)
    if (hasDocLinks) {
      const docLinks = db.prepare(`
        SELECT from_doc_id, to_doc_id, link_type
        FROM doc_links
        ORDER BY id ASC
      `).all() as DocLinkRow[]

      for (const edge of docLinks) {
        const source = docNodeById.get(edge.from_doc_id)
        const target = docNodeById.get(edge.to_doc_id)
        if (!source || !target) continue

        incomingDocLinkCount.set(
          target.docId,
          (incomingDocLinkCount.get(target.docId) ?? 0) + 1
        )

        if (edge.link_type === "prd_to_design" && source.kind === "prd" && (target.kind === "design" || target.kind === "system_design")) {
          prdsLinkedToDesign.add(source.docId)
        }
      }
    }

    for (const doc of docs) {
      const mdRelPath = resolveDocMdRelativePath(doc.kind, doc.name)
      const mdPath = resolvePathWithin(docsRoot, mdRelPath)
      let content: string | null = null

      if (!mdPath || !existsSync(mdPath)) {
        issues.push({
          docId: materializeDocId(doc),
          docName: doc.name,
          kind: "hash_drift",
          problems: [`Markdown file missing on disk: ${mdRelPath}`],
        })
      } else {
        content = readFileSync(mdPath, "utf8")
        const currentHash = computeDocHash(content)
        if (currentHash !== doc.hash) {
          issues.push({
            docId: materializeDocId(doc),
            docName: doc.name,
            kind: "hash_drift",
            problems: [
              `Content hash mismatch: DB has ${doc.hash.slice(0, 8)}..., file has ${currentHash.slice(0, 8)}...`,
            ],
          })
        }
      }

      if (content !== null) {
        const parsedResult = parseMdDocSync(content)
        if (parsedResult._tag === "Left") {
          issues.push({
            docId: materializeDocId(doc),
            docName: doc.name,
            kind: "parse",
            problems: [formatMarkdownParseProblem(parsedResult.left)],
          })
        } else {
          const problems = findPlaceholderProblems(doc.kind, parsedResult.right)
          if (problems.length > 0) {
            issues.push({
              docId: materializeDocId(doc),
              docName: doc.name,
              kind: "placeholder",
              problems,
            })
          }
        }
      }

      // Link checks only apply when the doc_links table exists
      if (hasDocLinks) {
        // Only design docs should warn about missing incoming links.
        // PRDs, overviews, system_design, requirements, runbooks, decisions are root-level.
        const isDesignKind = doc.kind === "design" || doc.kind === "system_design"
        if (isDesignKind && (incomingDocLinkCount.get(materializeDocId(doc)) ?? 0) === 0) {
          issues.push({
            docId: materializeDocId(doc),
            docName: doc.name,
            kind: "orphaned",
            problems: ["Design doc has no incoming links — expected a 'prd_to_design' link from a PRD."],
          })
        }

        if (doc.kind === "prd" && !prdsLinkedToDesign.has(materializeDocId(doc))) {
          issues.push({
            docId: materializeDocId(doc),
            docName: doc.name,
            kind: "cross_link",
            problems: ["PRD has no outgoing 'prd_to_design' link to a design doc."],
          })
        }
      }
    }

    for (const issue of issues) {
      unhealthyDocs.add(issue.docId)
    }

    return c.json({
      total: docs.length,
      healthy: docs.length - unhealthyDocs.size,
      issues,
    })
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
      const fp = normalizeDocFilePath(row.file_path)
      const isMdFile = /\.md$/i.test(fp)

      // Markdown-first docs: strip frontmatter and return body
      if (isMdFile) {
        const mdPath = resolvePathWithin(docsRoot, fp, { useRealpath: true })
        if (mdPath && existsSync(mdPath)) {
          try {
            return [stripFrontmatter(readFileSync(mdPath, "utf-8"))]
          } catch {
            return []
          }
        }
        return []
      }

      // Legacy YAML docs: render via YAML→Markdown converter
      const yamlPath = resolvePathWithin(docsRoot, fp, { useRealpath: true })
      if (!yamlPath) {
        return []
      }
      const mdRelativePath = fp.replace(/\.yml$/i, ".md")
      const mdPath = resolvePathWithin(docsRoot, mdRelativePath, { useRealpath: true })

      if (existsSync(yamlPath)) {
        try {
          const yamlContent = readFileSync(yamlPath, "utf-8")
          return [renderMarkdownFromYaml(yamlContent, fp)]
        } catch {
          return []
        }
      }

      if (mdPath && existsSync(mdPath)) {
        try {
          return [stripFrontmatter(readFileSync(mdPath, "utf-8"))]
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

// GET /api/docs/by-id/:docId - fetch latest or specific version by stable doc_id
app.get("/api/docs/by-id/:docId", (c) => {
  try {
    const db = getDb()
    if (!hasDocsSchema(db)) {
      return c.json({ error: "Docs are not initialized. Run 'tx migrate' first." }, 404)
    }

    const docId = c.req.param("docId")
    const version = parseDocVersionQuery(c)
    const resolved = resolveDocRowByRef(db, docId, version)
    if (resolved.error) return resolved.error
    if (!resolved.row) {
      return c.json({ error: "Doc not found" }, 404)
    }

    return c.json(serializeDoc(resolved.row))
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/docs/by-id/:docId/source - fetch source for latest or specific version by stable doc_id
app.get("/api/docs/by-id/:docId/source", (c) => {
  try {
    const db = getDb()
    if (!hasDocsSchema(db)) {
      return c.json({ error: "Docs are not initialized. Run 'tx migrate' first." }, 404)
    }

    const docId = c.req.param("docId")
    const version = parseDocVersionQuery(c)
    const resolved = resolveDocRowByRef(db, docId, version)
    if (resolved.error) return resolved.error
    if (!resolved.row) {
      return c.json({ error: "Doc not found" }, 404)
    }

    const row = resolved.row
    const docsRoot = getDocsRootPath()
    const fp = normalizeDocFilePath(row.file_path)
    const isMdFile = /\.md$/i.test(fp)

    if (isMdFile) {
      const mdPath = resolvePathWithin(docsRoot, fp, { useRealpath: true })
      const content = mdPath && existsSync(mdPath)
        ? readFileSync(mdPath, "utf-8")
        : null
      return c.json({
        docId: materializeDocId(row),
        name: row.name,
        version: row.version,
        yamlContent: null,
        renderedContent: content ? stripFrontmatter(content) : null,
        filePath: fp,
      })
    }

    const yamlPath = resolvePathWithin(docsRoot, fp, { useRealpath: true })
    if (!yamlPath) {
      return c.json({ error: "Invalid doc source path" }, 400)
    }
    const mdRelativePath = fp.replace(/\.yml$/i, ".md")
    const mdPath = resolvePathWithin(docsRoot, mdRelativePath, { useRealpath: true })

    const yamlContent = existsSync(yamlPath) ? readFileSync(yamlPath, "utf-8") : null
    const renderedContent = yamlContent
      ? renderMarkdownFromYaml(yamlContent, fp)
      : mdPath && existsSync(mdPath)
        ? stripFrontmatter(readFileSync(mdPath, "utf-8"))
        : null

    return c.json({
      docId: materializeDocId(row),
      name: row.name,
      version: row.version,
      yamlContent,
      renderedContent,
      filePath: fp,
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// DELETE /api/docs/by-id/:docId - delete latest or specific version by stable doc_id
app.delete("/api/docs/by-id/:docId", (c) => {
  try {
    const db = getDb()
    if (!hasDocsSchema(db)) {
      return c.json({ error: "Docs are not initialized. Run 'tx migrate' first." }, 404)
    }

    const docId = c.req.param("docId")
    const version = parseDocVersionQuery(c)
    const resolved = resolveDocRowByRef(db, docId, version)
    if (resolved.error) return resolved.error
    if (!resolved.row) {
      return c.json({ error: "Doc not found" }, 404)
    }

    const row = resolved.row
    if (row.status === "locked") {
      return c.json({ error: "Cannot delete a locked doc version" }, 409)
    }

    db.prepare("DELETE FROM docs WHERE id = ?").run(row.id)
    return c.json({ success: true, docId: materializeDocId(row), name: row.name, version: row.version })
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
    const version = parseDocVersionQuery(c)
    const resolved = resolveDocRowByRef(db, name, version)
    if (resolved.error) return resolved.error
    if (!resolved.row) {
      return c.json({ error: "Doc not found" }, 404)
    }
    return c.json(serializeDoc(resolved.row))
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
    const version = parseDocVersionQuery(c)
    const resolved = resolveDocRowByRef(db, name, version)
    if (resolved.error) return resolved.error
    if (!resolved.row) {
      return c.json({ error: "Doc not found" }, 404)
    }

    const docsRoot = getDocsRootPath()
    const fp = normalizeDocFilePath(resolved.row.file_path)
    const isMdFile = /\.md$/i.test(fp)

    if (isMdFile) {
      // Markdown-first doc: strip frontmatter, no YAML source
      const mdPath = resolvePathWithin(docsRoot, fp, { useRealpath: true })
      const renderedContent = mdPath && existsSync(mdPath)
        ? stripFrontmatter(readFileSync(mdPath, "utf-8"))
        : null
      return c.json({ docId: materializeDocId(resolved.row), name: resolved.row.name, version: resolved.row.version, yamlContent: null, renderedContent, filePath: fp })
    }

    // Legacy YAML doc
    const yamlPath = resolvePathWithin(docsRoot, fp, { useRealpath: true })
    if (!yamlPath) {
      return c.json({ error: "Invalid doc source path" }, 400)
    }
    const mdRelativePath = fp.replace(/\.yml$/i, ".md")
    const mdPath = resolvePathWithin(docsRoot, mdRelativePath, { useRealpath: true })

    const yamlContent = existsSync(yamlPath) ? readFileSync(yamlPath, "utf-8") : null
    const renderedContent = yamlContent
      ? renderMarkdownFromYaml(yamlContent, fp)
      : mdPath && existsSync(mdPath)
        ? stripFrontmatter(readFileSync(mdPath, "utf-8"))
        : null

    return c.json({
      docId: materializeDocId(resolved.row),
      name: resolved.row.name,
      version: resolved.row.version,
      yamlContent,
      renderedContent,
      filePath: fp,
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
    const version = parseDocVersionQuery(c)
    const resolved = resolveDocRowByRef(db, name, version)
    if (resolved.error) return resolved.error
    if (!resolved.row) {
      return c.json({ error: "Doc not found" }, 404)
    }
    const row = resolved.row
    if (row.status === "locked") {
      return c.json({ error: "Cannot delete a locked doc version" }, 409)
    }

    db.prepare("DELETE FROM docs WHERE id = ?").run(row.id)
    return c.json({ success: true, docId: materializeDocId(row), name: row.name, version: row.version })
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

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRowWithAssignment | undefined
    if (!task) {
      return c.json({ error: "Task not found" }, 404)
    }

    const dependencySnapshot = buildDependencySnapshot(db)
    const blockedByIds = dependencySnapshot.blockedByMap.get(id) ?? []
    const blocksIds = dependencySnapshot.blocksMap.get(id) ?? []
    const childIds = dependencySnapshot.childrenMap.get(id) ?? []

    // Fetch full task data for related tasks
    const fetchTasksByIds = (ids: string[]): TaskRowWithDeps[] => {
      if (ids.length === 0) return []
      const placeholders = ids.map(() => "?").join(",")
      const tasks = db.prepare(`SELECT * FROM tasks WHERE id IN (${placeholders})`).all(...ids) as TaskRowWithAssignment[]
      return enrichTasksWithDeps(db, tasks, dependencySnapshot)
    }

    const blockedByTasks = fetchTasksByIds(blockedByIds)
    const blocksTasks = fetchTasksByIds(blocksIds)
    const childTasks = fetchTasksByIds(childIds)

    // Enrich the main task
    const [enrichedTask] = enrichTasksWithDeps(db, [task], dependencySnapshot)

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
             stdout_path AS stdoutPath,
             stderr_path AS stderrPath,
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
      stdoutPath: string | null
      stderrPath: string | null
      contextInjected: string | null
      summary: string | null
      errorMessage: string | null
      metadata: string
    } | undefined

    if (!run) {
      return c.json({ error: "Run not found" }, 404)
    }

    const parseRunMessages = (raw: string): Array<{ role: string; content: unknown; type?: string; tool_name?: string; timestamp?: string }> => {
      const parsed: Array<{ role: string; content: unknown; type?: string; tool_name?: string; timestamp?: string }> = []
      const lines = raw.split("\n").filter(Boolean)

      for (const line of lines) {
        try {
          const entry = JSON.parse(line)

          // Claude stream-json format
          if (entry.type === "user" || entry.type === "assistant") {
            const msg = entry.message
            if (!msg) continue
            const content = msg.content

            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text") {
                  parsed.push({ role: msg.role, content: block.text, type: "text", timestamp: entry.timestamp })
                } else if (block.type === "tool_use") {
                  parsed.push({
                    role: msg.role,
                    content: JSON.stringify(block.input),
                    type: "tool_use",
                    tool_name: block.name,
                    timestamp: entry.timestamp,
                  })
                } else if (block.type === "tool_result") {
                  const text = typeof block.content === "string"
                    ? block.content
                    : Array.isArray(block.content)
                      ? block.content.map((c: { text?: string }) => c.text ?? "").join("\n")
                      : JSON.stringify(block.content)
                  parsed.push({
                    role: msg.role,
                    content: text,
                    type: "tool_result",
                    tool_name: block.tool_use_id,
                    timestamp: entry.timestamp,
                  })
                }
              }
            } else if (typeof content === "string") {
              parsed.push({ role: msg.role, content, type: "text", timestamp: entry.timestamp })
            }
            continue
          }

          // Generic role/content JSON lines
          if (
            (entry.role === "user" || entry.role === "assistant" || entry.role === "system")
            && entry.content !== undefined
          ) {
            parsed.push({
              role: entry.role,
              content: typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content),
              type: "text",
              timestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined,
            })
          }
        } catch {
          // Skip non-JSON lines here; plain text fallback handles them below.
        }
      }

      if (parsed.length > 0) {
        return parsed
      }

      // Fallback for plain text logs (Codex/custom runtimes stdout).
      const rawLines = raw
        .split("\n")
        .map((line) => line.replace(/\r$/, ""))
        .filter((line) => line.trim().length > 0)

      const maxLines = 400
      const tail = rawLines.slice(-maxLines)

      return tail.map((line) => {
        const lower = line.toLowerCase()
        if (lower.startsWith("user:")) {
          return { role: "user", content: line.slice(5).trim(), type: "text" as const }
        }
        if (lower.startsWith("assistant:")) {
          return { role: "assistant", content: line.slice(10).trim(), type: "text" as const }
        }
        if (lower.startsWith("system:")) {
          return { role: "system", content: line.slice(7).trim(), type: "text" as const }
        }
        return { role: "assistant", content: line, type: "text" as const }
      })
    }

    // Try transcript_path first, then stdout_path fallback.
    let messages: Array<{ role: string; content: unknown; type?: string; tool_name?: string; timestamp?: string }> = []
    let resolvedTranscriptPath: string | null = null
    const candidatePaths = [...new Set([run.transcriptPath, run.stdoutPath].filter((p): p is string => Boolean(p)))]

    for (const candidatePath of candidatePaths) {
      const validatedPath = validateTranscriptPath(candidatePath)
      if (validatedPath && existsSync(validatedPath)) {
        try {
          const raw = readFileSync(validatedPath, "utf-8")
          messages = parseRunMessages(raw)
          resolvedTranscriptPath = candidatePath
          if (messages.length > 0) break
        } catch {
          // Failed to read file
        }
      }
    }

    if (!run.transcriptPath && resolvedTranscriptPath) {
      run.transcriptPath = resolvedTranscriptPath
    }

    const trimLog = (content: string): { value: string; truncated: boolean } => {
      const maxChars = 200_000
      if (content.length <= maxChars) {
        return { value: content, truncated: false }
      }
      return { value: content.slice(-maxChars), truncated: true }
    }

    const readOptionalLog = (logPath: string | null): { content: string | null; truncated: boolean } => {
      if (!logPath) return { content: null, truncated: false }
      const validatedPath = validateTranscriptPath(logPath)
      if (!validatedPath || !existsSync(validatedPath)) {
        return { content: null, truncated: false }
      }
      try {
        const raw = readFileSync(validatedPath, "utf-8")
        const trimmed = trimLog(raw)
        return { content: trimmed.value, truncated: trimmed.truncated }
      } catch {
        return { content: null, truncated: false }
      }
    }

    const stdoutLog = readOptionalLog(run.stdoutPath)
    const stderrLog = readOptionalLog(run.stderrPath)

    return c.json({
      run,
      messages,
      logs: {
        stdout: stdoutLog.content,
        stderr: stderrLog.content,
        stdoutTruncated: stdoutLog.truncated,
        stderrTruncated: stderrLog.truncated,
      },
    })
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// =============================================================================
// SUPERVISION ROUTES — DD-039
// All business logic delegates to core SupervisionService via Effect layer.
// No direct SQL to supervision/domain_events tables (INV-SUP-010).
// =============================================================================

// Lazy Effect layer for supervision services.
let _supervisionLayer: ReturnType<typeof makeMinimalLayer> | null = null
const getSupervisionLayer = () => {
  if (!_supervisionLayer) {
    _supervisionLayer = makeMinimalLayer(dbPath)
  }
  return _supervisionLayer
}

/**
 * Helper: run a SupervisionService method through the Effect layer.
 * The callback receives the resolved service and must return an Effect
 * with no remaining requirements (all deps provided by the layer).
 */
const withSupervision = <A>(
  fn: (svc: any) => Effect.Effect<A, any, never>
): Promise<A> => {
  const layer = getSupervisionLayer()
  const program = SupervisionService.pipe(
    Effect.flatMap(fn),
    Effect.provide(layer)
  )
  return Effect.runPromise(program)
}

// GET /api/supervision/sessions — list all live worker sessions
app.get("/api/supervision/sessions", async (c) => {
  try {
    const sessions = await withSupervision((svc) => svc.listSessions())
    return c.json(sessions)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// GET /api/supervision/sessions/:id — get single session detail
app.get("/api/supervision/sessions/:id", async (c) => {
  try {
    const id = c.req.param("id")
    const session = await withSupervision((svc) => svc.getSession(id))
    return c.json(session)
  } catch (e) {
    const msg = String(e)
    if (msg.includes("not found") || msg.includes("NotFound")) {
      return c.json({ error: "Session not found" }, 404)
    }
    return c.json({ error: msg }, 500)
  }
})

// GET /api/supervision/sessions/:id/events — list session domain events
app.get("/api/supervision/sessions/:id/events", async (c) => {
  try {
    const id = c.req.param("id")
    const events = await withSupervision((svc) => svc.listSessionEvents(id))
    return c.json(events)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// POST /api/supervision/sessions/:id/pause — pause a session
app.post("/api/supervision/sessions/:id/pause", async (c) => {
  try {
    const id = c.req.param("id")
    const body = await c.req.json<{ actorType?: string; actorId?: string }>()
    const actor: ActorRef = {
      type: (body.actorType as ActorRef["type"]) ?? "human",
      id: body.actorId ?? "dashboard-user",
    }
    const session = await withSupervision((svc) => svc.pauseSession(id, actor))
    return c.json(session)
  } catch (e) {
    const msg = String(e)
    if (msg.includes("not found") || msg.includes("NotFound")) {
      return c.json({ error: "Session not found" }, 404)
    }
    if (msg.includes("invalid") || msg.includes("transition") || msg.includes("only")) {
      return c.json({ error: msg }, 409)
    }
    return c.json({ error: msg }, 500)
  }
})

// POST /api/supervision/sessions/:id/resume — resume a paused session
app.post("/api/supervision/sessions/:id/resume", async (c) => {
  try {
    const id = c.req.param("id")
    const body = await c.req.json<{ actorType?: string; actorId?: string }>()
    const actor: ActorRef = {
      type: (body.actorType as ActorRef["type"]) ?? "human",
      id: body.actorId ?? "dashboard-user",
    }
    const session = await withSupervision((svc) => svc.resumeSession(id, actor))
    return c.json(session)
  } catch (e) {
    const msg = String(e)
    if (msg.includes("not found") || msg.includes("NotFound")) {
      return c.json({ error: "Session not found" }, 404)
    }
    if (msg.includes("invalid") || msg.includes("transition") || msg.includes("only")) {
      return c.json({ error: msg }, 409)
    }
    return c.json({ error: msg }, 500)
  }
})

// GET /api/supervision/terminal-token/:id — issue terminal token for session
app.get("/api/supervision/terminal-token/:id", async (c) => {
  try {
    const sessionId = c.req.param("id")
    const viewerId = c.req.query("viewerId") ?? `dashboard-${randomUUID().slice(0, 8)}`
    const mode = (c.req.query("mode") ?? "observe") as "control" | "observe"
    const token = await withSupervision((svc) =>
      svc.createTerminalToken(sessionId, viewerId, mode)
    )
    return c.json(token)
  } catch (e) {
    const msg = String(e)
    if (msg.includes("not found") || msg.includes("NotFound")) {
      return c.json({ error: "Session not found" }, 404)
    }
    if (msg.includes("controller") || msg.includes("conflict")) {
      return c.json({ error: msg }, 409)
    }
    return c.json({ error: msg }, 500)
  }
})

// GET /api/supervision/terminal-wall — read-only terminal snapshots for all live sessions
app.get("/api/supervision/terminal-wall", async (c) => {
  try {
    const sessions = await withSupervision((svc) => svc.listSessions())

    // Check if tmux is available
    let tmuxAvailable = false
    try {
      execSync("tmux -V", { stdio: "pipe" })
      tmuxAvailable = true
    } catch {
      // tmux not installed or not available
    }

    const tiles = (sessions as readonly any[]).map((session: any) => {
      let terminalOutput: string | null = null

      if (tmuxAvailable && session.tmuxSessionName && session.endedAt === null) {
        try {
          terminalOutput = execSync(
            `tmux capture-pane -t ${JSON.stringify(session.tmuxSessionName)} -p -S -50`,
            { encoding: "utf-8", timeout: 2000 }
          ).trimEnd()
        } catch {
          // Session may have ended or pane unavailable
        }
      }

      return {
        sessionId: session.id,
        sessionLabel: session.workerName ?? session.id,
        currentTaskLabel: session.currentTaskTitle ?? null,
        heartbeatFreshness: session.lastHeartbeatAt,
        controlMode: session.controlMode,
        terminalAvailable: tmuxAvailable && session.tmuxSessionName != null,
        terminalOutput,
        readOnly: true,
      }
    })

    return c.json(tiles)
  } catch (e) {
    return c.json({ error: String(e) }, 500)
  }
})

// =============================================================================
// WEBSOCKET TERMINAL BRIDGE — DD-039 Section 4
// Focused terminal: websocket ↔ tmux PTY bridge.
// =============================================================================

// In-memory terminal token store (tokens are short-lived, validated by core).
const activeTerminalTokens = new Map<string, {
  sessionId: string
  viewerId: string
  mode: "control" | "observe"
  tmuxSessionName: string
  expiresAt: string
}>()

/**
 * Handle websocket upgrade for /api/supervision/terminal/ws.
 * Validates token, resolves tmux session, spawns PTY bridge.
 */
const handleTerminalWsUpgrade = async (
  req: IncomingMessage,
  socket: import("node:net").Socket,
  _head: Buffer
) => {
  const url = new URL(req.url ?? "/", "http://localhost")
  if (url.pathname !== "/api/supervision/terminal/ws") {
    socket.destroy()
    return
  }

  const token = url.searchParams.get("token")
  if (!token) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n")
    socket.destroy()
    return
  }

  // Resolve token: first check in-memory cache, then fetch session from core
  let sessionId: string | undefined
  let viewerId: string | undefined
  let mode: "control" | "observe" = "observe"
  let tmuxSessionName: string | undefined

  const cached = activeTerminalTokens.get(token)
  if (cached) {
    if (new Date(cached.expiresAt) < new Date()) {
      activeTerminalTokens.delete(token)
      socket.write("HTTP/1.1 401 Token Expired\r\n\r\n")
      socket.destroy()
      return
    }
    sessionId = cached.sessionId
    viewerId = cached.viewerId
    mode = cached.mode
    tmuxSessionName = cached.tmuxSessionName
  } else {
    // Try to parse token as JSON (core-issued SupervisionTerminalToken)
    try {
      const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf-8"))
      sessionId = parsed.sessionId
      viewerId = parsed.viewerId
      mode = parsed.mode ?? "observe"
      // Fetch session to get tmux session name
      const session = await withSupervision((svc) => svc.getSession(parsed.sessionId))
      tmuxSessionName = (session as any).tmuxSessionName
    } catch {
      socket.write("HTTP/1.1 401 Invalid Token\r\n\r\n")
      socket.destroy()
      return
    }
  }

  if (!tmuxSessionName) {
    socket.write("HTTP/1.1 503 Terminal Unavailable\r\n\r\n")
    socket.destroy()
    return
  }

  // Check tmux availability
  try {
    execSync("tmux -V", { stdio: "pipe" })
  } catch {
    socket.write("HTTP/1.1 503 tmux Not Available\r\n\r\n")
    socket.destroy()
    return
  }

  // Mark attached in core if control mode
  if (mode === "control" && sessionId && viewerId) {
    try {
      await withSupervision((svc) => svc.markAttached(sessionId!, viewerId!, true))
    } catch {
      socket.write("HTTP/1.1 409 Controller Conflict\r\n\r\n")
      socket.destroy()
      return
    }
  }

  // Perform WebSocket handshake (RFC 6455)
  const { createHash } = await import("node:crypto")
  const key = req.headers["sec-websocket-key"]
  if (!key) {
    socket.write("HTTP/1.1 400 Missing WebSocket Key\r\n\r\n")
    socket.destroy()
    return
  }
  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-5AB5DC11E65A")
    .digest("base64")

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    "\r\n"
  )

  // Spawn tmux attach process as PTY bridge
  const tmuxArgs = mode === "control"
    ? ["attach-session", "-t", tmuxSessionName]
    : ["capture-pane", "-t", tmuxSessionName, "-p", "-e"]

  let ptyProcess: ChildProcess | null = null

  if (mode === "control") {
    // Interactive: attach to tmux session
    ptyProcess = spawn("tmux", tmuxArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    })

    // Forward tmux stdout → websocket frames
    ptyProcess.stdout?.on("data", (data: Buffer) => {
      try {
        sendWsFrame(socket, data)
      } catch {
        // Socket closed
      }
    })

    ptyProcess.stderr?.on("data", (data: Buffer) => {
      try {
        sendWsFrame(socket, data)
      } catch {
        // Socket closed
      }
    })

    ptyProcess.on("exit", () => {
      try {
        sendWsCloseFrame(socket)
        socket.destroy()
      } catch {
        // Already closed
      }
    })

    // Forward websocket data → tmux stdin
    let wsBuffer = Buffer.alloc(0)
    socket.on("data", (chunk: Buffer) => {
      wsBuffer = Buffer.concat([wsBuffer, chunk])
      while (wsBuffer.length >= 2) {
        const parsed = parseWsFrame(wsBuffer)
        if (!parsed) break
        wsBuffer = wsBuffer.subarray(parsed.totalLength)

        if (parsed.opcode === 0x08) {
          // Close frame
          ptyProcess?.kill()
          socket.destroy()
          return
        }
        if (parsed.opcode === 0x01 || parsed.opcode === 0x02) {
          // Text or binary data → tmux stdin
          ptyProcess?.stdin?.write(parsed.payload)
        }
      }
    })
  } else {
    // Read-only: periodic capture-pane polling
    const captureInterval = setInterval(() => {
      try {
        const output = execSync(
          `tmux capture-pane -t ${JSON.stringify(tmuxSessionName)} -p -e -S -50`,
          { encoding: "utf-8", timeout: 2000 }
        )
        sendWsFrame(socket, Buffer.from(output, "utf-8"))
      } catch {
        // Pane may have ended
        clearInterval(captureInterval)
        try {
          sendWsCloseFrame(socket)
          socket.destroy()
        } catch {
          // Already closed
        }
      }
    }, 1000)

    socket.on("data", (chunk: Buffer) => {
      const parsed = parseWsFrame(chunk)
      if (parsed?.opcode === 0x08) {
        clearInterval(captureInterval)
        socket.destroy()
      }
    })

    socket.on("close", () => {
      clearInterval(captureInterval)
    })
  }

  // Cleanup on socket close
  const capturedSessionId = sessionId
  const capturedViewerId = viewerId
  socket.on("close", () => {
    ptyProcess?.kill()
    // Release terminal controller in core
    if (capturedSessionId && capturedViewerId) {
      withSupervision((svc) =>
        svc.markDetached(capturedSessionId, capturedViewerId)
      ).catch(() => {
        // Best-effort cleanup
      })
    }
  })
}

/** Encode a WebSocket frame (unmasked, server→client). */
function sendWsFrame(socket: import("node:net").Socket, data: Buffer): void {
  const len = data.length
  let header: Buffer
  if (len < 126) {
    header = Buffer.alloc(2)
    header[0] = 0x82 // FIN + binary
    header[1] = len
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x82
    header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x82
    header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  socket.write(Buffer.concat([header, data]))
}

/** Send a WebSocket close frame. */
function sendWsCloseFrame(socket: import("node:net").Socket): void {
  const frame = Buffer.alloc(2)
  frame[0] = 0x88 // FIN + close
  frame[1] = 0x00
  socket.write(frame)
}

/** Parse a WebSocket frame (masked, client→server). Returns null if incomplete. */
function parseWsFrame(buf: Buffer): { opcode: number; payload: Buffer; totalLength: number } | null {
  if (buf.length < 2) return null
  const opcode = buf[0]! & 0x0f
  const masked = (buf[1]! & 0x80) !== 0
  let payloadLen = buf[1]! & 0x7f
  let offset = 2

  if (payloadLen === 126) {
    if (buf.length < 4) return null
    payloadLen = buf.readUInt16BE(2)
    offset = 4
  } else if (payloadLen === 127) {
    if (buf.length < 10) return null
    payloadLen = Number(buf.readBigUInt64BE(2))
    offset = 10
  }

  const maskLen = masked ? 4 : 0
  const totalLength = offset + maskLen + payloadLen
  if (buf.length < totalLength) return null

  let payload: Buffer
  if (masked) {
    const mask = buf.subarray(offset, offset + 4)
    payload = Buffer.alloc(payloadLen)
    for (let i = 0; i < payloadLen; i++) {
      payload[i] = buf[offset + 4 + i]! ^ mask[i % 4]!
    }
  } else {
    payload = buf.subarray(offset, offset + payloadLen)
  }

  return { opcode, payload, totalLength }
}

// =============================================================================
// SERVER STARTUP
// =============================================================================

const port = Number(process.env.PORT ?? "3001")
try {
  const server = createServer((req, res) => {
    void app.handle(req, res)
  })

  // Handle WebSocket upgrades for terminal bridge
  server.on("upgrade", (req, socket, head) => {
    void handleTerminalWsUpgrade(req, socket as import("node:net").Socket, head)
  })

  server.listen(port, () => {
    console.log(`Dashboard API running on http://localhost:${port}`)
  })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Failed to start dashboard API on port ${port}: ${message}`)
  process.exit(1)
}
