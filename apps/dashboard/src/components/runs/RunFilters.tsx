import { useCallback, useEffect, useState } from "react"

export interface RunFiltersValues {
  status: string[]
  agent: string
}

interface StatusCounts {
  running?: number
  completed?: number
  failed?: number
  timeout?: number
  cancelled?: number
  [key: string]: number | undefined
}

interface RunFiltersProps {
  value: RunFiltersValues
  onChange: (value: RunFiltersValues) => void
  statusCounts?: StatusCounts
  availableAgents?: string[]
}

// Run status options per PRD-013 US-013-006
const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "running", label: "Running", color: "bg-yellow-500" },
  { value: "completed", label: "Completed", color: "bg-green-500" },
  { value: "failed", label: "Failed", color: "bg-red-500" },
] as const

/**
 * RunFilters component provides status toggles and agent dropdown for filtering runs.
 * - Status toggle buttons show count for each status
 * - Multiple statuses can be selected (except "All" which clears selection)
 * - Agent dropdown filters by agent name
 * - Parent is responsible for syncing with URL params
 */
export function RunFilters({
  value,
  onChange,
  statusCounts = {},
  availableAgents = [],
}: RunFiltersProps) {
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

  const handleAgentChange = useCallback(
    (agent: string) => {
      onChange({ ...value, agent })
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
    <div className="space-y-2.5">
      {/* Agent dropdown filter */}
      <div className="flex items-center gap-2.5">
        <label htmlFor="agent-filter" className="text-xs text-gray-400">
          Agent:
        </label>
        <select
          id="agent-filter"
          value={value.agent}
          onChange={(e) => handleAgentChange(e.target.value)}
          className="
            bg-gray-800 text-gray-200 text-xs rounded
            border border-gray-700
            px-2.5 py-1.5
            focus:ring-2 focus:ring-blue-500 focus:border-blue-500
            outline-none
            min-w-[150px]
          "
        >
          <option value="">All Agents</option>
          {availableAgents.map((agent) => (
            <option key={agent} value={agent}>
              {agent}
            </option>
          ))}
        </select>
      </div>

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
                inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium
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
                    ml-1 px-1.5 py-0.5 text-[10px] rounded-full min-w-[1.25rem] text-center
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
    </div>
  )
}

/**
 * Hook to sync RunFilters with URL search params.
 * Provides values and onChange handler that automatically update the URL.
 */
export function useRunFiltersWithUrl(): {
  filters: RunFiltersValues
  setFilters: (filters: RunFiltersValues) => void
} {
  // Initialize from URL - use namespaced params to avoid collision with TaskFilters
  const [filters, setFiltersState] = useState<RunFiltersValues>(() => {
    const searchParams = new URLSearchParams(window.location.search)
    return {
      status: searchParams.get("runStatus")?.split(",").filter(Boolean) ?? [],
      agent: searchParams.get("runAgent") ?? "",
    }
  })

  // Update URL when filters change - preserve other params (like taskStatus)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)

    // Clear our namespaced params first
    params.delete("runStatus")
    params.delete("runAgent")

    if (filters.status.length > 0) {
      params.set("runStatus", filters.status.join(","))
    }

    if (filters.agent) {
      params.set("runAgent", filters.agent)
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
        status: searchParams.get("runStatus")?.split(",").filter(Boolean) ?? [],
        agent: searchParams.get("runAgent") ?? "",
      })
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  return { filters, setFilters: setFiltersState }
}
