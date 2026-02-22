import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { fetchers, type DocSerialized, type DocGraphEdge, type DocGraphNode } from "../../api/client"

interface DocSidebarProps {
  selectedDocName: string | null
  onSelectDoc: (name: string) => void
  showMap: boolean
  onToggleMap: () => void
  kindFilter: string
  onKindFilterChange: (kind: string) => void
  statusFilter: string
  onStatusFilterChange: (status: string) => void
  selectedDocNames?: Set<string>
  onToggleSelectDoc?: (name: string) => void
}

const STATUS_DOT: Record<string, string> = {
  changing: "bg-orange-400",
  locked: "bg-green-400",
}

const KIND_LABELS: Record<DocSerialized["kind"], string> = {
  overview: "OV",
  prd: "PRD",
  design: "DD",
}

interface DocGroup {
  label: string
  docs: DocSerialized[]
}

type DocsViewMode = "grouped" | "hierarchy"

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

interface DocHierarchyNode {
  doc: DocSerialized
  children: DocHierarchyNode[]
}

function buildDocHierarchy(
  docs: DocSerialized[],
  graphNodes: DocGraphNode[],
  graphEdges: DocGraphEdge[],
): DocHierarchyNode[] {
  const docsByName = new Map(docs.map((doc) => [doc.name, doc]))
  const nodeToDocName = new Map<string, string>()
  for (const node of graphNodes) {
    if (node.kind !== "task") {
      nodeToDocName.set(node.id, node.label)
    }
  }

  const childNamesByParent = new Map<string, Set<string>>()
  const incomingCount = new Map<string, number>()
  for (const doc of docs) {
    childNamesByParent.set(doc.name, new Set<string>())
    incomingCount.set(doc.name, 0)
  }

  for (const edge of graphEdges) {
    if (!edge.source.startsWith("doc:") || !edge.target.startsWith("doc:")) continue
    const fromName = nodeToDocName.get(edge.source)
    const toName = nodeToDocName.get(edge.target)
    if (!fromName || !toName || fromName === toName) continue
    if (!docsByName.has(fromName) || !docsByName.has(toName)) continue

    const children = childNamesByParent.get(fromName)
    if (!children || children.has(toName)) continue
    children.add(toName)
    incomingCount.set(toName, (incomingCount.get(toName) ?? 0) + 1)
  }

  const sortByName = (a: string, b: string) => a.localeCompare(b)
  const visited = new Set<string>()

  const buildNode = (name: string, stack: Set<string>): DocHierarchyNode | null => {
    const doc = docsByName.get(name)
    if (!doc) return null
    if (stack.has(name)) return null
    visited.add(name)

    const nextStack = new Set(stack)
    nextStack.add(name)
    const childNames = [...(childNamesByParent.get(name) ?? [])].sort(sortByName)
    const children: DocHierarchyNode[] = []
    for (const childName of childNames) {
      const childNode = buildNode(childName, nextStack)
      if (childNode) children.push(childNode)
    }
    return { doc, children }
  }

  const roots = docs
    .map((doc) => doc.name)
    .filter((name) => (incomingCount.get(name) ?? 0) === 0)
    .sort(sortByName)

  const tree: DocHierarchyNode[] = []
  for (const rootName of roots) {
    const node = buildNode(rootName, new Set<string>())
    if (node) tree.push(node)
  }

  const unvisited = docs
    .map((doc) => doc.name)
    .filter((name) => !visited.has(name))
    .sort(sortByName)
  for (const name of unvisited) {
    const node = buildNode(name, new Set<string>())
    if (node) tree.push(node)
  }

  return tree
}

function matchesDocQuery(doc: DocSerialized, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return doc.name.toLowerCase().includes(q) || doc.title.toLowerCase().includes(q)
}

