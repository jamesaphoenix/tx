/**
 * Scaffold Claude Code or Codex integration files into the current project.
 *
 * Installs generated skills by default, with optional legacy CLAUDE.md / AGENTS.md
 * compatibility shims available through the lower-level scaffold helpers.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync, chmodSync, accessSync, constants as fsConstants } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join, dirname, relative, delimiter } from "node:path"
import { fileURLToPath } from "node:url"
import * as p from "@clack/prompts"
import { generateSkillBundles, listAvailableSkills, type SkillTarget } from "../skills/generate.js"

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

class ScaffoldError extends Error {
  readonly _tag = "ScaffoldError" as const
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
            throw new ScaffoldError(`Cannot scaffold '${relPath}': a parent path exists as a file. Move/delete conflicting path and retry.`)
          }
          throw new ScaffoldError(error instanceof Error ? error.message : String(error))
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

interface SkillSelectionOptions {
  skills?: readonly string[]
}

export interface ClaudeOptions extends SkillSelectionOptions {
  claudeMd?: boolean
  ralphScript?: boolean
}

interface CodexOptions extends SkillSelectionOptions {
  agentsMd?: boolean
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

interface ScaffoldSkillManifestEntry {
  id: string
  title: string
  installPath: string
  checksum: string
  commandKeys: string[]
  source: "generated" | "bundled"
}

interface ScaffoldSkillManifest {
  generator: "tx skills generate"
  version: string
  target: SkillTarget
  installRoot: ".claude/skills" | ".codex/skills"
  skillCount: number
  commandCount: number
  skills: ScaffoldSkillManifestEntry[]
}

const AVAILABLE_SKILLS = listAvailableSkills()
const AVAILABLE_SKILL_IDS = new Set(AVAILABLE_SKILLS.map((skill) => skill.id))

export function parseWatchdogRuntimeMode(value: string | boolean | undefined): WatchdogRuntimeMode {
  if (value === undefined) {
    return "auto"
  }
  if (value === true) {
    throw new ScaffoldError("Flag --watchdog-runtime requires a value: auto|codex|claude|both.")
  }
  if (typeof value !== "string") {
    throw new ScaffoldError("Flag --watchdog-runtime must be one of: auto|codex|claude|both.")
  }
  if (WATCHDOG_RUNTIME_MODES.includes(value as WatchdogRuntimeMode)) {
    return value as WatchdogRuntimeMode
  }
  throw new ScaffoldError(`Invalid --watchdog-runtime value: ${value} (expected: auto|codex|claude|both)`)
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
      throw new ScaffoldError(
        "Watchdog runtime 'codex' unavailable: codex CLI not found in PATH. Install codex or use --watchdog-runtime auto|claude."
      )
    }
    return { warnings: [], watchdogEnabled: true, codexEnabled: true, claudeEnabled: false }
  }

  if (mode === "claude") {
    if (!claudeAvailable) {
      throw new ScaffoldError(
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
      throw new ScaffoldError(`Watchdog runtime 'both' requires codex and claude; missing: ${missing.join(", ")}.`)
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

function installRoot(target: SkillTarget): string {
  return target === "claude" ? ".claude/skills" : ".codex/skills"
}

function normalizeSelectedSkills(skills: readonly string[] | undefined): string[] | undefined {
  if (skills === undefined) {
    return undefined
  }

  const normalized: string[] = []
  const seen = new Set<string>()
  const invalid: string[] = []

  for (const rawSkillId of skills) {
    const skillId = rawSkillId.trim()
    if (!skillId) {
      continue
    }
    if (!AVAILABLE_SKILL_IDS.has(skillId)) {
      invalid.push(skillId)
      continue
    }
    if (seen.has(skillId)) {
      continue
    }
    seen.add(skillId)
    normalized.push(skillId)
  }

  if (invalid.length > 0) {
    const available = AVAILABLE_SKILLS.map((skill) => skill.id).join(", ")
    throw new ScaffoldError(`Unknown tx skill id(s): ${invalid.join(", ")}. Available skills: ${available}`)
  }

  return normalized
}

function readSkillManifest(path: string): ScaffoldSkillManifest {
  return JSON.parse(readFileSync(path, "utf-8")) as ScaffoldSkillManifest
}

function renderSkillManifest(manifest: ScaffoldSkillManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function selectSkillManifest(
  manifest: ScaffoldSkillManifest,
  selectedSkillIds: readonly string[] | undefined,
): ScaffoldSkillManifest {
  if (selectedSkillIds === undefined) {
    return manifest
  }

  const selected = new Set(selectedSkillIds)
  const skills = manifest.skills.filter((skill) => selected.has(skill.id))

  return {
    ...manifest,
    skillCount: skills.length,
    commandCount: skills.reduce((total, skill) => total + skill.commandKeys.length, 0),
    skills,
  }
}

function writeManifestFile(
  destRoot: string,
  root: string,
  manifest: ScaffoldSkillManifest,
): Pick<ScaffoldResult, "copied" | "skipped"> {
  const manifestPath = join(destRoot, "manifest.json")
  const manifestContent = renderSkillManifest(manifest)
  const relPath = `${root}/manifest.json`

  if (existsSync(manifestPath)) {
    if (readFileSync(manifestPath, "utf-8") === manifestContent) {
      return { copied: [], skipped: [relPath] }
    }
    return { copied: [], skipped: [relPath] }
  }

  mkdirSync(destRoot, { recursive: true })
  writeFileSync(manifestPath, manifestContent, "utf-8")
  return { copied: [relPath], skipped: [] }
}

async function promptForSkills(target: SkillTarget): Promise<string[] | symbol> {
  return await p.multiselect({
    message:
      target === "claude"
        ? "Choose Claude tx skills to install"
        : "Choose Codex tx skills to install",
    initialValues: [],
    required: false,
    options: AVAILABLE_SKILLS.map((skill) => ({
      value: skill.id,
      label: skill.title,
      hint: `${skill.id} — ${skill.shortDescription}`,
    })),
  })
}

function scaffoldGeneratedSkills(
  projectDir: string,
  target: SkillTarget,
  options?: SkillSelectionOptions,
): ScaffoldResult {
  const tempDir = mkdtempSync(join(tmpdir(), `tx-generated-skills-${target}-`))
  const selectedSkillIds = normalizeSelectedSkills(options?.skills)

  try {
    generateSkillBundles({ target, outputDir: tempDir, clean: true })
    const root = installRoot(target)
    const src = join(tempDir, target, root)
    const dest = join(projectDir, root)
    const manifest = selectSkillManifest(
      readSkillManifest(join(src, "manifest.json")),
      selectedSkillIds,
    )
    const copied: string[] = []
    const skipped: string[] = []

    for (const skill of manifest.skills) {
      const result = copyTree(join(src, skill.id), join(dest, skill.id), dest)
      copied.push(...result.copied.map((path) => `${root}/${path}`))
      skipped.push(...result.skipped.map((path) => `${root}/${path}`))
    }

    const manifestResult = writeManifestFile(dest, root, manifest)
    copied.push(...manifestResult.copied)
    skipped.push(...manifestResult.skipped)

    return {
      copied,
      skipped,
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

/**
 * Scaffold Claude Code integration into the current project.
 */
