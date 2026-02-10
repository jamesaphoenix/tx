/**
 * Doc Route Handlers
 *
 * Implements docs-as-primitives endpoint handlers (DD-023).
 * YAML-on-disk doc management with DB metadata, linking, and invariant sync.
 */

import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"
import { readFileSync, existsSync } from "node:fs"
import { DocService } from "@jamesaphoenix/tx-core"
import { TxApi, mapCoreError } from "../api.js"

// -----------------------------------------------------------------------------
// Handler Layer
// -----------------------------------------------------------------------------

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

    .handle("createDoc", ({ payload }) =>
      Effect.gen(function* () {
        const svc = yield* DocService
        const doc = yield* svc.create({
          kind: payload.kind as "overview" | "prd" | "design",
          name: payload.name,
          title: payload.title,
          yamlContent: payload.yamlContent,
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

    .handle("getDocGraph", () =>
      Effect.gen(function* () {
        const svc = yield* DocService
        return yield* svc.getDocGraph()
      }).pipe(Effect.mapError(mapCoreError))
    )
)
