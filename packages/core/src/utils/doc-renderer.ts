/**
 * Pure YML → MD renderer for tx docs.
 *
 * Deterministic output with stable section ordering per doc kind.
 * Free-text sections pass through as-is (already markdown).
 * Structured sections (invariants, failure_modes, edge_cases, work_breakdown)
 * accept either string or object forms and render deterministically.
 */
import type { DocKind } from "@jamesaphoenix/tx-types"

interface ParsedYaml {
  [key: string]: unknown
}

interface IndexPrd {
  name: string
  title: string
  status: string
}

interface IndexDesignDoc {
  name: string
  title: string
  status: string
  implements?: string
}

interface IndexLink {
  from: string
  to: string
  type: string
}

interface IndexData {
  overview?: string
  prds: IndexPrd[]
  design_docs: IndexDesignDoc[]
  links: IndexLink[]
  invariant_summary?: {
    total: number
    by_enforcement: Record<string, number>
    by_subsystem: Record<string, number>
  }
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
  renderFreeTextSection(parsed, lines, "storage_schema", "Storage Schema")
  renderInvariantsTable(parsed.invariants as unknown[] | undefined, lines)
  renderFailureModesTable(parsed.failure_modes as unknown[] | undefined, lines)
  renderEdgeCasesTable(parsed.edge_cases as unknown[] | undefined, lines)
  renderConstraintsList(parsed.constraints as string[] | undefined, lines)
  renderFreeTextSection(parsed, lines, "cross_cutting", "Cross-Cutting Concerns")
  renderFreeTextSection(parsed, lines, "data_retention", "Data Retention")
}

const renderPrd = (parsed: ParsedYaml, lines: string[]): void => {
  renderFreeTextSection(parsed, lines, "problem", "Problem")
  renderFreeTextSection(parsed, lines, "solution", "Solution")
  renderStringList(parsed.requirements as string[] | undefined, lines, "Requirements")
  renderStringList(parsed.acceptance_criteria as string[] | undefined, lines, "Acceptance Criteria")
  renderStringList(parsed.out_of_scope as string[] | undefined, lines, "Out of Scope")
}

const renderDesign = (parsed: ParsedYaml, lines: string[]): void => {
  renderFreeTextSection(parsed, lines, "problem_definition", "Problem Definition")
  renderStringList(parsed.goals as string[] | undefined, lines, "Goals")
  renderFreeTextSection(parsed, lines, "architecture", "Architecture")
  renderFreeTextSection(parsed, lines, "interfaces", "Interfaces")
  renderFreeTextSection(parsed, lines, "implementation", "Implementation")
  renderFreeTextSection(parsed, lines, "data_model", "Data Model")
  renderInvariantsTable(parsed.invariants as unknown[] | undefined, lines)
  renderFailureModesTable(parsed.failure_modes as unknown[] | undefined, lines)
  renderEdgeCasesTable(parsed.edge_cases as unknown[] | undefined, lines)
  renderWorkBreakdown(parsed.work_breakdown as unknown[] | undefined, lines)
  renderFreeTextSection(parsed, lines, "retention", "Retention")
  renderFreeTextSection(parsed, lines, "testing_strategy", "Testing Strategy")
  renderFreeTextSection(parsed, lines, "open_questions", "Open Questions")
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
  lines.push("| ID | Rule | Enforcement | Reference |")
  lines.push("|-----|------|-------------|-----------|")
  for (const raw of invariants) {
    const inv = asRecord(raw)
    const id = pickString(inv, "id")
    const ruleFromString = typeof raw === "string" && raw.trim() ? raw.trim() : null
    const rule = ruleFromString ?? pickString(inv, "rule", "description", "scenario")
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
  lines.push("")
}

const renderFailureModesTable = (
  failureModes: unknown[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(failureModes) || failureModes.length === 0) return
  lines.push("## Failure Modes", "")
  lines.push("| ID | Description | Mitigation |")
  lines.push("|-----|-------------|------------|")
  for (const raw of failureModes) {
    const fm = asRecord(raw)
    const id = pickString(fm, "id")
    const descriptionFromString =
      typeof raw === "string" && raw.trim() ? raw.trim() : null
    const description = descriptionFromString ?? pickString(fm, "description", "scenario")
    const mitigation = pickString(fm, "mitigation")
    lines.push(
      `| ${markdownCell(id)} | ${markdownCell(description)} | ${markdownCell(mitigation)} |`
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
  lines.push("| ID | Description |")
  lines.push("|-----|-------------|")
  for (const raw of edgeCases) {
    const ec = asRecord(raw)
    const id = pickString(ec, "id")
    const descriptionFromString =
      typeof raw === "string" && raw.trim() ? raw.trim() : null
    const description =
      descriptionFromString ?? pickString(ec, "description", "scenario", "case")
    lines.push(`| ${markdownCell(id)} | ${markdownCell(description)} |`)
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

/**
 * Render index data to markdown.
 */
export const renderIndexToMarkdown = (indexData: IndexData): string => {
  const lines: string[] = ["# Documentation Index", ""]

  if (indexData.overview) {
    lines.push(
      `**System Overview**: [${indexData.overview}](${indexData.overview}.md)`,
      ""
    )
  }

  // PRDs table
  if (indexData.prds.length > 0) {
    lines.push("## Product Requirements Documents", "")
    lines.push("| Name | Title | Status |")
    lines.push("|------|-------|--------|")
    for (const prd of indexData.prds) {
      lines.push(
        `| [${prd.name}](prd/${prd.name}.md) | ${prd.title} | ${prd.status} |`
      )
    }
    lines.push("")
  }

  // Design docs table
  if (indexData.design_docs.length > 0) {
    lines.push("## Design Documents", "")
    lines.push("| Name | Title | Implements | Status |")
    lines.push("|------|-------|------------|--------|")
    for (const dd of indexData.design_docs) {
      lines.push(
        `| [${dd.name}](design/${dd.name}.md) | ${dd.title} | ${dd.implements ?? "-"} | ${dd.status} |`
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
