import { Data, Effect, Either, Schema } from "effect"
import { parse as parseYaml } from "yaml"
import {
  MdAcceptanceCriterionSchema,
  MdEmbeddedBlocksSchema,
  MdEarsRequirementSchema,
  MdFailureModeSchema,
  MdFrontmatterSchema,
  MdInterfaceSchema,
  MdInvariantSchema,
  MdParsedDocSchema,
  MdSectionSchema,
  MdVerificationSchema,
  type MdEmbeddedBlocks,
  type MdFrontmatter,
  type MdParsedDoc,
  type MdSection,
} from "../types/index.js"
import { formatEarsValidationErrors, validateEarsRequirements } from "./ears-validator.js"

const EMBEDDED_BLOCK_SCHEMAS = {
  ears_requirements: Schema.Array(MdEarsRequirementSchema),
  invariants: Schema.Array(MdInvariantSchema),
  verification: Schema.Array(MdVerificationSchema),
  interfaces: Schema.Array(MdInterfaceSchema),
  failure_modes: Schema.Array(MdFailureModeSchema),
  acceptance_criteria: Schema.Array(MdAcceptanceCriterionSchema),
} as const

type EmbeddedBlockKey = keyof typeof EMBEDDED_BLOCK_SCHEMAS
const EMBEDDED_BLOCK_KEYS = new Set<EmbeddedBlockKey>(
  Object.keys(EMBEDDED_BLOCK_SCHEMAS) as EmbeddedBlockKey[]
)

type ParseEither<A> = Either.Either<A, MdDocParseError>

export class MdDocParseError extends Data.TaggedError("MdDocParseError")<{
  readonly reason: string
}> {
  get message(): string {
    return this.reason
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

const formatDecodeError = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") {
      return message
    }
  }
  return String(error)
}

const decodeUnknown = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: unknown,
  context: string
): ParseEither<A> => {
  try {
    return Either.right(Schema.decodeUnknownSync(schema)(input))
  } catch (error) {
    return Either.left(
      new MdDocParseError({ reason: `${context}: ${formatDecodeError(error)}` })
    )
  }
}

const splitFrontmatter = (
  content: string
): ParseEither<{ frontmatter: string; body: string }> => {
  const cleaned = content.startsWith("\uFEFF") ? content.slice(1) : content
  const hasFrontmatterOpen = cleaned.startsWith("---\n") || cleaned.startsWith("---\r\n")

  if (!hasFrontmatterOpen) {
    return Either.left(
      new MdDocParseError({ reason: "Document must start with YAML frontmatter delimiter '---'." })
    )
  }

  const openLength = cleaned.startsWith("---\r\n") ? 5 : 4
  const rest = cleaned.slice(openLength)
  const lines = rest.split(/\r?\n/)
  const closingIndex = lines.findIndex((line) => line.trimEnd() === "---")

  if (closingIndex === -1) {
    return Either.left(
      new MdDocParseError({ reason: "Frontmatter opening delimiter found, but closing '---' delimiter is missing." })
    )
  }

  const frontmatter = lines.slice(0, closingIndex).join("\n")
  const body = lines.slice(closingIndex + 1).join("\n")

  return Either.right({ frontmatter, body })
}

const parseYamlRecord = (
  yamlContent: string,
  context: string
): ParseEither<Record<string, unknown>> => {
  let parsed: unknown

  try {
    parsed = parseYaml(yamlContent)
  } catch (error) {
    return Either.left(
      new MdDocParseError({ reason: `${context}: YAML parse error: ${String(error)}` })
    )
  }

  const record = asRecord(parsed)
  if (!record) {
    return Either.left(
      new MdDocParseError({ reason: `${context}: expected YAML object at top level.` })
    )
  }

  return Either.right(record)
}

