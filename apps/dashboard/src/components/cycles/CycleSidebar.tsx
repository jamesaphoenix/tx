import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query"
import { fetchers, type CycleRun } from "../../api/client"

interface CycleSidebarProps {
  selectedCycleId: string | null
  onSelectCycle: (id: string) => void
  onDeleteCycle?: (id: string) => void
}

function formatDate(date: string): string {
  const d = new Date(date)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
}

function CycleCard({ cycle, isSelected, onClick, onDelete }: { cycle: CycleRun; isSelected: boolean; onClick: () => void; onDelete?: () => void }) {
  return (
    <div
      className={`relative w-full text-left p-3 rounded-lg border transition cursor-pointer group ${
        isSelected
          ? "bg-blue-600/20 border-blue-500/50"
          : "bg-gray-800/50 border-gray-700/50 hover:bg-gray-800 hover:border-gray-600"
      }`}
      onClick={onClick}
    >
      {/* Delete button */}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (confirm(`Delete Cycle ${cycle.cycle} and all its issues?`)) {
              onDelete()
            }
          }}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition p-1 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400"
          title="Delete cycle"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      )}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">
            Cycle {cycle.cycle}
          </span>
          {cycle.converged && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 font-medium">
              converged
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500 mr-4">
          {cycle.rounds} rounds
        </span>
      </div>
      {cycle.name && (
        <div className="text-xs font-medium text-gray-300 mb-0.5">
          {cycle.name}
        </div>
      )}
      {cycle.description && (
        <div className="text-xs text-gray-500 mb-1.5 line-clamp-2">
          {cycle.description}
        </div>
      )}
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>Loss: <span className="text-gray-300">{cycle.finalLoss}</span></span>
        <span>Issues: <span className="text-gray-300">{cycle.totalNewIssues}</span></span>
        <span>{formatDate(cycle.startedAt)}</span>
      </div>
    </div>
  )
}

export function CycleSidebar({ selectedCycleId, onSelectCycle, onDeleteCycle }: CycleSidebarProps) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ["cycles"],
    queryFn: fetchers.cycles,
    refetchInterval: 10000,
  })

  const deleteMutation = useMutation({
    mutationFn: fetchers.deleteCycle,
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["cycles"] })
      if (selectedCycleId === deletedId) {
        onDeleteCycle?.(deletedId)
      }
    },
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
        Cycles
      </div>
      {cycles.map((cycle) => (
        <CycleCard
          key={cycle.id}
          cycle={cycle}
          isSelected={selectedCycleId === cycle.id}
          onClick={() => onSelectCycle(cycle.id)}
          onDelete={() => deleteMutation.mutate(cycle.id)}
        />
      ))}
    </div>
  )
}
