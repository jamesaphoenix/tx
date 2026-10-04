---
name: verify-invariants
description: Map declared invariants to enforcement code and meaningful tests, run those tests and report verification evidence and gaps.
---

# Map and verify invariants

Start with the selected document: `tx doc show <doc-ref> --md` and
`tx spec gaps --doc <doc-ref>`. Read each statement and its exact invariant ID.
Locate the code that enforces it and the existing assertions that prove it.
Matching names alone is not evidence.

## Map code and tests

Place a comment immediately beside the actual enforcement site, using an ID
already declared in the document:

```typescript
// @spec INV-AUTH-001
const requireOwner = /* the ownership check enforcing the invariant */
```

Link executable evidence with `[INV-AUTH-001]` in the test title or
`// @spec INV-AUTH-001` immediately above the test. In SQL use
`-- @spec INV-AUTH-001`; in languages with hash comments use `# @spec INV-AUTH-001`.
IDs are case-sensitive. One invariant may map to multiple enforcement sites and
tests; one assertion may prove several invariants. Do not impose one annotation
per invariant or annotate unrelated code just to improve a score.

Reuse tests whose assertions demonstrate the behaviour, including failure paths.
When completing verification, add focused missing tests. An annotation establishes
traceability, not a passing result. Source-only enforcement needs an explicit
structural review or a suitable lint/type/constraint check; do not automatically
record source comments as passed.

## Discover and verify

Run `tx spec discover --doc <doc-ref>`, inspect the mappings with
`tx spec tests <invariant-id>`, then run the relevant repository checks. Record
actual executable results using `tx spec batch --from vitest` or the supported
runner format. For Vitest 5, write `--reporter=json --outputFile=.tx/spec-results.json`,
then import with `tx spec batch --from vitest < .tx/spec-results.json`. Import
failures too, and preserve the test runner's exit code in automated checks.
Evidence must match the mapped file and assertion, not just a shared test title.
With pipelines use `set -o pipefail`; retain failure output.
Record manual structural evidence only after performing that review and label it
as manual evidence in the report.

Report each invariant's enforcement location, executable or manual evidence and
remaining gaps. `tx spec matrix --doc <doc-ref>` and `tx spec status --doc <doc-ref>`
help inspect traceability; neither annotation count nor FCI alone proves correctness.

Keep shared task state in the main repository and select the actual content
checkout with `--state-root` and `--content-root` when using worktrees.
Discovery retains stale mappings by default. Review a document-scoped `--dry-run`
before explicitly using `--prune`; preserve manual mappings. Verify all documents
only when that scope was requested. Do not launch agents or orchestration loops.
