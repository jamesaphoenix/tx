import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { HELP_TEXT, commandHelp } from "../help.js"
import { CLI_VERSION } from "../version.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const SHARED_SKILLS_DIR = resolve(__dirname, "..", "templates", "shared-skills")

export type SkillTarget = "claude" | "codex"
export type SkillTargetSelection = SkillTarget | "all"
export type GeneratedSkillSource = "generated" | "bundled"

export interface AvailableSkillDefinition {
  id: string
  title: string
  shortDescription: string
  source: GeneratedSkillSource
}

interface SkillGroupDefinition {
  id: string
  title: string
  shortDescription: string
  whenToUse: string
  quickStart: string[]
  operationalNotes?: string[]
}

interface GeneratedSkill {
  id: string
  title: string
  commandKeys: string[]
  installPath: string
  files: Array<{ relativePath: string; content: string }>
  checksum: string
  source: GeneratedSkillSource
}

interface TargetManifest {
  generator: "tx skills generate"
  version: string
  target: SkillTarget
  installRoot: ".claude/skills" | ".codex/skills"
  skillCount: number
  commandCount: number
  skills: Array<{
    id: string
    title: string
    installPath: string
    checksum: string
    commandKeys: string[]
    source: "generated" | "bundled"
  }>
}

export interface GeneratedTargetSummary {
  target: SkillTarget
  outputDir: string
  manifestPath: string
  skillCount: number
  fileCount: number
  commandCount: number
}

export interface SkillGenerationResult {
  outputDir: string
  targets: GeneratedTargetSummary[]
}

class SkillGenerationError extends Error {
  readonly _tag = "SkillGenerationError" as const
}

const SKILL_GROUPS: readonly SkillGroupDefinition[] = [
  {
    id: "tx-core-loop",
    title: "tx Core Loop",
    shortDescription: "Work the main tx queue: initialize, create tasks, inspect work, claim tasks, and complete them.",
    whenToUse: "Use when the user is setting up tx or moving normal task work through the queue.",
    quickStart: [
      "tx ready --limit 1 --json",
      "tx show <task-id>",
      "tx done <task-id>",
    ],
  },
  {
    id: "tx-dependencies-hierarchy",
    title: "tx Dependencies And Hierarchy",
    shortDescription: "Model blockers, parent-child relationships, and shared group context.",
    whenToUse: "Use when tasks need ordering, tree inspection, or inherited rollout context.",
    quickStart: [
      "tx dep block <task-id> <blocker-id>",
      "tx dep tree <task-id>",
      "tx group-context set <task-id> \"shared context\"",
    ],
  },
  {
    id: "tx-autonomy-controls",
    title: "tx Autonomy Controls",
    shortDescription: "Configure gates, guards, labels, verification, and retrospectives for bounded autonomy.",
    whenToUse: "Use when the user wants phase gates, verification hooks, or scoped ready queues.",
    quickStart: [
      "tx auto guard show",
      "tx auto verify run <task-id>",
      "tx auto gate status",
    ],
  },
  {
    id: "tx-memory-context",
    title: "tx Memory And Context",
    shortDescription: "Store, recall, search, and relate memory documents, learnings, and task context.",
    whenToUse: "Use when the user needs retrieval, prompt context, or durable learnings tied to files and tasks.",
    quickStart: [
      "tx memory context <task-id>",
      "tx memory search <query>",
      "tx memory recall <path>",
    ],
  },
  {
    id: "tx-messaging-pins",
    title: "tx Messaging And Pins",
    shortDescription: "Send agent messages, acknowledge inbox items, and persist shared context pins.",
    whenToUse: "Use when coordinating agents through channels or syncing pinned context into agent files.",
    quickStart: [
      "tx msg inbox <channel>",
      "tx msg send <channel> \"message\"",
      "tx pin sync",
    ],
  },
  {
    id: "tx-docs-specs",
    title: "tx Docs And Specs",
    shortDescription: "Create, patch, lint, discover, trace, and complete docs-first specs.",
    whenToUse: "Use when the user is working in PRDs, DDs, invariants, decision tracking, or markdown export flows.",
    quickStart: [
      "tx doc add prd <feature>-prd --title \"Title\"",
      "tx doc sync <doc-ref>",
      "tx spec discover --doc <doc-ref>",
      "tx spec lint",
    ],
    operationalNotes: [
      "Treat `<doc-ref>` as a globally unique name, a kind-scoped reference such as `design/auth-flow`, or a stable `doc_id`. Prefer distinct companion names such as `<feature>-prd` and `<feature>-design`; use `tx doc list --json` to recover IDs for legacy duplicate slugs.",
      "`tx doc sync <doc-ref>` refreshes the stored document record, document-derived invariants, and generated index in one transaction.",
      "`tx spec discover` reports every stale tag, comment, and manifest mapping by identity. It retains them by default; use `--dry-run` to preview all writes and `--prune` to delete stale auto-discovered mappings explicitly. Manual mappings are always preserved.",
      "Task state can remain shared while derived spec projections are scoped to the content checkout. Use `--state-root <main-repo>` with `--content-root <worktree>` when the roots differ, and confirm both with `tx diag doctor`.",
      "Clear drift with `tx doc sync <doc-ref>`. Never remove and recreate a document merely to update its hash.",
    ],
  },
  {
    id: "tx-sync-data",
    title: "tx Sync And Data",
    shortDescription: "Export, import, migrate, hydrate, and compact task state and sync artifacts.",
    whenToUse: "Use when data needs to move between SQLite, JSONL, Codex, Claude, or migration layers.",
    quickStart: [
      "tx sync export",
      "tx sync status",
      "tx sync compact",
    ],
  },
  {
    id: "tx-observability-traces",
    title: "tx Observability And Traces",
    shortDescription: "Inspect queue health, diagnostics, dashboards, run traces, and recent failures.",
    whenToUse: "Use when the user is debugging tx behavior, stalled runs, or dashboard/API status.",
    quickStart: [
      "tx diag doctor",
      "tx trace list",
      "tx trace errors",
    ],
  },
  {
    id: "tx-workers-runtime",
    title: "tx Workers And Runtime",
    shortDescription: "Operate workers, daemons, coordinators, cycle scans, and hook installation paths.",
    whenToUse: "Use when the user is orchestrating background workers, cycle scans, or long-running runtime processes.",
    quickStart: [
      "tx worker status",
      "tx coordinator status",
      "tx cycle --help",
    ],
  },
  {
    id: "tx-graph-utils",
    title: "tx Graph And Utilities",
    shortDescription: "Inspect graph anchors plus supporting utility and usage commands.",
    whenToUse: "Use when the user is repairing anchor graphs, checking CLI usage limits, or working with utility helpers.",
    quickStart: [
      "tx graph:status",
      "tx graph:verify",
      "tx utils codex-usage",
    ],
  },
] as const

