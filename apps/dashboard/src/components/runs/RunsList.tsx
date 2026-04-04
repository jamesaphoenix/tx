import { useCallback, useEffect, forwardRef, useImperativeHandle, useRef, useMemo } from "react"
import { useInfiniteRuns, type RunFilters } from "../../hooks/useInfiniteRuns"
import { useIntersectionObserver } from "../../hooks/useIntersectionObserver"
import { useKeyboardNavigation } from "../../hooks/useKeyboardNavigation"
import { LoadingSkeleton } from "../ui/LoadingSkeleton"
import { EmptyState } from "../ui/EmptyState"
import type { Run } from "../../api/client"

// ---------------------------------------------------------------------------
// Status styling
// ---------------------------------------------------------------------------

type RunStatus = "running" | "completed" | "failed" | "timeout" | "cancelled"

const RUN_STATUS_ORDER: RunStatus[] = ["running", "failed", "timeout", "completed", "cancelled"]

const STATUS_LABELS: Record<RunStatus, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  timeout: "Timeout",
  cancelled: "Cancelled",
}

const STATUS_SECTION_COLORS: Record<RunStatus, { text: string; line: string }> = {
  running: { text: "text-yellow-300", line: "bg-yellow-500/15" },
  completed: { text: "text-green-300", line: "bg-green-500/15" },
  failed: { text: "text-red-300", line: "bg-red-500/15" },
  timeout: { text: "text-orange-300", line: "bg-orange-500/15" },
  cancelled: { text: "text-gray-400", line: "bg-gray-500/15" },
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  running: "bg-yellow-500/20 text-yellow-200 border-yellow-400/40",
  completed: "bg-green-500/20 text-green-200 border-green-400/40",
  failed: "bg-red-500/20 text-red-200 border-red-400/40",
  timeout: "bg-orange-500/20 text-orange-200 border-orange-400/40",
  cancelled: "bg-gray-500/20 text-gray-300 border-gray-400/30",
}

const RUN_STATUS_SET = new Set<string>(RUN_STATUS_ORDER)

function isRunStatus(value: string): value is RunStatus {
  return RUN_STATUS_SET.has(value)
}

// ---------------------------------------------------------------------------
// RunStatusBadge
// ---------------------------------------------------------------------------

