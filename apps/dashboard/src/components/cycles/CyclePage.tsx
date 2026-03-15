import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { fetchers } from "../../api/client"
import { useCycles } from "../../hooks/useCycles"
import { CycleCard } from "./CycleCard"
import { CycleDetail } from "./CycleDetail"

type ThemeMode = "light" | "dark"

interface CyclePageProps {
  themeMode?: ThemeMode
}

function sortCyclesByStartDesc<T extends { startDate: string }>(cycles: T[]): T[] {
  return [...cycles].sort((left, right) => Date.parse(right.startDate) - Date.parse(left.startDate))
}

export function CyclePage({ themeMode = "dark" }: CyclePageProps) {
  const isDarkTheme = themeMode === "dark"
  const queryClient = useQueryClient()
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null)

  const { data: cycles = [], isLoading, isError, error } = useCycles()

  const createCycleMutation = useMutation({
    mutationFn: () => fetchers.createCycle(),
    onSuccess: async (createdCycle) => {
      await queryClient.invalidateQueries({ queryKey: ["cycles"] })
      setSelectedCycleId(createdCycle.id)
    },
  })

  const cycleGroups = useMemo(() => {
    const sorted = sortCyclesByStartDesc(cycles)
    return {
      current: sorted.find((cycle) => cycle.status === "current") ?? null,
      upcoming: sorted.filter((cycle) => cycle.status === "upcoming"),
      completed: sorted.filter((cycle) => cycle.status === "completed"),
    }
  }, [cycles])

  if (selectedCycleId) {
    return <CycleDetail cycleId={selectedCycleId} onBack={() => setSelectedCycleId(null)} themeMode={themeMode} />
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={`text-xl font-semibold ${isDarkTheme ? "text-gray-100" : "text-zinc-900"}`}>Cycles</h1>
          <p className={`mt-1 text-sm ${isDarkTheme ? "text-gray-400" : "text-zinc-600"}`}>
            Plan weekly scope, track progress, and carry work forward.
          </p>
        </div>

        <button
          type="button"
          disabled={createCycleMutation.isPending}
          onClick={() => createCycleMutation.mutate()}
          className="rounded-md border border-blue-500/50 bg-blue-500/20 px-3 py-1.5 text-sm font-medium text-blue-200 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {createCycleMutation.isPending ? "Creating…" : "+ New Cycle"}
        </button>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          <div className="h-28 animate-pulse rounded-xl bg-gray-800" />
          <div className="h-28 animate-pulse rounded-xl bg-gray-800" />
          <div className="h-28 animate-pulse rounded-xl bg-gray-800" />
        </div>
      ) : null}

      {isError ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          Failed to load cycles: {error instanceof Error ? error.message : "Unknown error"}
        </div>
      ) : null}

      {!isLoading && !isError ? (
        cycles.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-md rounded-xl border border-dashed border-gray-700 bg-gray-900/40 p-6 text-center">
              <h2 className="text-base font-semibold text-gray-100">No cycles yet</h2>
              <p className="mt-2 text-sm text-gray-400">
                Create your first cycle to start managing weekly work.
              </p>
              <button
                type="button"
                onClick={() => createCycleMutation.mutate()}
                disabled={createCycleMutation.isPending}
                className="mt-4 rounded-md border border-blue-500/50 bg-blue-500/20 px-3 py-1.5 text-sm font-medium text-blue-200 transition hover:bg-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {createCycleMutation.isPending ? "Creating…" : "+ New Cycle"}
              </button>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pb-2">
            {cycleGroups.current ? (
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-blue-200">Current</h2>
                  <span className="h-px flex-1 bg-blue-500/20" />
                </div>
                <CycleCard
                  cycle={cycleGroups.current}
                  onSelect={() => setSelectedCycleId(cycleGroups.current!.id)}
                  emphasize
                  themeMode={themeMode}
                />
              </section>
            ) : null}

            {cycleGroups.upcoming.length > 0 ? (
              <section>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-violet-200">Upcoming</h2>
                  <span className="h-px flex-1 bg-violet-500/20" />
                </div>
                <div className="space-y-3">
                  {cycleGroups.upcoming.map((cycle) => (
                    <CycleCard
                      key={cycle.id}
                      cycle={cycle}
                      onSelect={() => setSelectedCycleId(cycle.id)}
                      themeMode={themeMode}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="min-h-[220px]">
              <div className="mb-2 flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-emerald-200">Completed</h2>
                <span className="h-px flex-1 bg-emerald-500/20" />
              </div>

              {cycleGroups.completed.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-sm text-gray-500">
                  No completed cycles yet.
                </div>
              ) : (
                <div className="max-h-[380px] space-y-3 overflow-y-auto pr-1">
                  {cycleGroups.completed.map((cycle) => (
                    <CycleCard
                      key={cycle.id}
                      cycle={cycle}
                      onSelect={() => setSelectedCycleId(cycle.id)}
                      themeMode={themeMode}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        )
      ) : null}
    </div>
  )
}