const BUNDLED_SKILLS = [
  {
    id: "decompose-spec",
    title: "Decompose Spec",
    shortDescription: "Turn a design spec into a first-pass tx task graph.",
  },
  {
    id: "design-doc",
    title: "Design Doc",
    shortDescription: "Write architecture-first design docs from a tracked plan.",
  },
  {
    id: "map-invariants",
    title: "Map Invariants",
    shortDescription: "Link existing tests and source to design invariants.",
  },
  {
    id: "overview-spec",
    title: "Overview Spec",
    shortDescription: "Create an architectural overview spec before implementation.",
  },
  {
    id: "prd",
    title: "Product Requirements Document",
    shortDescription: "Write a PRD with EARS requirements and acceptance criteria.",
  },
  {
    id: "ralph-loop",
    title: "Ralph Loop",
    shortDescription: "Run Ralph against the repo queue or one linked design doc.",
  },
  {
    id: "skills-sync",
    title: "Skills Sync",
    shortDescription: "Refresh tx-managed skill bundles inside a project checkout.",
  },
  {
    id: "task-spec-loop",
    title: "Task Spec Loop",
    shortDescription: "Attach tasks to paired PRD/design docs and keep the graph aligned.",
  },
  {
    id: "verify-invariants",
    title: "Verify Invariants",
    shortDescription: "Implement and verify invariant coverage from a design doc.",
  },
] as const

export function listAvailableSkills(): AvailableSkillDefinition[] {
  const generated: AvailableSkillDefinition[] = SKILL_GROUPS.map((group) => ({
    id: group.id,
    title: group.title,
    shortDescription: group.shortDescription,
    source: "generated" as const,
  }))

  const bundled: AvailableSkillDefinition[] = BUNDLED_SKILLS.map((skill) => ({
    id: skill.id,
    title: skill.title,
    shortDescription: skill.shortDescription,
    source: "bundled" as const,
  }))

  return [...generated, ...bundled]
}

