/**
 * Pure YML → MD renderer for tx docs.
 *
 * Deterministic output with stable section ordering per doc kind.
 * Free-text sections pass through as-is (already markdown).
 * Structured sections (invariants, failure_modes, edge_cases, work_breakdown,
 * ears_requirements)
 * accept either string or object forms and render deterministically.
 */
import type { DocKind } from "../types/index.js"

type ParsedYaml = {
  [key: string]: unknown};

type IndexPrd = {
  name: string
  title: string
  description: string
  search_keywords: string[]
  status: string};

type IndexDesignDoc = {
  name: string
  title: string
  description: string
  search_keywords: string[]
  status: string
  implements?: string};

type IndexLink = {
  from: string
  to: string
  type: string};

type IndexDoc = {
  name: string
  title: string
  description: string
  search_keywords: string[]
  status: string}

type IndexData = {
  overview?: string
  description?: string
  search_keywords?: string[]
  requirements: IndexDoc[]
  prds: IndexPrd[]
  design_docs: IndexDesignDoc[]
  system_designs: IndexDoc[]
  links: IndexLink[]
  invariant_summary?: {
    total: number
    by_enforcement: Record<string, number>
    by_subsystem: Record<string, number>
  }};

const renderTableCell = (value: string): string => {
  return value
    .trim()
    .replace(/\r?\n+/g, " ")
    .replace(/\|/g, "\\|")
}

const renderSearchKeywords = (keywords: readonly string[]): string => {
  if (keywords.length === 0) return "-"
  return renderTableCell(keywords.join(", "))
}

/**
 * Render a parsed YAML doc to deterministic markdown.
 * Section order is fixed per kind. Missing sections are skipped.
 */
export const renderDocToMarkdown = (parsed: ParsedYaml, kind: DocKind): string => {
  const title = (parsed.title as string) ?? (parsed.name as string) ?? "Untitled"
  const lines: string[] = [`# ${title}`, ""]

  // Metadata header
  if (parsed.kind) lines.push(`**Kind**: ${parsed.kind}`)
  if (parsed.status) lines.push(`**Status**: ${parsed.status}`)
  if (parsed.version) lines.push(`**Version**: ${parsed.version}`)
  if (parsed.implements) lines.push(`**Implements**: ${parsed.implements}`)
  lines.push("")

  switch (kind) {
    case "overview":
      renderOverview(parsed, lines)
      break
    case "prd":
      renderPrd(parsed, lines)
      break
    case "design":
      renderDesign(parsed, lines)
      break
    case "requirement":
      renderRequirement(parsed, lines)
      break
    case "system_design":
      renderSystemDesign(parsed, lines)
      break
    case "runbook":
      renderRunbook(parsed, lines)
      break
    case "decision":
      renderDecision(parsed, lines)
      break
    default: {
      // Compile-time exhaustive check — adding a new DocKind without
      // a case above will fail here with a type error.
      const _exhaustive: never = kind
      return _exhaustive
    }
  }

  return lines.join("\n")
}

// =============================================================================
// KIND-SPECIFIC RENDERERS
// =============================================================================

const renderOverview = (parsed: ParsedYaml, lines: string[]): void => {
  renderFreeTextSection(parsed, lines, "problem_definition", "Problem Definition")
  renderFreeTextSection(parsed, lines, "subsystems", "Subsystems")
  renderFreeTextSection(parsed, lines, "object_model", "Object Model")
  // Legacy sections (removed from new schema, rendered for backward compat)
  renderFreeTextSection(parsed, lines, "storage_schema", "Storage Schema")
  renderInvariantsTable(parsed.invariants as unknown[] | undefined, lines)
  renderFailureModesTable(parsed.failure_modes as unknown[] | undefined, lines)
  renderEdgeCasesTable(parsed.edge_cases as unknown[] | undefined, lines)
  renderConstraintsList(parsed.constraints as string[] | undefined, lines)
  renderFreeTextSection(parsed, lines, "cross_cutting", "Cross-Cutting Concerns")
  renderFreeTextSection(parsed, lines, "data_retention", "Data Retention")
  renderFreeTextSection(parsed, lines, "user_specific_content", "Additional Notes")
}

