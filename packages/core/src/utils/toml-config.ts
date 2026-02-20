/**
 * Read and patch tx configuration from .tx/config.toml.
 * Returns defaults if file doesn't exist.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

export type DashboardDefaultTaskAssigmentType = "human" | "agent"

export interface TxConfig {
  docs: { path: string }
  cycles: { scanPrompt: string | null; agents: number; model: string }
  dashboard: { defaultTaskAssigmentType: DashboardDefaultTaskAssigmentType }
}

export const DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY = "default_task_assigment_type"
const DASHBOARD_SECTION = "dashboard"
const DOCS_SECTION = "docs"
const CYCLES_SECTION = "cycles"

const DEFAULT_CONFIG: TxConfig = {
  docs: { path: ".tx/docs" },
  cycles: { scanPrompt: null, agents: 3, model: "claude-opus-4-6" },
  dashboard: { defaultTaskAssigmentType: "human" },
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
    return {
      docs: {
        path: docsPath ?? DEFAULT_CONFIG.docs.path,
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
  const nextConfig = { ...readTxConfig(cwd), dashboard: { defaultTaskAssigmentType: value } }

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
