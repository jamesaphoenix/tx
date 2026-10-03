import { createHash } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { embeddedSkills } from "./embedded.js"
import { CLI_VERSION } from "../version.js"

export type SkillTarget = "claude" | "codex"
export type SkillTargetSelection = SkillTarget | "all"
export type GeneratedSkillSource = "generated" | "bundled"
export interface AvailableSkillDefinition { id: string; title: string; shortDescription: string; source: GeneratedSkillSource }
export interface GeneratedTargetSummary { target: SkillTarget; outputDir: string; manifestPath: string; skillCount: number; fileCount: number; commandCount: number }
export interface SkillGenerationResult { outputDir: string; targets: GeneratedTargetSummary[] }
// @spec INV-MINIMAL-001
const skills: AvailableSkillDefinition[] = [
  { id: "tx-plan", title: "Copy an implementation plan", shortDescription: "Copy a coding agent plan into docs, link its spec and retain a source symlink.", source: "bundled" },
  { id: "tx-tasks", title: "Create tx tasks", shortDescription: "Create tasks with acceptance criteria and optional document links or dependencies.", source: "bundled" },
  { id: "tx-docs", title: "Create tx documents", shortDescription: "Create design docs, optional product requirements and overviews.", source: "bundled" },
  { id: "verify-invariants", title: "Map and verify invariants", shortDescription: "Map invariants to enforcement code and tests, then record verification evidence.", source: "bundled" },
]
export const retiredSkillIds = new Set([
  "tx-core-loop", "tx-dependencies-hierarchy", "tx-autonomy-controls", "tx-memory-context", "tx-messaging-pins", "tx-docs-specs", "tx-sync-data", "tx-observability-traces", "tx-workers-runtime", "tx-graph-utils",
  "decompose-spec", "design-doc", "map-invariants", "overview-spec", "prd", "ralph-loop", "spec-doc", "skills-sync", "task-spec-loop", "system-design-doc", "subsystem-audit", "spec-to-implementation",
])
class SkillGenerationError extends Error {
  readonly _tag = "SkillGenerationError" as const
}
export function listAvailableSkills(): AvailableSkillDefinition[] { return skills.map(skill => ({ ...skill })) }

/** Templates consult live CLI help/configuration instead of embedding a second command catalogue. */
export function generateSkillBundles(options?: { target?: SkillTargetSelection; outputDir?: string; clean?: boolean; contentRoot?: string }): SkillGenerationResult {
  const outputDir = resolve(options?.outputDir ?? join(process.cwd(), ".tx", "generated-skills"))
  const selection = options?.target ?? "all"
  const targets: SkillTarget[] = selection === "all" ? ["claude", "codex"] : [selection]
  const summaries = targets.map((target): GeneratedTargetSummary => {
    const targetDir = join(outputDir, target), root = `.${target}/skills` as const
    if (options?.clean && existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true })
    const entries = skills.map(skill => {
      const installPath = `${root}/${skill.id}`
      const content = embeddedSkills[skill.id]
      if (content === undefined) throw new SkillGenerationError(`Missing bundled skill: ${skill.id}`)
      mkdirSync(join(targetDir, installPath), { recursive: true })
      writeFileSync(join(targetDir, installPath, "SKILL.md"), content)
      return { id: skill.id, title: skill.title, installPath, checksum: createHash("sha256").update(`${installPath}/SKILL.md\n${content}`).digest("hex"), commandKeys: [], source: skill.source }
    })
    const manifestPath = join(targetDir, root, "manifest.json")
    writeFileSync(manifestPath, `${JSON.stringify({ generator: "tx skills generate", version: CLI_VERSION, target, installRoot: root, skillCount: entries.length, commandCount: 0, skills: entries }, null, 2)}\n`)
    return { target, outputDir: targetDir, manifestPath, skillCount: entries.length, fileCount: entries.length + 1, commandCount: 0 }
  })
  return { outputDir, targets: summaries }
}
export function formatSkillGenerationResult(result: SkillGenerationResult, baseDir = process.cwd()): string {
  return ["Generated tx skill bundles:", ...result.targets.flatMap(target => [
    `  - ${target.target}: ${target.skillCount} skills, ${target.fileCount} files`,
    `    output: ${relative(baseDir, target.outputDir) || "."}`,
    `    manifest: ${relative(baseDir, target.manifestPath) || "."}`,
  ])].join("\n")
}