const renderPrd = (parsed: ParsedYaml, lines: string[]): void => {
  renderFreeTextSection(parsed, lines, "problem", "Problem")
  renderFreeTextSection(parsed, lines, "solution", "Solution")
  // Legacy `requirements` (deprecated, rendered for backward compat)
  renderStringList(parsed.requirements as string[] | undefined, lines, "Requirements")
  renderEarsRequirements(parsed.ears_requirements as unknown[] | undefined, lines)
  renderStringList(parsed.acceptance_criteria as string[] | undefined, lines, "Acceptance Criteria")
  // Render both `non_goals` and legacy `out_of_scope`
  renderStringList(parsed.non_goals as string[] | undefined, lines, "Non-Goals")
  if (!parsed.non_goals) {
    renderStringList(parsed.out_of_scope as string[] | undefined, lines, "Non-Goals")
  }
  renderFreeTextSection(parsed, lines, "user_specific_content", "Additional Notes")
}

const renderRequirement = (parsed: ParsedYaml, lines: string[]): void => {
  renderFreeTextSection(parsed, lines, "overview", "Overview")
  renderActorsTable(parsed.actors as unknown[] | undefined, lines)
  renderUseCasesTable(parsed.use_cases as unknown[] | undefined, lines)
  renderFreeTextSection(parsed, lines, "functional_requirements", "Functional Requirements")
  renderInvariantsTable(parsed.invariants as unknown[] | undefined, lines)
  renderEarsRequirements(parsed.ears_requirements as unknown[] | undefined, lines)
  renderStringList(parsed.non_functional_requirements as string[] | undefined, lines, "Non-Functional Requirements")
  const traceability = parsed.traceability
  if (Array.isArray(traceability)) {
    renderTraceabilityTable(traceability, lines)
  } else if (traceability && typeof traceability === "object") {
    // Legacy object form (scoped_by, designed_in)
    const rec = traceability as Record<string, unknown>
    const entries = Object.entries(rec).filter(([, value]) => value != null && value !== "")
    if (entries.length > 0) {
      lines.push("## Traceability", "")
      for (const [key, value] of entries) {
        lines.push(`- **${key}**: ${String(value)}`)
      }
      lines.push("")
    }
  }
  renderFreeTextSection(parsed, lines, "user_specific_content", "Additional Notes")
}

const renderSystemDesign = (parsed: ParsedYaml, lines: string[]): void => {
  renderFreeTextSection(parsed, lines, "overview", "Overview")
  renderFreeTextSection(parsed, lines, "scope", "Scope")
  renderStringList(parsed.constraints as string[] | undefined, lines, "Constraints")
  renderFreeTextSection(parsed, lines, "design", "Design")
  renderAppliesToTable(parsed.applies_to as unknown[] | undefined, lines)
  renderInvariantsTable(parsed.invariants as unknown[] | undefined, lines)
  renderDecisionLogTable(parsed.decision_log as unknown[] | undefined, lines)
  renderFreeTextSection(parsed, lines, "user_specific_content", "Additional Notes")
}

const renderDesign = (parsed: ParsedYaml, lines: string[]): void => {
  renderFreeTextSection(parsed, lines, "problem_definition", "Problem Definition")
  renderStringList(parsed.goals as string[] | undefined, lines, "Goals")
  renderFreeTextSection(parsed, lines, "architecture", "Architecture")
  renderFreeTextSection(parsed, lines, "data_model", "Data Model")
  renderInvariantsTable(parsed.invariants as unknown[] | undefined, lines)
  renderFailureModesTable(parsed.failure_modes as unknown[] | undefined, lines)
  renderEdgeCasesTable(parsed.edge_cases as unknown[] | undefined, lines)
  renderStringList(parsed.non_goals as string[] | undefined, lines, "Non-Goals")
  renderTestingStrategyTable(parsed.testing_strategy as unknown, lines)
  renderFreeTextSection(parsed, lines, "open_questions", "Open Questions")
  renderFreeTextSection(parsed, lines, "user_specific_content", "Additional Notes")
  // Legacy sections (removed from new schema, rendered for backward compat)
  renderFreeTextSection(parsed, lines, "interfaces", "Interfaces")
  renderFreeTextSection(parsed, lines, "implementation", "Implementation")
  renderWorkBreakdown(parsed.work_breakdown as unknown[] | undefined, lines)
  renderFreeTextSection(parsed, lines, "retention", "Retention")
}

