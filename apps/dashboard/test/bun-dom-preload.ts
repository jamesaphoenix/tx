/**
 * Preload script for bun test runner to provide DOM globals (document, window, etc.)
 * and browser API mocks (IntersectionObserver, ResizeObserver, matchMedia).
 *
 * Vitest uses its own `environment: 'jsdom'` + `test/setup.ts`; this file provides
 * the equivalent for `bun test` so dashboard tests work with either runner.
 *
 * IMPORTANT: DOM globals MUST be installed before any @testing-library imports,
 * because testing-library checks for `document` at module load time. We use
 * dynamic imports to ensure correct ordering.
 *
 * Limitations: Some vitest-specific APIs (vi.useFakeTimers, vi.stubGlobal) are
 * not available in bun's test runner. Tests using these will still need vitest.
 * The setup.ts file handles this gracefully with fallbacks.
 */
import { JSDOM } from "jsdom"
import { afterEach, expect, mock } from "bun:test"

// --- 1. DOM globals (must happen before testing-library loads) -----------------

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
})

const domGlobals: Record<string, unknown> = {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  HTMLInputElement: dom.window.HTMLInputElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  HTMLSelectElement: dom.window.HTMLSelectElement,
  HTMLButtonElement: dom.window.HTMLButtonElement,
  HTMLAnchorElement: dom.window.HTMLAnchorElement,
  HTMLFormElement: dom.window.HTMLFormElement,
  HTMLDivElement: dom.window.HTMLDivElement,
  HTMLSpanElement: dom.window.HTMLSpanElement,
  HTMLImageElement: dom.window.HTMLImageElement,
  HTMLUListElement: dom.window.HTMLUListElement,
  HTMLLIElement: dom.window.HTMLLIElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  NodeList: dom.window.NodeList,
  DocumentFragment: dom.window.DocumentFragment,
  Event: dom.window.Event,
  MouseEvent: dom.window.MouseEvent,
  KeyboardEvent: dom.window.KeyboardEvent,
  FocusEvent: dom.window.FocusEvent,
  InputEvent: dom.window.InputEvent,
  CustomEvent: dom.window.CustomEvent,
  MutationObserver: dom.window.MutationObserver,
  getComputedStyle: dom.window.getComputedStyle,
  requestAnimationFrame: dom.window.requestAnimationFrame,
  cancelAnimationFrame: dom.window.cancelAnimationFrame,
  DOMParser: dom.window.DOMParser,
  XMLSerializer: dom.window.XMLSerializer,
  SVGElement: dom.window.SVGElement,
  Text: dom.window.Text,
  Comment: dom.window.Comment,
  CSSStyleDeclaration: dom.window.CSSStyleDeclaration,
}

for (const [key, value] of Object.entries(domGlobals)) {
  if (value !== undefined) {
    Object.defineProperty(globalThis, key, {
      value,
      writable: true,
      configurable: true,
    })
  }
}

// --- 2. Browser API mocks (before testing-library, since tests may use them) ---

// IntersectionObserver
class MockIntersectionObserver {
  readonly root: Element | null = null
  readonly rootMargin: string = ""
  readonly thresholds: ReadonlyArray<number> = []
  constructor(_callback: unknown, _options?: unknown) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return []
  }
}
;(globalThis as Record<string, unknown>).IntersectionObserver =
  MockIntersectionObserver

// ResizeObserver
class MockResizeObserver {
  constructor(_callback: unknown) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
;(globalThis as Record<string, unknown>).ResizeObserver = MockResizeObserver

// matchMedia
Object.defineProperty(dom.window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: mock(() => {}),
    removeListener: mock(() => {}),
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
    dispatchEvent: mock(() => false),
  }),
})

// scrollIntoView
dom.window.Element.prototype.scrollIntoView = mock(() => {})

// --- 3. jest-dom matchers (dynamic import — after DOM is ready) ----------------

const jestDomMatchers = await import("@testing-library/jest-dom/matchers")
expect.extend(jestDomMatchers as unknown as Parameters<typeof expect.extend>[0])

// --- 4. Testing-library cleanup ------------------------------------------------
// Auto-cleanup may not detect bun's test runner, so register explicitly.

const { cleanup } = await import("@testing-library/react")
afterEach(() => cleanup())
