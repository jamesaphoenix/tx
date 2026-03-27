import { Effect } from "effect"
import { commandHelp } from "../help.js"
import { type Flags, flag, opt } from "../utils/parse.js"
import { CliUserError, unknownSubcommandError, validationError } from "../cli-errors.js"
import { formatSkillGenerationResult, generateSkillBundles, type SkillTargetSelection } from "../skills/generate.js"
import { formatSkillSyncResult, syncSkillBundles } from "../skills/sync.js"

function parseTarget(flags: Flags): Effect.Effect<SkillTargetSelection, CliUserError> {
  const target = opt(flags, "target", "t") ?? "all"
  if (target === "all" || target === "claude" || target === "codex") {
    return Effect.succeed(target)
  }

  return Effect.fail(validationError({
    code: "cli/invalid-flag-value",
    command: "skills",
    message: `Invalid --target value: ${target}.`,
    hint: "Expected one of: all, claude, codex.",
    usage: "tx skills <generate|sync> [--target <all|claude|codex>]",
    examples: [
      "tx skills generate --target codex",
      "tx skills sync --target claude",
    ],
    details: {
      flag: "target",
      received: target,
      expected: ["all", "claude", "codex"],
    },
  }))
}

function runSkillOperation<T>(code: string, message: string, operation: () => T): Effect.Effect<T, CliUserError> {
  return Effect.try({
    try: operation,
    catch: (error) => {
      if (error instanceof CliUserError) {
        return error
      }

      return validationError({
        code,
        command: "skills",
        message,
        hint: error instanceof Error ? error.message : String(error),
      })
    },
  })
}

export const skills = (pos: string[], flags: Flags) =>
  Effect.gen(function* () {
    const sub = pos[0]

    if (!sub || sub === "help") {
      console.log(commandHelp["skills"])
      return
    }

    if (flag(flags, "help", "h")) {
      const helpKey = `skills ${sub}`
      console.log(commandHelp[helpKey] ?? commandHelp["skills"])
      return
    }

    if (sub === "generate") {
      const target = yield* parseTarget(flags)
      const outputDir = opt(flags, "output-dir", "o")
      const clean = flag(flags, "clean")
      const result = yield* runSkillOperation(
        "cli/skills-generate-failed",
        "Failed to generate tx skill bundles.",
        () => generateSkillBundles({ target, outputDir, clean }),
      )

      if (flag(flags, "json")) {
        console.log(JSON.stringify(result, null, 2))
        return
      }

      console.log(formatSkillGenerationResult(result))
      return
    }

    if (sub === "sync") {
      const target = yield* parseTarget(flags)
      const projectDir = opt(flags, "project-dir", "p")
      const result = yield* runSkillOperation(
        "cli/skills-sync-failed",
        "Failed to sync tx skill bundles.",
        () => syncSkillBundles({ target, projectDir }),
      )

      if (flag(flags, "json")) {
        console.log(JSON.stringify(result, null, 2))
        return
      }

      console.log(formatSkillSyncResult(result))
      return
    }

    return yield* Effect.fail(unknownSubcommandError({
      command: "skills",
      subcommand: sub,
      usage: "tx skills <generate|sync> [options]",
      examples: [
        "tx skills generate --target codex",
        "tx skills sync --project-dir ../my-project",
      ],
    }))
  })
