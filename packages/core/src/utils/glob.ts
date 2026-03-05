/**
 * Simple glob matching - checks if file path matches pattern.
 * Supports: *, **, ?, and globstar-directory optional semantics (double-star + slash).
 *
 * - `*` matches any characters except /
 * - `**` matches any characters including /
 * - `?` matches a single character
 *
 * @example
 * Example with globstar directory match: pattern starts with "src/" and then matches nested paths.
 * matchesGlob("src/index.ts", "*.ts") // false (no / in *)
 * matchesGlob("file.ts", "file.??") // true
 */
const escapeRegex = (value: string): string =>
  value.replace(/[.+^${}()|[\]\\]/g, "\\$&")

/**
 * Compile a glob pattern into RegExp once for repeated matching.
 */
export const globToRegExp = (pattern: string): RegExp => {
  const normalized = pattern.replace(/\\/g, "/")
  const withTokens = normalized
    .replace(/\*\*\//g, "<<<GLOBSTAR_DIR>>>")
    .replace(/\*\*/g, "<<<GLOBSTAR>>>")
    .replace(/\*/g, "<<<STAR>>>")
    .replace(/\?/g, "<<<QUESTION>>>")

  const regexPattern = escapeRegex(withTokens)
    .replace(/<<<GLOBSTAR_DIR>>>/g, "(?:.*/)?")
    .replace(/<<<GLOBSTAR>>>/g, ".*")
    .replace(/<<<STAR>>>/g, "[^/]*")
    .replace(/<<<QUESTION>>>/g, "[^/]")

  return new RegExp(`^${regexPattern}$`)
}

export const matchesGlob = (filePath: string, pattern: string): boolean => {
  const regex = globToRegExp(pattern)
  return regex.test(filePath.replace(/\\/g, "/"))
}
