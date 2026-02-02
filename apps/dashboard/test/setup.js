import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { setupServer } from 'msw/node';
// MSW server instance for API mocking
export const server = setupServer();
// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
// Reset handlers after each test for clean state
afterEach(() => server.resetHandlers());
// Clean up after all tests are done
afterAll(() => server.close());
// Mock IntersectionObserver
class MockIntersectionObserver {
    root = null;
    rootMargin = '';
    thresholds = [];
    constructor(_callback, _options) { }
    observe(_target) { }
    unobserve(_target) { }
    disconnect() { }
    takeRecords() {
        return [];
    }
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
// Mock ResizeObserver (commonly needed for React components)
class MockResizeObserver {
    constructor(_callback) { }
    observe(_target, _options) { }
    unobserve(_target) { }
    disconnect() { }
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);
// Mock matchMedia (commonly needed for responsive components)
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});
// Mock Element.scrollIntoView (not implemented in jsdom)
Element.prototype.scrollIntoView = vi.fn();
//# sourceMappingURL=setup.js.map