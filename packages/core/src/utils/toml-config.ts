/**
 * Read and patch tx configuration from .tx/config.toml.
 * Returns defaults if file doesn't exist.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

export type DashboardDefaultTaskAssigmentType = "human" | "agent"

export interface TxConfig {
  docs: { path: string }
  memory: { defaultDir: string }
  cycles: { scanPrompt: string | null; agents: number; model: string }
  dashboard: { defaultTaskAssigmentType: DashboardDefaultTaskAssigmentType }
  pins: { targetFiles: string[] }
}

export const DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY = "default_task_assigment_type"
const DASHBOARD_SECTION = "dashboard"
const DOCS_SECTION = "docs"
const CYCLES_SECTION = "cycles"
const PINS_SECTION = "pins"

const MEMORY_SECTION = "memory"

const DEFAULT_CONFIG: TxConfig = {
  docs: { path: ".tx/docs" },
  memory: { defaultDir: "docs" },
  cycles: { scanPrompt: null, agents: 3, model: "claude-opus-4-6" },
  dashboard: { defaultTaskAssigmentType: "human" },
  pins: { targetFiles: ["CLAUDE.md", "AGENTS.md"] },
}

const isDashboardDefaultTaskAssigmentType = (
  value: string | null
): value is DashboardDefaultTaskAssigmentType =>
  value === "human" || value === "agent"

const parseTaskAssigmentTypeOrDefault = (value: string | null): DashboardDefaultTaskAssigmentType =>
  isDashboardDefaultTaskAssigmentType(value)
    ? value
    : DEFAULT_CONFIG.dashboard.defaultTaskAssigmentType

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
    return {
      docs: {
        path: docsPath ?? DEFAULT_CONFIG.docs.path,
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

# ─── Memory ─────────────────────────────────────────────────────────
# Filesystem-backed markdown search over your project's documentation.
# Index directories with \`tx memory source add <dir>\`, then search
# with \`tx memory search <query>\` (BM25) or \`--semantic\` (vector).
# Docs: https://txdocs.dev/docs/primitives/learning
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
