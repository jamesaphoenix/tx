import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchers } from "../../api/client"
import { Button } from "../ui"
import { SearchInput } from "../ui/SearchInput"
import { useCycleDetail, useCycles } from "../../hooks/useCycles"
import { useCommands } from "../command-palette/CommandContext"
import { buildTaskCommands, buildSelectionCommands } from "../command-palette/buildTaskCommands"
import { TaskComposerModal, type TaskComposerModalSubmit } from "../tasks/TaskComposerModal"
import { TaskDetail } from "../tasks/TaskDetail"
import { autoTaskLabelColor } from "../tasks/TaskPropertySelects"
import { useStore } from "@tanstack/react-store"
import { selectionStore, selectionActions } from "../../stores/selection-store"
import type { Command } from "../command-palette/CommandContext"
import { CycleKanbanView } from "./CycleKanbanView"
import { CycleListView } from "./CycleListView"

type ThemeMode = "light" | "dark"

type TaskStatus =
  | "backlog"
  | "ready"
  | "planning"
  | "active"
  | "blocked"
  | "review"
  | "needs_review"
  | "done"

interface CycleDetailProps {
  cycleId: string
  onBack: () => void
  themeMode?: ThemeMode
  /** Incrementing nonce that triggers the TaskComposerModal (e.g. from CMD+N) */
  composerNonce?: number
  /** Incrementing nonce that triggers the task picker to open */
  addTaskNonce?: number
}

const TASK_STATUS_ORDER: TaskStatus[] = [
  "backlog",
  "ready",
  "planning",
  "active",
  "blocked",
  "review",
  "needs_review",
  "done",
]

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: "Backlog",
  ready: "Ready",
  planning: "Planning",
  active: "Active",
  blocked: "Blocked",
  review: "Review",
  needs_review: "Needs Review",
  done: "Done",
}

const STATUS_DOT_CLASS: Record<TaskStatus, string> = {
  backlog: "bg-gray-500",
  ready: "bg-blue-500",
  planning: "bg-purple-500",
  active: "bg-yellow-500",
  blocked: "bg-red-500",
  review: "bg-orange-500",
  needs_review: "bg-pink-500",
  done: "bg-green-500",
}

const CYCLE_STATUS_CLASS_DARK = {
  current: "bg-blue-500/20 text-blue-200 border-blue-400/40",
  upcoming: "bg-violet-500/20 text-violet-200 border-violet-400/40",
  completed: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40",
} as const

const CYCLE_STATUS_CLASS_LIGHT = {
  current: "bg-blue-100 text-blue-700 border-blue-300",
  upcoming: "bg-violet-100 text-violet-700 border-violet-300",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-300",
} as const

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate)
  const end = new Date(endDate)

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return "Date unavailable"
  }

  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  }

  return `${start.toLocaleDateString("en-GB", options)} - ${end.toLocaleDateString("en-GB", options)}`
}

function isTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUS_ORDER.includes(value as TaskStatus)
}

function toProgressPercentage(completed: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((completed / total) * 100)
}


function readTaskIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("taskId")
}

function writeTaskUrl(taskId: string | null) {
  const params = new URLSearchParams(window.location.search)
  if (taskId) {
    params.set("taskId", taskId)
  } else {
    params.delete("taskId")
  }
  const search = params.toString()
  const url = search ? `${window.location.pathname}?${search}` : window.location.pathname
  window.history.pushState(null, "", url)
}

