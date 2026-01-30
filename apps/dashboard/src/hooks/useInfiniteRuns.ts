import { useInfiniteQuery } from "@tanstack/react-query"
import { type PaginatedRunsResponse, type Run } from "../api/client"

export interface RunFilters {
  agent?: string
  status?: string[]
  limit?: number
}

export interface UseInfiniteRunsResult {
  runs: Run[]
  data: ReturnType<typeof useInfiniteQuery<PaginatedRunsResponse, Error>>["data"]
  fetchNextPage: ReturnType<typeof useInfiniteQuery<PaginatedRunsResponse, Error>>["fetchNextPage"]
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: ReturnType<typeof useInfiniteQuery<PaginatedRunsResponse, Error>>["refetch"]
}

export function useInfiniteRuns(filters: RunFilters = {}): UseInfiniteRunsResult {
  const query = useInfiniteQuery<PaginatedRunsResponse, Error>({
    queryKey: ["runs", "infinite", filters],
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams()

      // Add cursor if present
      if (pageParam) {
        params.set("cursor", pageParam)
      }

      // Add agent filter
      if (filters.agent) {
        params.set("agent", filters.agent)
      }

      // Add status filter
      if (filters.status?.length) {
        params.set("status", filters.status.join(","))
      }

      // Add limit (default 20)
      params.set("limit", String(filters.limit ?? 20))

      const res = await fetch(`/api/runs?${params}`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      return res.json() as Promise<PaginatedRunsResponse>
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: undefined as string | undefined,
    staleTime: 2000, // Refetch after 2s
    refetchInterval: 5000, // Poll every 5s
  })

  // Flatten runs from all pages
  const runs = query.data?.pages.flatMap((page) => page.runs) ?? []

  return {
    runs,
    data: query.data,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage ?? false,
    isFetchingNextPage: query.isFetchingNextPage,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  }
}
