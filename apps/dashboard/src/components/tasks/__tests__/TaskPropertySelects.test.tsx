import { describe, it, expect } from "vitest"
import {
  autoTaskLabelColor,
  canonicalTaskLabelName,
  toHumanTaskStage,
} from "../TaskPropertySelects"

describe("TaskPropertySelects helpers", () => {
  it("maps task status values to their canonical values", () => {
    expect(toHumanTaskStage("done")).toBe("done")
    expect(toHumanTaskStage("backlog")).toBe("backlog")
    expect(toHumanTaskStage("active")).toBe("active")
    expect(toHumanTaskStage("ready")).toBe("ready")
    expect(toHumanTaskStage("planning")).toBe("planning")
    expect(toHumanTaskStage("blocked")).toBe("blocked")
    expect(toHumanTaskStage("review")).toBe("review")
    expect(toHumanTaskStage("human_needs_to_review")).toBe("human_needs_to_review")
    expect(toHumanTaskStage("unknown_status")).toBe("backlog")
  })

  it("creates deterministic auto label colors", () => {
    const first = autoTaskLabelColor("performance")
    const second = autoTaskLabelColor("performance")

    expect(first).toBe(second)
    expect(first).toMatch(/^#/) 
  })

  it("normalizes and canonicalizes label names", () => {
    expect(canonicalTaskLabelName("   devofps   ")).toBe("DevOps")
    expect(canonicalTaskLabelName(" needs   review ")).toBe("needs review")
  })
})
