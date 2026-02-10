import type { ReactNode, JSX } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchers, type DocSerialized } from "../../api/client"

interface DocDetailProps {
  docName: string
  onNavigateToDoc: (name: string) => void
}

const KIND_LABELS: Record<string, string> = {
  overview: "OVERVIEW DOCUMENT",
  prd: "PRODUCT REQUIREMENTS",
  design: "DESIGN DOCUMENT",
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

/**
 * Render markdown-like content to HTML.
 * Simple approach: use basic text transformations.
 */
function RenderedContent({ content }: { content: string }) {
  // Split by double newline for paragraphs, handle headers/lists/code
  const lines = content.split("\n")
  const elements: ReactNode[] = []
  let inCodeBlock = false
  let codeLines: string[] = []
  let codeKey = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code block toggle
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${codeKey++}`} className="bg-gray-900 border border-gray-700 rounded-lg p-4 text-xs font-mono text-gray-300 overflow-x-auto my-3">
            {codeLines.join("\n")}
          </pre>
        )
        codeLines = []
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    // Headers
    if (line.startsWith("### ")) {
      elements.push(<h3 key={i} className="text-base font-semibold text-white mt-5 mb-2">{line.slice(4)}</h3>)
    } else if (line.startsWith("## ")) {
      elements.push(<h2 key={i} className="text-lg font-semibold text-white mt-6 mb-2 border-b border-gray-700/50 pb-1">{line.slice(3)}</h2>)
    } else if (line.startsWith("# ")) {
      elements.push(<h1 key={i} className="text-xl font-bold text-white mt-4 mb-3">{line.slice(2)}</h1>)
    }
    // Bullet list
    else if (line.match(/^\s*[-*]\s/)) {
      const indent = line.match(/^\s*/)?.[0]?.length ?? 0
      const text = line.replace(/^\s*[-*]\s/, "")
      elements.push(
        <div key={i} className="flex gap-2 my-0.5" style={{ paddingLeft: `${indent * 8 + 8}px` }}>
          <span className="text-gray-500 mt-1.5 flex-shrink-0">&#x2022;</span>
          <span className="text-sm text-gray-300 leading-relaxed">{renderInline(text)}</span>
        </div>
      )
    }
    // Numbered list
    else if (line.match(/^\s*\d+\.\s/)) {
      const num = line.match(/^\s*(\d+)\./)?.[1]
      const text = line.replace(/^\s*\d+\.\s/, "")
      elements.push(
        <div key={i} className="flex gap-2 my-0.5 pl-2">
          <span className="text-gray-500 text-sm flex-shrink-0">{num}.</span>
          <span className="text-sm text-gray-300 leading-relaxed">{renderInline(text)}</span>
        </div>
      )
    }
    // Empty line
    else if (line.trim() === "") {
      // skip
    }
    // Regular paragraph
    else {
      elements.push(
        <p key={i} className="text-sm text-gray-300 leading-relaxed my-1.5">
          {renderInline(line)}
        </p>
      )
    }
  }

  return <div>{elements}</div>
}

/** Render inline formatting: `code`, **bold**, *italic* */
function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/`([^`]+)`/)
    if (codeMatch && codeMatch.index !== undefined) {
      if (codeMatch.index > 0) {
        parts.push(remaining.slice(0, codeMatch.index))
      }
      parts.push(
        <code key={key++} className="px-1.5 py-0.5 bg-gray-800 text-purple-300 rounded text-xs font-mono">
          {codeMatch[1]}
        </code>
      )
      remaining = remaining.slice(codeMatch.index + codeMatch[0].length)
      continue
    }

    // Bold
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/)
    if (boldMatch && boldMatch.index !== undefined) {
      if (boldMatch.index > 0) {
        parts.push(remaining.slice(0, boldMatch.index))
      }
      parts.push(<strong key={key++} className="text-white font-medium">{boldMatch[1]}</strong>)
      remaining = remaining.slice(boldMatch.index + boldMatch[0].length)
      continue
    }

    // No more formatting
    parts.push(remaining)
    break
  }

  return parts
}

