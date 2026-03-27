import { useState } from "react"
import { Button } from "../ui"
import { useQuery } from "@tanstack/react-query"
import { fetchers } from "../../api/client"

interface SpecHealthProps {
  onSelectDoc: (docId: string) => void
}

type PanelTone = "healthy" | "warning" | "critical"

const PANEL_STYLES: Record<PanelTone, { border: string; badge: string; summary: string }> = {
  healthy: {
    border: "border-green-500/30 bg-green-500/5",
    badge: "bg-green-500/15 text-green-300 border-green-500/30",
    summary: "All docs healthy",
  },
  warning: {
    border: "border-orange-500/30 bg-orange-500/5",
    badge: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    summary: "Warnings detected",
  },
  critical: {
    border: "border-red-500/30 bg-red-500/5",
    badge: "bg-red-500/15 text-red-300 border-red-500/30",
    summary: "Issues detected",
  },
}

const ISSUE_KIND_STYLES: Record<string, { bg: string; text: string }> = {
  hash_drift: { bg: "bg-red-500/15", text: "text-red-400" },
  parse: { bg: "bg-red-500/15", text: "text-red-400" },
  cross_link: { bg: "bg-amber-500/15", text: "text-amber-400" },
  orphaned: { bg: "bg-amber-500/15", text: "text-amber-400" },
  placeholder: { bg: "bg-blue-500/15", text: "text-blue-400" },
}

const formatKind = (kind: string): string => {
  const labels: Record<string, string> = {
    hash_drift: "drift",
    cross_link: "link",
    parse: "parse",
    orphaned: "orphan",
    placeholder: "placeholder",
  }
  return labels[kind] ?? kind.replace(/_/g, " ")
}

interface SpecIssue {
  docId: string
  docName: string
  kind: string
  problems: string[]
}

/** Group issues by docId for a cleaner display. */
function groupByDoc(issues: SpecIssue[]): Map<string, { docName: string; issues: SpecIssue[] }> {
  const map = new Map<string, { docName: string; issues: SpecIssue[] }>()
  for (const issue of issues) {
    const existing = map.get(issue.docId)
    if (existing) {
      existing.issues.push(issue)
    } else {
      map.set(issue.docId, { docName: issue.docName, issues: [issue] })
    }
  }
  return map
}

export function SpecHealth({ onSelectDoc }: SpecHealthProps) {
  const [expanded, setExpanded] = useState(false)
  const [copiedProblemKey, setCopiedProblemKey] = useState<string | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)

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
  const hasCritical = health.issues.some((issue) => issue.kind === "hash_drift" || issue.kind === "parse")
  const tone: PanelTone = issueCount === 0 ? "healthy" : (hasCritical ? "critical" : "warning")
  const styles = PANEL_STYLES[tone]
  const allIssueProblems = health.issues.flatMap((issue) =>
    issue.problems.map((problem) => `${issue.docName} [${issue.kind}]: ${problem}`),
  )

  const handleCopyProblem = (problemKey: string, copyText: string) => {
    void navigator.clipboard.writeText(copyText)
      .then(() => {
        setCopiedProblemKey(problemKey)
        window.setTimeout(() => {
          setCopiedProblemKey((current) => (current === problemKey ? null : current))
        }, 1500)
      })
      .catch(() => {})
  }

  const handleCopyAllProblems = () => {
    if (allIssueProblems.length === 0) return
    void navigator.clipboard.writeText(allIssueProblems.join("\n"))
      .then(() => {
        setCopiedAll(true)
        window.setTimeout(() => { setCopiedAll(false) }, 1500)
      })
      .catch(() => {})
  }

  const grouped = groupByDoc(health.issues)

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
          <div className="mt-3 flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setExpanded((prev) => !prev)}
              className="flex-1"
            >
              {expanded ? "Hide details" : `Show details (${issueCount})`}
            </Button>
            <Button
              size="sm"
              variant={copiedAll ? "success" : "secondary"}
              onClick={handleCopyAllProblems}
              title={copiedAll ? "Copied!" : "Copy all issues"}
              aria-label={copiedAll ? "Copied all issue text" : "Copy all issue text"}
            >
              {copiedAll ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
              <span>{copiedAll ? "Copied!" : "Copy all"}</span>
            </Button>
          </div>

          {expanded && (
            <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:#4b556388_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-600/70 [&::-webkit-scrollbar-thumb:hover]:bg-gray-500/70 [&::-webkit-scrollbar-track]:bg-transparent">
              {Array.from(grouped.entries()).map(([docId, group]) => (
                <div
                  key={docId}
                  className="rounded-lg border border-gray-700/60 bg-gray-900/70 overflow-hidden"
                >
                  {/* Doc header */}
                  <button
                    onClick={() => onSelectDoc(docId)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800/60 transition text-left"
                  >
                    <span className="text-xs font-medium text-blue-300 hover:text-blue-200 truncate">
                      {group.docName}
                    </span>
                    <span className="ml-auto text-[10px] text-gray-500">
                      {group.issues.length} {group.issues.length === 1 ? "issue" : "issues"}
                    </span>
                  </button>

                  {/* Issues for this doc */}
                  <div className="border-t border-gray-800/80 px-3 py-1.5 space-y-1.5">
                    {group.issues.map((issue, issueIdx) =>
                      issue.problems.map((problem, problemIdx) => {
                        const problemKey = `${docId}:${issue.kind}:${issueIdx}:${problemIdx}`
                        const isCopied = copiedProblemKey === problemKey
                        const kindStyle = ISSUE_KIND_STYLES[issue.kind] ?? { bg: "bg-gray-500/15", text: "text-gray-400" }
                        return (
                          <div key={problemKey} className="flex items-start gap-2 group">
                            {/* Kind badge */}
                            <span
                              className={`mt-0.5 flex-shrink-0 inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${kindStyle.bg} ${kindStyle.text}`}
                            >
                              {formatKind(issue.kind)}
                            </span>
                            {/* Problem text */}
                            <span className="flex-1 text-[11px] text-gray-300 leading-relaxed min-w-0 break-words">
                              {problem}
                            </span>
                            {/* Copy button */}
                            <button
                              onClick={() => handleCopyProblem(problemKey, `${issue.docName} [${issue.kind}]: ${problem}`)}
                              className={`mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded transition opacity-0 group-hover:opacity-100 ${
                                isCopied
                                  ? "opacity-100 text-emerald-400"
                                  : "text-gray-500 hover:text-gray-300"
                              }`}
                              title={isCopied ? "Copied!" : "Copy"}
                              aria-label={isCopied ? "Copied issue text" : "Copy issue text"}
                            >
                              {isCopied ? (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              ) : (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                              )}
                            </button>
                          </div>
                        )
                      })
                    )}
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
