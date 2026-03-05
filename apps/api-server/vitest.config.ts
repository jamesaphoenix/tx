import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

const ROOT_DIR = fileURLToPath(new URL("../..", import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@jamesaphoenix\/tx-core$/,
        replacement: resolve(ROOT_DIR, "packages/core/src/index.ts"),
      },
      {
        find: /^@jamesaphoenix\/tx-types$/,
        replacement: resolve(ROOT_DIR, "packages/types/src/index.ts"),
      },
    ],
  },
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
