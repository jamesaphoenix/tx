/**
 * Pin file manipulation utilities
 *
 * Pure functions for parsing, inserting, updating, and removing
 * <tx-pin id="...">...</tx-pin> blocks in markdown files.
 *
 * No DB, no Effect — just string manipulation.
 */

/** Regex to match a single tx-pin block. Uses non-greedy [\s\S]*? to avoid matching across blocks. */
const PIN_BLOCK_RE = /<tx-pin id="([^"]+)">([\s\S]*?)<\/tx-pin>/g

/** Build a regex for a specific pin ID. */
const pinBlockById = (id: string): RegExp =>
  new RegExp(`<tx-pin id="${escapeRegex(id)}">([\\s\\S]*?)<\\/tx-pin>`, "g")

/** Escape special regex characters in a string. */
const escapeRegex = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * Parse all <tx-pin> blocks from file content.
 * Returns a Map of id → content (content between tags).
 */
export const parseBlocks = (fileContent: string): Map<string, string> => {
  const blocks = new Map<string, string>()
  let match: RegExpExecArray | null
  const re = new RegExp(PIN_BLOCK_RE.source, PIN_BLOCK_RE.flags)
  while ((match = re.exec(fileContent)) !== null) {
    blocks.set(match[1], match[2])
  }
  return blocks
}

/** Check if a block with the given ID exists in file content. */
export const hasBlock = (fileContent: string, id: string): boolean => {
  return pinBlockById(id).test(fileContent)
}

/**
 * Insert a new block or replace an existing one.
 * If the block exists, replaces it in-place. Otherwise appends at the end.
 */
export const upsertBlock = (fileContent: string, id: string, blockContent: string): string => {
  const formatted = formatBlock(id, blockContent)
  if (hasBlock(fileContent, id)) {
    // Use function replacement to prevent $-pattern substitution (e.g. $&, $1)
    return fileContent.replace(pinBlockById(id), () => formatted)
  }
  // Append: ensure there's a blank line before the new block
  const trimmed = fileContent.trimEnd()
  return trimmed.length === 0 ? `${formatted}\n` : `${trimmed}\n\n${formatted}\n`
}

/**
 * Remove a block by ID from file content.
 * Removes the block and any extra blank lines left behind.
 */
export const removeBlock = (fileContent: string, id: string): string => {
  if (!hasBlock(fileContent, id)) return fileContent
  // Remove the block and surrounding line breaks (handles both \n and \r\n)
  const removeRe = new RegExp(
    `[\\r\\n]*<tx-pin id="${escapeRegex(id)}">[\\s\\S]*?<\\/tx-pin>[\\r\\n]*`,
    "g"
  )
  const result = fileContent.replace(removeRe, "\n\n")
  // Clean up: collapse triple+ newlines to double (handle \r\n sequences), trim both ends
  return result.replace(/(\r?\n){3,}/g, "\n\n").trim() + "\n"
}

/**
 * Full sync: given the desired set of pins, update file content to match.
 * - Adds missing pins
 * - Updates changed pins (content differs)
 * - Removes stale pins (in file but not in desired set)
 */
export const syncBlocks = (fileContent: string, pins: Map<string, string>): string => {
  let result = fileContent
  const existing = parseBlocks(result)

  // Remove stale blocks (in file but not in desired pins)
  for (const id of existing.keys()) {
    if (!pins.has(id)) {
      result = removeBlock(result, id)
    }
  }

  // Add or update blocks
  for (const [id, content] of pins) {
    result = upsertBlock(result, id, content)
  }

  return result
}

/** Format a pin block with proper XML tags. */
const formatBlock = (id: string, content: string): string => {
  // Ensure content has a leading newline and trailing newline for readability
  const normalized = content.startsWith("\n") ? content : `\n${content}`
  const withTrailing = normalized.endsWith("\n") ? normalized : `${normalized}\n`
  return `<tx-pin id="${id}">${withTrailing}</tx-pin>`
}
