import { Effect } from "effect"
import { buildSchemaPayload } from "../help-registry.js"
import { toJson } from "../output.js"

export const schema = (pos: string[]) =>
  Effect.sync(() => {
    console.log(toJson(buildSchemaPayload(pos)))
  })
