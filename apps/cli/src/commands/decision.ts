/**
 * Decision commands: decision add, decision list, decision show,
 * decision approve, decision reject, decision edit, decision pending
 */

import { Effect } from "effect"
import { DecisionService } from "@jamesaphoenix/tx-core"
import {
  isValidDecisionStatus,
  isValidDecisionSource,
  DECISION_STATUSES,
  DECISION_SOURCES,
} from "@jamesaphoenix/tx-types"
import type { Decision } from "@jamesaphoenix/tx-types"
import { toJson } from "../output.js"
import { type Flags, flag, opt, parseIntOpt } from "../utils/parse.js"
import { CliExitError } from "../cli-exit.js"

const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max) + "..." : s

const formatDecisionLine = (d: Decision): string => {
  const status = d.status.toUpperCase().padEnd(10)
  const source = d.source.padEnd(10)
  const content = truncate(d.content.replace(/\n/g, " "), 80)
  return `  ${d.id}  ${status}  ${source}  ${content}`
}

const formatDecisionDetail = (d: Decision): string => {
  const lines = [
    `Decision: ${d.id}`,
    `  Status: ${d.status}`,
    `  Source: ${d.source}`,
    `  Content: ${d.content}`,
  ]
  if (d.question) lines.push(`  Question: ${d.question}`)
  if (d.taskId) lines.push(`  Task: ${d.taskId}`)
  if (d.docId != null) lines.push(`  Doc: ${d.docId}`)
  if (d.commitSha) lines.push(`  Commit: ${d.commitSha}`)
  if (d.reviewedBy) lines.push(`  Reviewed by: ${d.reviewedBy}`)
  if (d.reviewNote) lines.push(`  Review note: ${d.reviewNote}`)
  if (d.editedContent) lines.push(`  Edited content: ${d.editedContent}`)
  if (d.reviewedAt) lines.push(`  Reviewed at: ${d.reviewedAt.toISOString()}`)
  if (d.supersededBy) lines.push(`  Superseded by: ${d.supersededBy}`)
  lines.push(`  Synced to doc: ${d.syncedToDoc ? "yes" : "no"}`)
  lines.push(`  Created: ${d.createdAt.toISOString()}`)
  lines.push(`  Updated: ${d.updatedAt.toISOString()}`)
  return lines.join("\n")
}

/** Dispatch decision subcommands. */
export const decision = (pos: string[], flags: Flags): Effect.Effect<void, unknown, unknown> => {
  const sub = pos[0]
  const rest = pos.slice(1)

  switch (sub) {
    case "add": return decisionAdd(rest, flags)
    case "list": return decisionList(rest, flags)
    case "show": return decisionShow(rest, flags)
    case "approve": return decisionApprove(rest, flags)
    case "reject": return decisionReject(rest, flags)
    case "edit": return decisionEdit(rest, flags)
    case "pending": return decisionPending(rest, flags)
    default:
      if (!sub) return decisionList([], flags)
      console.error(`Unknown decision subcommand: ${sub}`)
      console.error("Run 'tx decision --help' for usage information")
      return Effect.fail(new CliExitError(1))
  }
}

const decisionAdd = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const content = pos.join(" ").trim()
    if (!content) {
      console.error("Usage: tx decision add <content> [--question <q>] [--task <id>] [--doc <id>] [--commit <sha>] [--json]")
      throw new CliExitError(1)
    }

    const question = opt(flags, "question") ?? null
    const taskId = opt(flags, "task") ?? null
    const docId = parseIntOpt(flags, "doc", "doc") ?? null
    const commitSha = opt(flags, "commit") ?? null
    const sourceRaw = opt(flags, "source")

    if (sourceRaw && !isValidDecisionSource(sourceRaw)) {
      console.error(`Invalid --source: "${sourceRaw}". Expected one of: ${DECISION_SOURCES.join(", ")}`)
      throw new CliExitError(1)
    }

    const svc = yield* DecisionService
    const result = yield* svc.add({
      content,
      question,
      source: (sourceRaw as "manual" | "diff" | "transcript" | "agent") ?? "manual",
      taskId,
      docId,
      commitSha,
    })

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(`Created decision: ${result.id}`)
      console.log(`  Status: ${result.status}`)
      console.log(`  Content: ${truncate(result.content, 80)}`)
    }
  })

