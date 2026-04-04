/**
 * SupervisionService — DD-039
 *
 * Manages worker supervision sessions: listing, pause/resume, terminal tokens,
 * and attach/detach lifecycle. Enforces:
 *   INV-SUP-002 — task claims remain authoritative, never stolen by side effects
 *   INV-SUP-003 — pausing preserves live session and current claim
 *   INV-SUP-004 — at most one write-capable terminal controller per session
 *
 * Uses Effect-TS patterns per DD-002.
 */

import { Context, Effect, Layer } from "effect"
import { SupervisionRepository } from "../repo/supervision-repo.js"
import {
  DomainEventService,
  type PublishDomainEventInput,
} from "./domain-event-service.js"
import { DatabaseError } from "../errors.js"
import { generateUlid } from "../utils/ulid.js"
import type {
  WorkerSessionDetail,
  SupervisionTerminalToken,
  ActorRef,
} from "@jamesaphoenix/tx-types"
import type { DomainEventEnvelope } from "@jamesaphoenix/tx-types"

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default terminal token TTL in milliseconds (5 minutes). */
const TOKEN_TTL_MS = 5 * 60 * 1000

/** Valid transitions for pause: only agent -> human_paused. */
const PAUSABLE_MODES = ["agent"] as const

/** Valid transitions for resume: only human_paused -> agent. */
const RESUMABLE_MODES = ["human_paused"] as const

// =============================================================================
// SERVICE
// =============================================================================

export class SupervisionService extends Context.Tag("SupervisionService")<
  SupervisionService,
  {
    /**
     * List all live worker session details.
     * Delegates to SupervisionRepository.listSessionDetails.
     */
    readonly listSessions: () => Effect.Effect<
      readonly WorkerSessionDetail[],
      DatabaseError
    >

    /**
     * Get a single session detail by ID. Fails if not found.
     */
    readonly getSession: (
      sessionId: string
    ) => Effect.Effect<WorkerSessionDetail, DatabaseError>

    /**
     * List domain events for a session by stream worker_session/<id>.
     */
    readonly listSessionEvents: (
      sessionId: string
    ) => Effect.Effect<readonly DomainEventEnvelope[], DatabaseError>

    /**
     * Create a time-limited terminal token for a session.
     * For control mode: validates session is live + no existing controller (INV-SUP-004).
     * For observe mode: always allowed.
     */
    readonly createTerminalToken: (
      sessionId: string,
      viewerId: string,
      mode: "control" | "observe"
    ) => Effect.Effect<SupervisionTerminalToken, DatabaseError>

    /**
     * Pause a session. Validates state machine: only agent -> human_paused.
     * Emits worker.pause_requested then worker.paused events.
     * INV-SUP-002: claims are never stolen.
     * INV-SUP-003: pause preserves live session and current claim.
     */
    readonly pauseSession: (
      sessionId: string,
      actor: ActorRef
    ) => Effect.Effect<WorkerSessionDetail, DatabaseError>

    /**
     * Resume a paused session. Validates: only human_paused -> agent.
     * Emits worker.resumed event. Updates control_mode back to agent.
     */
    readonly resumeSession: (
      sessionId: string,
      actor: ActorRef
    ) => Effect.Effect<WorkerSessionDetail, DatabaseError>

    /**
     * Mark a viewer as attached to a session.
     * If mode=control and no existing controller, sets active_terminal_controller.
     * Emits worker.session_attached event.
     * INV-SUP-004: single write controller enforced.
     */
    readonly markAttached: (
      sessionId: string,
      viewerId: string,
      writable: boolean
    ) => Effect.Effect<void, DatabaseError>

    /**
     * Mark a viewer as detached from a session.
     * Clears active_terminal_controller if this viewer was the controller.
     * Emits worker.session_detached event.
     */
    readonly markDetached: (
      sessionId: string,
      viewerId: string
    ) => Effect.Effect<void, DatabaseError>
  }
>() {}