function validateGeneratedSkillCoverage(target: SkillTarget, skills: GeneratedSkill[]): void {
  const expectedKeys = Object.keys(commandHelp).sort((a, b) => a.localeCompare(b))
  const generatedCommandKeys = skills
    .filter((skill) => skill.source === "generated")
    .flatMap((skill) => skill.commandKeys)

  const duplicateKeys = generatedCommandKeys.filter((key, index) => generatedCommandKeys.indexOf(key) !== index)
  const actualKeys = Array.from(new Set(generatedCommandKeys)).sort((a, b) => a.localeCompare(b))
  const missingKeys = expectedKeys.filter((key) => !actualKeys.includes(key))
  const extraKeys = actualKeys.filter((key) => !expectedKeys.includes(key))

  if (duplicateKeys.length === 0 && missingKeys.length === 0 && extraKeys.length === 0) {
    return
  }

  const details = [
    `Generated ${target} skills failed command coverage validation.`,
    "Every CLI help entry must be mapped to exactly one generated skill.",
  ]

  if (missingKeys.length > 0) {
    details.push(`Missing: ${missingKeys.join(", ")}`)
  }

  if (extraKeys.length > 0) {
    details.push(`Unexpected: ${extraKeys.join(", ")}`)
  }

  if (duplicateKeys.length > 0) {
    details.push(`Duplicate assignments: ${Array.from(new Set(duplicateKeys)).join(", ")}`)
  }

  throw new SkillGenerationError(details.join("\n"))
}

function rootCommandKey(key: string): string {
  if (key.includes(" ")) return key.split(" ")[0] ?? key
  if (key.includes(":")) return key.split(":")[0] ?? key
  return key
}

function classifyCommandKey(key: string): string {
  const root = rootCommandKey(key)

  if ([
    "init", "add", "list", "ready", "show", "update", "done", "reset", "delete",
    "bulk", "claim", "help",
  ].includes(key) || root === "claim") {
    return "tx-core-loop"
  }

  if (
    root === "dep" ||
    ["block", "unblock", "children", "tree"].includes(key) ||
    root === "group-context"
  ) {
    return "tx-dependencies-hierarchy"
  }

  if (
    root === "auto" ||
    ["guard", "gate", "verify", "label", "reflect"].includes(root)
  ) {
    return "tx-autonomy-controls"
  }

  if (root === "memory") {
    return "tx-memory-context"
  }

  if (
    root === "msg" ||
    ["send", "inbox", "ack"].includes(root) ||
    root === "outbox" ||
    root === "pin"
  ) {
    return "tx-messaging-pins"
  }

  if (
    ["doc", "spec", "decision", "triangle", "invariant", "md-export", "decompose"].includes(root)
  ) {
    return "tx-docs-specs"
  }

  if (
    root === "sync" ||
    ["compact", "history", "migrate"].includes(root)
  ) {
    return "tx-sync-data"
  }

  if (
    root === "diag" ||
    root === "trace" ||
    ["stats", "doctor", "dashboard", "validate"].includes(root)
  ) {
    return "tx-observability-traces"
  }

  if (
    ["worker", "coordinator", "daemon", "cycle"].includes(root) ||
    root === "hooks"
  ) {
    return "tx-workers-runtime"
  }

  if (
    root === "graph" ||
    root === "schema" ||
    root === "utils" ||
    root === "skills" ||
    root === "test" ||
    key === "mcp-server"
  ) {
    return "tx-graph-utils"
  }

  throw new SkillGenerationError(
    [
      `Unmapped help entry: "${key}"`,
      "Fix: add a mapping in classifyCommandKey() inside apps/cli/src/skills/generate.ts.",
      "If this is intentionally excluded, add an explicit branch that documents that choice.",
    ].join("\n")
  )
}

function parseHelpHeader(key: string): { commandLabel: string; summary: string } {
  const raw = commandHelp[key]?.trim() ?? `tx ${key}`
  const header = raw.split(/\r?\n/, 1)[0] ?? `tx ${key}`
  const separator = header.indexOf(" - ")
  if (separator === -1) {
    return { commandLabel: header.trim(), summary: "" }
  }
  return {
    commandLabel: header.slice(0, separator).trim(),
    summary: header.slice(separator + 3).trim(),
  }
}

function renderTargetDescription(target: SkillTarget, group: SkillGroupDefinition): string {
  const host = target === "claude" ? "Claude Code" : "Codex"
  return `${group.shortDescription} Use when working in ${host} and the user needs tx commands from this area.`
}

