/**
 * DocService — business logic for docs-as-primitives (DD-023).
 *
 * Manages doc lifecycle (create/update/lock/version), markdown validation,
 * linking (doc-doc, task-doc), invariant sync, drift detection, and graph data.
 *
 * Markdown content lives on disk (specs/); DB stores metadata + links only.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from "node:fs"
import { resolve, dirname, join } from "node:path"
import { Cause, Context, Effect, Either, Layer, Option, Schema } from "effect"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { DocRepository } from "../repo/doc-repo.js"
import {
  ValidationError,
  DocNotFoundError,
  DocLockedError,
  InvalidDocYamlError,
  InvariantNotFoundError,
} from "../errors.js"
import type { DatabaseError } from "../errors.js"
import { computeDocHash } from "../utils/doc-hash.js"
import { renderIndexToMarkdown } from "../utils/doc-renderer.js"
import {
  formatEarsValidationErrors,
  validateEarsRequirements,
} from "../utils/ears-validator.js"
import { parseMdDocSync, MdDocParseError } from "../utils/md-doc-parser.js"
import { readTxConfig } from "../utils/toml-config.js"
import { resolvePathWithin } from "../utils/file-path.js"
import {
  DOC_KINDS,
  DOC_CONTENT_SCHEMAS,
  EARS_PATTERNS,
  renderEarsRule,
} from "@jamesaphoenix/tx-types"
import type {
  Doc,
  DocLink,
  Invariant,
  InvariantCheck,
  DocKind,
  DocLinkType,
  TaskDocLinkType,
  DocGraph,
  DocGraphNode,
  DocGraphEdge,
  EarsPattern,
} from "@jamesaphoenix/tx-types"

// Local string arrays for .includes() (avoids readonly cast)
const docKindStrings: readonly string[] = DOC_KINDS

/** Infer link type from doc kinds (from → to). */
const inferLinkType = (
  fromKind: DocKind,
  toKind: DocKind
): DocLinkType | null => {
  if (fromKind === "overview" && toKind === "prd") return "overview_to_prd"
  if (fromKind === "overview" && toKind === "design")
    return "overview_to_design"
  if (fromKind === "prd" && toKind === "design") return "prd_to_design"
  if (fromKind === "requirement" && toKind === "prd") return "requirement_to_prd"
  if (fromKind === "requirement" && toKind === "design") return "requirement_to_design"
  if (fromKind === "system_design" && toKind === "design") return "system_design_to_design"
  if (fromKind === "system_design" && toKind === "prd") return "system_design_to_prd"
  return null
}

/** Get the subdirectory for a doc kind. overview lives at root. */
const kindSubdir = (kind: DocKind): string => {
  if (kind === "overview") return ""
  if (kind === "requirement") return "requirements"
  if (kind === "system_design") return "system-design"
  return kind
}

/** Resolve the markdown file path for a doc. */
const resolveDocPath = (
  docsPath: string,
  kind: DocKind,
  name: string
): string => {
  const sub = kindSubdir(kind)
  const relativeDocPath = sub ? join(sub, `${name}.md`) : `${name}.md`
  const resolvedDocPath = resolvePathWithin(docsPath, relativeDocPath, {
    useRealpath: true,
  })
  if (!resolvedDocPath) {
    throw new ValidationError({
      reason: `Invalid doc path for name '${name}'`,
    })
  }
  return resolvedDocPath
}

const parseSpecTypeAsDocKind = (name: string, specType: string): DocKind => {
  if (!docKindStrings.includes(specType)) {
    throw new InvalidDocYamlError({
      name,
      reason: `Unsupported spec_type '${specType}' for docs service.`,
    })
  }
  return specType as DocKind
}

const collectLegacyRequirements = (value: unknown): string[] => {
  const normalize = (item: string): string | null => {
    const stripped = item
      .trim()
      .replace(/^[-*]\s+/, "")
      .replace(/^\d+\.\s+/, "")
      .trim()
    return stripped.length > 0 ? stripped : null
  }

  if (Array.isArray(value)) {
    const out: string[] = []
    for (const item of value) {
      if (typeof item !== "string") continue
      const normalized = normalize(item)
      if (!normalized) continue
      out.push(normalized)
    }
    return out
  }

  if (typeof value === "string") {
    const out: string[] = []
    for (const line of value.split(/\r?\n/)) {
      const normalized = normalize(line)
      if (!normalized) continue
      out.push(normalized)
    }
    return out
  }

  return []
}

/** EARS is a hard requirement for PRDs — not configurable. */
const isEarsRequiredForLegacyPrds = (): boolean => true

type YamlValidationResult = {
  parsed: Record<string, unknown>
  warnings: string[]
}

type ValidateYamlOptions = {
  enforceContentSchema?: boolean
}

