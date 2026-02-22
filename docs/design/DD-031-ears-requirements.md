# DD-031: EARS Requirements Integration

## Overview
This design adds optional EARS requirements support to PRD docs without breaking existing YAML shape.

The implementation introduces:
- Effect Schema types for EARS entries (`packages/types/src/doc.ts`)
- Pure validation utility for EARS syntax and pattern rules (`packages/core/src/utils/ears-validator.ts`)
- PRD renderer support for structured EARS output (`packages/core/src/utils/doc-renderer.ts`)
- Doc service validation hook for PRD EARS (`packages/core/src/services/doc-service.ts`)
- CLI command `tx doc lint-ears` (`apps/cli/src/commands/doc.ts`)

→ [PRD-031](../prd/PRD-031-ears-requirements.md)

## Design

### Data Model
No database schema change is required.

EARS remains authoring-time YAML structure in PRD files:

```yaml
ears_requirements:
  - id: EARS-FL-001
    pattern: ubiquitous
    system: tx learn command
    response: persist a learning entry
    priority: must
```

### Service Layer
- Add `validateEarsRequirements(requirements)` and `formatEarsValidationErrors(errors)`.
- During PRD YAML validation in `DocService`, if `ears_requirements` exists:
  - Require array shape
  - Run EARS validator
  - Throw `InvalidDocYamlError` on failures

### CLI / API Changes
- Add `tx doc lint-ears <doc-name-or-yaml-path> [--json]`.
- Extend PRD template with commented EARS example block for discoverability.
- No REST/MCP API shape changes are required in this phase.

## Implementation Plan

| Phase | Files | Changes |
|---|---|---|
| 1 | `packages/types/src/doc.ts`, `packages/types/src/index.ts` | Add EARS schema constants/types and exports |
| 2 | `packages/core/src/utils/ears-validator.ts`, `packages/core/src/index.ts` | Add pure validator utility and exports |
| 3 | `packages/core/src/utils/doc-renderer.ts` | Add EARS sentence composer + PRD EARS rendering section |
| 4 | `packages/core/src/services/doc-service.ts` | Validate PRD EARS requirements during YAML parse |
| 5 | `apps/cli/src/commands/doc.ts`, `apps/cli/src/help.ts` | Add `lint-ears` command and PRD template comments |
| 6 | `test/unit/ears-validator.test.ts`, `test/unit/doc-renderer-ears.test.ts`, `test/integration/ears-requirements.test.ts` | Add validator, renderer, and lifecycle coverage |

## Testing Strategy

### Requirement Traceability Matrix

| Requirement | Test Type | Test Name | Assertions | File Path |
|---|---|---|---|---|
| EARS-PRD-001 | Unit | renders structured EARS section | PRD markdown contains heading + EARS table | `test/unit/doc-renderer-ears.test.ts` |
| EARS-PRD-002 | Integration | rejects missing trigger | `InvalidDocYamlError` on `event_driven` without `trigger` | `test/integration/ears-requirements.test.ts` |
| EARS-PRD-002 | Unit | validates pattern-specific fields | validator emits missing `trigger/state/condition/feature` | `test/unit/ears-validator.test.ts` |
| EARS-PRD-003 | Unit | sentence composition by pattern | output sentence matches each EARS pattern | `test/unit/doc-renderer-ears.test.ts` |
| EARS-PRD-003 | Integration | renders PRD with EARS | generated `.md` includes rendered EARS rows | `test/integration/ears-requirements.test.ts` |
| EARS-PRD-004 | Unit | mixed requirements rendering | both legacy requirements and EARS sections render | `test/unit/doc-renderer-ears.test.ts` |
| EARS-PRD-005 | Integration | CLI lint valid/invalid | exit code 0 for valid, non-zero for invalid | `test/integration/ears-requirements.test.ts` |
| EARS-PRD-006 | Integration | backward compatible PRD | PRD without EARS renders unchanged and succeeds | `test/integration/ears-requirements.test.ts` |

### Unit Tests
- Validate happy path for all six EARS patterns.
- Validate required fields (`id`, `pattern`, `system`, `response`).
- Validate ID regex (`EARS-[A-Z0-9]+-\d{3}`) and duplicate ID detection.
- Validate priority enum (`must`, `should`, `could`, `wont`).
- Validate sentence composition and markdown escaping behavior in renderer.

### Integration Tests
Use singleton DB with `getSharedTestLayer()` and deterministic IDs with `fixtureId(name)`.

1. Setup: create temp docs workspace + valid EARS PRD.
   Action: create + render via `DocService`.
   Assert: generated markdown includes EARS heading and rows.
2. Setup: PRD with `event_driven` and missing `trigger`.
   Action: create via `DocService`.
   Assert: fails with `InvalidDocYamlError`.
3. Setup: PRD with duplicate EARS IDs.
   Action: create via `DocService`.
   Assert: fails with `InvalidDocYamlError`.
4. Setup: PRD without `ears_requirements`.
   Action: create + render.
   Assert: legacy behavior unchanged and no EARS section.
5. Setup: PRD with both `requirements` and `ears_requirements`.
   Action: create + render.
   Assert: both sections rendered.
6. Setup: CLI temp project + valid EARS block.
   Action: `tx doc lint-ears`.
   Assert: exit code 0 and pass message.
7. Setup: CLI temp project + invalid EARS block.
   Action: `tx doc lint-ears`.
   Assert: non-zero exit and failure message.
8. Setup: PRD with EARS entries containing markdown-special `|` characters.
   Action: render.
   Assert: table cells escape pipes correctly.

### Edge Cases
- `ears_requirements` defined but not an array.
- `complex` pattern with no clause fields.
- mixed object/string entries in rendering path.
- missing optional fields (`rationale`, `test_hint`, `priority`).

### Failure Injection
- malformed YAML parse failure in CLI linter.
- invalid root YAML type (array/scalar) in CLI linter.
- EARS schema failure propagated through `InvalidDocYamlError`.

### Performance
- EARS validation is linear over requirement count.
- Acceptable threshold: <10ms validation for 100 EARS rows on local dev machine.

## Open Questions
- Should `complex` EARS clauses enforce canonical clause order at authoring time?
- Should we introduce a dedicated `tx doc trace` command that maps EARS IDs to DD test matrices?
- Should EARS validation warnings (non-fatal) be supported in addition to hard failures?

## Migration
No runtime migration required. Existing PRDs continue to work unchanged.

## References
- [PRD-031](../prd/PRD-031-ears-requirements.md)
- `AGENTS.md` Doctrine Rules: 5, 8, 10
