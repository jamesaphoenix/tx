import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useInfiniteQuery, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query'
import { type PaginatedTasksResponse } from '../../api/client'
import { useInfiniteTasks } from '../useInfiniteTasks'

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query'
  )

  return {
    ...actual,
    useInfiniteQuery: vi.fn(),
  }
})

const emptyResponse: PaginatedTasksResponse = {
  tasks: [],
  nextCursor: null,
  hasMore: false,
  total: 0,
  summary: { total: 0, byStatus: {} },
}

type InfiniteTasksData = InfiniteData<PaginatedTasksResponse, string | undefined>

interface InfiniteQueryOptionsShape {
  enabled?: boolean
  refetchInterval?: number | false
  queryFn?: (context: { pageParam?: string }) => Promise<PaginatedTasksResponse>
}

function isInfiniteQueryOptionsShape(value: unknown): value is InfiniteQueryOptionsShape {
  return typeof value === 'object' && value !== null
}

function createUseInfiniteQueryResult(
  data: InfiniteTasksData
): UseInfiniteQueryResult<InfiniteTasksData, Error> {
  const result: UseInfiniteQueryResult<InfiniteTasksData, Error> = {
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
    status: 'success',
    fetchStatus: 'idle',
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

describe('useInfiniteTasks', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => emptyResponse,
    })
    vi.stubGlobal('fetch', fetchMock)

    vi.mocked(useInfiniteQuery).mockReturnValue(
      createUseInfiniteQueryResult({
        pages: [emptyResponse],
        pageParams: [undefined],
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('enables paginated polling by default', async () => {
    renderHook(() =>
      useInfiniteTasks({ status: ['ready'], search: 'auth', limit: 10 })
    )

    const optionsArg = vi.mocked(useInfiniteQuery).mock.calls[0]?.[0]
    expect(isInfiniteQueryOptionsShape(optionsArg)).toBe(true)
    if (!isInfiniteQueryOptionsShape(optionsArg)) {
      throw new Error('Expected useInfiniteQuery options to be passed')
    }

    expect(optionsArg.enabled).toBe(true)
    expect(optionsArg.refetchInterval).toBe(5000)

    if (optionsArg.enabled !== false && optionsArg.queryFn) {
      await optionsArg.queryFn({ pageParam: undefined })
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks?status=ready&search=auth&limit=10')
  })

  it('disables polling and does not invoke fetcher when enabled=false', () => {
    renderHook(() => useInfiniteTasks({ status: ['ready'] }, { enabled: false }))

    const optionsArg = vi.mocked(useInfiniteQuery).mock.calls[0]?.[0]
    expect(isInfiniteQueryOptionsShape(optionsArg)).toBe(true)
    if (!isInfiniteQueryOptionsShape(optionsArg)) {
      throw new Error('Expected useInfiniteQuery options to be passed')
    }

    expect(optionsArg.enabled).toBe(false)
    expect(optionsArg.refetchInterval).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
