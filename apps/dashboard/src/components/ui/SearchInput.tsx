import { useState, useEffect, useRef, type ChangeEvent } from "react"
import { useDebounce } from "../../hooks/useDebounce"

interface SearchInputProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  debounceMs?: number
  themeMode?: "light" | "dark"
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search...",
  debounceMs = 300,
  themeMode = "dark",
}: SearchInputProps) {
  const isDarkTheme = themeMode === "dark"
  const [localValue, setLocalValue] = useState(value)
  const debouncedValue = useDebounce(localValue, debounceMs)
  const hasMounted = useRef(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Update parent when debounced value changes (skip initial mount)
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true
      return
    }
    onChangeRef.current(debouncedValue)
  }, [debouncedValue])

  // Sync with external value changes
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setLocalValue(e.target.value)
  }

  const handleClear = () => {
    setLocalValue("")
    onChange("")
  }

  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <svg
          className={`h-4 w-4 ${isDarkTheme ? "text-gray-500" : "text-gray-400"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
      </div>
      <input
        type="text"
        value={localValue}
        onChange={handleChange}
        data-native-select-all="true"
        placeholder={placeholder}
        className={`w-full rounded-lg border py-2 pl-10 pr-10 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-500 ${
          isDarkTheme
            ? "border-gray-700 bg-gray-800 text-white placeholder-gray-500 focus:border-blue-500"
            : "border-[#cbd5e1] bg-white text-[#0f172a] placeholder:text-[#64748b] focus:border-[#60a5fa]"
        }`}
      />
      {localValue && (
        <button
          onClick={handleClear}
          className={`absolute inset-y-0 right-0 flex items-center pr-3 transition-colors ${
            isDarkTheme ? "text-gray-500 hover:text-gray-300" : "text-[#94a3b8] hover:text-[#64748b]"
          }`}
          aria-label="Clear search"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