const extractYamlBlocks = (body: string): ParseEither<string[]> => {
  const lines = body.split(/\r?\n/)
  const blocks: string[] = []
  let inFence = false
  let isYamlFence = false
  let fenceBuffer: string[] = []

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*```([^\s`]*)?\s*$/)

    if (!inFence) {
      if (fenceMatch) {
        inFence = true
        const language = (fenceMatch[1] ?? "").toLowerCase()
        isYamlFence = language === "yaml" || language === "yml"
        fenceBuffer = []
      }
      continue
    }

    if (fenceMatch) {
      if (isYamlFence) {
        blocks.push(fenceBuffer.join("\n"))
      }
      inFence = false
      isYamlFence = false
      fenceBuffer = []
      continue
    }

    if (isYamlFence) {
      fenceBuffer.push(line)
    }
  }

  if (inFence && isYamlFence) {
    return Either.left(new MdDocParseError({ reason: "Unclosed fenced YAML block detected." }))
  }

  return Either.right(blocks)
}

const mergeEmbeddedBlock = (
  accumulator: Partial<Record<EmbeddedBlockKey, readonly unknown[]>>,
  key: EmbeddedBlockKey,
  entries: readonly unknown[]
): void => {
  const existing = accumulator[key] ?? []
  accumulator[key] = [...existing, ...entries]
}

const decodeEmbeddedBlockEntries = (
  key: EmbeddedBlockKey,
  value: unknown
): ParseEither<readonly unknown[]> => {
  switch (key) {
    case "ears_requirements":
      return decodeUnknown(
        Schema.Array(MdEarsRequirementSchema),
        value,
        "Embedded block 'ears_requirements' validation failed"
      )
    case "invariants":
      return decodeUnknown(
        Schema.Array(MdInvariantSchema),
        value,
        "Embedded block 'invariants' validation failed"
      )
    case "verification":
      return decodeUnknown(
        Schema.Array(MdVerificationSchema),
        value,
        "Embedded block 'verification' validation failed"
      )
    case "interfaces":
      return decodeUnknown(
        Schema.Array(MdInterfaceSchema),
        value,
        "Embedded block 'interfaces' validation failed"
      )
    case "failure_modes":
      return decodeUnknown(
        Schema.Array(MdFailureModeSchema),
        value,
        "Embedded block 'failure_modes' validation failed"
      )
    case "acceptance_criteria":
      return decodeUnknown(
        Schema.Array(MdAcceptanceCriterionSchema),
        value,
        "Embedded block 'acceptance_criteria' validation failed"
      )
  }
}

const parseEmbeddedBlocks = (body: string): ParseEither<MdEmbeddedBlocks> => {
  const yamlBlocksResult = extractYamlBlocks(body)
  if (Either.isLeft(yamlBlocksResult)) {
    return Either.left(yamlBlocksResult.left)
  }

  const mergedBlocks: Partial<Record<EmbeddedBlockKey, readonly unknown[]>> = {}

  for (const rawBlock of yamlBlocksResult.right) {
    const parsedBlockResult = parseYamlRecord(rawBlock, "Embedded YAML block")
    if (Either.isLeft(parsedBlockResult)) {
      return Either.left(parsedBlockResult.left)
    }

    for (const [key, value] of Object.entries(parsedBlockResult.right)) {
      if (!EMBEDDED_BLOCK_KEYS.has(key as EmbeddedBlockKey)) {
        continue
      }

      const typedKey = key as EmbeddedBlockKey
      const decodedEntriesResult = decodeEmbeddedBlockEntries(typedKey, value)
      if (Either.isLeft(decodedEntriesResult)) {
        return Either.left(decodedEntriesResult.left)
      }

      if (typedKey === "ears_requirements") {
        const earsValidationErrors = validateEarsRequirements(decodedEntriesResult.right)
        if (earsValidationErrors.length > 0) {
          return Either.left(
            new MdDocParseError({
              reason: `Embedded block 'ears_requirements' semantic validation failed: ${formatEarsValidationErrors(earsValidationErrors)}`,
            })
          )
        }
      }

      mergeEmbeddedBlock(mergedBlocks, typedKey, decodedEntriesResult.right)
    }
  }

  return decodeUnknown(MdEmbeddedBlocksSchema, mergedBlocks, "Embedded blocks validation failed")
}

