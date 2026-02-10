import type { CycleRun } from "../../api/client"

interface CycleSummaryProps {
  cycle: CycleRun
}

function StatCard({ label, value, subtitle, color }: { label: string; value: string | number; subtitle?: string; color: string }) {
  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700/50">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-1">{subtitle ?? label}</div>
    </div>
  )
}

export function CycleSummary({ cycle }: CycleSummaryProps) {
  return (
    <div className="grid grid-cols-4 gap-3">
      <StatCard
        label="Cycle"
        value={`Cycle ${cycle.cycle}`}
        subtitle={`${cycle.rounds} rounds`}
        color="text-white"
      />
      <StatCard
        label="Issues Found"
        value={cycle.totalNewIssues}
        color="text-orange-400"
      />
      <StatCard
        label="Final Loss"
        value={cycle.finalLoss}
        color="text-purple-400"
      />
      <StatCard
        label="Converged"
        value={cycle.converged ? "Yes" : "No"}
        color={cycle.converged ? "text-green-400" : "text-yellow-400"}
      />
    </div>
  )
}
