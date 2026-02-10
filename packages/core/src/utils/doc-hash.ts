/**
 * Content-addressed hashing for docs.
 * SHA256 hex digest of normalized content.
 */
import { createHash } from "node:crypto"

/**
 * Compute SHA256 hash of document content.
 * Normalizes content by trimming whitespace and normalizing line endings.
 */
export const computeDocHash = (content: string): string => {
  const normalized = content.trim().replace(/\r\n/g, "\n")
  return createHash("sha256").update(normalized, "utf8").digest("hex")
}
