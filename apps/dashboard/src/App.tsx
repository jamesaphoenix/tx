import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { fetchers, type ChatMessage, type TaskWithDeps, type PaginatedTasksResponse, type Run, type PaginatedRunsResponse } from "./api/client"
import { TaskList, TaskFilters, TaskDetail, useTaskFiltersWithUrl } from "./components/tasks"
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

function ChatView({ runId }: { runId: string }) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

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
  const isRunning = run?.status === "running"

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [messages.length, autoScroll])

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
          {run.transcriptPath && (
            <div className="text-xs text-gray-500 mt-1 truncate" title={run.transcriptPath}>
              Transcript: {run.transcriptPath}
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

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-2"
      >
        {messages.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            {isRunning ? (
              <>
                <div className="animate-pulse">Waiting for transcript...</div>
                <div className="text-xs mt-2">
                  The conversation will appear here as the agent works
                </div>
              </>
            ) : (
              <>
                No conversation transcript available
                <div className="text-xs mt-2">
                  {run?.transcriptPath
                    ? "Transcript file could not be read"
                    : "No transcript path associated with this run"
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
        )}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && messages.length > 0 && (
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
      <div className="bg-gray-800 p-3 rounded-lg">
        <div className="text-xl font-bold text-white">{data.tasks}</div>
        <div className="text-xs text-gray-400">Tasks</div>
      </div>
      <div className="bg-gray-800 p-3 rounded-lg">
        <div className="text-xl font-bold text-blue-400">{data.ready}</div>
        <div className="text-xs text-gray-400">Ready</div>
      </div>
      <div className="bg-gray-800 p-3 rounded-lg">
        <div className="text-xl font-bold text-green-400">{data.done}</div>
        <div className="text-xs text-gray-400">Done</div>
      </div>
      <div className="bg-gray-800 p-3 rounded-lg">
        <div className="text-xl font-bold text-purple-400">{data.learnings}</div>
        <div className="text-xs text-gray-400">Learnings</div>
      </div>
      <div className="bg-gray-800 p-3 rounded-lg">
        <div className="text-xl font-bold text-yellow-400">{data.runsRunning ?? 0}</div>
        <div className="text-xs text-gray-400">Running</div>
      </div>
      <div className="bg-gray-800 p-3 rounded-lg">
        <div className="text-xl font-bold text-gray-400">{data.runsTotal ?? 0}</div>
        <div className="text-xs text-gray-400">Runs</div>
      </div>
    </div>
  )
}

// =============================================================================
// Main App
// =============================================================================

type Tab = "docs" | "tasks" | "runs" | "cycles"

export default function App() {
  return (
    <CommandProvider>
      <AppContent />
      <CommandPalette />
    </CommandProvider>
  )
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<Tab>("docs")
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  const selectedTaskIds = useStore(selectionStore, (s) => s.taskIds)
  const selectedRunIds = useStore(selectionStore, (s) => s.runIds)

  const queryClient = useQueryClient()

  const handleToggleTask = useCallback((id: string) => {
    selectionActions.toggleTask(id)
  }, [])

  const handleToggleRun = useCallback((id: string) => {
    selectionActions.toggleRun(id)
  }, [])

  // URL state management for filters
  const { filters: taskFilters, setFilters: setTaskFilters } = useTaskFiltersWithUrl()
  const { filters: runFilters, setFilters: setRunFilters } = useRunFiltersWithUrl()

  const { setAppCommands } = useCommandContext()

  // Fetch stats for task status counts
  const { data: statsData } = useQuery({
    queryKey: ["stats"],
    queryFn: fetchers.stats,
    staleTime: 5000,
  })

  // Helper: read all loaded items from infinite query cache
  // This ensures CMD+A/CMD+C work with ALL items loaded via scroll, not just the first page
  const getLoadedTasks = useCallback((): TaskWithDeps[] => {
    const queries = queryClient.getQueriesData<{ pages: PaginatedTasksResponse[] }>({ queryKey: ["tasks", "infinite"] })
    return queries.flatMap(([, data]) => data?.pages?.flatMap(p => p.tasks) ?? [])
  }, [queryClient])

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

  // Task status counts from stats endpoint
  const taskStatusCounts = statsData
    ? {
        ready: statsData.ready,
        done: statsData.done,
      }
    : {}

  // Register app-level commands (global + per-tab)
  const appCommands = useMemo((): Command[] => {
    const cmds: Command[] = []

    // Tab switching — always available
    const tabs: { tab: Tab; label: string }[] = [
      { tab: "docs", label: "Go to Docs" },
      { tab: "tasks", label: "Go to Tasks" },
      { tab: "runs", label: "Go to Runs" },
      { tab: "cycles", label: "Go to Cycles" },
    ]
    for (const { tab, label } of tabs) {
      if (tab !== activeTab) {
        cmds.push({ id: `nav:${tab}`, label, group: "Navigation", icon: "nav", action: () => setActiveTab(tab) })
      }
    }

    // Per-tab commands
    if (activeTab === "tasks") {
      cmds.push({
        id: "select-all",
        label: "Select all tasks",
        group: "Actions",
        icon: "select",
        shortcut: "⌘A",
        action: () => {
          const loaded = getLoadedTasks()
          selectionActions.selectAllTasks(loaded.map(t => t.id))
        },
      })
      if (selectedTaskIds.size > 0) {
        cmds.push({
          id: "action:copy-selected-tasks",
          label: "Copy selected task IDs",
          sublabel: `${selectedTaskIds.size} selected`,
          group: "Actions",
          icon: "copy",
          shortcut: "⌘C",
          action: async () => {
            const loaded = getLoadedTasks()
            const text = loaded
              .filter(t => selectedTaskIds.has(t.id))
              .map(t => `${t.id} [${t.score}] ${t.title}`)
              .join("\n")
            await navigator.clipboard.writeText(text)
          },
        })
        cmds.push({
          id: "action:delete-selected-tasks",
          label: "Delete selected tasks",
          sublabel: `${selectedTaskIds.size} selected`,
          group: "Actions",
          icon: "delete",
          action: async () => {
            if (confirm(`Delete ${selectedTaskIds.size} selected task(s)? This cannot be undone.`)) {
              for (const id of selectedTaskIds) {
                await fetchers.deleteTask(id)
              }
              selectionActions.clearTasks()
              queryClient.invalidateQueries({ queryKey: ["tasks"] })
              queryClient.invalidateQueries({ queryKey: ["stats"] })
            }
          },
        })
        cmds.push({
          id: "action:clear-task-selection",
          label: "Clear task selection",
          sublabel: `${selectedTaskIds.size} selected`,
          group: "Actions",
          icon: "action",
          action: () => selectionActions.clearTasks(),
        })
      }
      cmds.push(
        { id: "filter:task-ready", label: "Filter: Ready tasks", group: "Filters", icon: "filter", action: () => setTaskFilters({ ...taskFilters, status: ["ready"] }) },
        { id: "filter:task-active", label: "Filter: Active tasks", group: "Filters", icon: "filter", action: () => setTaskFilters({ ...taskFilters, status: ["active"] }) },
        { id: "filter:task-blocked", label: "Filter: Blocked tasks", group: "Filters", icon: "filter", action: () => setTaskFilters({ ...taskFilters, status: ["blocked"] }) },
        { id: "filter:task-done", label: "Filter: Done tasks", group: "Filters", icon: "filter", action: () => setTaskFilters({ ...taskFilters, status: ["done"] }) },
        { id: "filter:task-all", label: "Filter: Show all tasks", group: "Filters", icon: "filter", action: () => setTaskFilters({ status: [], search: "" }) },
      )
      if (taskFilters.search) {
        cmds.push({ id: "action:clear-search", label: "Clear search", sublabel: `"${taskFilters.search}"`, group: "Actions", icon: "action", action: () => setTaskFilters({ ...taskFilters, search: "" }) })
      }
      if (selectedTaskId) {
        cmds.push({
          id: "action:copy-task",
          label: "Copy task ID & title",
          sublabel: selectedTaskId,
          group: "Actions",
          icon: "copy",
          shortcut: selectedTaskIds.size === 0 ? "⌘C" : undefined,
          action: async () => {
            const loaded = getLoadedTasks()
            const task = loaded.find(t => t.id === selectedTaskId)
            const text = task ? `${task.id} ${task.title}` : selectedTaskId
            await navigator.clipboard.writeText(text)
          },
        })
        cmds.push({
          id: "action:deselect-task",
          label: "Deselect task",
          group: "Actions",
          icon: "action",
          action: () => setSelectedTaskId(null),
        })
      }
    }

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
  }, [activeTab, taskFilters, runFilters, selectedTaskId, selectedRunId, selectedTaskIds, selectedRunIds, getLoadedTasks, getLoadedRuns, setTaskFilters, setRunFilters, runsMetadata?.agents])

  useEffect(() => {
    setAppCommands(appCommands)
  }, [appCommands, setAppCommands])

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-700 px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between max-w-full">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold">tx</h1>
            <nav className="flex gap-1">
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
                  activeTab === "tasks" ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"
                }`}
                onClick={() => setActiveTab("tasks")}
              >
                Tasks
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
        </div>
      </header>

      {/* Stats — hidden on cycles tab */}
      {activeTab !== "cycles" && (
        <div className="px-6 py-3 border-b border-gray-700 flex-shrink-0">
          <Stats />
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {activeTab === "docs" ? (
          <DocsPage />
        ) : activeTab === "tasks" ? (
          <>
            {/* Tasks List */}
            <div className="w-96 border-r border-gray-700 p-4 overflow-y-auto flex-shrink-0">
              {/* Task Filters - synced with URL */}
              <div className="mb-4">
                <TaskFilters
                  value={taskFilters}
                  onChange={setTaskFilters}
                  statusCounts={taskStatusCounts}
                />
              </div>
              <TaskList
                filters={taskFilters}
                onSelectTask={setSelectedTaskId}
                onEscape={() => setSelectedTaskId(null)}
                selectedIds={selectedTaskIds}
                onToggleSelect={handleToggleTask}
              />
            </div>

            {/* Task Detail */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {selectedTaskId ? (
                <div className="flex-1 overflow-y-auto p-4">
                  <TaskDetail
                    taskId={selectedTaskId}
                    onNavigateToTask={setSelectedTaskId}
                  />
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <div className="text-lg mb-2">Select a task to view details</div>
                    <div className="text-sm">
                      Use <kbd className="px-2 py-1 bg-gray-800 rounded text-gray-300">j</kbd>/<kbd className="px-2 py-1 bg-gray-800 rounded text-gray-300">k</kbd> or arrow keys to navigate, <kbd className="px-2 py-1 bg-gray-800 rounded text-gray-300">Enter</kbd> to select
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : activeTab === "runs" ? (
          <>
            {/* Runs List */}
            <div className="w-96 border-r border-gray-700 p-4 overflow-y-auto flex-shrink-0">
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
            <div className="flex-1 flex flex-col overflow-hidden">
              {selectedRunId ? (
                <ChatView runId={selectedRunId} />
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <div className="text-lg mb-2">Select a run to view conversation</div>
                    <div className="text-sm">
                      Use <kbd className="px-2 py-1 bg-gray-800 rounded text-gray-300">j</kbd>/<kbd className="px-2 py-1 bg-gray-800 rounded text-gray-300">k</kbd> or arrow keys to navigate, <kbd className="px-2 py-1 bg-gray-800 rounded text-gray-300">Enter</kbd> to select
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <CyclePage />
        )}
      </main>
    </div>
  )
}
