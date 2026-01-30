import { useQuery } from "@tanstack/react-query"
import { fetchers, type TaskWithDeps, type RalphActivity } from "./api/client"

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
  }
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full text-white ${colors[status] ?? "bg-gray-400"}`}>
      {status}
    </span>
  )
}

function TaskCard({ task }: { task: TaskWithDeps }) {
  return (
    <div className={`p-3 rounded-lg border ${task.isReady ? "border-blue-500 bg-blue-500/10" : "border-gray-700 bg-gray-800"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-xs text-gray-400">{task.id}</code>
            <span className="text-sm font-medium text-amber-400">[{task.score}]</span>
          </div>
          <h3 className="text-sm font-medium text-white truncate">{task.title}</h3>
        </div>
        <StatusBadge status={task.status} />
      </div>
      {task.blockedBy.length > 0 && (
        <div className="mt-2 text-xs text-gray-500">
          Blocked by: {task.blockedBy.join(", ")}
        </div>
      )}
      {task.blocks.length > 0 && (
        <div className="mt-1 text-xs text-green-600">
          Unblocks {task.blocks.length} task(s)
        </div>
      )}
    </div>
  )
}

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

function ActivityFeed({ activities }: { activities: RalphActivity[] }) {
  const statusIcons: Record<string, string> = {
    started: "▶",
    completed: "✓",
    failed: "✗",
  }
  const statusColors: Record<string, string> = {
    started: "text-blue-400",
    completed: "text-green-400",
    failed: "text-red-400",
  }

  return (
    <div className="space-y-2">
      {activities.map((a, i) => (
        <div key={i} className="flex items-start gap-2 text-sm">
          <span className="text-gray-500 font-mono text-xs">
            {new Date(a.timestamp).toLocaleTimeString()}
          </span>
          <span className={statusColors[a.status]}>{statusIcons[a.status]}</span>
          <span className="text-gray-300">
            <code className="text-xs text-gray-400">{a.task}</code>{" "}
            {a.taskTitle}
            {a.agent && <span className="text-gray-500"> ({a.agent})</span>}
          </span>
        </div>
      ))}
      {activities.length === 0 && (
        <div className="text-gray-500 text-sm">No recent activity</div>
      )}
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
    <div className="grid grid-cols-4 gap-4">
      <div className="bg-gray-800 p-4 rounded-lg">
        <div className="text-2xl font-bold text-white">{data.tasks}</div>
        <div className="text-sm text-gray-400">Total Tasks</div>
      </div>
      <div className="bg-gray-800 p-4 rounded-lg">
        <div className="text-2xl font-bold text-blue-400">{data.ready}</div>
        <div className="text-sm text-gray-400">Ready</div>
      </div>
      <div className="bg-gray-800 p-4 rounded-lg">
        <div className="text-2xl font-bold text-green-400">{data.done}</div>
        <div className="text-sm text-gray-400">Done</div>
      </div>
      <div className="bg-gray-800 p-4 rounded-lg">
        <div className="text-2xl font-bold text-purple-400">{data.learnings}</div>
        <div className="text-sm text-gray-400">Learnings</div>
      </div>
    </div>
  )
}

function TaskList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["tasks"],
    queryFn: fetchers.tasks,
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="animate-pulse bg-gray-700 h-20 rounded-lg" />
        ))}
      </div>
    )
  }

  if (error) {
    return <div className="text-red-400">Error loading tasks: {String(error)}</div>
  }

  const readyTasks = data?.tasks.filter(t => t.isReady) ?? []
  const activeTasks = data?.tasks.filter(t => t.status === "active") ?? []
  const blockedTasks = data?.tasks.filter(t => t.status === "blocked") ?? []

  return (
    <div className="space-y-6">
      {activeTasks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-yellow-400 mb-3">
            Active ({activeTasks.length})
          </h2>
          <div className="space-y-2">
            {activeTasks.map(task => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-blue-400 mb-3">
          Ready ({readyTasks.length})
        </h2>
        <div className="space-y-2">
          {readyTasks.slice(0, 10).map(task => (
            <TaskCard key={task.id} task={task} />
          ))}
          {readyTasks.length > 10 && (
            <div className="text-gray-500 text-sm">
              +{readyTasks.length - 10} more ready tasks
            </div>
          )}
        </div>
      </section>

      {blockedTasks.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-red-400 mb-3">
            Blocked ({blockedTasks.length})
          </h2>
          <div className="space-y-2">
            {blockedTasks.slice(0, 5).map(task => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export default function App() {
  const { data: ralphData } = useQuery({
    queryKey: ["ralph"],
    queryFn: fetchers.ralph,
  })

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <h1 className="text-xl font-bold">tx Dashboard</h1>
          <RalphStatus />
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <Stats />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Tasks */}
          <div className="lg:col-span-2">
            <TaskList />
          </div>

          {/* Activity Feed */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h2 className="text-lg font-semibold text-gray-300 mb-4">
              Ralph Activity
            </h2>
            <ActivityFeed activities={ralphData?.recentActivity ?? []} />
          </div>
        </div>
      </main>
    </div>
  )
}
