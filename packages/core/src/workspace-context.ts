import { createHash } from "node:crypto"
import { existsSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { findTxRoot } from "./utils/file-path.js"

export const LEGACY_SPEC_PROJECTION_KEY = "legacy"

export type WorkspaceContext = {
  readonly stateRoot: string
  readonly contentRoot: string
  readonly dbPath: string
  readonly resolvedDbPath: string
  readonly projectionKey: string
  readonly gitCommonDir: string | null
  readonly branch: string | null
  readonly commit: string | null
  readonly dirty: boolean | null
}

export type ResolveWorkspaceContextOptions = {
  readonly cwd?: string
  readonly stateRoot?: string
  readonly contentRoot?: string
  readonly dbPath?: string
}

const canonicalPath = (path: string): string => {
  const absolute = resolve(path)
  try {
    return realpathSync(absolute)
  } catch {
    return absolute
  }
}

const isVirtualSqlitePath = (path: string): boolean =>
  path === ":memory:" || path.startsWith("file:")

const resolveDbPath = (path: string): string =>
  isVirtualSqlitePath(path) ? path : resolve(path)

const isolatedGitEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  )

const gitOutput = (contentRoot: string, args: readonly string[]): string | null => {
  const result = spawnSync("git", ["-C", contentRoot, ...args], {
    encoding: "utf8",
    env: isolatedGitEnv(),
    stdio: ["ignore", "pipe", "ignore"],
  })
  if (result.status !== 0) return null
  const value = result.stdout.trim()
  return value.length > 0 ? value : null
}

const resolveGitCommonDir = (contentRoot: string): string | null => {
  const raw = gitOutput(contentRoot, ["rev-parse", "--git-common-dir"])
  if (!raw) return null
  return canonicalPath(resolve(contentRoot, raw))
}

/**
 * Resolve the two roots tx operates against.
 *
 * State root owns the shared `.tx/tasks.db`. Content root owns source files,
 * specs, and `.tx/config.toml`. They default to the current checkout root but
 * can be split explicitly for worktree-safe operation.
 */
export const resolveWorkspaceContext = (
  options: ResolveWorkspaceContextOptions = {}
): WorkspaceContext => {
  const cwd = resolve(options.cwd ?? process.cwd())
  const contentRoot = canonicalPath(
    options.contentRoot ?? process.env.TX_CONTENT_ROOT ?? findTxRoot(cwd)
  )
  const stateRoot = canonicalPath(
    options.stateRoot ?? process.env.TX_STATE_ROOT ?? findTxRoot(cwd)
  )
  const explicitDbPath = options.dbPath ?? process.env.TX_DB_PATH
  const dbPath = explicitDbPath
    ? resolveDbPath(explicitDbPath)
    : resolve(stateRoot, ".tx", "tasks.db")
  const resolvedDbPath = isVirtualSqlitePath(dbPath)
    ? dbPath
    : existsSync(dbPath) ? canonicalPath(dbPath) : dbPath
  const gitCommonDir = resolveGitCommonDir(contentRoot)
  const branchRaw = gitOutput(contentRoot, ["rev-parse", "--abbrev-ref", "HEAD"])
  const branch = branchRaw === "HEAD" ? null : branchRaw
  const commit = gitOutput(contentRoot, ["rev-parse", "HEAD"])
  const status = gitOutput(contentRoot, ["status", "--porcelain"])
  const dirty = gitCommonDir === null ? null : status !== null
  const projectionIdentity = canonicalPath(contentRoot)
  const projectionKey = `checkout-${createHash("sha256")
    .update(projectionIdentity)
    .digest("hex")
    .slice(0, 16)}`

  return {
    stateRoot,
    contentRoot,
    dbPath,
    resolvedDbPath,
    projectionKey,
    gitCommonDir,
    branch,
    commit,
    dirty,
  }
}

export type SpecProjectionContext = Pick<
  WorkspaceContext,
  "projectionKey" | "contentRoot" | "gitCommonDir" | "branch" | "commit" | "dirty"
>

export const legacySpecProjectionContext = (
  contentRoot: string = process.cwd()
): SpecProjectionContext => ({
  projectionKey: LEGACY_SPEC_PROJECTION_KEY,
  contentRoot: resolve(contentRoot),
  gitCommonDir: null,
  branch: null,
  commit: null,
  dirty: null,
})