function RelationshipsSection({ doc, allDocs, onNavigateToDoc }: {
  doc: DocSerialized
  allDocs: DocSerialized[]
  onNavigateToDoc: (name: string) => void
}) {
  // Find parent doc
  const parentDoc = doc.parentDocId ? allDocs.find((d) => d.id === doc.parentDocId) : null

  // Find related docs (same group prefix)
  const prefix = doc.name.match(/^(?:PRD|DD|prd|dd)-?(\d{3})/i)?.[1]
  const related = prefix
    ? allDocs.filter((d) => d.name !== doc.name && d.name.match(new RegExp(`^(?:PRD|DD|prd|dd)-?${prefix}`, "i")))
    : []

  if (!parentDoc && related.length === 0) return null

  // Infer link type
  const inferLinkType = (from: DocSerialized, to: DocSerialized): string => {
    if (from.kind === "prd" && to.kind === "design") return "prd to design"
    if (from.kind === "overview" && to.kind === "prd") return "overview to prd"
    if (from.kind === "overview" && to.kind === "design") return "overview to design"
    return "related"
  }

  return (
    <div className="mb-6">
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Relationships
      </div>
      <div className="space-y-1.5">
        {parentDoc && (
          <div className="flex items-center gap-2">
            <span className="text-gray-500">&larr;</span>
            <button
              onClick={() => onNavigateToDoc(parentDoc.name)}
              className="text-sm text-blue-400 hover:text-blue-300 transition"
            >
              {parentDoc.name}
            </button>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
              parent
            </span>
          </div>
        )}
        {related.map((rel) => (
          <div key={rel.name} className="flex items-center gap-2">
            <span className="text-gray-500">&larr;</span>
            <button
              onClick={() => onNavigateToDoc(rel.name)}
              className="text-sm text-blue-400 hover:text-blue-300 transition"
            >
              {rel.name}
            </button>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
              {inferLinkType(rel, doc)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DocDetail({ docName, onNavigateToDoc }: DocDetailProps) {
  const { data: doc, isLoading: docLoading } = useQuery({
    queryKey: ["doc", docName],
    queryFn: () => fetchers.docDetail(docName),
    enabled: !!docName,
  })

  const { data: renderData, isLoading: renderLoading } = useQuery({
    queryKey: ["doc-render", docName],
    queryFn: () => fetchers.docRender(docName),
    enabled: !!docName,
  })

  const { data: allDocsData } = useQuery({
    queryKey: ["docs"],
    queryFn: () => fetchers.docs(),
  })

  const allDocs = allDocsData?.docs ?? []
  const rendered = renderData?.rendered?.[0] ?? ""

  if (docLoading) {
    return (
      <div className="space-y-4 p-6">
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
    <div className="p-6 max-w-4xl">
      {/* Kind label */}
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
        {KIND_LABELS[doc.kind] ?? doc.kind.toUpperCase()}
      </div>

      {/* Title + status + version */}
      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-xl font-bold text-white">{doc.title}</h1>
        <StatusBadge status={doc.status} />
        <span className="text-xs text-gray-500">v{doc.version}</span>
      </div>

      {/* Metadata line */}
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-6">
        <span className="font-mono">{doc.name}</span>
        <span>&middot;</span>
        <span>SHA: {doc.hash.slice(0, 10)}</span>
        <span>&middot;</span>
        <span className="font-mono">{doc.filePath}</span>
      </div>

      {/* Relationships */}
      <RelationshipsSection doc={doc} allDocs={allDocs} onNavigateToDoc={onNavigateToDoc} />

      {/* Content */}
      <div>
        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Content
        </div>
        {renderLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse bg-gray-800 h-4 rounded" style={{ width: `${60 + Math.random() * 40}%` }} />
            ))}
          </div>
        ) : rendered ? (
          <RenderedContent content={rendered} />
        ) : (
          <div className="text-sm text-gray-500 italic">
            No rendered content available
          </div>
        )}
      </div>
    </div>
  )
}
