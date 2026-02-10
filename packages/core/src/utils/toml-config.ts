/**
 * Read tx configuration from .tx/config.toml.
 * Returns defaults if file doesn't exist.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

export interface TxConfig {
  docs: { path: string }
  cycles: { scanPrompt: string | null; agents: number; model: string }
}

const DEFAULT_CONFIG: TxConfig = {
  docs: { path: ".tx/docs" },
  cycles: { scanPrompt: null, agents: 3, model: "claude-opus-4-6" },
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
    // We only support [docs] section with path key.
    const docsPath = extractTomlValue(raw, "docs", "path")
    const cyclesScanPrompt = extractTomlValue(raw, "cycles", "scan_prompt")
    const cyclesAgents = extractTomlValue(raw, "cycles", "agents")
    const cyclesModel = extractTomlValue(raw, "cycles", "model")
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
    }
  } catch {
    return DEFAULT_CONFIG
  }
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
