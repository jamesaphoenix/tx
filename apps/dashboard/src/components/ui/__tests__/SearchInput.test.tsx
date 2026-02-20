import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchInput } from '../SearchInput'

describe('SearchInput', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders with placeholder', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} placeholder="Search tasks..." />)
    expect(screen.getByPlaceholderText('Search tasks...')).toBeInTheDocument()
  })

  it('marks the input for native select-all handling', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} />)
    expect(screen.getByPlaceholderText('Search...')).toHaveAttribute('data-native-select-all', 'true')
  })

  it('renders default placeholder when not provided', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} />)
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument()
  })

  it('debounces onChange by 300ms', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} />)
    const input = screen.getByPlaceholderText('Search...')

    // Type in the input
    fireEvent.change(input, { target: { value: 'test' } })

    // onChange should not have been called yet (within 300ms)
    expect(onChange).not.toHaveBeenCalled()

    // Advance past the debounce timeout
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(onChange).toHaveBeenCalledWith('test')
  })

  it('debounces with custom delay', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} debounceMs={500} />)
    const input = screen.getByPlaceholderText('Search...')

    fireEvent.change(input, { target: { value: 'test' } })

    // Advance 300ms - should NOT have called onChange yet
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onChange).not.toHaveBeenCalled()

    // Advance another 200ms (total 500ms) - should call onChange now
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(onChange).toHaveBeenCalledWith('test')
  })

  it('shows clear button when value present', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} />)
    const input = screen.getByPlaceholderText('Search...')

    // Clear button should not be visible initially
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'test' } })

    // Clear button should now be visible
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument()
  })

  it('does not show clear button when value is empty', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} />)
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  })

  it('clear button resets value', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} />)
    const input = screen.getByPlaceholderText('Search...')

    fireEvent.change(input, { target: { value: 'test' } })

    // Clear the input
    const clearButton = screen.getByRole('button', { name: 'Clear search' })
    fireEvent.click(clearButton)

    // onChange should be called immediately with empty string (not debounced)
    expect(onChange).toHaveBeenCalledWith('')

    // Input should be empty
    expect(input).toHaveValue('')
  })

  it('syncs with external value changes', () => {
    const onChange = vi.fn()
    const { rerender } = render(<SearchInput value="initial" onChange={onChange} />)
    const input = screen.getByPlaceholderText('Search...')

    expect(input).toHaveValue('initial')

    // Update value from parent
    rerender(<SearchInput value="updated" onChange={onChange} />)
    expect(input).toHaveValue('updated')
  })

  it('cancels pending debounce when new value is typed', () => {
    const onChange = vi.fn()
    render(<SearchInput value="" onChange={onChange} />)
    const input = screen.getByPlaceholderText('Search...')

    fireEvent.change(input, { target: { value: 'ab' } })

    // Advance 200ms (less than 300ms)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'abc' } })

    // Advance another 200ms - still should not fire because timer was reset
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(onChange).not.toHaveBeenCalled()

    // Advance final 100ms to complete the debounce
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(onChange).toHaveBeenCalledWith('abc')
  })

  describe('with real timers', () => {
    beforeEach(() => {
      vi.useRealTimers()
    })

    it('clears input immediately on clear button click', async () => {
      const user = userEvent.setup()
      const onChange = vi.fn()
      render(<SearchInput value="test" onChange={onChange} />)

      const clearButton = screen.getByRole('button', { name: 'Clear search' })
      await user.click(clearButton)

      expect(onChange).toHaveBeenCalledWith('')
    })
  })
})
