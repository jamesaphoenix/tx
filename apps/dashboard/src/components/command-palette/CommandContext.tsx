import { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useRef, type ReactNode } from "react"
import { selectionActions } from "../../stores/selection-store"

export interface Command {
  id: string
  label: string
  sublabel?: string
  group?: string
  shortcut?: string
  /**
   * Allow shortcut handling while focus is inside an input/textarea/select.
   * Use sparingly for global view actions (e.g. select all in current panel).
   */
  allowInInput?: boolean
  icon?: "nav" | "filter" | "copy" | "delete" | "select" | "action"
  action: () => void | Promise<void>
}

type ShortcutScope = "global" | "modal" | "palette"
type ManagedShortcutScope = Exclude<ShortcutScope, "global">

interface CommandContextValue {
  /** All registered commands (app-level + page-level merged) */
  commands: Command[]
  /** Set app-level commands (global: tab switching, etc.) */
  setAppCommands: (cmds: Command[]) => void
  /** Set page-level commands (changes when tab/page changes) */
  setPageCommands: (cmds: Command[]) => void
  /** Set overlay commands (modals/dialogs layered on top of page) */
  setOverlayCommands: (cmds: Command[]) => void
  activeShortcutScope: ShortcutScope
  pushShortcutScope: (scope: ManagedShortcutScope) => () => void
  isOpen: boolean
  setOpen: (open: boolean) => void
}

const CommandContext = createContext<CommandContextValue | null>(null)

export function useCommandContext() {
  const ctx = useContext(CommandContext)
  if (!ctx) throw new Error("useCommandContext must be used inside <CommandProvider>")
  return ctx
}

/**
 * Hook for pages to register their commands. Commands are
 * automatically unregistered when the component unmounts.
 */
export function useCommands(commands: Command[]) {
  const { setPageCommands } = useCommandContext()
  const prevKeyRef = useRef("")

  useLayoutEffect(() => {
    const key = commands
      .map((c) => `${c.id}|${c.label}|${c.sublabel ?? ""}|${c.shortcut ?? ""}|${c.group ?? ""}|${String(c.allowInInput)}`)
      .join("\n")

    if (key === prevKeyRef.current) return
    prevKeyRef.current = key
    setPageCommands(commands)
  }, [commands, setPageCommands])
}

export function useOverlayCommands(commands: Command[]) {
  const { setOverlayCommands } = useCommandContext()
  const prevKeyRef = useRef("")

  useLayoutEffect(() => {
    const key = commands
      .map((c) => `${c.id}|${c.label}|${c.sublabel ?? ""}|${c.shortcut ?? ""}|${c.group ?? ""}|${String(c.allowInInput)}`)
      .join("\n")

    if (key === prevKeyRef.current) return
    prevKeyRef.current = key
    setOverlayCommands(commands)
  }, [commands, setOverlayCommands])
}

export function useShortcutScope(scope: ManagedShortcutScope, enabled: boolean) {
  const { pushShortcutScope } = useCommandContext()

  useLayoutEffect(() => {
    if (!enabled) return
    return pushShortcutScope(scope)
  }, [enabled, pushShortcutScope, scope])
}

function shortcutFromEvent(e: KeyboardEvent): string | null {
  if (!e.metaKey && !e.ctrlKey) return null
  const codeToKey: Record<string, string> = {
    KeyK: "K",
    KeyA: "A",
    KeyC: "C",
    KeyN: "N",
    KeyL: "L",
    KeyS: "S",
  }

  const byCode = codeToKey[e.code]
  const byKey = e.key.length === 1 ? e.key.toUpperCase() : ""
  const key = byCode ?? byKey
  if (!["K", "A", "C", "N", "L", "S"].includes(key)) return null
  return `${e.shiftKey ? "⌘⇧" : "⌘"}${key}`
}

function isTextInputElement(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.tagName === "TEXTAREA") return true
  if (target.tagName !== "INPUT") return false

  const input = target as HTMLInputElement
  return !["button", "submit", "reset", "checkbox", "radio", "file", "range", "color"].includes(input.type)
}

function isPaletteInputElement(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false
  return target.closest("[data-command-palette-input='true']") !== null
}

function isNativeSelectAllElement(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false
  return target.closest("[data-native-select-all='true']") !== null
}

