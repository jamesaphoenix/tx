import { HELP_TEXT, commandHelp } from "./help.js"
import { CliUserError, usageError } from "./cli-errors.js"

export const compoundHelpParents = [
  "dep", "msg", "diag", "auto",
  "sync", "trace", "bulk", "doc", "spec", "memory", "utils", "pin", "skills",
  "guard", "gate", "verify", "label", "claim", "outbox", "group-context", "ack",
] as const

export const deprecatedCommandMap: Record<string, string> = {
  block: "dep block", unblock: "dep unblock", children: "dep children", tree: "dep tree",
  send: "msg send", inbox: "msg inbox", ack: "msg ack", outbox: "msg pending|gc",
  stats: "diag stats", doctor: "diag doctor", validate: "diag doctor", dashboard: "diag dashboard",
  compact: "sync compact", history: "sync history", migrate: "sync migrate",
  guard: "auto guard", gate: "auto gate", verify: "auto verify", label: "auto label", reflect: "auto reflect",
}

export type ParsedCliArgument = {
  name: string
  required: boolean
  description?: string
}

export type ParsedCliOption = {
  flags: string[]
  valueName?: string
  description?: string
}

export type ParsedCliSubcommand = {
  name: string
  description?: string
}

export type CommandSchema = {
  key: string
  commandLabel: string
  summary: string
  rawHelp: string
  aliases: string[]
  deprecatedTo?: string
  usage: string[]
  arguments: ParsedCliArgument[]
  options: ParsedCliOption[]
  subcommands: ParsedCliSubcommand[]
  examples: string[]
}

export type CommandCatalogEntry = {
  key: string
  commandLabel: string
  summary: string
  aliases: string[]
  deprecatedTo?: string
  parent?: string
  subcommands: string[]
}

const SECTION_NAMES = new Set(["Usage", "Arguments", "Options", "Subcommands", "Examples"])

function splitHelpColumns(line: string): [string, string | undefined] {
  const parts = line.trim().split(/\s{2,}/)
  const left = parts.shift()?.trim() ?? ""
  const right = parts.length > 0 ? parts.join("  ").trim() : undefined
  return [left, right]
}

function parseHelpHeader(key: string, rawHelp: string): { commandLabel: string; summary: string } {
  const header = rawHelp.trim().split(/\r?\n/, 1)[0] ?? `tx ${key}`
  const separator = header.indexOf(" - ")
  if (separator === -1) {
    return { commandLabel: header.trim(), summary: "" }
  }
  return {
    commandLabel: header.slice(0, separator).trim(),
    summary: header.slice(separator + 3).trim(),
  }
}

function parseHelpSections(rawHelp: string): Record<string, string[]> {
  const sections: Record<string, string[]> = {}
  const lines = rawHelp.trimEnd().split(/\r?\n/)
  let currentSection: string | null = null

  for (let index = 1; index < lines.length; index++) {
    const line = lines[index] ?? ""
    const match = line.match(/^([A-Z][A-Za-z ]+):\s*(.*)$/)
    if (match && SECTION_NAMES.has(match[1])) {
      currentSection = match[1].toLowerCase()
      sections[currentSection] = sections[currentSection] ?? []
      if (match[2]) {
        sections[currentSection].push(match[2])
      }
      continue
    }

    if (!currentSection) continue
    sections[currentSection] = sections[currentSection] ?? []
    sections[currentSection].push(line)
  }

  return sections
}

function parseUsage(lines: string[] | undefined): string[] {
  return (lines ?? [])
    .map((line) => line.trim())
    .filter(Boolean)
}

function collapseSectionEntries(
  lines: string[] | undefined,
  isEntryStart: (trimmedLine: string) => boolean,
): string[] {
  const entries: string[] = []
  let current = ""

  for (const rawLine of lines ?? []) {
    const line = rawLine.trim()
    if (!line) continue

    if (!current || isEntryStart(line)) {
      if (current) entries.push(current)
      current = line
      continue
    }

    current = `${current}  ${line}`
  }

  if (current) entries.push(current)
  return entries
}