const nullableYamlStringKeys = new Set<string>([
  "name",
  "title",
  "problem_definition",
  "subsystems",
  "object_model",
  "user_specific_content",
  "problem",
  "solution",
  "overview",
  "scope",
  "design",
  "architecture",
  "data_model",
  "open_questions",
  "functional_requirements",
  "id",
  "statement",
  "category",
  "rationale",
  "condition",
  "impact",
  "handling",
  "expected_behavior",
  "description",
  "actor",
  "trigger",
  "outcome",
  "target",
  "reason",
  "decision",
  "consequence",
  "requirement_id",
  "verification",
  "success_criteria",
  "system",
  "response",
  "feature",
  "state",
  "test_hint",
  "constraints",
  "acceptance_criteria",
  "non_goals",
  "requirements",
  "out_of_scope",
  "goals",
  "non_functional_requirements",
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const normalizeNullYamlStrings = (
  value: unknown,
  currentKey?: string
): unknown => {
  if (value === null) {
    return currentKey && nullableYamlStringKeys.has(currentKey) ? "" : value
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeNullYamlStrings(item, currentKey))
  }

  if (!isRecord(value)) {
    return value
  }

  const normalized: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    normalized[key] = normalizeNullYamlStrings(entry, key)
  }
  return normalized
}

const normalizeLegacyEarsRequirements = (
  parsed: Record<string, unknown>
): void => {
  const raw = parsed.ears_requirements
  if (!Array.isArray(raw)) return

  for (const entry of raw) {
    if (!isRecord(entry)) continue

    if (typeof entry.statement === "string" && entry.statement.trim().length > 0) {
      continue
    }

    const patternValue = entry.pattern
    const systemValue = entry.system
    const responseValue = entry.response
    if (
      typeof patternValue !== "string" ||
      !EARS_PATTERNS.includes(patternValue as EarsPattern) ||
      typeof systemValue !== "string" ||
      typeof responseValue !== "string"
    ) {
      continue
    }

    entry.statement = renderEarsRule({
      pattern: patternValue as EarsPattern,
      system: systemValue,
      response: responseValue,
      trigger: typeof entry.trigger === "string" ? entry.trigger : undefined,
      state: typeof entry.state === "string" ? entry.state : undefined,
      condition: typeof entry.condition === "string" ? entry.condition : undefined,
      feature: typeof entry.feature === "string" ? entry.feature : undefined,
    })
  }
}

const normalizeForSchemaValidation = (
  kind: DocKind,
  parsed: Record<string, unknown>
): Record<string, unknown> => {
  const normalized = normalizeNullYamlStrings(parsed) as Record<string, unknown>
  if (kind === "prd" || kind === "requirement") {
    normalizeLegacyEarsRequirements(normalized)
  }
  return normalized
}

const collectSchemaWarnings = (
  kind: DocKind | null | undefined,
  parsed: Record<string, unknown>
): string[] => {
  if (kind !== "prd") return []

  const warnings: string[] = []
  if (parsed.requirements !== undefined) {
    warnings.push(
      "Deprecated field 'requirements' detected in PRD YAML; use 'ears_requirements' instead."
    )
  }
  if (parsed.out_of_scope !== undefined) {
    warnings.push(
      "Deprecated field 'out_of_scope' detected in PRD YAML; use 'non_goals' instead."
    )
  }
  return warnings
}

/** Validate YAML content and return parsed object. */
const validateYaml = (
  name: string,
  content: string,
  expectedKind?: DocKind,
  options?: ValidateYamlOptions
): YamlValidationResult => {
  const enforceContentSchema = options?.enforceContentSchema === true
  let parsed: unknown
  try {
    parsed = parseYaml(content)
  } catch (e) {
    throw new InvalidDocYamlError({
      name,
      reason: `YAML parse error: ${String(e)}`,
    })
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new InvalidDocYamlError({
      name,
      reason: "YAML must be an object (not array or scalar)",
    })
  }
  const parsedObject = parsed as Record<string, unknown>
  const yamlKind =
    typeof parsedObject.kind === "string" && docKindStrings.includes(parsedObject.kind)
      ? (parsedObject.kind as DocKind)
      : null
  const effectiveKind = expectedKind ?? yamlKind
  const warnings = collectSchemaWarnings(effectiveKind, parsedObject)

  if (enforceContentSchema && effectiveKind && effectiveKind in DOC_CONTENT_SCHEMAS) {
    const contentSchema = DOC_CONTENT_SCHEMAS[
      effectiveKind as keyof typeof DOC_CONTENT_SCHEMAS
    ] as Schema.Schema<unknown, unknown, never>
    const normalizedForDecode = normalizeForSchemaValidation(
      effectiveKind,
      parsedObject
    )
    const decoded = Schema.decodeUnknownEither(contentSchema)(normalizedForDecode)
    if (Either.isLeft(decoded)) {
      const detail =
        typeof decoded.left === "object" &&
        decoded.left !== null &&
        "message" in decoded.left &&
        typeof decoded.left.message === "string"
          ? decoded.left.message
          : String(decoded.left)

      throw new InvalidDocYamlError({
        name,
        reason: `YAML schema validation failed for kind '${effectiveKind}': ${detail}`,
      })
    }
  }

  if (effectiveKind === "prd" && parsedObject.ears_requirements !== undefined) {
    if (!Array.isArray(parsedObject.ears_requirements)) {
      throw new InvalidDocYamlError({
        name,
        reason: "EARS: 'ears_requirements' must be an array",
      })
    }
    const errors = validateEarsRequirements(parsedObject.ears_requirements)
    if (errors.length > 0) {
      throw new InvalidDocYamlError({
        name,
        reason: `EARS: ${formatEarsValidationErrors(errors)}`,
        earsErrors: errors,
      })
    }
  }

  if (
    effectiveKind === "prd" &&
    isEarsRequiredForLegacyPrds() &&
    collectLegacyRequirements(parsedObject.requirements).length > 0 &&
    (!Array.isArray(parsedObject.ears_requirements) ||
      parsedObject.ears_requirements.length === 0)
  ) {
    throw new InvalidDocYamlError({
      name,
      reason:
        "EARS: PRDs with legacy 'requirements' must also define a non-empty " +
        "'ears_requirements' array. EARS-structured requirements are mandatory for all PRDs.",
      })
  }

  return { parsed: parsedObject, warnings }
}

