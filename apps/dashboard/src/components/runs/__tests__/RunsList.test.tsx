import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { server } from '../../../../test/setup'
import { RunsList } from '../RunsList'
import type { PaginatedRunsResponse, Run } from '../../../api/client'
import { createDeferred } from '../../../test/deferred'

// Helper to create a run fixture
function createRun(overrides: Partial<Run> = {}): Run {
  return {
    id: `run-${Math.random().toString(36).slice(2, 10)}`,
    taskId: 'tx-abc123',
    agent: 'tx-tester',
    startedAt: '2026-01-30T12:00:00Z',
    endedAt: '2026-01-30T12:05:00Z',
    status: 'completed',
    exitCode: 0,
    pid: null,
    transcriptPath: null,
    summary: 'Test run summary',
    errorMessage: null,
    taskTitle: 'Test Task',
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

// Default empty response for paginated endpoint
const emptyPaginatedResponse: PaginatedRunsResponse = {
  runs: [],
  nextCursor: null,
  hasMore: false,
}

describe('RunsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set up default handler
    server.use(
      http.get('/api/runs', () => {
        return HttpResponse.json(emptyPaginatedResponse)
      })
    )
  })

  afterEach(() => {
    server.resetHandlers()
  })

  describe('loading state', () => {
    it('shows structured loading UI and transitions cleanly after load', async () => {
      const gate = createDeferred<void>()

      // Keep request pending until assertions are made.
      server.use(
        http.get('/api/runs', async () => {
          await gate.promise
          return HttpResponse.json({
            runs: [],
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      const { container } = renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      expect(screen.getByRole('heading', { level: 2, name: 'Runs' })).toBeInTheDocument()
      expect(screen.getByText('Loading...')).toBeInTheDocument()
      expect(container.querySelectorAll('.animate-shimmer')).toHaveLength(5)

      gate.resolve()

      await waitFor(() => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
        expect(screen.getByText('No runs found')).toBeInTheDocument()
      })
    })
  })

  describe('empty state', () => {
    it('shows EmptyState when no runs', async () => {
      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs: [],
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('No runs found')).toBeInTheDocument()
      })
    })

    it('shows filter hint when filters active and no results', async () => {
      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs: [],
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(
        <RunsList
          onSelectRun={onSelectRun}
          filters={{ status: ['failed'], agent: 'tx-tester' }}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('No runs found')).toBeInTheDocument()
        expect(
          screen.getByText('Try adjusting your filters')
        ).toBeInTheDocument()
      })
    })

    it('shows default hint when no filters and no runs', async () => {
      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs: [],
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} filters={{}} />)

      await waitFor(() => {
        expect(screen.getByText('No runs found')).toBeInTheDocument()
        expect(
          screen.getByText(/Runs will appear here when agents execute tasks/)
        ).toBeInTheDocument()
      })
    })
  })

  describe('rendering runs', () => {
    it('renders initial runs', async () => {
      const runs = [
        createRun({ id: 'run-1', taskTitle: 'First task' }),
        createRun({ id: 'run-2', taskTitle: 'Second task' }),
        createRun({ id: 'run-3', taskTitle: 'Third task' }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('First task')).toBeInTheDocument()
        expect(screen.getByText('Second task')).toBeInTheDocument()
        expect(screen.getByText('Third task')).toBeInTheDocument()
      })
    })

    it('displays run count in header', async () => {
      const runs = [
        createRun({ id: 'run-1', taskTitle: 'Task 1' }),
        createRun({ id: 'run-2', taskTitle: 'Task 2' }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('2 runs')).toBeInTheDocument()
      })
    })

    it('uses singular "run" when count is 1', async () => {
      const runs = [createRun({ id: 'run-1', taskTitle: 'Only run' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('1 run')).toBeInTheDocument()
      })
    })

    it('displays run agent name', async () => {
      const runs = [createRun({ id: 'run-1', agent: 'tx-implementer' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('tx-implementer')).toBeInTheDocument()
      })
    })

    it('displays run status badge', async () => {
      const runs = [createRun({ id: 'run-1', status: 'running' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('running')).toBeInTheDocument()
      })
    })
  })

  describe('run selection', () => {
    it('calls onSelectRun when run is clicked', async () => {
      const runs = [createRun({ id: 'run-clickable', taskTitle: 'Clickable run' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('Clickable run')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByText('Clickable run'))
      expect(onSelectRun).toHaveBeenCalledWith('run-clickable')
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
      const runs = [
        createRun({ id: 'run-1', taskTitle: 'Run 1' }),
        createRun({ id: 'run-2', taskTitle: 'Run 2' }),
        createRun({ id: 'run-3', taskTitle: 'Run 3' }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      const { container } = renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('Run 1')).toBeInTheDocument()
      })

      // First run should be focused by default (tabIndex=0)
      const cards = container.querySelectorAll('[tabindex]')
      expect(cards[0]).toHaveAttribute('tabIndex', '0')

      // Press ArrowDown
      act(() => {
        dispatchKeyEvent('ArrowDown')
      })

      // Second run should now be focused
      await waitFor(() => {
        const updatedCards = container.querySelectorAll('[tabindex]')
        expect(updatedCards[1]).toHaveAttribute('tabIndex', '0')
        expect(updatedCards[0]).toHaveAttribute('tabIndex', '-1')
      })
    })

    it('selects focused run on Enter', async () => {
      const runs = [
        createRun({ id: 'run-1', taskTitle: 'Run 1' }),
        createRun({ id: 'run-2', taskTitle: 'Run 2' }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('Run 1')).toBeInTheDocument()
      })

      // Move to second run
      act(() => {
        dispatchKeyEvent('ArrowDown')
      })

      // Press Enter to select
      act(() => {
        dispatchKeyEvent('Enter')
      })

      expect(onSelectRun).toHaveBeenCalledWith('run-2')
    })

    it('calls onEscape when Escape is pressed', async () => {
      const runs = [createRun({ id: 'run-1', taskTitle: 'Run 1' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      const onEscape = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} onEscape={onEscape} />)

      await waitFor(() => {
        expect(screen.getByText('Run 1')).toBeInTheDocument()
      })

      act(() => {
        dispatchKeyEvent('Escape')
      })

      expect(onEscape).toHaveBeenCalled()
    })
  })

  describe('infinite scroll', () => {
    it('shows scroll hint when hasMore is true', async () => {
      const runs = [createRun({ id: 'run-1', taskTitle: 'Run 1' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: 'cursor123',
            hasMore: true,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText(/scroll for more/)).toBeInTheDocument()
      })
    })

    it('shows end of list when no more pages', async () => {
      const runs = [createRun({ id: 'run-1', taskTitle: 'Run 1' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('End of runs')).toBeInTheDocument()
      })
    })

    it('loads more items when cursor is provided', async () => {
      const page1Runs = [createRun({ id: 'run-1', taskTitle: 'Run 1' })]
      const page2Runs = [createRun({ id: 'run-2', taskTitle: 'Run 2' })]

      let requestCount = 0
      server.use(
        http.get('/api/runs', ({ request }) => {
          const url = new URL(request.url)
          const cursor = url.searchParams.get('cursor')

          requestCount++

          if (cursor === 'cursor-page2') {
            return HttpResponse.json({
              runs: page2Runs,
              nextCursor: null,
              hasMore: false,
            } satisfies PaginatedRunsResponse)
          }

          return HttpResponse.json({
            runs: page1Runs,
            nextCursor: 'cursor-page2',
            hasMore: true,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      // First page should load
      await waitFor(() => {
        expect(screen.getByText('Run 1')).toBeInTheDocument()
      })

      // Initial request was made
      expect(requestCount).toBe(1)
    })
  })

  describe('filtering', () => {
    it('passes agent filter to API', async () => {
      let receivedAgent: string | null = null

      server.use(
        http.get('/api/runs', ({ request }) => {
          const url = new URL(request.url)
          receivedAgent = url.searchParams.get('agent')
          return HttpResponse.json({
            runs: [],
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(
        <RunsList onSelectRun={onSelectRun} filters={{ agent: 'tx-implementer' }} />
      )

      await waitFor(() => {
        expect(receivedAgent).toBe('tx-implementer')
      })
    })

    it('passes status filter to API', async () => {
      let receivedStatus: string | null = null

      server.use(
        http.get('/api/runs', ({ request }) => {
          const url = new URL(request.url)
          receivedStatus = url.searchParams.get('status')
          return HttpResponse.json({
            runs: [],
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(
        <RunsList onSelectRun={onSelectRun} filters={{ status: ['failed', 'running'] }} />
      )

      await waitFor(() => {
        expect(receivedStatus).toBe('failed,running')
      })
    })
  })

  describe('error state', () => {
    it('shows error when API fails', async () => {
      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
          )
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('Error loading runs')).toBeInTheDocument()
      })
    })
  })

  describe('RunCard: duration formatting', () => {
    it('shows "running..." for runs without end time', async () => {
      const runs = [
        createRun({
          id: 'run-running',
          status: 'running',
          startedAt: '2026-01-30T12:00:00Z',
          endedAt: null,
        }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('running...')).toBeInTheDocument()
      })
    })

    it('shows duration in seconds for short runs', async () => {
      const runs = [
        createRun({
          id: 'run-short',
          status: 'completed',
          startedAt: '2026-01-30T12:00:00Z',
          endedAt: '2026-01-30T12:00:30Z', // 30 seconds
        }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('30s')).toBeInTheDocument()
      })
    })

    it('shows duration in minutes and seconds for longer runs', async () => {
      const runs = [
        createRun({
          id: 'run-longer',
          status: 'completed',
          startedAt: '2026-01-30T12:00:00Z',
          endedAt: '2026-01-30T12:05:30Z', // 5 minutes 30 seconds
        }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('5m 30s')).toBeInTheDocument()
      })
    })
  })

  describe('RunCard: status colors', () => {
    it('applies yellow styling for running status', async () => {
      const runs = [createRun({ id: 'run-running', status: 'running' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        const badge = screen.getByText('running')
        expect(badge).toHaveClass('bg-yellow-500')
      })
    })

    it('applies green styling for completed status', async () => {
      const runs = [createRun({ id: 'run-completed', status: 'completed' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        const badge = screen.getByText('completed')
        expect(badge).toHaveClass('bg-green-500')
      })
    })

    it('applies red styling for failed status', async () => {
      const runs = [createRun({ id: 'run-failed', status: 'failed' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        const badge = screen.getByText('failed')
        expect(badge).toHaveClass('bg-red-500')
      })
    })

    it('applies orange styling for timeout status', async () => {
      const runs = [createRun({ id: 'run-timeout', status: 'timeout' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        const badge = screen.getByText('timeout')
        expect(badge).toHaveClass('bg-orange-500')
      })
    })

    it('applies gray styling for cancelled status', async () => {
      const runs = [createRun({ id: 'run-cancelled', status: 'cancelled' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        const badge = screen.getByText('cancelled')
        expect(badge).toHaveClass('bg-gray-500')
      })
    })

    it('applies card border styling based on running status', async () => {
      const runs = [
        createRun({ id: 'run-running', status: 'running', taskTitle: 'Running task' }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        const card = screen.getByText('Running task').closest('div[class*="border"]')
        expect(card).toHaveClass('border-yellow-500')
      })
    })

    it('applies card border styling based on failed status', async () => {
      const runs = [
        createRun({ id: 'run-failed', status: 'failed', taskTitle: 'Failed task' }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        const card = screen.getByText('Failed task').closest('div[class*="border"]')
        expect(card).toHaveClass('border-red-500/50')
      })
    })
  })

  describe('accessibility', () => {
    it('run cards have role="button"', async () => {
      const runs = [createRun({ id: 'run-1', taskTitle: 'Accessible run' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /View run: Accessible run/ })).toBeInTheDocument()
      })
    })

    it('run card aria-label uses task title', async () => {
      const runs = [createRun({ id: 'run-1', taskTitle: 'My task title' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'View run: My task title')
      })
    })

    it('run card aria-label falls back to task ID when no title', async () => {
      const runs = [createRun({ id: 'run-1', taskId: 'tx-fallback', taskTitle: null })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'View run: tx-fallback')
      })
    })

    it('run card aria-label falls back to run ID when no task', async () => {
      const runs = [createRun({ id: 'run-notask', taskId: null, taskTitle: null })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'View run: run-notask')
      })
    })

    it('triggers onSelectRun on Enter key on run card', async () => {
      const runs = [createRun({ id: 'run-enter', taskTitle: 'Enter run' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByRole('button')).toBeInTheDocument()
      })

      fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
      expect(onSelectRun).toHaveBeenCalledWith('run-enter')
    })

    it('triggers onSelectRun on Space key on run card', async () => {
      const runs = [createRun({ id: 'run-space', taskTitle: 'Space run' })]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByRole('button')).toBeInTheDocument()
      })

      fireEvent.keyDown(screen.getByRole('button'), { key: ' ' })
      expect(onSelectRun).toHaveBeenCalledWith('run-space')
    })
  })

  describe('run card content', () => {
    it('shows error message for failed runs', async () => {
      const runs = [
        createRun({
          id: 'run-failed',
          status: 'failed',
          errorMessage: 'Task execution timed out',
        }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('Task execution timed out')).toBeInTheDocument()
      })
    })

    it('shows summary for completed runs', async () => {
      const runs = [
        createRun({
          id: 'run-completed',
          status: 'completed',
          summary: 'Implemented the feature successfully',
        }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('Implemented the feature successfully')).toBeInTheDocument()
      })
    })

    it('shows exit code for non-zero exits', async () => {
      const runs = [
        createRun({
          id: 'run-failed',
          status: 'failed',
          exitCode: 1,
        }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('exit 1')).toBeInTheDocument()
      })
    })

    it('shows task ID when no task title', async () => {
      const runs = [
        createRun({
          id: 'run-1',
          taskId: 'tx-abc123',
          taskTitle: null,
        }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('Task: tx-abc123')).toBeInTheDocument()
      })
    })

    it('shows "No task" when run has no associated task', async () => {
      const runs = [
        createRun({
          id: 'run-notask',
          taskId: null,
          taskTitle: null,
        }),
      ]

      server.use(
        http.get('/api/runs', () => {
          return HttpResponse.json({
            runs,
            nextCursor: null,
            hasMore: false,
          } satisfies PaginatedRunsResponse)
        })
      )

      const onSelectRun = vi.fn()
      renderWithProviders(<RunsList onSelectRun={onSelectRun} />)

      await waitFor(() => {
        expect(screen.getByText('No task')).toBeInTheDocument()
      })
    })
  })
})
