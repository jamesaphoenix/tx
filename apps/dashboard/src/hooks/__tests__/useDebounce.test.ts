import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebounce } from '../useDebounce'

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('initial', 300))
    expect(result.current).toBe('initial')
  })

  it('returns debounced value after delay', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 300 } }
    )

    expect(result.current).toBe('initial')

    // Update the value
    rerender({ value: 'updated', delay: 300 })

    // Value should still be initial before delay
    expect(result.current).toBe('initial')

    // Advance time past the delay
    act(() => {
      vi.advanceTimersByTime(300)
    })

    // Now value should be updated
    expect(result.current).toBe('updated')
  })

  it('uses default delay of 300ms', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebounce(value),
      { initialProps: { value: 'initial' } }
    )

    rerender({ value: 'updated' })

    // Should not update at 200ms
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe('initial')

    // Should update at 300ms
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe('updated')
  })

  it('resets timer on value change', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 300 } }
    )

    // Change value
    rerender({ value: 'first', delay: 300 })

    // Advance 200ms (not yet expired)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe('initial')

    // Change value again - this should reset the timer
    rerender({ value: 'second', delay: 300 })

    // Advance another 200ms (400ms total, but only 200ms since last change)
    act(() => {
      vi.advanceTimersByTime(200)
    })
    // Still should show initial because timer was reset
    expect(result.current).toBe('initial')

    // Advance final 100ms to complete the new debounce
    act(() => {
      vi.advanceTimersByTime(100)
    })
    // Now should show 'second' (the most recent value)
    expect(result.current).toBe('second')
  })

  it('cleans up on unmount', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

    const { unmount } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 300 } }
    )

    unmount()

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })

  it('works with different types', () => {
    // Test with numbers
    const { result: numberResult, rerender: numberRerender } = renderHook(
      ({ value }) => useDebounce(value, 100),
      { initialProps: { value: 42 } }
    )
    expect(numberResult.current).toBe(42)

    numberRerender({ value: 100 })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(numberResult.current).toBe(100)

    // Test with objects
    const initialObj = { foo: 'bar' }
    const { result: objResult, rerender: objRerender } = renderHook(
      ({ value }) => useDebounce(value, 100),
      { initialProps: { value: initialObj } }
    )
    expect(objResult.current).toBe(initialObj)

    const updatedObj = { foo: 'baz' }
    objRerender({ value: updatedObj })
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(objResult.current).toBe(updatedObj)
  })

  it('handles delay changes', () => {
    const { result, rerender } = renderHook(
      ({ value, delay }) => useDebounce(value, delay),
      { initialProps: { value: 'initial', delay: 300 } }
    )

    // Update value with new delay
    rerender({ value: 'updated', delay: 500 })

    // Should not update at 300ms
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBe('initial')

    // Should update at 500ms
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe('updated')
  })
})
