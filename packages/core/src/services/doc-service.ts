/**
 * DocService — business logic for docs-as-primitives (DD-023).
 *
 * Manages doc lifecycle (create/update/lock/version), rendering (YAML→MD),
 * linking (doc-doc, task-doc), invariant sync, drift detection, and graph data.
 *
 * YAML content lives on disk (.tx/docs/); DB stores metadata + links only.
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
} from "node:fs"
import { resolve, dirname, join } from "node:path"
import { Context, Effect, Layer } from "effect"
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
import {
  renderDocToMarkdown,
  renderIndexToMarkdown,
} from "../utils/doc-renderer.js"
import { readTxConfig } from "../utils/toml-config.js"
import {
  DOC_KINDS,
  INVARIANT_ENFORCEMENT_TYPES,
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
} from "@jamesaphoenix/tx-types"

// Local string arrays for .includes() (avoids readonly cast)
const docKindStrings: readonly string[] = DOC_KINDS
const enforcementStrings: readonly string[] = INVARIANT_ENFORCEMENT_TYPES

/** Infer link type from doc kinds (from → to). */
const inferLinkType = (
  fromKind: DocKind,
  toKind: DocKind
): DocLinkType | null => {
  if (fromKind === "overview" && toKind === "prd") return "overview_to_prd"
  if (fromKind === "overview" && toKind === "design")
    return "overview_to_design"
  if (fromKind === "prd" && toKind === "design") return "prd_to_design"
  return null
}

/** Get the subdirectory for a doc kind. overview lives at root. */
const kindSubdir = (kind: DocKind): string => {
  if (kind === "overview") return ""
  return kind
}

/** Resolve the YAML file path for a doc. */
const resolveYamlPath = (
  docsPath: string,
  kind: DocKind,
  name: string
): string => {
  const sub = kindSubdir(kind)
  return sub
    ? resolve(docsPath, sub, `${name}.yml`)
    : resolve(docsPath, `${name}.yml`)
}

/** Resolve the MD file path for a doc. */
const resolveMdPath = (
  docsPath: string,
  kind: DocKind,
  name: string
): string => {
  const sub = kindSubdir(kind)
  return sub
    ? resolve(docsPath, sub, `${name}.md`)
    : resolve(docsPath, `${name}.md`)
}

