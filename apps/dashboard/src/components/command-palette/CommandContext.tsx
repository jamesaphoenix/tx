import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react"
import { selectionActions } from "../../stores/selection-store"

export interface Command {
  id: string
  label: string
  sublabel?: string
  group?: string
  shortcut?: string
  icon?: "nav" | "filter" | "copy" | "delete" | "select" | "action"
  action: () => void | Promise<void>
}

interface CommandContextValue {
  /** All registered commands (app-level + page-level merged) */
  commands: Command[]
  /** Set app-level commands (global: tab switching, etc.) */
  setAppCommands: (cmds: Command[]) => void
  /** Set page-level commands (changes when tab/page changes) */
  setPageCommands: (cmds: Command[]) => void
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
  const prevRef = useRef<string>("")

  useEffect(() => {
    // Only update if commands actually changed (by id list)
    const key = commands.map((c) => c.id).join(",")
    if (key !== prevRef.current) {
      prevRef.current = key
      setPageCommands(commands)
    }
  })

  useEffect(() => {
    return () => setPageCommands([])
  }, [setPageCommands])
}

export function CommandProvider({ children }: { children: ReactNode }) {
  const [appCommands, setAppCommands] = useState<Command[]>([])
  const [pageCommands, setPageCommands] = useState<Command[]>([])
  const [isOpen, setOpen] = useState(false)

  const commands = [...appCommands, ...pageCommands]

  // Global CMD+K and CMD+A handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't capture if user is typing in an input/textarea (except our palette input)
      const target = e.target as HTMLElement
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
        // Allow CMD+K even in inputs to open palette
        if ((e.metaKey || e.ctrlKey) && e.key === "k") {
          e.preventDefault()
          setOpen((prev) => !prev)
        }
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((prev) => !prev)
        return
      }

      // CMD+A: find and execute the selectAll command
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        const selectAllCmd = [...appCommands, ...pageCommands].find(
          (c) => c.id === "select-all" || c.shortcut === "⌘A"
        )
        if (selectAllCmd) {
          e.preventDefault()
          selectAllCmd.action()
        }
      }

      // CMD+C: find and execute the copy command (skip if text is selected for normal browser copy)
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        const selection = window.getSelection()
        if (selection && selection.toString().length > 0) return

        const copyCmd = [...appCommands, ...pageCommands].find(
          (c) => c.shortcut === "⌘C"
        )
        if (copyCmd) {
          e.preventDefault()
          copyCmd.action()
        }
      }

      // ESC: clear all selections when palette is not open
      if (e.key === "Escape" && !isOpen) {
        selectionActions.clearAll()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [appCommands, pageCommands, isOpen])

  const stableSetPageCommands = useCallback((cmds: Command[]) => {
    setPageCommands(cmds)
  }, [])

  const stableSetAppCommands = useCallback((cmds: Command[]) => {
    setAppCommands(cmds)
  }, [])

  return (
    <CommandContext.Provider
      value={{
        commands,
        setAppCommands: stableSetAppCommands,
        setPageCommands: stableSetPageCommands,
        isOpen,
        setOpen,
      }}
    >
      {children}
    </CommandContext.Provider>
  )
}