function parseArguments(lines: string[] | undefined): ParsedCliArgument[] {
  return collapseSectionEntries(lines, (line) => line.startsWith("<") || line.startsWith("["))
    .map((line) => {
      const [left, description] = splitHelpColumns(line)
      return {
        name: left,
        required: left.startsWith("<"),
        description,
      }
    })
}

function parseOptions(lines: string[] | undefined): ParsedCliOption[] {
  return collapseSectionEntries(lines, (line) => line.startsWith("-"))
    .map((line) => {
      const [left, description] = splitHelpColumns(line)
      const valueNameMatch = left.match(/(<[^>]+>)/)
      const valueName = valueNameMatch?.[1]
      const flagPart = valueName ? left.replace(valueName, "").trim() : left
      return {
        flags: flagPart.split(/\s*,\s*/).filter(Boolean),
        valueName,
        description,
      }
    })
}

function parseSubcommands(lines: string[] | undefined): ParsedCliSubcommand[] {
  return (lines ?? [])
    .map((line) => line.trimEnd())
    .filter((line) => Boolean(line.trim()))
    .map((line) => {
      const [name, description] = splitHelpColumns(line)
      return { name, description }
    })
}

function parseExamples(lines: string[] | undefined): string[] {
  return (lines ?? [])
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseUsageArguments(usage: string[]): ParsedCliArgument[] {
  const seen = new Set<string>()
  const argumentsFromUsage: ParsedCliArgument[] = []

  for (const line of usage) {
    const matches = line.match(/<[^>]+>/g) ?? []
    for (const match of matches) {
      if (seen.has(match)) continue
      seen.add(match)
      argumentsFromUsage.push({
        name: match,
        required: true,
      })
    }
  }

  return argumentsFromUsage
}

function buildAliasMap(): Map<string, string[]> {
  const aliases = new Map<string, string[]>()
  for (const [alias, target] of Object.entries(deprecatedCommandMap)) {
    if (target.includes("|")) continue
    const current = aliases.get(target) ?? []
    current.push(alias)
    aliases.set(target, current.sort((left, right) => left.localeCompare(right)))
  }
  return aliases
}

const aliasMap = buildAliasMap()

function editDistance(left: string, right: string): number {
  const rows = left.length + 1
  const cols = right.length + 1
  const dp = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => (row === 0 ? col : col === 0 ? row : 0))
  )

  for (let row = 1; row < rows; row++) {
    for (let col = 1; col < cols; col++) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1
      dp[row][col] = Math.min(
        dp[row - 1][col] + 1,
        dp[row][col - 1] + 1,
        dp[row - 1][col - 1] + cost
      )
    }
  }

  return dp[left.length][right.length]
}

function suggestHelpKeys(input: string, candidates: string[], limit = 3): string[] {
  const normalized = input.toLowerCase()
  return candidates
    .map((candidate) => {
      const candidateNormalized = candidate.toLowerCase()
      const prefixBoost = candidateNormalized.startsWith(normalized) ? -2 : 0
      const includeBoost = candidateNormalized.includes(normalized) ? -1 : 0
      return {
        candidate,
        score: editDistance(normalized, candidateNormalized) + prefixBoost + includeBoost,
      }
    })
    .sort((left, right) => left.score - right.score || left.candidate.localeCompare(right.candidate))
    .slice(0, limit)
    .map((entry) => entry.candidate)
}

function isRootCatalogEntry(entry: CommandCatalogEntry): boolean {
  return !entry.parent && !entry.deprecatedTo && !entry.key.includes(":")
}

export function resolveCommandKey(parts: string[]): string | null {
  if (parts.length === 0) return null
  const compoundKey = parts.length >= 2 ? `${parts[0]} ${parts[1]}` : null
  if (compoundKey && commandHelp[compoundKey]) {
    return compoundKey
  }
  if (commandHelp[parts[0]]) {
    return parts[0]
  }
  return null
}

