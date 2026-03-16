import { useCallback, useEffect, useState } from "react"
import { Button } from "../ui"

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
  { value: "completed", label: "Completed", color: "bg-emerald-500" },
  { value: "failed", label: "Failed", color: "bg-red-500" },
] as const

export function RunFilters({
  value,
  onChange,
  statusCounts = {},
  availableAgents = [],
}: RunFiltersProps) {
  const handleStatusToggle = useCallback(
    (status: string) => {
      if (status === "all") {
        onChange({ ...value, status: [] })
        return
      }

      const currentStatuses = value.status
      const isSelected = currentStatuses.includes(status)

      if (isSelected) {
        onChange({
          ...value,
          status: currentStatuses.filter((s) => s !== status),
        })
      } else {
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

  const totalCount = Object.values(statusCounts).reduce<number>(
    (sum, count) => sum + (count ?? 0),
    0
  )

  const isAllSelected = value.status.length === 0

  return (
    <div className="space-y-3">
      {/* Agent filter */}
      {availableAgents.length > 0 && (
        <div>
          <label htmlFor="agent-filter" className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            Agent
          </label>
          <select
            id="agent-filter"
            value={value.agent}
            onChange={(e) => handleAgentChange(e.target.value)}
            className="
              w-full rounded-lg border border-gray-800/80 bg-gray-900/40 text-[13px] text-gray-200
              px-2.5 py-1.5
              focus:ring-1 focus:ring-blue-500 focus:border-blue-500/50
              outline-none transition
              hover:border-gray-700
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
      )}

      {/* Status toggle buttons */}
      <div className="inline-flex gap-1 rounded-lg bg-gray-800/60 p-1">
        {STATUS_OPTIONS.map((option) => {
          const isAll = option.value === "all"
          const isSelected = isAll ? isAllSelected : value.status.includes(option.value)
          const count = isAll ? totalCount : statusCounts[option.value]

          return (
            <Button
              key={option.value}
              size="sm"
              variant={isSelected ? "primary" : "ghost"}
              onClick={() => handleStatusToggle(option.value)}
              aria-pressed={isSelected}
            >
              {!isAll && option.color && (
                <span
                  className={`h-2 w-2 rounded-full ${option.color}`}
                  aria-hidden="true"
                />
              )}
              <span>{option.label}</span>
              {count !== undefined && (
                <span className="text-[10px] opacity-80">
                  {count}
                </span>
              )}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Hook to sync RunFilters with URL search params.
 */
export function useRunFiltersWithUrl(): {
  filters: RunFiltersValues
  setFilters: (filters: RunFiltersValues) => void
} {
  const [filters, setFiltersState] = useState<RunFiltersValues>(() => {
    const searchParams = new URLSearchParams(window.location.search)
    return {
      status: searchParams.get("runStatus")?.split(",").filter(Boolean) ?? [],
      agent: searchParams.get("runAgent") ?? "",
    }
  })

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
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

    window.history.replaceState({}, "", newUrl)
  }, [filters])

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
