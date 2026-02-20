import { useEffect, useMemo, useState } from "react"
import Select, { type MultiValue, type SingleValue, type StylesConfig } from "react-select"
import CreatableSelect from "react-select/creatable"
import type { TaskLabel } from "../../api/client"

export type HumanTaskStage = "backlog" | "in_progress" | "done"

type SelectTheme = "light" | "dark"

interface StageOption {
  value: HumanTaskStage
  label: string
}

interface AssigneeOption {
  value: "human" | "agent"
  label: string
}

interface LabelOption {
  value: number
  label: string
  color: string
}

const HUMAN_STAGE_OPTIONS_INTERNAL: readonly StageOption[] = [
  { value: "backlog", label: "Backlog" },
  { value: "in_progress", label: "In Progress" },
  { value: "done", label: "Done" },
]

const ASSIGNEE_OPTIONS_INTERNAL: readonly AssigneeOption[] = [
  { value: "human", label: "Human" },
  { value: "agent", label: "Agent" },
]

const AUTO_LABEL_COLORS = [
  "#2563eb",
  "#0ea5e9",
  "#14b8a6",
  "#16a34a",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
] as const

const LEGACY_LABEL_NAME_ALIASES: Record<string, string> = {
  devofps: "DevOps",
}

const LIGHT_THEME = {
  controlBg: "#ffffff",
  border: "#d4d4d8",
  borderFocus: "#71717a",
  menuBg: "#ffffff",
  menuBorder: "#d4d4d8",
  menuShadow: "0 12px 32px rgba(0, 0, 0, 0.14)",
  optionBg: "#ffffff",
  optionHoverBg: "#f4f4f5",
  text: "#000000",
  secondaryText: "#111827",
  mutedText: "#4b5563",
  chipBg: "#f4f4f5",
  chipRemoveHoverBg: "#e4e4e7",
}

const DARK_THEME = {
  controlBg: "#111827",
  border: "#374151",
  borderFocus: "#6b7280",
  menuBg: "#111827",
  menuBorder: "#374151",
  menuShadow: "0 12px 32px rgba(0, 0, 0, 0.35)",
  optionBg: "#111827",
  optionHoverBg: "#1f2937",
  text: "#f3f4f6",
  secondaryText: "#9ca3af",
  mutedText: "#9ca3af",
  chipBg: "#1f2937",
  chipRemoveHoverBg: "#374151",
}

export const HUMAN_STAGE_OPTIONS = HUMAN_STAGE_OPTIONS_INTERNAL

export const HUMAN_STAGE_TO_STATUS: Record<HumanTaskStage, "backlog" | "active" | "done"> = {
  backlog: "backlog",
  in_progress: "active",
  done: "done",
}

export function toHumanTaskStage(status: string): HumanTaskStage {
  if (status === "done") return "done"
  if (status === "backlog") return "backlog"
  return "in_progress"
}

function hashLabelName(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash) + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export function autoTaskLabelColor(name: string): string {
  return AUTO_LABEL_COLORS[hashLabelName(name) % AUTO_LABEL_COLORS.length]!
}

export function canonicalTaskLabelName(name: string): string {
  const normalized = name.trim().replace(/\s+/g, " ")
  return LEGACY_LABEL_NAME_ALIASES[normalized.toLowerCase()] ?? normalized
}

function buildSelectStyles(theme: SelectTheme): StylesConfig<StageOption | AssigneeOption | LabelOption, boolean> {
  const palette = theme === "dark" ? DARK_THEME : LIGHT_THEME

  return {
    control: (base, state) => ({
      ...base,
      minHeight: 36,
      borderColor: state.isFocused ? palette.borderFocus : palette.border,
      boxShadow: "none",
      backgroundColor: palette.controlBg,
      "&:hover": {
        borderColor: palette.borderFocus,
      },
    }),
    menu: (base) => ({
      ...base,
      zIndex: 70,
      backgroundColor: palette.menuBg,
      border: `1px solid ${palette.menuBorder}`,
      boxShadow: palette.menuShadow,
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isFocused ? palette.optionHoverBg : palette.optionBg,
      color: palette.text,
      cursor: "pointer",
    }),
    multiValue: (base) => ({
      ...base,
      backgroundColor: palette.chipBg,
    }),
    multiValueLabel: (base) => ({
      ...base,
      color: palette.text,
      fontSize: 12,
    }),
    multiValueRemove: (base) => ({
      ...base,
      color: palette.secondaryText,
      ":hover": {
        backgroundColor: palette.chipRemoveHoverBg,
        color: palette.text,
      },
    }),
    placeholder: (base) => ({
      ...base,
      color: palette.mutedText,
      fontSize: 12,
    }),
    valueContainer: (base) => ({
      ...base,
      gap: 4,
      paddingTop: 3,
      paddingBottom: 3,
    }),
    input: (base) => ({
      ...base,
      color: palette.text,
    }),
    singleValue: (base) => ({
      ...base,
      color: palette.text,
    }),
  }
}

export interface TaskStatusSelectProps {
  instanceId: string
  value: HumanTaskStage
  onChange: (stage: HumanTaskStage) => void
  theme?: SelectTheme
  placeholder?: string
}

