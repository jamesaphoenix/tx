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
    const pid = execSync(`lsof -ti :${port} 2>/dev/null`, { encoding: "utf-8" }).trim()
    if (pid) {
      console.log(`Killing existing process on port ${port} (PID ${pid})`)
      execSync(`kill ${pid} 2>/dev/null`)
    }
  } catch {
    // No process on port — that's fine
  }
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

    console.log("Starting tx dashboard...")

    // Kill existing processes on our ports
    killPort(apiPort)
    killPort(vitePort)

    const runtime = process.argv[0]

    // Start API server
    console.log(`Starting API server on port ${apiPort}...`)
    const apiProc = spawn(runtime, [API_SERVER_ENTRY], {
      stdio: "pipe",
      env: { ...process.env, PORT: String(apiPort) },
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

    // Forward output
    apiProc.stdout?.on("data", (d: Buffer) => process.stdout.write(`[api] ${d}`))
    apiProc.stderr?.on("data", (d: Buffer) => process.stderr.write(`[api] ${d}`))
    viteProc.stdout?.on("data", (d: Buffer) => process.stdout.write(`[vite] ${d}`))
    viteProc.stderr?.on("data", (d: Buffer) => process.stderr.write(`[vite] ${d}`))

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

    // Wait for servers then open browser
    setTimeout(() => {
      if (!noOpen) {
        openBrowser(`http://localhost:${vitePort}`)
      }
      console.log("")
      console.log(`  API:       http://localhost:${apiPort}`)
      console.log(`  Dashboard: http://localhost:${vitePort}`)
      console.log("")
      console.log("Press Ctrl+C to stop.")
    }, 3000)
  })
