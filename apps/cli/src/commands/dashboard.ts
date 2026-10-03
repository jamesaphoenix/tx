/**
 * Dashboard command: Start API server + Vite dev server and open in browser
 *
 * Usage:
 *   tx diag dashboard              # Start and open in Brave/Chrome
 *   tx diag dashboard --no-open    # Start without opening browser
 *   tx diag dashboard --port 3002  # Custom API port
 */

import { Effect } from "effect"
import { spawn, execSync, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import { createServer } from "node:net"
import { CliUserError } from "../cli-errors.js"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { type Flags, flag, parseIntOpt } from "../utils/parse.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, "../../../..")

const API_SERVER_ENTRY = resolve(PROJECT_ROOT, "apps/dashboard/server/index.ts")
const DASHBOARD_DIR = resolve(PROJECT_ROOT, "apps/dashboard")

const portAvailable = (port: number): Promise<boolean> => new Promise((resolvePort) => {
  const probe = createServer()
  probe.once("error", () => resolvePort(false))
  probe.listen(port, () => probe.close(() => resolvePort(true)))
})

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

export async function stopDashboardChildren(children: readonly ChildProcess[], graceMs = 300): Promise<void> {
  const stillRunning = (child: ChildProcess) => child.pid !== undefined && child.exitCode === null && child.signalCode === null
  for (const child of children) if (stillRunning(child)) child.kill("SIGTERM")
  await new Promise<void>(resolveStop => setTimeout(resolveStop, graceMs))
  // .killed means a signal was sent, not that the process has actually exited.
  for (const child of children) if (stillRunning(child)) child.kill("SIGKILL")
}

export const dashboard = (_pos: string[], flags: Flags) =>
  Effect.promise(async () => {
    const apiPort = parseIntOpt(flags, "port", "port") ?? 3001
    const vitePort = parseIntOpt(flags, "vite-port", "vite-port") ?? 5173
    for (const [name, port] of [["port", apiPort], ["vite-port", vitePort]] as const) {
      if (port < 1 || port > 65535) throw new CliUserError({
        code: "cli/invalid-flag-value", message: `--${name} must be between 1 and 65535.`,
      })
    }
    if (!existsSync(API_SERVER_ENTRY) || !existsSync(DASHBOARD_DIR)) throw new CliUserError({
      code: "cli/dashboard-source-required",
      message: "The dashboard requires a tx source checkout.",
      hint: "Clone https://github.com/jamesaphoenix/tx and run bun install first.",
    })
    const noOpen = flag(flags, "no-open")

    // Resolve DB path from CWD (same logic as cli.ts)
    const dbPath = typeof flags.db === "string"
      ? resolve(flags.db as string)
      : resolve(process.cwd(), ".tx", "tasks.db")
    const contentRoot = typeof flags["content-root"] === "string" ? resolve(flags["content-root"]) : process.cwd()

    console.log("Starting tx diag dashboard...")
    console.log(`Database: ${dbPath}`)

    if (!await portAvailable(apiPort)) throw new CliUserError({
      code: "cli/port-in-use",
      message: `Dashboard API port ${apiPort} is already in use.`,
      hint: "Choose a free port with tx diag dashboard --port <port>.",
    })

    const runtime = process.argv[0]

    // Start API server, pass TX_DB_PATH so it uses the caller's database
    console.log(`Starting API server on port ${apiPort}...`)
    const apiProc = spawn(runtime, [API_SERVER_ENTRY], {
      cwd: contentRoot,
      stdio: "pipe",
      env: { ...process.env, PORT: String(apiPort), TX_DB_PATH: dbPath, TX_CONTENT_ROOT: contentRoot },
      detached: false,
    })

    // Start Vite dev server
    console.log(`Starting Vite dev server on port ${vitePort}...`)
    const viteProc = spawn(runtime, ["run", "dev", "--port", String(vitePort)], {
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
      void stopDashboardChildren(children).then(() => process.exit(exitCode))
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
