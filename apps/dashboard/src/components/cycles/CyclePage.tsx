import { useEffect, useMemo, useState, useCallback } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { fetchers } from "../../api/client"
import { useCycles } from "../../hooks/useCycles"
import { useCommands, type Command } from "../command-palette/CommandContext"
import { Button } from "../ui"
import { CycleCard } from "./CycleCard"
import { CycleDetail } from "./CycleDetail"

type ThemeMode = "light" | "dark"

interface CyclePageProps {
  themeMode?: ThemeMode
}

function sortCyclesByStartDesc<T extends { startDate: string }>(cycles: T[]): T[] {
  return [...cycles].sort((left, right) => Date.parse(right.startDate) - Date.parse(left.startDate))
}

function readCycleIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("cycleId")
}

function writeCycleUrl(cycleId: string | null) {
  const params = new URLSearchParams(window.location.search)
  if (cycleId) {
    params.set("cycleId", cycleId)
  } else {
    params.delete("cycleId")
  }
  const search = params.toString()
  const url = search ? `${window.location.pathname}?${search}` : window.location.pathname
  window.history.pushState(null, "", url)
}

export function CyclePage({ themeMode = "dark" }: CyclePageProps) {
  const isDarkTheme = themeMode === "dark"
  const queryClient = useQueryClient()
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(readCycleIdFromUrl)

  const { data: cycles = [], isLoading, isError, error } = useCycles()

  // Sync with browser back/forward
  useEffect(() => {
    const onPopState = () => setSelectedCycleId(readCycleIdFromUrl())
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [])

  const selectCycle = useCallback((cycleId: string | null) => {
    setSelectedCycleId(cycleId)
    writeCycleUrl(cycleId)
  }, [])

  const { mutate: createCycle, isPending: isCreateCyclePending } = useMutation({
    mutationFn: () => fetchers.createCycle(),
    onSuccess: async (createdCycle) => {
      await queryClient.invalidateQueries({ queryKey: ["cycles"] })
      selectCycle(createdCycle.id)
    },
  })

  const cycleGroups = useMemo(() => {
    const sorted = sortCyclesByStartDesc(cycles)
    return {
      current: sorted.find((cycle) => cycle.status === "current") ?? null,
      upcoming: sorted
        .filter((cycle) => cycle.status === "upcoming")
        .sort((a, b) => Date.parse(a.startDate) - Date.parse(b.startDate)),
      completed: sorted.filter((cycle) => cycle.status === "completed"),
    }
  }, [cycles])

  // Nonces to trigger modals in CycleDetail
  const [composerNonce, setComposerNonce] = useState(0)
  const [addTaskNonce, setAddTaskNonce] = useState(0)

  const requestNewTask = useCallback(() => {
    setComposerNonce((n) => n + 1)
  }, [])

  const requestAddExistingTasks = useCallback(() => {
    setAddTaskNonce((n) => n + 1)
  }, [])

  // Register page-level commands for the cycles tab
  const commands = useMemo((): Command[] => {
    const cmds: Command[] = []

    if (selectedCycleId) {
      // CMD+N creates a new task in the cycle
      cmds.push({
        id: "cycles:new-task",
        label: "Create new task in cycle",
        group: "Actions",
        icon: "action",
        shortcut: "⌘N",
        allowInInput: true,
        action: requestNewTask,
      })
      // Add existing tasks available without shortcut
      cmds.push({
        id: "cycles:add-existing",
        label: "Add existing tasks to cycle",
        group: "Actions",
        icon: "action",
        action: requestAddExistingTasks,
      })
      cmds.push({
        id: "cycles:back",
        label: "Back to all cycles",
        group: "Navigation",
        icon: "nav",
        action: () => selectCycle(null),
      })
    } else {
      // In cycle list view: CMD+N creates a new cycle
      cmds.push({
        id: "cycles:new",
        label: "Create new cycle",
        group: "Actions",
        icon: "action",
        shortcut: "⌘N",
        allowInInput: true,
        action: () => createCycle(),
      })

      // Quick-navigate to cycles
      for (const cycle of cycles) {
        cmds.push({
          id: `cycles:open:${cycle.id}`,
          label: cycle.name,
          sublabel: `${cycle.status} · ${cycle.taskCount} tasks`,
          group: "Items",
          icon: "nav",
          action: () => selectCycle(cycle.id),
        })
      }
    }

    return cmds
  }, [selectedCycleId, cycles, requestNewTask, requestAddExistingTasks, selectCycle, createCycle])

  useCommands(commands)

  if (selectedCycleId) {
    return (
      <CycleDetail
        cycleId={selectedCycleId}
        onBack={() => selectCycle(null)}
        themeMode={themeMode}
        composerNonce={composerNonce}
        addTaskNonce={addTaskNonce}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className={`text-lg font-semibold ${isDarkTheme ? "text-gray-100" : "text-zinc-900"}`}>Cycles</h1>
          <p className={`mt-0.5 text-xs ${isDarkTheme ? "text-gray-500" : "text-zinc-500"}`}>
            Plan weekly scope, track progress, and carry work forward.
          </p>
        </div>

        <Button
          size="sm"
          variant="primary"
          disabled={isCreateCyclePending}
          onClick={() => createCycle()}
        >
          {isCreateCyclePending ? "Creating…" : "+ New Cycle"}
        </Button>
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
            <div className="max-w-md rounded-xl border border-dashed border-gray-700/60 bg-gray-900/30 p-6 text-center">
              <h2 className="text-base font-semibold text-gray-100">No cycles yet</h2>
              <p className="mt-2 text-sm text-gray-400">
                Create your first cycle to start managing weekly work.
              </p>
              <Button
                size="sm"
                variant="primary"
                onClick={() => createCycle()}
                disabled={isCreateCyclePending}
                className="mt-4"
              >
                {isCreateCyclePending ? "Creating…" : "+ New Cycle"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-2">
            {cycleGroups.current ? (
              <section>
                <div className="mb-1.5 flex items-center gap-2">
                  <h2 className={`text-[11px] font-semibold uppercase tracking-wider ${isDarkTheme ? "text-blue-300" : "text-blue-600"}`}>Current</h2>
                  <span className={`h-px flex-1 ${isDarkTheme ? "bg-blue-500/15" : "bg-blue-300/30"}`} />
                </div>
                <CycleCard
                  cycle={cycleGroups.current}
                  onSelect={() => selectCycle(cycleGroups.current!.id)}
                  emphasize
                  themeMode={themeMode}
                />
              </section>
            ) : null}

            {cycleGroups.upcoming.length > 0 ? (
              <section>
                <div className="mb-1.5 flex items-center gap-2">
                  <h2 className={`text-[11px] font-semibold uppercase tracking-wider ${isDarkTheme ? "text-violet-300" : "text-violet-600"}`}>Upcoming</h2>
                  <span className={`h-px flex-1 ${isDarkTheme ? "bg-violet-500/15" : "bg-violet-300/30"}`} />
                </div>
                <div className="space-y-2">
                  {cycleGroups.upcoming.map((cycle) => (
                    <CycleCard
                      key={cycle.id}
                      cycle={cycle}
                      onSelect={() => selectCycle(cycle.id)}
                      themeMode={themeMode}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="min-h-[200px]">
              <div className="mb-1.5 flex items-center gap-2">
                <h2 className={`text-[11px] font-semibold uppercase tracking-wider ${isDarkTheme ? "text-emerald-300" : "text-emerald-600"}`}>Completed</h2>
                <span className={`h-px flex-1 ${isDarkTheme ? "bg-emerald-500/15" : "bg-emerald-300/30"}`} />
              </div>

              {cycleGroups.completed.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-700 px-3 py-4 text-sm text-gray-500">
                  No completed cycles yet.
                </div>
              ) : (
                <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1">
                  {cycleGroups.completed.map((cycle) => (
                    <CycleCard
                      key={cycle.id}
                      cycle={cycle}
                      onSelect={() => selectCycle(cycle.id)}
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
