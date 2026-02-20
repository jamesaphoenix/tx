import { describe, it, expect, afterEach } from "vitest"
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { ChildProcess } from "node:child_process"

const CLI_SRC = resolve(__dirname, "../../apps/cli/src/cli.ts")

interface ExecResult {
  status: number
  stdout: string
  stderr: string
}

function runTx(args: string[], cwd: string): ExecResult {
  const res = spawnSync("bun", [CLI_SRC, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 20000,
  })
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  }
}

const delay = (ms: number) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

function extractDashboardUrl(output: string): string | null {
  const summary = output.match(/Dashboard:\s*(https?:\/\/[^\s]+)/)
  if (summary?.[1]) return summary[1]
  const viteLocal = output.match(/Local:\s*(https?:\/\/[^\s]+)/)
  return viteLocal?.[1] ?? null
}

async function waitForServers(outputRef: { value: string }, apiPort: number, timeoutMs = 35000): Promise<string> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const dashboardUrl = extractDashboardUrl(outputRef.value)
    const apiReady = await fetch(`http://localhost:${apiPort}/api/stats`).then((r) => r.ok).catch(() => false)
    const dashboardReady = dashboardUrl
      ? await fetch(dashboardUrl).then((r) => r.ok).catch(() => false)
      : false
    if (apiReady && dashboardReady && dashboardUrl) {
      return dashboardUrl
    }
    await delay(400)
  }
  throw new Error(`dashboard did not become ready. output:\n${outputRef.value}`)
}

describe.sequential("dashboard docs e2e", () => {
  let proc: ChildProcess | null = null
  let tmpProjectDir: string | null = null

  afterEach(() => {
    if (proc && !proc.killed) {
      proc.kill("SIGTERM")
      proc = null
    }
    if (tmpProjectDir) {
      rmSync(tmpProjectDir, { recursive: true, force: true })
      tmpProjectDir = null
    }
  })

  it("loads docs list/detail/graph from the project DB used by tx dashboard", async () => {
    tmpProjectDir = mkdtempSync(join(tmpdir(), "tx-dashboard-docs-e2e-"))
    const apiPort = 3301

    const init = runTx(["init", "--codex"], tmpProjectDir)
    expect(init.status).toBe(0)

    const addOverview = runTx(
      ["doc", "add", "overview", "overview-dashboard-e2e", "--title", "Overview Dashboard E2E"],
      tmpProjectDir,
    )
    expect(addOverview.status).toBe(0)

    const addPrd = runTx(
      ["doc", "add", "prd", "PRD-001-dashboard-e2e", "--title", "PRD Dashboard E2E"],
      tmpProjectDir,
    )
    expect(addPrd.status).toBe(0)

    const link = runTx(
      ["doc", "link", "overview-dashboard-e2e", "PRD-001-dashboard-e2e", "--type", "overview_to_prd"],
      tmpProjectDir,
    )
    expect(link.status).toBe(0)

    proc = spawn("bun", [CLI_SRC, "dashboard", "--no-open", "--port", String(apiPort)], {
      cwd: tmpProjectDir,
      stdio: "pipe",
    })
    const output = { value: "" }
    proc.stdout?.on("data", (d: Buffer) => { output.value += d.toString() })
    proc.stderr?.on("data", (d: Buffer) => { output.value += d.toString() })

    await waitForServers(output, apiPort)

    const listRes = await fetch(`http://localhost:${apiPort}/api/docs`)
    expect(listRes.ok).toBe(true)
    const listData = await listRes.json() as { docs: Array<{ name: string; kind: string }> }
    expect(listData.docs.some((doc) => doc.name === "overview-dashboard-e2e")).toBe(true)
    expect(listData.docs.some((doc) => doc.name === "PRD-001-dashboard-e2e")).toBe(true)

    const filteredRes = await fetch(`http://localhost:${apiPort}/api/docs?kind=prd`)
    expect(filteredRes.ok).toBe(true)
    const filteredData = await filteredRes.json() as { docs: Array<{ name: string; kind: string }> }
    expect(filteredData.docs.length).toBeGreaterThan(0)
    expect(filteredData.docs.every((doc) => doc.kind === "prd")).toBe(true)

    const detailRes = await fetch(`http://localhost:${apiPort}/api/docs/PRD-001-dashboard-e2e`)
    expect(detailRes.ok).toBe(true)
    const detailData = await detailRes.json() as { name: string; kind: string }
    expect(detailData.name).toBe("PRD-001-dashboard-e2e")
    expect(detailData.kind).toBe("prd")

    const graphRes = await fetch(`http://localhost:${apiPort}/api/docs/graph`)
    expect(graphRes.ok).toBe(true)
    const graphData = await graphRes.json() as {
      nodes: Array<{ id: string; label: string }>
      edges: Array<{ source: string; target: string; type: string }>
    }
    const overviewNode = graphData.nodes.find((node) => node.label === "overview-dashboard-e2e")
    const prdNode = graphData.nodes.find((node) => node.label === "PRD-001-dashboard-e2e")
    expect(overviewNode).toBeDefined()
    expect(prdNode).toBeDefined()
    expect(
      graphData.edges.some((edge) =>
        edge.source === overviewNode?.id &&
        edge.target === prdNode?.id &&
        edge.type === "overview_to_prd"),
    ).toBe(true)

    const renderRes = await fetch(`http://localhost:${apiPort}/api/docs/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "PRD-001-dashboard-e2e" }),
    })
    expect(renderRes.ok).toBe(true)
    const renderData = await renderRes.json() as { rendered: string[] }
    expect(renderData.rendered.length).toBeGreaterThan(0)
    expect(renderData.rendered[0]).toContain("# PRD Dashboard E2E")
  }, 45000)
})
