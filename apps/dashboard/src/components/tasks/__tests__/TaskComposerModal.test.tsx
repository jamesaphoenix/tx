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

  it("labels the dialog and keeps pending submissions open", async () => {
    let finish!: () => void
    const onClose = vi.fn()
    renderComposer({open:true,heading:"New task",submitLabel:"Create task",availableLabels:[],onClose,
      onSubmit:() => new Promise<void>(resolve => {finish = resolve})})
    expect(screen.getByRole("dialog",{name:"New task"})).toHaveAttribute("aria-modal","true")
    const title = screen.getByRole("textbox",{name:"Task title"})
    expect(title).toHaveFocus()
    expect(screen.getByRole("combobox",{name:"Task status"})).toBeInTheDocument()
    expect(screen.getByRole("combobox",{name:"Assignment type"})).toBeInTheDocument()
    expect(screen.getByRole("combobox",{name:"Task labels"})).toBeInTheDocument()
    fireEvent.change(title,{target:{value:"Pending task"}})
    fireEvent.click(screen.getByRole("button",{name:"Create task"}))
    fireEvent.keyDown(title,{key:"Escape"})
    fireEvent.click(screen.getByRole("button",{name:"Close"}))
    expect(onClose).not.toHaveBeenCalled()
    finish()
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
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
    fireEvent.click(await screen.findByText("Active"))

    fireEvent.keyDown(comboboxes[2]!, { key: "ArrowDown" })
    fireEvent.click(await screen.findByText("Bug"))

    fireEvent.click(screen.getByRole("button", { name: "Create task" }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    expect(onSubmit).toHaveBeenCalledWith({
      title: "Make cmd+k fast",
      description: "Improve palette indexing strategy.",
      stage: "active",
      parentId: null,
      assigneeType: "human",
      assigneeId: null,
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
      assigneeType: "human",
      assigneeId: null,
      labelIds: [],
      createMore: true,
    })
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Task title")).toHaveValue("")
    })
  })

  it("uses provided default assignment type", async () => {
    const onSubmit = vi.fn(async () => {})

    renderComposer({
      open: true,
      heading: "New task",
      submitLabel: "Create task",
      defaultAssigneeType: "agent",
      availableLabels: [],
      onClose: () => {},
      onSubmit,
    })

    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Assigned to agent by default" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create task" }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1)
    })

    expect(onSubmit).toHaveBeenCalledWith({
      title: "Assigned to agent by default",
      description: undefined,
      stage: "backlog",
      parentId: null,
      assigneeType: "agent",
      assigneeId: null,
      labelIds: [],
      createMore: false,
    })
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