const renderRunbook = (parsed: ParsedYaml, lines: string[]): void => {
  renderFreeTextSection(parsed, lines, "summary", "Summary")
  renderFreeTextSection(parsed, lines, "symptoms", "Symptoms")
  renderFreeTextSection(parsed, lines, "diagnosis", "Diagnosis")
  renderFreeTextSection(parsed, lines, "mitigation", "Mitigation")
  renderFreeTextSection(parsed, lines, "escalation", "Escalation")
  renderFreeTextSection(parsed, lines, "user_specific_content", "Additional Notes")
}

const renderDecision = (parsed: ParsedYaml, lines: string[]): void => {
  renderFreeTextSection(parsed, lines, "summary", "Summary")
  renderFreeTextSection(parsed, lines, "context", "Context")
  renderFreeTextSection(parsed, lines, "alternatives", "Alternatives")
  renderFreeTextSection(parsed, lines, "decision", "Decision")
  renderFreeTextSection(parsed, lines, "consequences", "Consequences")
  renderFreeTextSection(parsed, lines, "user_specific_content", "Additional Notes")
}

// =============================================================================
// SECTION RENDERERS
// =============================================================================

const renderFreeTextSection = (
  parsed: ParsedYaml,
  lines: string[],
  key: string,
  heading: string
): void => {
  const content = parsed[key]
  if (!content || (typeof content === "string" && !content.trim())) return
  lines.push(`## ${heading}`, "")
  lines.push(String(content).trim(), "")
}

const renderStringList = (
  items: string[] | undefined,
  lines: string[],
  heading: string
): void => {
  if (!Array.isArray(items) || items.length === 0) return
  lines.push(`## ${heading}`, "")
  for (const item of items) {
    lines.push(`- ${String(item)}`)
  }
  lines.push("")
}

const renderConstraintsList = (
  constraints: string[] | undefined,
  lines: string[]
): void => {
  renderStringList(constraints, lines, "Constraints")
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

const pickString = (
  obj: Record<string, unknown> | null,
  ...keys: string[]
): string | null => {
  if (!obj) return null
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }
  return null
}

const markdownCell = (value: string | null | undefined): string => {
  if (!value || !value.trim()) return "-"
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()
}

const renderInvariantsTable = (
  invariants: unknown[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(invariants) || invariants.length === 0) return
  lines.push("## Invariants", "")

  // Detect format: new (id+statement) vs legacy (id+rule+enforcement)
  const firstInv = asRecord(invariants[0])
  const isNewFormat = firstInv && typeof firstInv.statement === "string"

  if (isNewFormat) {
    lines.push("| ID | Statement | Rationale |")
    lines.push("|-----|-----------|-----------|")
    for (const raw of invariants) {
      const inv = asRecord(raw)
      const id = pickString(inv, "id")
      const statement = pickString(inv, "statement")
      const rationale = pickString(inv, "rationale")
      lines.push(
        `| ${markdownCell(id)} | ${markdownCell(statement)} | ${markdownCell(rationale)} |`
      )
    }
  } else {
    // Legacy format with rule/enforcement/reference
    lines.push("| ID | Rule | Enforcement | Reference |")
    lines.push("|-----|------|-------------|-----------|")
    for (const raw of invariants) {
      const inv = asRecord(raw)
      const id = pickString(inv, "id")
      const ruleFromString = typeof raw === "string" && raw.trim() ? raw.trim() : null
      const rule = ruleFromString ?? pickString(inv, "rule", "statement", "description", "scenario")
      const subsystem = pickString(inv, "subsystem")
      const enforcement = pickString(inv, "enforcement")
      const ref = pickString(
        inv,
        "test_ref",
        "testRef",
        "lint_rule",
        "lintRule",
        "prompt_ref",
        "promptRef"
      )
      const ruleWithSubsystem = subsystem
        ? `${markdownCell(rule)} (${markdownCell(subsystem)})`
        : markdownCell(rule)

      lines.push(
        `| ${markdownCell(id)} | ${ruleWithSubsystem} | ${markdownCell(enforcement)} | ${markdownCell(ref)} |`
      )
    }
  }
  lines.push("")
}

