/**
 * Dashboard command: Start API server + Vite dev server and open in browser
 *
 * Usage:
 *   tx dashboard              # Start and open in Brave/Chrome
 *   tx dashboard --no-open    # Start without opening browser
 *   tx dashboard --port 3002  # Custom API port
 */

import { Effect } from "effect"
import { spawn, execSync } from "node:child_process"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { type Flags, flag, opt } from "../utils/parse.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, "../../../..")

const API_SERVER_ENTRY = resolve(PROJECT_ROOT, "apps/dashboard/server/index.ts")
const DASHBOARD_DIR = resolve(PROJECT_ROOT, "apps/dashboard")

function getPortPids(port: number): string[] {
  try {
    const raw = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf-8" }).trim()
    if (!raw) return []
    return [...new Set(raw.split(/\s+/).filter(Boolean))]
  } catch {
    return []
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function waitForPortToClear(port: number, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (getPortPids(port).length === 0) return true
    await sleep(100)
  }
  return getPortPids(port).length === 0
}

function killPids(pids: string[], signal: "TERM" | "KILL"): void {
  for (const pid of pids) {
    try {
      execSync(`kill -${signal} ${pid} 2>/dev/null`)
    } catch {
      // Ignore per-PID failures
    }
  }
}

async function killPort(port: number): Promise<void> {
  const pids = getPortPids(port)
  if (pids.length === 0) return

  const label = pids.length === 1 ? "PID" : "PIDs"
  console.log(`Killing existing process on port ${port} (${label} ${pids.join(", ")})`)
  killPids(pids, "TERM")

  if (await waitForPortToClear(port, 2000)) return

  const remainingPids = getPortPids(port)
  if (remainingPids.length > 0) {
    const remainingLabel = remainingPids.length === 1 ? "PID" : "PIDs"
    console.log(`Port ${port} is still occupied, forcing shutdown (${remainingLabel} ${remainingPids.join(", ")})`)
    killPids(remainingPids, "KILL")
  }

  if (!(await waitForPortToClear(port, 3000))) {
    throw new Error(`Failed to free port ${port}. Stop the process manually or run with --port.`)
  }
}

function extractViteLocalUrl(output: string): string | null {
  const match = output.match(/Local:\s*(https?:\/\/[^\s]+)/)
  return match?.[1] ?? null
}

function openBrowser(url: string): void {
  try {
    execSync(`open -a "Brave Browser" "${url}" 2>/dev/null`)
    console.log("Opened in Brave Browser")
    return
  } catch { /* Brave not available */ }

  try {
    execSync(`open -a "Google Chrome" "${url}" 2>/dev/null`)
    console.log("Opened in Google Chrome")
    return
  } catch { /* Chrome not available */ }

  try {
    execSync(`open "${url}" 2>/dev/null`)
    console.log("Opened in default browser")
  } catch {
    console.log(`Open ${url} in your browser`)
  }
}

export const dashboard = (_pos: string[], flags: Flags) =>
  Effect.promise(async () => {
    const apiPort = Number(opt(flags, "port")) || 3001
    const vitePort = 5173
    const noOpen = flag(flags, "no-open")

    // Resolve DB path from CWD (same logic as cli.ts)
    const dbPath = typeof flags.db === "string"
      ? resolve(flags.db as string)
      : resolve(process.cwd(), ".tx", "tasks.db")

    console.log("Starting tx dashboard...")
    console.log(`Database: ${dbPath}`)

    // Kill existing processes on our ports
    await killPort(apiPort)
    await killPort(vitePort)

    const runtime = process.argv[0]

    // Start API server — pass TX_DB_PATH so it uses the caller's database
    console.log(`Starting API server on port ${apiPort}...`)
    const apiProc = spawn(runtime, [API_SERVER_ENTRY], {
      stdio: "pipe",
      env: { ...process.env, PORT: String(apiPort), TX_DB_PATH: dbPath },
      detached: false,
    })

    // Start Vite dev server
    console.log(`Starting Vite dev server on port ${vitePort}...`)
    const viteProc = spawn(runtime, ["run", "dev"], {
      cwd: DASHBOARD_DIR,
      stdio: "pipe",
      env: { ...process.env, TX_DASHBOARD_API_PORT: String(apiPort) },
      detached: false,
    })

    const children = [apiProc, viteProc]
    let dashboardUrl = `http://localhost:${vitePort}`
    let announced = false
    let openedUrl: string | null = null
    let shuttingDown = false
    let fallbackAnnounceTimer: ReturnType<typeof setTimeout> | undefined

    const announce = () => {
      if (announced) return
      announced = true
      if (!noOpen) {
        openBrowser(dashboardUrl)
        openedUrl = dashboardUrl
      }
      console.log("")
      console.log(`  API:       http://localhost:${apiPort}`)
      console.log(`  Dashboard: ${dashboardUrl}`)
      console.log("")
      console.log("Press Ctrl+C to stop.")
    }

    const onDetectedDashboardUrl = (viteUrl: string) => {
      const changed = dashboardUrl !== viteUrl
      dashboardUrl = viteUrl

      if (!announced) {
        announce()
        return
      }

      if (changed) {
        console.log(`\n  Dashboard URL updated: ${dashboardUrl}`)
        if (!noOpen && openedUrl !== dashboardUrl) {
          openBrowser(dashboardUrl)
          openedUrl = dashboardUrl
        }
      }
    }

    // Forward output
    apiProc.stdout?.on("data", (d: Buffer) => process.stdout.write(`[api] ${d}`))
    apiProc.stderr?.on("data", (d: Buffer) => process.stderr.write(`[api] ${d}`))
    const onViteData = (prefix: "stdout" | "stderr") => (d: Buffer) => {
      const text = d.toString()
      const viteUrl = extractViteLocalUrl(text)
      if (viteUrl) {
        onDetectedDashboardUrl(viteUrl)
      }
      const sink = prefix === "stdout" ? process.stdout : process.stderr
      sink.write(`[vite] ${text}`)
    }
    viteProc.stdout?.on("data", onViteData("stdout"))
    viteProc.stderr?.on("data", onViteData("stderr"))

    // Cleanup on exit
    const cleanup = (exitCode: number) => {
      if (shuttingDown) return
      shuttingDown = true
      if (fallbackAnnounceTimer) clearTimeout(fallbackAnnounceTimer)
      console.log("\nShutting down dashboard...")
      for (const child of children) {
        if (!child.killed) child.kill("SIGTERM")
      }
      setTimeout(() => {
        for (const child of children) {
          if (!child.killed) child.kill("SIGKILL")
        }
        process.exit(exitCode)
      }, 300).unref()
    }

    const onUnexpectedExit = (name: string, code: number | null, signal: NodeJS.Signals | null) => {
      if (shuttingDown) return
      const detail = code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`
      console.error(`\n${name} exited unexpectedly (${detail}).`)
      if (name === "API server") {
        console.error("Dashboard API is unavailable, stopping the dashboard.")
      }
      cleanup(code === null || code === 0 ? 1 : code)
    }

    // Handle child exits
    apiProc.on("error", (err) => {
      if (shuttingDown) return
      console.error(`API server process error: ${err.message}`)
      cleanup(1)
    })
    viteProc.on("error", (err) => {
      if (shuttingDown) return
      console.error(`Vite process error: ${err.message}`)
      cleanup(1)
    })
    apiProc.on("exit", (code, signal) => onUnexpectedExit("API server", code, signal))
    viteProc.on("exit", (code, signal) => onUnexpectedExit("Vite dev server", code, signal))

    process.on("SIGINT", () => cleanup(0))
    process.on("SIGTERM", () => cleanup(0))

    // Fallback: announce even if we didn't parse Vite "Local" line yet.
    fallbackAnnounceTimer = setTimeout(() => {
      if (!shuttingDown) announce()
    }, 6000)
  })
