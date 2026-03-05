import { Context } from "effect"
import { AnchorRepository } from "../../repo/anchor-repo.js"
import { LearningRepository } from "../../repo/learning-repo.js"

export type AnchorRepo = Context.Tag.Service<typeof AnchorRepository>
export type LearningRepo = Context.Tag.Service<typeof LearningRepository>

export type AnchorServiceDeps = {
  readonly anchorRepo: AnchorRepo
  readonly learningRepo: LearningRepo
}