export function scaffoldClaude(projectDir: string, options?: ClaudeOptions): ScaffoldResult {
  const opts = { claudeMd: false, ralphScript: false, ...options }
  const allCopied: string[] = []
  const allSkipped: string[] = []
  const templates = templatesDir()

  const generated = scaffoldGeneratedSkills(projectDir, "claude", { skills: opts.skills })
  allCopied.push(...generated.copied)
  allSkipped.push(...generated.skipped)

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
export function scaffoldCodex(projectDir: string, options?: CodexOptions): ScaffoldResult {
  const allCopied: string[] = []
  const allSkipped: string[] = []
  const templates = templatesDir()
  const opts = { agentsMd: false, ...options }

  const generated = scaffoldGeneratedSkills(projectDir, "codex", { skills: opts.skills })
  allCopied.push(...generated.copied)
  allSkipped.push(...generated.skipped)

  // Copy codex command policy rules
  const codexRulesSrc = join(templates, "codex", "rules")
  const codexRulesDest = join(projectDir, ".codex", "rules")
  const rulesResult = copyTree(codexRulesSrc, codexRulesDest)
  allCopied.push(...rulesResult.copied.map(p => `.codex/rules/${p}`))
  allSkipped.push(...rulesResult.skipped.map(p => `.codex/rules/${p}`))

  if (opts.agentsMd) {
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
    message: "Add Claude Code integration? (generated .claude/skills)",
    initialValue: true,
  })
  if (p.isCancel(wantsClaude)) { p.cancel("Setup cancelled."); return }

  const results: ScaffoldResult[] = []

  if (wantsClaude) {
    const selectedClaudeSkills = await promptForSkills("claude")
    if (p.isCancel(selectedClaudeSkills)) { p.cancel("Setup cancelled."); return }

    const wantsRalph = await p.confirm({
      message: "Include ralph script? (autonomous task loop)",
      initialValue: false,
    })
    if (p.isCancel(wantsRalph)) { p.cancel("Setup cancelled."); return }

    const result = scaffoldClaude(projectDir, {
      claudeMd: false,
      ralphScript: !!wantsRalph,
      skills: [...selectedClaudeSkills],
    })
    results.push(result)
    if (selectedClaudeSkills.length === 0) {
      p.log.info("Claude integration installed without tx skills. Re-run tx init or use tx skills sync later to add them.")
    }
  }

  const wantsCodex = await p.confirm({
    message: "Add Codex integration? (generated .codex/skills + .codex/rules)",
    initialValue: true,
  })
  if (p.isCancel(wantsCodex)) { p.cancel("Setup cancelled."); return }

  if (wantsCodex) {
    const selectedCodexSkills = await promptForSkills("codex")
    if (p.isCancel(selectedCodexSkills)) { p.cancel("Setup cancelled."); return }

    results.push(scaffoldCodex(projectDir, { skills: [...selectedCodexSkills] }))
    if (selectedCodexSkills.length === 0) {
      p.log.info("Codex integration installed without tx skills. Re-run tx init or use tx skills sync later to add them.")
    }
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
