import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchers, type ChatMessage } from "./api/client"
import { TaskList } from "./components/tasks"
import { RunsList } from "./components/runs"

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

function ChatMessage({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"
  const isAssistant = message.role === "assistant"
  const isSystem = message.role === "system"
  const isTool = message.type === "tool_use" || message.type === "tool_result"

  if (isTool) {
    return (
      <div className="mx-4 my-2 p-2 bg-gray-800/50 rounded text-xs font-mono">
        <span className="text-purple-400">{message.type}:</span>{" "}
        <span className="text-gray-400">{message.tool_name || "unknown"}</span>
        {message.content != null && (
          <pre className="mt-1 text-gray-500 whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto">
            {typeof message.content === "string"
              ? message.content.slice(0, 500)
              : JSON.stringify(message.content, null, 2).slice(0, 500)}
            {(typeof message.content === "string"
              ? message.content.length
              : JSON.stringify(message.content).length) > 500 && "..."}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} my-2`}>
      <div className={`max-w-[80%] p-3 rounded-lg ${
        isUser ? "bg-blue-600 text-white" :
        isAssistant ? "bg-gray-700 text-gray-100" :
        isSystem ? "bg-yellow-900/30 text-yellow-200 text-xs" :
        "bg-gray-800 text-gray-300"
      }`}>
        <div className="text-xs text-gray-400 mb-1">{message.role}</div>
        <div className="whitespace-pre-wrap text-sm">
          {typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content, null, 2)}
        </div>
      </div>
    </div>
  )
}

function ChatView({ runId }: { runId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => fetchers.runDetail(runId),
    enabled: !!runId,
  })

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

  const run = data?.run
  const messages = data?.messages ?? []

  return (
    <div className="flex flex-col h-full">
      {/* Run Header */}
      {run && (
        <div className="p-4 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center justify-between">
            <div>
              <code className="text-sm text-gray-400">{run.id}</code>
              <span className="ml-2 text-purple-400">{run.agent}</span>
            </div>
            <StatusBadge status={run.status} />
          </div>
          {run.task_id && (
            <div className="text-sm text-gray-300 mt-1">
              Task: <code className="text-xs">{run.task_id}</code>
            </div>
          )}
          {run.summary && (
            <div className="text-sm text-gray-400 mt-2">{run.summary}</div>
          )}
          {run.error_message && (
            <div className="text-sm text-red-400 mt-2">{run.error_message}</div>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            No conversation transcript available
            <div className="text-xs mt-2">
              Transcripts are stored at ~/.claude/projects/...
            </div>
          </div>
        ) : (
          messages.map((msg, i) => <ChatMessage key={i} message={msg} />)
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Stats & Ralph Status
// =============================================================================

function RalphStatus() {
  const { data, isLoading } = useQuery({
    queryKey: ["ralph"],
    queryFn: fetchers.ralph,
  })

  if (isLoading) return <div className="animate-pulse bg-gray-700 h-6 w-32 rounded" />

  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${data?.running ? "bg-green-500 animate-pulse" : "bg-gray-500"}`} />
      <span className="text-sm text-gray-300">
        ralph: {data?.running ? `running (iter ${data.currentIteration})` : "stopped"}
      </span>
    </div>
  )
}

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
        <div className="text-xs text-gray-400">Total Runs</div>
      </div>
    </div>
  )
}

// =============================================================================
// Main App
// =============================================================================

type Tab = "tasks" | "runs"

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("runs")
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [_selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-700 px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between max-w-full">
          <div className="flex items-center gap-6">
            <h1 className="text-xl font-bold">tx Dashboard</h1>
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
                  activeTab === "runs" ? "bg-blue-600" : "bg-gray-700 hover:bg-gray-600"
                }`}
                onClick={() => setActiveTab("runs")}
              >
                Runs
              </button>
            </nav>
          </div>
          <RalphStatus />
        </div>
      </header>

      {/* Stats */}
      <div className="px-6 py-3 border-b border-gray-700 flex-shrink-0">
        <Stats />
      </div>

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden">
        {activeTab === "tasks" ? (
          <div className="flex-1 p-4 overflow-y-auto">
            <TaskList onSelectTask={setSelectedTaskId} />
          </div>
        ) : (
          <>
            {/* Runs List */}
            <div className="w-96 border-r border-gray-700 p-4 overflow-y-auto flex-shrink-0">
              <RunsList onSelectRun={setSelectedRunId} />
            </div>

            {/* Chat View */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {selectedRunId ? (
                <ChatView runId={selectedRunId} />
              ) : (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  Select a run to view conversation
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
