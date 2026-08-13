/**
 * Required-section linting for markdown specs.
 *
 * Sections used to be enforced inside the parser, which made a missing heading a
 * hard failure for `tx doc add/update/sync/render` and even for drift detection.
 * They are now lint-only: docs always parse, and `tx spec lint` reports missing
 * sections at the severity configured for that spec type.
 */
import type { MdParsedDoc } from "../types/doc.js"
import {
  renderLintMessage,
  type SpecTypeRegistry,
} from "./spec-type-registry.js"

export type SectionLintRule = "missing_section" | "unknown_spec_type"

export type SectionLintFinding = {
  readonly rule: SectionLintRule
  readonly severity: "error" | "warn"
  readonly specType: string
  /** Heading that is missing. Absent for `unknown_spec_type`. */
  readonly section?: string
  readonly message: string
}

export type SectionLintContext = {
  readonly docName: string
  readonly filePath?: string
}

const normalizeHeading = (heading: string): string => heading.trim().toLowerCase()

/**
 * Check a parsed spec doc against its configured sections.
 * Returns one finding per missing section so each can carry its own prompt.
 */
export const lintSpecSections = (
  parsed: MdParsedDoc,
  registry: SpecTypeRegistry,
  ctx: SectionLintContext
): readonly SectionLintFinding[] => {
  if (parsed.kind !== "spec") return []

  const specType = parsed.frontmatter.spec_type
  const definition = registry.types.get(specType)

  if (!definition) {
    return [
      {
        rule: "unknown_spec_type",
        severity: "warn",
        specType,
        message: renderLintMessage(registry.messages.unknownSpecType, {
          name: ctx.docName,
          spec_type: specType,
          file: ctx.filePath ?? "",
          description: "",
          section: "",
        }),
      },
    ]
  }

  if (definition.severity === "off" || definition.sections.length === 0) return []

  const present = new Set(parsed.sections.map((section) => normalizeHeading(section.heading)))

  return definition.sections
    .filter((section) => !present.has(normalizeHeading(section.heading)))
    .map((section) => ({
      rule: "missing_section" as const,
      severity: definition.severity === "warn" ? ("warn" as const) : ("error" as const),
      specType,
      section: section.heading,
      message: renderLintMessage(section.message, {
        name: ctx.docName,
        spec_type: specType,
        section: section.heading,
        description: section.description,
        file: ctx.filePath ?? "",
      }),
    }))
}
