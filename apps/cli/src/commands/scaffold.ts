/**
 * Scaffold Claude Code or Codex integration files into the current project.
 *
 * Copies template files (CLAUDE.md / AGENTS.md, skills, scripts, codex rules) into the
 * user's project, skipping any files that already exist.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, chmodSync, accessSync, constants as fsConstants } from "node:fs"
import { resolve, join, dirname, relative, delimiter } from "node:path"
import { fileURLToPath } from "node:url"
import * as p from "@clack/prompts"

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Resolve the templates directory relative to this source file */
function templatesDir(): string {
  return resolve(__dirname, "..", "templates")
}

/**
 * Detect whether a document already has the tx onboarding section.
 * Accepts either '-' or '—' in the heading to avoid accidental duplicates.
 */
function hasTxSection(content: string): boolean {
  return /^\s*#\s*tx\s*[—-]\s*Headless,\s*Local Infra for AI Agents\s*$/im.test(content)
}

/**
 * Recursively copy files from src to dest, skipping files that already exist.
 * Returns arrays of copied and skipped file paths (relative to dest).
 */
function copyTree(
  src: string,
  dest: string,
  baseDir?: string,
): { copied: string[]; skipped: string[] } {
  const copied: string[] = []
  const skipped: string[] = []
  const base = baseDir ?? dest

  if (!existsSync(src)) return { copied, skipped }

  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry)
    const destPath = join(dest, entry)
    const stat = statSync(srcPath)

    if (stat.isDirectory()) {
      const sub = copyTree(srcPath, destPath, base)
      copied.push(...sub.copied)
      skipped.push(...sub.skipped)
    } else {
      const relPath = relative(base, destPath)
      if (existsSync(destPath)) {
        skipped.push(relPath)
      } else {
        try {
          mkdirSync(dirname(destPath), { recursive: true })
        } catch (error) {
          const err = error as NodeJS.ErrnoException
          if (err.code === "ENOTDIR") {
            throw new Error(`Cannot scaffold '${relPath}': a parent path exists as a file. Move/delete conflicting path and retry.`)
          }
          throw error
        }
        writeFileSync(destPath, readFileSync(srcPath))
        // Make .sh files executable
        if (destPath.endsWith(".sh")) {
          chmodSync(destPath, 0o755)
        }
        copied.push(relPath)
      }
    }
  }

  return { copied, skipped }
}

export interface ScaffoldResult {
  copied: string[]
  skipped: string[]
}

export interface ClaudeOptions {
  claudeMd?: boolean
  workflowSkill?: boolean
  cycleSkill?: boolean
  ralphScript?: boolean
}

export type WatchdogRuntimeMode = "auto" | "codex" | "claude" | "both"

const WATCHDOG_RUNTIME_MODES = ["auto", "codex", "claude", "both"] as const

export interface WatchdogScaffoldOptions {
  runtimeMode?: WatchdogRuntimeMode
  detached?: boolean
  pathEnv?: string
}

export interface WatchdogScaffoldResult extends ScaffoldResult {
  warnings: string[]
  runtimeMode: WatchdogRuntimeMode
  watchdogEnabled: boolean
  codexEnabled: boolean
  claudeEnabled: boolean
}

export interface InteractiveScaffoldOptions {
  watchdogRuntimeMode?: WatchdogRuntimeMode
}

interface ResolvedWatchdogRuntime {
  warnings: string[]
  watchdogEnabled: boolean
  codexEnabled: boolean
  claudeEnabled: boolean
}

export function parseWatchdogRuntimeMode(value: string | boolean | undefined): WatchdogRuntimeMode {
  if (value === undefined) {
    return "auto"
  }
  if (value === true) {
    throw new Error("Flag --watchdog-runtime requires a value: auto|codex|claude|both.")
  }
  if (typeof value !== "string") {
    throw new Error("Flag --watchdog-runtime must be one of: auto|codex|claude|both.")
  }
  if (WATCHDOG_RUNTIME_MODES.includes(value as WatchdogRuntimeMode)) {
    return value as WatchdogRuntimeMode
  }
  throw new Error(`Invalid --watchdog-runtime value: ${value} (expected: auto|codex|claude|both)`)
}

