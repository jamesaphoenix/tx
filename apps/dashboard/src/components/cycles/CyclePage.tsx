import { useState, useCallback, useMemo } from "react"
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import { fetchers } from "../../api/client"
import { useCommands, type Command } from "../command-palette/CommandContext"
import { selectionStore, selectionActions } from "../../stores/selection-store"
import { CycleSidebar } from "./CycleSidebar"
import { CycleSummary } from "./CycleSummary"
import { LossChart } from "./LossChart"
import { IssuesList, formatIssueForClipboard } from "./IssuesList"

export function CyclePage() {
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null)
  const selectedIssueIds = useStore(selectionStore, (s) => s.issueIds)
  const setSelectedIssueIds = useCallback((ids: Set<string>) => {
    selectionActions.selectAllIssues([...ids])
  }, [])
  const [issueFilter, setIssueFilter] = useState("all")

  const queryClient = useQueryClient()

  const { data: detail, isLoading } = useQuery({
    queryKey: ["cycle", selectedCycleId],
    queryFn: () => fetchers.cycleDetail(selectedCycleId!),
    enabled: !!selectedCycleId,
  })

  const { data: cyclesData } = useQuery({
    queryKey: ["cycles"],
    queryFn: fetchers.cycles,
    refetchInterval: 10000,
  })
  const cycles = cyclesData?.cycles ?? []

  const deleteMutation = useMutation({
    mutationFn: fetchers.deleteCycle,
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["cycles"] })
      if (selectedCycleId === deletedId) {
        setSelectedCycleId(null)
      }
    },
  })

  const deleteIssuesMutation = useMutation({
    mutationFn: fetchers.deleteIssues,
    onSuccess: () => {
      selectionActions.clearIssues()
      queryClient.invalidateQueries({ queryKey: ["cycle", selectedCycleId] })
      queryClient.invalidateQueries({ queryKey: ["cycles"] })
    },
  })

  const handleCopyIssues = useCallback(async (ids: string[]) => {
    if (!detail) return
    const selected = detail.issues.filter((i) => ids.includes(i.id))
    if (selected.length === 0) return
    const text = selected.map(formatIssueForClipboard).join("\n\n")
    await navigator.clipboard.writeText(text)
  }, [detail])

  // Register cycle-specific commands
  const commands = useMemo((): Command[] => {
    const cmds: Command[] = []

    // Navigate to cycles
    for (const cycle of cycles) {
      if (cycle.id !== selectedCycleId) {
        cmds.push({
          id: `nav:cycle-${cycle.id}`,
          label: cycle.name || `Cycle ${cycle.cycle}`,
          sublabel: `${cycle.rounds} rounds, ${cycle.totalNewIssues} issues, loss ${cycle.finalLoss}`,
          group: "Navigation",
          icon: "nav",
          action: () => setSelectedCycleId(cycle.id),
        })
      }
    }

    // Delete cycles
    for (const cycle of cycles) {
      cmds.push({
        id: `delete:cycle-${cycle.id}`,
        label: `Delete Cycle ${cycle.cycle}`,
        sublabel: `${cycle.totalNewIssues} issues will be removed`,
        group: "Actions",
        icon: "delete",
        action: () => {
          if (confirm(`Delete Cycle ${cycle.cycle} and all its ${cycle.totalNewIssues} issues?`)) {
            deleteMutation.mutate(cycle.id)
          }
        },
      })
    }

    // Issue-specific commands (only when a cycle with issues is selected)
    if (detail?.issues?.length) {
      const issues = detail.issues

      cmds.push({
        id: "select-all",
        label: "Select all issues",
        sublabel: `${issues.length} issues`,
        group: "Actions",
        icon: "select",
        shortcut: "⌘A",
        action: () => setSelectedIssueIds(new Set(issues.map((i) => i.id))),
      })

      cmds.push({
        id: "action:copy-all-issues",
        label: "Copy all issues",
        sublabel: `${issues.length} issues`,
        group: "Actions",
        icon: "copy",
        action: () => handleCopyIssues(issues.map((i) => i.id)),
      })

      if (selectedIssueIds.size > 0) {
        const allSelected = selectedIssueIds.size === issues.length
        cmds.push({
          id: "action:delete-selected-issues",
          label: allSelected ? "Delete all issues (delete cycle)" : "Delete selected issues",
          sublabel: allSelected
            ? `All ${issues.length} issues — removes entire cycle`
            : `${selectedIssueIds.size} of ${issues.length} issues`,
          group: "Actions",
          icon: "delete",
          action: () => {
            if (allSelected) {
              if (confirm(`Delete this cycle and all ${issues.length} issues? This cannot be undone.`)) {
                deleteMutation.mutate(selectedCycleId!)
              }
            } else {
              if (confirm(`Delete ${selectedIssueIds.size} selected issue(s)? This cannot be undone.`)) {
                deleteIssuesMutation.mutate([...selectedIssueIds])
              }
            }
          },
        })
      }

      if (selectedIssueIds.size > 0) {
        cmds.push({
          id: "action:copy-selected",
          label: "Copy selected issues",
          sublabel: `${selectedIssueIds.size} selected`,
          group: "Actions",
          icon: "copy",
          shortcut: "⌘C",
          action: () => handleCopyIssues([...selectedIssueIds]),
        })
        cmds.push({
          id: "action:clear-selection",
          label: "Clear issue selection",
          group: "Actions",
          icon: "action",
          action: () => setSelectedIssueIds(new Set()),
        })
      }

      // Select by severity
      const highCount = issues.filter((i) => i.severity === "high").length
      const mediumCount = issues.filter((i) => i.severity === "medium").length
      const lowCount = issues.filter((i) => i.severity === "low").length

      if (highCount > 0) {
        cmds.push({
          id: "action:select-high",
          label: "Select high severity",
          sublabel: `${highCount} issues`,
          group: "Actions",
          icon: "select",
          action: () => setSelectedIssueIds(new Set(issues.filter((i) => i.severity === "high").map((i) => i.id))),
        })
        cmds.push({
          id: "action:copy-high",
          label: "Copy high severity issues",
          sublabel: `${highCount} issues`,
          group: "Actions",
          icon: "copy",
          action: () => handleCopyIssues(issues.filter((i) => i.severity === "high").map((i) => i.id)),
        })
      }
      if (mediumCount > 0) {
        cmds.push({
          id: "action:select-medium",
          label: "Select medium severity",
          sublabel: `${mediumCount} issues`,
          group: "Actions",
          icon: "select",
          action: () => setSelectedIssueIds(new Set(issues.filter((i) => i.severity === "medium").map((i) => i.id))),
        })
      }
      if (lowCount > 0) {
        cmds.push({
          id: "action:select-low",
          label: "Select low severity",
          sublabel: `${lowCount} issues`,
          group: "Actions",
          icon: "select",
          action: () => setSelectedIssueIds(new Set(issues.filter((i) => i.severity === "low").map((i) => i.id))),
        })
      }

      // Issue filter commands
      cmds.push(
        { id: "filter:issue-all", label: "Filter: All issues", group: "Filters", icon: "filter", action: () => setIssueFilter("all") },
        { id: "filter:issue-high", label: "Filter: High severity", group: "Filters", icon: "filter", action: () => setIssueFilter("high") },
        { id: "filter:issue-medium", label: "Filter: Medium severity", group: "Filters", icon: "filter", action: () => setIssueFilter("medium") },
        { id: "filter:issue-low", label: "Filter: Low severity", group: "Filters", icon: "filter", action: () => setIssueFilter("low") },
      )
    }

    if (selectedCycleId) {
      const cycle = cycles.find(c => c.id === selectedCycleId)
      cmds.push({
        id: "action:show-all-cycles",
        label: "Show all cycles",
        group: "Actions",
        icon: "action",
        action: () => setSelectedCycleId(null),
      })
      // Copy cycle name when no issues are selected
      if (selectedIssueIds.size === 0 && cycle) {
        cmds.push({
          id: "action:copy-cycle",
          label: "Copy cycle name",
          sublabel: cycle.name || `Cycle ${cycle.cycle}`,
          group: "Actions",
          icon: "copy",
          shortcut: "⌘C",
          action: async () => {
            await navigator.clipboard.writeText(cycle.name || `Cycle ${cycle.cycle}`)
          },
        })
      }
    }

    return cmds
  }, [cycles, selectedCycleId, detail, selectedIssueIds, handleCopyIssues, deleteMutation])

  useCommands(commands)

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {!selectedCycleId ? (
        <div className="flex h-full w-full">
          <div className="w-72 min-h-0 border-r border-gray-700 p-4 overflow-y-auto scrollbar-thin flex-shrink-0">
            <CycleSidebar
              selectedCycleId={selectedCycleId}
              onSelectCycle={setSelectedCycleId}
              onDeleteCycle={() => setSelectedCycleId(null)}
            />
          </div>
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <div className="text-4xl mb-4 opacity-30">&#x1F50D;</div>
              <div className="text-lg mb-2">Select a cycle to view details</div>
              <div className="text-sm">
                Cycles show issue discovery convergence across scan rounds
              </div>
            </div>
          </div>
        </div>
      ) : isLoading ? (
        <div className="p-6 space-y-4 w-full">
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse bg-gray-800 h-20 rounded-lg" />
            ))}
          </div>
          <div className="animate-pulse bg-gray-800 h-72 rounded-lg" />
          <div className="animate-pulse bg-gray-800 h-48 rounded-lg" />
        </div>
      ) : detail ? (
        <div className="flex flex-col h-full w-full overflow-y-auto">
          <div className="px-6 pt-6 pb-3 flex-shrink-0">
            <CycleSummary cycle={detail.cycle} />
          </div>
          <div className="px-6 pb-3 flex-shrink-0">
            <LossChart
              roundMetrics={detail.roundMetrics}
              cycleName={detail.cycle.name || `Cycle ${detail.cycle.cycle}`}
              onShowAllCycles={() => setSelectedCycleId(null)}
            />
          </div>
          <div className="flex flex-shrink-0 px-6 pb-6 gap-4" style={{ minHeight: 400 }}>
            <div className="w-72 flex-shrink-0 max-h-[500px] overflow-y-auto scrollbar-thin">
              <CycleSidebar
                selectedCycleId={selectedCycleId}
                onSelectCycle={setSelectedCycleId}
                onDeleteCycle={() => setSelectedCycleId(null)}
              />
            </div>
            <div className="flex-1 min-w-0">
              <IssuesList
                issues={detail.issues}
                selectedIds={selectedIssueIds}
                onSelectionChange={setSelectedIssueIds}
                filter={issueFilter}
                onFilterChange={setIssueFilter}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
