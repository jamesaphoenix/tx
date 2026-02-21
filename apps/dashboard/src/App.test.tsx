import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import App from './App'
import type { ChatMessage, Run, RunDetailResponse } from './api/client'
import { server } from '../test/setup'
import { selectionActions } from './stores/selection-store'
import { createDeferred } from './test/deferred'

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

function renderWithProviders(ui: React.ReactNode) {
  const queryClient = createTestQueryClient()
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
  )
}

function createRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-default',
    taskId: 'tx-abc123',
    agent: 'tx-tester',
    startedAt: '2026-02-21T10:00:00.000Z',
    endedAt: null,
    status: 'running',
    exitCode: null,
    pid: 4242,
    transcriptPath: null,
    stderrPath: null,
    stdoutPath: null,
    contextInjected: null,
    summary: null,
    errorMessage: null,
    metadata: {},
    taskTitle: 'Default run',
    ...overrides,
  }
}

function createRunDetailResponse(
  run: Run,
  overrides: {
    messages?: ChatMessage[]
    logs?: RunDetailResponse['logs']
  } = {}
): RunDetailResponse {
  return {
    run,
    messages: overrides.messages ?? [],
    logs: overrides.logs ?? {
      stdout: null,
      stderr: null,
      stdoutTruncated: false,
      stderrTruncated: false,
    },
  }
}

async function openRunsTabAndSelectRun(taskTitle: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Runs' }))
  const runCard = await screen.findByRole('button', {
    name: `View run: ${taskTitle}`,
  })
  fireEvent.click(runCard)
}

function mockRunsEndpoint(runs: Run[]) {
  server.use(
    http.get('/api/runs', () =>
      HttpResponse.json({
        runs,
        nextCursor: null,
        hasMore: false,
      })
    )
  )
}

