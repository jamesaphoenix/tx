import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { Button } from "./components/ui"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import {
  fetchers,
  type ChatMessage,
  type Run,
  type PaginatedRunsResponse,
  type TaskAssigneeType,
  type DashboardDefaultTaskView,
  type TaskLabel,
  type CycleSettings,
} from "./api/client"
import { TasksPage } from "./components/tasks"
import { RunsList, RunFilters, useRunFiltersWithUrl, type RunFiltersValues } from "./components/runs"
import { CyclePage } from "./components/cycles"
import { DocsPage } from "./components/docs"
import { CommandProvider, useCommandContext, type Command } from "./components/command-palette/CommandContext"
import { CommandPalette } from "./components/command-palette/CommandPalette"
import { selectionStore, selectionActions } from "./stores/selection-store"

// =============================================================================
// Status Badges
// =============================================================================

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    backlog: "bg-gray-500",
    ready: "bg-blue-500",
    planning: "bg-purple-500",
    active: "bg-yellow-500",
    blocked: "bg-red-500",
    review: "bg-orange-500",
    needs_review: "bg-pink-500",
    done: "bg-green-500",
    running: "bg-yellow-500",
    completed: "bg-green-500",
    failed: "bg-red-500",
    timeout: "bg-orange-500",
    cancelled: "bg-gray-500",
  }
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full text-white ${colors[status] ?? "bg-gray-400"}`}>
      {status}
    </span>
  )
}

// =============================================================================
// Chat/Conversation View
// =============================================================================

/**
 * Extract a human-readable summary from tool_use input for common tools.
 */
function summarizeToolInput(toolName: string, input: unknown): string | null {
  if (!input || typeof input !== "object") return null
  const obj = input as Record<string, unknown>

  switch (toolName) {
    case "Bash":
      return typeof obj.command === "string" ? obj.command : null
    case "Read":
      return typeof obj.file_path === "string" ? obj.file_path : null
    case "Write":
      return typeof obj.file_path === "string" ? `Write to ${obj.file_path}` : null
    case "Edit":
      return typeof obj.file_path === "string" ? `Edit ${obj.file_path}` : null
    case "Glob":
      return typeof obj.pattern === "string" ? obj.pattern : null
    case "Grep":
      return typeof obj.pattern === "string" ? `/${obj.pattern}/` : null
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
      return typeof obj.subject === "string" ? obj.subject
        : typeof obj.content === "string" ? obj.content.slice(0, 80)
        : null
    default:
      return null
  }
}

/**
 * Tool icon color based on tool name category.
 */
function toolColor(toolName: string): string {
  const colors: Record<string, string> = {
    Bash: "text-green-400",
    Read: "text-blue-400",
    Write: "text-yellow-400",
    Edit: "text-yellow-400",
    Glob: "text-cyan-400",
    Grep: "text-cyan-400",
    TodoWrite: "text-purple-400",
    TaskCreate: "text-purple-400",
    TaskUpdate: "text-purple-400",
    TaskList: "text-purple-400",
  }
  return colors[toolName] ?? "text-gray-400"
}

function ToolMessage({ message }: { message: ChatMessage }) {
  const [expanded, setExpanded] = useState(false)
  const isUse = message.type === "tool_use"
  const toolName = message.tool_name || "unknown"
  const summary = isUse ? summarizeToolInput(toolName, message.content) : null

  // Format content for display
  const rawContent = typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content, null, 2)
  const isLong = rawContent.length > 200

  return (
    <div className="mx-2 my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left group"
      >
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-gray-800/40 hover:bg-gray-800/70 transition border border-gray-700/50">
          {/* Arrow indicator */}
          <span className="text-gray-600 text-xs flex-shrink-0">
            {expanded ? "\u25BC" : "\u25B6"}
          </span>

          {/* Tool badge */}
          <span className={`text-xs font-semibold flex-shrink-0 ${toolColor(toolName)}`}>
            {toolName}
          </span>

          {/* Type indicator */}
          <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
            isUse
              ? "bg-blue-900/40 text-blue-300"
              : "bg-green-900/40 text-green-300"
          }`}>
            {isUse ? "call" : "result"}
          </span>

          {/* Summary line */}
          {summary && (
            <span className="text-xs text-gray-400 truncate font-mono">
              {summary}
            </span>
          )}
          {!summary && !isUse && rawContent.trim() && (
            <span className="text-xs text-gray-500 truncate">
              {rawContent.trim().split("\n")[0].slice(0, 100)}
            </span>
          )}
          {!summary && !isUse && !rawContent.trim() && (
            <span className="text-xs text-gray-600 italic">(no output)</span>
          )}
        </div>
      </button>

      {/* Expanded content */}
      {expanded && rawContent && (
        <div className="mt-1 mx-3 border-l-2 border-gray-700/50 pl-3">
          <pre className={`text-xs text-gray-400 whitespace-pre-wrap font-mono overflow-x-auto ${
            isLong && !expanded ? "max-h-24" : "max-h-96"
          } overflow-y-auto`}>
            {rawContent}
          </pre>
        </div>
      )}
    </div>
  )
}

/**
 * Format a timestamp string to a short time display.
 */
function formatTime(timestamp?: string): string | null {
  if (!timestamp) return null
  try {
    const d = new Date(timestamp)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  } catch {
    return null
  }
}

