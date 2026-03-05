import { EARS_PATTERNS } from "@jamesaphoenix/tx-types"

const EARS_ID_PATTERN = /^EARS-[A-Z0-9]+-\d{3}$/
const EARS_PRIORITIES = ["must", "should", "could", "wont"] as const

const validPatternSet = new Set<string>(EARS_PATTERNS)
const validPrioritySet = new Set<string>(EARS_PRIORITIES)

type EarsPattern = (typeof EARS_PATTERNS)[number]

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
  readonly message: string};

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

const requiredPatternField = (pattern: EarsPattern): string | null => {
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
    const pattern = pickString(req, "pattern")
    const system = pickString(req, "system")
    const response = pickString(req, "response")
    const priority = pickString(req, "priority")

    if (!id) {
      errors.push({
        index,
        id: null,
        field: "id",
        code: "missing_required",
        message: "Field 'id' is required.",
      })
    } else {
      if (!EARS_ID_PATTERN.test(id)) {
        errors.push({
          index,
          id,
          field: "id",
          code: "invalid_format",
          message: "Field 'id' must match EARS-<SYSTEM>-NNN (e.g. EARS-FL-001).",
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

    if (!pattern) {
      errors.push({
        index,
        id,
        field: "pattern",
        code: "missing_required",
        message: "Field 'pattern' is required.",
      })
    } else if (!validPatternSet.has(pattern)) {
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

    if (priority && !validPrioritySet.has(priority)) {
      errors.push({
        index,
        id,
        field: "priority",
        code: "invalid_value",
        message: `Invalid priority '${priority}'. Valid priorities: ${EARS_PRIORITIES.join(", ")}.`,
      })
    }

    if (pattern && validPatternSet.has(pattern)) {
      const requiredField = requiredPatternField(pattern as EarsPattern)
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
      const location = error.id
        ? `${error.id}`
        : `entry #${error.index + 1}`
      return `${location} (${error.field}): ${error.message}`
    })
    .join("; ")
}
