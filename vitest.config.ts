import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "eslint-plugin-tx/tests/**/*.test.js"],
    environment: "node",
    testTimeout: 10000,
    // Increase timeouts for CI stability
    teardownTimeout: 10000,
    hookTimeout: 60000
  }
})
