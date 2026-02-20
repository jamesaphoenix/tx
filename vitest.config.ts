import { defineConfig } from "vitest/config"

const EFFECT_INFO_LOG_RE = /^timestamp=\d{4}-\d{2}-\d{2}T.* level=INFO fiber=#\d+ message=/

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
    exclude: [
      // Commands not yet registered in CLI — tests exist ahead of implementation
      "test/integration/daemon-cli.test.ts",
      "test/integration/cli-graph.test.ts",
      "test/integration/cli-test-cache.test.ts",
      // Timeout-prone due to retriever pipeline complexity in CI
      "test/integration/cli-learning.test.ts",
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
    onConsoleLog(log, type) {
      if (
        type === "stdout" &&
        (EFFECT_INFO_LOG_RE.test(log) || log.startsWith("runWorker: Worker "))
      ) {
        return false
      }
    },
    server: {
      deps: {
        external: ["bun:sqlite"],
      }
    }
  }
})
