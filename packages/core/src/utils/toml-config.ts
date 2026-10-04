/**
 * Read and patch tx configuration from .tx/config.toml.
 * Returns defaults if file doesn't exist.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { DEFAULT_SPEC_TEST_PATTERNS } from "./spec-patterns.js"
import { dirname, resolve } from "node:path"

export type DashboardDefaultTaskAssigmentType = "human" | "agent"
export type DashboardDefaultTaskView = "list" | "kanban"
export type DashboardCycleStartDay =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
export type DashboardCyclesConfig = {
  cycleLengthDays: number
  cycleStartDay: DashboardCycleStartDay
  carryStatuses: string[]
  autoAddStatuses: string[]
}
export type SpecDesignDocMissingTaskLinksMode = "always" | "locked_only" | "never"
export type SpecSectionSeverity = "error" | "warn" | "off"

/**
 * A single required section of a spec type.
 * `description` explains what belongs under the heading (bundled into generated
 * skills and doc templates); `message` overrides the missing-section lint prompt.
 */
export type SpecSectionConfig = {
  slug: string
  heading: string
  description: string
  message: string | null
}

export type SpecTypeConfig = {
  sections: SpecSectionConfig[]
  severity: SpecSectionSeverity
  /** Subdirectory under the docs root. `null` = derive from the type name. */
  subdir: string | null
  /** Project-relative path to a custom markdown template. */
  template: string | null
}

export type TxConfig = {
  docs: { path: string }
  spec: {
    testPatterns: string[]
    designDocMissingTaskLinks: SpecDesignDocMissingTaskLinksMode
    /** Effective spec types: built-in defaults merged with user overrides. */
    types: Record<string, SpecTypeConfig>
    /** Global lint message templates keyed by rule id. */
    lintMessages: Record<string, string>
  }
  dashboard: {
    defaultTaskAssigmentType: DashboardDefaultTaskAssigmentType
    defaultTaskView: DashboardDefaultTaskView
    cycles: DashboardCyclesConfig
  }
};

export const DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY = "default_task_assigment_type"
export const DASHBOARD_DEFAULT_TASK_VIEW_KEY = "default_task_view"
const DASHBOARD_SECTION = "dashboard"
const DASHBOARD_CYCLES_SECTION = "dashboard.cycles"
export const DASHBOARD_CYCLE_LENGTH_DAYS_KEY = "cycle_length_days"
export const DASHBOARD_CYCLE_START_DAY_KEY = "cycle_start_day"
export const DASHBOARD_CARRY_STATUSES_KEY = "carry_statuses"
const DOCS_SECTION = "docs"
const SPEC_SECTION = "spec"

const isSpecDesignDocMissingTaskLinksMode = (
  v: string | null
): v is SpecDesignDocMissingTaskLinksMode =>
  v === "always" || v === "locked_only" || v === "never"

/** Built-in missing-section lint prompt, used when no override is configured. */
export const DEFAULT_MISSING_SECTION_MESSAGE =
  "{name}: missing required section '{section}' for spec_type '{spec_type}'. {description}"

/** Built-in prompt for a doc whose spec_type is not defined in config. */
export const DEFAULT_UNKNOWN_SPEC_TYPE_MESSAGE =
  "{name}: spec_type '{spec_type}' is not defined in .tx/config.toml. Add a [spec.types.{spec_type}] section or fix the frontmatter."

export const SPEC_LINT_MESSAGE_KEYS = ["missing_section", "unknown_spec_type"] as const

const DEFAULT_LINT_MESSAGES: Record<string, string> = {
  missing_section: DEFAULT_MISSING_SECTION_MESSAGE,
  unknown_spec_type: DEFAULT_UNKNOWN_SPEC_TYPE_MESSAGE,
}

/**
 * Built-in section definitions per spec type.
 * Tuples are [slug, heading, description, message | null].
 * These are the sections `tx spec lint` checks and the descriptions bundled
 * into generated skills and `tx doc template` output.
 */