function commandAvailable(commandName: string, pathEnv: string): boolean {
  if (!pathEnv) {
    return false
  }

  const pathEntries = pathEnv.split(delimiter).filter(Boolean)
  const isWindows = process.platform === "win32"
  const extensions = isWindows
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""]

  for (const entry of pathEntries) {
    for (const ext of extensions) {
      const candidate = join(entry, isWindows ? `${commandName}${ext}` : commandName)
      try {
        accessSync(candidate, fsConstants.X_OK)
        if (statSync(candidate).isFile()) {
          return true
        }
      } catch {
        continue
      }
    }
  }

  return false
}

function resolveWatchdogRuntime(mode: WatchdogRuntimeMode, pathEnv: string): ResolvedWatchdogRuntime {
  const codexAvailable = commandAvailable("codex", pathEnv)
  const claudeAvailable = commandAvailable("claude", pathEnv)

  if (mode === "codex") {
    if (!codexAvailable) {
      throw new Error(
        "Watchdog runtime 'codex' unavailable: codex CLI not found in PATH. Install codex or use --watchdog-runtime auto|claude."
      )
    }
    return { warnings: [], watchdogEnabled: true, codexEnabled: true, claudeEnabled: false }
  }

  if (mode === "claude") {
    if (!claudeAvailable) {
      throw new Error(
        "Watchdog runtime 'claude' unavailable: claude CLI not found in PATH. Install claude or use --watchdog-runtime auto|codex."
      )
    }
    return { warnings: [], watchdogEnabled: true, codexEnabled: false, claudeEnabled: true }
  }

  if (mode === "both") {
    const missing: string[] = []
    if (!codexAvailable) missing.push("codex")
    if (!claudeAvailable) missing.push("claude")
    if (missing.length > 0) {
      throw new Error(`Watchdog runtime 'both' requires codex and claude; missing: ${missing.join(", ")}.`)
    }
    return { warnings: [], watchdogEnabled: true, codexEnabled: true, claudeEnabled: true }
  }

  const codexEnabled = codexAvailable
  const claudeEnabled = claudeAvailable
  const watchdogEnabled = codexEnabled || claudeEnabled
  const warnings = watchdogEnabled
    ? []
    : [
        "Watchdog runtime auto-detect found no codex/claude CLI in PATH. Assets were scaffolded with WATCHDOG_ENABLED=0.",
        "Install a runtime and update .tx/watchdog.env to enable watchdog supervision.",
      ]

  return {
    warnings,
    watchdogEnabled,
    codexEnabled,
    claudeEnabled,
  }
}

function renderWatchdogEnv(
  mode: WatchdogRuntimeMode,
  runtime: ResolvedWatchdogRuntime,
  detached: boolean,
): string {
  const as01 = (value: boolean): string => (value ? "1" : "0")
  const lines = [
    `WATCHDOG_ENABLED=${as01(runtime.watchdogEnabled)}`,
    `WATCHDOG_RUNTIME_MODE=${mode}`,
    `WATCHDOG_CODEX_ENABLED=${as01(runtime.codexEnabled)}`,
    `WATCHDOG_CLAUDE_ENABLED=${as01(runtime.claudeEnabled)}`,
    "WATCHDOG_POLL_SECONDS=300",
    "WATCHDOG_TRANSCRIPT_IDLE_SECONDS=600",
    "WATCHDOG_CLAUDE_STALL_GRACE_SECONDS=900",
    "WATCHDOG_HEARTBEAT_LAG_SECONDS=180",
    "WATCHDOG_RUN_STALE_SECONDS=5400",
    "WATCHDOG_IDLE_ROUNDS=300",
    "WATCHDOG_ERROR_BURST_WINDOW_MINUTES=20",
    "WATCHDOG_ERROR_BURST_THRESHOLD=4",
    "WATCHDOG_ERROR_BURST_GRACE_SECONDS=600",
    "WATCHDOG_RESTART_COOLDOWN_SECONDS=900",
    `WATCHDOG_DETACHED=${detached ? "1" : "0"}`,
  ]

  return `${lines.join("\n")}\n`
}

/**
 * Scaffold Claude Code integration into the current project.
 */
