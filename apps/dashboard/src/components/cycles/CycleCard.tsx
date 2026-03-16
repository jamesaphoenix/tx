import type { Cycle } from "../../api/client"

type ThemeMode = "light" | "dark"

interface CycleCardProps {
  cycle: Cycle
  isSelected?: boolean
  onSelect?: () => void
  emphasize?: boolean
  themeMode?: ThemeMode
}

const STATUS_BADGE_DARK: Record<Cycle["status"], string> = {
  current: "bg-blue-500/20 text-blue-200 border-blue-400/40",
  upcoming: "bg-violet-500/20 text-violet-200 border-violet-400/40",
  completed: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40",
}

const STATUS_BADGE_LIGHT: Record<Cycle["status"], string> = {
  current: "bg-blue-100 text-blue-700 border-blue-300",
  upcoming: "bg-violet-100 text-violet-700 border-violet-300",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-300",
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
      className={`w-full rounded-lg border p-3 text-left transition ${
        isSelected
          ? "border-blue-500/60 bg-blue-500/5"
          : isDarkTheme
            ? "border-gray-800/80 bg-gray-900/40 hover:border-gray-700 hover:bg-gray-900/70"
            : "border-zinc-200 bg-white hover:border-zinc-300"
      } ${emphasize ? "border-blue-500/30 bg-blue-500/5" : ""}`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-2">
          <h3 className={`truncate text-[13px] font-semibold ${isDarkTheme ? "text-gray-100" : "text-zinc-900"}`}>
            {cycle.name}
          </h3>
          <span className={`text-[11px] ${isDarkTheme ? "text-gray-500" : "text-zinc-500"}`}>
            {formatDateRange(cycle.startDate, cycle.endDate)}
          </span>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${isDarkTheme ? STATUS_BADGE_DARK[cycle.status] : STATUS_BADGE_LIGHT[cycle.status]}`}
        >
          {STATUS_LABEL[cycle.status]}
        </span>
      </div>

      <div className={`mb-2 h-1.5 rounded-full ${isDarkTheme ? "bg-gray-800/80" : "bg-zinc-200"}`}>
        <div
          className="h-full rounded-full bg-blue-500 transition-[width]"
          style={{ width: `${successRate}%` }}
        />
      </div>

      <div className={`flex items-center gap-5 text-[11px] ${isDarkTheme ? "text-gray-500" : "text-zinc-500"}`}>
        <span><span className={`font-semibold ${isDarkTheme ? "text-gray-300" : "text-zinc-700"}`}>{total}</span> scope</span>
        <span><span className={`font-semibold ${isDarkTheme ? "text-gray-300" : "text-zinc-700"}`}>{started}</span> started</span>
        <span><span className={`font-semibold ${isDarkTheme ? "text-gray-300" : "text-zinc-700"}`}>{completed}</span> completed</span>
        <span className="ml-auto"><span className={`font-semibold ${isDarkTheme ? "text-gray-300" : "text-zinc-700"}`}>{successRate}%</span></span>
      </div>
    </button>
  )
}