function renderSkillMarkdown(target: SkillTarget, group: SkillGroupDefinition, commandKeys: string[]): string {
  const host = target === "claude" ? "Claude Code" : "Codex"
  const commandList = commandKeys.map((key) => {
    const { commandLabel, summary } = parseHelpHeader(key)
    return summary
      ? `- \`${commandLabel}\`: ${summary}`
      : `- \`${commandLabel}\``
  }).join("\n")

  const quickStart = group.quickStart.map((command) => `- \`${command}\``).join("\n")
  const operationalNotes = group.operationalNotes?.length
    ? [
        "## Operational Safety",
        "",
        group.operationalNotes.map((note) => `- ${note}`).join("\n"),
        "",
      ]
    : []

  return [
    "---",
    `name: "${group.id}"`,
    `description: "${renderTargetDescription(target, group)}"`,
    "metadata:",
    `  short-description: "${group.shortDescription}"`,
    "---",
    "",
    `# ${group.title}`,
    "",
    `${group.whenToUse}`,
    "",
    "## Quick Start",
    "",
    quickStart,
    "",
    ...operationalNotes,
    "## Included Commands",
    "",
    commandList,
    "",
    "## Full Help",
    "",
    "Read [references/commands.md](references/commands.md) for the full generated CLI help text for this skill's commands.",
    "",
    "## Search And Shell Fixes",
    "",
    `When working in ${host}, prefer \`rg -n <pattern> <path>\` and \`rg --files <path>\` over broad \`grep -r\` or fragile \`find\` pipelines.`,
    "",
    "If a shell/search command fails because of malformed flags, truncated paths, or broken quotes:",
    "",
    "- rerun it as a smaller `rg` command with an explicit directory",
    "- avoid partial paths like `node_modul` or unterminated quotes",
    "- replace `grep -r` with `rg -n` unless `rg` is unavailable",
    "- replace broad `find` probes with `rg --files` when you are really locating source files",
    "",
  ].join("\n")
}

function renderReferenceMarkdown(group: SkillGroupDefinition, commandKeys: string[]): string {
  const sections: string[] = [
    `# ${group.title} Command Reference`,
    "",
    "This file is generated from `apps/cli/src/help.ts`. Regenerate it with `tx skills generate`.",
    "",
  ]

  if (group.id === "tx-core-loop") {
    sections.push("## tx help", "", "```text", HELP_TEXT.trimEnd(), "```", "")
  }

  for (const key of commandKeys) {
    const { commandLabel } = parseHelpHeader(key)
    sections.push(`## ${commandLabel}`, "", "```text", commandHelp[key]!.trimEnd(), "```", "")
  }

  return sections.join("\n")
}

function replaceSlashCommandReference(content: string, command: string): string {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return content
    .replace(new RegExp("`\\/" + escaped + "`", "g"), `\`${command}\``)
    .replace(
      new RegExp(`(^|[\\s(])\\/${escaped}(?=[\\s.,:;!?)]|$)`, "gm"),
      `$1\`${command}\``,
    )
}

function renderBundledSkillContent(target: SkillTarget, skillId: string): string {
  const content = readFileSync(join(SHARED_SKILLS_DIR, skillId, "SKILL.md"), "utf-8")
  if (target === "claude") {
    return content
  }

  let rewritten = content
    .replaceAll("~/.claude/plans/", "~/.codex/plans/")
    .replaceAll("CLAUDE.md", "project instructions (for example `AGENTS.md`, if present)")

  for (const command of ["plan", "overview-spec", "design-doc", "prd", "verify-invariants", "map-invariants"]) {
    rewritten = replaceSlashCommandReference(rewritten, command)
  }

  return rewritten
}

function buildBundledSkill(
  target: SkillTarget,
  skillDefinition: (typeof BUNDLED_SKILLS)[number],
): GeneratedSkill {
  const skillDir = `${installRoot(target)}/${skillDefinition.id}`
  const files = [
    {
      relativePath: `${skillDir}/SKILL.md`,
      content: renderBundledSkillContent(target, skillDefinition.id),
    },
  ]

  return {
    id: skillDefinition.id,
    title: skillDefinition.title,
    commandKeys: [],
    installPath: skillDir,
    checksum: computeChecksum(files),
    files,
    source: "bundled",
  }
}

function computeChecksum(files: Array<{ relativePath: string; content: string }>): string {
  const payload = files
    .slice()
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    .map((file) => `${file.relativePath}\n${file.content}`)
    .join("\n---\n")

  return createHash("sha256").update(payload).digest("hex")
}

function installRoot(target: SkillTarget): ".claude/skills" | ".codex/skills" {
  return target === "claude" ? ".claude/skills" : ".codex/skills"
}

