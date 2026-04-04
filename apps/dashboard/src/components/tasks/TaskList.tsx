import { useCallback, useEffect, useMemo, useState } from "react"
import { useInfiniteTasks, type TaskFilters } from "../../hooks/useInfiniteTasks"
import { useReadyTasks } from "../../hooks/useReadyTasks"
import { useIntersectionObserver } from "../../hooks/useIntersectionObserver"
import { useKeyboardNavigation } from "../../hooks/useKeyboardNavigation"
import type { TaskWithDeps } from "../../api/client"
import { EmptyState } from "../ui/EmptyState"
import { TaskCard } from "./TaskCard"
import {
  buildTaskClientFilterPredicate,
  hasActiveTaskClientFilters,
  normalizeTaskClientFilters,
  type TaskClientFilters,
} from "./taskClientFilters"

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
  "active",
  "ready",
  "planning",
  "blocked",
  "review",
  "needs_review",
  "backlog",
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

const STATUS_SECTION_COLORS: Record<TaskStatus, { text: string; line: string }> = {
  active: { text: "text-yellow-300", line: "bg-yellow-500/15" },
  ready: { text: "text-blue-300", line: "bg-blue-500/15" },
  planning: { text: "text-purple-300", line: "bg-purple-500/15" },
  blocked: { text: "text-red-300", line: "bg-red-500/15" },
  review: { text: "text-orange-300", line: "bg-orange-500/15" },
  needs_review: { text: "text-pink-300", line: "bg-pink-500/15" },
  backlog: { text: "text-gray-400", line: "bg-gray-500/15" },
  done: { text: "text-green-300", line: "bg-green-500/15" },
}

const STATUS_SET = new Set<string>(TASK_STATUS_ORDER)

function isTaskStatus(value: string): value is TaskStatus {
  return STATUS_SET.has(value)
}

export interface TaskListProps {
  filters?: TaskFilters
  clientFilters?: TaskClientFilters
  onSelectTask: (taskId: string) => void
  onEscape?: () => void
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
}

/**
 * Check if the filter is requesting ready tasks only.
 * When filtering for ready tasks, we fetch ALL of them at once
 * instead of using pagination, since ready tasks should be
 * immediately visible without scrolling.
 */
function isReadyOnlyFilter(filters: TaskFilters): boolean {
  // Only use ready endpoint if filtering exclusively by "ready" status
  // and no search query is active (search requires the paginated endpoint)
  return (
    filters.status?.length === 1 &&
    filters.status[0] === "ready" &&
    !filters.search
  )
}

interface NestedTaskEntry {
  task: TaskWithDeps
  depth: number
}