function filterHierarchy(nodes: DocHierarchyNode[], query: string): DocHierarchyNode[] {
  if (!query) return nodes

  const filtered: DocHierarchyNode[] = []
  for (const node of nodes) {
    const childMatches = filterHierarchy(node.children, query)
    if (matchesDocQuery(node.doc, query) || childMatches.length > 0) {
      filtered.push({
        doc: node.doc,
        children: childMatches,
      })
    }
  }
  return filtered
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
  onToggleCheck?: (name: string) => void
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 rounded-md transition ${
        isChecked
          ? "bg-blue-600/20 border border-blue-500/50"
          : isSelected
            ? "bg-blue-600/20 border border-blue-500/50"
            : "hover:bg-gray-800/70 border border-transparent"
      }`}
    >
      <div className="flex items-center gap-2">
        {onToggleCheck && (
          <span
            role="checkbox"
            aria-checked={isChecked}
            onClick={(e) => { e.stopPropagation(); onToggleCheck(doc.name) }}
            className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition cursor-pointer ${
              isChecked
                ? "bg-blue-500 border-blue-500 text-white"
                : "border-gray-500 hover:border-blue-400"
            }`}
          >
            {isChecked && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            )}
          </span>
        )}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[doc.status] ?? "bg-gray-400"}`} />
        <span className="text-sm text-white truncate flex-1">
          {doc.name}
        </span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded border font-semibold"
          style={{ backgroundColor: "#334155", color: "#f8fafc", borderColor: "#64748b" }}
        >
          {KIND_LABELS[doc.kind]}
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
  )
}

export function DocSidebar({ selectedDocName, onSelectDoc, showMap, onToggleMap, kindFilter, onKindFilterChange, statusFilter, onStatusFilterChange, selectedDocNames, onToggleSelectDoc }: DocSidebarProps) {
  const [viewMode, setViewMode] = useState<DocsViewMode>("grouped")
  const [searchQuery, setSearchQuery] = useState("")

  const docsQuery = useQuery({
    queryKey: ["docs", kindFilter, statusFilter],
    queryFn: () =>
      fetchers.docs({
        kind: kindFilter || undefined,
        status: statusFilter || undefined,
      }),
    refetchInterval: 10000,
  })

  const graphQuery = useQuery({
    queryKey: ["doc-graph"],
    queryFn: fetchers.docGraph,
    enabled: viewMode === "hierarchy",
    refetchInterval: 30000,
  })

  const docs = docsQuery.data?.docs ?? []
  const filteredDocs = useMemo(
    () => docs.filter((doc) => matchesDocQuery(doc, searchQuery)),
    [docs, searchQuery],
  )
  const graphNodes = graphQuery.data?.nodes ?? []
  const graphEdges = graphQuery.data?.edges ?? []
  const { topLevel, groups } = useMemo(() => groupDocs(filteredDocs), [filteredDocs])
  const hierarchy = useMemo(() => {
    const fullTree = buildDocHierarchy(docs, graphNodes, graphEdges)
    return filterHierarchy(fullTree, searchQuery)
  }, [docs, graphNodes, graphEdges, searchQuery])
  const kindCounts = useMemo(() => ({
    all: filteredDocs.length,
    overview: filteredDocs.filter((doc) => doc.kind === "overview").length,
    prd: filteredDocs.filter((doc) => doc.kind === "prd").length,
    design: filteredDocs.filter((doc) => doc.kind === "design").length,
  }), [filteredDocs])
  const isLoading = docsQuery.isLoading || (viewMode === "hierarchy" && graphQuery.isLoading)
  const loadError = docsQuery.error instanceof Error
    ? docsQuery.error.message
    : graphQuery.error instanceof Error
      ? graphQuery.error.message
      : null

  const renderHierarchyNode = (node: DocHierarchyNode, depth = 0) => (
    <div key={node.doc.name} className={depth > 0 ? "border-l border-gray-800/60 pl-2 ml-3" : ""}>
      <DocItem
        doc={node.doc}
        isSelected={selectedDocName === node.doc.name}
        isChecked={selectedDocNames?.has(node.doc.name)}
        onToggleCheck={onToggleSelectDoc}
        onClick={() => onSelectDoc(node.doc.name)}
      />
      {node.children.length > 0 && (
        <div className="space-y-1 mt-1">
          {node.children.map((child) => renderHierarchyNode(child, depth + 1))}
        </div>
      )}
    </div>
  )

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
          Graph
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-2">
        <select
          value={kindFilter}
          onChange={(e) => onKindFilterChange(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded px-2 py-1.5"
        >
          <option value="">All kinds</option>
          <option value="overview">overview</option>
          <option value="prd">prd</option>
          <option value="design">design</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 text-xs text-gray-300 rounded px-2 py-1.5"
        >
          <option value="">All statuses</option>
          <option value="changing">changing</option>
          <option value="locked">locked</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          onClick={() => setViewMode("grouped")}
          className={`px-2.5 py-1.5 rounded text-xs transition ${
            viewMode === "grouped"
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          Grouped
        </button>
        <button
          onClick={() => setViewMode("hierarchy")}
          className={`px-2.5 py-1.5 rounded text-xs transition ${
            viewMode === "hierarchy"
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-gray-300 hover:bg-gray-600"
          }`}
        >
          Hierarchy
        </button>
      </div>

      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        data-native-select-all="true"
        placeholder="Search docs by name or title..."
        className="mb-3 w-full bg-gray-900 border border-gray-700 text-xs text-gray-200 rounded px-2.5 py-1.5 placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
      />

      <div className="grid grid-cols-4 gap-1.5 mb-3">
        <div className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-center">
          <div className="text-[10px] text-gray-500 uppercase">All</div>
          <div className="text-xs text-gray-100 font-semibold">{kindCounts.all}</div>
        </div>
        <div className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-center">
          <div className="text-[10px] text-gray-500 uppercase">OV</div>
          <div className="text-xs text-gray-100 font-semibold">{kindCounts.overview}</div>
        </div>
        <div className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-center">
          <div className="text-[10px] text-gray-500 uppercase">PRD</div>
          <div className="text-xs text-gray-100 font-semibold">{kindCounts.prd}</div>
        </div>
        <div className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-center">
          <div className="text-[10px] text-gray-500 uppercase">DD</div>
          <div className="text-xs text-gray-100 font-semibold">{kindCounts.design}</div>
        </div>
      </div>

      {/* Doc tree */}
      <div className="flex-1 overflow-y-auto space-y-1">
        {loadError ? (
          <div className="text-center py-8 text-red-300">
            <div className="text-sm">Unable to load docs</div>
            <div className="text-xs mt-1 text-red-400/80">{loadError}</div>
          </div>
        ) : viewMode === "grouped" ? (
          <>
            {/* Top-level docs (overviews) */}
            {topLevel.map((doc) => (
              <DocItem
                key={doc.name}
                doc={doc}
                isSelected={selectedDocName === doc.name}
                isChecked={selectedDocNames?.has(doc.name)}
                onToggleCheck={onToggleSelectDoc}
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
                      isChecked={selectedDocNames?.has(doc.name)}
                      onToggleCheck={onToggleSelectDoc}
                      onClick={() => onSelectDoc(doc.name)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="space-y-1">
            {hierarchy.map((node) => renderHierarchyNode(node))}
          </div>
        )}

        {filteredDocs.length === 0 && !loadError && (
          <div className="text-center py-8 text-gray-500">
            <div className="text-sm">No docs found</div>
            <div className="text-xs mt-1">
              {searchQuery
                ? "Try a broader search term"
                : <>Run <code className="text-gray-400">tx doc add</code> to create one</>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
