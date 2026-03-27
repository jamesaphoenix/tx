/**
 * Read and patch tx configuration from .tx/config.toml.
 * Returns defaults if file doesn't exist.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

export type DashboardDefaultTaskAssigmentType = "human" | "agent"
export type DashboardDefaultTaskView = "list" | "kanban"
export type DashboardCycleStartDay =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
export type DashboardCyclesConfig = {
  cycleLengthDays: number
  cycleStartDay: DashboardCycleStartDay
  carryStatuses: string[]
}
export type GuardMode = "advisory" | "enforce"

export type TxConfig = {
  docs: { path: string }
  spec: { testPatterns: string[] }
  memory: { defaultDir: string }
  cycles: { scanPrompt: string | null; agents: number; model: string }
  dashboard: {
    defaultTaskAssigmentType: DashboardDefaultTaskAssigmentType
    defaultTaskView: DashboardDefaultTaskView
    cycles: DashboardCyclesConfig
  }
  pins: { targetFiles: string[]; blockAgentDoneWhenTaskIdPresent: boolean }
  guard: { mode: GuardMode; maxPending: number | null; maxChildren: number | null; maxDepth: number | null }
  verify: { timeout: number; defaultSchema: string | null }
  reflect: { provider: string; model: string | null; defaultSessions: number; includeTranscripts: boolean }};

export const DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY = "default_task_assigment_type"
export const DASHBOARD_DEFAULT_TASK_VIEW_KEY = "default_task_view"
const DASHBOARD_SECTION = "dashboard"
const DASHBOARD_CYCLES_SECTION = "dashboard.cycles"
export const DASHBOARD_CYCLE_LENGTH_DAYS_KEY = "cycle_length_days"
export const DASHBOARD_CYCLE_START_DAY_KEY = "cycle_start_day"
export const DASHBOARD_CARRY_STATUSES_KEY = "carry_statuses"
const DOCS_SECTION = "docs"
const SPEC_SECTION = "spec"
const CYCLES_SECTION = "cycles"
const PINS_SECTION = "pins"
const MEMORY_SECTION = "memory"
const GUARD_SECTION = "guard"
const VERIFY_SECTION = "verify"
const REFLECT_SECTION = "reflect"

const isGuardMode = (v: string | null): v is GuardMode =>
  v === "advisory" || v === "enforce"

const DEFAULT_CONFIG: TxConfig = {
  docs: { path: "specs" },
  spec: {
    testPatterns: [
      "test/**/*.test.{ts,js,tsx,jsx}",
      "tests/**/*.py",
      "**/*_test.go",
      "**/*_test.rs",
      "**/test_*.py",
      "**/*.spec.{ts,js,tsx,jsx}",
      "**/Test*.java",
      "**/*Test.java",
      "**/*_spec.rb",
      "**/*.test.{c,cpp,cc}",
      "**/*_test.{c,cpp,cc}",
    ]
  },
  memory: { defaultDir: "specs" },
  cycles: { scanPrompt: null, agents: 3, model: "claude-opus-4-6" },
  dashboard: {
    defaultTaskAssigmentType: "human",
    defaultTaskView: "list",
    cycles: {
      cycleLengthDays: 7,
      cycleStartDay: "monday",
      carryStatuses: ["planning", "active", "blocked", "review", "needs_review"],
    },
  },
  pins: { targetFiles: ["CLAUDE.md", "AGENTS.md"], blockAgentDoneWhenTaskIdPresent: true },
  guard: { mode: "advisory", maxPending: null, maxChildren: null, maxDepth: null },
  verify: { timeout: 300, defaultSchema: null },
  reflect: { provider: "auto", model: null, defaultSessions: 10, includeTranscripts: false },
}

const isDashboardDefaultTaskAssigmentType = (
  value: string | null
): value is DashboardDefaultTaskAssigmentType =>
  value === "human" || value === "agent"

const isDashboardDefaultTaskView = (
  value: string | null
): value is DashboardDefaultTaskView =>
  value === "list" || value === "kanban"

const DASHBOARD_CYCLE_START_DAYS = new Set<DashboardCycleStartDay>([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
])

const parseTaskAssigmentTypeOrDefault = (value: string | null): DashboardDefaultTaskAssigmentType =>
  isDashboardDefaultTaskAssigmentType(value)
    ? value
    : DEFAULT_CONFIG.dashboard.defaultTaskAssigmentType

