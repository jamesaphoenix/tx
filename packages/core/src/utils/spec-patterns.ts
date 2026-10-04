// Shared by discovery, config defaults and the generated TOML.
export const DEFAULT_SPEC_TEST_PATTERNS: readonly string[] = [
  "**/*.test.{ts,js,tsx,jsx}",
  "**/*.integration.test.{ts,js,tsx,jsx}",
  "**/*.spec.{ts,js,tsx,jsx}",
  "test/**/*.test.{ts,js,tsx,jsx}",
  "tests/**/*.py",
  "**/test_*.py",
  "**/*_test.go",
  "**/*_test.rs",
  "**/Test*.java",
  "**/*Test.java",
  "**/*_spec.rb",
  "**/*.test.{c,cpp,cc}",
  "**/*_test.{c,cpp,cc}",
  "**/*.pgtap.sql",
]
