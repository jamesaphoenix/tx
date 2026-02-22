import type { TaskAssigneeType, TaskWithDeps } from "../../api/client"

export type TaskAssigneeFilterValue = TaskAssigneeType | "unassigned" | "all"

export interface TaskClientFilters {
  assigneeType: TaskAssigneeFilterValue
  labelIds: number[]
}

export const DEFAULT_TASK_CLIENT_FILTERS: TaskClientFilters = {
  assigneeType: "all",
  labelIds: [],
}

export function normalizeTaskClientFilters(filters?: Partial<TaskClientFilters>): TaskClientFilters {
  const assigneeType = filters?.assigneeType
  const normalizedAssigneeType: TaskAssigneeFilterValue =
    assigneeType === "human" || assigneeType === "agent" || assigneeType === "unassigned"
      ? assigneeType
      : "all"

  const labelIds = Array.isArray(filters?.labelIds)
    ? Array.from(new Set(filters.labelIds.filter((id): id is number => Number.isInteger(id) && id > 0)))
    : []

  return {
    assigneeType: normalizedAssigneeType,
    labelIds,
  }
}

export function hasActiveTaskClientFilters(filters?: Partial<TaskClientFilters>): boolean {
  const normalized = normalizeTaskClientFilters(filters)
  return normalized.assigneeType !== "all" || normalized.labelIds.length > 0
}

export function buildTaskClientFilterPredicate(filters?: Partial<TaskClientFilters>): (task: TaskWithDeps) => boolean {
  const normalized = normalizeTaskClientFilters(filters)
  const selectedLabelIds = new Set(normalized.labelIds)
  const hasLabelFilter = selectedLabelIds.size > 0

  return (task: TaskWithDeps) => {
    const assigneeMatches = normalized.assigneeType === "all"
      ? true
      : normalized.assigneeType === "unassigned"
        ? task.assigneeType === null
        : task.assigneeType === normalized.assigneeType

    if (!assigneeMatches) {
      return false
    }

    if (!hasLabelFilter) {
      return true
    }

    const taskLabelIds = task.labels?.map((label) => label.id) ?? []
    return taskLabelIds.some((labelId) => selectedLabelIds.has(labelId))
  }
}
