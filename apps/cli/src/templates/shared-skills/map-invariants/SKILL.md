---
name: map-invariants
description: Auto-annotate existing tests and source code with [INV-*] / @spec tags by reading all spec gaps, understanding each invariant, and matching them to existing test assertions. Optionally creates missing tests too. Drives FCI from 0% toward 100%.
argument-hint: <doc-name> [--with-tests] (doc name required; --with-tests to also create missing tests)
---

# Map Invariants

Automatically match uncovered invariants to existing tests and source code, then annotate them with `[INV-*]` tags. Unlike `/verify-invariants` (which writes new tests from scratch), this skill starts by mapping what already exists.

**Use when:** A module has a spec (design doc + PRD) with many invariants and an existing test suite that already covers most behaviors - you just need to connect the dots.

## Options

| Flag | Effect |
|------|--------|
| *(no flag)* | Map + annotate existing tests only. MISSING invariants are reported as skeletons but **not** implemented. |
| `--with-tests` | After mapping, **also create full integration tests** for every MISSING invariant so FCI reaches 100%. |

When `--with-tests` is NOT provided, after the report in Step 7 the agent MUST ask:

> "There are **Z** missing invariants that need new tests. Would you like me to create them now?"

If the user says yes, proceed as if `--with-tests` was given (continue to Step 8).

## How tx spec Discovery Works

`tx spec discover` scans files in two passes:

1. **Test files** (matched by `test_patterns` in `.tx/config.toml`) - scanned for both `[INV-*]` bracket tags in test names AND `// @spec INV-*` comments
2. **Source files** (all programming languages) - scanned ONLY for `// @spec INV-*` comments (structural annotations)

This means `@spec` comments work in ANY file (test or source), but `[INV-*]` bracket tags are only picked up from test files.

### Critical: Worktree And Pruning Safety

`tx spec discover` reads files from the current checkout and reconciles the shared spec database. Auto-discovered tag, comment, and manifest mappings that are absent from the scan are pruned; manual mappings are preserved.

- If a worktree symlinks `.tx/tasks.db` to the primary checkout, its task and spec state is shared even though its files are branch-local.
- Always run `tx spec discover --doc <doc-ref>` from the checkout containing the target doc and annotations.
- Do not substitute an unscoped discovery run for the required doc-scoped command.
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

## Workflow

```
START
  │
  ▼
Step 1: LOAD ALL GAPS
  │
  ▼
Step 2: READ THE TEST FILES
  │
  ▼
Step 3: MATCH INVARIANTS TO CODE
  │
  ▼
Step 4: ANNOTATE
  │
  ▼
Step 5: DISCOVER + VALIDATE
  │
  ▼
Step 6: RUN TESTS + RECORD
  │
  ▼
Step 7: REPORT
  │
  ├─ No MISSING invariants? → DONE
  │
  ├─ --with-tests flag? → Step 8
  │
  └─ No flag? → Ask user → Yes? → Step 8
  │                        No?  → DONE
  ▼
Step 8: CREATE MISSING TESTS (optional)
  │
  ▼
Step 9: RE-DISCOVER + RE-RUN + FINAL REPORT
  │
  ▼
DONE
```

## Step 1 - Load All Gaps (Show the Full Picture)

Get every uncovered invariant and understand what each one means.

```bash
# Get all uncovered invariant IDs
tx spec gaps --doc $ARGUMENTS

# Get current coverage baseline
tx spec fci --doc $ARGUMENTS

# Read the full spec to understand every invariant
tx doc show $ARGUMENTS --md
```

For **each** gap, extract from the spec:

| Field | What to capture | Example |
|-------|----------------|---------|
| **id** | The invariant ID (case-sensitive, UPPERCASE) | `INV-AUTH-001` or `INV-REQ-AUTH-001` |
| **statement** | What must be true - read this carefully | "Sign-up creates a verified user and returns a session token" |
| **severity** | `critical` / `high` / `medium` / `low` | `critical` |
| **verified_by** | Suggested test file + test name from the spec | `apps/api/src/api.integration.test.ts::sign-up flow` |
| **traces_to** | Which `REQ-*` it maps to (for `INV-REQ-*` derived invariants) | `REQ-AUTH-001` |

**Print a rich summary table** showing ALL gaps with their IDs, statements, and severities before proceeding. The agent must understand what each invariant means before matching.

If FCI is already 100%, report success and stop.

### Handling Both Invariant Types

Design docs produce explicit invariants: `INV-AUTH-001`, `INV-AUTH-002`, etc.
PRDs produce derived invariants from EARS requirements: `INV-REQ-AUTH-001`, `INV-REQ-AUTH-002`, etc.

Both types appear in `tx spec gaps`. **Every invariant gets a marker** - do not skip derived invariants.

## Step 2 - Read the Test Files

Build a complete map of what every test actually verifies.

### Find all relevant test files

```bash
# Start with files referenced in verified_by hints from Step 1
# Then glob for additional test files in the module
```

Search for test files matching patterns like:
- `**/*.test.ts`, `**/*.integration.test.ts`
- `**/*.spec.ts`, `**/*.pgtap.sql`
- Any files referenced in `verified_by` hints

