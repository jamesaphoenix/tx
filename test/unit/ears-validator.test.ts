import { describe, expect, it } from "vitest"
import { validateEarsRequirements } from "@jamesaphoenix/tx-core"

describe("EARS validator", () => {
  it("accepts valid requirements across all EARS patterns", () => {
    const requirements: unknown[] = [
      {
        id: "EARS-FL-001",
        pattern: "ubiquitous",
        system: "tx learn command",
        response: "persist learnings",
        priority: "must",
      },
      {
        id: "EARS-FL-002",
        pattern: "event_driven",
        trigger: "a user runs tx recall",
        system: "recall service",
        response: "return matching learnings",
      },
      {
        id: "EARS-FL-003",
        pattern: "state_driven",
        state: "the task is blocked",
        system: "ready service",
        response: "exclude the task from ready queue",
      },
      {
        id: "EARS-FL-004",
        pattern: "unwanted",
        condition: "input YAML is malformed",
        system: "doc service",
        response: "raise InvalidDocYamlError",
      },
      {
        id: "EARS-FL-005",
        pattern: "optional",
        feature: "dashboard mode",
        system: "dashboard api",
        response: "render assignment controls",
      },
      {
        id: "EARS-FL-006",
        pattern: "complex",
        trigger: "a task is completed",
        state: "dependent tasks exist",
        system: "ready service",
        response: "recompute readiness",
      },
    ]

    expect(validateEarsRequirements(requirements)).toHaveLength(0)
  })

  it("reports missing required fields", () => {
    const errors = validateEarsRequirements([
      {
        id: "EARS-FL-001",
      },
    ])

    expect(errors.some((error) => error.field === "pattern")).toBe(true)
    expect(errors.some((error) => error.field === "system")).toBe(true)
    expect(errors.some((error) => error.field === "response")).toBe(true)
  })

  it("reports invalid ID format", () => {
    const errors = validateEarsRequirements([
      {
        id: "invalid-id",
        pattern: "ubiquitous",
        system: "tx",
        response: "do work",
      },
    ])

    expect(errors.some((error) => error.field === "id" && error.code === "invalid_format")).toBe(true)
  })

  it("reports duplicate EARS IDs", () => {
    const errors = validateEarsRequirements([
      {
        id: "EARS-FL-001",
        pattern: "ubiquitous",
        system: "tx",
        response: "do work",
      },
      {
        id: "EARS-FL-001",
        pattern: "ubiquitous",
        system: "tx",
        response: "do more work",
      },
    ])

    expect(errors.some((error) => error.code === "duplicate_id")).toBe(true)
  })

  it("enforces pattern-specific fields", () => {
    const errors = validateEarsRequirements([
      {
        id: "EARS-FL-001",
        pattern: "event_driven",
        system: "tx",
        response: "do work",
      },
      {
        id: "EARS-FL-002",
        pattern: "state_driven",
        system: "tx",
        response: "do work",
      },
      {
        id: "EARS-FL-003",
        pattern: "unwanted",
        system: "tx",
        response: "do work",
      },
      {
        id: "EARS-FL-004",
        pattern: "optional",
        system: "tx",
        response: "do work",
      },
    ])

    expect(errors.some((error) => error.field === "trigger")).toBe(true)
    expect(errors.some((error) => error.field === "state")).toBe(true)
    expect(errors.some((error) => error.field === "condition")).toBe(true)
    expect(errors.some((error) => error.field === "feature")).toBe(true)
  })

  it("rejects invalid pattern and priority values", () => {
    const errors = validateEarsRequirements([
      {
        id: "EARS-FL-001",
        pattern: "made_up_pattern",
        system: "tx",
        response: "do work",
        priority: "critical",
      },
    ])

    expect(errors.some((error) => error.field === "pattern" && error.code === "invalid_value")).toBe(true)
    expect(errors.some((error) => error.field === "priority" && error.code === "invalid_value")).toBe(true)
  })
})
