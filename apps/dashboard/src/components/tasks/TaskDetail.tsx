import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery, keepPreviousData, useQueryClient } from "@tanstack/react-query"
import {
  fetchers,
  type TaskAssigneeType,
  type TaskDetailResponse,
  type TaskLabel,
  type TaskWithDeps
} from "../../api/client"
import { useDebounce } from "../../hooks/useDebounce"
import {
  canonicalTaskLabelName,
  TaskLabelsSelect,
  TaskAssigneeTypeSelect,
  TaskStatusSelect,
  toHumanTaskStage,
  type HumanTaskStage,
} from "./TaskPropertySelects"

type TimestampInput = string | number | Date | null | undefined
type ThemeMode = "light" | "dark"
type TaskBreadcrumb = { id: string; title: string }

const MAX_BREADCRUMB_DEPTH = 24

function parseTimestamp(value: TimestampInput): Date | null {
  if (value === null || value === undefined) return null

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }

  if (typeof value === "number") {
    const epochMs = value > 1e12 ? value : value * 1000
    const date = new Date(epochMs)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed)
    if (!Number.isNaN(numeric)) {
      const epochMs = trimmed.length > 10 ? numeric : numeric * 1000
      const numericDate = new Date(epochMs)
      if (!Number.isNaN(numericDate.getTime())) return numericDate
    }
  }

  const directDate = new Date(trimmed)
  if (!Number.isNaN(directDate.getTime())) return directDate

  // SQLite datetime format: "YYYY-MM-DD HH:MM:SS(.sss)"
  const sqliteDate = new Date(trimmed.replace(" ", "T").replace(/$/, "Z"))
  if (!Number.isNaN(sqliteDate.getTime())) return sqliteDate

  return null
}

function formatTimestamp(value: TimestampInput): string {
  const date = parseTimestamp(value)
  if (!date) return "—"
  return date.toLocaleString()
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    backlog: "bg-gray-500",
    ready: "bg-blue-500",
    planning: "bg-purple-500",
    active: "bg-yellow-500",
    blocked: "bg-red-500",
    review: "bg-orange-500",
    human_needs_to_review: "bg-pink-500",
    done: "bg-green-500",
  }
  return (
    <span className={`px-2 py-0.5 text-xs rounded-full text-white ${colors[status] ?? "bg-gray-400"}`}>
      {status}
    </span>
  )
}

function RelatedTaskCard({
  task,
  onClick,
  isSelected = false,
  onToggleSelect,
}: {
  task: TaskWithDeps
  onClick: () => void
  isSelected?: boolean
  onToggleSelect?: (taskId: string) => void
}) {
  return (
    <div
      className={`rounded-lg p-2.5 transition-all duration-200 ease-out hover:-translate-y-0.5 ${
        isSelected
          ? "bg-blue-500/15 ring-1 ring-blue-500/50"
          : "bg-gray-800/90 hover:bg-gray-700/60"
      }`}
    >
      <div className="flex items-center gap-2">
        {onToggleSelect && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect(task.id)
            }}
            className={`h-4 w-4 rounded border transition ${
              isSelected
                ? "border-blue-400 bg-blue-500"
                : "border-gray-500 hover:border-blue-400"
            }`}
            aria-label={`Select child task ${task.id}`}
          />
        )}
        <button
          onClick={onClick}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <code className="text-xs text-gray-400">{task.id}</code>
              <span className="text-xs font-medium text-amber-400">[{task.score}]</span>
            </div>
            <h4 className="truncate text-sm text-white">{task.title}</h4>
          </div>
          <StatusBadge status={task.status} />
        </button>
      </div>
    </div>
  )
}

