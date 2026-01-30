import { useEffect, useRef, useCallback } from "react"

interface UseIntersectionObserverOptions {
  onIntersect: () => void
  enabled?: boolean
  threshold?: number
  rootMargin?: string
}

export function useIntersectionObserver({
  onIntersect,
  enabled = true,
  threshold = 0.1,
  rootMargin = "100px",
}: UseIntersectionObserverOptions): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)
  const onIntersectRef = useRef(onIntersect)

  // Keep callback ref up to date
  useEffect(() => {
    onIntersectRef.current = onIntersect
  }, [onIntersect])

  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries
      if (entry?.isIntersecting) {
        onIntersectRef.current()
      }
    },
    []
  )

  useEffect(() => {
    const element = ref.current
    if (!enabled || !element) {
      return
    }

    const observer = new IntersectionObserver(handleIntersect, {
      threshold,
      rootMargin,
    })

    observer.observe(element)

    return () => {
      observer.disconnect()
    }
  }, [enabled, threshold, rootMargin, handleIntersect])

  return ref
}