const DEFAULT_SECTION_SPECS: Record<string, ReadonlyArray<readonly [string, string, string, string | null]>> = {
  plan: [],
  prd: [
    ["summary", "Summary", "One paragraph stating what this feature is and why it matters.", null],
    ["problem", "Problem", "The user or system problem being solved, with evidence or a motivating scenario.", "{name}: PRD is missing '# Problem'. State the problem before listing requirements. {description}"],
    ["scope", "Scope", "Explicit Included and Excluded lists that bound this work.", null],
    ["requirements", "Requirements", "EARS requirements in an embedded yaml `ears_requirements:` block with REQ-* ids.", "{name}: PRD is missing '# Requirements'. Add the section with an `ears_requirements:` yaml block. {description}"],
    ["acceptance-criteria", "Acceptance Criteria", "Testable criteria in an embedded yaml `acceptance_criteria:` block with AC-* ids.", null],
  ],
  design: [
    ["summary", "Summary", "One paragraph stating the technical approach.", null],
    ["architecture", "Architecture", "Components, their responsibilities, and how they fit together.", null],
    ["interfaces", "Interfaces", "Public surfaces in an embedded yaml `interfaces:` block (name, type, semantics, contract).", null],
    ["data-model", "Data Model", "Tables, schemas, and types this design introduces or changes.", null],
    ["invariants", "Invariants", "Invariants in an embedded yaml `invariants:` block with INV-* ids and verified_by test paths.", "{name}: design doc is missing '# Invariants'. tx derives spec coverage from this section's yaml block. {description}"],
    ["failure-modes", "Failure Modes", "Failure modes in an embedded yaml `failure_modes:` block (condition, impact, handling).", null],
    ["verification", "Verification", "Requirement-to-test mapping in an embedded yaml `verification:` block.", null],
  ],
  overview: [
    ["summary", "Summary", "One paragraph describing the system this overview maps.", null],
    ["architecture", "Architecture", "The high-level architectural shape and its boundaries.", null],
    ["components", "Components", "Each major component and the responsibility it owns.", null],
    ["data-flows", "Data Flows", "How data moves between components, including entry and exit points.", null],
  ],
}

const buildDefaultSpecTypes = (): Record<string, SpecTypeConfig> => {
  const out: Record<string, SpecTypeConfig> = {}
  for (const [typeName, sectionSpecs] of Object.entries(DEFAULT_SECTION_SPECS)) {
    out[typeName] = {
      sections: sectionSpecs.map(([slug, heading, description, message]) => ({
        slug,
        heading,
        description,
        message,
      })),
      severity: "error",
      subdir: typeName === "overview" ? "" : null,
      template: null,
    }
  }
  return out
}

const DEFAULT_CONFIG: TxConfig = {
  docs: { path: "specs" },
  spec: {
    types: buildDefaultSpecTypes(),
    lintMessages: { ...DEFAULT_LINT_MESSAGES },
    testPatterns: [...DEFAULT_SPEC_TEST_PATTERNS],
    designDocMissingTaskLinks: "always",
  },
  dashboard: {
    defaultTaskAssigmentType: "human",
    defaultTaskView: "list",
    cycles: {
      cycleLengthDays: 7,
      cycleStartDay: "monday",
      carryStatuses: ["planning", "active", "blocked", "review", "needs_review"],
      autoAddStatuses: ["backlog", "ready"],
    },
  },
}

const isDashboardDefaultTaskAssigmentType = (
  value: string | null
): value is DashboardDefaultTaskAssigmentType =>
  value === "human" || value === "agent"

const isDashboardDefaultTaskView = (
  value: string | null
): value is DashboardDefaultTaskView =>
  value === "list" || value === "kanban"

const DASHBOARD_CYCLE_START_DAYS = new Set<DashboardCycleStartDay>([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
])

const parseTaskAssigmentTypeOrDefault = (value: string | null): DashboardDefaultTaskAssigmentType =>
  isDashboardDefaultTaskAssigmentType(value)
    ? value
    : DEFAULT_CONFIG.dashboard.defaultTaskAssigmentType

const parseDashboardDefaultTaskViewOrDefault = (
  value: string | null
): DashboardDefaultTaskView =>
  isDashboardDefaultTaskView(value)
    ? value
    : DEFAULT_CONFIG.dashboard.defaultTaskView

