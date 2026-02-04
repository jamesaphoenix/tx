/**
 * Git hooks commands: hooks:install, hooks:uninstall, hooks:status
 *
 * Integrates tx graph verification with git post-commit hooks for
 * automatic verification after refactors.
 */

import { Effect } from "effect"
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, chmodSync } from "node:fs"
import { resolve, dirname } from "node:path"

type Flags = Record<string, string | boolean>

function flag(flags: Flags, ...names: string[]): boolean {
  return names.some(n => flags[n] === true)
}

function opt(flags: Flags, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = flags[n]
    if (typeof v === "string") return v
  }
  return undefined
}

/** Default configuration for .txrc */
export interface TxrcConfig {
  hooks?: {
    enabled?: boolean
    fileThreshold?: number
    highValueFiles?: string[]
    verifyOnCommit?: boolean
  }
}

/** Default high-value file patterns */
const DEFAULT_HIGH_VALUE_FILES = [
  "package.json",
  "tsconfig.json",
  "*.config.ts",
  "*.config.js",
  "src/index.ts",
  "src/index.js",
]

/** Default file change threshold for triggering verification */
const DEFAULT_FILE_THRESHOLD = 10

/**
 * Read .txrc configuration file.
 * Returns default config if file doesn't exist.
 */
export function readTxrc(projectDir: string): TxrcConfig {
  const txrcPath = resolve(projectDir, ".txrc")
  const txrcJsonPath = resolve(projectDir, ".txrc.json")

  let configPath: string | undefined
  if (existsSync(txrcJsonPath)) {
    configPath = txrcJsonPath
  } else if (existsSync(txrcPath)) {
    configPath = txrcPath
  }

  if (!configPath) {
    return {}
  }

  try {
    const content = readFileSync(configPath, "utf-8")
    return JSON.parse(content)
  } catch {
    return {}
  }
}

/**
 * Write .txrc configuration file.
 */
