/**
 * CycleScanService — Cycle-Based Issue Discovery
 *
 * Orchestrates sub-agent swarms via AgentService to scan for codebase issues,
 * deduplicates findings against known issues using an LLM-as-judge, and
 * optionally fixes them. Repeats in rounds within each cycle until convergence.
 */

import { Context, Effect, Layer } from "effect"
import { mkdirSync } from "node:fs"
import { appendFile } from "node:fs/promises"
import { resolve } from "node:path"
import { randomBytes } from "node:crypto"
import { readFileSync, existsSync, statSync } from "node:fs"
import type { Finding, DedupResult, CycleConfig, CycleResult, CycleProgressEvent } from "@jamesaphoenix/tx-types"
import { LOSS_WEIGHTS } from "@jamesaphoenix/tx-types"
import { CycleScanError } from "../errors.js"
import { AgentService } from "./agent-service.js"
import { SqliteClient } from "../db.js"

// =============================================================================
// JSON Schemas for Structured Output
// =============================================================================

const FINDINGS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short, descriptive issue title" },
          description: { type: "string", description: "Detailed explanation of the issue and why it matters" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          issueType: { type: "string", description: "Category: bug, anti-pattern, security, performance, testing, ddd, etc." },
          file: { type: "string", description: "File path relative to project root" },
          line: { type: "number", description: "Approximate line number" },
        },
        required: ["title", "description", "severity", "issueType", "file", "line"],
      },
    },
  },
  required: ["findings"],
}

const DEDUP_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    newIssues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          severity: { type: "string", enum: ["high", "medium", "low"] },
          issueType: { type: "string" },
          file: { type: "string" },
          line: { type: "number" },
        },
        required: ["title", "description", "severity", "issueType", "file", "line"],
      },
    },
    duplicates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          findingIdx: { type: "number", description: "Index into the findings array" },
          existingIssueId: { type: "string", description: "Task ID of the existing issue this duplicates" },
          reason: { type: "string", description: "Why this is considered a duplicate" },
        },
        required: ["findingIdx", "existingIssueId", "reason"],
      },
    },
  },
  required: ["newIssues", "duplicates"],
}

// =============================================================================
// Helpers
// =============================================================================

function composeScanPrompt(task: string, scan: string): string {
  return `## Context
${task}

## Your Mission
${scan}

## Instructions
Explore the codebase thoroughly using Read, Glob, and Grep.
Look for real issues — not style nits. Focus on bugs, logic errors,
missing error handling, security vulnerabilities, and structural problems.

Return your findings as structured JSON. Only report issues you are
confident about after reading the actual code.`
}

function composeDedupPrompt(findings: readonly Finding[], existingIssues: Array<{ id: string; title: string; description: string; severity: string; file: string; line: number }>): string {
  return `## Task
Compare these new findings against known issues. Return only genuinely new issues.

## New Findings (${findings.length} total)
${JSON.stringify(findings, null, 2)}

## Known Issues (${existingIssues.length} total)
${JSON.stringify(existingIssues, null, 2)}

## Instructions
For each new finding, check if it describes the same problem as any known issue.
Use semantic understanding — the same issue might be worded differently or reference
a slightly different line number in the same file. Be conservative: if in doubt,
treat it as new rather than duplicate.

Return your analysis as structured JSON.`
}

function composeFixPrompt(issues: readonly Finding[]): string {
  const issuesSummary = issues
    .map(
      (i, idx) =>
        `${idx + 1}. [${i.severity.toUpperCase()}] ${i.title} (${i.file}:${i.line})\n   ${i.description}`
    )
    .join("\n\n")
  return `## Task
Fix these ${issues.length} issues found in the codebase:

${issuesSummary}

## Instructions
Work through the issues above. For each one:
1. Read the relevant file to understand context
2. Make the minimal fix needed
3. Move to the next issue

Focus on correctness. Skip issues you're not confident about fixing safely.`
}

function resolvePrompt(value: string): string {
  const filePath = resolve(value)
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    return readFileSync(filePath, "utf-8").trim()
  }
  return value
}

