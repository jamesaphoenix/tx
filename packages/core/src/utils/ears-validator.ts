import {
  EARS_PATTERNS,
  MD_EARS_PRIORITIES,
  MD_EARS_REQUIREMENT_KINDS,
} from "../types/index.js"

const LEGACY_EARS_ID_PATTERN = /^EARS-[A-Z0-9]+-\d{3}$/
const MARKDOWN_EARS_ID_PATTERN = /^REQ-[A-Z0-9-]+$/
const LEGACY_EARS_PRIORITIES = ["must", "should", "could", "wont"] as const

const validLegacyPatternSet = new Set<string>(EARS_PATTERNS)
const validLegacyPrioritySet = new Set<string>(LEGACY_EARS_PRIORITIES)
const validMarkdownKindSet = new Set<string>(MD_EARS_REQUIREMENT_KINDS)
const validMarkdownPrioritySet = new Set<string>(MD_EARS_PRIORITIES)

type LegacyEarsPattern = (typeof EARS_PATTERNS)[number]
type MarkdownEarsKind = (typeof MD_EARS_REQUIREMENT_KINDS)[number]

export type EarsValidationError = {
  readonly index: number
  readonly id: string | null
  readonly field: string
  readonly code:
    | "invalid_type"
    | "missing_required"
    | "invalid_format"
    | "duplicate_id"
    | "invalid_value"
  readonly message: string
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

const pickString = (obj: Record<string, unknown>, key: string): string | null => {
  const value = obj[key]
  return typeof value === "string" ? value.trim() : null
}

const requiredPatternField = (pattern: LegacyEarsPattern): string | null => {
  switch (pattern) {
    case "event_driven":
      return "trigger"
    case "state_driven":
      return "state"
    case "unwanted":
      return "condition"
    case "optional":
      return "feature"
    default:
      return null
  }
}

const requiredMarkdownClause = (kind: MarkdownEarsKind): string | null => {
  switch (kind) {
    case "event-driven":
      return "when"
    case "state-driven":
      return "while"
    case "unwanted":
      return "if"
    case "optional":
      return "where"
    default:
      return null
  }
}

export const validateEarsRequirements = (
  requirements: readonly unknown[]
): EarsValidationError[] => {
  const errors: EarsValidationError[] = []
  const seenIds = new Set<string>()

  requirements.forEach((entry, index) => {
    const req = asRecord(entry)
    if (!req) {
      errors.push({
        index,
        id: null,
        field: "ears_requirements",
        code: "invalid_type",
        message: "Each EARS requirement must be an object.",
      })
      return
    }

    const id = pickString(req, "id")
    const statementRaw = req.statement
    const statement = typeof statementRaw === "string" ? statementRaw.trim() : null
    const kind = pickString(req, "kind")
    const pattern = pickString(req, "pattern")
    const system = pickString(req, "system")
    const response = pickString(req, "response")
    const priority = pickString(req, "priority")
    const isMarkdownFormat = kind !== null || (id !== null && id.startsWith("REQ-"))

    if (!id) {
      errors.push({
        index,
        id: null,
        field: "id",
        code: "missing_required",
        message: "Field 'id' is required.",
      })
    } else {
      const idPattern = isMarkdownFormat ? MARKDOWN_EARS_ID_PATTERN : LEGACY_EARS_ID_PATTERN
      const idFormatMessage = isMarkdownFormat
        ? "Field 'id' must match REQ-<SCOPE>-<NNN> (e.g. REQ-DOCS-001)."
        : "Field 'id' must match EARS-<SYSTEM>-NNN (e.g. EARS-FL-001)."

      if (!idPattern.test(id)) {
        errors.push({
          index,
          id,
          field: "id",
          code: "invalid_format",
          message: idFormatMessage,
        })
      }

      if (seenIds.has(id)) {
        errors.push({
          index,
          id,
          field: "id",
          code: "duplicate_id",
          message: `Duplicate EARS requirement id '${id}'.`,
        })
      } else {
        seenIds.add(id)
      }
    }

    if (isMarkdownFormat) {
      if (!kind) {
        errors.push({
          index,
          id,
          field: "kind",
          code: "missing_required",
          message: "Field 'kind' is required.",
        })
      } else if (!validMarkdownKindSet.has(kind)) {
        errors.push({
          index,
          id,
          field: "kind",
          code: "invalid_value",
          message: `Invalid EARS kind '${kind}'. Valid kinds: ${MD_EARS_REQUIREMENT_KINDS.join(", ")}.`,
        })
      }

      if (!statement) {
        errors.push({
          index,
          id,
          field: "statement",
          code: "missing_required",
          message: "Field 'statement' is required.",
        })
      }

      if (!priority) {
        errors.push({
          index,
          id,
          field: "priority",
          code: "missing_required",
          message: "Field 'priority' is required.",
        })
      } else if (!validMarkdownPrioritySet.has(priority)) {
        errors.push({
          index,
          id,
          field: "priority",
          code: "invalid_value",
          message: `Invalid priority '${priority}'. Valid priorities: ${MD_EARS_PRIORITIES.join(", ")}.`,
        })
      }

      if (kind && validMarkdownKindSet.has(kind)) {
        const clauseField = requiredMarkdownClause(kind as MarkdownEarsKind)
        if (clauseField) {
          const clauseValue = pickString(req, clauseField)
          if (!clauseValue) {
            errors.push({
              index,
              id,
              field: clauseField,
              code: "missing_required",
              message: `Kind '${kind}' requires field '${clauseField}'.`,
            })
          }
        }

        if (kind === "complex") {
          const hasClause =
            Boolean(pickString(req, "when")) ||
            Boolean(pickString(req, "while")) ||
            Boolean(pickString(req, "if")) ||
            Boolean(pickString(req, "where"))

          if (!hasClause) {
            errors.push({
              index,
              id,
              field: "kind",
              code: "missing_required",
              message:
                "Kind 'complex' requires at least one clause: when, while, if, or where.",
            })
          }
        }
      }

      return
    }

    const isLegacyStatementFormat = typeof statementRaw === "string"

    if (isLegacyStatementFormat) {
      if (!statement) {
        errors.push({
          index,
          id,
          field: "statement",
          code: "missing_required",
          message: "Field 'statement' is required.",
        })
      }
      return
    }

    if (!pattern) {
      errors.push({
        index,
        id,
        field: "pattern",
        code: "missing_required",
        message: "Field 'pattern' is required.",
      })
    } else if (!validLegacyPatternSet.has(pattern)) {
      errors.push({
        index,
        id,
        field: "pattern",
        code: "invalid_value",
        message: `Invalid EARS pattern '${pattern}'. Valid patterns: ${EARS_PATTERNS.join(", ")}.`,
      })
    }

    if (!system) {
      errors.push({
        index,
        id,
        field: "system",
        code: "missing_required",
        message: "Field 'system' is required.",
      })
    }

    if (!response) {
      errors.push({
        index,
        id,
        field: "response",
        code: "missing_required",
        message: "Field 'response' is required.",
      })
    }

    if (priority && !validLegacyPrioritySet.has(priority)) {
      errors.push({
        index,
        id,
        field: "priority",
        code: "invalid_value",
        message: `Invalid priority '${priority}'. Valid priorities: ${LEGACY_EARS_PRIORITIES.join(", ")}.`,
      })
    }

    if (pattern && validLegacyPatternSet.has(pattern)) {
      const requiredField = requiredPatternField(pattern as LegacyEarsPattern)
      if (requiredField) {
        const requiredValue = pickString(req, requiredField)
        if (!requiredValue) {
          errors.push({
            index,
            id,
            field: requiredField,
            code: "missing_required",
            message: `Pattern '${pattern}' requires field '${requiredField}'.`,
          })
        }
      }

      if (pattern === "complex") {
        const hasClause =
          Boolean(pickString(req, "trigger")) ||
          Boolean(pickString(req, "state")) ||
          Boolean(pickString(req, "condition")) ||
          Boolean(pickString(req, "feature"))
        if (!hasClause) {
          errors.push({
            index,
            id,
            field: "pattern",
            code: "missing_required",
            message:
              "Pattern 'complex' requires at least one clause: trigger, state, condition, or feature.",
          })
        }
      }
    }
  })

  return errors
}

export const formatEarsValidationErrors = (
  errors: readonly EarsValidationError[]
): string => {
  return errors
    .map((error) => {
      const location = error.id ? `${error.id}` : `entry #${error.index + 1}`
      return `${location} (${error.field}): ${error.message}`
    })
    .join("; ")
}
