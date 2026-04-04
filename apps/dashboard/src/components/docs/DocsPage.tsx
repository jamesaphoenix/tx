import { useState, useMemo, useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { docSelectionKey, fetchers } from "../../api/client"
import { useCommands, type Command } from "../command-palette/CommandContext"
import { selectionStore, selectionActions } from "../../stores/selection-store"
import { Button } from "../ui"
import { DocSidebar } from "./DocSidebar"
import { DocDetail } from "./DocDetail"
import { DocGraph } from "./DocGraph"

export function DocsPage() {
  const [selectedDocRef, setSelectedDocRef] = useState<string | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [kindFilter, setKindFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")

  const selectedDocRefs = useStore(selectionStore, (s) => s.docRefs)
  const queryClient = useQueryClient()

  const handleToggleDoc = (ref: string) => {
    selectionActions.toggleDoc(ref)
  }

  // Fetch docs for command palette navigation
  const { data: docsData } = useQuery({
    queryKey: ["docs", kindFilter, statusFilter],
    queryFn: () => fetchers.docs({ kind: kindFilter || undefined, status: statusFilter || undefined }),
    refetchInterval: 10000,
  })
  const docs = docsData?.docs ?? []
  const selectedDoc = selectedDocRef
    ? docs.find((doc) => docSelectionKey(doc) === selectedDocRef) ?? null
    : null

  // Register doc-specific commands
  const commands = useMemo((): Command[] => {
    const cmds: Command[] = []

    // Toggle map
    cmds.push({
      id: "action:toggle-map",
      label: showMap ? "Close document graph" : "Open document graph",
      group: "Actions",
      icon: "action",
      action: () => setShowMap(!showMap),
    })

    // Select all docs
    if (docs.length > 0) {
      cmds.push({
        id: "select-all",
        label: "Select all docs",
        sublabel: `${docs.length} docs`,
        group: "Actions",
        icon: "select",
        shortcut: "⌘A",
        allowInInput: true,
        action: () => selectionActions.selectAllDocs(docs.map((doc) => docSelectionKey(doc))),
      })
    }
    if (selectedDocRefs.size > 0) {
      cmds.push({
        id: "action:copy-selected-docs",
        label: "Copy selected doc names",
        sublabel: `${selectedDocRefs.size} selected`,
        group: "Actions",
        icon: "copy",
        shortcut: "⌘C",
        action: async () => {
          const text = docs
            .filter((doc) => selectedDocRefs.has(docSelectionKey(doc)))
            .map(d => `${d.name} (${d.kind}) - ${d.title}`)
            .join("\n")
          await navigator.clipboard.writeText(text)
        },
      })
      cmds.push({
        id: "action:delete-selected-docs",
        label: "Delete selected docs",
        sublabel: `${selectedDocRefs.size} selected`,
        group: "Actions",
        icon: "delete",
        action: async () => {
          if (confirm(`Delete ${selectedDocRefs.size} selected doc(s)? This cannot be undone.`)) {
            for (const doc of docs) {
              if (!selectedDocRefs.has(docSelectionKey(doc))) continue
              await fetchers.deleteDoc(doc.docId, doc.version)
            }
            selectionActions.clearDocs()
            if (selectedDocRef && selectedDocRefs.has(selectedDocRef)) {
              setSelectedDocRef(null)
            }
            queryClient.invalidateQueries({ queryKey: ["docs"] })
          }
        },
      })
      cmds.push({
        id: "action:clear-doc-selection",
        label: "Clear doc selection",
        sublabel: `${selectedDocRefs.size} selected`,
        group: "Actions",
        icon: "action",
        action: () => selectionActions.clearDocs(),
      })
    }

    // Kind filters
    cmds.push(
      { id: "filter:doc-overview", label: "Filter: Overview docs", group: "Filters", icon: "filter", action: () => setKindFilter("overview") },
      { id: "filter:doc-prd", label: "Filter: PRD docs", group: "Filters", icon: "filter", action: () => setKindFilter("prd") },
      { id: "filter:doc-design", label: "Filter: Design docs", group: "Filters", icon: "filter", action: () => setKindFilter("design") },
      { id: "filter:doc-requirement", label: "Filter: Requirement docs", group: "Filters", icon: "filter", action: () => setKindFilter("requirement") },
      { id: "filter:doc-system-design", label: "Filter: System Design docs", group: "Filters", icon: "filter", action: () => setKindFilter("system_design") },
      { id: "filter:doc-all-kinds", label: "Filter: All doc kinds", group: "Filters", icon: "filter", action: () => setKindFilter("") },
    )

    // Status filters
    cmds.push(
      { id: "filter:doc-changing", label: "Filter: Changing docs", group: "Filters", icon: "filter", action: () => setStatusFilter("changing") },
      { id: "filter:doc-locked", label: "Filter: Locked docs", group: "Filters", icon: "filter", action: () => setStatusFilter("locked") },
      { id: "filter:doc-all-statuses", label: "Filter: All statuses", group: "Filters", icon: "filter", action: () => setStatusFilter("") },
    )

    // Navigate to each doc
    for (const doc of docs) {
      cmds.push({
        id: `nav:doc-${doc.id}`,
        label: doc.title || doc.name,
        sublabel: `${doc.kind} - ${doc.name} (v${doc.version})`,
        group: "Items",
        icon: "nav",
        action: () => { setSelectedDocRef(docSelectionKey(doc)); setShowMap(false) },
      })
    }

    // Copy doc name if one is selected (with title)
    if (selectedDoc) {
      cmds.push({
        id: "action:copy-doc-name",
        label: "Copy doc name",
        sublabel: `${selectedDoc.name} (v${selectedDoc.version})`,
        group: "Actions",
        icon: "copy",
        shortcut: selectedDocRefs.size === 0 ? "⌘C" : undefined,
        action: async () => {
          const text = `${selectedDoc.name} - ${selectedDoc.title}`
          await navigator.clipboard.writeText(text)
        },
      })
    }

    return cmds
  }, [docs, selectedDoc, selectedDocRef, selectedDocRefs, showMap, queryClient])

  useCommands(commands)

  // ESC closes graph view
  useEffect(() => {
    if (!showMap) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        setShowMap(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [showMap])

  // Full-page map mode
  if (showMap) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700/50 flex-shrink-0">
          <Button size="sm" variant="secondary" onClick={() => setShowMap(false)}>
            &larr; Back to Docs
          </Button>
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Document Graph
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden relative">
          <DocGraph
            selectedNodeId={selectedDoc ? `doc:${selectedDoc.id}` : null}
            onSelectDoc={(docDbId) => {
              const doc = docs.find((candidate) => candidate.id === docDbId)
              if (!doc) return
              setSelectedDocRef(docSelectionKey(doc))
              setShowMap(false)
            }}
            fullPage
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden">
      <div className="w-72 min-h-0 border-r border-gray-700 p-4 overflow-y-auto flex-shrink-0">
        <DocSidebar
          selectedDocRef={selectedDocRef}
          onSelectDoc={setSelectedDocRef}
          showMap={showMap}
          onToggleMap={() => setShowMap(true)}
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          selectedDocRefs={selectedDocRefs}
          onToggleSelectDoc={handleToggleDoc}
        />
      </div>
      {!selectedDoc ? (
        <div className="min-h-0 flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <div className="text-4xl mb-4 opacity-30">&#x1F4C4;</div>
            <div className="text-lg mb-2">Select a doc to view details</div>
            <div className="text-sm">
              Docs show PRDs, design docs, and system overviews
            </div>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <DocDetail
            docId={selectedDoc.docId}
            version={selectedDoc.version}
            onNavigateToDoc={(nextDocId, nextVersion) => {
              const next = docs.find((doc) => doc.docId === nextDocId && doc.version === nextVersion)
              if (next) {
                setSelectedDocRef(docSelectionKey(next))
              }
            }}
          />
        </div>
      )}
    </div>
  )
}
