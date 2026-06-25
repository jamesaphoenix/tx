import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Context, Effect, JSONSchema, Layer, Schema } from "effect"
import type {
  DecomposeRequest,
  DecomposeResult,
  DecompositionPlan,
  DecompositionTask,
  Doc,
  MaterializedDecomposeTask,
  TaskId,
  TaskWithDeps,
} from "../types/index.js"
import {
  DecomposeRequestSchema,
  DecompositionPlanSchema,
} from "../types/index.js"
import { AgentService } from "./agent-service.js"
import { DependencyService } from "./dep-service.js"
import { DocService } from "./doc-service.js"
import { TaskService } from "./task-service.js"
import {
  AgentError,
  CircularDependencyError,
  DatabaseError,
  DocNotFoundError,
  GuardExceededError,
  TaskNotFoundError,
  ValidationError,
} from "../errors.js"
import { readTxConfig } from "../utils/toml-config.js"

const SANITY_MAX_TASKS = 200
const DEFAULT_ROOT_SCORE = 800

const failValidation = (reason: string) =>
  Effect.fail(new ValidationError({ reason }))

const assertPositiveInteger = (
  name: string,
  value: number | null | undefined
): Effect.Effect<void, ValidationError> => {
  if (value == null) {
    return Effect.void
  }
  if (!Number.isInteger(value) || value < 1) {
    return failValidation(`Invalid ${name}: ${value}. Must be a positive integer.`)
  }
  return Effect.void
}

const ensureDesignDoc = (doc: Doc): Effect.Effect<Doc, ValidationError> =>
  doc.kind === "design"
    ? Effect.succeed(doc)
    : failValidation(`tx decompose requires a design doc, got '${doc.kind}' for '${doc.name}'.`)

const loadDocMarkdown = (doc: Doc): Effect.Effect<string, ValidationError> =>
  Effect.try({
    try: () => {
      const config = readTxConfig()
      const docPath = resolve(config.docs.path, doc.filePath)
      if (!existsSync(docPath)) {
        throw new ValidationError({ reason: `Doc source file not found: ${docPath}` })
      }
      return readFileSync(docPath, "utf-8")
    },
    catch: (error) =>
      error instanceof ValidationError
        ? error
        : new ValidationError({ reason: String(error) }),
  })

const buildPrompt = (
  doc: Doc,
  markdown: string,
  parentTask: TaskWithDeps | null,
  maxTasks: number | null
): string => {
  const parentBlock = parentTask
    ? [
        "## Existing Root Task",
        JSON.stringify({
          id: parentTask.id,
          title: parentTask.title,
          description: parentTask.description,
          status: parentTask.status,
          blockedBy: parentTask.blockedBy,
          blocks: parentTask.blocks,
          children: parentTask.children,
          linkedDocs: parentTask.linkedDocs.map((linked) => ({
            docId: linked.docId,
            name: linked.name,
            linkType: linked.linkType,
          })),
        }, null, 2),
        "",
      ].join("\n")
    : ""

  return [
    "You are decomposing a tx design spec into an explicit task graph.",
    "",
    "Return only JSON matching the provided schema.",
    maxTasks != null
      ? `Create between 1 and ${maxTasks} tasks.`
      : "Create as many tasks as the design doc warrants. Each task should be atomic enough for a single agent iteration.",
    "",
    "Rules:",
    "- Tasks must be atomic enough for a single agent iteration.",
    "- Prefer concrete implementation, test, and documentation tasks over vague phases.",
    "- Include verification or integration-test tasks when behavior changes are implied.",
    "- Use parentLocalId for hierarchy and dependsOn for execution order.",
    "- Do not create dependency cycles or self references.",
    "- The root task should represent the umbrella implementation for the design doc.",
    "",
    "## Design Doc Metadata",
    JSON.stringify({
      docId: doc.docId,
      name: doc.name,
      title: doc.title,
      kind: doc.kind,
      filePath: doc.filePath,
    }, null, 2),
    "",
    parentBlock,
    "## Design Doc Markdown",
    markdown,
  ].join("\n")
}

