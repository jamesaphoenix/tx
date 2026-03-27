import { toJson } from "./output.js"

export interface CliUserErrorInit {
  code: string
  message: string
  hint?: string
  usage?: string
  examples?: string[]
  command?: string
  details?: Record<string, unknown>
  exitCode?: number
}

export interface CliErrorEnvelope {
  ok: false
  error: {
    code: string
    message: string
    hint?: string
    usage?: string
    examples?: string[]
    command?: string
    details?: Record<string, unknown>
  }
}

export class CliUserError extends Error {
  readonly _tag = "CliUserError" as const
  readonly code: string
  readonly hint?: string
  readonly usage?: string
  readonly examples?: string[]
  readonly command?: string
  readonly details?: Record<string, unknown>
  readonly exitCode: number

  constructor(init: CliUserErrorInit) {
    super(init.message)
    this.code = init.code
    this.hint = init.hint
    this.usage = init.usage
    this.examples = init.examples
    this.command = init.command
    this.details = init.details
    this.exitCode = init.exitCode ?? 1
  }
}

export function usageError(init: Omit<CliUserErrorInit, "code"> & { code?: string }): CliUserError {
  return new CliUserError({
    code: init.code ?? "cli/usage",
    ...init,
  })
}

export function validationError(init: Omit<CliUserErrorInit, "code"> & { code?: string }): CliUserError {
  return new CliUserError({
    code: init.code ?? "cli/validation",
    ...init,
  })
}

export function unknownSubcommandError(params: {
  command: string
  subcommand: string
  usage: string
  examples?: string[]
}): CliUserError {
  return usageError({
    code: "cli/unknown-subcommand",
    command: params.command,
    message: `Unknown ${params.command} subcommand: ${params.subcommand}`,
    hint: `Run \`tx help ${params.command}\` to inspect valid subcommands.`,
    usage: params.usage,
    examples: params.examples,
    details: {
      subcommand: params.subcommand,
    },
  })
}

export function unknownCommandError(params: {
  command: string
  suggestions?: string[]
}): CliUserError {
  const suggestionText = params.suggestions && params.suggestions.length > 0
    ? `Closest matches: ${params.suggestions.join(", ")}.`
    : "Run `tx help` to inspect available commands."

  return usageError({
    code: "cli/unknown-command",
    command: params.command,
    message: `Unknown command: ${params.command}`,
    hint: suggestionText,
    usage: "tx <command> [arguments] [options]",
    details: {
      suggestions: params.suggestions ?? [],
    },
  })
}

export function movedCommandError(params: {
  command: string
  message: string
  hint: string
}): CliUserError {
  return usageError({
    code: "cli/moved-command",
    command: params.command,
    message: params.message,
    hint: params.hint,
  })
}

export function renderCliError(error: CliUserError, jsonMode: boolean): string {
  if (jsonMode) {
    const envelope: CliErrorEnvelope = {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        hint: error.hint,
        usage: error.usage,
        examples: error.examples,
        command: error.command,
        details: error.details,
      },
    }
    return toJson(envelope)
  }

  const lines = [error.message]
  if (error.hint) lines.push(`Hint: ${error.hint}`)
  if (error.usage) lines.push(`Usage: ${error.usage}`)
  if (error.examples && error.examples.length > 0) {
    lines.push("Examples:")
    for (const example of error.examples) {
      lines.push(`  ${example}`)
    }
  }
  return lines.join("\n")
}

export function emitCliError(error: CliUserError, jsonMode: boolean): void {
  const rendered = renderCliError(error, jsonMode)
  if (jsonMode) {
    console.log(rendered)
  } else {
    console.error(rendered)
  }
}
