import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { generateSkillBundles, type SkillTarget, type SkillTargetSelection } from "./generate.js"

class SkillSyncError extends Error {
  readonly _tag = "SkillSyncError" as const
}

export interface SkillSyncTargetSummary {
  target: SkillTarget
  installRoot: ".claude/skills" | ".codex/skills"
  manifestPath: string
  added: string[]
  updated: string[]
  unchanged: string[]
}

export interface SkillSyncResult {
  projectDir: string
  targets: SkillSyncTargetSummary[]
}

interface TreeSyncSummary {
  added: string[]
  updated: string[]
  unchanged: string[]
}

function installRoot(target: SkillTarget): ".claude/skills" | ".codex/skills" {
  return target === "claude" ? ".claude/skills" : ".codex/skills"
}

function selectedTargets(selection: SkillTargetSelection): SkillTarget[] {
  return selection === "all" ? ["claude", "codex"] : [selection]
}

function mergeSummaries(a: TreeSyncSummary, b: TreeSyncSummary): TreeSyncSummary {
  return {
    added: a.added.concat(b.added),
    updated: a.updated.concat(b.updated),
    unchanged: a.unchanged.concat(b.unchanged),
  }
}

function ensureParentDir(path: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true })
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === "ENOTDIR") {
      throw new SkillSyncError(`Cannot sync '${path}': a parent path exists as a file. Move/delete the conflicting path and retry.`)
    }
    throw new SkillSyncError(err.message || `Failed to create parent directory for '${path}'.`)
  }
}

function validateProjectDir(projectDir: string): void {
  if (!existsSync(projectDir)) {
    return
  }

  const stat = lstatSync(projectDir)
  if (!stat.isDirectory()) {
    throw new SkillSyncError(`Cannot sync into '${projectDir}': project path exists and is not a directory.`)
  }
}

function assertNoSymlinkSegments(projectDir: string, candidatePath: string): void {
  const relativePath = relative(projectDir, candidatePath)
  if (!relativePath || relativePath === ".") {
    return
  }

  let current = projectDir
  for (const segment of relativePath.split(/[/\\]+/).filter(Boolean)) {
    current = join(current, segment)
    if (!existsSync(current)) {
      continue
    }

    const stat = lstatSync(current)
    if (stat.isSymbolicLink()) {
      throw new SkillSyncError(
        `Cannot sync '${relative(projectDir, current) || "."}': symlinked destination paths are not supported.`
      )
    }
  }
}

function writeFileAtomic(dest: string, content: Buffer): void {
  ensureParentDir(dest)
  const tempPath = join(
    dirname(dest),
    `.tx-skill-sync-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`,
  )

  try {
    writeFileSync(tempPath, content)
    try {
      renameSync(tempPath, dest)
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if ((err.code === "EEXIST" || err.code === "EPERM") && existsSync(dest)) {
        rmSync(dest, { force: true })
        renameSync(tempPath, dest)
      } else {
        throw new SkillSyncError(err.message || `Failed to move '${tempPath}' into place for '${dest}'.`)
      }
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    throw new SkillSyncError(err.message || `Failed to write '${dest}'.`)
  } finally {
    if (existsSync(tempPath)) {
      rmSync(tempPath, { force: true })
    }
  }
}

function syncTree(src: string, dest: string, projectDir: string): TreeSyncSummary {
  if (!existsSync(src)) {
    throw new SkillSyncError(`Cannot sync missing generated bundle path: ${src}`)
  }

  assertNoSymlinkSegments(projectDir, dest)

  const srcStat = statSync(src)
  if (srcStat.isDirectory()) {
    if (existsSync(dest) && !statSync(dest).isDirectory()) {
      throw new SkillSyncError(
        `Cannot sync '${relative(projectDir, dest) || "."}': destination exists as a file where a directory is required.`
      )
    }

    ensureParentDir(join(dest, ".keep"))
    mkdirSync(dest, { recursive: true })

    let summary: TreeSyncSummary = { added: [], updated: [], unchanged: [] }
    for (const entry of readdirSync(src).sort((a, b) => a.localeCompare(b))) {
      summary = mergeSummaries(summary, syncTree(join(src, entry), join(dest, entry), projectDir))
    }
    return summary
  }

  if (existsSync(dest) && statSync(dest).isDirectory()) {
    throw new SkillSyncError(
      `Cannot sync '${relative(projectDir, dest) || "."}': destination exists as a directory where a file is required.`
    )
  }

  const srcContent = readFileSync(src)
  const relPath = relative(projectDir, dest) || "."

  if (!existsSync(dest)) {
    writeFileAtomic(dest, srcContent)
    return { added: [relPath], updated: [], unchanged: [] }
  }

  const destContent = readFileSync(dest)
  if (srcContent.equals(destContent)) {
    return { added: [], updated: [], unchanged: [relPath] }
  }

  writeFileAtomic(dest, srcContent)
  return { added: [], updated: [relPath], unchanged: [] }
}

export function syncSkillBundles(options?: {
  target?: SkillTargetSelection
  projectDir?: string
}): SkillSyncResult {
  const targetSelection = options?.target ?? "all"
  const projectDir = resolve(options?.projectDir ?? process.cwd())
  const tempDir = mkdtempSync(join(tmpdir(), "tx-skills-sync-"))

  try {
    validateProjectDir(projectDir)

    generateSkillBundles({
      target: targetSelection,
      outputDir: tempDir,
      clean: true,
    })

    const targets = selectedTargets(targetSelection).map((target): SkillSyncTargetSummary => {
      const root = installRoot(target)
      const srcRoot = join(tempDir, target, root)
      const destRoot = join(projectDir, root)
      const summary = syncTree(srcRoot, destRoot, projectDir)

      return {
        target,
        installRoot: root,
        manifestPath: join(destRoot, "manifest.json"),
        added: summary.added,
        updated: summary.updated,
        unchanged: summary.unchanged,
      }
    })

    return {
      projectDir,
      targets,
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

export function formatSkillSyncResult(result: SkillSyncResult, baseDir: string = process.cwd()): string {
  const lines = [
    "Synced tx skills:",
    `  project: ${relative(baseDir, result.projectDir) || "."}`,
  ]

  for (const target of result.targets) {
    lines.push(
      `  - ${target.target}: added=${target.added.length}, updated=${target.updated.length}, unchanged=${target.unchanged.length}`,
      `    root: ${target.installRoot}`,
      `    manifest: ${relative(baseDir, target.manifestPath) || "."}`,
    )
  }

  return lines.join("\n")
}
