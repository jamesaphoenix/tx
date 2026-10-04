import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import App from './App'
import { server } from '../test/setup'
import { selectionActions } from './stores/selection-store'

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
  const settingsPatchPayloads: Array<{
    dashboard?: { defaultTaskAssigmentType?: string; defaultTaskView?: string }
  }> = []

  beforeEach(() => {
    settingsPatchPayloads.length = 0
    server.use(
      http.get('/api/settings', () => HttpResponse.json({
        dashboard: { defaultTaskAssigmentType: 'human', defaultTaskView: 'list' },
      })),
      http.patch('/api/settings', async ({ request }) => {
        const payload = await request.json() as {
          dashboard?: { defaultTaskAssigmentType?: string; defaultTaskView?: string }
        }
        settingsPatchPayloads.push(payload)
        return HttpResponse.json({
          dashboard: {
            defaultTaskAssigmentType: payload.dashboard?.defaultTaskAssigmentType ?? 'human',
            defaultTaskView: payload.dashboard?.defaultTaskView ?? 'list',
          },
        })
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

  it('resets the tasks view to its base state when clicking Tasks in the header', async () => {
    window.history.replaceState({}, '', '/?status=ready&taskSearch=ship&view=kanban')

    renderWithProviders(<App />)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search tasks...')).toHaveValue('ship')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))

    await waitFor(() => {
      expect(window.location.search).toBe('')
      expect(screen.getByPlaceholderText('Search tasks...')).toHaveValue('')
    })
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

  it('returns to tasks when clicking back from settings page', async () => {
    renderWithProviders(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Back to Tasks' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'New Task' })).toBeInTheDocument()
    })
  })

  it('creates labels from the settings labels section', async () => {
    const labels: Array<{ id: number; name: string; color: string; createdAt: string; updatedAt: string }> = []

    server.use(
      http.get('/api/labels', () => HttpResponse.json({ labels })),
      http.post('/api/labels', async ({ request }) => {
        const payload = await request.json() as { name?: string; color?: string }
        const created = {
          id: labels.length + 1,
          name: payload.name ?? 'Unnamed',
          color: payload.color ?? '#3b82f6',
          createdAt: '',
          updatedAt: '',
        }
        labels.push(created)
        return HttpResponse.json(created, { status: 201 })
      }),
    )

    renderWithProviders(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    })

    // Navigate to the Labels settings tab
    fireEvent.click(screen.getByRole('button', { name: 'Labels' }))

    await waitFor(() => {
      expect(screen.getByLabelText('New label name')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('New label name'), {
      target: { value: 'priority-high' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create label' }))

    await waitFor(() => {
      expect(screen.getByText('priority-high')).toBeInTheDocument()
    })
  })

  it('edits and deletes labels from settings', async () => {
    let labels: Array<{ id: number; name: string; color: string; createdAt: string; updatedAt: string }> = [
      { id: 1, name: 'bug', color: '#ef4444', createdAt: '', updatedAt: '' },
    ]

    server.use(
      http.get('/api/labels', () => HttpResponse.json({ labels })),
      http.patch('/api/labels/:labelId', async ({ params, request }) => {
        const payload = await request.json() as { name?: string; color?: string }
        const id = Number(params.labelId)
        labels = labels.map((label) => label.id === id
          ? {
            ...label,
            name: payload.name ?? label.name,
            color: payload.color ?? label.color,
          }
          : label
        )
        const updated = labels.find((label) => label.id === id)
        return HttpResponse.json(updated ?? { message: 'not found' }, { status: updated ? 200 : 404 })
      }),
      http.delete('/api/labels/:labelId', ({ params }) => {
        const id = Number(params.labelId)
        labels = labels.filter((label) => label.id !== id)
        return HttpResponse.json({ success: true, id })
      }),
    )

    renderWithProviders(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    })

    // Navigate to the Labels settings tab
    fireEvent.click(screen.getByRole('button', { name: 'Labels' }))

    await waitFor(() => {
      expect(screen.getByText('bug')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Edit label bug' }))
    fireEvent.change(screen.getByLabelText('Edit label name bug'), {
      target: { value: 'backend-bug' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save label bug' }))

    await waitFor(() => {
      expect(screen.getByText('backend-bug')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Delete label backend-bug' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete label backend-bug' }))

    await waitFor(() => {
      expect(screen.queryByText('backend-bug')).not.toBeInTheDocument()
    })
  })
})