const renderFailureModesTable = (
  failureModes: unknown[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(failureModes) || failureModes.length === 0) return
  lines.push("## Failure Modes", "")
  lines.push("| Condition | Impact | Handling |")
  lines.push("|-----------|--------|----------|")
  for (const raw of failureModes) {
    const fm = asRecord(raw)
    const descriptionFromString =
      typeof raw === "string" && raw.trim() ? raw.trim() : null
    // New schema: condition/impact/handling; legacy: id/description/mitigation
    const condition = descriptionFromString ??
      pickString(fm, "condition", "description", "scenario")
    const impact = pickString(fm, "impact")
    const handling = pickString(fm, "handling", "mitigation")
    lines.push(
      `| ${markdownCell(condition)} | ${markdownCell(impact)} | ${markdownCell(handling)} |`
    )
  }
  lines.push("")
}

const renderEdgeCasesTable = (
  edgeCases: unknown[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(edgeCases) || edgeCases.length === 0) return
  lines.push("## Edge Cases", "")
  lines.push("| Condition | Expected Behavior |")
  lines.push("|-----------|-------------------|")
  for (const raw of edgeCases) {
    const ec = asRecord(raw)
    const descriptionFromString =
      typeof raw === "string" && raw.trim() ? raw.trim() : null
    // New schema: condition/expected_behavior; legacy: id/description
    const condition = descriptionFromString ??
      pickString(ec, "condition", "description", "scenario", "case")
    const expectedBehavior = pickString(ec, "expected_behavior")
    lines.push(`| ${markdownCell(condition)} | ${markdownCell(expectedBehavior)} |`)
  }
  lines.push("")
}

const renderWorkBreakdown = (
  items: unknown[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(items) || items.length === 0) return
  lines.push("## Work Breakdown", "")
  for (const item of items) {
    const entry = asRecord(item)
    const taskRef = pickString(entry, "task_id", "taskId")
    const descriptionFromString =
      typeof item === "string" && item.trim() ? item.trim() : null
    const description =
      descriptionFromString ?? pickString(entry, "description", "title", "phase")
    if (!description) continue
    const taskPrefix = taskRef ? `\`${taskRef}\` — ` : ""
    lines.push(`- ${taskPrefix}${description}`)
  }
  lines.push("")
}

const renderActorsTable = (
  actors: unknown[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(actors) || actors.length === 0) return
  lines.push("## Actors", "")
  lines.push("| Name | Description |")
  lines.push("|------|-------------|")
  for (const raw of actors) {
    const actor = asRecord(raw)
    const nameFromString = typeof raw === "string" && raw.trim() ? raw.trim() : null
    const name = nameFromString ?? pickString(actor, "name")
    const description = pickString(actor, "description")
    lines.push(`| ${markdownCell(name)} | ${markdownCell(description)} |`)
  }
  lines.push("")
}

const renderUseCasesTable = (
  useCases: unknown[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(useCases) || useCases.length === 0) return
  lines.push("## Use Cases", "")
  for (const raw of useCases) {
    const uc = asRecord(raw)
    const id = pickString(uc, "id")
    const actor = pickString(uc, "actor")
    const trigger = pickString(uc, "trigger")
    const outcome = pickString(uc, "outcome")
    // Support both new schema (id/actor/trigger/outcome) and legacy (id/title/trigger/...)
    const title = pickString(uc, "title")
    const heading = id ? `### ${id}${title ? `: ${title}` : ""}` : `### Use Case`
    lines.push(heading, "")
    if (actor) lines.push(`**Actor**: ${actor}`)
    if (trigger) lines.push(`**Trigger**: ${trigger}`)
    if (outcome) lines.push(`**Outcome**: ${outcome}`)
    // Legacy fields
    const preconditions = pickString(uc, "preconditions")
    const postconditions = pickString(uc, "postconditions")
    const exceptions = pickString(uc, "exceptions")
    if (preconditions) lines.push(`**Preconditions**: ${preconditions}`)
    if (postconditions) lines.push(`**Postconditions**: ${postconditions}`)
    if (exceptions) lines.push(`**Exceptions**: ${exceptions}`)
    // Flow (legacy)
    if (uc && Array.isArray(uc.flow)) {
      lines.push("", "**Flow**:")
      for (const step of uc.flow as unknown[]) {
        lines.push(`1. ${String(step)}`)
      }
    }
    lines.push("")
  }
}

