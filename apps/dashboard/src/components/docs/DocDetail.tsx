import { useMemo } from "react"
import { Button } from "../ui"
import { useQuery } from "@tanstack/react-query"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ApiError, fetchers } from "../../api/client"
import { DocumentLinks } from "./DocumentLinks"

interface DocDetailProps {
  docId: string
  version: number
  onNavigateToDoc: (docId: string, version: number) => void
}

const KIND_LABELS = new Map<string, string>(Object.entries({
  overview: "OVERVIEW DOCUMENT",
  prd: "PRODUCT REQUIREMENTS",
  design: "DESIGN DOCUMENT",
  plan: "IMPLEMENTATION PLAN",
  requirement: "REQUIREMENT",
  system_design: "SYSTEM DESIGN",
  runbook: "RUNBOOK",
  decision: "DECISION RECORD",
}))

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    changing: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    locked: "bg-green-500/20 text-green-400 border-green-500/30",
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border ${styles[status] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${status === "changing" ? "bg-orange-400" : "bg-green-400"}`} />
      {status}
    </span>
  )
}

// =============================================================================
// DocDetail component
// =============================================================================

export function DocDetail({ docId, version, onNavigateToDoc }: DocDetailProps) {
  const { data: doc, isLoading: docLoading, error: docError, refetch: retryDoc } = useQuery({
    queryKey: ["doc", docId, version],
    queryFn: () => fetchers.docDetail(docId, version),
    enabled: !!docId,
    refetchInterval: 5000,
  })

  const { data: sourceData, isLoading: sourceLoading, error: sourceError, refetch: retrySource } = useQuery({
    queryKey: ["doc-source", docId, version],
    queryFn: () => fetchers.docSource(docId, version),
    enabled: !!docId,
    refetchInterval: 5000,
  })

  // Strip leading title and Kind/Status/Version lines from rendered content
  // since we already show them in the header above
  const rendered = useMemo(() => {
    let text = (sourceData?.renderedContent ?? "").trimStart()
    // Strip leading "# Title\n" line
    const leadingHeading = text.match(/^#\s+([^\n]+)\n+/)
    if (leadingHeading && doc && leadingHeading[1].trim() === doc.title.trim()) text = text.slice(leadingHeading[0].length)
    // Strip "**Kind**: ..." line
    text = text.replace(/^\*\*Kind\*\*:\s*\w+\n+/, "")
    // Strip "**Status**: ..." line
    text = text.replace(/^\*\*Status\*\*:\s*\w+\n+/, "")
    // Strip "**Version**: ..." line
    text = text.replace(/^\*\*Version\*\*:\s*\d+\n+/, "")
    // Strip "**Implements**: ..." line
    text = text.replace(/^\*\*Implements\*\*:\s*[^\n]+\n+/, "")
    return text.trim()
  }, [sourceData, doc?.title])

  if (docLoading) {
    return (
      <div className="space-y-4 p-8">
        <div className="animate-pulse bg-gray-800 h-8 w-2/3 rounded" />
        <div className="animate-pulse bg-gray-800 h-4 w-1/2 rounded" />
        <div className="animate-pulse bg-gray-800 h-64 rounded-lg mt-4" />
      </div>
    )
  }

  if (!doc) {
    return (
      <div role="alert" className="p-8 text-gray-400">
        <p>{docError instanceof ApiError && docError.status === 404 ? "Document not found" : `Could not load document: ${docError?.message ?? "No response"}`}</p>
        <Button className="mt-3" onClick={() => { void retryDoc() }}>Retry document</Button>
      </div>
    )
  }

  return (
    <div className="p-8 pb-20">
      {/* Kind label */}
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">
        {KIND_LABELS.get(doc.kind) ?? doc.kind.toUpperCase()}
      </div>

      {/* Title + status + version */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h1 className="text-2xl font-bold text-white">{doc.title}</h1>
        <StatusBadge status={doc.status} />
        <span className="text-xs text-gray-500 font-mono">v{doc.version}</span>
      </div>

      {/* Metadata line */}
      <div className="flex flex-wrap items-center gap-2 break-all text-xs text-gray-500 mb-8 font-mono">
        <span>{doc.name}</span>
        <span className="text-gray-600">&middot;</span>
        <span>{doc.docId}</span>
        <span className="text-gray-600">&middot;</span>
        <span>SHA: {doc.hash.slice(0, 10)}</span>
        <span className="text-gray-600">&middot;</span>
        <span>{doc.filePath}</span>
      </div>

      {/* Relationships */}
      <DocumentLinks nodeId={`doc:${doc.id}`} onNavigateToDoc={onNavigateToDoc} />

      {/* Content */}
      <div>
        {sourceError && <div role="alert" className="mb-4 text-sm text-amber-400">
          <p>Could not load document content: {sourceError.message}</p>
          <Button className="mt-2" onClick={() => { void retrySource() }}>Retry content</Button>
        </div>}
        {(!rendered && sourceLoading) ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse bg-gray-800 h-4 rounded" style={{ width: `${60 + ((i * 17 + 7) % 40)}%` }} />
            ))}
          </div>
        ) : rendered ? (
          <div className="prose prose-sm max-w-none tx-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {rendered}
            </ReactMarkdown>
          </div>
        ) : !sourceError ? (
          <div className="text-sm text-gray-500 italic">Document content is unavailable. Check {doc.filePath} in this checkout.</div>
        ) : null}
      </div>
    </div>
  )
}
