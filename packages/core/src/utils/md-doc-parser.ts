import { Data, Effect, Either, Schema } from "effect"
import { parse as parseYaml } from "yaml"
import {
  MD_REQUIRED_SECTIONS_BY_SPEC_TYPE,
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
} from "@jamesaphoenix/tx-types"
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

const decodeUnknown = <A>(
  schema: Schema.Schema<A, unknown, never>,
  input: unknown,
  context: string
): Either.Either<A, MdDocParseError> => {
  const decoded = Schema.decodeUnknownEither(schema)(input)
  if (Either.isLeft(decoded)) {
    return Either.left(
      new MdDocParseError({ reason: `${context}: ${formatDecodeError(decoded.left)}` })
    )
  }
  return decoded
}

const splitFrontmatter = (
  content: string
): Either.Either<{ frontmatter: string; body: string }, MdDocParseError> => {
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
): Either.Either<Record<string, unknown>, MdDocParseError> => {
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

const extractYamlBlocks = (body: string): Either.Either<string[], MdDocParseError> => {
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
    return Either.left(
      new MdDocParseError({ reason: "Unclosed fenced YAML block detected." })
    )
  }

  return Either.right(blocks)
}

const mergeEmbeddedBlock = (
  accumulator: Partial<Record<EmbeddedBlockKey, unknown[]>>,
  key: EmbeddedBlockKey,
  entries: unknown[]
): void => {
  const existing = accumulator[key] ?? []
  accumulator[key] = [...existing, ...entries]
}

const decodeEmbeddedBlockEntries = (
  key: EmbeddedBlockKey,
  value: unknown
): Either.Either<unknown[], MdDocParseError> => {
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

const parseEmbeddedBlocks = (body: string): Either.Either<MdEmbeddedBlocks, MdDocParseError> => {
  const yamlBlocksResult = extractYamlBlocks(body)
  if (Either.isLeft(yamlBlocksResult)) {
    return yamlBlocksResult
  }

  const mergedBlocks: Partial<Record<EmbeddedBlockKey, unknown[]>> = {}

  for (const rawBlock of yamlBlocksResult.right) {
    const parsedBlockResult = parseYamlRecord(rawBlock, "Embedded YAML block")
    if (Either.isLeft(parsedBlockResult)) {
      return parsedBlockResult
    }

    const parsedBlock = parsedBlockResult.right
    for (const [key, value] of Object.entries(parsedBlock)) {
      if (!EMBEDDED_BLOCK_KEYS.has(key as EmbeddedBlockKey)) {
        continue
      }

      const typedKey = key as EmbeddedBlockKey
      const decodedEntriesResult = decodeEmbeddedBlockEntries(typedKey, value)
      if (Either.isLeft(decodedEntriesResult)) {
        return decodedEntriesResult
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

const extractSections = (body: string): Either.Either<MdSection[], MdDocParseError> => {
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

const normalizeHeading = (heading: string): string => heading.trim().toLowerCase()

const validateRequiredSections = (
  frontmatter: MdFrontmatter,
  sections: readonly MdSection[]
): Either.Either<void, MdDocParseError> => {
  const requiredSections = MD_REQUIRED_SECTIONS_BY_SPEC_TYPE[frontmatter.spec_type]
  const present = new Set(sections.map((section) => normalizeHeading(section.heading)))
  const missing = requiredSections.filter(
    (requiredHeading) => !present.has(normalizeHeading(requiredHeading))
  )

  if (missing.length > 0) {
    return Either.left(
      new MdDocParseError({
        reason: `Missing required section(s) for spec_type '${frontmatter.spec_type}': ${missing.join(", ")}`,
      })
    )
  }

  return Either.right(undefined)
}

const parseFrontmatterByKind = (
  rawFrontmatter: Record<string, unknown>
): Either.Either<
  | { kind: "spec"; frontmatter: MdFrontmatter }
  | { kind: "task"; frontmatter: Record<string, unknown> },
  MdDocParseError
> => {
  const kind = rawFrontmatter.kind

  if (kind === "spec") {
    const decodedFrontmatter = decodeUnknown(
      MdFrontmatterSchema,
      rawFrontmatter,
      "Frontmatter validation failed"
    )
    if (Either.isLeft(decodedFrontmatter)) {
      return decodedFrontmatter
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

export const parseMdDocSync = (content: string): Either.Either<MdParsedDoc, MdDocParseError> => {
  const frontmatterSplit = splitFrontmatter(content)
  if (Either.isLeft(frontmatterSplit)) {
    return frontmatterSplit
  }

  const rawFrontmatterResult = parseYamlRecord(frontmatterSplit.right.frontmatter, "Frontmatter")
  if (Either.isLeft(rawFrontmatterResult)) {
    return rawFrontmatterResult
  }

  const parsedFrontmatterResult = parseFrontmatterByKind(rawFrontmatterResult.right)
  if (Either.isLeft(parsedFrontmatterResult)) {
    return parsedFrontmatterResult
  }

  const sectionsResult = extractSections(frontmatterSplit.right.body)
  if (Either.isLeft(sectionsResult)) {
    return sectionsResult
  }

  const blocksResult = parseEmbeddedBlocks(frontmatterSplit.right.body)
  if (Either.isLeft(blocksResult)) {
    return blocksResult
  }

  if (parsedFrontmatterResult.right.kind === "spec") {
    const sectionValidation = validateRequiredSections(
      parsedFrontmatterResult.right.frontmatter,
      sectionsResult.right
    )
    if (Either.isLeft(sectionValidation)) {
      return sectionValidation
    }

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
): Effect.Effect<MdParsedDoc, MdDocParseError> => Effect.fromEither(parseMdDocSync(content))