/** Validate doc kind from YAML. */
const validateKind = (
  name: string,
  parsed: Record<string, unknown>,
  expectedKind: DocKind
): void => {
  const yamlKind = parsed.kind
  if (yamlKind && typeof yamlKind === "string" && yamlKind !== expectedKind) {
    throw new InvalidDocYamlError({
      name,
      reason: `YAML kind '${yamlKind}' does not match expected kind '${expectedKind}'`,
    })
  }
}

type InvariantCandidate = {
  id: string
  rule: string
  enforcement: string
  subsystem?: string | null
  testRef?: string | null
  lintRule?: string | null
  promptRef?: string | null
  source?: string
  sourceRef?: string | null
  // EARS fields
  pattern?: string | null
  triggerText?: string | null
  stateText?: string | null
  conditionText?: string | null
  feature?: string | null
  systemName?: string | null
  response?: string | null
  rationale?: string | null
  testHint?: string | null
};

const mapInvariantSeverityToEnforcement = (
  _severity: string | undefined
): string => {
  return "integration_test"
}

const mapMdEarsKindToLegacyPattern = (kind: string): EarsPattern => {
  switch (kind) {
    case "event-driven":
      return "event_driven"
    case "state-driven":
      return "state_driven"
    case "unwanted":
      return "unwanted"
    case "optional":
      return "optional"
    case "complex":
      return "complex"
    default:
      return "ubiquitous"
  }
}

const deriveEmbeddedInvariantCandidates = (
  doc: Doc,
  rawInvariants:
    | readonly {
        id: string
        statement: string
        severity: string
        verified_by: readonly string[]
      }[]
    | undefined
): InvariantCandidate[] => {
  if (!rawInvariants || rawInvariants.length === 0) return []

  return rawInvariants.map((inv) => ({
    id: inv.id,
    rule: inv.statement,
    enforcement: mapInvariantSeverityToEnforcement(inv.severity),
    subsystem: doc.kind,
    testRef: inv.verified_by[0] ?? null,
    source: "explicit",
    sourceRef: "blocks.invariants",
  }))
}

const deriveEmbeddedEarsInvariantCandidates = (
  doc: Doc,
  rawRequirements:
    | readonly {
        id: string
        kind: string
        statement: string
        when?: string
        while?: string
        if?: string
        where?: string
        rationale?: string
      }[]
    | undefined
): InvariantCandidate[] => {
  if (!rawRequirements || rawRequirements.length === 0) return []

  return rawRequirements.map((req) => ({
    id: `INV-${req.id}`,
    rule: req.statement,
    enforcement: "integration_test",
    subsystem: doc.kind,
    source: "explicit",
    sourceRef: "blocks.ears_requirements",
    pattern: mapMdEarsKindToLegacyPattern(req.kind),
    triggerText: req.when ?? null,
    stateText: req.while ?? null,
    conditionText: req.if ?? null,
    feature: req.where ?? null,
    rationale: req.rationale ?? null,
  }))
}

