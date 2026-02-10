/**
 * Shared LLM JSON parsing utility.
 *
 * Robust parser for LLM responses that may include markdown fences,
 * extra text, or other formatting issues. Following DD-006 patterns.
 */

/**
 * Parse LLM JSON response, handling common formatting issues.
 *
 * Tries multiple strategies:
 * 1. Direct JSON.parse
 * 2. Strip markdown code fences
 * 3. Find first [ or { and parse from there
 * 4. Find matching bracket and extract
 */
export const parseLlmJson = <T>(raw: string): T | null => {
  // Step 1: Try direct parse
  try { return JSON.parse(raw) } catch { /* continue */ }

  // Step 2: Strip markdown code fences
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  if (fenceMatch && fenceMatch[1]) {
    try { return JSON.parse(fenceMatch[1].trim()) } catch { /* continue */ }
  }

  // Step 3: Find first [ or { and parse from there
  const jsonStart = raw.search(/[[{]/)
  if (jsonStart >= 0) {
    const candidate = raw.slice(jsonStart)
    try { return JSON.parse(candidate) } catch { /* continue */ }

    // Step 4: Find matching bracket and extract
    const openChar = candidate[0]
    const closeChar = openChar === "[" ? "]" : "}"
    const lastClose = candidate.lastIndexOf(closeChar)
    if (lastClose > 0) {
      try { return JSON.parse(candidate.slice(0, lastClose + 1)) } catch { /* continue */ }
    }
  }

  return null
}
