import { describe, expect, it } from "vitest"
import { buildCommandSchema, buildHelpPayload } from "../../apps/cli/src/help-registry.js"

describe("help registry parsing", () => {

  it("parses explicit arguments for compound commands", () => {
    const schema = buildCommandSchema("task dep block")

    expect(schema.arguments.map((argument) => argument.name)).toEqual(["<task-id>", "<blocker-id>"])
    expect(schema.arguments.every((argument) => argument.required)).toBe(true)
  })

  it("keeps deprecated aliases out of the root machine-readable catalog", () => {
    const payload = buildHelpPayload([]) as {
      kind: string
      help: {
        commands: Array<{ key: string }>
      }
    }

    const keys = payload.help.commands.map((entry) => entry.key)

    expect(payload.kind).toBe("catalog")
    expect(keys).toContain("task")
    expect(keys).toContain("schema")
    expect(keys).not.toContain("block")
    expect(keys).not.toContain("ack:all")
  })
  it("separates option values from required and optional positional arguments", () => {
    const run = buildCommandSchema("spec run")
    expect(run.arguments).toEqual([{ name: "<test-id>", required: true }])
    expect(run.usage).toEqual(["tx spec run <test-id> --passed|--failed [--duration <ms>] [--details <text>] [--json]"])
    expect(run.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ flags: ["--passed"] }),
      expect.objectContaining({ flags: ["--failed"] }),
      expect.objectContaining({ flags: ["--duration"], valueName: "<ms>" }),
    ]))
    const link = buildCommandSchema("spec link")
    expect(link.arguments).toEqual([
      { name: "<inv-id>", required: true }, { name: "<file>", required: true }, { name: "<name>", required: false },
    ])
    expect(link.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ flags: ["--framework"], valueName: "<name>" }),
    ]))
  })

})
