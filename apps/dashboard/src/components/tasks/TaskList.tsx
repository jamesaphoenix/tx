import { useCallback, useRef, useMemo } from "react"
import { useInfiniteTasks, type TaskFilters } from "../../hooks/useInfiniteTasks"
import { useReadyTasks } from "../../hooks/useReadyTasks"
import { useIntersectionObserver } from "../../hooks/useIntersectionObserver"
import { useKeyboardNavigation } from "../../hooks/useKeyboardNavigation"
import { LoadingSkeleton } from "../ui/LoadingSkeleton"
import { EmptyState } from "../ui/EmptyState"
import { TaskCard } from "./TaskCard"

export interface TaskListProps {
  filters?: TaskFilters
  onSelectTask: (taskId: string) => void
  onEscape?: () => void
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

export function TaskList({ filters = {}, onSelectTask, onEscape }: TaskListProps) {
  // Determine which data source to use
  const useReadyEndpoint = useMemo(() => isReadyOnlyFilter(filters), [filters])

  // Ready tasks (non-paginated, all at once)
  const readyResult = useReadyTasks()

  // Paginated tasks (infinite scroll)
  const infiniteResult = useInfiniteTasks(filters)

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

  // Refs for card elements for scrollIntoView
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  // Keyboard navigation
  const handleSelect = useCallback(
    (index: number) => {
      const task = tasks[index]
      if (task) {
        onSelectTask(task.id)
      }
    },
    [tasks, onSelectTask]
  )

  const { focusedIndex } = useKeyboardNavigation({
    itemCount: tasks.length,
    onSelect: handleSelect,
    onEscape,
    enabled: tasks.length > 0,
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
      <div className="space-y-2">
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
    <div className="space-y-2">
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
        {tasks.map((task, index) => (
          <TaskCard
            key={task.id}
            ref={(el) => {
              if (el) {
                cardRefs.current.set(index, el)
              } else {
                cardRefs.current.delete(index)
              }
            }}
            task={task}
            isFocused={index === focusedIndex}
            onClick={() => onSelectTask(task.id)}
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