export function writeTxrc(projectDir: string, config: TxrcConfig): void {
  const txrcPath = resolve(projectDir, ".txrc.json")
  const dir = dirname(txrcPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(txrcPath, JSON.stringify(config, null, 2) + "\n")
}

/**
 * Find git root directory from current directory.
 */
export function findGitRoot(startDir: string): string | null {
  let dir = startDir
  while (dir !== "/") {
    if (existsSync(resolve(dir, ".git"))) {
      return dir
    }
    dir = dirname(dir)
  }
  return null
}

/**
 * Generate the post-commit hook script content.
 */
export function generatePostCommitHook(config: TxrcConfig): string {
  const fileThreshold = config.hooks?.fileThreshold ?? DEFAULT_FILE_THRESHOLD
  const highValueFiles = config.hooks?.highValueFiles ?? DEFAULT_HIGH_VALUE_FILES

  // Generate the high-value file pattern matching
  const highValuePatterns = highValueFiles
    .map(pattern => {
      // Convert glob pattern to grep pattern
      const grepPattern = pattern
        .replace(/\./g, "\\.")
        .replace(/\*/g, ".*")
      return `echo "$CHANGED_FILES" | grep -qE '${grepPattern}'`
    })
    .join(" || ")

  return `#!/bin/bash
# tx post-commit hook - Automatic anchor verification after refactors
# Installed by: tx hooks:install
# Documentation: https://github.com/tx/tx#git-hooks

set -e

# Skip if tx is not available
if ! command -v tx &> /dev/null; then
  exit 0
fi

# Skip if .txrc has hooks.enabled = false
if [ -f ".txrc.json" ]; then
  ENABLED=$(cat .txrc.json 2>/dev/null | grep -o '"enabled"[[:space:]]*:[[:space:]]*\\(true\\|false\\)' | grep -o '\\(true\\|false\\)' || echo "true")
  if [ "$ENABLED" = "false" ]; then
    exit 0
  fi
fi
if [ -f ".txrc" ]; then
  ENABLED=$(cat .txrc 2>/dev/null | grep -o '"enabled"[[:space:]]*:[[:space:]]*\\(true\\|false\\)' | grep -o '\\(true\\|false\\)' || echo "true")
  if [ "$ENABLED" = "false" ]; then
    exit 0
  fi
fi

# Get changed files from the commit
CHANGED_FILES=$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null || echo "")
FILE_COUNT=$(echo "$CHANGED_FILES" | grep -c . 2>/dev/null || echo "0")

# Check if we should trigger verification
SHOULD_VERIFY=false

# Condition 1: More than ${fileThreshold} files changed
if [ "$FILE_COUNT" -gt ${fileThreshold} ]; then
  SHOULD_VERIFY=true
  echo "[tx] Large commit detected ($FILE_COUNT files). Triggering anchor verification..."
fi

# Condition 2: High-value files modified
if [ "$SHOULD_VERIFY" = "false" ] && [ -n "$CHANGED_FILES" ]; then
  if ${highValuePatterns}; then
    SHOULD_VERIFY=true
    echo "[tx] High-value files modified. Triggering anchor verification..."
  fi
fi

# Run verification if conditions are met
if [ "$SHOULD_VERIFY" = "true" ]; then
  # Verify anchors for changed files (run in background to not block commit)
  echo "[tx] Running anchor verification in background..."
  (
    for file in $CHANGED_FILES; do
      if [ -f "$file" ]; then
        tx graph:verify "$file" --quiet 2>/dev/null || true
      fi
    done
    echo "[tx] Anchor verification complete."
  ) &
fi

exit 0
`
}

/**
 * tx hooks:install [--force] [--threshold <n>] [--high-value <patterns>]
 * Install post-commit hook for anchor verification
 */
export const hooksInstall = (_pos: string[], flags: Flags) =>
  Effect.sync(() => {
    const projectDir = process.cwd()
    const gitRoot = findGitRoot(projectDir)

    if (!gitRoot) {
      console.error("Error: Not a git repository (or any parent up to mount point)")
      process.exit(1)
    }

    const hooksDir = resolve(gitRoot, ".git", "hooks")
    const hookPath = resolve(hooksDir, "post-commit")

    // Check if hook already exists
    if (existsSync(hookPath) && !flag(flags, "force", "f")) {
      const content = readFileSync(hookPath, "utf-8")
      if (content.includes("tx post-commit hook")) {
        console.log("tx post-commit hook is already installed.")
        console.log("Use --force to reinstall.")
        return
      }
      console.error("Error: A post-commit hook already exists.")
      console.error("Use --force to overwrite, or manually integrate tx verification.")
      process.exit(1)
    }

    // Read existing config or create default
    let config = readTxrc(projectDir)

    // Apply CLI options
    const threshold = opt(flags, "threshold", "t")
    const highValue = opt(flags, "high-value", "h")

    if (!config.hooks) {
      config.hooks = {}
    }

    if (threshold) {
      const n = parseInt(threshold, 10)
      if (!isNaN(n) && n > 0) {
        config.hooks.fileThreshold = n
      }
    }

    if (highValue) {
      config.hooks.highValueFiles = highValue.split(",").map(s => s.trim())
    }

    config.hooks.enabled = true
    config.hooks.verifyOnCommit = true

    // Ensure hooks directory exists
    if (!existsSync(hooksDir)) {
      mkdirSync(hooksDir, { recursive: true })
    }

    // Generate and write the hook
    const hookContent = generatePostCommitHook(config)
    writeFileSync(hookPath, hookContent)
    chmodSync(hookPath, 0o755)

    // Save config to .txrc.json
    writeTxrc(projectDir, config)

    console.log("tx post-commit hook installed successfully!")
    console.log()
    console.log("Configuration:")
    console.log(`  File threshold: ${config.hooks.fileThreshold ?? DEFAULT_FILE_THRESHOLD} files`)
    console.log(`  High-value files: ${(config.hooks.highValueFiles ?? DEFAULT_HIGH_VALUE_FILES).join(", ")}`)
    console.log()
    console.log("The hook will automatically verify anchors when:")
    console.log(`  - More than ${config.hooks.fileThreshold ?? DEFAULT_FILE_THRESHOLD} files are changed in a commit`)
    console.log("  - Any high-value configuration files are modified")
    console.log()
    console.log("To disable, set hooks.enabled = false in .txrc.json")
  })

/**
 * tx hooks:uninstall
 * Remove post-commit hook
 */
export const hooksUninstall = (_pos: string[], _flags: Flags) =>
  Effect.sync(() => {
    const projectDir = process.cwd()
    const gitRoot = findGitRoot(projectDir)

    if (!gitRoot) {
      console.error("Error: Not a git repository (or any parent up to mount point)")
      process.exit(1)
    }

    const hookPath = resolve(gitRoot, ".git", "hooks", "post-commit")

    if (!existsSync(hookPath)) {
      console.log("No post-commit hook found.")
      return
    }

    const content = readFileSync(hookPath, "utf-8")
    if (!content.includes("tx post-commit hook")) {
      console.error("Error: Existing post-commit hook was not installed by tx.")
      console.error("Please manually remove the hook if desired.")
      process.exit(1)
    }

    unlinkSync(hookPath)

    // Update config
    const config = readTxrc(projectDir)
    if (config.hooks) {
      config.hooks.enabled = false
      config.hooks.verifyOnCommit = false
      writeTxrc(projectDir, config)
    }

    console.log("tx post-commit hook uninstalled.")
  })

/**
 * tx hooks:status [--json]
 * Show current hook status
 */
export const hooksStatus = (_pos: string[], flags: Flags) =>
  Effect.sync(() => {
    const projectDir = process.cwd()
    const gitRoot = findGitRoot(projectDir)

    const status: {
      gitRoot: string | null
      hookInstalled: boolean
      hookPath: string | null
      config: TxrcConfig
      enabled: boolean
    } = {
      gitRoot,
      hookInstalled: false,
      hookPath: null,
      config: readTxrc(projectDir),
      enabled: false
    }

    if (gitRoot) {
      const hookPath = resolve(gitRoot, ".git", "hooks", "post-commit")
      status.hookPath = hookPath

      if (existsSync(hookPath)) {
        const content = readFileSync(hookPath, "utf-8")
        status.hookInstalled = content.includes("tx post-commit hook")
      }
    }

    status.enabled = status.hookInstalled && (status.config.hooks?.enabled !== false)

    if (flag(flags, "json")) {
      console.log(JSON.stringify(status, null, 2))
      return
    }

    console.log("tx Git Hook Status")
    console.log()
    console.log(`  Git root:       ${status.gitRoot ?? "Not found"} `)
    console.log(`  Hook installed: ${status.hookInstalled ? "Yes" : "No"}`)
    console.log(`  Hook enabled:   ${status.enabled ? "Yes" : "No"}`)

    if (status.config.hooks) {
      console.log()
      console.log("Configuration (.txrc.json):")
      console.log(`  File threshold:   ${status.config.hooks.fileThreshold ?? DEFAULT_FILE_THRESHOLD}`)
      console.log(`  High-value files: ${(status.config.hooks.highValueFiles ?? DEFAULT_HIGH_VALUE_FILES).join(", ")}`)
    }
  })