export function CommandProvider({ children }: { children: ReactNode }) {
  const [appCommands, setAppCommands] = useState<Command[]>([])
  const [pageCommands, setPageCommands] = useState<Command[]>([])
  const [overlayCommands, setOverlayCommands] = useState<Command[]>([])
  const [shortcutScopes, setShortcutScopes] = useState<Array<{ id: number; scope: ManagedShortcutScope }>>([])
  const [isOpen, setOpen] = useState(false)
  const nextShortcutScopeIdRef = useRef(0)

  const commands = [...appCommands, ...pageCommands, ...overlayCommands]
  const activeShortcutScope: ShortcutScope = shortcutScopes.length > 0
    ? shortcutScopes[shortcutScopes.length - 1]!.scope
    : "global"

  const pushShortcutScope = useCallback((scope: ManagedShortcutScope) => {
    const nextId = nextShortcutScopeIdRef.current + 1
    nextShortcutScopeIdRef.current = nextId
    setShortcutScopes((prev) => [...prev, { id: nextId, scope }])

    return () => {
      setShortcutScopes((prev) => prev.filter((entry) => entry.id !== nextId))
    }
  }, [])

  // Global keyboard shortcut handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const shortcutCommands = activeShortcutScope === "modal"
        ? [...overlayCommands]
        : [...overlayCommands, ...pageCommands, ...appCommands]
      const inputShortcutCommands = overlayCommands.length > 0
        ? [...overlayCommands]
        : [...pageCommands, ...appCommands]
      const shortcut = shortcutFromEvent(e)

      const isTextInput = isTextInputElement(e.target)
      const isPaletteInput = isPaletteInputElement(e.target)

      // CMD+Shift+K always toggles the command palette.
      if (shortcut === "⌘⇧K") {
        e.preventDefault()
        setOpen((prev) => !prev)
        return
      }

      // CMD+K toggles the command palette.
      if (shortcut === "⌘K") {
        e.preventDefault()
        setOpen((prev) => !prev)
        return
      }

      if (e.defaultPrevented) {
        return
      }

      // Palette owns key handling while open (except CMD+K above).
      if (activeShortcutScope === "palette") {
        if (shortcut) {
          e.preventDefault()
        }
        return
      }

      if (isTextInput) {
        if (shortcut === "⌘A" && isNativeSelectAllElement(e.target)) {
          return
        }

        // Let native text shortcuts win inside focused overlay inputs.
        if (activeShortcutScope !== "global" || isPaletteInput) {
          if (shortcut) {
            e.preventDefault()
          }
          return
        }

        // Allow a narrow set of explicitly opted-in shortcuts while typing.
        if (shortcut) {
          const command = inputShortcutCommands.find((c) =>
            c.allowInInput &&
            (
              c.shortcut === shortcut ||
              (shortcut === "⌘A" && c.id === "select-all")
            )
          )
          if (command) {
            e.preventDefault()
            void command.action()
            return
          }
        }
        // Otherwise avoid hijacking browser/editor shortcuts while typing
        return
      }

      if (shortcut === "⌘C") {
        const selection = window.getSelection()
        if (selection && selection.toString().length > 0) return
      }

      if (shortcut) {
        const command = shortcutCommands.find(
          (c) => c.shortcut === shortcut || (shortcut === "⌘A" && c.id === "select-all")
        )
        if (command) {
          e.preventDefault()
          void command.action()
          return
        }
      }

      // ESC: clear all selections when palette is not open
      if (e.key === "Escape" && !isOpen) {
        selectionActions.clearAll()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [appCommands, pageCommands, overlayCommands, isOpen, activeShortcutScope])

  const stableSetPageCommands = useCallback((cmds: Command[]) => {
    setPageCommands(cmds)
  }, [])

  const stableSetAppCommands = useCallback((cmds: Command[]) => {
    setAppCommands(cmds)
  }, [])

  const stableSetOverlayCommands = useCallback((cmds: Command[]) => {
    setOverlayCommands(cmds)
  }, [])

  return (
    <CommandContext.Provider
      value={{
        commands,
        setAppCommands: stableSetAppCommands,
        setPageCommands: stableSetPageCommands,
        setOverlayCommands: stableSetOverlayCommands,
        activeShortcutScope,
        pushShortcutScope,
        isOpen,
        setOpen,
      }}
    >
      {children}
    </CommandContext.Provider>
  )
}