### Read and analyze each test file

For each test file:
1. **Read the entire file** - not just test names
2. **Extract all `it()` / `test()` blocks** with their line numbers
3. **Read each test body** to understand what it actually asserts:
   - What endpoint/function does it call?
   - What status code / return value does it expect?
   - What response body does it check?
   - What side effects does it verify (DB state, events, tokens)?
4. **Build a map**: `{ testName → [behaviors it verifies] }`

### Also read source files for structural invariants

Some invariants are enforced by code structure, not tests. Read:
- Schema files - unique indexes, constraints, cascade rules
- Permission/contract files - permission definitions, schema validations
- Domain logic files - domain rules, literals
- Middleware files, auth config, etc.

## Step 3 - Match Invariants to Code

For **each** uncovered invariant, find the code that covers it.

### Matching signals (use all of them)

| Signal | Weight | Example |
|--------|--------|---------|
| **verified_by hint** from spec | High | Spec says `api.integration.test.ts::rejects invalid credentials` |
| **Keyword overlap** between invariant statement and test name | Medium | Invariant: "rejects sign-in with wrong password" ↔ Test: `rejects sign-in with invalid credentials` |
| **Test body assertions** | High | Test calls `POST /auth/sign-in` with bad password, expects 401 |
| **Source code structure** | For structural only | Schema has `uniqueIndex('users_email_unique')` |

### Classification

Classify each invariant into exactly one category:

| Category | Meaning | Action |
|----------|---------|--------|
| **TESTABLE-MATCHED** | An existing test already covers this behavior | Append `[INV-*]` tag to test name |
| **STRUCTURAL-MATCHED** | Code structure enforces this (schema, lint, type) | Add `// @spec INV-*` comment above enforcing code |
| **MISSING** | No existing test or code covers this | Report as gap with test skeleton |

### Rules for matching

- **Read the test body, not just the name.** A test named "complete auth flow" might cover 5+ invariants. You can only tell by reading its assertions.
- **One test can match multiple invariants.** A single test can get `[INV-AUTH-005] [INV-REQ-AUTH-013]` if it verifies both behaviors.
- **Prefer TESTABLE-MATCHED over STRUCTURAL-MATCHED.** Use structural only when no test exercises the behavior and the enforcement is genuinely structural (DB constraint, type system, lint rule).
- **Be precise about matching.** Don't force-match an invariant to a vaguely related test. If the test doesn't actually assert the specific behavior, classify as MISSING.

## Step 4 - Annotate

### For TESTABLE-MATCHED: Edit test names

Append `[INV-*]` tag(s) to the `it()` description string:

```typescript
// Before
it('rejects sign-in with invalid credentials', async () => {

// After - single invariant
it('rejects sign-in with invalid credentials [INV-AUTH-011]', async () => {

// After - multiple invariants covered by one test
it('rejects sign-in with invalid credentials [INV-AUTH-011] [INV-REQ-AUTH-022]', async () => {
```

**Critical formatting rules:**
- Tag goes INSIDE the string, before the closing quote
- Space before the opening `[`
- Tags are UPPERCASE and match the spec exactly (case-sensitive)
- Multiple tags separated by spaces: `[INV-A] [INV-B]`

### For STRUCTURAL-MATCHED: Add @spec comments

Place `// @spec INV-*` comment directly above the enforcing code:

```typescript
// @spec INV-AUTH-003
export const users = pgTable('users', {
  email: varchar('email', { length: 255 }).notNull().unique(),
  // ...
})
```

For SQL files use `-- @spec INV-*`:
```sql
-- @spec INV-AUTH-003
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
```

### For MISSING: Report with test skeleton

Do NOT silently skip. For each MISSING invariant, output:

```
MISSING: INV-AUTH-042
Statement: "Rate limiting locks account after 5 failed attempts"
Severity: high
Suggested file: apps/api/src/auth.integration.test.ts
Skeleton:
  it('locks account after 5 failed sign-in attempts [INV-AUTH-042]', async () => {
    // TODO: Attempt sign-in 5 times with wrong password
    // Assert: 6th attempt returns 429 or 423
    // Assert: Account is locked in DB
  })
```

## Step 5 - Discover + Validate

Run discovery to pick up the new annotations:

```bash
tx spec discover --doc $ARGUMENTS
```

Verify the output:
- `Discovered links: N` should match the number of annotations you added
- Check `By source: tag=X, comment=Y` - tag count = test annotations, comment count = structural annotations

If links are lower than expected:
- Check annotation format (must be `[INV-*]` in test names or `// @spec INV-*` in source)
- Check ID case sensitivity (must be UPPERCASE)
- Check test file patterns in `.tx/config.toml`

Then confirm gaps reduced:
```bash
tx spec gaps --doc $ARGUMENTS
```

