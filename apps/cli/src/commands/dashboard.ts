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

function killPort(port: number): void {
  try {
    const raw = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf-8" }).trim()
    if (raw) {
      const pids = [...new Set(raw.split(/\s+/).filter(Boolean))]
      const label = pids.length === 1 ? "PID" : "PIDs"
      console.log(`Killing existing process on port ${port} (${label} ${pids.join(", ")})`)
      for (const pid of pids) {
        try {
          execSync(`kill ${pid} 2>/dev/null`)
        } catch {
          // Ignore per-PID failures
        }
      }
    }
  } catch {
    // No process on port — that's fine
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
  Effect.sync(() => {
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
    killPort(apiPort)
    killPort(vitePort)

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
      detached: false,
    })

    const children = [apiProc, viteProc]
    let dashboardUrl = `http://localhost:${vitePort}`
    let announced = false
    let openedUrl: string | null = null

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

    // Handle child exits
    for (const child of children) {
      child.on("error", (err) => console.error(`Process error: ${err.message}`))
    }

    // Cleanup on exit
    const cleanup = () => {
      console.log("\nShutting down dashboard...")
      for (const child of children) {
        child.kill()
      }
    }

    process.on("SIGINT", () => { cleanup(); process.exit(0) })
    process.on("SIGTERM", () => { cleanup(); process.exit(0) })

    // Fallback: announce even if we didn't parse Vite "Local" line yet.
    setTimeout(() => {
      announce()
    }, 6000)
  })
