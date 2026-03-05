import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { RoundMetric } from "../../../api/client"
import { LossChart } from "../LossChart"

const roundMetricsFixture: RoundMetric[] = [
  {
    cycle: 1,
    round: 1,
    loss: 8,
    newIssues: 4,
    existingIssues: 4,
    duplicates: 0,
    high: 1,
    medium: 2,
    low: 1,
  },
]

describe("LossChart", () => {
  it("shows empty state when no round metrics are available", () => {
    render(<LossChart roundMetrics={[]} />)

    expect(screen.getByText("No round metrics available")).toBeInTheDocument()
  })

  it("renders chart header and invokes show-all callback", () => {
    const onShowAllCycles = vi.fn()

    render(
      <LossChart
        roundMetrics={roundMetricsFixture}
        cycleName="Cycle One"
        onShowAllCycles={onShowAllCycles}
      />,
    )

    expect(screen.getByText("Loss Convergence — Cycle One")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Show all cycles" }))
    expect(onShowAllCycles).toHaveBeenCalledTimes(1)
  })
})
