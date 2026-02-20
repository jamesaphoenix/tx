/**
 * Dashboard command tests
 *
 * Tests for `tx dashboard` — starts API server + Vite dev server.
 */
import { describe, it, expect, afterEach } from "vitest"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { ChildProcess } from "node:child_process"

const CLI_SRC = resolve(__dirname, "../cli.ts")

describe("tx dashboard", () => {
  let proc: ChildProcess | null = null
  let blocker: ChildProcess | null = null
  let tempProjectDir: string | null = null

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const canFetch = async (url: string): Promise<boolean> => {
    try {
      const res = await fetch(url)
      return res.ok
    } catch {
      return false
    }
  }

  const extractDashboardUrl = (output: string): string | null => {
    // Preferred: summary line emitted by tx dashboard
    const summary = output.match(/Dashboard:\s*(https?:\/\/[^\s]+)/)
    if (summary?.[1]) return summary[1]

    // Fallback: Vite's "Local:" line
    const viteLocal = output.match(/Local:\s*(https?:\/\/[^\s]+)/)
    return viteLocal?.[1] ?? null
  }

  async function waitForServers(outputRef: { value: string }, timeoutMs = 20000): Promise<string> {
    const started = Date.now()
    let dashboardUrl: string | null = null

    while (Date.now() - started < timeoutMs) {
      dashboardUrl = extractDashboardUrl(outputRef.value)
      const apiReady = await canFetch("http://localhost:3001/api/stats")
      const dashboardReady = dashboardUrl ? await canFetch(dashboardUrl) : false

      if (apiReady && dashboardReady && dashboardUrl) {
        return dashboardUrl
      }
      await delay(500)
    }

    throw new Error(`dashboard did not become ready. output:\n${outputRef.value}`)
  }

  function runCliInCwd(args: string[], cwd: string) {
    return spawnSync("bun", [CLI_SRC, ...args], {
      cwd,
      encoding: "utf-8",
      timeout: 20000,
    })
  }

  afterEach(() => {
    if (blocker && !blocker.killed) {
      blocker.kill("SIGKILL")
      blocker = null
    }
    if (proc && !proc.killed) {
      proc.kill("SIGTERM")
      proc = null
    }
    if (tempProjectDir) {
      rmSync(tempProjectDir, { recursive: true, force: true })
      tempProjectDir = null
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
    const output = { value: "" }
    proc.stdout?.on("data", (d: Buffer) => { output.value += d.toString() })
    proc.stderr?.on("data", (d: Buffer) => { output.value += d.toString() })

    const dashboardUrl = await waitForServers(output)

    expect(await canFetch("http://localhost:3001/api/stats")).toBe(true)
    expect(await canFetch(dashboardUrl)).toBe(true)
  }, 25000)

  it("cleans up child processes on SIGTERM", async () => {
    proc = spawn("bun", [CLI_SRC, "dashboard", "--no-open"], {
      stdio: "pipe",
    })
    const output = { value: "" }
    proc.stdout?.on("data", (d: Buffer) => { output.value += d.toString() })
    proc.stderr?.on("data", (d: Buffer) => { output.value += d.toString() })

    const dashboardUrl = await waitForServers(output)

    // Send SIGTERM
    proc.kill("SIGTERM")

    // Wait for cleanup
    await delay(2000)

    // Ports should be freed
    const apiFreed = !(await canFetch("http://localhost:3001/api/stats"))
    const viteFreed = !(await canFetch(dashboardUrl))

    expect(apiFreed).toBe(true)
    expect(viteFreed).toBe(true)

    proc = null // already killed
  }, 25000)

  it("prints and uses the actual Vite URL when 5173 remains occupied", async () => {
    // Blocker ignores SIGTERM so killPort(5173) won't free it.
    blocker = spawn("bun", [
      "-e",
      `
      process.on("SIGTERM", () => {});
      Bun.serve({ port: 5173, fetch: () => new Response("blocked") });
      setInterval(() => {}, 1000);
      `
    ], { stdio: "ignore" })

    await delay(500)

    proc = spawn("bun", [CLI_SRC, "dashboard", "--no-open"], {
      stdio: "pipe",
    })
    const output = { value: "" }
    proc.stdout?.on("data", (d: Buffer) => { output.value += d.toString() })
    proc.stderr?.on("data", (d: Buffer) => { output.value += d.toString() })

    const dashboardUrl = await waitForServers(output, 30000)
    expect(dashboardUrl).not.toContain(":5173")
    expect(output.value).toContain(`Dashboard: ${dashboardUrl}`)
  }, 35000)

  it("serves docs endpoints from the selected project database", async () => {
    tempProjectDir = mkdtempSync(join(tmpdir(), "tx-dashboard-docs-"))

    const init = runCliInCwd(["init", "--codex"], tempProjectDir)
    expect(init.status).toBe(0)

    const addDoc = runCliInCwd(
      ["doc", "add", "overview", "dashboard-test-doc", "--title", "Dashboard Test Doc"],
      tempProjectDir,
    )
    expect(addDoc.status).toBe(0)

    proc = spawn("bun", [CLI_SRC, "dashboard", "--no-open"], {
      cwd: tempProjectDir,
      stdio: "pipe",
    })
    const output = { value: "" }
    proc.stdout?.on("data", (d: Buffer) => { output.value += d.toString() })
    proc.stderr?.on("data", (d: Buffer) => { output.value += d.toString() })

    await waitForServers(output, 30000)

    const listRes = await fetch("http://localhost:3001/api/docs")
    expect(listRes.ok).toBe(true)
    const listData = await listRes.json() as { docs: Array<{ name: string }> }
    expect(listData.docs.some((doc) => doc.name === "dashboard-test-doc")).toBe(true)

    const detailRes = await fetch("http://localhost:3001/api/docs/dashboard-test-doc")
    expect(detailRes.ok).toBe(true)
    const detailData = await detailRes.json() as { name: string; kind: string }
    expect(detailData.name).toBe("dashboard-test-doc")
    expect(detailData.kind).toBe("overview")

    const graphRes = await fetch("http://localhost:3001/api/docs/graph")
    expect(graphRes.ok).toBe(true)
    const graphData = await graphRes.json() as { nodes: Array<{ label: string }> }
    expect(graphData.nodes.some((node) => node.label === "dashboard-test-doc")).toBe(true)
  }, 40000)
})
