import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { TaskAssigneeType, TaskLabel } from "../../api/client"
import { useOverlayCommands, useShortcutScope, type Command } from "../command-palette/CommandContext"
import {
  HUMAN_STAGE_OPTIONS,
  type HumanTaskStage,
  TaskAssigneeTypeSelect,
  TaskLabelsSelect,
  TaskStatusSelect,
} from "./TaskPropertySelects"

export type { HumanTaskStage } from "./TaskPropertySelects"

export interface TaskComposerModalSubmit {
  title: string
  description?: string
  stage: HumanTaskStage
  parentId: string | null
  assigneeType: TaskAssigneeType
  assigneeId: string | null
  labelIds: number[]
  createMore: boolean
}

interface TaskComposerModalProps {
  open: boolean
  heading: string
  submitLabel: string
  parentId?: string | null
  defaultAssigneeType?: TaskAssigneeType
  availableLabels: TaskLabel[]
  onClose: () => void
  onSubmit: (payload: TaskComposerModalSubmit) => Promise<void> | void
  onCreateLabel?: (payload: { name: string; color?: string }) => Promise<TaskLabel | null> | TaskLabel | null
}

export function TaskComposerModal({
  open,
  heading,
  submitLabel,
  parentId = null,
  defaultAssigneeType = "human",
  availableLabels,
  onClose,
  onSubmit,
  onCreateLabel,
}: TaskComposerModalProps) {
  useShortcutScope("modal", open)
  const modalTheme = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark"
    ? "dark"
    : "light"
  const isDarkTheme = modalTheme === "dark"

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [selectedStage, setSelectedStage] = useState<HumanTaskStage>("backlog")
  const [selectedAssigneeType, setSelectedAssigneeType] = useState<TaskAssigneeType>(defaultAssigneeType)
  const [assigneeId, setAssigneeId] = useState("")
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<number>>(new Set())
  const [commandCreatedLabels, setCommandCreatedLabels] = useState<TaskLabel[]>([])
  const [createMore, setCreateMore] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCreatingCommandLabel, setIsCreatingCommandLabel] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const titleValueRef = useRef("")
  const descriptionValueRef = useRef("")
  const selectedStageRef = useRef<HumanTaskStage>("backlog")
  const selectedAssigneeTypeRef = useRef<TaskAssigneeType>(defaultAssigneeType)
  const assigneeIdRef = useRef("")
  const selectedLabelIdsRef = useRef<Set<number>>(new Set())
  const createMoreRef = useRef(false)
  const isSubmittingRef = useRef(false)
  const pendingCommandLabelCreateRef = useRef<Promise<void> | null>(null)

  const mergedAvailableLabels = useMemo(() => {
    const byId = new Map<number, TaskLabel>()
    for (const label of availableLabels) {
      byId.set(label.id, label)
    }
    for (const label of commandCreatedLabels) {
      if (!byId.has(label.id)) {
        byId.set(label.id, label)
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [availableLabels, commandCreatedLabels])

  const autosizeDescription = useCallback(() => {
    const input = descriptionRef.current
    if (!input) return
    input.style.height = "0px"
    input.style.height = `${input.scrollHeight}px`
  }, [])

  const resetFields = useCallback((keepSelections: boolean) => {
    setTitle("")
    setDescription("")
    setErrorMessage(null)
    setIsSubmitting(false)
    setIsCreatingCommandLabel(false)
    pendingCommandLabelCreateRef.current = null

    if (!keepSelections) {
      selectedStageRef.current = "backlog"
      selectedAssigneeTypeRef.current = defaultAssigneeType
      assigneeIdRef.current = ""
      selectedLabelIdsRef.current = new Set()
      createMoreRef.current = false
      setSelectedStage("backlog")
      setSelectedAssigneeType(defaultAssigneeType)
      setAssigneeId("")
      setSelectedLabelIds(new Set())
      setCommandCreatedLabels([])
      setCreateMore(false)
    }
  }, [defaultAssigneeType])

  useEffect(() => {
    if (!open) return
    resetFields(false)
    setTimeout(() => titleRef.current?.focus(), 0)
  }, [open, resetFields])

  useEffect(() => {
    if (!open) return
    autosizeDescription()
  }, [open, description, autosizeDescription])

  const handleLabelSelectionChange = useCallback((labelIds: number[]) => {
    const next = new Set(labelIds)
    selectedLabelIdsRef.current = next
    setSelectedLabelIds(next)
  }, [])

  const handleStageChange = useCallback((stage: HumanTaskStage) => {
    selectedStageRef.current = stage
    setSelectedStage(stage)
  }, [])

  const handleAssigneeTypeChange = useCallback((assigneeType: TaskAssigneeType) => {
    selectedAssigneeTypeRef.current = assigneeType
    setSelectedAssigneeType(assigneeType)
  }, [])

  const toggleAssigneeType = useCallback(() => {
    const nextType: TaskAssigneeType = selectedAssigneeTypeRef.current === "human" ? "agent" : "human"
    selectedAssigneeTypeRef.current = nextType
    setSelectedAssigneeType(nextType)
  }, [])

  useEffect(() => {
    titleValueRef.current = title
  }, [title])

  useEffect(() => {
    descriptionValueRef.current = description
  }, [description])

  useEffect(() => {
    selectedStageRef.current = selectedStage
  }, [selectedStage])

  useEffect(() => {
    selectedAssigneeTypeRef.current = selectedAssigneeType
  }, [selectedAssigneeType])

  useEffect(() => {
    assigneeIdRef.current = assigneeId
  }, [assigneeId])

  useEffect(() => {
    selectedLabelIdsRef.current = selectedLabelIds
  }, [selectedLabelIds])

  useEffect(() => {
    createMoreRef.current = createMore
  }, [createMore])

  useEffect(() => {
    isSubmittingRef.current = isSubmitting
  }, [isSubmitting])

  const submitComposer = useCallback(async () => {
    if (pendingCommandLabelCreateRef.current) {
      try {
        await pendingCommandLabelCreateRef.current
      } catch {
        // Error is already surfaced in the create-label flow.
      }
    }

    const nextTitle = titleValueRef.current.trim()
    if (!nextTitle || isSubmittingRef.current) return

    isSubmittingRef.current = true
    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      await onSubmit({
        title: nextTitle,
        description: descriptionValueRef.current.trim() || undefined,
        stage: selectedStageRef.current,
        parentId,
        assigneeType: selectedAssigneeTypeRef.current,
        assigneeId: assigneeIdRef.current.trim() || null,
        labelIds: Array.from(selectedLabelIdsRef.current),
        createMore: createMoreRef.current,
      })

      if (createMoreRef.current) {
        resetFields(true)
        setTimeout(() => titleRef.current?.focus(), 0)
        return
      }

      onClose()
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create task")
    } finally {
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }, [
    onSubmit,
    parentId,
    resetFields,
    onClose,
  ])

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target
      const isTextField = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        if (isTextField && (target === titleRef.current || target === descriptionRef.current)) {
          // Ensure editing text fields in the composer use native select-all behavior.
          event.preventDefault()
          event.stopPropagation()
          target.select()
          return
        }

        if (!isTextField) {
          event.preventDefault()
          event.stopPropagation()
          titleRef.current?.focus()
          titleRef.current?.select()
          return
        }
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault()
        event.stopPropagation()
        void submitComposer()
        return
      }

      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }

    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose, submitComposer])

  const overlayCommands = useMemo((): Command[] => {
    if (!open) return []

    const commands: Command[] = [
      {
        id: "composer:submit",
        label: submitLabel,
        group: "Composer",
        icon: "action",
        action: () => void submitComposer(),
      },
      {
        id: "composer:close",
        label: "Close composer",
        group: "Composer",
        icon: "nav",
        action: onClose,
      },
      {
        id: "composer:focus-title",
        label: "Focus title",
        group: "Composer",
        icon: "action",
        action: () => {
          titleRef.current?.focus()
          titleRef.current?.select()
        },
      },
      {
        id: "composer:focus-description",
        label: "Focus description",
        group: "Composer",
        icon: "action",
        action: () => {
          descriptionRef.current?.focus()
          descriptionRef.current?.select()
        },
      },
      {
        id: "composer:assignment-toggle",
        label: `Toggle assignment (${selectedAssigneeType === "human" ? "Human → Agent" : "Agent → Human"})`,
        group: "Composer",
        icon: "action",
        shortcut: "⌘K",
        action: toggleAssigneeType,
      },
      {
        id: "composer:select-all-labels",
        label: "Select all labels",
        group: "Composer",
        icon: "select",
        action: () => {
          const next = new Set(mergedAvailableLabels.map((label) => label.id))
          selectedLabelIdsRef.current = next
          setSelectedLabelIds(next)
        },
      },
      {
        id: "composer:toggle-create-more",
        label: `${createMore ? "Disable" : "Enable"} create more`,
        group: "Composer",
        icon: "action",
        action: () => setCreateMore((prev) => !prev),
      },
      {
        id: "composer:clear-labels",
        label: "Clear selected labels",
        sublabel: `${selectedLabelIds.size} selected`,
        group: "Composer",
        icon: "action",
        action: () => {
          const next = new Set<number>()
          selectedLabelIdsRef.current = next
          setSelectedLabelIds(next)
        },
      },
      {
        id: "composer:create-label",
        label: "Create new label",
        group: "Composer",
        icon: "action",
        action: async () => {
          if (!onCreateLabel) return
          const name = window.prompt("Label name:")?.trim()
          if (!name) return
          const createPromise = (async () => {
            setIsCreatingCommandLabel(true)
            try {
              const created = await onCreateLabel({ name })
              if (!created) return
              setCommandCreatedLabels((prev) => (
                prev.some((label) => label.id === created.id) ? prev : [...prev, created]
              ))
              setSelectedLabelIds((prev) => {
                const next = new Set(prev)
                next.add(created.id)
                selectedLabelIdsRef.current = next
                return next
              })
            } catch (error) {
              setErrorMessage(error instanceof Error ? error.message : "Failed to create label")
            } finally {
              setIsCreatingCommandLabel(false)
            }
          })()

          pendingCommandLabelCreateRef.current = createPromise
          try {
            await createPromise
          } finally {
            if (pendingCommandLabelCreateRef.current === createPromise) {
              pendingCommandLabelCreateRef.current = null
            }
          }
        },
      },
    ]

    for (const stage of HUMAN_STAGE_OPTIONS) {
      commands.push({
        id: `composer:status:${stage.value}`,
        label: `Set status: ${stage.label}`,
        group: "Composer",
        icon: "action",
        action: () => handleStageChange(stage.value),
      })
    }

    for (const label of mergedAvailableLabels) {
      const selected = selectedLabelIds.has(label.id)
      commands.push({
        id: `composer:label:${label.id}`,
        label: `${selected ? "Remove" : "Add"} label: ${label.name}`,
        group: "Composer",
        icon: "action",
        action: () => {
          setSelectedLabelIds((prev) => {
            const next = new Set(prev)
            if (next.has(label.id)) next.delete(label.id)
            else next.add(label.id)
            selectedLabelIdsRef.current = next
            return next
          })
        },
      })
    }

    return commands
  }, [
    open,
    submitLabel,
    submitComposer,
    onClose,
    createMore,
    selectedAssigneeType,
    selectedLabelIds,
    onCreateLabel,
    mergedAvailableLabels,
    handleStageChange,
    toggleAssigneeType,
    isCreatingCommandLabel,
  ])

  useOverlayCommands(overlayCommands)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        className={`absolute inset-0 animate-fade-in ${isDarkTheme ? "bg-black/60" : "bg-black/35"}`}
        onClick={onClose}
        aria-label="Close task composer"
      />
      <div
        data-theme={modalTheme}
        className={`relative w-full max-w-3xl rounded-xl border shadow-2xl animate-slide-in-up ${
          isDarkTheme
            ? "border-gray-700 bg-gray-900 text-gray-100"
            : "border-0 bg-white text-black"
        }`}
      >
        <div className={`flex items-center justify-between border-b px-4 py-3 ${
          isDarkTheme ? "border-gray-700" : "border-zinc-200"
        }`}>
          <div className="flex items-center gap-2">
            <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
              isDarkTheme
                ? "border-gray-600 bg-gray-800 text-gray-300"
                : "border-zinc-300 bg-zinc-100 text-zinc-700"
            }`}>
              TX
            </span>
            <span className={`text-xs font-medium ${isDarkTheme ? "text-gray-400" : "text-zinc-600"}`}>
              {heading}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`rounded-md border px-2 py-0.5 text-xs transition ${
              isDarkTheme
                ? "border-gray-600 bg-gray-800 text-gray-300 hover:bg-gray-700"
                : "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100"
            }`}
            aria-label="Close"
          >
            Esc
          </button>
        </div>

        <form
          className="space-y-4 p-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submitComposer()
          }}
        >
          <div className="space-y-1.5">
            <input
              ref={titleRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Task title"
              className={`w-full border-none bg-transparent px-1 py-2 text-3xl font-semibold outline-none ${
                isDarkTheme ? "text-gray-100 placeholder:text-gray-500" : "text-black placeholder:text-zinc-400"
              }`}
            />
          </div>

          <div className="space-y-1.5">
            <textarea
              ref={descriptionRef}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value)
                autosizeDescription()
              }}
              placeholder="Describe the task (optional)..."
              rows={1}
              className={`w-full resize-none overflow-hidden border-none bg-transparent px-1 text-base outline-none ${
                isDarkTheme ? "text-gray-300 placeholder:text-gray-500" : "text-black placeholder:text-zinc-500"
              }`}
            />
          </div>

          <div className={`grid gap-3 border-t pt-3 md:grid-cols-2 ${
            isDarkTheme ? "border-gray-700" : "border-zinc-200"
          }`}>
            <div>
              <p className={`mb-1 text-[11px] font-medium uppercase tracking-wide ${
                isDarkTheme ? "text-gray-400" : "text-zinc-600"
              }`}>
                Status
              </p>
              <TaskStatusSelect
                instanceId="task-composer-status"
                value={selectedStage}
                onChange={handleStageChange}
                theme={modalTheme}
              />
            </div>

            <div>
              <p className={`mb-1 text-[11px] font-medium uppercase tracking-wide ${
                isDarkTheme ? "text-gray-400" : "text-zinc-600"
              }`}>
                Assignment Type
              </p>
              <TaskAssigneeTypeSelect
                instanceId="task-composer-assignee-type"
                value={selectedAssigneeType}
                onChange={handleAssigneeTypeChange}
                theme={modalTheme}
              />
            </div>

            <div>
              <p className={`mb-1 text-[11px] font-medium uppercase tracking-wide ${
                isDarkTheme ? "text-gray-400" : "text-zinc-600"
              }`}>
                Assignee ID
              </p>
              <input
                value={assigneeId}
                onChange={(event) => {
                  assigneeIdRef.current = event.target.value
                  setAssigneeId(event.target.value)
                }}
                placeholder="Optional assignee ID"
                className={`w-full rounded-md border px-2.5 py-2 text-sm outline-none transition ${
                  isDarkTheme
                    ? "border-gray-600 bg-gray-800 text-gray-200 placeholder:text-gray-500 focus:border-indigo-400"
                    : "border-zinc-300 bg-white text-zinc-900 placeholder:text-zinc-500 focus:border-indigo-500"
                }`}
              />
            </div>

            <div>
              <p className={`mb-1 text-[11px] font-medium uppercase tracking-wide ${
                isDarkTheme ? "text-gray-400" : "text-zinc-600"
              }`}>
                Labels
              </p>
              <TaskLabelsSelect
                instanceId="task-composer-labels"
                labels={mergedAvailableLabels}
                selectedLabelIds={selectedLabelIds}
                onChange={handleLabelSelectionChange}
                onCreateLabel={onCreateLabel}
                theme={modalTheme}
                noOptionsMessage="No labels yet."
              />
            </div>
          </div>

          {errorMessage && (
            <div className="rounded-md border border-red-300 bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
              {errorMessage}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <label className={`inline-flex items-center gap-2 text-xs ${
              isDarkTheme ? "text-gray-400" : "text-zinc-700"
            }`}>
              <input
                type="checkbox"
                checked={createMore}
                onChange={(event) => setCreateMore(event.target.checked)}
                className={`rounded text-indigo-600 focus:ring-indigo-500 ${
                  isDarkTheme ? "border-gray-600 bg-gray-800" : "border-zinc-300 bg-white"
                }`}
              />
              Create more
            </label>
            <button
              type="submit"
              disabled={!title.trim() || isSubmitting || isCreatingCommandLabel}
              className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 ${
                isDarkTheme ? "bg-indigo-500 hover:bg-indigo-400" : "bg-indigo-600 hover:bg-indigo-500"
              }`}
            >
              {isSubmitting ? "Creating..." : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
