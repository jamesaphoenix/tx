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
import { Cause, Context, Effect, Either, Layer, Option } from "effect"
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
import { generateDocStableId } from "../id.js"
import { parseMdDocSync, MdDocParseError } from "../utils/md-doc-parser.js"
import { readTxConfig } from "../utils/toml-config.js"
import { resolvePathWithin } from "../utils/file-path.js"
import {
  DOC_KINDS,
} from "../types/index.js"
import type {
  Doc,
  DocLink,
  Invariant,
  InvariantCheck,
  DocKind,
  DocLinkType,
  DocStableId,
  TaskDocLinkType,
  DocGraph,
  DocGraphNode,
  DocGraphEdge,
  EarsPattern,
} from "../types/index.js"

// Local string arrays for .includes() (avoids readonly cast)
const docKindStrings: readonly string[] = DOC_KINDS
const DOC_STABLE_ID_PATTERN = /^doc-[a-f0-9]{12}$/

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

const isDocStableId = (value: string): value is DocStableId =>
  DOC_STABLE_ID_PATTERN.test(value)

const parseKindScopedDocReference = (
  ref: string
): { kind: DocKind; name: string } | null => {
  const normalized = ref.replace(/^specs\//, "").replace(/\.md$/, "")
  const slashIdx = normalized.indexOf("/")
  if (slashIdx === -1) return null

  const rawKind = normalized.slice(0, slashIdx)
  const name = normalized.slice(slashIdx + 1)
  if (!name) return null

  const kind =
    rawKind === "requirements"
      ? "requirement"
      : rawKind === "system-design"
        ? "system_design"
        : rawKind

  if (!docKindStrings.includes(kind)) return null
  return { kind: kind as DocKind, name }
}

const splitMarkdownFrontmatter = (
  content: string
): { frontmatter: string; body: string; newline: string } | null => {
  const cleaned = content.startsWith("\uFEFF") ? content.slice(1) : content
  const startsWithLf = cleaned.startsWith("---\n")
  const startsWithCrLf = cleaned.startsWith("---\r\n")
  if (!startsWithLf && !startsWithCrLf) return null

  const newline = startsWithCrLf ? "\r\n" : "\n"
  const openLength = startsWithCrLf ? 5 : 4
  const rest = cleaned.slice(openLength)
  const delimiter = `${newline}---`
  const closeIdx = rest.indexOf(delimiter)
  if (closeIdx === -1) return null

  const frontmatter = rest.slice(0, closeIdx)
  let bodyStart = closeIdx + delimiter.length
  if (rest[bodyStart] === "\r") bodyStart++
  if (rest[bodyStart] === "\n") bodyStart++

  return {
    frontmatter,
    body: rest.slice(bodyStart),
    newline,
  }
}

const DOC_ID_FRONTMATTER_PATTERN = /^\s*doc_id\s*:\s*(.+?)\s*$/

const normalizeFrontmatterScalar = (value: string): string => {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

const collectFrontmatterDocIdValues = (content: string): string[] => {
  const split = splitMarkdownFrontmatter(content)
  if (!split) return []

  const values: string[] = []
  for (const line of split.frontmatter.split(/\r?\n/)) {
    const match = line.match(DOC_ID_FRONTMATTER_PATTERN)
    if (!match) continue
    const value = normalizeFrontmatterScalar(match[1] ?? "")
    if (value) values.push(value)
  }

  return values
}

type SearchableIndexMetadata = {
  readonly description: string
  readonly domain: string
  readonly tags: readonly string[]
  readonly searchKeywords: readonly string[]
}

const INDEX_GENERIC_TAGS = new Set([
  "prd",
  "design",
  "overview",
  "runbook",
  "decision",
  "requirement",
  "system_design",
  "spec",
])

const PLACEHOLDER_DOMAIN = "product-area"

const SEARCHABLE_SUMMARY_PREFIXES = [
  "Architectural overview of ",
  "One-line summary of ",
  "Technical approach for ",
] as const

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

const readStringField = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : ""
}

const readStringArrayField = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") continue
    const trimmed = entry.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

const buildSearchKeywords = (domain: string, tags: readonly string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of [domain, ...tags]) {
    const trimmed = candidate.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

const readSearchableIndexMetadata = (
  docsPath: string,
  doc: Doc
): SearchableIndexMetadata => {
  const docPath = resolvePathWithin(docsPath, doc.filePath, { useRealpath: true })
  if (!docPath || !existsSync(docPath)) {
    return { description: "", domain: "", tags: [], searchKeywords: [] }
  }

  const content = readFileSync(docPath, "utf8")
  const split = splitMarkdownFrontmatter(content)
  if (!split) {
    return { description: "", domain: "", tags: [], searchKeywords: [] }
  }

  let parsedFrontmatter: unknown
  try {
    parsedFrontmatter = parseYaml(split.frontmatter)
  } catch (err) {
    console.warn(`[tx] malformed YAML frontmatter in ${doc.filePath}: ${err}`)
    return { description: "", domain: "", tags: [], searchKeywords: [] }
  }

  const record = asRecord(parsedFrontmatter)
  if (!record) {
    return { description: "", domain: "", tags: [], searchKeywords: [] }
  }

  const description = readStringField(record.summary)
  const domain = readStringField(record.domain)
  const tags = readStringArrayField(record.tags)

  return {
    description,
    domain,
    tags,
    searchKeywords: buildSearchKeywords(domain, tags),
  }
}

const validateSearchableIndexMetadata = (
  doc: Doc,
  metadata: SearchableIndexMetadata
): string[] => {
  const warnings: string[] = []

  if (!metadata.description) {
    warnings.push(
      `${doc.name}: missing frontmatter 'summary'. Add a one-sentence summary; it becomes the Description column in specs/index.md. Example: summary: "Technical design for ${doc.title}."`
    )
  } else if (SEARCHABLE_SUMMARY_PREFIXES.some((prefix) => metadata.description.startsWith(prefix))) {
    warnings.push(
      `${doc.name}: frontmatter 'summary' still looks templated (${JSON.stringify(metadata.description)}). Replace it with subsystem-specific wording; it becomes the Description column in specs/index.md.`
    )
  }

  if (!metadata.domain) {
    warnings.push(
      `${doc.name}: missing frontmatter 'domain'. Add the subsystem/domain name; it is added to Search Keywords in specs/index.md. Example: domain: ${doc.name}`
    )
  } else if (metadata.domain === PLACEHOLDER_DOMAIN) {
    warnings.push(
      `${doc.name}: frontmatter 'domain' still uses placeholder '${PLACEHOLDER_DOMAIN}'. Replace it with the subsystem/domain name; it is added to Search Keywords in specs/index.md.`
    )
  }

  if (metadata.tags.length === 0) {
    warnings.push(
      `${doc.name}: missing frontmatter 'tags'. Add search terms so agents can find this spec; they populate Search Keywords in specs/index.md. Example: tags: [${doc.kind}, ${doc.name}]`
    )
  } else if (metadata.tags.every((tag) => INDEX_GENERIC_TAGS.has(tag.toLowerCase()))) {
    warnings.push(
      `${doc.name}: frontmatter 'tags' only includes generic values (${metadata.tags.join(", ")}). Add subsystem-specific search terms; they populate Search Keywords in specs/index.md. Example: tags: [${doc.kind}, ${doc.name}, architecture]`
    )
  }

  return warnings
}

const upsertDocIdInMarkdown = (content: string, docId: string): string => {
  const split = splitMarkdownFrontmatter(content)
  if (!split) return content

  const frontmatterLines = split.frontmatter.split(/\r?\n/)
  const nextLines = frontmatterLines.filter(
    (line) => !DOC_ID_FRONTMATTER_PATTERN.test(line)
  )
  const docIdLine = `doc_id: ${docId}`

  const specTypeIndex = nextLines.findIndex((line) => /^\s*spec_type\s*:/.test(line))
  if (specTypeIndex >= 0) {
    nextLines.splice(specTypeIndex + 1, 0, docIdLine)
  } else {
    const kindIndex = nextLines.findIndex((line) => /^\s*kind\s*:/.test(line))
    if (kindIndex >= 0) {
      nextLines.splice(kindIndex + 1, 0, docIdLine)
    } else {
      nextLines.unshift(docIdLine)
    }
  }

  const nextFrontmatter = nextLines.join(split.newline)
  const nextContent = `---${split.newline}${nextFrontmatter}${split.newline}---${split.newline}${split.body}`
  return nextContent === content ? content : nextContent
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
      relFilePath?: string
    }) => Effect.Effect<Doc, ValidationError | InvalidDocYamlError | DatabaseError>
    get: (
      name: string,
      version?: number
    ) => Effect.Effect<Doc, DocNotFoundError | ValidationError | DatabaseError>
    update: (
      name: string,
      content: string
    ) => Effect.Effect<Doc, DocNotFoundError | DocLockedError | InvalidDocYamlError | ValidationError | DatabaseError>
    lock: (name: string) => Effect.Effect<Doc, DocNotFoundError | ValidationError | DatabaseError>
    list: (filter?: {
      kind?: string
      status?: string
    }) => Effect.Effect<Doc[], DatabaseError>
    remove: (
      name: string
    ) => Effect.Effect<void, DocNotFoundError | DocLockedError | ValidationError | DatabaseError>
    render: (
      name?: string
    ) => Effect.Effect<string[], DocNotFoundError | ValidationError | DatabaseError>
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
    ) => Effect.Effect<void, DocNotFoundError | ValidationError | DatabaseError>
    createPatch: (
      designName: string,
      patchName: string,
      patchTitle: string
    ) => Effect.Effect<Doc, DocNotFoundError | ValidationError | DatabaseError>
    validate: () => Effect.Effect<string[], DatabaseError>
    validateIndexSearchability: () => Effect.Effect<string[], DatabaseError>
    detectDrift: (
      name: string
    ) => Effect.Effect<string[], DocNotFoundError | ValidationError | DatabaseError>
    generateIndex: () => Effect.Effect<void, DatabaseError>
    syncInvariants: (
      docName?: string
    ) => Effect.Effect<Invariant[], DocNotFoundError | ValidationError | DatabaseError>
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

    const ensurePersistedDocId = (doc: Doc) =>
      Effect.gen(function* () {
        yield* docRepo.update(doc.id, { docId: doc.docId })
        const refreshed = yield* docRepo.findById(doc.id)
        if (!refreshed) {
          return yield* Effect.fail(new DocNotFoundError({ name: doc.name }))
        }
        return refreshed
      })

    const ensureDocIdInFile = (doc: Doc, docsPath: string): string => {
      const docPath = resolveDocPath(docsPath, doc.kind, doc.name)
      if (!existsSync(docPath)) {
        throw new DocNotFoundError({ name: doc.name })
      }

      const original = readFileSync(docPath, "utf8")
      const rawDocIds = collectFrontmatterDocIdValues(original)
      const uniqueRawDocIds = [...new Set(rawDocIds)]

      if (uniqueRawDocIds.length > 1) {
        throw new InvalidDocYamlError({
          name: doc.name,
          reason: `Frontmatter contains conflicting doc_id values (${uniqueRawDocIds.join(", ")}). Keep exactly one doc_id entry matching stored doc_id '${doc.docId}'.`,
        })
      }

      if (uniqueRawDocIds[0] && uniqueRawDocIds[0] !== doc.docId) {
        throw new InvalidDocYamlError({
          name: doc.name,
          reason: `Frontmatter doc_id '${uniqueRawDocIds[0]}' does not match stored doc_id '${doc.docId}'. Use exactly: doc_id: ${doc.docId}`,
        })
      }

      const normalized = upsertDocIdInMarkdown(original, doc.docId)
      if (normalized !== original) {
        writeFileSync(docPath, normalized, "utf8")
      }

      const parsed = parseMarkdownSpecDocContent(doc.name, normalized)
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

      const frontmatterDocId = parsed.frontmatter.doc_id
      if (frontmatterDocId && frontmatterDocId !== doc.docId) {
        throw new InvalidDocYamlError({
          name: doc.name,
          reason: `Frontmatter doc_id '${frontmatterDocId}' does not match stored doc_id '${doc.docId}'.`,
        })
      }

      return docPath
    }

    const resolveDocReference = (
      ref: string,
      version?: number
    ): Effect.Effect<Doc, DocNotFoundError | ValidationError | DatabaseError> =>
      Effect.gen(function* () {
        const scoped = parseKindScopedDocReference(ref)
        if (scoped) {
          const scopedDoc = yield* docRepo.findLatestByKindAndName(
            scoped.kind,
            scoped.name
          )
          if (!scopedDoc) {
            return yield* Effect.fail(new DocNotFoundError({ name: ref }))
          }
          return yield* ensurePersistedDocId(scopedDoc)
        }

        const direct = isDocStableId(ref)
          ? yield* docRepo.findByDocId(ref, version)
          : null
        if (direct) {
          return yield* ensurePersistedDocId(direct)
        }

        const matches = yield* docRepo.findAllByName(ref, version)
        if (matches.length === 0) {
          return yield* Effect.fail(new DocNotFoundError({ name: ref }))
        }
        const kinds = [...new Set(matches.map((doc) => doc.kind))]
        if (kinds.length > 1) {
          return yield* Effect.fail(
            new ValidationError({
              reason: `Doc reference '${ref}' is ambiguous across kinds (${kinds.join(", ")}). Use doc_id instead.`,
            })
          )
        }
        return yield* ensurePersistedDocId(matches[0]!)
      })

    /** Validate a single markdown doc and return its canonical file path. */
    const validateDocFile = (doc: Doc, docsPath: string): string => {
      return ensureDocIdInFile(doc, docsPath)
    }

    /** Generate index.md from all docs in DB and remove the legacy index.yml. */
    function generateIndexEffect(docsPath: string) {
      return Effect.gen(function* () {
        const allDocs = yield* docRepo.findAll()
        const allLinks = yield* docRepo.getAllLinks()
        const indexMetadataByDocId = new Map<number, SearchableIndexMetadata>()

        for (const doc of allDocs) {
          indexMetadataByDocId.set(doc.id, readSearchableIndexMetadata(docsPath, doc))
        }

        const overviewDoc = allDocs.find((d) => d.kind === "overview")
        const prds = allDocs
          .filter((d) => d.kind === "prd")
          .map((d) => {
            const metadata = indexMetadataByDocId.get(d.id) ?? {
              description: "",
              domain: "",
              tags: [],
              searchKeywords: [],
            }
            return {
              name: d.name,
              title: d.title,
              description: metadata.description,
              search_keywords: [...metadata.searchKeywords],
              status: d.status,
            }
          })

        const requirementDocs = allDocs
          .filter((d) => d.kind === "requirement")
          .map((d) => {
            const metadata = indexMetadataByDocId.get(d.id) ?? {
              description: "",
              domain: "",
              tags: [],
              searchKeywords: [],
            }
            return {
              name: d.name,
              title: d.title,
              description: metadata.description,
              search_keywords: [...metadata.searchKeywords],
              status: d.status,
            }
          })

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
            const metadata = indexMetadataByDocId.get(d.id) ?? {
              description: "",
              domain: "",
              tags: [],
              searchKeywords: [],
            }
            return {
              name: d.name,
              title: d.title,
              description: metadata.description,
              search_keywords: [...metadata.searchKeywords],
              status: d.status,
              implements: implDoc?.name,
            }
          })

        const systemDesignDocs = allDocs
          .filter((d) => d.kind === "system_design")
          .map((d) => {
            const metadata = indexMetadataByDocId.get(d.id) ?? {
              description: "",
              domain: "",
              tags: [],
              searchKeywords: [],
            }
            return {
              name: d.name,
              title: d.title,
              description: metadata.description,
              search_keywords: [...metadata.searchKeywords],
              status: d.status,
            }
          })

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

        const aggregateSearchKeywords = (): string[] => {
          const seen = new Set<string>()
          const out: string[] = []
          for (const doc of allDocs) {
            const metadata = indexMetadataByDocId.get(doc.id)
            for (const keyword of [doc.name, doc.title, ...(metadata?.searchKeywords ?? [])]) {
              const key = keyword.toLowerCase()
              if (seen.has(key)) continue
              seen.add(key)
              out.push(keyword)
            }
          }
          return out
        }

        const indexData = {
          overview: overviewDoc?.name,
          description:
            "Search map for subsystem PRDs and design docs. Use this file to find the authoritative spec by feature area, domain term, or implementation concern.",
          search_keywords: aggregateSearchKeywords(),
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

        const legacyIndexYamlPath = resolve(docsPath, "index.yml")
        try {
          if (existsSync(legacyIndexYamlPath)) unlinkSync(legacyIndexYamlPath)
        } catch {
          /* non-fatal */
        }

        // Write index.md
        const indexMd = renderIndexToMarkdown(indexData)
        const indexMdPath = resolve(docsPath, "index.md")
        ensureDir(indexMdPath)
        writeFileSync(indexMdPath, indexMd, "utf8")
      })
    }

    /** Sync invariants from a single markdown doc into DB. */
    function syncInvariantsForDoc(doc: Doc) {
      return Effect.gen(function* () {
        const docsPath = getDocsPath()
        const persistedDoc = yield* ensurePersistedDocId(doc)
        const docPath = ensureDocIdInFile(persistedDoc, docsPath)
        const content = readFileSync(docPath, "utf8")
        const parsed = parseMarkdownSpecDocContent(persistedDoc.name, content)

        const explicit = deriveEmbeddedInvariantCandidates(
          persistedDoc,
          parsed.blocks.invariants
        )
        const derived = deriveEmbeddedEarsInvariantCandidates(
          persistedDoc,
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
          yield* docRepo.deprecateInvariantsNotIn(persistedDoc.id, [])
          return []
        }

        const synced: Invariant[] = []
        const activeIds: string[] = []
        for (const candidate of candidates) {
          const input = {
            id: candidate.id,
            rule: candidate.rule,
            enforcement: candidate.enforcement,
            docId: persistedDoc.id,
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

        yield* docRepo.deprecateInvariantsNotIn(persistedDoc.id, activeIds)
        return synced
      })
    }

    return {
      create: (input) =>
        Effect.gen(function* () {
          const { kind, name, title, content, metadata, relFilePath } = input
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
          const rawDocIds = collectFrontmatterDocIdValues(content)
          const uniqueRawDocIds = [...new Set(rawDocIds)]
          if (uniqueRawDocIds.length > 1) {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Frontmatter contains conflicting doc_id values (${uniqueRawDocIds.join(", ")}). Keep exactly one doc_id entry or remove them so tx can generate one.`,
              })
            )
          }
          const contentForParse =
            rawDocIds.length > 1 && uniqueRawDocIds[0]
              ? upsertDocIdInMarkdown(content, uniqueRawDocIds[0])
              : content
          const parsedDoc = parseMarkdownSpecDocContent(name, contentForParse)
          const frontmatter = parsedDoc.frontmatter
          const parsedKind = parseSpecTypeAsDocKind(name, frontmatter.spec_type)

          // Deprecation warnings for legacy PRD frontmatter fields
          if (parsedKind === "prd") {
            if ((frontmatter as Record<string, unknown>).requirements !== undefined) {
              console.warn(`[tx] Deprecated field 'requirements' detected in PRD YAML; use 'ears_requirements' instead.`)
            }
            if ((frontmatter as Record<string, unknown>).out_of_scope !== undefined) {
              console.warn(`[tx] Deprecated field 'out_of_scope' detected in PRD YAML; use 'non_goals' instead.`)
            }
          }
          const generatedDocId = (frontmatter.doc_id ??
            (yield* generateDocStableId())) as DocStableId

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

          if (frontmatter.doc_id && !isDocStableId(frontmatter.doc_id)) {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Invalid doc_id '${frontmatter.doc_id}'. Expected format doc-<12 hex>.`,
              })
            )
          }

          const existing = yield* docRepo.findLatestByKindAndName(parsedKind, frontmatter.name)
          if (existing) {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Doc '${parsedKind}/${frontmatter.name}' already exists (v${existing.version})`,
              })
            )
          }
          const existingDocId = yield* docRepo.findByDocId(generatedDocId)
          if (existingDocId) {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Doc ID '${generatedDocId}' already exists.`,
              })
            )
          }

          const docsPath = getDocsPath()
          let relPath: string
          const contentWithDocId = upsertDocIdInMarkdown(
            contentForParse,
            generatedDocId
          )

          if (relFilePath) {
            // Registering an existing file at a custom path
            const absPath = resolve(docsPath, relFilePath)
            if (!existsSync(absPath)) {
              return yield* Effect.fail(
                new ValidationError({
                  reason: `File not found at ${absPath}. Provide a path relative to '${docsPath}'.`,
                })
              )
            }
            if (contentWithDocId !== contentForParse) {
              writeFileSync(absPath, contentWithDocId, "utf8")
            }
            relPath = relFilePath
          } else {
            // Scaffolding a new file at the standard path
            const filePath = resolveDocPath(docsPath, parsedKind, frontmatter.name)
            if (existsSync(filePath)) {
              return yield* Effect.fail(
                new ValidationError({
                  reason: `File already exists at ${filePath}. Edit it directly instead of re-creating. Then run 'tx doc sync' to update the DB hash.`,
                })
              )
            }
            ensureDir(filePath)
            writeFileSync(filePath, contentWithDocId, "utf8")

            const sub = kindSubdir(parsedKind)
            relPath = sub
              ? join(sub, `${frontmatter.name}.md`)
              : `${frontmatter.name}.md`
          }

          const hash = computeDocHash(contentWithDocId)

          const doc = yield* docRepo.insert({
            docId: generatedDocId,
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
          const doc = yield* resolveDocReference(name, version)
          yield* Effect.try({
            try: () => ensureDocIdInFile(doc, getDocsPath()),
            catch: (cause) => {
              if (cause instanceof DocNotFoundError) return cause
              if (cause instanceof InvalidDocYamlError)
                return new ValidationError({ reason: cause.reason })
              return new ValidationError({ reason: String(cause) })
            }
          })
          return doc
        }),

      update: (name, content) =>
        Effect.gen(function* () {
          const doc = yield* resolveDocReference(name)
          if (doc.status === "locked") {
            return yield* Effect.fail(
              new DocLockedError({ name, version: doc.version })
            )
          }
          const rawDocIds = collectFrontmatterDocIdValues(content)
          const uniqueRawDocIds = [...new Set(rawDocIds)]
          if (uniqueRawDocIds.length > 1) {
            return yield* Effect.fail(
              new InvalidDocYamlError({
                name,
                reason: `Frontmatter contains conflicting doc_id values (${uniqueRawDocIds.join(", ")}). Keep exactly one doc_id entry matching doc_id '${doc.docId}'.`,
              })
            )
          }
          if (uniqueRawDocIds[0] && uniqueRawDocIds[0] !== doc.docId) {
            return yield* Effect.fail(
              new InvalidDocYamlError({
                name,
                reason: `Frontmatter doc_id '${uniqueRawDocIds[0]}' does not match doc_id '${doc.docId}'. Use exactly: doc_id: ${doc.docId}`,
              })
            )
          }
          const normalizedContent = upsertDocIdInMarkdown(content, doc.docId)
          const parsedDoc = parseMarkdownSpecDocContent(name, normalizedContent)
          const frontmatter = parsedDoc.frontmatter
          const parsedKind = parseSpecTypeAsDocKind(name, frontmatter.spec_type)

          if (frontmatter.name !== doc.name) {
            return yield* Effect.fail(
              new InvalidDocYamlError({
                name,
                reason: `Frontmatter name '${frontmatter.name}' does not match doc '${doc.name}'.`,
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

          if (frontmatter.doc_id && frontmatter.doc_id !== doc.docId) {
            return yield* Effect.fail(
              new InvalidDocYamlError({
                name,
                reason: `Frontmatter doc_id '${frontmatter.doc_id}' does not match doc_id '${doc.docId}'.`,
              })
            )
          }

          const hash = computeDocHash(normalizedContent)
          const docsPath = getDocsPath()
          const filePath = resolveDocPath(docsPath, doc.kind, doc.name)
          ensureDir(filePath)
          writeFileSync(filePath, normalizedContent, "utf8")

          const title = frontmatter.title
          yield* docRepo.update(doc.id, { docId: doc.docId, hash, title })

          const updated = yield* docRepo.findById(doc.id)
          if (!updated) {
            return yield* Effect.fail(new DocNotFoundError({ name }))
          }

          yield* generateIndexEffect(docsPath)
          return updated
        }),

      lock: (name) =>
        Effect.gen(function* () {
          const doc = yield* resolveDocReference(name)
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
          const doc = yield* resolveDocReference(name)
          if (doc.status === "locked") {
            return yield* Effect.fail(
              new DocLockedError({ name, version: doc.version })
            )
          }
          yield* docRepo.remove(doc.id)

          const docsPath = getDocsPath()
          const remainingDocs = yield* docRepo.findAll()
          const stillReferenced = remainingDocs.some(
            (candidate) => candidate.filePath === doc.filePath
          )
          if (!stillReferenced) {
            const docPath = resolveDocPath(docsPath, doc.kind, doc.name)
            try {
              if (existsSync(docPath)) unlinkSync(docPath)
            } catch {
              /* non-fatal */
            }
          }
          yield* generateIndexEffect(docsPath)
        }),

      render: (name?) =>
        Effect.gen(function* () {
          const docsPath = getDocsPath()
          const rendered: string[] = []
          if (name) {
            const doc = yield* resolveDocReference(name)
            rendered.push(validateDocFile(doc, docsPath))
          } else {
            const allDocs = yield* docRepo.findAll()
            for (const doc of allDocs) {
              try {
                const persistedDoc = yield* ensurePersistedDocId(doc)
                rendered.push(validateDocFile(persistedDoc, docsPath))
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
          const doc = yield* resolveDocReference(name)
          if (doc.status !== "locked") {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Doc '${name}' must be locked before creating a new version`,
              })
            )
          }
          const docsPath = getDocsPath()
          const docPath = ensureDocIdInFile(doc, docsPath)
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
            ? join(versionSub, `${doc.name}.md`)
            : `${doc.name}.md`

          const newDoc = yield* docRepo.insert({
            docId: doc.docId,
            hash,
            kind: doc.kind,
            name: doc.name,
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
          const fromDoc = yield* resolveDocReference(fromName)
          const toDoc = yield* resolveDocReference(toName)

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
          const doc = yield* resolveDocReference(docName)
          yield* docRepo.createTaskLink(taskId, doc.id, linkType)
        }),

      createPatch: (designName, patchName, patchTitle) =>
        Effect.gen(function* () {
          const parentDoc = yield* resolveDocReference(designName)
          if (parentDoc.kind !== "design") {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Patches can only be created on design docs, got '${parentDoc.kind}'`,
              })
            )
          }

          const today = new Date().toISOString().slice(0, 10)
          const patchDocId = (yield* generateDocStableId()) as DocStableId
          const patchFrontmatter = stringifyYaml({
            kind: "spec",
            spec_type: "design",
            doc_id: patchDocId,
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
          yield* Effect.try({
            try: () => parseMarkdownSpecDocContent(patchName, patchContent),
            catch: (cause) =>
              cause instanceof InvalidDocYamlError
                ? new ValidationError({ reason: cause.reason })
                : new ValidationError({ reason: String(cause) })
          })

          const hash = computeDocHash(patchContent)
          const docsPath = getDocsPath()
          const filePath = resolveDocPath(docsPath, "design", patchName)
          ensureDir(filePath)
          writeFileSync(filePath, patchContent, "utf8")

          const relPath = join("design", `${patchName}.md`)
          const patchDoc = yield* docRepo.insert({
            docId: patchDocId,
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

      validateIndexSearchability: () =>
        Effect.gen(function* () {
          const docsPath = getDocsPath()
          const docs = yield* docRepo.findAll()
          const warnings: string[] = []
          for (const doc of docs) {
            warnings.push(
              ...validateSearchableIndexMetadata(
                doc,
                readSearchableIndexMetadata(docsPath, doc)
              )
            )
          }
          return warnings
        }),

      detectDrift: (name) =>
        Effect.gen(function* () {
          const doc = yield* resolveDocReference(name)
          const warnings: string[] = []
          const docsPath = getDocsPath()
          let docPath: string
          try {
            docPath = ensureDocIdInFile(doc, docsPath)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            warnings.push(`Unable to validate markdown structure for drift detection: ${message}`)
            return warnings
          }

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
            warnings.push(`Design doc '${doc.name}' has no linked tasks`)
          }
          return warnings
        }),

      generateIndex: () => generateIndexEffect(getDocsPath()),

      syncInvariants: (docName?) =>
        Effect.gen(function* () {
          const synced: Invariant[] = []
          if (docName) {
            const doc = yield* resolveDocReference(docName)
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
          const nameCounts = new Map<string, number>()

          for (const doc of allDocs) {
            nameCounts.set(doc.name, (nameCounts.get(doc.name) ?? 0) + 1)
          }

          for (const doc of allDocs) {
            nodes.push({
              id: `doc:${doc.id}`,
              label: (nameCounts.get(doc.name) ?? 0) > 1 ? `${doc.kind}/${doc.name}` : doc.name,
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