export class DocService extends Context.Tag("DocService")<
  DocService,
  {
    create: (input: {
      kind: DocKind
      name: string
      title: string
      content: string
      metadata?: Record<string, unknown>
    }) => Effect.Effect<Doc, ValidationError | InvalidDocYamlError | DatabaseError>
    get: (
      name: string,
      version?: number
    ) => Effect.Effect<Doc, DocNotFoundError | DatabaseError>
    update: (
      name: string,
      content: string
    ) => Effect.Effect<Doc, DocNotFoundError | DocLockedError | InvalidDocYamlError | DatabaseError>
    lock: (name: string) => Effect.Effect<Doc, DocNotFoundError | DatabaseError>
    list: (filter?: {
      kind?: string
      status?: string
    }) => Effect.Effect<Doc[], DatabaseError>
    remove: (
      name: string
    ) => Effect.Effect<void, DocNotFoundError | DocLockedError | DatabaseError>
    render: (
      name?: string
    ) => Effect.Effect<string[], DocNotFoundError | DatabaseError>
    createVersion: (
      name: string
    ) => Effect.Effect<Doc, DocNotFoundError | ValidationError | DatabaseError>
    linkDocs: (
      fromName: string,
      toName: string,
      linkType?: DocLinkType
    ) => Effect.Effect<DocLink, DocNotFoundError | ValidationError | DatabaseError>
    attachTask: (
      taskId: string,
      docName: string,
      linkType?: TaskDocLinkType
    ) => Effect.Effect<void, DocNotFoundError | DatabaseError>
    createPatch: (
      designName: string,
      patchName: string,
      patchTitle: string
    ) => Effect.Effect<Doc, DocNotFoundError | ValidationError | DatabaseError>
    validate: () => Effect.Effect<string[], DatabaseError>
    detectDrift: (
      name: string
    ) => Effect.Effect<string[], DocNotFoundError | DatabaseError>
    generateIndex: () => Effect.Effect<void, DatabaseError>
    syncInvariants: (
      docName?: string
    ) => Effect.Effect<Invariant[], DocNotFoundError | DatabaseError>
    listInvariants: (filter?: {
      subsystem?: string
      enforcement?: string
    }) => Effect.Effect<Invariant[], DatabaseError>
    recordInvariantCheck: (
      id: string,
      passed: boolean,
      details?: string | null,
      durationMs?: number | null
    ) => Effect.Effect<InvariantCheck, InvariantNotFoundError | DatabaseError>
    getDocGraph: () => Effect.Effect<DocGraph, DatabaseError>
  }
>() {}

