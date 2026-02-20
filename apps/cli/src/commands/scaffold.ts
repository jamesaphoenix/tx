/**
 * Scaffold Claude Code or Codex integration files into the current project.
 *
 * Copies template files (CLAUDE.md / AGENTS.md, skills, scripts) into the
 * user's project, skipping any files that already exist.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync, chmodSync } from "node:fs"
import { resolve, join, dirname, relative } from "node:path"
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
    message: "Add Codex integration? (AGENTS.md + .codex/agents)",
    initialValue: true,
  })
  if (p.isCancel(wantsCodex)) { p.cancel("Setup cancelled."); return }

  if (wantsCodex) {
    results.push(scaffoldCodex(projectDir))
  }

  const output = formatResults(results)
  if (output) {
    p.note(output, "Files")
  }

  if (!wantsClaude && !wantsCodex) {
    p.log.info("Skipped agent integration. Run tx init --claude or tx init --codex later.")
  }
}
