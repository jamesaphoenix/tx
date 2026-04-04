import type { TaskWithDeps } from "../../api/client"
import { TaskCard } from "../tasks/TaskCard"

type TaskStatus =
  | "backlog"
  | "ready"
  | "planning"
  | "active"
  | "blocked"
  | "review"
  | "needs_review"
  | "done"

const TASK_STATUS_ORDER: TaskStatus[] = [
  "backlog",
  "ready",
  "planning",
  "active",
  "blocked",
  "review",
  "needs_review",
  "done",
]

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  ready: "Ready",
  planning: "Planning",
  active: "Active",
  blocked: "Blocked",
  review: "Review",
  needs_review: "Needs Review",
  done: "Done",
}

const STATUS_DOT_CLASS: Record<TaskStatus, string> = {
  backlog: "bg-gray-500",
  ready: "bg-blue-500",
  planning: "bg-purple-500",
  active: "bg-yellow-500",
  blocked: "bg-red-500",
  review: "bg-orange-500",
  needs_review: "bg-pink-500",
  done: "bg-green-500",
}

function isTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUS_ORDER.includes(value as TaskStatus)
}

export interface CycleListViewProps {
  tasks: TaskWithDeps[]
  selectedIds?: Set<string>
  onSelectTask: (id: string) => void
  onToggleSelect?: (id: string) => void
  onRemoveTask: (id: string) => void
}

export function CycleListView({
  tasks,
  selectedIds,
  onSelectTask,
  onToggleSelect,
  onRemoveTask,
}: CycleListViewProps) {
  const tasksByStatus: Record<TaskStatus, TaskWithDeps[]> = {
    backlog: [],
    ready: [],
    planning: [],
    active: [],
    blocked: [],
    review: [],
    needs_review: [],
    done: [],
  }

  for (const task of tasks) {
    if (isTaskStatus(task.status)) {
      tasksByStatus[task.status].push(task)
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-gray-700 px-3 py-6 text-center text-sm text-gray-400">
        No tasks match the current filters.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {TASK_STATUS_ORDER.map((status) => {
        const statusTasks = tasksByStatus[status]
        if (statusTasks.length === 0) return null

        return (
          <div key={status}>
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT_CLASS[status]}`} />
              <span className="font-medium text-gray-300">{STATUS_LABELS[status]}</span>
              <span className="text-gray-500">{statusTasks.length}</span>
            </div>
            <div className="space-y-2">
              {statusTasks.map((task) => (
                <div key={task.id} className="group relative">
                  <TaskCard
                    task={task}
                    compact
                    isSelected={selectedIds?.has(task.id) ?? false}
                    onToggleSelect={onToggleSelect}
                    onClick={() => onSelectTask(task.id)}
                  />
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRemoveTask(task.id)
                    }}
                    className="absolute right-2 top-2 hidden rounded bg-red-500/20 px-2 py-1 text-[11px] font-medium text-red-300 hover:bg-red-500/30 group-hover:block"
                    aria-label={`Remove ${task.title} from cycle`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