function ChatMessageComponent({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"
  const isAssistant = message.role === "assistant"
  const isSystem = message.role === "system"
  const isTool = message.type === "tool_use" || message.type === "tool_result"

  if (isTool) {
    return <ToolMessage message={message} />
  }

  const time = formatTime(message.timestamp)
  const contentStr = typeof message.content === "string"
    ? message.content
    : JSON.stringify(message.content, null, 2)

  if (isUser) {
    return (
      <div className="flex justify-end my-3 px-4">
        <div className="flex items-end gap-2 max-w-[75%]">
          <div>
            {time && <div className="text-[10px] text-gray-500 text-right mb-1">{time}</div>}
            <div className="bg-blue-600 text-white px-4 py-2.5 rounded-2xl rounded-br-md shadow-md shadow-blue-900/20">
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{contentStr}</div>
            </div>
          </div>
          <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-white shadow-sm">
            U
          </div>
        </div>
      </div>
    )
  }

  if (isAssistant) {
    return (
      <div className="flex justify-start my-3 px-4">
        <div className="flex items-end gap-2 max-w-[80%]">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center flex-shrink-0 text-[11px] font-bold text-white shadow-sm">
            C
          </div>
          <div>
            {time && <div className="text-[10px] text-gray-500 mb-1">{time}</div>}
            <div className="bg-gray-750 text-gray-100 px-4 py-2.5 rounded-2xl rounded-bl-md border border-gray-700/50 shadow-sm">
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{contentStr}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (isSystem) {
    return (
      <div className="flex justify-center my-2 px-4">
        <div className="max-w-[90%] px-3 py-1.5 rounded-full bg-yellow-900/20 border border-yellow-800/30 text-yellow-300/80 text-xs">
          {contentStr}
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start my-2 px-4">
      <div className="max-w-[80%] p-3 rounded-lg bg-gray-800 text-gray-300">
        <div className="whitespace-pre-wrap text-sm">{contentStr}</div>
      </div>
    </div>
  )
}

function SourcePathRow({ label, path }: { label: string; path: string }) {
  return (
    <div className="text-xs text-gray-500 flex min-w-0" title={path}>
      <span className="text-gray-400 shrink-0">{label}:</span>{" "}
      <code className="text-[11px] truncate ml-1">{path}</code>
    </div>
  )
}

function ChatView({ runId }: { runId: string }) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [activeTab, setActiveTab] = useState<"transcript" | "logs">("transcript")

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => fetchers.runDetail(runId),
    enabled: !!runId,
    // Poll every 2 seconds when run is in progress
    refetchInterval: (query) => {
      const status = query.state.data?.run?.status
      return status === "running" ? 2000 : false
    },
  })

  const run = data?.run
  const messages = data?.messages ?? []
  const logs = data?.logs
  const logsPayloadMissing = Boolean(data && logs === undefined)
  const stdoutLog = logs?.stdout ?? null
  const stderrLog = logs?.stderr ?? null
  const hasStdoutLog = typeof stdoutLog === "string" && stdoutLog.length > 0
  const hasStderrLog = typeof stderrLog === "string" && stderrLog.length > 0
  const hasLogs = hasStdoutLog || hasStderrLog
  const hasLogPaths = Boolean(run?.stdoutPath || run?.stderrPath)
  const hasReadableEmptyLog = stdoutLog === "" || stderrLog === ""
  const hasUnreadableLogPath = Boolean(
    (run?.stdoutPath && stdoutLog === null)
      || (run?.stderrPath && stderrLog === null)
  )
  const isRunning = run?.status === "running"
  const sourcePaths = [
    { label: "Transcript", path: run?.transcriptPath ?? null },
    { label: "Stdout", path: run?.stdoutPath ?? null },
    { label: "Stderr", path: run?.stderrPath ?? null },
    { label: "Context", path: run?.contextInjected ?? null },
  ]
  const availableSourcePaths = sourcePaths.filter(
    (source): source is { label: string; path: string } => Boolean(source.path)
  )

  useEffect(() => {
    setActiveTab("transcript")
  }, [runId])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages.length, stdoutLog?.length, stderrLog?.length, autoScroll, activeTab])

  // Detect if user has scrolled up (disable auto-scroll)
  const handleScroll = () => {
    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100
      setAutoScroll(isAtBottom)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full" />
      </div>
    )
  }

  if (error) {
    return <div className="text-red-400 p-4 break-words overflow-hidden">Error loading run: {String(error)}</div>
  }

  return (
    <div className="flex flex-col h-full">
      {/* Run Header */}
      {run && (
        <div className="p-4 border-b border-gray-700 bg-gray-800/50 overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <code className="text-sm text-gray-400">{run.id}</code>
              <span className="text-purple-400">{run.agent}</span>
              {isRunning && (
                <span className="flex items-center gap-1 text-xs text-yellow-400">
                  <span className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse" />
                  Live
                </span>
              )}
              {isFetching && !isLoading && (
                <span className="w-3 h-3 border border-gray-500 border-t-transparent rounded-full animate-spin" />
              )}
            </div>
            <StatusBadge status={run.status} />
          </div>
          {run.taskId && (
            <div className="text-sm text-gray-300 mt-1">
              Task: <code className="text-xs">{run.taskId}</code>
            </div>
          )}
          {availableSourcePaths.length > 0 && (
            <div className="mt-2 space-y-1">
              {availableSourcePaths.map((source) => (
                <SourcePathRow key={source.label} label={source.label} path={source.path} />
              ))}
            </div>
          )}
          {run.summary && (
            <div className="text-sm text-gray-400 mt-2">{run.summary}</div>
          )}
          {run.errorMessage && (
            <div className="text-sm text-red-400 mt-2">{run.errorMessage}</div>
          )}
        </div>
      )}

      {/* Transcript / Logs tabs */}
      <div className="px-4 pt-3 border-b border-gray-800 bg-gray-900/40">
        <div className="inline-flex rounded-lg border border-gray-700 overflow-hidden">
          <Button
            size="sm"
            variant={activeTab === "transcript" ? "primary" : "ghost"}
            onClick={() => setActiveTab("transcript")}
            className="rounded-none border-0"
          >
            Transcript
          </Button>
          <Button
            size="sm"
            variant={activeTab === "logs" ? "primary" : "ghost"}
            onClick={() => setActiveTab("logs")}
            className="rounded-none border-0"
          >
            Execution Logs
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-2"
      >
        {activeTab === "transcript" ? (
          messages.length === 0 ? (
            <div className="text-gray-500 text-center py-8">
              {isRunning ? (
                <>
                  <div className="animate-pulse">Waiting for transcript...</div>
                  <div className="text-xs mt-2">
                    {run?.transcriptPath
                      ? "Transcript path is configured; messages will stream here as they are parsed."
                      : "Run has not reported a transcript path yet."
                    }
                  </div>
                </>
              ) : (
                <>
                  No conversation transcript available
                  <div className="text-xs mt-2">
                    {run?.transcriptPath
                      ? "Transcript path was recorded, but the file was empty or unreadable."
                      : "No transcript path was captured for this run."
                    }
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              {messages.map((msg, i) => (
                <ChatMessageComponent key={`${msg.role}-${msg.type ?? "text"}-${i}`} message={msg} />
              ))}
              <div ref={messagesEndRef} />
            </>
          )
        ) : logsPayloadMissing ? (
          <div className="text-center py-8">
            <div className="text-amber-300">Execution logs payload unavailable</div>
            <div className="text-xs text-gray-500 mt-2">
              {isRunning
                ? "Run detail response did not include the logs payload yet; waiting for the next compatible update."
                : "Run detail response omitted logs payload, so stdout/stderr could not be rendered."
              }
            </div>
          </div>
        ) : hasLogs ? (
          <div className="space-y-3">
            {(logs?.stdoutTruncated || logs?.stderrTruncated) && (
              <div className="text-xs text-amber-300">
                Log output truncated to last 200k characters for dashboard rendering.
              </div>
            )}
            {hasStdoutLog && (
              <div>
                <div className="text-xs text-gray-400 mb-1">stdout</div>
                <pre className="text-xs text-gray-200 bg-gray-900 border border-gray-700 rounded-md p-3 whitespace-pre-wrap overflow-x-auto">
                  {stdoutLog}
                </pre>
              </div>
            )}
            {hasStderrLog && (
              <div>
                <div className="text-xs text-gray-400 mb-1">stderr</div>
                <pre className="text-xs text-red-200 bg-gray-900 border border-red-900/40 rounded-md p-3 whitespace-pre-wrap overflow-x-auto">
                  {stderrLog}
                </pre>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="text-gray-500 text-center py-8">
            {isRunning ? (
              <>
                <div className="animate-pulse">Waiting for execution logs...</div>
                <div className="text-xs mt-2">
                  {hasLogPaths
                    ? hasReadableEmptyLog
                      ? "stdout/stderr files are present but currently empty."
                      : "stdout/stderr paths are configured; output will appear once bytes are written."
                    : "Run has not reported stdout/stderr source paths yet."
                  }
                </div>
              </>
            ) : (
              <>
                No execution logs available
                <div className="text-xs mt-2">
                  {!hasLogPaths
                    ? "No stdout/stderr files were captured for this run."
                    : hasUnreadableLogPath && hasReadableEmptyLog
                      ? "Some log files were empty and others were unreadable."
                      : hasUnreadableLogPath
                        ? "stdout/stderr paths were recorded, but log files were unreadable or missing."
                        : "Log files were captured but contained no output."
                  }
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && ((activeTab === "transcript" && messages.length > 0) || (activeTab === "logs" && hasLogs)) && (
        <Button
          size="sm"
          variant="primary"
          onClick={() => {
            setAutoScroll(true)
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
          }}
          className="absolute bottom-4 right-4 rounded-full shadow-lg"
        >
          Scroll to bottom
        </Button>
      )}
    </div>
  )
}

// =============================================================================
// Stats & Ralph Status
// =============================================================================

function Stats() {
  const { data } = useQuery({
    queryKey: ["stats"],
    queryFn: fetchers.stats,
  })

  if (!data) return null

  return (
    <div className="grid grid-cols-5 gap-3">
      <div className="rounded-xl bg-gray-800/85 px-4 py-3 shadow-sm">
        <div className="text-xl font-bold text-white">{data.tasks}</div>
        <div className="text-xs text-gray-400">Tasks</div>
      </div>
      <div className="rounded-xl bg-gray-800/85 px-4 py-3 shadow-sm">
        <div className="text-xl font-bold text-blue-400">{data.ready}</div>
        <div className="text-xs text-gray-400">Ready</div>
      </div>
      <div className="rounded-xl bg-gray-800/85 px-4 py-3 shadow-sm">
        <div className="text-xl font-bold text-green-400">{data.done}</div>
        <div className="text-xs text-gray-400">Done</div>
      </div>
      <div className="rounded-xl bg-gray-800/85 px-4 py-3 shadow-sm">
        <div className="text-xl font-bold text-yellow-400">{data.runsRunning ?? 0}</div>
        <div className="text-xs text-gray-400">Running</div>
      </div>
      <div className="rounded-xl bg-gray-800/85 px-4 py-3 shadow-sm">
        <div className="text-xl font-bold text-gray-400">{data.runsTotal ?? 0}</div>
        <div className="text-xs text-gray-400">Runs</div>
      </div>
    </div>
  )
}

// =============================================================================
// Main App
// =============================================================================

type Tab = "tasks" | "docs" | "runs" | "cycles" | "settings"
type ThemeMode = "light" | "dark"
const DEFAULT_RUN_FILTERS: RunFiltersValues = { status: [], agent: "" }

const THEME_STORAGE_KEY = "tx-dashboard-theme"

function getThemeStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") return null
  const maybeStorage = window.localStorage as Partial<Storage> | undefined
  if (!maybeStorage) return null
  if (typeof maybeStorage.getItem !== "function") return null
  if (typeof maybeStorage.setItem !== "function") return null
  return maybeStorage as Pick<Storage, "getItem" | "setItem">
}

function readInitialTheme(): ThemeMode {
  try {
    const storage = getThemeStorage()
    if (!storage) return "light"
    const storedTheme = storage.getItem(THEME_STORAGE_KEY)
    return storedTheme === "light" || storedTheme === "dark" ? storedTheme : "light"
  } catch {
    return "light"
  }
}

function ThemeToggleIcon({ themeMode }: { themeMode: ThemeMode }) {
  if (themeMode === "light") {
    return (
      <svg
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="4.93" x2="7.05" y2="7.05" />
      <line x1="16.95" y1="16.95" x2="19.07" y2="19.07" />
      <line x1="16.95" y1="7.05" x2="19.07" y2="4.93" />
      <line x1="4.93" y1="19.07" x2="7.05" y2="16.95" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33h.02A1.65 1.65 0 0 0 9.9 3.1V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.02a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.02a1.65 1.65 0 0 0 1.51 1.01H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

type SettingsTab = "general" | "labels" | "cycles"

const SETTINGS_TAB_LABELS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "labels", label: "Labels" },
  { id: "cycles", label: "Cycles" },
]

const CYCLE_START_DAY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "monday", label: "Monday" },
  { value: "tuesday", label: "Tuesday" },
  { value: "wednesday", label: "Wednesday" },
  { value: "thursday", label: "Thursday" },
  { value: "friday", label: "Friday" },
  { value: "saturday", label: "Saturday" },
  { value: "sunday", label: "Sunday" },
]

const CYCLE_CARRY_STATUS_OPTIONS = [
  "backlog",
  "ready",
  "planning",
  "active",
  "blocked",
  "review",
  "needs_review",
  "done",
] as const

type CycleCarryStatus = (typeof CYCLE_CARRY_STATUS_OPTIONS)[number]

const CYCLE_CARRY_STATUS_LABELS: Record<CycleCarryStatus, string> = {
  backlog: "Backlog",
  ready: "Ready",
  planning: "Planning",
  active: "Active",
  blocked: "Blocked",
  review: "Review",
  needs_review: "Needs Review",
  done: "Done",
}

const DEFAULT_CYCLE_SETTINGS: CycleSettings = {
  cycleLengthDays: 7,
  cycleStartDay: "monday",
  carryStatuses: ["planning", "active", "blocked", "review", "needs_review"],
  autoAddStatuses: ["backlog", "ready"],
}

function normalizeCarryStatuses(statuses: readonly string[]): CycleCarryStatus[] {
  return CYCLE_CARRY_STATUS_OPTIONS.filter((status) => statuses.includes(status))
}

function SettingsPage({
  defaultTaskAssigmentType,
  defaultTaskView,
  cycleSettings,
  isSaving,
  errorMessage,
  onBack,
  onSaveDefaultTaskAssigmentType,
  onSaveDefaultTaskView,
  onSaveCycleSettings,
}: {
  defaultTaskAssigmentType: TaskAssigneeType
  defaultTaskView: DashboardDefaultTaskView
  cycleSettings: CycleSettings
  isSaving: boolean
  errorMessage: string | null
  onBack: () => void
  onSaveDefaultTaskAssigmentType: (nextType: TaskAssigneeType) => void
  onSaveDefaultTaskView: (nextView: DashboardDefaultTaskView) => void
  onSaveCycleSettings: (nextSettings: CycleSettings) => void
}) {
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("general")
  const [draftType, setDraftType] = useState<TaskAssigneeType>(defaultTaskAssigmentType)
  const [draftTaskView, setDraftTaskView] = useState<DashboardDefaultTaskView>(defaultTaskView)
  const normalizedCycleStartDay = CYCLE_START_DAY_OPTIONS.some((option) => option.value === cycleSettings.cycleStartDay)
    ? cycleSettings.cycleStartDay
    : DEFAULT_CYCLE_SETTINGS.cycleStartDay
  const normalizedCurrentCarryStatuses = useMemo(
    () => normalizeCarryStatuses(cycleSettings.carryStatuses),
    [cycleSettings.carryStatuses]
  )
  const normalizedCurrentAutoAddStatuses = useMemo(
    () => normalizeCarryStatuses(cycleSettings.autoAddStatuses ?? DEFAULT_CYCLE_SETTINGS.autoAddStatuses),
    [cycleSettings.autoAddStatuses]
  )
  const currentCarryStatusesKey = normalizedCurrentCarryStatuses.join(",")
  const currentAutoAddStatusesKey = normalizedCurrentAutoAddStatuses.join(",")
  const [draftCycleLengthDays, setDraftCycleLengthDays] = useState(String(cycleSettings.cycleLengthDays))
  const [draftCycleStartDay, setDraftCycleStartDay] = useState(normalizedCycleStartDay)
  const [draftCarryStatuses, setDraftCarryStatuses] = useState<CycleCarryStatus[]>(normalizedCurrentCarryStatuses)
  const [draftAutoAddStatuses, setDraftAutoAddStatuses] = useState<CycleCarryStatus[]>(normalizedCurrentAutoAddStatuses)

  useEffect(() => {
    setDraftType(defaultTaskAssigmentType)
  }, [defaultTaskAssigmentType])

  useEffect(() => {
    setDraftTaskView(defaultTaskView)
  }, [defaultTaskView])

  useEffect(() => {
    setDraftCycleLengthDays(String(cycleSettings.cycleLengthDays))
    setDraftCycleStartDay(normalizedCycleStartDay)
    setDraftCarryStatuses(normalizedCurrentCarryStatuses)
    setDraftAutoAddStatuses(normalizedCurrentAutoAddStatuses)
  }, [cycleSettings.cycleLengthDays, normalizedCycleStartDay, currentCarryStatusesKey, normalizedCurrentCarryStatuses, currentAutoAddStatusesKey, normalizedCurrentAutoAddStatuses])

  const hasAssigmentTypeChanges = draftType !== defaultTaskAssigmentType
  const hasDefaultTaskViewChanges = draftTaskView !== defaultTaskView
  const parsedCycleLengthDays = Number.parseInt(draftCycleLengthDays, 10)
  const hasValidCycleLengthDays = Number.isInteger(parsedCycleLengthDays) && parsedCycleLengthDays > 0
  const normalizedDraftCarryStatuses = normalizeCarryStatuses(draftCarryStatuses)
  const normalizedDraftAutoAddStatuses = normalizeCarryStatuses(draftAutoAddStatuses)
  const hasCycleSettingChanges =
    hasValidCycleLengthDays &&
    (
      parsedCycleLengthDays !== cycleSettings.cycleLengthDays ||
      draftCycleStartDay !== normalizedCycleStartDay ||
      normalizedDraftCarryStatuses.join(",") !== currentCarryStatusesKey ||
      normalizedDraftAutoAddStatuses.join(",") !== currentAutoAddStatusesKey
    )

  const queryClient = useQueryClient()
  const { data: labelsData, isLoading: isLoadingLabels } = useQuery({
    queryKey: ["labels"],
    queryFn: fetchers.labels,
    staleTime: 5000,
    retry: false,
  })
  const labels = labelsData?.labels ?? []
  const [newLabelName, setNewLabelName] = useState("")
  const [newLabelColor, setNewLabelColor] = useState("#3b82f6")
  const [isCreatingLabel, setIsCreatingLabel] = useState(false)
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null)
  const [editingLabelName, setEditingLabelName] = useState("")
  const [editingLabelColor, setEditingLabelColor] = useState("#3b82f6")
  const [labelBusyId, setLabelBusyId] = useState<number | null>(null)
  const [pendingDeleteLabelId, setPendingDeleteLabelId] = useState<number | null>(null)
  const [labelError, setLabelError] = useState<string | null>(null)

  const invalidateLabelCaches = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["labels"] }),
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["task"] }),
    ])
  }, [queryClient])

  const beginEditLabel = useCallback((label: TaskLabel) => {
    setEditingLabelId(label.id)
    setEditingLabelName(label.name)
    setEditingLabelColor(label.color)
    setPendingDeleteLabelId(null)
    setLabelError(null)
  }, [])

  const cancelEditLabel = useCallback(() => {
    setEditingLabelId(null)
    setEditingLabelName("")
    setEditingLabelColor("#3b82f6")
  }, [])

  const handleCreateLabel = useCallback(async () => {
    const normalizedName = newLabelName.trim()
    if (!normalizedName) {
      setLabelError("Label name is required")
      return
    }

    setIsCreatingLabel(true)
    setLabelError(null)
    try {
      await fetchers.createLabel({ name: normalizedName, color: newLabelColor })
      setNewLabelName("")
      setNewLabelColor("#3b82f6")
      await invalidateLabelCaches()
    } catch (error) {
      setLabelError(error instanceof Error ? error.message : "Failed to create label")
    } finally {
      setIsCreatingLabel(false)
    }
  }, [newLabelName, newLabelColor, invalidateLabelCaches])

  const handleSaveLabel = useCallback(async (labelId: number) => {
    const normalizedName = editingLabelName.trim()
    if (!normalizedName) {
      setLabelError("Label name is required")
      return
    }

    setLabelBusyId(labelId)
    setLabelError(null)
    try {
      await fetchers.updateLabel(labelId, {
        name: normalizedName,
        color: editingLabelColor,
      })
      setEditingLabelId(null)
      setEditingLabelName("")
      setEditingLabelColor("#3b82f6")
      await invalidateLabelCaches()
    } catch (error) {
      setLabelError(error instanceof Error ? error.message : "Failed to update label")
    } finally {
      setLabelBusyId(null)
    }
  }, [editingLabelName, editingLabelColor, invalidateLabelCaches])

  const requestDeleteLabel = useCallback((labelId: number) => {
    setPendingDeleteLabelId(labelId)
    setLabelError(null)
  }, [])

  const cancelDeleteLabel = useCallback((labelId: number) => {
    setPendingDeleteLabelId((current) => (current === labelId ? null : current))
  }, [])

  const handleDeleteLabel = useCallback(async (labelId: number) => {
    setLabelBusyId(labelId)
    setLabelError(null)
    try {
      await fetchers.deleteLabel(labelId)
      if (editingLabelId === labelId) {
        setEditingLabelId(null)
      }
      setPendingDeleteLabelId(null)
      await invalidateLabelCaches()
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      if (rawMessage.includes("HTTP 404")) {
        setLabelError("Delete labels endpoint not found. Restart `tx diag dashboard` and try again.")
      } else {
        setLabelError(error instanceof Error ? error.message : "Failed to delete label")
      }
    } finally {
      setLabelBusyId(null)
    }
  }, [editingLabelId, invalidateLabelCaches])

  const toggleCarryStatus = useCallback((status: CycleCarryStatus) => {
    setDraftCarryStatuses((current) =>
      current.includes(status)
        ? current.filter((existingStatus) => existingStatus !== status)
        : [...current, status]
    )
  }, [])

  const toggleAutoAddStatus = useCallback((status: CycleCarryStatus) => {
    setDraftAutoAddStatuses((current) =>
      current.includes(status)
        ? current.filter((existingStatus) => existingStatus !== status)
        : [...current, status]
    )
  }, [])

  const saveCycleSettings = useCallback(() => {
    if (!hasValidCycleLengthDays) return
    onSaveCycleSettings({
      cycleLengthDays: parsedCycleLengthDays,
      cycleStartDay: draftCycleStartDay,
      carryStatuses: normalizedDraftCarryStatuses,
      autoAddStatuses: normalizedDraftAutoAddStatuses,
    })
  }, [
    draftCycleStartDay,
    hasValidCycleLengthDays,
    normalizedDraftCarryStatuses,
    normalizedDraftAutoAddStatuses,
    onSaveCycleSettings,
    parsedCycleLengthDays,
  ])

  const cycleLengthError = draftCycleLengthDays.trim().length > 0 && !hasValidCycleLengthDays
    ? "Cycle length must be a positive whole number."
    : null

  return (
    <div className="mx-auto w-full max-w-4xl p-6 pb-8">
      <Button
        size="sm"
        variant="secondary"
        onClick={onBack}
        aria-label="Back to Tasks"
      >
        ← Back to Tasks
      </Button>
      <h2 className="mt-3 text-xl font-semibold text-white">Settings</h2>
      <p className="mt-1 text-sm text-gray-400">
        Configure dashboard defaults, labels, and cycles.
      </p>

      <div className="mt-6 rounded-xl border border-gray-700 bg-gray-800/70 p-1">
        <nav className="flex flex-wrap gap-1" aria-label="Settings sections">
          {SETTINGS_TAB_LABELS.map((tab) => (
            <Button
              key={tab.id}
              size="md"
              variant={activeSettingsTab === tab.id ? "primary" : "ghost"}
              onClick={() => setActiveSettingsTab(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </nav>
      </div>

      <div className="mt-4 space-y-4">
        {activeSettingsTab === "general" ? (
          <>
            <section className="rounded-xl border border-gray-700 bg-gray-800/70 p-4">
              <h3 className="text-sm font-semibold text-gray-200">Default Task Assignment Type</h3>
              <p className="mt-1 text-xs text-gray-400">
                Applied when creating tasks from the dashboard composer.
              </p>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setDraftType("human")}
                  className={`h-8 rounded-md border px-3 text-left text-[13px] transition ${
                    draftType === "human"
                      ? "border-blue-500 bg-blue-500/20 text-blue-200"
                      : "border-gray-700 bg-gray-900/40 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  Human
                </button>
                <button
                  type="button"
                  onClick={() => setDraftType("agent")}
                  className={`h-8 rounded-md border px-3 text-left text-[13px] transition ${
                    draftType === "agent"
                      ? "border-blue-500 bg-blue-500/20 text-blue-200"
                      : "border-gray-700 bg-gray-900/40 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  Agent
                </button>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={isSaving || !hasAssigmentTypeChanges}
                  onClick={() => onSaveDefaultTaskAssigmentType(draftType)}
                >
                  {isSaving ? "Saving..." : "Save settings"}
                </Button>
                <span className="text-xs text-gray-500">
                  Current default: {defaultTaskAssigmentType}
                </span>
              </div>
            </section>

            <section className="rounded-xl border border-gray-700 bg-gray-800/70 p-4">
              <h3 className="text-sm font-semibold text-gray-200">Default Tasks View</h3>
              <p className="mt-1 text-xs text-gray-400">
                Applied when opening the Tasks tab unless overridden by URL query params.
              </p>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setDraftTaskView("list")}
                  className={`h-8 rounded-md border px-3 text-left text-[13px] transition ${
                    draftTaskView === "list"
                      ? "border-blue-500 bg-blue-500/20 text-blue-200"
                      : "border-gray-700 bg-gray-900/40 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  List
                </button>
                <button
                  type="button"
                  onClick={() => setDraftTaskView("kanban")}
                  className={`h-8 rounded-md border px-3 text-left text-[13px] transition ${
                    draftTaskView === "kanban"
                      ? "border-blue-500 bg-blue-500/20 text-blue-200"
                      : "border-gray-700 bg-gray-900/40 text-gray-300 hover:border-gray-600"
                  }`}
                >
                  Kanban
                </button>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={isSaving || !hasDefaultTaskViewChanges}
                  onClick={() => onSaveDefaultTaskView(draftTaskView)}
                >
                  {isSaving ? "Saving..." : "Save view setting"}
                </Button>
                <span className="text-xs text-gray-500">
                  Current default: {defaultTaskView}
                </span>
              </div>
            </section>
          </>
        ) : activeSettingsTab === "labels" ? (
          <section className="rounded-xl border border-gray-700 bg-gray-800/70 p-4">
            <h3 className="text-sm font-semibold text-gray-200">Task Labels</h3>
            <p className="mt-1 text-xs text-gray-400">
              Create, edit, and delete reusable task labels.
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
              <input
                aria-label="New label name"
                type="text"
                value={newLabelName}
                onChange={(event) => setNewLabelName(event.target.value)}
                placeholder="Label name"
                className="h-10 rounded-md border border-gray-700 bg-gray-900/40 px-2.5 py-2 text-sm text-gray-100 outline-none transition focus:border-blue-500"
              />
              <label className="flex h-10 items-center justify-between rounded-md border border-gray-700 bg-gray-900/40 px-2.5 py-2 text-xs text-gray-300">
                Color
                <input
                  aria-label="New label color"
                  type="color"
                  value={newLabelColor}
                  onChange={(event) => setNewLabelColor(event.target.value)}
                  className="h-6 w-8 cursor-pointer rounded border border-gray-600 bg-transparent p-0"
                />
              </label>
              <Button
                size="lg"
                variant="primary"
                aria-label="Create label"
                disabled={isCreatingLabel}
                onClick={() => { void handleCreateLabel() }}
                className="h-10"
              >
                {isCreatingLabel ? "Creating..." : "Create"}
              </Button>
            </div>

            <div className="mt-4 rounded-lg border border-gray-700/80 bg-gray-900/20 p-2">
              {!isLoadingLabels && labels.length > 0 && (
                <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-gray-500">
                  <span>{labels.length} label{labels.length === 1 ? "" : "s"}</span>
                  <span>Scroll to manage all labels</span>
                </div>
              )}
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {isLoadingLabels ? (
                  <p className="text-xs text-gray-400">Loading labels...</p>
                ) : labels.length === 0 ? (
                  <p className="rounded-md border border-gray-700/80 bg-gray-900/30 px-3 py-2 text-xs text-gray-500">
                    No labels yet.
                  </p>
                ) : (
                  labels.map((label) => {
                    const isEditing = editingLabelId === label.id
                    const isBusy = labelBusyId === label.id
                    return (
                      <div
                        key={label.id}
                        className="rounded-md border border-gray-700/80 bg-gray-900/30 px-3 py-2"
                      >
                        {isEditing ? (
                          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto_auto]">
                            <input
                              aria-label={`Edit label name ${label.name}`}
                              type="text"
                              value={editingLabelName}
                              onChange={(event) => setEditingLabelName(event.target.value)}
                              className="rounded-md border border-gray-700 bg-gray-900/50 px-2.5 py-1.5 text-xs text-gray-100 outline-none transition focus:border-blue-500"
                            />
                            <label className="flex items-center justify-between rounded-md border border-gray-700 bg-gray-900/50 px-2 py-1.5 text-[11px] text-gray-300">
                              Color
                              <input
                                aria-label={`Edit label color ${label.name}`}
                                type="color"
                                value={editingLabelColor}
                                onChange={(event) => setEditingLabelColor(event.target.value)}
                                className="h-5 w-7 cursor-pointer rounded border border-gray-600 bg-transparent p-0"
                              />
                            </label>
                            <Button
                              size="xs"
                              variant="primary"
                              aria-label={`Save label ${label.name}`}
                              disabled={isBusy}
                              onClick={() => { void handleSaveLabel(label.id) }}
                            >
                              Save
                            </Button>
                            <Button
                              size="xs"
                              variant="secondary"
                              aria-label={`Cancel label edit ${label.name}`}
                              onClick={cancelEditLabel}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-2">
                            <div className="inline-flex min-w-0 items-center gap-2">
                              <span
                                className="h-3 w-3 flex-shrink-0 rounded-full border border-white/10"
                                style={{ backgroundColor: label.color }}
                                aria-hidden="true"
                              />
                              <span className="truncate text-sm text-gray-100">{label.name}</span>
                              <span className="text-[10px] text-gray-500">#{label.id}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {pendingDeleteLabelId === label.id ? (
                                <>
                                  <span className="text-[11px] text-red-300">Confirm delete?</span>
                                  <Button
                                    size="xs"
                                    variant="danger"
                                    aria-label={`Confirm delete label ${label.name}`}
                                    disabled={isBusy}
                                    onClick={() => { void handleDeleteLabel(label.id) }}
                                  >
                                    {isBusy ? "Deleting..." : "Confirm"}
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    aria-label={`Cancel delete label ${label.name}`}
                                    disabled={isBusy}
                                    onClick={() => cancelDeleteLabel(label.id)}
                                  >
                                    Cancel
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    aria-label={`Edit label ${label.name}`}
                                    disabled={isBusy}
                                    onClick={() => beginEditLabel(label)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="danger"
                                    aria-label={`Delete label ${label.name}`}
                                    disabled={isBusy}
                                    onClick={() => requestDeleteLabel(label.id)}
                                  >
                                    Delete
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {labelError && (
              <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">
                {labelError}
              </p>
            )}
          </section>
        ) : (
          <section className="rounded-xl border border-gray-700 bg-gray-800/70 p-4">
            <h3 className="text-sm font-semibold text-gray-200">Cycle Defaults</h3>
            <p className="mt-1 text-xs text-gray-400">
              Configure cycle cadence and which task statuses carry forward to the next cycle.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-gray-300">
                Cycle length (days)
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={draftCycleLengthDays}
                  onChange={(event) => setDraftCycleLengthDays(event.target.value)}
                  className="h-10 rounded-md border border-gray-700 bg-gray-900/40 px-2.5 py-2 text-sm text-gray-100 outline-none transition focus:border-blue-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-gray-300">
                Cycle start day
                <select
                  value={draftCycleStartDay}
                  onChange={(event) => setDraftCycleStartDay(event.target.value)}
                  className="h-10 rounded-md border border-gray-700 bg-gray-900/40 px-2.5 py-2 text-sm text-gray-100 outline-none transition focus:border-blue-500"
                >
                  {CYCLE_START_DAY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <fieldset className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Carry-over statuses
              </legend>
              <p className="mt-1 text-xs text-gray-400">
                Tasks in selected statuses are copied into the next cycle when the current cycle completes.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {CYCLE_CARRY_STATUS_OPTIONS.map((status) => (
                  <label
                    key={status}
                    className="flex items-center gap-2 rounded-md border border-gray-700 bg-gray-900/30 px-2.5 py-2 text-sm text-gray-200"
                  >
                    <input
                      type="checkbox"
                      checked={draftCarryStatuses.includes(status)}
                      onChange={() => toggleCarryStatus(status)}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
                    />
                    {CYCLE_CARRY_STATUS_LABELS[status]}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                Auto-add to cycle
              </legend>
              <p className="mt-1 text-xs text-gray-400">
                Tasks in selected statuses are automatically added to the current cycle when a new cycle is created or when new tasks are created.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {CYCLE_CARRY_STATUS_OPTIONS.map((status) => (
                  <label
                    key={status}
                    className="flex items-center gap-2 rounded-md border border-gray-700 bg-gray-900/30 px-2.5 py-2 text-sm text-gray-200"
                  >
                    <input
                      type="checkbox"
                      checked={draftAutoAddStatuses.includes(status)}
                      onChange={() => toggleAutoAddStatus(status)}
                      className="h-4 w-4 rounded border-gray-600 bg-gray-900 text-blue-500 focus:ring-blue-500"
                    />
                    {CYCLE_CARRY_STATUS_LABELS[status]}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                size="sm"
                variant="primary"
                disabled={isSaving || !hasCycleSettingChanges || !hasValidCycleLengthDays}
                onClick={saveCycleSettings}
              >
                {isSaving ? "Saving..." : "Save cycle settings"}
              </Button>
              <span className="text-xs text-gray-500">
                {normalizedDraftCarryStatuses.length} carry-over, {normalizedDraftAutoAddStatuses.length} auto-add
              </span>
            </div>

            {cycleLengthError && (
              <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">
                {cycleLengthError}
              </p>
            )}
          </section>
        )}
      </div>

      {errorMessage && (
        <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">
          {errorMessage}
        </p>
      )}
    </div>
  )
}

export default function App() {
  return (
    <CommandProvider>
      <AppContent />
      <CommandPalette />
    </CommandProvider>
  )
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<Tab>("tasks")
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => readInitialTheme())
  const [newTaskRequestNonce, setNewTaskRequestNonce] = useState(0)
  const [tabResetKey, setTabResetKey] = useState(0)

  const selectedRunIds = useStore(selectionStore, (s) => s.runIds)

  const queryClient = useQueryClient()

  // URL state management for filters
  const { filters: runFilters, setFilters: setRunFilters } = useRunFiltersWithUrl()

  /** Switch tabs via the top-level shell and reset to each section's base view. */
  const navigateToTab = useCallback((tab: Tab) => {
    window.history.replaceState({}, "", window.location.pathname)
    setTabResetKey((current) => current + 1)
    setActiveTab(tab)
    setSelectedRunId(null)
    if (tab === "runs") {
      setRunFilters(DEFAULT_RUN_FILTERS)
    }
  }, [setRunFilters])

  const handleToggleRun = useCallback((id: string) => {
    selectionActions.toggleRun(id)
  }, [])

  const toggleThemeMode = useCallback(() => {
    setThemeMode((current) => current === "light" ? "dark" : "light")
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    document.documentElement.style.colorScheme = themeMode
    try {
      getThemeStorage()?.setItem(THEME_STORAGE_KEY, themeMode)
    } catch {
      // Ignore storage write failures (e.g. restricted environments)
    }
  }, [themeMode])

  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const [settingsSaveError, setSettingsSaveError] = useState<string | null>(null)

  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: fetchers.settings,
    staleTime: 5000,
    retry: false,
  })

  const defaultTaskAssigmentType: TaskAssigneeType =
    settingsData?.dashboard.defaultTaskAssigmentType ?? "human"
  const defaultTaskView: DashboardDefaultTaskView =
    settingsData?.dashboard.defaultTaskView ?? "list"
  const cycleSettings: CycleSettings =
    settingsData?.dashboard.cycles ?? DEFAULT_CYCLE_SETTINGS

  const saveDashboardDefaultAssigmentType = useCallback(async (nextType: TaskAssigneeType) => {
    setIsSavingSettings(true)
    setSettingsSaveError(null)
    try {
      const updated = await fetchers.updateSettings({
        dashboard: {
          defaultTaskAssigmentType: nextType,
        },
      })
      queryClient.setQueryData(["settings"], updated)
    } catch (error) {
      setSettingsSaveError(error instanceof Error ? error.message : "Failed to save settings")
    } finally {
      setIsSavingSettings(false)
    }
  }, [queryClient])

  const saveDashboardDefaultTaskView = useCallback(async (nextView: DashboardDefaultTaskView) => {
    setIsSavingSettings(true)
    setSettingsSaveError(null)
    try {
      const updated = await fetchers.updateSettings({
        dashboard: {
          defaultTaskView: nextView,
        },
      })
      queryClient.setQueryData(["settings"], updated)
    } catch (error) {
      setSettingsSaveError(error instanceof Error ? error.message : "Failed to save settings")
    } finally {
      setIsSavingSettings(false)
    }
  }, [queryClient])

  const saveDashboardCycleSettings = useCallback(async (nextSettings: CycleSettings) => {
    setIsSavingSettings(true)
    setSettingsSaveError(null)
    try {
      const updated = await fetchers.updateSettings({
        dashboard: {
          cycles: nextSettings,
        },
      })
      queryClient.setQueryData(["settings"], updated)
    } catch (error) {
      setSettingsSaveError(error instanceof Error ? error.message : "Failed to save settings")
    } finally {
      setIsSavingSettings(false)
    }
  }, [queryClient])

  const { setAppCommands, setPageCommands, setOverlayCommands } = useCommandContext()

  const getLoadedRuns = useCallback((): Run[] => {
    const queries = queryClient.getQueriesData<{ pages: PaginatedRunsResponse[] }>({ queryKey: ["runs", "infinite"] })
    return queries.flatMap(([, data]) => data?.pages?.flatMap((p) => p.runs) ?? [])
  }, [queryClient])

  // Fetch runs to get available agents and status counts
  const { data: runsMetadata } = useQuery({
    queryKey: ["runs", "metadata"],
    queryFn: fetchers.runs,
    select: (data) => {
      const agents = [...new Set(data.runs.map((run) => run.agent))].filter(Boolean).sort()
      const statusCounts = data.runs.reduce<Record<string, number>>((acc, run) => {
        acc[run.status] = (acc[run.status] ?? 0) + 1
        return acc
      }, {})
      return { agents, statusCounts }
    },
    staleTime: 5000,
  })

  // Register app-level commands (global + per-tab)
  const appCommands = useMemo((): Command[] => {
    const cmds: Command[] = [
      {
        id: "global:task:new",
        label: "Create new task",
        group: "Actions",
        icon: "action",
        shortcut: "⌘N",
        allowInInput: true,
        action: () => {
          setNewTaskRequestNonce((current) => current + 1)
          if (activeTab !== "tasks") {
            navigateToTab("tasks")
          }
        },
      },
    ]

    // Tab switching - always available
    const tabs: { tab: Tab; label: string }[] = [
      { tab: "tasks", label: "Go to Tasks" },
      { tab: "docs", label: "Go to Specs" },
      { tab: "cycles", label: "Go to Cycles" },
      { tab: "runs", label: "Go to Runs" },
      { tab: "settings", label: "Go to Settings" },
    ]
    for (const { tab, label } of tabs) {
      if (tab !== activeTab) {
        cmds.push({ id: `nav:${tab}`, label, group: "Navigation", icon: "nav", action: () => navigateToTab(tab) })
      }
    }

    // Per-tab commands
    if (activeTab === "runs") {
      cmds.push({
        id: "select-all",
        label: "Select all runs",
        group: "Actions",
        icon: "select",
        shortcut: "⌘A",
        action: () => {
          const loaded = getLoadedRuns()
          selectionActions.selectAllRuns(loaded.map((run) => run.id))
        },
      })
      if (selectedRunIds.size > 0) {
        cmds.push({
          id: "action:copy-selected-runs",
          label: "Copy selected run IDs",
          sublabel: `${selectedRunIds.size} selected`,
          group: "Actions",
          icon: "copy",
          shortcut: "⌘C",
          action: async () => {
            const loaded = getLoadedRuns()
            const text = loaded
              .filter((run) => selectedRunIds.has(run.id))
              .map((run) => `${run.id} ${run.agent} ${run.status}`)
              .join("\n")
            await navigator.clipboard.writeText(text)
          },
        })
        cmds.push({
          id: "action:clear-run-selection",
          label: "Clear run selection",
          sublabel: `${selectedRunIds.size} selected`,
          group: "Actions",
          icon: "action",
          action: () => selectionActions.clearRuns(),
        })
      }
      cmds.push(
        {
          id: "filter:run-running",
          label: "Filter: Running",
          group: "Filters",
          icon: "filter",
          action: () => setRunFilters({ ...runFilters, status: ["running"] }),
        },
        {
          id: "filter:run-completed",
          label: "Filter: Completed",
          group: "Filters",
          icon: "filter",
          action: () => setRunFilters({ ...runFilters, status: ["completed"] }),
        },
        {
          id: "filter:run-failed",
          label: "Filter: Failed",
          group: "Filters",
          icon: "filter",
          action: () => setRunFilters({ ...runFilters, status: ["failed"] }),
        },
        {
          id: "filter:run-all",
          label: "Filter: Show all runs",
          group: "Filters",
          icon: "filter",
          action: () => setRunFilters({ status: [], agent: "" }),
        },
      )
      // Agent-specific filters
      for (const agent of runsMetadata?.agents ?? []) {
        cmds.push({
          id: `filter:run-agent-${agent}`,
          label: `Filter: Agent "${agent}"`,
          group: "Filters",
          icon: "filter",
          action: () => setRunFilters({ ...runFilters, agent }),
        })
      }
      if (runFilters.agent) {
        cmds.push({
          id: "action:clear-agent",
          label: "Clear agent filter",
          sublabel: runFilters.agent,
          group: "Actions",
          icon: "action",
          action: () => setRunFilters({ ...runFilters, agent: "" }),
        })
      }
      if (selectedRunId) {
        cmds.push({
          id: "action:copy-run",
          label: "Copy run ID & agent",
          sublabel: selectedRunId,
          group: "Actions",
          icon: "copy",
          shortcut: selectedRunIds.size === 0 ? "⌘C" : undefined,
          action: async () => {
            const loaded = getLoadedRuns()
            const run = loaded.find((candidate) => candidate.id === selectedRunId)
            const text = run ? `${run.id} ${run.agent} ${run.status}` : selectedRunId
            await navigator.clipboard.writeText(text)
          },
        })
        cmds.push({
          id: "action:deselect-run",
          label: "Deselect run",
          group: "Actions",
          icon: "action",
          action: () => setSelectedRunId(null),
        })
      }
    }

    return cmds
  }, [activeTab, runFilters, selectedRunId, selectedRunIds, getLoadedRuns, setRunFilters, runsMetadata?.agents])

  useEffect(() => {
    setAppCommands(appCommands)
  }, [appCommands, setAppCommands])

  useEffect(() => {
    // Runs and settings tabs do not provide page-level commands.
    if (activeTab === "runs" || activeTab === "settings") {
      setPageCommands([])
    }
    // Task composer overlay commands should never leak across tabs.
    if (activeTab !== "tasks") {
      setOverlayCommands([])
    }
  }, [activeTab, setPageCommands, setOverlayCommands])
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-900 text-white">
      {/* Header */}
      <header className="flex-shrink-0 px-4 py-2.5">
        <div className="flex max-w-full items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold">tx</h1>
            <nav className="flex gap-1">
              {([
                { id: "tasks", label: "Tasks" },
                { id: "docs", label: "Specs" },
                { id: "cycles", label: "Cycles" },
                { id: "runs", label: "Runs" },
              ] as const).map(({ id, label }) => (
                <Button
                  key={id}
                  size="md"
                  variant={activeTab === id ? "primary" : "ghost"}
                  onClick={() => navigateToTab(id)}
                >
                  {label}
                </Button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="icon-lg"
              variant={activeTab === "settings" ? "primary" : "secondary"}
              onClick={() => navigateToTab("settings")}
              aria-label="Open settings"
              title="Open settings"
              className="rounded-full"
            >
              <SettingsIcon />
              <span className="sr-only">Open settings</span>
            </Button>
            <Button
              size="icon-lg"
              variant="secondary"
              onClick={toggleThemeMode}
              aria-label={`Switch to ${themeMode === "light" ? "dark" : "light"} mode`}
              title={`Switch to ${themeMode === "light" ? "dark" : "light"} mode`}
              className="rounded-full"
            >
              <ThemeToggleIcon themeMode={themeMode} />
              <span className="sr-only">
                Switch to {themeMode === "light" ? "dark" : "light"} mode
              </span>
            </Button>
          </div>
        </div>
      </header>

      {/* Stats — only shown on tasks tab */}
      {activeTab === "tasks" && (
        <div className="flex-shrink-0 px-4 pb-2">
          <Stats />
        </div>
      )}

      {/* Main Content */}
      <main className={`flex min-h-0 flex-1 flex-col ${activeTab === "settings" ? "overflow-y-auto" : "overflow-hidden"}`}>
        {activeTab === "tasks" ? (
          <TasksPage
            key={`tasks:${tabResetKey}`}
            themeMode={themeMode}
            defaultTaskAssigmentType={defaultTaskAssigmentType}
            defaultTaskView={defaultTaskView}
            autoAddStatuses={cycleSettings.autoAddStatuses ?? DEFAULT_CYCLE_SETTINGS.autoAddStatuses}
            newTaskRequestNonce={newTaskRequestNonce}
          />
        ) : activeTab === "docs" ? (
          <DocsPage key={`docs:${tabResetKey}`} />
        ) : activeTab === "runs" ? (
          <div key={`runs:${tabResetKey}`} className="flex h-full w-full overflow-hidden">
            {/* Runs sidebar */}
            <div className="w-80 min-h-0 border-r border-gray-800/80 flex-shrink-0 flex flex-col">
              <div className="px-4 pt-4 pb-3">
                <RunFilters
                  value={runFilters}
                  onChange={setRunFilters}
                  statusCounts={runsMetadata?.statusCounts}
                  availableAgents={runsMetadata?.agents}
                />
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
                <RunsList
                  filters={runFilters}
                  onSelectRun={setSelectedRunId}
                  onEscape={() => setSelectedRunId(null)}
                  selectedIds={selectedRunIds}
                  onToggleSelect={handleToggleRun}
                />
              </div>
            </div>

            {/* Chat View */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {selectedRunId ? (
                <ChatView runId={selectedRunId} />
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <div className="max-w-md rounded-xl border border-dashed border-gray-700/60 bg-gray-900/30 p-6 text-center">
                    <h2 className="text-base font-semibold text-gray-100">Select a run</h2>
                    <p className="mt-2 text-sm text-gray-400">
                      View agent execution transcripts and outcomes.
                    </p>
                    <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-gray-500">
                      <kbd className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-gray-300">j</kbd>
                      <kbd className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-gray-300">k</kbd>
                      <span>to navigate</span>
                      <kbd className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-gray-300">Enter</kbd>
                      <span>to select</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "settings" ? (
          <SettingsPage
            key={`settings:${tabResetKey}`}
            defaultTaskAssigmentType={defaultTaskAssigmentType}
            defaultTaskView={defaultTaskView}
            cycleSettings={cycleSettings}
            isSaving={isSavingSettings}
            errorMessage={settingsSaveError}
            onBack={() => navigateToTab("tasks")}
            onSaveDefaultTaskAssigmentType={(nextType) => {
              void saveDashboardDefaultAssigmentType(nextType)
            }}
            onSaveDefaultTaskView={(nextView) => {
              void saveDashboardDefaultTaskView(nextView)
            }}
            onSaveCycleSettings={(nextSettings) => {
              void saveDashboardCycleSettings(nextSettings)
            }}
          />
        ) : (
          <CyclePage key={`cycles:${tabResetKey}`} themeMode={themeMode} autoAddStatuses={cycleSettings.autoAddStatuses ?? DEFAULT_CYCLE_SETTINGS.autoAddStatuses} />
        )}
      </main>
    </div>
  )
}
