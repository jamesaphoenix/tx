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
    assigneeType: 'agent',
    assigneeId: null,
    assignedAt: '2026-01-30T12:00:00Z',
    assignedBy: 'test',
    metadata: {},
    labels: [],
    blockedBy: [],
    blocks: [],
    children: [],
    isReady: true,
    groupContext: null,
    effectiveGroupContext: null,
    effectiveGroupContextSourceTaskId: null,
    orchestrationStatus: null,
    claimedBy: null,
    claimExpiresAt: null,
    failedAttempts: 0,
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

function dispatchKeyCombo(key: string, meta = false, ctrl = false, shift = false) {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: meta,
    ctrlKey: ctrl,
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  })
  window.dispatchEvent(event)
}

/** Set up default API mocks that return empty data */
function setupEmptyApiMocks() {
  server.use(
    http.get('/api/settings', () =>
      HttpResponse.json({
        dashboard: { defaultTaskAssigmentType: 'human', defaultTaskView: 'list' },
      })
    ),
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

  describe('CMD+A after tab transitions', () => {
    it('selects all tasks after navigating Runs -> Tasks', async () => {
      const tasks = [
        createTask({ id: 'tx-runs-to-tasks-1', title: 'Runs to Tasks 1' }),
        createTask({ id: 'tx-runs-to-tasks-2', title: 'Runs to Tasks 2' }),
      ]

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks,
            nextCursor: null,
            hasMore: false,
            total: tasks.length,
            summary: { total: tasks.length, byStatus: { backlog: tasks.length } },
          } satisfies PaginatedTasksResponse)
        ),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Runs' }))
      })
      await waitFor(() => {
        expect(screen.getByText('No runs found')).toBeInTheDocument()
      })

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Runs to Tasks 1')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('a', true)
      })

      await waitFor(() => {
        expect(selectionStore.state.taskIds.has('tx-runs-to-tasks-1')).toBe(true)
        expect(selectionStore.state.taskIds.has('tx-runs-to-tasks-2')).toBe(true)
      })
    })

    it('selects all docs after navigating Runs -> Docs', async () => {
      const docs = [
        {
          id: 1,
          hash: 'hash-1',
          kind: 'overview',
          name: 'overview-root',
          title: 'Overview Root',
          version: 1,
          status: 'changing',
          filePath: '/tmp/overview.md',
          parentDocId: null,
          createdAt: '2026-02-22T10:00:00.000Z',
          lockedAt: null,
        },
        {
          id: 2,
          hash: 'hash-2',
          kind: 'prd',
          name: 'PRD-001-testing',
          title: 'PRD Testing',
          version: 1,
          status: 'changing',
          filePath: '/tmp/prd.md',
          parentDocId: null,
          createdAt: '2026-02-22T10:00:00.000Z',
          lockedAt: null,
        },
      ]

      server.use(
        http.get('/api/docs', () => HttpResponse.json({ docs })),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Runs' }))
      })
      await waitFor(() => {
        expect(screen.getByText('No runs found')).toBeInTheDocument()
      })

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Specs' }))
      })

      await waitFor(() => {
        expect(screen.getByText('overview-root')).toBeInTheDocument()
        expect(screen.getByText('PRD-001-testing')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('a', true)
      })

      await waitFor(() => {
        expect(selectionStore.state.docNames.has('overview-root')).toBe(true)
        expect(selectionStore.state.docNames.has('PRD-001-testing')).toBe(true)
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

  describe('CMD+K behavior', () => {
    it('opens and closes command palette in task list', async () => {
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

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Parent list task')).toBeInTheDocument()
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
    })

    it('opens and closes command palette in task detail with CMD+K and CTRL+K', async () => {
      const parentTask = createTask({
        id: 'tx-parent-cmdk-detail',
        title: 'Parent cmdk detail task',
      })

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
            task: createTask({ id: String(params.id), title: 'Parent cmdk detail task' }),
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
        expect(screen.getByText('Parent cmdk detail task')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Parent cmdk detail task'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
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

      act(() => {
        dispatchKeyCombo('k', false, true)
      })
      expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument()
    })

    it('opens command palette in task detail with CMD+Shift+K fallback', async () => {
      const parentTask = createTask({ id: 'tx-parent-shift-k', title: 'Parent shift k task' })

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
            task: createTask({ id: String(params.id), title: 'Parent shift k task' }),
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
        expect(screen.getByText('Parent shift k task')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Parent shift k task'))

      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('k', true, false, true)
      })

      expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument()
    })

    it('opens command palette in task detail with CTRL+K when child selection is active', async () => {
      const parentTask = createTask({ id: 'tx-parent-ctrl-k', title: 'Parent ctrl k task' })
      const childA = createTask({ id: 'tx-child-ctrl-k-a', title: 'Child ctrl k A', parentId: 'tx-parent-ctrl-k' })
      const childB = createTask({ id: 'tx-child-ctrl-k-b', title: 'Child ctrl k B', parentId: 'tx-parent-ctrl-k' })

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
            task: createTask({ id: String(params.id), title: 'Parent ctrl k task' }),
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
        expect(screen.getByText('Parent ctrl k task')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Parent ctrl k task'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('a', true)
      })

      await waitFor(() => {
        expect(screen.getByText('Delete selected (2)')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('k', false, true)
      })

      expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument()
    })

    it('toggles assignment in task detail with CMD+Shift+A', async () => {
      const parentTask = createTask({
        id: 'tx-parent-toggle',
        title: 'Parent toggle task',
        assigneeType: 'human',
      })
      const patchPayloads: Array<{ assigneeType?: string | null }> = []

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
            task: createTask({ id: String(params.id), title: 'Parent toggle task', assigneeType: 'human' }),
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          })
        ),
        http.patch('/api/tasks/:id', async ({ params, request }) => {
          expect(params.id).toBe('tx-parent-toggle')
          const payload = await request.json() as { assigneeType?: string | null }
          patchPayloads.push(payload)
          return HttpResponse.json(createTask({
            id: 'tx-parent-toggle',
            title: 'Parent toggle task',
            assigneeType: payload.assigneeType === 'human' || payload.assigneeType === 'agent'
              ? payload.assigneeType
              : 'human',
          }))
        }),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Parent toggle task')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Parent toggle task'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('a', true, false, true)
      })

      await waitFor(() => {
        expect(patchPayloads.some((payload) => payload.assigneeType === 'agent')).toBe(true)
      })
      expect(screen.queryByPlaceholderText('Type a command...')).not.toBeInTheDocument()
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

    it('clears selected child tasks before navigating away from task detail', async () => {
      const parentTask = createTask({ id: 'tx-parent-esc', title: 'Parent esc task' })
      const childA = createTask({ id: 'tx-child-esc-a', title: 'Child esc A', parentId: 'tx-parent-esc' })
      const childB = createTask({ id: 'tx-child-esc-b', title: 'Child esc B', parentId: 'tx-parent-esc' })

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
            task: createTask({ id: String(params.id), title: 'Parent esc task' }),
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
        expect(screen.getByText('Parent esc task')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Parent esc task'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('a', true)
      })

      await waitFor(() => {
        expect(screen.getByText('Delete selected (2)')).toBeInTheDocument()
      })

      const beforeEscTaskId = new URLSearchParams(window.location.search).get('taskId')
      expect(beforeEscTaskId).toBe('tx-parent-esc')

      act(() => {
        dispatchKeyCombo('Escape')
      })

      await waitFor(() => {
        expect(screen.queryByText('Delete selected (2)')).not.toBeInTheDocument()
      })
      expect(screen.getByText('Properties')).toBeInTheDocument()
      const afterEscTaskId = new URLSearchParams(window.location.search).get('taskId')
      expect(afterEscTaskId).toBe('tx-parent-esc')
    })
  })

  describe('CMD+S cycle status shortcut', () => {
    it('pressing CMD+S in task detail sends the next status', async () => {
      let taskState = createTask({ id: 'tx-cycle-single', title: 'Cycle single', status: 'backlog' })
      const patchStatuses: string[] = []

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [taskState],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { backlog: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ ...taskState, id: String(params.id) }),
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          })
        ),
        http.patch('/api/tasks/:id', async ({ request }) => {
          const payload = await request.json() as { status?: string }
          if (payload.status) {
            patchStatuses.push(payload.status)
            taskState = createTask({ ...taskState, status: payload.status })
          }
          return HttpResponse.json(taskState)
        }),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Cycle single')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Cycle single'))

      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('s', true)
      })

      await waitFor(() => {
        expect(patchStatuses).toContain('ready')
      })
    })

    it('cycles through all 8 statuses and wraps back to backlog', async () => {
      let taskState = createTask({ id: 'tx-cycle-full', title: 'Cycle full', status: 'backlog' })
      const patchStatuses: string[] = []

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [taskState],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { backlog: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ ...taskState, id: String(params.id) }),
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          })
        ),
        http.patch('/api/tasks/:id', async ({ request }) => {
          const payload = await request.json() as { status?: string }
          if (payload.status) {
            patchStatuses.push(payload.status)
            taskState = createTask({ ...taskState, status: payload.status })
          }
          return HttpResponse.json(taskState)
        }),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Cycle full')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Cycle full'))

      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      const expectedOrder = ['ready', 'planning', 'active', 'blocked', 'review', 'needs_review', 'done', 'backlog']
      for (const [index, expected] of expectedOrder.entries()) {
        act(() => {
          dispatchKeyCombo('s', true)
        })
        await waitFor(() => {
          expect(patchStatuses.length).toBe(index + 1)
        })
        expect(patchStatuses[index]).toBe(expected)

        act(() => {
          dispatchKeyCombo('Escape')
        })
        await waitFor(() => {
          expect(screen.queryByText('Properties')).not.toBeInTheDocument()
        })

        fireEvent.click(screen.getByText('Cycle full'))
        await waitFor(() => {
          expect(screen.getByText('Properties')).toBeInTheDocument()
        })
      }

      expect(patchStatuses).toEqual(expectedOrder)
    })

    it('supports Ctrl+S as a variant', async () => {
      let taskState = createTask({ id: 'tx-cycle-ctrl', title: 'Cycle ctrl', status: 'planning' })
      const patchStatuses: string[] = []

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [taskState],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { planning: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ ...taskState, id: String(params.id) }),
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          })
        ),
        http.patch('/api/tasks/:id', async ({ request }) => {
          const payload = await request.json() as { status?: string }
          if (payload.status) {
            patchStatuses.push(payload.status)
            taskState = createTask({ ...taskState, status: payload.status })
          }
          return HttpResponse.json(taskState)
        }),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Cycle ctrl')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Cycle ctrl'))

      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('s', false, true)
      })

      await waitFor(() => {
        expect(patchStatuses).toContain('active')
      })
    })

    it('does not trigger in focused text inputs', async () => {
      let taskState = createTask({
        id: 'tx-cycle-input',
        title: 'Cycle input suppression',
        status: 'ready',
        description: 'Editable description',
      })
      const patchStatuses: string[] = []

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [taskState],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({
              ...taskState,
              id: String(params.id),
              description: 'Editable description',
            }),
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          })
        ),
        http.patch('/api/tasks/:id', async ({ request }) => {
          const payload = await request.json() as { status?: string }
          if (payload.status) {
            patchStatuses.push(payload.status)
            taskState = createTask({ ...taskState, status: payload.status })
          }
          return HttpResponse.json(taskState)
        }),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Cycle input suppression')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Cycle input suppression'))

      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      const descriptionInput = await screen.findByLabelText('Task description')
      fireEvent.focus(descriptionInput)

      fireEvent.keyDown(descriptionInput, {
        key: 's',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })
      fireEvent.keyDown(descriptionInput, {
        key: 's',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })

      await waitFor(() => {
        expect(patchStatuses).toHaveLength(0)
      })
      expect(taskState.status).toBe('ready')
    })
  })

  describe('CMD+L label shortcut', () => {
    it('calls window.prompt from task detail via CMD+L', async () => {
      const task = createTask({ id: 'tx-label-cmd', title: 'Label command task' })
      const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null)

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [task],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ ...task, id: String(params.id) }),
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
        expect(screen.getByText('Label command task')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Label command task'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('l', true)
      })

      await waitFor(() => {
        expect(promptSpy).toHaveBeenCalledWith('Label name:')
      })
    })

    it('supports Ctrl+L as a variant', async () => {
      const task = createTask({ id: 'tx-label-ctrl', title: 'Label ctrl task' })
      const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null)

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [task],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ ...task, id: String(params.id) }),
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
        expect(screen.getByText('Label ctrl task')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Label ctrl task'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('l', false, true)
      })

      await waitFor(() => {
        expect(promptSpy).toHaveBeenCalledWith('Label name:')
      })
    })

    it('works while an input is focused (allowInInput=true)', async () => {
      const task = createTask({
        id: 'tx-label-input',
        title: 'Label input task',
        description: 'Input-focused description',
      })
      const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue(null)

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [task],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({
              ...task,
              id: String(params.id),
              description: 'Input-focused description',
            }),
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
        expect(screen.getByText('Label input task')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Label input task'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      const descriptionInput = await screen.findByLabelText('Task description')
      fireEvent.focus(descriptionInput)
      fireEvent.keyDown(descriptionInput, {
        key: 'l',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      })

      await waitFor(() => {
        expect(promptSpy).toHaveBeenCalledWith('Label name:')
      })
    })
  })

  describe('CMD+Shift+N sub-task shortcut', () => {
    it('opens composer with "New sub-task" heading and sets parentId', async () => {
      const parentTask = createTask({ id: 'tx-subtask-parent', title: 'Parent for shift+n' })
      const createdTask = createTask({ id: 'tx-subtask-created', title: 'Created child', parentId: 'tx-subtask-parent' })
      const createPayloads: Array<{ parentId?: string | null; title?: string }> = []

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [parentTask],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ ...parentTask, id: String(params.id) }),
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          })
        ),
        http.post('/api/tasks', async ({ request }) => {
          createPayloads.push(await request.json() as { parentId?: string | null; title?: string })
          return HttpResponse.json(createdTask, { status: 201 })
        }),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Parent for shift+n')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Parent for shift+n'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('n', true, false, true)
      })

      await waitFor(() => {
        expect(screen.getByText('New sub-task')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByPlaceholderText('Task title'), {
        target: { value: 'Created child' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create sub-task' }))

      await waitFor(() => {
        expect(createPayloads.length).toBeGreaterThan(0)
      })
      expect(createPayloads[0]?.parentId).toBe('tx-subtask-parent')
    })

    it('supports Ctrl+Shift+N as a variant', async () => {
      const parentTask = createTask({ id: 'tx-subtask-ctrl', title: 'Parent ctrl shift n' })

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [parentTask],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ ...parentTask, id: String(params.id) }),
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
        expect(screen.getByText('Parent ctrl shift n')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Parent ctrl shift n'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('n', false, true, true)
      })

      await waitFor(() => {
        expect(screen.getByText('New sub-task')).toBeInTheDocument()
      })
    })
  })

  describe('Set status via command palette', () => {
    const statusOptions = [
      { value: 'backlog', label: 'Backlog' },
      { value: 'ready', label: 'Ready' },
      { value: 'planning', label: 'Planning' },
      { value: 'active', label: 'Active' },
      { value: 'blocked', label: 'Blocked' },
      { value: 'review', label: 'Review' },
      { value: 'needs_review', label: 'Needs Review' },
      { value: 'done', label: 'Done' },
    ] as const

    async function runPaletteCommand(label: string) {
      if (!screen.queryByPlaceholderText(/command|filter/i)) {
        act(() => {
          dispatchKeyCombo('k', true)
        })
        await waitFor(() => {
          expect(screen.getByPlaceholderText(/command|filter/i)).toBeInTheDocument()
        })
      }

      // Type the label to surface hierarchical children via search
      const paletteInput = screen.getByPlaceholderText(/command|filter/i)
      fireEvent.change(paletteInput, { target: { value: label } })

      await waitFor(() => {
        const allButtons = Array.from(document.querySelectorAll('[data-item-index]'))
        expect(allButtons.length).toBeGreaterThan(0)
      })

      const allPaletteButtons = Array.from(document.querySelectorAll('[data-item-index]')) as HTMLButtonElement[]
      let commandButton = allPaletteButtons.find((btn) => btn.textContent?.includes(label))
      if (!commandButton) {
        // For hierarchical commands, try matching the last segment after ": "
        const lastSegment = label.includes(': ') ? label.split(': ').pop()! : label
        commandButton = allPaletteButtons.find((btn) => btn.textContent?.includes(lastSegment))
      }

      if (!commandButton) {
        throw new Error(`Unable to locate command button for label: ${label}`)
      }

      fireEvent.click(commandButton)
    }

    it('executes every "Set status: X" command in task detail', async () => {
      let taskState = createTask({ id: 'tx-palette-status', title: 'Palette status task', status: 'backlog' })
      const patchPayloads: string[] = []

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [taskState],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { backlog: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ ...taskState, id: String(params.id) }),
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          })
        ),
        http.patch('/api/tasks/:id', async ({ request }) => {
          const payload = await request.json() as { status?: string }
          if (payload.status) {
            patchPayloads.push(payload.status)
            taskState = createTask({ ...taskState, status: payload.status })
          }
          return HttpResponse.json(taskState)
        }),
      )

      renderApp()

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      })

      await waitFor(() => {
        expect(screen.getByText('Palette status task')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Palette status task'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      for (const option of statusOptions) {
        await runPaletteCommand(`Set status: ${option.label}`)
        await waitFor(() => {
          expect(patchPayloads).toContain(option.value)
        })
      }

      expect(patchPayloads).toEqual(statusOptions.map((option) => option.value))
    })

    it('executes "Set selected tasks to X" in list view', async () => {
      const taskA = createTask({ id: 'tx-palette-list-a', title: 'Palette list A' })
      const taskB = createTask({ id: 'tx-palette-list-b', title: 'Palette list B' })
      const patchPayloads: Array<{ id: string; status?: string }> = []

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [taskA, taskB],
            nextCursor: null,
            hasMore: false,
            total: 2,
            summary: { total: 2, byStatus: { backlog: 2 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.patch('/api/tasks/:id', async ({ params, request }) => {
          const payload = await request.json() as { status?: string }
          patchPayloads.push({ id: String(params.id), status: payload.status })
          return HttpResponse.json(createTask({ id: String(params.id), status: payload.status ?? 'backlog' }))
        }),
      )

      renderApp()

      await waitFor(() => {
        expect(screen.getByText('Palette list A')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('a', true)
      })

      await waitFor(() => {
        expect(selectionStore.state.taskIds.size).toBe(2)
      })

      await runPaletteCommand('Set selected tasks to Done')

      await waitFor(() => {
        expect(patchPayloads.some((payload) => payload.id === 'tx-palette-list-a' && payload.status === 'done')).toBe(true)
        expect(patchPayloads.some((payload) => payload.id === 'tx-palette-list-b' && payload.status === 'done')).toBe(true)
      })
    })

    it('executes "Set selected child tasks to X" in task detail', async () => {
      const parentTask = createTask({ id: 'tx-palette-child-parent', title: 'Palette child parent' })
      const childA = createTask({ id: 'tx-palette-child-a', title: 'Palette child A', parentId: 'tx-palette-child-parent' })
      const childB = createTask({ id: 'tx-palette-child-b', title: 'Palette child B', parentId: 'tx-palette-child-parent' })
      const patchPayloads: Array<{ id: string; status?: string }> = []

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
            task: createTask({ ...parentTask, id: String(params.id) }),
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [childA, childB],
          })
        ),
        http.patch('/api/tasks/:id', async ({ params, request }) => {
          const payload = await request.json() as { status?: string }
          patchPayloads.push({ id: String(params.id), status: payload.status })
          return HttpResponse.json(createTask({ id: String(params.id), status: payload.status ?? 'backlog' }))
        }),
      )

      renderApp()

      await waitFor(() => {
        expect(screen.getByText('Palette child parent')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Palette child parent'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('a', true)
      })

      await waitFor(() => {
        expect(screen.getByText('Delete selected (2)')).toBeInTheDocument()
      })

      await runPaletteCommand('Set selected child tasks to Blocked')

      await waitFor(() => {
        expect(patchPayloads.some((payload) => payload.id === 'tx-palette-child-a' && payload.status === 'blocked')).toBe(true)
        expect(patchPayloads.some((payload) => payload.id === 'tx-palette-child-b' && payload.status === 'blocked')).toBe(true)
      })
    })
  })

  describe('ESC context behavior', () => {
    it('closes the command palette when open', async () => {
      renderApp()

      act(() => {
        dispatchKeyCombo('k', true)
      })

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('Escape')
      })

      await waitFor(() => {
        expect(screen.queryByPlaceholderText('Type a command...')).not.toBeInTheDocument()
      })
    })

    it('clears child selection in detail view without navigating away', async () => {
      const parentTask = createTask({ id: 'tx-esc-child-parent', title: 'ESC child parent' })
      const childA = createTask({ id: 'tx-esc-child-a', title: 'ESC child A', parentId: 'tx-esc-child-parent' })
      const childB = createTask({ id: 'tx-esc-child-b', title: 'ESC child B', parentId: 'tx-esc-child-parent' })

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [parentTask],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ ...parentTask, id: String(params.id) }),
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
        expect(screen.getByText('ESC child parent')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('ESC child parent'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('a', true)
      })

      await waitFor(() => {
        expect(screen.getByText('Delete selected (2)')).toBeInTheDocument()
      })

      const beforeEscTaskId = new URLSearchParams(window.location.search).get('taskId')
      expect(beforeEscTaskId).toBe('tx-esc-child-parent')

      act(() => {
        dispatchKeyCombo('Escape')
      })

      await waitFor(() => {
        expect(screen.queryByText('Delete selected (2)')).not.toBeInTheDocument()
      })
      expect(screen.getByText('Properties')).toBeInTheDocument()
      expect(new URLSearchParams(window.location.search).get('taskId')).toBe('tx-esc-child-parent')
    })

    it('navigates back from task detail to list when no child selection is active', async () => {
      const parentTask = createTask({ id: 'tx-esc-back-parent', title: 'ESC back parent' })

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [parentTask],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ ...parentTask, id: String(params.id) }),
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
        expect(screen.getByText('ESC back parent')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('ESC back parent'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })
      expect(new URLSearchParams(window.location.search).get('taskId')).toBe('tx-esc-back-parent')

      act(() => {
        dispatchKeyCombo('Escape')
      })

      await waitFor(() => {
        expect(screen.queryByText('Properties')).not.toBeInTheDocument()
      })
      expect(screen.getByText('ESC back parent')).toBeInTheDocument()
      expect(new URLSearchParams(window.location.search).get('taskId')).toBeNull()
    })

    it('clears task list selections with ESC', async () => {
      renderApp()

      selectionActions.selectAllTasks(['tx-esc-list-a', 'tx-esc-list-b'])
      expect(selectionStore.state.taskIds.size).toBe(2)

      act(() => {
        dispatchKeyCombo('Escape')
      })

      await waitFor(() => {
        expect(selectionStore.state.taskIds.size).toBe(0)
      })
    })

    it('does not clear child selection or navigate when Escape is pressed inside an input/textarea', async () => {
      const parentTask = createTask({
        id: 'tx-esc-input-parent',
        title: 'ESC input parent',
        description: 'Editable text',
      })
      const childA = createTask({ id: 'tx-esc-input-a', title: 'ESC input child A', parentId: 'tx-esc-input-parent' })
      const childB = createTask({ id: 'tx-esc-input-b', title: 'ESC input child B', parentId: 'tx-esc-input-parent' })

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [parentTask],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({
              ...parentTask,
              id: String(params.id),
              description: 'Editable text',
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
        expect(screen.getByText('ESC input parent')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('ESC input parent'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('a', true)
      })

      await waitFor(() => {
        expect(screen.getByText('Delete selected (2)')).toBeInTheDocument()
      })

      const descriptionInput = await screen.findByLabelText('Task description')
      fireEvent.focus(descriptionInput)
      fireEvent.keyDown(descriptionInput, {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      })

      await waitFor(() => {
        expect(screen.getByText('Delete selected (2)')).toBeInTheDocument()
      })
      expect(screen.getByText('Properties')).toBeInTheDocument()
      expect(new URLSearchParams(window.location.search).get('taskId')).toBe('tx-esc-input-parent')
    })
  })

  describe('CMD+C copy shortcut', () => {
    it('copies task reference in task detail when no children are selected', async () => {
      const task = createTask({ id: 'tx-copy-detail', title: 'Copy detail task' })
      const writeText = vi.fn(async () => {})
      Object.assign(navigator, {
        clipboard: { writeText },
      })

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [task],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ ...task, id: String(params.id) }),
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
        expect(screen.getByText('Copy detail task')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Copy detail task'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('c', true)
      })

      await waitFor(() => {
        expect(writeText).toHaveBeenCalled()
      })
      const copiedText = String((writeText.mock.calls as unknown as Array<[unknown]>)[0]?.[0] ?? '')
      expect(copiedText).toContain('tx-copy-detail Copy detail task')
    })

    it('copies selected child task IDs when child selection is active', async () => {
      const parentTask = createTask({ id: 'tx-copy-child-parent', title: 'Copy child parent' })
      const childA = createTask({ id: 'tx-copy-child-a', title: 'Copy child A', parentId: 'tx-copy-child-parent' })
      const childB = createTask({ id: 'tx-copy-child-b', title: 'Copy child B', parentId: 'tx-copy-child-parent' })
      const writeText = vi.fn(async () => {})
      Object.assign(navigator, {
        clipboard: { writeText },
      })

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [parentTask],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ ...parentTask, id: String(params.id) }),
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
        expect(screen.getByText('Copy child parent')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Copy child parent'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('a', true)
      })

      await waitFor(() => {
        expect(screen.getByText('Delete selected (2)')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('c', true)
      })

      await waitFor(() => {
        expect(writeText).toHaveBeenCalled()
      })
      const copiedText = String((writeText.mock.calls as unknown as Array<[unknown]>)[0]?.[0] ?? '')
      expect(copiedText).toContain('tx-copy-child-a')
      expect(copiedText).toContain('tx-copy-child-b')
    })

    it('does not intercept copy when text is selected', async () => {
      const writeText = vi.fn(async () => {})
      Object.assign(navigator, {
        clipboard: { writeText },
      })

      const originalGetSelection = window.getSelection
      window.getSelection = vi.fn(() => ({
        toString: () => 'selected text',
      })) as unknown as typeof window.getSelection

      renderApp()

      act(() => {
        dispatchKeyCombo('c', true)
      })

      expect(writeText).not.toHaveBeenCalled()
      window.getSelection = originalGetSelection
    })

    it('supports Ctrl+C as a variant', async () => {
      const task = createTask({ id: 'tx-copy-ctrl', title: 'Copy ctrl task' })
      const writeText = vi.fn(async () => {})
      Object.assign(navigator, {
        clipboard: { writeText },
      })

      server.use(
        http.get('/api/tasks', () =>
          HttpResponse.json({
            tasks: [task],
            nextCursor: null,
            hasMore: false,
            total: 1,
            summary: { total: 1, byStatus: { ready: 1 } },
          } satisfies PaginatedTasksResponse)
        ),
        http.get('/api/tasks/:id', ({ params }) =>
          HttpResponse.json({
            task: createTask({ ...task, id: String(params.id) }),
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
        expect(screen.getByText('Copy ctrl task')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Copy ctrl task'))
      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyCombo('c', false, true)
      })

      await waitFor(() => {
        expect(writeText).toHaveBeenCalled()
      })
      const copiedText = String((writeText.mock.calls as unknown as Array<[unknown]>)[0]?.[0] ?? '')
      expect(copiedText).toContain('tx-copy-ctrl Copy ctrl task')
    })
  })
})
