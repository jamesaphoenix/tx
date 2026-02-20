import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { TaskComposerModal } from "../TaskComposerModal"
import { CommandProvider } from "../../command-palette/CommandContext"

function renderComposer(props: ComponentProps<typeof TaskComposerModal>) {
  return render(
    <CommandProvider>
      <TaskComposerModal {...props} />
    </CommandProvider>
  )
}

describe("TaskComposerModal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.documentElement.dataset.theme = "light"
  })

  it("closes on Escape", () => {
    const onClose = vi.fn()

    renderComposer({
      open: true,
      heading: "New task",
      submitLabel: "Create task",
      availableLabels: [],
      onClose,
      onSubmit: () => {},
    })

    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("submits title, description, stage, and label IDs", async () => {
    const onSubmit = vi.fn(async () => {})

    renderComposer({
      open: true,
      heading: "New task",
      submitLabel: "Create task",
      availableLabels: [
        { id: 1, name: "Bug", color: "#ef4444", createdAt: "", updatedAt: "" },
        { id: 2, name: "Perf", color: "#f59e0b", createdAt: "", updatedAt: "" },
      ],
      onClose: () => {},
      onSubmit,
    })

    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Make cmd+k fast" },
    })
    fireEvent.change(screen.getByPlaceholderText("Describe the task (optional)..."), {
      target: { value: "Improve palette indexing strategy." },
    })

    const comboboxes = screen.getAllByRole("combobox")
    fireEvent.keyDown(comboboxes[0]!, { key: "ArrowDown" })
    fireEvent.click(await screen.findByText("In Progress"))

    fireEvent.keyDown(comboboxes[1]!, { key: "ArrowDown" })
    fireEvent.click(await screen.findByText("Bug"))

    fireEvent.click(screen.getByRole("button", { name: "Create task" }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    expect(onSubmit).toHaveBeenCalledWith({
      title: "Make cmd+k fast",
      description: "Improve palette indexing strategy.",
      stage: "in_progress",
      parentId: null,
      labelIds: [1],
      createMore: false,
    })
  })

  it("supports create-more mode without closing", async () => {
    const onSubmit = vi.fn(async () => {})
    const onClose = vi.fn()

    renderComposer({
      open: true,
      heading: "New task",
      submitLabel: "Create task",
      availableLabels: [],
      onClose,
      onSubmit,
    })

    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "First task" },
    })
    fireEvent.click(screen.getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: "Create task" }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    expect(onSubmit).toHaveBeenCalledWith({
      title: "First task",
      description: undefined,
      stage: "backlog",
      parentId: null,
      labelIds: [],
      createMore: true,
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText("Task title")).toHaveValue("")
  })

  it("uses CMD+A to select title/description text while modal is open", () => {
    renderComposer({
      open: true,
      heading: "New task",
      submitLabel: "Create task",
      availableLabels: [],
      onClose: () => {},
      onSubmit: () => {},
    })

    const title = screen.getByPlaceholderText("Task title") as HTMLInputElement
    const description = screen.getByPlaceholderText("Describe the task (optional)...") as HTMLTextAreaElement

    fireEvent.change(title, { target: { value: "Title selection" } })
    fireEvent.change(description, { target: { value: "Description selection" } })

    title.focus()
    fireEvent.keyDown(title, { key: "a", metaKey: true })
    expect(title.selectionStart).toBe(0)
    expect(title.selectionEnd).toBe(title.value.length)

    description.focus()
    fireEvent.keyDown(description, { key: "a", metaKey: true })
    expect(description.selectionStart).toBe(0)
    expect(description.selectionEnd).toBe(description.value.length)
  })

  it("uses the current html theme mode for modal styling", () => {
    document.documentElement.dataset.theme = "dark"

    const { container } = renderComposer({
      open: true,
      heading: "New task",
      submitLabel: "Create task",
      availableLabels: [],
      onClose: () => {},
      onSubmit: () => {},
    })

    const modal = container.querySelector("[data-theme='dark']")
    expect(modal).toBeTruthy()
  })
})