export function buildCommandSchema(key: string): CommandSchema {
  const rawHelp = commandHelp[key]
  if (!rawHelp) {
    throw new CliUserError({
      code: "cli/unknown-command",
      command: key,
      message: `Unknown command: ${key}`,
      hint: `Closest matches: ${suggestHelpKeys(key, Object.keys(commandHelp)).join(", ")}.`,
      usage: "tx help <command>",
      details: {
        suggestions: suggestHelpKeys(key, Object.keys(commandHelp)),
      },
    })
  }

  const sections = parseHelpSections(rawHelp)
  const { commandLabel, summary } = parseHelpHeader(key, rawHelp)
  const usage = parseUsage(sections.usage)
  const argumentsList = parseArguments(sections.arguments)

  return {
    key,
    commandLabel,
    summary,
    rawHelp,
    aliases: aliasMap.get(key) ?? [],
    deprecatedTo: deprecatedCommandMap[key],
    usage,
    arguments: argumentsList.length > 0 ? argumentsList : parseUsageArguments(usage),
    options: parseOptions(sections.options),
    subcommands: parseSubcommands(sections.subcommands),
    examples: parseExamples(sections.examples),
  }
}

export function buildCommandCatalog(): CommandCatalogEntry[] {
  const keys = Object.keys(commandHelp).sort((left, right) => left.localeCompare(right))
  return keys.map((key) => {
    const schema = buildCommandSchema(key)
    const segments = key.split(" ")
    return {
      key,
      commandLabel: schema.commandLabel,
      summary: schema.summary,
      aliases: schema.aliases,
      deprecatedTo: schema.deprecatedTo,
      parent: segments.length > 1 ? segments[0] : undefined,
      subcommands: keys.filter((candidate) => candidate.startsWith(`${key} `)),
    }
  })
}

export function buildHelpPayload(parts: string[]): Record<string, unknown> {
  if (parts.length === 0) {
    return {
      kind: "catalog",
      help: {
        summary: HELP_TEXT.trim().split(/\r?\n/, 1)[0] ?? HELP_TEXT.trim(),
        commands: buildCommandCatalog().filter(isRootCatalogEntry),
      },
    }
  }

  const key = resolveCommandKey(parts)
  if (!key) {
    const suggestions = suggestHelpKeys(parts.join(" "), buildCommandCatalog().map((entry) => entry.key))
    throw new CliUserError({
      code: "cli/unknown-command",
      command: parts.join(" "),
      message: `Unknown command: ${parts.join(" ")}`,
      hint: suggestions.length > 0
        ? `Closest matches: ${suggestions.join(", ")}.`
        : "Run `tx help --json` to inspect the available command catalog.",
      usage: "tx help [command] [subcommand]",
      details: {
        suggestions,
      },
    })
  }

  return {
    kind: "command",
    help: buildCommandSchema(key),
  }
}

export function buildSchemaPayload(parts: string[]): Record<string, unknown> {
  if (parts.length === 0) {
    return {
      kind: "catalog",
      schema: {
        commands: buildCommandCatalog().filter(isRootCatalogEntry),
      },
    }
  }

  const key = resolveCommandKey(parts)
  if (!key) {
    const error = usageError({
      code: "cli/unknown-command",
      command: parts.join(" "),
      message: `Unknown command for schema lookup: ${parts.join(" ")}`,
      hint: "Run `tx help --json` to inspect the available command catalog first.",
      usage: "tx schema [command] [subcommand]",
      examples: [
        "tx schema dep block",
        "tx schema sync",
      ],
    })
    throw new CliUserError({
      code: error.code,
      command: error.command,
      message: error.message,
      hint: error.hint,
      usage: error.usage,
      examples: error.examples,
      details: error.details,
      exitCode: error.exitCode,
    })
  }

  return {
    kind: "command",
    schema: buildCommandSchema(key),
  }
}
