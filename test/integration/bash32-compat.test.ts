import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

const WATCHDOG_ONBOARDING_SCRIPTS = [
  resolve(__dirname, "../../apps/cli/src/templates/watchdog/scripts/watchdog-launcher.sh"),
  resolve(__dirname, "../../apps/cli/src/templates/watchdog/scripts/ralph-watchdog.sh"),
  resolve(__dirname, "../../apps/cli/src/templates/watchdog/scripts/ralph-hourly-supervisor.sh"),
]

const DISALLOWED_BASH32_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "negative substring expansion (${var:1:-1})",
    pattern: /\$\{[^}\n]+:[0-9]+:-[0-9]+\}/,
  },
  {
    name: "associative arrays (declare -A)",
    pattern: /\bdeclare\s+-A\b/,
  },
  {
    name: "coproc builtin",
    pattern: /\bcoproc\b/,
  },
  {
    name: "stderr/stdout shorthand pipe (|&)",
    pattern: /\|&/,
  },
  {
    name: "append stderr/stdout shorthand (&>>)",
    pattern: /&>>/,
  },
]

describe("watchdog onboarding Bash 3.2 compatibility", () => {
  it("parses under /bin/bash -n", () => {
    for (const scriptPath of WATCHDOG_ONBOARDING_SCRIPTS) {
      const result = spawnSync("/bin/bash", ["-n", scriptPath], {
        encoding: "utf-8",
      })
      expect(result.status, `${scriptPath}\n${result.stderr}`).toBe(0)
    }
  })

  it("avoids known Bash 4+ syntax constructs", () => {
    for (const scriptPath of WATCHDOG_ONBOARDING_SCRIPTS) {
      const content = readFileSync(scriptPath, "utf-8")
      for (const disallowed of DISALLOWED_BASH32_PATTERNS) {
        expect(disallowed.pattern.test(content), `${scriptPath} uses disallowed syntax: ${disallowed.name}`).toBe(false)
      }
    }
  })
})