function RelatedTasksSection({
  title,
  tasks,
  emptyMessage,
  onTaskClick,
  titleColor,
}: {
  title: string
  tasks: TaskWithDeps[]
  emptyMessage: string
  onTaskClick: (taskId: string) => void
  titleColor: string
}) {
  return (
    <div>
      <h3 className={`mb-2 text-sm font-semibold ${titleColor}`}>
        {title} ({tasks.length})
      </h3>
      {tasks.length === 0 ? (
        <p className="text-sm italic text-gray-500">{emptyMessage}</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <RelatedTaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export interface TaskDetailProps {
  taskId: string
  onNavigateToTask: (taskId: string) => void
  onNavigateToList?: () => void
  themeMode?: ThemeMode
  onCreateChild?: () => void
  onCopyTaskReference?: () => void
  statusStage?: HumanTaskStage
  onChangeStatusStage?: (stage: HumanTaskStage) => void | Promise<void>
  onUpdateAssignment?: (payload: {
    assigneeType: TaskAssigneeType | null
    assigneeId: string | null
    assignedBy?: string | null
  }) => void | Promise<void>
  allLabels?: TaskLabel[]
  isLabelAssigned?: (label: TaskLabel) => boolean
  onToggleLabel?: (label: TaskLabel) => void | Promise<void>
  onCreateLabel?: (payload: { name: string; color?: string }) => TaskLabel | null | Promise<TaskLabel | null>
  selectedChildIds?: Set<string>
  onToggleChildSelection?: (taskId: string) => void
  onSelectAllChildren?: () => void
  onClearChildSelection?: () => void
  onDeleteSelectedChildren?: () => void | Promise<void>
}

export function TaskDetail({
  taskId,
  onNavigateToTask,
  onNavigateToList,
  themeMode = "light",
  onCreateChild,
  onCopyTaskReference,
  statusStage,
  onChangeStatusStage,
  onUpdateAssignment,
  allLabels = [],
  isLabelAssigned,
  onToggleLabel,
  onCreateLabel,
  selectedChildIds = new Set<string>(),
  onToggleChildSelection,
  onSelectAllChildren,
  onClearChildSelection,
  onDeleteSelectedChildren,
}: TaskDetailProps) {
  const queryClient = useQueryClient()
  const debouncedTaskId = useDebounce(taskId, 120)
  const [isSyncingLabelSelection, setIsSyncingLabelSelection] = useState(false)
  const [createLabelError, setCreateLabelError] = useState<string | null>(null)
  const [descriptionDraft, setDescriptionDraft] = useState("")
  const [isSavingDescription, setIsSavingDescription] = useState(false)
  const [descriptionError, setDescriptionError] = useState<string | null>(null)
  const [selectedAssigneeType, setSelectedAssigneeType] = useState<TaskAssigneeType>("human")
  const [assigneeIdDraft, setAssigneeIdDraft] = useState("")
  const [isSavingAssignment, setIsSavingAssignment] = useState(false)
  const [assignmentError, setAssignmentError] = useState<string | null>(null)
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null)
  const lastSavedDescriptionRef = useRef("")
  const lastSavedAssignmentRef = useRef<{ assigneeType: TaskAssigneeType; assigneeId: string }>({
    assigneeType: "human",
    assigneeId: "",
  })
  const saveSequenceRef = useRef(0)
  const assignmentSaveSequenceRef = useRef(0)

  const { data, isLoading, error } = useQuery({
    queryKey: ["task", debouncedTaskId],
    queryFn: ({ signal }) => fetchers.taskDetail(debouncedTaskId, { signal }),
    enabled: !!debouncedTaskId,
    placeholderData: keepPreviousData,
  })

  const parentTaskId = data?.task.parentId ?? null
  const { data: ancestorBreadcrumbs = [] } = useQuery({
    queryKey: ["task-breadcrumbs", data?.task.id ?? null, parentTaskId],
    enabled: Boolean(parentTaskId),
    staleTime: 60_000,
    queryFn: async ({ signal }): Promise<TaskBreadcrumb[]> => {
      if (!parentTaskId) return []

      const breadcrumbs: TaskBreadcrumb[] = []
      const visitedParentIds = new Set<string>()
      let currentParentId: string | null = parentTaskId
      let steps = 0

      while (currentParentId && steps < MAX_BREADCRUMB_DEPTH && !visitedParentIds.has(currentParentId)) {
        visitedParentIds.add(currentParentId)
        const cachedParent: TaskWithDeps | undefined =
          queryClient.getQueryData<TaskDetailResponse>(["task", currentParentId])?.task
        const parentTask: TaskWithDeps =
          cachedParent ?? (await fetchers.taskDetail(currentParentId, { signal })).task

        breadcrumbs.push({
          id: currentParentId,
          title: parentTask.title,
        })

        currentParentId = parentTask.parentId
        steps += 1
      }

      return breadcrumbs.reverse()
    },
  })

  useEffect(() => {
    setIsSyncingLabelSelection(false)
    setCreateLabelError(null)
    setIsSavingDescription(false)
    setDescriptionError(null)
    setIsSavingAssignment(false)
    setAssignmentError(null)
    saveSequenceRef.current += 1
    assignmentSaveSequenceRef.current += 1
  }, [taskId])

  useEffect(() => {
    if (!data?.task.id) return
    const nextDescription = data.task.description ?? ""
    setDescriptionDraft(nextDescription)
    lastSavedDescriptionRef.current = nextDescription
    setDescriptionError(null)
    setIsSavingDescription(false)

    const nextAssigneeType = data.task.assigneeType ?? "human"
    const nextAssigneeId = data.task.assigneeId ?? ""
    setSelectedAssigneeType(nextAssigneeType)
    setAssigneeIdDraft(nextAssigneeId)
    lastSavedAssignmentRef.current = {
      assigneeType: nextAssigneeType,
      assigneeId: nextAssigneeId,
    }
    setAssignmentError(null)
    setIsSavingAssignment(false)
  }, [data?.task.id])

  useEffect(() => {
    const input = descriptionInputRef.current
    if (!input) return
    input.style.height = "0px"
    input.style.height = `${input.scrollHeight}px`
  }, [descriptionDraft, data?.task.id])

  useEffect(() => {
    if (!data?.task.id) return
    if (descriptionDraft === lastSavedDescriptionRef.current) return

    const requestTaskId = data.task.id
    const nextDescription = descriptionDraft
    const timer = window.setTimeout(() => {
      const requestSequence = ++saveSequenceRef.current
      setIsSavingDescription(true)
      setDescriptionError(null)

      void fetchers.updateTask(requestTaskId, { description: nextDescription })
        .then((updatedTask) => {
          if (requestSequence !== saveSequenceRef.current) return
          const updatedDescription = updatedTask.description ?? ""
          lastSavedDescriptionRef.current = updatedDescription
          setDescriptionDraft((currentDraft) => (
            currentDraft === nextDescription ? updatedDescription : currentDraft
          ))
          queryClient.setQueriesData<TaskDetailResponse>({ queryKey: ["task"] }, (existing) => {
            if (!existing || existing.task.id !== updatedTask.id) return existing
            return {
              ...existing,
              task: updatedTask,
            }
          })
        })
        .catch((error) => {
          if (requestSequence !== saveSequenceRef.current) return
          setDescriptionError(error instanceof Error ? error.message : "Failed to update description")
        })
        .finally(() => {
          if (requestSequence !== saveSequenceRef.current) return
          setIsSavingDescription(false)
        })
    }, 650)

    return () => window.clearTimeout(timer)
  }, [data?.task.id, descriptionDraft, queryClient])

  const persistAssignment = useCallback(async (
    assigneeType: TaskAssigneeType,
    assigneeIdInput: string
  ) => {
    if (!onUpdateAssignment) return

    const normalizedAssigneeId = assigneeIdInput.trim()
    const lastSaved = lastSavedAssignmentRef.current
    if (lastSaved.assigneeType === assigneeType && lastSaved.assigneeId === normalizedAssigneeId) {
      return
    }

    const requestSequence = ++assignmentSaveSequenceRef.current
    setIsSavingAssignment(true)
    setAssignmentError(null)

    try {
      await onUpdateAssignment({
        assigneeType,
        assigneeId: normalizedAssigneeId || null,
        assignedBy: "dashboard:detail",
      })
      if (requestSequence !== assignmentSaveSequenceRef.current) return
      lastSavedAssignmentRef.current = {
        assigneeType,
        assigneeId: normalizedAssigneeId,
      }
      setAssigneeIdDraft(normalizedAssigneeId)
      setSelectedAssigneeType(assigneeType)
    } catch (error) {
      if (requestSequence !== assignmentSaveSequenceRef.current) return
      setAssignmentError(error instanceof Error ? error.message : "Failed to update assignment")
    } finally {
      if (requestSequence !== assignmentSaveSequenceRef.current) return
      setIsSavingAssignment(false)
    }
  }, [onUpdateAssignment])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse rounded bg-gray-700 h-8 w-3/4" />
        <div className="animate-pulse rounded bg-gray-700 h-4 w-1/2" />
        <div className="animate-pulse rounded bg-gray-700 h-24" />
        <div className="animate-pulse rounded bg-gray-700 h-32" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-red-400">
        Error loading task: {String(error)}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-4 text-gray-500">
        Task not found
      </div>
    )
  }

  const { task, blockedByTasks, blocksTasks, childTasks } = data
  const compatTask = task as TaskWithDeps & {
    created_at?: string | null
    updated_at?: string | null
    completed_at?: string | null
  }
  const createdAt = compatTask.createdAt ?? compatTask.created_at
  const updatedAt = compatTask.updatedAt ?? compatTask.updated_at
  const completedAt = compatTask.completedAt ?? compatTask.completed_at
  const currentStatusStage = statusStage ?? toHumanTaskStage(task.status)
  const selectedChildrenCount = selectedChildIds.size
  const mergedLabels = (() => {
    const byId = new Map<number, TaskLabel>()
    for (const label of allLabels) {
      byId.set(label.id, label)
    }
    for (const label of task.labels ?? []) {
      if (!byId.has(label.id)) {
        byId.set(label.id, label)
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
  })()
  const selectedLabelIds = mergedLabels.flatMap((label) => {
    const isOnTask = Boolean(task.labels?.some((taskLabel) => taskLabel.id === label.id))
    return isLabelAssigned
      ? (isLabelAssigned(label) || isOnTask ? [label.id] : [])
      : (isOnTask ? [label.id] : [])
  })
  const assignedLabelsCount = selectedLabelIds.length
  const descriptionIsDirty = descriptionDraft !== lastSavedDescriptionRef.current
  const descriptionStatusMessage = descriptionError
    ? "Autosave failed"
    : isSavingDescription
      ? "Saving..."
      : descriptionIsDirty
        ? "Changes pending..."
        : "Saved"
  const normalizedAssigneeIdDraft = assigneeIdDraft.trim()
  const assignmentIsDirty =
    selectedAssigneeType !== lastSavedAssignmentRef.current.assigneeType
    || normalizedAssigneeIdDraft !== lastSavedAssignmentRef.current.assigneeId
  const assignmentStatusMessage = assignmentError
    ? "Assignment save failed"
    : isSavingAssignment
      ? "Saving..."
      : assignmentIsDirty
        ? "Changes pending..."
        : "Saved"
  const breadcrumbs = [...ancestorBreadcrumbs, { id: task.id, title: task.title }]

  const syncLabelsFromSelect = async (nextLabelIds: number[]) => {
    if (!onToggleLabel) return
    const desiredIds = new Set(nextLabelIds)
    const currentIds = new Set(selectedLabelIds)
    const toAdd = mergedLabels.filter((label) => desiredIds.has(label.id) && !currentIds.has(label.id))
    const toRemove = mergedLabels.filter((label) => !desiredIds.has(label.id) && currentIds.has(label.id))
    if (toAdd.length === 0 && toRemove.length === 0) return

    setIsSyncingLabelSelection(true)
    setCreateLabelError(null)
    try {
      for (const label of [...toAdd, ...toRemove]) {
        await onToggleLabel(label)
      }
    } catch (error) {
      setCreateLabelError(error instanceof Error ? error.message : "Failed to update labels")
    } finally {
      setIsSyncingLabelSelection(false)
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px] xl:max-w-[1200px] xl:mx-auto animate-slide-in-up">
      <div className="space-y-5">
        <div className="transition-all duration-200 ease-out">
          <div className="mb-1.5 flex flex-wrap items-center gap-1 text-xs text-gray-400">
            {onNavigateToList ? (
              <button
                type="button"
                onClick={onNavigateToList}
                className="text-blue-300 hover:text-blue-200 hover:underline"
              >
                Tasks
              </button>
            ) : (
              <span className="text-gray-500">Tasks</span>
            )}
            {breadcrumbs.map((crumb, index) => {
              const isCurrent = index === breadcrumbs.length - 1
              const crumbLabel = crumb.title.trim() || crumb.id

              return (
                <div key={crumb.id} className="flex min-w-0 items-center gap-1">
                  <span className="text-gray-600">/</span>
                  {isCurrent ? (
                    <span className="max-w-[240px] truncate text-gray-300" title={crumbLabel}>
                      {crumbLabel}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onNavigateToTask(crumb.id)}
                      className="max-w-[240px] truncate text-blue-300 hover:text-blue-200 hover:underline"
                      title={crumbLabel}
                    >
                      {crumbLabel}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <div className="mb-2 flex items-center gap-2">
            <code className="text-sm text-gray-400">{task.id}</code>
            <StatusBadge status={task.status} />
            {task.isReady && (
              <span className="rounded-full border border-blue-500 bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
                Ready
              </span>
            )}
          </div>
          <h2 className="text-2xl font-semibold text-white">{task.title}</h2>
          <div className="mt-2 rounded-md border border-white/10 bg-gray-900/20 px-2.5 py-2">
            <div className="mb-1 flex items-center justify-end gap-2">
              <span className={`text-[11px] ${
                descriptionError
                  ? "text-red-400"
                  : isSavingDescription
                    ? "text-blue-300"
                    : descriptionIsDirty
                      ? "text-amber-300"
                      : "text-emerald-300"
              }`}>
                {descriptionStatusMessage}
              </span>
            </div>

            <textarea
              ref={descriptionInputRef}
              value={descriptionDraft}
              onChange={(event) => {
                setDescriptionDraft(event.target.value)
                const input = descriptionInputRef.current
                if (!input) return
                input.style.height = "0px"
                input.style.height = `${input.scrollHeight}px`
              }}
              aria-label="Task description"
              data-native-select-all="true"
              placeholder="Add description..."
              rows={1}
              className="w-full resize-none overflow-hidden bg-transparent px-0 py-1 text-sm text-gray-200 outline-none transition"
            />

            {descriptionError && (
              <p className="mt-2 text-xs text-red-400">{descriptionError}</p>
            )}
          </div>
          {task.labels && task.labels.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {task.labels.map((label) => (
                <span
                  key={label.id}
                  className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    color: label.color,
                    backgroundColor: `${label.color}1a`,
                  }}
                >
                  {canonicalTaskLabelName(label.name)}
                </span>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-gray-400">
            <span>
              Score: <span className="font-medium text-amber-400">{task.score}</span>
            </span>
            {task.parentId && (
              <span>
                Parent:{" "}
                <button
                  className="text-blue-400 hover:underline"
                  onClick={() => onNavigateToTask(task.parentId!)}
                >
                  {task.parentId}
                </button>
              </span>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-purple-400">
              Children ({childTasks.length})
            </h3>
            <div className="flex items-center gap-1.5">
              {onSelectAllChildren && childTasks.length > 0 && (
                <button
                  onClick={onSelectAllChildren}
                  className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700"
                >
                  Select all
                </button>
              )}
              {onClearChildSelection && selectedChildrenCount > 0 && (
                <button
                  onClick={onClearChildSelection}
                  className="rounded-md border border-gray-700 bg-gray-800 px-2 py-1 text-[11px] text-gray-300 hover:bg-gray-700"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {childTasks.length === 0 ? (
            <p className="text-sm italic text-gray-500">No child tasks</p>
          ) : (
            <div className="space-y-2">
              {childTasks.map((child) => (
                <RelatedTaskCard
                  key={child.id}
                  task={child}
                  onClick={() => onNavigateToTask(child.id)}
                  isSelected={selectedChildIds.has(child.id)}
                  onToggleSelect={onToggleChildSelection}
                />
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {onCreateChild && (
              <button
                onClick={onCreateChild}
                className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1 text-xs text-gray-200 hover:bg-gray-700"
              >
                + Create new task
              </button>
            )}
            {onDeleteSelectedChildren && selectedChildrenCount > 0 && (
              <button
                onClick={() => { void onDeleteSelectedChildren() }}
                className="rounded-md border border-red-500/60 bg-red-500/10 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/20"
              >
                Delete selected ({selectedChildrenCount})
              </button>
            )}
          </div>
        </div>

        <div className="space-y-1 text-xs text-gray-500">
          <div>Created: {formatTimestamp(createdAt)}</div>
          <div>Updated: {formatTimestamp(updatedAt)}</div>
          {completedAt && (
            <div>Completed: {formatTimestamp(completedAt)}</div>
          )}
        </div>

        {blockedByTasks.length > 0 && (
          <RelatedTasksSection
            title="Blocked By"
            tasks={blockedByTasks}
            emptyMessage="No blockers - this task is unblocked"
            onTaskClick={onNavigateToTask}
            titleColor="text-red-400"
          />
        )}

        {blocksTasks.length > 0 && (
          <RelatedTasksSection
            title="Blocks"
            tasks={blocksTasks}
            emptyMessage="Does not block any other tasks"
            onTaskClick={onNavigateToTask}
            titleColor="text-green-400"
          />
        )}
      </div>

      <aside className="h-fit animate-fade-in rounded-xl border border-gray-700 bg-gray-800 p-4 shadow-sm transition-all duration-300 ease-out">
        <h3 className="mb-4 text-sm font-semibold text-gray-200">Properties</h3>

        <div className="space-y-6">
          <section>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">Status</p>
            <TaskStatusSelect
              instanceId={`task-detail-status-${task.id}`}
              value={currentStatusStage}
              onChange={(nextStage) => {
                void onChangeStatusStage?.(nextStage)
              }}
              theme={themeMode}
            />
            <p className="mt-2 text-[11px] text-gray-500">Internal status: {task.status}</p>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Assignment</p>
              <span className={`text-[11px] ${
                assignmentError
                  ? "text-red-400"
                  : isSavingAssignment
                    ? "text-blue-300"
                    : assignmentIsDirty
                      ? "text-amber-300"
                      : "text-gray-500"
              }`}>
                {assignmentStatusMessage}
              </span>
            </div>

            <TaskAssigneeTypeSelect
              instanceId={`task-detail-assignee-type-${task.id}`}
              value={selectedAssigneeType}
              onChange={(nextType) => {
                setSelectedAssigneeType(nextType)
                void persistAssignment(nextType, assigneeIdDraft)
              }}
              theme={themeMode}
            />

            <label htmlFor={`task-detail-assignee-id-${task.id}`} className="mt-3 block text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Assignee ID
            </label>
            <input
              id={`task-detail-assignee-id-${task.id}`}
              value={assigneeIdDraft}
              onChange={(event) => setAssigneeIdDraft(event.target.value)}
              onBlur={() => {
                void persistAssignment(selectedAssigneeType, assigneeIdDraft)
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return
                event.preventDefault()
                void persistAssignment(selectedAssigneeType, assigneeIdDraft)
              }}
              placeholder="Optional assignee ID"
              className="mt-1 w-full rounded-md border border-gray-600 bg-gray-800 px-2.5 py-2 text-sm text-gray-200 outline-none transition focus:border-blue-400"
            />

            <p className="mt-2 text-[11px] text-gray-500">
              Assigned at: {formatTimestamp(task.assignedAt)}
            </p>
            <p className="text-[11px] text-gray-500">
              Assigned by: {task.assignedBy ?? "—"}
            </p>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">Labels</p>
              <span className="text-[11px] text-gray-500">{assignedLabelsCount} selected</span>
            </div>

            <TaskLabelsSelect
              instanceId={`task-detail-labels-${task.id}`}
              labels={mergedLabels}
              selectedLabelIds={selectedLabelIds}
              onChange={(nextLabelIds) => {
                void syncLabelsFromSelect(nextLabelIds)
              }}
              onCreateLabel={onCreateLabel}
              theme={themeMode}
              disabled={isSyncingLabelSelection || (!onToggleLabel && !onCreateLabel)}
              noOptionsMessage="No labels yet."
            />

            {isSyncingLabelSelection && (
              <p className="mt-2 text-[11px] text-gray-500">Updating labels...</p>
            )}
            {createLabelError && (
              <p className="mt-2 text-[11px] text-red-400">{createLabelError}</p>
            )}
          </section>

          {(onCopyTaskReference || onCreateChild) && (
            <section>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">Actions</p>
              <div className="space-y-1.5">
                {onCopyTaskReference && (
                  <button
                    onClick={onCopyTaskReference}
                    className="w-full rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-700"
                  >
                    Copy task reference
                  </button>
                )}
                {onCreateChild && (
                  <button
                    onClick={onCreateChild}
                    className="w-full rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-700"
                  >
                    Create new sub-task
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      </aside>
    </div>
  )
}
