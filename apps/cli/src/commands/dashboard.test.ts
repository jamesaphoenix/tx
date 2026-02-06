/**
 * Dashboard command tests
 *
 * Tests for `tx dashboard` — starts API server + Vite dev server.
 */
import { describe, it, expect, afterEach } from "vitest"
import { spawn, spawnSync } from "node:child_process"
import { resolve } from "node:path"
import type { ChildProcess } from "node:child_process"

const CLI_SRC = resolve(__dirname, "../cli.ts")

describe("tx dashboard", () => {
  let proc: ChildProcess | null = null

  afterEach(() => {
    if (proc && !proc.killed) {
      proc.kill("SIGTERM")
      proc = null
    }
  })

  it("is registered as a CLI command", () => {
    const result = spawnSync("bun", [CLI_SRC, "help"], {
      encoding: "utf-8",
      timeout: 10000,
    })
    expect(result.stdout).toContain("dashboard")
  })

  it("shows help text with --help flag", () => {
    const result = spawnSync("bun", [CLI_SRC, "dashboard", "--help"], {
      encoding: "utf-8",
      timeout: 10000,
    })
    expect(result.stdout).toContain("tx dashboard")
    expect(result.stdout).toContain("--no-open")
    expect(result.stdout).toContain("--port")
  })

  it("starts servers that respond on expected ports", async () => {
    proc = spawn("bun", [CLI_SRC, "dashboard", "--no-open"], {
      stdio: "pipe",
    })

    // Wait for servers to start (up to 10 seconds)
    let apiReady = false
    let viteReady = false

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500))

      if (!apiReady) {
        try {
          const res = await fetch("http://localhost:3001/api/stats")
          if (res.ok) apiReady = true
        } catch {
          // not ready yet
        }
      }

      if (!viteReady) {
        try {
          const res = await fetch("http://localhost:5173")
          if (res.ok) viteReady = true
        } catch {
          // not ready yet
        }
      }

      if (apiReady && viteReady) break
    }

    expect(apiReady).toBe(true)
    expect(viteReady).toBe(true)
  }, 15000)

  it("cleans up child processes on SIGTERM", async () => {
    proc = spawn("bun", [CLI_SRC, "dashboard", "--no-open"], {
      stdio: "pipe",
    })

    // Wait for servers to start
    await new Promise((r) => setTimeout(r, 4000))

    // Send SIGTERM
    proc.kill("SIGTERM")

    // Wait for cleanup
    await new Promise((r) => setTimeout(r, 2000))

    // Ports should be freed
    let apiFreed = false
    let viteFreed = false

    try {
      await fetch("http://localhost:3001/api/stats")
    } catch {
      apiFreed = true
    }

    try {
      await fetch("http://localhost:5173")
    } catch {
      viteFreed = true
    }

    expect(apiFreed).toBe(true)
    expect(viteFreed).toBe(true)

    proc = null // already killed
  }, 15000)
})
