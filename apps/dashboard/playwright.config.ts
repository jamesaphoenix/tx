import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5173",
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
    screenshot: "on",
  },
  webServer: {
    command: "bun run dev",
    port: 5173,
    reuseExistingServer: true,
    timeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
})
