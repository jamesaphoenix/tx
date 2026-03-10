/**
 * Read and patch tx configuration from .tx/config.toml.
 * Returns defaults if file doesn't exist.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

export type DashboardDefaultTaskAssigmentType = "human" | "agent"
export type GuardMode = "advisory" | "enforce"

export type TxConfig = {
  docs: { path: string }
  spec: { testPatterns: string[] }
  memory: { defaultDir: string }
  cycles: { scanPrompt: string | null; agents: number; model: string }
  dashboard: { defaultTaskAssigmentType: DashboardDefaultTaskAssigmentType }
  pins: { targetFiles: string[]; blockAgentDoneWhenTaskIdPresent: boolean }
  guard: { mode: GuardMode; maxPending: number | null; maxChildren: number | null; maxDepth: number | null }
  verify: { timeout: number; defaultSchema: string | null }
  reflect: { provider: string; model: string | null; defaultSessions: number; includeTranscripts: boolean }};

export const DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY = "default_task_assigment_type"
const DASHBOARD_SECTION = "dashboard"
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
  docs: { path: ".tx/docs" },
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
  memory: { defaultDir: "docs" },
  cycles: { scanPrompt: null, agents: 3, model: "claude-opus-4-6" },
  dashboard: { defaultTaskAssigmentType: "human" },
  pins: { targetFiles: ["CLAUDE.md", "AGENTS.md"], blockAgentDoneWhenTaskIdPresent: true },
  guard: { mode: "advisory", maxPending: null, maxChildren: null, maxDepth: null },
  verify: { timeout: 300, defaultSchema: null },
  reflect: { provider: "auto", model: null, defaultSessions: 10, includeTranscripts: false },
}

const isDashboardDefaultTaskAssigmentType = (
  value: string | null
): value is DashboardDefaultTaskAssigmentType =>
  value === "human" || value === "agent"

const parseTaskAssigmentTypeOrDefault = (value: string | null): DashboardDefaultTaskAssigmentType =>
  isDashboardDefaultTaskAssigmentType(value)
    ? value
    : DEFAULT_CONFIG.dashboard.defaultTaskAssigmentType

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
  const nextConfig: TxConfig = { ...current, dashboard: { defaultTaskAssigmentType: value } }

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
path = ".tx/docs"

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
default_dir = "docs"

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
# Settings for the tx dashboard web UI (\`tx dashboard\`).
# The dashboard provides a visual interface for task management,
# doc browsing, run inspection, and cycle results.
# Docs: https://txdocs.dev/docs/headful/filters-and-settings
[dashboard]

# Default assignee type when creating new tasks from the dashboard.
# "human" = tasks are assigned to humans by default.
# "agent" = tasks are assigned to agents by default.
# Can be toggled per-task with Cmd+K in the dashboard.
default_task_assigment_type = "human"

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
# Commands: tx guard set, tx guard show, tx guard clear
[guard]

# Guard mode: "advisory" (default) or "enforce"
# Advisory: tasks are created with warning metadata, stderr warning printed
# Enforce: tx add fails with GuardExceededError when limits are hit
mode = "advisory"

# Default limits (can be overridden per-scope via tx guard set)
# max_pending = 50
# max_children = 10
# max_depth = 4

# ─── Verify ────────────────────────────────────────────────────────
# Machine-checkable done criteria attached to tasks.
# Attach a shell command to a task; \`tx verify run <id>\` executes it.
# Exit 0 = pass, non-zero = fail.
# Commands: tx verify set, tx verify show, tx verify run, tx verify clear
[verify]

# Default timeout in seconds for verification commands.
timeout = 300

# Default JSON schema for structured verification output.
# Leave commented for exit-code-only mode (default).
# default_schema = "verify-schema.json"

# ─── Reflect ───────────────────────────────────────────────────────
# Macro-level session retrospective — look at recent sessions,
# assess what is working, and surface machine-readable signals.
# Commands: tx reflect
[reflect]

# LLM provider for \`tx reflect --analyze\`
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
