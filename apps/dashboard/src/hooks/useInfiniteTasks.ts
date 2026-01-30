import { useInfiniteQuery } from "@tanstack/react-query"
import { type PaginatedTasksResponse, type TaskWithDeps } from "../api/client"

export interface TaskFilters {
  status?: string[]
  search?: string
  limit?: number
}

export interface UseInfiniteTasksResult {
  tasks: TaskWithDeps[]
  data: ReturnType<typeof useInfiniteQuery<PaginatedTasksResponse, Error>>["data"]
  fetchNextPage: ReturnType<typeof useInfiniteQuery<PaginatedTasksResponse, Error>>["fetchNextPage"]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: ReturnType<typeof useInfiniteQuery<PaginatedTasksResponse, Error>>["refetch"]
  total: number
}

export function useInfiniteTasks(filters: TaskFilters = {}): UseInfiniteTasksResult {
  const query = useInfiniteQuery({
    queryKey: ["tasks", "infinite", filters] as const,
    queryFn: async ({ pageParam }): Promise<PaginatedTasksResponse> => {
      const params = new URLSearchParams()

      // Add cursor if present (pageParam is string | undefined)
      if (pageParam) {
        params.set("cursor", pageParam)
      }

      // Add status filter
      if (filters.status?.length) {
        params.set("status", filters.status.join(","))
      }

      // Add search filter
      if (filters.search) {
        params.set("search", filters.search)
      }

      // Add limit (default 20)
      params.set("limit", String(filters.limit ?? 20))

      const res = await fetch(`/api/tasks?${params}`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      return res.json() as Promise<PaginatedTasksResponse>
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: 2000, // Refetch after 2s
    refetchInterval: 5000, // Poll every 5s
  })

  // Flatten tasks from all pages
  const tasks = query.data?.pages.flatMap((page) => page.tasks) ?? []

  // Get total from the latest page (most accurate)
  const total = query.data?.pages[query.data.pages.length - 1]?.total ?? 0

  return {
    tasks,
    data: query.data,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    total,
  }
}
