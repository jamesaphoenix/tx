import { Effect } from "effect"
import {
  DecomposeService,
} from "@jamesaphoenix/tx"
import {
  AGENT_RUNTIMES,
  serializeDecomposeResult,
} from "@jamesaphoenix/tx/types"
import type { AgentRuntime } from "@jamesaphoenix/tx/types"
import { CliExitError } from "../cli-exit.js"
import { toJson } from "../output.js"
import { type Flags, flag, opt, parseIntOpt, parseTaskId } from "../utils/parse.js"

const cliExit = (code: number, message: string) =>
  Effect.sync(() => {
    console.error(message)
    throw new CliExitError(code)
  })

function printPlanSummary(result: ReturnType<typeof serializeDecomposeResult>): void {
  console.log(`Decomposition plan for ${result.doc.name}`)
  console.log(`  Root: ${result.rootTaskPreview.title}`)
  console.log(`  Tasks: ${result.plan.tasks.length}`)
  if (result.rationale) {
    console.log(`  Rationale: ${result.rationale}`)
  }
  for (const task of result.plan.tasks) {
    const parent = task.parentLocalId ? ` parent=${task.parentLocalId}` : ""
    const deps = task.dependsOn.length > 0 ? ` deps=${task.dependsOn.join(",")}` : ""
    console.log(`  - ${task.localId}: ${task.title} [${task.score}]${parent}${deps}`)
  }
}

function printMaterializedSummary(result: ReturnType<typeof serializeDecomposeResult>): void {
  console.log(`Created task graph for ${result.doc.name}`)
  console.log(`  Root: ${result.rootTask?.id} (${result.rootTask?.title})`)
  console.log(`  Generated tasks: ${result.createdTasks.length}`)
  if (result.rationale) {
    console.log(`  Rationale: ${result.rationale}`)
  }
  for (const item of result.createdTasks) {
    const deps = item.dependsOn.length > 0 ? ` deps=${item.dependsOn.join(",")}` : ""
    console.log(`  - ${item.taskId}: ${item.title} [local=${item.localId}]${deps}`)
  }
}

export const decompose = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const docRef = pos[0]
    if (!docRef) {
      console.error("Usage: tx decompose <design-doc-ref> [--parent <task-id>] [--runtime <runtime>] [--model <name>] [--max-tasks <n>] [--root-title <text>] [--score <n>] [--dry-run] [--json]")
      throw new CliExitError(1)
    }

    const runtimeRaw = opt(flags, "runtime") ?? "auto"
    if (!(AGENT_RUNTIMES as readonly string[]).includes(runtimeRaw)) {
      console.error(`Error: invalid --runtime "${runtimeRaw}". Must be one of: ${AGENT_RUNTIMES.join(", ")}`)
      throw new CliExitError(1)
    }

    const parentTaskIdRaw = opt(flags, "parent", "p")
    const parentTaskId = parentTaskIdRaw ? parseTaskId(parentTaskIdRaw) : null
    const maxTasks = parseIntOpt(flags, "max-tasks", "max-tasks")
    const rootScore = parseIntOpt(flags, "score", "score")
    const dryRun = flag(flags, "dry-run")
    const jsonOutput = flag(flags, "json")

    const svc = yield* DecomposeService
    const result = yield* svc.run({
      docRef,
      parentTaskId,
      runtime: runtimeRaw as AgentRuntime,
      model: opt(flags, "model") ?? null,
      maxTasks: maxTasks ?? undefined,
      rootTitle: opt(flags, "root-title") ?? null,
      rootScore: rootScore ?? null,
      dryRun,
    }).pipe(
      Effect.catchTags({
        ValidationError: (error) => cliExit(1, error.reason),
        GuardExceededError: (error) => cliExit(1, error.message),
        DocNotFoundError: (error) => cliExit(2, `Doc not found: ${error.name}`),
        TaskNotFoundError: (error) => cliExit(2, `Task not found: ${error.id}`),
      })
    )

    const payload = serializeDecomposeResult(result)
    if (jsonOutput) {
      console.log(toJson(payload))
      return
    }

    if (payload.dryRun) {
      printPlanSummary(payload)
      return
    }

    printMaterializedSummary(payload)
  })