export const SupervisionServiceLive = Layer.effect(
  SupervisionService,
  Effect.gen(function* () {
    const repo = yield* SupervisionRepository
    const eventService = yield* DomainEventService

    // -------------------------------------------------------------------------
    // Internal: publish a domain event
    // -------------------------------------------------------------------------
    const publishEvent = (input: PublishDomainEventInput) =>
      eventService.publish(input)

    // -------------------------------------------------------------------------
    // Internal: fail with a descriptive error
    // -------------------------------------------------------------------------
    const failWith = (message: string) =>
      Effect.fail(new DatabaseError({ cause: new Error(message) }))

    return {
      // =======================================================================
      // listSessions
      // =======================================================================
      listSessions: () => repo.listSessionDetails(),

      // =======================================================================
      // getSession
      // =======================================================================
      getSession: (sessionId: string) =>
        Effect.gen(function* () {
          const detail = yield* repo.getSessionDetail(sessionId)
          if (!detail) {
            return yield* failWith(
              `Supervision session not found: ${sessionId}`
            )
          }
          return detail
        }),

      // =======================================================================
      // listSessionEvents
      // =======================================================================
      listSessionEvents: (sessionId: string) =>
        eventService.listByStream("worker_session", sessionId),

      // =======================================================================
      // createTerminalToken
      // =======================================================================
      createTerminalToken: (
        sessionId: string,
        viewerId: string,
        mode: "control" | "observe"
      ) =>
        Effect.gen(function* () {
          // Validate session exists and is live
          const session = yield* repo.getSessionById(sessionId)
          if (!session) {
            return yield* failWith(
              `Supervision session not found: ${sessionId}`
            )
          }
          if (session.endedAt !== null) {
            return yield* failWith(
              `Session ${sessionId} has ended, cannot issue terminal token`
            )
          }

          // INV-SUP-004: For control mode, check no existing controller
          if (mode === "control") {
            const existingController =
              yield* repo.resolveTerminalController(sessionId)
            if (existingController && existingController !== viewerId) {
              return yield* failWith(
                `Session ${sessionId} already has an active terminal controller: ${existingController}`
              )
            }
          }

          const now = new Date()
          const token: SupervisionTerminalToken = {
            token: generateUlid(),
            sessionId,
            viewerId,
            mode,
            issuedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(),
          }

          return token
        }),

      // =======================================================================
      // pauseSession
      // =======================================================================
      pauseSession: (sessionId: string, actor: ActorRef) =>
        Effect.gen(function* () {
          // Fetch session to validate state
          const session = yield* repo.getSessionById(sessionId)
          if (!session) {
            return yield* failWith(
              `Supervision session not found: ${sessionId}`
            )
          }

          // Validate state machine: only agent -> human_paused
          if (
            !(PAUSABLE_MODES as readonly string[]).includes(session.controlMode)
          ) {
            return yield* failWith(
              `Cannot pause session ${sessionId}: current control mode is '${session.controlMode}', must be 'agent'`
            )
          }

          // INV-SUP-002 & INV-SUP-003: Pause does NOT touch claims.
          // Only update control_mode. Claims remain authoritative.

          // Emit worker.pause_requested
          yield* publishEvent({
            eventType: "worker.pause_requested",
            streamType: "worker_session",
            streamId: sessionId,
            aggregateType: "worker",
            aggregateId: session.workerId,
            actorType: actor.type,
            actorId: actor.id,
            payload: {
              sessionId,
              workerId: session.workerId,
              requestedBy: actor.id,
            },
          })

          // Update control mode
          yield* repo.updateControlMode(sessionId, "human_paused")

          // Emit worker.paused
          yield* publishEvent({
            eventType: "worker.paused",
            streamType: "worker_session",
            streamId: sessionId,
            aggregateType: "worker",
            aggregateId: session.workerId,
            actorType: actor.type,
            actorId: actor.id,
            payload: {
              sessionId,
              workerId: session.workerId,
              currentTaskId: session.currentTaskId,
              currentRunId: session.currentRunId,
            },
          })

          // Return updated detail
          const detail = yield* repo.getSessionDetail(sessionId)
          if (!detail) {
            return yield* failWith(
              `Session detail not found after pause: ${sessionId}`
            )
          }
          return detail
        }),

      // =======================================================================
      // resumeSession
      // =======================================================================
      resumeSession: (sessionId: string, actor: ActorRef) =>
        Effect.gen(function* () {
          // Fetch session to validate state
          const session = yield* repo.getSessionById(sessionId)
          if (!session) {
            return yield* failWith(
              `Supervision session not found: ${sessionId}`
            )
          }

          // Validate state machine: only human_paused -> agent
          if (
            !(RESUMABLE_MODES as readonly string[]).includes(
              session.controlMode
            )
          ) {
            return yield* failWith(
              `Cannot resume session ${sessionId}: current control mode is '${session.controlMode}', must be 'human_paused'`
            )
          }

          // Update control mode back to agent
          yield* repo.updateControlMode(sessionId, "agent")

          // Emit worker.resumed
          yield* publishEvent({
            eventType: "worker.resumed",
            streamType: "worker_session",
            streamId: sessionId,
            aggregateType: "worker",
            aggregateId: session.workerId,
            actorType: actor.type,
            actorId: actor.id,
            payload: {
              sessionId,
              workerId: session.workerId,
              resumedBy: actor.id,
            },
          })

          // Return updated detail
          const detail = yield* repo.getSessionDetail(sessionId)
          if (!detail) {
            return yield* failWith(
              `Session detail not found after resume: ${sessionId}`
            )
          }
          return detail
        }),

      // =======================================================================
      // markAttached
      // =======================================================================
      markAttached: (
        sessionId: string,
        viewerId: string,
        writable: boolean
      ) =>
        Effect.gen(function* () {
          const session = yield* repo.getSessionById(sessionId)
          if (!session) {
            return yield* failWith(
              `Supervision session not found: ${sessionId}`
            )
          }

          // INV-SUP-004: Only set controller if writable and no existing controller
          if (writable) {
            const existingController =
              yield* repo.resolveTerminalController(sessionId)
            if (existingController && existingController !== viewerId) {
              return yield* failWith(
                `Session ${sessionId} already has an active terminal controller: ${existingController}`
              )
            }
            yield* repo.updateSession(sessionId, {
              activeTerminalController: viewerId,
            })
          }

          // Emit worker.session_attached
          yield* publishEvent({
            eventType: "worker.session_attached",
            streamType: "worker_session",
            streamId: sessionId,
            aggregateType: "worker",
            aggregateId: session.workerId,
            payload: {
              sessionId,
              viewerId,
              mode: writable ? "control" : "observe",
            },
          })
        }),

      // =======================================================================
      // markDetached
      // =======================================================================
      markDetached: (sessionId: string, viewerId: string) =>
        Effect.gen(function* () {
          const session = yield* repo.getSessionById(sessionId)
          if (!session) {
            return yield* failWith(
              `Supervision session not found: ${sessionId}`
            )
          }

          // Clear controller if this viewer was the active controller
          if (session.activeTerminalController === viewerId) {
            yield* repo.updateSession(sessionId, {
              activeTerminalController: null,
            })
          }

          // Emit worker.session_detached
          yield* publishEvent({
            eventType: "worker.session_detached",
            streamType: "worker_session",
            streamId: sessionId,
            aggregateType: "worker",
            aggregateId: session.workerId,
            payload: {
              sessionId,
              viewerId,
            },
          })
        }),
    }
  })
)
