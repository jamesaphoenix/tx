import type { AnchorServiceDeps } from "./anchor-service-deps.js"
import { createAnchorCoreOps } from "./anchor-service-core-ops.js"
import { createAnchorStateOps } from "./anchor-service-state-ops.js"
import { createAnchorVerificationOps } from "./anchor-service-verification-ops.js"

export const createAnchorServiceOps = (deps: AnchorServiceDeps) => ({
  ...createAnchorCoreOps(deps),
  ...createAnchorStateOps(deps),
  ...createAnchorVerificationOps(deps)
})
