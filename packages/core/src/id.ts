import { Effect } from "effect"
import { randomBytes, createHash } from "crypto"

export const generateTaskId = (): Effect.Effect<string> =>
  Effect.sync(() => {
    const random = randomBytes(16).toString("hex")
    const timestamp = Date.now().toString(36)
    const hash = createHash("sha256")
      .update(timestamp + random)
      .digest("hex")
      .substring(0, 8)
    return `tx-${hash}`
  })

export const deterministicId = (seed: string): string => {
  const hash = createHash("sha256")
    .update(`fixture:${seed}`)
    .digest("hex")
    .substring(0, 8)
  return `tx-${hash}`
}
