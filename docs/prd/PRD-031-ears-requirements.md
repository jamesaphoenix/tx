# PRD-031: EARS Structured Requirements

## Problem
PRD requirements in tx docs are currently flat string lists. They are readable but ambiguous, difficult to lint, and hard to map directly to tests.

## Solution
Enforce EARS-based structured requirements (`ears_requirements`) as mandatory for all PRD YAML. Legacy `requirements` lists are still rendered for backward compatibility, but PRDs with legacy requirements must also define a non-empty `ears_requirements` array.

This enables machine-parseable requirements and tighter requirement-to-test traceability.

→ [DD-031](../design/DD-031-ears-requirements.md)

## Requirements
- [ ] `EARS-PRD-001` (ubiquitous): The docs renderer shall support a mandatory `ears_requirements` section in PRD YAML.
- [ ] `EARS-PRD-002` (event-driven): When PRD YAML contains invalid EARS entries, the doc service shall reject the YAML with a typed validation error.
- [ ] `EARS-PRD-003` (state-driven): While rendering PRD markdown, the renderer shall render EARS requirements in deterministic table format.
- [ ] `EARS-PRD-004` (optional): Where authors choose to keep legacy `requirements`, the system shall continue rendering legacy requirements unchanged.
- [ ] `EARS-PRD-005` (event-driven): When a user runs `tx doc lint-ears`, the CLI shall validate EARS syntax and return a non-zero exit code on failures.
- [ ] `EARS-PRD-006` (ubiquitous): The system shall preserve backwards compatibility for PRDs that have no legacy `requirements` section (EARS enforcement only triggers when legacy requirements are present).

## Acceptance Criteria
- Valid EARS sections render under a `Structured Requirements (EARS)` heading with deterministic ordering.
- Invalid EARS documents fail with `InvalidDocYamlError` that includes EARS-specific details.
- `tx doc lint-ears <doc-name-or-yaml-path>` succeeds on valid EARS input and fails on invalid input.
- Legacy PRDs (without EARS) render exactly as before.
- Mixed PRDs (legacy `requirements` + `ears_requirements`) render both sections.
- Unit and integration coverage is added for validator behavior, renderer behavior, and doc lifecycle behavior.

## Out of Scope
- Persisting EARS entries into dedicated DB tables.
- New MCP tools for EARS validation.
- Automatic trace-matrix generation from EARS IDs.
