import { useQuery } from "@tanstack/react-query"
import { fetchers, type TaskWithDeps } from "../api/client"

export interface UseReadyTasksResult {
  tasks: TaskWithDeps[]
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: () => void
  total: number
}

/**
 * Hook to fetch ALL ready tasks at once (not paginated).
 * Ready tasks are those with workable status (backlog, ready, planning)
 * and all blockers completed.
 *
 * Use this instead of useInfiniteTasks when you want to display
 * all ready tasks without infinite scroll.
 */
export function useReadyTasks(): UseReadyTasksResult {
  const query = useQuery({
    queryKey: ["tasks", "ready"] as const,
    queryFn: fetchers.ready,
    staleTime: 2000, // Refetch after 2s
    refetchInterval: 5000, // Poll every 5s
  })

  const tasks = query.data?.tasks ?? []

  return {
    tasks,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    total: tasks.length,
  }
}
