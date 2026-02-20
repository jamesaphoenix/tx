import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/setup'
import App from '../App'
import { selectionStore, selectionActions } from '../stores/selection-store'
import type { PaginatedTasksResponse, TaskWithDeps } from '../api/client'

// ─── Fixtures ──────────────────────────────────────────────────────────

function createTask(overrides: Partial<TaskWithDeps> = {}): TaskWithDeps {
  return {
    id: `tx-${Math.random().toString(36).slice(2, 10)}`,
    title: 'Test task',
    description: '',
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

// ─── Helpers ───────────────────────────────────────────────────────────

function dispatchKeyCombo(key: string, meta = false, ctrl = false) {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: meta,
    ctrlKey: ctrl,
    bubbles: true,
    cancelable: true,
  })
  window.dispatchEvent(event)
}

/** Set up default API mocks that return empty data */
function setupEmptyApiMocks() {
  server.use(
    http.get('/api/stats', () =>
      HttpResponse.json({ tasks: 0, done: 0, ready: 0, learnings: 0, runsRunning: 0, runsTotal: 0 })
    ),
    http.get('/api/ralph', () =>
      HttpResponse.json({ running: false, pid: null, currentIteration: 0, currentTask: null, recentActivity: [] })
    ),
    http.get('/api/tasks', () =>
      HttpResponse.json({
        tasks: [], nextCursor: null, hasMore: false, total: 0,
        summary: { total: 0, byStatus: {} },
      } satisfies PaginatedTasksResponse)
    ),
    http.get('/api/tasks/:id', ({ params }) =>
      HttpResponse.json({
        task: createTask({ id: String(params.id), title: `Task ${String(params.id)}` }),
        blockedByTasks: [],
        blocksTasks: [],
        childTasks: [],
      })
    ),
    http.get('/api/tasks/ready', () =>
      HttpResponse.json({ tasks: [] })
    ),
    http.get('/api/labels', () =>
      HttpResponse.json({ labels: [] })
    ),
    http.get('/api/runs', () =>
      HttpResponse.json({ runs: [], nextCursor: null, hasMore: false })
    ),
    http.get('/api/docs', () =>
      HttpResponse.json({ docs: [] })
    ),
    http.get('/api/docs/graph', () =>
      HttpResponse.json({ nodes: [], edges: [] })
    ),
    http.get('/api/cycles', () =>
      HttpResponse.json({ cycles: [] })
    ),
  )
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('Keyboard shortcuts', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    selectionActions.clearAll()
    window.history.replaceState({}, "", "/")
    queryClient = createTestQueryClient()
    setupEmptyApiMocks()
  })

  afterEach(() => {
    server.resetHandlers()
    selectionActions.clearAll()
  })

  function renderApp() {
    return render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    )
  }

  describe('CMD+A selects all loaded items on Tasks tab', () => {
    it('selects tasks from first page', async () => {
      const page1Tasks = [
        createTask({ id: 'tx-001', title: 'Task 1' }),
        createTask({ id: 'tx-002', title: 'Task 2' }),
        createTask({ id: 'tx-003', title: 'Task 3' }),
      ]

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: page1Tasks,
            nextCursor: null,
            hasMore: false,
            total: 3,
            summary: { total: 3, byStatus: { ready: 3 } },
          } satisfies PaginatedTasksResponse)
        ),
      )

      renderApp()

      // Switch to Tasks tab
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      // Wait for tasks to load
      await waitFor(() => {
        expect(screen.getByText('Task 1')).toBeInTheDocument()
      })

      // Press CMD+A
      act(() => {
        dispatchKeyCombo('a', true)
      })

      // All task IDs should be selected
      await waitFor(() => {
        const state = selectionStore.state
        expect(state.taskIds.has('tx-001')).toBe(true)
        expect(state.taskIds.has('tx-002')).toBe(true)
        expect(state.taskIds.has('tx-003')).toBe(true)
        expect(state.taskIds.size).toBe(3)
      })
    })

    it('keeps native select-all in search input and does not select tasks', async () => {
      const tasks = [
        createTask({ id: 'tx-focus-001', title: 'Focus Task 1' }),
        createTask({ id: 'tx-focus-002', title: 'Focus Task 2' }),
      ]

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: 2,
            summary: { total: 2, byStatus: { ready: 2 } },
          } satisfies PaginatedTasksResponse)
        ),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Focus Task 1')).toBeInTheDocument()
      })

      const searchInput = screen.getByPlaceholderText('Search tasks...')
      fireEvent.click(searchInput)

      act(() => {
        fireEvent.keyDown(searchInput, {
          key: 'a',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      })

      await waitFor(() => {
        expect(selectionStore.state.taskIds.size).toBe(0)
      })

      act(() => {
        fireEvent.keyDown(searchInput, {
          key: 'a',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
      })

      await waitFor(() => {
        expect(selectionStore.state.taskIds.size).toBe(0)
      })
    })

    it('selects tasks from BOTH pages after infinite scroll loads page 2', async () => {
      // This is the core bug test: CMD+A must include scrolled items
      const page1Tasks = [
        createTask({ id: 'tx-p1-001', title: 'Page 1 Task A' }),
        createTask({ id: 'tx-p1-002', title: 'Page 1 Task B' }),
      ]
      const page2Tasks = [
        createTask({ id: 'tx-p2-001', title: 'Page 2 Task C' }),
        createTask({ id: 'tx-p2-002', title: 'Page 2 Task D' }),
      ]

      server.use(
        http.get('/api/tasks', ({ request }) => {
          const url = new URL(request.url)
          const cursor = url.searchParams.get('cursor')

          if (cursor === 'page2') {
            return HttpResponse.json({
              tasks: page2Tasks,
              nextCursor: null,
              hasMore: false,
              total: 4,
              summary: { total: 4, byStatus: { ready: 4 } },
            } satisfies PaginatedTasksResponse)
          }

          return HttpResponse.json({
            tasks: page1Tasks,
            nextCursor: 'page2',
            hasMore: true,
            total: 4,
            summary: { total: 4, byStatus: { ready: 4 } },
          } satisfies PaginatedTasksResponse)
        }),
      )

      renderApp()

      // Switch to Tasks tab
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      // Wait for page 1 to load
      await waitFor(() => {
        expect(screen.getByText('Page 1 Task A')).toBeInTheDocument()
      })

      // Simulate infinite scroll by directly updating the query cache with both pages.
      // This mimics what happens when IntersectionObserver triggers fetchNextPage.
      await act(async () => {
        const queries = queryClient.getQueriesData({ queryKey: ['tasks', 'infinite'] })
        for (const [queryKey] of queries) {
          queryClient.setQueryData(queryKey, {
            pages: [
              {
                tasks: page1Tasks,
                nextCursor: 'page2',
                hasMore: true,
                total: 4,
                summary: { total: 4, byStatus: { ready: 4 } },
              },
              {
                tasks: page2Tasks,
                nextCursor: null,
                hasMore: false,
                total: 4,
                summary: { total: 4, byStatus: { ready: 4 } },
              },
            ],
            pageParams: [undefined, 'page2'],
          })
        }
      })

      // Wait for page 2 tasks to appear
      await waitFor(() => {
        expect(screen.getByText('Page 2 Task C')).toBeInTheDocument()
      })

      // Press CMD+A
      act(() => {
        dispatchKeyCombo('a', true)
      })

      // ALL tasks from both pages should be selected
      await waitFor(() => {
        const state = selectionStore.state
        expect(state.taskIds.has('tx-p1-001')).toBe(true)
        expect(state.taskIds.has('tx-p1-002')).toBe(true)
        expect(state.taskIds.has('tx-p2-001')).toBe(true)
        expect(state.taskIds.has('tx-p2-002')).toBe(true)
        expect(state.taskIds.size).toBe(4)
      })
    })
  })

  describe('CMD+A keeps native behavior in overlay inputs', () => {
    it('does not trigger list select-all from the command palette input', async () => {
      const tasks = [
        createTask({ id: 'tx-overlay-a', title: 'Overlay Task A' }),
        createTask({ id: 'tx-overlay-b', title: 'Overlay Task B' }),
      ]

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: tasks.length,
            summary: { total: tasks.length, byStatus: { ready: tasks.length } },
          } satisfies PaginatedTasksResponse)
        ),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Overlay Task A')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('k', true)
      })

      const paletteInput = await screen.findByPlaceholderText('Type a command...')
      fireEvent.change(paletteInput, { target: { value: 'Overlay' } })

      act(() => {
        fireEvent.keyDown(paletteInput, {
          key: 'a',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      })

      await waitFor(() => {
        expect(selectionStore.state.taskIds.size).toBe(0)
      })
    })

    it('does not trigger list select-all from task composer text fields', async () => {
      const tasks = [
        createTask({ id: 'tx-modal-a', title: 'Modal Task A' }),
        createTask({ id: 'tx-modal-b', title: 'Modal Task B' }),
      ]

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: tasks.length,
            summary: { total: tasks.length, byStatus: { ready: tasks.length } },
          } satisfies PaginatedTasksResponse)
        ),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Modal Task A')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'New Task' }))

      const titleInput = await screen.findByPlaceholderText('Task title')
      fireEvent.change(titleInput, { target: { value: 'Composer title' } })

      act(() => {
        fireEvent.keyDown(titleInput, {
          key: 'a',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      })

      await waitFor(() => {
        expect(selectionStore.state.taskIds.size).toBe(0)
      })
    })
  })

  describe('CMD+C copies item data', () => {
    it('does not intercept CMD+C when text is selected', async () => {
      const writeText = vi.fn()
      Object.assign(navigator, {
        clipboard: { writeText },
      })

      // Mock getSelection to return non-empty text
      const originalGetSelection = window.getSelection
      window.getSelection = vi.fn(() => ({
        toString: () => 'some selected text',
      })) as unknown as typeof window.getSelection

      renderApp()

      act(() => {
        dispatchKeyCombo('c', true)
      })

      // Should NOT have called clipboard.writeText (browser handles it)
      expect(writeText).not.toHaveBeenCalled()

      window.getSelection = originalGetSelection
    })
  })

  describe('CMD+K opens command palette everywhere', () => {
    it('opens from the task list and task detail views', async () => {
      const parentTask = createTask({ id: 'tx-parent-01', title: 'Parent task' })

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [parentTask],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { backlog: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ id: String(params.id), title: 'Parent task' }),
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          })
        ),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Parent task')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('k', true)
      })

      expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument()

      act(() => {
        dispatchKeyCombo('k', true)
      })

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Type a command...')).not.toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Parent task'))

      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('k', true)
      })

      expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument()
    })
  })

  describe('CMD+N behavior', () => {
    it('supports CTRL+N when no tasks are loaded in list view', async () => {
      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('No tasks found')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('n', false, true)
      })

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Task title')).toBeInTheDocument()
      })
    })

    it('opens task composer from Runs tab via global CTRL+N fallback', async () => {
      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Runs' }))
      })

      await waitFor(() => {
        expect(screen.getByText('No runs found')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('n', false, true)
      })

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Task title')).toBeInTheDocument()
      })
    })

    it('creates a sub-task when task detail is open', async () => {
      const parentTask = createTask({ id: 'tx-parent-open', title: 'Parent open task' })
      const createdTask = createTask({ id: 'tx-child-new', title: 'Child from shortcut', parentId: 'tx-parent-open' })
      const createPayloadRef: { current?: { parentId?: string; title?: string } } = {}

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [parentTask],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { backlog: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ id: String(params.id), title: 'Parent open task' }),
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          })
        ),
        http.post('/api/tasks', async ({ request }) => {
          createPayloadRef.current = await request.json() as { parentId?: string; title?: string }
          return HttpResponse.json(createdTask, { status: 201 })
        }),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Parent open task')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Parent open task'))

      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('n', true)
      })

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Task title')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByPlaceholderText('Task title'), {
        target: { value: 'Child from shortcut' },
      })

      fireEvent.click(screen.getByRole('button', { name: 'Create sub-task' }))

      await waitFor(() => {
        expect(createPayloadRef.current).toBeTruthy()
      })

      if (!createPayloadRef.current) {
        throw new Error('Expected create payload to be captured')
      }
      expect(createPayloadRef.current.parentId).toBe('tx-parent-open')
      expect(createPayloadRef.current.title).toBe('Child from shortcut')
    })

    it('supports CTRL+N for creating a new task from in-progress list view URL', async () => {
      const parentTask = createTask({ id: 'tx-parent-list', title: 'Parent list task' })

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [parentTask],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { backlog: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
      )

      window.history.replaceState({}, "", "/?taskBucket=in_progress")
      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Parent list task')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('n', false, true)
      })

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Task title')).toBeInTheDocument()
      })
    })

    it('supports CTRL+N when key value differs but KeyboardEvent.code is KeyN', async () => {
      const parentTask = createTask({ id: 'tx-parent-layout', title: 'Keyboard layout task' })

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [parentTask],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { backlog: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Keyboard layout task')).toBeInTheDocument()
      })

      act(() => {
        const event = new KeyboardEvent('keydown', {
          key: 'ñ',
          code: 'KeyN',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        })
        window.dispatchEvent(event)
      })

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Task title')).toBeInTheDocument()
      })
    })
  })

  describe('CMD+A in task detail', () => {
    it('selects all child tasks', async () => {
      const parentTask = createTask({ id: 'tx-parent-select', title: 'Parent with children' })
      const childA = createTask({ id: 'tx-child-a', title: 'Child A', parentId: 'tx-parent-select' })
      const childB = createTask({ id: 'tx-child-b', title: 'Child B', parentId: 'tx-parent-select' })

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [parentTask],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { backlog: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ id: String(params.id), title: 'Parent with children' }),
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [childA, childB],
          })
        ),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Parent with children')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Parent with children'))

      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      await act(async () => {
        queryClient.setQueryData(['task', 'tx-parent-select'], {
          task: parentTask,
          blockedByTasks: [],
          blocksTasks: [],
          childTasks: [childA, childB],
        })
      })

      act(() => {
        dispatchKeyCombo('a', true)
      })

      await waitFor(() => {
        expect(screen.getByText('Delete selected (2)')).toBeInTheDocument()
      })
    })

    it('keeps native select-all in description textarea and does not select children', async () => {
      const parentTask = createTask({
        id: 'tx-parent-select-native',
        title: 'Parent with editable description',
        description: 'Alpha Beta',
      })
      const childA = createTask({ id: 'tx-child-native-a', title: 'Native Child A', parentId: 'tx-parent-select-native' })
      const childB = createTask({ id: 'tx-child-native-b', title: 'Native Child B', parentId: 'tx-parent-select-native' })

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [parentTask],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { backlog: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({
              id: String(params.id),
              title: 'Parent with editable description',
              description: 'Alpha Beta',
            }),
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [childA, childB],
          })
        ),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Parent with editable description')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Parent with editable description'))

      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      await act(async () => {
        queryClient.setQueryData(['task', 'tx-parent-select-native'], {
          task: parentTask,
          blockedByTasks: [],
          blocksTasks: [],
          childTasks: [childA, childB],
        })
      })

      const descriptionInput = await screen.findByLabelText('Task description')
      fireEvent.focus(descriptionInput)
      fireEvent.keyDown(descriptionInput, {
        key: 'a',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })

      await waitFor(() => {
        expect(screen.queryByText('Delete selected (2)')).not.toBeInTheDocument()
      })
    })
  })

  describe('ESC clears selections', () => {
    it('clears all selections when ESC is pressed', async () => {
      renderApp()

      // Set some selections
      selectionActions.selectAllTasks(['tx-001', 'tx-002'])
      expect(selectionStore.state.taskIds.size).toBe(2)

      // Press ESC
      act(() => {
        dispatchKeyCombo('Escape')
      })

      await waitFor(() => {
        expect(selectionStore.state.taskIds.size).toBe(0)
      })
    })
  })
})
