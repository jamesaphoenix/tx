import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CycleCard } from "../CycleCard"
import type { Cycle } from "../../../api/client"

function makeCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: "cycle-test-1",
    name: "Sprint 5",
    startDate: "2026-03-16T00:00:00.000Z",
    endDate: "2026-03-23T00:00:00.000Z",
    status: "current",
    createdAt: "2026-03-16T00:00:00.000Z",
    updatedAt: "2026-03-16T00:00:00.000Z",
    taskCount: 10,
    completedCount: 4,
    inProgressCount: 3,
    ...overrides,
  }
}

describe("CycleCard", () => {
  // -------------------------------------------------------------------------
  // Content rendering
  // -------------------------------------------------------------------------

  it("renders cycle name", () => {
    render(<CycleCard cycle={makeCycle()} />)
    expect(screen.getByText("Sprint 5")).toBeInTheDocument()
  })

  it("renders date range", () => {
    render(<CycleCard cycle={makeCycle()} />)
    // en-GB format: "16 Mar - 23 Mar"
    expect(screen.getByText(/16 Mar.*23 Mar/)).toBeInTheDocument()
  })

  it("renders status badge", () => {
    render(<CycleCard cycle={makeCycle({ status: "current" })} />)
    expect(screen.getByText("Current")).toBeInTheDocument()
  })

  it("renders upcoming status badge", () => {
    render(<CycleCard cycle={makeCycle({ status: "upcoming" })} />)
    expect(screen.getByText("Upcoming")).toBeInTheDocument()
  })

  it("renders completed status badge", () => {
    render(<CycleCard cycle={makeCycle({ status: "completed" })} />)
    expect(screen.getByText("Completed")).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Stats calculations
  // -------------------------------------------------------------------------

  it("displays correct scope count", () => {
    render(<CycleCard cycle={makeCycle({ taskCount: 8 })} />)
    expect(screen.getByText("8")).toBeInTheDocument()
    expect(screen.getByText("scope")).toBeInTheDocument()
  })

  it("displays started = inProgressCount + completedCount", () => {
    render(<CycleCard cycle={makeCycle({ inProgressCount: 3, completedCount: 2 })} />)
    // started = 3 + 2 = 5
    expect(screen.getByText("5")).toBeInTheDocument()
    expect(screen.getByText("started")).toBeInTheDocument()
  })

  it("displays completed count", () => {
    render(<CycleCard cycle={makeCycle({ completedCount: 4 })} />)
    expect(screen.getByText("4")).toBeInTheDocument()
    expect(screen.getByText("completed")).toBeInTheDocument()
  })

  it("displays success rate as percentage", () => {
    // 4 out of 10 = 40%
    render(<CycleCard cycle={makeCycle({ taskCount: 10, completedCount: 4 })} />)
    expect(screen.getByText("40%")).toBeInTheDocument()
  })

  it("displays 0% when taskCount is 0", () => {
    render(<CycleCard cycle={makeCycle({ taskCount: 0, completedCount: 0, inProgressCount: 0 })} />)
    expect(screen.getByText("0%")).toBeInTheDocument()
  })

  it("displays 100% when all tasks completed", () => {
    render(<CycleCard cycle={makeCycle({ taskCount: 5, completedCount: 5, inProgressCount: 0 })} />)
    expect(screen.getByText("100%")).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Progress bar
  // -------------------------------------------------------------------------

  it("renders progress bar with correct width", () => {
    const { container } = render(
      <CycleCard cycle={makeCycle({ taskCount: 10, completedCount: 4 })} />,
    )
    const bar = container.querySelector(".bg-blue-500")
    expect(bar).toHaveStyle({ width: "40%" })
  })

  it("renders progress bar at 0% when no tasks", () => {
    const { container } = render(
      <CycleCard cycle={makeCycle({ taskCount: 0, completedCount: 0 })} />,
    )
    const bar = container.querySelector(".bg-blue-500")
    expect(bar).toHaveStyle({ width: "0%" })
  })

  // -------------------------------------------------------------------------
  // Click handling
  // -------------------------------------------------------------------------

  it("calls onSelect when clicked", async () => {
    const onSelect = vi.fn()
    render(<CycleCard cycle={makeCycle()} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole("button"))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("renders as a button element for keyboard accessibility", () => {
    render(<CycleCard cycle={makeCycle()} />)
    expect(screen.getByRole("button")).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Invalid dates
  // -------------------------------------------------------------------------

  it("shows 'Date unavailable' for invalid dates", () => {
    render(
      <CycleCard
        cycle={makeCycle({ startDate: "invalid", endDate: "also-invalid" })}
      />,
    )
    expect(screen.getByText("Date unavailable")).toBeInTheDocument()
  })

  // -------------------------------------------------------------------------
  // Theme support
  // -------------------------------------------------------------------------

  it("applies dark theme classes by default", () => {
    const { container } = render(<CycleCard cycle={makeCycle()} />)
    const stats = container.querySelector(".text-gray-500")
    expect(stats).toBeInTheDocument()
  })

  it("applies light theme classes when themeMode=light", () => {
    const { container } = render(<CycleCard cycle={makeCycle()} themeMode="light" />)
    const stats = container.querySelector(".text-zinc-500")
    expect(stats).toBeInTheDocument()
  })
})
