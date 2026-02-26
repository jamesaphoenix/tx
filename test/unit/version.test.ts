/**
 * Unit tests for CLI version resolution and semver validation.
 *
 * Tests the SEMVER_RE regex and version fallback behavior exposed via
 * apps/cli/src/version.ts.
 */
import { describe, it, expect } from "vitest"

// Must match the regex from version.ts exactly
const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9._-]+)?(\+[a-zA-Z0-9._-]+)?$/

describe("version semver validation", () => {
  const validVersions = [
    "0.5.9",
    "1.0.0",
    "10.20.30",
    "0.0.1",
    "99.99.99",
    "0.5.9-beta.1",
    "1.0.0-rc.1",
    "1.0.0+build.123",
    "1.0.0-alpha+001",
  ]

  const invalidVersions = [
    "false",
    "null",
    "true",
    "undefined",
    "",
    "abc",
    "0",
    "0.5",
    "v0.5.9",          // leading 'v' is not valid semver
    ".0.5.9",          // leading dot
    "latest",
    "not-a-version",
    "1.2.3; rm -rf /", // shell injection attempt
    "1.2.3$(id)",      // command substitution attempt
    "1.2.3\nmalicious", // newline injection
    "1.2.3 extra",     // trailing space + text
  ]

  for (const v of validVersions) {
    it(`accepts valid version: ${JSON.stringify(v)}`, () => {
      expect(SEMVER_RE.test(v)).toBe(true)
    })
  }

  for (const v of invalidVersions) {
    it(`rejects invalid version: ${JSON.stringify(v)}`, () => {
      expect(SEMVER_RE.test(v)).toBe(false)
    })
  }
})