function generateId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString("hex")}`
}

// =============================================================================
// Transcript Logging
// =============================================================================

const LOGS_DIR = resolve(".tx", "logs")

function ensureLogsDir(): void {
  mkdirSync(LOGS_DIR, { recursive: true })
}

function logPath(runId: string): string {
  return resolve(LOGS_DIR, `${runId}.jsonl`)
}

function writeTranscriptLine(runId: string, message: unknown): void {
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

function writeOrchestratorLog(runId: string, text: string): void {
  writeTranscriptLine(runId, {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
    },
    timestamp: new Date().toISOString(),
  })
}

// =============================================================================
// DB Row Types
// =============================================================================

interface ExistingIssueRow {
  id: string
  title: string
  description: string
  metadata: string
}

interface IssueMapEntry {
  id: string
  title: string
  description: string
  severity: string
  file: string
  line: number
}

// =============================================================================
// Service Definition
// =============================================================================

/**
 * CycleScanService orchestrates cycle-based issue discovery.
 */
export class CycleScanService extends Context.Tag("CycleScanService")<
  CycleScanService,
  {
    readonly computeLoss: (findings: readonly Finding[]) => number
    readonly runCycles: (
      config: CycleConfig,
      onProgress?: (event: CycleProgressEvent) => void
    ) => Effect.Effect<CycleResult[], CycleScanError>
  }
>() {}

// =============================================================================
// Live Implementation
// =============================================================================

/**
 * Live implementation of CycleScanService.
 * Depends on AgentService for sub-agent dispatch and SqliteClient for DB ops.
 */
export const CycleScanServiceLive = Layer.effect(
  CycleScanService,
  Effect.gen(function* () {
    const agentService = yield* AgentService
    const sqliteClient = yield* SqliteClient

    const computeLoss = (findings: readonly Finding[]): number => {
      let loss = 0
      for (const f of findings) {
        loss += LOSS_WEIGHTS[f.severity] ?? 1
      }
      return loss
    }

    const countBySeverity = (findings: readonly Finding[]): { high: number; medium: number; low: number } => {
      let high = 0,
        medium = 0,
        low = 0
      for (const f of findings) {
        if (f.severity === "high") high++
        else if (f.severity === "medium") medium++
        else low++
      }
      return { high, medium, low }
    }

    // DB helpers
    const db = sqliteClient

    const dbCreateRun = (agent: string): string => {
      const id = generateId("run")
      const now = new Date().toISOString()
      const transcriptPath = logPath(id)
      db.prepare(
        `INSERT INTO runs (id, agent, started_at, status, metadata, transcript_path)
         VALUES (?, ?, ?, 'running', '{}', ?)`
      ).run(id, agent, now, transcriptPath)
      return id
    }

    const dbUpdateRun = (runId: string, updates: { status?: string; summary?: string; errorMessage?: string }): void => {
      const sets: string[] = []
      const params: (string | number)[] = []
      if (updates.status) {
        sets.push("status = ?")
        params.push(updates.status)
        if (updates.status === "completed" || updates.status === "failed") {
          sets.push("ended_at = datetime('now')")
        }
      }
      if (updates.summary) {
        sets.push("summary = ?")
        params.push(updates.summary)
      }
      if (updates.errorMessage) {
        sets.push("error_message = ?")
        params.push(updates.errorMessage)
      }
      if (sets.length > 0) {
        params.push(runId)
        db.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(...params)
      }
    }

    const dbUpdateRunMetadata = (runId: string, metadata: Record<string, unknown>): void => {
      db.prepare(`UPDATE runs SET metadata = ? WHERE id = ?`).run(JSON.stringify(metadata), runId)
    }

    const dbCreateTask = (data: { title: string; description: string; score: number; metadata: Record<string, unknown> }): string => {
      const id = generateId("tx")
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
         VALUES (?, ?, ?, 'backlog', NULL, ?, ?, ?, NULL, ?)`
      ).run(id, data.title, data.description, data.score, now, now, JSON.stringify(data.metadata))
      return id
    }

    const emitMetric = (runId: string, metricName: string, metadata: Record<string, unknown>): void => {
      db.prepare(
        `INSERT INTO events (timestamp, event_type, run_id, content, metadata)
         VALUES (datetime('now'), 'metric', ?, ?, ?)`
      ).run(runId, metricName, JSON.stringify(metadata))
    }

    // Agent dispatch helpers
    const runScanAgent = (task: string, scan: string, agentModel: string, runId: string) =>
      Effect.gen(function* () {
        const prompt = composeScanPrompt(task, scan)
        const config = {
          prompt,
          options: {
            tools: ["Read", "Glob", "Grep"] as readonly string[],
            permissionMode: "bypassPermissions",
            allowDangerouslySkipPermissions: true,
            model: agentModel,
            maxTurns: 20,
            persistSession: false,
            outputFormat: { type: "json_schema", schema: FINDINGS_SCHEMA },
          },
        }
        const result = yield* agentService
          .run(config, (msg) => {
            writeTranscriptLine(runId, { ...msg as Record<string, unknown>, timestamp: new Date().toISOString() })
          })
          .pipe(
            Effect.mapError(
              (e) => new CycleScanError({ phase: "scan", reason: e.reason, cause: e })
            )
          )
        // Try structured output first, then parse text
        const output = result.structuredOutput as { findings?: Finding[] } | null
        if (output?.findings) {
          return output.findings
        }
        try {
          const parsed = JSON.parse(result.text) as { findings?: Finding[] }
          return parsed.findings ?? []
        } catch {
          return [] as Finding[]
        }
      })

    const runDedupAgent = (findings: readonly Finding[], issuesMap: Map<string, IssueMapEntry>, agentModel: string, runId: string) =>
      Effect.gen(function* () {
        if (issuesMap.size === 0) {
          return { newIssues: findings, duplicates: [] } as DedupResult
        }
        if (findings.length === 0) {
          return { newIssues: [], duplicates: [] } as DedupResult
        }
        const existingIssues = Array.from(issuesMap.entries()).map(([id, issue]) => ({
          id,
          title: issue.title,
          description: issue.description,
          severity: issue.severity,
          file: issue.file,
          line: issue.line,
        }))
        const prompt = composeDedupPrompt(findings, existingIssues)
        const config = {
          prompt,
          options: {
            tools: [] as readonly string[],
            model: agentModel,
            maxTurns: 1,
            persistSession: false,
            outputFormat: { type: "json_schema", schema: DEDUP_SCHEMA },
          },
        }
        const result = yield* agentService
          .run(config, (msg) => {
            writeTranscriptLine(runId, { ...msg as Record<string, unknown>, timestamp: new Date().toISOString() })
          })
          .pipe(
            Effect.mapError(
              (e) => new CycleScanError({ phase: "dedup", reason: e.reason, cause: e })
            )
          )
        const output = result.structuredOutput as DedupResult | null
        if (output?.newIssues) {
          return output
        }
        try {
          return JSON.parse(result.text) as DedupResult
        } catch {
          return { newIssues: findings, duplicates: [] } as DedupResult
        }
      })

    const runFixAgent = (issues: readonly Finding[], agentModel: string, runId: string) =>
      Effect.gen(function* () {
        const prompt = composeFixPrompt(issues)
        const config = {
          prompt,
          options: {
            tools: ["Read", "Edit", "Write", "Bash", "Glob", "Grep"] as readonly string[],
            permissionMode: "acceptEdits",
            model: agentModel,
            maxTurns: 50,
            persistSession: false,
          },
        }
        yield* agentService
          .run(config, (msg) => {
            writeTranscriptLine(runId, { ...msg as Record<string, unknown>, timestamp: new Date().toISOString() })
          })
          .pipe(
            Effect.mapError(
              (e) => new CycleScanError({ phase: "fix", reason: e.reason, cause: e })
            )
          )
      })

    return {
      computeLoss,

      runCycles: (config, onProgress) =>
        Effect.gen(function* () {
          ensureLogsDir()
          const taskPrompt = resolvePrompt(config.taskPrompt)
          const scanPrompt = config.scanPrompt
            ? resolvePrompt(config.scanPrompt)
            : "Find bugs, anti-patterns, missing error handling, security vulnerabilities, and untested code paths."
          const cycleCount = config.cycles ?? 1
          const maxRounds = config.maxRounds ?? 10
          const agentCount = config.agents ?? 3
          const model = config.model ?? "claude-opus-4-6"
          const scanOnly = config.scanOnly ?? false
          const dryRun = config.dryRun ?? false
          const doFix = (config.fix ?? false) && !scanOnly && !dryRun
          const effectiveMaxRounds = scanOnly || (!doFix && !dryRun) ? 1 : maxRounds
          const baseScore = config.score ?? 500
          const cycleName = config.name ?? taskPrompt.slice(0, 60).replace(/\n/g, " ")
          const cycleDescription = config.description ?? scanPrompt.slice(0, 200).replace(/\n/g, " ")

          const results: CycleResult[] = []

          // Query max existing cycle number for globally unique numbering
          const maxCycleRow = db
            .prepare(
              `SELECT MAX(CAST(json_extract(metadata, '$.cycle') AS INTEGER)) as maxCycle
               FROM runs WHERE agent = 'cycle-scanner'`
            )
            .get() as { maxCycle: number | null } | undefined
          const cycleOffset = maxCycleRow?.maxCycle ?? 0

          for (let i = 1; i <= cycleCount; i++) {
            const cycle = cycleOffset + i
            onProgress?.({ type: "cycle_start", cycle, totalCycles: cycleCount, name: cycleName })

            // Create cycle group run
            const cycleRunId = dbCreateRun("cycle-scanner")
            dbUpdateRunMetadata(cycleRunId, { type: "cycle", cycle, name: cycleName, description: cycleDescription })
            writeOrchestratorLog(
              cycleRunId,
              `Starting cycle ${cycle}/${cycleCount}: "${cycleName}" with ${agentCount} agents, model: ${model}`
            )

            // Load existing issues for this cycle
            const issuesMap = new Map<string, IssueMapEntry>()
            const existingRows = db
              .prepare(
                `SELECT id, title, description, metadata FROM tasks
                 WHERE json_extract(metadata, '$.foundByScan') = 1
                   AND json_extract(metadata, '$.cycleId') = ?`
              )
              .all(cycleRunId) as ExistingIssueRow[]
            for (const row of existingRows) {
              const meta = JSON.parse(row.metadata || "{}") as Record<string, unknown>
              issuesMap.set(row.id, {
                id: row.id,
                title: row.title,
                description: row.description,
                severity: (meta.severity as string) ?? "low",
                file: (meta.file as string) ?? "",
                line: (meta.line as number) ?? 0,
              })
            }

            let totalNewIssues = 0
            let finalLoss = 0
            let converged = false
            let roundCount = 0

            for (let round = 1; round <= effectiveMaxRounds; round++) {
              roundCount = round

              // SCAN PHASE — N agents in parallel
              writeOrchestratorLog(cycleRunId, `Round ${round}: Dispatching ${agentCount} scan agents...`)
              const scanStart = Date.now()
              const scanEffects = Array.from({ length: agentCount }, (_, i) =>
                Effect.gen(function* () {
                  const scanRunId = dbCreateRun(`scan-agent-${i + 1}`)
                  dbUpdateRunMetadata(scanRunId, { type: "scan", cycle, round, cycleRunId })
                  const findings = yield* runScanAgent(taskPrompt, scanPrompt, model, scanRunId).pipe(
                    Effect.tap(() => Effect.sync(() => dbUpdateRun(scanRunId, { status: "completed" }))),
                    Effect.tapError(() => Effect.sync(() => dbUpdateRun(scanRunId, { status: "failed" }))),
                    Effect.catchAll(() => Effect.succeed([] as Finding[]))
                  )
                  return findings
                })
              )
              const scanResults = yield* Effect.all(scanEffects, { concurrency: agentCount })
              const allFindings = scanResults.flat()
              const scanDuration = Date.now() - scanStart

              writeOrchestratorLog(
                cycleRunId,
                `Round ${round}: Scan complete — ${allFindings.length} findings in ${(scanDuration / 1000).toFixed(1)}s`
              )
              onProgress?.({ type: "scan_complete", cycle, round, findings: allFindings.length, durationMs: scanDuration })

              if (allFindings.length === 0) {
                writeOrchestratorLog(cycleRunId, `Round ${round}: No findings — converged!`)
                emitMetric(cycleRunId, "cycle.round.loss", {
                  metric: "cycle.round.loss",
                  cycleId: cycleRunId,
                  cycle,
                  round,
                  loss: 0,
                  newIssues: 0,
                  existingIssues: issuesMap.size,
                  duplicates: 0,
                  high: 0,
                  medium: 0,
                  low: 0,
                })
                onProgress?.({ type: "converged", cycle, round })
                converged = true
                break
              }

              // DEDUP PHASE
              const dedupRunId = dbCreateRun("dedup-agent")
              dbUpdateRunMetadata(dedupRunId, { type: "dedup", cycle, round, cycleRunId })
              const dedupResult = yield* runDedupAgent(allFindings, issuesMap, model, dedupRunId).pipe(
                Effect.tap(() => Effect.sync(() => dbUpdateRun(dedupRunId, { status: "completed" }))),
                Effect.tapError(() => Effect.sync(() => dbUpdateRun(dedupRunId, { status: "failed" }))),
                Effect.catchAll(() => Effect.succeed({ newIssues: allFindings, duplicates: [] } as DedupResult))
              )

              writeOrchestratorLog(
                cycleRunId,
                `Round ${round}: Dedup complete — ${dedupResult.newIssues.length} new, ${dedupResult.duplicates.length} duplicates`
              )
              onProgress?.({
                type: "dedup_complete",
                cycle,
                round,
                newIssues: dedupResult.newIssues.length,
                duplicates: dedupResult.duplicates.length,
              })

              // CREATE TASKS for new issues
              if (!dryRun && dedupResult.newIssues.length > 0) {
                for (const issue of dedupResult.newIssues) {
                  const taskId = dbCreateTask({
                    title: `${issue.severity.toUpperCase()}: ${issue.title}`,
                    description: issue.description,
                    score: baseScore,
                    metadata: {
                      foundByScan: true,
                      cycleId: cycleRunId,
                      cycle,
                      round,
                      severity: issue.severity,
                      issueType: issue.issueType,
                      file: issue.file,
                      line: issue.line,
                    },
                  })
                  issuesMap.set(taskId, {
                    id: taskId,
                    title: issue.title,
                    description: issue.description,
                    severity: issue.severity,
                    file: issue.file,
                    line: issue.line,
                  })
                }
              } else if (dryRun && dedupResult.newIssues.length > 0) {
                // Still add to in-memory map for dedup in subsequent rounds
                for (const issue of dedupResult.newIssues) {
                  const fakeId = `dry-${cycle}-${round}-${issuesMap.size}`
                  issuesMap.set(fakeId, {
                    id: fakeId,
                    title: issue.title,
                    description: issue.description,
                    severity: issue.severity,
                    file: issue.file,
                    line: issue.line,
                  })
                }
              }

              totalNewIssues += dedupResult.newIssues.length

              // COMPUTE ROUND LOSS
              const { high, medium, low } = countBySeverity(dedupResult.newIssues)
              const loss = computeLoss(dedupResult.newIssues)
              finalLoss = loss

              writeOrchestratorLog(
                cycleRunId,
                `Round ${round}: Loss = ${loss} (${high}H x3 + ${medium}M x2 + ${low}L x1)`
              )
              onProgress?.({ type: "round_loss", cycle, round, loss, high, medium, low })

              // FIX PHASE
              if (doFix && dedupResult.newIssues.length > 0) {
                const fixRunId = dbCreateRun("fix-agent")
                dbUpdateRunMetadata(fixRunId, { type: "fix", cycle, round, cycleRunId })
                yield* runFixAgent(dedupResult.newIssues, model, fixRunId).pipe(
                  Effect.tap(() => Effect.sync(() => dbUpdateRun(fixRunId, { status: "completed" }))),
                  Effect.tapError(() => Effect.sync(() => dbUpdateRun(fixRunId, { status: "failed" }))),
                  Effect.catchAll(() => Effect.void)
                )
              }

              // EMIT ROUND METRICS
              emitMetric(cycleRunId, "cycle.round.loss", {
                metric: "cycle.round.loss",
                cycleId: cycleRunId,
                cycle,
                round,
                loss,
                newIssues: dedupResult.newIssues.length,
                existingIssues: issuesMap.size,
                duplicates: dedupResult.duplicates.length,
                high,
                medium,
                low,
              })

              // CHECK CONVERGENCE
              if (dedupResult.newIssues.length === 0) {
                converged = true
                break
              }
            }

            // EMIT CYCLE-LEVEL METRIC
            emitMetric(cycleRunId, "cycle.complete", {
              metric: "cycle.complete",
              cycleId: cycleRunId,
              cycle,
              name: cycleName,
              description: cycleDescription,
              rounds: roundCount,
              totalNewIssues,
              existingIssues: issuesMap.size,
              finalLoss,
              converged,
            })

            // UPDATE CYCLE RUN
            dbUpdateRun(cycleRunId, {
              status: "completed",
              summary: `Cycle ${cycle}: ${roundCount} rounds, ${totalNewIssues} new issues, loss ${finalLoss}${converged ? " (converged)" : ""}`,
            })
            dbUpdateRunMetadata(cycleRunId, {
              type: "cycle",
              cycle,
              name: cycleName,
              description: cycleDescription,
              rounds: roundCount,
              totalNewIssues,
              existingIssues: issuesMap.size,
              finalLoss,
              converged,
            })

            writeOrchestratorLog(
              cycleRunId,
              `Cycle ${cycle} complete: ${roundCount} rounds, ${totalNewIssues} new issues, final loss ${finalLoss}${converged ? " — CONVERGED" : ""}`
            )

            const cycleResult: CycleResult = {
              cycleRunId,
              cycle,
              name: cycleName,
              description: cycleDescription,
              rounds: roundCount,
              totalNewIssues,
              existingIssues: issuesMap.size,
              finalLoss,
              converged,
            }
            onProgress?.({ type: "cycle_complete", result: cycleResult })
            results.push(cycleResult)
          }

          return results
        }).pipe(
          Effect.catchAllDefect((defect) =>
            Effect.fail(
              new CycleScanError({
                phase: "unknown",
                reason: `Unexpected defect: ${defect instanceof Error ? defect.message : String(defect)}`,
                cause: defect,
              })
            )
          )
        ),
    }
  })
)
