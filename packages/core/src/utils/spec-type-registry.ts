/**
 * Resolve the effective spec-type registry from tx config.
 *
 * Spec structure is user-configurable: required markdown sections, their
 * descriptions, per-section lint prompts, subdirectories, and entirely new spec
 * types all come from `[spec.types.*]` in `.tx/config.toml`.
 *
 * What is NOT configurable (because tx functionality depends on it) is the
 * frontmatter contract (`MdFrontmatterSchema`) and the embedded yaml block
 * schemas (`ears_requirements` with REQ-* ids, `invariants` with INV-* ids,
 * `verification`, `interfaces`, `failure_modes`, `acceptance_criteria`). Those
 * blocks are located by fence + top-level key anywhere in the body, so renaming
 * or removing a heading never breaks `tx spec discover` or FCI scoring.
 */
import { MD_REQUIRED_SECTIONS_BY_SPEC_TYPE } from "../types/doc.js"
import {
  DEFAULT_MISSING_SECTION_MESSAGE,
  DEFAULT_UNKNOWN_SPEC_TYPE_MESSAGE,
  type SpecSectionSeverity,
  type TxConfig,
} from "./toml-config.js"

export type SpecSectionDefinition = {
  readonly slug: string
  readonly heading: string
  /** What belongs under this heading. Empty string when not configured. */
  readonly description: string
  /** Resolved missing-section prompt: per-section ?? global ?? built-in. */
  readonly message: string
}

export type SpecTypeDefinition = {
  readonly name: string
  readonly builtin: boolean
  readonly sections: readonly SpecSectionDefinition[]
  readonly severity: SpecSectionSeverity
  /** Subdirectory under the docs root. `""` means the docs root itself. */
  readonly subdir: string
  readonly templatePath: string | null
  /** True when a built-in type's sections differ from tx defaults. */
  readonly sectionsCustomized: boolean
}

export type SpecLintMessages = {
  readonly missingSection: string
  readonly unknownSpecType: string
}

export type SpecTypeRegistry = {
  readonly types: ReadonlyMap<string, SpecTypeDefinition>
  readonly messages: SpecLintMessages
  /** Advisory config warnings surfaced by `tx spec lint` and `tx spec types`. */
  readonly warnings: readonly string[]
}

/**
 * Legacy doc kinds that predate markdown-first specs. They are never authored
 * via config but must stay resolvable so path/kind lookups keep working.
 */
const LEGACY_TYPE_SUBDIRS: Record<string, string> = {
  requirement: "requirements",
  system_design: "system-design",
}

/**
 * Sections whose yaml blocks feed tx's spec machinery. Dropping one does not
 * break discovery (blocks are found anywhere in the body) but it does stop
 * agents being told to write the block, so it earns an advisory warning.
 */
const BLOCK_BEARING_SECTIONS: Record<string, readonly string[]> = {
  design: ["Invariants", "Verification"],
  prd: ["Requirements"],
}

/** Substitute {placeholders}; unknown keys are left untouched. */
export const renderLintMessage = (
  template: string,
  vars: Record<string, string>
): string => template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match)

const normalizeHeadingKey = (heading: string): string => heading.trim().toLowerCase()

const defaultSubdirFor = (typeName: string): string =>
  LEGACY_TYPE_SUBDIRS[typeName] ?? (typeName === "overview" ? "" : typeName)

/** Build the effective registry from config. Pure, so it is safe to call anywhere. */
export const resolveSpecTypes = (config: TxConfig): SpecTypeRegistry => {
  const messages: SpecLintMessages = {
    missingSection: config.spec.lintMessages.missing_section ?? DEFAULT_MISSING_SECTION_MESSAGE,
    unknownSpecType: config.spec.lintMessages.unknown_spec_type ?? DEFAULT_UNKNOWN_SPEC_TYPE_MESSAGE,
  }

  const types = new Map<string, SpecTypeDefinition>()
  const warnings: string[] = []

  for (const [name, typeConfig] of Object.entries(config.spec.types)) {
    const builtinSections = MD_REQUIRED_SECTIONS_BY_SPEC_TYPE[
      name as keyof typeof MD_REQUIRED_SECTIONS_BY_SPEC_TYPE
    ] as readonly string[] | undefined
    const builtin = builtinSections !== undefined

    const sections = typeConfig.sections.map((section) => ({
      slug: section.slug,
      heading: section.heading,
      description: section.description,
      message: section.message ?? messages.missingSection,
    }))

    const sectionsCustomized =
      builtin &&
      (sections.length !== builtinSections.length ||
        sections.some(
          (section, index) =>
            normalizeHeadingKey(section.heading) !==
            normalizeHeadingKey(builtinSections[index]!)
        ))

    types.set(name, {
      name,
      builtin,
      sections,
      severity: typeConfig.severity,
      subdir: typeConfig.subdir ?? defaultSubdirFor(name),
      templatePath: typeConfig.template,
      sectionsCustomized,
    })

    const blockBearing = BLOCK_BEARING_SECTIONS[name]
    if (blockBearing) {
      const present = new Set(sections.map((section) => normalizeHeadingKey(section.heading)))
      for (const required of blockBearing) {
        if (!present.has(normalizeHeadingKey(required))) {
          warnings.push(
            `spec.types.${name}: '${required}' section removed. Embedded yaml blocks are still discovered anywhere in the body, but agents are no longer told to write them, so spec coverage may drop.`
          )
        }
      }
    }
  }

  // Legacy kinds are not config-authored but must remain resolvable.
  for (const [name, subdir] of Object.entries(LEGACY_TYPE_SUBDIRS)) {
    if (types.has(name)) continue
    types.set(name, {
      name,
      builtin: true,
      sections: [],
      severity: "off",
      subdir,
      templatePath: null,
      sectionsCustomized: false,
    })
  }

  return { types, messages, warnings }
}

/** Subdirectory for a spec type, falling back to conventions for unknown types. */
export const specTypeSubdir = (registry: SpecTypeRegistry, typeName: string): string =>
  registry.types.get(typeName)?.subdir ?? defaultSubdirFor(typeName)

/** Sorted list of configured type names, for error messages and CLI output. */
export const specTypeNames = (registry: SpecTypeRegistry): string[] =>
  [...registry.types.keys()].sort()
