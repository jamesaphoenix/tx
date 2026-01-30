import { useCallback, useRef } from "react"
import { useInfiniteTasks, type TaskFilters } from "../../hooks/useInfiniteTasks"
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

export function TaskList({ filters = {}, onSelectTask, onEscape }: TaskListProps) {
  const {
    tasks,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    total,
  } = useInfiniteTasks(filters)

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

  // Infinite scroll via intersection observer
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const sentinelRef = useIntersectionObserver({
    onIntersect: handleLoadMore,
    enabled: hasNextPage && !isFetchingNextPage,
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
        <h2 className="text-lg font-semibold text-gray-300">Tasks</h2>
        <span className="text-sm text-gray-500">
          {total} task{total !== 1 ? "s" : ""}
          {hasNextPage && " (scroll for more)"}
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

      {/* Sentinel element for infinite scroll */}
      <div ref={sentinelRef} className="h-4" />

      {/* Loading more indicator */}
      {isFetchingNextPage && <LoadingSkeleton count={3} />}

      {/* End of list indicator */}
      {!hasNextPage && tasks.length > 0 && (
        <div className="text-center text-sm text-gray-500 py-4">
          End of tasks
        </div>
      )}
    </div>
  )
}
