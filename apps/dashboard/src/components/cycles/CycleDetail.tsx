import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { fetchers, type TaskWithDeps } from "../../api/client"
import { useCycleDetail } from "../../hooks/useCycles"

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

const CYCLE_STATUS_CLASS = {
  current: "bg-blue-500/20 text-blue-200 border-blue-400/40",
  upcoming: "bg-violet-500/20 text-violet-200 border-violet-400/40",
  completed: "bg-emerald-500/20 text-emerald-200 border-emerald-400/40",
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

function getStartedCount(tasks: TaskWithDeps[]): number {
  return tasks.filter((task) => {
    const status = task.status
    return status !== "backlog" && status !== "ready"
  }).length
}

export function CycleDetail({ cycleId, onBack, themeMode = "dark" }: CycleDetailProps) {
  const isDarkTheme = themeMode === "dark"
  const queryClient = useQueryClient()
  const { data: cycle, isLoading, isError, error } = useCycleDetail(cycleId)

  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState("")
  const [isTaskPickerOpen, setIsTaskPickerOpen] = useState(false)
  const [taskSearch, setTaskSearch] = useState("")
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [feedback, setFeedback] = useState<string | null>(null)

  const tasksQuery = useQuery({
    queryKey: ["tasks", "cycle-picker"],
    queryFn: fetchers.tasks,
    enabled: isTaskPickerOpen,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!cycle) return
    setNameDraft(cycle.name)
  }, [cycle])

  useEffect(() => {
    if (!feedback) return
    const timeout = window.setTimeout(() => setFeedback(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  const invalidateCycleData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cycles"] }),
      queryClient.invalidateQueries({ queryKey: ["cycles", cycleId] }),
    ])
  }

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

  const tasksByStatus = useMemo(() => {
    const grouped: Record<TaskStatus, TaskWithDeps[]> = {
      backlog: [],
      ready: [],
      planning: [],
      active: [],
      blocked: [],
      review: [],
      needs_review: [],
      done: [],
    }

    for (const task of cycleTasks) {
      if (isTaskStatus(task.status)) {
        grouped[task.status].push(task)
      }
    }

    return grouped
  }, [cycleTasks])

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
  const started = getStartedCount(cycleTasks)
  const progress = toProgressPercentage(completed, total)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-gray-800 px-6 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className={`rounded-md border px-2.5 py-1 text-xs transition ${
              isDarkTheme
                ? "border-gray-700 bg-gray-900 text-gray-300 hover:bg-gray-800"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
            }`}
          >
            ← All Cycles
          </button>
          {cycle.status === "current" ? (
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("Complete this cycle and carry remaining work to the next cycle?")) {
                  return
                }
                completeCycleMutation.mutate()
              }}
              disabled={completeCycleMutation.isPending}
              className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {completeCycleMutation.isPending ? "Completing…" : "Complete Cycle"}
            </button>
          ) : null}
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-2">
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
                className="min-w-[240px] rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm font-semibold text-gray-100 outline-none focus:border-blue-500"
                autoFocus
              />
              <button
                type="button"
                onClick={() => {
                  const trimmed = nameDraft.trim()
                  if (!trimmed || trimmed === cycle.name) {
                    setIsEditingName(false)
                    return
                  }
                  updateNameMutation.mutate(trimmed)
                }}
                disabled={updateNameMutation.isPending}
                className="rounded-md border border-blue-500/50 bg-blue-500/20 px-2.5 py-1 text-xs text-blue-200 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsEditingName(false)
                  setNameDraft(cycle.name)
                }}
                className="rounded-md border border-gray-700 bg-gray-900 px-2.5 py-1 text-xs text-gray-300 transition hover:bg-gray-800"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <h2 className={`text-xl font-semibold ${isDarkTheme ? "text-gray-100" : "text-zinc-900"}`}>{cycle.name}</h2>
              <button
                type="button"
                onClick={() => setIsEditingName(true)}
                className="rounded-md border border-gray-700 bg-gray-900 px-2 py-0.5 text-[11px] text-gray-300 transition hover:bg-gray-800"
              >
                Edit
              </button>
            </>
          )}
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${CYCLE_STATUS_CLASS[cycle.status]}`}>
            {cycle.status}
          </span>
        </div>

        <p className={`text-sm ${isDarkTheme ? "text-gray-400" : "text-zinc-600"}`}>
          {formatDateRange(cycle.startDate, cycle.endDate)}
        </p>
      </div>

      {feedback ? (
        <div className="mx-6 mt-4 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
          {feedback}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <section className="mb-5 rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-gray-100">Progress</h3>
            <span className="text-xs text-gray-400">{progress}% complete</span>
          </div>
          <div className="mb-3 h-2 rounded-full bg-gray-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="rounded-md border border-gray-800 bg-gray-950/60 px-3 py-2">
              <p className="text-gray-400">Scope</p>
              <p className="mt-1 text-lg font-semibold text-gray-100">{total}</p>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950/60 px-3 py-2">
              <p className="text-gray-400">Started</p>
              <p className="mt-1 text-lg font-semibold text-gray-100">{started}</p>
            </div>
            <div className="rounded-md border border-gray-800 bg-gray-950/60 px-3 py-2">
              <p className="text-gray-400">Completed</p>
              <p className="mt-1 text-lg font-semibold text-gray-100">{completed}</p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-100">Tasks ({cycleTasks.length})</h3>
            <button
              type="button"
              onClick={() => setIsTaskPickerOpen(true)}
              className="rounded-md border border-blue-500/40 bg-blue-500/15 px-3 py-1.5 text-xs font-medium text-blue-200 transition hover:bg-blue-500/25"
            >
              + Add tasks
            </button>
          </div>

          {cycleTasks.length === 0 ? (
            <div className="rounded-md border border-dashed border-gray-700 px-3 py-6 text-center text-sm text-gray-400">
              No tasks in this cycle yet.
            </div>
          ) : (
            <div className="space-y-4">
              {TASK_STATUS_ORDER.map((status) => {
                const tasks = tasksByStatus[status]
                if (tasks.length === 0) return null

                return (
                  <div key={status}>
                    <div className="mb-2 flex items-center gap-2 text-xs">
                      <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT_CLASS[status]}`} />
                      <span className="font-medium text-gray-300">{STATUS_LABELS[status]}</span>
                      <span className="text-gray-500">{tasks.length}</span>
                    </div>
                    <div className="space-y-2">
                      {tasks.map((task) => (
                        <div
                          key={task.id}
                          className="flex items-start justify-between gap-2 rounded-md border border-gray-800 bg-gray-950/60 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-gray-100">{task.title}</p>
                            <p className="mt-0.5 text-xs text-gray-500">{task.id}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeTaskMutation.mutate(task.id)}
                            disabled={removeTaskMutation.isPending}
                            className="rounded border border-gray-700 px-2 py-0.5 text-[11px] text-gray-300 transition hover:border-red-400 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label={`Remove ${task.title} from cycle`}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>

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
              <button
                type="button"
                onClick={() => {
                  setIsTaskPickerOpen(false)
                  setSelectedTaskIds([])
                  setTaskSearch("")
                }}
                className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-300 transition hover:bg-gray-800"
              >
                Esc
              </button>
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
                  <button
                    type="button"
                    onClick={() => {
                      setIsTaskPickerOpen(false)
                      setSelectedTaskIds([])
                      setTaskSearch("")
                    }}
                    className="rounded border border-gray-700 px-3 py-1.5 text-xs text-gray-300 transition hover:bg-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={selectedTaskIds.length === 0 || addTasksMutation.isPending}
                    onClick={() => addTasksMutation.mutate(selectedTaskIds)}
                    className="rounded border border-blue-500/50 bg-blue-500/20 px-3 py-1.5 text-xs font-medium text-blue-200 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {addTasksMutation.isPending ? "Adding…" : "Add Selected"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