const decisionList = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const statusRaw = opt(flags, "status")
    const sourceRaw = opt(flags, "source")
    const limit = parseIntOpt(flags, "limit", "limit") ?? undefined

    if (statusRaw && !isValidDecisionStatus(statusRaw)) {
      console.error(`Invalid --status: "${statusRaw}". Expected one of: ${DECISION_STATUSES.join(", ")}`)
      throw new CliExitError(1)
    }
    if (sourceRaw && !isValidDecisionSource(sourceRaw)) {
      console.error(`Invalid --source: "${sourceRaw}". Expected one of: ${DECISION_SOURCES.join(", ")}`)
      throw new CliExitError(1)
    }

    const svc = yield* DecisionService
    const decisions = yield* svc.list({
      status: statusRaw,
      source: sourceRaw,
      limit,
    })

    if (flag(flags, "json")) {
      console.log(toJson(decisions))
      return
    }

    if (decisions.length === 0) {
      console.log("No decisions found")
      return
    }

    console.log(`${decisions.length} decision(s):`)
    for (const d of decisions) {
      console.log(formatDecisionLine(d))
    }
  })

const decisionShow = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx decision show <id> [--json]")
      throw new CliExitError(1)
    }

    const svc = yield* DecisionService
    const result = yield* svc.show(id)

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(formatDecisionDetail(result))
    }
  })

const decisionApprove = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx decision approve <id> [--reviewer <name>] [--note <text>] [--json]")
      throw new CliExitError(1)
    }

    const reviewer = opt(flags, "reviewer")
    const note = opt(flags, "note")

    const svc = yield* DecisionService
    const result = yield* svc.approve(id, reviewer, note)

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(`Approved: ${result.id}`)
      if (reviewer) console.log(`  Reviewer: ${reviewer}`)
      if (note) console.log(`  Note: ${note}`)
    }
  })

const decisionReject = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    if (!id) {
      console.error("Usage: tx decision reject <id> --reason <text> [--reviewer <name>] [--json]")
      throw new CliExitError(1)
    }

    const reason = opt(flags, "reason")
    if (!reason) {
      console.error("--reason is required for rejection")
      throw new CliExitError(1)
    }

    const reviewer = opt(flags, "reviewer")

    const svc = yield* DecisionService
    const result = yield* svc.reject(id, reviewer, reason)

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(`Rejected: ${result.id}`)
      console.log(`  Reason: ${reason}`)
      if (reviewer) console.log(`  Reviewer: ${reviewer}`)
    }
  })

const decisionEdit = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const id = pos[0]
    const content = pos.slice(1).join(" ").trim()
    if (!id || !content) {
      console.error("Usage: tx decision edit <id> <content> [--reviewer <name>] [--json]")
      throw new CliExitError(1)
    }

    const reviewer = opt(flags, "reviewer")

    const svc = yield* DecisionService
    const result = yield* svc.edit(id, content, reviewer)

    if (flag(flags, "json")) {
      console.log(toJson(result))
    } else {
      console.log(`Edited: ${result.id}`)
      console.log(`  New content: ${truncate(content, 80)}`)
      if (reviewer) console.log(`  Reviewer: ${reviewer}`)
    }
  })

const decisionPending = (_pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const svc = yield* DecisionService
    const decisions = yield* svc.pending()

    if (flag(flags, "json")) {
      console.log(toJson(decisions))
      return
    }

    if (decisions.length === 0) {
      console.log("No pending decisions")
      return
    }

    console.log(`${decisions.length} pending decision(s):`)
    for (const d of decisions) {
      console.log(formatDecisionLine(d))
    }
  })
