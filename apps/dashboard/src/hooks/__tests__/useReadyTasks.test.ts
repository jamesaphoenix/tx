import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { fetchers, type ReadyResponse } from '../../api/client'
import { useReadyTasks } from '../useReadyTasks'

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>(
    '@tanstack/react-query'
  )

  return {
    ...actual,
    useQuery: vi.fn(),
  }
})

const emptyReadyResponse: ReadyResponse = { tasks: [] }

interface ReadyQueryOptionsShape {
  enabled?: boolean
  refetchInterval?: number | false
  queryFn?: () => Promise<ReadyResponse>
}

function isReadyQueryOptionsShape(value: unknown): value is ReadyQueryOptionsShape {
  return typeof value === 'object' && value !== null
}

function createUseQueryResult(data: ReadyResponse): UseQueryResult<ReadyResponse, Error> {
  const result: UseQueryResult<ReadyResponse, Error> = {
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
  }

  return result
}

describe('useReadyTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(fetchers, 'ready').mockResolvedValue(emptyReadyResponse)

    vi.mocked(useQuery).mockReturnValue(createUseQueryResult(emptyReadyResponse))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enables query polling by default', async () => {
    renderHook(() => useReadyTasks())

    const optionsArg = vi.mocked(useQuery).mock.calls[0]?.[0]
    expect(isReadyQueryOptionsShape(optionsArg)).toBe(true)
    if (!isReadyQueryOptionsShape(optionsArg)) {
      throw new Error('Expected useQuery options to be passed')
    }

    expect(optionsArg.enabled).toBe(true)
    expect(optionsArg.refetchInterval).toBe(5000)

    if (optionsArg.enabled !== false && optionsArg.queryFn) {
      await optionsArg.queryFn()
    }

    expect(fetchers.ready).toHaveBeenCalledTimes(1)
  })

  it('disables polling and does not invoke fetcher when enabled=false', () => {
    renderHook(() => useReadyTasks({ enabled: false }))

    const optionsArg = vi.mocked(useQuery).mock.calls[0]?.[0]
    expect(isReadyQueryOptionsShape(optionsArg)).toBe(true)
    if (!isReadyQueryOptionsShape(optionsArg)) {
      throw new Error('Expected useQuery options to be passed')
    }

    expect(optionsArg.enabled).toBe(false)
    expect(optionsArg.refetchInterval).toBe(false)
    expect(fetchers.ready).not.toHaveBeenCalled()
  })
})
