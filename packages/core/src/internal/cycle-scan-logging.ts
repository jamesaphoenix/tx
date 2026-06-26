/**
 * Transcript logging and run-log path utilities for CycleScanService.
 */

import { mkdirSync } from "node:fs"
import { appendFile } from "node:fs/promises"
import { resolve } from "node:path"
import { existsSync } from "node:fs"

export const LOGS_DIR = resolve(".tx", "logs")
export const RUNS_DIR = resolve(".tx", "runs")

export type RunLogStream = "stdout" | "stderr"

export type RunLogPathHints = {
  readonly stdoutPath?: string | null
  readonly stderrPath?: string | null
}

export type RunPathRow = {
  readonly transcript_path: string | null
  readonly stdout_path: string | null
  readonly stderr_path: string | null
  readonly metadata: unknown
}

export function ensureLogsDir(): void {
  mkdirSync(LOGS_DIR, { recursive: true })
}

export function logPath(runId: string): string {
  return resolve(LOGS_DIR, `${runId}.jsonl`)
}

export function writeTranscriptLine(runId: string, message: unknown): void {
  try {
    const line = JSON.stringify(message) + "\n"
    // Use async appendFile to avoid blocking the event loop during concurrent scans
    appendFile(logPath(runId), line).catch(() => {
      // Don't let transcript writing break the scan
    })
  } catch {
    // Don't let transcript writing break the scan
  }
}

export function writeOrchestratorLog(runId: string, text: string): void {
  writeTranscriptLine(runId, {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
    timestamp: new Date().toISOString(),
  })
}

export function asNonEmptyPath(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function extractRunLogPathHints(message: unknown): RunLogPathHints {
  if (!message || typeof message !== "object") {
    return {}
  }

  const queue: Array<{ readonly value: unknown; readonly depth: number }> = [{ value: message, depth: 0 }]
  const seen = new Set<unknown>()
  let stdoutPath: string | null = null
  let stderrPath: string | null = null

  while (queue.length > 0 && (!stdoutPath || !stderrPath)) {
    const next = queue.shift()
    if (!next) break
    const { value, depth } = next

    if (!value || typeof value !== "object" || seen.has(value)) {
      continue
    }
    seen.add(value)

    const record = value as Record<string, unknown>
    if (!stdoutPath) {
      stdoutPath = asNonEmptyPath(record.stdout_path) ?? asNonEmptyPath(record.stdoutPath)
    }
    if (!stderrPath) {
      stderrPath = asNonEmptyPath(record.stderr_path) ?? asNonEmptyPath(record.stderrPath)
    }

    if (depth >= 2) continue

    for (const child of Object.values(record)) {
      if (child && typeof child === "object") {
        queue.push({ value: child, depth: depth + 1 })
      }
    }
  }

  return {
    ...(stdoutPath ? { stdoutPath } : {}),
    ...(stderrPath ? { stderrPath } : {}),
  }
}

export function buildRunLogPathCandidates(runId: string, stream: RunLogStream): readonly string[] {
  const suffixes = stream === "stdout" ? ["stdout", "stdout.log"] : ["stderr", "stderr.log"]

  return [
    resolve(LOGS_DIR, `${runId}.${suffixes[0]}`),
    resolve(LOGS_DIR, `${runId}.${suffixes[1]}`),
    resolve(RUNS_DIR, `${runId}.${suffixes[0]}`),
    resolve(RUNS_DIR, `${runId}.${suffixes[1]}`),
  ]
}

export function discoverRunLogPath(runId: string, stream: RunLogStream): string | null {
  const candidates = buildRunLogPathCandidates(runId, stream)
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

export function parseRunMetadata(raw: unknown): Record<string, unknown> {
  if (!raw) return {}
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  if (typeof raw !== "string") return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}
