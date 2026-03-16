import { useEffect } from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { CommandPalette } from "../CommandPalette"
import { CommandProvider, useCommandContext, type Command } from "../CommandContext"

function PaletteHarness({ commands }: { commands: Command[] }) {
  const { setAppCommands, setOpen } = useCommandContext()

  useEffect(() => {
    setAppCommands(commands)
    setOpen(true)
  }, [commands, setAppCommands, setOpen])

  return <CommandPalette />
}

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("executes the active command with keyboard navigation", async () => {
    const firstAction = vi.fn()
    const secondAction = vi.fn()

    render(
      <CommandProvider>
        <PaletteHarness
          commands={[
            { id: "first", label: "Open settings", group: "Actions", action: firstAction },
            { id: "second", label: "Create issue", group: "Actions", action: secondAction },
          ]}
        />
      </CommandProvider>,
    )

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Type a command...")).toBeInTheDocument()
    })

    fireEvent.keyDown(window, { key: "ArrowDown" })
    fireEvent.keyDown(window, { key: "Enter" })

    expect(secondAction).toHaveBeenCalledTimes(1)
    expect(firstAction).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Type a command...")).not.toBeInTheDocument()
    })
  })

  it("drills into a command with children on Enter", async () => {
    const leafAction = vi.fn()

    render(
      <CommandProvider>
        <PaletteHarness
          commands={[
            {
              id: "parent",
              label: "Set status",
              group: "Actions",
              action: () => {},
              children: [
                { id: "child-active", label: "Active", group: "Statuses", action: leafAction },
                { id: "child-done", label: "Done", group: "Statuses", action: () => {} },
              ],
            },
            { id: "other", label: "Other command", group: "Actions", action: () => {} },
          ]}
        />
      </CommandProvider>,
    )

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Type a command...")).toBeInTheDocument()
    })

    // First item should be "Set status" — press Enter to drill in
    fireEvent.keyDown(window, { key: "Enter" })

    // Should now see children
    await waitFor(() => {
      expect(screen.getByText("Active")).toBeInTheDocument()
      expect(screen.getByText("Done")).toBeInTheDocument()
      // Should NOT see the other top-level command
      expect(screen.queryByText("Other command")).not.toBeInTheDocument()
    })

    // Breadcrumb should show
    expect(screen.getByTestId("breadcrumb-root")).toHaveTextContent("All")

    // Select "Active" (first item) and press Enter
    fireEvent.keyDown(window, { key: "Enter" })

    expect(leafAction).toHaveBeenCalledTimes(1)

    // Palette should close after leaf execution
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/command/i)).not.toBeInTheDocument()
    })
  })

  it("drills into a command with ArrowRight", async () => {
    render(
      <CommandProvider>
        <PaletteHarness
          commands={[
            {
              id: "parent",
              label: "Set status",
              group: "Actions",
              action: () => {},
              children: [
                { id: "child-a", label: "Active", group: "Statuses", action: () => {} },
              ],
            },
          ]}
        />
      </CommandProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("Set status")).toBeInTheDocument()
    })

    fireEvent.keyDown(window, { key: "ArrowRight" })

    await waitFor(() => {
      expect(screen.getByText("Active")).toBeInTheDocument()
      expect(screen.getByTestId("breadcrumb-root")).toBeInTheDocument()
    })
  })

  it("ESC goes back one level before closing", async () => {
    render(
      <CommandProvider>
        <PaletteHarness
          commands={[
            {
              id: "parent",
              label: "Set status",
              group: "Actions",
              action: () => {},
              children: [
                { id: "child-a", label: "Active", group: "Statuses", action: () => {} },
              ],
            },
          ]}
        />
      </CommandProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("Set status")).toBeInTheDocument()
    })

    // Drill in
    fireEvent.keyDown(window, { key: "Enter" })
    await waitFor(() => {
      expect(screen.getByText("Active")).toBeInTheDocument()
    })

    // ESC should go back to top level (not close)
    fireEvent.keyDown(window, { key: "Escape" })
    await waitFor(() => {
      expect(screen.getByText("Set status")).toBeInTheDocument()
      expect(screen.queryByTestId("breadcrumb-root")).not.toBeInTheDocument()
    })

    // Palette should still be open
    expect(screen.getByPlaceholderText("Type a command...")).toBeInTheDocument()

    // ESC again closes the palette
    fireEvent.keyDown(window, { key: "Escape" })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText("Type a command...")).not.toBeInTheDocument()
    })
  })

  it("Backspace drills up when search is empty", async () => {
    render(
      <CommandProvider>
        <PaletteHarness
          commands={[
            {
              id: "parent",
              label: "Set status",
              group: "Actions",
              action: () => {},
              children: [
                { id: "child-a", label: "Active", group: "Statuses", action: () => {} },
              ],
            },
          ]}
        />
      </CommandProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("Set status")).toBeInTheDocument()
    })

    // Drill in
    fireEvent.keyDown(window, { key: "Enter" })
    await waitFor(() => {
      expect(screen.getByText("Active")).toBeInTheDocument()
    })

    // Backspace with empty query should go back
    fireEvent.keyDown(window, { key: "Backspace" })
    await waitFor(() => {
      expect(screen.getByText("Set status")).toBeInTheDocument()
    })
  })

  it("shows chevron indicator for commands with children", async () => {
    render(
      <CommandProvider>
        <PaletteHarness
          commands={[
            {
              id: "with-children",
              label: "Has children",
              group: "Actions",
              action: () => {},
              children: [{ id: "child", label: "Child", group: "Sub", action: () => {} }],
            },
            { id: "no-children", label: "Leaf command", group: "Actions", action: () => {} },
          ]}
        />
      </CommandProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("Has children")).toBeInTheDocument()
      expect(screen.getByText("Leaf command")).toBeInTheDocument()
    })

    // Command with children should have chevron indicator
    expect(screen.getByTestId("children-indicator-with-children")).toBeInTheDocument()
  })

  it("breadcrumb click navigates to specific level", async () => {
    render(
      <CommandProvider>
        <PaletteHarness
          commands={[
            {
              id: "level1",
              label: "Level 1",
              group: "Actions",
              action: () => {},
              children: [
                {
                  id: "level2",
                  label: "Level 2",
                  group: "Sub",
                  action: () => {},
                  children: [
                    { id: "level3", label: "Level 3 leaf", group: "Deep", action: () => {} },
                  ],
                },
              ],
            },
          ]}
        />
      </CommandProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("Level 1")).toBeInTheDocument()
    })

    // Drill to level 1
    fireEvent.keyDown(window, { key: "Enter" })
    await waitFor(() => {
      expect(screen.getByText("Level 2")).toBeInTheDocument()
    })

    // Drill to level 2
    fireEvent.keyDown(window, { key: "Enter" })
    await waitFor(() => {
      expect(screen.getByText("Level 3 leaf")).toBeInTheDocument()
    })

    // Click breadcrumb "All" to jump back to root
    fireEvent.click(screen.getByTestId("breadcrumb-root"))
    await waitFor(() => {
      expect(screen.getByText("Level 1")).toBeInTheDocument()
      expect(screen.queryByTestId("breadcrumb-root")).not.toBeInTheDocument()
    })
  })

  it("search filters within current hierarchy level", async () => {
    render(
      <CommandProvider>
        <PaletteHarness
          commands={[
            {
              id: "parent",
              label: "Status",
              group: "Actions",
              action: () => {},
              children: [
                { id: "active", label: "Active", group: "Statuses", action: () => {} },
                { id: "done", label: "Done", group: "Statuses", action: () => {} },
                { id: "blocked", label: "Blocked", group: "Statuses", action: () => {} },
              ],
            },
          ]}
        />
      </CommandProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("Status")).toBeInTheDocument()
    })

    // Drill in
    fireEvent.keyDown(window, { key: "Enter" })
    await waitFor(() => {
      expect(screen.getByText("Active")).toBeInTheDocument()
      expect(screen.getByText("Done")).toBeInTheDocument()
      expect(screen.getByText("Blocked")).toBeInTheDocument()
    })

    // Search should filter within the current level
    const input = screen.getByPlaceholderText(/Filter Status/i)
    fireEvent.change(input, { target: { value: "act" } })

    await waitFor(() => {
      expect(screen.getByText("Active")).toBeInTheDocument()
      expect(screen.queryByText("Done")).not.toBeInTheDocument()
      expect(screen.queryByText("Blocked")).not.toBeInTheDocument()
    })
  })

  it("number keys execute items when inside a hierarchy", async () => {
    const actions = [vi.fn(), vi.fn(), vi.fn()]

    render(
      <CommandProvider>
        <PaletteHarness
          commands={[
            {
              id: "parent",
              label: "Status",
              group: "Actions",
              action: () => {},
              children: [
                { id: "first", label: "First", group: "Items", action: actions[0] },
                { id: "second", label: "Second", group: "Items", action: actions[1] },
                { id: "third", label: "Third", group: "Items", action: actions[2] },
              ],
            },
          ]}
        />
      </CommandProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("Status")).toBeInTheDocument()
    })

    // Drill in
    fireEvent.keyDown(window, { key: "Enter" })
    await waitFor(() => {
      expect(screen.getByText("First")).toBeInTheDocument()
    })

    // Number badges should be visible
    expect(screen.getByTestId("number-badge-1")).toBeInTheDocument()
    expect(screen.getByTestId("number-badge-2")).toBeInTheDocument()
    expect(screen.getByTestId("number-badge-3")).toBeInTheDocument()

    // Press "2" to execute the second item
    fireEvent.keyDown(window, { key: "2" })

    expect(actions[1]).toHaveBeenCalledTimes(1)
    expect(actions[0]).not.toHaveBeenCalled()
    expect(actions[2]).not.toHaveBeenCalled()

    // Palette should close
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/command/i)).not.toBeInTheDocument()
    })
  })

  it("number keys do NOT execute when at root level", async () => {
    const action = vi.fn()

    render(
      <CommandProvider>
        <PaletteHarness
          commands={[
            { id: "first", label: "First command", group: "Actions", action },
          ]}
        />
      </CommandProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText("First command")).toBeInTheDocument()
    })

    // Press "1" at root level — should NOT execute (number goes to search input)
    fireEvent.keyDown(window, { key: "1" })

    expect(action).not.toHaveBeenCalled()
    // Palette should still be open
    expect(screen.getByPlaceholderText("Type a command...")).toBeInTheDocument()
  })
})