const parseDashboardDefaultTaskViewOrDefault = (
  value: string | null
): DashboardDefaultTaskView =>
  isDashboardDefaultTaskView(value)
    ? value
    : DEFAULT_CONFIG.dashboard.defaultTaskView

const parseDashboardCycleLengthOrDefault = (value: string | null): number => {
  if (!value) return DEFAULT_CONFIG.dashboard.cycles.cycleLengthDays
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CONFIG.dashboard.cycles.cycleLengthDays
}

const parseDashboardCycleStartDayOrDefault = (value: string | null): DashboardCycleStartDay => {
  if (!value) return DEFAULT_CONFIG.dashboard.cycles.cycleStartDay
  const normalized = value.toLowerCase() as DashboardCycleStartDay
  return DASHBOARD_CYCLE_START_DAYS.has(normalized)
    ? normalized
    : DEFAULT_CONFIG.dashboard.cycles.cycleStartDay
}

const parseDashboardCarryStatusesOrDefault = (values: string[]): string[] => {
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0)
  return normalized.length > 0 ? normalized : DEFAULT_CONFIG.dashboard.cycles.carryStatuses
}

const parseBooleanOrDefault = (value: string | null, fallback: boolean): boolean => {
  if (value === "true") return true
  if (value === "false") return false
  return fallback
}

/**
 * Read .tx/config.toml and return parsed config.
 * Falls back to defaults if file doesn't exist or is invalid.
 */
