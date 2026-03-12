/**
 * Triangle health command: aggregates spec-test coverage,
 * decision status, and doc drift into a single view.
 */

import { Effect } from "effect"
import { DecisionService, DocService, SpecTraceService } from "@jamesaphoenix/tx-core"
import { toJson } from "../output.js"
import { type Flags, flag } from "../utils/parse.js"

type TriangleHealth = {
  status: "synced" | "drifting" | "broken"
  specTest: {
    total: number
    covered: number
    uncovered: number
    coveragePercent: number
    passing: number
    failing: number
    untested: number
    docsComplete: number
    docsHarden: number
    docsBuild: number
  }
  decisions: {
    pending: number
    approvedUnsynced: number
    total: number
  }
  docDrift: {
    driftedDocs: number
    totalDocs: number
  }
}

export const triangle = (_pos: string[], flags: Flags): Effect.Effect<void, unknown, unknown> =>
  Effect.gen(function* () {
    const decisionSvc = yield* DecisionService
    const docSvc = yield* DocService
    const specTraceSvc = yield* SpecTraceService

    // 1. Decision status
    const allDecisions = yield* decisionSvc.list({})
    const pending = allDecisions.filter(d => d.status === "pending").length
    const approvedUnsynced = allDecisions.filter(
      d => (d.status === "approved" || d.status === "edited") && !d.syncedToDoc
    ).length

    // 2. Doc drift — count docs with hash mismatch
    const docs = yield* docSvc.list()
    const invariants = yield* docSvc.listInvariants({}).pipe(
      Effect.catchTag("DatabaseError", () => Effect.succeed([]))
    )
    let driftedDocs = 0
    for (const doc of docs) {
      const driftDetails = yield* docSvc.detectDrift(doc.name).pipe(
        Effect.catchTag("DocNotFoundError", () => Effect.succeed([] as string[])),
        Effect.catchTag("DatabaseError", () => Effect.succeed([] as string[]))
      )
      if (driftDetails.length > 0) {
        driftedDocs++
      }
    }

    // 3. Spec-test coverage via spec trace mappings
    const specCoverage = yield* specTraceSvc.fci().pipe(
      Effect.map((summary) => ({
        total: summary.total,
        covered: summary.covered,
        uncovered: summary.uncovered,
        passing: summary.passing,
        failing: summary.failing,
        untested: summary.untested,
      })),
      Effect.catchTag("DatabaseError", () => Effect.succeed({
        total: 0,
        covered: 0,
        uncovered: 0,
        passing: 0,
        failing: 0,
        untested: 0,
      }))
    )
    const docsWithActiveInvariants = new Set(
      invariants
        .filter((inv) => inv.status === "active")
        .map((inv) => inv.docId)
    )

    let docsComplete = 0
    let docsHarden = 0
    let docsBuild = 0
    for (const doc of docs) {
      if (!docsWithActiveInvariants.has(doc.id)) continue

      const docStatus = yield* specTraceSvc.status({ doc: doc.name }).pipe(
        Effect.catchTag("DatabaseError", () =>
          Effect.succeed({
            phase: "BUILD" as const,
            fci: 0,
            gaps: 0,
            total: 0,
          })
        )
      )

      if (docStatus.phase === "COMPLETE") {
        docsComplete += 1
      } else if (docStatus.phase === "HARDEN") {
        docsHarden += 1
      } else {
        docsBuild += 1
      }
    }
    const totalInvariants = specCoverage.total
    const coveredInvariants = specCoverage.covered

    const coveragePercent = totalInvariants > 0
      ? Math.round((coveredInvariants / totalInvariants) * 100)
      : 100

    // 4. Determine overall status
    let status: TriangleHealth["status"] = "synced"
    const allSpecDocsClosed = docsBuild === 0 && docsHarden === 0
    if (specCoverage.failing > 0 || driftedDocs > docs.length / 2) {
      status = "broken"
    } else if (pending > 0 || approvedUnsynced > 0 || driftedDocs > 0 || !allSpecDocsClosed) {
      status = "drifting"
    }

    const health: TriangleHealth = {
      status,
      specTest: {
        total: totalInvariants,
        covered: coveredInvariants,
        uncovered: specCoverage.uncovered,
        coveragePercent,
        passing: specCoverage.passing,
        failing: specCoverage.failing,
        untested: specCoverage.untested,
        docsComplete,
        docsHarden,
        docsBuild,
      },
      decisions: {
        pending,
        approvedUnsynced,
        total: allDecisions.length,
      },
      docDrift: {
        driftedDocs,
        totalDocs: docs.length,
      },
    }

    if (flag(flags, "json")) {
      console.log(toJson(health))
      return
    }

    // Human-readable output
    const statusLabel = health.status.toUpperCase()
    console.log(`Spec Health: ${statusLabel}`)
    console.log("")

    // Spec-test coverage
    if (totalInvariants > 0) {
      console.log(
        `  Spec -> Test:  ${coveredInvariants}/${totalInvariants} invariants have tests (${coveragePercent}%)`
      )
      console.log(
        `  Spec State:   ${specCoverage.passing} passing, ${specCoverage.failing} failing, ${specCoverage.untested} untested, ${specCoverage.uncovered} uncovered`
      )
      console.log(
        `  Doc Closure:  ${docsComplete} COMPLETE, ${docsHarden} HARDEN, ${docsBuild} BUILD`
      )
    } else {
      console.log("  Spec -> Test:  No invariants defined")
    }

    // Decision status
    const decParts: string[] = []
    if (pending > 0) decParts.push(`${pending} pending`)
    if (approvedUnsynced > 0) decParts.push(`${approvedUnsynced} approved-unsynced`)
    if (decParts.length > 0) {
      console.log(`  Decisions:    ${decParts.join(", ")}`)
    } else if (allDecisions.length > 0) {
      console.log(`  Decisions:    All ${allDecisions.length} synced`)
    } else {
      console.log("  Decisions:    None captured")
    }

    // Doc drift
    if (docs.length > 0) {
      console.log(
        `  Doc Drift:    ${driftedDocs} of ${docs.length} docs with hash mismatch`
      )
    } else {
      console.log("  Doc Drift:    No docs")
    }

    // Doc hierarchy summary
    const kindCounts = new Map<string, number>()
    for (const doc of docs) {
      kindCounts.set(doc.kind, (kindCounts.get(doc.kind) ?? 0) + 1)
    }
    if (kindCounts.size > 0) {
      const parts: string[] = []
      const order = ["requirement", "prd", "design", "system_design", "overview"]
      for (const k of order) {
        const c = kindCounts.get(k)
        if (c) {
          const abbr = k === "requirement" ? "REQ" :
            k === "system_design" ? "SD" :
              k === "design" ? "DD" :
                k.toUpperCase()
          parts.push(`${c} ${abbr}`)
        }
      }
      if (parts.length > 0) {
        console.log("")
        console.log(`  Doc hierarchy: ${parts.join(" -> ")}`)
      }
    }
  })
