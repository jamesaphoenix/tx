import { type JSX, useMemo } from "react"
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

// =============================================================================
// Inline rendering: `code`, **bold**, *italic*, [links](url)
// =============================================================================

function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // Find the earliest match among all inline patterns
    const patterns: { regex: RegExp; type: string }[] = [
      { regex: /`([^`]+)`/, type: "code" },
      { regex: /\*\*([^*]+)\*\*/, type: "bold" },
      { regex: /\*([^*]+)\*/, type: "italic" },
      { regex: /\[([^\]]+)\]\(([^)]+)\)/, type: "link" },
    ]

    let earliest: { index: number; match: RegExpMatchArray; type: string } | null = null
    for (const { regex, type } of patterns) {
      const m = remaining.match(regex)
      if (m && m.index !== undefined) {
        if (!earliest || m.index < earliest.index) {
          earliest = { index: m.index, match: m, type }
        }
      }
    }

    if (!earliest) {
      parts.push(remaining)
      break
    }

    if (earliest.index > 0) {
      parts.push(remaining.slice(0, earliest.index))
    }

    const { match, type } = earliest
    switch (type) {
      case "code":
        parts.push(
          <code key={key++} className="px-1.5 py-0.5 bg-gray-800 text-purple-300 rounded text-[13px] font-mono">
            {match[1]}
          </code>
        )
        break
      case "bold":
        parts.push(<strong key={key++} className="text-white font-semibold">{match[1]}</strong>)
        break
      case "italic":
        parts.push(<em key={key++} className="text-gray-200 italic">{match[1]}</em>)
        break
      case "link":
        parts.push(
          <a key={key++} href={match[2]} className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition">
            {match[1]}
          </a>
        )
        break
    }

    remaining = remaining.slice(earliest.index + match[0].length)
  }

  return parts
}

// =============================================================================
// Block-level markdown renderer
// =============================================================================

interface ParsedBlock {
  type: "heading" | "paragraph" | "code" | "bullet" | "numbered" | "blockquote" | "hr" | "table"
  level?: number // heading level or indent level
  content?: string
  lines?: string[]
  lang?: string
  rows?: string[][] // table rows
  hasHeader?: boolean
}

function parseBlocks(content: string): ParsedBlock[] {
  const lines = content.split("\n")
  const blocks: ParsedBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i])
        i++
      }
      blocks.push({ type: "code", lines: codeLines, lang: lang || undefined })
      i++ // skip closing ```
      continue
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr" })
      i++
      continue
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/)
    if (headingMatch) {
      blocks.push({ type: "heading", level: headingMatch[1].length, content: headingMatch[2] })
      i++
      continue
    }

    // Table (line with pipes)
    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableRows: string[][] = []
      let hasHeader = false
      while (i < lines.length && lines[i].includes("|")) {
        const row = lines[i].trim()
        // Skip separator row (|---|---|)
        if (/^\|[\s-:|]+\|$/.test(row)) {
          hasHeader = tableRows.length > 0
          i++
          continue
        }
        const cells = row.split("|").slice(1, -1).map((c) => c.trim())
        tableRows.push(cells)
        i++
      }
      if (tableRows.length > 0) {
        blocks.push({ type: "table", rows: tableRows, hasHeader })
      }
      continue
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = []
      while (i < lines.length && (lines[i].startsWith("> ") || lines[i].startsWith(">"))) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""))
        i++
      }
      blocks.push({ type: "blockquote", lines: quoteLines })
      continue
    }

    // Bullet list - collect consecutive bullet items
    if (line.match(/^\s*[-*]\s/)) {
      const items: string[] = []
      while (i < lines.length && lines[i].match(/^\s*[-*]\s/)) {
        items.push(lines[i])
        i++
      }
      blocks.push({ type: "bullet", lines: items })
      continue
    }

    // Numbered list - collect consecutive numbered items
    if (line.match(/^\s*\d+\.\s/)) {
      const items: string[] = []
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s/)) {
        items.push(lines[i])
        i++
      }
      blocks.push({ type: "numbered", lines: items })
      continue
    }

    // Empty line
    if (line.trim() === "") {
      i++
      continue
    }

    // Paragraph - collect consecutive non-empty, non-special lines
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("> ") &&
      !lines[i].match(/^\s*[-*]\s/) &&
      !lines[i].match(/^\s*\d+\.\s/) &&
      !(lines[i].includes("|") && lines[i].trim().startsWith("|")) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", content: paraLines.join(" ") })
    }
  }

  return blocks
}

