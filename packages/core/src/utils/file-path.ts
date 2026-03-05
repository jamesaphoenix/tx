import { existsSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve, sep, win32 } from "node:path"

export type PathWithinOptions = {
  readonly allowBaseDir?: boolean
  readonly useRealpath?: boolean
}

/**
 * Normalize path separators to forward slashes for stable IDs and comparisons.
 */
export const normalizePathSeparators = (filePath: string): string => {
  return filePath.replace(/\\/g, "/")
}

/**
 * Convert an absolute path to a root-relative POSIX-style path.
 * Relative input is returned with normalized separators.
 */
export const toNormalizedRelativePath = (rootDir: string, filePath: string): string => {
  const normalized = normalizePathSeparators(filePath)
  if (!isAbsolute(normalized) && !win32.isAbsolute(normalized)) return normalized
  return normalizePathSeparators(relative(rootDir, normalized))
}

/**
 * Resolve a path for security comparison, using realpath when available.
 * Falls back to resolve() when the target does not exist yet.
 */
export const resolvePathForComparison = (filePath: string): string => {
  const resolved = resolve(filePath)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

/**
 * Resolve path using realpath for the deepest existing ancestor.
 * This catches symlink escapes for yet-to-be-created files.
 */
const resolvePathForComparisonViaAncestor = (filePath: string): string => {
  const resolved = resolve(filePath)
  let probe = resolved

  while (true) {
    if (existsSync(probe)) {
      const canonicalProbe = resolvePathForComparison(probe)
      if (probe === resolved) return canonicalProbe

      const remainder = relative(probe, resolved)
      return resolve(canonicalProbe, remainder)
    }

    const parent = dirname(probe)
    if (parent === probe) return resolved
    probe = parent
  }
}

/**
 * True when candidatePath is within baseDir (or equal to it when allowed).
 */
export const isPathWithin = (
  baseDir: string,
  candidatePath: string,
  options: PathWithinOptions = {}
): boolean => {
  const allowBaseDir = options.allowBaseDir ?? true
  const useRealpath = options.useRealpath ?? false

  const resolvedBase = useRealpath ? resolvePathForComparison(baseDir) : resolve(baseDir)
  const resolvedCandidate = useRealpath
    ? resolvePathForComparisonViaAncestor(candidatePath)
    : resolve(candidatePath)

  if (resolvedCandidate === resolvedBase) return allowBaseDir

  const basePrefix = resolvedBase.endsWith(sep)
    ? resolvedBase
    : `${resolvedBase}${sep}`

  return resolvedCandidate.startsWith(basePrefix)
}

/**
 * Resolve targetPath against baseDir and return null when it escapes baseDir.
 */
export const resolvePathWithin = (
  baseDir: string,
  targetPath: string,
  options: PathWithinOptions = {}
): string | null => {
  const resolvedTarget = resolve(baseDir, targetPath)
  return isPathWithin(baseDir, resolvedTarget, options) ? resolvedTarget : null
}
