/**
 * Dedicated vitest config for utils-usage tests.
 *
 * These tests are excluded from the main suite because they require
 * real CLIs + network access and update tools via brew/npm.
 *
 * Run: bunx --bun vitest run --config test/integration/vitest.utils-usage.config.ts
 */
import { defineConfig } from "vitest/config"
import { resolve } from "node:path"

const ROOT_DIR = resolve(import.meta.dirname, "../..")

export default defineConfig({
  resolve: {
    conditions: ["bun"],
    alias: [
      { find: /^@jamesaphoenix\/tx-core\/services$/, replacement: resolve(ROOT_DIR, "packages/core/src/services/index.ts") },
      { find: /^@jamesaphoenix\/tx-core$/, replacement: resolve(ROOT_DIR, "packages/core/src/index.ts") },
      { find: /^@jamesaphoenix\/tx-test-utils$/, replacement: resolve(ROOT_DIR, "packages/test-utils/src/index.ts") },
      { find: /^@jamesaphoenix\/tx-types$/, replacement: resolve(ROOT_DIR, "packages/types/src/index.ts") },
      { find: /^@jamesaphoenix\/tx$/, replacement: resolve(ROOT_DIR, "packages/tx/src/index.ts") },
    ],
  },
  test: {
    include: ["test/integration/utils-usage.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 300_000,
    pool: "forks",
    maxWorkers: 1,
  },
})
