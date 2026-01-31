import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react'
import { TaskFilters, useTaskFiltersWithUrl } from '../TaskFilters'

describe('TaskFilters', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('status toggles', () => {
    it('renders all status options', () => {
      const onChange = vi.fn()
      render(
        <TaskFilters value={{ status: [], search: '' }} onChange={onChange} />
      )

      expect(screen.getByText('All')).toBeInTheDocument()
      expect(screen.getByText('Ready')).toBeInTheDocument()
      expect(screen.getByText('Active')).toBeInTheDocument()
      expect(screen.getByText('Blocked')).toBeInTheDocument()
      expect(screen.getByText('Done')).toBeInTheDocument()
    })

    it('toggles status on click', () => {
      const onChange = vi.fn()
      render(
        <TaskFilters value={{ status: [], search: '' }} onChange={onChange} />
      )

      fireEvent.click(screen.getByText('Ready'))
      expect(onChange).toHaveBeenCalledWith({ status: ['ready'], search: '' })
    })

    it('allows multiple statuses to be selected', () => {
      const onChange = vi.fn()
      const { rerender } = render(
        <TaskFilters value={{ status: ['ready'], search: '' }} onChange={onChange} />
      )

      // First status already selected
      expect(screen.getByRole('button', { name: /Ready/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )

      // Click another status
      fireEvent.click(screen.getByText('Active'))
      expect(onChange).toHaveBeenCalledWith({
        status: ['ready', 'active'],
        search: '',
      })

      // Rerender with both selected
      rerender(
        <TaskFilters
          value={{ status: ['ready', 'active'], search: '' }}
          onChange={onChange}
        />
      )

      expect(screen.getByRole('button', { name: /Ready/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(screen.getByRole('button', { name: /Active/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    })

    it('removes status when clicking selected status', () => {
      const onChange = vi.fn()
      render(
        <TaskFilters
          value={{ status: ['ready', 'active'], search: '' }}
          onChange={onChange}
        />
      )

      fireEvent.click(screen.getByText('Ready'))
      expect(onChange).toHaveBeenCalledWith({ status: ['active'], search: '' })
    })

    it('clears all statuses when clicking All', () => {
      const onChange = vi.fn()
      render(
        <TaskFilters
          value={{ status: ['ready', 'active'], search: '' }}
          onChange={onChange}
        />
      )

      fireEvent.click(screen.getByText('All'))
      expect(onChange).toHaveBeenCalledWith({ status: [], search: '' })
    })

    it('shows All as selected when no status is selected', () => {
      const onChange = vi.fn()
      render(
        <TaskFilters value={{ status: [], search: '' }} onChange={onChange} />
      )

      expect(screen.getByRole('button', { name: /All/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    })

    it('shows All as not selected when status is selected', () => {
      const onChange = vi.fn()
      render(
        <TaskFilters value={{ status: ['ready'], search: '' }} onChange={onChange} />
      )

      expect(screen.getByRole('button', { name: /All/ })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
    })
  })

  describe('status counts', () => {
    it('displays count for each status', () => {
      const onChange = vi.fn()
      const statusCounts = {
        ready: 5,
        active: 3,
        blocked: 2,
        done: 10,
      }

      render(
        <TaskFilters
          value={{ status: [], search: '' }}
          onChange={onChange}
          statusCounts={statusCounts}
        />
      )

      // Total count on All button
      expect(screen.getByText('20')).toBeInTheDocument()

      // Individual counts
      expect(screen.getByText('5')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument()
    })

    it('handles missing counts gracefully', () => {
      const onChange = vi.fn()
      const statusCounts = {
        ready: 5,
        // active is undefined
      }

      render(
        <TaskFilters
          value={{ status: [], search: '' }}
          onChange={onChange}
          statusCounts={statusCounts}
        />
      )

      // Should still render without errors
      expect(screen.getByText('Ready')).toBeInTheDocument()
      expect(screen.getByText('Active')).toBeInTheDocument()
    })
  })

  describe('search input', () => {
    it('renders search input', () => {
      const onChange = vi.fn()
      render(
        <TaskFilters value={{ status: [], search: '' }} onChange={onChange} />
      )

      expect(screen.getByPlaceholderText('Search tasks...')).toBeInTheDocument()
    })

    it('updates search on type (debounced)', () => {
      const onChange = vi.fn()
      render(
        <TaskFilters value={{ status: [], search: '' }} onChange={onChange} />
      )

      const input = screen.getByPlaceholderText('Search tasks...')
      fireEvent.change(input, { target: { value: 'test query' } })

      // Should not be called immediately (debounced)
      expect(onChange).not.toHaveBeenCalledWith(
        expect.objectContaining({ search: 'test query' })
      )

      // Advance past debounce timeout
      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(onChange).toHaveBeenCalledWith({ status: [], search: 'test query' })
    })

    it('preserves status when search changes', () => {
      const onChange = vi.fn()
      render(
        <TaskFilters
          value={{ status: ['ready', 'active'], search: '' }}
          onChange={onChange}
        />
      )

      const input = screen.getByPlaceholderText('Search tasks...')
      fireEvent.change(input, { target: { value: 'test' } })

      act(() => {
        vi.advanceTimersByTime(300)
      })

      expect(onChange).toHaveBeenCalledWith({
        status: ['ready', 'active'],
        search: 'test',
      })
    })
  })

  describe('aria-pressed', () => {
    it('sets aria-pressed correctly for selected status', () => {
      const onChange = vi.fn()
      render(
        <TaskFilters value={{ status: ['ready'], search: '' }} onChange={onChange} />
      )

      expect(screen.getByRole('button', { name: /Ready/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(screen.getByRole('button', { name: /Active/ })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
    })
  })

  describe('color indicators', () => {
    it('renders color indicator for status buttons', () => {
      const onChange = vi.fn()
      const { container } = render(
        <TaskFilters value={{ status: [], search: '' }} onChange={onChange} />
      )

      // Check for colored dots (non-All buttons have them)
      const colorDots = container.querySelectorAll('.w-2.h-2.rounded-full')
      expect(colorDots.length).toBeGreaterThan(0)
    })

    it('does not render color indicator for All button', () => {
      const onChange = vi.fn()
      render(
        <TaskFilters value={{ status: [], search: '' }} onChange={onChange} />
      )

      const allButton = screen.getByRole('button', { name: /All/ })
      // All button should not contain a colored dot
      expect(allButton.querySelector('.w-2.h-2.rounded-full')).toBeNull()
    })
  })
})

describe('useTaskFiltersWithUrl', () => {
  const originalLocation = window.location

  beforeEach(() => {
    // Mock window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...originalLocation,
        pathname: '/tasks',
        search: '',
      },
    })

    // Mock history.replaceState
    window.history.replaceState = vi.fn()
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    })
  })

  it('initializes with empty filters when no URL params', () => {
    const { result } = renderHook(() => useTaskFiltersWithUrl())

    expect(result.current.filters).toEqual({
      status: [],
      search: '',
    })
  })

  it('initializes with status from URL params', () => {
    window.location.search = '?status=ready,active'

    const { result } = renderHook(() => useTaskFiltersWithUrl())

    expect(result.current.filters.status).toEqual(['ready', 'active'])
  })

  it('initializes with search from URL params', () => {
    window.location.search = '?search=test%20query'

    const { result } = renderHook(() => useTaskFiltersWithUrl())

    expect(result.current.filters.search).toBe('test query')
  })

  it('updates URL when filters change', () => {
    const { result } = renderHook(() => useTaskFiltersWithUrl())

    act(() => {
      result.current.setFilters({ status: ['ready'], search: 'test' })
    })

    expect(window.history.replaceState).toHaveBeenCalledWith(
      {},
      '',
      '/tasks?status=ready&search=test'
    )
  })

  it('clears URL params when filters are empty', () => {
    window.location.search = '?status=ready&search=test'

    const { result } = renderHook(() => useTaskFiltersWithUrl())

    act(() => {
      result.current.setFilters({ status: [], search: '' })
    })

    expect(window.history.replaceState).toHaveBeenCalledWith({}, '', '/tasks')
  })

  it('handles popstate event for browser navigation', () => {
    const { result } = renderHook(() => useTaskFiltersWithUrl())

    // Simulate browser back navigation
    act(() => {
      window.location.search = '?status=blocked'
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(result.current.filters.status).toEqual(['blocked'])
  })

  it('cleans up popstate listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useTaskFiltersWithUrl())

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'popstate',
      expect.any(Function)
    )

    removeEventListenerSpy.mockRestore()
  })
})
