import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../../../test/setup'
import { TaskDetail } from '../TaskDetail'
import type { TaskDetailResponse, TaskWithDeps } from '../../../api/client'

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

describe('TaskDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    server.resetHandlers()
  })

  describe('loading state', () => {
    it('shows loading skeleton while fetching', async () => {
      server.use(
        http.get('/api/tasks/:id', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          const task = createTask({ id: 'tx-loading' })
          return HttpResponse.json({
            task,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      const { container } = renderWithProviders(
        <TaskDetail taskId="tx-loading" onNavigateToTask={onNavigate} />
      )

      // Should show loading skeleton (animate-pulse divs)
      const skeletons = container.querySelectorAll('.animate-pulse')
      expect(skeletons.length).toBeGreaterThan(0)
    })
  })

  describe('fetching and displaying task details', () => {
    it('fetches and displays task details', async () => {
      const task = createTask({
        id: 'tx-detail1',
        title: 'Detailed task',
        description: 'This is the task description',
        status: 'active',
        score: 750,
      })

      server.use(
        http.get('/api/tasks/:id', ({ params }) => {
          expect(params.id).toBe('tx-detail1')
          return HttpResponse.json({
            task,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-detail1" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText('Detailed task')).toBeInTheDocument()
        expect(screen.getByText('This is the task description')).toBeInTheDocument()
        expect(screen.getByText('active')).toBeInTheDocument()
        expect(screen.getByText('750')).toBeInTheDocument()
      })
    })

    it('displays task ID', async () => {
      const task = createTask({ id: 'tx-myid123' })

      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-myid123" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText('tx-myid123')).toBeInTheDocument()
      })
    })

    it('shows Ready badge when task isReady', async () => {
      const task = createTask({ id: 'tx-ready1', isReady: true })

      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-ready1" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText('Ready')).toBeInTheDocument()
      })
    })

    it('shows timestamps', async () => {
      const task = createTask({
        id: 'tx-timestamps',
        created_at: '2026-01-30T12:00:00Z',
        updated_at: '2026-01-30T14:00:00Z',
        completed_at: '2026-01-30T16:00:00Z',
      })

      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-timestamps" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText(/Created:/)).toBeInTheDocument()
        expect(screen.getByText(/Updated:/)).toBeInTheDocument()
        expect(screen.getByText(/Completed:/)).toBeInTheDocument()
      })
    })
  })

  describe('parent task', () => {
    it('shows parent task link when parent_id is set', async () => {
      const task = createTask({
        id: 'tx-child1',
        parent_id: 'tx-parent1',
      })

      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-child1" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText('tx-parent1')).toBeInTheDocument()
      })

      // Click parent link
      fireEvent.click(screen.getByText('tx-parent1'))
      expect(onNavigate).toHaveBeenCalledWith('tx-parent1')
    })
  })

  describe('blockedBy tasks', () => {
    it('shows blockedBy tasks as clickable', async () => {
      const task = createTask({
        id: 'tx-blocked1',
        blockedBy: ['tx-blocker1', 'tx-blocker2'],
      })

      const blockerTask1 = createTask({
        id: 'tx-blocker1',
        title: 'Blocker task 1',
        status: 'active',
      })

      const blockerTask2 = createTask({
        id: 'tx-blocker2',
        title: 'Blocker task 2',
        status: 'done',
      })

      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task,
            blockedByTasks: [blockerTask1, blockerTask2],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-blocked1" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText('Blocked By (2)')).toBeInTheDocument()
        expect(screen.getByText('Blocker task 1')).toBeInTheDocument()
        expect(screen.getByText('Blocker task 2')).toBeInTheDocument()
      })

      // Click one of the blocker tasks
      fireEvent.click(screen.getByText('Blocker task 1'))
      expect(onNavigate).toHaveBeenCalledWith('tx-blocker1')
    })

    it('shows empty message when no blockers', async () => {
      const task = createTask({
        id: 'tx-unblocked',
        blockedBy: [],
      })

      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-unblocked" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText('Blocked By (0)')).toBeInTheDocument()
        expect(
          screen.getByText('No blockers - this task is unblocked')
        ).toBeInTheDocument()
      })
    })
  })

  describe('blocks tasks', () => {
    it('shows blocks tasks as clickable', async () => {
      const task = createTask({
        id: 'tx-blocker1',
        blocks: ['tx-blocked1', 'tx-blocked2'],
      })

      const blockedTask1 = createTask({
        id: 'tx-blocked1',
        title: 'Blocked task 1',
        status: 'blocked',
      })

      const blockedTask2 = createTask({
        id: 'tx-blocked2',
        title: 'Blocked task 2',
        status: 'blocked',
      })

      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task,
            blockedByTasks: [],
            blocksTasks: [blockedTask1, blockedTask2],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-blocker1" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText('Blocks (2)')).toBeInTheDocument()
        expect(screen.getByText('Blocked task 1')).toBeInTheDocument()
        expect(screen.getByText('Blocked task 2')).toBeInTheDocument()
      })

      // Click one of the blocked tasks
      fireEvent.click(screen.getByText('Blocked task 2'))
      expect(onNavigate).toHaveBeenCalledWith('tx-blocked2')
    })

    it('shows empty message when task blocks nothing', async () => {
      const task = createTask({
        id: 'tx-noblockers',
        blocks: [],
      })

      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-noblockers" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText('Blocks (0)')).toBeInTheDocument()
        expect(
          screen.getByText('Does not block any other tasks')
        ).toBeInTheDocument()
      })
    })
  })

  describe('children tasks', () => {
    it('shows children tasks as clickable', async () => {
      const task = createTask({
        id: 'tx-parent1',
        children: ['tx-child1', 'tx-child2', 'tx-child3'],
      })

      const childTask1 = createTask({
        id: 'tx-child1',
        title: 'Child task 1',
        parent_id: 'tx-parent1',
      })

      const childTask2 = createTask({
        id: 'tx-child2',
        title: 'Child task 2',
        parent_id: 'tx-parent1',
      })

      const childTask3 = createTask({
        id: 'tx-child3',
        title: 'Child task 3',
        parent_id: 'tx-parent1',
      })

      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [childTask1, childTask2, childTask3],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-parent1" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText('Children (3)')).toBeInTheDocument()
        expect(screen.getByText('Child task 1')).toBeInTheDocument()
        expect(screen.getByText('Child task 2')).toBeInTheDocument()
        expect(screen.getByText('Child task 3')).toBeInTheDocument()
      })

      // Click one of the children
      fireEvent.click(screen.getByText('Child task 2'))
      expect(onNavigate).toHaveBeenCalledWith('tx-child2')
    })

    it('shows empty message when no children', async () => {
      const task = createTask({
        id: 'tx-nochildren',
        children: [],
      })

      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-nochildren" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText('Children (0)')).toBeInTheDocument()
        expect(screen.getByText('No child tasks')).toBeInTheDocument()
      })
    })
  })

  describe('error state', () => {
    it('shows error when API fails', async () => {
      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json(
            { error: 'Task not found' },
            { status: 404 }
          )
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-notfound" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText(/Error loading task/)).toBeInTheDocument()
      })
    })
  })

  describe('task not found', () => {
    it('shows not found message when task is null', async () => {
      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json(null)
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-missing" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText('Task not found')).toBeInTheDocument()
      })
    })
  })

  describe('related task cards', () => {
    it('shows status badges on related tasks', async () => {
      const task = createTask({
        id: 'tx-main',
        blocks: ['tx-blocked1'],
      })

      const blockedTask = createTask({
        id: 'tx-blocked1',
        title: 'Blocked task',
        status: 'blocked',
        score: 600,
      })

      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task,
            blockedByTasks: [],
            blocksTasks: [blockedTask],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      renderWithProviders(
        <TaskDetail taskId="tx-main" onNavigateToTask={onNavigate} />
      )

      await waitFor(() => {
        expect(screen.getByText('Blocked task')).toBeInTheDocument()
        // Look for the blocked status in the related tasks section
        const blocksSection = screen.getByText('Blocks (1)').parentElement
        expect(blocksSection?.textContent).toContain('blocked')
        expect(blocksSection?.textContent).toContain('600')
      })
    })
  })
})