const renderAppliesToTable = (
  appliesTo: unknown[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(appliesTo) || appliesTo.length === 0) return
  lines.push("## Applies To", "")
  lines.push("| Target | Reason |")
  lines.push("|--------|--------|")
  for (const raw of appliesTo) {
    const entry = asRecord(raw)
    const targetFromString = typeof raw === "string" && raw.trim() ? raw.trim() : null
    const target = targetFromString ?? pickString(entry, "target")
    const reason = pickString(entry, "reason")
    lines.push(`| ${markdownCell(target)} | ${markdownCell(reason)} |`)
  }
  lines.push("")
}

const renderDecisionLogTable = (
  decisionLog: unknown[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(decisionLog) || decisionLog.length === 0) return
  lines.push("## Decision Log", "")
  lines.push("| Date | Decision | Rationale | Consequence |")
  lines.push("|------|----------|-----------|-------------|")
  for (const raw of decisionLog) {
    const entry = asRecord(raw)
    const decisionFromString = typeof raw === "string" && raw.trim() ? raw.trim() : null
    const decision = decisionFromString ?? pickString(entry, "decision")
    const rationale = pickString(entry, "rationale")
    const date = pickString(entry, "date")
    const consequence = pickString(entry, "consequence")
    lines.push(
      `| ${markdownCell(date)} | ${markdownCell(decision)} | ${markdownCell(rationale)} | ${markdownCell(consequence)} |`
    )
  }
  lines.push("")
}

const renderTraceabilityTable = (
  traceability: unknown[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(traceability) || traceability.length === 0) return
  lines.push("## Traceability", "")
  lines.push("| Requirement | Level | Verification | Success Criteria |")
  lines.push("|-------------|-------|--------------|------------------|")
  for (const raw of traceability) {
    const row = asRecord(raw)
    const reqId = pickString(row, "requirement_id", "requirement")
    const level = pickString(row, "level", "test_type")
    const verification = pickString(row, "verification", "test_name")
    const successCriteria = pickString(row, "success_criteria")
    lines.push(
      `| ${markdownCell(reqId)} | ${markdownCell(level)} | ${markdownCell(verification)} | ${markdownCell(successCriteria)} |`
    )
  }
  lines.push("")
}

/**
 * Render testing_strategy as a structured traceability table (new schema)
 * or fall back to free-text rendering (legacy).
 */
const renderTestingStrategyTable = (
  testingStrategy: unknown,
  lines: string[]
): void => {
  if (!testingStrategy) return
  // New schema: array of traceability rows
  if (Array.isArray(testingStrategy) && testingStrategy.length > 0) {
    lines.push("## Testing Strategy", "")
    lines.push("| Requirement | Level | Verification | Success Criteria |")
    lines.push("|-------------|-------|--------------|------------------|")
    for (const raw of testingStrategy) {
      const row = asRecord(raw)
      const reqId = pickString(row, "requirement_id", "requirement")
      const level = pickString(row, "level", "test_type")
      const verification = pickString(row, "verification", "test_name")
      const successCriteria = pickString(row, "success_criteria")
      // Legacy: assertions array
      const assertions = row?.assertions
      const successStr = successCriteria ??
        (Array.isArray(assertions) ? (assertions as string[]).join("; ") : null)
      lines.push(
        `| ${markdownCell(reqId)} | ${markdownCell(level)} | ${markdownCell(verification)} | ${markdownCell(successStr)} |`
      )
    }
    lines.push("")
    return
  }
  // Legacy: free-text testing_strategy
  if (typeof testingStrategy === "string" && testingStrategy.trim()) {
    lines.push("## Testing Strategy", "")
    lines.push(testingStrategy.trim(), "")
  }
}

