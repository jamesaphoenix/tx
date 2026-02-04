import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 10000,
    coverage: {
      // Only measure coverage for files testable without bun:sqlite.
      // Route handlers and server-lib depend on tx-core (bun:sqlite) and
      // require `bun test` for integration testing.
      include: [
        "src/api.ts",
        "src/middleware/**",
        "src/utils/**",
      ],
    },
  },
})
