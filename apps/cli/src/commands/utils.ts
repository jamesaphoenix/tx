/**
 * CLI commands for tx utils — external tool utilities
 *
 * Usage checking for Claude Code and Codex subscriptions.
 * These commands do NOT require the tx database.
 */

import { Effect } from "effect"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { commandHelp } from "../help.js"
import { CliExitError } from "../cli-exit.js"

type Flags = Record<string, string | boolean>

function flag(flags: Flags, ...names: string[]): boolean {
  return names.some(n => flags[n] === true)
}

// --- Format helpers ---

function formatTimeUntil(isoOrUnix: string | number): string {
  const resetMs = typeof isoOrUnix === "number"
    ? isoOrUnix * 1000
    : new Date(isoOrUnix as string).getTime()
  const diffMs = resetMs - Date.now()
  if (diffMs <= 0) return "now"

  const totalMins = Math.floor(diffMs / 60_000)
  const hours = Math.floor(totalMins / 60)
  const minutes = totalMins % 60

  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const resetDate = new Date(resetMs)
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return `${monthNames[resetDate.getMonth()]} ${resetDate.getDate()} (${days}d ${hours % 24}h)`
  }
  if (hours > 0) return `in ${hours}h ${minutes}m`
  return `in ${minutes}m`
}

function formatBar(usedPercent: number, width: number = 20): string {
  const used = Math.round((usedPercent / 100) * width)
  const empty = width - used
  return "\u2588".repeat(used) + "\u2591".repeat(empty)
}

function formatWindow(label: string, usedPercent: number, resetsAt: string | number | null | undefined): string {
  const remaining = 100 - usedPercent
  const bar = formatBar(usedPercent)
  const resetStr = resetsAt != null ? ` \u00b7 resets ${formatTimeUntil(resetsAt)}` : ""
  const padLabel = label.padEnd(10)
  const usedStr = `${usedPercent}%`.padStart(4)
  const remainStr = `${remaining}%`.padStart(4)
  return `  ${padLabel}${bar} ${usedStr} used \u00b7 ${remainStr} left${resetStr}`
}

// --- claude-usage ---