export function scaffoldClaude(projectDir: string, options?: ClaudeOptions): ScaffoldResult {
  const opts = { claudeMd: true, workflowSkill: true, cycleSkill: true, ralphScript: false, ...options }
  const allCopied: string[] = []
  const allSkipped: string[] = []
  const templates = templatesDir()

  // Copy individual skills based on options
  const skillsDest = join(projectDir, ".claude", "skills")
  const skillsToInclude: string[] = []
  if (opts.workflowSkill) skillsToInclude.push("tx-workflow")
  if (opts.cycleSkill) skillsToInclude.push("tx-cycle")

  for (const skill of skillsToInclude) {
    const src = join(templates, "claude", "skills", skill)
    const dest = join(skillsDest, skill)
    const result = copyTree(src, dest)
    allCopied.push(...result.copied.map(p => `.claude/skills/${skill}/${p}`))
    allSkipped.push(...result.skipped.map(p => `.claude/skills/${skill}/${p}`))
  }

  // Copy ralph script
  if (opts.ralphScript) {
    const scriptsSrc = join(templates, "claude", "scripts")
    const scriptsDest = join(projectDir, "scripts")
    const result = copyTree(scriptsSrc, scriptsDest)
    allCopied.push(...result.copied.map(p => `scripts/${p}`))
    allSkipped.push(...result.skipped.map(p => `scripts/${p}`))
  }

  // Copy/create CLAUDE.md
  if (opts.claudeMd) {
    const claudeMdSrc = join(templates, "claude", "CLAUDE.md")
    const claudeMdDest = join(projectDir, "CLAUDE.md")

    if (existsSync(claudeMdDest)) {
      const existing = readFileSync(claudeMdDest, "utf-8")
      if (hasTxSection(existing)) {
        allSkipped.push("CLAUDE.md (tx section already present)")
      } else {
        const txSection = readFileSync(claudeMdSrc, "utf-8")
        writeFileSync(claudeMdDest, existing + "\n\n" + txSection)
        allCopied.push("CLAUDE.md (appended tx section)")
      }
    } else {
      writeFileSync(claudeMdDest, readFileSync(claudeMdSrc, "utf-8"))
      allCopied.push("CLAUDE.md")
    }
  }

  return { copied: allCopied, skipped: allSkipped }
}

/**
 * Scaffold Codex integration into the current project.
 */
export function scaffoldCodex(projectDir: string): ScaffoldResult {
  const allCopied: string[] = []
  const allSkipped: string[] = []
  const templates = templatesDir()

  // Copy codex agent profiles
  const codexAgentsSrc = join(templates, "codex", "agents")
  const codexAgentsDest = join(projectDir, ".codex", "agents")
  const agentsResult = copyTree(codexAgentsSrc, codexAgentsDest)
  allCopied.push(...agentsResult.copied.map(p => `.codex/agents/${p}`))
  allSkipped.push(...agentsResult.skipped.map(p => `.codex/agents/${p}`))

  // Copy codex command policy rules
  const codexRulesSrc = join(templates, "codex", "rules")
  const codexRulesDest = join(projectDir, ".codex", "rules")
  const rulesResult = copyTree(codexRulesSrc, codexRulesDest)
  allCopied.push(...rulesResult.copied.map(p => `.codex/rules/${p}`))
  allSkipped.push(...rulesResult.skipped.map(p => `.codex/rules/${p}`))

  const agentsMdSrc = join(templates, "codex", "AGENTS.md")
  const agentsMdDest = join(projectDir, "AGENTS.md")

  if (existsSync(agentsMdDest)) {
    const existing = readFileSync(agentsMdDest, "utf-8")
    if (hasTxSection(existing)) {
      allSkipped.push("AGENTS.md (tx section already present)")
    } else {
      const txSection = readFileSync(agentsMdSrc, "utf-8")
      writeFileSync(agentsMdDest, existing + "\n\n" + txSection)
      allCopied.push("AGENTS.md (appended tx section)")
    }
  } else {
    writeFileSync(agentsMdDest, readFileSync(agentsMdSrc, "utf-8"))
    allCopied.push("AGENTS.md")
  }

  return { copied: allCopied, skipped: allSkipped }
}

/**
 * Scaffold watchdog supervision scripts/config into the current project.
 * Runtime-specific toggles are persisted in .tx/watchdog.env.
 */
