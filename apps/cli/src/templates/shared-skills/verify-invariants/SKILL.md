---
name: verify-invariants
description: Implement and verify design doc invariants by annotating tests and source code with [INV-*] / @spec tags, then driving tx spec coverage from BUILD toward HARDEN (100% FCI). Works with any design doc that has an invariants block.
argument-hint: "[design-doc-name] (optional - omit to verify ALL docs)"
---

# Verify Invariants

Drive invariants from uncovered (BUILD phase) to fully verified (HARDEN phase) by annotating integration tests and source code with invariant IDs.

**Scope:**
- With argument (e.g. `/verify-invariants team-tags-design`): verify that doc only
- Without argument (`/verify-invariants`): verify ALL design docs and PRDs with uncovered invariants

## How tx spec Discovery Works

`tx spec discover` scans files in two passes:

1. **Test files** (matched by `test_patterns` in `.tx/config.toml`) - scanned for both `[INV-*]` bracket tags in test names AND `// @spec INV-*` comments
2. **Source files** (all programming languages) - scanned ONLY for `// @spec INV-*` comments (structural annotations)

This means `@spec` comments work in ANY file (test or source), but `[INV-*]` bracket tags are only picked up from test files.

### Critical: Worktree And Pruning Safety

`tx spec discover` reads files from the current checkout and reconciles the shared spec database. Auto-discovered tag, comment, and manifest mappings that are absent from the scan are pruned; manual mappings are preserved.

- If a worktree symlinks `.tx/tasks.db` to the primary checkout, its task and spec state is shared even though its files are branch-local.
- When verifying one doc, always use `tx spec discover --doc <doc-ref>` from the checkout containing that doc and its tests.
- Run unscoped `tx spec discover` only when the current checkout is intentionally the source of truth for every registered invariant.
- Review discovery output and the resulting spec status before recording test runs.

### Annotation Formats

| Format | Where It Works | Example |
|--------|---------------|---------|
| `[INV-TAG-001]` in test name | Test files only | `it('creates tag [INV-TAG-001]', ...)` |
| `// @spec INV-TAG-001` comment | Any file (test or source) | `// @spec INV-TAG-001` above a schema definition |
| `-- @spec INV-TAG-001` SQL comment | `.sql` files | `-- @spec INV-TAG-001` in pgTAP test |
| `# @spec INV-TAG-001` hash comment | `.py`, `.rb`, etc. | `# @spec INV-TAG-001` above a test |

### Critical: IDs Are Case-Sensitive

`INV-TAG-001` and `inv-tag-001` are NOT the same. Always use UPPERCASE as shown in the design doc's `invariants:` YAML block.

### Critical: Config Matters

The `test_patterns` in `.tx/config.toml` control which files are scanned as test files. The defaults include:

```toml
test_patterns = [
  "**/*.test.{ts,js,tsx,jsx}",
  "**/*.integration.test.{ts,js,tsx,jsx}",
  "**/*.spec.{ts,js,tsx,jsx}",
  "**/*.pgtap.sql",
  # ... and more for Go, Python, Rust, Java, Ruby, C/C++
]
```

If your test file isn't being found, check that its pattern matches one of these globs.

## Workflow State Machine

