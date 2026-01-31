import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../../../test/setup'
import { TaskList } from '../TaskList'
import type { PaginatedTasksResponse, ReadyResponse, TaskWithDeps } from '../../../api/client'

// Helper to create a task fixture
function createTask(overrides: Partial<TaskWithDeps> = {}): TaskWithDeps {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 10)}`,
    title: 'Test task',
    description: 'Test description',
    status: 'ready',
    parent_id: null,
    score: 500,
    created_at: '2026-01-30T12:00:00Z',
    updated_at: '2026-01-30T12:00:00Z',
    completed_at: null,
    metadata: '{}',
    blockedBy: [],
    blocks: [],
    children: [],
    isReady: true,
    ...overrides,
  }
}

// Create a fresh QueryClient for each test
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

// Helper to render with all providers
function renderWithProviders(ui: React.ReactElement) {
  const queryClient = createTestQueryClient()
  return {
    ...render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>),
    queryClient,
  }
}

// Default empty response for ready endpoint
const emptyReadyResponse: ReadyResponse = { tasks: [] }

// Default empty response for paginated endpoint
const emptyPaginatedResponse: PaginatedTasksResponse = {
  tasks: [],
  nextCursor: null,
  hasMore: false,
  total: 0,
  summary: { total: 0, byStatus: {} },
}

describe('TaskList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set up default handlers - tests can override these
    server.use(
      http.get('/api/tasks/ready', () => {
        return HttpResponse.json(emptyReadyResponse)
      }),
      http.get('/api/tasks', () => {
        return HttpResponse.json(emptyPaginatedResponse)
      })
    )
  })

  afterEach(() => {
    server.resetHandlers()
  })

  describe('loading state', () => {
    it('shows LoadingSkeleton while loading', async () => {
      // Mock slow response
      server.use(
        http.get('/api/tasks', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return HttpResponse.json({
            tasks: [],
            nextCursor: null,
            hasMore: false,
            total: 0,
            summary: { total: 0, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(<TaskList onSelectTask={onSelectTask} />)

      // Should show loading text
      expect(screen.getByText('Loading...')).toBeInTheDocument()
    })
  })

  describe('empty state', () => {
    it('shows EmptyState when no tasks', async () => {
      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks: [],
            nextCursor: null,
            hasMore: false,
            total: 0,
            summary: { total: 0, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(<TaskList onSelectTask={onSelectTask} />)

      await waitFor(() => {
        expect(screen.getByText('No tasks found')).toBeInTheDocument()
      })
    })

    it('shows filter hint when filters active and no results', async () => {
      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks: [],
            nextCursor: null,
            hasMore: false,
            total: 0,
            summary: { total: 0, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(
        <TaskList
          onSelectTask={onSelectTask}
          filters={{ status: ['blocked'], search: 'test' }}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('No tasks found')).toBeInTheDocument()
        expect(
          screen.getByText('Try adjusting your filters or search query')
        ).toBeInTheDocument()
      })
    })

    it('shows create hint when no filters and no tasks', async () => {
      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks: [],
            nextCursor: null,
            hasMore: false,
            total: 0,
            summary: { total: 0, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(<TaskList onSelectTask={onSelectTask} filters={{}} />)

      await waitFor(() => {
        expect(screen.getByText('No tasks found')).toBeInTheDocument()
        expect(screen.getByText(/Create your first task/)).toBeInTheDocument()
      })
    })
  })

  describe('rendering tasks', () => {
    it('renders initial tasks', async () => {
      const tasks = [
        createTask({ id: 'tx-task1', title: 'First task' }),
        createTask({ id: 'tx-task2', title: 'Second task' }),
        createTask({ id: 'tx-task3', title: 'Third task' }),
      ]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 3,
            summary: { total: 3, byStatus: { ready: 3 } },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(<TaskList onSelectTask={onSelectTask} />)

      await waitFor(() => {
        expect(screen.getByText('First task')).toBeInTheDocument()
        expect(screen.getByText('Second task')).toBeInTheDocument()
        expect(screen.getByText('Third task')).toBeInTheDocument()
      })
    })

    it('displays total count in header', async () => {
      const tasks = [
        createTask({ id: 'tx-task1', title: 'Task 1' }),
        createTask({ id: 'tx-task2', title: 'Task 2' }),
      ]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 2,
            summary: { total: 2, byStatus: { ready: 2 } },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(<TaskList onSelectTask={onSelectTask} />)

      await waitFor(() => {
        expect(screen.getByText('2 tasks')).toBeInTheDocument()
      })
    })

    it('uses singular "task" when count is 1', async () => {
      const tasks = [createTask({ id: 'tx-task1', title: 'Only task' })]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(<TaskList onSelectTask={onSelectTask} />)

      await waitFor(() => {
        expect(screen.getByText('1 task')).toBeInTheDocument()
      })
    })
  })

  describe('task selection', () => {
    it('calls onSelectTask when task is clicked', async () => {
      const tasks = [createTask({ id: 'tx-clickable', title: 'Clickable task' })]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(<TaskList onSelectTask={onSelectTask} />)

      await waitFor(() => {
        expect(screen.getByText('Clickable task')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Clickable task'))
      expect(onSelectTask).toHaveBeenCalledWith('tx-clickable')
    })
  })

  describe('keyboard navigation', () => {
    const dispatchKeyEvent = (key: string) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      })
      window.dispatchEvent(event)
    }

    it('updates focused item on ArrowDown', async () => {
      const tasks = [
        createTask({ id: 'tx-task1', title: 'Task 1' }),
        createTask({ id: 'tx-task2', title: 'Task 2' }),
        createTask({ id: 'tx-task3', title: 'Task 3' }),
      ]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 3,
            summary: { total: 3, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      const { container } = renderWithProviders(<TaskList onSelectTask={onSelectTask} />)

      await waitFor(() => {
        expect(screen.getByText('Task 1')).toBeInTheDocument()
      })

      // First task should be focused by default (tabIndex=0)
      const cards = container.querySelectorAll('[tabindex]')
      expect(cards[0]).toHaveAttribute('tabIndex', '0')

      // Press ArrowDown
      act(() => {
        dispatchKeyEvent('ArrowDown')
      })

      // Second task should now be focused
      await waitFor(() => {
        const updatedCards = container.querySelectorAll('[tabindex]')
        expect(updatedCards[1]).toHaveAttribute('tabIndex', '0')
        expect(updatedCards[0]).toHaveAttribute('tabIndex', '-1')
      })
    })

    it('selects focused task on Enter', async () => {
      const tasks = [
        createTask({ id: 'tx-task1', title: 'Task 1' }),
        createTask({ id: 'tx-task2', title: 'Task 2' }),
      ]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 2,
            summary: { total: 2, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(<TaskList onSelectTask={onSelectTask} />)

      await waitFor(() => {
        expect(screen.getByText('Task 1')).toBeInTheDocument()
      })

      // Move to second task
      act(() => {
        dispatchKeyEvent('ArrowDown')
      })

      // Press Enter to select
      act(() => {
        dispatchKeyEvent('Enter')
      })

      expect(onSelectTask).toHaveBeenCalledWith('tx-task2')
    })

    it('calls onEscape when Escape is pressed', async () => {
      const tasks = [createTask({ id: 'tx-task1', title: 'Task 1' })]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      const onEscape = vi.fn()
      renderWithProviders(<TaskList onSelectTask={onSelectTask} onEscape={onEscape} />)

      await waitFor(() => {
        expect(screen.getByText('Task 1')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyEvent('Escape')
      })

      expect(onEscape).toHaveBeenCalled()
    })
  })

  describe('infinite scroll', () => {
    it('shows scroll hint when hasMore is true', async () => {
      const tasks = [createTask({ id: 'tx-task1', title: 'Task 1' })]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: 'cursor123',
            hasMore: true,
            total: 10,
            summary: { total: 10, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(<TaskList onSelectTask={onSelectTask} />)

      await waitFor(() => {
        expect(screen.getByText(/scroll for more/)).toBeInTheDocument()
      })
    })

    it('shows end of list when no more pages', async () => {
      const tasks = [createTask({ id: 'tx-task1', title: 'Task 1' })]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(<TaskList onSelectTask={onSelectTask} />)

      await waitFor(() => {
        expect(screen.getByText('End of tasks')).toBeInTheDocument()
      })
    })
  })

  describe('ready tasks filter', () => {
    it('uses ready endpoint when filtering by ready status only', async () => {
      const readyTasks = [
        createTask({ id: 'tx-ready1', title: 'Ready task 1', status: 'ready' }),
        createTask({ id: 'tx-ready2', title: 'Ready task 2', status: 'ready' }),
      ]

      server.use(
        http.get('/api/tasks/ready', () => {
          return HttpResponse.json({
            tasks: readyTasks,
          } satisfies ReadyResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(
        <TaskList onSelectTask={onSelectTask} filters={{ status: ['ready'] }} />
      )

      await waitFor(() => {
        expect(screen.getByText('Ready Tasks')).toBeInTheDocument()
        expect(screen.getByText('Ready task 1')).toBeInTheDocument()
        expect(screen.getByText('Ready task 2')).toBeInTheDocument()
      })
    })

    it('shows "All ready tasks shown" for ready-only filter', async () => {
      const readyTasks = [
        createTask({ id: 'tx-ready1', title: 'Ready task 1', status: 'ready' }),
      ]

      server.use(
        http.get('/api/tasks/ready', () => {
          return HttpResponse.json({
            tasks: readyTasks,
          } satisfies ReadyResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(
        <TaskList onSelectTask={onSelectTask} filters={{ status: ['ready'] }} />
      )

      await waitFor(() => {
        expect(screen.getByText('All ready tasks shown')).toBeInTheDocument()
      })
    })

    it('uses paginated endpoint when search is active with ready filter', async () => {
      const tasks = [createTask({ id: 'tx-task1', title: 'Ready task matching search' })]

      server.use(
        http.get('/api/tasks', ({ request }) => {
          const url = new URL(request.url)
          expect(url.searchParams.get('search')).toBe('matching')
          expect(url.searchParams.get('status')).toBe('ready')
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(
        <TaskList
          onSelectTask={onSelectTask}
          filters={{ status: ['ready'], search: 'matching' }}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Ready task matching search')).toBeInTheDocument()
      })
    })
  })

  describe('error state', () => {
    it('shows error when API fails', async () => {
      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
          )
        })
      )

      const onSelectTask = vi.fn()
      renderWithProviders(<TaskList onSelectTask={onSelectTask} />)

      await waitFor(() => {
        expect(screen.getByText('Error loading tasks')).toBeInTheDocument()
      })
    })
  })
})
