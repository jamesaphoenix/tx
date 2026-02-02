import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "eslint-plugin-tx/tests/**/*.test.js"],
    environment: "node",
    testTimeout: 10000,
    // Use forks pool for better stability in CI environments
    pool: "forks",
    // Reduce parallelism to avoid vitest worker communication timeouts
    poolOptions: {
      forks: {
        // Limit concurrent forks to reduce resource pressure
        maxForks: process.env.CI ? 2 : undefined,
        minForks: 1
      }
    },
    // Increase teardown timeout for CI stability
    teardownTimeout: 10000
  }
})
