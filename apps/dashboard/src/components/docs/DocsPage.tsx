import { useState } from "react"
import { DocSidebar } from "./DocSidebar"
import { DocDetail } from "./DocDetail"
import { DocGraph } from "./DocGraph"

export function DocsPage() {
  const [selectedDocName, setSelectedDocName] = useState<string | null>(null)
  const [showMap, setShowMap] = useState(false)

  return (
    <div className="flex h-full overflow-hidden">
      {/* Sidebar */}
      <div className="w-72 border-r border-gray-700 p-4 overflow-y-auto flex-shrink-0">
        <DocSidebar
          selectedDocName={selectedDocName}
          onSelectDoc={setSelectedDocName}
          showMap={showMap}
          onToggleMap={() => setShowMap(!showMap)}
        />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden relative">
        <div className="flex-1 overflow-y-auto">
          {!selectedDocName ? (
            <div className="flex items-center justify-center h-full text-gray-500">
              <div className="text-center">
                <div className="text-4xl mb-4 opacity-30">&#x1F4C4;</div>
                <div className="text-lg mb-2">Select a doc to view details</div>
                <div className="text-sm">
                  Docs show PRDs, design docs, and system overviews
                </div>
              </div>
            </div>
          ) : (
            <DocDetail
              docName={selectedDocName}
              onNavigateToDoc={setSelectedDocName}
            />
          )}
        </div>

        {/* Mini graph overlay (bottom-left) */}
        {showMap && (
          <div className="absolute bottom-4 left-4 w-48 h-40 bg-gray-800/90 backdrop-blur border border-gray-700/50 rounded-lg p-2 shadow-xl">
            <DocGraph
              selectedDocName={selectedDocName}
              onSelectDoc={setSelectedDocName}
            />
          </div>
        )}
      </div>
    </div>
  )
}
