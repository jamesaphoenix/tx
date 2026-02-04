import { useQuery } from "@tanstack/react-query"
import { fetchers, type TaskWithDeps } from "../../api/client"

// Local StatusBadge - matches TaskCard implementation
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

// Mini task card for related tasks (blockedBy, blocks, children)
function RelatedTaskCard({
  task,
  onClick,
}: {
  task: TaskWithDeps
  onClick: () => void
}) {
  return (
    <div
      className="p-2 rounded border border-gray-700 bg-gray-800 hover:bg-gray-700/50 cursor-pointer transition"
      onClick={onClick}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <code className="text-xs text-gray-400">{task.id}</code>
            <span className="text-xs font-medium text-amber-400">[{task.score}]</span>
          </div>
          <h4 className="text-sm text-white truncate">{task.title}</h4>
        </div>
        <StatusBadge status={task.status} />
      </div>
    </div>
  )
}

// Section for related tasks
function RelatedTasksSection({
  title,
  tasks,
  emptyMessage,
  onTaskClick,
  titleColor,
}: {
  title: string
  tasks: TaskWithDeps[]
  emptyMessage: string
  onTaskClick: (taskId: string) => void
  titleColor: string
}) {
  return (
    <div>
      <h3 className={`text-sm font-semibold mb-2 ${titleColor}`}>
        {title} ({tasks.length})
      </h3>
      {tasks.length === 0 ? (
        <p className="text-sm text-gray-500 italic">{emptyMessage}</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <RelatedTaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export interface TaskDetailProps {
  taskId: string
  onNavigateToTask: (taskId: string) => void
}

export function TaskDetail({ taskId, onNavigateToTask }: TaskDetailProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchers.taskDetail(taskId),
    enabled: !!taskId,
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse bg-gray-700 h-8 w-3/4 rounded" />
        <div className="animate-pulse bg-gray-700 h-4 w-1/2 rounded" />
        <div className="animate-pulse bg-gray-700 h-24 rounded" />
        <div className="animate-pulse bg-gray-700 h-32 rounded" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-red-400 p-4">
        Error loading task: {String(error)}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-gray-500 p-4">
        Task not found
      </div>
    )
  }

  const { task, blockedByTasks, blocksTasks, childTasks } = data

  return (
    <div className="space-y-6">
      {/* Task Header */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <code className="text-sm text-gray-400">{task.id}</code>
          <StatusBadge status={task.status} />
          {task.isReady && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-400 border border-blue-500">
              Ready
            </span>
          )}
        </div>
        <h2 className="text-xl font-semibold text-white">{task.title}</h2>
        <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
          <span>
            Score: <span className="text-amber-400 font-medium">{task.score}</span>
          </span>
          {task.parentId && (
            <span>
              Parent:{" "}
              <button
                className="text-blue-400 hover:underline"
                onClick={() => onNavigateToTask(task.parentId!)}
              >
                {task.parentId}
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Description */}
      {task.description && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-2">Description</h3>
          <div className="text-sm text-gray-300 whitespace-pre-wrap bg-gray-800 p-3 rounded-lg border border-gray-700">
            {task.description}
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="text-xs text-gray-500 space-y-1">
        <div>Created: {new Date(task.createdAt).toLocaleString()}</div>
        <div>Updated: {new Date(task.updatedAt).toLocaleString()}</div>
        {task.completedAt && (
          <div>Completed: {new Date(task.completedAt).toLocaleString()}</div>
        )}
      </div>

      <hr className="border-gray-700" />

      {/* Blocked By */}
      <RelatedTasksSection
        title="Blocked By"
        tasks={blockedByTasks}
        emptyMessage="No blockers - this task is unblocked"
        onTaskClick={onNavigateToTask}
        titleColor="text-red-400"
      />

      {/* Blocks */}
      <RelatedTasksSection
        title="Blocks"
        tasks={blocksTasks}
        emptyMessage="Does not block any other tasks"
        onTaskClick={onNavigateToTask}
        titleColor="text-green-400"
      />

      {/* Children */}
      <RelatedTasksSection
        title="Children"
        tasks={childTasks}
        emptyMessage="No child tasks"
        onTaskClick={onNavigateToTask}
        titleColor="text-purple-400"
      />
    </div>
  )
}
