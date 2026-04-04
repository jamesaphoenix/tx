import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useStore } from "@tanstack/react-store"
import Select, { type MultiValue, type SingleValue, type StylesConfig } from "react-select"
import {
  fetchers,
  type TaskAssigneeType,
  type TaskWithDeps,
  type PaginatedTasksResponse,
  type TaskLabel
} from "../../api/client"
import { Button } from "../ui"
import { SearchInput } from "../ui/SearchInput"
import { TaskList } from "./TaskList"
import { KanbanBoard } from "./KanbanBoard"
import { TaskDetail } from "./TaskDetail"
import { TaskComposerModal, type TaskComposerModalSubmit } from "./TaskComposerModal"
import {
  HUMAN_STAGE_OPTIONS,
  TASK_STATUS_OPTIONS,
  autoTaskLabelColor,
  toHumanTaskStage,
  type TaskStatusValue,
  type HumanTaskStage,
} from "./TaskPropertySelects"
import { useCommands, type Command } from "../command-palette/CommandContext"
import { buildTaskCommands, buildSelectionCommands } from "../command-palette/buildTaskCommands"
import { useCycles } from "../../hooks/useCycles"
import { selectionActions, selectionStore } from "../../stores/selection-store"
import {
  buildTaskClientFilterPredicate,
  hasActiveTaskClientFilters,
  normalizeTaskClientFilters,
  type TaskAssigneeFilterValue,
  type TaskClientFilters,
} from "./taskClientFilters"

type ThemeMode = "light" | "dark"

export interface TasksPageProps {
  themeMode?: ThemeMode
  defaultTaskAssigmentType?: TaskAssigneeType
  defaultTaskView?: "list" | "kanban"
  autoAddStatuses?: string[]
  /**
   * Incrementing signal from the app shell to request opening the
   * task composer even before page-level shortcut registration settles.
   */
  newTaskRequestNonce?: number
}

type TaskViewMode = "list" | "kanban"

interface TaskViewState {
  view: TaskViewMode
  statuses: TaskStatusValue[]
  search: string
  taskId: string | null
  assigneeType: TaskAssigneeFilterValue
  labelIds: number[]
}

interface ComposerState {
  heading: string
  submitLabel: string
  parentId: string | null
}

const STATUS_COLORS: Record<TaskStatusValue, string> = {
  backlog: "bg-gray-500",
  ready: "bg-blue-500",
  planning: "bg-purple-500",
  active: "bg-yellow-500",
  blocked: "bg-red-500",
  review: "bg-orange-500",
  needs_review: "bg-pink-500",
  done: "bg-green-500",
}

const TASK_STATUS_VALUES: readonly TaskStatusValue[] = TASK_STATUS_OPTIONS.map((option) => option.value)
const TASK_STATUS_SET = new Set<TaskStatusValue>(TASK_STATUS_VALUES)

interface AssigneeFilterOption {
  value: TaskAssigneeFilterValue
  label: string
}

interface LabelFilterOption {
  value: number
  label: string
  color: string
}

const ASSIGNEE_FILTER_OPTIONS: readonly AssigneeFilterOption[] = [
  { value: "all", label: "All Assignments" },
  { value: "human", label: "Human" },
  { value: "agent", label: "Agent" },
  { value: "unassigned", label: "Unassigned" },
]

function createTaskFilterSelectStyles(themeMode: ThemeMode): StylesConfig<AssigneeFilterOption | LabelFilterOption, boolean> {
  const isDark = themeMode === "dark"
  const palette = isDark
    ? {
      controlBg: "#111827",
      controlBorder: "#374151",
      controlBorderFocus: "#6b7280",
      menuBg: "#111827",
      optionBg: "#111827",
      optionBgFocus: "#1f2937",
      text: "#f3f4f6",
      muted: "#9ca3af",
      chipBg: "#1f2937",
      chipHoverBg: "#374151",
      menuShadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
      focusShadow: "0 0 0 2px rgba(59, 130, 246, 0.25)",
    }
    : {
      controlBg: "#f8fbff",
      controlBorder: "#d2deee",
      controlBorderFocus: "#4f8ff8",
      menuBg: "#ffffff",
      optionBg: "#ffffff",
      optionBgFocus: "#eef5ff",
      optionBgSelected: "#dbeafe",
      text: "#0f172a",
      muted: "#64748b",
      chipBg: "#dbeafe",
      chipHoverBg: "#bfdbfe",
      menuShadow: "0 14px 30px rgba(15, 23, 42, 0.16)",
      focusShadow: "0 0 0 2px rgba(79, 143, 248, 0.22)",
    }

  return {
    control: (base, state) => ({
      ...base,
      minHeight: 38,
      borderRadius: 10,
      borderColor: state.isFocused ? palette.controlBorderFocus : palette.controlBorder,
      boxShadow: state.isFocused ? palette.focusShadow : "none",
      backgroundColor: palette.controlBg,
      "&:hover": {
        borderColor: palette.controlBorderFocus,
      },
    }),
    menuPortal: (base) => ({
      ...base,
      zIndex: 80,
    }),
    menu: (base) => ({
      ...base,
      zIndex: 80,
      borderRadius: 10,
      backgroundColor: palette.menuBg,
      border: `1px solid ${palette.controlBorder}`,
      boxShadow: palette.menuShadow,
    }),
    menuList: (base) => ({
      ...base,
      paddingTop: 4,
      paddingBottom: 4,
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isSelected
        ? (palette.optionBgSelected ?? palette.optionBgFocus)
        : state.isFocused
          ? palette.optionBgFocus
          : palette.optionBg,
      color: palette.text,
      cursor: "pointer",
      fontSize: 13,
    }),
    placeholder: (base) => ({
      ...base,
      color: palette.muted,
      fontSize: 13,
    }),
    singleValue: (base) => ({
      ...base,
      color: palette.text,
      fontSize: 13,
    }),
    input: (base) => ({
      ...base,
      color: palette.text,
    }),
    indicatorSeparator: (base) => ({
      ...base,
      backgroundColor: palette.controlBorder,
    }),
    dropdownIndicator: (base, state) => ({
      ...base,
      color: state.isFocused ? palette.controlBorderFocus : palette.muted,
      "&:hover": {
        color: palette.controlBorderFocus,
      },
    }),
    clearIndicator: (base) => ({
      ...base,
      color: palette.muted,
      "&:hover": {
        color: palette.text,
      },
    }),
    noOptionsMessage: (base) => ({
      ...base,
      color: palette.muted,
      fontSize: 12,
    }),
    multiValue: (base) => ({
      ...base,
      backgroundColor: palette.chipBg,
      borderRadius: 999,
    }),
    multiValueLabel: (base) => ({
      ...base,
      color: palette.text,
      fontSize: 12,
    }),
    multiValueRemove: (base) => ({
      ...base,
      color: palette.muted,
      ":hover": {
        backgroundColor: palette.chipHoverBg,
        color: palette.text,
      },
    }),
  }
}

