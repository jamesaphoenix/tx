import { useQuery } from "@tanstack/react-query"
import { fetchers, type CycleRun } from "../../api/client"

interface CycleSidebarProps {
  selectedCycleId: string | null
  onSelectCycle: (id: string) => void
}

function formatTimeAgo(date: string): string {
  const now = Date.now()
  const then = new Date(date).getTime()
  if (isNaN(then)) return ""
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function CycleCard({ cycle, isSelected, onClick }: { cycle: CycleRun; isSelected: boolean; onClick: () => void }) {
  const statusColor = cycle.status === "completed"
    ? cycle.converged ? "text-green-400" : "text-yellow-400"
    : cycle.status === "running" ? "text-blue-400" : "text-red-400"

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition ${
        isSelected
          ? "bg-blue-600/20 border-blue-500/50"
          : "bg-gray-800/50 border-gray-700/50 hover:bg-gray-800 hover:border-gray-600"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-white truncate mr-2">
          {cycle.name || `Cycle ${cycle.cycle}`}
        </span>
        <span className={`text-xs font-medium ${statusColor}`}>
          {cycle.converged ? "converged" : cycle.status}
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span>{cycle.totalNewIssues} issues</span>
        <span>Loss: {cycle.finalLoss}</span>
        <span>{cycle.rounds}r</span>
      </div>
      <div className="text-[10px] text-gray-500 mt-1">
        {formatTimeAgo(cycle.startedAt)}
      </div>
    </button>
  )
}

export function CycleSidebar({ selectedCycleId, onSelectCycle }: CycleSidebarProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["cycles"],
    queryFn: fetchers.cycles,
    refetchInterval: 10000,
  })

  const cycles = data?.cycles ?? []

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="animate-pulse bg-gray-800 h-20 rounded-lg" />
        ))}
      </div>
    )
  }

  if (cycles.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <div className="text-sm">No cycle scans yet</div>
        <div className="text-xs mt-1">Run <code className="text-gray-400">tx cycle</code> to start</div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">
        Cycles ({cycles.length})
      </div>
      {cycles.map((cycle) => (
        <CycleCard
          key={cycle.id}
          cycle={cycle}
          isSelected={selectedCycleId === cycle.id}
          onClick={() => onSelectCycle(cycle.id)}
        />
      ))}
    </div>
  )
}