function buildTargetSkills(target: SkillTarget): GeneratedSkill[] {
  const grouped = new Map<string, string[]>()
  const keys = Object.keys(commandHelp).sort((a, b) => a.localeCompare(b))

  for (const key of keys) {
    const groupId = classifyCommandKey(key)
    const existing = grouped.get(groupId) ?? []
    existing.push(key)
    grouped.set(groupId, existing)
  }

  const generatedSkills: GeneratedSkill[] = SKILL_GROUPS.map((group): GeneratedSkill => {
    const commandKeys = (grouped.get(group.id) ?? []).slice().sort((a, b) => a.localeCompare(b))
    if (commandKeys.length === 0) {
      throw new SkillGenerationError(`Skill group "${group.id}" has no commands assigned.`)
    }

    const skillDir = `${installRoot(target)}/${group.id}`
    const files = [
      {
        relativePath: `${skillDir}/SKILL.md`,
        content: renderSkillMarkdown(target, group, commandKeys),
      },
      {
        relativePath: `${skillDir}/references/commands.md`,
        content: renderReferenceMarkdown(group, commandKeys),
      },
    ]

    return {
      id: group.id,
      title: group.title,
      commandKeys,
      installPath: skillDir,
      checksum: computeChecksum(files),
      files,
      source: "generated",
    }
  })

  validateGeneratedSkillCoverage(target, generatedSkills)

  return generatedSkills.concat(BUNDLED_SKILLS.map((skillDefinition) => buildBundledSkill(target, skillDefinition)))
}

function renderManifest(target: SkillTarget, skills: GeneratedSkill[]): string {
  const manifest: TargetManifest = {
    generator: "tx skills generate",
    version: CLI_VERSION,
    target,
    installRoot: installRoot(target),
    skillCount: skills.length,
    commandCount: skills.reduce((total, skill) => total + skill.commandKeys.length, 0),
    skills: skills.map((skill) => ({
      id: skill.id,
      title: skill.title,
      installPath: skill.installPath,
      checksum: skill.checksum,
      commandKeys: skill.commandKeys,
      source: skill.source,
    })),
  }

  return `${JSON.stringify(manifest, null, 2)}\n`
}

function selectedTargets(selection: SkillTargetSelection): SkillTarget[] {
  if (selection === "all") return ["claude", "codex"]
  return [selection]
}

export function generateSkillBundles(options?: {
  target?: SkillTargetSelection
  outputDir?: string
  clean?: boolean
}): SkillGenerationResult {
  const targetSelection = options?.target ?? "all"
  const outputDir = resolve(options?.outputDir ?? join(process.cwd(), ".tx", "generated-skills"))
  const clean = options?.clean ?? false

  const targets = selectedTargets(targetSelection)
  const summaries: GeneratedTargetSummary[] = []

  for (const target of targets) {
    const targetOutputDir = join(outputDir, target)
    if (clean && existsSync(targetOutputDir)) {
      rmSync(targetOutputDir, { recursive: true, force: true })
    }

    mkdirSync(targetOutputDir, { recursive: true })

    const skills = buildTargetSkills(target)
    const manifestPath = join(targetOutputDir, installRoot(target), "manifest.json")
    let fileCount = 0

    for (const skill of skills) {
      for (const file of skill.files) {
        const absolutePath = join(targetOutputDir, file.relativePath)
        mkdirSync(resolve(absolutePath, ".."), { recursive: true })
        writeFileSync(absolutePath, file.content, "utf-8")
        fileCount += 1
      }
    }

    mkdirSync(resolve(manifestPath, ".."), { recursive: true })
    writeFileSync(manifestPath, renderManifest(target, skills), "utf-8")
    fileCount += 1

    summaries.push({
      target,
      outputDir: targetOutputDir,
      manifestPath,
      skillCount: skills.length,
      fileCount,
      commandCount: skills.reduce((total, skill) => total + skill.commandKeys.length, 0),
    })
  }

  return {
    outputDir,
    targets: summaries,
  }
}

export function formatSkillGenerationResult(result: SkillGenerationResult, baseDir: string = process.cwd()): string {
  const lines = ["Generated tx skill bundles:"]

  for (const target of result.targets) {
    lines.push(
      `  - ${target.target}: ${target.skillCount} skills, ${target.commandCount} commands, ${target.fileCount} files`,
      `    output: ${relative(baseDir, target.outputDir) || "."}`,
      `    manifest: ${relative(baseDir, target.manifestPath) || "."}`,
    )
  }

  return lines.join("\n")
}
