import { describe, expect, it } from "vitest"
import { composeEarsSentence, renderDocToMarkdown } from "@jamesaphoenix/tx-core"

describe("EARS sentence composition", () => {
  it("composes each EARS pattern into deterministic prose", () => {
    expect(
      composeEarsSentence({
        pattern: "ubiquitous",
        system: "tx",
        response: "store learnings",
      })
    ).toBe("The tx shall store learnings.")

    expect(
      composeEarsSentence({
        pattern: "event_driven",
        trigger: "a user runs tx memory recall",
        system: "recall service",
        response: "return results",
      })
    ).toBe("When a user runs tx memory recall, the recall service shall return results.")

    expect(
      composeEarsSentence({
        pattern: "state_driven",
        state: "tasks are blocked",
        system: "ready queue",
        response: "exclude blocked tasks",
      })
    ).toBe("While tasks are blocked, the ready queue shall exclude blocked tasks.")

    expect(
      composeEarsSentence({
        pattern: "unwanted",
        condition: "YAML is invalid",
        system: "doc service",
        response: "throw InvalidDocYamlError",
      })
    ).toBe("If YAML is invalid, then the doc service shall throw InvalidDocYamlError.")

    expect(
      composeEarsSentence({
        pattern: "optional",
        feature: "dashboard mode",
        system: "api",
        response: "show assignment controls",
      })
    ).toBe("Where dashboard mode, the api shall show assignment controls.")

    expect(
      composeEarsSentence({
        pattern: "complex",
        trigger: "a task is completed",
        state: "dependencies exist",
        condition: "ready state can change",
        feature: "priority queues enabled",
        system: "ready service",
        response: "recompute candidate tasks",
      })
    ).toBe(
      "When a task is completed, while dependencies exist, if ready state can change, where priority queues enabled, the ready service shall recompute candidate tasks."
    )
  })
})

describe("EARS rendering in PRDs", () => {
  it("renders structured EARS section with summary table and details", () => {
    const markdown = renderDocToMarkdown(
      {
        kind: "prd",
        title: "EARS test",
        ears_requirements: [
          {
            id: "EARS-FL-001",
            pattern: "ubiquitous",
            system: "tx memory learn command",
            response: "persist a learning entry",
            priority: "must",
            rationale: "Core primitive",
            test_hint: "integration test",
          },
          {
            id: "EARS-FL-002",
            pattern: "event_driven",
            trigger: "a user runs tx memory recall",
            system: "recall service",
            response: "return matching learnings",
          },
        ],
      },
      "prd"
    )

    expect(markdown).toContain("## Structured Requirements (EARS)")
    expect(markdown).toContain("| ID | Pattern | Requirement | Priority |")
    expect(markdown).toContain(
      "| EARS-FL-001 | ubiquitous | The tx memory learn command shall persist a learning entry. | must |"
    )
    expect(markdown).toContain(
      "| EARS-FL-002 | event_driven | When a user runs tx memory recall, the recall service shall return matching learnings. | - |"
    )
    expect(markdown).toContain("### EARS-FL-001")
    expect(markdown).toContain("**Rationale**: Core primitive")
    expect(markdown).toContain("**Test hint**: integration test")
  })

  it("omits EARS section when ears_requirements is empty or missing", () => {
    const withoutEars = renderDocToMarkdown(
      {
        kind: "prd",
        title: "No EARS",
        requirements: ["Requirement 1"],
      },
      "prd"
    )
    expect(withoutEars).not.toContain("Structured Requirements (EARS)")

    const emptyEars = renderDocToMarkdown(
      {
        kind: "prd",
        title: "Empty EARS",
        ears_requirements: [],
      },
      "prd"
    )
    expect(emptyEars).not.toContain("Structured Requirements (EARS)")
  })

  it("escapes pipe characters in EARS content", () => {
    const markdown = renderDocToMarkdown(
      {
        kind: "prd",
        title: "Pipe escaping",
        ears_requirements: [
          {
            id: "EARS-FL-001",
            pattern: "ubiquitous",
            system: "tx | learn",
            response: "store A | B values",
          },
        ],
      },
      "prd"
    )

    expect(markdown).toContain(
      "| EARS-FL-001 | ubiquitous | The tx \\| learn shall store A \\| B values. | - |"
    )
  })

  it("renders both legacy requirements and EARS requirements", () => {
    const markdown = renderDocToMarkdown(
      {
        kind: "prd",
        title: "Mixed requirements",
        requirements: ["Legacy requirement"],
        ears_requirements: [
          {
            id: "EARS-FL-001",
            pattern: "ubiquitous",
            system: "tx",
            response: "support structured requirements",
          },
        ],
      },
      "prd"
    )

    expect(markdown).toContain("## Requirements")
    expect(markdown).toContain("- Legacy requirement")
    expect(markdown).toContain("## Structured Requirements (EARS)")
  })
})
