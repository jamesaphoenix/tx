import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import App from './App'
import { server } from '../test/setup'

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
})