export function scaffoldWatchdog(projectDir: string, options?: WatchdogScaffoldOptions): WatchdogScaffoldResult {
  const allCopied: string[] = []
  const allSkipped: string[] = []
  const mode = options?.runtimeMode ?? "auto"
  const runtime = resolveWatchdogRuntime(mode, options?.pathEnv ?? (process.env.PATH ?? ""))
  const detached = options?.detached !== false
  const templates = templatesDir()

  const scriptsSrc = join(templates, "watchdog", "scripts")
  const scriptsDest = join(projectDir, "scripts")
  const scriptsResult = copyTree(scriptsSrc, scriptsDest)
  allCopied.push(...scriptsResult.copied.map(p => `scripts/${p}`))
  allSkipped.push(...scriptsResult.skipped.map(p => `scripts/${p}`))

  const opsSrc = join(templates, "watchdog", "ops")
  const opsDest = join(projectDir, "ops")
  const opsResult = copyTree(opsSrc, opsDest)
  allCopied.push(...opsResult.copied.map(p => `ops/${p}`))
  allSkipped.push(...opsResult.skipped.map(p => `ops/${p}`))

  const envPath = join(projectDir, ".tx", "watchdog.env")
  if (existsSync(envPath)) {
    allSkipped.push(".tx/watchdog.env")
  } else {
    mkdirSync(dirname(envPath), { recursive: true })
    writeFileSync(envPath, renderWatchdogEnv(mode, runtime, detached))
    allCopied.push(".tx/watchdog.env")
  }

  return {
    copied: allCopied,
    skipped: allSkipped,
    warnings: runtime.warnings,
    runtimeMode: mode,
    watchdogEnabled: runtime.watchdogEnabled,
    codexEnabled: runtime.codexEnabled,
    claudeEnabled: runtime.claudeEnabled,
  }
}

/** Format scaffold results for clack note */
function formatResults(results: ScaffoldResult[]): string {
  const lines: string[] = []
  for (const r of results) {
    for (const f of r.copied) lines.push(`  + ${f}`)
    for (const f of r.skipped) lines.push(`  ~ ${f} (exists)`)
  }
  return lines.join("\n")
}

/**
 * Interactive scaffold using @clack/prompts.
 * Asks the user what they want step by step.
 */
export async function interactiveScaffold(projectDir: string, options?: InteractiveScaffoldOptions): Promise<void> {
  const watchdogRuntimeMode = options?.watchdogRuntimeMode ?? "auto"
  const wantsClaude = await p.confirm({
    message: "Add Claude Code integration? (CLAUDE.md + skills)",
    initialValue: true,
  })
  if (p.isCancel(wantsClaude)) { p.cancel("Setup cancelled."); return }

  const results: ScaffoldResult[] = []

  if (wantsClaude) {
    const wantsCycle = await p.confirm({
      message: "Include cycle sub-agent skill? (automated issue discovery)",
      initialValue: true,
    })
    if (p.isCancel(wantsCycle)) { p.cancel("Setup cancelled."); return }

    const wantsRalph = await p.confirm({
      message: "Include ralph script? (autonomous task loop)",
      initialValue: false,
    })
    if (p.isCancel(wantsRalph)) { p.cancel("Setup cancelled."); return }

    const result = scaffoldClaude(projectDir, {
      claudeMd: true,
      workflowSkill: true,
      cycleSkill: !!wantsCycle,
      ralphScript: !!wantsRalph,
    })
    results.push(result)
  }

  const wantsCodex = await p.confirm({
    message: "Add Codex integration? (AGENTS.md + .codex/agents + .codex/rules)",
    initialValue: true,
  })
  if (p.isCancel(wantsCodex)) { p.cancel("Setup cancelled."); return }

  if (wantsCodex) {
    results.push(scaffoldCodex(projectDir))
  }

  const wantsWatchdog = await p.confirm({
    message: "Enable watchdog supervision for detached RALPH loops? (default: No)",
    initialValue: false,
  })
  if (p.isCancel(wantsWatchdog)) { p.cancel("Setup cancelled."); return }

  if (wantsWatchdog) {
    const watchdogResult = scaffoldWatchdog(projectDir, { runtimeMode: watchdogRuntimeMode })
    for (const warning of watchdogResult.warnings) {
      p.log.warn(warning)
    }
    results.push(watchdogResult)
  }

  const output = formatResults(results)
  if (output) {
    p.note(output, "Files")
  }

  if (!wantsClaude && !wantsCodex && !wantsWatchdog) {
    p.log.info("Skipped integrations. Run tx init --claude, --codex, or --watchdog later.")
  }
}