export function CycleDetail({
  cycleId,
  onBack,
  themeMode = "dark",
  composerNonce = 0,
  addTaskNonce = 0,
}: CycleDetailProps) {
  const isDarkTheme = themeMode === "dark"
  const queryClient = useQueryClient()
  const { data: cycle, isLoading, isError, error } = useCycleDetail(cycleId)

  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState("")
  const [isTaskPickerOpen, setIsTaskPickerOpen] = useState(false)
  const [taskSearch, setTaskSearch] = useState("")
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [feedback, setFeedback] = useState<string | null>(null)

  // Filter and view state
  const [viewMode, setViewMode] = useState<"list" | "kanban">("list")
  const [statusFilter, setStatusFilter] = useState<TaskStatus[]>([])
  const [searchQuery, setSearchQuery] = useState("")

  // Nonce tracking
  const lastHandledAddTaskNonceRef = useRef(0)

  // Composer state
  const [isComposerOpen, setIsComposerOpen] = useState(false)
  const lastHandledComposerNonceRef = useRef(0)
  const nextComposerLabelIdRef = useRef(-1)
  const [composerFallbackLabels, setComposerFallbackLabels] = useState<Record<number, { name: string; color: string }>>({})

  const tasksQuery = useQuery({
    queryKey: ["tasks", "cycle-picker"],
    queryFn: fetchers.tasks,
    enabled: isTaskPickerOpen,
    staleTime: 30_000,
  })

  const labelsQuery = useQuery({
    queryKey: ["labels"],
    queryFn: fetchers.labels,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!cycle || isEditingName) return
    setNameDraft(cycle.name)
  }, [cycle, isEditingName])

  // Open task picker when addTaskNonce changes (guard against re-mount)
  useEffect(() => {
    if (addTaskNonce > lastHandledAddTaskNonceRef.current) {
      lastHandledAddTaskNonceRef.current = addTaskNonce
      setIsTaskPickerOpen(true)
    }
  }, [addTaskNonce])

  // Open composer when composerNonce changes
  useEffect(() => {
    if (composerNonce > lastHandledComposerNonceRef.current) {
      lastHandledComposerNonceRef.current = composerNonce
      setIsComposerOpen(true)
    }
  }, [composerNonce])

  useEffect(() => {
    if (!feedback) return
    const timeout = window.setTimeout(() => setFeedback(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  const invalidateCycleData = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cycles"] }),
      queryClient.invalidateQueries({ queryKey: ["cycles", cycleId] }),
    ])
  }, [queryClient, cycleId])

  const updateNameMutation = useMutation({
    mutationFn: (name: string) => fetchers.updateCycle(cycleId, { name }),
    onSuccess: async () => {
      setFeedback("Cycle name updated")
      setIsEditingName(false)
      await invalidateCycleData()
    },
  })

  const addTasksMutation = useMutation({
    mutationFn: (taskIds: string[]) => fetchers.addTasksToCycle(cycleId, taskIds),
    onSuccess: async (_response, taskIds) => {
      setFeedback(`Added ${taskIds.length} task${taskIds.length === 1 ? "" : "s"} to cycle`)
      setSelectedTaskIds([])
      setTaskSearch("")
      setIsTaskPickerOpen(false)
      await invalidateCycleData()
    },
  })

  const removeTaskMutation = useMutation({
    mutationFn: (taskId: string) => fetchers.removeTaskFromCycle(cycleId, taskId),
    onSuccess: async () => {
      await invalidateCycleData()
    },
  })

  const completeCycleMutation = useMutation({
    mutationFn: () => fetchers.completeCycle(cycleId),
    onSuccess: async (result) => {
      const carriedCount = result.carriedTaskIds.length
      setFeedback(`Cycle completed. Carried over ${carriedCount} task${carriedCount === 1 ? "" : "s"}.`)
      await invalidateCycleData()
    },
  })

  const cycleTasks = cycle?.tasks ?? []

  const taskIdsInCycle = useMemo(() => new Set(cycleTasks.map((task) => task.id)), [cycleTasks])

  const availableTasks = useMemo(() => {
    const allTasks = tasksQuery.data?.tasks ?? []
    const query = taskSearch.trim().toLowerCase()

    return allTasks
      .filter((task) => !taskIdsInCycle.has(task.id))
      .filter((task) => {
        if (!query) return true
        return (
          task.title.toLowerCase().includes(query)
          || task.id.toLowerCase().includes(query)
          || task.status.toLowerCase().includes(query)
        )
      })
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }, [taskIdsInCycle, taskSearch, tasksQuery.data])

  // Client-side filtering of cycle tasks
  const filteredTasks = useMemo(() => {
    return cycleTasks.filter((task) => {
      if (statusFilter.length > 0 && !statusFilter.includes(task.status as TaskStatus)) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        if (!task.title.toLowerCase().includes(q) && !task.id.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [cycleTasks, statusFilter, searchQuery])

  // Status counts for filter buttons
  const statusCounts = useMemo(() => {
    const counts: Record<TaskStatus, number> = {
      backlog: 0, ready: 0, planning: 0, active: 0,
      blocked: 0, review: 0, needs_review: 0, done: 0,
    }
    for (const task of cycleTasks) {
      if (isTaskStatus(task.status)) {
        counts[task.status]++
      }
    }
    return counts
  }, [cycleTasks])

  const toggleStatusFilter = useCallback((status: TaskStatus) => {
    setStatusFilter((prev) => {
      if (prev.includes(status)) {
        return prev.filter((s) => s !== status)
      }
      return [...prev, status]
    })
  }, [])

  const clearStatusFilters = useCallback(() => {
    setStatusFilter([])
  }, [])

  const handleRemoveTask = useCallback((taskId: string) => {
    removeTaskMutation.mutate(taskId)
  }, [removeTaskMutation])

  // Task detail navigation: click task → open detail, back → return to cycle
  // Synced to URL via ?taskId= param
  const [openTaskId, setOpenTaskId] = useState<string | null>(readTaskIdFromUrl)
  const focusedTask = useMemo(
    () => cycleTasks.find((t) => t.id === openTaskId) ?? null,
    [cycleTasks, openTaskId],
  )

  // Sync with browser back/forward
  useEffect(() => {
    const onPopState = () => setOpenTaskId(readTaskIdFromUrl())
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  const handleSelectTask = useCallback((taskId: string) => {
    setOpenTaskId(taskId)
    writeTaskUrl(taskId)
  }, [])

  const handleBackFromTask = useCallback(() => {
    setOpenTaskId(null)
    writeTaskUrl(null)
  }, [])

  // Create task and add to cycle
  const createTaskInCycle = useCallback(async (payload: TaskComposerModalSubmit) => {
    const created = await fetchers.createTask({
      title: payload.title,
      description: payload.description,
      parentId: payload.parentId,
      status: payload.stage,
      assigneeType: payload.assigneeType,
      assigneeId: payload.assigneeId,
      assignedBy: "dashboard:cycle-composer",
    })

    const persistedLabelIds = payload.labelIds.filter((labelId) => labelId > 0)
    const fallbackLabels = payload.labelIds
      .filter((labelId) => labelId < 0)
      .map((labelId) => composerFallbackLabels[labelId])
      .filter((label): label is { name: string; color: string } => Boolean(label))

    if (persistedLabelIds.length > 0 || fallbackLabels.length > 0) {
      await Promise.all([
        ...persistedLabelIds.map((labelId) => fetchers.assignTaskLabel(created.id, { labelId })),
        ...fallbackLabels.map((label) => fetchers.assignTaskLabel(created.id, {
          name: label.name,
          color: label.color,
        })),
      ])
    }

    // Add the new task to the cycle
    try {
      await fetchers.addTasksToCycle(cycleId, [created.id])
    } catch {
      setFeedback("Task created but failed to add to cycle. Use \"Add existing\" to recover.")
      setComposerFallbackLabels({})
      await invalidateCycleData()
      return
    }

    setFeedback("Task created and added to cycle")
    setComposerFallbackLabels({})
    await invalidateCycleData()
    await queryClient.invalidateQueries({ queryKey: ["tasks"] })

    if (!payload.createMore) {
      setIsComposerOpen(false)
    }
  }, [cycleId, composerFallbackLabels, queryClient, invalidateCycleData])

  const createLabel = useCallback(async (payload: { name: string; color?: string }) => {
    const normalizedName = payload.name.trim()
    if (!normalizedName) return null
    try {
      const created = await fetchers.createLabel({ name: normalizedName, color: payload.color })
      setComposerFallbackLabels((prev) => {
        const next = { ...prev }
        for (const [id, value] of Object.entries(next)) {
          if (value.name.toLowerCase() === normalizedName.toLowerCase()) {
            delete next[Number(id)]
          }
        }
        return next
      })
      await queryClient.invalidateQueries({ queryKey: ["labels"] })
      return created
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes("404")) {
        throw error
      }
      // Fallback for older servers without /api/labels
      const tempId = nextComposerLabelIdRef.current
      nextComposerLabelIdRef.current -= 1
      const color = payload.color ?? autoTaskLabelColor(normalizedName)
      setComposerFallbackLabels((prev) => ({
        ...prev,
        [tempId]: { name: normalizedName, color },
      }))
      const now = new Date().toISOString()
      return { id: tempId, name: normalizedName, color, createdAt: now, updatedAt: now }
    }
  }, [queryClient])

  // Multi-select state from global store
  const selectedCycleTaskIds = useStore(selectionStore, (s) => s.issueIds)
  const handleToggleCycleTask = useCallback((id: string) => {
    selectionActions.toggleIssue(id)
  }, [])

  // All cycles + labels for shared commands
  const { data: allCycles = [] } = useCycles()
  const allLabels = labelsQuery.data?.labels ?? []

  // Selected task IDs that are actually in this cycle
  const selectedInCycle = useMemo(() => {
    return cycleTasks.filter((t) => selectedCycleTaskIds.has(t.id)).map((t) => t.id)
  }, [cycleTasks, selectedCycleTaskIds])

  // Build full cycle-page command palette
  const cycleCommands = useMemo((): Command[] => {
    const cmds: Command[] = []

    // When viewing a task inside the cycle, show back navigation
    if (openTaskId) {
      cmds.push({
        id: "cycle:back-to-cycle",
        label: `Back to ${cycle?.name ?? "cycle"}`,
        group: "Navigation",
        icon: "nav",
        action: handleBackFromTask,
      })
    }

    // Select all / clear
    cmds.push({
      id: "cycle:select-all",
      label: "Select all tasks",
      sublabel: `${cycleTasks.length} in cycle`,
      group: "Actions",
      icon: "select",
      shortcut: "⌘A",
      allowInInput: true,
      action: () => selectionActions.selectAllIssues(cycleTasks.map((t) => t.id)),
    })

    if (selectedInCycle.length > 0) {
      cmds.push(
        {
          id: "cycle:clear-selection",
          label: "Clear selection",
          sublabel: `${selectedInCycle.length} selected`,
          group: "Actions",
          icon: "action",
          action: () => selectionActions.clearIssues(),
        },
        {
          id: "cycle:remove-selected",
          label: "Remove selected from cycle",
          sublabel: `${selectedInCycle.length} selected`,
          group: "Actions",
          icon: "delete",
          action: () => {
            if (!window.confirm(`Remove ${selectedInCycle.length} task${selectedInCycle.length === 1 ? "" : "s"} from this cycle?`)) return
            void (async () => {
              for (const id of selectedInCycle) {
                await fetchers.removeTaskFromCycle(cycleId, id)
              }
              selectionActions.clearIssues()
              await invalidateCycleData()
            })()
          },
        },
      )

      // Bulk selection commands via shared builder
      cmds.push(...buildSelectionCommands({
        namespace: "cycle",
        selectedIds: selectedInCycle,
        cycles: allCycles,
        onBulkSetStatus: (status) => {
          void (async () => {
            for (const id of selectedInCycle) {
              await fetchers.updateTask(id, { status })
            }
            selectionActions.clearIssues()
            await invalidateCycleData()
          })()
        },
        onBulkMoveToCycle: (targetCycleId) => {
          void (async () => {
            await fetchers.addTasksToCycle(targetCycleId, selectedInCycle)
            selectionActions.clearIssues()
            await invalidateCycleData()
            await queryClient.invalidateQueries({ queryKey: ["cycles"] })
          })()
        },
      }))
    }

    // Single-task "Set <field>" commands when a task is focused
    cmds.push(...buildTaskCommands({
      namespace: "cycle-task",
      task: focusedTask ? { id: focusedTask.id, labels: focusedTask.labels } : null,
      labels: allLabels,
      cycles: allCycles,
      onSetStatus: (status) => {
        if (!focusedTask) return
        void (async () => {
          await fetchers.updateTask(focusedTask.id, { status })
          await invalidateCycleData()
        })()
      },
      onToggleLabel: (label) => {
        if (!focusedTask) return
        const assigned = (focusedTask.labels ?? []).some((l) => l.id === label.id)
        void (async () => {
          if (assigned) {
            await fetchers.unassignTaskLabel(focusedTask.id, label.id)
          } else {
            await fetchers.assignTaskLabel(focusedTask.id, { labelId: label.id })
          }
          await invalidateCycleData()
        })()
      },
      onSetScore: () => {
        if (!focusedTask) return
        const input = window.prompt("Score:", String(focusedTask.score ?? 0))
        if (input === null) return
        const score = parseInt(input, 10)
        if (Number.isNaN(score)) return
        void (async () => {
          await fetchers.updateTask(focusedTask.id, { score })
          await invalidateCycleData()
        })()
      },
      onMoveToCycle: (targetCycleId) => {
        if (!focusedTask) return
        void (async () => {
          await fetchers.addTasksToCycle(targetCycleId, [focusedTask.id])
          await invalidateCycleData()
          await queryClient.invalidateQueries({ queryKey: ["cycles"] })
        })()
      },
    }))

    // Navigate to each task in cycle
    for (const task of cycleTasks.slice(0, 100)) {
      cmds.push({
        id: `cycle:open:${task.id}`,
        label: task.title,
        sublabel: `${task.id} · ${task.status}`,
        group: "Items",
        icon: "nav",
        action: () => { setOpenTaskId(task.id); writeTaskUrl(task.id) },
      })
    }

    return cmds
  }, [cycleTasks, selectedInCycle, focusedTask, allLabels, allCycles, cycleId, openTaskId, cycle, handleBackFromTask, invalidateCycleData, queryClient])

  useCommands(cycleCommands)

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-12 animate-pulse rounded-lg bg-gray-800" />
        <div className="h-32 animate-pulse rounded-lg bg-gray-800" />
        <div className="h-80 animate-pulse rounded-lg bg-gray-800" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-lg rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          Failed to load cycle details: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      </div>
    )
  }

  if (!cycle) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-gray-400">Cycle not found.</p>
      </div>
    )
  }

  const total = cycle.taskCount
  const completed = cycle.completedCount
  const started = cycle.inProgressCount + completed
  const progress = toProgressPercentage(completed, total)

  // Task detail view — click a task in the cycle to navigate into it
  if (openTaskId) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-b border-gray-800/60 px-6 py-3">
          <div className="flex items-center gap-1.5 text-sm">
            <Button size="sm" variant="ghost" onClick={onBack} className="text-gray-400">
              Cycles
            </Button>
            <span className={isDarkTheme ? "text-gray-600" : "text-zinc-400"}>/</span>
            <Button size="sm" variant="ghost" onClick={handleBackFromTask} className="text-gray-400">
              {cycle.name}
            </Button>
            <span className={isDarkTheme ? "text-gray-600" : "text-zinc-400"}>/</span>
            <span className={`font-medium ${isDarkTheme ? "text-gray-200" : "text-zinc-800"}`}>Task</span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TaskDetail
            taskId={openTaskId}
            themeMode={themeMode}
            onNavigateToTask={(taskId) => { setOpenTaskId(taskId); writeTaskUrl(taskId) }}
            onNavigateToList={handleBackFromTask}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="border-b border-gray-800/60 px-6 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-sm">
            <Button size="sm" variant="ghost" onClick={onBack} className="text-gray-400">
              Cycles
            </Button>
            <span className={isDarkTheme ? "text-gray-600" : "text-zinc-400"}>/</span>
            <span className={`font-medium ${isDarkTheme ? "text-gray-200" : "text-zinc-800"}`}>{cycle.name}</span>
          </div>
          {cycle.status === "current" ? (
            <Button
              size="sm"
              variant="success"
              onClick={() => {
                if (!window.confirm("Complete this cycle and carry remaining work to the next cycle?")) {
                  return
                }
                completeCycleMutation.mutate()
              }}
              disabled={completeCycleMutation.isPending}
            >
              {completeCycleMutation.isPending ? "Completing…" : "Complete Cycle"}
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isEditingName ? (
            <>
              <input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setIsEditingName(false)
                    setNameDraft(cycle.name)
                  }
                  if (event.key === "Enter") {
                    event.preventDefault()
                    const trimmed = nameDraft.trim()
                    if (!trimmed || trimmed === cycle.name) {
                      setIsEditingName(false)
                      return
                    }
                    updateNameMutation.mutate(trimmed)
                  }
                }}
                className="min-w-[240px] rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1 text-sm font-semibold text-gray-100 outline-none focus:border-blue-500"
                autoFocus
              />
              <Button
                size="xs"
                variant="primary"
                onClick={() => {
                  const trimmed = nameDraft.trim()
                  if (!trimmed || trimmed === cycle.name) {
                    setIsEditingName(false)
                    return
                  }
                  updateNameMutation.mutate(trimmed)
                }}
                disabled={updateNameMutation.isPending}
              >
                Save
              </Button>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  setIsEditingName(false)
                  setNameDraft(cycle.name)
                }}
              >
                Cancel
              </Button>
            </>
          ) : (
            <h2
              className="text-lg font-semibold cursor-pointer rounded px-1 -mx-1 transition text-gray-100 hover:bg-gray-800/60"
              onClick={() => setIsEditingName(true)}
              title="Click to rename"
            >
              {cycle.name}
            </h2>
          )}
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${isDarkTheme ? CYCLE_STATUS_CLASS_DARK[cycle.status] : CYCLE_STATUS_CLASS_LIGHT[cycle.status]}`}>
            {cycle.status}
          </span>
        </div>

        <p className="mt-0.5 text-xs text-gray-500">
          {formatDateRange(cycle.startDate, cycle.endDate)}
        </p>
      </div>

      {feedback ? (
        <div className="mx-6 mt-3 rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-1.5 text-xs text-blue-300">
          {feedback}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {/* Progress — compact inline layout */}
        <section className="mb-4">
          <div className="mb-1.5 h-1.5 rounded-full bg-gray-800/80">
            <div
              className="h-full rounded-full bg-blue-500 transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center gap-6 text-[11px]">
            <span className="text-gray-400">
              <span className="font-semibold text-gray-200">{total}</span> scope
            </span>
            <span className="text-gray-400">
              <span className="font-semibold text-gray-200">{started}</span> started
            </span>
            <span className="text-gray-400">
              <span className="font-semibold text-gray-200">{completed}</span> completed
            </span>
            <span className="ml-auto text-gray-500">{progress}%</span>
          </div>
        </section>

        {/* Tasks section */}
        <section>
          {/* Header with buttons */}
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              Tasks
              <span className="ml-1.5 text-gray-500">{cycleTasks.length}</span>
            </h3>
            <div className="flex items-center gap-2">
              <Button size="xs" variant="primary" onClick={() => setIsComposerOpen(true)}>
                + New task
              </Button>
              <Button size="xs" variant="secondary" onClick={() => setIsTaskPickerOpen(true)}>
                + Add existing
              </Button>
            </div>
          </div>

          {/* Filter bar */}
          {cycleTasks.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {/* Status filter buttons */}
              <div className={`inline-flex flex-wrap gap-1 rounded-lg p-1 ${isDarkTheme ? "bg-gray-800" : "bg-zinc-100"}`}>
                <Button
                  size="sm"
                  variant={statusFilter.length === 0 ? "primary" : "ghost"}
                  onClick={clearStatusFilters}
                >
                  <span>All</span>
                  <span className="text-[10px] opacity-80">{cycleTasks.length}</span>
                </Button>
                {TASK_STATUS_ORDER.map((status) => {
                  const count = statusCounts[status]
                  if (count === 0) return null
                  const isActive = statusFilter.includes(status)
                  return (
                    <Button
                      key={status}
                      size="sm"
                      variant={isActive ? "primary" : "ghost"}
                      onClick={() => toggleStatusFilter(status)}
                    >
                      <span className={`h-2 w-2 rounded-full ${STATUS_DOT_CLASS[status]}`} aria-hidden="true" />
                      <span>{STATUS_LABELS[status]}</span>
                      <span className="text-[10px] opacity-80">{count}</span>
                    </Button>
                  )
                })}
              </div>

              {/* View toggle */}
              <div className={`inline-flex gap-1 rounded-lg p-1 ${isDarkTheme ? "bg-gray-800" : "bg-zinc-100"}`}>
                <Button
                  size="icon-sm"
                  variant={viewMode === "list" ? "primary" : "ghost"}
                  aria-label="List view"
                  title="List view"
                  onClick={() => setViewMode("list")}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="8" y1="6" x2="20" y2="6" />
                    <line x1="8" y1="12" x2="20" y2="12" />
                    <line x1="8" y1="18" x2="20" y2="18" />
                    <line x1="4" y1="6" x2="4.01" y2="6" />
                    <line x1="4" y1="12" x2="4.01" y2="12" />
                    <line x1="4" y1="18" x2="4.01" y2="18" />
                  </svg>
                </Button>
                <Button
                  size="icon-sm"
                  variant={viewMode === "kanban" ? "primary" : "ghost"}
                  aria-label="Kanban view"
                  title="Kanban view"
                  onClick={() => setViewMode("kanban")}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="6" height="16" rx="1" />
                    <rect x="10.5" y="4" width="10.5" height="7" rx="1" />
                    <rect x="10.5" y="13" width="10.5" height="7" rx="1" />
                  </svg>
                </Button>
              </div>

              {/* Search */}
              <div className="min-w-[200px] flex-1">
                <SearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Filter tasks..."
                  themeMode={themeMode}
                />
              </div>
            </div>
          )}

          {/* Task views */}
          {cycleTasks.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-700/60 px-3 py-8 text-center text-sm text-gray-500">
              No tasks in this cycle yet. Press <kbd className="rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-[11px] font-medium text-gray-300">⌘N</kbd> to create one.
            </div>
          ) : viewMode === "kanban" ? (
            <CycleKanbanView
              tasks={filteredTasks}
              cycleId={cycleId}
              selectedIds={selectedCycleTaskIds}
              onSelectTask={handleSelectTask}
              onToggleSelect={handleToggleCycleTask}
              onRemoveTask={handleRemoveTask}
            />
          ) : (
            <CycleListView
              tasks={filteredTasks}
              selectedIds={selectedCycleTaskIds}
              onSelectTask={handleSelectTask}
              onToggleSelect={handleToggleCycleTask}
              onRemoveTask={handleRemoveTask}
            />
          )}
        </section>
      </div>

      {/* Task Picker Modal (existing tasks) */}
      {isTaskPickerOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            onClick={() => {
              setIsTaskPickerOpen(false)
              setSelectedTaskIds([])
              setTaskSearch("")
            }}
            aria-label="Close add tasks dialog"
          />
          <div className="relative z-10 w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
              <h4 className="text-sm font-semibold text-gray-100">Add tasks to {cycle.name}</h4>
              <Button
                size="xs"
                variant="secondary"
                onClick={() => {
                  setIsTaskPickerOpen(false)
                  setSelectedTaskIds([])
                  setTaskSearch("")
                }}
              >
                Esc
              </Button>
            </div>

            <div className="space-y-3 p-4">
              <input
                type="text"
                value={taskSearch}
                onChange={(event) => setTaskSearch(event.target.value)}
                placeholder="Search tasks by title, id, or status"
                className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 outline-none focus:border-blue-500"
              />

              <div className="max-h-[360px] overflow-y-auto rounded-md border border-gray-800">
                {tasksQuery.isLoading ? (
                  <div className="space-y-2 p-3">
                    <div className="h-10 animate-pulse rounded bg-gray-800" />
                    <div className="h-10 animate-pulse rounded bg-gray-800" />
                    <div className="h-10 animate-pulse rounded bg-gray-800" />
                  </div>
                ) : tasksQuery.isError ? (
                  <div className="p-3 text-sm text-red-300">
                    Could not load tasks for picker.
                  </div>
                ) : availableTasks.length === 0 ? (
                  <div className="p-3 text-sm text-gray-400">No matching tasks available.</div>
                ) : (
                  <ul className="divide-y divide-gray-800">
                    {availableTasks.map((task) => {
                      const checked = selectedTaskIds.includes(task.id)
                      return (
                        <li key={task.id}>
                          <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-gray-800/60">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                if (event.target.checked) {
                                  setSelectedTaskIds((current) => [...current, task.id])
                                } else {
                                  setSelectedTaskIds((current) => current.filter((id) => id !== task.id))
                                }
                              }}
                              className="mt-0.5"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-sm text-gray-100">{task.title}</span>
                              <span className="mt-0.5 block text-xs text-gray-500">{task.id} · {task.status}</span>
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-400">
                  {selectedTaskIds.length} selected
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setIsTaskPickerOpen(false)
                      setSelectedTaskIds([])
                      setTaskSearch("")
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={selectedTaskIds.length === 0 || addTasksMutation.isPending}
                    onClick={() => addTasksMutation.mutate(selectedTaskIds)}
                  >
                    {addTasksMutation.isPending ? "Adding…" : "Add Selected"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Task Composer Modal (new task) */}
      <TaskComposerModal
        open={isComposerOpen}
        heading="New task in cycle"
        submitLabel="Create & add to cycle"
        availableLabels={labelsQuery.data?.labels ?? []}
        onClose={() => setIsComposerOpen(false)}
        onSubmit={createTaskInCycle}
        onCreateLabel={createLabel}
      />
    </div>
  )
}
