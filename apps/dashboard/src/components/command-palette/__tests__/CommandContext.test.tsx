import { useMemo } from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { CommandProvider, useCommandContext, useCommands, type Command } from "../CommandContext"

function Harness({ onCreate }: { onCreate: () => void }) {
  const { isOpen } = useCommandContext()
  const commands = useMemo<Command[]>(
    () => [
      {
        id: "tasks:new",
        label: "Create task",
        shortcut: "⌘N",
        action: onCreate,
      },
    ],
    [onCreate],
  )

  useCommands(commands)

  return <div data-testid="palette-state">{isOpen ? "open" : "closed"}</div>
}

describe("CommandContext", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("registers commands and handles global shortcuts", async () => {
    const onCreate = vi.fn()

    render(
      <CommandProvider>
        <Harness onCreate={onCreate} />
      </CommandProvider>,
    )

    expect(screen.getByTestId("palette-state")).toHaveTextContent("closed")

    fireEvent.keyDown(window, { key: "k", code: "KeyK", metaKey: true })

    await waitFor(() => {
      expect(screen.getByTestId("palette-state")).toHaveTextContent("open")
    })

    fireEvent.keyDown(window, { key: "n", code: "KeyN", metaKey: true })

    expect(onCreate).toHaveBeenCalledTimes(1)
  })
})
