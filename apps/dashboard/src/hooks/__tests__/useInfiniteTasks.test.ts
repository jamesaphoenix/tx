import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useInfiniteQuery } from '@tanstack/react-query'
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

    vi.mocked(useInfiniteQuery).mockImplementation((options: any) => {
      if (options.enabled !== false) {
        void options.queryFn({ pageParam: undefined })
      }

      return {
        data: {
          pages: [emptyResponse],
          pageParams: [undefined],
        },
        fetchNextPage: vi.fn(),
        hasNextPage: false,
        isFetchingNextPage: false,
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('enables paginated polling by default', async () => {
    renderHook(() =>
      useInfiniteTasks({ status: ['ready'], search: 'auth', limit: 10 })
    )

    const options = vi.mocked(useInfiniteQuery).mock.calls[0]?.[0]
    expect(options.enabled).toBe(true)
    expect(options.refetchInterval).toBe(5000)

    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks?status=ready&search=auth&limit=10')
  })

  it('disables polling and does not invoke fetcher when enabled=false', () => {
    renderHook(() => useInfiniteTasks({ status: ['ready'] }, { enabled: false }))

    const options = vi.mocked(useInfiniteQuery).mock.calls[0]?.[0]
    expect(options.enabled).toBe(false)
    expect(options.refetchInterval).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
