import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import {
  fetchers,
  type ChatMessage,
  type Run,
  type PaginatedRunsResponse,
  type TaskAssigneeType
} from "./api/client"
import { TasksPage } from "./components/tasks"
import { RunsList, RunFilters, useRunFiltersWithUrl } from "./components/runs"
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
    human_needs_to_review: "bg-pink-500",
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
    <div className="text-xs text-gray-500 truncate" title={path}>
      <span className="text-gray-400">{label}:</span> <code className="text-[11px]">{path}</code>
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
    return <div className="text-red-400 p-4">Error loading run: {String(error)}</div>
  }

  return (
    <div className="flex flex-col h-full">
      {/* Run Header */}
      {run && (
        <div className="p-4 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
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
          <button
            onClick={() => setActiveTab("transcript")}
            className={`px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "transcript"
                ? "bg-blue-600 text-white"
                : "bg-gray-900 text-gray-300 hover:bg-gray-800"
            }`}
          >
            Transcript
          </button>
          <button
            onClick={() => setActiveTab("logs")}
            className={`px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "logs"
                ? "bg-blue-600 text-white"
                : "bg-gray-900 text-gray-300 hover:bg-gray-800"
            }`}
          >
            Execution Logs
          </button>
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
        <button
          onClick={() => {
            setAutoScroll(true)
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
          }}
          className="absolute bottom-4 right-4 bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg transition"
        >
          Scroll to bottom
        </button>
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
    <div className="grid grid-cols-6 gap-3">
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
        <div className="text-xl font-bold text-purple-400">{data.learnings}</div>
        <div className="text-xs text-gray-400">Learnings</div>
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

function SettingsPage({
  defaultTaskAssigmentType,
  isSaving,
  errorMessage,
  onSave,
}: {
  defaultTaskAssigmentType: TaskAssigneeType
  isSaving: boolean
  errorMessage: string | null
  onSave: (nextType: TaskAssigneeType) => void
}) {
  const [draftType, setDraftType] = useState<TaskAssigneeType>(defaultTaskAssigmentType)

  useEffect(() => {
    setDraftType(defaultTaskAssigmentType)
  }, [defaultTaskAssigmentType])

  const hasChanges = draftType !== defaultTaskAssigmentType

  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <h2 className="text-xl font-semibold text-white">Settings</h2>
      <p className="mt-1 text-sm text-gray-400">
        Configure dashboard defaults for new task creation.
      </p>

      <section className="mt-6 rounded-xl border border-gray-700 bg-gray-800/70 p-4">
        <h3 className="text-sm font-semibold text-gray-200">Default Task Assignment Type</h3>
        <p className="mt-1 text-xs text-gray-400">
          Applied when creating tasks from the dashboard composer.
        </p>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setDraftType("human")}
            className={`rounded-md border px-3 py-2 text-left text-sm transition ${
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
            className={`rounded-md border px-3 py-2 text-left text-sm transition ${
              draftType === "agent"
                ? "border-blue-500 bg-blue-500/20 text-blue-200"
                : "border-gray-700 bg-gray-900/40 text-gray-300 hover:border-gray-600"
            }`}
          >
            Agent
          </button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={isSaving || !hasChanges}
            onClick={() => onSave(draftType)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSaving ? "Saving..." : "Save settings"}
          </button>
          <span className="text-xs text-gray-500">
            Current default: {defaultTaskAssigmentType}
          </span>
        </div>

        {errorMessage && (
          <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-300">
            {errorMessage}
          </p>
        )}
      </section>
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

  const selectedRunIds = useStore(selectionStore, (s) => s.runIds)

  const queryClient = useQueryClient()

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

  // URL state management for filters
  const { filters: runFilters, setFilters: setRunFilters } = useRunFiltersWithUrl()
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

  const { setAppCommands } = useCommandContext()

  const getLoadedRuns = useCallback((): Run[] => {
    const queries = queryClient.getQueriesData<{ pages: PaginatedRunsResponse[] }>({ queryKey: ["runs", "infinite"] })
    return queries.flatMap(([, data]) => data?.pages?.flatMap(p => p.runs) ?? [])
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
            setActiveTab("tasks")
          }
        },
      },
    ]

    // Tab switching — always available
    const tabs: { tab: Tab; label: string }[] = [
      { tab: "tasks", label: "Go to Tasks" },
      { tab: "docs", label: "Go to Docs" },
      { tab: "runs", label: "Go to Runs" },
      { tab: "cycles", label: "Go to Cycles" },
      { tab: "settings", label: "Go to Settings" },
    ]
    for (const { tab, label } of tabs) {
      if (tab !== activeTab) {
        cmds.push({ id: `nav:${tab}`, label, group: "Navigation", icon: "nav", action: () => setActiveTab(tab) })
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
          selectionActions.selectAllRuns(loaded.map(r => r.id))
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
              .filter(r => selectedRunIds.has(r.id))
              .map(r => `${r.id} ${r.agent} ${r.status}`)
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
        { id: "filter:run-running", label: "Filter: Running", group: "Filters", icon: "filter", action: () => setRunFilters({ ...runFilters, status: ["running"] }) },
        { id: "filter:run-completed", label: "Filter: Completed", group: "Filters", icon: "filter", action: () => setRunFilters({ ...runFilters, status: ["completed"] }) },
        { id: "filter:run-failed", label: "Filter: Failed", group: "Filters", icon: "filter", action: () => setRunFilters({ ...runFilters, status: ["failed"] }) },
        { id: "filter:run-all", label: "Filter: Show all runs", group: "Filters", icon: "filter", action: () => setRunFilters({ status: [], agent: "" }) },
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
            const run = loaded.find(r => r.id === selectedRunId)
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

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-gray-900 text-white">
      {/* Header */}
      <header className="flex-shrink-0 px-4 py-2.5">
        <div className="flex max-w-full items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold">tx</h1>
            <nav className="flex gap-1">
              <button
                className={`px-4 py-1.5 rounded text-sm font-medium transition ${
                  activeTab === "tasks" ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"
                }`}
                onClick={() => setActiveTab("tasks")}
              >
                Tasks
              </button>
              <button
                className={`px-4 py-1.5 rounded text-sm font-medium transition ${
                  activeTab === "docs" ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"
                }`}
                onClick={() => setActiveTab("docs")}
              >
                Docs
              </button>
              <button
                className={`px-4 py-1.5 rounded text-sm font-medium transition ${
                  activeTab === "runs" ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"
                }`}
                onClick={() => setActiveTab("runs")}
              >
                Runs
              </button>
              <button
                className={`px-4 py-1.5 rounded text-sm font-medium transition ${
                  activeTab === "cycles" ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"
                }`}
                onClick={() => setActiveTab("cycles")}
              >
                Cycles
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("settings")}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-full border text-gray-300 transition ${
                activeTab === "settings"
                  ? "border-blue-500 bg-blue-500/20"
                  : "border-gray-700 bg-gray-800 hover:bg-gray-700"
              }`}
              aria-label="Open settings"
              title="Open settings"
            >
              <SettingsIcon />
              <span className="sr-only">Open settings</span>
            </button>
            <button
              type="button"
              onClick={toggleThemeMode}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-700 bg-gray-800 text-gray-300 transition hover:bg-gray-700"
              aria-label={`Switch to ${themeMode === "light" ? "dark" : "light"} mode`}
              title={`Switch to ${themeMode === "light" ? "dark" : "light"} mode`}
            >
              <ThemeToggleIcon themeMode={themeMode} />
              <span className="sr-only">
                Switch to {themeMode === "light" ? "dark" : "light"} mode
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Stats — hidden on cycles tab */}
      {activeTab !== "cycles" && activeTab !== "settings" && (
        <div className="flex-shrink-0 px-4 pb-2">
          <Stats />
        </div>
      )}

      {/* Main Content */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "tasks" ? (
          <TasksPage
            themeMode={themeMode}
            defaultTaskAssigmentType={defaultTaskAssigmentType}
            newTaskRequestNonce={newTaskRequestNonce}
          />
        ) : activeTab === "docs" ? (
          <DocsPage />
        ) : activeTab === "runs" ? (
          <div className="flex h-full w-full overflow-hidden">
            {/* Runs List */}
            <div className="w-72 min-h-0 border-r border-gray-700 p-4 overflow-y-auto flex-shrink-0">
              {/* Run Filters - synced with URL */}
              <div className="mb-4">
                <RunFilters
                  value={runFilters}
                  onChange={setRunFilters}
                  statusCounts={runsMetadata?.statusCounts}
                  availableAgents={runsMetadata?.agents}
                />
              </div>
              <RunsList
                filters={runFilters}
                onSelectRun={setSelectedRunId}
                onEscape={() => setSelectedRunId(null)}
                selectedIds={selectedRunIds}
                onToggleSelect={handleToggleRun}
              />
            </div>

            {/* Chat View */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {selectedRunId ? (
                <ChatView runId={selectedRunId} />
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <div className="text-lg mb-2">Select a run to view details</div>
                    <div className="text-sm">Runs show agent execution transcripts and outcomes</div>
                    <div className="mt-2 text-xs text-gray-500">
                      Use <kbd className="px-2 py-1 bg-gray-800 rounded text-gray-300">j</kbd>/<kbd className="px-2 py-1 bg-gray-800 rounded text-gray-300">k</kbd> or arrow keys to navigate, <kbd className="px-2 py-1 bg-gray-800 rounded text-gray-300">Enter</kbd> to select
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "settings" ? (
          <SettingsPage
            defaultTaskAssigmentType={defaultTaskAssigmentType}
            isSaving={isSavingSettings}
            errorMessage={settingsSaveError}
            onSave={(nextType) => {
              void saveDashboardDefaultAssigmentType(nextType)
            }}
          />
        ) : (
          <CyclePage />
        )}
      </main>
    </div>
  )
}
