import { useState, useCallback, useEffect } from "react"
import type { CycleIssue } from "../../api/client"

interface IssuesListProps {
  issues: CycleIssue[]
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  filter: string
  onFilterChange: (filter: string) => void
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

export function formatIssueForClipboard(issue: CycleIssue): string {
  return `[${issue.severity.toUpperCase()}] ${issue.title}\n  File: ${issue.file}:${issue.line}\n  ${issue.description}`
}

export function IssuesList({ issues, selectedIds, onSelectionChange, filter, onFilterChange }: IssuesListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const filtered = filter === "all"
    ? issues
    : issues.filter((i) => i.severity === filter)

  const counts = {
    all: issues.length,
    high: issues.filter((i) => i.severity === "high").length,
    medium: issues.filter((i) => i.severity === "medium").length,
    low: issues.filter((i) => i.severity === "low").length,
  }

  const toggleSelect = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = new Set(selectedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    onSelectionChange(next)
  }, [selectedIds, onSelectionChange])

  const selectAll = useCallback(() => {
    if (selectedIds.size === filtered.length) {
      onSelectionChange(new Set())
    } else {
      onSelectionChange(new Set(filtered.map((i) => i.id)))
    }
  }, [filtered, selectedIds.size, onSelectionChange])

  const copyToClipboard = useCallback(async () => {
    const selected = issues.filter((i) => selectedIds.has(i.id))
    if (selected.length === 0) return
    const text = selected.map(formatIssueForClipboard).join("\n\n")
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [issues, selectedIds])

  // Clear selection when issues change
  useEffect(() => {
    onSelectionChange(new Set())
  }, [issues]) // eslint-disable-line react-hooks/exhaustive-deps

  if (issues.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg border border-gray-700/50 p-6 text-center text-gray-500">
        No issues found in this cycle
      </div>
    )
  }

  const allSelected = filtered.length > 0 && selectedIds.size === filtered.length
  const someSelected = selectedIds.size > 0

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700/50 relative">
      {/* Header with filters */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700/50">
        <div className="flex items-center gap-3">
          {/* Select all checkbox */}
          <button
            onClick={selectAll}
            className={`w-4 h-4 rounded border flex items-center justify-center transition flex-shrink-0 ${
              allSelected
                ? "bg-blue-500 border-blue-500"
                : someSelected
                  ? "bg-blue-500/30 border-blue-500"
                  : "border-gray-600 hover:border-gray-400"
            }`}
          >
            {allSelected && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {someSelected && !allSelected && (
              <div className="w-2 h-0.5 bg-white rounded" />
            )}
          </button>
          <h3 className="text-sm font-medium text-white">
            Issues ({issues.length})
          </h3>
        </div>
        <div className="flex gap-1">
          {(["all", "high", "medium", "low"] as const).map((sev) => (
            <button
              key={sev}
              onClick={() => onFilterChange(sev)}
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
        {filtered.map((issue) => {
          const isSelected = selectedIds.has(issue.id)
          return (
            <div
              key={issue.id}
              className={`w-full text-left px-4 py-3 transition cursor-pointer ${
                isSelected ? "bg-blue-600/10" : "hover:bg-gray-750/50"
              }`}
              onClick={() => setExpandedId(expandedId === issue.id ? null : issue.id)}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <button
                  onClick={(e) => toggleSelect(issue.id, e)}
                  className={`w-4 h-4 mt-0.5 rounded border flex items-center justify-center transition flex-shrink-0 ${
                    isSelected
                      ? "bg-blue-500 border-blue-500"
                      : "border-gray-600 hover:border-gray-400"
                  }`}
                >
                  {isSelected && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
                <SeverityBadge severity={issue.severity} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white leading-tight">
                    {issue.title}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[10px] text-gray-500 font-mono truncate">
                      {issue.file}:{issue.line}
                    </span>
                  </div>
                  {expandedId === issue.id && (
                    <div className="mt-2 text-xs text-gray-400 leading-relaxed whitespace-pre-wrap">
                      {issue.description}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-gray-600 font-mono flex-shrink-0 mt-0.5">
                  {issue.id}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Floating action bar when items selected */}
      {someSelected && (
        <div className="sticky bottom-0 left-0 right-0 px-4 py-2.5 bg-gray-900/95 backdrop-blur-sm border-t border-gray-700/50 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {selectedIds.size} issue{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onSelectionChange(new Set())}
              className="px-2.5 py-1 text-xs text-gray-400 hover:text-white transition rounded hover:bg-gray-700"
            >
              Clear
            </button>
            <button
              onClick={copyToClipboard}
              className={`px-3 py-1 text-xs rounded transition flex items-center gap-1.5 ${
                copied
                  ? "bg-green-600 text-white"
                  : "bg-blue-600 text-white hover:bg-blue-500"
              }`}
            >
              {copied ? (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy
                  <kbd className="ml-1 px-1 py-0.5 text-[9px] bg-blue-700/50 rounded border border-blue-500/30">
                    &#8984;C
                  </kbd>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
