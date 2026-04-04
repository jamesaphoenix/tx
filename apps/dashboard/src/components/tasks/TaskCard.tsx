import { forwardRef, useEffect, useRef, useImperativeHandle } from "react"
import type { TaskWithDeps, OrchestrationStatus } from "../../api/client"
import { canonicalTaskLabelName } from "./TaskPropertySelects"

function OrchestrationBadge({ status }: { status: OrchestrationStatus }) {
  const styles: Record<OrchestrationStatus, string> = {
    unclaimed: "bg-gray-500/20 text-gray-300 border-gray-400/30",
    claimed: "bg-cyan-500/20 text-cyan-200 border-cyan-400/40",
    running: "bg-yellow-500/20 text-yellow-200 border-yellow-400/40",
    lease_expired: "bg-red-500/20 text-red-200 border-red-400/40",
    released: "bg-gray-500/20 text-gray-300 border-gray-400/30",
  }
  return (
    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${styles[status] ?? "bg-gray-500/20 text-gray-300 border-gray-400/30"}`}>
      {status.replace(/_/g, " ")}
    </span>
  )
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  backlog: "bg-gray-500/20 text-gray-300 border-gray-400/30",
  ready: "bg-blue-500/20 text-blue-200 border-blue-400/40",
  planning: "bg-purple-500/20 text-purple-200 border-purple-400/40",
  active: "bg-yellow-500/20 text-yellow-200 border-yellow-400/40",
  blocked: "bg-red-500/20 text-red-200 border-red-400/40",
  review: "bg-orange-500/20 text-orange-200 border-orange-400/40",
  needs_review: "bg-pink-500/20 text-pink-200 border-pink-400/40",
  done: "bg-green-500/20 text-green-200 border-green-400/40",
}

const STATUS_LABELS: Record<string, string> = {
  backlog: "Backlog",
  ready: "Ready",
  planning: "Planning",
  active: "Active",
  blocked: "Blocked",
  review: "Review",
  needs_review: "Needs Review",
  done: "Done",
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE_STYLES[status] ?? "bg-gray-500/20 text-gray-300 border-gray-400/30"}`}>
      {STATUS_LABELS[status] ?? status.replace(/_/g, " ")}
    </span>
  )
}

export interface TaskCardProps {
  task: TaskWithDeps
  isFocused?: boolean
  showFocusRing?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
  onClick?: () => void
  entryIndex?: number
  nestingLevel?: number
  /** When true, hides the status badge (useful in kanban where the column already shows status) */
  compact?: boolean
}

export const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(
  function TaskCard({
    task,
    isFocused = false,
    showFocusRing = true,
    isSelected = false,
    onToggleSelect,
    onClick,
    entryIndex = 0,
    nestingLevel = 0,
    compact = false,
  }, ref) {
    const innerRef = useRef<HTMLDivElement>(null)

    useImperativeHandle(ref, () => innerRef.current!, [])

    useEffect(() => {
      if (isFocused && innerRef.current) {
        innerRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" })
      }
    }, [isFocused])

    const animationDelayMs = Math.min(entryIndex * 22, 220)
    const indentPx = Math.min(Math.max(nestingLevel, 0), 8) * 18
    const hasLabels = task.labels && task.labels.length > 0
    const hasBlockInfo = (task.blockedBy?.length > 0) || (task.blocks?.length > 0)

    return (
      <div
        ref={innerRef}
        className={`rounded-lg border p-3 cursor-pointer transition-all duration-150 animate-task-card-enter shadow-sm ${
          isSelected
            ? "border-blue-500/60 bg-blue-500/5 shadow-blue-500/10"
            : "border-gray-700 bg-gray-900/60 hover:border-gray-600 hover:bg-gray-900/80 hover:shadow-md"
        } ${isFocused && showFocusRing ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-900" : ""}`}
        data-depth={nestingLevel}
        role="button"
        aria-label={`View task: ${task.title}`}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            onClick?.()
          }
        }}
        tabIndex={isFocused ? 0 : -1}
        style={{
          animationDelay: `${animationDelayMs}ms`,
          marginLeft: `${indentPx}px`,
        }}
      >
        {/* Row 1: Title + status badge */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {onToggleSelect && (
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSelect(task.id) }}
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
            <h3 className="truncate text-[13px] font-semibold text-gray-100">{task.title}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!compact && <StatusBadge status={task.status} />}
            {task.orchestrationStatus && task.orchestrationStatus !== "unclaimed" && (
              <OrchestrationBadge status={task.orchestrationStatus} />
            )}
          </div>
        </div>

        {/* Row 2: ID */}
        <div className="mt-1 text-[11px]">
          <code className="text-gray-500">{task.id}</code>
        </div>

        {/* Row 3: Labels */}
        {hasLabels && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {task.labels!.map((label) => (
              <span
                key={label.id}
                className="task-label-badge inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border"
                style={{ '--label-color': label.color } as React.CSSProperties}
              >
                {canonicalTaskLabelName(label.name)}
              </span>
            ))}
          </div>
        )}

        {/* Row 4: Blocked / unblocks info */}
        {hasBlockInfo && (
          <div className="mt-1.5 flex items-center gap-3 text-[11px]">
            {task.blockedBy?.length > 0 && (
              <span className="text-red-400/70">
                Blocked by {task.blockedBy.join(", ")}
              </span>
            )}
            {task.blocks?.length > 0 && (
              <span className="text-green-400/70">
                Unblocks {task.blocks.length}
              </span>
            )}
          </div>
        )}
      </div>
    )
  }
)