### Troubleshooting: 0 Links Discovered

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Scanned 0 file(s)` | Test patterns in `.tx/config.toml` don't match your test files | Add patterns like `"**/*.test.{ts,js}"` |
| Scanned files but 0 links | Annotation format wrong | Must be `[INV-TAG-001]` (with brackets) or `// @spec INV-TAG-001` |
| Links found but wrong count | ID mismatch | IDs are case-sensitive. `INV-TAG-001` is not `inv-tag-001` |
| Source `@spec` not found | Source file excluded | Check file isn't in `node_modules`, `dist`, `.git` |

### How Test IDs Are Built

`tx spec discover` builds test IDs as `{relative-file-path}::{test-name}`. For example:
- `apps/api/src/routes/auth.test.ts::rejects sign-in with invalid credentials [INV-AUTH-011]`
- `packages/infra/db/src/schema.ts::spec@line-264` (structural - no test name, uses line number)

## Step 6 - Run Tests + Record

### For test annotations (vitest)

```bash
pnpm vitest run <test-file> --reporter=json 2>/dev/null \
  | tx spec batch --from vitest
```

Run each annotated test file. The batch command matches test results to discovered spec links automatically.

### For structural annotations (manual recording)

```bash
# Get the exact test ID
tx spec tests <INV-ID>
# Output: packages/infra/db/src/schema.ts::spec@line-264 [comment]

# Record as passed after confirming the code enforces the invariant
tx spec run "<file>::spec@line-N" --passed
```

### For pgTAP annotations

```bash
pnpm test:db:pgtap
tx spec run "<pgtap-file>::<test>" --passed
```

## Step 7 - Report

```bash
tx spec fci --doc $ARGUMENTS
tx spec matrix --doc $ARGUMENTS
```

Print a summary table:

```
## Map Invariants Summary: $ARGUMENTS

| Metric | Count |
|--------|-------|
| Total invariants | N |
| TESTABLE-MATCHED (annotated existing tests) | X |
| STRUCTURAL-MATCHED (@spec in source) | Y |
| MISSING (need new tests) | Z |
| FCI | before% → after% |

### Missing Invariants (need new tests)
| ID | Statement | Severity | Suggested File |
|----|-----------|----------|----------------|
| INV-AUTH-042 | Rate limiting locks account... | high | auth.integration.test.ts |
```

### After the report

- **If `--with-tests` was passed:** proceed directly to Step 8.
- **If no MISSING invariants:** done.
- **Otherwise, ask the user:**

> "There are **Z** missing invariants that need new tests. Would you like me to create them now?"

If yes → Step 8. If no → done.

## Step 8 - Create Missing Tests (optional)

For each MISSING invariant from Step 3, write a full integration test. Follow the same conventions as `/verify-invariants` Step 3:

### Writing tests

1. **Choose the correct test file** - use the suggested file from the MISSING report, or the file where related tests already live.
2. **Write the test inside the existing `describe()` block** if one exists for the domain.
3. **Include the `[INV-*]` tag** in the test name from the start.
4. **Follow existing test patterns** - use the same helpers, fixtures, and assertion style as neighboring tests in the file.

```typescript
it('locks account after 5 failed sign-in attempts [INV-AUTH-042]', async () => {
  for (let i = 0; i < 5; i++) {
    await fetch(`${ctx.baseUrl}/auth/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'wrong' })
    })
  }
  const res = await fetch(`${ctx.baseUrl}/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: 'wrong' })
  })
  expect(res.status).toBe(429)
})
```

### Rules

- Integration tests preferred over unit tests.
- Tests must be idempotent and rerunnable.
- Seed data via API fixtures, not direct DB writes when possible.
- Critical severity invariants first.
- One test can cover multiple invariants if the assertions naturally overlap.

## Step 9 - Re-Discover + Re-Run + Final Report

After creating the missing tests, re-run the full discovery and test pipeline:

```bash
# Pick up new annotations
tx spec discover --doc $ARGUMENTS

# Run the new tests
pnpm vitest run <test-file> --reporter=json 2>/dev/null \
  | tx spec batch --from vitest

# Record any structural annotations
# tx spec run "<file>::spec@line-N" --passed

# Final coverage check
tx spec fci --doc $ARGUMENTS
tx spec gaps --doc $ARGUMENTS
tx spec matrix --doc $ARGUMENTS
```

Print the final summary:

```
## Final Map Invariants Summary: $ARGUMENTS

| Metric | Count |
|--------|-------|
| Total invariants | N |
| Mapped to existing tests | X |
| Structural annotations | Y |
| New tests written | Z |
| FCI | before% → after% |
| Remaining gaps | 0 (or list) |
```

If FCI = 100%, the doc is in HARDEN phase.

## Key Differences from /verify-invariants

| Aspect | /map-invariants | /verify-invariants |
|--------|----------------|-------------------|
| **Primary action** | Map existing tests first, optionally create missing | Write new tests from scratch |
| **Reads test bodies** | Yes - deeply analyzes assertions | No - writes from scratch |
| **Handles 60+ invariants** | Yes - batch processes all gaps | Yes - but iterates one-by-one |
| **Output for gaps** | Reports skeletons, asks before writing | Full test implementations immediately |
| **Best for** | Mature modules with existing tests | New modules needing test coverage |
| **`--with-tests` flag** | Creates missing tests after mapping | N/A - always creates tests |
