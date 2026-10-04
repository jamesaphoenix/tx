import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react"

/** Keep keyboard navigation inside an open dialog and return to its opener. */
export function useModalFocus(open: boolean, onClose: () => void, initialFocus: RefObject<HTMLElement | null>) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    initialFocus.current?.focus()
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus() }
  }, [open, initialFocus])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== "Tab" || !dialogRef.current?.contains(event.target as Node)) return
    const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
      'button,input,textarea,select,a[href],[tabindex]'
    )).filter(element => element.tabIndex >= 0 && !element.matches(":disabled") &&
      !element.closest('[hidden],[aria-hidden="true"]') &&
      getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden")
    const first = controls[0], last = controls.at(-1)
    if (!first || !last) { event.preventDefault(); return }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  return {dialogRef,onKeyDown}
}
