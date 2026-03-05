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
})
