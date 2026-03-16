import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react"
import { TASK_STATUSES, VALID_TRANSITIONS, type TaskStatus } from "@jamesaphoenix/tx-types/task"
import { fetchers, type TaskWithDeps } from "../../api/client"
import { useInfiniteTasks } from "../../hooks/useInfiniteTasks"
import { Button } from "../ui"
import { EmptyState } from "../ui/EmptyState"
import { TaskCard } from "./TaskCard"
import {
  buildTaskClientFilterPredicate,
  normalizeTaskClientFilters,
  type TaskClientFilters,
} from "./taskClientFilters"

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

const STATUS_HEADER_TEXT: Record<TaskStatus, string> = {
  backlog: "text-gray-400",
  ready: "text-blue-300",
  planning: "text-purple-300",
  active: "text-yellow-300",
  blocked: "text-red-300",
  review: "text-orange-300",
  needs_review: "text-pink-300",
  done: "text-green-300",
}

const INITIAL_DONE_VISIBLE = 5
const DONE_INCREMENT = 10
const DONE_PAGE_SIZE = 5
const STATUS_SET = new Set<string>(TASK_STATUSES as readonly string[])
const NON_DONE_STATUSES = TASK_STATUSES.filter(
  (status): status is Exclude<TaskStatus, "done"> => status !== "done",
)

/** Column display order — puts "Needs Review" before "Review" on the kanban board. */
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

export interface KanbanBoardProps {
  onSelectTask: (id: string) => void
  search?: string
  clientFilters?: TaskClientFilters
}

function isTaskStatus(status: string): status is TaskStatus {
  return STATUS_SET.has(status)
}

function toTimestamp(value: string | null): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function sortByMostRecentCompletion(a: TaskWithDeps, b: TaskWithDeps): number {
  const left = toTimestamp(a.completedAt ?? a.updatedAt)
  const right = toTimestamp(b.completedAt ?? b.updatedAt)
  return right - left
}

function sortByMostRecentUpdate(a: TaskWithDeps, b: TaskWithDeps): number {
  const left = toTimestamp(a.updatedAt)
  const right = toTimestamp(b.updatedAt)
  return right - left
}

