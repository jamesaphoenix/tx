import { forwardRef, useEffect, useRef, useImperativeHandle } from "react"
import type { TaskWithDeps } from "../../api/client"

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
  onClick?: () => void
}

export const TaskCard = forwardRef<HTMLDivElement, TaskCardProps>(
  function TaskCard({ task, isFocused = false, onClick }, ref) {
    const innerRef = useRef<HTMLDivElement>(null)

    // Expose the inner ref via forwardRef
    useImperativeHandle(ref, () => innerRef.current!, [])

    // Scroll into view when focused via keyboard
    useEffect(() => {
      if (isFocused && innerRef.current) {
        innerRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" })
      }
    }, [isFocused])

    const baseClasses = "p-3 rounded-lg border cursor-pointer transition-all"
    const readyClasses = task.isReady
      ? "border-blue-500 bg-blue-500/10"
      : "border-gray-700 bg-gray-800"
    const hoverClasses = "hover:bg-gray-700/50"
    const focusClasses = isFocused
      ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-900"
      : ""

    return (
      <div
        ref={innerRef}
        className={`${baseClasses} ${readyClasses} ${hoverClasses} ${focusClasses}`}
        onClick={onClick}
        tabIndex={isFocused ? 0 : -1}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <code className="text-xs text-gray-400">{task.id}</code>
              <span className="text-sm font-medium text-amber-400">[{task.score}]</span>
            </div>
            <h3 className="text-sm font-medium text-white truncate">{task.title}</h3>
          </div>
          <StatusBadge status={task.status} />
        </div>
        {task.blockedBy.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            Blocked by: {task.blockedBy.join(", ")}
          </div>
        )}
        {task.blocks.length > 0 && (
          <div className="mt-1 text-xs text-green-600">
            Unblocks {task.blocks.length} task(s)
          </div>
        )}
      </div>
    )
  }
)
