/**
 * Pure YML → MD renderer for tx docs.
 *
 * Deterministic output with stable section ordering per doc kind.
 * Free-text sections pass through as-is (already markdown).
 * Structured sections (invariants, failure_modes, edge_cases) render as tables.
 */
import type { DocKind } from "@jamesaphoenix/tx-types"

interface ParsedYaml {
  [key: string]: unknown
}

interface InvariantEntry {
  id: string
  rule: string
  enforcement: string
  test_ref?: string
  lint_rule?: string
  prompt_ref?: string
  subsystem?: string | null
}

interface FailureModeEntry {
  id: string
  description: string
  mitigation?: string
}

interface EdgeCaseEntry {
  id: string
  description: string
}

interface WorkBreakdownEntry {
  description: string
  task_id?: string
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
  renderInvariantsTable(parsed.invariants as InvariantEntry[] | undefined, lines)
  renderFailureModesTable(parsed.failure_modes as FailureModeEntry[] | undefined, lines)
  renderEdgeCasesTable(parsed.edge_cases as EdgeCaseEntry[] | undefined, lines)
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
  renderInvariantsTable(parsed.invariants as InvariantEntry[] | undefined, lines)
  renderFailureModesTable(parsed.failure_modes as FailureModeEntry[] | undefined, lines)
  renderEdgeCasesTable(parsed.edge_cases as EdgeCaseEntry[] | undefined, lines)
  renderWorkBreakdown(parsed.work_breakdown as WorkBreakdownEntry[] | undefined, lines)
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

const renderInvariantsTable = (
  invariants: InvariantEntry[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(invariants) || invariants.length === 0) return
  lines.push("## Invariants", "")
  lines.push("| ID | Rule | Enforcement | Reference |")
  lines.push("|-----|------|-------------|-----------|")
  for (const inv of invariants) {
    const ref = inv.test_ref ?? inv.lint_rule ?? inv.prompt_ref ?? "-"
    const subsystem = inv.subsystem ? ` (${inv.subsystem})` : ""
    lines.push(`| ${inv.id} | ${inv.rule}${subsystem} | ${inv.enforcement} | ${ref} |`)
  }
  lines.push("")
}

const renderFailureModesTable = (
  failureModes: FailureModeEntry[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(failureModes) || failureModes.length === 0) return
  lines.push("## Failure Modes", "")
  lines.push("| ID | Description | Mitigation |")
  lines.push("|-----|-------------|------------|")
  for (const fm of failureModes) {
    lines.push(`| ${fm.id} | ${fm.description} | ${fm.mitigation ?? "-"} |`)
  }
  lines.push("")
}

const renderEdgeCasesTable = (
  edgeCases: EdgeCaseEntry[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(edgeCases) || edgeCases.length === 0) return
  lines.push("## Edge Cases", "")
  lines.push("| ID | Description |")
  lines.push("|-----|-------------|")
  for (const ec of edgeCases) {
    lines.push(`| ${ec.id} | ${ec.description} |`)
  }
  lines.push("")
}

const renderWorkBreakdown = (
  items: WorkBreakdownEntry[] | undefined,
  lines: string[]
): void => {
  if (!Array.isArray(items) || items.length === 0) return
  lines.push("## Work Breakdown", "")
  for (const item of items) {
    const taskRef = item.task_id ? `\`${item.task_id}\` — ` : ""
    lines.push(`- ${taskRef}${item.description}`)
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
