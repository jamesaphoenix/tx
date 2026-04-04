import type { Command } from "./CommandContext"
import { HUMAN_STAGE_OPTIONS } from "../tasks/TaskPropertySelects"
import type { TaskLabel, Cycle } from "../../api/client"

/**
 * Context for building standardized "Set <field>" task commands.
 * Supports both single-task (detail view) and multi-task (selection) modes.
 */
export interface TaskCommandContext {
  /** Namespace prefix for command IDs, e.g. "tasks" or "cycle" */
  namespace: string
  /** The single task being acted on (detail view). When null, single-task commands are omitted. */
  task: { id: string; labels?: TaskLabel[]; score?: number } | null
  /** Available labels to toggle */
  labels: TaskLabel[]
  /** Available cycles to move the task into */
  cycles: Cycle[]
  /** Callbacks for single-task operations — all pre-bound by the caller */
  onSetStatus: (status: string) => void
  onToggleLabel: (label: TaskLabel) => void
  onSetScore: () => void
  onMoveToCycle: (cycleId: string) => void
}

/**
 * Context for building bulk selection commands (list view with selected tasks).
 */
export interface SelectionCommandContext {
  /** Namespace prefix for command IDs */
  namespace: string
  /** IDs of currently selected tasks */
  selectedIds: string[]
  /** Available labels for bulk assignment */
  labels?: TaskLabel[]
  /** Available cycles to move selected tasks into */
  cycles: Cycle[]
  /** Callbacks for bulk operations */
  onBulkSetStatus: (status: string) => void
  onBulkToggleLabel?: (label: TaskLabel) => void
  onBulkMoveToCycle: (cycleId: string) => void
}

/**
 * Build standardized hierarchical "Set <field>" commands for a single task.
 * Returns commands for: Set status, Set label, Set score, Move to cycle.
 * Pure function — no React, no side effects.
 */
export function buildTaskCommands(ctx: TaskCommandContext): Command[] {
  if (!ctx.task) return []

  const { namespace, task, labels, cycles } = ctx
  const cmds: Command[] = []

  // Set status
  cmds.push({
    id: `${namespace}:set-status`,
    label: "Set status",
    group: "Actions",
    icon: "action",
    action: () => {},
    children: HUMAN_STAGE_OPTIONS.map((stage) => ({
      id: `${namespace}:set-status:${stage.value}`,
      label: stage.label,
      group: "Statuses",
      icon: "action" as const,
      action: () => ctx.onSetStatus(stage.value),
    })),
  })

  // Set label
  if (labels.length > 0) {
    const taskLabels = task.labels ?? []
    cmds.push({
      id: `${namespace}:set-label`,
      label: "Set label",
      sublabel: `${labels.length} available`,
      group: "Actions",
      icon: "action",
      action: () => {},
      children: labels.map((label) => {
        const assigned = taskLabels.some((l) => l.id === label.id)
        return {
          id: `${namespace}:label:${label.id}`,
          label: `${assigned ? "Remove" : "Add"}: ${label.name}`,
          group: "Labels",
          icon: "action" as const,
          action: () => ctx.onToggleLabel(label),
        }
      }),
    })
  }

  // Set score
  cmds.push({
    id: `${namespace}:set-score`,
    label: "Set score",
    group: "Actions",
    icon: "action",
    action: ctx.onSetScore,
  })

  // Move to cycle
  if (cycles.length > 0) {
    cmds.push({
      id: `${namespace}:move-to-cycle`,
      label: "Move to cycle",
      sublabel: `${cycles.length} cycle${cycles.length === 1 ? "" : "s"} available`,
      group: "Actions",
      icon: "action",
      action: () => {},
      children: cycles.map((cycle) => ({
        id: `${namespace}:move-to-cycle:${cycle.id}`,
        label: cycle.name,
        sublabel: `${cycle.status} · ${cycle.taskCount} tasks`,
        group: "Cycles",
        icon: "nav" as const,
        action: () => ctx.onMoveToCycle(cycle.id),
      })),
    })
  }

  return cmds
}

/**
 * Build bulk "Set <field>" commands for a multi-task selection.
 * Returns: Set selected tasks to (status), Move selected to cycle.
 */
export function buildSelectionCommands(ctx: SelectionCommandContext): Command[] {
  if (ctx.selectedIds.length === 0) return []

  const { namespace, selectedIds, cycles } = ctx
  const count = selectedIds.length
  const sublabel = `${count} selected`
  const cmds: Command[] = []

  // Set status (top priority — shown first)
  cmds.push({
    id: `${namespace}:selected:set-status`,
    label: "Set status",
    sublabel,
    group: "Actions",
    icon: "action",
    action: () => {},
    children: HUMAN_STAGE_OPTIONS.map((stage) => ({
      id: `${namespace}:selected:set-status:${stage.value}`,
      label: stage.label,
      group: "Statuses",
      icon: "action" as const,
      action: () => ctx.onBulkSetStatus(stage.value),
    })),
  })

  // Set label
  const labels = ctx.labels ?? []
  if (labels.length > 0 && ctx.onBulkToggleLabel) {
    const toggleLabel = ctx.onBulkToggleLabel
    cmds.push({
      id: `${namespace}:selected:set-label`,
      label: "Set label",
      sublabel,
      group: "Actions",
      icon: "action",
      action: () => {},
      children: labels.map((label) => ({
        id: `${namespace}:selected:label:${label.id}`,
        label: `Add: ${label.name}`,
        group: "Labels",
        icon: "action" as const,
        action: () => toggleLabel(label),
      })),
    })
  }

  // Move to cycle
  if (cycles.length > 0) {
    cmds.push({
      id: `${namespace}:selected:move-to-cycle`,
      label: "Move to cycle",
      sublabel,
      group: "Actions",
      icon: "action",
      action: () => {},
      children: cycles.map((cycle) => ({
        id: `${namespace}:selected:move-to-cycle:${cycle.id}`,
        label: cycle.name,
        sublabel: `${cycle.status} · ${cycle.taskCount} tasks`,
        group: "Cycles",
        icon: "nav" as const,
        action: () => ctx.onBulkMoveToCycle(cycle.id),
      })),
    })
  }

  return cmds
}