const parseDashboardCycleLengthOrDefault = (value: string | null): number => {
  if (!value) return DEFAULT_CONFIG.dashboard.cycles.cycleLengthDays
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_CONFIG.dashboard.cycles.cycleLengthDays
}

const parseDashboardCycleStartDayOrDefault = (value: string | null): DashboardCycleStartDay => {
  if (!value) return DEFAULT_CONFIG.dashboard.cycles.cycleStartDay
  const normalized = value.toLowerCase() as DashboardCycleStartDay
  return DASHBOARD_CYCLE_START_DAYS.has(normalized)
    ? normalized
    : DEFAULT_CONFIG.dashboard.cycles.cycleStartDay
}

const parseDashboardCarryStatusesOrDefault = (values: string[]): string[] => {
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0)
  return normalized.length > 0 ? normalized : DEFAULT_CONFIG.dashboard.cycles.carryStatuses
}

const SPEC_TYPE_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/

const isSpecSectionSeverity = (v: string | null): v is SpecSectionSeverity =>
  v === "error" || v === "warn" || v === "off"

/** "acceptance-criteria" -> "Acceptance Criteria" */
const titleCaseSlug = (slug: string): string =>
  slug
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")

/**
 * List TOML section header names equal to `prefix` or starting with `prefix + "."`.
 * Returns unique names in first-occurrence file order.
 *
 * The hand-rolled parser can only read sections whose names are known up front;
 * user-defined spec types are not, so this enumerates them.
 */
