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

function dispatchKeyCombo(key: string, meta = false) {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: meta,
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
    http.get('/api/tasks/ready', () =>
      HttpResponse.json({ tasks: [] })
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