const extractSections = (body: string): ParseEither<readonly MdSection[]> => {
  const lines = body.split(/\r?\n/)
  const sections: Array<{ heading: string; body: string }> = []
  let inFence = false
  let currentHeading: string | null = null
  let sectionBodyLines: string[] = []

  const flushSection = (): void => {
    if (currentHeading === null) {
      return
    }
    sections.push({
      heading: currentHeading,
      body: sectionBodyLines.join("\n").trim(),
    })
    currentHeading = null
    sectionBodyLines = []
  }

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      if (currentHeading !== null) {
        sectionBodyLines.push(line)
      }
      continue
    }

    if (!inFence) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/)
      if (headingMatch) {
        flushSection()
        currentHeading = headingMatch[2]!.replace(/\s+#+\s*$/, "").trim()
        continue
      }
    }

    if (currentHeading !== null) {
      sectionBodyLines.push(line)
    }
  }

  flushSection()

  return decodeUnknown(Schema.Array(MdSectionSchema), sections, "Section extraction validation failed")
}

const parseFrontmatterByKind = (
  rawFrontmatter: Record<string, unknown>
): ParseEither<
  | { kind: "spec"; frontmatter: MdFrontmatter }
  | { kind: "task"; frontmatter: Record<string, unknown> }
> => {
  const kind = rawFrontmatter.kind

  if (kind === "spec") {
    const decodedFrontmatter = decodeUnknown(
      MdFrontmatterSchema,
      rawFrontmatter,
      "Frontmatter validation failed"
    )
    if (Either.isLeft(decodedFrontmatter)) {
      return Either.left(decodedFrontmatter.left)
    }
    return Either.right({ kind: "spec", frontmatter: decodedFrontmatter.right })
  }

  if (kind === "task") {
    return Either.right({ kind: "task", frontmatter: rawFrontmatter })
  }

  return Either.left(
    new MdDocParseError({
      reason: "Frontmatter 'kind' must be either 'spec' or 'task'.",
    })
  )
}

export const parseMdDocSync = (content: string): ParseEither<MdParsedDoc> => {
  const frontmatterSplit = splitFrontmatter(content)
  if (Either.isLeft(frontmatterSplit)) {
    return Either.left(frontmatterSplit.left)
  }

  const rawFrontmatterResult = parseYamlRecord(frontmatterSplit.right.frontmatter, "Frontmatter")
  if (Either.isLeft(rawFrontmatterResult)) {
    return Either.left(rawFrontmatterResult.left)
  }

  const parsedFrontmatterResult = parseFrontmatterByKind(rawFrontmatterResult.right)
  if (Either.isLeft(parsedFrontmatterResult)) {
    return Either.left(parsedFrontmatterResult.left)
  }

  const sectionsResult = extractSections(frontmatterSplit.right.body)
  if (Either.isLeft(sectionsResult)) {
    return Either.left(sectionsResult.left)
  }

  const blocksResult = parseEmbeddedBlocks(frontmatterSplit.right.body)
  if (Either.isLeft(blocksResult)) {
    return Either.left(blocksResult.left)
  }

  if (parsedFrontmatterResult.right.kind === "spec") {
    // Required sections are NOT validated here. They are configurable per spec
    // type and checked by `tx spec lint` (see utils/spec-section-lint.ts), so a
    // missing heading never blocks doc add/update/sync or drift detection.
    return decodeUnknown(
      MdParsedDocSchema,
      {
        kind: "spec",
        frontmatter: parsedFrontmatterResult.right.frontmatter,
        sections: sectionsResult.right,
        blocks: blocksResult.right,
      },
      "Parsed spec document validation failed"
    )
  }

  return decodeUnknown(
    MdParsedDocSchema,
    {
      kind: "task",
      frontmatter: parsedFrontmatterResult.right.frontmatter,
      sections: sectionsResult.right,
      blocks: blocksResult.right,
    },
    "Parsed task document validation failed"
  )
}

export const parseMdDoc = (
  content: string
): Effect.Effect<MdParsedDoc, MdDocParseError> => {
  const parsed = parseMdDocSync(content)
  return Either.isLeft(parsed)
    ? Effect.fail(parsed.left)
    : Effect.succeed(parsed.right)
}
