/**
 * CLI version — read from package.json at runtime so there's a single source of truth.
 */
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dir = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(__dir, "../package.json"), "utf-8"))

export const CLI_VERSION: string = pkg.version ?? "0.0.0"