const renderEarsRequirements = (
  requirements: unknown[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(requirements) || requirements.length === 0) return

  // Detect format: new simplified (id+statement) vs legacy decomposed (pattern+system+response)
  const firstReq = asRecord(requirements[0])
  const isNewFormat = firstReq && typeof firstReq.statement === "string"

  if (isNewFormat) {
    // New DOC_SCHEMA_SPEC format: id, statement, optional category/rationale
    lines.push("## Structured Requirements (EARS)", "")
    lines.push("| ID | Statement | Category |")
    lines.push("|-----|-----------|----------|")

    const detailSections: Array<{ id: string; rationale: string | null }> = []

    for (const raw of requirements) {
      const req = asRecord(raw)
      const id = pickString(req, "id")
      const statement = pickString(req, "statement")
      const category = pickString(req, "category")

      lines.push(
        `| ${markdownCell(id)} | ${markdownCell(statement)} | ${markdownCell(category)} |`
      )

      if (!req || !id) continue
      const rationale = pickString(req, "rationale")
      if (rationale) {
        detailSections.push({ id, rationale })
      }
    }
    lines.push("")

    for (const detail of detailSections) {
      lines.push(`### ${detail.id}`)
      lines.push(`**Rationale**: ${detail.rationale}`)
      lines.push("")
    }
  } else {
    // Legacy decomposed format: pattern, system, response, etc.
    lines.push("## Structured Requirements (EARS)", "")
    lines.push("| ID | Pattern | Requirement | Priority |")
    lines.push("|-----|---------|-------------|----------|")

    const detailSections: Array<{ id: string; rationale: string | null; testHint: string | null }> = []

    for (const raw of requirements) {
      const req = asRecord(raw)
      const id = pickString(req, "id")
      const pattern = pickString(req, "pattern")
      const priority = pickString(req, "priority")
      const requirementFromString =
        typeof raw === "string" && raw.trim() ? raw.trim() : null
      const requirement = requirementFromString ?? composeEarsSentence(raw)

      lines.push(
        `| ${markdownCell(id)} | ${markdownCell(pattern)} | ${markdownCell(requirement)} | ${markdownCell(priority)} |`
      )

      if (!req || !id) continue

      const rationale = pickString(req, "rationale")
      const testHint = pickString(req, "test_hint", "testHint")
      if (rationale || testHint) {
        detailSections.push({ id, rationale, testHint })
      }
    }
    lines.push("")

    for (const detail of detailSections) {
      lines.push(`### ${detail.id}`)
      if (detail.rationale) {
        lines.push(`**Rationale**: ${detail.rationale}`)
      }
      if (detail.testHint) {
        lines.push(`**Test hint**: ${detail.testHint}`)
      }
      lines.push("")
    }
  }
}

const ensureSentence = (text: string): string => {
  const trimmed = text.trim()
  if (!trimmed) return trimmed
  if (/[.!?]$/.test(trimmed)) return trimmed
  return `${trimmed}.`
}

export const composeEarsSentence = (raw: unknown): string | null => {
  const req = asRecord(raw)
  if (!req) {
    return null
  }

  const pattern = pickString(req, "pattern")
  const system = pickString(req, "system")
  const response = pickString(req, "response")
  const trigger = pickString(req, "trigger")
  const state = pickString(req, "state")
  const condition = pickString(req, "condition")
  const feature = pickString(req, "feature")

  if (!system || !response) return null

  switch (pattern) {
    case "event_driven":
      return trigger
        ? ensureSentence(`When ${trigger}, the ${system} shall ${response}`)
        : ensureSentence(`The ${system} shall ${response}`)
    case "state_driven":
      return state
        ? ensureSentence(`While ${state}, the ${system} shall ${response}`)
        : ensureSentence(`The ${system} shall ${response}`)
    case "unwanted":
      return condition
        ? ensureSentence(`If ${condition}, then the ${system} shall ${response}`)
        : ensureSentence(`The ${system} shall ${response}`)
    case "optional":
      return feature
        ? ensureSentence(`Where ${feature}, the ${system} shall ${response}`)
        : ensureSentence(`The ${system} shall ${response}`)
    case "complex": {
      const clauses: string[] = []
      if (trigger) clauses.push(`When ${trigger}`)
      if (state) clauses.push(`while ${state}`)
      if (condition) clauses.push(`if ${condition}`)
      if (feature) clauses.push(`where ${feature}`)
      if (clauses.length === 0) {
        return ensureSentence(`The ${system} shall ${response}`)
      }
      return ensureSentence(`${clauses.join(", ")}, the ${system} shall ${response}`)
    }
    case "ubiquitous":
    default:
      return ensureSentence(`The ${system} shall ${response}`)
  }
}

