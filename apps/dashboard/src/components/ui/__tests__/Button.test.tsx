import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Button, buttonVariants } from "../Button"

describe("Button", () => {
  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  it("renders children text", () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument()
  })

  it("renders as a <button> element", () => {
    render(<Button>Test</Button>)
    const el = screen.getByRole("button")
    expect(el.tagName).toBe("BUTTON")
  })

  // -------------------------------------------------------------------------
  // Sizes — verify each size produces the expected height class
  // -------------------------------------------------------------------------

  it.each([
    ["xs", "h-6"],
    ["sm", "h-7"],
    ["md", "h-8"],
    ["lg", "h-9"],
    ["icon-xs", "h-6"],
    ["icon-sm", "h-7"],
    ["icon-md", "h-8"],
    ["icon-lg", "h-9"],
  ] as const)("size=%s includes %s class", (size, expectedClass) => {
    render(<Button size={size}>S</Button>)
    expect(screen.getByRole("button")).toHaveClass(expectedClass)
  })

  it("icon sizes include width classes", () => {
    render(<Button size="icon-sm">X</Button>)
    const btn = screen.getByRole("button")
    expect(btn).toHaveClass("w-7")
  })

  // -------------------------------------------------------------------------
  // Variants — verify each variant applies the correct base style
  // -------------------------------------------------------------------------

  it.each([
    ["primary", "bg-blue-600"],
    ["secondary", "border"],
    ["ghost", "hover:bg-gray-800"],
    ["danger", "text-red-300"],
    ["success", "text-emerald-300"],
  ] as const)("variant=%s includes %s class", (variant, expectedClass) => {
    render(<Button variant={variant}>V</Button>)
    expect(screen.getByRole("button")).toHaveClass(expectedClass)
  })

  it("primary variant includes font-medium", () => {
    render(<Button variant="primary">Primary</Button>)
    expect(screen.getByRole("button")).toHaveClass("font-medium")
  })

  // -------------------------------------------------------------------------
  // Defaults
  // -------------------------------------------------------------------------

  it("defaults to size=sm and variant=secondary", () => {
    render(<Button>Default</Button>)
    const btn = screen.getByRole("button")
    expect(btn).toHaveClass("h-7") // sm
    expect(btn).toHaveClass("border") // secondary
  })

  // -------------------------------------------------------------------------
  // Disabled state
  // -------------------------------------------------------------------------

  it("applies disabled styling and prevents clicks", async () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Disabled</Button>)
    const btn = screen.getByRole("button")
    expect(btn).toBeDisabled()
    expect(btn).toHaveClass("disabled:opacity-50")
    await userEvent.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // Click handling
  // -------------------------------------------------------------------------

  it("calls onClick when clicked", async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Click</Button>)
    await userEvent.click(screen.getByRole("button"))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  // -------------------------------------------------------------------------
  // className merge — additional classes should combine, not replace
  // -------------------------------------------------------------------------

  it("merges additional className with built-in classes", () => {
    render(<Button className="my-custom-class">Merge</Button>)
    const btn = screen.getByRole("button")
    expect(btn).toHaveClass("my-custom-class")
    expect(btn).toHaveClass("h-7") // still has default sm size
  })

  // -------------------------------------------------------------------------
  // Ref forwarding
  // -------------------------------------------------------------------------

  it("forwards ref to the button element", () => {
    const ref = vi.fn()
    render(<Button ref={ref}>Ref</Button>)
    expect(ref).toHaveBeenCalledWith(expect.any(HTMLButtonElement))
  })

  // -------------------------------------------------------------------------
  // HTML attributes pass-through
  // -------------------------------------------------------------------------

  it("passes through type attribute", () => {
    render(<Button type="submit">Submit</Button>)
    expect(screen.getByRole("button")).toHaveAttribute("type", "submit")
  })

  it("passes through aria-label", () => {
    render(<Button aria-label="Close dialog">X</Button>)
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeInTheDocument()
  })

  it("passes through aria-pressed", () => {
    render(<Button aria-pressed="true">Active</Button>)
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true")
  })

  // -------------------------------------------------------------------------
  // buttonVariants() standalone function
  // -------------------------------------------------------------------------

  it("buttonVariants returns class string for given size+variant", () => {
    const classes = buttonVariants("md", "primary")
    expect(classes).toContain("h-8")
    expect(classes).toContain("bg-blue-600")
    expect(classes).toContain("inline-flex")
  })

  it("buttonVariants defaults to sm+secondary", () => {
    const classes = buttonVariants()
    expect(classes).toContain("h-7")
    expect(classes).toContain("border")
  })

  // -------------------------------------------------------------------------
  // Whitespace nowrap (prevents label wrapping in tight layouts)
  // -------------------------------------------------------------------------

  it("includes whitespace-nowrap to prevent text wrapping", () => {
    render(<Button>Long button label text</Button>)
    expect(screen.getByRole("button")).toHaveClass("whitespace-nowrap")
  })
})
