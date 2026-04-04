import { useCallback, useEffect, useState } from "react"
import { Button } from "../ui"
import { SearchInput } from "../ui/SearchInput"

export interface TaskFiltersValues {
  status: string[]
  search: string
}

interface StatusCounts {
  ready?: number
  active?: number
  blocked?: number
  done?: number
  backlog?: number
  planning?: number
  review?: number
  needs_review?: number
  [key: string]: number | undefined
}

interface TaskFiltersProps {
  value: TaskFiltersValues
  onChange: (value: TaskFiltersValues) => void
  statusCounts?: StatusCounts
}

// Main status buttons to show (can be expanded)
const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "ready", label: "Ready", color: "bg-blue-500" },
  { value: "active", label: "Active", color: "bg-yellow-500" },
  { value: "blocked", label: "Blocked", color: "bg-red-500" },
  { value: "done", label: "Done", color: "bg-green-500" },
] as const

function normalizeSingleStatusSelection(statuses: readonly string[]): string[] {
  const selectedStatus = statuses.at(-1)
  return selectedStatus ? [selectedStatus] : []
}

/**
 * TaskFilters component provides status toggles and search functionality.
 * - Status toggle buttons show count for each status
 * - Status selection is single-select (except "All" which clears selection)
 * - Integrates SearchInput for debounced text search
 * - Parent is responsible for syncing with URL params
 */
export function TaskFilters({ value, onChange, statusCounts = {} }: TaskFiltersProps) {
  const selectedStatuses = normalizeSingleStatusSelection(value.status)
  const selectedStatus = selectedStatuses[0] ?? null

  const handleStatusToggle = useCallback(
    (status: string) => {
      if (status === "all") {
        // "All" clears all status filters
        onChange({ ...value, status: [] })
        return
      }

      const nextStatuses = selectedStatus === status ? [] : [status]
      onChange({
        ...value,
        status: nextStatuses,
      })
    },
    [value, onChange, selectedStatus]
  )

  const handleSearchChange = useCallback(
    (search: string) => {
      onChange({ ...value, status: selectedStatuses, search })
    },
    [value, onChange, selectedStatuses]
  )

  // Calculate total count (sum of all status counts)
  const totalCount = Object.values(statusCounts).reduce<number>(
    (sum, count) => sum + (count ?? 0),
    0
  )

  // Check if "All" is selected (no specific statuses selected)
  const isAllSelected = selectedStatuses.length === 0

  return (
    <div className="space-y-3">
      {/* Status toggle buttons */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((option) => {
          const isAll = option.value === "all"
          const isSelected = isAll ? isAllSelected : selectedStatus === option.value
          const count = isAll ? totalCount : statusCounts[option.value]

          return (
            <Button
              key={option.value}
              size="sm"
              variant={isSelected ? "primary" : "secondary"}
              onClick={() => handleStatusToggle(option.value)}
              aria-pressed={isSelected}
            >
              {!isAll && option.color && (
                <span
                  className={`w-2 h-2 rounded-full ${option.color}`}
                  aria-hidden="true"
                />
              )}
              <span>{option.label}</span>
              {count !== undefined && (
                <span
                  className={`ml-1 px-1.5 py-0.5 text-[10px] rounded-full min-w-[1.25rem] text-center ${
                    isSelected ? "bg-blue-500 text-white" : "bg-gray-700 text-gray-400"
                  }`}
                >
                  {count}
                </span>
              )}
            </Button>
          )
        })}
      </div>

      {/* Search input */}
      <SearchInput
        value={value.search}
        onChange={handleSearchChange}
        placeholder="Search tasks..."
      />
    </div>
  )
}

/**
 * Hook to sync TaskFilters with URL search params.
 * Provides values and onChange handler that automatically update the URL.
 */
export function useTaskFiltersWithUrl(): {
  filters: TaskFiltersValues
  setFilters: (filters: TaskFiltersValues) => void
} {
  // Initialize from URL - use namespaced params to avoid collision with RunFilters
  const [filters, setFiltersState] = useState<TaskFiltersValues>(() => {
    const searchParams = new URLSearchParams(window.location.search)
    return {
      status: normalizeSingleStatusSelection(
        searchParams.get("taskStatus")?.split(",").filter(Boolean) ?? []
      ),
      search: searchParams.get("taskSearch") ?? "",
    }
  })

  // Update URL when filters change - preserve other params (like runStatus)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const selectedStatuses = normalizeSingleStatusSelection(filters.status)

    // Clear our namespaced params first
    params.delete("taskStatus")
    params.delete("taskSearch")

    if (selectedStatuses.length > 0) {
      params.set("taskStatus", selectedStatuses[0]!)
    }

    if (filters.search) {
      params.set("taskSearch", filters.search)
    }

    const newUrl = params.toString()
      ? `${window.location.pathname}?${params}`
      : window.location.pathname

    // Use replaceState to avoid creating browser history entries
    window.history.replaceState({}, "", newUrl)
  }, [filters])

  // Handle browser back/forward navigation
  useEffect(() => {
    const handlePopState = () => {
      const searchParams = new URLSearchParams(window.location.search)
      setFiltersState({
        status: normalizeSingleStatusSelection(
          searchParams.get("taskStatus")?.split(",").filter(Boolean) ?? []
        ),
        search: searchParams.get("taskSearch") ?? "",
      })
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  return { filters, setFilters: setFiltersState }
}