```
START
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 1: LOAD GAPS                                    │
│                                                      │
│ If <name> given:                                     │
│   tx spec gaps --doc <name>                          │
│   tx spec fci --doc <name>                           │
│   tx doc show <name> --md                            │
│                                                      │
│ If NO argument:                                      │
│   tx spec gaps        (all docs)                     │
│   tx spec fci         (global)                       │
│   tx doc list         (enumerate all docs)           │
│   For each doc with gaps:                            │
│     tx doc show <doc> --md                           │
│                                                      │
│ ├─ FCI = 100%? → Already HARDEN. Done.              │
│ └─ FCI < 100%? → Continue to Step 2                 │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 2: CLASSIFY INVARIANTS                          │
│                                                      │
│ For each uncovered invariant, decide:                │
│                                                      │
│ A) TESTABLE - can be verified by an integration      │
│    test or unit test exercising the behavior.        │
│    Examples: API returns 401, cascade deletes,       │
│    filter returns correct results.                   │
│    → Annotate in test file with [INV-*] tag          │
│                                                      │
│ B) STRUCTURAL - enforced by code structure, lint,    │
│    or DB constraint. Cannot be meaningfully tested   │
│    in isolation but IS enforced in source.           │
│    Examples: "tag names unique per org" enforced     │
│    by DB index, "no retention policy" enforced by    │
│    absence from retentionTableNames literal.         │
│    → Annotate in source code with // @spec INV-*     │
│                                                      │
│ C) PGTAP - enforced by database constraints.         │
│    → Annotate in pgTAP test with -- @spec INV-*      │
│                                                      │
│ Prefer A over B. Use B only when A is genuinely      │
│ not possible.                                        │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 3: IMPLEMENT + ANNOTATE                         │
│                                                      │
│ For TESTABLE invariants:                             │
│   Write or extend integration test files.            │
│   Annotate each test with the invariant ID:          │
│                                                      │
│   it('creates tag [INV-TAG-001]', async () => {     │
│     // test body                                     │
│   })                                                 │
│                                                      │
│   OR use comment form:                               │
│   // @spec INV-TAG-001                               │
│   it('creates tag', async () => { ... })             │
│                                                      │
│ For STRUCTURAL invariants:                           │
│   Place // @spec comment in the source file where    │
│   the invariant is enforced (schema, literals, etc.) │
│                                                      │
│ For PGTAP invariants:                                │
│   Place -- @spec comment in the .pgtap.sql file      │
│                                                      │
│ RULE: Every invariant must get exactly one            │
│ annotation somewhere in the codebase.                │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 4: DISCOVER                                     │
│                                                      │
│ tx spec discover --doc <name>                        │
│ tx spec discover          (if verifying all)         │
│                                                      │
│ Verify output shows:                                 │
│   Scanned N file(s)                                  │
│   Discovered links: M                                │
│   By source: tag=X, comment=Y                        │
│                                                      │
│ If 0 links: check annotation format, file path,      │
│ config.toml patterns, ID case sensitivity.           │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 5: RUN TESTS + RECORD RESULTS                   │
│                                                      │
│ For vitest tests:                                    │
│   pnpm vitest run <file> --reporter=json             │
│     2>/dev/null | tx spec batch --from vitest        │
│                                                      │
│ For structural annotations:                          │
│   tx spec run "<file>::spec@line-N" --passed         │
│                                                      │
│ For pgTAP:                                           │
│   pnpm test:db:pgtap                                 │
│   tx spec run "<pgtap-file>::<test>" --passed        │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 6: CHECK PROGRESS                               │
│                                                      │
│ tx spec fci --doc <name>                             │
│ tx spec gaps --doc <name>                            │
│                                                      │
│ ├─ FCI = 100% → HARDEN phase reached. Done.         │
│ ├─ Gaps remain → Loop back to Step 3 for remaining. │
│ └─ Failures → Fix failing tests, re-run Step 5.     │
└─────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────────────────────────────────────────┐
│ Step 7: REPORT                                       │
│                                                      │
│ tx spec matrix --doc <name>                          │
│ tx spec status --doc <name>                          │
│                                                      │
│ Print summary with invariant coverage breakdown.     │
└─────────────────────────────────────────────────────┘
  │
  ▼
DONE
```

## Step 1 - Load Gaps

**If a doc name was provided:**
```bash
tx spec gaps --doc $ARGUMENTS
tx spec fci --doc $ARGUMENTS
tx spec matrix --doc $ARGUMENTS
tx doc show $ARGUMENTS --md
```

**If no argument (verify all):**
```bash
tx spec gaps
tx spec fci
tx doc list
# Then for each doc with gaps:
tx doc show <doc-name> --md
```

Read each design doc markdown to understand each invariant's:
- **id** - the invariant ID (e.g. `INV-TAG-001`) - must match annotation exactly
- **statement** - what must be true
- **severity** - critical/high/medium/low (prioritize critical first)
- **verified_by** - hint about which test file should cover it
- **traces_to** - which PRD requirement it maps to

If FCI is already 100%, report success and stop.

## Step 2 - Classify Each Uncovered Invariant

For each gap from `tx spec gaps`, decide the verification strategy:

