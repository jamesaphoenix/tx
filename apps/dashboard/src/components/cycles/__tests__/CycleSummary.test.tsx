import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import type { CycleRun } from "../../../api/client"
import { CycleSummary } from "../CycleSummary"

const cycleFixture: CycleRun = {
  id: "cycle-2",
  cycle: 2,
  name: "Cycle 2",
  description: "Cycle description",
  startedAt: "2026-02-15T10:00:00.000Z",
  endedAt: null,
  status: "completed",
  rounds: 4,
  totalNewIssues: 9,
  existingIssues: 3,
  finalLoss: 1.25,
  converged: true,
}

describe("CycleSummary", () => {
  it("renders key cycle stats", () => {
    render(<CycleSummary cycle={cycleFixture} />)

    expect(screen.getByText("Cycle 2")).toBeInTheDocument()
    expect(screen.getByText("4 rounds")).toBeInTheDocument()
    expect(screen.getByText("9")).toBeInTheDocument()
    expect(screen.getByText("1.25")).toBeInTheDocument()
    expect(screen.getByText("Yes")).toBeInTheDocument()
  })
})