function RunStatusBadge({ status }: { status: string }) {
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE_STYLES[status] ?? "bg-gray-500/20 text-gray-300 border-gray-400/30"}`}>
      {STATUS_LABELS[status as RunStatus] ?? status}
    </span>
  )
}

// ---------------------------------------------------------------------------
// RunCard
// ---------------------------------------------------------------------------

interface RunCardProps {
  run: Run
  isFocused?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  onClick?: () => void
}

const RunCard = forwardRef<HTMLDivElement, RunCardProps>(
  function RunCard({ run, isFocused = false, isSelected = false, onToggleSelect, onClick }, ref) {
    const innerRef = useRef<HTMLDivElement>(null)

    useImperativeHandle(ref, () => innerRef.current!, [])

    useEffect(() => {
      if (isFocused && innerRef.current) {
        innerRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" })
      }
    }, [isFocused])

    const formatDuration = (startedAt: string, endedAt: string | null): string => {
      if (!endedAt) return "running..."
      const start = new Date(startedAt)
      const end = new Date(endedAt)
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return "\u2014"
      const durationMs = end.getTime() - start.getTime()
      const seconds = Math.floor(durationMs / 1000)
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      const remainingSeconds = seconds % 60
      return `${minutes}m ${remainingSeconds}s`
    }

    const formatTimeAgo = (date: string): string => {
      if (!date) return "\u2014"
      const now = new Date()
      const then = new Date(date)
      if (isNaN(then.getTime())) return "\u2014"
      const diffMs = now.getTime() - then.getTime()
      const diffMins = Math.floor(diffMs / (1000 * 60))
      if (diffMins < 1) return "just now"
      if (diffMins < 60) return `${diffMins}m ago`
      const diffHours = Math.floor(diffMins / 60)
      if (diffHours < 24) return `${diffHours}h ago`
      const diffDays = Math.floor(diffHours / 24)
      return `${diffDays}d ago`
    }

    return (
      <div
        ref={innerRef}
        className={`rounded-lg border p-3 cursor-pointer transition-all duration-150 ${
          isSelected
            ? "border-blue-500/60 bg-blue-500/5"
            : "border-gray-800/80 bg-gray-900/40 hover:border-gray-700 hover:bg-gray-900/70"
        } ${isFocused ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-900" : ""}`}
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
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {onToggleSelect && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSelect(run.id) }}
                className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition ${
                  isSelected
                    ? "bg-blue-500 border-blue-500 text-white"
                    : "border-gray-600 hover:border-blue-400"
                }`}
              >
                {isSelected && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                )}
              </button>
            )}
            {run.taskTitle ? (
              <h3 className="truncate text-[13px] font-semibold text-gray-100">{run.taskTitle}</h3>
            ) : run.taskId ? (
              <h3 className="truncate text-[13px] font-semibold text-gray-400">Task: {run.taskId}</h3>
            ) : (
              <h3 className="truncate text-[13px] font-semibold text-gray-500 italic">No task</h3>
            )}
          </div>
          <RunStatusBadge status={run.status} />
        </div>

        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-gray-500">
          <code className="text-gray-500">{run.id}</code>
          <span className="text-gray-600">{run.agent}</span>
          <span className="ml-auto">{formatTimeAgo(run.startedAt)}</span>
          <span>{formatDuration(run.startedAt, run.endedAt)}</span>
          {run.exitCode !== null && run.exitCode !== 0 && (
            <span className="text-red-400/70">exit {run.exitCode}</span>
          )}
        </div>

        {run.summary && (
          <p className="mt-1.5 text-[11px] text-gray-400 line-clamp-2">{run.summary}</p>
        )}
        {run.errorMessage && (
          <p className="mt-1.5 text-[11px] text-red-400/80 line-clamp-2">{run.errorMessage}</p>
        )}
      </div>
    )
  }
)

// ---------------------------------------------------------------------------
// RunsList
// ---------------------------------------------------------------------------

export interface RunsListProps {
  filters?: RunFilters
  onSelectRun: (runId: string) => void
  onEscape?: () => void
  selectedIds?: Set<string>
  onToggleSelect?: (id: string) => void
}

export function RunsList({ filters = {}, onSelectRun, onEscape, selectedIds, onToggleSelect }: RunsListProps) {
  const {
    runs,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useInfiniteRuns(filters)

  // Group runs by status for section display
  const runsByStatus = useMemo(() => {
    const groups: Record<RunStatus, Run[]> = {
      running: [], completed: [], failed: [], timeout: [], cancelled: [],
    }
    for (const run of runs) {
      if (isRunStatus(run.status)) {
        groups[run.status].push(run)
      }
    }
    return groups
  }, [runs])

  // Build flat list for keyboard navigation (ordered by section)
  const flatOrderedRuns = useMemo(() => {
    const result: Run[] = []
    for (const status of RUN_STATUS_ORDER) {
      result.push(...runsByStatus[status])
    }
    return result
  }, [runsByStatus])

  // Keyboard navigation
  const handleSelect = useCallback(
    (index: number) => {
      const run = flatOrderedRuns[index]
      if (run) {
        onSelectRun(run.id)
      }
    },
    [flatOrderedRuns, onSelectRun]
  )

  const { focusedIndex } = useKeyboardNavigation({
    itemCount: flatOrderedRuns.length,
    onSelect: handleSelect,
    onEscape,
    enabled: flatOrderedRuns.length > 0,
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

  // Render with section grouping
  let globalIndex = 0

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-gray-500">
          {runs.length} run{runs.length !== 1 ? "s" : ""}
          {hasNextPage && " (scroll for more)"}
        </span>
      </div>

      {/* Run sections grouped by status */}
      <div className="space-y-4">
        {RUN_STATUS_ORDER.map((status) => {
          const statusRuns = runsByStatus[status]
          if (statusRuns.length === 0) return null

          const colors = STATUS_SECTION_COLORS[status]
          const startIndex = globalIndex
          globalIndex += statusRuns.length

          return (
            <section key={status}>
              <div className="mb-1.5 flex items-center gap-2">
                <h2 className={`text-[11px] font-semibold uppercase tracking-wider ${colors.text}`}>
                  {STATUS_LABELS[status]}
                </h2>
                <span className="text-[11px] text-gray-600">{statusRuns.length}</span>
                <span className={`h-px flex-1 ${colors.line}`} />
              </div>
              <div className="space-y-1.5">
                {statusRuns.map((run, localIndex) => (
                  <RunCard
                    key={run.id}
                    run={run}
                    isFocused={startIndex + localIndex === focusedIndex}
                    isSelected={selectedIds?.has(run.id)}
                    onToggleSelect={onToggleSelect}
                    onClick={() => onSelectRun(run.id)}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {/* Sentinel element for infinite scroll */}
      <div ref={sentinelRef} className="h-4" />

      {/* Loading more indicator */}
      {isFetchingNextPage && <LoadingSkeleton count={3} />}

      {/* End of list indicator */}
      {!hasNextPage && runs.length > 0 && (
        <div className="pt-2 text-center text-[11px] text-gray-600">
          End of runs
        </div>
      )}
    </div>
  )
}
