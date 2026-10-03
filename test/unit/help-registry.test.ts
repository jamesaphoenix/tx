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
})