const decodePlan = (
  rawPlan: Record<string, unknown> | null
): Effect.Effect<DecompositionPlan, ValidationError> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(DecompositionPlanSchema)(rawPlan ?? {}),
    catch: (error) =>
      new ValidationError({
        reason: `Runtime returned invalid decomposition output: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }),
  })

const validatePlan = (
  plan: DecompositionPlan,
  maxTasks: number | null
): Effect.Effect<Map<string, DecompositionTask>, ValidationError> =>
  Effect.gen(function* () {
    if (plan.tasks.length === 0) {
      return yield* failValidation("Decomposition plan returned no tasks.")
    }
    const effectiveMax = maxTasks ?? SANITY_MAX_TASKS
    if (plan.tasks.length > effectiveMax) {
      return yield* failValidation(
        maxTasks != null
          ? `Decomposition plan returned ${plan.tasks.length} tasks, exceeding maxTasks ${maxTasks}.`
          : `Decomposition plan returned ${plan.tasks.length} tasks, exceeding sanity limit ${SANITY_MAX_TASKS}. Use --max-tasks to set an explicit cap.`
      )
    }

    const byLocalId = new Map<string, DecompositionTask>()
    for (const task of plan.tasks) {
      const localId = task.localId.trim()
      const title = task.title.trim()
      if (!localId) {
        return yield* failValidation("Decomposition plan contained an empty localId.")
      }
      if (!title) {
        return yield* failValidation(`Decomposition plan task '${localId}' has an empty title.`)
      }
      if (byLocalId.has(localId)) {
        return yield* failValidation(`Decomposition plan contains duplicate localId '${localId}'.`)
      }
      byLocalId.set(localId, {
        ...task,
        localId,
        title,
        description: task.description.trim(),
      })
    }

    for (const task of byLocalId.values()) {
      const parentLocalId = task.parentLocalId?.trim() ?? null
      if (parentLocalId) {
        if (!byLocalId.has(parentLocalId)) {
          return yield* failValidation(
            `Task '${task.localId}' references unknown parentLocalId '${task.parentLocalId}'.`
          )
        }
        if (parentLocalId === task.localId) {
          return yield* failValidation(`Task '${task.localId}' cannot use itself as parentLocalId.`)
        }
      }

      for (const dep of task.dependsOn) {
        const trimmedDep = dep.trim()
        if (!byLocalId.has(trimmedDep)) {
          return yield* failValidation(`Task '${task.localId}' depends on unknown localId '${dep}'.`)
        }
        if (trimmedDep === task.localId) {
          return yield* failValidation(`Task '${task.localId}' cannot depend on itself.`)
        }
      }
    }

    const parentState = new Map<string, "visiting" | "done">()
    const visitParent = (localId: string): Effect.Effect<void, ValidationError> =>
      Effect.gen(function* () {
        const state = parentState.get(localId)
        if (state === "done") return
        if (state === "visiting") {
          return yield* failValidation(`Parent hierarchy cycle detected at '${localId}'.`)
        }
        parentState.set(localId, "visiting")
        const parentLocalId = byLocalId.get(localId)?.parentLocalId?.trim()
        if (parentLocalId) {
          yield* visitParent(parentLocalId)
        }
        parentState.set(localId, "done")
      })

    for (const localId of byLocalId.keys()) {
      yield* visitParent(localId)
    }

    const depState = new Map<string, "visiting" | "done">()
    const visitDep = (localId: string): Effect.Effect<void, ValidationError> =>
      Effect.gen(function* () {
        const state = depState.get(localId)
        if (state === "done") return
        if (state === "visiting") {
          return yield* failValidation(`Dependency cycle detected at '${localId}'.`)
        }
        depState.set(localId, "visiting")
        for (const dep of byLocalId.get(localId)?.dependsOn ?? []) {
          yield* visitDep(dep.trim())
        }
        depState.set(localId, "done")
      })

    for (const localId of byLocalId.keys()) {
      yield* visitDep(localId)
    }

    return byLocalId
  })

export type DecomposeError =
  | AgentError
  | ValidationError
  | TaskNotFoundError
  | DocNotFoundError
  | DatabaseError
  | GuardExceededError
  | CircularDependencyError

export class DecomposeService extends Context.Tag("DecomposeService")<
  DecomposeService,
  {
    readonly run: (input: DecomposeRequest) => Effect.Effect<DecomposeResult, DecomposeError>
  }
>() {}

export const DecomposeServiceLive = Layer.effect(
  DecomposeService,
  Effect.gen(function* () {
    const docSvc = yield* DocService
    const taskSvc = yield* TaskService
    const depSvc = yield* DependencyService
    const agentSvc = yield* AgentService

    return {
      run: (input) =>
        Effect.gen(function* () {
          const request = yield* Effect.try({
            try: () => Schema.decodeUnknownSync(DecomposeRequestSchema)(input),
            catch: (error) =>
              new ValidationError({
                reason: `Invalid decompose request: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              }),
          })

          yield* assertPositiveInteger("maxTasks", request.maxTasks)
          yield* assertPositiveInteger("rootScore", request.rootScore ?? undefined)

          const runtime = request.runtime ?? "auto"
          const model = request.model?.trim() || null
          const maxTasks = request.maxTasks ?? null
          const rootTitleOverride = request.rootTitle?.trim() || null
          const rootScoreOverride = request.rootScore ?? null
          const dryRun = request.dryRun ?? false
          const parentTaskId = request.parentTaskId ?? null

          const doc = yield* docSvc.get(request.docRef).pipe(
            Effect.flatMap(ensureDesignDoc)
          )
          const markdown = yield* loadDocMarkdown(doc)
          const parentTask = parentTaskId ? yield* taskSvc.getWithDeps(parentTaskId) : null

          const agentResult = yield* agentSvc.run({
            prompt: buildPrompt(doc, markdown, parentTask, maxTasks),
            options: {
              runtime,
              model: model ?? undefined,
              outputFormat: {
                type: "json_schema",
                schema: JSONSchema.make(DecompositionPlanSchema) as unknown as Record<string, unknown>,
              },
            },
          })

          const plan = yield* decodePlan(agentResult.structuredOutput)
          const taskMap = yield* validatePlan(plan, maxTasks)

          const rootTaskTitle = rootTitleOverride || plan.rootTask.title.trim()
          const rootTaskDescription = plan.rootTask.description.trim()
          const rootTaskScore = rootScoreOverride ?? plan.rootTask.score ?? DEFAULT_ROOT_SCORE

          if (!rootTaskTitle) {
            return yield* failValidation("Decomposition plan root task has an empty title.")
          }

          const rootTaskPreview = {
            title: rootTaskTitle,
            description: rootTaskDescription,
            score: rootTaskScore,
            existingParentTaskId: parentTaskId,
          } as const

          if (dryRun) {
            return {
              dryRun: true,
              runtime,
              model,
              doc: {
                docId: doc.docId,
                name: doc.name,
                title: doc.title,
                kind: "design" as const,
                filePath: doc.filePath,
              },
              parentTaskId,
              rootTaskPreview,
              rootTask: null,
              plan,
              createdTasks: [],
              rationale: plan.rationale ?? null,
            }
          }

          let rootTask: TaskWithDeps
          if (parentTask) {
            rootTask = parentTask
          } else {
            const createdRoot = yield* taskSvc.create({
              title: rootTaskTitle,
              description: rootTaskDescription,
              score: rootTaskScore,
              metadata: {
                source: "tx-decompose",
                designDoc: doc.name,
                role: "root",
              },
            })
            rootTask = yield* taskSvc.getWithDeps(createdRoot.id)
          }

          const rootAlreadyLinked = rootTask.linkedDocs.some((linked) => linked.docId === doc.docId)
          if (!rootAlreadyLinked) {
            yield* docSvc.attachTask(rootTask.id, doc.name, "implements")
            rootTask = yield* taskSvc.getWithDeps(rootTask.id)
          }

          const created = new Map<string, MaterializedDecomposeTask>()
          const creating = new Set<string>()

          const createTaskRecursive = (localId: string): Effect.Effect<TaskId, DecomposeError> =>
            Effect.gen(function* () {
              const existing = created.get(localId)
              if (existing) return existing.taskId
              if (creating.has(localId)) {
                return yield* failValidation(`Internal hierarchy cycle while materializing '${localId}'.`)
              }
              creating.add(localId)

              const task = taskMap.get(localId)
              if (!task) {
                return yield* failValidation(`Internal error: missing task '${localId}' during materialization.`)
              }

              const parentTxId = task.parentLocalId
                ? yield* createTaskRecursive(task.parentLocalId.trim())
                : rootTask.id

              const createdTask = yield* taskSvc.create({
                title: task.title,
                description: task.description,
                parentId: parentTxId,
                score: task.score,
                metadata: {
                  source: "tx-decompose",
                  designDoc: doc.name,
                  localId,
                },
              })
              yield* docSvc.attachTask(createdTask.id, doc.name, "references")

              created.set(localId, {
                localId,
                taskId: createdTask.id,
                title: task.title,
                parentTaskId: parentTxId,
                dependsOn: [...task.dependsOn],
                score: task.score,
              })
              creating.delete(localId)
              return createdTask.id
            })

          for (const localId of taskMap.keys()) {
            yield* createTaskRecursive(localId)
          }

          for (const task of taskMap.values()) {
            const blockedTaskId = created.get(task.localId)?.taskId
            if (!blockedTaskId) {
              return yield* failValidation(`Internal error: task '${task.localId}' was not created.`)
            }
            for (const dep of task.dependsOn) {
              const blockerTaskId = created.get(dep.trim())?.taskId
              if (!blockerTaskId) {
                return yield* failValidation(`Internal error: dependency '${dep}' was not created.`)
              }
              yield* depSvc.addBlocker(blockedTaskId, blockerTaskId)
            }
          }

          const topLevelTaskIds = [...taskMap.values()]
            .filter((task) => task.parentLocalId == null || task.parentLocalId.trim().length === 0)
            .map((task) => task.localId)

          for (const localId of topLevelTaskIds) {
            const blockerTaskId = created.get(localId)?.taskId
            if (!blockerTaskId) continue
            yield* depSvc.addBlocker(rootTask.id, blockerTaskId)
          }

          rootTask = yield* taskSvc.getWithDeps(rootTask.id)

          return {
            dryRun: false,
            runtime,
            model,
            doc: {
              docId: doc.docId,
              name: doc.name,
              title: doc.title,
              kind: "design" as const,
              filePath: doc.filePath,
            },
            parentTaskId,
            rootTaskPreview,
            rootTask,
            plan,
            createdTasks: [...created.values()],
            rationale: plan.rationale ?? null,
          }
        }),
    }
  })
)
