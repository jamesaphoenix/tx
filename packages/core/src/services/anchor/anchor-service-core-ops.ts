import { Effect } from "effect"
import { AnchorNotFoundError, LearningNotFoundError } from "../../errors.js"
import type { AnchorServiceDeps } from "./anchor-service-deps.js"
import { validateAnchorInput } from "./anchor-service-validation.js"

export const createAnchorCoreOps = ({ anchorRepo, learningRepo }: AnchorServiceDeps) => ({
  createAnchor: (input: Parameters<typeof validateAnchorInput>[0]) =>
    Effect.gen(function* () {
      const validatedInput = yield* validateAnchorInput(input)

      const learning = yield* learningRepo.findById(input.learningId)
      if (!learning) {
        return yield* Effect.fail(new LearningNotFoundError({ id: input.learningId }))
      }

      return yield* anchorRepo.create(validatedInput)
    }),

  findAnchorsForFile: (filePath: string) => anchorRepo.findByFilePath(filePath),

  findAnchorsForLearning: (learningId: number) => anchorRepo.findByLearningId(learningId),

  get: (id: number) =>
    Effect.gen(function* () {
      const anchor = yield* anchorRepo.findById(id)
      if (!anchor) {
        return yield* Effect.fail(new AnchorNotFoundError({ id }))
      }
      return anchor
    }),

  findDrifted: () => anchorRepo.findDrifted(),

  findInvalid: () => anchorRepo.findInvalid(),

  prune: (olderThanDays: number) =>
    Effect.gen(function* () {
      const deleted = yield* anchorRepo.deleteOldInvalid(olderThanDays)
      return { deleted }
    }),

  getStatus: () =>
    Effect.gen(function* () {
      const summary = yield* anchorRepo.getStatusSummary()
      const recentInvalidations = yield* anchorRepo.getInvalidationLogs()

      return {
        total: summary.total,
        valid: summary.valid,
        drifted: summary.drifted,
        invalid: summary.invalid,
        pinned: summary.pinned,
        recentInvalidations: recentInvalidations.slice(0, 10)
      }
    })
})
