import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useInfiniteQuery, type InfiniteData, type UseInfiniteQueryResult } from "@tanstack/react-query"
import { type PaginatedRunsResponse } from "../../api/client"
import { useInfiniteRuns } from "../useInfiniteRuns"

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>(
    "@tanstack/react-query",
  )

  return {
    ...actual,
    useInfiniteQuery: vi.fn(),
  }
})

const emptyResponse: PaginatedRunsResponse = {
  runs: [],
  nextCursor: null,
  hasMore: false,
}

type InfiniteRunsData = InfiniteData<PaginatedRunsResponse, string | undefined>

interface InfiniteQueryOptionsShape {
  queryFn?: (context: { pageParam?: string }) => Promise<PaginatedRunsResponse>
  staleTime?: number
  refetchInterval?: number | false
}

function isInfiniteQueryOptionsShape(value: unknown): value is InfiniteQueryOptionsShape {
  return typeof value === "object" && value !== null
}

function createUseInfiniteQueryResult(
  data: InfiniteRunsData,
): UseInfiniteQueryResult<InfiniteRunsData, Error> {
  const result: UseInfiniteQueryResult<InfiniteRunsData, Error> = {
    data,
    dataUpdatedAt: Date.now(),
    error: null,
    errorUpdatedAt: 0,
    failureCount: 0,
    failureReason: null,
    errorUpdateCount: 0,
    isError: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isLoading: false,
    isPending: false,
    isLoadingError: false,
    isInitialLoading: false,
    isPaused: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    isSuccess: true,
    isEnabled: true,
    refetch: async () => result,
    status: "success",
    fetchStatus: "idle",
    promise: Promise.resolve(data),
    fetchNextPage: async () => result,
    fetchPreviousPage: async () => result,
    hasNextPage: false,
    hasPreviousPage: false,
    isFetchNextPageError: false,
    isFetchingNextPage: false,
    isFetchPreviousPageError: false,
    isFetchingPreviousPage: false,
  }

  return result
}

describe("useInfiniteRuns", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => emptyResponse,
    })
    vi.stubGlobal("fetch", fetchMock)

    vi.mocked(useInfiniteQuery).mockReturnValue(
      createUseInfiniteQueryResult({
        pages: [
          {
            runs: [
              { id: "run-1", taskId: null, agent: "tx-1", startedAt: "", endedAt: null, status: "running", exitCode: null, pid: null, transcriptPath: null, stderrPath: null, stdoutPath: null, contextInjected: null, summary: null, errorMessage: null, metadata: {} },
            ],
            nextCursor: "next-1",
            hasMore: true,
          },
          {
            runs: [
              { id: "run-2", taskId: null, agent: "tx-2", startedAt: "", endedAt: null, status: "completed", exitCode: 0, pid: null, transcriptPath: null, stderrPath: null, stdoutPath: null, contextInjected: null, summary: null, errorMessage: null, metadata: {} },
            ],
            nextCursor: null,
            hasMore: false,
          },
        ],
        pageParams: [undefined, "next-1"],
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("flattens paginated data and configures polling query options", async () => {
    const { result } = renderHook(() =>
      useInfiniteRuns({ agent: "worker-1", status: ["running", "failed"], limit: 10 }),
    )

    expect(result.current.runs.map((run) => run.id)).toEqual(["run-1", "run-2"])

    const optionsArg = vi.mocked(useInfiniteQuery).mock.calls[0]?.[0]
    expect(isInfiniteQueryOptionsShape(optionsArg)).toBe(true)
    if (!isInfiniteQueryOptionsShape(optionsArg)) {
      throw new Error("Expected useInfiniteQuery options")
    }

    expect(optionsArg.staleTime).toBe(2000)
    expect(optionsArg.refetchInterval).toBe(5000)

    if (optionsArg.queryFn) {
      await optionsArg.queryFn({ pageParam: "cursor-1" })
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/runs?cursor=cursor-1&agent=worker-1&status=running%2Cfailed&limit=10",
    )
  })

  it("throws a descriptive HTTP error for non-OK responses", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    })

    renderHook(() => useInfiniteRuns())

    const optionsArg = vi.mocked(useInfiniteQuery).mock.calls[0]?.[0]
    expect(isInfiniteQueryOptionsShape(optionsArg)).toBe(true)
    if (!isInfiniteQueryOptionsShape(optionsArg) || !optionsArg.queryFn) {
      throw new Error("Expected query function")
    }

    await expect(optionsArg.queryFn({ pageParam: undefined })).rejects.toThrow(
      "HTTP 500: Internal Server Error",
    )
  })
})