| Category | When to use | Annotation style | Where |
|----------|------------|-----------------|-------|
| **TESTABLE** | Behavior can be exercised via API call, function call, or DB query | `[INV-*]` in test name or `// @spec INV-*` near test | Test file (`.test.ts`, `.integration.test.ts`, `.pgtap.sql`) |
| **STRUCTURAL** | Enforced by schema, lint rule, type system, or code structure - no meaningful test possible | `// @spec INV-*` comment | Source file where enforcement lives (schema.ts, literals.ts, service file) |
| **PGTAP** | Database constraint, trigger, or index behavior | `-- @spec INV-*` SQL comment | `.pgtap.sql` test file |

**Prefer TESTABLE.** Most invariants should be verifiable by a test. Only use STRUCTURAL when the invariant is genuinely about code structure (e.g., "table X is NOT in retentionTableNames" - verified by inspecting the literal array, not by running a test).

## Step 3 - Implement and Annotate

### Integration test annotation (preferred)

The `[INV-*]` bracket tag in the test name is the cleanest approach - `tx spec discover` extracts both the invariant ID and the test name from the same line:

```typescript
it('creates tag with name and color [INV-TAG-001]', async () => {
  const res = await fetch(`${ctx.baseUrl}/v1/organizations/${orgId}/tags`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ name: 'Engineering', color: '#3B82F6' })
  })
  expect(res.status).toBe(201)
})
```

The comment form also works - place it on the line immediately before or up to 2 lines above the `it()`:

```typescript
// @spec INV-TAG-100
it('returns 401 without auth token', async () => {
  const res = await fetch(`${ctx.baseUrl}/v1/organizations/${orgId}/tags`)
  expect(res.status).toBe(401)
})
```

### Source code annotation (structural)

`tx spec discover` scans ALL source files (any language) for `@spec` comments. Place the annotation directly above the code that enforces the invariant:

```typescript
// @spec INV-TAG-200
export const teamTags = pgTable('team_tags', {
  // ...columns
}, (table) => ({
  orgNameCiUnique: uniqueIndex('team_tags_org_name_ci_unique')
    .on(table.organizationId, sql`lower(trim(${table.name}))`)
}))
```

**Important:** Structural annotations create a link with a test ID like `packages/infra/db/src/schema.ts::spec@line-264`. You must manually record these as passed since there's no test to run:

```bash
# Get the exact test ID
tx spec tests INV-TAG-200
# Output: packages/infra/db/src/schema.ts::spec@line-264 [comment]

# Record as passed
tx spec run "packages/infra/db/src/schema.ts::spec@line-264" --passed
```

### pgTAP annotation

```sql
-- @spec INV-TAG-202
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'team_tag_assignments_tag_id_fkey'
    AND confdeltype = 'c'
  ),
  'tag assignments cascade-delete when tag is deleted'
);
```

### Rules

- Every invariant gets **exactly one** annotation somewhere in the codebase
- One test/annotation can cover multiple invariants: `[INV-TAG-001] [INV-TAG-002]`
- Critical severity invariants should be covered first
- Integration tests are preferred over unit tests (hard requirement from design doc skill)

## Step 4 - Discover

```bash
# For a specific doc
tx spec discover --doc $ARGUMENTS

# For all docs
tx spec discover
```

Expected output:
```
Scanned 123 file(s)
Discovered links: 14
Upserted links: 14
By source: tag=12, comment=2, manifest=0
```

### Troubleshooting: 0 Links Discovered

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Scanned 0 file(s)` | Test patterns in `.tx/config.toml` don't match your test files | Add patterns like `"**/*.test.{ts,js}"` or `"**/*.integration.test.{ts,js}"` |
| Scanned files but 0 links | Annotation format wrong | Must be `[INV-TAG-001]` (with brackets) or `// @spec INV-TAG-001` - no other formats work |
| Links found but wrong count | ID mismatch | IDs are case-sensitive. `INV-TAG-001` is not `inv-tag-001` or `INV-Tag-001` |
| Source `@spec` not found | Source file excluded | Check file isn't in `node_modules`, `dist`, `.git`, or other skip dirs |

### How Test IDs Are Built

`tx spec discover` builds test IDs as `{relative-file-path}::{test-name}`. For example:
- `apps/api/src/routes/team-tags.test.ts::creates tag with name and color [INV-TAG-001]`
- `packages/infra/db/src/schema.ts::spec@line-264` (structural - no test name, uses line number)

## Step 5 - Run Tests and Record Results

### Vitest (primary path)

