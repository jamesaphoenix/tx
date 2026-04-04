---
tags: [learning]
created: "2026-03-29T20:11:54.683Z"
file_pattern: "apps/dashboard/server/*.ts"
source_type: manual
---

# To bridge EffectTS services into Hono 7cbe01

To bridge Effect-TS services into Hono dashboard routes, use a withSupervision<A>() pattern: lazy layer via getSupervisionLayer(makeMinimalLayer), Effect.gen to yield* the service tag, then Effect.provide(layer) + Effect.runPromise. Keep the fn param typed as (svc: {...}) => Effect.Effect<A, any, never> to avoid R-constraint issues with Effect.provide.