const claudeUsage = (_pos: string[], flags: Flags) =>
  Effect.tryPromise({
    try: async () => {
      const credPath = join(homedir(), ".claude", ".credentials.json")
      if (!existsSync(credPath)) {
        console.error("Error: Claude credentials not found at ~/.claude/.credentials.json")
        console.error("Hint: Sign in to Claude Code first (claude auth login)")
        throw new CliExitError(1)
      }

      let creds: Record<string, unknown>
      try {
        creds = JSON.parse(readFileSync(credPath, "utf-8"))
      } catch {
        console.error("Error: Failed to parse ~/.claude/.credentials.json")
        throw new CliExitError(1)
      }

      const accessToken = (creds?.claudeAiOauth as Record<string, unknown>)?.accessToken as string | undefined
      if (!accessToken) {
        console.error("Error: No OAuth access token found in credentials")
        console.error("Hint: Re-authenticate with Claude Code (claude auth login)")
        throw new CliExitError(1)
      }

      const subscriptionType = (creds?.claudeAiOauth as Record<string, unknown>)?.subscriptionType as string | undefined

      const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
        },
      })

      if (!response.ok) {
        console.error(`Error: API returned ${response.status} ${response.statusText}`)
        if (response.status === 401) {
          console.error("Hint: Token may have expired. Re-authenticate with: claude auth login")
        }
        throw new CliExitError(1)
      }

      const usage = await response.json() as Record<string, unknown>

      if (flag(flags, "json")) {
        console.log(JSON.stringify(usage, null, 2))
        return
      }

      // Human-readable output
      const planLabel = subscriptionType ? ` (${subscriptionType})` : ""
      console.log(`Claude Code Usage${planLabel}`)

      const fiveHour = usage.five_hour as { utilization: number; resets_at: string } | null
      if (fiveHour) {
        console.log(formatWindow("5-hour:", fiveHour.utilization, fiveHour.resets_at))
      }

      const sevenDay = usage.seven_day as { utilization: number; resets_at: string } | null
      if (sevenDay) {
        console.log(formatWindow("7-day:", sevenDay.utilization, sevenDay.resets_at))
      }

      const sonnet = usage.seven_day_sonnet as { utilization: number; resets_at: string } | null
      if (sonnet) {
        console.log(formatWindow("Sonnet:", sonnet.utilization, sonnet.resets_at))
      }

      const opus = usage.seven_day_opus as { utilization: number; resets_at: string } | null
      if (opus) {
        console.log(formatWindow("Opus:", opus.utilization, opus.resets_at))
      }

      const extra = usage.extra_usage as { is_enabled: boolean; utilization: number | null } | null
      if (extra?.is_enabled && extra.utilization != null) {
        console.log(formatWindow("Extra:", extra.utilization, null))
      }
    },
    catch: (e) => {
      if (e instanceof CliExitError) throw e
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`)
      throw new CliExitError(1)
    },
  })

// --- codex-usage ---

interface RateLimitWindow {
  usedPercent: number
  resetsAt?: number | null
  windowDurationMins?: number | null
}

interface RateLimitSnapshot {
  limitId?: string | null
  limitName?: string | null
  primary?: RateLimitWindow | null
  secondary?: RateLimitWindow | null
  planType?: string | null
  credits?: { hasCredits: boolean; unlimited: boolean; balance?: string | null } | null
}

interface CodexRateLimitsResult {
  rateLimits: RateLimitSnapshot
  rateLimitsByLimitId?: Record<string, RateLimitSnapshot> | null
}

const codexUsage = (_pos: string[], flags: Flags) =>
  Effect.tryPromise({
    try: async () => {
      const codexCheck = spawnSync("which", ["codex"], { encoding: "utf-8" })
      if (codexCheck.status !== 0) {
        console.error("Error: codex CLI not found")
        console.error("Hint: Install with npm install -g codex@latest")
        throw new CliExitError(1)
      }

      const proc = spawn("codex", ["app-server", "--listen", "stdio://"], {
        stdio: ["pipe", "pipe", "pipe"],
      })

      try {
        let buffer = ""

        const sendRpc = (id: number, method: string, params: Record<string, unknown>): Promise<unknown> => {
          return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              proc.stdout!.off("data", onData)
              reject(new Error("Timeout waiting for codex app-server response (10s)"))
            }, 10_000)

            const onData = (chunk: Buffer) => {
              buffer += chunk.toString()
              const lines = buffer.split("\n")
              buffer = lines.pop() ?? ""
              for (const line of lines) {
                if (!line.trim()) continue
                try {
                  const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } }
                  if (msg.id === id) {
                    clearTimeout(timeout)
                    proc.stdout!.off("data", onData)
                    if (msg.error) reject(new Error(msg.error.message))
                    else resolve(msg.result)
                  }
                } catch { /* skip non-JSON lines */ }
              }
            }

            proc.stdout!.on("data", onData)
            proc.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
          })
        }

        // Initialize
        await sendRpc(1, "initialize", {
          clientInfo: { name: "tx", version: "0.1.0" },
        })

        // Get rate limits
        const result = await sendRpc(2, "account/rateLimits/read", {}) as CodexRateLimitsResult

        if (flag(flags, "json")) {
          console.log(JSON.stringify(result, null, 2))
          return
        }

        // Human-readable output
        const planLabel = result.rateLimits.planType ? ` (${result.rateLimits.planType})` : ""
        console.log(`Codex Usage${planLabel}`)

        if (result.rateLimits.primary) {
          console.log(formatWindow("5-hour:", result.rateLimits.primary.usedPercent, result.rateLimits.primary.resetsAt))
        }

        if (result.rateLimits.secondary) {
          console.log(formatWindow("Weekly:", result.rateLimits.secondary.usedPercent, result.rateLimits.secondary.resetsAt))
        }

        // Per-model breakdown
        const byId = result.rateLimitsByLimitId
        if (byId) {
          for (const [key, snapshot] of Object.entries(byId)) {
            if (key === result.rateLimits.limitId) continue // skip main bucket (already shown)
            // Shorten long names (e.g. "GPT-5.3-Codex-Spark" → "Spark")
            const rawName = snapshot.limitName ?? key
            const shortName = rawName.length > 12 ? rawName.split("-").pop() ?? rawName : rawName
            if (snapshot.primary) {
              console.log(formatWindow(`${shortName} 5h:`, snapshot.primary.usedPercent, snapshot.primary.resetsAt))
            }
            if (snapshot.secondary) {
              console.log(formatWindow(`${shortName} wk:`, snapshot.secondary.usedPercent, snapshot.secondary.resetsAt))
            }
          }
        }

        // Credits info
        const credits = result.rateLimits.credits
        if (credits) {
          if (credits.unlimited) {
            console.log("  Credits:    unlimited")
          } else if (credits.balance != null) {
            console.log(`  Credits:    ${credits.balance}`)
          }
        }
      } finally {
        proc.kill("SIGTERM")
      }
    },
    catch: (e) => {
      if (e instanceof CliExitError) throw e
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`)
      throw new CliExitError(1)
    },
  })

// --- Dispatcher ---

export const utils = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sub = pos[0]

    if (!sub || sub === "help") {
      console.log(commandHelp["utils"] ?? "Usage: tx utils <claude-usage|codex-usage>")
      return
    }

    if (flag(flags, "help", "h")) {
      const helpKey = `utils ${sub}`
      if (commandHelp[helpKey]) {
        console.log(commandHelp[helpKey])
        return
      }
    }

    switch (sub) {
      case "claude-usage":
        return yield* claudeUsage(pos.slice(1), flags)
      case "codex-usage":
        return yield* codexUsage(pos.slice(1), flags)
      default:
        console.error(`Unknown utils subcommand: ${sub}`)
        console.error("Run 'tx utils --help' for usage information")
        throw new CliExitError(1)
    }
  })
