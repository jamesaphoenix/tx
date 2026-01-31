import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { useIntersectionObserver } from '../useIntersectionObserver'
import React from 'react'

describe('useIntersectionObserver', () => {
  let mockObserve: ReturnType<typeof vi.fn>
  let mockUnobserve: ReturnType<typeof vi.fn>
  let mockDisconnect: ReturnType<typeof vi.fn>
  let intersectionCallback: IntersectionObserverCallback | null = null
  let constructorSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockObserve = vi.fn()
    mockUnobserve = vi.fn()
    mockDisconnect = vi.fn()
    constructorSpy = vi.fn()
    intersectionCallback = null

    const MockIntersectionObserver = vi.fn((
      callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit
    ) => {
      intersectionCallback = callback
      constructorSpy(options)
      return {
        observe: mockObserve,
        unobserve: mockUnobserve,
        disconnect: mockDisconnect,
        root: null,
        rootMargin: '',
        thresholds: [],
        takeRecords: () => [],
      }
    })

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Test component that attaches the ref to a div
  function TestComponent({
    onIntersect,
    enabled = true,
    threshold,
    rootMargin,
  }: {
    onIntersect: () => void
    enabled?: boolean
    threshold?: number
    rootMargin?: string
  }) {
    const ref = useIntersectionObserver({
      onIntersect,
      enabled,
      threshold,
      rootMargin,
    })
    return React.createElement('div', { ref, 'data-testid': 'sentinel' })
  }

  it('returns a ref to attach to an element', () => {
    const onIntersect = vi.fn()
    const { result } = renderHook(() =>
      useIntersectionObserver({ onIntersect })
    )

    expect(result.current).toBeDefined()
    expect(result.current.current).toBeNull()
  })

  it('calls onIntersect when element intersects', () => {
    const onIntersect = vi.fn()

    render(React.createElement(TestComponent, { onIntersect }))

    // Observer should have been created and observe called
    expect(mockObserve).toHaveBeenCalled()

    // Simulate intersection event
    const element = document.querySelector('[data-testid="sentinel"]')!
    const mockEntry: IntersectionObserverEntry = {
      isIntersecting: true,
      boundingClientRect: element.getBoundingClientRect(),
      intersectionRatio: 1,
      intersectionRect: element.getBoundingClientRect(),
      rootBounds: null,
      target: element,
      time: Date.now(),
    }

    act(() => {
      intersectionCallback!([mockEntry], {} as IntersectionObserver)
    })

    expect(onIntersect).toHaveBeenCalledTimes(1)
  })

  it('does not call onIntersect when enabled=false', () => {
    const onIntersect = vi.fn()

    render(React.createElement(TestComponent, { onIntersect, enabled: false }))

    // Observer should not be created when disabled
    expect(mockObserve).not.toHaveBeenCalled()
    expect(onIntersect).not.toHaveBeenCalled()
  })

  it('cleans up observer on unmount', () => {
    const onIntersect = vi.fn()

    const { unmount } = render(React.createElement(TestComponent, { onIntersect }))

    // Observer should be observing
    expect(mockObserve).toHaveBeenCalled()

    unmount()

    // Disconnect should be called on cleanup
    expect(mockDisconnect).toHaveBeenCalled()
  })

  it('does not create observer when no element is attached', () => {
    const onIntersect = vi.fn()

    // Using renderHook, ref.current is always null
    renderHook(() => useIntersectionObserver({ onIntersect }))

    // With ref.current being null, observe should not be called
    expect(mockObserve).not.toHaveBeenCalled()
  })

  it('does not call onIntersect when isIntersecting is false', () => {
    const onIntersect = vi.fn()

    render(React.createElement(TestComponent, { onIntersect }))

    // Simulate non-intersecting event
    const element = document.querySelector('[data-testid="sentinel"]')!
    const mockEntry: IntersectionObserverEntry = {
      isIntersecting: false,
      boundingClientRect: element.getBoundingClientRect(),
      intersectionRatio: 0,
      intersectionRect: element.getBoundingClientRect(),
      rootBounds: null,
      target: element,
      time: Date.now(),
    }

    act(() => {
      intersectionCallback!([mockEntry], {} as IntersectionObserver)
    })

    expect(onIntersect).not.toHaveBeenCalled()
  })

  it('uses default options (threshold: 0.1, rootMargin: 100px)', () => {
    const onIntersect = vi.fn()

    render(React.createElement(TestComponent, { onIntersect }))

    expect(constructorSpy).toHaveBeenCalledWith({
      threshold: 0.1,
      rootMargin: '100px',
    })
  })

  it('uses provided options', () => {
    const onIntersect = vi.fn()

    render(
      React.createElement(TestComponent, {
        onIntersect,
        threshold: 0.5,
        rootMargin: '50px',
      })
    )

    expect(constructorSpy).toHaveBeenCalledWith({
      threshold: 0.5,
      rootMargin: '50px',
    })
  })

  it('updates callback without recreating observer', () => {
    const onIntersect1 = vi.fn()
    const onIntersect2 = vi.fn()

    const { rerender } = render(
      React.createElement(TestComponent, { onIntersect: onIntersect1 })
    )

    // Initial render should create observer
    expect(mockObserve).toHaveBeenCalledTimes(1)

    // Update callback
    rerender(React.createElement(TestComponent, { onIntersect: onIntersect2 }))

    // Simulate intersection - should use the new callback
    const element = document.querySelector('[data-testid="sentinel"]')!
    const mockEntry: IntersectionObserverEntry = {
      isIntersecting: true,
      boundingClientRect: element.getBoundingClientRect(),
      intersectionRatio: 1,
      intersectionRect: element.getBoundingClientRect(),
      rootBounds: null,
      target: element,
      time: Date.now(),
    }

    act(() => {
      intersectionCallback!([mockEntry], {} as IntersectionObserver)
    })

    // The new callback should be called, not the old one
    expect(onIntersect1).not.toHaveBeenCalled()
    expect(onIntersect2).toHaveBeenCalledTimes(1)
  })
})
