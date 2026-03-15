/**
 * Doc Route Handlers
 *
 * Implements docs-as-primitives endpoint handlers (DD-023).
 * YAML-on-disk doc management with DB metadata, linking, and invariant sync.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { readFileSync, existsSync } from "node:fs"
import { resolve } from "node:path"
import { computeDocHash, DocService, readTxConfig } from "@jamesaphoenix/tx-core"
import type { DocKind } from "@jamesaphoenix/tx-types"
import { parse as parseYaml } from "yaml"
import { TxApi, mapCoreError } from "../api.js"

// -----------------------------------------------------------------------------
// Handler Layer
// -----------------------------------------------------------------------------

const PLACEHOLDER_TEXT_BY_KIND: Record<DocKind, Record<string, readonly string[]>> = {
  overview: {
    problem_definition: ["Describe the problem this system solves."],
    subsystems: ["## Subsystem 1", "Boundary: packages/core/src/services/..."],
  },
  prd: {
    problem: ["Describe the problem."],
    solution: ["Describe the solution approach."],
    ears_requirements: ["The system shall do something important"],
    acceptance_criteria: ["Criterion 1"],
  },
  design: {
    problem_definition: ["Why this change is needed."],
    architecture: ["## Components\n  ..."],
    testing_strategy: ["EARS-XXX-001", "should do X when Y", "Returns expected state Z"],
    goals: ["Goal 1"],
  },
  requirement: {
    overview: ["One-sentence behavioral description."],
    ears_requirements: ["The system shall do something"],
  },
  system_design: {
    overview: ["What cross-cutting concern this describes."],
    scope: ["Which features/subsystems this applies to."],
    design: ["Architecture, patterns, data flow, service boundaries."],
  },
  runbook: {
    summary: ["Describe when to use this runbook."],
    symptoms: ["Describe observable symptoms."],
    diagnosis: ["How to confirm root cause."],
    mitigation: ["Step-by-step mitigation actions."],
    escalation: ["When and how to escalate."],
  },
  decision: {
    summary: ["One-line decision summary."],
    context: ["Describe the context and constraints."],
    alternatives: ["List alternatives considered."],
    decision: ["Record the chosen option."],
    consequences: ["Document expected trade-offs and impacts."],
  },
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null

const findPlaceholderProblems = (kind: DocKind, parsed: unknown): string[] => {
  const doc = asRecord(parsed)
  if (!doc) return []

  const checks = PLACEHOLDER_TEXT_BY_KIND[kind]
  const problems: string[] = []
  const seen = new Set<string>()

  for (const [field, placeholders] of Object.entries(checks)) {
    const value = doc[field]
    if (value === undefined || value === null) continue

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
          const yamlPath = resolve(docsPath, doc.filePath)
          let yamlContent: string | null = null

          if (!existsSync(yamlPath)) {
            issues.push({
              docName: doc.name,
              kind: "hash_drift",
              problems: [`YAML file missing on disk: ${doc.filePath}`],
            })
          } else {
            yamlContent = readFileSync(yamlPath, "utf8")
            const currentHash = computeDocHash(yamlContent)
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

          if (yamlContent !== null) {
            const parsedResult = yield* Effect.try({
              try: () => parseYaml(yamlContent) as unknown,
              catch: () => new Error("Invalid YAML"),
            }).pipe(Effect.either)

            if (parsedResult._tag === "Left") {
              issues.push({
                docName: doc.name,
                kind: "placeholder",
                problems: ["Unable to parse YAML for placeholder health checks."],
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
        const doc = yield* svc.create({
          kind: payload.kind as DocKind,
          name: payload.name,
          title: payload.title,
          content: payload.yamlContent,
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
        const doc = yield* svc.update(name, payload.yamlContent)
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

        let yamlContent: string | null = null
        let renderedContent: string | null = null

        const config = readTxConfig()
        const docsPath = resolve(config.docs.path)

        // Resolve subdirectory for this doc kind
        const kindSubdir = doc.kind === "overview" ? "" :
          doc.kind === "requirement" ? "requirements" :
          doc.kind === "system_design" ? "system-design" :
          doc.kind
        const yamlRel = kindSubdir ? `${kindSubdir}/${doc.name}.yml` : `${doc.name}.yml`
        const yamlPath = resolve(docsPath, yamlRel)

        if (existsSync(yamlPath)) {
          yamlContent = readFileSync(yamlPath, "utf8")
        }

        // Try to read rendered MD file
        const mdRel = kindSubdir ? `${kindSubdir}/${doc.name}.md` : `${doc.name}.md`
        const mdPath = resolve(docsPath, mdRel)

        if (existsSync(mdPath)) {
          renderedContent = readFileSync(mdPath, "utf8")
        }

        return {
          name: doc.name,
          filePath: doc.filePath,
          yamlContent,
          renderedContent,
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
