import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "eslint-plugin-tx/tests/**/*.test.js"],
    environment: "node",
    testTimeout: 10000,
    // Use forks pool with single worker to avoid vitest worker communication timeouts in CI
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: process.env.CI === "true"
      }
    },
    // Increase timeouts for CI stability
    teardownTimeout: 10000,
    // Increase the hook timeout for RPC communication between processes
    hookTimeout: 60000
  }
})
