/**
 * Scaffold Claude Code or Codex integration files into the current project.
 *
 * Installs generated skills by default, with optional legacy CLAUDE.md / AGENTS.md
 * compatibility shims available through the lower-level scaffold helpers.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync, chmodSync, } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join, dirname, relative, } from "node:path"
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
}

interface CodexOptions extends SkillSelectionOptions {
  agentsMd?: boolean
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
    writeFileSync(manifestPath, manifestContent, "utf-8")
    return { copied: [relPath], skipped: [] }
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
      hint: `${skill.id}: ${skill.shortDescription}`,
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
    generateSkillBundles({ target, outputDir: tempDir, clean: true, contentRoot: projectDir })
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
  const opts = { claudeMd: false, ...options }
  const allCopied: string[] = []
  const allSkipped: string[] = []
  const templates = templatesDir()

  const generated = scaffoldGeneratedSkills(projectDir, "claude", { skills: opts.skills })
  allCopied.push(...generated.copied)
  allSkipped.push(...generated.skipped)

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
export async function interactiveScaffold(projectDir: string): Promise<void> {
  const wantsClaude = await p.confirm({
    message: "Add Claude Code integration? (generated .claude/skills)",
    initialValue: true,
  })
  if (p.isCancel(wantsClaude)) { p.cancel("Setup cancelled."); return }

  const results: ScaffoldResult[] = []

  if (wantsClaude) {
    const selectedClaudeSkills = await promptForSkills("claude")
    if (p.isCancel(selectedClaudeSkills)) { p.cancel("Setup cancelled."); return }

    const result = scaffoldClaude(projectDir, {
      claudeMd: false,
      skills: [...selectedClaudeSkills],
    })
    results.push(result)
    if (selectedClaudeSkills.length === 0) {
      p.log.info("Claude integration installed without tx skills. Re-run tx init or use tx skills sync later to add them.")
    }
  }

  const wantsCodex = await p.confirm({
    message: "Add Codex integration? (.codex/skills only)",
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

  const output = formatResults(results)
  if (output) {
    p.note(output, "Files")
  }

}
