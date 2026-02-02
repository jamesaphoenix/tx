import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, renderHook } from '@testing-library/react'
import { RunFilters, useRunFiltersWithUrl } from '../RunFilters'

describe('RunFilters', () => {
  describe('status toggles', () => {
    it('renders all status options', () => {
      const onChange = vi.fn()
      render(
        <RunFilters value={{ status: [], agent: '' }} onChange={onChange} />
      )

      expect(screen.getByText('All')).toBeInTheDocument()
      expect(screen.getByText('Running')).toBeInTheDocument()
      expect(screen.getByText('Completed')).toBeInTheDocument()
      expect(screen.getByText('Failed')).toBeInTheDocument()
    })

    it('toggles status on click', () => {
      const onChange = vi.fn()
      render(
        <RunFilters value={{ status: [], agent: '' }} onChange={onChange} />
      )

      fireEvent.click(screen.getByText('Running'))
      expect(onChange).toHaveBeenCalledWith({ status: ['running'], agent: '' })
    })

    it('allows multiple statuses to be selected', () => {
      const onChange = vi.fn()
      const { rerender } = render(
        <RunFilters value={{ status: ['running'], agent: '' }} onChange={onChange} />
      )

      // First status already selected
      expect(screen.getByRole('button', { name: /Running/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )

      // Click another status
      fireEvent.click(screen.getByText('Failed'))
      expect(onChange).toHaveBeenCalledWith({
        status: ['running', 'failed'],
        agent: '',
      })

      // Rerender with both selected
      rerender(
        <RunFilters
          value={{ status: ['running', 'failed'], agent: '' }}
          onChange={onChange}
        />
      )

      expect(screen.getByRole('button', { name: /Running/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(screen.getByRole('button', { name: /Failed/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    })

    it('removes status when clicking selected status', () => {
      const onChange = vi.fn()
      render(
        <RunFilters
          value={{ status: ['running', 'failed'], agent: '' }}
          onChange={onChange}
        />
      )

      fireEvent.click(screen.getByText('Running'))
      expect(onChange).toHaveBeenCalledWith({ status: ['failed'], agent: '' })
    })

    it('clears all statuses when clicking All', () => {
      const onChange = vi.fn()
      render(
        <RunFilters
          value={{ status: ['running', 'failed'], agent: '' }}
          onChange={onChange}
        />
      )

      fireEvent.click(screen.getByText('All'))
      expect(onChange).toHaveBeenCalledWith({ status: [], agent: '' })
    })

    it('shows All as selected when no status is selected', () => {
      const onChange = vi.fn()
      render(
        <RunFilters value={{ status: [], agent: '' }} onChange={onChange} />
      )

      expect(screen.getByRole('button', { name: /All/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
    })

    it('shows All as not selected when status is selected', () => {
      const onChange = vi.fn()
      render(
        <RunFilters value={{ status: ['running'], agent: '' }} onChange={onChange} />
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
        running: 2,
        completed: 10,
        failed: 3,
      }

      render(
        <RunFilters
          value={{ status: [], agent: '' }}
          onChange={onChange}
          statusCounts={statusCounts}
        />
      )

      // Total count on All button
      expect(screen.getByText('15')).toBeInTheDocument()

      // Individual counts
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('10')).toBeInTheDocument()
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    it('handles missing counts gracefully', () => {
      const onChange = vi.fn()
      const statusCounts = {
        running: 5,
        // completed and failed are undefined
      }

      render(
        <RunFilters
          value={{ status: [], agent: '' }}
          onChange={onChange}
          statusCounts={statusCounts}
        />
      )

      // Should still render without errors
      expect(screen.getByText('Running')).toBeInTheDocument()
      expect(screen.getByText('Completed')).toBeInTheDocument()
      expect(screen.getByText('Failed')).toBeInTheDocument()
    })
  })

  describe('agent dropdown', () => {
    it('renders agent dropdown with All Agents option', () => {
      const onChange = vi.fn()
      render(
        <RunFilters
          value={{ status: [], agent: '' }}
          onChange={onChange}
          availableAgents={['tx-implementer', 'tx-tester']}
        />
      )

      const select = screen.getByRole('combobox')
      expect(select).toBeInTheDocument()
      expect(screen.getByText('All Agents')).toBeInTheDocument()
    })

    it('renders available agents in dropdown', () => {
      const onChange = vi.fn()
      render(
        <RunFilters
          value={{ status: [], agent: '' }}
          onChange={onChange}
          availableAgents={['tx-implementer', 'tx-tester', 'tx-reviewer']}
        />
      )

      expect(screen.getByRole('option', { name: 'tx-implementer' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'tx-tester' })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: 'tx-reviewer' })).toBeInTheDocument()
    })

    it('calls onChange when agent is selected', () => {
      const onChange = vi.fn()
      render(
        <RunFilters
          value={{ status: [], agent: '' }}
          onChange={onChange}
          availableAgents={['tx-implementer', 'tx-tester']}
        />
      )

      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: 'tx-implementer' } })

      expect(onChange).toHaveBeenCalledWith({
        status: [],
        agent: 'tx-implementer',
      })
    })

    it('preserves status when agent changes', () => {
      const onChange = vi.fn()
      render(
        <RunFilters
          value={{ status: ['running', 'failed'], agent: '' }}
          onChange={onChange}
          availableAgents={['tx-implementer', 'tx-tester']}
        />
      )

      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: 'tx-tester' } })

      expect(onChange).toHaveBeenCalledWith({
        status: ['running', 'failed'],
        agent: 'tx-tester',
      })
    })

    it('shows selected agent in dropdown', () => {
      const onChange = vi.fn()
      render(
        <RunFilters
          value={{ status: [], agent: 'tx-implementer' }}
          onChange={onChange}
          availableAgents={['tx-implementer', 'tx-tester']}
        />
      )

      const select = screen.getByRole('combobox') as HTMLSelectElement
      expect(select.value).toBe('tx-implementer')
    })

    it('clears agent filter when All Agents is selected', () => {
      const onChange = vi.fn()
      render(
        <RunFilters
          value={{ status: ['running'], agent: 'tx-implementer' }}
          onChange={onChange}
          availableAgents={['tx-implementer', 'tx-tester']}
        />
      )

      const select = screen.getByRole('combobox')
      fireEvent.change(select, { target: { value: '' } })

      expect(onChange).toHaveBeenCalledWith({
        status: ['running'],
        agent: '',
      })
    })

    it('renders empty dropdown when no agents available', () => {
      const onChange = vi.fn()
      render(
        <RunFilters
          value={{ status: [], agent: '' }}
          onChange={onChange}
          availableAgents={[]}
        />
      )

      const select = screen.getByRole('combobox')
      // Should only have "All Agents" option
      const options = select.querySelectorAll('option')
      expect(options.length).toBe(1)
      expect(options[0].textContent).toBe('All Agents')
    })
  })

  describe('aria-pressed', () => {
    it('sets aria-pressed correctly for selected status', () => {
      const onChange = vi.fn()
      render(
        <RunFilters value={{ status: ['running'], agent: '' }} onChange={onChange} />
      )

      expect(screen.getByRole('button', { name: /Running/ })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      expect(screen.getByRole('button', { name: /Completed/ })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
      expect(screen.getByRole('button', { name: /Failed/ })).toHaveAttribute(
        'aria-pressed',
        'false'
      )
    })
  })

  describe('color indicators', () => {
    it('renders color indicator for status buttons', () => {
      const onChange = vi.fn()
      const { container } = render(
        <RunFilters value={{ status: [], agent: '' }} onChange={onChange} />
      )

      // Check for colored dots (non-All buttons have them)
      const colorDots = container.querySelectorAll('.w-2.h-2.rounded-full')
      expect(colorDots.length).toBeGreaterThan(0)
    })

    it('does not render color indicator for All button', () => {
      const onChange = vi.fn()
      render(
        <RunFilters value={{ status: [], agent: '' }} onChange={onChange} />
      )

      const allButton = screen.getByRole('button', { name: /All/ })
      // All button should not contain a colored dot
      expect(allButton.querySelector('.w-2.h-2.rounded-full')).toBeNull()
    })
  })
})

describe('useRunFiltersWithUrl', () => {
  const originalLocation = window.location

  beforeEach(() => {
    // Mock window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: {
        ...originalLocation,
        pathname: '/runs',
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
    const { result } = renderHook(() => useRunFiltersWithUrl())

    expect(result.current.filters).toEqual({
      status: [],
      agent: '',
    })
  })

  it('initializes with status from URL params', () => {
    window.location.search = '?runStatus=running,failed'

    const { result } = renderHook(() => useRunFiltersWithUrl())

    expect(result.current.filters.status).toEqual(['running', 'failed'])
  })

  it('initializes with agent from URL params', () => {
    window.location.search = '?runAgent=tx-implementer'

    const { result } = renderHook(() => useRunFiltersWithUrl())

    expect(result.current.filters.agent).toBe('tx-implementer')
  })

  it('updates URL when filters change', () => {
    const { result } = renderHook(() => useRunFiltersWithUrl())

    act(() => {
      result.current.setFilters({ status: ['running'], agent: 'tx-tester' })
    })

    expect(window.history.replaceState).toHaveBeenCalledWith(
      {},
      '',
      '/runs?runStatus=running&runAgent=tx-tester'
    )
  })

  it('clears URL params when filters are empty', () => {
    window.location.search = '?runStatus=running&runAgent=tx-tester'

    const { result } = renderHook(() => useRunFiltersWithUrl())

    act(() => {
      result.current.setFilters({ status: [], agent: '' })
    })

    expect(window.history.replaceState).toHaveBeenCalledWith({}, '', '/runs')
  })

  it('handles popstate event for browser navigation', () => {
    const { result } = renderHook(() => useRunFiltersWithUrl())

    // Simulate browser back navigation
    act(() => {
      window.location.search = '?runStatus=failed'
      window.dispatchEvent(new PopStateEvent('popstate'))
    })

    expect(result.current.filters.status).toEqual(['failed'])
  })

  it('cleans up popstate listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useRunFiltersWithUrl())

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'popstate',
      expect.any(Function)
    )

    removeEventListenerSpy.mockRestore()
  })

  it('preserves other URL params when updating run filters', () => {
    window.location.search = '?taskStatus=ready&otherParam=value'

    const { result } = renderHook(() => useRunFiltersWithUrl())

    act(() => {
      result.current.setFilters({ status: ['running'], agent: '' })
    })

    expect(window.history.replaceState).toHaveBeenCalledWith(
      {},
      '',
      '/runs?taskStatus=ready&otherParam=value&runStatus=running'
    )
  })
})
