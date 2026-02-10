import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchers } from "../../api/client"
import { CycleSidebar } from "./CycleSidebar"
import { CycleSummary } from "./CycleSummary"
import { LossChart } from "./LossChart"
import { IssuesList } from "./IssuesList"

export function CyclePage() {
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null)

  const { data: detail, isLoading } = useQuery({
    queryKey: ["cycle", selectedCycleId],
    queryFn: () => fetchers.cycleDetail(selectedCycleId!),
    enabled: !!selectedCycleId,
  })

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-80 border-r border-gray-700 p-4 overflow-y-auto flex-shrink-0">
        <CycleSidebar
          selectedCycleId={selectedCycleId}
          onSelectCycle={setSelectedCycleId}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedCycleId ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="text-center">
              <div className="text-4xl mb-4 opacity-30">&#x1F50D;</div>
              <div className="text-lg mb-2">Select a cycle to view details</div>
              <div className="text-sm">
                Cycles show issue discovery convergence across scan rounds
              </div>
            </div>
          </div>
        ) : isLoading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="animate-pulse bg-gray-800 h-20 rounded-lg" />
              ))}
            </div>
            <div className="animate-pulse bg-gray-800 h-72 rounded-lg" />
            <div className="animate-pulse bg-gray-800 h-48 rounded-lg" />
          </div>
        ) : detail ? (
          <div className="space-y-6 max-w-5xl">
            {/* Summary cards */}
            <CycleSummary cycle={detail.cycle} />

            {/* Loss convergence chart */}
            <LossChart roundMetrics={detail.roundMetrics} />

            {/* Issues list */}
            <IssuesList issues={detail.issues} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