export const listTomlSections = (toml: string, prefix: string): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of toml.split("\n")) {
    const match = line.trim().match(/^\[([^\]]+)\]\s*(?:#.*)?$/)
    if (!match) continue
    const name = match[1]!.trim()
    if (name !== prefix && !name.startsWith(`${prefix}.`)) continue
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

type TomlTable = {
  readonly scalars: Map<string, string>
  readonly arrays: Map<string, string[]>
}

const parseTomlScalar = (raw: string): string | null => {
  const trimmed = raw.trim()
  const quoted = trimmed.match(/^["'](.*)["']\s*(?:#.*)?$/)
  if (quoted) return quoted[1]!
  const unquoted = trimmed.match(/^([^#\s]+)/)
  return unquoted ? unquoted[1]! : null
}

const parseTomlInlineArray = (collected: string): string[] => {
  const out: string[] = []
  const quoted = /["']([^"']*)["']/g
  let match: RegExpExecArray | null
  while ((match = quoted.exec(collected)) !== null) {
    const value = match[1]!.trim()
    if (value.length > 0) out.push(value)
  }
  return out
}

/**
 * Collect every TOML table whose name matches `prefix`, keyed by table name.
 *
 * Unlike `extractTomlValue`, this walks the whole file and merges repeated
 * tables (later keys win). Spec-type config is commonly appended to a file that
 * already scaffolds the same table, and a silently ignored second `[spec.types.design]`
 * would be a confusing no-op.
 */
const collectTomlTables = (toml: string, prefix: string): Map<string, TomlTable> => {
  const tables = new Map<string, TomlTable>()
  const lines = toml.split("\n")
  let current: TomlTable | null = null

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim()
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue

    const header = trimmed.match(/^\[([^\]]+)\]\s*(?:#.*)?$/)
    if (header) {
      const name = header[1]!.trim()
      if (name !== prefix && !name.startsWith(`${prefix}.`)) {
        current = null
        continue
      }
      let table = tables.get(name)
      if (!table) {
        table = { scalars: new Map(), arrays: new Map() }
        tables.set(name, table)
      }
      current = table
      continue
    }

    if (!current) continue

    const assignment = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/)
    if (!assignment) continue
    const key = assignment[1]!
    const value = assignment[2]!

    if (value.trimStart().startsWith("[")) {
      let collected = value
      while (!collected.includes("]") && i + 1 < lines.length) {
        i += 1
        collected += lines[i]!.trim()
      }
      current.arrays.set(key, parseTomlInlineArray(collected))
      continue
    }

    const scalar = parseTomlScalar(value)
    if (scalar !== null) current.scalars.set(key, scalar)
  }

  return tables
}

/**
 * Build the section list for one spec type from its
 * `[spec.types.<type>.section.<slug>]` tables, falling back to the
 * `sections = [...]` string-array shorthand.
 */
const parseSpecSections = (
  tables: Map<string, TomlTable>,
  typeName: string
): SpecSectionConfig[] | null => {
  const prefix = `${SPEC_SECTION}.types.${typeName}.section.`

  const sections: SpecSectionConfig[] = []
  for (const [tableName, table] of tables) {
    if (!tableName.startsWith(prefix)) continue
    const slug = tableName.slice(prefix.length)
    if (slug.length === 0 || slug.includes(".") || !SPEC_TYPE_NAME_PATTERN.test(slug)) continue

    const heading = table.scalars.get("heading")
    const description = table.scalars.get("description")
    const message = table.scalars.get("message")
    sections.push({
      slug,
      heading: heading && heading.trim().length > 0 ? heading.trim() : titleCaseSlug(slug),
      description: description ?? "",
      message: message && message.trim().length > 0 ? message : null,
    })
  }
  if (sections.length > 0) return sections

  const shorthand = tables.get(`${SPEC_SECTION}.types.${typeName}`)?.arrays.get("sections")
  if (!shorthand || shorthand.length === 0) return null
  return shorthand.map((heading) => ({
    slug: heading.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    heading: heading.trim(),
    description: "",
    message: null,
  }))
}

/**
 * Merge user-declared `[spec.types.*]` tables over the built-in defaults.
 * Built-in types keep their default sections unless the file declares its own.
 */
const parseSpecTypes = (raw: string): Record<string, SpecTypeConfig> => {
  const merged: Record<string, SpecTypeConfig> = {}
  for (const [name, def] of Object.entries(DEFAULT_CONFIG.spec.types)) {
    merged[name] = { ...def, sections: def.sections.map((section) => ({ ...section })) }
  }

  const typesPrefix = `${SPEC_SECTION}.types`
  const tables = collectTomlTables(raw, typesPrefix)

  for (const [tableName, table] of tables) {
    const suffix = tableName.slice(typesPrefix.length + 1)
    // Skip the bare prefix and the nested .section.* tables.
    if (tableName === typesPrefix || suffix.length === 0 || suffix.includes(".")) continue
    const typeName = suffix
    if (!SPEC_TYPE_NAME_PATTERN.test(typeName)) continue

    const existing = merged[typeName]
    const sections = parseSpecSections(tables, typeName)
    const severity = table.scalars.get("severity") ?? null
    const subdir = table.scalars.get("subdir") ?? null
    const template = table.scalars.get("template") ?? null

    merged[typeName] = {
      sections: sections ?? existing?.sections ?? [],
      severity: isSpecSectionSeverity(severity) ? severity : existing?.severity ?? "error",
      subdir: subdir ?? existing?.subdir ?? null,
      template: template ?? existing?.template ?? null,
    }
  }
  return merged
}

const parseSpecLintMessages = (raw: string): Record<string, string> => {
  const messages: Record<string, string> = { ...DEFAULT_LINT_MESSAGES }
  const table = collectTomlTables(raw, `${SPEC_SECTION}.lint.messages`).get(
    `${SPEC_SECTION}.lint.messages`
  )
  if (!table) return messages
  for (const key of SPEC_LINT_MESSAGE_KEYS) {
    const value = table.scalars.get(key)
    if (value && value.trim().length > 0) messages[key] = value
  }
  return messages
}

/**
 * Read .tx/config.toml and return parsed config.
 * Falls back to defaults if file doesn't exist or is invalid.
 */
export const readTxConfig = (cwd: string = process.cwd()): TxConfig => {
  const configPath = resolve(cwd, ".tx", "config.toml")
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG
  }
  try {
    const raw = readFileSync(configPath, "utf8")
    // Lightweight TOML parsing for our simple config structure.
    const docsPath = extractTomlValue(raw, DOCS_SECTION, "path")
    const specPatterns = extractTomlArray(raw, SPEC_SECTION, "test_patterns")
    const specDesignDocMissingTaskLinks = extractTomlValue(
      raw,
      SPEC_SECTION,
      "design_doc_missing_task_links"
    )
    const defaultTaskAssigmentType = extractTomlValue(
      raw,
      DASHBOARD_SECTION,
      DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY
    )
    const defaultTaskView = extractTomlValue(
      raw,
      DASHBOARD_SECTION,
      DASHBOARD_DEFAULT_TASK_VIEW_KEY
    )
    const dashboardCycleLengthDays = extractTomlValue(
      raw,
      DASHBOARD_CYCLES_SECTION,
      DASHBOARD_CYCLE_LENGTH_DAYS_KEY
    )
    const dashboardCycleStartDay = extractTomlValue(
      raw,
      DASHBOARD_CYCLES_SECTION,
      DASHBOARD_CYCLE_START_DAY_KEY
    )
    const dashboardCarryStatuses = extractTomlArray(
      raw,
      DASHBOARD_CYCLES_SECTION,
      DASHBOARD_CARRY_STATUSES_KEY
    )

    return {
      docs: {
        path: docsPath ?? DEFAULT_CONFIG.docs.path,
      },
      spec: {
        testPatterns: specPatterns.length > 0 ? specPatterns : DEFAULT_CONFIG.spec.testPatterns,
        designDocMissingTaskLinks: isSpecDesignDocMissingTaskLinksMode(specDesignDocMissingTaskLinks)
          ? specDesignDocMissingTaskLinks
          : DEFAULT_CONFIG.spec.designDocMissingTaskLinks,
        types: parseSpecTypes(raw),
        lintMessages: parseSpecLintMessages(raw),
      },
      dashboard: {
        defaultTaskAssigmentType: parseTaskAssigmentTypeOrDefault(defaultTaskAssigmentType),
        defaultTaskView: parseDashboardDefaultTaskViewOrDefault(defaultTaskView),
        cycles: {
          cycleLengthDays: parseDashboardCycleLengthOrDefault(dashboardCycleLengthDays),
          cycleStartDay: parseDashboardCycleStartDayOrDefault(dashboardCycleStartDay),
          carryStatuses: parseDashboardCarryStatusesOrDefault(dashboardCarryStatuses),
          autoAddStatuses: collectTomlTables(raw, DASHBOARD_CYCLES_SECTION).get(DASHBOARD_CYCLES_SECTION)?.arrays.get("auto_add_statuses") ?? [...DEFAULT_CONFIG.dashboard.cycles.autoAddStatuses],
        },
      },
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

/**
 * Patch the dashboard default assignment type in .tx/config.toml.
 * Preserves unrelated sections and comments.
 */
export const writeDashboardDefaultTaskAssigmentType = (
  value: DashboardDefaultTaskAssigmentType,
  cwd: string = process.cwd()
): TxConfig => {
  const configDir = resolve(cwd, ".tx")
  const configPath = resolve(configDir, "config.toml")
  const current = readTxConfig(cwd)
  const nextConfig: TxConfig = {
    ...current,
    dashboard: { ...current.dashboard, defaultTaskAssigmentType: value },
  }

  mkdirSync(dirname(configPath), { recursive: true })
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const nextRaw = patchTomlKey(
    existingRaw,
    DASHBOARD_SECTION,
    DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY,
    `"${value}"`
  )
  writeFileSync(configPath, ensureTrailingNewline(nextRaw), "utf8")

  return nextConfig
}

/**
 * Patch the dashboard default task view in .tx/config.toml.
 * Preserves unrelated sections and comments.
 */
export const writeDashboardDefaultTaskView = (
  value: DashboardDefaultTaskView,
  cwd: string = process.cwd()
): TxConfig => {
  const configDir = resolve(cwd, ".tx")
  const configPath = resolve(configDir, "config.toml")
  const current = readTxConfig(cwd)
  const nextConfig: TxConfig = {
    ...current,
    dashboard: { ...current.dashboard, defaultTaskView: value },
  }

  mkdirSync(dirname(configPath), { recursive: true })
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const nextRaw = patchTomlKey(
    existingRaw,
    DASHBOARD_SECTION,
    DASHBOARD_DEFAULT_TASK_VIEW_KEY,
    `"${value}"`
  )
  writeFileSync(configPath, ensureTrailingNewline(nextRaw), "utf8")

  return nextConfig
}

/**
 * Read dashboard cycle settings from .tx/config.toml.
 */
export const readDashboardCyclesConfig = (
  cwd: string = process.cwd()
): DashboardCyclesConfig => readTxConfig(cwd).dashboard.cycles

/**
 * Patch dashboard cycle length in .tx/config.toml.
 */
export const writeDashboardCycleLengthDays = (
  value: number,
  cwd: string = process.cwd()
): TxConfig => {
  const configDir = resolve(cwd, ".tx")
  const configPath = resolve(configDir, "config.toml")
  const current = readTxConfig(cwd)
  const normalizedValue =
    Number.isFinite(value) && Number.isInteger(value) && value > 0
      ? value
      : current.dashboard.cycles.cycleLengthDays
  const nextConfig: TxConfig = {
    ...current,
    dashboard: {
      ...current.dashboard,
      cycles: { ...current.dashboard.cycles, cycleLengthDays: normalizedValue },
    },
  }

  mkdirSync(dirname(configPath), { recursive: true })
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const nextRaw = patchTomlKey(
    existingRaw,
    DASHBOARD_CYCLES_SECTION,
    DASHBOARD_CYCLE_LENGTH_DAYS_KEY,
    `${normalizedValue}`
  )
  writeFileSync(configPath, ensureTrailingNewline(nextRaw), "utf8")

  return nextConfig
}

/**
 * Patch dashboard cycle start day in .tx/config.toml.
 */
export const writeDashboardCycleStartDay = (
  value: DashboardCycleStartDay,
  cwd: string = process.cwd()
): TxConfig => {
  const configDir = resolve(cwd, ".tx")
  const configPath = resolve(configDir, "config.toml")
  const current = readTxConfig(cwd)
  const normalizedValue = DASHBOARD_CYCLE_START_DAYS.has(value)
    ? value
    : current.dashboard.cycles.cycleStartDay
  const nextConfig: TxConfig = {
    ...current,
    dashboard: {
      ...current.dashboard,
      cycles: { ...current.dashboard.cycles, cycleStartDay: normalizedValue },
    },
  }

  mkdirSync(dirname(configPath), { recursive: true })
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const nextRaw = patchTomlKey(
    existingRaw,
    DASHBOARD_CYCLES_SECTION,
    DASHBOARD_CYCLE_START_DAY_KEY,
    `"${normalizedValue}"`
  )
  writeFileSync(configPath, ensureTrailingNewline(nextRaw), "utf8")

  return nextConfig
}

/**
 * Patch dashboard cycle carry statuses in .tx/config.toml.
 */
export const writeDashboardCarryStatuses = (
  value: readonly string[],
  cwd: string = process.cwd()
): TxConfig => {
  const normalized = value
    .map((status) => status.trim())
    .filter((status) => status.length > 0)

  const configDir = resolve(cwd, ".tx")
  const configPath = resolve(configDir, "config.toml")
  const current = readTxConfig(cwd)
  const nextCarryStatuses = normalized.length > 0
    ? normalized
    : current.dashboard.cycles.carryStatuses
  const nextConfig: TxConfig = {
    ...current,
    dashboard: {
      ...current.dashboard,
      cycles: { ...current.dashboard.cycles, carryStatuses: [...nextCarryStatuses] },
    },
  }

  mkdirSync(dirname(configPath), { recursive: true })
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const renderedStatuses = `[${nextCarryStatuses.map((status) => JSON.stringify(status)).join(", ")}]`
  const nextRaw = patchTomlKey(
    existingRaw,
    DASHBOARD_CYCLES_SECTION,
    DASHBOARD_CARRY_STATUSES_KEY,
    renderedStatuses
  )
  writeFileSync(configPath, ensureTrailingNewline(nextRaw), "utf8")

  return nextConfig
}

/** Persist cycle auto-add selection, including an empty list that disables auto-add. */
export const writeDashboardAutoAddStatuses = (value: readonly string[], cwd: string = process.cwd()): TxConfig => {
  const configPath = resolve(cwd, ".tx", "config.toml")
  const existingRaw = existsSync(configPath) ? readFileSync(configPath, "utf8") : ""
  const statuses = [...new Set(value.map(status => status.trim()).filter(Boolean))]
  const nextRaw = patchTomlKey(existingRaw, DASHBOARD_CYCLES_SECTION, "auto_add_statuses", JSON.stringify(statuses))
  mkdirSync(dirname(configPath), {recursive:true})
  writeFileSync(configPath, ensureTrailingNewline(nextRaw), "utf8")
  return readTxConfig(cwd)
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`
}

/**
 * Extract a value from a simple TOML file.
 * Handles [section] + key = "value" patterns.
 */
const extractTomlValue = (
  toml: string,
  section: string,
  key: string
): string | null => {
  const lines = toml.split("\n")
  let inSection = false
  for (const line of lines) {
    const trimmed = line.trim()
    // Check for section header
    if (trimmed === `[${section}]`) {
      inSection = true
      continue
    }
    // New section starts — stop looking
    if (trimmed.startsWith("[") && inSection) {
      break
    }
    // Look for key = "value", key = 'value', or key = unquoted
    if (inSection) {
      const quoted = trimmed.match(new RegExp(`^${key}\\s*=\\s*["'](.+?)["']$`))
      if (quoted) {
        return quoted[1]
      }
      const unquoted = trimmed.match(new RegExp(`^${key}\\s*=\\s*([^#\\s]+)`))
      if (unquoted) {
        return unquoted[1]
      }
    }
  }
  return null
}

/**
 * Extract an array value from TOML section/key.
 * Supports:
 * 1. key = ["a", "b", "c"] (single line)
 * 2. key = [ ... ] (multi-line)
 * 3. key = "a, b, c" (comma-separated fallback)
 */
const extractTomlArray = (
  toml: string,
  section: string,
  key: string
): string[] => {
  const lines = toml.split("\n")
  let inSection = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (trimmed === `[${section}]`) {
      inSection = true
      continue
    }
    if (trimmed.startsWith("[") && inSection) {
      break
    }
    if (!inSection) continue

    const arrayStart = new RegExp(`^${key}\\s*=\\s*\\[`).exec(trimmed)
    if (arrayStart) {
      let collected = trimmed
      while (!collected.includes("]") && i + 1 < lines.length) {
        i += 1
        collected += lines[i].trim()
      }

      const out: string[] = []
      const quoted = /["']([^"']+)["']/g
      let match: RegExpExecArray | null
      while ((match = quoted.exec(collected)) !== null) {
        if (match[1].trim().length > 0) out.push(match[1].trim())
      }
      return out
    }
  }

  const fallback = extractTomlValue(toml, section, key)
  if (!fallback) return []
  return fallback.split(",").map((s) => s.trim()).filter(Boolean)
}

function patchTomlKey(
  toml: string,
  section: string,
  key: string,
  renderedValue: string
): string {
  const lines = toml.length > 0 ? toml.split("\n") : []
  const sectionHeader = `[${section}]`
  const sectionRegex = /^\s*\[[^\]]+\]\s*$/
  const keyRegex = new RegExp(`^(\\s*)${escapeRegex(key)}\\s*=`)

  let sectionStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() === sectionHeader) {
      sectionStart = i
      break
    }
  }

  const renderedLine = `${key} = ${renderedValue}`

  if (sectionStart === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("")
    }
    lines.push(sectionHeader, renderedLine)
    return lines.join("\n")
  }

  let sectionEnd = lines.length
  for (let i = sectionStart + 1; i < lines.length; i++) {
    if (sectionRegex.test(lines[i] ?? "")) {
      sectionEnd = i
      break
    }
  }

  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const line = lines[i] ?? ""
    const match = line.match(keyRegex)
    if (!match) continue
    const indent = match[1] ?? ""
    lines[i] = `${indent}${key} = ${renderedValue}`
    return lines.join("\n")
  }

  lines.splice(sectionEnd, 0, renderedLine)
  return lines.join("\n")
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Render the `[spec.types.*]` tables from DEFAULT_CONFIG so the scaffolded file
 * and the in-code defaults can never drift (see the round-trip test).
 * Keys whose default is already correct (subdir, template) are left out so the
 * merge in `parseSpecTypes` keeps them.
 */
const renderDefaultSpecTypesToml = (): string => {
  const lines: string[] = []
  for (const [typeName, def] of Object.entries(DEFAULT_CONFIG.spec.types)) {
    lines.push("", `[${SPEC_SECTION}.types.${typeName}]`, `severity = "${def.severity}"`)

  }
  return lines.join("\n")
}

/** Header comment for the [spec.types.*] block, shared by scaffold and upgrade. */
const SPEC_TYPES_TOML_HEADER = `# Four built-in document kinds; defaults include their standard sections.
# Inspect with \`tx spec types\` or \`tx doc template <kind>\`.
# Override only the settings you need under [spec.types.<kind>].
`
const SPEC_TYPES_TOML_FOOTER = ""

/**
 * The default config.toml content with comments and doc links.
 * Written by `tx init` if config.toml does not exist.
 */
const DEFAULT_CONFIG_TOML = `# tx configuration
# Docs: https://txdocs.dev/docs
# Existing files are preserved by tx init.

# Markdown designs, plans, optional PRDs and system overviews.
# https://txdocs.dev/docs/primitives/docs
[docs]
path = "specs"

# EARS (Easy Approach to Requirements Syntax) is mandatory for PRDs.
# Invariant mappings: tx spec discover. Evidence: tx spec batch.
[spec]
test_patterns = [
${DEFAULT_SPEC_TEST_PATTERNS.map(pattern => `  ${JSON.stringify(pattern)},`).join("\n")}
]
# Warn for designs without linked tasks: always | locked_only | never.
design_doc_missing_task_links = "always"

${SPEC_TYPES_TOML_HEADER}${renderDefaultSpecTypesToml()}

# Task display and optional weekly planning. tx diag dashboard.
# https://txdocs.dev/docs/getting-started
[dashboard]
# human | agent. The historical spelling is retained for compatibility.
default_task_assigment_type = "human"
# list | kanban
default_task_view = "list"

[dashboard.cycles]
cycle_length_days = 7
cycle_start_day = "monday"
carry_statuses = ["planning", "active", "blocked", "review", "needs_review"]
# Auto-add matching dashboard tasks to new cycles; [] disables auto-add.
auto_add_statuses = ["backlog", "ready"]
`

/**
 * Scaffold .tx/config.toml with annotated defaults.
 * No-op if the file already exists (preserves user edits).
 * Returns true if the file was created, false if it already existed.
 */
export const scaffoldConfigToml = (cwd: string = process.cwd()): boolean => {
  const configDir = resolve(cwd, ".tx")
  const configPath = resolve(configDir, "config.toml")
  if (existsSync(configPath)) {
    return false
  }
  mkdirSync(configDir, { recursive: true })
  writeFileSync(configPath, DEFAULT_CONFIG_TOML, "utf8")
  return true
}

/** Config sections added after a project was first initialized. */
const UPGRADEABLE_SECTIONS: ReadonlyArray<{
  readonly marker: string
  readonly render: () => string
}> = [
  {
    // Spec types became configurable; older configs predate [spec.types.*].
    marker: `[${SPEC_SECTION}.types.`,
    render: () => `${SPEC_TYPES_TOML_HEADER}${renderDefaultSpecTypesToml()}\n${SPEC_TYPES_TOML_FOOTER}`,
  },
]

/**
 * Append config sections that did not exist when the project was initialized.
 *
 * Additive and idempotent: a section is only written when its marker is absent,
 * and the appended values match the built-in defaults, so behaviour does not
 * change. Existing keys and comments are never touched.
 *
 * Returns the markers that were added.
 */
export const upgradeConfigToml = (cwd: string = process.cwd()): string[] => {
  const configPath = resolve(cwd, ".tx", "config.toml")
  if (!existsSync(configPath)) return []

  let raw: string
  try {
    raw = readFileSync(configPath, "utf8")
  } catch {
    return []
  }

  const added: string[] = []
  let next = raw
  for (const section of UPGRADEABLE_SECTIONS) {
    if (next.includes(section.marker)) continue
    next = `${ensureTrailingNewline(next)}\n${section.render()}`
    added.push(section.marker)
  }

  if (added.length === 0) return []
  writeFileSync(configPath, ensureTrailingNewline(next), "utf8")
  return added
}
