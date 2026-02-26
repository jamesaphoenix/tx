/**
 * CLI version — read from package.json at runtime so there's a single source of truth.
 *
 * In compiled binaries (`bun build --compile`), import.meta.url resolves to a
 * virtual /$bunfs/ path where package.json doesn't exist. We catch that and
 * fall back to the version that was inlined at compile time.
 */
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

function getVersion(): string {
  try {
    const __dir = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(resolve(__dir, "../package.json"), "utf-8"))
    return pkg.version ?? "0.0.0"
  } catch {
    // Compiled binary — package.json is not on disk.
    // process.env.TX_CLI_VERSION can be injected at build time via --define.
    return process.env.TX_CLI_VERSION ?? "0.0.0"
  }
}

export const CLI_VERSION: string = getVersion()
