import { useMemo, useState } from "react"
import { Button } from "../ui"
import { useQuery } from "@tanstack/react-query"
import { docSelectionKey, fetchers, type DocSerialized } from "../../api/client"
import { SpecHealth } from "./SpecHealth"

interface DocSidebarProps {
  selectedDocRef: string | null
  onSelectDoc: (ref: string) => void
  showMap: boolean
  onToggleMap: () => void
  kindFilter: string
  onKindFilterChange: (kind: string) => void
  statusFilter: string
  onStatusFilterChange: (status: string) => void
  selectedDocRefs?: Set<string>
  onToggleSelectDoc?: (ref: string) => void
}

const STATUS_DOT: Record<string, string> = {
  changing: "bg-orange-400",
  locked: "bg-green-400",
}

const KIND_LABELS = new Map<string, string>(Object.entries({
  plan: "Plan",
  overview: "Overview",
  prd: "PRD",
  design: "Design",
  requirement: "REQ",
  system_design: "SD",
  runbook: "RB",
  decision: "DEC",
}))

interface DocGroup {
  label: string
  docs: DocSerialized[]
}

/** Sort docs by createdAt descending (most recent first). */
function sortByRecent(docs: DocSerialized[]): DocSerialized[] {
  return [...docs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

/**
 * Group docs by their numbering prefix (e.g., "023" from "PRD-023-..." or "DD-023-...").
 * Overview docs with no prefix go at the top level.
 * Within each group, docs are sorted by most recently created.
 */
function groupDocs(docs: DocSerialized[]): { topLevel: DocSerialized[]; groups: DocGroup[] } {
  const topLevel: DocSerialized[] = []
  const groupMap = new Map<string, DocSerialized[]>()

  for (const doc of docs) {
    if (doc.kind === "overview") {
      topLevel.push(doc)
      continue
    }

    // Extract numeric prefix: PRD-023-..., DD-023-..., REQ-033-..., SD-003-...
    const match = doc.name.match(/^(?:PRD|DD|REQ|SD|prd|dd|req|sd)-?(\d{3})/i)
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
    const sorted = sortByRecent(groupDocs)
    // Try to derive a label from the first doc's title
    const label = `${key} - ${sorted[0]?.title?.split(" ").slice(0, 4).join(" ") ?? key}`
    groups.push({ label: label.toUpperCase(), docs: sorted })
  }

  // Sort groups by most recent doc within each group
  groups.sort((a, b) => new Date(b.docs[0].createdAt).getTime() - new Date(a.docs[0].createdAt).getTime())

  return { topLevel: sortByRecent(topLevel), groups }
}

function matchesDocQuery(doc: DocSerialized, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return doc.name.toLowerCase().includes(q) || doc.title.toLowerCase().includes(q)
}

function DocItem({
  doc,
  isSelected,
  isChecked,
  onToggleCheck,
  onClick,
}: {
  doc: DocSerialized
  isSelected: boolean
  isChecked?: boolean
  onToggleCheck?: (ref: string) => void
  onClick: () => void
}) {
  return (
    <div className="relative">
      {onToggleCheck && (
        <input type="checkbox" checked={Boolean(isChecked)}
          aria-label={`Select ${doc.title || doc.name} (v${doc.version})`}
          onChange={() => onToggleCheck(docSelectionKey(doc))}
          className="absolute left-3 top-3 z-10 h-4 w-4 cursor-pointer accent-blue-500" />
      )}
      <button
        type="button" onClick={onClick} aria-current={isSelected ? "page" : undefined}
        className={`w-full text-left px-3 py-2 rounded-md transition ${onToggleCheck ? "pl-9" : ""} ${
          isChecked || isSelected
            ? "bg-blue-600/20 border border-blue-500/50"
            : "hover:bg-gray-800/70 border border-transparent"
        }`}
      >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[doc.status] ?? "bg-gray-400"}`} />
        <span className="text-sm text-white truncate flex-1">
          {doc.name}
        </span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded border font-semibold"
          style={{ backgroundColor: "#334155", color: "#f8fafc", borderColor: "#64748b" }}
        >
          {KIND_LABELS.get(doc.kind) ?? doc.kind}
        </span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded border font-semibold"
          style={{ backgroundColor: "#0f172a", color: "#f8fafc", borderColor: "#64748b" }}
        >
          v{doc.version}
        </span>
      </div>
      <div className="text-xs text-gray-500 ml-4 mt-0.5 truncate">
        {doc.title}
      </div>
      </button>
    </div>
  )
}

export function DocSidebar({ selectedDocRef, onSelectDoc, showMap, onToggleMap, kindFilter, onKindFilterChange, statusFilter, onStatusFilterChange, selectedDocRefs, onToggleSelectDoc }: DocSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("")

  const docsQuery = useQuery({
    queryKey: ["docs"],
    queryFn: () => fetchers.docs(),
    refetchInterval: 10000,
  })

  const docs = docsQuery.data?.docs ?? []
  const filteredDocs = useMemo(
    () => docs.filter((doc) => (!kindFilter || doc.kind === kindFilter)
      && (!statusFilter || doc.status === statusFilter) && matchesDocQuery(doc, searchQuery)),
    [docs, kindFilter, statusFilter, searchQuery],
  )
  const { topLevel, groups } = useMemo(() => groupDocs(filteredDocs), [filteredDocs])

  const isLoading = docsQuery.isLoading
  const loadError = docsQuery.error instanceof Error
    ? docsQuery.error.message
    : null

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
          Documents
        </span>
        <Button
          size="sm"
          variant={showMap ? "primary" : "ghost"}
          onClick={onToggleMap}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-70">
            <circle cx="3" cy="3" r="2" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="9" cy="9" r="2" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="9" cy="3" r="2" stroke="currentColor" strokeWidth="1.2" />
            <line x1="4.5" y1="3.5" x2="7.5" y2="3" stroke="currentColor" strokeWidth="1" />
            <line x1="4.5" y1="4" x2="7.5" y2="8" stroke="currentColor" strokeWidth="1" />
          </svg>
          Graph
        </Button>
      </div>

      <SpecHealth onSelectDoc={(docId) => {
        const match = docs.find((doc) => doc.docId === docId)
        if (match) {
          onSelectDoc(docSelectionKey(match))
        }
      }} />

      {/* Filters */}
      <div className="flex gap-2 mb-2">
        <select
          aria-label="Document kind"
          value={kindFilter}
          onChange={(e) => onKindFilterChange(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded px-2 py-1.5"
        >
          <option value="">All kinds</option>
          <option value="overview">Overview</option>
          <option value="prd">PRD</option>
          <option value="design">Design</option>
          <option value="plan">Plan</option>
          {[...new Set(docs.map(doc => doc.kind))].filter(kind => !["overview","prd","design","plan"].includes(kind)).sort().map(kind =>
            <option key={kind} value={kind}>{KIND_LABELS.get(kind) ?? kind}</option>)}
        </select>
        <select
          aria-label="Document status"
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded px-2 py-1.5"
        >
          <option value="">All statuses</option>
          <option value="changing">Changing</option>
          <option value="locked">Locked</option>
        </select>
      </div>

      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        data-native-select-all="true"
        aria-label="Search documents"
        placeholder="Search docs by name or title..."
        className="mb-3 w-full bg-gray-900 border border-gray-700 text-xs text-gray-200 rounded px-2.5 py-1.5 placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
      />

      {/* Doc tree */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {loadError ? (
          <div className="text-center py-8 text-red-300">
            <div className="text-sm">Unable to load docs</div>
            <div className="text-xs mt-1 text-red-400/80">{loadError}</div>
            <Button className="mt-3" onClick={() => {void docsQuery.refetch()}}>Retry documents</Button>
          </div>
        ) : (
          <>
            {/* Top-level docs (overviews) */}
            {topLevel.map((doc) => (
              <DocItem
                key={docSelectionKey(doc)}
                doc={doc}
                isSelected={selectedDocRef === docSelectionKey(doc)}
                isChecked={selectedDocRefs?.has(docSelectionKey(doc))}
                onToggleCheck={onToggleSelectDoc}
                onClick={() => onSelectDoc(docSelectionKey(doc))}
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
                      key={docSelectionKey(doc)}
                      doc={doc}
                      isSelected={selectedDocRef === docSelectionKey(doc)}
                      isChecked={selectedDocRefs?.has(docSelectionKey(doc))}
                      onToggleCheck={onToggleSelectDoc}
                      onClick={() => onSelectDoc(docSelectionKey(doc))}
                    />
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        {filteredDocs.length === 0 && !loadError && (
          <div className="text-center py-8 text-gray-500">
            <div className="text-sm">No docs found</div>
            <div className="text-xs mt-1">
              {searchQuery || kindFilter || statusFilter
                ? "Try a broader search term"
                : <>Start with <code className="text-gray-400">tx doc add design my-design</code></>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
