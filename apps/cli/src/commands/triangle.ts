import { Effect } from "effect"
import { getSpecHealth } from "@jamesaphoenix/tx"
import { toJson } from "../output.js"
import { flag, type Flags } from "../utils/parse.js"
export const triangle = (_pos: string[], flags: Flags) => Effect.gen(function* () {
  const health = yield* getSpecHealth()
  if (flag(flags, "json")) { console.log(toJson(health)); return }
  console.log('Spec Health: ' + health.status)
  console.log('Invariants: ' + health.specTest.total + ', unmapped: ' + health.specTest.uncovered + ', missing results: ' + health.specTest.untested + ', failing: ' + health.specTest.failing)
  console.log('Doc Drift: ' + health.docDrift.totalDocs + ', drifting: ' + health.docDrift.driftedDocs + ', complete: ' + health.specTest.docsComplete)
})