export const readTxConfig = (cwd: string = process.cwd()): TxConfig => {
  const configPath = resolve(cwd, ".tx", "config.toml")
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG
  }
  try {
    const raw = readFileSync(configPath, "utf8")
    // Lightweight TOML parsing for our simple config structure.
    const docsPath = extractTomlValue(raw, DOCS_SECTION, "path")
    const specPatterns = extractTomlArray(raw, SPEC_SECTION, "test_patterns")
    const cyclesScanPrompt = extractTomlValue(raw, CYCLES_SECTION, "scan_prompt")
    const cyclesAgents = extractTomlValue(raw, CYCLES_SECTION, "agents")
    const cyclesModel = extractTomlValue(raw, CYCLES_SECTION, "model")
    const defaultTaskAssigmentType = extractTomlValue(
      raw,
      DASHBOARD_SECTION,
      DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY
    )
    const defaultTaskView = extractTomlValue(
      raw,
      DASHBOARD_SECTION,
      DASHBOARD_DEFAULT_TASK_VIEW_KEY
    )
    const dashboardCycleLengthDays = extractTomlValue(
      raw,
      DASHBOARD_CYCLES_SECTION,
      DASHBOARD_CYCLE_LENGTH_DAYS_KEY
    )
    const dashboardCycleStartDay = extractTomlValue(
      raw,
      DASHBOARD_CYCLES_SECTION,
      DASHBOARD_CYCLE_START_DAY_KEY
    )
    const dashboardCarryStatuses = extractTomlArray(
      raw,
      DASHBOARD_CYCLES_SECTION,
      DASHBOARD_CARRY_STATUSES_KEY
    )
    const memoryDefaultDir = extractTomlValue(raw, MEMORY_SECTION, "default_dir")
    const pinsTargetFiles = extractTomlValue(raw, PINS_SECTION, "target_files")
    const pinsBlockAgentDone = extractTomlValue(raw, PINS_SECTION, "block_agent_done_when_task_id_present")

    // Guard section
    const guardMode = extractTomlValue(raw, GUARD_SECTION, "mode")
    const guardMaxPending = extractTomlValue(raw, GUARD_SECTION, "max_pending")
    const guardMaxChildren = extractTomlValue(raw, GUARD_SECTION, "max_children")
    const guardMaxDepth = extractTomlValue(raw, GUARD_SECTION, "max_depth")

    // Verify section
    const verifyTimeout = extractTomlValue(raw, VERIFY_SECTION, "timeout")
    const verifyDefaultSchema = extractTomlValue(raw, VERIFY_SECTION, "default_schema")

    // Reflect section
    const reflectProvider = extractTomlValue(raw, REFLECT_SECTION, "provider")
    const reflectModel = extractTomlValue(raw, REFLECT_SECTION, "model")
    const reflectDefaultSessions = extractTomlValue(raw, REFLECT_SECTION, "default_sessions")
    const reflectIncludeTranscripts = extractTomlValue(raw, REFLECT_SECTION, "include_transcripts")

    return {
      docs: {
        path: docsPath ?? DEFAULT_CONFIG.docs.path,
      },
      spec: {
        testPatterns: specPatterns.length > 0 ? specPatterns : DEFAULT_CONFIG.spec.testPatterns,
      },
      memory: {
        defaultDir: memoryDefaultDir ?? DEFAULT_CONFIG.memory.defaultDir,
      },
      cycles: {
        scanPrompt: cyclesScanPrompt ?? DEFAULT_CONFIG.cycles.scanPrompt,
        agents: cyclesAgents
          ? parseInt(cyclesAgents, 10)
          : DEFAULT_CONFIG.cycles.agents,
        model: cyclesModel ?? DEFAULT_CONFIG.cycles.model,
      },
      dashboard: {
        defaultTaskAssigmentType: parseTaskAssigmentTypeOrDefault(defaultTaskAssigmentType),
        defaultTaskView: parseDashboardDefaultTaskViewOrDefault(defaultTaskView),
        cycles: {
          cycleLengthDays: parseDashboardCycleLengthOrDefault(dashboardCycleLengthDays),
          cycleStartDay: parseDashboardCycleStartDayOrDefault(dashboardCycleStartDay),
          carryStatuses: parseDashboardCarryStatusesOrDefault(dashboardCarryStatuses),
        },
      },
      pins: {
        targetFiles: pinsTargetFiles
          ? pinsTargetFiles.split(",").map(f => f.trim()).filter(Boolean)
          : DEFAULT_CONFIG.pins.targetFiles,
        blockAgentDoneWhenTaskIdPresent: parseBooleanOrDefault(
          pinsBlockAgentDone,
          DEFAULT_CONFIG.pins.blockAgentDoneWhenTaskIdPresent
        )
      },
      guard: {
        mode: isGuardMode(guardMode) ? guardMode : DEFAULT_CONFIG.guard.mode,
        maxPending: guardMaxPending ? parseInt(guardMaxPending, 10) : DEFAULT_CONFIG.guard.maxPending,
        maxChildren: guardMaxChildren ? parseInt(guardMaxChildren, 10) : DEFAULT_CONFIG.guard.maxChildren,
        maxDepth: guardMaxDepth ? parseInt(guardMaxDepth, 10) : DEFAULT_CONFIG.guard.maxDepth,
      },
      verify: {
        timeout: verifyTimeout ? parseInt(verifyTimeout, 10) : DEFAULT_CONFIG.verify.timeout,
        defaultSchema: verifyDefaultSchema ?? DEFAULT_CONFIG.verify.defaultSchema,
      },
      reflect: {
        provider: reflectProvider ?? DEFAULT_CONFIG.reflect.provider,
        model: reflectModel ?? DEFAULT_CONFIG.reflect.model,
        defaultSessions: reflectDefaultSessions ? parseInt(reflectDefaultSessions, 10) : DEFAULT_CONFIG.reflect.defaultSessions,
        includeTranscripts: reflectIncludeTranscripts === "true" ? true : DEFAULT_CONFIG.reflect.includeTranscripts,
      },
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

/**
 * Patch the dashboard default assignment type in .tx/config.toml.
 * Preserves unrelated sections and comments.
 */
export const writeDashboardDefaultTaskAssigmentType = (
  value: DashboardDefaultTaskAssigmentType,
  cwd: string = process.cwd()
): TxConfig => {
  const configDir = resolve(cwd, ".tx")
  const configPath = resolve(configDir, "config.toml")
  const current = readTxConfig(cwd)
  const nextConfig: TxConfig = {
    ...current,
    dashboard: { ...current.dashboard, defaultTaskAssigmentType: value },
  }

  mkdirSync(dirname(configPath), { recursive: true })
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const nextRaw = patchTomlKey(
    existingRaw,
    DASHBOARD_SECTION,
    DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY,
    `"${value}"`
  )
  writeFileSync(configPath, ensureTrailingNewline(nextRaw), "utf8")

  return nextConfig
}

/**
 * Patch the dashboard default task view in .tx/config.toml.
 * Preserves unrelated sections and comments.
 */
export const writeDashboardDefaultTaskView = (
  value: DashboardDefaultTaskView,
  cwd: string = process.cwd()
): TxConfig => {
  const configDir = resolve(cwd, ".tx")
  const configPath = resolve(configDir, "config.toml")
  const current = readTxConfig(cwd)
  const nextConfig: TxConfig = {
    ...current,
    dashboard: { ...current.dashboard, defaultTaskView: value },
  }

  mkdirSync(dirname(configPath), { recursive: true })
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const nextRaw = patchTomlKey(
    existingRaw,
    DASHBOARD_SECTION,
    DASHBOARD_DEFAULT_TASK_VIEW_KEY,
    `"${value}"`
  )
  writeFileSync(configPath, ensureTrailingNewline(nextRaw), "utf8")

  return nextConfig
}

/**
 * Read dashboard cycle settings from .tx/config.toml.
 */
export const readDashboardCyclesConfig = (
  cwd: string = process.cwd()
): DashboardCyclesConfig => readTxConfig(cwd).dashboard.cycles

/**
 * Patch dashboard cycle length in .tx/config.toml.
 */
export const writeDashboardCycleLengthDays = (
  value: number,
  cwd: string = process.cwd()
): TxConfig => {
  const configDir = resolve(cwd, ".tx")
  const configPath = resolve(configDir, "config.toml")
  const current = readTxConfig(cwd)
  const normalizedValue =
    Number.isFinite(value) && Number.isInteger(value) && value > 0
      ? value
      : current.dashboard.cycles.cycleLengthDays
  const nextConfig: TxConfig = {
    ...current,
    dashboard: {
      ...current.dashboard,
      cycles: { ...current.dashboard.cycles, cycleLengthDays: normalizedValue },
    },
  }

  mkdirSync(dirname(configPath), { recursive: true })
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const nextRaw = patchTomlKey(
    existingRaw,
    DASHBOARD_CYCLES_SECTION,
    DASHBOARD_CYCLE_LENGTH_DAYS_KEY,
    `${normalizedValue}`
  )
  writeFileSync(configPath, ensureTrailingNewline(nextRaw), "utf8")

  return nextConfig
}

/**
 * Patch dashboard cycle start day in .tx/config.toml.
 */
export const writeDashboardCycleStartDay = (
  value: DashboardCycleStartDay,
  cwd: string = process.cwd()
): TxConfig => {
  const configDir = resolve(cwd, ".tx")
  const configPath = resolve(configDir, "config.toml")
  const current = readTxConfig(cwd)
  const normalizedValue = DASHBOARD_CYCLE_START_DAYS.has(value)
    ? value
    : current.dashboard.cycles.cycleStartDay
  const nextConfig: TxConfig = {
    ...current,
    dashboard: {
      ...current.dashboard,
      cycles: { ...current.dashboard.cycles, cycleStartDay: normalizedValue },
    },
  }

  mkdirSync(dirname(configPath), { recursive: true })
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const nextRaw = patchTomlKey(
    existingRaw,
    DASHBOARD_CYCLES_SECTION,
    DASHBOARD_CYCLE_START_DAY_KEY,
    `"${normalizedValue}"`
  )
  writeFileSync(configPath, ensureTrailingNewline(nextRaw), "utf8")

  return nextConfig
}

/**
 * Patch dashboard cycle carry statuses in .tx/config.toml.
 */
export const writeDashboardCarryStatuses = (
  value: readonly string[],
  cwd: string = process.cwd()
): TxConfig => {
  const normalized = value
    .map((status) => status.trim())
    .filter((status) => status.length > 0)

  const configDir = resolve(cwd, ".tx")
  const configPath = resolve(configDir, "config.toml")
  const current = readTxConfig(cwd)
  const nextCarryStatuses = normalized.length > 0
    ? normalized
    : current.dashboard.cycles.carryStatuses
  const nextConfig: TxConfig = {
    ...current,
    dashboard: {
      ...current.dashboard,
      cycles: { ...current.dashboard.cycles, carryStatuses: [...nextCarryStatuses] },
    },
  }

  mkdirSync(dirname(configPath), { recursive: true })
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const renderedStatuses = `[${nextCarryStatuses.map((status) => JSON.stringify(status)).join(", ")}]`
  const nextRaw = patchTomlKey(
    existingRaw,
    DASHBOARD_CYCLES_SECTION,
    DASHBOARD_CARRY_STATUSES_KEY,
    renderedStatuses
  )
  writeFileSync(configPath, ensureTrailingNewline(nextRaw), "utf8")

  return nextConfig
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`
}

/**
 * Extract a value from a simple TOML file.
 * Handles [section] + key = "value" patterns.
 */
const extractTomlValue = (
  toml: string,
  section: string,
  key: string
): string | null => {
  const lines = toml.split("\n")
  let inSection = false
  for (const line of lines) {
    const trimmed = line.trim()
    // Check for section header
    if (trimmed === `[${section}]`) {
      inSection = true
      continue
    }
    // New section starts — stop looking
    if (trimmed.startsWith("[") && inSection) {
      break
    }
    // Look for key = "value", key = 'value', or key = unquoted
    if (inSection) {
      const quoted = trimmed.match(new RegExp(`^${key}\\s*=\\s*["'](.+?)["']$`))
      if (quoted) {
        return quoted[1]
      }
      const unquoted = trimmed.match(new RegExp(`^${key}\\s*=\\s*([^#\\s]+)`))
      if (unquoted) {
        return unquoted[1]
      }
    }
  }
  return null
}

/**
 * Extract an array value from TOML section/key.
 * Supports:
 * 1. key = ["a", "b", "c"] (single line)
 * 2. key = [ ... ] (multi-line)
 * 3. key = "a, b, c" (comma-separated fallback)
 */
const extractTomlArray = (
  toml: string,
  section: string,
  key: string
): string[] => {
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
    if (arrayStart) {
      let collected = trimmed
      while (!collected.includes("]") && i + 1 < lines.length) {
        i += 1
        collected += lines[i].trim()
      }

      const out: string[] = []
      const quoted = /["']([^"']+)["']/g
      let match: RegExpExecArray | null
      while ((match = quoted.exec(collected)) !== null) {
        if (match[1].trim().length > 0) out.push(match[1].trim())
      }
      return out
    }
  }

  const fallback = extractTomlValue(toml, section, key)
  if (!fallback) return []
  return fallback.split(",").map((s) => s.trim()).filter(Boolean)
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
    if (lines[i]?.trim() === sectionHeader) {
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

/**
 * The default config.toml content with comments and doc links.
 * Written by `tx init` if config.toml does not exist.
 */
const DEFAULT_CONFIG_TOML = `# tx configuration
# Full documentation: https://txdocs.dev/docs
#
# This file is created by \`tx init\` and lives at .tx/config.toml.
# Edit any value below to override the default. Commented-out lines
# show optional settings — uncomment them to enable.

# ─── Docs ───────────────────────────────────────────────────────────
# Structured documentation primitives for PRDs, design docs, and specs.
# Commands: tx doc add, tx doc show, tx doc list, tx doc validate
# Docs: https://txdocs.dev/docs/primitives/docs
[docs]

# Where tx stores YAML doc files on disk.
# Relative to the project root.
path = "specs"

# EARS (Easy Approach to Requirements Syntax) is mandatory for all PRDs.
# PRDs with legacy 'requirements' must also define 'ears_requirements'.

# ─── Spec Traceability ─────────────────────────────────────────────
# Invariant-to-test mapping discovery and completion scoring.
# Commands: tx spec discover, tx spec fci, tx spec matrix
[spec]

# Test file patterns scanned by tx spec discover.
# Add/remove patterns to match your project's languages and conventions.
test_patterns = [
  "test/**/*.test.{ts,js,tsx,jsx}",
  "tests/**/*.py",
  "**/*_test.go",
  "**/*_test.rs",
  "**/test_*.py",
  "**/*.spec.{ts,js,tsx,jsx}",
  "**/Test*.java",
  "**/*Test.java",
  "**/*_spec.rb",
  "**/*.test.{c,cpp,cc}",
  "**/*_test.{c,cpp,cc}",
]

# ─── Memory ─────────────────────────────────────────────────────────
# Filesystem-backed markdown search over your project's documentation.
# Index directories with \`tx memory source add <dir>\`, then search
# with \`tx memory search <query>\` (BM25) or \`--semantic\` (vector).
# Docs: https://txdocs.dev/docs/primitives/memory
[memory]

# Default directory used by \`tx memory add\` when no source is registered.
# If this directory isn't already a registered source, tx auto-registers
# it so new documents survive future \`tx memory index\` runs.
# Relative to the project root.
default_dir = "specs"

# ─── Cycles ─────────────────────────────────────────────────────────
# Sub-agent swarm for automated issue discovery.
# Run \`tx cycle\` to dispatch parallel scan agents that find issues,
# then review results in the dashboard or via \`tx list\`.
# Docs: https://txdocs.dev/docs/headful/docs-runs-cycles
[cycles]

# Optional prompt appended to each scan agent's system prompt.
# Use this to focus scans on specific areas (e.g. security, performance).
# scan_prompt = "Focus on security issues"

# Number of parallel scan agents to dispatch per cycle run.
# Higher values = faster scans but more API usage.
agents = 3

# LLM model used by cycle scan agents.
# Must be a valid Anthropic model ID.
model = "claude-opus-4-6"

# ─── Dashboard ──────────────────────────────────────────────────────
# Settings for the tx dashboard web UI (\`tx diag dashboard\`).
# The dashboard provides a visual interface for task management,
# doc browsing, run inspection, and cycle results.
# Docs: https://txdocs.dev/docs/headful/filters-and-settings
[dashboard]

# Default assignee type when creating new tasks from the dashboard.
# "human" = tasks are assigned to humans by default.
# "agent" = tasks are assigned to agents by default.
# Can be toggled per-task with Cmd+K in the dashboard.
default_task_assigment_type = "human"

# Default task view when opening the Tasks tab in the dashboard.
# "list" = table/list layout.
# "kanban" = status-column board layout.
default_task_view = "list"

# Weekly cycle planning settings used by dashboard cycle APIs.
[dashboard.cycles]

# Cycle duration in days.
cycle_length_days = 7

# Day of week that anchors cycle windows.
cycle_start_day = "monday"

# Non-done statuses carried into the next cycle when a cycle is completed.
carry_statuses = ["planning", "active", "blocked", "review", "needs_review"]

# ─── Pins ───────────────────────────────────────────────────────────
# Context pins — persistent named content blocks that are injected
# into agent context files as <tx-pin id="...">...</tx-pin> XML sections.
# This enables programmatic CRUD of agent memory across sessions.
# Commands: tx pin set, tx pin get, tx pin rm, tx pin list, tx pin sync
# Docs: https://txdocs.dev/docs/primitives/pin
[pins]

# Comma-separated list of files that \`tx pin sync\` writes pins into.
# Paths are relative to the project root.
# Both Claude Code (CLAUDE.md) and Codex (AGENTS.md) are synced by default
# so all agents share the same persistent context.
target_files = "CLAUDE.md, AGENTS.md"

# When true, agent-driven task completion is blocked for any task linked
# from a gate pin via \`taskId\`. Humans can still complete the task.
block_agent_done_when_task_id_present = true

# ─── Guard ─────────────────────────────────────────────────────────
# Task creation guards — lightweight limits checked at \`tx add\` time.
# Prevents unbounded task proliferation in agent loops.
# Commands: tx auto guard set, tx auto guard show, tx auto guard clear
[guard]

# Guard mode: "advisory" (default) or "enforce"
# Advisory: tasks are created with warning metadata, stderr warning printed
# Enforce: tx add fails with GuardExceededError when limits are hit
mode = "advisory"

# Default limits (can be overridden per-scope via tx auto guard set)
# max_pending = 50
# max_children = 10
# max_depth = 4

# ─── Verify ────────────────────────────────────────────────────────
# Machine-checkable done criteria attached to tasks.
# Attach a shell command to a task; \`tx auto verify run <id>\` executes it.
# Exit 0 = pass, non-zero = fail.
# Commands: tx auto verify set, tx auto verify show, tx auto verify run, tx auto verify clear
[verify]

# Default timeout in seconds for verification commands.
timeout = 300

# Default JSON schema for structured verification output.
# Leave commented for exit-code-only mode (default).
# default_schema = "verify-schema.json"

# ─── Reflect ───────────────────────────────────────────────────────
# Macro-level session retrospective — look at recent sessions,
# assess what is working, and surface machine-readable signals.
# Commands: tx auto reflect
[reflect]

# LLM provider for \`tx auto reflect --analyze\`
# "auto" = auto-detect from available env vars (default)
# "claude" = uses ANTHROPIC_API_KEY
# "codex" = uses OPENAI_API_KEY
provider = "auto"

# Model for analysis tier
# model = "claude-opus-4-6"

# Default number of sessions to analyze
default_sessions = 10

# Whether to include transcript parsing by default
include_transcripts = false
`

/**
 * Scaffold .tx/config.toml with annotated defaults.
 * No-op if the file already exists (preserves user edits).
 * Returns true if the file was created, false if it already existed.
 */
export const scaffoldConfigToml = (cwd: string = process.cwd()): boolean => {
  const configDir = resolve(cwd, ".tx")
  const configPath = resolve(configDir, "config.toml")
  if (existsSync(configPath)) {
    return false
  }
  mkdirSync(configDir, { recursive: true })
  writeFileSync(configPath, DEFAULT_CONFIG_TOML, "utf8")
  return true
}
