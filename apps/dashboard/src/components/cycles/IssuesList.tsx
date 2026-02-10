import { useState } from "react"
import type { CycleIssue } from "../../api/client"

interface IssuesListProps {
  issues: CycleIssue[]
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    high: "bg-red-500/20 text-red-400 border-red-500/30",
    medium: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    low: "bg-green-500/20 text-green-400 border-green-500/30",
  }
  return (
    <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded border ${styles[severity] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}>
      {severity}
    </span>
  )
}

function IssueTypeBadge({ type }: { type: string }) {
  return (
    <span className="px-1.5 py-0.5 text-[10px] text-gray-400 bg-gray-700/50 rounded">
      {type}
    </span>
  )
}

export function IssuesList({ issues }: IssuesListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>("all")

  const filtered = filter === "all"
    ? issues
    : issues.filter((i) => i.severity === filter)

  const counts = {
    all: issues.length,
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
  }

  if (issues.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700/50 p-6 text-center text-gray-500">
        No issues found in this cycle
      </div>
    )
  }

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700/50">
      {/* Header with filters */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
        <h3 className="text-sm font-medium text-white">
          Issues ({issues.length})
        </h3>
        <div className="flex gap-1">
          {(["all", "high", "medium", "low"] as const).map((sev) => (
            <button
              key={sev}
              onClick={() => setFilter(sev)}
              className={`px-2 py-1 text-[10px] rounded transition ${
                filter === sev
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-400 hover:bg-gray-600"
              }`}
            >
              {sev === "all" ? "All" : sev.charAt(0).toUpperCase() + sev.slice(1)} ({counts[sev]})
            </button>
          ))}
        </div>
      </div>

      {/* Issue rows */}
      <div className="divide-y divide-gray-700/30 max-h-[400px] overflow-y-auto">
        {filtered.map((issue) => (
          <button
            key={issue.id}
            onClick={() => setExpandedId(expandedId === issue.id ? null : issue.id)}
            className="w-full text-left px-4 py-3 hover:bg-gray-750/50 transition"
          >
            <div className="flex items-start gap-3">
              <SeverityBadge severity={issue.severity} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-white leading-tight">
                  {issue.title}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <IssueTypeBadge type={issue.issueType} />
                  <span className="text-[10px] text-gray-500 font-mono truncate">
                    {issue.file}:{issue.line}
                  </span>
                  <span className="text-[10px] text-gray-600">
                    R{issue.round}
                  </span>
                </div>
                {expandedId === issue.id && (
                  <div className="mt-2 text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">
                    {issue.description}
                  </div>
                )}
              </div>
              <span className="text-gray-600 text-xs flex-shrink-0 mt-0.5">
                {expandedId === issue.id ? "\u25BC" : "\u25B6"}
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
