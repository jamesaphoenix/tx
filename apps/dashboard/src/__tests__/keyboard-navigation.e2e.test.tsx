import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/setup'
import App from '../App'
import type {
  PaginatedTasksResponse,
  TaskWithDeps,
  StatsResponse,
  RalphResponse,
  RunsResponse,
  TaskDetailResponse,
} from '../api/client'

// =============================================================================
// Test Fixtures
// =============================================================================

function createTask(overrides: Partial<TaskWithDeps> = {}): TaskWithDeps {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 10)}`,
    title: 'Test task',
    description: 'Test description',
    status: 'ready',
    parentId: null,
    score: 500,
    createdAt: '2026-01-30T12:00:00Z',
    updatedAt: '2026-01-30T12:00:00Z',
    completedAt: null,
    metadata: {},
    blockedBy: [],
    blocks: [],
    children: [],
    isReady: true,
    ...overrides,
  }
}

const defaultStats: StatsResponse = {
  tasks: 10,
  done: 3,
  ready: 5,
  learnings: 20,
  runsRunning: 1,
  runsTotal: 15,
}

const defaultRalph: RalphResponse = {
  running: false,
  pid: null,
  currentIteration: 0,
  currentTask: null,
  recentActivity: [],
}

const defaultRuns: RunsResponse = {
  runs: [],
}


// =============================================================================
// Test Setup
// =============================================================================

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

function renderApp() {
  const queryClient = createTestQueryClient()
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    ),
    queryClient,
  }
}

function dispatchKeyEvent(key: string) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  })
  window.dispatchEvent(event)
}


// =============================================================================
// E2E Tests: Keyboard Navigation and Detail Panel
// =============================================================================

describe('E2E: Keyboard Navigation and Detail Panel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/')
    // Set up default handlers for all endpoints
    server.use(
      http.get('/api/stats', () => HttpResponse.json(defaultStats)),
      http.get('/api/ralph', () => HttpResponse.json(defaultRalph)),
      http.get('/api/runs', () => HttpResponse.json(defaultRuns)),
      http.get('/api/tasks', () => {
        return HttpResponse.json({
          tasks: [],
          nextCursor: null,
          hasMore: false,
          total: 0,
          summary: { total: 0, byStatus: {} },
        } satisfies PaginatedTasksResponse)
      }),
      http.get('/api/tasks/ready', () => HttpResponse.json({ tasks: [] })),
      http.get('/api/tasks/:id', ({ params }) => {
        const id = String(params.id)
        return HttpResponse.json({
          task: createTask({ id, title: `Task ${id}` }),
          blockedByTasks: [],
          blocksTasks: [],
          childTasks: [],
        } satisfies TaskDetailResponse)
      }),
      http.get('/api/labels', () => HttpResponse.json({ labels: [] }))
    )
  })

  afterEach(() => {
    server.resetHandlers()
  })

  describe('Arrow Keys Navigation', () => {
    it('navigates down through tasks with ArrowDown', async () => {
      const tasks = [
        createTask({ id: 'tx-task1', title: 'First Task' }),
        createTask({ id: 'tx-task2', title: 'Second Task' }),
        createTask({ id: 'tx-task3', title: 'Third Task' }),
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

      const { container } = renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      // Wait for tasks to load
      await waitFor(() => {
        expect(screen.getByText('First Task')).toBeInTheDocument()
      })

      // First task should be focused (tabIndex=0)
      const cards = container.querySelectorAll('[tabindex]')
      const taskCards = Array.from(cards).filter(
        (el) => el.textContent?.includes('Task')
      )
      expect(taskCards[0]).toHaveAttribute('tabIndex', '0')

      // Press ArrowDown to move focus
      act(() => {
        dispatchKeyEvent('ArrowDown')
      })

      // Second task should now be focused
      await waitFor(() => {
        const updatedCards = container.querySelectorAll('[tabindex]')
        const updatedTaskCards = Array.from(updatedCards).filter(
          (el) => el.textContent?.includes('Task')
        )
        expect(updatedTaskCards[1]).toHaveAttribute('tabIndex', '0')
        expect(updatedTaskCards[0]).toHaveAttribute('tabIndex', '-1')
      })
    })

    it('navigates up through tasks with ArrowUp', async () => {
      const tasks = [
        createTask({ id: 'tx-task1', title: 'First Task' }),
        createTask({ id: 'tx-task2', title: 'Second Task' }),
        createTask({ id: 'tx-task3', title: 'Third Task' }),
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

      const { container } = renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      // Wait for tasks to load
      await waitFor(() => {
        expect(screen.getByText('First Task')).toBeInTheDocument()
      })

      // Move down twice to get to third task
      act(() => {
        dispatchKeyEvent('ArrowDown')
        dispatchKeyEvent('ArrowDown')
      })

      // Third task should be focused
      await waitFor(() => {
        const cards = container.querySelectorAll('[tabindex]')
        const taskCards = Array.from(cards).filter(
          (el) => el.textContent?.includes('Task')
        )
        expect(taskCards[2]).toHaveAttribute('tabIndex', '0')
      })

      // Press ArrowUp to go back
      act(() => {
        dispatchKeyEvent('ArrowUp')
      })

      // Second task should now be focused
      await waitFor(() => {
        const updatedCards = container.querySelectorAll('[tabindex]')
        const updatedTaskCards = Array.from(updatedCards).filter(
          (el) => el.textContent?.includes('Task')
        )
        expect(updatedTaskCards[1]).toHaveAttribute('tabIndex', '0')
        expect(updatedTaskCards[2]).toHaveAttribute('tabIndex', '-1')
      })
    })

    it('stops at first task when pressing ArrowUp at top', async () => {
      const tasks = [
        createTask({ id: 'tx-task1', title: 'First Task' }),
        createTask({ id: 'tx-task2', title: 'Second Task' }),
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

      const { container } = renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('First Task')).toBeInTheDocument()
      })

      // Press ArrowUp multiple times at top
      act(() => {
        dispatchKeyEvent('ArrowUp')
        dispatchKeyEvent('ArrowUp')
        dispatchKeyEvent('ArrowUp')
      })

      // First task should still be focused
      await waitFor(() => {
        const cards = container.querySelectorAll('[tabindex]')
        const taskCards = Array.from(cards).filter(
          (el) => el.textContent?.includes('Task')
        )
        expect(taskCards[0]).toHaveAttribute('tabIndex', '0')
      })
    })

    it('stops at last task when pressing ArrowDown at bottom', async () => {
      const tasks = [
        createTask({ id: 'tx-task1', title: 'First Task' }),
        createTask({ id: 'tx-task2', title: 'Second Task' }),
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

      const { container } = renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('First Task')).toBeInTheDocument()
      })

      // Press ArrowDown multiple times
      act(() => {
        dispatchKeyEvent('ArrowDown')
        dispatchKeyEvent('ArrowDown')
        dispatchKeyEvent('ArrowDown')
        dispatchKeyEvent('ArrowDown')
      })

      // Last task should be focused
      await waitFor(() => {
        const cards = container.querySelectorAll('[tabindex]')
        const taskCards = Array.from(cards).filter(
          (el) => el.textContent?.includes('Task')
        )
        expect(taskCards[1]).toHaveAttribute('tabIndex', '0')
      })
    })
  })

  describe('Vim Keys Navigation (j/k)', () => {
    it('navigates down through tasks with j key', async () => {
      const tasks = [
        createTask({ id: 'tx-task1', title: 'First Task' }),
        createTask({ id: 'tx-task2', title: 'Second Task' }),
        createTask({ id: 'tx-task3', title: 'Third Task' }),
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

      const { container } = renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('First Task')).toBeInTheDocument()
      })

      // Press j to move down
      act(() => {
        dispatchKeyEvent('j')
      })

      // Second task should be focused
      await waitFor(() => {
        const cards = container.querySelectorAll('[tabindex]')
        const taskCards = Array.from(cards).filter(
          (el) => el.textContent?.includes('Task')
        )
        expect(taskCards[1]).toHaveAttribute('tabIndex', '0')
        expect(taskCards[0]).toHaveAttribute('tabIndex', '-1')
      })

      // Press j again
      act(() => {
        dispatchKeyEvent('j')
      })

      // Third task should be focused
      await waitFor(() => {
        const cards = container.querySelectorAll('[tabindex]')
        const taskCards = Array.from(cards).filter(
          (el) => el.textContent?.includes('Task')
        )
        expect(taskCards[2]).toHaveAttribute('tabIndex', '0')
      })
    })

    it('navigates up through tasks with k key', async () => {
      const tasks = [
        createTask({ id: 'tx-task1', title: 'First Task' }),
        createTask({ id: 'tx-task2', title: 'Second Task' }),
        createTask({ id: 'tx-task3', title: 'Third Task' }),
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

      const { container } = renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('First Task')).toBeInTheDocument()
      })

      // Move to third task with j
      act(() => {
        dispatchKeyEvent('j')
        dispatchKeyEvent('j')
      })

      // Press k to move up
      act(() => {
        dispatchKeyEvent('k')
      })

      // Second task should be focused
      await waitFor(() => {
        const cards = container.querySelectorAll('[tabindex]')
        const taskCards = Array.from(cards).filter(
          (el) => el.textContent?.includes('Task')
        )
        expect(taskCards[1]).toHaveAttribute('tabIndex', '0')
        expect(taskCards[2]).toHaveAttribute('tabIndex', '-1')
      })
    })

    it('j and k keys work the same as ArrowDown and ArrowUp', async () => {
      const tasks = [
        createTask({ id: 'tx-task1', title: 'First Task' }),
        createTask({ id: 'tx-task2', title: 'Second Task' }),
        createTask({ id: 'tx-task3', title: 'Third Task' }),
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

      const { container } = renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('First Task')).toBeInTheDocument()
      })

      // Mix j/k with arrow keys
      act(() => {
        dispatchKeyEvent('j') // Move to second
        dispatchKeyEvent('ArrowDown') // Move to third
        dispatchKeyEvent('k') // Move back to second
        dispatchKeyEvent('ArrowUp') // Move back to first
      })

      // Should be back at first task
      await waitFor(() => {
        const cards = container.querySelectorAll('[tabindex]')
        const taskCards = Array.from(cards).filter(
          (el) => el.textContent?.includes('Task')
        )
        expect(taskCards[0]).toHaveAttribute('tabIndex', '0')
      })
    })
  })

  describe('Enter Opens Detail Panel', () => {
    it('pressing Enter opens the task detail panel', async () => {
      const tasks = [
        createTask({
          id: 'tx-detail1',
          title: 'Task With Details',
          description: 'This task has a detailed description',
          score: 750,
        }),
      ]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        }),
        http.get('/api/tasks/:id', ({ params }) => {
          return HttpResponse.json({
            task: tasks.find((t) => t.id === params.id) ?? tasks[0],
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      // Wait for tasks to load
      await waitFor(() => {
        expect(screen.getByText('Task With Details')).toBeInTheDocument()
      })

      // Press Enter to open detail panel
      act(() => {
        dispatchKeyEvent('Enter')
      })

      // Detail panel should show the task
      await waitFor(() => {
        // Should see the description in the detail view
        expect(screen.getByText('This task has a detailed description')).toBeInTheDocument()
        // Should see the score
        expect(screen.getByText('750')).toBeInTheDocument()
      })
    })

    it('pressing Enter on second task opens its detail panel', async () => {
      const tasks = [
        createTask({ id: 'tx-task1', title: 'First Task' }),
        createTask({
          id: 'tx-task2',
          title: 'Second Task',
          description: 'Details for second task',
        }),
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
        }),
        http.get('/api/tasks/:id', ({ params }) => {
          const task = tasks.find((t) => t.id === params.id)
          return HttpResponse.json({
            task: task ?? tasks[0],
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('First Task')).toBeInTheDocument()
      })

      // Navigate to second task
      act(() => {
        dispatchKeyEvent('ArrowDown')
      })

      // Press Enter to open detail panel
      act(() => {
        dispatchKeyEvent('Enter')
      })

      // Should show second task details
      await waitFor(() => {
        expect(screen.getByText('Details for second task')).toBeInTheDocument()
      })
    })
  })

  describe('Escape Closes Panel', () => {
    it('pressing Escape closes the detail panel', async () => {
      const tasks = [
        createTask({
          id: 'tx-close1',
          title: 'Task To Close',
          description: 'Panel should close with Escape',
        }),
      ]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        }),
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task: tasks[0],
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('Task To Close')).toBeInTheDocument()
      })

      // Open detail panel
      act(() => {
        dispatchKeyEvent('Enter')
      })

      await waitFor(() => {
        expect(screen.getByText('Panel should close with Escape')).toBeInTheDocument()
      })

      // Press Escape to close
      act(() => {
        dispatchKeyEvent('Escape')
      })

      // Should return to list view
      await waitFor(() => {
        expect(screen.getByText('Task To Close')).toBeInTheDocument()
        expect(screen.queryByText('Panel should close with Escape')).not.toBeInTheDocument()
      })
    })
  })

  describe('Click Opens Panel', () => {
    it('clicking a task opens the detail panel', async () => {
      const tasks = [
        createTask({
          id: 'tx-click1',
          title: 'Clickable Task',
          description: 'Opened by clicking',
        }),
      ]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        }),
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task: tasks[0],
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('Clickable Task')).toBeInTheDocument()
      })

      // Click on the task
      fireEvent.click(screen.getByText('Clickable Task'))

      // Detail panel should open
      await waitFor(() => {
        expect(screen.getByText('Opened by clicking')).toBeInTheDocument()
      })
    })

    it('clicking a different task switches the detail panel', async () => {
      const tasks = [
        createTask({ id: 'tx-click1', title: 'First Clickable', description: 'First description' }),
        createTask({ id: 'tx-click2', title: 'Second Clickable', description: 'Second description' }),
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
        }),
        http.get('/api/tasks/:id', ({ params }) => {
          const task = tasks.find((t) => t.id === params.id)
          return HttpResponse.json({
            task: task ?? tasks[0],
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('First Clickable')).toBeInTheDocument()
      })

      // Click first task
      fireEvent.click(screen.getByText('First Clickable'))

      await waitFor(() => {
        expect(screen.getByText('First description')).toBeInTheDocument()
      })

      // Go back to list and open second task
      fireEvent.click(screen.getByRole('button', { name: '← Back to Tasks' }))
      await waitFor(() => {
        expect(screen.getByText('Second Clickable')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText('Second Clickable'))

      await waitFor(() => {
        expect(screen.getByText('Second description')).toBeInTheDocument()
      })
    })
  })

  describe('Related Tasks Clickable in Panel', () => {
    it('clicking blockedBy task navigates to that task', async () => {
      const blockerTask = createTask({
        id: 'tx-blocker1',
        title: 'Blocker Task',
        description: 'This task blocks others',
        status: 'active',
      })

      const blockedTask = createTask({
        id: 'tx-blocked1',
        title: 'Blocked Task',
        description: 'This task is blocked',
        blockedBy: ['tx-blocker1'],
        isReady: false,
      })

      const tasks = [blockedTask, blockerTask]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 2,
            summary: { total: 2, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        }),
        http.get('/api/tasks/:id', ({ params }) => {
          const task = tasks.find((t) => t.id === params.id)
          if (params.id === 'tx-blocked1') {
            return HttpResponse.json({
              task: blockedTask,
              blockedByTasks: [blockerTask],
              blocksTasks: [],
              childTasks: [],
            } satisfies TaskDetailResponse)
          }
          return HttpResponse.json({
            task: task ?? blockerTask,
            blockedByTasks: [],
            blocksTasks: [blockedTask],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('Blocked Task')).toBeInTheDocument()
      })

      // Click on blocked task to open its detail panel
      fireEvent.click(screen.getByText('Blocked Task'))

      // Wait for detail panel to show blockedBy section
      await waitFor(() => {
        expect(screen.getByText('Blocked By (1)')).toBeInTheDocument()
      })

      // Find all elements with 'Blocker Task' text - the h4 element is in the detail panel's RelatedTaskCard
      const blockerElements = screen.getAllByText('Blocker Task')
      const detailBlockerElement = blockerElements.find(el => el.tagName === 'H4')
      expect(detailBlockerElement).toBeTruthy()

      // Click the card button that wraps the related task
      const clickableButton = detailBlockerElement?.closest('button')
      expect(clickableButton).toBeTruthy()
      if (clickableButton) {
        fireEvent.click(clickableButton)
      }

      // Should now show blocker task details
      await waitFor(() => {
        expect(screen.getByText('This task blocks others')).toBeInTheDocument()
      })
    })

    it('clicking blocks task navigates to that task', async () => {
      const blockerTask = createTask({
        id: 'tx-blocker1',
        title: 'Blocker Task',
        description: 'This task blocks others',
        blocks: ['tx-blocked1'],
      })

      const blockedTask = createTask({
        id: 'tx-blocked1',
        title: 'Blocked Task',
        description: 'This task is blocked by another',
        blockedBy: ['tx-blocker1'],
      })

      const tasks = [blockerTask, blockedTask]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 2,
            summary: { total: 2, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        }),
        http.get('/api/tasks/:id', ({ params }) => {
          if (params.id === 'tx-blocker1') {
            return HttpResponse.json({
              task: blockerTask,
              blockedByTasks: [],
              blocksTasks: [blockedTask],
              childTasks: [],
            } satisfies TaskDetailResponse)
          }
          return HttpResponse.json({
            task: blockedTask,
            blockedByTasks: [blockerTask],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('Blocker Task')).toBeInTheDocument()
      })

      // Click on blocker task
      fireEvent.click(screen.getByText('Blocker Task'))

      // Wait for detail panel with blocks section
      await waitFor(() => {
        expect(screen.getByText('Blocks (1)')).toBeInTheDocument()
      })

      // Find the blocked task in the blocks section - the h4 element is in the RelatedTaskCard
      const blockedElements = screen.getAllByText('Blocked Task')
      const detailBlockedElement = blockedElements.find(el => el.tagName === 'H4')
      expect(detailBlockedElement).toBeTruthy()

      // Click the card button that wraps the related task
      const clickableButton = detailBlockedElement?.closest('button')
      expect(clickableButton).toBeTruthy()
      if (clickableButton) {
        fireEvent.click(clickableButton)
      }

      // Should now show blocked task details
      await waitFor(() => {
        expect(screen.getByText('This task is blocked by another')).toBeInTheDocument()
      })
    })

    it('clicking child task navigates to that task', async () => {
      const parentTask = createTask({
        id: 'tx-parent1',
        title: 'Parent Task',
        description: 'This is the parent',
        children: ['tx-child1'],
      })

      const childTask = createTask({
        id: 'tx-child1',
        title: 'Child Task',
        description: 'This is the child',
        parentId: 'tx-parent1',
      })

      const tasks = [parentTask, childTask]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 2,
            summary: { total: 2, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        }),
        http.get('/api/tasks/:id', ({ params }) => {
          if (params.id === 'tx-parent1') {
            return HttpResponse.json({
              task: parentTask,
              blockedByTasks: [],
              blocksTasks: [],
              childTasks: [childTask],
            } satisfies TaskDetailResponse)
          }
          return HttpResponse.json({
            task: childTask,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('Parent Task')).toBeInTheDocument()
      })

      // Click on parent task
      fireEvent.click(screen.getByText('Parent Task'))

      // Wait for detail panel with children section
      await waitFor(() => {
        expect(screen.getByText('Children (1)')).toBeInTheDocument()
      })

      // Find the child task in the children section - the h4 element is in the RelatedTaskCard
      const childElements = screen.getAllByText('Child Task')
      const detailChildElement = childElements.find(el => el.tagName === 'H4')
      expect(detailChildElement).toBeTruthy()

      // Click the card button that wraps the child task
      const clickableButton = detailChildElement?.closest('button')
      expect(clickableButton).toBeTruthy()
      if (clickableButton) {
        fireEvent.click(clickableButton)
      }

      // Should now show child task details
      await waitFor(() => {
        expect(screen.getByText('This is the child')).toBeInTheDocument()
      })
    })

    it('clicking parent link navigates to parent task', async () => {
      const parentTask = createTask({
        id: 'tx-parent1',
        title: 'Parent Task',
        description: 'This is the parent task',
        children: ['tx-child1'],
      })

      const childTask = createTask({
        id: 'tx-child1',
        title: 'Child Task',
        description: 'This is the child',
        parentId: 'tx-parent1',
      })

      const tasks = [parentTask, childTask]

      server.use(
        http.get('/api/tasks', () => {
          return HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 2,
            summary: { total: 2, byStatus: {} },
          } satisfies PaginatedTasksResponse)
        }),
        http.get('/api/tasks/:id', ({ params }) => {
          if (params.id === 'tx-child1') {
            return HttpResponse.json({
              task: childTask,
              blockedByTasks: [],
              blocksTasks: [],
              childTasks: [],
            } satisfies TaskDetailResponse)
          }
          return HttpResponse.json({
            task: parentTask,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [childTask],
          } satisfies TaskDetailResponse)
        })
      )

      renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('Child Task')).toBeInTheDocument()
      })

      // Click on child task
      fireEvent.click(screen.getByText('Child Task'))

      // Wait for detail panel to show parent link
      await waitFor(() => {
        expect(screen.getByText('tx-parent1')).toBeInTheDocument()
      })

      // Click on parent ID link
      fireEvent.click(screen.getByText('tx-parent1'))

      // Should now show parent task details
      await waitFor(() => {
        expect(screen.getByText('This is the parent task')).toBeInTheDocument()
      })
    })
  })

  describe('Keyboard Navigation Edge Cases', () => {
    it('does not navigate when typing in search input', async () => {
      const tasks = [
        createTask({ id: 'tx-task1', title: 'First Task' }),
        createTask({ id: 'tx-task2', title: 'Second Task' }),
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

      const { container } = renderApp()

      // Switch to Tasks tab
      await waitFor(() => {
        const tasksTab = screen.getByRole('button', { name: /tasks/i })
        fireEvent.click(tasksTab)
      })

      await waitFor(() => {
        expect(screen.getByText('First Task')).toBeInTheDocument()
      })

      // Find search input and focus it
      const searchInput = screen.getByPlaceholderText(/search/i)
      searchInput.focus()

      // Type j and k in the search input - should NOT navigate
      fireEvent.keyDown(searchInput, { key: 'j' })
      fireEvent.keyDown(searchInput, { key: 'k' })

      // Focus should still be on first task (navigation didn't happen)
      await waitFor(() => {
        const cards = container.querySelectorAll('[tabindex]')
        const taskCards = Array.from(cards).filter(
          (el) => el.textContent?.includes('Task')
        )
        expect(taskCards[0]).toHaveAttribute('tabIndex', '0')
      })
    })
  })
})