describe('App', () => {
  const settingsPatchPayloads: Array<{ dashboard?: { defaultTaskAssigmentType?: string } }> = []

  beforeEach(() => {
    settingsPatchPayloads.length = 0
    server.use(
      http.get('/api/settings', () => HttpResponse.json({ dashboard: { defaultTaskAssigmentType: 'human' } })),
      http.patch('/api/settings', async ({ request }) => {
        const payload = await request.json() as { dashboard?: { defaultTaskAssigmentType?: string } }
        settingsPatchPayloads.push(payload)
        return HttpResponse.json({ dashboard: { defaultTaskAssigmentType: payload.dashboard?.defaultTaskAssigmentType ?? 'human' } })
      }),
      http.get('/api/stats', () => HttpResponse.json({ tasks: 0, done: 0, ready: 0, learnings: 0, runsRunning: 0, runsTotal: 0 })),
      http.get('/api/ralph', () => HttpResponse.json({ running: false, pid: null, currentIteration: 0, currentTask: null, recentActivity: [] })),
      http.get('/api/runs', () => HttpResponse.json({ runs: [], nextCursor: null, hasMore: false })),
      http.get('/api/tasks/ready', () => HttpResponse.json({ tasks: [] })),
      http.get('/api/tasks', () => HttpResponse.json({
        tasks: [],
        nextCursor: null,
        hasMore: false,
        total: 0,
        summary: { total: 0, byStatus: {} },
      })),
      http.get('/api/docs', () => HttpResponse.json({ docs: [] })),
      http.get('/api/docs/graph', () => HttpResponse.json({ nodes: [], edges: [] })),
      http.get('/api/cycles', () => HttpResponse.json({ cycles: [] })),
      http.get('/api/labels', () => HttpResponse.json({ labels: [] })),
    )
  })

  afterEach(() => {
    selectionActions.clearAll()
    vi.useRealTimers()
    server.resetHandlers()
  })

  it('renders without crashing', () => {
    renderWithProviders(<App />)
    // Basic smoke test - verify dashboard header renders
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('tx')
  })

  it('opens settings from header cog and saves default assignment type', async () => {
    renderWithProviders(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))

    await waitFor(() => {
      expect(settingsPatchPayloads).toContainEqual({
        dashboard: { defaultTaskAssigmentType: 'agent' },
      })
    })
  })

  describe('run detail panel', () => {
    it('shows transcript/log waiting states for running runs', async () => {
      const runningRun = createRun({
        id: 'run-running',
        taskTitle: 'Running run',
        status: 'running',
        transcriptPath: '/tmp/running-transcript.jsonl',
        stdoutPath: '/tmp/running.stdout.log',
        stderrPath: '/tmp/running.stderr.log',
        contextInjected: '/tmp/running-context.md',
      })

      mockRunsEndpoint([runningRun])
      server.use(
        http.get('/api/runs/:id', ({ params }) => {
          if (params.id !== runningRun.id) {
            return HttpResponse.json({ message: 'not found' }, { status: 404 })
          }
          return HttpResponse.json(createRunDetailResponse(runningRun))
        })
      )

      renderWithProviders(<App />)
      await openRunsTabAndSelectRun('Running run')

      await waitFor(() => {
        expect(screen.getByText('Waiting for transcript...')).toBeInTheDocument()
      })
      expect(
        screen.getByText(
          'Transcript path is configured; messages will stream here as they are parsed.'
        )
      ).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Execution Logs' }))

      await waitFor(() => {
        expect(screen.getByText('Waiting for execution logs...')).toBeInTheDocument()
      })
      expect(
        screen.getByText(
          'stdout/stderr paths are configured; output will appear once bytes are written.'
        )
      ).toBeInTheDocument()
    })

    it('shows transcript/log empty states for failed runs', async () => {
      const failedRun = createRun({
        id: 'run-failed-empty',
        taskTitle: 'Failed empty run',
        status: 'failed',
        endedAt: '2026-02-21T10:01:00.000Z',
        exitCode: 1,
        errorMessage: 'Agent exited with non-zero code',
      })

      mockRunsEndpoint([failedRun])
      server.use(
        http.get('/api/runs/:id', ({ params }) => {
          if (params.id !== failedRun.id) {
            return HttpResponse.json({ message: 'not found' }, { status: 404 })
          }
          return HttpResponse.json(createRunDetailResponse(failedRun))
        })
      )

      renderWithProviders(<App />)
      await openRunsTabAndSelectRun('Failed empty run')

      await waitFor(() => {
        expect(screen.getByText('No conversation transcript available')).toBeInTheDocument()
      })
      expect(
        screen.getByText('No transcript path was captured for this run.')
      ).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Execution Logs' }))

      await waitFor(() => {
        expect(screen.getByText('No execution logs available')).toBeInTheDocument()
      })
      expect(
        screen.getByText('No stdout/stderr files were captured for this run.')
      ).toBeInTheDocument()
    })

    it('shows run-detail error state when detail fetch fails', async () => {
      const failedRun = createRun({
        id: 'run-detail-error',
        taskTitle: 'Broken run detail',
        status: 'failed',
      })

      mockRunsEndpoint([failedRun])
      server.use(
        http.get('/api/runs/:id', ({ params }) => {
          if (params.id !== failedRun.id) {
            return HttpResponse.json({ message: 'not found' }, { status: 404 })
          }
          return HttpResponse.text('boom', { status: 500 })
        })
      )

      renderWithProviders(<App />)
      await openRunsTabAndSelectRun('Broken run detail')

      await waitFor(() => {
        expect(screen.getByText(/Error loading run:/)).toBeInTheDocument()
      })
      expect(
        screen.queryByRole('button', { name: 'Execution Logs' })
      ).not.toBeInTheDocument()
    })

    it('renders source paths and truncated log notice from run detail', async () => {
      const completedRun = createRun({
        id: 'run-with-paths',
        taskTitle: 'Run with paths',
        status: 'completed',
        endedAt: '2026-02-21T10:05:00.000Z',
        transcriptPath: '/tmp/tx/transcript.jsonl',
        stdoutPath: '/tmp/tx/stdout.log',
        stderrPath: '/tmp/tx/stderr.log',
        contextInjected: '/tmp/tx/context.md',
      })

      mockRunsEndpoint([completedRun])
      server.use(
        http.get('/api/runs/:id', ({ params }) => {
          if (params.id !== completedRun.id) {
            return HttpResponse.json({ message: 'not found' }, { status: 404 })
          }
          return HttpResponse.json(
            createRunDetailResponse(completedRun, {
              messages: [
                {
                  role: 'assistant',
                  type: 'text',
                  content: 'Finished run execution.',
                },
              ],
              logs: {
                stdout: 'stdout line 1',
                stderr: 'stderr warning 1',
                stdoutTruncated: true,
                stderrTruncated: false,
              },
            })
          )
        })
      )

      renderWithProviders(<App />)
      await openRunsTabAndSelectRun('Run with paths')

      await waitFor(() => {
        expect(screen.getByText('/tmp/tx/transcript.jsonl')).toBeInTheDocument()
      })
      expect(screen.getByText('/tmp/tx/stdout.log')).toBeInTheDocument()
      expect(screen.getByText('/tmp/tx/stderr.log')).toBeInTheDocument()
      expect(screen.getByText('/tmp/tx/context.md')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Execution Logs' }))

      await waitFor(() => {
        expect(
          screen.getByText('Log output truncated to last 200k characters for dashboard rendering.')
        ).toBeInTheDocument()
      })
      expect(screen.getByText('stdout line 1')).toBeInTheDocument()
      expect(screen.getByText('stderr warning 1')).toBeInTheDocument()
    })

    it('shows logs payload unavailable messaging for running and failed runs', async () => {
      const runningRun = createRun({
        id: 'run-logs-missing-running',
        taskTitle: 'Running missing logs payload',
        status: 'running',
        transcriptPath: '/tmp/transcript-running.jsonl',
      })
      const failedRun = createRun({
        id: 'run-logs-missing-failed',
        taskTitle: 'Failed missing logs payload',
        status: 'failed',
        endedAt: '2026-02-21T10:10:00.000Z',
        exitCode: 1,
      })

      mockRunsEndpoint([runningRun, failedRun])
      server.use(
        http.get('/api/runs/:id', ({ params }) => {
          if (params.id === runningRun.id) {
            return HttpResponse.json({ run: runningRun, messages: [] })
          }
          if (params.id === failedRun.id) {
            return HttpResponse.json({ run: failedRun, messages: [] })
          }
          return HttpResponse.json({ message: 'not found' }, { status: 404 })
        })
      )

      renderWithProviders(<App />)

      await openRunsTabAndSelectRun('Running missing logs payload')
      await waitFor(() => {
        expect(screen.getByText('Waiting for transcript...')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByRole('button', { name: 'Execution Logs' }))

      await waitFor(() => {
        expect(screen.getByText('Execution logs payload unavailable')).toBeInTheDocument()
      })
      expect(
        screen.getByText(
          'Run detail response did not include the logs payload yet; waiting for the next compatible update.'
        )
      ).toBeInTheDocument()

      const failedRunCard = await screen.findByRole('button', {
        name: 'View run: Failed missing logs payload',
      })
      fireEvent.click(failedRunCard)
      await waitFor(() => {
        expect(screen.getByText('No conversation transcript available')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByRole('button', { name: 'Execution Logs' }))

      await waitFor(() => {
        expect(screen.getByText('Execution logs payload unavailable')).toBeInTheDocument()
      })
      expect(
        screen.getByText(
          'Run detail response omitted logs payload, so stdout/stderr could not be rendered.'
        )
      ).toBeInTheDocument()
    })

    it(
      'polls run detail while running and shows fetching indicator during background refresh',
      async () => {
      const deferredRefetch = createDeferred<void>()
      const runningRun = createRun({
        id: 'run-polling-running',
        taskTitle: 'Polling running run',
        status: 'running',
        transcriptPath: '/tmp/polling-running.jsonl',
      })
      let runDetailCalls = 0

      mockRunsEndpoint([runningRun])
      server.use(
        http.get('/api/runs/:id', async ({ params }) => {
          if (params.id !== runningRun.id) {
            return HttpResponse.json({ message: 'not found' }, { status: 404 })
          }
          runDetailCalls += 1
          if (runDetailCalls === 2) {
            await deferredRefetch.promise
          }
          return HttpResponse.json(createRunDetailResponse(runningRun))
        })
      )

      const { container } = renderWithProviders(<App />)
      await openRunsTabAndSelectRun('Polling running run')

      await waitFor(() => {
        expect(screen.getByText('Live')).toBeInTheDocument()
      })
      expect(runDetailCalls).toBe(1)

      await waitFor(() => {
        expect(runDetailCalls).toBeGreaterThanOrEqual(2)
      }, { timeout: 7000 })
      await waitFor(() => {
        expect(screen.getByText('Live')).toBeInTheDocument()
      })
      await waitFor(() => {
        expect(container.querySelector('span.w-3.h-3.animate-spin')).toBeInTheDocument()
      })

      deferredRefetch.resolve(undefined)

      await waitFor(() => {
        expect(container.querySelector('span.w-3.h-3.animate-spin')).not.toBeInTheDocument()
      })
      },
      12000
    )

    it('stops run-detail polling once run reaches terminal status', async () => {
      const failedRun = createRun({
        id: 'run-polling-terminal',
        taskTitle: 'Polling terminal run',
        status: 'failed',
        endedAt: '2026-02-21T10:20:00.000Z',
        exitCode: 1,
      })
      let runDetailCalls = 0

      mockRunsEndpoint([failedRun])
      server.use(
        http.get('/api/runs/:id', ({ params }) => {
          if (params.id !== failedRun.id) {
            return HttpResponse.json({ message: 'not found' }, { status: 404 })
          }
          runDetailCalls += 1
          return HttpResponse.json(createRunDetailResponse(failedRun))
        })
      )

      const { container } = renderWithProviders(<App />)
      await openRunsTabAndSelectRun('Polling terminal run')

      await waitFor(() => {
        expect(screen.getByText('No conversation transcript available')).toBeInTheDocument()
      })
      expect(runDetailCalls).toBe(1)
      expect(screen.queryByText('Live')).not.toBeInTheDocument()

      await new Promise((resolve) => setTimeout(resolve, 2500))

      expect(runDetailCalls).toBe(1)
      expect(container.querySelector('span.w-3.h-3.animate-spin')).not.toBeInTheDocument()
    }, 12000)
  })
})
