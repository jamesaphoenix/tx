/**
 * @fileoverview Tests for the require-primitive-docs ESLint rule
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import fs from "fs"
import rule, { _resetReported } from "../rules/require-primitive-docs.js"

vi.mock("fs", () => ({
  default: {
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}))

// -- Test fixtures --

const GOOD_MDX = `---
title: tx ready
---

## Usage

<Tabs groupId="interface" persist items={["CLI", "TypeScript SDK", "MCP", "REST API"]}>
<Tab value="CLI">

\`\`\`bash
tx ready --limit 5
\`\`\`

</Tab>
<Tab value="TypeScript SDK">

\`\`\`typescript
import { TxClient } from '@jamesaphoenix/tx-agent-sdk'
const tx = new TxClient({ dbPath: '.tx/tasks.db' })
const ready = await tx.tasks.ready({ limit: 5 })
\`\`\`

</Tab>
<Tab value="MCP">

\`\`\`json
{ "name": "tx_ready", "arguments": { "limit": 5 } }
\`\`\`

</Tab>
<Tab value="REST API">

\`\`\`bash
curl http://localhost:3456/api/tasks/ready?limit=5
\`\`\`

</Tab>
</Tabs>`

const MISSING_SDK_TAB_MDX = `---
title: tx broken
---

<Tabs groupId="interface" persist items={["CLI", "MCP", "REST API"]}>
<Tab value="CLI">

\`\`\`bash
tx broken
\`\`\`

</Tab>
<Tab value="MCP">

\`\`\`json
{ "name": "tx_broken" }
\`\`\`

</Tab>
<Tab value="REST API">

\`\`\`bash
curl http://localhost:3456/api/broken
\`\`\`

</Tab>
</Tabs>`

const PLACEHOLDER_MDX = `---
title: tx attempts
---

<Tabs groupId="interface" persist items={["CLI", "TypeScript SDK", "MCP", "REST API"]}>
<Tab value="CLI">

\`\`\`bash
tx try tx-abc123 "approach"
\`\`\`

</Tab>
<Tab value="TypeScript SDK">

\`\`\`typescript
import { TxClient } from '@jamesaphoenix/tx-agent-sdk'
const tx = new TxClient({ dbPath: '.tx/tasks.db' })
await tx.attempts.record('tx-abc123', { approach: 'regex' })
\`\`\`

</Tab>
<Tab value="MCP">

MCP tools for attempts are planned for future release.

</Tab>
<Tab value="REST API">

REST API endpoints are not yet implemented.

</Tab>
</Tabs>`

const BANNED_IMPORT_MDX = `---
title: tx bad
---

<Tabs groupId="interface" persist items={["CLI", "TypeScript SDK", "MCP", "REST API"]}>
<Tab value="CLI">

\`\`\`bash
tx bad
\`\`\`

</Tab>
<Tab value="TypeScript SDK">

\`\`\`typescript
import { AttemptService } from '@jamesaphoenix/tx-core'
import { Effect } from 'effect'
const result = yield* AttemptService
\`\`\`

</Tab>
<Tab value="MCP">

\`\`\`json
{ "name": "tx_bad" }
\`\`\`

</Tab>
<Tab value="REST API">

\`\`\`bash
curl http://localhost:3456/api/bad
\`\`\`

</Tab>
</Tabs>`

const BANNED_FUNCTION_MDX = `---
title: tx sync
---

<Tabs groupId="interface" persist items={["CLI", "TypeScript SDK", "MCP", "REST API"]}>
<Tab value="CLI">

\`\`\`bash
tx sync export
\`\`\`

</Tab>
<Tab value="TypeScript SDK">

\`\`\`typescript
import { createTx, SyncService } from '@jamesaphoenix/tx'
const tx = createTx()
await tx.run(Effect.gen(function* () {
  const sync = yield* SyncService
  yield* sync.exportToJsonl()
}))
\`\`\`

</Tab>
<Tab value="MCP">

\`\`\`json
{ "name": "tx_sync_export" }
\`\`\`

</Tab>
<Tab value="REST API">

\`\`\`bash
curl -X POST http://localhost:3456/api/sync/export
\`\`\`

</Tab>
</Tabs>`

const NO_CODE_BLOCK_MDX = `---
title: tx empty
---

<Tabs groupId="interface" persist items={["CLI", "TypeScript SDK", "MCP", "REST API"]}>
<Tab value="CLI">

Just run the tx empty command.

</Tab>
<Tab value="TypeScript SDK">

\`\`\`typescript
import { TxClient } from '@jamesaphoenix/tx-agent-sdk'
\`\`\`

</Tab>
<Tab value="MCP">

\`\`\`json
{ "name": "tx_empty" }
\`\`\`

</Tab>
<Tab value="REST API">

\`\`\`bash
curl http://localhost:3456/api/empty
\`\`\`

</Tab>
</Tabs>`

const PLANNED_MDX = `---
title: tx checkpoint
---

> **Status**: Planned - This primitive is not yet implemented.

## Purpose

Checkpoint allows saving progress on long-running tasks.`

const CORE_IMPORT_IN_CLI_TAB_MDX = `---
title: tx context
---

<Tabs groupId="interface" persist items={["CLI", "TypeScript SDK", "MCP", "REST API"]}>
<Tab value="CLI">

For Effect-based access, use RetrieverService from @jamesaphoenix/tx-core directly.

\`\`\`bash
tx context tx-abc123
\`\`\`

</Tab>
<Tab value="TypeScript SDK">

\`\`\`typescript
import { TxClient } from '@jamesaphoenix/tx-agent-sdk'
const tx = new TxClient({ dbPath: '.tx/tasks.db' })
const ctx = await tx.context.forTask('tx-abc123')
\`\`\`

</Tab>
<Tab value="MCP">

\`\`\`json
{ "name": "tx_context", "arguments": { "taskId": "tx-abc123" } }
\`\`\`

</Tab>
<Tab value="REST API">

\`\`\`bash
curl http://localhost:3456/api/tasks/tx-abc123/context
\`\`\`

</Tab>
</Tabs>`

// -- Helpers --

function createContext(options = {}, filename = "/project/apps/cli/src/commands/task.ts") {
  const messages = []
  return {
    options: [options],
    filename,
    getFilename: () => filename,
    cwd: "/project",
    report: (info) => messages.push(info),
    _messages: messages,
  }
}

function createProgramNode() {
  return { type: "Program", body: [] }
}

function setupMocks(docMap = {}) {
  const files = Object.keys(docMap).map((name) => `${name}.mdx`)
  fs.readdirSync.mockReturnValue(files)
  fs.readFileSync.mockImplementation((filePath) => {
    for (const [name, content] of Object.entries(docMap)) {
      if (filePath.includes(`${name}.mdx`)) return content
    }
    throw new Error("ENOENT")
  })
}

const DEFAULT_OPTIONS = {
  docsDir: "apps/docs/content/docs/primitives",
  requiredTabs: ["CLI", "TypeScript SDK", "MCP", "REST API"],
  bannedPatterns: ["planned for future release", "not yet implemented"],
  bannedImports: ["@jamesaphoenix/tx-core"],
  bannedFunctions: ["createTx"],
}

// -- Tests --

describe("require-primitive-docs rule", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetReported()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe("meta", () => {
    it("has correct type", () => {
      expect(rule.meta.type).toBe("problem")
    })

    it("has all messages defined", () => {
      expect(rule.meta.messages.missingTab).toContain("missing")
      expect(rule.meta.messages.placeholderContent).toContain("placeholder")
      expect(rule.meta.messages.bannedImport).toContain("banned import")
      expect(rule.meta.messages.bannedFunction).toContain("banned function")
      expect(rule.meta.messages.missingCodeBlock).toContain("no code block")
    })

    it("has schema", () => {
      expect(rule.meta.schema).toHaveLength(1)
      expect(rule.meta.schema[0].properties.docsDir).toBeDefined()
      expect(rule.meta.schema[0].properties.requiredTabs).toBeDefined()
      expect(rule.meta.schema[0].properties.bannedPatterns).toBeDefined()
    })
  })

  describe("well-formed MDX", () => {
    it("reports nothing for a complete, correct doc", () => {
      setupMocks({ ready: GOOD_MDX })

      const context = createContext(DEFAULT_OPTIONS)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })

  describe("missing tab", () => {
    it("reports when TypeScript SDK tab is absent", () => {
      setupMocks({ broken: MISSING_SDK_TAB_MDX })

      const context = createContext(DEFAULT_OPTIONS)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      const missing = context._messages.filter((m) => m.messageId === "missingTab")
      expect(missing).toHaveLength(1)
      expect(missing[0].data.primitive).toBe("broken")
      expect(missing[0].data.tab).toBe("TypeScript SDK")
    })
  })

  describe("placeholder content", () => {
    it("reports 'planned for future release' in MCP tab", () => {
      setupMocks({ attempts: PLACEHOLDER_MDX })

      const context = createContext(DEFAULT_OPTIONS)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      const placeholders = context._messages.filter(
        (m) => m.messageId === "placeholderContent"
      )
      expect(placeholders.length).toBeGreaterThanOrEqual(1)

      const mcpPlaceholder = placeholders.find(
        (m) => m.data.tab === "MCP" && m.data.match === "planned for future release"
      )
      expect(mcpPlaceholder).toBeDefined()
    })

    it("reports 'not yet implemented' in REST API tab", () => {
      setupMocks({ attempts: PLACEHOLDER_MDX })

      const context = createContext(DEFAULT_OPTIONS)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      const placeholders = context._messages.filter(
        (m) =>
          m.messageId === "placeholderContent" &&
          m.data.tab === "REST API" &&
          m.data.match === "not yet implemented"
      )
      expect(placeholders).toHaveLength(1)
    })
  })

  describe("banned import in SDK tab", () => {
    it("reports @jamesaphoenix/tx-core import in TypeScript SDK tab", () => {
      setupMocks({ bad: BANNED_IMPORT_MDX })

      const context = createContext(DEFAULT_OPTIONS)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      const banned = context._messages.filter((m) => m.messageId === "bannedImport")
      expect(banned).toHaveLength(1)
      expect(banned[0].data.primitive).toBe("bad")
      expect(banned[0].data.tab).toBe("TypeScript SDK")
      expect(banned[0].data.import).toBe("@jamesaphoenix/tx-core")
    })
  })

  describe("banned import NOT in CLI tab", () => {
    it("does not report @jamesaphoenix/tx-core mention in CLI tab", () => {
      setupMocks({ context: CORE_IMPORT_IN_CLI_TAB_MDX })

      const context = createContext(DEFAULT_OPTIONS)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      const banned = context._messages.filter((m) => m.messageId === "bannedImport")
      expect(banned).toHaveLength(0)
    })
  })

  describe("banned function", () => {
    it("reports createTx() usage in TypeScript SDK tab", () => {
      setupMocks({ sync: BANNED_FUNCTION_MDX })

      const context = createContext(DEFAULT_OPTIONS)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      const banned = context._messages.filter((m) => m.messageId === "bannedFunction")
      expect(banned.length).toBeGreaterThanOrEqual(1)

      const sdkBanned = banned.find(
        (m) => m.data.tab === "TypeScript SDK" && m.data.function === "createTx"
      )
      expect(sdkBanned).toBeDefined()
    })
  })

  describe("missing code block", () => {
    it("reports when CLI tab has no code block", () => {
      setupMocks({ empty: NO_CODE_BLOCK_MDX })

      const context = createContext(DEFAULT_OPTIONS)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      const noCode = context._messages.filter(
        (m) => m.messageId === "missingCodeBlock" && m.data.tab === "CLI"
      )
      expect(noCode).toHaveLength(1)
      expect(noCode[0].data.primitive).toBe("empty")
    })
  })

  describe("planned primitive skipped", () => {
    it("skips all checks for primitives with Status: Planned", () => {
      setupMocks({ checkpoint: PLANNED_MDX })

      const context = createContext(DEFAULT_OPTIONS)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("does NOT skip when skipPlanned is false", () => {
      setupMocks({ checkpoint: PLANNED_MDX })

      const context = createContext({ ...DEFAULT_OPTIONS, skipPlanned: false })
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      // Should report missing tabs since the planned MDX has no tabs
      const missing = context._messages.filter((m) => m.messageId === "missingTab")
      expect(missing.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe("multiple tab groups", () => {
    it("handles MDX with multiple Tabs groups (same tab values)", () => {
      const multiGroup = `---
title: tx claim
---

## Claim a Task

<Tabs groupId="interface" persist items={["CLI", "TypeScript SDK", "MCP", "REST API"]}>
<Tab value="CLI">

\`\`\`bash
tx claim tx-abc123 worker-1
\`\`\`

</Tab>
<Tab value="TypeScript SDK">

\`\`\`typescript
import { TxClient } from '@jamesaphoenix/tx-agent-sdk'
const tx = new TxClient({ dbPath: '.tx/tasks.db' })
await tx.claims.claim('tx-abc123', 'worker-1')
\`\`\`

</Tab>
<Tab value="MCP">

\`\`\`json
{ "name": "tx_claim", "arguments": { "taskId": "tx-abc123", "worker": "worker-1" } }
\`\`\`

</Tab>
<Tab value="REST API">

\`\`\`bash
curl -X POST http://localhost:3456/api/tasks/tx-abc123/claim
\`\`\`

</Tab>
</Tabs>

## Release a Claim

<Tabs groupId="interface" persist items={["CLI", "TypeScript SDK", "MCP", "REST API"]}>
<Tab value="CLI">

\`\`\`bash
tx claim:release tx-abc123 worker-1
\`\`\`

</Tab>
<Tab value="TypeScript SDK">

\`\`\`typescript
await tx.claims.release('tx-abc123', 'worker-1')
\`\`\`

</Tab>
<Tab value="MCP">

\`\`\`json
{ "name": "tx_claim_release" }
\`\`\`

</Tab>
<Tab value="REST API">

\`\`\`bash
curl -X DELETE http://localhost:3456/api/tasks/tx-abc123/claim
\`\`\`

</Tab>
</Tabs>`

      setupMocks({ claim: multiGroup })

      const context = createContext(DEFAULT_OPTIONS)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })

  describe("file skipping", () => {
    it("skips non-TS files", () => {
      setupMocks({ ready: GOOD_MDX })

      const context = createContext(DEFAULT_OPTIONS, "/project/package.json")
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("skips test files", () => {
      setupMocks({ ready: GOOD_MDX })

      const context = createContext(
        DEFAULT_OPTIONS,
        "/project/apps/cli/src/commands/task.test.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("skips files not under apps/", () => {
      setupMocks({ ready: GOOD_MDX })

      const context = createContext(
        DEFAULT_OPTIONS,
        "/project/packages/core/src/utils.ts"
      )
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })
  })

  describe("graceful error handling", () => {
    it("handles missing docs directory", () => {
      fs.readdirSync.mockImplementation(() => {
        throw new Error("ENOENT")
      })

      const context = createContext(DEFAULT_OPTIONS)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("handles unreadable MDX file", () => {
      fs.readdirSync.mockReturnValue(["ready.mdx", "broken.mdx"])
      fs.readFileSync.mockImplementation((filePath) => {
        if (filePath.includes("ready.mdx")) return GOOD_MDX
        throw new Error("ENOENT")
      })

      const context = createContext(DEFAULT_OPTIONS)
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      // ready.mdx should still be checked, broken.mdx skipped
      expect(context._messages).toHaveLength(0)
    })
  })

  describe("custom config", () => {
    it("respects custom requiredTabs", () => {
      setupMocks({ ready: GOOD_MDX })

      // Only require CLI and MCP
      const context = createContext({
        ...DEFAULT_OPTIONS,
        requiredTabs: ["CLI", "MCP"],
      })
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      expect(context._messages).toHaveLength(0)
    })

    it("respects custom bannedPatterns", () => {
      const mdxWithCustomBanned = `---
title: tx test
---

<Tabs groupId="interface" persist items={["CLI", "TypeScript SDK", "MCP", "REST API"]}>
<Tab value="CLI">

\`\`\`bash
tx test
\`\`\`

</Tab>
<Tab value="TypeScript SDK">

\`\`\`typescript
import { TxClient } from '@jamesaphoenix/tx-agent-sdk'
// TODO: implement this
\`\`\`

</Tab>
<Tab value="MCP">

\`\`\`json
{ "name": "tx_test" }
\`\`\`

</Tab>
<Tab value="REST API">

\`\`\`bash
curl http://localhost:3456/api/test
\`\`\`

</Tab>
</Tabs>`

      setupMocks({ test: mdxWithCustomBanned })

      const context = createContext({
        ...DEFAULT_OPTIONS,
        bannedPatterns: ["TODO: implement"],
      })
      const visitor = rule.create(context)
      visitor.Program(createProgramNode())

      const placeholders = context._messages.filter(
        (m) => m.messageId === "placeholderContent"
      )
      expect(placeholders).toHaveLength(1)
      expect(placeholders[0].data.match).toBe("TODO: implement")
    })
  })

  describe("additional banned pattern variants", () => {
    function makeMdxWithTextInTab(tabName, text) {
      return `---
title: tx test
---

<Tabs groupId="interface" persist items={["CLI", "TypeScript SDK", "MCP", "REST API"]}>
<Tab value="CLI">

\`\`\`bash
tx test
\`\`\`

</Tab>
<Tab value="TypeScript SDK">

\`\`\`typescript
import { TxClient } from '@jamesaphoenix/tx-agent-sdk'
\`\`\`

</Tab>
<Tab value="MCP">

\`\`\`json
{ "name": "tx_test" }
\`\`\`

</Tab>
<Tab value="REST API">

\`\`\`bash
curl http://localhost:3456/api/test
\`\`\`

${tabName === "REST API" ? text : ""}

</Tab>
</Tabs>`
    }

    const EXTENDED_BANNED_PATTERNS = [
      "planned for future release",
      "planned for a future release",
      "not yet implemented",
      "not yet available",
      "coming soon",
      "not yet exposed",
      "currently CLI-only",
      "currently available via CLI only",
      "localhost:3001",
    ]

    for (const pattern of EXTENDED_BANNED_PATTERNS) {
      it(`catches banned pattern: "${pattern}"`, () => {
        const mdx = makeMdxWithTextInTab("REST API", `This feature is ${pattern}.`)
        setupMocks({ testprim: mdx })

        const context = createContext({
          ...DEFAULT_OPTIONS,
          bannedPatterns: EXTENDED_BANNED_PATTERNS,
        })
        const visitor = rule.create(context)
        visitor.Program(createProgramNode())

        const placeholders = context._messages.filter(
          (m) => m.messageId === "placeholderContent" && m.data.match === pattern
        )
        expect(placeholders).toHaveLength(1)
      })
    }
  })
})