```bash
# Run specific test file and pipe JSON results to tx
pnpm vitest run apps/api/src/routes/team-tags.test.ts --reporter=json 2>/dev/null | tx spec batch --from vitest
```

`tx spec batch --from vitest` does the following:
1. Parses the vitest JSON report
2. Normalizes absolute file paths to relative (strips repo root)
3. Matches test results to discovered spec_tests by `{file}::{title}`
4. Records PASS/FAIL runs for each matched invariant

**Important:** vitest outputs absolute paths but `tx spec discover` stores relative paths. The batch parser handles this automatically by stripping common path prefixes (`/apps/`, `/packages/`, `/src/`, etc.).

**Important:** vitest `fullName` includes describe ancestry (e.g. `suite name > test name`) but discover stores just the `it()` title. The batch parser emits both variants and matches on the `title` (shorter form) first.

### Structural annotations (manual recording)

Structural annotations (source code `@spec` comments) have no test to run. After confirming the code correctly enforces the invariant, record them manually:

```bash
# Get the exact test ID from tx spec tests
tx spec tests INV-TAG-200
# Output: packages/infra/db/src/schema.ts::spec@line-264 [comment]

# Record as passed
tx spec run "packages/infra/db/src/schema.ts::spec@line-264" --passed
```

### pgTAP tests

```bash
# Run pgTAP suite
pnpm test:db:pgtap

# Record results manually (pgTAP doesn't output vitest-compatible JSON)
tx spec run "packages/infra/db/pgtap/003_team_tags.pgtap.sql::cascade delete" --passed
```

## Step 6 - Check Progress and Iterate

```bash
tx spec fci --doc $ARGUMENTS
tx spec gaps --doc $ARGUMENTS
```

### FCI Phases

| FCI | Phase | Meaning |
|-----|-------|---------|
| 0% | BUILD | No invariants verified - just starting |
| 1-99% | BUILD | Some invariants verified, gaps remain |
| 100% | HARDEN | All invariants linked + passing - ready for sign-off |
| 100% + sign-off | COMPLETE | Human confirmed feature is done |

### What "untested" Means

`tx spec fci` distinguishes between:
- **covered** - invariant has a linked test/annotation (via discover)
- **passing** - linked test has a recorded PASS run (via batch or manual)
- **untested** - covered but no run recorded yet

A common state is `covered=14, passing=12, untested=2` - meaning 2 invariants are linked (discovered) but you haven't yet run `tx spec run --passed` for them. This typically happens with structural annotations.

### Iteration Loop

If gaps remain:
1. Check which invariants are uncovered: `tx spec gaps --doc <name>`
2. Add the missing annotation (test or source)
3. Re-run `tx spec discover`
4. Run tests + record results
5. Check FCI again

## Step 7 - Report

```bash
tx spec matrix --doc $ARGUMENTS
tx spec status --doc $ARGUMENTS
```

The matrix shows every invariant with its linked test and latest result:

```
INV-TAG-001: Organizations can create, list, update, and delete tags via API
  - apps/api/src/routes/team-tags.test.ts::creates tag [INV-TAG-001] [tag] latest=PASS
INV-TAG-200: Tag names are unique per org via DB index
  - packages/infra/db/src/schema.ts::spec@line-264 [comment] latest=PASS
```

Print a summary:
- Total invariants
- Covered by test annotations vs source annotations
- FCI percentage and phase
- Any remaining gaps or failures

## After Verification

1. **FCI = 100%** → phase is HARDEN. All invariants are mechanically verified.
2. **Human sign-off**: `tx spec complete --doc <name> --by <name>` → moves to COMPLETE.
3. **Regression detection**: Re-run tests periodically → `tx spec batch` → FCI drops if a test fails, phase reverts to BUILD.

## Proven Example (team-tags-design)

This workflow was tested end-to-end with the `team-tags-design` doc:

```
14 invariants (design doc)
  ↓ tx spec discover
12 [INV-*] tags in test file + 2 @spec comments in schema.ts = 14 links
  ↓ vitest run | tx spec batch --from vitest
12 test results recorded (PASS)
  ↓ tx spec run --passed (2 structural)
2 structural results recorded
  ↓ tx spec fci
FCI: 100% (HARDEN)
  ↓ tx spec matrix
All 14 invariants → PASS
```
