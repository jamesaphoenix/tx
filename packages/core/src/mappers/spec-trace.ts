/**
 * Spec traceability mappers - convert DB rows to domain objects.
 */

import {
  SPEC_DISCOVERY_METHODS,
  SPEC_SCOPE_TYPES,
  type SpecDiscoveryMethod,
  type SpecScopeType,
  type SpecTest,
  type SpecTestRun,
  type SpecSignoff,
  type SpecTestRow,
  type SpecTestRunRow,
  type SpecSignoffRow,
} from "@jamesaphoenix/tx-types"
import { InvalidStatusError } from "../errors.js"
import { parseDate } from "./parse-date.js"

export { SPEC_DISCOVERY_METHODS, SPEC_SCOPE_TYPES }

const discoveryStrings: readonly string[] = SPEC_DISCOVERY_METHODS
const scopeStrings: readonly string[] = SPEC_SCOPE_TYPES

export const isValidSpecDiscoveryMethod = (s: string): s is SpecDiscoveryMethod =>
  discoveryStrings.includes(s)

export const isValidSpecScopeType = (s: string): s is SpecScopeType =>
  scopeStrings.includes(s)

export const rowToSpecTest = (row: SpecTestRow): SpecTest => {
  if (!isValidSpecDiscoveryMethod(row.discovery)) {
    throw new InvalidStatusError({
      entity: "spec_test.discovery",
      status: row.discovery,
      validStatuses: [...SPEC_DISCOVERY_METHODS],
      rowId: row.id,
    })
  }

  return {
    id: row.id,
    invariantId: row.invariant_id,
    testId: row.test_id,
    testFile: row.test_file,
    testName: row.test_name,
    framework: row.framework,
    discovery: row.discovery,
    createdAt: parseDate(row.created_at, "created_at", row.id),
    updatedAt: parseDate(row.updated_at, "updated_at", row.id),
  }
}

export const rowToSpecTestRun = (row: SpecTestRunRow): SpecTestRun => ({
  id: row.id,
  specTestId: row.spec_test_id,
  passed: row.passed === 1,
  durationMs: row.duration_ms,
  details: row.details,
  runAt: parseDate(row.run_at, "run_at", row.id),
})

export const rowToSpecSignoff = (row: SpecSignoffRow): SpecSignoff => {
  if (!isValidSpecScopeType(row.scope_type)) {
    throw new InvalidStatusError({
      entity: "spec_signoff.scope_type",
      status: row.scope_type,
      validStatuses: [...SPEC_SCOPE_TYPES],
      rowId: row.id,
    })
  }

  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeValue: row.scope_value,
    signedOffBy: row.signed_off_by,
    notes: row.notes,
    signedOffAt: parseDate(row.signed_off_at, "signed_off_at", row.id),
  }
}
