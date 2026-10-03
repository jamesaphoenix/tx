/**
 * @tx/core/mappers - Row to domain object conversion utilities
 */

// Shared utilities
export { parseDate } from "./parse-date.js"

// Task mappers
export {
  rowToTask,
  rowToDependency,
  isValidStatus,
  isValidTransition,
  TASK_STATUSES,
  VALID_TRANSITIONS,
  type TaskRow,
  type DependencyRow
} from "./task.js"

// Doc mappers (DD-023 docs-as-primitives)
export {
  rowToDoc,
  rowToDocLink,
  rowToTaskDocLink,
  rowToInvariant,
  rowToInvariantCheck,
  isValidDocKind,
  isValidDocStatus,
  isValidDocLinkType,
  isValidTaskDocLinkType,
  isValidInvariantEnforcement,
  isValidInvariantStatus,
} from "./doc.js"
