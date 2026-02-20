import { describe, it, expect, afterEach } from "vitest"
import { spawnSync, type SpawnSyncReturns } from "child_process"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join, resolve } from "path"

interface Harness {
  tmpDir: string
  stateDir: string
  scriptPath: string
  run: (args: string[], extraEnv?: Record<string, string>) => SpawnSyncReturns<string>
  readStateFile: (name: string) => string
}

const hasJq = spawnSync("jq", ["--version"], { stdio: "pipe" }).status === 0
const describeIf = hasJq ? describe : describe.skip

const SOURCE_RALPH = resolve(__dirname, "../../scripts/ralph.sh")

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content)
  chmodSync(path, 0o755)
}

function setupHarness(options?: { withCodex?: boolean; withClaude?: boolean }): Harness {
  const withCodex = options?.withCodex ?? true
  const withClaude = options?.withClaude ?? true

  const tmpDir = mkdtempSync(join(tmpdir(), "tx-ralph-script-"))
  const scriptsDir = join(tmpDir, "scripts")
  const appCliDir = join(tmpDir, "apps", "cli", "src")
  const binDir = join(tmpDir, "bin")
  const stateDir = join(tmpDir, "state")
  const codexAgentsDir = join(tmpDir, ".codex", "agents")
  const claudeAgentsDir = join(tmpDir, ".claude", "agents")

  mkdirSync(scriptsDir, { recursive: true })
  mkdirSync(appCliDir, { recursive: true })
  mkdirSync(binDir, { recursive: true })
  mkdirSync(stateDir, { recursive: true })
  mkdirSync(codexAgentsDir, { recursive: true })
  mkdirSync(claudeAgentsDir, { recursive: true })

  // Minimal agent profiles needed by ralph.sh dispatch.
  writeFileSync(join(codexAgentsDir, "tx-implementer.md"), "# codex implementer profile\n")
  writeFileSync(join(claudeAgentsDir, "tx-implementer.md"), "# claude implementer profile\n")

  // Script under test
  const scriptPath = join(scriptsDir, "ralph.sh")
  writeFileSync(scriptPath, readFileSync(SOURCE_RALPH, "utf-8"))
  chmodSync(scriptPath, 0o755)

  // Placeholder CLI source path expected by ralph.sh tx() helper
  writeFileSync(join(appCliDir, "cli.ts"), "// mock placeholder for ralph integration tests\n")

  // Mock bun command: emulates `tx` subcommands used by ralph.sh
  writeExecutable(
    join(binDir, "bun"),
    `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${RALPH_TEST_STATE_DIR:?}"
mkdir -p "$STATE_DIR"

# arg1 is cli.ts path
shift || true
CMD="\${1:-}"
shift || true

case "$CMD" in
  ready)
    if [ -f "$STATE_DIR/ready_once_consumed" ]; then
      echo "[]"
    else
      touch "$STATE_DIR/ready_once_consumed"
      echo '[{"id":"tx-test-1","title":"Test task","score":500,"children":[]}]'
    fi
    ;;
  list)
    echo "[]"
    ;;
  claim)
    echo "$*" >> "$STATE_DIR/claims.log"
    if [ "\${MOCK_CLAIM_FAIL:-0}" = "1" ]; then
      exit 1
    fi
    ;;
  "claim:release")
    echo "$*" >> "$STATE_DIR/releases.log"
    ;;
  show)
    STATUS="\${MOCK_SHOW_STATUS:-done}"
    echo "{\\"id\\":\\"tx-test-1\\",\\"status\\":\\"$STATUS\\",\\"score\\":500}"
    ;;
  update)
    echo "$*" >> "$STATE_DIR/updates.log"
    ;;
  reset)
    echo "$*" >> "$STATE_DIR/resets.log"
    ;;
  context)
    echo ""
    ;;
  *)
    echo ""
    ;;
esac
`
  )

  // Mock git command
  writeExecutable(
    join(binDir, "git"),
    `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  rev-parse)
    echo "deadbeef"
    ;;
  status|add|commit)
    ;;
  *)
    ;;
esac
`
  )

  // Mock uuidgen for deterministic claude mode tests
  writeExecutable(
    join(binDir, "uuidgen"),
    `#!/usr/bin/env bash
set -euo pipefail
echo "11111111-2222-3333-4444-555555555555"
`
  )

  if (withCodex) {
    writeExecutable(
      join(binDir, "codex"),
      `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${RALPH_TEST_STATE_DIR:?}"
echo "$*" >> "$STATE_DIR/codex.log"
`
    )
  }

  if (withClaude) {
    writeExecutable(
      join(binDir, "claude"),
      `#!/usr/bin/env bash
set -euo pipefail
STATE_DIR="\${RALPH_TEST_STATE_DIR:?}"
echo "$*" >> "$STATE_DIR/claude.log"
`
    )
  }

  const run = (args: string[], extraEnv?: Record<string, string>) =>
    spawnSync(scriptPath, args, {
      cwd: tmpDir,
      encoding: "utf-8",
      timeout: 30000,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        RALPH_TEST_STATE_DIR: stateDir,
        ...extraEnv,
      },
    })

  return {
    tmpDir,
    stateDir,
    scriptPath,
    run,
    readStateFile: (name: string) => readFileSync(join(stateDir, name), "utf-8"),
  }
}

