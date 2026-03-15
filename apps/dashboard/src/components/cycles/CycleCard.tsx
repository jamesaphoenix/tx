import type { Cycle } from "../../api/client"

type ThemeMode = "light" | "dark"

interface CycleCardProps {
  cycle: Cycle
  isSelected?: boolean
  onSelect?: () => void
  emphasize?: boolean
  themeMode?: ThemeMode
}

const STATUS_BADGE_CLASS: Record<Cycle["status"], string> = {
  current: "bg-blue-500/20 text-blue-200 border-blue-400/40",
  upcoming: "bg-violet-500/20 text-violet-200 border-violet-400/40",
  completed: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40",
}

const STATUS_LABEL: Record<Cycle["status"], string> = {
  current: "Current",
  upcoming: "Upcoming",
  completed: "Completed",
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate)
  const end = new Date(endDate)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Date unavailable"
  }

  return `${start.toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  })} - ${end.toLocaleDateString("en-GB", {
    month: "short",
    day: "numeric",
  })}`
}

function percentage(completed: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((completed / total) * 100)
}

export function CycleCard({
  cycle,
  isSelected = false,
  onSelect,
  emphasize = false,
  themeMode = "dark",
}: CycleCardProps) {
  const isDarkTheme = themeMode === "dark"
  const completed = cycle.completedCount
  const total = cycle.taskCount
  const started = cycle.inProgressCount + completed
  const successRate = percentage(completed, total)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-xl border p-4 text-left transition ${
        isSelected
          ? "border-blue-500/60 bg-blue-500/10 shadow-[0_0_0_1px_rgba(96,165,250,0.35)]"
          : isDarkTheme
            ? "border-gray-700/80 bg-gray-900/70 hover:border-gray-600 hover:bg-gray-900"
            : "border-zinc-300 bg-white hover:border-zinc-400"
      } ${emphasize ? "ring-1 ring-blue-500/50" : ""}`}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={`truncate text-sm font-semibold ${isDarkTheme ? "text-gray-100" : "text-zinc-900"}`}>
            {cycle.name}
          </h3>
          <p className={`mt-1 text-xs ${isDarkTheme ? "text-gray-400" : "text-zinc-600"}`}>
            {formatDateRange(cycle.startDate, cycle.endDate)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE_CLASS[cycle.status]}`}
        >
          {STATUS_LABEL[cycle.status]}
        </span>
      </div>

      <div className="mb-2 h-2 rounded-full bg-gray-800/80">
        <div
          className="h-full rounded-full bg-blue-500 transition-[width]"
          style={{ width: `${successRate}%` }}
        />
      </div>

      <div className={`grid grid-cols-4 gap-2 text-[11px] ${isDarkTheme ? "text-gray-400" : "text-zinc-600"}`}>
        <div>
          <p className="uppercase tracking-wide">Scope</p>
          <p className={`mt-0.5 font-semibold ${isDarkTheme ? "text-gray-200" : "text-zinc-800"}`}>{total}</p>
        </div>
        <div>
          <p className="uppercase tracking-wide">Started</p>
          <p className={`mt-0.5 font-semibold ${isDarkTheme ? "text-gray-200" : "text-zinc-800"}`}>{started}</p>
        </div>
        <div>
          <p className="uppercase tracking-wide">Completed</p>
          <p className={`mt-0.5 font-semibold ${isDarkTheme ? "text-gray-200" : "text-zinc-800"}`}>{completed}</p>
        </div>
        <div>
          <p className="uppercase tracking-wide">Success</p>
          <p className={`mt-0.5 font-semibold ${isDarkTheme ? "text-gray-200" : "text-zinc-800"}`}>{successRate}%</p>
        </div>
      </div>
    </button>
  )
}
