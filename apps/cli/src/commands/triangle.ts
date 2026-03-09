/**
 * Triangle health command: aggregates spec-test coverage,
 * decision status, and doc drift into a single view.
 */

import { Effect } from "effect"
import { DecisionService, DocService } from "@jamesaphoenix/tx-core"
import type { Invariant } from "@jamesaphoenix/tx-types"
import { toJson } from "../output.js"
import { type Flags, flag } from "../utils/parse.js"

type TriangleHealth = {
  status: "synced" | "drifting" | "broken"
  specTest: {
    total: number
    covered: number
    uncovered: number
    coveragePercent: number
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

    // 1. Decision status
    const allDecisions = yield* decisionSvc.list({})
    const pending = allDecisions.filter(d => d.status === "pending").length
    const approvedUnsynced = allDecisions.filter(
      d => (d.status === "approved" || d.status === "edited") && !d.syncedToDoc
    ).length

    // 2. Doc drift — count docs with hash mismatch
    const docs = yield* docSvc.list()
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

    // 3. Spec-test coverage via active invariants (exclude deprecated)
    const allInvariants = yield* docSvc.listInvariants({}).pipe(
      Effect.catchTag("DatabaseError", () => Effect.succeed([] as Invariant[]))
    )
    const invariants = allInvariants.filter(
      (inv: { status: string }) => inv.status === "active"
    )
    const totalInvariants = invariants.length
    // Count invariants that have a testRef (linked to a test)
    const coveredInvariants = invariants.filter(
      (inv: { testRef: string | null }) => inv.testRef != null && inv.testRef !== ""
    ).length

    const coveragePercent = totalInvariants > 0
      ? Math.round((coveredInvariants / totalInvariants) * 100)
      : 100

    // 4. Determine overall status
    let status: TriangleHealth["status"] = "synced"
    if (pending > 0 || approvedUnsynced > 0 || driftedDocs > 0 || coveragePercent < 100) {
      status = "drifting"
    }
    if (driftedDocs > docs.length / 2 || (totalInvariants > 0 && coveragePercent < 50)) {
      status = "broken"
    }

    const health: TriangleHealth = {
      status,
      specTest: {
        total: totalInvariants,
        covered: coveredInvariants,
        uncovered: totalInvariants - coveredInvariants,
        coveragePercent,
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
    console.log(`Triangle Health: ${statusLabel}`)
    console.log("")

    // Spec-test coverage
    if (totalInvariants > 0) {
      console.log(
        `  Spec -> Test:  ${coveredInvariants}/${totalInvariants} invariants have tests (${coveragePercent}%)`
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
