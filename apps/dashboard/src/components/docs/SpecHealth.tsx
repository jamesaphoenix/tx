import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchers } from "../../api/client"

interface SpecHealthProps {
  onSelectDoc: (name: string) => void
}

type PanelTone = "healthy" | "warning" | "critical"

const PANEL_STYLES: Record<PanelTone, { border: string; badge: string; summary: string }> = {
  healthy: {
    border: "border-emerald-500/30 bg-emerald-500/10",
    badge: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    summary: "All docs healthy",
  },
  warning: {
    border: "border-amber-500/30 bg-amber-500/10",
    badge: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    summary: "Warnings detected",
  },
  critical: {
    border: "border-red-500/40 bg-red-500/10",
    badge: "bg-red-500/20 text-red-300 border-red-500/40",
    summary: "Issues detected",
  },
}

const formatKind = (kind: string): string => kind.replace(/_/g, " ")

export function SpecHealth({ onSelectDoc }: SpecHealthProps) {
  const [expanded, setExpanded] = useState(false)

  const healthQuery = useQuery({
    queryKey: ["doc-health"],
    queryFn: fetchers.docHealth,
    refetchInterval: 5000,
  })

  if (healthQuery.isLoading) {
    return <div className="mb-3 animate-pulse rounded-lg border border-gray-700 bg-gray-800/50 h-24" />
  }

  if (healthQuery.error instanceof Error) {
    return (
      <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-red-300">Spec Health</div>
        <div className="mt-1 text-xs text-red-200/90">Unable to load health data: {healthQuery.error.message}</div>
      </div>
    )
  }

  const health = healthQuery.data
  if (!health) return null

  const issueCount = health.issues.length
  const hasCritical = health.issues.some((issue) => issue.kind === "hash_drift")
  const tone: PanelTone = issueCount === 0 ? "healthy" : (hasCritical ? "critical" : "warning")
  const styles = PANEL_STYLES[tone]

  return (
    <div className={`mb-3 rounded-lg border p-3 ${styles.border}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-gray-100">Spec Health</div>
          <div className="text-[11px] text-gray-300/90 mt-0.5">{styles.summary}</div>
        </div>
        <span className={`text-[10px] uppercase tracking-wider border rounded px-2 py-0.5 ${styles.badge}`}>
          {tone}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded border border-gray-700/70 bg-gray-900/60 px-2 py-1 text-center">
          <div className="text-[10px] text-gray-500 uppercase">Total</div>
          <div className="text-xs font-semibold text-gray-100">{health.total}</div>
        </div>
        <div className="rounded border border-gray-700/70 bg-gray-900/60 px-2 py-1 text-center">
          <div className="text-[10px] text-gray-500 uppercase">Healthy</div>
          <div className="text-xs font-semibold text-gray-100">{health.healthy}</div>
        </div>
        <div className="rounded border border-gray-700/70 bg-gray-900/60 px-2 py-1 text-center">
          <div className="text-[10px] text-gray-500 uppercase">Issues</div>
          <div className="text-xs font-semibold text-gray-100">{issueCount}</div>
        </div>
      </div>

      {issueCount > 0 && (
        <>
          <button
            onClick={() => setExpanded((prev) => !prev)}
            className="mt-3 w-full rounded border border-gray-700 bg-gray-900/60 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-gray-800/80 transition"
          >
            {expanded ? "Hide details" : `Show details (${issueCount})`}
          </button>

          {expanded && (
            <div className="mt-2 space-y-2">
              {health.issues.map((issue, index) => (
                <div
                  key={`${issue.docName}:${issue.kind}:${index}`}
                  className="rounded border border-gray-700/70 bg-gray-900/70 px-2.5 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => onSelectDoc(issue.docName)}
                      className="text-xs font-medium text-blue-300 hover:text-blue-200 underline underline-offset-2 truncate"
                    >
                      {issue.docName}
                    </button>
                    <span className="text-[10px] uppercase tracking-wider text-gray-400">{formatKind(issue.kind)}</span>
                  </div>

                  <div className="mt-1.5 space-y-1">
                    {issue.problems.map((problem, problemIndex) => (
                      <div key={`${issue.docName}:${issue.kind}:problem:${problemIndex}`} className="text-[11px] text-gray-300">
                        • {problem}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
