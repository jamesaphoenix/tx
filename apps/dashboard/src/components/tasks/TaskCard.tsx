import { forwardRef, useEffect, useRef, useImperativeHandle } from "react"
import type { TaskWithDeps } from "../../api/client"
import { canonicalTaskLabelName } from "./TaskPropertySelects"

// Local StatusBadge - TODO: extract to ui/StatusBadge.tsx
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    backlog: "bg-gray-500",
    ready: "bg-blue-500",
    planning: "bg-purple-500",
    active: "bg-yellow-500",
    blocked: "bg-red-500",
    review: "bg-orange-500",
    human_needs_to_review: "bg-pink-500",
    done: "bg-green-500",
  }
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full text-white ${colors[status] ?? "bg-gray-400"}`}>
      {status}
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
  }, ref) {
    const innerRef = useRef<HTMLDivElement>(null)

    // Expose the inner ref via forwardRef
    useImperativeHandle(ref, () => innerRef.current!, [])

    // Scroll into view when focused via keyboard
    useEffect(() => {
      if (isFocused && innerRef.current) {
        innerRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" })
      }
    }, [isFocused])

    const baseClasses = "p-3 rounded-lg border cursor-pointer transition-all duration-200 shadow-sm"
    const readyClasses = isSelected
      ? "border-blue-400/70 bg-blue-600/20 shadow-blue-900/20"
      : "border-zinc-700/40 bg-gray-800/80"
    const hoverClasses = "hover:bg-gray-700/45 hover:border-zinc-500/55"
    const focusClasses = isFocused && showFocusRing
      ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-900"
      : ""

    const animationDelayMs = Math.min(entryIndex * 22, 220)
    const indentPx = Math.min(Math.max(nestingLevel, 0), 8) * 18

    return (
      <div
        ref={innerRef}
        className={`${baseClasses} ${readyClasses} ${hoverClasses} ${focusClasses} animate-task-card-enter`}
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
        <div className="flex items-start justify-between gap-2">
          {onToggleSelect && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(task.id) }}
              className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition ${
                isSelected
                  ? "bg-blue-500 border-blue-500 text-white"
                  : "border-gray-500 hover:border-blue-400"
              }`}
            >
              {isSelected && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              )}
            </button>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <code className="text-xs text-gray-400">{task.id}</code>
              <span className="text-sm font-medium text-amber-400">[{task.score}]</span>
            </div>
            <h3 className="text-sm font-medium text-white truncate">{task.title}</h3>
          </div>
          <StatusBadge status={task.status} />
        </div>
        {task.labels && task.labels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {task.labels.map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium"
                style={{
                  color: label.color,
                  backgroundColor: `${label.color}1a`,
                }}
              >
                {canonicalTaskLabelName(label.name)}
              </span>
            ))}
          </div>
        )}
        {task.blockedBy?.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            Blocked by: {task.blockedBy.join(", ")}
          </div>
        )}
        {task.blocks?.length > 0 && (
          <div className="mt-1 text-xs text-green-600">
            Unblocks {task.blocks.length} task(s)
          </div>
        )}
      </div>
    )
  }
)
