import { defineConfig } from "vitest/config"

// NOTE: Root-level tests now use `bun test` instead of vitest for bun:sqlite compatibility.
// This config is kept for package-level vitest tests that don't use bun:sqlite.
export default defineConfig({
  test: {
    // Root tests moved to bun test - this config is for packages only
    include: [],
    setupFiles: ["./vitest.setup.ts"],
    environment: "node",
    testTimeout: 10000,
    // Increase timeouts for CI stability
    teardownTimeout: 10000,
    hookTimeout: 60000,
    // Limit parallelization to prevent memory exhaustion
    // Each fork process uses a singleton in-memory SQLite database (see vitest.setup.ts)
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 4,  // Limit to 4 parallel test files
        minForks: 1
      }
    },
    // Isolate tests to prevent memory leaks between files
    isolate: true,
    // Force sequential within a file to reduce concurrent DBs
    sequence: {
      concurrent: false
    }
  }
})
