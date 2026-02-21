import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { UseInfiniteTasksResult } from '../../../hooks/useInfiniteTasks'
import type { UseReadyTasksResult } from '../../../hooks/useReadyTasks'
import { TaskList } from '../TaskList'

const { useReadyTasksMock, useInfiniteTasksMock } = vi.hoisted(() => ({
  useReadyTasksMock: vi.fn(),
  useInfiniteTasksMock: vi.fn(),
}))

vi.mock('../../../hooks/useReadyTasks', () => ({
  useReadyTasks: useReadyTasksMock,
}))

vi.mock('../../../hooks/useInfiniteTasks', () => ({
  useInfiniteTasks: useInfiniteTasksMock,
}))

vi.mock('../../../hooks/useIntersectionObserver', () => ({
  useIntersectionObserver: vi.fn(() => vi.fn()),
}))

vi.mock('../../../hooks/useKeyboardNavigation', () => ({
  useKeyboardNavigation: vi.fn(() => ({
    focusedIndex: 0,
    isKeyboardNavigating: false,
  })),
}))

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        refetchInterval: false,
        refetchOnWindowFocus: false,
      },
    },
  })
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient()
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>
  )

  return {
    ...rendered,
    queryClient,
  }
}

function createReadyResult(): UseReadyTasksResult {
  return {
    tasks: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    total: 0,
  }
}

function createInfiniteResult(): UseInfiniteTasksResult {
  return {
    tasks: [],
    data: undefined,
    fetchNextPage: vi.fn() as UseInfiniteTasksResult['fetchNextPage'],
    hasNextPage: false,
    isFetchingNextPage: false,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn() as UseInfiniteTasksResult['refetch'],
    total: 0,
  }
}

describe('TaskList query gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useReadyTasksMock.mockReturnValue(createReadyResult())
    useInfiniteTasksMock.mockReturnValue(createInfiniteResult())
  })

  it('enables ready query and disables paginated query for ready-only filters', () => {
    renderWithProviders(
      <TaskList
        onSelectTask={vi.fn()}
        filters={{ status: ['ready'] }}
      />
    )

    expect(useReadyTasksMock.mock.calls.at(-1)).toEqual([{ enabled: true }])
    expect(useInfiniteTasksMock.mock.calls.at(-1)).toEqual([
      { status: ['ready'] },
      { enabled: false },
    ])
  })

  it('enables paginated query and disables ready query for non-ready filters', () => {
    renderWithProviders(<TaskList onSelectTask={vi.fn()} />)

    expect(useReadyTasksMock.mock.calls.at(-1)).toEqual([{ enabled: false }])
    expect(useInfiniteTasksMock.mock.calls.at(-1)).toEqual([
      {},
      { enabled: true },
    ])
  })

  it('keeps paginated query active when ready filter includes search', () => {
    renderWithProviders(
      <TaskList
        onSelectTask={vi.fn()}
        filters={{ status: ['ready'], search: 'auth' }}
      />
    )

    expect(useReadyTasksMock.mock.calls.at(-1)).toEqual([{ enabled: false }])
    expect(useInfiniteTasksMock.mock.calls.at(-1)).toEqual([
      { status: ['ready'], search: 'auth' },
      { enabled: true },
    ])
  })

  it('switches enabled flags when filters transition between paginated and ready-only modes', () => {
    const onSelectTask = vi.fn()
    const queryClient = createTestQueryClient()

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TaskList onSelectTask={onSelectTask} />
      </QueryClientProvider>
    )

    expect(useReadyTasksMock.mock.calls.at(-1)).toEqual([{ enabled: false }])
    expect(useInfiniteTasksMock.mock.calls.at(-1)).toEqual([
      {},
      { enabled: true },
    ])

    rerender(
      <QueryClientProvider client={queryClient}>
        <TaskList onSelectTask={onSelectTask} filters={{ status: ['ready'] }} />
      </QueryClientProvider>
    )

    expect(useReadyTasksMock.mock.calls.at(-1)).toEqual([{ enabled: true }])
    expect(useInfiniteTasksMock.mock.calls.at(-1)).toEqual([
      { status: ['ready'] },
      { enabled: false },
    ])
  })
})