export function TaskStatusSelect({
  instanceId,
  value,
  onChange,
  theme = "light",
  placeholder = "Select one...",
}: TaskStatusSelectProps) {
  const selectedOption =
    HUMAN_STAGE_OPTIONS_INTERNAL.find((option) => option.value === value) ?? HUMAN_STAGE_OPTIONS_INTERNAL[0]

  return (
    <Select<StageOption, false>
      instanceId={instanceId}
      options={HUMAN_STAGE_OPTIONS_INTERNAL as StageOption[]}
      value={selectedOption}
      isClearable={false}
      isSearchable={false}
      styles={buildSelectStyles(theme) as unknown as StylesConfig<StageOption, false>}
      onChange={(next: SingleValue<StageOption>) => {
        if (!next) return
        onChange(next.value)
      }}
      placeholder={placeholder}
    />
  )
}

export interface TaskLabelsSelectProps {
  instanceId: string
  labels: TaskLabel[]
  selectedLabelIds: readonly number[] | Set<number>
  onChange: (labelIds: number[]) => void
  onCreateLabel?: (payload: { name: string; color?: string }) => Promise<TaskLabel | null> | TaskLabel | null
  theme?: SelectTheme
  disabled?: boolean
  placeholder?: string
  noOptionsMessage?: string
}

export interface TaskAssigneeTypeSelectProps {
  instanceId: string
  value: "human" | "agent"
  onChange: (assigneeType: "human" | "agent") => void
  theme?: SelectTheme
}

export function TaskAssigneeTypeSelect({
  instanceId,
  value,
  onChange,
  theme = "light",
}: TaskAssigneeTypeSelectProps) {
  const selectedOption =
    ASSIGNEE_OPTIONS_INTERNAL.find((option) => option.value === value) ?? ASSIGNEE_OPTIONS_INTERNAL[0]

  return (
    <Select<AssigneeOption, false>
      instanceId={instanceId}
      options={ASSIGNEE_OPTIONS_INTERNAL as AssigneeOption[]}
      value={selectedOption}
      isClearable={false}
      isSearchable={false}
      styles={buildSelectStyles(theme) as unknown as StylesConfig<AssigneeOption, false>}
      onChange={(next: SingleValue<AssigneeOption>) => {
        if (!next) return
        onChange(next.value)
      }}
      placeholder="Select assignee type..."
    />
  )
}

export function TaskLabelsSelect({
  instanceId,
  labels,
  selectedLabelIds,
  onChange,
  onCreateLabel,
  theme = "light",
  disabled = false,
  placeholder = "Select labels or create new...",
  noOptionsMessage = "No labels yet.",
}: TaskLabelsSelectProps) {
  const [ephemeralLabels, setEphemeralLabels] = useState<TaskLabel[]>([])
  const [isCreatingLabel, setIsCreatingLabel] = useState(false)
  const [createLabelError, setCreateLabelError] = useState<string | null>(null)

  const selectedIdSet = useMemo(
    () => (selectedLabelIds instanceof Set ? selectedLabelIds : new Set(selectedLabelIds)),
    [selectedLabelIds]
  )

  const mergedLabels = useMemo(() => {
    const byId = new Map<number, TaskLabel>()
    for (const label of labels) {
      byId.set(label.id, label)
    }
    for (const label of ephemeralLabels) {
      if (!byId.has(label.id)) {
        byId.set(label.id, label)
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [labels, ephemeralLabels])

  useEffect(() => {
    if (createLabelError && labels.length > 0) {
      setCreateLabelError(null)
    }
  }, [labels, createLabelError])

  const labelOptions = useMemo(
    () => mergedLabels.map((label) => ({
      value: label.id,
      label: canonicalTaskLabelName(label.name),
      color: label.color,
    } satisfies LabelOption)),
    [mergedLabels]
  )

  const selectedOptions = useMemo(
    () => labelOptions.filter((option) => selectedIdSet.has(option.value)),
    [labelOptions, selectedIdSet]
  )

  const handleCreateOption = async (rawName: string) => {
    if (!onCreateLabel || isCreatingLabel) return

    const normalizedName = rawName.trim()
    if (!normalizedName) return

    setIsCreatingLabel(true)
    setCreateLabelError(null)

    try {
      const created = await onCreateLabel({ name: normalizedName })
      if (!created) return

      setEphemeralLabels((prev) => {
        if (prev.some((label) => label.id === created.id)) return prev
        return [...prev, created]
      })

      const next = new Set(selectedIdSet)
      next.add(created.id)
      onChange(Array.from(next))
    } catch (error) {
      setCreateLabelError(error instanceof Error ? error.message : "Failed to create label")
    } finally {
      setIsCreatingLabel(false)
    }
  }

  return (
    <div>
      <CreatableSelect<LabelOption, true>
        instanceId={instanceId}
        isMulti
        closeMenuOnSelect={false}
        isClearable={false}
        isDisabled={disabled || isCreatingLabel}
        options={labelOptions}
        value={selectedOptions}
        styles={buildSelectStyles(theme) as StylesConfig<LabelOption, true>}
        onChange={(next: MultiValue<LabelOption>) => {
          onChange(next.map((option) => option.value))
        }}
        onCreateOption={(inputValue) => {
          void handleCreateOption(inputValue)
        }}
        formatCreateLabel={(inputValue) => `Create label "${inputValue}"`}
        noOptionsMessage={() => noOptionsMessage}
        placeholder={placeholder}
        formatOptionLabel={(option) => (
          <span className="inline-flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: option.color }}
            />
            <span>{option.label}</span>
          </span>
        )}
      />

      {isCreatingLabel && (
        <p className={`mt-2 text-[11px] ${theme === "dark" ? "text-gray-500" : "text-zinc-500"}`}>
          Creating label...
        </p>
      )}
      {createLabelError && (
        <p className={`mt-2 text-[11px] ${theme === "dark" ? "text-red-300" : "text-red-600"}`}>
          {createLabelError}
        </p>
      )}
    </div>
  )
}
