import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { CycleIssue } from "../../../api/client"
import { IssuesList, formatIssueForClipboard } from "../IssuesList"

const issuesFixture: CycleIssue[] = [
  {
    id: "issue-1",
    title: "Null pointer access",
    description: "Guard value before access",
    severity: "high",
    issueType: "runtime",
    file: "src/core/service.ts",
    line: 42,
    cycle: 1,
    round: 1,
  },
  {
    id: "issue-2",
    title: "Unused import",
    description: "Remove dead import",
    severity: "low",
    issueType: "lint",
    file: "src/ui/panel.tsx",
    line: 12,
    cycle: 1,
    round: 1,
  },
]

describe("IssuesList", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("formats issues for clipboard output", () => {
    const text = formatIssueForClipboard(issuesFixture[0]!)

    expect(text).toContain("[HIGH] Null pointer access")
    expect(text).toContain("File: src/core/service.ts:42")
  })

  it("shows filter controls and propagates filter selection", () => {
    const onSelectionChange = vi.fn()
    const onFilterChange = vi.fn()

    render(
      <IssuesList
        issues={issuesFixture}
        selectedIds={new Set<string>()}
        onSelectionChange={onSelectionChange}
        filter="all"
        onFilterChange={onFilterChange}
      />,
    )

    expect(screen.getByText("Issues (2)")).toBeInTheDocument()
    expect(onSelectionChange).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "High (1)" }))
    expect(onFilterChange).toHaveBeenCalledWith("high")
  })
})
