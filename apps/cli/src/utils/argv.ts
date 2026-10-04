import { commandHelp } from "../help.js"
import { buildCommandSchema } from "../help-registry.js"
import type { Flags } from "./parse.js"
import { CliUserError } from "../cli-errors.js"

const options = Object.keys(commandHelp).flatMap(key => buildCommandSchema(key).options)
const valuedFlags = new Set(["--db","--state-root","--content-root","--doc-version",
  ...options.filter(option => option.valueName).flatMap(option => option.flags)])
const booleanFlags = new Set([
  "--version", "--help", "-h", "-v",
  ...options.filter(option => !option.valueName).flatMap(option => option.flags).filter(flag => !valuedFlags.has(flag)),
])

/** Parse global flags and compound commands without consuming command names as boolean values. */
export function parseArgs(argv: string[]): {command:string; positional:string[]; flags:Flags} {
  const args = argv.slice(2)
  const positional: string[] = []
  const flags: Flags = {}
  let command: string | undefined
  let literal = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!literal && arg === "--") { literal = true; continue }
    if (!literal && arg.startsWith("-")) {
      const equals = arg.indexOf("=")
      const flagName = equals < 0 ? arg : arg.slice(0, equals)
      const key = flagName.replace(/^--?/, "")
      const next = args[i + 1]
      let value: string | boolean = true
      if (equals >= 0) value = arg.slice(equals + 1)
      else if (!booleanFlags.has(flagName) && next !== undefined && (!next.startsWith("-") || /^-\d/.test(next))) {
        value = next
        i++
      }
      if (value === true && valuedFlags.has(flagName)) throw new CliUserError({
        code:"cli/missing-flag-value",message:`${flagName} requires a value.`,
        hint:`Pass ${flagName} <value>, or ${flagName}=<value> when the value starts with a dash.`,
      })
      const previous = flags[key]
      flags[key] = typeof previous === "string" && typeof value === "string" ? `${previous},${value}` : value
    } else if (command === undefined) command = arg
    else positional.push(arg)
  }
  return {command:command ?? "help", positional, flags}
}
