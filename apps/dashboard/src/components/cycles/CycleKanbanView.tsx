import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react"
import { VALID_TRANSITIONS, type TaskStatus } from "@jamesaphoenix/tx-types/task"
import { fetchers, type TaskWithDeps } from "../../api/client"
import { useQueryClient } from "@tanstack/react-query"
import { TaskCard } from "../tasks/TaskCard"

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

const KANBAN_COLUMN_ORDER: readonly TaskStatus[] = [
  "backlog",
  "ready",
  "planning",
  "active",
  "blocked",
  "needs_review",
  "review",
  "done",
]

function isTaskStatus(status: string): status is TaskStatus {
  return KANBAN_COLUMN_ORDER.includes(status as TaskStatus)
}

export interface CycleKanbanViewProps {
  tasks: TaskWithDeps[]
  cycleId: string
  selectedIds?: Set<string>
  onSelectTask: (id: string) => void
  onToggleSelect?: (id: string) => void
  onRemoveTask: (id: string) => void
}

export function CycleKanbanView({
  tasks,
  cycleId,
  selectedIds,
  onSelectTask,
  onToggleSelect,
  onRemoveTask,
}: CycleKanbanViewProps) {
  const queryClient = useQueryClient()
  const [optimisticTasksById, setOptimisticTasksById] = useState<Record<string, TaskWithDeps>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [activeDropTarget, setActiveDropTarget] = useState<TaskStatus | null>(null)

  useEffect(() => {
    if (!errorMessage) return
    const timeout = window.setTimeout(() => setErrorMessage(null), 2500)
    return () => window.clearTimeout(timeout)
  }, [errorMessage])

  const tasksById = useMemo(() => {
    const byId = new Map<string, TaskWithDeps>()
    for (const task of tasks) {
      byId.set(task.id, task)
    }
    for (const task of Object.values(optimisticTasksById)) {
      byId.set(task.id, task)
    }
    return byId
  }, [tasks, optimisticTasksById])

  const groupedTasks = useMemo(() => {
    const grouped: Record<TaskStatus, TaskWithDeps[]> = {
      backlog: [],
      ready: [],
      planning: [],
      active: [],
      blocked: [],
      review: [],
      needs_review: [],
      done: [],
    }

    for (const task of tasksById.values()) {
      if (isTaskStatus(task.status)) {
        grouped[task.status].push(task)
      }
    }

    return grouped
  }, [tasksById])

  const moveTaskToStatus = useCallback(
    async (taskId: string, nextStatus: TaskStatus) => {
      const currentTask = tasksById.get(taskId)
      if (!currentTask || !isTaskStatus(currentTask.status)) {
        setErrorMessage("Could not move task: unknown task status")
        return
      }

      const previousStatus = currentTask.status
      if (previousStatus === nextStatus) return

      const allowedTransitions = VALID_TRANSITIONS[previousStatus]
      if (!allowedTransitions.includes(nextStatus)) {
        setErrorMessage(`Invalid transition: ${previousStatus} → ${nextStatus}`)
        return
      }

      const nowIso = new Date().toISOString()
      const optimisticTask: TaskWithDeps = {
        ...currentTask,
        status: nextStatus,
        updatedAt: nowIso,
        completedAt:
          nextStatus === "done"
            ? nowIso
            : previousStatus === "done"
              ? null
              : currentTask.completedAt,
      }

      setOptimisticTasksById((current) => ({ ...current, [taskId]: optimisticTask }))

      try {
        await fetchers.updateTask(taskId, { status: nextStatus })
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["cycles"] }),
          queryClient.invalidateQueries({ queryKey: ["cycles", cycleId] }),
        ])
        setOptimisticTasksById((current) => {
          const { [taskId]: _removed, ...rest } = current
          return rest
        })
      } catch (error) {
        setOptimisticTasksById((current) => {
          const { [taskId]: _removed, ...rest } = current
          return rest
        })
        const message = error instanceof Error ? error.message : "unknown error"
        setErrorMessage(`Could not move task: ${message}`)
      }
    },
    [tasksById, cycleId, queryClient],
  )

  const handleDragStart = useCallback((event: DragEvent<HTMLDivElement>, taskId: string) => {
    event.dataTransfer.setData("text/plain", taskId)
    event.dataTransfer.effectAllowed = "move"
    setDraggedTaskId(taskId)
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggedTaskId(null)
    setActiveDropTarget(null)
  }, [])

  const handleDragOver = useCallback((event: DragEvent<HTMLElement>, status: TaskStatus) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    if (activeDropTarget !== status) {
      setActiveDropTarget(status)
    }
  }, [activeDropTarget])

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>, status: TaskStatus) => {
      event.preventDefault()
      const droppedTaskId = event.dataTransfer.getData("text/plain") || draggedTaskId
      setActiveDropTarget(null)
      setDraggedTaskId(null)
      if (!droppedTaskId) return
      void moveTaskToStatus(droppedTaskId, status)
    },
    [draggedTaskId, moveTaskToStatus],
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {errorMessage ? (
        <div
          role="status"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300"
        >
          {errorMessage}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-x-auto pb-2">
        <div className="flex h-full min-h-0 gap-3 pr-2">
          {KANBAN_COLUMN_ORDER.map((status) => {
            const columnTasks = groupedTasks[status]

            return (
              <section
                key={status}
                onDragOver={(event) => handleDragOver(event, status)}
                onDrop={(event) => handleDrop(event, status)}
                onDragLeave={() => {
                  if (activeDropTarget === status) {
                    setActiveDropTarget(null)
                  }
                }}
                className={`flex min-w-[250px] max-w-[340px] flex-1 min-h-0 flex-col rounded-lg border p-2 transition ${
                  activeDropTarget === status
                    ? "border-blue-400/70 ring-2 ring-blue-500/40"
                    : "border-gray-700 bg-gray-900/50"
                }`}
              >
                <header className="mb-2 flex items-center justify-between gap-2 px-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[status]}`} />
                    <h3 className="truncate text-sm font-semibold text-gray-100">{STATUS_LABELS[status]}</h3>
                  </div>
                  <span className="shrink-0 rounded-full bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-300">
                    {columnTasks.length}
                  </span>
                </header>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-1 pb-1">
                  {columnTasks.length === 0 ? (
                    <div className="rounded-md border border-dashed border-gray-700 px-2 py-3 text-xs text-gray-500">
                      No tasks
                    </div>
                  ) : (
                    columnTasks.map((task) => (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={(event) => handleDragStart(event, task.id)}
                        onDragEnd={handleDragEnd}
                        className="group relative cursor-grab active:cursor-grabbing"
                      >
                        <TaskCard
                          task={task}
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
                          className="absolute right-1 top-1 hidden rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-300 hover:bg-red-500/30 group-hover:block"
                          aria-label={`Remove ${task.title} from cycle`}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
