import { useEffect, useState, useCallback } from "react"

interface UseKeyboardNavigationOptions {
  itemCount: number
  onSelect: (index: number) => void
  onEscape?: () => void
  enabled?: boolean
}

export function useKeyboardNavigation({
  itemCount,
  onSelect,
  onEscape,
  enabled = true,
}: UseKeyboardNavigationOptions): {
  focusedIndex: number
  setFocusedIndex: React.Dispatch<React.SetStateAction<number>>
} {
  const [focusedIndex, setFocusedIndex] = useState(0)

  // Reset focus when item count changes
  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(0, itemCount - 1)))
  }, [itemCount])

  // Store callbacks in refs to avoid stale closures
  const onSelectRef = useCallback(onSelect, [onSelect])
  const onEscapeRef = useCallback(() => onEscape?.(), [onEscape])

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input or textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      switch (e.key) {
        case "ArrowDown":
        case "j":
          e.preventDefault()
          setFocusedIndex((i) => Math.min(i + 1, itemCount - 1))
          break
        case "ArrowUp":
        case "k":
          e.preventDefault()
          setFocusedIndex((i) => Math.max(i - 1, 0))
          break
        case "Enter":
          e.preventDefault()
          setFocusedIndex((currentIndex) => {
            onSelectRef(currentIndex)
            return currentIndex
          })
          break
        case "Escape":
          e.preventDefault()
          onEscapeRef()
          break
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [enabled, itemCount, onSelectRef, onEscapeRef])

  return { focusedIndex, setFocusedIndex }
}