export const DocServiceLive = Layer.effect(
  DocService,
  Effect.gen(function* () {
    const docRepo = yield* DocRepository

    const getDocsPath = (): string => {
      const config = readTxConfig()
      return resolve(config.docs.path)
    }

    const ensureDir = (filePath: string): void => {
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }

    const parseMarkdownSpecDocContent = (name: string, content: string) => {
      const parsedResult = parseMdDocSync(content)
      if (Either.isLeft(parsedResult)) {
        const reason =
          parsedResult.left instanceof MdDocParseError
            ? parsedResult.left.reason
            : String(parsedResult.left)
        throw new InvalidDocYamlError({
          name,
          reason: `Markdown validation failed: ${reason}`,
        })
      }

      if (parsedResult.right.kind !== "spec") {
        throw new InvalidDocYamlError({
          name,
          reason: "Markdown docs managed by DocService must have frontmatter kind: spec.",
        })
      }

      return parsedResult.right
    }

    /** Validate a single markdown doc and return its canonical file path. */
    const validateDocFile = (doc: Doc, docsPath: string): string => {
      const docPath = resolveDocPath(docsPath, doc.kind, doc.name)
      if (!existsSync(docPath)) {
        throw new DocNotFoundError({ name: doc.name })
      }

      const content = readFileSync(docPath, "utf8")
      const parsed = parseMarkdownSpecDocContent(doc.name, content)
      const parsedKind = parseSpecTypeAsDocKind(doc.name, parsed.frontmatter.spec_type)

      if (parsed.frontmatter.name !== doc.name) {
        throw new InvalidDocYamlError({
          name: doc.name,
          reason: `Frontmatter name '${parsed.frontmatter.name}' does not match doc name '${doc.name}'.`,
        })
      }

      if (parsedKind !== doc.kind) {
        throw new InvalidDocYamlError({
          name: doc.name,
          reason: `Frontmatter spec_type '${parsed.frontmatter.spec_type}' does not match doc kind '${doc.kind}'.`,
        })
      }

      return docPath
    }

    /** Generate index.yml and index.md from all docs in DB. */
    function generateIndexEffect(docsPath: string) {
      return Effect.gen(function* () {
        const allDocs = yield* docRepo.findAll()
        const allLinks = yield* docRepo.getAllLinks()

        const overviewDoc = allDocs.find((d) => d.kind === "overview")
        const prds = allDocs
          .filter((d) => d.kind === "prd")
          .map((d) => ({ name: d.name, title: d.title, status: d.status }))

        const requirementDocs = allDocs
          .filter((d) => d.kind === "requirement")
          .map((d) => ({ name: d.name, title: d.title, status: d.status }))

        const designDocs = allDocs
          .filter((d) => d.kind === "design")
          .map((d) => {
            const implLink = allLinks.find(
              (l) =>
                l.toDocId === d.id && l.linkType === "prd_to_design"
            )
            const implDoc = implLink
              ? allDocs.find((dd) => dd.id === implLink.fromDocId)
              : undefined
            return {
              name: d.name,
              title: d.title,
              status: d.status,
              implements: implDoc?.name,
            }
          })

        const systemDesignDocs = allDocs
          .filter((d) => d.kind === "system_design")
          .map((d) => ({ name: d.name, title: d.title, status: d.status }))

        const links = allLinks.map((l) => {
          const from = allDocs.find((d) => d.id === l.fromDocId)
          const to = allDocs.find((d) => d.id === l.toDocId)
          return {
            from: from?.name ?? String(l.fromDocId),
            to: to?.name ?? String(l.toDocId),
            type: l.linkType,
          }
        })

        // Invariant summary
        const allInvariants = yield* docRepo.findInvariants()
        const activeInvariants = allInvariants.filter(
          (i) => i.status === "active"
        )
        const byEnforcement: Record<string, number> = {}
        const bySubsystem: Record<string, number> = {}
        for (const inv of activeInvariants) {
          byEnforcement[inv.enforcement] =
            (byEnforcement[inv.enforcement] ?? 0) + 1
          const sub = inv.subsystem ?? "system"
          bySubsystem[sub] = (bySubsystem[sub] ?? 0) + 1
        }

        const indexData = {
          overview: overviewDoc?.name,
          requirements: requirementDocs,
          prds,
          design_docs: designDocs,
          system_designs: systemDesignDocs,
          links,
          invariant_summary:
            activeInvariants.length > 0
              ? {
                  total: activeInvariants.length,
                  by_enforcement: byEnforcement,
                  by_subsystem: bySubsystem,
                }
              : undefined,
        }

        // Write index.yml
        const indexYamlObj: Record<string, unknown> = {
          generated: true,
          generated_at: new Date().toISOString(),
        }
        if (indexData.overview) {
          indexYamlObj.overview = indexData.overview
        }
        if (requirementDocs.length > 0) {
          indexYamlObj.requirements = requirementDocs.map((r) => ({
            name: r.name,
            title: r.title,
            status: r.status,
          }))
        }
        if (prds.length > 0) {
          indexYamlObj.prds = prds.map((p) => ({
            name: p.name,
            title: p.title,
            status: p.status,
          }))
        }
        if (designDocs.length > 0) {
          indexYamlObj.design_docs = designDocs.map((dd) => {
            const entry: Record<string, string> = {
              name: dd.name,
              title: dd.title,
              status: dd.status,
            }
            if (dd.implements) entry.implements = dd.implements
            return entry
          })
        }
        if (systemDesignDocs.length > 0) {
          indexYamlObj.system_designs = systemDesignDocs.map((sd) => ({
            name: sd.name,
            title: sd.title,
            status: sd.status,
          }))
        }

        const indexYamlPath = resolve(docsPath, "index.yml")
        ensureDir(indexYamlPath)
        writeFileSync(indexYamlPath, stringifyYaml(indexYamlObj), "utf8")

        // Write index.md
        const indexMd = renderIndexToMarkdown(indexData)
        const indexMdPath = resolve(docsPath, "index.md")
        writeFileSync(indexMdPath, indexMd, "utf8")
      })
    }

    /** Sync invariants from a single markdown doc into DB. */
    function syncInvariantsForDoc(doc: Doc) {
      return Effect.gen(function* () {
        const docsPath = getDocsPath()
        const docPath = resolveDocPath(docsPath, doc.kind, doc.name)
        if (!existsSync(docPath)) {
          return []
        }
        const content = readFileSync(docPath, "utf8")
        const parsed = parseMarkdownSpecDocContent(doc.name, content)
        const parsedKind = parseSpecTypeAsDocKind(doc.name, parsed.frontmatter.spec_type)

        if (parsed.frontmatter.name !== doc.name) {
          throw new InvalidDocYamlError({
            name: doc.name,
            reason: `Frontmatter name '${parsed.frontmatter.name}' does not match doc name '${doc.name}'.`,
          })
        }

        if (parsedKind !== doc.kind) {
          throw new InvalidDocYamlError({
            name: doc.name,
            reason: `Frontmatter spec_type '${parsed.frontmatter.spec_type}' does not match doc kind '${doc.kind}'.`,
          })
        }

        const explicit = deriveEmbeddedInvariantCandidates(
          doc,
          parsed.blocks.invariants
        )
        const derived = deriveEmbeddedEarsInvariantCandidates(
          doc,
          parsed.blocks.ears_requirements
        )

        const candidates: InvariantCandidate[] = []
        const seen = new Set<string>()
        for (const candidate of [...explicit, ...derived]) {
          if (seen.has(candidate.id)) continue
          candidates.push(candidate)
          seen.add(candidate.id)
        }

        if (candidates.length === 0) {
          yield* docRepo.deprecateInvariantsNotIn(doc.id, [])
          return []
        }

        const synced: Invariant[] = []
        const activeIds: string[] = []
        for (const candidate of candidates) {
          const input = {
            id: candidate.id,
            rule: candidate.rule,
            enforcement: candidate.enforcement,
            docId: doc.id,
            subsystem: candidate.subsystem,
            testRef: candidate.testRef,
            lintRule: candidate.lintRule,
            promptRef: candidate.promptRef,
            source: candidate.source,
            sourceRef: candidate.sourceRef,
            // EARS fields
            pattern: candidate.pattern,
            triggerText: candidate.triggerText,
            stateText: candidate.stateText,
            conditionText: candidate.conditionText,
            feature: candidate.feature,
            systemName: candidate.systemName,
            response: candidate.response,
            rationale: candidate.rationale,
            testHint: candidate.testHint,
          }
          const result = yield* docRepo.upsertInvariant(input)
          synced.push(result)
          activeIds.push(candidate.id)
        }

        yield* docRepo.deprecateInvariantsNotIn(doc.id, activeIds)
        return synced
      })
    }

    return {
      create: (input) =>
        Effect.gen(function* () {
          const { kind, name, title, content, metadata } = input
          if (!docKindStrings.includes(kind)) {
            return yield* Effect.fail(
              new ValidationError({ reason: `Invalid doc kind: ${kind}` })
            )
          }
          if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Invalid doc name: ${name}. Use alphanumeric with dashes/dots.`,
              })
            )
          }
          const parsedDoc = parseMarkdownSpecDocContent(name, content)
          const frontmatter = parsedDoc.frontmatter
          const parsedKind = parseSpecTypeAsDocKind(name, frontmatter.spec_type)

          if (frontmatter.name !== name) {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Frontmatter name '${frontmatter.name}' does not match input name '${name}'.`,
              })
            )
          }

          if (frontmatter.title !== title) {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Frontmatter title '${frontmatter.title}' does not match input title '${title}'.`,
              })
            )
          }

          if (parsedKind !== kind) {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Frontmatter spec_type '${frontmatter.spec_type}' does not match input kind '${kind}'.`,
              })
            )
          }

          const existing = yield* docRepo.findByName(frontmatter.name)
          if (existing) {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Doc '${frontmatter.name}' already exists (v${existing.version})`,
              })
            )
          }

          const hash = computeDocHash(content)
          const docsPath = getDocsPath()
          const filePath = resolveDocPath(docsPath, parsedKind, frontmatter.name)
          ensureDir(filePath)
          writeFileSync(filePath, content, "utf8")

          const sub = kindSubdir(parsedKind)
          const relPath = sub
            ? join(sub, `${frontmatter.name}.md`)
            : `${frontmatter.name}.md`

          const doc = yield* docRepo.insert({
            hash,
            kind: parsedKind,
            name: frontmatter.name,
            title: frontmatter.title,
            version: 1,
            filePath: relPath,
            parentDocId: null,
            metadata: metadata ? JSON.stringify(metadata) : undefined,
          })

          yield* generateIndexEffect(docsPath)
          return doc
        }),

      get: (name, version?) =>
        Effect.gen(function* () {
          const doc = yield* docRepo.findByName(name, version)
          if (!doc) {
            return yield* Effect.fail(new DocNotFoundError({ name }))
          }
          return doc
        }),

      update: (name, content) =>
        Effect.gen(function* () {
          const doc = yield* docRepo.findByName(name)
          if (!doc) {
            return yield* Effect.fail(new DocNotFoundError({ name }))
          }
          if (doc.status === "locked") {
            return yield* Effect.fail(
              new DocLockedError({ name, version: doc.version })
            )
          }
          const parsedDoc = parseMarkdownSpecDocContent(name, content)
          const frontmatter = parsedDoc.frontmatter
          const parsedKind = parseSpecTypeAsDocKind(name, frontmatter.spec_type)

          if (frontmatter.name !== name) {
            return yield* Effect.fail(
              new InvalidDocYamlError({
                name,
                reason: `Frontmatter name '${frontmatter.name}' does not match doc '${name}'.`,
              })
            )
          }

          if (parsedKind !== doc.kind) {
            return yield* Effect.fail(
              new InvalidDocYamlError({
                name,
                reason: `Frontmatter spec_type '${frontmatter.spec_type}' does not match existing kind '${doc.kind}'.`,
              })
            )
          }

          const hash = computeDocHash(content)
          const docsPath = getDocsPath()
          const filePath = resolveDocPath(docsPath, doc.kind, name)
          ensureDir(filePath)
          writeFileSync(filePath, content, "utf8")

          const title = frontmatter.title
          yield* docRepo.update(doc.id, { hash, title })

          const updated = yield* docRepo.findById(doc.id)
          if (!updated) {
            return yield* Effect.fail(new DocNotFoundError({ name }))
          }

          yield* generateIndexEffect(docsPath)
          return updated
        }),

      lock: (name) =>
        Effect.gen(function* () {
          const doc = yield* docRepo.findByName(name)
          if (!doc) {
            return yield* Effect.fail(new DocNotFoundError({ name }))
          }
          if (doc.status === "locked") {
            return doc
          }
          const lockedAt = new Date().toISOString()
          yield* docRepo.lock(doc.id, lockedAt)

          const locked = yield* docRepo.findById(doc.id)
          if (!locked) {
            return yield* Effect.fail(new DocNotFoundError({ name }))
          }

          yield* generateIndexEffect(getDocsPath())
          return locked
        }),

      list: (filter?) => docRepo.findAll(filter),

      remove: (name) =>
        Effect.gen(function* () {
          const doc = yield* docRepo.findByName(name)
          if (!doc) {
            return yield* Effect.fail(new DocNotFoundError({ name }))
          }
          if (doc.status === "locked") {
            return yield* Effect.fail(
              new DocLockedError({ name, version: doc.version })
            )
          }
          yield* docRepo.remove(doc.id)

          const docsPath = getDocsPath()
          const docPath = resolveDocPath(docsPath, doc.kind, name)
          try {
            if (existsSync(docPath)) unlinkSync(docPath)
          } catch {
            /* non-fatal */
          }
          yield* generateIndexEffect(docsPath)
        }),

      render: (name?) =>
        Effect.gen(function* () {
          const docsPath = getDocsPath()
          const rendered: string[] = []
          if (name) {
            const doc = yield* docRepo.findByName(name)
            if (!doc) {
              return yield* Effect.fail(new DocNotFoundError({ name }))
            }
            rendered.push(validateDocFile(doc, docsPath))
          } else {
            const allDocs = yield* docRepo.findAll()
            for (const doc of allDocs) {
              try {
                rendered.push(validateDocFile(doc, docsPath))
              } catch {
                /* skip docs with invalid or missing markdown */
              }
            }
          }
          yield* generateIndexEffect(docsPath)
          return rendered
        }),

      createVersion: (name) =>
        Effect.gen(function* () {
          const doc = yield* docRepo.findByName(name)
          if (!doc) {
            return yield* Effect.fail(new DocNotFoundError({ name }))
          }
          if (doc.status !== "locked") {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Doc '${name}' must be locked before creating a new version`,
              })
            )
          }
          const docsPath = getDocsPath()
          const docPath = resolveDocPath(docsPath, doc.kind, name)
          if (!existsSync(docPath)) {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Markdown file not found for '${name}'`,
              })
            )
          }
          const content = readFileSync(docPath, "utf8")
          const hash = computeDocHash(content)
          const newVersion = doc.version + 1

          const versionSub = kindSubdir(doc.kind)
          const relPath = versionSub
            ? join(versionSub, `${name}.md`)
            : `${name}.md`

          const newDoc = yield* docRepo.insert({
            hash,
            kind: doc.kind,
            name,
            title: doc.title,
            version: newVersion,
            filePath: relPath,
            parentDocId: doc.id,
          })

          yield* generateIndexEffect(docsPath)
          return newDoc
        }),

      linkDocs: (fromName, toName, linkType?) =>
        Effect.gen(function* () {
          const fromDoc = yield* docRepo.findByName(fromName)
          if (!fromDoc) {
            return yield* Effect.fail(
              new DocNotFoundError({ name: fromName })
            )
          }
          const toDoc = yield* docRepo.findByName(toName)
          if (!toDoc) {
            return yield* Effect.fail(new DocNotFoundError({ name: toName }))
          }

          const resolvedType =
            linkType ?? inferLinkType(fromDoc.kind, toDoc.kind)
          if (!resolvedType) {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Cannot infer link type from ${fromDoc.kind} → ${toDoc.kind}. Provide explicit linkType.`,
              })
            )
          }
          return yield* docRepo.createLink(
            fromDoc.id,
            toDoc.id,
            resolvedType
          )
        }),

      attachTask: (taskId, docName, linkType = "implements") =>
        Effect.gen(function* () {
          const doc = yield* docRepo.findByName(docName)
          if (!doc) {
            return yield* Effect.fail(
              new DocNotFoundError({ name: docName })
            )
          }
          yield* docRepo.createTaskLink(taskId, doc.id, linkType)
        }),

      createPatch: (designName, patchName, patchTitle) =>
        Effect.gen(function* () {
          const parentDoc = yield* docRepo.findByName(designName)
          if (!parentDoc) {
            return yield* Effect.fail(
              new DocNotFoundError({ name: designName })
            )
          }
          if (parentDoc.kind !== "design") {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Patches can only be created on design docs, got '${parentDoc.kind}'`,
              })
            )
          }

          const today = new Date().toISOString().slice(0, 10)
          const patchFrontmatter = stringifyYaml({
            kind: "spec",
            spec_type: "design",
            name: patchName,
            title: patchTitle,
            status: "draft",
            version: 1,
            owners: ["docs-team"],
            summary: `Patch for ${parentDoc.name}: ${patchTitle}`,
            domain: "docs",
            tags: ["patch"],
            depends_on: [parentDoc.name],
            supersedes: [],
            implements: parentDoc.name,
            last_reviewed_at: today,
          })
          const patchContent = `---\n${patchFrontmatter}---\n\n# Summary\nPatch for ${parentDoc.name}: ${patchTitle}\n\n# Architecture\nPatch architecture details.\n\n# Interfaces\n\`\`\`yaml\ninterfaces: []\n\`\`\`\n\n# Data Model\nNo data model changes.\n\n# Invariants\n\`\`\`yaml\ninvariants: []\n\`\`\`\n\n# Failure Modes\n\`\`\`yaml\nfailure_modes: []\n\`\`\`\n\n# Verification\n\`\`\`yaml\nverification: []\n\`\`\`\n`
          parseMarkdownSpecDocContent(patchName, patchContent)

          const hash = computeDocHash(patchContent)
          const docsPath = getDocsPath()
          const filePath = resolveDocPath(docsPath, "design", patchName)
          ensureDir(filePath)
          writeFileSync(filePath, patchContent, "utf8")

          const relPath = join("design", `${patchName}.md`)
          const patchDoc = yield* docRepo.insert({
            hash,
            kind: "design",
            name: patchName,
            title: patchTitle,
            version: 1,
            filePath: relPath,
            parentDocId: null,
          })

          yield* docRepo.createLink(patchDoc.id, parentDoc.id, "design_patch")

          yield* generateIndexEffect(docsPath)
          return patchDoc
        }),

      validate: () =>
        Effect.gen(function* () {
          const warnings: string[] = []
          const unlinked = yield* docRepo.getUnlinkedTaskIds()
          for (const taskId of unlinked) {
            warnings.push(`Task ${taskId} is not linked to any doc`)
          }
          return warnings
        }),

      detectDrift: (name) =>
        Effect.gen(function* () {
          const doc = yield* docRepo.findByName(name)
          if (!doc) {
            return yield* Effect.fail(new DocNotFoundError({ name }))
          }
          const warnings: string[] = []
          const docsPath = getDocsPath()
          const docPath = resolveDocPath(docsPath, doc.kind, name)

          if (existsSync(docPath)) {
            const content = readFileSync(docPath, "utf8")
            const currentHash = computeDocHash(content)
            if (currentHash !== doc.hash) {
              warnings.push(
                `Content hash mismatch: DB has ${doc.hash.slice(0, 8)}..., file has ${currentHash.slice(0, 8)}...`
              )
            }
          } else {
            warnings.push(`Markdown file missing: ${docPath}`)
          }

          const taskLinks = yield* docRepo.getTaskLinksForDoc(doc.id)
          if (taskLinks.length === 0 && doc.kind === "design") {
            warnings.push(`Design doc '${name}' has no linked tasks`)
          }
          return warnings
        }),

      generateIndex: () => generateIndexEffect(getDocsPath()),

      syncInvariants: (docName?) =>
        Effect.gen(function* () {
          const synced: Invariant[] = []
          if (docName) {
            const doc = yield* docRepo.findByName(docName)
            if (!doc) {
              return yield* Effect.fail(
                new DocNotFoundError({ name: docName })
              )
            }
            const result = yield* syncInvariantsForDoc(doc)
            synced.push(...result)
          } else {
            const allDocs = yield* docRepo.findAll()
            for (const doc of allDocs) {
              // Keep whole-repo sync resilient: one malformed markdown file should not
              // prevent invariants from being refreshed for every other doc.
              const result = yield* syncInvariantsForDoc(doc).pipe(
                Effect.catchAllCause((cause) => {
                  const defect = Cause.dieOption(cause)
                  if (
                    Option.isSome(defect) &&
                    defect.value instanceof InvalidDocYamlError
                  ) {
                    return Effect.succeed([])
                  }

                  return Effect.failCause(cause)
                })
              )
              synced.push(...result)
            }
          }
          return synced
        }),

      listInvariants: (filter?) => docRepo.findInvariants(filter),

      recordInvariantCheck: (id, passed, details?, durationMs?) =>
        Effect.gen(function* () {
          const inv = yield* docRepo.findInvariantById(id)
          if (!inv) {
            return yield* Effect.fail(new InvariantNotFoundError({ id }))
          }
          return yield* docRepo.insertInvariantCheck(
            id,
            passed,
            details ?? null,
            durationMs ?? null
          )
        }),

      getDocGraph: () =>
        Effect.gen(function* () {
          const allDocs = yield* docRepo.findAll()
          const allLinks = yield* docRepo.getAllLinks()

          const nodes: DocGraphNode[] = []
          const edges: DocGraphEdge[] = []

          for (const doc of allDocs) {
            nodes.push({
              id: `doc:${doc.id}`,
              label: doc.name,
              kind: doc.kind,
              status: doc.status,
            })
          }

          for (const link of allLinks) {
            edges.push({
              source: `doc:${link.fromDocId}`,
              target: `doc:${link.toDocId}`,
              type: link.linkType,
            })
          }

          for (const doc of allDocs) {
            const taskLinks = yield* docRepo.getTaskLinksForDoc(doc.id)
            for (const tl of taskLinks) {
              const taskNodeId = `task:${tl.taskId}`
              if (!nodes.some((n) => n.id === taskNodeId)) {
                nodes.push({
                  id: taskNodeId,
                  label: tl.taskId,
                  kind: "task",
                })
              }
              edges.push({
                source: taskNodeId,
                target: `doc:${doc.id}`,
                type: tl.linkType,
              })
            }
          }

          return { nodes, edges }
        }),
    }
  })
)
