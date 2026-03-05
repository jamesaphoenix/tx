import { Context, Effect } from "effect"
import * as crypto from "node:crypto"
import * as fs from "node:fs/promises"
import { AnchorRepository } from "../../repo/anchor-repo.js"
import { DatabaseError } from "../../errors.js"
import type { Anchor } from "@jamesaphoenix/tx-types"

const SELF_HEAL_THRESHOLD = 0.8
const MAX_PREVIEW_LENGTH = 500

export const computeContentHash = (content: string): string =>
  crypto.createHash("sha256").update(content).digest("hex")

export const fileExists = (filePath: string): Effect.Effect<boolean, never> =>
  Effect.tryPromise({
    try: async () => {
      await fs.access(filePath)
      return true
    },
    catch: () => false
  }).pipe(Effect.catchAll(() => Effect.succeed(false)))

export const readFile = (filePath: string): Effect.Effect<string | null, never> =>
  Effect.tryPromise({
    try: async () => {
      const content = await fs.readFile(filePath, "utf-8")
      return content
    },
    catch: () => null
  }).pipe(Effect.catchAll(() => Effect.succeed(null)))

export const readLineRange = (
  filePath: string,
  lineStart: number,
  lineEnd: number
): Effect.Effect<string | null, never> =>
  Effect.gen(function* () {
    if (lineStart < 1 || lineEnd < 1) return null
    if (lineEnd < lineStart) return null

    const content = yield* readFile(filePath)
    if (!content) return null

    const lines = content.split("\n")
    if (lineStart > lines.length) return null

    const end = Math.min(lineEnd, lines.length)
    return lines.slice(lineStart - 1, end).join("\n")
  })

export const countLines = (filePath: string): Effect.Effect<number, never> =>
  Effect.gen(function* () {
    const content = yield* readFile(filePath)
    if (!content) return 0
    return content.split("\n").length
  })

const escapeRegex = (str: string): string =>
  str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export const symbolExistsInFile = (
  filePath: string,
  symbolName: string
): Effect.Effect<boolean, never> =>
  Effect.gen(function* () {
    const content = yield* readFile(filePath)
    if (!content) return false

    const lastSep = symbolName.lastIndexOf("::")
    const simpleName = lastSep >= 0
      ? symbolName.slice(lastSep + 2) || symbolName
      : symbolName

    if (!simpleName || simpleName.trim().length === 0) {
      return false
    }

    const escapedName = escapeRegex(simpleName.trim())

    const idStart = `(?<![a-zA-Z0-9_$])`
    const idEnd = `(?![a-zA-Z0-9_$])`
    const patterns = [
      new RegExp(`\\b(function|const|let|var)\\s+${escapedName}${idEnd}`),
      new RegExp(`\\bclass\\s+${escapedName}${idEnd}`),
      new RegExp(`\\binterface\\s+${escapedName}${idEnd}`),
      new RegExp(`\\btype\\s+${escapedName}${idEnd}`),
      new RegExp(`\\bexport\\s+(default\\s+)?(function|class|const|let|var|interface|type)\\s+${escapedName}${idEnd}`),
      new RegExp(`\\bexport\\s+\\{[^}]*${idStart}${escapedName}${idEnd}[^}]*\\}`)
    ]

    return patterns.some(p => p.test(content))
  })

const tokenize = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 2)
  )

const jaccardSimilarity = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0

  const intersection = new Set([...a].filter(x => b.has(x)))
  const union = new Set([...a, ...b])
  return union.size === 0 ? 0 : intersection.size / union.size
}

const computeSimilarity = (oldContent: string, newContent: string): number =>
  jaccardSimilarity(tokenize(oldContent), tokenize(newContent))

export const createContentPreview = (content: string): string => {
  if (content.length <= MAX_PREVIEW_LENGTH) return content
  return content.slice(0, MAX_PREVIEW_LENGTH)
}

export type SelfHealResult = {
  readonly healed: boolean
  readonly similarity: number
  readonly newHash?: string
  readonly newPreview?: string
}

export const trySelfHeal = (
  anchor: Anchor,
  newContent: string,
  newHash: string,
  anchorRepo: Context.Tag.Service<typeof AnchorRepository>
): Effect.Effect<SelfHealResult, DatabaseError> =>
  Effect.gen(function* () {
    if (!anchor.contentPreview) {
      return { healed: false, similarity: 0 }
    }

    const similarity = computeSimilarity(anchor.contentPreview, newContent)

    if (similarity >= SELF_HEAL_THRESHOLD) {
      const newPreview = createContentPreview(newContent)

      yield* anchorRepo.update(anchor.id, {
        contentHash: newHash,
        contentPreview: newPreview,
        verifiedAt: new Date()
      })

      return {
        healed: true,
        similarity,
        newHash,
        newPreview
      }
    }

    return { healed: false, similarity }
  })
