import { describe, it, expect } from "vitest"
import {
  autoTaskLabelColor,
  canonicalTaskLabelName,
  toHumanTaskStage,
} from "../TaskPropertySelects"

describe("TaskPropertySelects helpers", () => {
  it("maps task status values to human stages", () => {
    expect(toHumanTaskStage("done")).toBe("done")
    expect(toHumanTaskStage("backlog")).toBe("backlog")
    expect(toHumanTaskStage("active")).toBe("in_progress")
    expect(toHumanTaskStage("ready")).toBe("in_progress")
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
