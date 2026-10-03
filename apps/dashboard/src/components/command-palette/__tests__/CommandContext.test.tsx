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

  it("uses the latest action when command labels remain the same", () => {
    const first = vi.fn()
    const next = vi.fn()
    const view = (action: () => void) => <CommandProvider><Harness onCreate={action} /></CommandProvider>
    const {rerender} = render(view(first))
    fireEvent.keyDown(window,{key:"n",code:"KeyN",metaKey:true})
    expect(first).toHaveBeenCalledTimes(1)
    rerender(view(next))
    fireEvent.keyDown(window,{key:"n",code:"KeyN",metaKey:true})
    expect(next).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
  })

  it("shows asynchronous command failures without an unhandled rejection", async () => {
    render(<CommandProvider><Harness onCreate={async () => {throw new Error("Cannot save the task")}} /></CommandProvider>)
    fireEvent.keyDown(window,{key:"n",code:"KeyN",metaKey:true})
    expect(await screen.findByRole("alert")).toHaveTextContent("Create task: Cannot save the task")
    fireEvent.click(screen.getByRole("button",{name:"Dismiss command error"}))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
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
