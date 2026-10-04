import { describe, expect, it } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CLI_VERSION } from "../../apps/cli/src/version.js"

describe("MCP release metadata", () => {
  it("reports the installed implementation version during client initialisation", async () => {
    const root = mkdtempSync(join(tmpdir(), "tx-mcp-version-"))
    const client = new Client({ name: "tx-version-proof", version: "1.0.0" })
    const transport = new StdioClientTransport({
      command: "bun",
      args: [fileURLToPath(new URL("../../apps/cli/src/mcp/server.ts", import.meta.url)), "--db", join(root, "tasks.db")],
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      stderr: "pipe",
    })
    try {
      await client.connect(transport)
      expect(client.getServerVersion()).toEqual({ name: "tx", version: CLI_VERSION })
    } finally {
      await client.close()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
