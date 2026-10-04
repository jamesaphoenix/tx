/**
 * @tx/core - Core business logic for tx
 *
 * This package provides Effect-TS services and repositories for
 * task management, learnings, file-learnings, attempts, and sync.
 *
 * See DD-002 for design specification.
 */

// =============================================================================
// Errors
// =============================================================================
export {
  TaskNotFoundError,
  ValidationError,
  CircularDependencyError,
  DatabaseError,
  DependencyNotFoundError,
  // Batch processing errors
  BatchProcessingError,
  // Optimistic locking errors
  StaleDataError,
  // Hierarchy protection errors
  HasChildrenError,
  // Data validation errors
  InvalidStatusError,
  InvalidDateError,
  // Doc errors (DD-023 docs-as-primitives)
  DocNotFoundError,
  DocLockedError,
  InvalidDocYamlError,
  InvariantNotFoundError,
  // Label errors
  LabelNotFoundError,
} from "./errors.js"

// =============================================================================
// Database
// =============================================================================
export {
  SqliteClient,
  SqliteClientLive,
  makeSqliteClient,
  getSchemaVersion,
  applyMigrations,
  runMigration,
  type SqliteDatabase,
  type SqliteStatement,
  type SqliteRunResult
} from "./db.js"

// =============================================================================
// ID Generation
// =============================================================================
export { generateTaskId, generateDocStableId, deriveDocStableId, fixtureId } from "./id.js"
export { generateUlid, isUlid } from "./utils/ulid.js"
export {
  LEGACY_SPEC_PROJECTION_KEY,
  resolveWorkspaceContext,
  legacySpecProjectionContext,
  type WorkspaceContext,
  type ResolveWorkspaceContextOptions,
  type SpecProjectionContext,
} from "./workspace-context.js"

// =============================================================================
// Schemas
// =============================================================================
export * from "./schemas/index.js"

// =============================================================================
// Mappers
// =============================================================================
export {
  rowToTask,
  rowToDependency,
  isValidStatus,
  isValidTransition,
  VALID_TRANSITIONS,
  type TaskRow,
  type DependencyRow
} from "./mappers/task.js"

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
} from "./mappers/doc.js"

export {
  asDocKind,
  isBuiltinDocKind,
  isBuiltinSpecType,
  SPEC_TYPE_NAME_PATTERN,
} from "./types/doc.js"
export { matchesGlob } from "./utils/glob.js"
export {
  normalizePathSeparators,
  toNormalizedRelativePath,
  resolvePathForComparison,
  isPathWithin,
  resolvePathWithin,
  findTxRoot,
  resolveTxDbPath,
  type PathWithinOptions,
} from "./utils/file-path.js"
export { escapeLikePattern, DEFAULT_QUERY_LIMIT } from "./utils/sql.js"
export { computeDocHash } from "./utils/doc-hash.js"
export {
  renderDocToMarkdown,
  renderIndexToMarkdown,
  composeEarsSentence,
} from "./utils/doc-renderer.js"
export {
  validateEarsRequirements,
  formatEarsValidationErrors,
  type EarsValidationError,
} from "./utils/ears-validator.js"
export {
  parseMdDoc,
  parseMdDocSync,
  MdDocParseError,
} from "./utils/md-doc-parser.js"
export {
  readTxConfig,
  writeDashboardDefaultTaskAssigmentType,
  writeDashboardDefaultTaskView,
  readDashboardCyclesConfig,
  writeDashboardCycleLengthDays,
  writeDashboardCycleStartDay,
  writeDashboardCarryStatuses,
  writeDashboardAutoAddStatuses,
  scaffoldConfigToml,
  upgradeConfigToml,
  DASHBOARD_DEFAULT_TASK_ASSIGMENT_KEY,
  DASHBOARD_DEFAULT_TASK_VIEW_KEY,
  DASHBOARD_CYCLE_LENGTH_DAYS_KEY,
  DASHBOARD_CYCLE_START_DAY_KEY,
  DASHBOARD_CARRY_STATUSES_KEY,
  type DashboardDefaultTaskAssigmentType,
  type DashboardDefaultTaskView,
  type DashboardCycleStartDay,
  type DashboardCyclesConfig,
  type SpecDesignDocMissingTaskLinksMode,
  listTomlSections,
  DEFAULT_MISSING_SECTION_MESSAGE,
  DEFAULT_UNKNOWN_SPEC_TYPE_MESSAGE,
  SPEC_LINT_MESSAGE_KEYS,
  type SpecSectionSeverity,
  type SpecSectionConfig,
  type SpecTypeConfig,
  type TxConfig,
} from "./utils/toml-config.js"
export {
  renderLintMessage,
  resolveSpecTypes,
  specTypeSubdir,
  specTypeNames,
  type SpecTypeRegistry,
  type SpecTypeDefinition,
  type SpecSectionDefinition,
} from "./utils/spec-type-registry.js"
export {
  lintSpecSections,
  type SectionLintFinding,
  type SectionLintRule,
  type SectionLintContext,
} from "./utils/spec-section-lint.js"
export {
  discoverSpecTests,
  readSpecManifest,
  defaultSpecTestPatterns,
  type DiscoveredTest,
  type SpecDiscoveryMethod,
} from "./utils/spec-discovery.js"

export * from "./layer.js"
export * from "./services/index.js"
export * from "./repo/index.js"