/**
 * Render index data to markdown.
 */
export const renderIndexToMarkdown = (indexData: IndexData): string => {
  const lines: string[] = ["# Documentation Index", ""]

  if (indexData.description) {
    lines.push(`**Description**: ${indexData.description}`, "")
  }

  if (indexData.search_keywords && indexData.search_keywords.length > 0) {
    lines.push(`**Search Keywords**: ${indexData.search_keywords.join(", ")}`, "")
  }

  if (indexData.overview) {
    lines.push(
      `**System Overview**: [${indexData.overview}](${indexData.overview}.md)`,
      ""
    )
  }

  // Requirements table
  if (indexData.requirements.length > 0) {
    lines.push("## Requirements Documents", "")
    lines.push("| Name | Title | Description | Search Keywords | Status |")
    lines.push("|------|-------|-------------|-----------------|--------|")
    for (const req of indexData.requirements) {
      lines.push(
        `| [${req.name}](requirement/${req.name}.md) | ${renderTableCell(req.title)} | ${renderTableCell(req.description)} | ${renderSearchKeywords(req.search_keywords)} | ${renderTableCell(req.status)} |`
      )
    }
    lines.push("")
  }

  // PRDs table
  if (indexData.prds.length > 0) {
    lines.push("## Product Requirements Documents", "")
    lines.push("| Name | Title | Description | Search Keywords | Status |")
    lines.push("|------|-------|-------------|-----------------|--------|")
    for (const prd of indexData.prds) {
      lines.push(
        `| [${prd.name}](prd/${prd.name}.md) | ${renderTableCell(prd.title)} | ${renderTableCell(prd.description)} | ${renderSearchKeywords(prd.search_keywords)} | ${renderTableCell(prd.status)} |`
      )
    }
    lines.push("")
  }

  // Design docs table
  if (indexData.design_docs.length > 0) {
    lines.push("## Design Documents", "")
    lines.push("| Name | Title | Description | Search Keywords | Implements | Status |")
    lines.push("|------|-------|-------------|-----------------|------------|--------|")
    for (const dd of indexData.design_docs) {
      lines.push(
        `| [${dd.name}](design/${dd.name}.md) | ${renderTableCell(dd.title)} | ${renderTableCell(dd.description)} | ${renderSearchKeywords(dd.search_keywords)} | ${renderTableCell(dd.implements ?? "-")} | ${renderTableCell(dd.status)} |`
      )
    }
    lines.push("")
  }

  // System Design docs table
  if (indexData.system_designs.length > 0) {
    lines.push("## System Design Documents", "")
    lines.push("| Name | Title | Description | Search Keywords | Status |")
    lines.push("|------|-------|-------------|-----------------|--------|")
    for (const sd of indexData.system_designs) {
      lines.push(
        `| [${sd.name}](system_design/${sd.name}.md) | ${renderTableCell(sd.title)} | ${renderTableCell(sd.description)} | ${renderSearchKeywords(sd.search_keywords)} | ${renderTableCell(sd.status)} |`
      )
    }
    lines.push("")
  }

  // Invariant summary
  if (indexData.invariant_summary && indexData.invariant_summary.total > 0) {
    const s = indexData.invariant_summary
    lines.push("## Invariant Summary", "")
    lines.push(`**Total invariants**: ${s.total}`, "")
    if (Object.keys(s.by_enforcement).length > 0) {
      lines.push("**By enforcement type**:", "")
      for (const [type, count] of Object.entries(s.by_enforcement)) {
        lines.push(`- ${type}: ${count}`)
      }
      lines.push("")
    }
    if (Object.keys(s.by_subsystem).length > 0) {
      lines.push("**By subsystem**:", "")
      for (const [subsystem, count] of Object.entries(s.by_subsystem)) {
        lines.push(`- ${subsystem}: ${count}`)
      }
      lines.push("")
    }
  }

  // Links
  if (indexData.links.length > 0) {
    lines.push("## Document Links", "")
    lines.push("| From | To | Type |")
    lines.push("|------|-----|------|")
    for (const link of indexData.links) {
      lines.push(`| ${link.from} | ${link.to} | ${link.type} |`)
    }
    lines.push("")
  }

  return lines.join("\n")
}
