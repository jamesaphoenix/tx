import { useCallback, useEffect, forwardRef, useImperativeHandle, useRef } from "react"
import { useInfiniteRuns, type RunFilters } from "../../hooks/useInfiniteRuns"
import { useIntersectionObserver } from "../../hooks/useIntersectionObserver"
import { useKeyboardNavigation } from "../../hooks/useKeyboardNavigation"
import { LoadingSkeleton } from "../ui/LoadingSkeleton"
import { EmptyState } from "../ui/EmptyState"
import type { Run } from "../../api/client"

// RunCard component for individual run items
interface RunCardProps {
  run: Run
  isFocused?: boolean
  onClick?: () => void
}

function RunStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
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

const RunCard = forwardRef<HTMLDivElement, RunCardProps>(
  function RunCard({ run, isFocused = false, onClick }, ref) {
    const innerRef = useRef<HTMLDivElement>(null)

    // Expose the inner ref via forwardRef
    useImperativeHandle(ref, () => innerRef.current!, [])

    // Scroll into view when focused via keyboard
    useEffect(() => {
      if (isFocused && innerRef.current) {
        innerRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" })
      }
    }, [isFocused])

    // Format duration if both start and end exist
    const formatDuration = (startedAt: string, endedAt: string | null): string => {
      if (!endedAt) return "running..."
      const start = new Date(startedAt)
      const end = new Date(endedAt)
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return "—"
      const durationMs = end.getTime() - start.getTime()
      const seconds = Math.floor(durationMs / 1000)
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      const remainingSeconds = seconds % 60
      return `${minutes}m ${remainingSeconds}s`
    }

    // Format time ago
    const formatTimeAgo = (date: string): string => {
      if (!date) return "—"
      const now = new Date()
      const then = new Date(date)
      if (isNaN(then.getTime())) return "—"
      const diffMs = now.getTime() - then.getTime()
      const diffMins = Math.floor(diffMs / (1000 * 60))
      if (diffMins < 1) return "just now"
      if (diffMins < 60) return `${diffMins}m ago`
      const diffHours = Math.floor(diffMins / 60)
      if (diffHours < 24) return `${diffHours}h ago`
      const diffDays = Math.floor(diffHours / 24)
      return `${diffDays}d ago`
    }

    const baseClasses = "p-3 rounded-lg border cursor-pointer transition-all"
    const statusClasses =
      run.status === "running"
        ? "border-yellow-500 bg-yellow-500/10"
        : run.status === "failed"
          ? "border-red-500/50 bg-red-500/5"
          : "border-gray-700 bg-gray-800"
    const hoverClasses = "hover:bg-gray-700/50"
    const focusClasses = isFocused
      ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-900"
      : ""

    return (
      <div
        ref={innerRef}
        className={`${baseClasses} ${statusClasses} ${hoverClasses} ${focusClasses}`}
        role="button"
        aria-label={`View run: ${run.taskTitle ?? run.taskId ?? run.id}`}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onClick?.()
          }
        }}
        tabIndex={isFocused ? 0 : -1}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <code className="text-xs text-gray-400">{run.id}</code>
              <span className="text-xs text-gray-500">•</span>
              <span className="text-xs text-gray-400">{run.agent}</span>
            </div>
            {run.taskTitle ? (
              <h3 className="text-sm font-medium text-white truncate">{run.taskTitle}</h3>
            ) : run.taskId ? (
              <h3 className="text-sm font-medium text-gray-400 truncate">Task: {run.taskId}</h3>
            ) : (
              <h3 className="text-sm font-medium text-gray-500 truncate italic">No task</h3>
            )}
          </div>
          <RunStatusBadge status={run.status} />
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
          <span>{formatTimeAgo(run.startedAt)}</span>
          <span>•</span>
          <span>{formatDuration(run.startedAt, run.endedAt)}</span>
          {run.exitCode !== null && run.exitCode !== 0 && (
            <>
              <span>•</span>
              <span className="text-red-400">exit {run.exitCode}</span>
            </>
          )}
        </div>
        {run.summary && (
          <p className="mt-2 text-xs text-gray-400 line-clamp-2">{run.summary}</p>
        )}
        {run.errorMessage && (
          <p className="mt-2 text-xs text-red-400 line-clamp-2">{run.errorMessage}</p>
        )}
      </div>
    )
  }
)

export interface RunsListProps {
  filters?: RunFilters
  onSelectRun: (runId: string) => void
  onEscape?: () => void
}

export function RunsList({ filters = {}, onSelectRun, onEscape }: RunsListProps) {
  const {
    runs,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useInfiniteRuns(filters)

  // Keyboard navigation
  const handleSelect = useCallback(
    (index: number) => {
      const run = runs[index]
      if (run) {
        onSelectRun(run.id)
      }
    },
    [runs, onSelectRun]
  )

  const { focusedIndex } = useKeyboardNavigation({
    itemCount: runs.length,
    onSelect: handleSelect,
    onEscape,
    enabled: runs.length > 0,
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
          <h2 className="text-lg font-semibold text-gray-300">Runs</h2>
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
        title="Error loading runs"
        description={error?.message ?? "An unexpected error occurred"}
      />
    )
  }

  // Empty state
  if (runs.length === 0) {
    return (
      <EmptyState
        icon={<span>🏃</span>}
        title="No runs found"
        description={
          filters.agent || filters.status?.length
            ? "Try adjusting your filters"
            : "Runs will appear here when agents execute tasks"
        }
      />
    )
  }

  return (
    <div className="space-y-2">
      {/* Header with count */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-300">Runs</h2>
        <span className="text-sm text-gray-500">
          {runs.length} run{runs.length !== 1 ? "s" : ""}
          {hasNextPage && " (scroll for more)"}
        </span>
      </div>

      {/* Run cards */}
      <div className="space-y-2">
        {runs.map((run, index) => (
          <RunCard
            key={run.id}
            run={run}
            isFocused={index === focusedIndex}
            onClick={() => onSelectRun(run.id)}
          />
        ))}
      </div>

      {/* Sentinel element for infinite scroll */}
      <div ref={sentinelRef} className="h-4" />

      {/* Loading more indicator */}
      {isFetchingNextPage && <LoadingSkeleton count={3} />}

      {/* End of list indicator */}
      {!hasNextPage && runs.length > 0 && (
        <div className="text-center text-sm text-gray-500 py-4">
          End of runs
        </div>
      )}
    </div>
  )
}
