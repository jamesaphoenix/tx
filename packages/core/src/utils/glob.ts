/**
 * Simple glob matching - checks if file path matches pattern.
 * Supports: *, **, ?
 *
 * - `*` matches any characters except /
 * - `**` matches any characters including /
 * - `?` matches a single character
 *
 * @example
 * matchesGlob("src/utils/math.ts", "src/**\/*.ts") // true
 * matchesGlob("src/index.ts", "*.ts") // false (no / in *)
 * matchesGlob("file.ts", "file.??") // true
 */
export const matchesGlob = (filePath: string, pattern: string): boolean => {
  // Simple glob matching without external dependencies
  // Order matters: protect glob patterns, escape dots, then restore patterns
  const regexPattern = pattern
    .replace(/\*\*/g, "<<<GLOBSTAR>>>") // Protect ** (will become .*)
    .replace(/\?/g, "<<<QUESTION>>>") // Protect ? (will become .)
    .replace(/\*/g, "[^/]*") // Replace * with segment matcher
    .replace(/\./g, "\\.") // Escape literal dots (e.g., .ts → \\.ts)
    .replace(/<<<GLOBSTAR>>>/g, ".*") // Restore ** as .* (matches any path)
    .replace(/<<<QUESTION>>>/g, ".") // Restore ? as . (matches single char)

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(filePath)
}