function parseTaskStatuses(value: string | null): TaskStatusValue[] {
  if (!value) return []

  const statuses = value
    .split(",")
    .map((part) => part.trim())
    .filter((status): status is TaskStatusValue => TASK_STATUS_SET.has(status as TaskStatusValue))

  const selectedStatus = statuses.at(-1)
  return selectedStatus ? [selectedStatus] : []
}

function parseLegacyBucketStatuses(value: string | null): TaskStatusValue[] {
  if (value === "backlog") return ["backlog"]
  if (value === "in_progress") return ["ready", "planning", "active", "blocked", "review", "needs_review"]
  if (value === "done") return ["done"]
  return []
}

function parseTaskAssigneeFilter(value: string | null): TaskAssigneeFilterValue {
  if (value === "human" || value === "agent" || value === "unassigned") {
    return value
  }
  return "all"
}

function parseTaskLabelFilters(value: string | null): number[] {
  if (!value) return []
  const parsed = value
    .split(",")
    .map((part) => Number(part))
    .filter((id): id is number => Number.isInteger(id) && id > 0)
  return Array.from(new Set(parsed))
}

function parseTaskView(value: string | null, fallback: TaskViewMode): TaskViewMode {
  if (value === "list" || value === "kanban") {
    return value
  }
  return fallback
}

function readTaskViewStateFromUrl(defaultTaskView: TaskViewMode = "list"): TaskViewState {
  const params = new URLSearchParams(window.location.search)
  const statuses = parseTaskStatuses(params.get("status"))
  const legacyStatuses = statuses.length === 0 ? parseLegacyBucketStatuses(params.get("taskBucket")) : []
  return {
    view: parseTaskView(params.get("view"), defaultTaskView),
    statuses: statuses.length > 0 ? statuses : legacyStatuses,
    search: params.get("taskSearch") ?? "",
    taskId: params.get("taskId"),
    assigneeType: parseTaskAssigneeFilter(params.get("taskAssignee")),
    labelIds: parseTaskLabelFilters(params.get("taskLabels")),
  }
}

function buildTaskUrl(state: TaskViewState): string {
  const params = new URLSearchParams(window.location.search)
  params.delete("view")
  params.delete("status")
  params.delete("taskBucket")
  params.delete("taskSearch")
  params.delete("taskId")
  params.delete("taskAssignee")
  params.delete("taskLabels")

  params.set("view", state.view)
  if (state.statuses.length > 0) {
    params.set("status", state.statuses.join(","))
  }
  if (state.search) {
    params.set("taskSearch", state.search)
  }
  if (state.taskId) {
    params.set("taskId", state.taskId)
  }
  if (state.assigneeType !== "all") {
    params.set("taskAssignee", state.assigneeType)
  }
  if (state.labelIds.length > 0) {
    params.set("taskLabels", state.labelIds.join(","))
  }

  const query = params.toString()
  return query ? `${window.location.pathname}?${query}` : window.location.pathname
}

async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    // noop
  }
}

