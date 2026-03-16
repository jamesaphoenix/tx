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
  const hasCritical = health.issues.some((issue) => issue.kind === "hash_drift")
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
      .catch(() => {
        // Ignore clipboard failures; user remains on the same view.
      })
  }
  const handleCopyAllProblems = () => {
    if (allIssueProblems.length === 0) return

    void navigator.clipboard.writeText(allIssueProblems.join("\n"))
      .then(() => {
        setCopiedAll(true)
        window.setTimeout(() => {
          setCopiedAll(false)
        }, 1500)
      })
      .catch(() => {
        // Ignore clipboard failures; user remains on the same view.
      })
  }

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
            <button
              onClick={() => setExpanded((prev) => !prev)}
              className="flex-1 rounded border border-gray-700 bg-gray-900/60 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-gray-800/80 transition"
            >
              {expanded ? "Hide details" : `Show details (${issueCount})`}
            </button>
            <button
              onClick={handleCopyAllProblems}
              className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs transition ${
                copiedAll
                  ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-200"
                  : "border-gray-700 bg-gray-900/60 text-gray-200 hover:bg-gray-800/80"
              }`}
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
            </button>
          </div>

          {expanded && (
            <div className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:#4b556388_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-600/70 [&::-webkit-scrollbar-thumb:hover]:bg-gray-500/70 [&::-webkit-scrollbar-track]:bg-transparent">
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
                    {issue.problems.map((problem, problemIndex) => {
                      const problemKey = `${issue.docName}:${issue.kind}:problem:${problemIndex}`
                      const isCopied = copiedProblemKey === problemKey
                      return (
                        <div key={problemKey} className="flex items-start justify-between gap-2 text-[11px] text-gray-300">
                          <div className="min-w-0 flex-1">• {problem}</div>
                          <button
                            onClick={() => handleCopyProblem(problemKey, `${issue.docName} [${issue.kind}]: ${problem}`)}
                            className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition ${
                              isCopied
                                ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-300"
                                : "border-gray-700 bg-gray-900/70 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                            }`}
                            title={isCopied ? "Copied!" : "Copy issue"}
                            aria-label={isCopied ? "Copied issue text" : "Copy issue text"}
                          >
                            {isCopied ? (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                              </svg>
                            )}
                          </button>
                        </div>
                      )
                    })}
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
