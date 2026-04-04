import { useMemo } from "react"
import { Button } from "../ui"
import { useQuery } from "@tanstack/react-query"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { fetchers, type DocSerialized } from "../../api/client"

interface DocDetailProps {
  docId: string
  version: number
  onNavigateToDoc: (docId: string, version: number) => void
}

const KIND_LABELS: Record<string, string> = {
  overview: "OVERVIEW DOCUMENT",
  prd: "PRODUCT REQUIREMENTS",
  design: "DESIGN DOCUMENT",
  requirement: "REQUIREMENT",
  system_design: "SYSTEM DESIGN",
  runbook: "RUNBOOK",
  decision: "DECISION RECORD",
}

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
// Relationships section
// =============================================================================

function RelationshipsSection({ doc, allDocs, onNavigateToDoc }: {
  doc: DocSerialized
  allDocs: DocSerialized[]
  onNavigateToDoc: (docId: string, version: number) => void
}) {
  const parentDoc = doc.parentDocId ? allDocs.find((d) => d.id === doc.parentDocId) : null

  const prefix = doc.name.match(/^(?:PRD|DD|prd|dd)-?(\d{3})/i)?.[1]
  const related = prefix
    ? allDocs.filter((d) => (d.docId !== doc.docId || d.version !== doc.version) && d.name.match(new RegExp(`^(?:PRD|DD|prd|dd)-?${prefix}`, "i")))
    : []

  if (!parentDoc && related.length === 0) return null

  const inferLinkType = (from: DocSerialized, to: DocSerialized): string => {
    if (from.kind === "prd" && to.kind === "design") return "prd to design"
    if (from.kind === "overview" && to.kind === "prd") return "overview to prd"
    if (from.kind === "overview" && to.kind === "design") return "overview to design"
    return "related"
  }

  return (
    <div className="mb-8 p-4 bg-gray-800/30 rounded-lg border border-gray-700/30">
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">
        Relationships
      </div>
      <div className="flex flex-wrap gap-3">
        {parentDoc && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onNavigateToDoc(parentDoc.docId, parentDoc.version)}
          >
            <span className="text-gray-500">&larr;</span>
            <span className="text-blue-400">{parentDoc.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">parent</span>
          </Button>
        )}
        {related.map((rel) => (
          <Button
            key={`${rel.docId}:${rel.version}`}
            size="sm"
            variant="secondary"
            onClick={() => onNavigateToDoc(rel.docId, rel.version)}
          >
            <span className="text-gray-500">&larr;</span>
            <span className="text-blue-400">{rel.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
              {inferLinkType(doc, rel)}
            </span>
          </Button>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// DocDetail component
// =============================================================================

export function DocDetail({ docId, version, onNavigateToDoc }: DocDetailProps) {
  const { data: doc, isLoading: docLoading } = useQuery({
    queryKey: ["doc", docId, version],
    queryFn: () => fetchers.docDetail(docId, version),
    enabled: !!docId,
    refetchInterval: 5000,
  })

  const { data: allDocsData } = useQuery({
    queryKey: ["docs"],
    queryFn: () => fetchers.docs(),
    refetchInterval: 5000,
  })

  const { data: sourceData, isLoading: sourceLoading } = useQuery({
    queryKey: ["doc-source", docId, version],
    queryFn: () => fetchers.docSource(docId, version),
    enabled: !!docId,
    refetchInterval: 5000,
  })

  const allDocs = allDocsData?.docs ?? []
  // Strip leading title and Kind/Status/Version lines from rendered content
  // since we already show them in the header above
  const rendered = useMemo(() => {
    let text = sourceData?.renderedContent ?? ""
    // Strip leading "# Title\n" line
    text = text.replace(/^#\s+[^\n]+\n+/, "")
    // Strip "**Kind**: ..." line
    text = text.replace(/^\*\*Kind\*\*:\s*\w+\n+/, "")
    // Strip "**Status**: ..." line
    text = text.replace(/^\*\*Status\*\*:\s*\w+\n+/, "")
    // Strip "**Version**: ..." line
    text = text.replace(/^\*\*Version\*\*:\s*\d+\n+/, "")
    // Strip "**Implements**: ..." line
    text = text.replace(/^\*\*Implements\*\*:\s*[^\n]+\n+/, "")
    return text.trim()
  }, [sourceData])

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
      <div className="flex items-center justify-center h-full text-gray-500">
        Doc not found
      </div>
    )
  }

  return (
    <div className="p-8 pb-20">
      {/* Kind label */}
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-3">
        {KIND_LABELS[doc.kind] ?? doc.kind.toUpperCase()}
      </div>

      {/* Title + status + version */}
      <div className="flex items-center gap-3 mb-3">
        <h1 className="text-2xl font-bold text-white">{doc.title}</h1>
        <StatusBadge status={doc.status} />
        <span className="text-xs text-gray-500 font-mono">v{doc.version}</span>
      </div>

      {/* Metadata line */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-8 font-mono">
        <span>{doc.name}</span>
        <span className="text-gray-600">&middot;</span>
        <span>{doc.docId}</span>
        <span className="text-gray-600">&middot;</span>
        <span>SHA: {doc.hash.slice(0, 10)}</span>
        <span className="text-gray-600">&middot;</span>
        <span>{doc.filePath}</span>
      </div>

      {/* Relationships */}
      <RelationshipsSection doc={doc} allDocs={allDocs} onNavigateToDoc={onNavigateToDoc} />

      {/* Content */}
      <div>
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
        ) : (
          <div className="text-sm text-gray-500 italic">No rendered content available</div>
        )}
      </div>
    </div>
  )
}
