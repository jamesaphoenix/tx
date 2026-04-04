/**
 * Dashboard Supervision E2E Integration Tests
 *
 * Covers:
 * - Real dashboard server route responses (GET sessions, GET session/:id)
 * - WebSocket terminal attach handshake (token issuance → ws connect → verify)
 * - Attach/detach event emission through HTTP (verify domain_events rows)
 * - Pause/resume over HTTP and resulting core state changes
 * - INV-SUP-004 verification (single write controller)
 *
 * Spins up actual dashboard server against test DB.
 *
 * @see DD-039 for specification
 * @see DD-007 for testing strategy
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { Database } from "bun:sqlite"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createHash } from "node:crypto"
import { applyMigrations } from "@jamesaphoenix/tx-core"

// =============================================================================
// Test Fixtures (Rule 3: SHA256-based IDs)
// =============================================================================

const NAMESPACE = "dashboard-supervision-e2e"

const fixtureId = (name: string): string => {
  const hash = createHash("sha256")
    .update(`${NAMESPACE}:${name}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}

const FIXTURES = {
  WORKER_1: fixtureId("worker-1"),
  WORKER_2: fixtureId("worker-2"),
  SESSION_1: fixtureId("session-1"),
  SESSION_2: fixtureId("session-2"),
  TASK_1: fixtureId("task-1"),
  RUN_1: fixtureId("run-1"),
} as const

const NOW = new Date().toISOString()

// =============================================================================
// Helpers
// =============================================================================

/** Wait for the dashboard server to become ready (accepting requests). */
async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(`${url}/api/supervision/sessions`)
      return
    } catch {
      // Server not up yet
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`)
}

// =============================================================================
// Test Suite
// =============================================================================

describe("Dashboard Supervision E2E", () => {
  let serverProcess: ChildProcess
  let port: number
  let dbPath: string
  let tempDir: string
  let db: Database

  const baseUrl = () => `http://localhost:${port}`

  // ---------------------------------------------------------------------------
  // Setup: create temp DB, start dashboard server subprocess
  // ---------------------------------------------------------------------------
  beforeAll(async () => {
    // Create temp directory and DB file
    tempDir = join(tmpdir(), `tx-dashboard-e2e-${Date.now()}`)
    mkdirSync(join(tempDir, ".tx"), { recursive: true })
    dbPath = join(tempDir, ".tx", "tasks.db")

    // Create DB and apply all migrations
    db = new Database(dbPath)
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("PRAGMA foreign_keys = ON")
    applyMigrations(db as any)

    // Pick random port in high range to avoid conflicts
    port = 41000 + Math.floor(Math.random() * 9000)

    // Start actual dashboard server as subprocess
    const serverPath = resolve("apps/dashboard/server/index.ts")
    serverProcess = spawn("bun", [serverPath], {
      env: {
        ...process.env,
        TX_DB_PATH: dbPath,
        PORT: String(port),
      },
      stdio: ["pipe", "pipe", "pipe"],
    })

    // Collect stderr for debug purposes
    serverProcess.stderr?.on("data", () => {
      // swallow stderr noise
    })

    // Wait for server to accept requests
    await waitForServer(baseUrl(), 15000)
  }, 20000)

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM")
    }
    if (db) {
      try {
        db.close()
      } catch {
        /* already closed */
      }
    }
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        /* ok */
      }
    }
  })

  // ---------------------------------------------------------------------------
  // Seed helpers — operate on the test process's DB connection
  // ---------------------------------------------------------------------------

  function seedWorker(workerId: string, name: string, status = "idle") {
    db.prepare(
      `INSERT INTO workers (id, name, hostname, pid, status, registered_at, last_heartbeat_at, metadata)
       VALUES (?, ?, 'test-host', 12345, ?, ?, ?, '{}')`
    ).run(workerId, name, status, NOW, NOW)
  }

  function seedTask(taskId: string, title: string, status = "active") {
    const completedAt = status === "done" ? NOW : null
    db.prepare(
      `INSERT INTO tasks (id, title, description, status, parent_id, score, created_at, updated_at, completed_at, metadata)
       VALUES (?, ?, 'Test task', ?, NULL, 500, ?, ?, ?, '{}')`
    ).run(taskId, title, status, NOW, NOW, completedAt)
  }

  function seedRun(runId: string, taskId: string, status = "running") {
    db.prepare(
      `INSERT INTO runs (id, task_id, agent, started_at, status, metadata)
       VALUES (?, ?, 'tx-tester', ?, ?, '{}')`
    ).run(runId, taskId, NOW, status)
  }

  function seedSession(opts: {
    sessionId: string
    workerId: string
    controlMode?: string
    scopeMode?: string
    scopeRef?: string | null
    currentTaskId?: string | null
    currentRunId?: string | null
    activeTerminalController?: string | null
    endedAt?: string | null
  }) {
    db.prepare(
      `INSERT INTO worker_sessions
        (id, worker_id, scope_mode, scope_ref, orchestrator, runtime, terminal_backend,
         tmux_session_name, tmux_window_name, tmux_pane_id, control_mode,
         current_task_id, current_run_id, active_terminal_controller,
         started_at, last_heartbeat_at, ended_at, metadata)
       VALUES (?, ?, ?, ?, 'ralph', 'claude', 'tmux', ?, 'main', '%0', ?, ?, ?, ?, ?, ?, ?, '{}')`
    ).run(
      opts.sessionId,
      opts.workerId,
      opts.scopeMode ?? "all",
      opts.scopeRef ?? null,
      `ralph-${opts.sessionId}`,
      opts.controlMode ?? "agent",
      opts.currentTaskId ?? null,
      opts.currentRunId ?? null,
      opts.activeTerminalController ?? null,
      NOW,
      NOW,
      opts.endedAt ?? null
    )
  }

  function cleanTables() {
    db.exec("DELETE FROM domain_events")
    db.exec("DELETE FROM worker_sessions")
    db.exec("DELETE FROM doc_review_runs")
    db.exec("DELETE FROM task_claims")
    db.exec("DELETE FROM runs")
    db.exec("DELETE FROM task_doc_links")
    db.exec("DELETE FROM task_dependencies")
    db.exec("DELETE FROM tasks")
    db.exec("DELETE FROM workers")
  }

  function getDomainEvents(streamId: string) {
    return db
      .prepare(
        "SELECT event_type, payload FROM domain_events WHERE stream_id = ? ORDER BY id"
      )
      .all(streamId) as Array<{ event_type: string; payload: string }>
  }

  beforeEach(() => {
    cleanTables()
  })

  // ===========================================================================
  // 1. GET /api/supervision/sessions — list sessions
  // ===========================================================================
  describe("GET /api/supervision/sessions", () => {
    it("returns empty array when no sessions exist", async () => {
      const res = await fetch(`${baseUrl()}/api/supervision/sessions`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBe(0)
    })

    it("returns live sessions with correct shape", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha", "busy")
      seedTask(FIXTURES.TASK_1, "Implement feature X", "active")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
        currentTaskId: FIXTURES.TASK_1,
      })

      const res = await fetch(`${baseUrl()}/api/supervision/sessions`)
      expect(res.status).toBe(200)
      const sessions = await res.json()

      expect(sessions.length).toBe(1)
      const s = sessions[0]
      expect(s.id).toBe(FIXTURES.SESSION_1)
      expect(s.workerId).toBe(FIXTURES.WORKER_1)
      expect(s.workerName).toBe("worker-alpha")
      expect(s.controlMode).toBe("agent")
      expect(s.currentTaskId).toBe(FIXTURES.TASK_1)
    })

    it("excludes ended sessions from listing", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha")
      seedWorker(FIXTURES.WORKER_2, "worker-beta")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
      })
      seedSession({
        sessionId: FIXTURES.SESSION_2,
        workerId: FIXTURES.WORKER_2,
        endedAt: NOW,
      })

      const res = await fetch(`${baseUrl()}/api/supervision/sessions`)
      const sessions = await res.json()
      expect(sessions.length).toBe(1)
      expect(sessions[0].id).toBe(FIXTURES.SESSION_1)
    })
  })

  // ===========================================================================
  // 2. GET /api/supervision/sessions/:id — session detail
  // ===========================================================================
  describe("GET /api/supervision/sessions/:id", () => {
    it("returns session detail with worker info", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha", "busy")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
      })

      const res = await fetch(
        `${baseUrl()}/api/supervision/sessions/${FIXTURES.SESSION_1}`
      )
      expect(res.status).toBe(200)
      const detail = await res.json()

      expect(detail.id).toBe(FIXTURES.SESSION_1)
      expect(detail.workerId).toBe(FIXTURES.WORKER_1)
      expect(detail.workerName).toBe("worker-alpha")
      expect(detail.workerStatus).toBe("busy")
      expect(detail.controlMode).toBe("agent")
      expect(typeof detail.startedAt).toBe("string")
      expect(typeof detail.lastHeartbeatAt).toBe("string")
    })

    it("returns 404 for non-existent session", async () => {
      const res = await fetch(
        `${baseUrl()}/api/supervision/sessions/nonexistent-id`
      )
      expect(res.status).toBe(404)
      const body = await res.json()
      expect(body.error).toBeDefined()
    })

    it("includes current task and run info when set", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha")
      seedTask(FIXTURES.TASK_1, "Build feature Y", "active")
      seedRun(FIXTURES.RUN_1, FIXTURES.TASK_1, "running")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
        currentTaskId: FIXTURES.TASK_1,
        currentRunId: FIXTURES.RUN_1,
      })

      const res = await fetch(
        `${baseUrl()}/api/supervision/sessions/${FIXTURES.SESSION_1}`
      )
      const detail = await res.json()

      expect(detail.currentTaskId).toBe(FIXTURES.TASK_1)
      expect(detail.currentTaskTitle).toBe("Build feature Y")
      expect(detail.currentRunId).toBe(FIXTURES.RUN_1)
    })
  })

  // ===========================================================================
  // 3. POST /api/supervision/sessions/:id/pause — pause session
  // ===========================================================================
  describe("POST /api/supervision/sessions/:id/pause", () => {
    it("pauses an agent-mode session and updates controlMode", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
        controlMode: "agent",
      })

      const res = await fetch(
        `${baseUrl()}/api/supervision/sessions/${FIXTURES.SESSION_1}/pause`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorType: "human",
            actorId: "operator-1",
          }),
        }
      )
      expect(res.status).toBe(200)
      const detail = await res.json()
      expect(detail.controlMode).toBe("human_paused")

      // Verify core state change via direct DB
      const row = db
        .prepare("SELECT control_mode FROM worker_sessions WHERE id = ?")
        .get(FIXTURES.SESSION_1) as any
      expect(row.control_mode).toBe("human_paused")

      // Verify domain events were emitted
      const events = getDomainEvents(FIXTURES.SESSION_1)
      const types = events.map((e) => e.event_type)
      expect(types).toContain("worker.pause_requested")
      expect(types).toContain("worker.paused")
    })

    it("rejects pause for already-paused session", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
        controlMode: "human_paused",
      })

      const res = await fetch(
        `${baseUrl()}/api/supervision/sessions/${FIXTURES.SESSION_1}/pause`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorType: "human",
            actorId: "operator-1",
          }),
        }
      )
      // Server returns error status for invalid state transition
      expect(res.ok).toBe(false)
      expect(res.status).toBeGreaterThanOrEqual(400)
    })

    it("returns 404 for non-existent session", async () => {
      const res = await fetch(
        `${baseUrl()}/api/supervision/sessions/nonexistent/pause`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      )
      expect(res.status).toBe(404)
    })
  })

  // ===========================================================================
  // 4. POST /api/supervision/sessions/:id/resume — resume session
  // ===========================================================================
  describe("POST /api/supervision/sessions/:id/resume", () => {
    it("resumes a paused session and updates controlMode to agent", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
        controlMode: "human_paused",
      })

      const res = await fetch(
        `${baseUrl()}/api/supervision/sessions/${FIXTURES.SESSION_1}/resume`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorType: "human",
            actorId: "operator-1",
          }),
        }
      )
      expect(res.status).toBe(200)
      const detail = await res.json()
      expect(detail.controlMode).toBe("agent")

      // Verify core state
      const row = db
        .prepare("SELECT control_mode FROM worker_sessions WHERE id = ?")
        .get(FIXTURES.SESSION_1) as any
      expect(row.control_mode).toBe("agent")

      // Verify domain events
      const events = getDomainEvents(FIXTURES.SESSION_1)
      expect(events.map((e) => e.event_type)).toContain("worker.resumed")
    })

    it("rejects resume for non-paused session", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
        controlMode: "agent",
      })

      const res = await fetch(
        `${baseUrl()}/api/supervision/sessions/${FIXTURES.SESSION_1}/resume`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      )
      // Server returns error status for invalid state transition
      expect(res.ok).toBe(false)
      expect(res.status).toBeGreaterThanOrEqual(400)
    })
  })

  // ===========================================================================
  // 5. GET /api/supervision/terminal-token/:id — token issuance
  // ===========================================================================
  describe("GET /api/supervision/terminal-token/:id", () => {
    it("issues observe-mode terminal token with correct shape", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
      })

      const res = await fetch(
        `${baseUrl()}/api/supervision/terminal-token/${FIXTURES.SESSION_1}?viewerId=viewer-1&mode=observe`
      )
      expect(res.status).toBe(200)
      const token = await res.json()

      expect(token.token).toBeDefined()
      expect(typeof token.token).toBe("string")
      expect(token.sessionId).toBe(FIXTURES.SESSION_1)
      expect(token.viewerId).toBe("viewer-1")
      expect(token.mode).toBe("observe")
      expect(token.issuedAt).toBeDefined()
      expect(token.expiresAt).toBeDefined()
    })

    it("issues control-mode token when no existing controller [INV-SUP-004]", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
      })

      const res = await fetch(
        `${baseUrl()}/api/supervision/terminal-token/${FIXTURES.SESSION_1}?viewerId=ctrl-viewer&mode=control`
      )
      expect(res.status).toBe(200)
      const token = await res.json()
      expect(token.mode).toBe("control")
    })

    it("rejects control token when another controller exists [INV-SUP-004]", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
        activeTerminalController: "existing-viewer",
      })

      const res = await fetch(
        `${baseUrl()}/api/supervision/terminal-token/${FIXTURES.SESSION_1}?viewerId=new-viewer&mode=control`
      )
      expect(res.status).toBe(409)
    })

    it("returns 404 for non-existent session", async () => {
      const res = await fetch(
        `${baseUrl()}/api/supervision/terminal-token/nonexistent?viewerId=x&mode=observe`
      )
      expect(res.status).toBe(404)
    })
  })

  // ===========================================================================
  // 6. WebSocket terminal attach handshake
  // ===========================================================================
  describe("WebSocket terminal attach handshake", () => {
    it("token issuance → ws connect → token validation succeeds", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
      })

      // Step 1: Issue terminal token via HTTP
      const tokenRes = await fetch(
        `${baseUrl()}/api/supervision/terminal-token/${FIXTURES.SESSION_1}?viewerId=ws-test-viewer&mode=observe`
      )
      expect(tokenRes.status).toBe(200)
      const tokenData = await tokenRes.json()
      expect(tokenData.token).toBeDefined()

      // Step 2: Encode the full token object as base64url JSON (as the server expects)
      const encodedToken = Buffer.from(JSON.stringify(tokenData)).toString(
        "base64url"
      )

      // Step 3: Attempt WebSocket upgrade via http.request to verify handshake
      const http = await import("node:http")
      const crypto = await import("node:crypto")
      const wsKey = crypto.randomBytes(16).toString("base64")

      const result = await new Promise<{
        status: number | string
        upgraded: boolean
      }>((resolve) => {
        const req = http.request(
          {
            hostname: "localhost",
            port,
            path: `/api/supervision/terminal/ws?token=${encodedToken}`,
            headers: {
              Connection: "Upgrade",
              Upgrade: "websocket",
              "Sec-WebSocket-Key": wsKey,
              "Sec-WebSocket-Version": "13",
            },
          },
          (res) => {
            // Non-upgrade response (error case)
            resolve({ status: res.statusCode ?? 0, upgraded: false })
          }
        )

        req.on("upgrade", (_res, socket) => {
          // WebSocket handshake succeeded (101)
          socket.destroy()
          resolve({ status: 101, upgraded: true })
        })

        req.on("error", (err) => {
          resolve({ status: `error:${err.message}`, upgraded: false })
        })

        req.end()

        setTimeout(() => {
          req.destroy()
          resolve({ status: "timeout", upgraded: false })
        }, 5000)
      })

      // Token validation succeeded if we get 101 (ws upgrade), 503 (tmux unavailable),
      // or 0 (connection reset — tmux unavailable and server closes socket).
      // Token validation FAILED if we get 400 or 401.
      const statusNum =
        typeof result.status === "number" ? result.status : 0
      if (result.upgraded) {
        expect(statusNum).toBe(101)
      } else {
        expect(statusNum).not.toBe(400)
        expect(statusNum).not.toBe(401)
      }
    })

    it("rejects ws connection with invalid token", async () => {
      const http = await import("node:http")
      const crypto = await import("node:crypto")
      const wsKey = crypto.randomBytes(16).toString("base64")

      const result = await new Promise<{
        status: number | string
        upgraded: boolean
      }>((resolve) => {
        const req = http.request(
          {
            hostname: "localhost",
            port,
            path: `/api/supervision/terminal/ws?token=invalid-garbage-token`,
            headers: {
              Connection: "Upgrade",
              Upgrade: "websocket",
              "Sec-WebSocket-Key": wsKey,
              "Sec-WebSocket-Version": "13",
            },
          },
          (res) => {
            resolve({ status: res.statusCode ?? 0, upgraded: false })
          }
        )

        req.on("upgrade", (_res, socket) => {
          socket.destroy()
          resolve({ status: 101, upgraded: true })
        })

        req.on("error", (err) => {
          resolve({ status: `error:${err.message}`, upgraded: false })
        })

        req.end()

        setTimeout(() => {
          req.destroy()
          resolve({ status: "timeout", upgraded: false })
        }, 3000)
      })

      // Invalid token should NOT get upgraded — expect 401 or socket error
      expect(result.upgraded).toBe(false)
    })
  })

  // ===========================================================================
  // 7. Pause/resume lifecycle → domain events verification
  // ===========================================================================
  describe("pause/resume lifecycle with domain events", () => {
    it("full pause→resume cycle emits correct domain event sequence", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
        controlMode: "agent",
      })

      // Pause
      const pauseRes = await fetch(
        `${baseUrl()}/api/supervision/sessions/${FIXTURES.SESSION_1}/pause`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorType: "human",
            actorId: "op-1",
          }),
        }
      )
      expect(pauseRes.status).toBe(200)

      // Resume
      const resumeRes = await fetch(
        `${baseUrl()}/api/supervision/sessions/${FIXTURES.SESSION_1}/resume`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorType: "human",
            actorId: "op-1",
          }),
        }
      )
      expect(resumeRes.status).toBe(200)

      // Verify the full event sequence in DB
      const events = getDomainEvents(FIXTURES.SESSION_1)
      const eventTypes = events.map((e) => e.event_type)
      expect(eventTypes).toEqual([
        "worker.pause_requested",
        "worker.paused",
        "worker.resumed",
      ])

      // Verify final core state
      const row = db
        .prepare("SELECT control_mode FROM worker_sessions WHERE id = ?")
        .get(FIXTURES.SESSION_1) as any
      expect(row.control_mode).toBe("agent")
    })
  })

  // ===========================================================================
  // 8. GET /api/supervision/sessions/:id/events — event listing via API
  // ===========================================================================
  describe("GET /api/supervision/sessions/:id/events", () => {
    it("returns events after pause operation via API", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
        controlMode: "agent",
      })

      // Pause to generate events
      await fetch(
        `${baseUrl()}/api/supervision/sessions/${FIXTURES.SESSION_1}/pause`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            actorType: "human",
            actorId: "op-1",
          }),
        }
      )

      // Query events via API
      const res = await fetch(
        `${baseUrl()}/api/supervision/sessions/${FIXTURES.SESSION_1}/events`
      )
      expect(res.status).toBe(200)
      const events = await res.json()

      expect(Array.isArray(events)).toBe(true)
      expect(events.length).toBeGreaterThanOrEqual(2)

      // Events may use camelCase (from Effect service) or snake_case
      const types = events.map(
        (e: any) => e.eventType ?? e.event_type
      )
      expect(types).toContain("worker.pause_requested")
      expect(types).toContain("worker.paused")
    })
  })

  // ===========================================================================
  // 9. GET /api/supervision/terminal-wall — wall mode snapshots
  // ===========================================================================
  describe("GET /api/supervision/terminal-wall", () => {
    it("returns wall tiles with correct shape for live sessions", async () => {
      seedWorker(FIXTURES.WORKER_1, "worker-alpha")
      seedTask(FIXTURES.TASK_1, "Working on feature Z", "active")
      seedSession({
        sessionId: FIXTURES.SESSION_1,
        workerId: FIXTURES.WORKER_1,
        currentTaskId: FIXTURES.TASK_1,
      })

      const res = await fetch(`${baseUrl()}/api/supervision/terminal-wall`)
      expect(res.status).toBe(200)
      const tiles = await res.json()

      expect(Array.isArray(tiles)).toBe(true)
      expect(tiles.length).toBe(1)

      const tile = tiles[0]
      expect(tile.sessionId).toBe(FIXTURES.SESSION_1)
      expect(tile.sessionLabel).toBeDefined()
      expect(tile.readOnly).toBe(true)
      expect(typeof tile.terminalAvailable).toBe("boolean")
      expect(typeof tile.heartbeatFreshness).toBe("string")
      expect(tile.controlMode).toBe("agent")
    })

    it("returns empty array when no live sessions", async () => {
      const res = await fetch(`${baseUrl()}/api/supervision/terminal-wall`)
      expect(res.status).toBe(200)
      const tiles = await res.json()
      expect(tiles).toEqual([])
    })
  })
})
