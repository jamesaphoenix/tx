import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchers, type DocSerialized } from "../../api/client"

interface DocSidebarProps {
  selectedDocName: string | null
  onSelectDoc: (name: string) => void
  showMap: boolean
  onToggleMap: () => void
}

const KIND_COLORS: Record<string, string> = {
  overview: "bg-blue-400",
  prd: "bg-green-400",
  design: "bg-purple-400",
}

const STATUS_DOT: Record<string, string> = {
  changing: "bg-orange-400",
  locked: "bg-green-400",
}

interface DocGroup {
  label: string
  docs: DocSerialized[]
}

/**
 * Group docs by their numbering prefix (e.g., "023" from "PRD-023-..." or "DD-023-...").
 * Overview docs with no prefix go at the top level.
 */
function groupDocs(docs: DocSerialized[]): { topLevel: DocSerialized[]; groups: DocGroup[] } {
  const topLevel: DocSerialized[] = []
  const groupMap = new Map<string, DocSerialized[]>()

  for (const doc of docs) {
    if (doc.kind === "overview") {
      topLevel.push(doc)
      continue
    }

    // Extract numeric prefix: PRD-023-... or DD-023-... or prd-023-...
    const match = doc.name.match(/^(?:PRD|DD|prd|dd)-?(\d{3})/i)
    if (match) {
      const key = match[1]
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(doc)
    } else {
      topLevel.push(doc)
    }
  }

  const groups: DocGroup[] = []
  for (const [key, groupDocs] of groupMap) {
    // Try to derive a label from the first doc's title
    const label = `${key} - ${groupDocs[0]?.title?.split(" ").slice(0, 4).join(" ") ?? key}`
    groups.push({ label: label.toUpperCase(), docs: groupDocs })
  }

  return { topLevel, groups }
}

function DocItem({
  doc,
  isSelected,
  onClick,
}: {
  doc: DocSerialized
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-md transition ${
        isSelected
          ? "bg-blue-600/20 border border-blue-500/50"
          : "hover:bg-gray-800/70 border border-transparent"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[doc.status] ?? "bg-gray-400"}`} />
        <span className="text-sm text-white truncate flex-1">
          {doc.name}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${KIND_COLORS[doc.kind] ?? "bg-gray-500"} text-white font-medium`}>
          v{doc.version}
        </span>
      </div>
      <div className="text-xs text-gray-500 ml-4 mt-0.5 truncate">
        {doc.title}
      </div>
    </button>
  )
}

export function DocSidebar({ selectedDocName, onSelectDoc, showMap, onToggleMap }: DocSidebarProps) {
  const [kindFilter, setKindFilter] = useState<string>("")
  const [statusFilter, setStatusFilter] = useState<string>("")

  const { data, isLoading } = useQuery({
    queryKey: ["docs", kindFilter, statusFilter],
    queryFn: () =>
      fetchers.docs({
        kind: kindFilter || undefined,
        status: statusFilter || undefined,
      }),
    refetchInterval: 10000,
  })

  const docs = data?.docs ?? []
  const { topLevel, groups } = groupDocs(docs)

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="animate-pulse bg-gray-800 h-14 rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          Docs
        </span>
        <button
          onClick={onToggleMap}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition ${
            showMap
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-400 hover:bg-gray-600"
          }`}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-70">
            <circle cx="3" cy="3" r="2" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="9" cy="3" r="2" stroke="currentColor" strokeWidth="1.2" />
            <line x1="4.5" y1="3.5" x2="7.5" y2="3" stroke="currentColor" strokeWidth="1" />
            <line x1="4.5" y1="4" x2="7.5" y2="8" stroke="currentColor" strokeWidth="1" />
          </svg>
          Map
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-3">
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded px-2 py-1.5"
        >
          <option value="">All kinds</option>
          <option value="overview">overview</option>
          <option value="prd">prd</option>
          <option value="design">design</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded px-2 py-1.5"
        >
          <option value="">All statuses</option>
          <option value="changing">changing</option>
          <option value="locked">locked</option>
        </select>
      </div>

      {/* Doc tree */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {/* Top-level docs (overviews) */}
        {topLevel.map((doc) => (
          <DocItem
            key={doc.name}
            doc={doc}
            isSelected={selectedDocName === doc.name}
            onClick={() => onSelectDoc(doc.name)}
          />
        ))}

        {/* Grouped docs */}
        {groups.map((group) => (
          <div key={group.label} className="mt-3">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider px-3 py-1">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.docs.map((doc) => (
                <DocItem
                  key={doc.name}
                  doc={doc}
                  isSelected={selectedDocName === doc.name}
                  onClick={() => onSelectDoc(doc.name)}
                />
              ))}
            </div>
          </div>
        ))}

        {docs.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <div className="text-sm">No docs found</div>
            <div className="text-xs mt-1">
              Run <code className="text-gray-400">tx doc add</code> to create one
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
