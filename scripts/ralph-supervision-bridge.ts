#!/usr/bin/env bun
/**
 * ralph-supervision-bridge.ts — Lightweight TypeScript bridge for ralph.sh
 *
 * Provides shell-callable subcommands that route through core Effect services
 * so ralph.sh never owns supervision SQL or domain event persistence directly.
 *
 * Usage from ralph.sh:
 *   bun scripts/ralph-supervision-bridge.ts session-create <json-args>
 *   bun scripts/ralph-supervision-bridge.ts session-update <session-id> <json-fields>
 *   bun scripts/ralph-supervision-bridge.ts session-end <session-id>
 *   bun scripts/ralph-supervision-bridge.ts session-heartbeat <session-id>
 *   bun scripts/ralph-supervision-bridge.ts publish-event <json-event>
 *   bun scripts/ralph-supervision-bridge.ts maybe-trigger <doc-ref>
 */

import { Effect } from "effect"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import {
  makeMinimalLayer,
  SupervisionRepository,
  DomainEventService,
  DocReviewService,
  type PublishDomainEventInput,
} from "@jamesaphoenix/tx"

const projectDir = resolve(import.meta.dir, "..")
const dbPath = process.env.TX_DB_PATH ?? resolve(projectDir, ".tx/tasks.db")
const layer = makeMinimalLayer(dbPath)

function generateSessionId(workerId: string): string {
  const hash = createHash("sha256")
    .update(`supervision-session:${workerId}:${Date.now()}`)
    .digest("hex")
    .substring(0, 12)
  return `ws-${hash}`
}

function nowIso(): string {
  return new Date().toISOString()
}

async function sessionCreate(argsJson: string): Promise<void> {
  const args = JSON.parse(argsJson)
  const sessionId = generateSessionId(args.workerId)
  const now = nowIso()

  const program = Effect.gen(function* () {
    const repo = yield* SupervisionRepository
    const events = yield* DomainEventService

    const session = yield* repo.createSession({
      id: sessionId,
      workerId: args.workerId,
      scopeMode: args.scopeMode ?? "all",
      scopeRef: args.scopeRef ?? null,
      orchestrator: "ralph",
      runtime: args.runtime ?? "claude",
      terminalBackend: "tmux",
      tmuxSessionName: args.tmuxSessionName ?? null,
      tmuxWindowName: args.tmuxWindowName ?? null,
      tmuxPaneId: args.tmuxPaneId ?? null,
      controlMode: "agent",
      currentTaskId: null,
      currentRunId: null,
      activeTerminalController: null,
      startedAt: now,
      lastHeartbeatAt: now,
      metadata: args.metadata ?? {},
    })

    yield* events.publish({
      eventType: "worker.session_created",
      streamType: "worker_session",
      streamId: session.id,
      aggregateType: "worker",
      aggregateId: args.workerId,
      actorType: "system",
      actorId: "ralph",
      schemaVersion: 1,
      payload: {
        sessionId: session.id,
        workerId: args.workerId,
        scopeMode: args.scopeMode ?? "all",
        scopeRef: args.scopeRef ?? null,
        runtime: args.runtime ?? "claude",
        tmuxSessionName: args.tmuxSessionName ?? null,
      },
      metadata: {},
    })

    return session.id
  }).pipe(Effect.provide(layer))

  const id = await Effect.runPromise(program)
  // Output session ID for shell to capture
  process.stdout.write(id)
}

async function sessionUpdate(sessionId: string, fieldsJson: string): Promise<void> {
  const fields = JSON.parse(fieldsJson)

  const program = Effect.gen(function* () {
    const repo = yield* SupervisionRepository
    yield* repo.updateSession(sessionId, {
      currentTaskId: fields.currentTaskId,
      currentRunId: fields.currentRunId,
      lastHeartbeatAt: nowIso(),
    })
  }).pipe(Effect.provide(layer))

  await Effect.runPromise(program)
}

async function sessionEnd(sessionId: string): Promise<void> {
  const now = nowIso()

  const program = Effect.gen(function* () {
    const repo = yield* SupervisionRepository
    const events = yield* DomainEventService

    // Get session info before ending
    const session = yield* repo.getSessionById(sessionId)
    if (!session || session.endedAt) return

    yield* repo.endSession(sessionId, now)

    yield* events.publish({
      eventType: "worker.session_ended",
      streamType: "worker_session",
      streamId: sessionId,
      aggregateType: "worker",
      aggregateId: session.workerId,
      actorType: "system",
      actorId: "ralph",
      schemaVersion: 1,
      payload: {
        sessionId,
        workerId: session.workerId,
        endedAt: now,
      },
      metadata: {},
    })
  }).pipe(Effect.provide(layer))

  await Effect.runPromise(program)
}

async function sessionHeartbeat(sessionId: string): Promise<void> {
  const program = Effect.gen(function* () {
    const repo = yield* SupervisionRepository
    yield* repo.updateHeartbeat(sessionId, nowIso())
  }).pipe(Effect.provide(layer))

  await Effect.runPromise(program)
}

async function publishEvent(eventJson: string): Promise<void> {
  const event: PublishDomainEventInput = JSON.parse(eventJson)

  const program = Effect.gen(function* () {
    const events = yield* DomainEventService
    yield* events.publish(event)
  }).pipe(Effect.provide(layer))

  await Effect.runPromise(program)
}

async function maybeTrigger(docRef: string): Promise<void> {
  const program = Effect.gen(function* () {
    const docReview = yield* DocReviewService
    const result = yield* docReview.maybeTrigger(docRef, "scope_drained")
    return result
  }).pipe(Effect.provide(layer))

  const result = await Effect.runPromise(program)
  process.stdout.write(JSON.stringify(result))
}

// =============================================================================
// CLI dispatch
// =============================================================================

const [command, ...args] = process.argv.slice(2)

try {
  switch (command) {
    case "session-create":
      await sessionCreate(args[0] ?? "{}")
      break
    case "session-update":
      await sessionUpdate(args[0], args[1] ?? "{}")
      break
    case "session-end":
      await sessionEnd(args[0])
      break
    case "session-heartbeat":
      await sessionHeartbeat(args[0])
      break
    case "publish-event":
      await publishEvent(args[0] ?? "{}")
      break
    case "maybe-trigger":
      await maybeTrigger(args[0])
      break
    default:
      console.error(`Unknown command: ${command}`)
      console.error("Usage: ralph-supervision-bridge.ts <command> [args...]")
      console.error("Commands: session-create, session-update, session-end, session-heartbeat, publish-event, maybe-trigger")
      process.exit(1)
  }
} catch (err) {
  console.error(`[supervision-bridge] ${command} failed:`, err)
  process.exit(1)
}
