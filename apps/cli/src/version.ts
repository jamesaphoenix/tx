/**
 * CLI version — injected at compile time for binaries, read from package.json
 * for development.
 *
 * In compiled binaries (`bun build --compile`), `--define` replaces
 * `process.env.TX_CLI_VERSION` with a string literal at bundle time, so
 * the filesystem read is never reached. This avoids Bun minifier bugs
 * that can hoist `readFileSync` out of try-catch blocks.
 */

// Basic semver pattern: digits.digits.digits with optional pre-release suffix
const SEMVER_RE = /^\d+\.\d+\.\d+/

function getVersion(): string {
  // Compile-time injected version (set by --define in release.yml)
  // In compiled binaries, bun replaces this with the literal string e.g. '0.5.9'
  const injected = process.env.TX_CLI_VERSION
  if (injected && injected !== "undefined" && injected !== "" && SEMVER_RE.test(injected)) {
    return injected
  }

  // Development fallback: read from package.json.
  // IMPORTANT: Uses require() instead of static import to prevent Bun's minifier
  // from hoisting readFileSync to module scope (outside try-catch), which causes
  // ENOENT crashes in compiled binaries where /$bunfs/ paths don't exist on disk.
  // In compiled binaries, the --define check above returns before reaching this code.
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs")
    const { resolve, dirname } = require("node:path") as typeof import("node:path")
    const { fileURLToPath } = require("node:url") as typeof import("node:url")
    const __dir = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(resolve(__dir, "../package.json"), "utf-8"))
    return pkg.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

export const CLI_VERSION: string = getVersion()
