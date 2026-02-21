import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
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

describe('useReadyTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    vi.spyOn(fetchers, 'ready').mockResolvedValue({ tasks: [] } as ReadyResponse)

    vi.mocked(useQuery).mockImplementation((options: any) => {
      if (options.enabled !== false) {
        void options.queryFn()
      }

      return {
        data: { tasks: [] },
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enables query polling by default', async () => {
    renderHook(() => useReadyTasks())

    const options = vi.mocked(useQuery).mock.calls[0]?.[0]
    expect(options.enabled).toBe(true)
    expect(options.refetchInterval).toBe(5000)

    await Promise.resolve()
    expect(fetchers.ready).toHaveBeenCalledTimes(1)
  })

  it('disables polling and does not invoke fetcher when enabled=false', () => {
    renderHook(() => useReadyTasks({ enabled: false }))

    const options = vi.mocked(useQuery).mock.calls[0]?.[0]
    expect(options.enabled).toBe(false)
    expect(options.refetchInterval).toBe(false)
    expect(fetchers.ready).not.toHaveBeenCalled()
  })
})