function buildNestedTaskEntries(tasks: TaskWithDeps[]): NestedTaskEntry[] {
  if (tasks.length <= 1) {
    return tasks.map((task) => ({ task, depth: 0 }))
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const childrenByParent = new Map<string, TaskWithDeps[]>()

  for (const task of tasks) {
    if (!task.parentId || !taskById.has(task.parentId)) {
      continue
    }
    const siblings = childrenByParent.get(task.parentId) ?? []
    siblings.push(task)
    childrenByParent.set(task.parentId, siblings)
  }

  const roots = tasks.filter((task) => !task.parentId || !taskById.has(task.parentId))
  const nested: NestedTaskEntry[] = []
  const visited = new Set<string>()

  const appendWithChildren = (task: TaskWithDeps, depth: number): void => {
    if (visited.has(task.id)) return
    visited.add(task.id)
    nested.push({ task, depth })

    const children = childrenByParent.get(task.id) ?? []
    for (const child of children) {
      appendWithChildren(child, depth + 1)
    }
  }

  for (const root of roots) {
    appendWithChildren(root, 0)
  }

  // Defensive fallback if there is an unexpected cycle in incoming data.
  for (const task of tasks) {
    if (!visited.has(task.id)) {
      appendWithChildren(task, 0)
    }
  }

  return nested
}

export function TaskList({
  filters = {},
  clientFilters,
  onSelectTask,
  onEscape,
  selectedIds,
  onToggleSelect,
}: TaskListProps) {
  const statusMotionKey = useMemo(
    () => (filters.status?.length ? filters.status.join(",") : "all"),
    [filters.status]
  )
  const [isBucketAnimating, setIsBucketAnimating] = useState(false)

  useEffect(() => {
    setIsBucketAnimating(true)
    const timer = window.setTimeout(() => setIsBucketAnimating(false), 220)
    return () => window.clearTimeout(timer)
  }, [statusMotionKey])

  // Determine which data source to use
  const useReadyEndpoint = useMemo(() => isReadyOnlyFilter(filters), [filters])

  // Keep only one query path active to avoid duplicate polling.
  // Ready-only filter uses /api/tasks/ready, all other cases use paginated /api/tasks.
  const readyResult = useReadyTasks({ enabled: useReadyEndpoint })
  const infiniteResult = useInfiniteTasks(filters, { enabled: !useReadyEndpoint })

  // Select the appropriate result based on filter
  const {
    tasks,
    isLoading,
    isError,
    error,
    total,
  } = useReadyEndpoint
    ? {
        tasks: readyResult.tasks,
        isLoading: readyResult.isLoading,
        isError: readyResult.isError,
        error: readyResult.error,
        total: readyResult.total,
      }
    : {
        tasks: infiniteResult.tasks,
        isLoading: infiniteResult.isLoading,
        isError: infiniteResult.isError,
        error: infiniteResult.error,
        total: infiniteResult.total,
      }

  // Pagination controls (only used for infinite scroll mode)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = infiniteResult
  const normalizedClientFilters = useMemo(
    () => normalizeTaskClientFilters(clientFilters),
    [clientFilters]
  )
  const clientFilterPredicate = useMemo(
    () => buildTaskClientFilterPredicate(normalizedClientFilters),
    [normalizedClientFilters]
  )
  const hasClientFilters = useMemo(
    () => hasActiveTaskClientFilters(normalizedClientFilters),
    [normalizedClientFilters]
  )
  const filteredTasks = useMemo(
    () => tasks.filter(clientFilterPredicate),
    [tasks, clientFilterPredicate]
  )

  const nestedTaskEntries = useMemo(() => buildNestedTaskEntries(filteredTasks), [filteredTasks])

  // Group tasks by status for section display
  const tasksByStatus = useMemo(() => {
    const groups: Record<TaskStatus, NestedTaskEntry[]> = {
      active: [], ready: [], planning: [], blocked: [],
      review: [], needs_review: [], backlog: [], done: [],
    }
    for (const entry of nestedTaskEntries) {
      const status = entry.task.status
      if (isTaskStatus(status)) {
        groups[status].push(entry)
      }
    }
    return groups
  }, [nestedTaskEntries])

  // Build flat list for keyboard navigation (ordered by section)
  const flatOrderedEntries = useMemo(() => {
    const entries: NestedTaskEntry[] = []
    for (const status of TASK_STATUS_ORDER) {
      entries.push(...tasksByStatus[status])
    }
    return entries
  }, [tasksByStatus])

  // Keyboard navigation
  const handleSelect = useCallback(
    (index: number) => {
      const task = flatOrderedEntries[index]?.task
      if (task) {
        onSelectTask(task.id)
      }
    },
    [flatOrderedEntries, onSelectTask]
  )

  const { focusedIndex, isKeyboardNavigating } = useKeyboardNavigation({
    itemCount: flatOrderedEntries.length,
    onSelect: handleSelect,
    onEscape,
    enabled: flatOrderedEntries.length > 0,
  })

  // Infinite scroll via intersection observer (only for paginated mode)
  const handleLoadMore = useCallback(() => {
    if (!useReadyEndpoint && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [useReadyEndpoint, hasNextPage, isFetchingNextPage, fetchNextPage])

  const sentinelRef = useIntersectionObserver({
    onIntersect: handleLoadMore,
    enabled: !useReadyEndpoint && hasNextPage && !isFetchingNextPage,
  })

  // Initial loading state
  if (isLoading) {
    return null
  }

  // Error state
  if (isError) {
    return (
      <EmptyState
        icon={<span>⚠️</span>}
        title="Error loading tasks"
        description={error?.message ?? "An unexpected error occurred"}
      />
    )
  }

  // Empty state
  if (tasks.length === 0) {
    return (
      <EmptyState
        icon={<span>📋</span>}
        title="No tasks found"
        description={
          filters.search || filters.status?.length || hasClientFilters
            ? "Try adjusting your filters or search query"
            : "Create your first task with 'tx add'"
        }
      />
    )
  }

  const hasFilteredResults = nestedTaskEntries.length > 0

  // Compute global index for each task in the flat ordered list
  let globalIndex = 0

  return (
    <div className={`space-y-1 ${isBucketAnimating ? "animate-bucket-swap" : ""}`}>
      {/* Header with total count */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-500">
          {hasClientFilters
            ? `${filteredTasks.length} matching of ${tasks.length} loaded`
            : `${total} task${total !== 1 ? "s" : ""}`}
          {!useReadyEndpoint && hasNextPage && !hasClientFilters && " (scroll for more)"}
        </span>
      </div>

      {/* Task sections grouped by status */}
      {hasFilteredResults ? (
        <div className="space-y-4">
          {TASK_STATUS_ORDER.map((status) => {
            const statusEntries = tasksByStatus[status]
            if (statusEntries.length === 0) return null

            const colors = STATUS_SECTION_COLORS[status]
            const startIndex = globalIndex
            globalIndex += statusEntries.length

            return (
              <section key={status}>
                <div className="mb-1.5 flex items-center gap-2">
                  <h2 className={`text-[11px] font-semibold uppercase tracking-wider ${colors.text}`}>
                    {STATUS_LABELS[status]}
                  </h2>
                  <span className="text-[11px] text-gray-600">{statusEntries.length}</span>
                  <span className={`h-px flex-1 ${colors.line}`} />
                </div>
                <div className="space-y-1.5">
                  {statusEntries.map((entry, localIndex) => {
                    const flatIndex = startIndex + localIndex
                    return (
                      <TaskCard
                        key={`${statusMotionKey}-${entry.task.id}`}
                        task={entry.task}
                        nestingLevel={entry.depth}
                        isFocused={flatIndex === focusedIndex}
                        showFocusRing={isKeyboardNavigating && flatIndex === focusedIndex}
                        isSelected={selectedIds?.has(entry.task.id)}
                        onToggleSelect={onToggleSelect}
                        onClick={() => onSelectTask(entry.task.id)}
                        entryIndex={localIndex}
                      />
                    )
                  })}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-sm text-gray-500">
          No tasks in the loaded results match the current filters.
        </div>
      )}

      {/* Sentinel element for infinite scroll (only in paginated mode) */}
      {!useReadyEndpoint && <div ref={sentinelRef} className="h-4" />}

      {/* End of list indicator */}
      {(useReadyEndpoint || !hasNextPage) && hasFilteredResults && (
        <div className="pt-2 text-center text-[11px] text-gray-600">
          {useReadyEndpoint ? "All ready tasks shown" : "End of tasks"}
        </div>
      )}
    </div>
  )
}
