import { Effect, Schema } from "effect"
import { DocService } from "./doc-service.js"
import { SpecTraceService } from "./spec-trace-service.js"
import { DecisionService } from "./decision-service.js"

export const SpecHealthSchema = Schema.Struct({
  status: Schema.Literal("synced", "drifting", "broken"),
  specTest: Schema.Struct({
    total: Schema.Number, covered: Schema.Number, uncovered: Schema.Number,
    coveragePercent: Schema.Number, passing: Schema.Number, failing: Schema.Number,
    untested: Schema.Number, docsComplete: Schema.Number, docsHarden: Schema.Number, docsBuild: Schema.Number,
  }),
  decisions: Schema.Struct({ pending: Schema.Number, approvedUnsynced: Schema.Number, total: Schema.Number }),
  docDrift: Schema.Struct({ driftedDocs: Schema.Number, totalDocs: Schema.Number }),
  docs: Schema.Array(Schema.Struct({ name: Schema.String, phase: Schema.String, gaps: Schema.Number, drift: Schema.Array(Schema.String) })),
})
export type SpecHealth = typeof SpecHealthSchema.Type

/** @spec INV-LEAN-004 Read failures propagate; unavailable evidence never becomes healthy. */
export const getSpecHealth = () => Effect.gen(function* () {
  const docService = yield* DocService
  const specService = yield* SpecTraceService
  const decisionService = yield* DecisionService
  const docs = yield* docService.list()
  const decisions = yield* decisionService.list({})
  const fci = yield* specService.fci()
  const invariants = yield* docService.listInvariants({})
  const activeDocIds = new Set(invariants.filter(i => i.status === "active").map(i => i.docId))
  const statuses = []
  for (const doc of docs) {
    let status = yield* specService.status({ doc: doc.docId })
    // Keep legacy name-based sign-offs valid only when the name is unambiguous.
    if (status.phase === "HARDEN" && docs.filter(d => d.name === doc.name).length === 1) {
      const legacy = yield* specService.status({ doc: doc.name })
      if (legacy.phase === "COMPLETE") status = legacy
    }
    const drift = yield* docService.detectDrift(`${doc.kind}/${doc.name}`)
    statuses.push({ name: `${doc.kind}/${doc.name}`, phase: status.phase, gaps: status.gaps, drift: [...drift], hasInvariants: activeDocIds.has(doc.id) })
  }
  const pending = decisions.filter(d => d.status === "pending").length
  const approvedUnsynced = decisions.filter(d => (d.status === "approved" || d.status === "edited") && !d.syncedToDoc).length
  const driftedDocs = statuses.filter(d => d.drift.length > 0).length
  return {
    status: fci.failing > 0 || driftedDocs > docs.length / 2 ? "broken" as const : driftedDocs > 0 || pending > 0 || approvedUnsynced > 0 || fci.uncovered > 0 || fci.untested > 0 || statuses.some(d => d.hasInvariants && d.phase !== "COMPLETE") ? "drifting" as const : "synced" as const,
    specTest: { total: fci.total, covered: fci.covered, uncovered: fci.uncovered,
      coveragePercent: fci.total > 0 ? Math.round(fci.covered / fci.total * 100) : 0,
      passing: fci.passing, failing: fci.failing, untested: fci.untested,
      docsComplete: statuses.filter(d => d.hasInvariants && d.phase === "COMPLETE").length,
      docsHarden: statuses.filter(d => d.hasInvariants && d.phase === "HARDEN").length,
      docsBuild: statuses.filter(d => d.hasInvariants && d.phase === "BUILD").length },
    decisions: { pending, approvedUnsynced, total: decisions.length },
    docDrift: { driftedDocs, totalDocs: docs.length },
    docs: statuses,
  } satisfies SpecHealth
})
