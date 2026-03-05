/**
 * Minimal ULID generator (26-char Crockford Base32).
 *
 * No external dependency to keep tx-core lean.
 */

import { randomBytes } from "node:crypto"

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

const encodeTime = (timeMs: number, length: number): string => {
  let value = Math.floor(timeMs)
  let out = ""
  for (let i = length; i > 0; i--) {
    out = ENCODING[value % 32] + out
    value = Math.floor(value / 32)
  }
  return out
}

const encodeRandom = (length: number): string => {
  const bytes = randomBytes(length)
  let out = ""
  for (let i = 0; i < bytes.length; i++) {
    out += ENCODING[bytes[i] % 32]
  }
  return out
}

export const generateUlid = (timestampMs: number = Date.now()): string => {
  // ULID: 10 chars timestamp + 16 chars randomness
  return `${encodeTime(timestampMs, 10)}${encodeRandom(16)}`
}

export const isUlid = (value: string): boolean => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)
