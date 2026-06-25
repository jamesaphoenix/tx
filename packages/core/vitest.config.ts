import { defineConfig } from "vitest/config"

// Colocated tests for the test utilities merged into @jamesaphoenix/tx (./testing).
// These are self-contained (relative imports, no shared DB singleton) so they run
// from this package directly via `bun run test` and the pre-commit hook's
// package-specific test step.
export default defineConfig({
  resolve: {
    conditions: ["bun"],
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 10000,
  },
})
