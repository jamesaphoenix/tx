import { useState, useMemo, useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { fetchers } from "../../api/client"
import { useCommands, type Command } from "../command-palette/CommandContext"
import { selectionStore, selectionActions } from "../../stores/selection-store"
import { DocSidebar } from "./DocSidebar"
import { DocDetail } from "./DocDetail"
import { DocGraph } from "./DocGraph"

export function DocsPage() {
  const [selectedDocName, setSelectedDocName] = useState<string | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [kindFilter, setKindFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")

  const selectedDocNames = useStore(selectionStore, (s) => s.docNames)
  const queryClient = useQueryClient()

  const handleToggleDoc = (name: string) => {
    selectionActions.toggleDoc(name)
  }

  // Fetch docs for command palette navigation
  const { data: docsData } = useQuery({
    queryKey: ["docs", kindFilter, statusFilter],
    queryFn: () => fetchers.docs({ kind: kindFilter || undefined, status: statusFilter || undefined }),
    refetchInterval: 10000,
  })
  const docs = docsData?.docs ?? []

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
        action: () => selectionActions.selectAllDocs(docs.map(d => d.name)),
      })
    }
    if (selectedDocNames.size > 0) {
      cmds.push({
        id: "action:copy-selected-docs",
        label: "Copy selected doc names",
        sublabel: `${selectedDocNames.size} selected`,
        group: "Actions",
        icon: "copy",
        shortcut: "⌘C",
        action: async () => {
          const text = docs
            .filter(d => selectedDocNames.has(d.name))
            .map(d => `${d.name} (${d.kind}) - ${d.title}`)
            .join("\n")
          await navigator.clipboard.writeText(text)
        },
      })
      cmds.push({
        id: "action:delete-selected-docs",
        label: "Delete selected docs",
        sublabel: `${selectedDocNames.size} selected`,
        group: "Actions",
        icon: "delete",
        action: async () => {
          if (confirm(`Delete ${selectedDocNames.size} selected doc(s)? This cannot be undone.`)) {
            for (const name of selectedDocNames) {
              await fetchers.deleteDoc(name)
            }
            selectionActions.clearDocs()
            if (selectedDocName && selectedDocNames.has(selectedDocName)) {
              setSelectedDocName(null)
            }
            queryClient.invalidateQueries({ queryKey: ["docs"] })
          }
        },
      })
      cmds.push({
        id: "action:clear-doc-selection",
        label: "Clear doc selection",
        sublabel: `${selectedDocNames.size} selected`,
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
        id: `nav:doc-${doc.name}`,
        label: doc.title || doc.name,
        sublabel: `${doc.kind} - ${doc.name}`,
        group: "Items",
        icon: "nav",
        action: () => { setSelectedDocName(doc.name); setShowMap(false) },
      })
    }

    // Copy doc name if one is selected (with title)
    if (selectedDocName) {
      const doc = docs.find(d => d.name === selectedDocName)
      cmds.push({
        id: "action:copy-doc-name",
        label: "Copy doc name",
        sublabel: selectedDocName,
        group: "Actions",
        icon: "copy",
        shortcut: selectedDocNames.size === 0 ? "⌘C" : undefined,
        action: async () => {
          const text = doc ? `${doc.name} - ${doc.title}` : selectedDocName
          await navigator.clipboard.writeText(text)
        },
      })
    }

    return cmds
  }, [docs, showMap, selectedDocName, selectedDocNames, queryClient])

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
      <div className="flex flex-col h-full w-full overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700/50 flex-shrink-0">
          <button
            onClick={() => setShowMap(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
          >
            &larr; Back to Docs
          </button>
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
            Document Graph
          </span>
        </div>
        <div className="flex-1 bg-gray-900 p-6 overflow-hidden relative">
          <DocGraph
            selectedDocName={selectedDocName}
            onSelectDoc={(name) => {
              setSelectedDocName(name)
              setShowMap(false)
            }}
            fullPage
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="w-72 border-r border-gray-700 p-4 overflow-y-auto flex-shrink-0">
        <DocSidebar
          selectedDocName={selectedDocName}
          onSelectDoc={setSelectedDocName}
          showMap={showMap}
          onToggleMap={() => setShowMap(true)}
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          selectedDocNames={selectedDocNames}
          onToggleSelectDoc={handleToggleDoc}
        />
      </div>
      {!selectedDocName ? (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <div className="text-4xl mb-4 opacity-30">&#x1F4C4;</div>
            <div className="text-lg mb-2">Select a doc to view details</div>
            <div className="text-sm">
              Docs show PRDs, design docs, and system overviews
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <DocDetail
            docName={selectedDocName}
            onNavigateToDoc={setSelectedDocName}
          />
        </div>
      )}
    </div>
  )
}