/** Validate YAML content and return parsed object. */
const validateYaml = (
  name: string,
  content: string
): Record<string, unknown> => {
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
  return parsed as Record<string, unknown>
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

export class DocService extends Context.Tag("DocService")<
  DocService,
  {
    create: (input: {
      kind: DocKind
      name: string
      title: string
      yamlContent: string
      metadata?: Record<string, unknown>
    }) => Effect.Effect<Doc, ValidationError | InvalidDocYamlError | DatabaseError>
    get: (
      name: string,
      version?: number
    ) => Effect.Effect<Doc, DocNotFoundError | DatabaseError>
    update: (
      name: string,
      yamlContent: string
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

    /** Render a single doc and return its MD file path. */
    const renderSingleDoc = (doc: Doc, docsPath: string): string => {
      const yamlPath = resolveYamlPath(docsPath, doc.kind, doc.name)
      if (!existsSync(yamlPath)) {
        throw new DocNotFoundError({ name: doc.name })
      }
      const yamlContent = readFileSync(yamlPath, "utf8")
      const parsed = validateYaml(doc.name, yamlContent)
      const md = renderDocToMarkdown(parsed, doc.kind)
      const mdPath = resolveMdPath(docsPath, doc.kind, doc.name)
      ensureDir(mdPath)
      writeFileSync(mdPath, md, "utf8")
      return mdPath
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
          prds,
          design_docs: designDocs,
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

        const indexYamlPath = resolve(docsPath, "index.yml")
        ensureDir(indexYamlPath)
        writeFileSync(indexYamlPath, stringifyYaml(indexYamlObj), "utf8")

        // Write index.md
        const indexMd = renderIndexToMarkdown(indexData)
        const indexMdPath = resolve(docsPath, "index.md")
        writeFileSync(indexMdPath, indexMd, "utf8")
      })
    }

    /** Sync invariants from a single doc's YAML into DB. */
    function syncInvariantsForDoc(doc: Doc) {
      return Effect.gen(function* () {
        const docsPath = getDocsPath()
        const yamlPath = resolveYamlPath(docsPath, doc.kind, doc.name)
        if (!existsSync(yamlPath)) {
          return []
        }
        const yamlContent = readFileSync(yamlPath, "utf8")
        const parsed = validateYaml(doc.name, yamlContent)
        const invariantsRaw = parsed.invariants as unknown[] | undefined

        if (!Array.isArray(invariantsRaw) || invariantsRaw.length === 0) {
          yield* docRepo.deprecateInvariantsNotIn(doc.id, [])
          return []
        }

        const synced: Invariant[] = []
        const activeIds: string[] = []
        for (const raw of invariantsRaw) {
          if (typeof raw !== "object" || raw === null) continue
          const inv = raw as Record<string, unknown>
          const id = typeof inv.id === "string" ? inv.id : null
          const rule = typeof inv.rule === "string" ? inv.rule : null
          const enforcement =
            typeof inv.enforcement === "string" ? inv.enforcement : null

          if (!id || !rule || !enforcement) continue
          if (!enforcementStrings.includes(enforcement)) continue

          const input = {
            id,
            rule,
            enforcement,
            docId: doc.id,
            subsystem:
              typeof inv.subsystem === "string"
                ? inv.subsystem
                : inv.subsystem === null
                  ? null
                  : undefined,
            testRef:
              typeof inv.test_ref === "string" ? inv.test_ref : undefined,
            lintRule:
              typeof inv.lint_rule === "string" ? inv.lint_rule : undefined,
            promptRef:
              typeof inv.prompt_ref === "string" ? inv.prompt_ref : undefined,
          }
          const result = yield* docRepo.upsertInvariant(input)
          synced.push(result)
          activeIds.push(id)
        }

        yield* docRepo.deprecateInvariantsNotIn(doc.id, activeIds)
        return synced
      })
    }

    return {
      create: (input) =>
        Effect.gen(function* () {
          const { kind, name, title, yamlContent, metadata } = input
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
          const parsed = validateYaml(name, yamlContent)
          validateKind(name, parsed, kind)

          const existing = yield* docRepo.findByName(name)
          if (existing) {
            return yield* Effect.fail(
              new ValidationError({
                reason: `Doc '${name}' already exists (v${existing.version})`,
              })
            )
          }

          const hash = computeDocHash(yamlContent)
          const docsPath = getDocsPath()
          const filePath = resolveYamlPath(docsPath, kind, name)
          ensureDir(filePath)
          writeFileSync(filePath, yamlContent, "utf8")

          const relPath =
            kind === "overview" ? `${name}.yml` : join(kind, `${name}.yml`)

          const doc = yield* docRepo.insert({
            hash,
            kind,
            name,
            title,
            version: 1,
            filePath: relPath,
            parentDocId: null,
            metadata: metadata ? JSON.stringify(metadata) : undefined,
          })

          try {
            renderSingleDoc(doc, docsPath)
          } catch {
            /* non-fatal */
          }
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

      update: (name, yamlContent) =>
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
          const parsed = validateYaml(name, yamlContent)
          validateKind(name, parsed, doc.kind)

          const hash = computeDocHash(yamlContent)
          const docsPath = getDocsPath()
          const filePath = resolveYamlPath(docsPath, doc.kind, name)
          ensureDir(filePath)
          writeFileSync(filePath, yamlContent, "utf8")

          const title =
            typeof parsed.title === "string" ? parsed.title : doc.title
          yield* docRepo.update(doc.id, { hash, title })

          const updated = yield* docRepo.findById(doc.id)
          if (!updated) {
            return yield* Effect.fail(new DocNotFoundError({ name }))
          }

          try {
            renderSingleDoc(updated, docsPath)
          } catch {
            /* non-fatal */
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

          const docsPath = getDocsPath()
          try {
            renderSingleDoc(locked, docsPath)
          } catch {
            /* non-fatal */
          }
          yield* generateIndexEffect(docsPath)
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
          const yamlPath = resolveYamlPath(docsPath, doc.kind, name)
          const mdPath = resolveMdPath(docsPath, doc.kind, name)
          try {
            if (existsSync(yamlPath)) unlinkSync(yamlPath)
          } catch {
            /* non-fatal */
          }
          try {
            if (existsSync(mdPath)) unlinkSync(mdPath)
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
            rendered.push(renderSingleDoc(doc, docsPath))
          } else {
            const allDocs = yield* docRepo.findAll()
            for (const doc of allDocs) {
              try {
                rendered.push(renderSingleDoc(doc, docsPath))
              } catch {
                /* skip docs with missing YAML */
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
          const yamlPath = resolveYamlPath(docsPath, doc.kind, name)
          if (!existsSync(yamlPath)) {
            return yield* Effect.fail(
              new ValidationError({
                reason: `YAML file not found for '${name}'`,
              })
            )
          }
          const yamlContent = readFileSync(yamlPath, "utf8")
          const hash = computeDocHash(yamlContent)
          const newVersion = doc.version + 1

          const relPath =
            doc.kind === "overview"
              ? `${name}.yml`
              : join(doc.kind, `${name}.yml`)

          const newDoc = yield* docRepo.insert({
            hash,
            kind: doc.kind,
            name,
            title: doc.title,
            version: newVersion,
            filePath: relPath,
            parentDocId: doc.id,
          })

          try {
            renderSingleDoc(newDoc, docsPath)
          } catch {
            /* non-fatal */
          }
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

          const patchYaml = stringifyYaml({
            kind: "design",
            name: patchName,
            title: patchTitle,
            status: "changing",
            version: 1,
            implements: parentDoc.name,
            problem_definition: `Patch for ${parentDoc.name}: ${patchTitle}`,
          })

          const hash = computeDocHash(patchYaml)
          const docsPath = getDocsPath()
          const filePath = resolveYamlPath(docsPath, "design", patchName)
          ensureDir(filePath)
          writeFileSync(filePath, patchYaml, "utf8")

          const relPath = join("design", `${patchName}.yml`)
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

          try {
            renderSingleDoc(patchDoc, docsPath)
          } catch {
            /* non-fatal */
          }
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
          const yamlPath = resolveYamlPath(docsPath, doc.kind, name)

          if (existsSync(yamlPath)) {
            const content = readFileSync(yamlPath, "utf8")
            const currentHash = computeDocHash(content)
            if (currentHash !== doc.hash) {
              warnings.push(
                `Content hash mismatch: DB has ${doc.hash.slice(0, 8)}..., file has ${currentHash.slice(0, 8)}...`
              )
            }
          } else {
            warnings.push(`YAML file missing: ${yamlPath}`)
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
              const result = yield* syncInvariantsForDoc(doc)
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
