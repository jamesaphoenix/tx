import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useKeyboardNavigation } from '../useKeyboardNavigation'

describe('useKeyboardNavigation', () => {
  const dispatchKeyEvent = (key: string, target?: EventTarget | null) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    })
    if (target) {
      Object.defineProperty(event, 'target', { value: target })
    }
    window.dispatchEvent(event)
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns focusedIndex starting at 0', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useKeyboardNavigation({ itemCount: 5, onSelect })
    )

    expect(result.current.focusedIndex).toBe(0)
  })

  it('ArrowDown increments focusedIndex', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useKeyboardNavigation({ itemCount: 5, onSelect })
    )

    act(() => {
      dispatchKeyEvent('ArrowDown')
    })

    expect(result.current.focusedIndex).toBe(1)
  })

  it('j increments focusedIndex (vim-style)', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useKeyboardNavigation({ itemCount: 5, onSelect })
    )

    act(() => {
      dispatchKeyEvent('j')
    })

    expect(result.current.focusedIndex).toBe(1)
  })

  it('ArrowUp decrements focusedIndex', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useKeyboardNavigation({ itemCount: 5, onSelect })
    )

    // First move down
    act(() => {
      dispatchKeyEvent('ArrowDown')
      dispatchKeyEvent('ArrowDown')
    })

    expect(result.current.focusedIndex).toBe(2)

    // Then move up
    act(() => {
      dispatchKeyEvent('ArrowUp')
    })

    expect(result.current.focusedIndex).toBe(1)
  })

  it('k decrements focusedIndex (vim-style)', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useKeyboardNavigation({ itemCount: 5, onSelect })
    )

    // First move down
    act(() => {
      dispatchKeyEvent('j')
      dispatchKeyEvent('j')
    })

    expect(result.current.focusedIndex).toBe(2)

    // Then move up
    act(() => {
      dispatchKeyEvent('k')
    })

    expect(result.current.focusedIndex).toBe(1)
  })

  it('does not go below 0', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useKeyboardNavigation({ itemCount: 5, onSelect })
    )

    act(() => {
      dispatchKeyEvent('ArrowUp')
    })

    expect(result.current.focusedIndex).toBe(0)
  })

  it('does not exceed itemCount - 1', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useKeyboardNavigation({ itemCount: 3, onSelect })
    )

    act(() => {
      dispatchKeyEvent('ArrowDown')
      dispatchKeyEvent('ArrowDown')
      dispatchKeyEvent('ArrowDown')
      dispatchKeyEvent('ArrowDown')
    })

    expect(result.current.focusedIndex).toBe(2)
  })

  it('Enter calls onSelect with current index', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useKeyboardNavigation({ itemCount: 5, onSelect })
    )

    // Move down twice
    act(() => {
      dispatchKeyEvent('ArrowDown')
      dispatchKeyEvent('ArrowDown')
    })

    expect(result.current.focusedIndex).toBe(2)

    // Press Enter
    act(() => {
      dispatchKeyEvent('Enter')
    })

    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('Escape calls onEscape', () => {
    const onSelect = vi.fn()
    const onEscape = vi.fn()
    renderHook(() =>
      useKeyboardNavigation({ itemCount: 5, onSelect, onEscape })
    )

    act(() => {
      dispatchKeyEvent('Escape')
    })

    expect(onEscape).toHaveBeenCalled()
  })

  it('Escape does nothing when onEscape is not provided', () => {
    const onSelect = vi.fn()
    // Should not throw
    renderHook(() => useKeyboardNavigation({ itemCount: 5, onSelect }))

    act(() => {
      dispatchKeyEvent('Escape')
    })

    // No error should occur
  })

  it('ignores keys when focus is in input', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useKeyboardNavigation({ itemCount: 5, onSelect })
    )

    const input = document.createElement('input')
    document.body.appendChild(input)

    act(() => {
      dispatchKeyEvent('ArrowDown', input)
    })

    expect(result.current.focusedIndex).toBe(0)

    document.body.removeChild(input)
  })

  it('ignores keys when focus is in textarea', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useKeyboardNavigation({ itemCount: 5, onSelect })
    )

    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)

    act(() => {
      dispatchKeyEvent('ArrowDown', textarea)
    })

    expect(result.current.focusedIndex).toBe(0)

    document.body.removeChild(textarea)
  })

  it('resets index when itemCount changes', () => {
    const onSelect = vi.fn()
    const { result, rerender } = renderHook(
      ({ itemCount }) => useKeyboardNavigation({ itemCount, onSelect }),
      { initialProps: { itemCount: 10 } }
    )

    // Move to index 5
    act(() => {
      for (let i = 0; i < 5; i++) {
        dispatchKeyEvent('ArrowDown')
      }
    })

    expect(result.current.focusedIndex).toBe(5)

    // Change itemCount to 3 - index should be clamped to 2
    rerender({ itemCount: 3 })

    expect(result.current.focusedIndex).toBe(2)
  })

  it('resets to 0 when itemCount becomes 0', () => {
    const onSelect = vi.fn()
    const { result, rerender } = renderHook(
      ({ itemCount }) => useKeyboardNavigation({ itemCount, onSelect }),
      { initialProps: { itemCount: 5 } }
    )

    // Move down
    act(() => {
      dispatchKeyEvent('ArrowDown')
    })

    expect(result.current.focusedIndex).toBe(1)

    // Set itemCount to 0
    rerender({ itemCount: 0 })

    expect(result.current.focusedIndex).toBe(0)
  })

  it('does not respond to keys when enabled=false', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useKeyboardNavigation({ itemCount: 5, onSelect, enabled: false })
    )

    act(() => {
      dispatchKeyEvent('ArrowDown')
    })

    expect(result.current.focusedIndex).toBe(0)

    act(() => {
      dispatchKeyEvent('Enter')
    })

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('responds to keys when enabled changes from false to true', () => {
    const onSelect = vi.fn()
    const { result, rerender } = renderHook(
      ({ enabled }) => useKeyboardNavigation({ itemCount: 5, onSelect, enabled }),
      { initialProps: { enabled: false } }
    )

    act(() => {
      dispatchKeyEvent('ArrowDown')
    })

    expect(result.current.focusedIndex).toBe(0)

    // Enable the hook
    rerender({ enabled: true })

    act(() => {
      dispatchKeyEvent('ArrowDown')
    })

    expect(result.current.focusedIndex).toBe(1)
  })

  it('provides setFocusedIndex to manually control focus', () => {
    const onSelect = vi.fn()
    const { result } = renderHook(() =>
      useKeyboardNavigation({ itemCount: 5, onSelect })
    )

    act(() => {
      result.current.setFocusedIndex(3)
    })

    expect(result.current.focusedIndex).toBe(3)
  })

  it('cleans up event listener on unmount', () => {
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')
    const onSelect = vi.fn()

    const { unmount } = renderHook(() =>
      useKeyboardNavigation({ itemCount: 5, onSelect })
    )

    unmount()

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'keydown',
      expect.any(Function)
    )

    removeEventListenerSpy.mockRestore()
  })
})
