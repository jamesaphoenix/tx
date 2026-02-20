import { describe, it, expect } from "vitest"
import { renderDocToMarkdown } from "@jamesaphoenix/tx-core"

describe("Doc renderer structured section normalization", () => {
  it("renders failure_modes scenario entries and string edge_cases without undefined", () => {
    const parsed: Record<string, unknown> = {
      kind: "design",
      title: "Cycle-Based Issue Discovery",
      status: "changing",
      version: 1,
      failure_modes: [
        {
          scenario: "LLM returns unparseable JSON",
          mitigation: "Skip finding, log warning, continue",
        },
      ],
      edge_cases: [
        "First round in first cycle has no existing issues to dedup against",
      ],
      work_breakdown: [
        "Phase 1: Create PRD-023 and DD-023 via tx doc CLI",
        { task_id: "tx-abc123", description: "Phase 2: Build cycle scan script" },
      ],
    }

    const markdown = renderDocToMarkdown(parsed, "design")

    expect(markdown).toContain(
      "| - | LLM returns unparseable JSON | Skip finding, log warning, continue |"
    )
    expect(markdown).toContain(
      "| - | First round in first cycle has no existing issues to dedup against |"
    )
    expect(markdown).toContain("- Phase 1: Create PRD-023 and DD-023 via tx doc CLI")
    expect(markdown).toContain("- `tx-abc123` — Phase 2: Build cycle scan script")
    expect(markdown).not.toContain("undefined")
  })

  it("keeps object-form failure_modes rendering intact", () => {
    const parsed: Record<string, unknown> = {
      kind: "design",
      title: "Failure Modes Shape",
      failure_modes: [
        { id: "FM-001", description: "Service timeout", mitigation: "Retry once" },
      ],
    }

    const markdown = renderDocToMarkdown(parsed, "design")
    expect(markdown).toContain("| FM-001 | Service timeout | Retry once |")
  })
})
