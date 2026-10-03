import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { conditions: ["bun"] },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 10000,
  },
})
