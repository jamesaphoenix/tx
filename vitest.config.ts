import { defineConfig } from "vitest/config"

// Run with: bunx --bun vitest run
// The --bun flag ensures bun is the runtime so bun:sqlite is available in forked workers.
export default defineConfig({
  resolve: {
    conditions: ["bun"],
  },
  ssr: {
    external: ["bun:sqlite"],
    noExternal: [],
  },
  test: {
    include: [
      "test/**/*.test.ts",
      "eslint-plugin-tx/tests/**/*.test.js"
    ],
    setupFiles: ["./vitest.setup.ts"],
    environment: "node",
    testTimeout: 10000,
    teardownTimeout: 10000,
    hookTimeout: 60000,
    pool: "forks",
    // Vitest 4: poolOptions moved to top-level
    maxWorkers: 4,
    isolate: true,
    sequence: {
      concurrent: false
    },
    server: {
      deps: {
        external: ["bun:sqlite"],
      }
    }
  }
})
