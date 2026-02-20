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
        expect(screen.getByRole('heading', { name: 'Detailed task' })).toBeInTheDocument()
        expect(screen.getByText('This is the task description')).toBeInTheDocument()
        expect(screen.getByText('active')).toBeInTheDocument()
        expect(screen.getByText('750')).toBeInTheDocument()
      })

      const title = screen.getByRole('heading', { name: 'Detailed task' })
      const description = screen.getByText('This is the task description')
      expect(title.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('autosaves description changes after debounce', async () => {
      let currentDescription = 'Initial description'
      const patchPayloads: Array<{ description?: string }> = []

      server.use(
        http.get('/api/tasks/:id', ({ params }) => {
          expect(params.id).toBe('tx-description-edit')
          return HttpResponse.json({
            task: createTask({
              id: 'tx-description-edit',
              title: 'Editable description task',
              description: currentDescription,
            }),
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        }),
        http.patch('/api/tasks/:id', async ({ params, request }) => {
          expect(params.id).toBe('tx-description-edit')
          const payload = await request.json() as { description?: string }
          patchPayloads.push(payload)
          currentDescription = payload.description ?? ''

          return HttpResponse.json(
            createTask({
              id: 'tx-description-edit',
              title: 'Editable description task',
              description: currentDescription,
            })
          )
        })
      )

      renderWithProviders(
        <TaskDetail taskId="tx-description-edit" onNavigateToTask={vi.fn()} />
      )

      await waitFor(() => {
        expect(screen.getByLabelText('Task description')).toHaveValue('Initial description')
      })

      fireEvent.change(screen.getByLabelText('Task description'), {
        target: { value: 'Updated inline description' },
      })

      await waitFor(() => {
        expect(screen.getByText('Changes pending...')).toBeInTheDocument()
      })

      await waitFor(() => {
        expect(patchPayloads).toContainEqual({ description: 'Updated inline description' })
        expect(screen.getByLabelText('Task description')).toHaveValue('Updated inline description')
      }, { timeout: 2500 })
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
        createdAt: '2026-01-30T12:00:00Z',
        updatedAt: '2026-01-30T14:00:00Z',
        completedAt: '2026-01-30T16:00:00Z',
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

    it('parses sqlite-style timestamps for created and updated fields', async () => {
      const task = createTask({
        id: 'tx-sqlite-timestamps',
        createdAt: '2026-01-30 12:00:00',
        updatedAt: '2026-01-30 14:00:00',
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

      renderWithProviders(
        <TaskDetail taskId="tx-sqlite-timestamps" onNavigateToTask={vi.fn()} />
      )

      await waitFor(() => {
        expect(screen.queryByText('Created: —')).not.toBeInTheDocument()
        expect(screen.queryByText('Updated: —')).not.toBeInTheDocument()
      })
    })
  })

  describe('parent task', () => {
    it('shows parent task link when parent_id is set', async () => {
      const task = createTask({
        id: 'tx-child1',
        parentId: 'tx-parent1',
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

    it('renders task breadcrumbs and supports ancestor navigation', async () => {
      const rootTask = createTask({
        id: 'tx-root1',
        title: 'Root task',
        parentId: null,
      })
      const parentTask = createTask({
        id: 'tx-parent2',
        title: 'Parent task',
        parentId: 'tx-root1',
      })
      const childTask = createTask({
        id: 'tx-child2',
        title: 'Child task',
        parentId: 'tx-parent2',
      })

      server.use(
        http.get('/api/tasks/:id', ({ params }) => {
          const id = String(params.id)
          const taskById: Record<string, TaskWithDeps> = {
            'tx-root1': rootTask,
            'tx-parent2': parentTask,
            'tx-child2': childTask,
          }
          const matchedTask = taskById[id]
          if (!matchedTask) {
            return HttpResponse.json({ error: 'Task not found' }, { status: 404 })
          }
          return HttpResponse.json({
            task: matchedTask,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [],
          } satisfies TaskDetailResponse)
        })
      )

      const onNavigate = vi.fn()
      const onNavigateToList = vi.fn()
      renderWithProviders(
        <TaskDetail
          taskId="tx-child2"
          onNavigateToTask={onNavigate}
          onNavigateToList={onNavigateToList}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Tasks' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Root task' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Parent task' })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: 'Tasks' }))
      expect(onNavigateToList).toHaveBeenCalledTimes(1)

      fireEvent.click(screen.getByRole('button', { name: 'Root task' }))
      expect(onNavigate).toHaveBeenCalledWith('tx-root1')

      fireEvent.click(screen.getByRole('button', { name: 'Parent task' }))
      expect(onNavigate).toHaveBeenCalledWith('tx-parent2')
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

    it('hides blockedBy section when no blockers', async () => {
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
        expect(screen.queryByText(/^Blocked By/)).not.toBeInTheDocument()
        expect(screen.queryByText('No blockers - this task is unblocked')).not.toBeInTheDocument()
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

    it('hides blocks section when task blocks nothing', async () => {
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
        expect(screen.queryByText(/^Blocks/)).not.toBeInTheDocument()
        expect(screen.queryByText('Does not block any other tasks')).not.toBeInTheDocument()
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
        parentId: 'tx-parent1',
      })

      const childTask2 = createTask({
        id: 'tx-child2',
        title: 'Child task 2',
        parentId: 'tx-parent1',
      })

      const childTask3 = createTask({
        id: 'tx-child3',
        title: 'Child task 3',
        parentId: 'tx-parent1',
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

  describe('properties panel actions', () => {
    it('renders properties panel and supports status changes', async () => {
      const task = createTask({
        id: 'tx-properties',
        title: 'Properties task',
        status: 'active',
      })
      const onChangeStatusStage = vi.fn()

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

      renderWithProviders(
        <TaskDetail
          taskId="tx-properties"
          onNavigateToTask={vi.fn()}
          statusStage="in_progress"
          onChangeStatusStage={onChangeStatusStage}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Properties')).toBeInTheDocument()
      })

      const statusInput = document.getElementById('react-select-task-detail-status-tx-properties-input')
      expect(statusInput).toBeTruthy()
      fireEvent.keyDown(statusInput as HTMLElement, { key: 'ArrowDown' })
      let doneOption: HTMLElement | null = null
      await waitFor(() => {
        doneOption = document.getElementById('react-select-task-detail-status-tx-properties-option-2')
        expect(doneOption).not.toBeNull()
      })
      fireEvent.click(doneOption!)
      expect(onChangeStatusStage).toHaveBeenCalledWith('done')
    })

    it('creates child tasks from the children section CTA', async () => {
      const task = createTask({
        id: 'tx-parent-cta',
        title: 'Parent task',
      })
      const onCreateChild = vi.fn()

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

      renderWithProviders(
        <TaskDetail
          taskId="tx-parent-cta"
          onNavigateToTask={vi.fn()}
          onCreateChild={onCreateChild}
        />
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '+ Create new task' })).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: '+ Create new task' }))
      expect(onCreateChild).toHaveBeenCalledTimes(1)
    })

    it('supports child selection and delete-selected action', async () => {
      const task = createTask({
        id: 'tx-parent-select',
        title: 'Parent selectable',
        children: ['tx-child-1'],
      })
      const childTask = createTask({
        id: 'tx-child-1',
        title: 'Only child',
        parentId: 'tx-parent-select',
      })

      const onToggleChildSelection = vi.fn()
      const onDeleteSelectedChildren = vi.fn()

      server.use(
        http.get('/api/tasks/:id', () => {
          return HttpResponse.json({
            task,
            blockedByTasks: [],
            blocksTasks: [],
            childTasks: [childTask],
          } satisfies TaskDetailResponse)
        })
      )

      renderWithProviders(
        <TaskDetail
          taskId="tx-parent-select"
          onNavigateToTask={vi.fn()}
          selectedChildIds={new Set(['tx-child-1'])}
          onToggleChildSelection={onToggleChildSelection}
          onDeleteSelectedChildren={onDeleteSelectedChildren}
        />
      )

      await waitFor(() => {
        expect(screen.getByLabelText('Select child task tx-child-1')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByLabelText('Select child task tx-child-1'))
      expect(onToggleChildSelection).toHaveBeenCalledWith('tx-child-1')

      fireEvent.click(screen.getByRole('button', { name: 'Delete selected (1)' }))
      expect(onDeleteSelectedChildren).toHaveBeenCalledTimes(1)
    })

    it('toggles labels from the properties sidebar', async () => {
      const task = createTask({
        id: 'tx-label-panel',
        title: 'Label task',
      })
      const bugLabel = { id: 11, name: 'Bug', color: '#ef4444', createdAt: '', updatedAt: '' }
      const onToggleLabel = vi.fn()

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

      renderWithProviders(
        <TaskDetail
          taskId="tx-label-panel"
          onNavigateToTask={vi.fn()}
          allLabels={[bugLabel]}
          onToggleLabel={onToggleLabel}
        />
      )

      let labelsInput: HTMLInputElement | null = null
      await waitFor(() => {
        labelsInput = document.querySelector<HTMLInputElement>('[id^="react-select-task-detail-labels-"][id$="-input"]')
        expect(labelsInput).not.toBeNull()
      })
      fireEvent.keyDown(labelsInput!, { key: 'ArrowDown' })
      let bugOption: HTMLElement | null = null
      await waitFor(() => {
        bugOption = document.getElementById('react-select-task-detail-labels-tx-label-panel-option-0')
        expect(bugOption).not.toBeNull()
      })
      fireEvent.click(bugOption!)
      expect(onToggleLabel).toHaveBeenCalledWith(bugLabel)
    })
  })
})
