import { useCallback, useEffect, useMemo, useState } from "react"
import { useInfiniteTasks, type TaskFilters } from "../../hooks/useInfiniteTasks"
import { useReadyTasks } from "../../hooks/useReadyTasks"
import { useIntersectionObserver } from "../../hooks/useIntersectionObserver"
import { useKeyboardNavigation } from "../../hooks/useKeyboardNavigation"
import type { TaskWithDeps } from "../../api/client"
import { LoadingSkeleton } from "../ui/LoadingSkeleton"
import { EmptyState } from "../ui/EmptyState"
import { TaskCard } from "./TaskCard"

export interface TaskListProps {
  filters?: TaskFilters
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

export function TaskList({ filters = {}, onSelectTask, onEscape, selectedIds, onToggleSelect }: TaskListProps) {
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

  const nestedTaskEntries = useMemo(() => buildNestedTaskEntries(tasks), [tasks])

  // Keyboard navigation
  const handleSelect = useCallback(
    (index: number) => {
      const task = nestedTaskEntries[index]?.task
      if (task) {
        onSelectTask(task.id)
      }
    },
    [nestedTaskEntries, onSelectTask]
  )

  const { focusedIndex, isKeyboardNavigating } = useKeyboardNavigation({
    itemCount: nestedTaskEntries.length,
    onSelect: handleSelect,
    onEscape,
    enabled: nestedTaskEntries.length > 0,
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
    return (
      <div className={`space-y-2 ${isBucketAnimating ? "animate-bucket-swap" : ""}`}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-300">Tasks</h2>
          <span className="text-sm text-gray-500">Loading...</span>
        </div>
        <LoadingSkeleton count={5} />
      </div>
    )
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
          filters.search || filters.status?.length
            ? "Try adjusting your filters or search query"
            : "Create your first task with 'tx add'"
        }
      />
    )
  }

  return (
    <div className={`space-y-2 ${isBucketAnimating ? "animate-bucket-swap" : ""}`}>
      {/* Header with total count */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-300">
          {useReadyEndpoint ? "Ready Tasks" : "Tasks"}
        </h2>
        <span className="text-sm text-gray-500">
          {total} task{total !== 1 ? "s" : ""}
          {!useReadyEndpoint && hasNextPage && " (scroll for more)"}
        </span>
      </div>

      {/* Task cards */}
      <div className="space-y-2">
        {nestedTaskEntries.map(({ task, depth }, index) => (
          <TaskCard
            key={`${statusMotionKey}-${task.id}`}
            task={task}
            nestingLevel={depth}
            isFocused={index === focusedIndex}
            showFocusRing={isKeyboardNavigating && index === focusedIndex}
            isSelected={selectedIds?.has(task.id)}
            onToggleSelect={onToggleSelect}
            onClick={() => onSelectTask(task.id)}
            entryIndex={index}
          />
        ))}
      </div>

      {/* Sentinel element for infinite scroll (only in paginated mode) */}
      {!useReadyEndpoint && <div ref={sentinelRef} className="h-4" />}

      {/* Loading more indicator (only in paginated mode) */}
      {!useReadyEndpoint && isFetchingNextPage && <LoadingSkeleton count={3} />}

      {/* End of list indicator */}
      {(useReadyEndpoint || !hasNextPage) && tasks.length > 0 && (
        <div className="text-center text-sm text-gray-500 py-4">
          {useReadyEndpoint ? "All ready tasks shown" : "End of tasks"}
        </div>
      )}
    </div>
  )
}
