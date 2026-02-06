import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskCard } from '../TaskCard'
import type { TaskWithDeps } from '../../../api/client'

// Helper to create a task fixture
function createTask(overrides: Partial<TaskWithDeps> = {}): TaskWithDeps {
  return {
    id: 'tx-test123',
    title: 'Test task title',
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

describe('TaskCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    it('renders task title', () => {
      const task = createTask({ title: 'My special task' })
      render(<TaskCard task={task} />)

      expect(screen.getByText('My special task')).toBeInTheDocument()
    })

    it('renders task ID', () => {
      const task = createTask({ id: 'tx-abc123' })
      render(<TaskCard task={task} />)

      expect(screen.getByText('tx-abc123')).toBeInTheDocument()
    })

    it('renders task score', () => {
      const task = createTask({ score: 750 })
      render(<TaskCard task={task} />)

      expect(screen.getByText('[750]')).toBeInTheDocument()
    })

    it('renders task status badge', () => {
      const task = createTask({ status: 'active' })
      render(<TaskCard task={task} />)

      expect(screen.getByText('active')).toBeInTheDocument()
    })

    it('renders multiple status types correctly', () => {
      const statuses = ['backlog', 'ready', 'planning', 'active', 'blocked', 'review', 'done']

      statuses.forEach((status) => {
        const { unmount } = render(<TaskCard task={createTask({ status })} />)
        expect(screen.getByText(status)).toBeInTheDocument()
        unmount()
      })
    })
  })

  describe('blockedBy display', () => {
    it('shows blockedBy tasks when present', () => {
      const task = createTask({ blockedBy: ['tx-blocker1', 'tx-blocker2'] })
      render(<TaskCard task={task} />)

      expect(screen.getByText(/Blocked by:/)).toBeInTheDocument()
      expect(screen.getByText(/tx-blocker1/)).toBeInTheDocument()
      expect(screen.getByText(/tx-blocker2/)).toBeInTheDocument()
    })

    it('hides blockedBy when empty', () => {
      const task = createTask({ blockedBy: [] })
      render(<TaskCard task={task} />)

      expect(screen.queryByText(/Blocked by:/)).not.toBeInTheDocument()
    })
  })

  describe('blocks display', () => {
    it('shows blocks count when present', () => {
      const task = createTask({ blocks: ['tx-blocked1', 'tx-blocked2', 'tx-blocked3'] })
      render(<TaskCard task={task} />)

      expect(screen.getByText(/Unblocks 3 task\(s\)/)).toBeInTheDocument()
    })

    it('hides blocks when empty', () => {
      const task = createTask({ blocks: [] })
      render(<TaskCard task={task} />)

      expect(screen.queryByText(/Unblocks/)).not.toBeInTheDocument()
    })
  })

  describe('focus ring', () => {
    it('shows focus ring when isFocused=true', () => {
      const task = createTask()
      const { container } = render(<TaskCard task={task} isFocused={true} />)

      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('ring-2')
      expect(card).toHaveClass('ring-blue-500')
    })

    it('hides focus ring when isFocused=false', () => {
      const task = createTask()
      const { container } = render(<TaskCard task={task} isFocused={false} />)

      const card = container.firstChild as HTMLElement
      expect(card).not.toHaveClass('ring-2')
    })

    it('hides focus ring by default (isFocused not provided)', () => {
      const task = createTask()
      const { container } = render(<TaskCard task={task} />)

      const card = container.firstChild as HTMLElement
      expect(card).not.toHaveClass('ring-2')
    })
  })

  describe('onClick', () => {
    it('calls onClick when clicked', () => {
      const onClick = vi.fn()
      const task = createTask()
      const { container } = render(<TaskCard task={task} onClick={onClick} />)

      const card = container.firstChild as HTMLElement
      fireEvent.click(card)

      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('does not throw when onClick is not provided', () => {
      const task = createTask()
      const { container } = render(<TaskCard task={task} />)

      const card = container.firstChild as HTMLElement
      expect(() => fireEvent.click(card)).not.toThrow()
    })
  })

  describe('scrollIntoView', () => {
    it('calls scrollIntoView when focused', () => {
      const scrollIntoViewMock = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoViewMock

      const task = createTask()
      render(<TaskCard task={task} isFocused={true} />)

      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
      })
    })

    it('does not call scrollIntoView when not focused', () => {
      const scrollIntoViewMock = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoViewMock

      const task = createTask()
      render(<TaskCard task={task} isFocused={false} />)

      expect(scrollIntoViewMock).not.toHaveBeenCalled()
    })

    it('calls scrollIntoView when focus changes from false to true', () => {
      const scrollIntoViewMock = vi.fn()
      Element.prototype.scrollIntoView = scrollIntoViewMock

      const task = createTask()
      const { rerender } = render(<TaskCard task={task} isFocused={false} />)

      expect(scrollIntoViewMock).not.toHaveBeenCalled()

      rerender(<TaskCard task={task} isFocused={true} />)

      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'nearest',
      })
    })
  })

  describe('tabIndex', () => {
    it('has tabIndex=0 when focused', () => {
      const task = createTask()
      const { container } = render(<TaskCard task={task} isFocused={true} />)

      const card = container.firstChild as HTMLElement
      expect(card).toHaveAttribute('tabIndex', '0')
    })

    it('has tabIndex=-1 when not focused', () => {
      const task = createTask()
      const { container } = render(<TaskCard task={task} isFocused={false} />)

      const card = container.firstChild as HTMLElement
      expect(card).toHaveAttribute('tabIndex', '-1')
    })
  })

  describe('accessibility', () => {
    it('has role="button"', () => {
      const task = createTask()
      render(<TaskCard task={task} onClick={() => {}} />)

      expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('has aria-label with task title', () => {
      const task = createTask({ title: 'Fix the widget' })
      render(<TaskCard task={task} onClick={() => {}} />)

      expect(screen.getByRole('button')).toHaveAttribute(
        'aria-label',
        'View task: Fix the widget'
      )
    })

    it('triggers onClick on Enter key', () => {
      const onClick = vi.fn()
      const task = createTask()
      render(<TaskCard task={task} onClick={onClick} isFocused={true} />)

      fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('triggers onClick on Space key', () => {
      const onClick = vi.fn()
      const task = createTask()
      render(<TaskCard task={task} onClick={onClick} isFocused={true} />)

      fireEvent.keyDown(screen.getByRole('button'), { key: ' ' })
      expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('does not trigger onClick on other keys', () => {
      const onClick = vi.fn()
      const task = createTask()
      render(<TaskCard task={task} onClick={onClick} isFocused={true} />)

      fireEvent.keyDown(screen.getByRole('button'), { key: 'Tab' })
      expect(onClick).not.toHaveBeenCalled()
    })
  })

  describe('isReady styling', () => {
    it('shows blue border when task isReady', () => {
      const task = createTask({ isReady: true })
      const { container } = render(<TaskCard task={task} />)

      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('border-blue-500')
    })

    it('shows gray border when task is not ready', () => {
      const task = createTask({ isReady: false })
      const { container } = render(<TaskCard task={task} />)

      const card = container.firstChild as HTMLElement
      expect(card).toHaveClass('border-gray-700')
    })
  })
})
