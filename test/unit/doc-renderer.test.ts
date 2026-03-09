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

  it("renders requirement doc with expected sections", () => {
    const parsed: Record<string, unknown> = {
      kind: "requirement",
      title: "Auth Flows",
      status: "changing",
      actors: "End users, Admin users",
      use_cases: "Login, logout, password reset",
      functional_requirements: "All auth endpoints must return 401 on invalid token",
      traceability: "PRD-001, DD-002",
      invariants: [
        { id: "INV-REQ-001", rule: "Auth tokens expire after 24h", enforcement: "integration_test" },
      ],
    }

    const markdown = renderDocToMarkdown(parsed, "requirement")
    expect(markdown).toContain("# Auth Flows")
    expect(markdown).toContain("**Kind**: requirement")
    expect(markdown).toContain("## Actors")
    expect(markdown).toContain("## Use Cases")
    expect(markdown).toContain("## Functional Requirements")
    expect(markdown).toContain("All auth endpoints must return 401 on invalid token")
    expect(markdown).toContain("## Traceability")
    expect(markdown).toContain("## Invariants")
    expect(markdown).toContain("INV-REQ-001")
    expect(markdown).not.toContain("undefined")
  })

  it("renders system_design doc with expected sections", () => {
    const parsed: Record<string, unknown> = {
      kind: "system_design",
      title: "Error Handling",
      status: "changing",
      scope: "All services",
      constraints: ["Must be Bash 3.2 compatible", "No raw try/catch"],
      design: "Use Effect-TS tagged errors throughout",
      applies_to: "DD-002, DD-005",
      decision_log: "2024-01-01: Adopted Effect-TS",
      invariants: [
        { id: "INV-SD-001", rule: "All errors use Data.TaggedError", enforcement: "linter" },
      ],
    }

    const markdown = renderDocToMarkdown(parsed, "system_design")
    expect(markdown).toContain("# Error Handling")
    expect(markdown).toContain("**Kind**: system_design")
    expect(markdown).toContain("## Scope")
    expect(markdown).toContain("## Constraints")
    expect(markdown).toContain("Must be Bash 3.2 compatible")
    expect(markdown).toContain("## Design")
    expect(markdown).toContain("## Applies To")
    expect(markdown).toContain("## Invariants")
    expect(markdown).toContain("INV-SD-001")
    expect(markdown).toContain("## Decision Log")
    expect(markdown).not.toContain("undefined")
  })
})