describeIf("ralph.sh integration", () => {
  const harnesses: Harness[] = []

  afterEach(() => {
    for (const h of harnesses.splice(0, harnesses.length)) {
      if (existsSync(h.tmpDir)) {
        rmSync(h.tmpDir, { recursive: true, force: true })
      }
    }
  })

  it("defaults workers to 1 and uses ralph-main as worker id", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "codex", "--max", "1", "--max-hours", "1", "--idle-rounds", "1"])
    expect(result.status).toBe(0)

    const log = readFileSync(join(h.tmpDir, ".tx", "ralph.log"), "utf-8")
    expect(log).toContain("Worker mode: workers=1 worker_id=ralph-main")

    const claims = h.readStateFile("claims.log")
    expect(claims).toContain("tx-test-1 ralph-main --lease 30")
  })

  it("rejects invalid --workers values", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--workers", "0"])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Invalid --workers value")
  })

  it("rejects invalid --claim-lease values", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--claim-lease", "0"])
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Invalid --claim-lease value")
  })

  it("routes execution to codex runtime when requested", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "codex", "--max", "1", "--max-hours", "1", "--idle-rounds", "1"])
    expect(result.status).toBe(0)

    const log = readFileSync(join(h.tmpDir, ".tx", "ralph.log"), "utf-8")
    expect(log).toContain("Runtime: codex (Codex)")
  })

  it("routes execution to claude runtime when requested", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "claude", "--max", "1", "--max-hours", "1", "--idle-rounds", "1"])
    expect(result.status).toBe(0)

    const log = readFileSync(join(h.tmpDir, ".tx", "ralph.log"), "utf-8")
    expect(log).toContain("Runtime: claude (Claude)")
  })

  it("passes --claim-lease value through to tx claim", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "codex", "--max", "1", "--max-hours", "1", "--claim-lease", "45", "--idle-rounds", "1"])
    expect(result.status).toBe(0)

    const claims = h.readStateFile("claims.log")
    expect(claims).toContain("--lease 45")
  })

  it("spawns multiple workers with --workers and creates per-worker state files", () => {
    const h = setupHarness()
    harnesses.push(h)

    const result = h.run(["--runtime", "codex", "--workers", "2", "--max", "1", "--max-hours", "1", "--idle-rounds", "1"])
    expect(result.status).toBe(0)

    const log = readFileSync(join(h.tmpDir, ".tx", "ralph.log"), "utf-8")
    expect(log).toContain("Spawned worker ralph-1")
    expect(log).toContain("Spawned worker ralph-2")

    expect(existsSync(join(h.tmpDir, ".tx", "ralph-state-ralph-1"))).toBe(true)
    expect(existsSync(join(h.tmpDir, ".tx", "ralph-state-ralph-2"))).toBe(true)
  })
})
