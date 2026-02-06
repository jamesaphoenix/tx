import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { setupServer } from 'msw/node'

// MSW server instance for API mocking
export const server = setupServer()

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))

// Reset handlers after each test for clean state
afterEach(() => server.resetHandlers())

// Clean up after all tests are done
afterAll(() => server.close())

// Helper: set global — use vi.stubGlobal when available (vitest), fall back to
// direct globalThis assignment (bun test runner).
const setGlobal = (key: string, value: unknown) => {
  if (typeof vi.stubGlobal === 'function') {
    vi.stubGlobal(key, value)
  } else {
    ;(globalThis as Record<string, unknown>)[key] = value
  }
}

// Helper: create a mock function — vi.fn() in vitest, plain function in bun
const createMock = () =>
  typeof vi.fn === 'function' ? vi.fn() : (() => {})

// Mock IntersectionObserver
class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | null = null
  readonly rootMargin: string = ''
  readonly thresholds: ReadonlyArray<number> = []

  constructor(
    _callback: IntersectionObserverCallback,
    _options?: IntersectionObserverInit
  ) {}

  observe(_target: Element): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

setGlobal('IntersectionObserver', MockIntersectionObserver)

// Mock ResizeObserver (commonly needed for React components)
class MockResizeObserver implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe(_target: Element, _options?: ResizeObserverOptions): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}

setGlobal('ResizeObserver', MockResizeObserver)

// Mock matchMedia (commonly needed for responsive components)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: createMock(),
    removeListener: createMock(),
    addEventListener: createMock(),
    removeEventListener: createMock(),
    dispatchEvent: createMock(),
  })),
})

// Mock Element.scrollIntoView (not implemented in jsdom)
Element.prototype.scrollIntoView = vi.fn()