function RenderedContent({ content }: { content: string }) {
  const blocks = useMemo(() => parseBlocks(content), [content])

  return (
    <div className="space-y-4">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading": {
            const styles: Record<number, string> = {
              1: "text-2xl font-bold text-white mt-8 mb-3",
              2: "text-xl font-semibold text-white mt-8 mb-3 pb-2 border-b border-gray-700/50",
              3: "text-lg font-semibold text-white mt-6 mb-2",
              4: "text-base font-medium text-gray-200 mt-4 mb-1.5",
            }
            const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4"
            return <Tag key={i} className={styles[block.level!] ?? styles[3]}>{renderInline(block.content!)}</Tag>
          }

          case "paragraph":
            return (
              <p key={i} className="text-[15px] text-gray-300 leading-7">
                {renderInline(block.content!)}
              </p>
            )

          case "code":
            return (
              <div key={i} className="relative group">
                {block.lang && (
                  <div className="absolute top-0 right-0 px-3 py-1 text-[10px] font-mono text-gray-500 uppercase">
                    {block.lang}
                  </div>
                )}
                <pre className="bg-gray-900 border border-gray-700/50 rounded-lg p-4 text-[13px] font-mono text-gray-300 overflow-x-auto leading-6">
                  {block.lines!.join("\n")}
                </pre>
              </div>
            )

          case "bullet":
            return (
              <ul key={i} className="space-y-1 my-2">
                {block.lines!.map((line, j) => {
                  const indent = line.match(/^\s*/)?.[0]?.length ?? 0
                  const text = line.replace(/^\s*[-*]\s/, "")
                  return (
                    <li key={j} className="flex gap-2.5" style={{ paddingLeft: `${indent * 8 + 4}px` }}>
                      <span className="text-blue-400 mt-1.5 flex-shrink-0 text-sm">&bull;</span>
                      <span className="text-[15px] text-gray-300 leading-7">{renderInline(text)}</span>
                    </li>
                  )
                })}
              </ul>
            )

          case "numbered":
            return (
              <ol key={i} className="space-y-1 my-2">
                {block.lines!.map((line, j) => {
                  const num = line.match(/^\s*(\d+)\./)?.[1]
                  const text = line.replace(/^\s*\d+\.\s/, "")
                  return (
                    <li key={j} className="flex gap-2.5 pl-1">
                      <span className="text-gray-500 text-[15px] flex-shrink-0 w-6 text-right font-mono">{num}.</span>
                      <span className="text-[15px] text-gray-300 leading-7">{renderInline(text)}</span>
                    </li>
                  )
                })}
              </ol>
            )

          case "blockquote":
            return (
              <blockquote key={i} className="border-l-3 border-blue-500/50 pl-4 py-1 my-4 bg-blue-500/5 rounded-r-lg">
                {block.lines!.map((line, j) => (
                  <p key={j} className="text-[15px] text-gray-400 leading-7 italic">
                    {renderInline(line)}
                  </p>
                ))}
              </blockquote>
            )

          case "hr":
            return <hr key={i} className="border-gray-700/50 my-6" />

          case "table":
            return (
              <div key={i} className="overflow-x-auto my-4 rounded-lg border border-gray-700/50">
                <table className="w-full text-sm">
                  {block.hasHeader && block.rows!.length > 0 && (
                    <thead>
                      <tr className="bg-gray-800/80">
                        {block.rows![0].map((cell, c) => (
                          <th key={c} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                            {renderInline(cell)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                  )}
                  <tbody className="divide-y divide-gray-700/30">
                    {block.rows!.slice(block.hasHeader ? 1 : 0).map((row, r) => (
                      <tr key={r} className="hover:bg-gray-800/30 transition">
                        {row.map((cell, c) => (
                          <td key={c} className="px-4 py-2 text-[14px] text-gray-300">
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )

          default:
            return null
        }
      })}
    </div>
  )
}

// =============================================================================
// Relationships section
// =============================================================================

function RelationshipsSection({ doc, allDocs, onNavigateToDoc }: {
  doc: DocSerialized
  allDocs: DocSerialized[]
  onNavigateToDoc: (name: string) => void
}) {
  const parentDoc = doc.parentDocId ? allDocs.find((d) => d.id === doc.parentDocId) : null

  const prefix = doc.name.match(/^(?:PRD|DD|prd|dd)-?(\d{3})/i)?.[1]
  const related = prefix
    ? allDocs.filter((d) => d.name !== doc.name && d.name.match(new RegExp(`^(?:PRD|DD|prd|dd)-?${prefix}`, "i")))
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
          <button
            onClick={() => onNavigateToDoc(parentDoc.name)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700/50 hover:border-blue-500/50 hover:bg-gray-750 transition text-sm"
          >
            <span className="text-gray-500">&larr;</span>
            <span className="text-blue-400">{parentDoc.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">parent</span>
          </button>
        )}
        {related.map((rel) => (
          <button
            key={rel.name}
            onClick={() => onNavigateToDoc(rel.name)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700/50 hover:border-blue-500/50 hover:bg-gray-750 transition text-sm"
          >
            <span className="text-gray-500">&larr;</span>
            <span className="text-blue-400">{rel.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
              {inferLinkType(doc, rel)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// DocDetail component
// =============================================================================

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
  // Strip leading title and Kind/Status/Version lines from rendered content
  // since we already show them in the header above
  const rendered = useMemo(() => {
    let text = renderData?.rendered?.[0] ?? ""
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
  }, [renderData])

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
    <div className="p-8">
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
        <span>SHA: {doc.hash.slice(0, 10)}</span>
        <span className="text-gray-600">&middot;</span>
        <span>{doc.filePath}</span>
      </div>

      {/* Relationships */}
      <RelationshipsSection doc={doc} allDocs={allDocs} onNavigateToDoc={onNavigateToDoc} />

      {/* Content */}
      <div>
        {renderLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse bg-gray-800 h-4 rounded" style={{ width: `${60 + ((i * 17 + 7) % 40)}%` }} />
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
