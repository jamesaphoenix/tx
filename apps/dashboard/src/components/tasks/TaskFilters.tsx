import { useCallback, useEffect, useState } from "react"
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
  human_needs_to_review?: number
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

/**
 * TaskFilters component provides status toggles and search functionality.
 * - Status toggle buttons show count for each status
 * - Multiple statuses can be selected (except "All" which clears selection)
 * - Integrates SearchInput for debounced text search
 * - Parent is responsible for syncing with URL params
 */
export function TaskFilters({ value, onChange, statusCounts = {} }: TaskFiltersProps) {
  const handleStatusToggle = useCallback(
    (status: string) => {
      if (status === "all") {
        // "All" clears all status filters
        onChange({ ...value, status: [] })
        return
      }

      const currentStatuses = value.status
      const isSelected = currentStatuses.includes(status)

      if (isSelected) {
        // Remove status from selection
        onChange({
          ...value,
          status: currentStatuses.filter((s) => s !== status),
        })
      } else {
        // Add status to selection
        onChange({
          ...value,
          status: [...currentStatuses, status],
        })
      }
    },
    [value, onChange]
  )

  const handleSearchChange = useCallback(
    (search: string) => {
      onChange({ ...value, search })
    },
    [value, onChange]
  )

  // Calculate total count (sum of all status counts)
  const totalCount = Object.values(statusCounts).reduce<number>(
    (sum, count) => sum + (count ?? 0),
    0
  )

  // Check if "All" is selected (no specific statuses selected)
  const isAllSelected = value.status.length === 0

  return (
    <div className="space-y-3">
      {/* Status toggle buttons */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((option) => {
          const isAll = option.value === "all"
          const isSelected = isAll ? isAllSelected : value.status.includes(option.value)
          const count = isAll ? totalCount : statusCounts[option.value]

          return (
            <button
              key={option.value}
              onClick={() => handleStatusToggle(option.value)}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium
                transition-all duration-150
                ${
                  isSelected
                    ? "bg-blue-600 text-white ring-2 ring-blue-400 ring-offset-1 ring-offset-gray-900"
                    : "bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700"
                }
              `}
              aria-pressed={isSelected}
            >
              {/* Status color indicator (not for "All") */}
              {!isAll && option.color && (
                <span
                  className={`w-2 h-2 rounded-full ${option.color}`}
                  aria-hidden="true"
                />
              )}
              <span>{option.label}</span>
              {/* Count badge */}
              {count !== undefined && (
                <span
                  className={`
                    ml-1 px-1.5 py-0.5 text-xs rounded-full min-w-[1.25rem] text-center
                    ${isSelected ? "bg-blue-500 text-white" : "bg-gray-700 text-gray-400"}
                  `}
                >
                  {count}
                </span>
              )}
            </button>
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
      status: searchParams.get("taskStatus")?.split(",").filter(Boolean) ?? [],
      search: searchParams.get("taskSearch") ?? "",
    }
  })

  // Update URL when filters change - preserve other params (like runStatus)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    // Clear our namespaced params first
    params.delete("taskStatus")
    params.delete("taskSearch")

    if (filters.status.length > 0) {
      params.set("taskStatus", filters.status.join(","))
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
        status: searchParams.get("taskStatus")?.split(",").filter(Boolean) ?? [],
        search: searchParams.get("taskSearch") ?? "",
      })
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  return { filters, setFilters: setFiltersState }
}
