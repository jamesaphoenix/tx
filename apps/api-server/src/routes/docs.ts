/**
 * Doc Route Handlers
 *
 * Implements docs-as-primitives endpoint handlers (DD-023).
 * Markdown-on-disk doc management with DB metadata, linking, and invariant sync.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import {
  computeDocHash,
  DocService,
  MdDocParseError,
  parseMdDocSync,
  readTxConfig,
} from "@jamesaphoenix/tx-core"
import type { DocKind } from "@jamesaphoenix/tx-types"
import { TxApi, mapCoreError } from "../api.js"

// -----------------------------------------------------------------------------
// Handler Layer
// -----------------------------------------------------------------------------

const PLACEHOLDER_TEXT_BY_KIND: Record<DocKind, readonly string[]> = {
  overview: [
    "Describe the system overview.",
    "What problem this system solves.",
    "Included: ...",
    "Excluded: ...",
  ],
  prd: [
    "Describe the purpose of this PRD.",
    "Describe the problem this feature solves.",
    "the system shall do X",
    "criterion description",
  ],
  design: [
    "Describe the design approach.",
    "No data model changes.",
    "Unresolved design decisions",
  ],
  requirement: [
    "One-sentence behavioral description.",
    "The system shall do something",
  ],
  system_design: [
    "What cross-cutting concern this describes.",
    "Which features/subsystems this applies to.",
    "Architecture, patterns, data flow, service boundaries.",
  ],
  runbook: [
    "Describe when to use this runbook.",
    "Describe observable symptoms.",
    "How to confirm root cause.",
    "Step-by-step mitigation actions.",
    "When and how to escalate.",
  ],
  decision: [
    "One-line decision summary.",
    "Describe the context and constraints.",
    "List alternatives considered.",
    "Record the chosen option.",
    "Document expected trade-offs and impacts.",
  ],
}

const kindSubdir = (kind: string): string => {
  if (kind === "overview") return ""
  if (kind === "requirement") return "requirements"
  if (kind === "system_design") return "system-design"
  return kind
}

const resolveDocMdRelativePath = (kind: string, name: string): string => {
  const sub = kindSubdir(kind)
  return sub ? `${sub}/${name}.md` : `${name}.md`
}

const formatMarkdownParseProblem = (error: unknown): string => {
  if (error instanceof MdDocParseError) {
    return `Markdown parse error: ${error.reason}`
  }
  return "Markdown parse error: unable to parse document content."
}

const findPlaceholderProblems = (
  kind: DocKind,
  parsed: {
    frontmatter: { title?: unknown; summary?: unknown }
    sections: ReadonlyArray<{ heading: string; body: string }>
  }
): string[] => {
  const placeholders = PLACEHOLDER_TEXT_BY_KIND[kind]
  const problems: string[] = []
  const seen = new Set<string>()

  const checkValue = (field: string, value: unknown) => {
    if (value === undefined || value === null) return
    const haystack = (typeof value === "string" ? value : JSON.stringify(value)).toLowerCase()
    for (const placeholder of placeholders) {
      const marker = placeholder.toLowerCase()
      if (!haystack.includes(marker)) continue

      const problem = `Placeholder text in '${field}': "${placeholder}"`
      if (!seen.has(problem)) {
        seen.add(problem)
        problems.push(problem)
      }
    }
  }

  checkValue("frontmatter.title", parsed.frontmatter.title)
  checkValue("frontmatter.summary", parsed.frontmatter.summary)

  for (const section of parsed.sections) {
    checkValue(`section.${section.heading}`, section.body)
  }

  return problems
}

export const DocsLive = HttpApiBuilder.group(TxApi, "docs", (handlers) =>
  handlers
    .handle("listDocs", ({ urlParams }) =>
      Effect.gen(function* () {
        const svc = yield* DocService
        const docs = yield* svc.list({
          kind: urlParams.kind,
          status: urlParams.status,
        })
        return {
          docs: docs.map((d) => ({
            id: d.id,
            hash: d.hash,
            kind: d.kind,
            name: d.name,
            title: d.title,
            version: d.version,
            status: d.status,
            filePath: d.filePath,
            parentDocId: d.parentDocId,
            createdAt: d.createdAt.toISOString(),
            lockedAt: d.lockedAt ? d.lockedAt.toISOString() : null,
          })),
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getDocsHealth", () =>
      Effect.gen(function* () {
        const svc = yield* DocService
        const docs = yield* svc.list()
        const graph = yield* svc.getDocGraph()

        const config = readTxConfig()
        const docsPath = resolve(config.docs.path)

        const issues: Array<{ docName: string; kind: string; problems: string[] }> = []
        const unhealthyDocs = new Set<string>()

        const docNodeById = new Map<string, { name: string; kind: string }>()
        for (const node of graph.nodes) {
          if (!node.id.startsWith("doc:")) continue
          docNodeById.set(node.id, { name: node.label, kind: node.kind })
        }

        const incomingDocLinkCount = new Map<string, number>()
        const prdsLinkedToDesign = new Set<string>()
        const designsLinkedFromPrd = new Set<string>()
        for (const doc of docs) incomingDocLinkCount.set(doc.name, 0)

        for (const edge of graph.edges) {
          if (!edge.source.startsWith("doc:") || !edge.target.startsWith("doc:")) continue

          const source = docNodeById.get(edge.source)
          const target = docNodeById.get(edge.target)
          if (!source || !target) continue

          incomingDocLinkCount.set(
            target.name,
            (incomingDocLinkCount.get(target.name) ?? 0) + 1
          )

          if (edge.type === "prd_to_design" && source.kind === "prd" && target.kind === "design") {
            prdsLinkedToDesign.add(source.name)
            designsLinkedFromPrd.add(target.name)
          }
        }

        for (const doc of docs) {
          const mdRelPath = resolveDocMdRelativePath(doc.kind, doc.name)
          const mdPath = resolve(docsPath, mdRelPath)
          let content: string | null = null

          if (!existsSync(mdPath)) {
            issues.push({
              docName: doc.name,
              kind: "hash_drift",
              problems: [`Markdown file missing on disk: ${mdRelPath}`],
            })
          } else {
            content = readFileSync(mdPath, "utf8")
            const currentHash = computeDocHash(content)
            if (currentHash !== doc.hash) {
              issues.push({
                docName: doc.name,
                kind: "hash_drift",
                problems: [
                  `Content hash mismatch: DB has ${doc.hash.slice(0, 8)}..., file has ${currentHash.slice(0, 8)}...`,
                ],
              })
            }
          }

          if (content !== null) {
            const parsedResult = parseMdDocSync(content)

            if (parsedResult._tag === "Left") {
              issues.push({
                docName: doc.name,
                kind: "parse",
                problems: [formatMarkdownParseProblem(parsedResult.left)],
              })
            } else {
              const problems = findPlaceholderProblems(doc.kind, parsedResult.right)
              if (problems.length > 0) {
                issues.push({
                  docName: doc.name,
                  kind: "placeholder",
                  problems,
                })
              }
            }
          }

          if ((incomingDocLinkCount.get(doc.name) ?? 0) === 0) {
            issues.push({
              docName: doc.name,
              kind: "orphaned",
              problems: ["No incoming doc links."],
            })
          }

          if (doc.kind === "prd" && !prdsLinkedToDesign.has(doc.name)) {
            issues.push({
              docName: doc.name,
              kind: "cross_link",
              problems: ["PRD is not linked to any design doc via 'prd_to_design'."],
            })
          }

          if (doc.kind === "design" && !designsLinkedFromPrd.has(doc.name)) {
            issues.push({
              docName: doc.name,
              kind: "cross_link",
              problems: ["Design doc has no incoming PRD link via 'prd_to_design'."],
            })
          }
        }

        for (const issue of issues) {
          unhealthyDocs.add(issue.docName)
        }

        return {
          total: docs.length,
          healthy: docs.length - unhealthyDocs.size,
          issues,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("createDoc", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* DocService
        const content = payload.content
        const doc = yield* svc.create({
          kind: payload.kind as DocKind,
          name: payload.name,
          title: payload.title,
          content,
          metadata: payload.metadata as Record<string, unknown> | undefined,
        })
        return {
          id: doc.id,
          hash: doc.hash,
          kind: doc.kind,
          name: doc.name,
          title: doc.title,
          version: doc.version,
          status: doc.status,
          filePath: doc.filePath,
          parentDocId: doc.parentDocId,
          createdAt: doc.createdAt.toISOString(),
          lockedAt: doc.lockedAt ? doc.lockedAt.toISOString() : null,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getDoc", ({ path: { name } }) =>
      Effect.gen(function* () {
        const svc = yield* DocService
        const doc = yield* svc.get(name)
        return {
          id: doc.id,
          hash: doc.hash,
          kind: doc.kind,
          name: doc.name,
          title: doc.title,
          version: doc.version,
          status: doc.status,
          filePath: doc.filePath,
          parentDocId: doc.parentDocId,
          createdAt: doc.createdAt.toISOString(),
          lockedAt: doc.lockedAt ? doc.lockedAt.toISOString() : null,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("deleteDoc", ({ path: { name } }) =>
      Effect.gen(function* () {
        const svc = yield* DocService
        yield* svc.remove(name)
        return { success: true, name }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("updateDoc", ({ path: { name }, payload }) =>
      Effect.gen(function* () {
        const svc = yield* DocService
        const content = payload.content
        const doc = yield* svc.update(name, content)
        return {
          id: doc.id,
          hash: doc.hash,
          kind: doc.kind,
          name: doc.name,
          title: doc.title,
          version: doc.version,
          status: doc.status,
          filePath: doc.filePath,
          parentDocId: doc.parentDocId,
          createdAt: doc.createdAt.toISOString(),
          lockedAt: doc.lockedAt ? doc.lockedAt.toISOString() : null,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("lockDoc", ({ path: { name } }) =>
      Effect.gen(function* () {
        const svc = yield* DocService
        const doc = yield* svc.lock(name)
        return {
          id: doc.id,
          hash: doc.hash,
          kind: doc.kind,
          name: doc.name,
          title: doc.title,
          version: doc.version,
          status: doc.status,
          filePath: doc.filePath,
          parentDocId: doc.parentDocId,
          createdAt: doc.createdAt.toISOString(),
          lockedAt: doc.lockedAt ? doc.lockedAt.toISOString() : null,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("linkDocs", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* DocService
        const link = yield* svc.linkDocs(
          payload.fromName,
          payload.toName,
          payload.linkType as "overview_to_prd" | "overview_to_design" | "prd_to_design" | "design_patch" | undefined,
        )
        return {
          id: link.id,
          fromDocId: link.fromDocId,
          toDocId: link.toDocId,
          linkType: link.linkType,
          createdAt: link.createdAt.toISOString(),
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("renderDocs", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* DocService
        const paths = yield* svc.render(payload.name ?? undefined)
        const rendered = paths.map((p) => {
          if (existsSync(p)) return readFileSync(p, "utf8")
          return ""
        })
        return { rendered }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getDocSource", ({ path: { name } }) =>
      Effect.gen(function* () {
        const svc = yield* DocService
        const doc = yield* svc.get(name)

        const config = readTxConfig()
        const docsPath = resolve(config.docs.path)
        const mdRel = resolveDocMdRelativePath(doc.kind, doc.name)
        const mdPath = resolve(docsPath, mdRel)
        const content = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : null

        return {
          name: doc.name,
          filePath: doc.filePath,
          content,
          yamlContent: null,
          renderedContent: content,
        }
      }).pipe(Effect.mapError(mapCoreError))
    )

    .handle("getDocGraph", () =>
      Effect.gen(function* () {
        const svc = yield* DocService
        return yield* svc.getDocGraph()
      }).pipe(Effect.mapError(mapCoreError))
    )
)