export function TasksPage({
  themeMode = "light",
  defaultTaskAssigmentType = "human",
  defaultTaskView = "list",
  autoAddStatuses = [],
  newTaskRequestNonce = 0
}: TasksPageProps) {
  const isDarkTheme = themeMode === "dark"
  const queryClient = useQueryClient()
  const selectedTaskIds = useStore(selectionStore, (s) => s.taskIds)
  const lastHandledNewTaskRequestRef = useRef(0)
  const nextComposerLabelIdRef = useRef(-1)
  const filterButtonRef = useRef<HTMLButtonElement | null>(null)
  const filterPanelRef = useRef<HTMLDivElement | null>(null)
  const [viewState, setViewState] = useState<TaskViewState>(() => readTaskViewStateFromUrl(defaultTaskView))
  const [composer, setComposer] = useState<ComposerState | null>(null)
  const [composerFallbackLabels, setComposerFallbackLabels] = useState<Record<number, { name: string; color: string }>>({})
  const [selectedChildIds, setSelectedChildIds] = useState<Set<string>>(new Set())
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false)
  const selectMenuPortalTarget = useMemo(() => typeof document === "undefined" ? undefined : document.body, [])
  const taskFilterSelectStyles = useMemo(
    () => createTaskFilterSelectStyles(themeMode),
    [themeMode]
  )

  // Cycles data for task commands
  const { data: cycles = [] } = useCycles()
  const moveTaskToCycle = useCallback(async (cycleId: string, taskIds: string[]) => {
    await fetchers.addTasksToCycle(cycleId, taskIds)
    await queryClient.invalidateQueries({ queryKey: ["cycles"] })
    await queryClient.invalidateQueries({ queryKey: ["tasks"] })
  }, [queryClient])

  const filters = useMemo(() => ({
    status: viewState.statuses,
    search: viewState.search,
  }), [viewState.statuses, viewState.search])

  const { data: taskSummaryData } = useQuery({
    queryKey: ["tasks", "summary"],
    queryFn: fetchers.tasks,
    staleTime: 5000,
  })
  const statusCounts = useMemo(() => {
    const summaryByStatus = taskSummaryData?.summary.byStatus
    return TASK_STATUS_VALUES.reduce((acc, status) => {
      const count = summaryByStatus?.[status]
      acc[status] = typeof count === "number" ? count : 0
      return acc
    }, {} as Record<TaskStatusValue, number>)
  }, [taskSummaryData])
  const allStatusCount = useMemo(
    () => TASK_STATUS_VALUES.reduce((total, status) => total + (statusCounts[status] ?? 0), 0),
    [statusCounts]
  )

  const { data: labelsData } = useQuery({
    queryKey: ["labels"],
    queryFn: fetchers.labels,
    staleTime: 5000,
  })
  const allLabels = labelsData?.labels ?? []
  const labelFilterOptions = useMemo<LabelFilterOption[]>(
    () => allLabels.map((label) => ({
      value: label.id,
      label: label.name,
      color: label.color,
    })),
    [allLabels]
  )
  const selectedAssigneeFilterOption = useMemo(
    () => ASSIGNEE_FILTER_OPTIONS.find((option) => option.value === viewState.assigneeType) ?? ASSIGNEE_FILTER_OPTIONS[0],
    [viewState.assigneeType]
  )
  const selectedLabelFilterOptions = useMemo(
    () => labelFilterOptions.filter((option) => viewState.labelIds.includes(option.value)),
    [labelFilterOptions, viewState.labelIds]
  )
  const clientFilters = useMemo<TaskClientFilters>(
    () => normalizeTaskClientFilters({
      assigneeType: viewState.assigneeType,
      labelIds: viewState.labelIds,
    }),
    [viewState.assigneeType, viewState.labelIds]
  )
  const matchesClientFilters = useMemo(
    () => buildTaskClientFilterPredicate(clientFilters),
    [clientFilters]
  )
  const hasActiveClientFilters = useMemo(
    () => hasActiveTaskClientFilters(clientFilters),
    [clientFilters]
  )
  const activeClientFilterCount = useMemo(
    () => (viewState.assigneeType !== "all" ? 1 : 0) + viewState.labelIds.length,
    [viewState.assigneeType, viewState.labelIds]
  )

  const { data: selectedTaskDetail } = useQuery({
    queryKey: ["task", viewState.taskId],
    queryFn: ({ signal }) => fetchers.taskDetail(viewState.taskId!, { signal }),
    enabled: !!viewState.taskId,
  })
  const selectedTask = selectedTaskDetail?.task
  const childTasks = selectedTaskDetail?.childTasks ?? []

  const writeViewState = useCallback((next: TaskViewState, mode: "replace" | "push") => {
    const nextUrl = buildTaskUrl(next)
    if (mode === "push") {
      window.history.pushState({ txTaskNav: true }, "", nextUrl)
    } else {
      window.history.replaceState(window.history.state, "", nextUrl)
    }
    setViewState(next)
  }, [])

  useEffect(() => {
    const onPopState = () => setViewState(readTaskViewStateFromUrl(defaultTaskView))
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [defaultTaskView])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.has("view")) return
    setViewState((current) => {
      if (current.view === defaultTaskView) {
        return current
      }
      return { ...current, view: defaultTaskView }
    })
  }, [defaultTaskView])

  useEffect(() => {
    setSelectedChildIds(new Set())
  }, [viewState.taskId])

  useEffect(() => {
    if (viewState.taskId) {
      setIsFilterPanelOpen(false)
    }
  }, [viewState.taskId])

  useEffect(() => {
    if (!isFilterPanelOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (filterPanelRef.current?.contains(target)) return
      if (filterButtonRef.current?.contains(target)) return
      setIsFilterPanelOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFilterPanelOpen(false)
      }
    }

    window.addEventListener("mousedown", handlePointerDown)
    window.addEventListener("keydown", handleEscape)

    return () => {
      window.removeEventListener("mousedown", handlePointerDown)
      window.removeEventListener("keydown", handleEscape)
    }
  }, [isFilterPanelOpen])

  const openComposer = useCallback((state: ComposerState) => {
    nextComposerLabelIdRef.current = -1
    setComposerFallbackLabels({})
    setComposer(state)
  }, [])

  const closeComposer = useCallback(() => {
    setComposer(null)
    setComposerFallbackLabels({})
    nextComposerLabelIdRef.current = -1
  }, [])

  useEffect(() => {
    if (newTaskRequestNonce <= lastHandledNewTaskRequestRef.current) return
    lastHandledNewTaskRequestRef.current = newTaskRequestNonce
    openComposer({
      heading: "New task",
      submitLabel: "Create task",
      parentId: null,
    })
  }, [newTaskRequestNonce, openComposer])

  const openTask = useCallback((taskId: string) => {
    if (viewState.taskId === taskId) return
    writeViewState({ ...viewState, taskId }, "push")
  }, [viewState, writeViewState])

  const closeTaskToList = useCallback(() => {
    if (!viewState.taskId) return
    writeViewState({ ...viewState, taskId: null }, "replace")
  }, [viewState, writeViewState])

  const closeTask = useCallback(() => {
    if (!viewState.taskId) return
    if ((window.history.state as { txTaskNav?: boolean } | null)?.txTaskNav) {
      window.history.back()
      return
    }
    closeTaskToList()
  }, [viewState.taskId, closeTaskToList])

  useEffect(() => {
    if (!viewState.taskId || composer) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement
      ) {
        return
      }
      if (selectedChildIds.size > 0) {
        event.preventDefault()
        setSelectedChildIds(new Set())
        return
      }
      closeTask()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [viewState.taskId, composer, closeTask, selectedChildIds])

  const toggleStatusFilter = useCallback((status: TaskStatusValue) => {
    const isSelected = viewState.statuses.length === 1 && viewState.statuses[0] === status
    const statuses = isSelected ? [] : [status]
    writeViewState({ ...viewState, statuses, taskId: null }, "replace")
  }, [viewState, writeViewState])

  const clearStatusFilters = useCallback(() => {
    if (viewState.statuses.length === 0) return
    writeViewState({ ...viewState, statuses: [], taskId: null }, "replace")
  }, [viewState, writeViewState])

  const setView = useCallback((view: TaskViewMode) => {
    if (viewState.view === view) return
    writeViewState({ ...viewState, view, taskId: null }, "replace")
  }, [viewState, writeViewState])

  const setSearch = useCallback((search: string) => {
    writeViewState({ ...viewState, search }, "replace")
  }, [viewState, writeViewState])

  const setAssigneeTypeFilter = useCallback((assigneeType: TaskAssigneeFilterValue) => {
    writeViewState({ ...viewState, assigneeType }, "replace")
  }, [viewState, writeViewState])

  const setLabelFilters = useCallback((labelIds: number[]) => {
    writeViewState({
      ...viewState,
      labelIds: Array.from(new Set(labelIds.filter((id) => Number.isInteger(id) && id > 0))),
    }, "replace")
  }, [viewState, writeViewState])

  const clearClientFilters = useCallback(() => {
    writeViewState({
      ...viewState,
      assigneeType: "all",
      labelIds: [],
    }, "replace")
  }, [viewState, writeViewState])

  const invalidateTaskQueries = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["tasks"] }),
      queryClient.invalidateQueries({ queryKey: ["task"] }),
      queryClient.invalidateQueries({ queryKey: ["stats"] }),
      queryClient.invalidateQueries({ queryKey: ["labels"] }),
      queryClient.invalidateQueries({ queryKey: ["cycles"] }),
    ])
  }, [queryClient])

  const createTaskFromComposer = useCallback(async (payload: TaskComposerModalSubmit) => {
    const created = await fetchers.createTask({
      title: payload.title,
      description: payload.description,
      parentId: payload.parentId,
      status: payload.stage,
      assigneeType: payload.assigneeType,
      assigneeId: payload.assigneeId,
      assignedBy: "dashboard:composer",
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

    // Auto-add to current cycle if task status matches autoAddStatuses
    if (autoAddStatuses.length > 0 && autoAddStatuses.includes(payload.stage)) {
      const currentCycle = cycles.find((c) => c.status === "current")
      if (currentCycle) {
        try {
          await fetchers.addTasksToCycle(currentCycle.id, [created.id])
        } catch {
          // Non-critical: task was created, auto-add to cycle failed silently
        }
      }
    }

    setComposerFallbackLabels({})
    await invalidateTaskQueries()

    if (payload.createMore && payload.parentId) {
      // Keep the parent detail selected while creating multiple subtasks,
      // but eagerly refresh that detail so the new child appears immediately.
      await queryClient.refetchQueries({
        queryKey: ["task", payload.parentId],
        exact: true,
        type: "active",
      })
      return
    }

    closeComposer()
  }, [closeComposer, composerFallbackLabels, invalidateTaskQueries, queryClient, autoAddStatuses, cycles])

  const createLabel = useCallback(async (payload: { name: string; color?: string }): Promise<TaskLabel | null> => {
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
      await invalidateTaskQueries()
      return created
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes("404")) {
        throw error
      }

      // Compatibility fallback for older API servers without /api/labels.
      const tempId = nextComposerLabelIdRef.current
      nextComposerLabelIdRef.current -= 1
      const color = payload.color ?? autoTaskLabelColor(normalizedName)
      setComposerFallbackLabels((prev) => ({
        ...prev,
        [tempId]: { name: normalizedName, color },
      }))

      const now = new Date().toISOString()
      return {
        id: tempId,
        name: normalizedName,
        color,
        createdAt: now,
        updatedAt: now,
      }
    }
  }, [invalidateTaskQueries])

  const createAndAssignLabel = useCallback(async (payload: { name: string; color?: string }): Promise<TaskLabel | null> => {
    if (!viewState.taskId) return null
    const normalizedName = payload.name.trim()
    if (!normalizedName) return null
    const response = await fetchers.assignTaskLabel(viewState.taskId, {
      name: normalizedName,
      color: payload.color,
    })
    await invalidateTaskQueries()
    return response.label ?? null
  }, [viewState.taskId, invalidateTaskQueries])

  const changeTaskStatusStage = useCallback(async (stage: HumanTaskStage, taskId: string | null = viewState.taskId) => {
    if (!taskId) return
    await fetchers.updateTask(taskId, { status: stage })
    await invalidateTaskQueries()
  }, [viewState.taskId, invalidateTaskQueries])

  const updateTaskAssignment = useCallback(async (payload: {
    assigneeType: TaskAssigneeType | null
    assigneeId: string | null
    assignedBy?: string | null
  }, taskId: string | null = viewState.taskId) => {
    if (!taskId) return
    await fetchers.updateTask(taskId, {
      assigneeType: payload.assigneeType,
      assigneeId: payload.assigneeId,
      assignedBy: payload.assignedBy ?? "dashboard:task-detail",
    })
    await invalidateTaskQueries()
  }, [viewState.taskId, invalidateTaskQueries])

  const toggleSelectedTaskAssigneeType = useCallback(async () => {
    if (!selectedTask) return
    const nextType: TaskAssigneeType = selectedTask.assigneeType === "human" ? "agent" : "human"
    await updateTaskAssignment({
      assigneeType: nextType,
      assigneeId: selectedTask.assigneeId ?? null,
      assignedBy: "dashboard:cmdk",
    }, selectedTask.id)
  }, [selectedTask, updateTaskAssignment])

  const cycleTaskStatusStage = useCallback(async () => {
    if (!selectedTask) return
    const order: HumanTaskStage[] = ["backlog", "ready", "planning", "active", "blocked", "review", "needs_review", "done"]
    const current = toHumanTaskStage(selectedTask.status)
    const next = order[(order.indexOf(current) + 1) % order.length]!
    await changeTaskStatusStage(next, selectedTask.id)
  }, [selectedTask, changeTaskStatusStage])

  const setSelectedChildrenStatusStage = useCallback(async (stage: HumanTaskStage) => {
    const ids = Array.from(selectedChildIds)
    if (ids.length === 0) return
    await Promise.all(ids.map((taskId) => fetchers.updateTask(taskId, { status: stage })))
    await invalidateTaskQueries()
  }, [selectedChildIds, invalidateTaskQueries])

  const setSelectedTasksStatusStage = useCallback(async (stage: HumanTaskStage) => {
    const ids = Array.from(selectedTaskIds)
    if (ids.length === 0) return
    await Promise.all(ids.map((taskId) => fetchers.updateTask(taskId, { status: stage })))
    await invalidateTaskQueries()
  }, [selectedTaskIds, invalidateTaskQueries])

  const isAssignedLabel = useCallback((label: TaskLabel) => {
    return Boolean(selectedTask?.labels?.some((l) => l.id === label.id))
  }, [selectedTask?.labels])

  const toggleLabel = useCallback(async (label: TaskLabel) => {
    if (!viewState.taskId) return
    if (isAssignedLabel(label)) {
      await fetchers.unassignTaskLabel(viewState.taskId, label.id)
    } else {
      await fetchers.assignTaskLabel(viewState.taskId, { labelId: label.id })
    }
    await invalidateTaskQueries()
  }, [viewState.taskId, isAssignedLabel, invalidateTaskQueries])

  const promptCreateAndAssignLabel = useCallback(async () => {
    if (!viewState.taskId) return
    const name = window.prompt("Label name:")
    const normalizedName = name?.trim()
    if (!normalizedName) return
    await createAndAssignLabel({ name: normalizedName })
  }, [viewState.taskId, createAndAssignLabel])

  const copySelectedTaskReference = useCallback(async () => {
    if (!viewState.taskId) return
    const selected = selectedTask
    const params = new URLSearchParams(window.location.search)
    params.delete("view")
    params.delete("status")
    params.delete("taskBucket")
    params.set("taskId", viewState.taskId)
    params.set("view", viewState.view)
    if (viewState.statuses.length > 0) params.set("status", viewState.statuses.join(","))
    if (viewState.assigneeType !== "all") params.set("taskAssignee", viewState.assigneeType)
    if (viewState.labelIds.length > 0) params.set("taskLabels", viewState.labelIds.join(","))
    const deepLink = `${window.location.origin}${window.location.pathname}?${params.toString()}`
    const text = selected
      ? `${selected.id} ${selected.title}\n${deepLink}`
      : `${viewState.taskId}\n${deepLink}`
    await copyToClipboard(text)
  }, [viewState.taskId, viewState.view, viewState.statuses, viewState.assigneeType, viewState.labelIds, selectedTask])

  const getLoadedTasks = useCallback((): TaskWithDeps[] => {
    const byId = new Map<string, TaskWithDeps>()
    const activeQueryData = queryClient.getQueryData<{ pages: PaginatedTasksResponse[] }>(
      ["tasks", "infinite", filters] as const
    )
    for (const page of activeQueryData?.pages ?? []) {
      for (const task of page.tasks) {
        if (!matchesClientFilters(task)) {
          continue
        }
        byId.set(task.id, task)
      }
    }
    return Array.from(byId.values())
  }, [queryClient, matchesClientFilters, filters])

  const toggleChildSelection = useCallback((taskId: string) => {
    setSelectedChildIds((prev) => {
      const next = new Set(prev)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }, [])

  const deleteTasks = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    await Promise.all(ids.map(async (id) => {
      try {
        await fetchers.deleteTask(id)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Treat already-deleted rows as success for bulk command actions.
        if (!message.includes("404")) {
          throw error
        }
      }
    }))
    await invalidateTaskQueries()
  }, [invalidateTaskQueries])

  const deleteSelectedChildren = useCallback(async () => {
    const ids = Array.from(selectedChildIds)
    if (ids.length === 0) return
    const confirmed = window.confirm(`Delete ${ids.length} selected child task${ids.length > 1 ? "s" : ""}?`)
    if (!confirmed) return
    await deleteTasks(ids)
    setSelectedChildIds(new Set())
  }, [selectedChildIds, deleteTasks])

  const commands = useMemo((): Command[] => {
    const hasTaskDetailOpen = Boolean(viewState.taskId)
    const loadedTasks = getLoadedTasks()
    const selectedLoadedIds = loadedTasks
      .filter((task) => selectedTaskIds.has(task.id))
      .map((task) => task.id)

    const cmds: Command[] = [
      {
        id: "tasks:new",
        label: hasTaskDetailOpen ? "Create new sub-task" : "Create new task",
        group: "Actions",
        icon: "action",
        shortcut: "⌘N",
        allowInInput: true,
        action: () => openComposer({
          heading: hasTaskDetailOpen ? "New sub-task" : "New task",
          submitLabel: hasTaskDetailOpen ? "Create sub-task" : "Create task",
          parentId: hasTaskDetailOpen ? viewState.taskId : null,
        }),
      },
      {
        id: "tasks:statuses:all",
        label: "View All Statuses",
        group: "Filters",
        icon: "filter",
        action: clearStatusFilters,
      },
    ]

    cmds.push({
      id: "tasks:statuses:toggle",
      label: "Filter by status",
      group: "Filters",
      icon: "filter",
      action: () => {},
      children: TASK_STATUS_OPTIONS.map((option) => ({
        id: `tasks:statuses:toggle:${option.value}`,
        label: option.label,
        group: "Statuses",
        icon: "filter" as const,
        action: () => toggleStatusFilter(option.value),
      })),
    })

    if (!hasTaskDetailOpen && hasActiveClientFilters) {
      cmds.push({
        id: "tasks:filters:clear",
        label: "Clear assignment + label filters",
        group: "Filters",
        icon: "filter",
        action: clearClientFilters,
      })
    }

    cmds.push({
      id: "select-all",
      label: hasTaskDetailOpen ? "Select all child tasks" : "Select all tasks",
      sublabel: hasTaskDetailOpen ? `${childTasks.length} children` : `${loadedTasks.length} loaded`,
      group: "Actions",
      icon: "select",
      shortcut: "⌘A",
      allowInInput: true,
      action: () => {
        if (hasTaskDetailOpen) {
          setSelectedChildIds(new Set(childTasks.map((task) => task.id)))
          return
        }
        const currentLoaded = getLoadedTasks()
        selectionActions.selectAllTasks(currentLoaded.map((task) => task.id))
      },
    })

    if (!hasTaskDetailOpen && selectedLoadedIds.length > 0) {
      const selectedIds = selectedLoadedIds
      const selectedIdSet = new Set(selectedIds)

      // "Set status", "Set label", "Move to cycle" — top of the list
      cmds.push(...buildSelectionCommands({
        namespace: "tasks",
        selectedIds,
        labels: allLabels,
        cycles,
        onBulkSetStatus: (status) => void setSelectedTasksStatusStage(status as TaskStatusValue),
        onBulkToggleLabel: (label) => {
          void (async () => {
            for (const id of selectedIds) {
              await fetchers.assignTaskLabel(id, { labelId: label.id })
            }
            await invalidateTaskQueries()
          })()
        },
        onBulkMoveToCycle: (cycleId) => void moveTaskToCycle(cycleId, selectedIds),
      }))

      cmds.push({
        id: "tasks:copy-selected",
        label: "Copy selected task IDs",
        sublabel: `${selectedIds.length} selected`,
        group: "Actions",
        icon: "copy",
        shortcut: "⌘C",
        action: async () => {
          const text = loadedTasks
            .filter((task) => selectedIdSet.has(task.id))
            .map((task) => `${task.id} ${task.title}`)
            .join("\n")
          await copyToClipboard(text)
        },
      })
      cmds.push({
        id: "tasks:clear-selection",
        label: "Clear task selection",
        sublabel: `${selectedIds.length} selected`,
        group: "Actions",
        icon: "action",
        action: () => selectionActions.clearTasks(),
      })
      cmds.push({
        id: "tasks:delete-selected",
        label: "Delete selected tasks",
        sublabel: `${selectedIds.length} selected`,
        group: "Actions",
        icon: "delete",
        action: async () => {
          if (selectedIds.length === 0) return
          const confirmed = window.confirm(`Delete ${selectedIds.length} selected task${selectedIds.length > 1 ? "s" : ""}?`)
          if (!confirmed) return
          await deleteTasks(selectedIds)
          selectionActions.clearTasks()
        },
      })
    }

    if (!hasTaskDetailOpen) {
      for (const task of loadedTasks.slice(0, 100)) {
        cmds.push({
          id: `tasks:open:${task.id}`,
          label: task.title,
          sublabel: `${task.id} • ${task.status}`,
          group: "Items",
          icon: "nav",
          action: () => openTask(task.id),
        })
      }
      return cmds
    }

    cmds.push(
      {
        id: "tasks:back",
        label: "Back to task list",
        group: "Navigation",
        icon: "nav",
        action: closeTask,
      },
      {
        id: "tasks:copy",
        label: "Copy task reference",
        sublabel: viewState.taskId ?? "",
        group: "Actions",
        icon: "copy",
        shortcut: selectedChildIds.size === 0 ? "⌘C" : undefined,
        action: copySelectedTaskReference,
      },
      {
        id: "tasks:new-subtask",
        label: "Create sub-task",
        group: "Actions",
        icon: "action",
        shortcut: "⌘⇧N",
        allowInInput: true,
        action: () => openComposer({
          heading: "New sub-task",
          submitLabel: "Create sub-task",
          parentId: viewState.taskId,
        }),
      },
      {
        id: "tasks:status-cycle",
        label: "Cycle status (Backlog → Ready → … → Done)",
        group: "Actions",
        icon: "action",
        shortcut: "⌘S",
        action: cycleTaskStatusStage,
      },
      {
        id: "tasks:assignment-toggle",
        label: `Toggle assignment (switch to ${selectedTask?.assigneeType === "human" ? "Agent" : "Human"})`,
        group: "Actions",
        icon: "action",
        shortcut: "⌘⇧A",
        action: () => void toggleSelectedTaskAssigneeType(),
      },
      {
        id: "tasks:labels-prompt",
        label: "Create + assign label",
        group: "Labels",
        icon: "action",
        shortcut: "⌘L",
        allowInInput: true,
        action: promptCreateAndAssignLabel,
      },
      {
        id: "tasks:delete-current",
        label: "Delete current task",
        sublabel: viewState.taskId ?? "",
        group: "Actions",
        icon: "delete",
        action: async () => {
          if (!viewState.taskId) return
          const confirmed = window.confirm("Delete this task and all of its children?")
          if (!confirmed) return
          await fetchers.deleteTask(viewState.taskId)
          await invalidateTaskQueries()
          closeTask()
        },
      },
    )

    // Shared "Set <field>" commands via buildTaskCommands
    cmds.push(...buildTaskCommands({
      namespace: "tasks",
      task: selectedTask ? { id: selectedTask.id, labels: selectedTask.labels } : null,
      labels: allLabels,
      cycles,
      onSetStatus: (status) => void changeTaskStatusStage(status as TaskStatusValue, selectedTask!.id),
      onToggleLabel: (label) => void toggleLabel(label),
      onSetScore: () => {
        if (!selectedTask) return
        const input = window.prompt("Score:", String(selectedTask.score ?? 0))
        if (input === null) return
        const score = parseInt(input, 10)
        if (Number.isNaN(score)) return
        void (async () => {
          await fetchers.updateTask(selectedTask.id, { score })
          await invalidateTaskQueries()
        })()
      },
      onMoveToCycle: (cycleId) => {
        if (viewState.taskId) {
          void moveTaskToCycle(cycleId, [viewState.taskId])
        }
      },
    }))

    for (const child of childTasks.slice(0, 100)) {
      cmds.push({
        id: `tasks:child:open:${child.id}`,
        label: `Open child: ${child.title}`,
        sublabel: `${child.id} • ${child.status}`,
        group: "Items",
        icon: "nav",
        action: () => openTask(child.id),
      })
    }

    if (selectedChildIds.size > 0) {
      cmds.push(
        {
          id: "tasks:children:copy-selected",
          label: "Copy selected child task IDs",
          sublabel: `${selectedChildIds.size} selected`,
          group: "Children",
          icon: "copy",
          shortcut: "⌘C",
          action: async () => {
            const text = childTasks
              .filter((task) => selectedChildIds.has(task.id))
              .map((task) => `${task.id} ${task.title}`)
              .join("\n")
            await copyToClipboard(text)
          },
        },
        {
          id: "tasks:children:clear-selected",
          label: "Clear selected child tasks",
          sublabel: `${selectedChildIds.size} selected`,
          group: "Children",
          icon: "action",
          action: () => setSelectedChildIds(new Set()),
        },
        {
          id: "tasks:children:delete-selected",
          label: "Delete selected child tasks",
          sublabel: `${selectedChildIds.size} selected`,
          group: "Children",
          icon: "delete",
          action: () => void deleteSelectedChildren(),
        },
      )

      cmds.push({
        id: "tasks:children:status",
        label: "Set selected child tasks to",
        sublabel: `${selectedChildIds.size} selected`,
        group: "Children",
        icon: "action",
        action: () => {},
        children: HUMAN_STAGE_OPTIONS.map((stage) => ({
          id: `tasks:children:status:${stage.value}`,
          label: stage.label,
          group: "Statuses",
          icon: "action" as const,
          action: () => void setSelectedChildrenStatusStage(stage.value),
        })),
      })
    }

    if (childTasks.length > 0) {
      cmds.push({
        id: "tasks:children:select-all",
        label: "Select all child tasks",
        sublabel: `${childTasks.length} children`,
        group: "Children",
        icon: "select",
        action: () => setSelectedChildIds(new Set(childTasks.map((task) => task.id))),
      })
    }

    return cmds
  }, [
    viewState.taskId,
    selectedTask,
    selectedTaskIds,
    selectedChildIds,
    allLabels,
    childTasks,
    getLoadedTasks,
    openTask,
    closeTask,
    openComposer,
    clearStatusFilters,
    toggleStatusFilter,
    hasActiveClientFilters,
    clearClientFilters,
    copySelectedTaskReference,
    cycleTaskStatusStage,
    toggleSelectedTaskAssigneeType,
    promptCreateAndAssignLabel,
    changeTaskStatusStage,
    toggleLabel,
    isAssignedLabel,
    deleteSelectedChildren,
    deleteTasks,
    invalidateTaskQueries,
    setSelectedChildrenStatusStage,
    setSelectedTasksStatusStage,
    cycles,
    moveTaskToCycle,
  ])

  useCommands(commands)

  return (
    <div className="flex h-full w-full overflow-hidden">
      {!viewState.taskId ? (
        <div className="flex w-full flex-col overflow-hidden">
          <div className="px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                {viewState.view === "list" && (
                  <div className={`inline-flex gap-1 rounded-lg p-1 shadow-sm ${
                    isDarkTheme ? "bg-gray-800" : "bg-[#e8f0fb]"
                  }`}>
                    <Button
                      size="sm"
                      variant={viewState.statuses.length === 0 ? "primary" : "ghost"}
                      onClick={clearStatusFilters}
                    >
                      <span>All</span>
                      <span className="text-[10px] opacity-80">{allStatusCount}</span>
                    </Button>
                    {TASK_STATUS_OPTIONS.map((option) => {
                      const isActive = viewState.statuses.includes(option.value)
                      return (
                        <Button
                          key={option.value}
                          size="sm"
                          variant={isActive ? "primary" : "ghost"}
                          onClick={() => toggleStatusFilter(option.value)}
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${STATUS_COLORS[option.value]}`}
                            aria-hidden="true"
                          />
                          <span>{option.label}</span>
                          <span className="text-[10px] opacity-80">{statusCounts[option.value] ?? 0}</span>
                        </Button>
                      )
                    })}
                  </div>
                )}
                <div className={`inline-flex gap-1 rounded-lg p-1 shadow-sm ${
                  isDarkTheme ? "bg-gray-800" : "bg-[#e8f0fb]"
                }`}>
                  <Button
                    size="icon-sm"
                    variant={viewState.view === "list" ? "primary" : "ghost"}
                    aria-label="List view"
                    title="List view"
                    aria-pressed={viewState.view === "list"}
                    onClick={() => setView("list")}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
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
                    variant={viewState.view === "kanban" ? "primary" : "ghost"}
                    aria-label="Kanban view"
                    title="Kanban view"
                    aria-pressed={viewState.view === "kanban"}
                    onClick={() => setView("kanban")}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="4" width="6" height="16" rx="1" />
                      <rect x="10.5" y="4" width="10.5" height="7" rx="1" />
                      <rect x="10.5" y="13" width="10.5" height="7" rx="1" />
                    </svg>
                  </Button>
                </div>
                <div className="relative">
                  <Button
                    ref={filterButtonRef}
                    size="sm"
                    variant={hasActiveClientFilters ? "primary" : "secondary"}
                    onClick={() => setIsFilterPanelOpen((current) => !current)}
                    aria-expanded={isFilterPanelOpen}
                    aria-controls="task-filter-popover"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="14"
                      height="14"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                    </svg>
                    <span>Filter</span>
                    {activeClientFilterCount > 0 && (
                      <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        {activeClientFilterCount}
                      </span>
                    )}
                  </Button>

                  {isFilterPanelOpen && (
                    <div
                      id="task-filter-popover"
                      role="dialog"
                      aria-label="Task filters"
                      ref={filterPanelRef}
                      className={`absolute left-0 top-full z-50 mt-2 w-[380px] rounded-xl border p-3 shadow-2xl ${
                        isDarkTheme
                          ? "border-gray-700 bg-gray-900 text-gray-100"
                          : "border-[#d4e0ef] bg-[#f8fbff] text-[#0f172a]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <h3 className={`text-xs font-semibold uppercase tracking-wide ${isDarkTheme ? "text-gray-300" : "text-[#64748b]"}`}>
                          Filters
                        </h3>
                        <span className={`text-[11px] ${isDarkTheme ? "text-gray-400" : "text-[#64748b]"}`}>
                          {activeClientFilterCount} active
                        </span>
                      </div>
                      <div className="mt-3 space-y-3">
                        <div>
                          <label className={`mb-1 block text-[11px] font-medium uppercase tracking-wide ${isDarkTheme ? "text-gray-500" : "text-[#64748b]"}`}>
                            Assignment
                          </label>
                          <Select<AssigneeFilterOption, false>
                            instanceId="tasks-filter-assignee"
                            value={selectedAssigneeFilterOption}
                            options={ASSIGNEE_FILTER_OPTIONS as AssigneeFilterOption[]}
                            isSearchable={false}
                            isClearable={false}
                            styles={taskFilterSelectStyles as unknown as StylesConfig<AssigneeFilterOption, false>}
                            menuPortalTarget={selectMenuPortalTarget}
                            onChange={(next: SingleValue<AssigneeFilterOption>) => {
                              if (!next) return
                              setAssigneeTypeFilter(next.value)
                            }}
                          />
                        </div>
                        <div>
                          <label className={`mb-1 block text-[11px] font-medium uppercase tracking-wide ${isDarkTheme ? "text-gray-500" : "text-[#64748b]"}`}>
                            Labels
                          </label>
                          <Select<LabelFilterOption, true>
                            instanceId="tasks-filter-labels"
                            value={selectedLabelFilterOptions}
                            options={labelFilterOptions}
                            isMulti
                            closeMenuOnSelect={false}
                            hideSelectedOptions={false}
                            placeholder="Filter by labels..."
                            noOptionsMessage={() => allLabels.length === 0 ? "No labels yet" : "No labels match"}
                            styles={taskFilterSelectStyles as unknown as StylesConfig<LabelFilterOption, true>}
                            menuPortalTarget={selectMenuPortalTarget}
                            formatOptionLabel={(option) => (
                              <span className="inline-flex items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: option.color }}
                                  aria-hidden="true"
                                />
                                <span>{option.label}</span>
                              </span>
                            )}
                            onChange={(next: MultiValue<LabelFilterOption>) => {
                              setLabelFilters(next.map((option) => option.value))
                            }}
                          />
                        </div>
                      </div>
                      <div className="mt-4 flex items-center justify-between">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!hasActiveClientFilters}
                          onClick={clearClientFilters}
                        >
                          Clear Filters
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => setIsFilterPanelOpen(false)}
                        >
                          Done
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => openComposer({
                  heading: "New task",
                  submitLabel: "Create task",
                  parentId: null,
                })}
              >
                New Task
              </Button>
            </div>
            <div className="mt-3">
              <SearchInput
                value={viewState.search}
                onChange={setSearch}
                placeholder="Search tasks..."
                themeMode={themeMode}
              />
            </div>
          </div>
          <div className={`flex-1 px-3 pb-3 ${
            viewState.view === "kanban"
              ? "min-h-0 overflow-hidden"
              : "overflow-y-auto"
          }`}>
            {viewState.view === "kanban" ? (
              <KanbanBoard
                onSelectTask={openTask}
                search={viewState.search}
                clientFilters={clientFilters}
              />
            ) : (
              <TaskList
                filters={filters}
                clientFilters={clientFilters}
                onSelectTask={openTask}
                selectedIds={selectedTaskIds}
                onToggleSelect={selectionActions.toggleTask}
                onEscape={selectionActions.clearTasks}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="flex w-full flex-col overflow-hidden">
          <div className="px-3 py-2">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={closeTask}
              >
                ← Back to Tasks
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto pr-3 pb-3 pl-4">
            <TaskDetail
              taskId={viewState.taskId}
              onNavigateToTask={openTask}
              onNavigateToList={closeTaskToList}
              themeMode={themeMode}
              onCreateChild={() => openComposer({
                heading: "New sub-task",
                submitLabel: "Create sub-task",
                parentId: viewState.taskId,
              })}
              onCopyTaskReference={() => { void copySelectedTaskReference() }}
              allLabels={allLabels}
              isLabelAssigned={isAssignedLabel}
              onToggleLabel={(label) => { void toggleLabel(label) }}
              onCreateLabel={(payload) => createAndAssignLabel(payload)}
              statusStage={selectedTask ? toHumanTaskStage(selectedTask.status) : undefined}
              onChangeStatusStage={(stage) => { void changeTaskStatusStage(stage) }}
              onUpdateAssignment={(payload) => { void updateTaskAssignment(payload) }}
              selectedChildIds={selectedChildIds}
              onToggleChildSelection={toggleChildSelection}
              onSelectAllChildren={() => setSelectedChildIds(new Set(childTasks.map((task) => task.id)))}
              onClearChildSelection={() => setSelectedChildIds(new Set())}
              onDeleteSelectedChildren={() => { void deleteSelectedChildren() }}
            />
          </div>
        </div>
      )}

      <TaskComposerModal
        open={Boolean(composer)}
        heading={composer?.heading ?? ""}
        submitLabel={composer?.submitLabel ?? "Create"}
        parentId={composer?.parentId ?? null}
        defaultAssigneeType={defaultTaskAssigmentType}
        availableLabels={allLabels}
        onClose={closeComposer}
        onSubmit={createTaskFromComposer}
        onCreateLabel={createLabel}
      />
    </div>
  )
}
