import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useCommandContext, type Command } from "./CommandContext"

const ICON_MAP: Record<string, React.ReactNode> = {
  nav: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  ),
  filter: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  ),
  copy: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  delete: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  select: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-cyan-400">
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  ),
  action: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
}

const GROUP_ORDER = ["Actions", "Navigation", "Filters", "Items"]

function groupCommands(commands: Command[]): { group: string; items: Command[] }[] {
  const map = new Map<string, Command[]>()
  for (const cmd of commands) {
    const g = cmd.group ?? "Actions"
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(cmd)
  }

  const result: { group: string; items: Command[] }[] = []
  // Known groups first, in order
  for (const g of GROUP_ORDER) {
    if (map.has(g)) {
      result.push({ group: g, items: map.get(g)! })
      map.delete(g)
    }
  }
  // Any remaining groups
  for (const [g, items] of map) {
    result.push({ group: g, items })
  }
  return result
}

export function CommandPalette() {
  const { commands, isOpen, setOpen } = useCommandContext()
  const [query, setQuery] = useState("")
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setQuery("")
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  // Filter commands by query
  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.sublabel?.toLowerCase().includes(q) ?? false) ||
        (c.group?.toLowerCase().includes(q) ?? false)
    )
  }, [commands, query])

  // Flat list for keyboard nav
  const flatItems = useMemo(() => {
    const groups = groupCommands(filtered)
    const items: { cmd: Command; groupLabel: string | null }[] = []
    for (const g of groups) {
      for (let i = 0; i < g.items.length; i++) {
        items.push({ cmd: g.items[i], groupLabel: i === 0 ? g.group : null })
      }
    }
    return items
  }, [filtered])

  // Clamp active index
  useEffect(() => {
    if (activeIndex >= flatItems.length) {
      setActiveIndex(Math.max(0, flatItems.length - 1))
    }
  }, [flatItems.length, activeIndex])

  // Scroll into view
  useEffect(() => {
    const container = listRef.current
    if (!container) return
    // Find the active element (account for group headers)
    let idx = 0
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i] as HTMLElement
      if (child.dataset.itemIndex === String(activeIndex)) {
        child.scrollIntoView({ block: "nearest" })
        break
      }
      idx++
    }
  }, [activeIndex])

  const executeItem = useCallback(
    (cmd: Command) => {
      setOpen(false)
      cmd.action()
    },
    [setOpen]
  )

  // Keyboard navigation inside palette
  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(e: KeyboardEvent) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1))
          break
        case "ArrowUp":
          e.preventDefault()
          setActiveIndex((i) => Math.max(i - 1, 0))
          break
        case "Enter":
          e.preventDefault()
          if (flatItems[activeIndex]) {
            executeItem(flatItems[activeIndex].cmd)
          }
          break
        case "Escape":
          e.preventDefault()
          setOpen(false)
          break
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, flatItems, activeIndex, setOpen, executeItem])

  if (!isOpen) return null

  // Build render items with group headers
  const renderList: ({ type: "header"; label: string; key: string } | { type: "item"; cmd: Command; index: number; key: string })[] = []
  for (let i = 0; i < flatItems.length; i++) {
    const { cmd, groupLabel } = flatItems[i]
    if (groupLabel) {
      renderList.push({ type: "header", label: groupLabel, key: `header-${groupLabel}` })
    }
    renderList.push({ type: "item", cmd, index: i, key: cmd.id })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />

      {/* Palette */}
      <div className="relative w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Search */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-700/50">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500 flex-shrink-0">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIndex(0)
            }}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] text-gray-500 bg-gray-800 rounded border border-gray-700">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[340px] overflow-y-auto py-1">
          {flatItems.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              No matching commands
            </div>
          )}
          {renderList.map((item) => {
            if (item.type === "header") {
              return (
                <div
                  key={item.key}
                  className="px-4 pt-2 pb-1 text-[10px] font-semibold text-gray-500 uppercase tracking-wider"
                >
                  {item.label}
                </div>
              )
            }

            const isActive = item.index === activeIndex
            const icon = item.cmd.icon ? ICON_MAP[item.cmd.icon] : ICON_MAP.action

            return (
              <button
                key={item.key}
                data-item-index={item.index}
                onClick={() => executeItem(item.cmd)}
                onMouseEnter={() => setActiveIndex(item.index)}
                className={`w-full text-left px-4 py-2 flex items-center gap-3 transition-colors ${
                  isActive ? "bg-blue-600/20" : "hover:bg-gray-800"
                }`}
              >
                <span className="flex-shrink-0">{icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">{item.cmd.label}</div>
                  {item.cmd.sublabel && (
                    <div className="text-[10px] text-gray-500 truncate">{item.cmd.sublabel}</div>
                  )}
                </div>
                {item.cmd.shortcut && (
                  <kbd className="px-1.5 py-0.5 text-[9px] text-gray-500 bg-gray-800 rounded border border-gray-700 flex-shrink-0">
                    {item.cmd.shortcut}
                  </kbd>
                )}
                {isActive && !item.cmd.shortcut && (
                  <kbd className="px-1.5 py-0.5 text-[9px] text-gray-500 bg-gray-800 rounded border border-gray-700 flex-shrink-0">
                    &#x23CE;
                  </kbd>
                )}
              </button>
            )
          })}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-gray-700/50 flex items-center gap-4 text-[10px] text-gray-600">
          <span>
            <kbd className="px-1 py-0.5 bg-gray-800 rounded border border-gray-700">&#x2191;&#x2193;</kbd> navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-gray-800 rounded border border-gray-700">&#x23CE;</kbd> select
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-gray-800 rounded border border-gray-700">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
