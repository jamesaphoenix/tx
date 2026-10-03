import { afterEach, describe, expect, it } from "vitest"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { createServer, type Server } from "node:http"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { stopDashboardChildren } from "./dashboard.js"

const CLI_SRC = resolve(import.meta.dirname, "../cli.ts")
const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const listen = (server: Server): Promise<number> => new Promise((resolvePort, reject) => {
  server.once("error", reject)
  server.listen(0, () => resolvePort((server.address() as { port: number }).port))
})
const freePort = async () => {
  const server = createServer()
  const port = await listen(server)
  await new Promise<void>(r => server.close(() => r()))
  return port
}
const responds = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
    await response.arrayBuffer()
    return response.ok
  } catch { return false }
}

// Exercises the real command and its real API, including preservation of other
// processes. UI interaction is covered separately by dashboard component tests.
describe("tx diag dashboard", () => {
  let proc: ChildProcess | undefined
  let blocker: Server | undefined
  let project: string | undefined
  let output = ""
  const otherProjects: string[] = []

  afterEach(async () => {
    if (proc && proc.exitCode === null) {
      const child = proc
      child.kill("SIGTERM")
      const deadline = Date.now() + 5000
      while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await wait(20)
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    }
    if (blocker) await new Promise<void>(r => blocker!.close(() => r()))
    if (project) rmSync(project, { recursive: true, force: true })
    for (const root of otherProjects.splice(0)) rmSync(root, { recursive: true, force: true })
    proc = undefined; blocker = undefined; project = undefined; output = ""
  })

  const start = async (preferredVitePort?: number, contentRoot?: string) => {
    project = mkdtempSync(join(tmpdir(), "tx-dashboard-cli-"))
    const init = spawnSync("bun", [CLI_SRC, "init"], { cwd: project, encoding: "utf8", timeout: 10000 })
    expect(init.status, init.stderr).toBe(0)
    const apiPort = await freePort()
    const vitePort = preferredVitePort ?? await freePort()
    proc = spawn("bun", [CLI_SRC, "diag", "dashboard", "--no-open", "--port", String(apiPort), "--vite-port", String(vitePort),
      ...(contentRoot ? ["--content-root", contentRoot] : [])], { cwd: project, stdio: "pipe" })
    proc.stdout?.on("data", d => { output += d.toString() })
    proc.stderr?.on("data", d => { output += d.toString() })
    return { apiPort, vitePort }
  }

  const ready = async (apiPort: number) => {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      const ui = output.match(/Dashboard:\s*(https?:\/\/[^\s]+)/)?.[1]
      const apiReady = await responds(`http://localhost:${apiPort}/api/stats`)
      if (ui && apiReady && await responds(ui)) return ui
      if (proc?.exitCode !== null) throw new Error(output)
      await wait(50)
    }
    throw new Error(`Dashboard did not become ready:\n${output}`)
  }

  it("exposes accurate help under the diagnostics namespace", () => {
    const result = spawnSync("bun", [CLI_SRC, "diag", "dashboard", "--help"], { encoding: "utf8", timeout: 10000 })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("tx diag dashboard")
    expect(result.stdout).toContain("--vite-port")
    expect(result.stdout).toContain("never stopped")
  })

  it("rejects invalid ports before starting servers", () => {
    for (const port of ["invalid", "0", "65536", "3001.2"]) {
      const result = spawnSync("bun", [CLI_SRC, "diag", "dashboard", "--port", port, "--no-open"], { encoding: "utf8", timeout: 10000 })
      expect(result.status).not.toBe(0)
      expect(result.stdout).not.toContain("Starting API server")
    }
  })

  it("leaves an occupied API port running and tells the user how to recover", async () => {
    blocker = createServer((_req, res) => res.end("existing service"))
    const port = await listen(blocker)
    const result = spawnSync("bun", [CLI_SRC, "diag", "dashboard", "--no-open", "--port", String(port)], { encoding: "utf8", timeout: 10000 })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("already in use")
    expect(result.stderr).toContain("--port")
    expect(await fetch(`http://localhost:${port}`).then(r => r.text())).toBe("existing service")
  })

  it("starts scoped API and UI servers and releases both on SIGTERM", async () => {
    const { apiPort } = await start()
    const ui = await ready(apiPort)
    expect(await fetch(`${ui}/api/stats`).then(r => r.ok)).toBe(true)
    proc!.kill("SIGTERM")
    const deadline = Date.now() + 5000
    while (proc!.exitCode === null && proc!.signalCode === null && Date.now() < deadline) await wait(20)
    expect(await responds(`http://localhost:${apiPort}/api/stats`)).toBe(false)
    expect(await responds(ui)).toBe(false)
  }, 25000)

  it("uses Vite's actual URL and preserves an occupied UI port", async () => {
    blocker = createServer((_req, res) => res.end("existing UI"))
    const port = await listen(blocker)
    const { apiPort } = await start(port)
    const ui = await ready(apiPort)
    expect(new URL(ui).port).not.toBe(String(port))
    expect(await fetch(`http://localhost:${port}`).then(r => r.text())).toBe("existing UI")
  }, 25000)

  it("serves Documents from the selected project database", async () => {
    const { apiPort } = await start()
    await ready(apiPort)
    const add = spawnSync("bun", [CLI_SRC, "doc", "add", "plan", "saved-plan", "--title", "Saved plan"], { cwd: project, encoding: "utf8", timeout: 10000 })
    expect(add.status, add.stderr).toBe(0)
    const list = await fetch(`http://localhost:${apiPort}/api/docs`).then(r => r.json()) as { docs: { name: string }[] }
    expect(list.docs.map(d => d.name)).toContain("saved-plan")
    const detail = await fetch(`http://localhost:${apiPort}/api/docs/saved-plan`).then(r => r.json()) as { name: string; kind: string }
    expect(detail).toMatchObject({ name: "saved-plan", kind: "plan" })
    const graph = await fetch(`http://localhost:${apiPort}/api/docs/graph`).then(r => r.json()) as { nodes: { label: string }[] }
    expect(graph.nodes.map(n => n.label)).toContain("saved-plan")
    const addedTask = spawnSync("bun", [CLI_SRC, "task", "add", "Implement saved plan", "--json"], { cwd: project, encoding: "utf8", timeout: 10000 })
    expect(addedTask.status, addedTask.stderr).toBe(0)
    const task = JSON.parse(addedTask.stdout) as { id: string }
    const attach = spawnSync("bun", [CLI_SRC, "doc", "attach", task.id, "saved-plan"], { cwd: project, encoding: "utf8", timeout: 10000 })
    expect(attach.status, attach.stderr).toBe(0)
    const linkedTask = await fetch(`http://localhost:${apiPort}/api/tasks/${task.id}`).then(r => r.json()) as { task: { linkedDocs: unknown[] } }
    expect(linkedTask.task.linkedDocs).toEqual([expect.objectContaining({ name: "saved-plan", kind: "plan", linkType: "implements" })])
    const linkedGraph = await fetch(`http://localhost:${apiPort}/api/docs/graph`).then(r => r.json()) as { nodes: { id: string; label: string }[] }
    expect(linkedGraph.nodes.find(node => node.id === `task:${task.id}`)?.label).toBe("Implement saved plan")
    const unrelated = spawnSync("bun", [CLI_SRC, "doc", "add", "overview", "unrelated-overview"], { cwd: project, encoding: "utf8", timeout: 10000 })
    expect(unrelated.status, unrelated.stderr).toBe(0)
    const recordedGraph = await fetch(`http://localhost:${apiPort}/api/docs/graph`).then(r => r.json()) as { edges: { type: string }[] }
    expect(recordedGraph.edges.map(edge => edge.type)).toEqual(["implements"])
  }, 25000)
  it("trims title edits and rejects blank or non-string titles without changing the task", async () => {
    const { apiPort } = await start()
    await ready(apiPort)
    const add = spawnSync("bun", [CLI_SRC, "task", "add", "Original title", "--json"], { cwd: project, encoding: "utf8", timeout: 10000 })
    expect(add.status, add.stderr).toBe(0)
    const { id } = JSON.parse(add.stdout) as { id: string }
    const url = `http://localhost:${apiPort}/api/tasks/${id}`
    const update = (title: unknown) => fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) })
    const valid = await update("  Renamed task  ")
    expect(valid.status).toBe(200)
    expect(await valid.json()).toMatchObject({ title: "Renamed task" })
    for (const title of ["", " ", "\u200b", 17, null, {}, ["title"]]) {
      const rejected = await update(title)
      expect(rejected.status).toBe(400)
      expect(await rejected.json()).toMatchObject({ error: expect.stringMatching(/title/i) })
      const current = await fetch(url).then(r => r.json()) as { task: { title: string } }
      expect(current.task.title).toBe("Renamed task")
    }
    for (const body of ["{broken", "null", "[]", '"title"']) {
      const rejected = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body })
      expect(rejected.status).toBe(400)
      expect(await rejected.json()).toMatchObject({ error: expect.stringMatching(/JSON/) })
    }
    const tooLarge = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "x".repeat(1_048_577) }) })
    expect(tooLarge.status).toBe(413)
    expect(await tooLarge.json()).toEqual({ error: "Request body too large" })
  }, 25000)

  it("uses the selected worktree's documents and evidence with a shared database", async () => {
    const contentRoot = mkdtempSync(join(tmpdir(), "tx-dashboard-worktree-"))
    otherProjects.push(contentRoot)
    const { apiPort } = await start(undefined, contentRoot)
    await ready(apiPort)
    const added = spawnSync("bun", [CLI_SRC, "doc", "add", "design", "worktree-design", "--title", "Worktree design", "--state-root", project!, "--json"], { cwd: contentRoot, encoding: "utf8", timeout: 10000 })
    expect(added.status, added.stderr).toBe(0)
    const doc = JSON.parse(added.stdout) as { docId: string; filePath: string }
    const sourcePath = join(contentRoot, "specs", doc.filePath)
    writeFileSync(sourcePath, readFileSync(sourcePath, "utf8").replace("Describe the design approach.", "Worktree design source."))
    const source = await fetch(`http://localhost:${apiPort}/api/docs/by-id/${doc.docId}/source`).then(r => r.json()) as { renderedContent: string }
    expect(source.renderedContent).toContain("Worktree design")
    const cliHealth = spawnSync("bun", [CLI_SRC, "spec", "health", "--content-root", contentRoot, "--json"], { cwd: project, encoding: "utf8", timeout: 10000 })
    expect(cliHealth.status, cliHealth.stderr).toBe(0)
    expect(await fetch(`http://localhost:${apiPort}/api/spec/health`).then(r => r.json())).toEqual(JSON.parse(cliHealth.stdout))
  }, 25000)

})

describe("dashboard process ownership", () => {
  it("forces an owned child to exit if it ignores SIGTERM", async () => {
    const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)'], { stdio: "pipe" })
    const exit = new Promise<void>(resolveExit => child.once("exit", () => resolveExit()))
    try {
      await new Promise<void>((resolveReady, reject) => {
        const timeout = setTimeout(() => reject(new Error("Child did not initialise")), 3000)
        child.once("error", reject)
        child.stdout!.once("data", () => { clearTimeout(timeout); resolveReady() })
      })
      await stopDashboardChildren([child], 100)
      await Promise.race([exit, wait(1000)])
      expect(child.signalCode).toBe("SIGKILL")
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      await exit
    }
  })
})