export function KanbanBoard({
  onSelectTask,
  search,
  clientFilters,
}: KanbanBoardProps) {
  const [doneVisibleCount, setDoneVisibleCount] = useState(INITIAL_DONE_VISIBLE)
  const [optimisticTasksById, setOptimisticTasksById] = useState<Record<string, TaskWithDeps>>({})
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [activeDropTarget, setActiveDropTarget] = useState<TaskStatus | null>(null)

  const {
    tasks: nonDoneTasks,
    fetchNextPage: fetchNextNonDonePage,
    hasNextPage: nonDoneHasNextPage,
    isFetchingNextPage: isFetchingNextNonDonePage,
    isLoading: isNonDoneLoading,
    isError: isNonDoneError,
    error: nonDoneError,
    refetch: refetchNonDone,
  } = useInfiniteTasks({
    status: [...NON_DONE_STATUSES],
    search,
  })

  const {
    tasks: doneTasks,
    fetchNextPage: fetchNextDonePage,
    hasNextPage: doneHasNextPage,
    isFetchingNextPage: isFetchingNextDonePage,
    isLoading: isDoneLoading,
    isError: isDoneError,
    error: doneError,
    refetch: refetchDone,
    total: doneTotal,
  } = useInfiniteTasks({
    status: ["done"],
    search,
    limit: DONE_PAGE_SIZE,
  })

  useEffect(() => {
    if (!nonDoneHasNextPage || isFetchingNextNonDonePage) return
    void fetchNextNonDonePage()
  }, [fetchNextNonDonePage, nonDoneHasNextPage, isFetchingNextNonDonePage])

  useEffect(() => {
    if (doneTasks.length >= doneVisibleCount) return
    if (!doneHasNextPage || isFetchingNextDonePage) return
    void fetchNextDonePage()
  }, [doneTasks.length, doneVisibleCount, doneHasNextPage, isFetchingNextDonePage, fetchNextDonePage])

  useEffect(() => {
    if (!errorMessage) return
    const timeout = window.setTimeout(() => setErrorMessage(null), 2500)
    return () => window.clearTimeout(timeout)
  }, [errorMessage])

  const normalizedClientFilters = useMemo(
    () => normalizeTaskClientFilters(clientFilters),
    [clientFilters],
  )
  const taskClientFilterPredicate = useMemo(
    () => buildTaskClientFilterPredicate(normalizedClientFilters),
    [normalizedClientFilters],
  )

  const mergedTasksById = useMemo(() => {
    const byId = new Map<string, TaskWithDeps>()
    for (const task of nonDoneTasks) {
      byId.set(task.id, task)
    }
    for (const task of doneTasks) {
      byId.set(task.id, task)
    }
    for (const task of Object.values(optimisticTasksById)) {
      byId.set(task.id, task)
    }
    return byId
  }, [doneTasks, nonDoneTasks, optimisticTasksById])

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

    for (const task of mergedTasksById.values()) {
      if (!isTaskStatus(task.status)) continue
      if (!taskClientFilterPredicate(task)) continue
      grouped[task.status].push(task)
    }

    for (const status of TASK_STATUSES) {
      if (status === "done") {
        grouped[status].sort(sortByMostRecentCompletion)
      } else {
        grouped[status].sort(sortByMostRecentUpdate)
      }
    }

    return grouped
  }, [mergedTasksById, taskClientFilterPredicate])

  const hasClientFilters =
    normalizedClientFilters.assigneeType !== "all" || normalizedClientFilters.labelIds.length > 0
  const doneColumnTotal = hasClientFilters
    ? groupedTasks.done.length
    : Math.max(doneTotal, groupedTasks.done.length)

  const showError = useCallback((message: string) => {
    setErrorMessage(message)
  }, [])

  const moveTaskToStatus = useCallback(
    async (taskId: string, nextStatus: TaskStatus) => {
      const currentTask = mergedTasksById.get(taskId)
      if (!currentTask || !isTaskStatus(currentTask.status)) {
        showError("Could not move task: unknown task status")
        return
      }

      const previousStatus = currentTask.status
      if (previousStatus === nextStatus) {
        return
      }

      const allowedTransitions = VALID_TRANSITIONS[previousStatus]
      if (!allowedTransitions.includes(nextStatus)) {
        showError(`Invalid transition: ${previousStatus} → ${nextStatus}`)
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

      setOptimisticTasksById((current) => ({
        ...current,
        [taskId]: optimisticTask,
      }))

      try {
        await fetchers.updateTask(taskId, { status: nextStatus })
        await Promise.all([refetchNonDone(), refetchDone()])
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
        showError(`Could not move task: ${message}`)
      }
    },
    [mergedTasksById, refetchDone, refetchNonDone, showError],
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

  const handleShowMoreDone = useCallback(() => {
    setDoneVisibleCount((current) => current + DONE_INCREMENT)
  }, [])

  const isLoading = isNonDoneLoading || isDoneLoading
  const hasTasksLoaded = nonDoneTasks.length > 0 || doneTasks.length > 0

  if (isLoading && !hasTasksLoaded) {
    return null
  }

  if ((isNonDoneError || isDoneError) && !hasTasksLoaded) {
    const error = nonDoneError ?? doneError
    return (
      <EmptyState
        icon={<span>⚠️</span>}
        title="Error loading board"
        description={error?.message ?? "An unexpected error occurred"}
      />
    )
  }

  const visibleDoneTasks = groupedTasks.done.slice(0, doneVisibleCount)

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
            const columnTasks = status === "done" ? visibleDoneTasks : groupedTasks[status]
            const columnCount = status === "done" ? doneColumnTotal : groupedTasks[status].length
            const canShowMoreDone = status === "done" && doneVisibleCount < doneColumnTotal

            return (
              <section
                key={status}
                data-testid={`kanban-column-${status}`}
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
                    : "border-gray-800/80 bg-gray-900/40"
                }`}
              >
                <header className="mb-2 flex items-center justify-between gap-2 px-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT_CLASS[status]}`} />
                    <h3 className={`truncate text-[11px] font-semibold uppercase tracking-wider ${STATUS_HEADER_TEXT[status]}`}>{STATUS_LABELS[status]}</h3>
                  </div>
                  <span
                    data-testid={status === "done" ? "kanban-count-done" : undefined}
                    className="shrink-0 text-[11px] text-gray-600"
                  >
                    {columnCount}
                  </span>
                </header>

                <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-0.5 pb-1">
                  {columnTasks.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-800 px-2 py-3 text-[11px] text-gray-600">
                      No tasks
                    </div>
                  ) : (
                    columnTasks.map((task) => (
                      <div
                        key={task.id}
                        data-testid={`kanban-draggable-${task.id}`}
                        draggable
                        onDragStart={(event) => handleDragStart(event, task.id)}
                        onDragEnd={handleDragEnd}
                        className="cursor-grab active:cursor-grabbing"
                      >
                        <TaskCard task={task} compact onClick={() => onSelectTask(task.id)} />
                      </div>
                    ))
                  )}
                </div>

                {canShowMoreDone ? (
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={handleShowMoreDone}
                    disabled={isFetchingNextDonePage}
                    className="mt-2"
                  >
                    {isFetchingNextDonePage ? "Loading..." : "Show more"}
                  </Button>
                ) : null}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
